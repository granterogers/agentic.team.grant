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
import { refreshMail } from '../google/mail.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export function mailHandler(db: SqlExecutor): Handler {
  return {
    kind: 'google.read_mail',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const outcome = await refreshMail(db)

      if (outcome.ok) {
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

      return {
        body: `Mail refreshed: ${outcome.note}.`,
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
