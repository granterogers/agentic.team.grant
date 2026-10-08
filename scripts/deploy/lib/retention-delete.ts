/**
 * The deletion procedure for a FROZEN retention proposal, over an injected client. Pure of its own network and filesystem:
 * the one DELETE request this module can make goes through the client it is handed, and the log goes through a function it is
 * handed. scripts/vercel/vercel-retention-delete.ts wires the real ones; tests wire a fake Vercel and an array.
 *
 * Nothing here is a bulk tool. It deletes exactly the ids it is given, each of which must be in the hashed proposal's candidate
 * list, one per request, strictly in sequence, and it STOPS at the first thing it did not expect. There is no "everything older
 * than", no wildcard, no retry, no parallelism and no way to continue after a failure inside one run.
 *
 * Before ANY deletion it verifies: the proposal hashes to the approved value; the keep file is the one it names; the rules
 * re-derive the same candidate set from the proposal's own inventory; the proposal is fresh; every requested id is allowed.
 * Before EACH deletion it re-reads the world and refuses if anything differs from the frozen inventory: production, aliases,
 * the whole list of deployments (so a new deployment or any state change is a refusal), the deployment itself, its bundle size,
 * and whether a tracked file now names it.
 */
import { FreezeRefused, type KeepFile, type Proposal, verifyProposal } from './retention-freeze.ts'
import {
  type HttpClient,
  inventoryDigest,
  type LiveRow,
  metaDigest,
  readBytes,
  readDeployment,
  readLive,
} from './vercel-live-read.ts'

/** Never more than this many ids in one run, whatever is asked. */
export const MAX_PER_RUN = 25
/** A proposal older than this is refused; the caller can only ask for a shorter limit. */
export const MAX_AGE_MS = 60 * 60_000
const CLOCK_SKEW_MS = 5 * 60_000
/** Exact ids only: no wildcard character can match this. */
export const ID_PATTERN = /^dpl_[A-Za-z0-9]{10,}$/

export type Code =
  | 'hash-mismatch'
  | 'keep-hash-mismatch'
  | 'proposal-invalid'
  | 'stale-proposal'
  | 'bad-id'
  | 'duplicate-id'
  | 'too-many'
  | 'current-production'
  | 'aliased'
  | 'rollback-target'
  | 'protected'
  | 'not-in-proposal'
  | 'production-changed'
  | 'aliases-changed'
  | 'inventory-changed'
  | 'missing'
  | 'already-deleted'
  | 'deployment-changed'
  | 'bytes-changed'
  | 'referenced'
  | 'unexpected-response'
  | 'ambiguous'
  | 'log-failed'
  | 'read-failed'

/** A refusal BEFORE anything was deleted. */
export class Refused extends Error {
  constructor(
    readonly code: Code,
    message: string,
  ) {
    super(message)
  }
}

export interface LogEntry {
  at: string
  run: string
  phase: 'attempt' | 'completed' | 'dry-run'
  id: string
  /** For `completed`: deleted | unexpected | ambiguous. */
  result?: string
  httpStatus?: number
  detail?: string
}

export interface DeleteOptions {
  client: HttpClient
  proposalText: string
  keepText: string
  /** The sha256 a person approved. The proposal must hash to exactly this. */
  expectedSha256: string
  ids: readonly string[]
  /** Without this nothing is deleted: every check runs and the answer is what WOULD be deleted. */
  go: boolean
  /** The time the run began. Used only for the freshness check, never to stamp a log entry. */
  now: number
  /** Reads the clock. Called once per log entry, at the moment that entry is written. Defaults to Date.now. */
  clock?: () => number
  /** May only shorten the freshness limit. */
  maxAgeMs?: number
  /** Append one entry; it must be durable before this returns. If it throws, nothing is sent. */
  log: (entry: LogEntry) => void
  /** How many tracked repository files name this id now. */
  referencedNow: (id: string) => number | Promise<number>
  runId: string
}

export interface Stopped {
  id: string
  code: Code
  detail: string
}

