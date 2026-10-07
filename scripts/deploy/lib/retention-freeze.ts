/**
 * The frozen retention proposal: which deployments may be deleted, and which are kept, written as two hashed files.
 * Pure: no filesystem, no network, no clock (the time is an input). Nothing here can delete anything.
 *
 * PRESERVATION-FIRST, and stricter than the planner in vercel-retention.ts (which it runs as a second, independent opinion):
 * a deployment is a CANDIDATE only if EVERY check in CHECK_NAMES passes. Any failing check, and anything this code cannot
 * confidently classify (an unfamiliar metadata key, a state that is not READY, a size that could not be read, a preview), is KEEP.
 * Unknown is KEEP; uncertainty is never read as DELETE.
 *
 * The deletion tool re-derives the whole classification from the proposal file (`verifyProposal`) and refuses a proposal whose
 * candidate set is not exactly what the rules produce from its own frozen inventory, so a hand-edited list cannot pass even if
 * someone re-hashes it.
 */
import { canonicalText, sha256 } from './retention-hash.ts'
import { inventoryDigest, type LiveRow } from './vercel-live-read.ts'
import { classify, type DeploymentRow, lastOfEachDay } from './vercel-retention.ts'

export const SCHEMA = 'vercel-retention/1'
export const KEEP_NEWEST = 15
export const MIN_AGE_DAYS = 7
/** "Every UTC day represented in history", not a rolling window. */
export const ALL_HISTORY_DAYS = 36_500
/** Metadata keys Vercel adds on its own. Any other key on a deployment may mean somebody recorded something about it. */
export const BENIGN_META_KEYS: ReadonlySet<string> = new Set(['lambdaRuntimeStats'])
/**
 * Tracked files that are LISTS of deployments, not records that depend on them. The 5 October inventory names every deployment
 * that existed that day (241 ids); counting it as a reference would protect all of them and make any cleanup impossible.
 * This is one explicit file, not a pattern. Everything else tracked, including docs/performance, counts.
 */
export const INVENTORY_LISTS_NOT_REFERENCES: readonly string[] = [
  'docs/performance/vercel-cleanup-inventory-2026-10-05.csv',
]
const DAY = 86_400_000

export const CHECK_NAMES = [
  'not-current-production',
  'no-alias',
  'not-rollback-target',
  'not-validation-preview',
  'not-referenced-in-tracked-files',
  'not-named-by-reviewer',
  'older-than-7-days',
  'not-newest-15-ready-production',
  'not-daily-keeper',
  'not-vercel-retention-protected',
  'settled-READY',
  'production-build-not-preview',
  'metadata-is-only-vercels-own',
  'size-known',
] as const

export interface RowFacts {
  id: string
  created: number
  target: 'production' | 'preview'
  state: string
  aliases: string[]
  metaKeys: string[]
  metaSha: string
  bytes: number
  bundles: number
  bytesKnown: boolean
}

export interface FreezeContext {
  now: number
  productionId: string
  aliasedIds: ReadonlySet<string>
  rollbackId: string
  validationIds: ReadonlySet<string>
  /** Ids named in tracked repository files (minus INVENTORY_LISTS_NOT_REFERENCES). */
  referencedIds: ReadonlySet<string>
  extraKeep: ReadonlySet<string>
}

export interface Evaluation {
  id: string
  keepReasons: string[]
  checks: { name: (typeof CHECK_NAMES)[number]; ok: boolean }[]
  candidate: boolean
}

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const newestFirst = (a: RowFacts, b: RowFacts): number =>
  b.created - a.created || a.id.localeCompare(b.id)

