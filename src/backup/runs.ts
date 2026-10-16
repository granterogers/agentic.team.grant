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
 * Nothing calls `applyRetention` with `go: true` except `scripts/backup/prune.ts`, behind the production-writes gate and a
 * person's explicit `--attended`. A deletion refuses (throws) without BOTH the attended flag and the repository's own
 * production-write approval. The nightly handler only reports.
 */

import { productionWritesAllowed } from '../safety/production-gate.ts'
import { BUCKET, checksum, downloadArchive, listUnder, readFolder } from './portable.ts'
import { isOurs, type Plan, type RunInfo } from './retention.ts'

interface Listed {
  readonly name: string
  readonly created_at?: string
  readonly id?: string | null
  readonly metadata?: { readonly size?: number } | null
}

const sizeOf = (o: Listed): number => Number(o.metadata?.size ?? 0)

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
      const times = inside
        .map((i) => i.created_at ?? '')
        .filter((t) => t !== '')
        .sort()
      runs.push({
        name: o.name,
        at: times[times.length - 1] ?? '1970-01-01T00:00:00Z',
        bytes: inside.reduce((a, i) => a + sizeOf(i), 0),
        complete: inside.some((i) => i.name.endsWith('/manifest.json.gz')),
        verified: false,
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
export async function verifyRuns(
  ref: string,
  serviceKey: string,
  runs: readonly RunInfo[],
  onEach: (run: RunInfo, verified: boolean) => void = () => undefined,
): Promise<RunInfo[]> {
  const out: RunInfo[] = []
  for (const r of runs) {
    let verified = false
    if (isOurs(r.name) && r.complete) {
      try {
        if (r.name.startsWith('run-')) {
          const inside = await listUnder(ref, serviceKey, r.name)
          const tables = inside
            .map((o) => o.name)
            .filter((n) => n.endsWith('.json.gz') && !n.endsWith('/manifest.json.gz'))
          const read = await readFolder(ref, serviceKey, { prefix: r.name, tables })
          verified = read.corrupt.length === 0 && Object.keys(read.data).length > 0
        } else {
          const bytes = await downloadArchive(ref, serviceKey, r.name)
          const stated = new TextDecoder()
            .decode(await downloadArchive(ref, serviceKey, `${r.name}.sha256`))
            .trim()
            .split(/\s+/)[0]
          verified = stated !== undefined && stated !== '' && stated === (await checksum(bytes))
        }
      } catch {
        verified = false
      }
    }
    onEach(r, verified)
    out.push({ ...r, verified })
  }
  return out
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

const remove = async (ref: string, serviceKey: string, path: string): Promise<boolean> => {
  const r = await fetch(`https://${ref}.supabase.co/storage/v1/object/${BUCKET}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${serviceKey}` },
  })
  return r.ok
}

/**
 * The order a run folder's objects are removed in: its manifest and manifest checksum first, then every data object.
 * Exported so the order is tested directly, rather than inferred from a deletion that may be killed halfway.
 */
export function deletionOrder(inside: readonly string[]): string[] {
  const isManifest = (n: string): boolean => n.includes('/manifest.json.gz')
  return [...inside.filter(isManifest), ...inside.filter((n) => !isManifest(n))]
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
    if (name.startsWith('run-')) {
      const inside = (await listUnder(ref, serviceKey, name)).map((o) => o.name)
      for (const path of deletionOrder(inside))
        if (await remove(ref, serviceKey, path)) objects += 1
    } else {
      for (const path of [name, `${name}.sha256`])
        if (await remove(ref, serviceKey, path)) objects += 1
    }
  }
  return { dryRun: false, deleted: names, objectsDeleted: objects, refused: null }
}