export interface DeleteResult {
  dryRun: boolean
  requested: string[]
  deleted: string[]
  wouldDelete: string[]
  reclaimedBytes: number
  stopped: Stopped | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const isDeletedBody = (body: unknown, id: string): boolean =>
  isObj(body) && body.state === 'DELETED' && body.uid === id

export async function runDeletion(o: DeleteOptions): Promise<DeleteResult> {
  // ---- the proposal -----------------------------------------------------------------------------------------------------
  let proposal: Proposal
  let keep: KeepFile
  try {
    ;({ proposal, keep } = verifyProposal(o.proposalText, o.keepText, o.expectedSha256))
  } catch (e) {
    if (e instanceof FreezeRefused) throw new Refused(e.code as Code, e.message)
    throw e
  }
  const age = o.now - Date.parse(proposal.generatedAt)
  const limit = Math.min(o.maxAgeMs ?? MAX_AGE_MS, MAX_AGE_MS)
  if (!(age >= -CLOCK_SKEW_MS && age <= limit))
    throw new Refused(
      'stale-proposal',
      `the proposal was generated ${String(Math.round(age / 60_000))} minutes ago; ${String(Math.round(limit / 60_000))} is the most allowed. Regenerate it.`,
    )

  // ---- the request: exact ids, each allowed ------------------------------------------------------------------------------------
  const requested = [...o.ids]
  if (requested.length === 0) throw new Refused('bad-id', 'no deployment ids were given')
  if (requested.length > MAX_PER_RUN)
    throw new Refused('too-many', `at most ${String(MAX_PER_RUN)} ids per run`)
  const candidateIds = new Set(proposal.candidates.map((c) => c.id))
  const keepIds = new Set(keep.keeps.map((k) => k.id))
  const aliasedIds = new Set(proposal.production.aliases.map((a) => a.deploymentId))
  const seen = new Set<string>()
  for (const id of requested) {
    if (!ID_PATTERN.test(id)) throw new Refused('bad-id', `${id} is not an exact deployment id`)
    if (seen.has(id)) throw new Refused('duplicate-id', `${id} was given twice`)
    seen.add(id)
    // PROTECTION: current production
    if (id === proposal.production.id)
      throw new Refused('current-production', `${id} is the production deployment`)
    // PROTECTION: aliases
    if (aliasedIds.has(id)) throw new Refused('aliased', `${id} is behind a live alias`)
    if (id === proposal.rollbackId)
      throw new Refused('rollback-target', `${id} is the rollback deployment`)
    if (keepIds.has(id) || proposal.validationIds.includes(id))
      throw new Refused('protected', `${id} is in the keep set`)
    // PROTECTION: the allow-list. Only an id the hashed proposal names may ever be deleted.
    if (!candidateIds.has(id))
      throw new Refused('not-in-proposal', `${id} is not a candidate in the approved proposal`)
  }

  // ---- one at a time ------------------------------------------------------------------------------------------------------------
  const result: DeleteResult = {
    dryRun: !o.go,
    requested,
    deleted: [],
    wouldDelete: [],
    reclaimedBytes: 0,
    stopped: null,
  }
  const frozen = new Map(proposal.inventory.map((r) => [r.id, r]))
  const candidate = new Map(proposal.candidates.map((c) => [c.id, c]))
  const gone = new Set<string>()
  const clock = o.clock ?? Date.now
  // TIMESTAMP: each entry is stamped when it is built, which is when it is written, not when the run began.
  const entry = (e: Omit<LogEntry, 'at' | 'run'>): LogEntry => ({
    at: new Date(clock()).toISOString(),
    run: o.runId,
    ...e,
  })
  const sortedPairs = (ps: readonly { alias: string; deploymentId: string }[]): string =>
    JSON.stringify([...ps].sort((a, b) => (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0)))

  const one = async (id: string): Promise<Stopped | null> => {
    const stop = (code: Code, detail: string): Stopped => ({ id, code, detail })
    // 1. the world, read fresh
    let live: Awaited<ReturnType<typeof readLive>>
    try {
      live = await readLive(o.client, {
        teamId: proposal.teamId,
        projectName: proposal.projectName,
      })
    } catch (e) {
      return stop('read-failed', `could not read the live inventory: ${String(e).slice(0, 120)}`)
    }
    // PROTECTION: current production, as it is NOW
    if (live.productionId === id)
      return stop('current-production', `${id} became the production deployment`)
    // PROTECTION: aliases, as they are NOW
    const liveRow = live.rows.find((r) => r.id === id)
    if (liveRow !== undefined && liveRow.aliases.length > 0)
      return stop('aliased', `${id} now holds an alias (${liveRow.aliases.join(', ')})`)
    if (live.productionId !== proposal.production.id)
      return stop(
        'production-changed',
        'production points at a different deployment than when the proposal was frozen',
      )
    if (sortedPairs(live.aliasPairs) !== sortedPairs(proposal.production.aliases))
      return stop('aliases-changed', 'the aliases changed since the proposal was frozen')
    const expected = proposal.inventory
      .filter((r) => !gone.has(r.id))
      .map((r) => ({ ...r, rollbackCandidate: false }) as LiveRow)
    if (inventoryDigest(live.rows) !== inventoryDigest(expected))
      return stop(
        'inventory-changed',
        'the live inventory differs from the frozen one (a deployment was added, removed or changed)',
      )

    // 2. this deployment, read fresh
    const f = frozen.get(id)
    const c = candidate.get(id)
    if (f === undefined || c === undefined)
      return stop('not-in-proposal', `${id} is not a candidate`)
    let dep: { status: number; body: unknown }
    try {
      dep = await readDeployment(o.client, proposal.teamId, id)
    } catch (e) {
      return stop('read-failed', `could not read ${id}: ${String(e).slice(0, 120)}`)
    }
    if (dep.status === 404) return stop('missing', `${id} does not exist`)
    if (dep.status !== 200 || !isObj(dep.body))
      return stop('unexpected-response', `reading ${id} answered http ${String(dep.status)}`)
    if (dep.body.readyState === 'DELETED')
      return stop('already-deleted', `${id} is already deleted`)
    const b = dep.body
    const createdLive = typeof b.createdAt === 'number' ? b.createdAt : b.created
    if (
      b.readyState !== 'READY' ||
      (b.target === 'production' ? 'production' : 'preview') !== f.target ||
      createdLive !== f.created ||
      metaDigest(b.meta) !== f.metaSha
    )
      return stop(
        'deployment-changed',
        `${id} no longer matches the frozen record (state, target, creation time or metadata)`,
      )
    try {
      const bytes = await readBytes(o.client, proposal.teamId, id)
      if (bytes.bytes !== c.bytes || bytes.bundles !== c.bundles)
        return stop(
          'bytes-changed',
          `${id} now holds ${String(bytes.bytes)} bytes, not ${String(c.bytes)}`,
        )
    } catch (e) {
      return stop('read-failed', `could not read the size of ${id}: ${String(e).slice(0, 120)}`)
    }
    if ((await o.referencedNow(id)) > 0) return stop('referenced', `a tracked file now names ${id}`)

    if (!o.go) {
      o.log(entry({ phase: 'dry-run', id, detail: 'every check passed; nothing sent' }))
      result.wouldDelete.push(id)
      return null
    }

    // 3. the one write. The attempt is logged BEFORE the request; if it cannot be, nothing is sent.
    try {
      o.log(entry({ phase: 'attempt', id }))
    } catch {
      return stop('log-failed', 'the attempt could not be logged, so nothing was sent')
    }
    let resp: { status: number; body: unknown }
    try {
      resp = await o.client.request('DELETE', `/v13/deployments/${id}?teamId=${proposal.teamId}`)
    } catch (e) {
      // A timeout or a cut-off: whether it was deleted is UNKNOWN. Never retried.
      o.log(entry({ phase: 'completed', id, result: 'ambiguous', detail: String(e).slice(0, 120) }))
      return stop(
        'ambiguous',
        `the delete of ${id} did not answer; whether it happened is unknown. Not retried.`,
      )
    }
    if (resp.status !== 200 || !isDeletedBody(resp.body, id)) {
      o.log(entry({ phase: 'completed', id, result: 'unexpected', httpStatus: resp.status }))
      return stop(
        'unexpected-response',
        `deleting ${id} answered http ${String(resp.status)} with an unexpected body`,
      )
    }
    // Confirm it is really gone before counting it.
    let after: { status: number; body: unknown }
    try {
      after = await readDeployment(o.client, proposal.teamId, id)
    } catch (e) {
      o.log(
        entry({
          phase: 'completed',
          id,
          result: 'ambiguous',
          httpStatus: resp.status,
          detail: String(e).slice(0, 120),
        }),
      )
      return stop('ambiguous', `${id} was said to be deleted but could not be confirmed`)
    }
    const goneNow =
      after.status === 404 ||
      (after.status === 200 && isObj(after.body) && after.body.readyState === 'DELETED')
    if (!goneNow) {
      o.log(
        entry({
          phase: 'completed',
          id,
          result: 'ambiguous',
          httpStatus: resp.status,
          detail: 'still readable after delete',
        }),
      )
      return stop('ambiguous', `${id} is still readable after a successful-looking delete`)
    }
    o.log(entry({ phase: 'completed', id, result: 'deleted', httpStatus: resp.status }))
    gone.add(id)
    result.deleted.push(id)
    result.reclaimedBytes += c.bytes
    return null
  }

  for (const id of requested) {
    const failure = await one(id)
    if (failure !== null) {
      result.stopped = failure
      // STOP: nothing after a failure is attempted in this run.
      break
    }
  }
  return result
}
