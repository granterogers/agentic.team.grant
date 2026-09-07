/**
 * The duty that keeps the cached calendar current.
 *
 * 0109's `calendar-refresh` responsibility makes the job hourly; this does the
 * work. Deliberately thin — everything interesting is in `src/google/`, and a
 * handler that also knew how to talk to Google would be a second place for the
 * scope check to be forgotten.
 *
 * ## Why it does not announce
 *
 * A refresh that found nothing new is the normal case sixteen times a day.
 * `jobs.announce` is set true by the duty dispatcher because a duty's output is
 * usually the point (0100) — here it is not, so the handler turns it off for
 * the uneventful case and leaves it on when there is something to say. That is
 * the column doing exactly what 0074 built it for: *"a job can decide its own
 * output is not worth a message."*
 */

import type { SqlExecutor } from '../db/executor.ts'
import { refreshCalendar } from '../google/calendar.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export function calendarHandler(db: SqlExecutor): Handler {
  return {
    kind: 'google.read_calendar',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const outcome = await refreshCalendar(db)

      // Silent unless something changed or something is wrong. The alternative
      // is a message in #the_team every hour saying the diary is the same.
      const worthSaying = !outcome.ok || outcome.removed > 0
      if (!worthSaying) {
        await db.execute(
          `update public.jobs set announce = false where job_id = ${lit(job.jobId)}::uuid`,
        )
      }

      if (!outcome.ok) {
        // Not thrown. A calendar that cannot be read is a §18 degradation, not
        // a job failure: the cached events stay readable, the connection light
        // goes red with the reason, and retrying five times would not help.
        return {
          body:
            `I could not read the calendar: ${outcome.note}. What we already had is still ` +
            'here, and the connection light on the front end says the same thing.',
          confidence: 'high',
          evidence: 'verified',
          sources: ['google:calendar'],
          contradictions: null,
          path: 'deterministic_retrieval',
          model: null,
        } satisfies HandlerOutput
      }

      return {
        body: `Calendar refreshed: ${outcome.note}.`,
        confidence: 'high',
        evidence: 'verified',
        sources: ['google:calendar'],
        contradictions: null,
        path: 'deterministic_retrieval',
        model: null,
      } satisfies HandlerOutput
    },
  }
}
