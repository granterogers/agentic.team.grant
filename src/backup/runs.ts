/**
 * The backups in the bucket as `RunInfo`, and the one function that deletes them (G-1).
 *
 * `retention.ts` decides, purely, which runs may go. This file reads the bucket into the shape that decision needs and
 * carries out a plan, and it is where every guard that must hold at the moment of deletion is repeated, because the
 * pure plan can be correct and the call that acts on it can still be handed the wrong plan:
 *
 *   - a plan that was `refused` deletes nothing;
 *   - a name this system did not create is never deleted, whatever the plan says;
 *   - nothing is deleted without `go: true`, and the default is a dry run that returns what it WOULD delete;
 *   - a folder is emptied with its manifest FIRST, then its data objects. A manifest is what makes a run complete, and
 *     verification reads only the objects still present, so a manifest left behind after some objects are gone reads as
 *     a complete, verified backup with holes in it. Removing the manifest first means an interrupted deletion leaves an
 *     INCOMPLETE run, which a restore refuses and the policy reports rather than deletes.
 *
 * Nothing calls `applyRetention` or `applyInterrupted` with `go: true` except `scripts/backup/prune.ts`, behind the
 * production-writes gate and a person's explicit `--attended` (and, for interrupted runs, `--interrupted`). A deletion refuses (throws) without BOTH the attended flag and the repository's own
 * production-write approval. The nightly handler deletes only through `applyScheduledRetention`, only while the owner's
 * `backup.auto_prune` switch is on, under that function's own limits (ADR-0077).
 */

import { productionWritesAllowed } from '../safety/production-gate.ts'
import { BUCKET, checksum, downloadArchive, listUnder, readFolder } from './portable.ts'
import { type Decision, isOurs, type Plan, type RunInfo } from './retention.ts'

interface Listed {
  readonly name: string
  readonly created_at?: string
  readonly id?: string | null
  readonly metadata?: { readonly size?: number } | null
}

const sizeOf = (o: Listed): number => Number(o.metadata?.size ?? 0)

/**
 * The verify-once marker (ADR-0077): `run-<id>/verified.json`, written after every object of the run was read back and
 * matched the checksum recorded when it was written. Its presence, beside a manifest, is what the NIGHTLY prune takes as
 * verified, so it never has to read old backups again. The attended `backup:prune` still reads every run itself.
 */
export const MARKER = 'verified.json'
export const isMarker = (name: string): boolean => name.endsWith(`/${MARKER}`)

export async function listRuns(ref: string, serviceKey: string): Promise<RunInfo[]> {
  const top = (await listUnder(ref, serviceKey, '')) as readonly Listed[]
  const runs: RunInfo[] = []
  for (const o of top) {
    if (!isOurs(o.name)) {
      // foreign objects and folders are reported so a person sees them, and are never candidates
      runs.push({
        name: o.name,
        at: o.created_at ?? '1970-01-01T00:00:00Z',
        bytes: sizeOf(o),
        complete: true,
        verified: false,
      })
      continue
    }
    if (o.name.startsWith('run-')) {
      const inside = (await listUnder(ref, serviceKey, o.name)) as readonly Listed[]
      // The marker is left out of the run's time: it can be written days later (a backfill), and a run's day and ISO
      // week must stay the day its backup was taken, or the policy would keep and drop the wrong runs.
      const times = inside
        .filter((i) => !isMarker(i.name))
        .map((i) => i.created_at ?? '')
        .filter((t) => t !== '')
        .sort()
      runs.push({
        name: o.name,
        at: times[times.length - 1] ?? '1970-01-01T00:00:00Z',
        bytes: inside.reduce((a, i) => a + sizeOf(i), 0),
        complete: inside.some((i) => i.name.endsWith('/manifest.json.gz')),
        verified: false,
        marked: inside.some((i) => isMarker(i.name)),
      })
    } else {
      // a legacy single file and its checksum beside it
      const sidecar = top.find((t) => t.name === `${o.name}.sha256`)
      runs.push({
        name: o.name,
        at: o.created_at ?? '1970-01-01T00:00:00Z',
        bytes: sizeOf(o) + (sidecar === undefined ? 0 : sizeOf(sidecar)),
        complete: true,
        verified: false,
      })
    }
  }
  // a legacy file's checksum is not a run of its own
  return runs.filter((r) => !r.name.endsWith('.sha256'))
}

