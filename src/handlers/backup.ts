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

import {
  BUCKET,
  backupPrefix,
  buildManifest,
  dumpTable,
  ensureBucket,
  listArchives,
  putObject,
  tablesToBackUp,
} from '../backup/portable.ts'
import { DEFAULT_POLICY, planRetention } from '../backup/retention.ts'
import { listRuns } from '../backup/runs.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { runSteps } from '../jobs/checkpoint.ts'
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
          // A backup that did not happen is the one thing here worth saying
          // out loud, and worth a phone buzzing: an unnoticed absence of
          // backups is the whole failure mode, and it needs him to act.
          announce: true,
          severity: 'important',
        } satisfies HandlerOutput
      }

      /*
        ONE STEP PER TABLE, so a killed tick resumes (0492).

        This used to build the whole 52MB archive in one call. Measured at 148
        seconds on a fast machine; an edge function does not get that long, and
        the job's own history says exactly that — five ticks each ending
        `worker edge-… died holding this in running`, then `5 attempts
        exhausted`. **The last backup that finished was 16 September.**

        Now each table is dumped, uploaded and checkpointed on its own. A tick
        that dies has still banked everything before it, and the next attempt
        skips those steps. No tick holds more than one table in memory.

        The effect is `local` rather than `external`, deliberately. `external`
        means "a resume cannot tell whether this committed, so park" — right
        for a message that may have been sent twice. Here the key is derived
        from the JOB and the upload is an upsert, so repeating a step
        overwrites the same object with the same bytes. Declaring `external`
        would park the job on the first interruption, which is the one thing
        this change exists to stop.
      */
      /*
        `ensureBucket` answers with what it DID — "already private", or
        "created private" — not with a name. The first version of the folder
        message interpolated it as a path and told Grant his backup was in
        `already private/run-…`, which is not a place. The bucket's name is
        the constant.
      */
      const bucketState = await ensureBucket(projectRef, serviceKey)
      const bucket = BUCKET
      const prefix = backupPrefix(job.jobId)
      const tables = await tablesToBackUp(db)

      const end = await runSteps(
        db,
        job.jobId,
        'office.backup@1',
        [
          ...tables.map((t) => ({
            name: `table:${t.table_schema}.${t.table_name}`,
            effect: 'local' as const,
            run: async () => {
              const dump = await dumpTable(db, prefix, t.table_schema, t.table_name)
              await putObject(projectRef, serviceKey, dump)
              return {
                // sha256 and fingerprint ride in the checkpoint so the manifest can vouch for this object (G-2)
                outcome: {
                  rows: dump.rows,
                  bytes: dump.bytes.length,
                  sha256: dump.sha256,
                  fingerprint: dump.fingerprint ?? null,
                },
                effectRef: dump.key,
              }
            },
          })),
          {
            /*
            The manifest LAST, because its presence is what makes the folder a
            complete backup rather than an interrupted one. A restore that
            finds tables and no manifest should say so, not load three
            quarters of an office.
          */
            name: 'manifest',
            effect: 'local' as const,
            run: async (done) => {
              const counts: Record<string, number> = {}
              const objects: Record<string, { sha256: string; bytes: number }> = {}
              const fingerprints: Record<string, string> = {}
              for (const t of tables) {
                const q = `${t.table_schema}.${t.table_name}`
                const o = done[`table:${q}`]
                counts[q] = Number(o?.rows ?? 0)
                if (typeof o?.sha256 === 'string') {
                  objects[`${prefix}/${q}.json.gz`] = {
                    sha256: o.sha256,
                    bytes: Number(o.bytes ?? 0),
                  }
                }
                if (typeof o?.fingerprint === 'string') fingerprints[q] = o.fingerprint
              }
              const m = await buildManifest(db, projectRef, prefix, counts, {
                objects,
                fingerprints,
              })
              await putObject(projectRef, serviceKey, m)
              return { outcome: { rows: m.rows, tables: Object.keys(counts).length } }
            },
          },
        ],
        job,
      )

      if (end.kind !== 'done') {
        /*
          Stopped or parked between tables. Say what was banked rather than
          claiming a backup — an unnoticed absence of backups is the whole
          failure mode, and a half-finished folder that reports success is the
          most dangerous shape this handler has.
        */
        const banked = Object.keys(end.kind === 'stopped' ? end.outcomes : {}).length
        return {
          ...base,
          body:
            `The backup did not finish: ${end.kind} at ${end.at}. ` +
            `${count(banked, 'table is', 'tables are')} already in ${bucket}/${prefix}, ` +
            'and the next run carries on from there rather than starting again.',
          announce: true,
          severity: 'important',
        } satisfies HandlerOutput
      }

      const rows = Object.entries(end.outcomes)
        .filter(([k]) => k.startsWith('table:'))
        .reduce((a, [, o]) => a + Number(o.rows ?? 0), 0)
      const bytes = Object.entries(end.outcomes)
        .filter(([k]) => k.startsWith('table:'))
        .reduce((a, [, o]) => a + Number(o.bytes ?? 0), 0)
      const kept = await listArchives(projectRef, serviceKey)

      /*
        What a retention policy WOULD do, said and never done (G-1).

        Backups share the 1 GB Storage allowance and are never deleted, which G-1 shows may be what fills it. This
        reports the size, and what keeping the newest seven plus one a week would free, so the decision Grant makes with
        `npm run backup:prune` has a number in front of it. The run just written counts as the verified one for this
        sentence only: it was written seconds ago with its checksums in the manifest, and the deleting command verifies
        the newest backup again, by reading it, before it removes anything.

        Swallowed on failure: a retention figure must never turn a finished backup into a failed one.
      */
      let retentionNote = ''
      try {
        const runs = await listRuns(projectRef, serviceKey)
        const plan = planRetention(
          runs.map((r) => ({ ...r, verified: r.name === prefix })),
          new Date(),
        )
        const total = runs.reduce((a, r) => a + r.bytes, 0)
        if (plan.remove.length > 0) {
          retentionNote =
            `\n\nThe backups hold ${String(Math.round(total / 1_000_000))}MB of the 1GB storage allowance across ` +
            `${count(runs.length, 'run', 'runs')}. Keeping the newest ${String(DEFAULT_POLICY.keepLast)} and one a week ` +
            `would free ${String(Math.round(plan.freedBytes / 1_000_000))}MB by removing ` +
            `${count(plan.remove.length, 'run', 'runs')}. Nothing is deleted until you run \`npm run backup:prune\`.`
        }
      } catch {
        retentionNote = ''
      }

      return {
        ...base,
        body:
          `Backed up ${count(rows, 'row', 'rows')} across ` +
          `${count(tables.length, 'table', 'tables')} — ` +
          `${String(Math.round(bytes / 1024))}KB compressed, one object per table in ` +
          `${bucket}/${prefix}.\n\n` +
          `${count(kept.length, 'copy is', 'copies are')} kept (${bucketState}). ` +
          'Nothing is ever deleted automatically.\n\n' +
          'It holds no credentials, and it lives in the same Supabase project it ' +
          'came from — so it survives losing the code or this machine, and not ' +
          'losing the project.' +
          retentionNote,
        // Nightly and identical. The Set up page carries "last taken 18
        // minutes ago" for whoever wants to check.
        announce: false,
      } satisfies HandlerOutput
    },
  }
}