const WHY_KEPT: Record<(typeof CHECK_NAMES)[number], string> = {
  'not-current-production': 'current production deployment',
  'no-alias': 'behind a live alias',
  'not-rollback-target': 'the previous known-good rollback deployment',
  'not-validation-preview': 'a validation preview',
  'not-referenced-in-tracked-files': 'named in a tracked repository file',
  'not-named-by-reviewer': 'kept by name on review',
  'older-than-7-days': 'created in the last 7 days',
  'not-newest-15-ready-production': 'one of the newest 15 ready production deployments',
  'not-daily-keeper': 'the last ready production deployment of its UTC day',
  'not-vercel-retention-protected': "protected by Vercel's own retention exceptions",
  'settled-READY':
    'not a settled READY deployment (building, queued, errored or unknown: kept as possible evidence)',
  'production-build-not-preview': 'a preview (previews are kept in this proposal)',
  'metadata-is-only-vercels-own':
    'carries metadata somebody recorded (release, benchmark, provenance or similar)',
  'size-known': 'its bundle size could not be read, so it cannot be judged',
}

/** Classify every row. A row is a candidate only if every check passes AND the planner agrees. */
export function evaluate(rows: readonly RowFacts[], ctx: FreezeContext): Evaluation[] {
  const planner = classify(
    rows.map(
      (r): DeploymentRow => ({
        id: r.id,
        url: '',
        created: r.created,
        target: r.target,
        state: r.state,
        bundles: r.bundles,
        bytes: r.bytes,
        aliases: r.aliases,
        docRefs: ctx.referencedIds.has(r.id) ? ['tracked file'] : [],
        experiment: null,
      }),
    ),
    {
      liveId: ctx.productionId,
      now: ctx.now,
      keepNewestProduction: KEEP_NEWEST,
      windowDays: MIN_AGE_DAYS,
      dailyDays: ALL_HISTORY_DAYS,
      extraKeep: new Set([...ctx.extraKeep, ctx.rollbackId, ...ctx.validationIds]),
      docIds: ctx.referencedIds,
    },
  )
  const plannerById = new Map(planner.map((d) => [d.id, d]))
  const readyProd = rows
    .filter((r) => r.target === 'production' && r.state === 'READY')
    .sort(newestFirst)
  const newest15 = new Set(readyProd.slice(0, KEEP_NEWEST).map((r) => r.id))
  const lastThreeProd = new Set(readyProd.slice(0, 3).map((r) => r.id))
  const lastThreeAny = new Set(
    [...rows]
      .sort(newestFirst)
      .slice(0, 3)
      .map((r) => r.id),
  )
  const daily = lastOfEachDay(
    rows.map(
      (r): DeploymentRow => ({
        id: r.id,
        url: '',
        created: r.created,
        target: r.target,
        state: r.state,
        bundles: r.bundles,
        bytes: r.bytes,
        aliases: [],
        docRefs: [],
        experiment: null,
      }),
    ),
    ctx.now,
    ALL_HISTORY_DAYS,
  )
  const windowStart = ctx.now - MIN_AGE_DAYS * DAY

  return rows.map((r): Evaluation => {
    const ok: Record<(typeof CHECK_NAMES)[number], boolean> = {
      'not-current-production': r.id !== ctx.productionId,
      'no-alias': r.aliases.length === 0 && !ctx.aliasedIds.has(r.id),
      'not-rollback-target': r.id !== ctx.rollbackId,
      'not-validation-preview': !ctx.validationIds.has(r.id),
      'not-referenced-in-tracked-files': !ctx.referencedIds.has(r.id),
      'not-named-by-reviewer': !ctx.extraKeep.has(r.id),
      'older-than-7-days': r.created < windowStart,
      'not-newest-15-ready-production': !newest15.has(r.id),
      'not-daily-keeper': !daily.has(r.id),
      'not-vercel-retention-protected':
        r.id !== ctx.productionId &&
        r.aliases.length === 0 &&
        !lastThreeProd.has(r.id) &&
        !lastThreeAny.has(r.id),
      'settled-READY': r.state === 'READY',
      'production-build-not-preview': r.target === 'production',
      'metadata-is-only-vercels-own': r.metaKeys.every((k) => BENIGN_META_KEYS.has(k)),
      'size-known': r.bytesKnown,
    }
    const checks = CHECK_NAMES.map((name) => ({ name, ok: ok[name] }))
    const keepReasons = checks.filter((c) => !c.ok).map((c) => WHY_KEPT[c.name])
    const p = plannerById.get(r.id)
    // The planner is a second opinion: if it keeps something every check here passed, it is kept and the disagreement is shown.
    if (p === undefined) keepReasons.push('not classified by the planner')
    else if (keepReasons.length === 0 && p.action === 'KEEP')
      keepReasons.push(`planner keeps it: ${p.keepReasons.join('; ')}`)
    return { id: r.id, keepReasons, checks, candidate: keepReasons.length === 0 }
  })
}