/**
 * Mark which runs are VERIFIED, by reading them back: every object's checksum must match the one stored beside it
 * (the same read `backup:rehearse` does). `listRuns` never sets `verified`, because listing proves nothing about
 * whether the bytes can be read. An unfinished run, a failed read or a throw is NOT verified. Attended and slow (it
 * downloads each run), so the caller decides which runs to ask about.
 */
/**
 * Read one backup back and check it. The same checks as before: an unfinished or foreign backup is never verified, and
 * any read or checksum failure is a refusal to verify rather than an error that stops the run.
 */
async function verifyOne(ref: string, serviceKey: string, r: RunInfo): Promise<boolean> {
  if (!isOurs(r.name) || !r.complete) return false
  try {
    if (r.name.startsWith('run-')) {
      const inside = await listUnder(ref, serviceKey, r.name)
      const tables = inside
        .map((o) => o.name)
        .filter((n) => n.endsWith('.json.gz') && !n.endsWith('/manifest.json.gz'))
      const read = await readFolder(ref, serviceKey, { prefix: r.name, tables })
      return read.corrupt.length === 0 && Object.keys(read.data).length > 0
    }
    const bytes = await downloadArchive(ref, serviceKey, r.name)
    const stated = new TextDecoder()
      .decode(await downloadArchive(ref, serviceKey, `${r.name}.sha256`))
      .trim()
      .split(/\s+/)[0]
    return stated !== undefined && stated !== '' && stated === (await checksum(bytes))
  } catch {
    return false
  }
}

/**
 * Verify every run, a few at a time. The concurrency only changes how long it takes: each run is still read in full and
 * checked on its own, and the results come back in the order the runs were given. A sequential read of 39 backups did
 * not finish inside a ten-minute foreground command.
 */
export async function verifyRuns(
  ref: string,
  serviceKey: string,
  runs: readonly RunInfo[],
  onEach: (run: RunInfo, verified: boolean) => void = () => undefined,
  concurrency = 4,
): Promise<RunInfo[]> {
  const results: boolean[] = Array.from({ length: runs.length }, () => false)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < runs.length) {
      const i = next
      next += 1
      results[i] = await verifyOne(ref, serviceKey, runs[i] as RunInfo)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, runs.length) }, worker))
  return runs.map((r, i) => {
    const verified = results[i] === true
    onEach(r, verified)
    return { ...r, verified }
  })
}

export interface Applied {
  readonly dryRun: boolean
  readonly deleted: readonly string[]
  readonly objectsDeleted: number
  readonly refused: string | null
}

export interface ApplyOptions {
  /** A deletion was asked for. Without it the call is a dry run. */
  readonly go: boolean
  /** A person is at the keyboard and said so (`--attended`). A deletion needs this as well as `go`. */
  readonly attended?: boolean
  /**
   * The repository's own production-write approval (`ALLOW_PRODUCTION_CHECKS=1` and `ALLOW_PRODUCTION_WRITES=1`).
   * Defaults to reading the environment. Only a replica proof against the storage emulator passes anything else;
   * `scripts/backup/prune.ts` never does. Production destructive execution additionally needs the owner's separate
   * approval, which no code here can grant.
   */
  readonly writesAllowed?: () => boolean
}

/** Refused deletion: thrown, never silently turned into a dry run, so a script that asked for a deletion hears no. */
export class RetentionRefused extends Error {}

/** Objects per bulk call. Storage accepts up to 1,000; a smaller batch bounds what one failed call leaves behind. */
export const DELETE_BATCH = 100

/**
 * Remove objects with Storage's bulk endpoint, `batch` paths a call, in the order given, and answer how many Storage says
 * it removed. One object per call took about 300 requests a backup and did not finish 14 backups inside a ten-minute
 * foreground command on 18 November 2026; it stopped part way through one folder (harmlessly, manifest first).
 */
