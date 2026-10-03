/**
 * The duty that keeps the cached inbox current.
 *
 * 0127's `mail-refresh` responsibility makes the job hourly; this does the
 * work. Thin on purpose, exactly like `calendar.ts`: everything interesting is
 * in `src/google/`, and a handler that also knew how to talk to Google would be
 * a second place for the scope check to be forgotten.
 *
 * ## Why it says less than the calendar does
 *
 * The calendar announces when an event disappears, because a meeting vanishing
 * from Grant's diary is news. Mail arriving is not: it is the normal condition
 * of an inbox, sixteen times a day, and a message in #the_team every hour
 * saying "four new emails" is the noise that makes people stop reading
 * #the_team. So this announces only when something is WRONG.
 *
 * The mail itself reaches Grant by being available to answer questions with —
 * `app.mail_recent()` — not by being pushed at him. He has an email client for
 * being pushed at.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { officeOfJob } from '../db/office.ts'
import { refreshMail } from '../google/mail.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export function mailHandler(db: SqlExecutor): Handler {
  return {
    kind: 'google.read_mail',
    handle: async (job: Job): Promise<HandlerOutput> => {
      // The office is the claimed job's, fixed when the duty made it. Never the "only person" guess: with two real
      // offices that is no_office, and the duty failed every hour (#407).
      const outcome = await refreshMail(db, { officeId: await officeOfJob(db, job.jobId) })

      if (outcome.ok) {
        // raw-sql[2]: keyed by the claimed job; it sets one column of the job the worker holds.
        await db.execute(
          `update public.jobs set announce = false where job_id = ${lit(job.jobId)}::uuid`,
        )
      }

      if (!outcome.ok) {
        // Not thrown. Mail that cannot be read is a §18 degradation, not a job
        // failure: what is cached stays readable, the connection light goes red
        // with the reason, and retrying five times would not help.
        return {
          body:
            `I could not read the mail: ${outcome.note}. What we already had is still here, ` +
            'and the connection light on the front end says the same thing.',
          confidence: 'high',
          evidence: 'verified',
          sources: ['google:gmail'],
          contradictions: null,
          path: 'deterministic_retrieval',
          model: null,
        } satisfies HandlerOutput
      }

      /*
        And the cache is pruned to the retention ADR-0037 decided.

        Nothing had ever pruned `mail_messages`. The refresh caps at fifty a
        run and marks what left the window `vanished_at`, so it grows slowly
        and for ever -- a table holding Grant's subject lines indefinitely is
        not what anybody chose, it is what nobody chose. 180 days is long
        enough for "have we already discussed this" and short enough to be a
        limit.

        Here rather than in its own duty because it belongs to the same act:
        the thing that fills the cache is the thing that should keep it to
        size, and a second hourly job to delete nothing most hours is a job
        Grant would have to understand.

        Swallowed on failure and SAID when it removes something. A retention
        sweep must never turn a successful refresh into a failed job, and a
        sweep nobody can see is 0350's delete that matched nothing and reported
        success.
      */
      let pruned = 0
      try {
        const { rows } = await db.execute(
          `select app.forget_mail_before(app.job_office(${lit(job.jobId)}::uuid), 180) as r`,
        )
        const raw = rows[0]?.r
        const r = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { removed?: unknown }
        pruned = typeof r?.removed === 'number' ? r.removed : 0
      } catch {
        // A cache that could not be pruned is a cache, not an outage.
      }

      /*
        And the bodies, earlier (#172, ADR-0038, migration 0500).

        Deliberately a second call rather than a second parameter on the first:
        the office should remember that a conversation HAPPENED for twice as
        long as it remembers what was in it, and one number cannot express two
        retentions. Same swallow, same reason — a retention sweep must never
        turn a successful refresh into a failed job.
      */
      let forgotten = 0
      try {
        const { rows } = await db.execute(
          `select app.forget_mail_bodies_before(app.job_office(${lit(job.jobId)}::uuid), 90) as r`,
        )
        const raw = rows[0]?.r
        const r = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { forgotten?: unknown }
        forgotten = typeof r?.forgotten === 'number' ? r.forgotten : 0
      } catch {
        // As above.
      }

      return {
        body: `Mail refreshed: ${outcome.note}${
          pruned === 0 ? '' : `, and ${String(pruned)} older than 180 days forgotten`
        }${
          forgotten === 0
            ? ''
            : `, and the words of ${String(forgotten)} older than 90 days forgotten`
        }.`,
        confidence: 'high',
        evidence: 'verified',
        sources: ['google:gmail'],
        contradictions: null,
        path: 'deterministic_retrieval',
        model: null,
      } satisfies HandlerOutput
    },
  }
}