export interface InventoryRow {
  id: string
  created: number
  target: 'production' | 'preview'
  state: string
  aliases: string[]
  metaKeys: string[]
  metaSha: string
}
export interface Candidate {
  id: string
  created: number
  createdUtc: string
  state: string
  target: string
  bytes: number
  bundles: number
  eligibleBecause: string
  /** Every check that passed (all of CHECK_NAMES, or the id is not a candidate). */
  checks: string[]
}
export interface KeepEntry {
  id: string
  created: number
  createdUtc: string
  state: string
  target: string
  bytes: number
  bundles: number
  reasons: string[]
}
export interface Totals {
  inventory: { deployments: number; bytes: number }
  keep: { deployments: number; bytes: number }
  delete: { deployments: number; bytes: number }
}
export interface KeepFile {
  schema: string
  generatedAt: string
  projectId: string
  keeps: KeepEntry[]
  totals: Totals
}
export interface Proposal {
  schema: string
  generatedAt: string
  teamId: string
  projectId: string
  projectName: string
  production: { id: string; aliases: { alias: string; deploymentId: string }[] }
  rollbackId: string
  validationIds: string[]
  extraKeep: string[]
  referencedIds: string[]
  rule: { keepNewestReadyProduction: number; protectedWindowDays: number; dailyKeeperDays: string }
  inventory: InventoryRow[]
  inventoryDigest: string
  keepSha256: string
  candidates: Candidate[]
  totals: Totals
}

export class FreezeRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface FreezeInputs {
  now: number
  teamId: string
  project: { id: string; name: string }
  production: { id: string; aliases: { alias: string; deploymentId: string }[] }
  rollbackId: string
  validationIds: readonly string[]
  rows: readonly RowFacts[]
  referencedIds: readonly string[]
  extraKeep: readonly string[]
}

const sum = (xs: readonly { bytes: number }[]): { deployments: number; bytes: number } => ({
  deployments: xs.length,
  bytes: xs.reduce((n, x) => n + x.bytes, 0),
})

const contextOf = (i: {
  now: number
  production: { id: string; aliases: { deploymentId: string }[] }
  rollbackId: string
  validationIds: readonly string[]
  referencedIds: readonly string[]
  extraKeep: readonly string[]
}): FreezeContext => ({
  now: i.now,
  productionId: i.production.id,
  aliasedIds: new Set(i.production.aliases.map((a) => a.deploymentId)),
  rollbackId: i.rollbackId,
  validationIds: new Set(i.validationIds),
  referencedIds: new Set(i.referencedIds),
  extraKeep: new Set(i.extraKeep),
})