const removeAll = async (
  ref: string,
  serviceKey: string,
  paths: readonly string[],
  batch = DELETE_BATCH,
): Promise<number> => {
  let removed = 0
  for (let i = 0; i < paths.length; i += batch) {
    const r = await fetch(`https://${ref}.supabase.co/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: paths.slice(i, i + batch) }),
    })
    if (!r.ok) throw new Error(`storage refused a bulk delete: http ${String(r.status)}`)
    const body = (await r.json().catch(() => [])) as unknown
    removed += Array.isArray(body) ? body.length : 0
  }
  return removed
}

/**
 * Empty one run folder: its manifest objects in a call of their own FIRST, then the data objects in batches. Splitting
 * the manifest into its own call is what keeps the manifest-first guarantee with bulk deletion: a batch is not ordered
 * inside itself, so a manifest sharing a batch with data could outlive some of it.
 */
const emptyFolder = async (ref: string, serviceKey: string, name: string): Promise<number> => {
  const order = deletionOrder((await listUnder(ref, serviceKey, name)).map((o) => o.name))
  return (
    (await removeAll(ref, serviceKey, order.filter(leadsDeletion))) +
    (await removeAll(
      ref,
      serviceKey,
      order.filter((n) => !leadsDeletion(n)),
    ))
  )
}

/**
 * What goes FIRST when a run is emptied: the manifest (and its checksum) and the verify-once marker. Either left behind
 * over missing data would vouch for a backup with holes in it; gone first, an interrupted deletion reads as unfinished.
 */
const leadsDeletion = (n: string): boolean => n.includes('/manifest.json.gz') || isMarker(n)

/**
 * The order a run folder's objects are removed in: its manifest and manifest checksum first, then every data object.
 * Exported so the order is tested directly, rather than inferred from a deletion that may be killed halfway.
 */
export function deletionOrder(inside: readonly string[]): string[] {
  return [...inside.filter(leadsDeletion), ...inside.filter((n) => !leadsDeletion(n))]
}

export async function applyRetention(
  ref: string,
  serviceKey: string,
  plan: Plan,
  options: ApplyOptions,
): Promise<Applied> {
  if (plan.refused !== null)
    return { dryRun: !options.go, deleted: [], objectsDeleted: 0, refused: plan.refused }
  const names = plan.remove.map((d) => d.name)
  const foreign = names.find((n) => !isOurs(n))
  if (foreign !== undefined) {
    throw new Error(`refusing to delete ${foreign}: this system did not create it`)
  }
  // a plan that names anything this policy never deletes (unverified, unfinished) is a corrupted plan
  const reported = new Set(plan.unknown.map((d) => d.name))
  const unjudged = names.find((n) => reported.has(n))
  if (unjudged !== undefined) {
    throw new Error(`refusing to delete ${unjudged}: it is unverified or unfinished`)
  }
  if (!options.go) return { dryRun: true, deleted: names, objectsDeleted: 0, refused: null }
  if (options.attended !== true) {
    throw new RetentionRefused(
      'refusing to delete: a deletion needs the attended flag (--attended) as well as go',
    )
  }
  if (!(options.writesAllowed ?? productionWritesAllowed)()) {
    throw new RetentionRefused(
      "refusing to delete: production writes are not allowed (ALLOW_PRODUCTION_CHECKS=1 and ALLOW_PRODUCTION_WRITES=1 are the owner's switch)",
    )
  }

  let objects = 0
  for (const name of names) {
    objects += name.startsWith('run-')
      ? await emptyFolder(ref, serviceKey, name)
      : await removeAll(ref, serviceKey, [name, `${name}.sha256`])
  }
  return { dryRun: false, deleted: names, objectsDeleted: objects, refused: null }
}

/**
 * Delete INTERRUPTED runs (`planInterrupted` in retention.ts): folders with no manifest, which a restore refuses. The
 * same gates as `applyRetention` (dry run by default; a deletion needs `go`, `attended` and the production-write
 * approval), and two of its own, checked at the moment of deletion rather than trusted from the plan:
 *  - only a `run-<uuid>` folder this system created;
 *  - the folder is listed again, and one that now HAS a manifest (it finished since the plan was made) is skipped and
 *    reported, never emptied.
 */
export async function applyInterrupted(
  ref: string,
  serviceKey: string,
  decisions: readonly Decision[],
  options: ApplyOptions,
): Promise<Applied & { readonly skipped: readonly string[] }> {
  const names = decisions.map((d) => d.name)
  const bad = names.find((n) => !isOurs(n) || !n.startsWith('run-'))
  if (bad !== undefined)
    throw new Error(`refusing to delete ${bad}: not a run folder this system created`)
  if (!options.go)
    return { dryRun: true, deleted: names, objectsDeleted: 0, refused: null, skipped: [] }
  if (options.attended !== true) {
    throw new RetentionRefused(
      'refusing to delete: a deletion needs the attended flag (--attended) as well as go',
    )
  }
  if (!(options.writesAllowed ?? productionWritesAllowed)()) {
    throw new RetentionRefused(
      "refusing to delete: production writes are not allowed (ALLOW_PRODUCTION_CHECKS=1 and ALLOW_PRODUCTION_WRITES=1 are the owner's switch)",
    )
  }
  const deleted: string[] = []
  const skipped: string[] = []
  let objects = 0
  for (const name of names) {
    const inside = (await listUnder(ref, serviceKey, name)).map((o) => o.name)
    if (inside.some((n) => n.endsWith('/manifest.json.gz'))) {
      skipped.push(name)
      continue
    }
    objects += await removeAll(ref, serviceKey, inside)
    deleted.push(name)
  }
  return { dryRun: false, deleted, objectsDeleted: objects, refused: null, skipped }
}

/** What a verify-once marker says. Written by the nightly job, or by the attended prune for a run it has just read. */
export interface Marker {
  readonly format: 'verified/1'
  readonly run: string
  readonly verified_at: string
  /** How many objects were read back and matched, when the writer counted them (the nightly job does). */
  readonly objects?: number
  readonly by: 'nightly backup' | 'attended prune'
}

/** Put the marker in a run folder. Upsert, so a repeated step writes the same thing. */
export async function writeMarker(ref: string, serviceKey: string, marker: Marker): Promise<void> {
  const r = await fetch(
    `https://${ref}.supabase.co/storage/v1/object/${BUCKET}/${marker.run}/${MARKER}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'x-upsert': 'true',
      },
      body: JSON.stringify(marker),
    },
  )
  if (!r.ok)
    throw new Error(`could not write the marker for ${marker.run}: http ${String(r.status)}`)
}

