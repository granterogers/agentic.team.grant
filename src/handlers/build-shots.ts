/**
 * The build diary's pictures stay inside the diary's window (#21, 0413).
 *
 * `build_steps` prunes at thirty days and always has. The screenshots it
 * points at did not: 160 objects and 74 MB of a 1 GB free tier, of which 38
 * belonged to steps that had already gone. Nothing anywhere was going to
 * remove them, which is #72's shape wearing a storage bucket — the mechanism
 * built, the mouth forgotten.
 *
 * ## Why the deletion is not SQL
 *
 * `storage.objects` is a real table and a `delete` against it would work and
 * would be wrong: Supabase keeps the BYTES behind the storage API, so removing
 * the row leaves the object paying for itself for ever with nothing left that
 * knows it exists. The rule lives in SQL (`app.build_shots_orphaned`), the
 * deletion goes through the API, and this handler is the join.
 *
 * ## A 404 is a success
 *
 * `removeFrom` treats a missing object as gone, and that matters more here
 * than in teardown: a retention pass that throws on something somebody else
 * already deleted is a retention pass that stops at the first one and leaves
 * the rest.
 *
 * ## It usually says nothing
 *
 * Same reasoning as `job-traces.ts`: a cleanup duty that announces "nothing to
 * do" every day is how a person stops reading the channel that would have
 * told them it broke.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { removeFrom } from '../files/store.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** Where the build diary's screenshots live. Public, and ADR-0034 says why. */
const BUCKET = 'build'

export interface BuildShotsDeps {
  readonly db: SqlExecutor
  readonly projectRef: string
  readonly serviceKey: string
}

export function buildShotsHandler(deps: BuildShotsDeps): Handler {
  const { db, projectRef, serviceKey } = deps
  return {
    kind: 'office.prune_build_shots',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        shape: 'nothing_happened' as const,
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
      }
      const quiet = async (): Promise<void> => {
        await db.execute(
          `update public.jobs set announce = false where job_id = ${lit(job.jobId)}::uuid`,
        )
      }

      /*
        No key is an OUTCOME, not a crash — `backup.ts`'s reasoning, and for the
        same reason: a retention pass that silently does not happen is exactly
        the failure this Issue is about.
      */
      if (serviceKey === '') {
        await quiet()
        return {
          ...base,
          facts: { changed: false, looked_at: 0 },
          body:
            'No storage key, so the build diary’s screenshots could not be looked at. ' +
            'The bucket is still growing.',
          announce: true,
        }
      }

      const rows = (await db.execute('select object_name from app.build_shots_orphaned(200)'))
        .rows as { object_name: string }[]

      if (rows.length === 0) {
        await quiet()
        return {
          ...base,
          facts: { changed: false, looked_at: 0 },
          body: 'Every build-diary screenshot still belongs to a step.',
          announce: false,
        }
      }

      let gone = 0
      const stuck: string[] = []
      for (const r of rows) {
        // eslint-disable-next-line no-await-in-loop -- the storage API takes one object per call
        const ok = await removeFrom(BUCKET, projectRef, serviceKey, r.object_name)
        if (ok) gone += 1
        else stuck.push(r.object_name)
      }

      /*
        The ones that would not go are named, capped, because a count alone
        cannot be acted on and a list of two hundred is not a sentence.
      */
      const note =
        stuck.length === 0
          ? ''
          : ` ${String(stuck.length)} would not delete, starting with ${stuck.slice(0, 3).join(', ')}.`

      return {
        ...base,
        facts: { changed: gone > 0, looked_at: rows.length },
        body:
          `Deleted ${String(gone)} build-diary screenshot(s) that no step points at any more` +
          `${rows.length === 200 ? ', and there are more waiting' : ''}.${note}`,
        announce: stuck.length > 0,
      }
    },
  }
}