/** Build the two frozen files from a live reading. Throws FreezeRefused when the premises are not what was said. */
export function buildFreeze(i: FreezeInputs): {
  proposal: Proposal
  keep: KeepFile
  proposalText: string
  keepText: string
  evaluation: Evaluation[]
} {
  const byId = new Map(i.rows.map((r) => [r.id, r]))
  const need = (id: string, what: string): RowFacts => {
    const r = byId.get(id)
    if (r === undefined)
      throw new FreezeRefused('premise', `${what} ${id} is not in the live inventory`)
    return r
  }
  const prod = need(i.production.id, 'the production deployment')
  if (prod.target !== 'production' || prod.state !== 'READY')
    throw new FreezeRefused(
      'premise',
      'the production deployment is not a READY production deployment',
    )
  const rb = need(i.rollbackId, 'the rollback deployment')
  if (i.rollbackId === i.production.id)
    throw new FreezeRefused(
      'premise',
      'the rollback deployment is the current production deployment',
    )
  if (rb.target !== 'production' || rb.state !== 'READY')
    throw new FreezeRefused(
      'premise',
      'the rollback deployment is not a READY production deployment',
    )
  for (const v of i.validationIds) {
    const r = need(v, 'the validation preview')
    if (r.target !== 'preview' || r.state !== 'READY')
      throw new FreezeRefused('premise', `${v} is not a READY preview`)
  }
  for (const a of i.production.aliases)
    need(a.deploymentId, `the deployment behind alias ${a.alias}`)

  const ctx = contextOf(i)
  const evaluation = evaluate(i.rows, ctx)
  const candidateIds = new Set(evaluation.filter((e) => e.candidate).map((e) => e.id))
  const iso = (ms: number): string => new Date(ms).toISOString()
  const keeps: KeepEntry[] = []
  const candidates: Candidate[] = []
  for (const r of [...i.rows].sort(newestFirst)) {
    const ev = evaluation.find((e) => e.id === r.id) as Evaluation
    if (candidateIds.has(r.id)) {
      candidates.push({
        id: r.id,
        created: r.created,
        createdUtc: iso(r.created),
        state: r.state,
        target: r.target,
        bytes: r.bytes,
        bundles: r.bundles,
        eligibleBecause: `superseded production build of ${utcDay(r.created)}, ${String(Math.floor((i.now - r.created) / DAY))} days old: passed all ${String(CHECK_NAMES.length)} safety checks`,
        checks: ev.checks.filter((c) => c.ok).map((c) => c.name),
      })
    } else {
      keeps.push({
        id: r.id,
        created: r.created,
        createdUtc: iso(r.created),
        state: r.state,
        target: r.target,
        bytes: r.bytes,
        bundles: r.bundles,
        reasons: ev.keepReasons,
      })
    }
  }
  const totals: Totals = {
    inventory: sum(i.rows),
    keep: sum(keeps),
    delete: sum(candidates),
  }
  const generatedAt = iso(i.now)
  const keep: KeepFile = { schema: SCHEMA, generatedAt, projectId: i.project.id, keeps, totals }
  const keepText = canonicalText(keep)
  const inventory: InventoryRow[] = [...i.rows]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => ({
      id: r.id,
      created: r.created,
      target: r.target,
      state: r.state,
      aliases: [...r.aliases].sort(),
      metaKeys: [...r.metaKeys].sort(),
      metaSha: r.metaSha,
    }))
  const proposal: Proposal = {
    schema: SCHEMA,
    generatedAt,
    teamId: i.teamId,
    projectId: i.project.id,
    projectName: i.project.name,
    production: { id: i.production.id, aliases: [...i.production.aliases] },
    rollbackId: i.rollbackId,
    validationIds: [...i.validationIds].sort(),
    extraKeep: [...i.extraKeep].sort(),
    referencedIds: [...i.referencedIds].sort(),
    rule: {
      keepNewestReadyProduction: KEEP_NEWEST,
      protectedWindowDays: MIN_AGE_DAYS,
      dailyKeeperDays: 'every UTC day in history',
    },
    inventory,
    inventoryDigest: inventoryDigest(
      inventory.map((r) => ({ ...r, rollbackCandidate: false }) as LiveRow),
    ),
    keepSha256: sha256(keepText),
    candidates,
    totals,
  }
  return { proposal, keep, proposalText: canonicalText(proposal), keepText, evaluation }
}

/**
 * Everything the deletion tool needs to trust before it touches anything: the bytes hash to what a person approved, the keep
 * file is the one the proposal names, the two files partition the inventory exactly, and the rules re-derive the SAME candidate
 * set from the proposal's own frozen inventory. Throws FreezeRefused with a code; never returns a partly-trusted answer.
 */