/** The nightly prune's own limit: a wrong policy removes at most this many runs a night. Steady state removes one. */
export const NIGHTLY_MAX_DELETES = 3

export interface Scheduled {
  readonly switchOn: boolean
  /** The run this night's job wrote: never deleted, whatever the plan says. */
  readonly justWritten: string
  readonly maxDeletes?: number
}

/**
 * The NIGHTLY prune (ADR-0077). A deletion the owner switched on once (`backup.auto_prune`, not self-adjustable), not a
 * person at the keyboard, so it has its own guards in place of `--attended` and the production-write flags, and they are
 * checked here, at the moment of deletion, not trusted from the plan:
 *  - the switch is on, or nothing happens (an answer, not an error: off is the default);
 *  - the plan was not refused, names only runs this system made, names nothing unverified or unfinished, and does not
 *    name the run this night's job wrote;
 *  - at most `maxDeletes` (3) runs; a longer plan is refused WHOLE, because steady state is one a night and more means
 *    something is wrong;
 *  - each run is listed again, and one that no longer has BOTH its manifest and its marker is skipped, not emptied.
 */
export async function applyScheduledRetention(
  ref: string,
  serviceKey: string,
  plan: Plan,
  options: Scheduled,
): Promise<Applied & { readonly skipped: readonly string[] }> {
  const none = { dryRun: true, deleted: [], objectsDeleted: 0, skipped: [] }
  if (!options.switchOn)
    return { ...none, refused: 'the nightly prune is off (system_config backup.auto_prune)' }
  if (plan.refused !== null) return { ...none, refused: plan.refused }
  const names = plan.remove.map((d) => d.name)
  const max = options.maxDeletes ?? NIGHTLY_MAX_DELETES
  if (names.length > max)
    throw new RetentionRefused(
      `refusing a nightly prune of ${String(names.length)} runs: the limit is ${String(max)}, and more than that is a person's decision (npm run backup:prune)`,
    )
  if (names.includes(options.justWritten))
    throw new RetentionRefused(`refusing to delete ${options.justWritten}: tonight's job wrote it`)
  const foreign = names.find((n) => !isOurs(n) || !n.startsWith('run-'))
  if (foreign !== undefined)
    throw new RetentionRefused(`refusing to delete ${foreign}: not a run folder this system made`)
  const reported = new Set(plan.unknown.map((d) => d.name))
  const unjudged = names.find((n) => reported.has(n))
  if (unjudged !== undefined)
    throw new RetentionRefused(`refusing to delete ${unjudged}: it is unverified or unfinished`)

  const deleted: string[] = []
  const skipped: string[] = []
  let objects = 0
  for (const name of names) {
    const inside = (await listUnder(ref, serviceKey, name)).map((o) => o.name)
    if (!inside.some((n) => n.endsWith('/manifest.json.gz')) || !inside.some(isMarker)) {
      skipped.push(name)
      continue
    }
    objects += await emptyFolder(ref, serviceKey, name)
    deleted.push(name)
  }
  return { dryRun: false, deleted, objectsDeleted: objects, refused: null, skipped }
}
