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
 * ## Deleting expired backups: only when the owner switched it on (ADR-0077)
 *
 * Until 18 November 2026 retention was reported, never enforced. Grant: *"you
 * should always check before making any destructive action with me."* The
 * backups then filled the 1 GB Storage allowance, and on 18 November he chose
 * "Auto-prune nightly": this job applies his 7 October retention policy after a
 * backup that has VERIFIED. It stays a decision he makes, once, as data:
 * `system_config` `backup.auto_prune` = true, not self-adjustable. Off is the
 * default. The limits it runs under are in `applyScheduledRetention` (runs.ts):
 * at most three a night, never tonight's run, only runs read back and marked.
 */

import { addFingerprints, type KeyRange } from '../backup/paged.ts'
import { type PartOptions, type PartsPlan, partKey, partStep, planParts } from '../backup/parts.ts'
import {
  BUCKET,
  backupPrefix,
  buildManifest,
  checksum,
  downloadArchive,
  dumpTable,
  ensureBucket,
  listArchives,
  putObject,
  tablesToBackUp,
} from '../backup/portable.ts'
import { DEFAULT_POLICY, planRetention } from '../backup/retention.ts'
import { applyScheduledRetention, listRuns, RetentionRefused, writeMarker } from '../backup/runs.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { runSteps, type Step } from '../jobs/checkpoint.ts'
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
  /** How large tables are split (parts.ts). Production uses the defaults; a replica proof lowers them to force a split. */
  readonly parts?: PartOptions
}

/**
 * The checkpoint version. @3 added the verify, mark and prune steps (ADR-0077). @2 added the `plan:parts` step and
 * part steps (#503): a run begun under an earlier version is refused its old
 * checkpoints by `app.step_begin` rather than mixing two layouts in one folder.
 */
export const STEPS_VERSION = 'office.backup@3'

/**
 * The owner's switch for the nightly prune: `system_config` `backup.auto_prune` = true. Absent, anything else, or a row
 * marked self-adjustable (which would let the office's own adaptation turn it on) all read as OFF. Destructive-action
 * policy sits behind `self_adjustable = false` by the table's own definition (0002).
 */