export function verifyProposal(
  proposalText: string,
  keepText: string,
  expectedSha256: string,
): { proposal: Proposal; keep: KeepFile } {
  // PROTECTION: the proposal hash. The tool accepts only the exact bytes a person hashed and approved.
  if (sha256(proposalText) !== expectedSha256)
    throw new FreezeRefused('hash-mismatch', 'the proposal does not hash to the approved value')
  let proposal: Proposal
  let keep: KeepFile
  try {
    proposal = JSON.parse(proposalText) as Proposal
    keep = JSON.parse(keepText) as KeepFile
  } catch {
    throw new FreezeRefused('proposal-invalid', 'a frozen file is not valid JSON')
  }
  if (proposal.schema !== SCHEMA || keep.schema !== SCHEMA)
    throw new FreezeRefused('proposal-invalid', 'unknown schema')
  if (sha256(keepText) !== proposal.keepSha256)
    throw new FreezeRefused(
      'keep-hash-mismatch',
      'the keep file is not the one this proposal names',
    )
  const inv = new Map(proposal.inventory.map((r) => [r.id, r]))
  const cands = new Map(proposal.candidates.map((c) => [c.id, c]))
  const keeps = new Map(keep.keeps.map((k) => [k.id, k]))
  if (
    inv.size !== proposal.inventory.length ||
    cands.size !== proposal.candidates.length ||
    keeps.size !== keep.keeps.length
  )
    throw new FreezeRefused('proposal-invalid', 'a deployment id appears twice')
  for (const id of cands.keys())
    if (keeps.has(id))
      throw new FreezeRefused('proposal-invalid', `${id} is both a candidate and a keep`)
  if (cands.size + keeps.size !== inv.size)
    throw new FreezeRefused(
      'proposal-invalid',
      'candidates and keeps do not partition the inventory',
    )
  for (const id of [...cands.keys(), ...keeps.keys()])
    if (!inv.has(id))
      throw new FreezeRefused('proposal-invalid', `${id} is not in the frozen inventory`)
  const recomputed = inventoryDigest(
    proposal.inventory.map((r) => ({ ...r, rollbackCandidate: false }) as LiveRow),
  )
  if (recomputed !== proposal.inventoryDigest)
    throw new FreezeRefused('proposal-invalid', 'the inventory digest does not match the inventory')

  const rows: RowFacts[] = proposal.inventory.map((r) => {
    const src = cands.get(r.id) ?? keeps.get(r.id)
    return {
      id: r.id,
      created: r.created,
      target: r.target,
      state: r.state,
      aliases: r.aliases,
      metaKeys: r.metaKeys,
      metaSha: r.metaSha,
      bytes: src?.bytes ?? 0,
      bundles: src?.bundles ?? 0,
      bytesKnown: src !== undefined,
    }
  })
  const ev = evaluate(
    rows,
    contextOf({
      now: Date.parse(proposal.generatedAt),
      production: proposal.production,
      rollbackId: proposal.rollbackId,
      validationIds: proposal.validationIds,
      referencedIds: proposal.referencedIds,
      extraKeep: proposal.extraKeep,
    }),
  )
  const derived = new Set(ev.filter((e) => e.candidate).map((e) => e.id))
  for (const id of cands.keys())
    if (!derived.has(id))
      throw new FreezeRefused('proposal-invalid', `${id} is a candidate but the rules keep it`)
  for (const id of derived)
    if (!cands.has(id))
      throw new FreezeRefused(
        'proposal-invalid',
        `${id} is not a candidate but the rules would delete it`,
      )
  for (const c of proposal.candidates)
    if (c.checks.length !== CHECK_NAMES.length)
      throw new FreezeRefused('proposal-invalid', `${c.id} did not pass every check`)
  return { proposal, keep }
}

