/**
 * The handler behind the nightly backup.
 *
 * §16 wants a backup that has been restored from. Until tonight this system
 * had neither half running: the `pg_dump` lived in GitHub Actions, Actions were
 * switched off on 2026-09-08, and nothing has taken a copy since.
 *
 * `src/backup/portable.ts` explains what the artifact is and why it is JSON
 * rather than a dump. This file is the part that decides when, and where, and
 * what to say about it.
 *
 * ## Where it goes, and why not further
 *
 * A private bucket in the same Supabase project. That is deliberately modest:
 * it survives losing the code, losing this machine, and losing every vendor
 * account except one — and it does NOT survive losing the Supabase project,
 * which is the failure §16 most wants covered.
 *
 * Sending it somewhere else means either a new vendor account or emailing
 * Grant's whole database to himself, and both are his call rather than mine.
 * So the honest position is: this runs nightly, it is real, and its one gap is
 * stated here and in what the handler says every night rather than discovered
 * during a restore.
 *
 * ## Nothing is ever deleted
 *
 * Retention is reported, not enforced. Grant: *"you should always check before
 * making any destructive action with me."* A retention policy that deletes the
 * oldest copy is a destructive action taken on a schedule while he is asleep,
 * and the whole value of the thing being deleted is that it is the copy of last
 * resort. The count is in the output so the decision is visible; the deletion
 * is a command he runs.
 */

import { buildArchive, ensureBucket, listArchives, uploadArchive } from '../backup/portable.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { count } from '../text/plain.ts'

export interface BackupDeps {
  readonly db: SqlExecutor
  readonly projectRef: string
  /**
   * The key Storage wants, injected.
   *
   * Read from the vault by the composition root rather than here, so this file
   * has no opinion about where credentials live and a test can drive it
   * without one.
   */
  readonly serviceKey: string
}

export function backupHandler(deps: BackupDeps): Handler {
  const { db, projectRef, serviceKey } = deps
  return {
    kind: 'office.backup',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
      }

      if (serviceKey === '') {
        // A backup that cannot be stored must SAY so rather than succeed
        // quietly. An unnoticed absence of backups is the whole failure mode.
        return {
          ...base,
          body:
            'No storage key, so no backup was taken. The copy is built from the ' +
            'Management API but it has to be put somewhere, and that needs the ' +
            'service role key in the vault as `supabase.service_role_key`.',
          confidence: 'high',
        } satisfies HandlerOutput
      }

      const bucket = await ensureBucket(projectRef, serviceKey)
      const archive = await buildArchive(db, projectRef)
      await uploadArchive(projectRef, serviceKey, archive)
      const kept = await listArchives(projectRef, serviceKey)

      const size = `${String(Math.round(archive.bytes.length / 1024))}KB`
      const raw = `${String(Math.round(archive.rawBytes / 1024))}KB`

      return {
        ...base,
        body:
          `Backed up ${count(archive.rows, 'row', 'rows')} across ` +
          `${count(archive.tables, 'table', 'tables')} — ${raw} of data, ${size} compressed. ` +
          `Up to and including migration ${archive.latestMigration}.\n\n` +
          `${count(kept.length, 'copy is', 'copies are')} kept (${bucket}). ` +
          'Nothing is ever deleted automatically.\n\n' +
          'It holds no credentials, and it lives in the same Supabase project it ' +
          'came from — so it survives losing the code or this machine, and not ' +
          'losing the project.',
      } satisfies HandlerOutput
    },
  }
}