export async function autoPruneOn(db: SqlExecutor): Promise<boolean> {
  const { rows } = await db.execute(
    `select (value = 'true'::jsonb and not self_adjustable) as on from public.system_config where key = 'backup.auto_prune'`,
  )
  return rows[0]?.on === true
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

      /*
        PARTS FIRST, AND CHECKPOINTED (#503).

        A worker attempt dies after about 13 to 16 MB of compressed output, and an attempt that finishes no step earns
        no further slice. `job_state_transitions` outgrew one attempt on 9 November and no backup finished for ten
        nights. So a large table is written as several key-range parts, one step each (src/backup/parts.ts).

        Which parts is decided ONCE, in this first step, and read back from its checkpoint by every later attempt, so the
        step names and the ranges they cover are the same however many attempts the run takes. The table steps can only
        be listed once the plan is known, hence two calls to runSteps; the second lists the plan again, and the gate
        skips it with its recorded answer.
      */
      const planStep: Step = {
        name: 'plan:parts',
        effect: 'local',
        run: async () => ({ outcome: { parts: await planParts(db, tables, deps.parts) } }),
      }
      const planned = await runSteps(db, job.jobId, STEPS_VERSION, [planStep], job)
      const plan =
        planned.kind === 'done'
          ? ((planned.outcomes['plan:parts']?.parts ?? {}) as PartsPlan)
          : null

      const tableSteps = (t: { table_schema: string; table_name: string }): Step[] => {
        const q = `${t.table_schema}.${t.table_name}`
        const write = async (options: { range?: KeyRange; part?: number } = {}) => {
          const dump = await dumpTable(db, prefix, t.table_schema, t.table_name, options)
          await putObject(projectRef, serviceKey, dump)
          return {
            // sha256 and fingerprint ride in the checkpoint so the manifest can vouch for this object (G-2)
            outcome: {
              rows: dump.rows,
              bytes: dump.bytes.length,
              sha256: dump.sha256,
              fingerprint: dump.fingerprint ?? null,
              key: dump.key,
            },
            effectRef: dump.key,
          }
        }
        const ranges = plan?.[q]
        if (ranges === undefined)
          return [{ name: `table:${q}`, effect: 'local', run: async () => await write() }]
        return ranges.map((range, i) => ({
          name: partStep(q, i + 1),
          effect: 'local' as const,
          run: async () => await write({ range, part: i + 1 }),
        }))
      }

      /*
        VERIFY ONCE, HERE (ADR-0077).

        Every object this run wrote is read back, one step each (no step holds more than one object, the same bound as
        writing it), and its sha256 compared with the one recorded when it was written. All match: the run gets its
        verify-once marker, which is what lets tomorrow's prune trust it without reading it again. About 45 MB of egress a
        night, against reading every kept backup every night (466 MB).

        A mismatch is recorded, not thrown: a corrupt object is a fact to report, and retrying would not change it. A
        download that FAILS throws, because that can be transient, and the attempt is retried.
      */
      const verifySteps = (written: readonly string[]): Step[] =>
        written.map((stepName) => ({
          name: `verify:${stepName}`,
          effect: 'local',
          run: async (done) => {
            const want = done[stepName]
            const key = String(want?.key ?? '')
            if (key === '' || typeof want?.sha256 !== 'string')
              return { outcome: { ok: false, why: 'no checksum was recorded when it was written' } }
            const got = await checksum(await downloadArchive(projectRef, serviceKey, key))
            return { outcome: { ok: got === want.sha256, key } }
          },
        }))
      const markStep: Step = {
        name: 'mark',
        effect: 'local',
        run: async (done) => {
          const checks = Object.entries(done).filter(([k]) => k.startsWith('verify:'))
          const bad = checks
            .filter(([, o]) => o.ok !== true)
            .map(([k]) => k.slice('verify:'.length))
          if (checks.length === 0 || bad.length > 0)
            return { outcome: { marked: false, bad: bad.slice(0, 20), checked: checks.length } }
          await writeMarker(projectRef, serviceKey, {
            format: 'verified/1',
            run: prefix,
            verified_at: new Date().toISOString(),
            objects: checks.length,
            by: 'nightly backup',
          })
          return { outcome: { marked: true, checked: checks.length } }
        },
      }
      /*
        THE NIGHTLY PRUNE (ADR-0077), off unless the owner switched it on.

        Grant, 18 November 2026, asked whether the nightly backup should also delete expired backups so storage cannot
        fill again: "Auto-prune nightly". His 7 October policy decides what goes; `applyScheduledRetention` holds the
        limits. Only runs carrying a marker count as verified here, so a backup nobody verified is never deleted and
        never counted. Interrupted runs are reported and left for `backup:prune -- --interrupted`. A refusal is reported
        and announced; it never turns a finished backup into a failed one.
      */
      const pruneStep: Step = {
        name: 'prune',
        effect: 'local',
        run: async (done) => {
          if (done.mark?.marked !== true)
            return { outcome: { skipped: 'this run did not verify, so nothing is pruned' } }
          const switchOn = await autoPruneOn(db)
          if (!switchOn) return { outcome: { off: true } }
          const runs = (await listRuns(projectRef, serviceKey)).map((r) => ({
            ...r,
            verified: r.complete && r.marked === true,
          }))
          const retention = planRetention(runs, new Date(), DEFAULT_POLICY)
          try {
            const applied = await applyScheduledRetention(projectRef, serviceKey, retention, {
              switchOn,
              justWritten: prefix,
            })
            const freed = retention.remove
              .filter((d) => applied.deleted.includes(d.name))
              .reduce((a, d) => a + d.bytes, 0)
            return {
              outcome: {
                deleted: [...applied.deleted],
                skipped: [...applied.skipped],
                freed,
                refused: applied.refused,
                kept: retention.keep.length,
                unknown: retention.unknown.length,
                interrupted: retention.unknown.filter((d) => d.rule === 'incomplete').length,
              },
            }
          } catch (error) {
            if (!(error instanceof RetentionRefused)) throw error
            return { outcome: { refusedLoudly: error.message, kept: retention.keep.length } }
          }
        },
      }

      const end =
        plan === null
          ? planned
          : await runSteps(
              db,
              job.jobId,
              STEPS_VERSION,
              [
                planStep,
                ...tables.flatMap(tableSteps),
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
                    const parts: Record<string, string[]> = {}
                    for (const t of tables) {
                      const q = `${t.table_schema}.${t.table_name}`
                      const ranges = plan?.[q]
                      // a whole table is one step; a split one is its parts, added together (fingerprints are sums)
                      const pieces =
                        ranges === undefined
                          ? [{ key: `${prefix}/${q}.json.gz`, o: done[`table:${q}`] }]
                          : ranges.map((_, i) => ({
                              key: partKey(prefix, q, i + 1),
                              o: done[partStep(q, i + 1)],
                            }))
                      counts[q] = pieces.reduce((a, p) => a + Number(p.o?.rows ?? 0), 0)
                      for (const p of pieces)
                        if (typeof p.o?.sha256 === 'string')
                          objects[p.key] = { sha256: p.o.sha256, bytes: Number(p.o.bytes ?? 0) }
                      const fps = pieces.map((p) => p.o?.fingerprint)
                      if (fps.every((f): f is string => typeof f === 'string'))
                        fingerprints[q] = addFingerprints(fps)
                      if (ranges !== undefined) parts[q] = pieces.map((p) => p.key)
                    }
                    const m = await buildManifest(db, projectRef, prefix, counts, {
                      objects,
                      fingerprints,
                      parts,
                    })
                    await putObject(projectRef, serviceKey, m)
                    return {
                      outcome: {
                        rows: m.rows,
                        tables: Object.keys(counts).length,
                        key: m.key,
                        sha256: m.sha256,
                      },
                    }
                  },
                },
                ...verifySteps([...tables.flatMap(tableSteps).map((s) => s.name), 'manifest']),
                markStep,
                pruneStep,
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

      // what verification and the prune found, for the sentence and for whether it is worth a buzz (ADR-0077)
      const mark = end.outcomes.mark ?? {}
      const pruned = end.outcomes.prune ?? {}
      const deletedRuns = Array.isArray(pruned.deleted) ? (pruned.deleted as string[]) : []
      const verifiedNote =
        mark.marked === true
          ? `Every one of its ${String(mark.checked)} objects was read back and matched its checksum. `
          : `It did NOT verify: ${String(Array.isArray(mark.bad) ? mark.bad.length : 0)} object(s) did not read back as written (${(Array.isArray(mark.bad) ? (mark.bad as string[]) : []).slice(0, 3).join(', ')}). It is kept and nothing was pruned. `
      const pruneNote =
        typeof pruned.refusedLoudly === 'string'
          ? `The nightly prune refused: ${pruned.refusedLoudly}.`
          : pruned.off === true
            ? 'The nightly prune is off, so nothing was deleted (system_config backup.auto_prune).'
            : typeof pruned.skipped === 'string'
              ? 'Nothing was pruned.'
              : deletedRuns.length === 0
                ? `Nothing was due to be deleted; ${count(Number(pruned.kept ?? 0), 'backup is', 'backups are')} kept under the retention policy.`
                : `${count(deletedRuns.length, 'expired backup was', 'expired backups were')} deleted under the retention policy (${String(Math.round(Number(pruned.freed ?? 0) / 1_000_000))}MB freed); ${count(Number(pruned.kept ?? 0), 'backup is', 'backups are')} kept.`
      const interruptedNote =
        Number(pruned.interrupted ?? 0) > 0
          ? ` ${count(Number(pruned.interrupted), 'interrupted run is', 'interrupted runs are')} left for a person (npm run backup:prune -- --interrupted).`
          : ''
      const worthABuzz = mark.marked !== true || typeof pruned.refusedLoudly === 'string'

      const split = Object.keys(plan ?? {})
      return {
        ...base,
        body:
          `Backed up ${count(rows, 'row', 'rows')} across ` +
          `${count(tables.length, 'table', 'tables')} — ` +
          `${String(Math.round(bytes / 1024))}KB compressed, one object per table in ` +
          `${bucket}/${prefix}` +
          (split.length === 0
            ? '.\n\n'
            : ` (${split.map((q) => `${q} in ${String(plan?.[q]?.length ?? 0)} parts`).join(', ')}).\n\n`) +
          verifiedNote +
          `${pruneNote}${interruptedNote}\n\n` +
          `${count(kept.length, 'copy is', 'copies are')} in the bucket (${bucketState}). ` +
          'It holds no credentials, and it lives in the same Supabase project it ' +
          'came from — so it survives losing the code or this machine, and not ' +
          'losing the project.',
        // Nightly and identical when all is well; the Set up page carries "last taken 18 minutes ago". A backup that did
        // not verify, or a prune that refused, is worth his phone buzzing.
        announce: worthABuzz,
        ...(worthABuzz ? { severity: 'important' as const } : {}),
      } satisfies HandlerOutput
    },
  }
}