/** Ids named in tracked files, from `git grep -o` output (path:id per line), minus the files that are lists, not references. */
export function collectReferencedIds(
  grepOutput: string,
  exclude: readonly string[] = INVENTORY_LISTS_NOT_REFERENCES,
): { ids: string[]; byFile: Map<string, number> } {
  const skip = new Set(exclude)
  const ids = new Set<string>()
  const byFile = new Map<string, number>()
  for (const line of grepOutput.split('\n')) {
    const at = line.indexOf(':')
    if (at < 0) continue
    const file = line.slice(0, at)
    const id = line.slice(at + 1).trim()
    if (!/^dpl_[A-Za-z0-9]{20,}$/.test(id) || skip.has(file)) continue
    ids.add(id)
    byFile.set(file, (byFile.get(file) ?? 0) + 1)
  }
  return { ids: [...ids].sort(), byFile }
}

export interface StagePick {
  id: string
  createdUtc: string
  bytes: number
  beforeProtected: { id: string; createdUtc: string; why: string } | null
  afterProtected: { id: string; createdUtc: string; why: string } | null
  why: string
}

const SIGNIFICANT = [
  'named in a tracked repository file',
  'kept by name on review',
  'current production',
  'rollback deployment',
  'validation preview',
]

/**
 * Stage 1: the five OLDEST, least-significant, highest-confidence candidates. A candidate qualifies only if its bundle size is
 * ordinary (within 20% of the median non-empty candidate), it has bundles at all, and neither neighbouring protected deployment
 * (the nearest KEEP on each side by creation time) is within two hours of it AND significant (a release record, a named
 * deployment). Stage 2 is everything else, in batches of 10, 20, then 25.
 */
export function planStages(
  proposal: Proposal,
  keep: KeepFile,
): { stage1: StagePick[]; later: string[][] } {
  const withBytes = proposal.candidates
    .filter((c) => c.bytes > 0)
    .map((c) => c.bytes)
    .sort((a, b) => a - b)
  const median =
    withBytes.length === 0 ? 0 : (withBytes[Math.floor(withBytes.length / 2)] as number)
  const keeps = [...keep.keeps].sort((a, b) => a.created - b.created)
  const near = (created: number): { before: KeepEntry | null; after: KeepEntry | null } => {
    let before: KeepEntry | null = null
    let after: KeepEntry | null = null
    for (const k of keeps) {
      if (k.created < created) before = k
      else if (k.created > created && after === null) after = k
    }
    return { before, after }
  }
  const significant = (k: KeepEntry | null): boolean =>
    k?.reasons.some((r) => SIGNIFICANT.some((s) => r.includes(s))) ?? false
  const twoHours = 2 * 3_600_000
  const oldestFirst = [...proposal.candidates].sort((a, b) => a.created - b.created)
  const picks: StagePick[] = []
  const used = new Set<string>()
  for (const c of oldestFirst) {
    if (picks.length === 5) break
    if (c.bundles === 0 || c.bytes === 0) continue
    if (median > 0 && Math.abs(c.bytes - median) > 0.2 * median) continue
    const { before, after } = near(c.created)
    if (significant(before) && c.created - (before as KeepEntry).created < twoHours) continue
    if (significant(after) && (after as KeepEntry).created - c.created < twoHours) continue
    const brief = (k: KeepEntry | null): StagePick['beforeProtected'] =>
      k === null ? null : { id: k.id, createdUtc: k.createdUtc, why: k.reasons[0] ?? '' }
    picks.push({
      id: c.id,
      createdUtc: c.createdUtc,
      bytes: c.bytes,
      beforeProtected: brief(before),
      afterProtected: brief(after),
      why: `${c.eligibleBecause}; ordinary size; not adjacent to a release record`,
    })
    used.add(c.id)
  }
  const rest = oldestFirst.filter((c) => !used.has(c.id)).map((c) => c.id)
  const later: string[][] = []
  for (const size of [10, 20]) {
    if (rest.length > 0) later.push(rest.splice(0, size))
  }
  while (rest.length > 0) later.push(rest.splice(0, 25))
  return { stage1: picks, later }
}
