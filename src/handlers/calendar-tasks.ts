/**
 * The duty that keeps the diary matching the task list (#94, ADR-0020).
 *
 * The mirror of `calendar.ts`, which caches what is already in the diary. This
 * one puts dated, open tasks INTO it.
 *
 * Deliberately thin for the same reason that one is: everything that knows how
 * to talk to Google lives in `src/google/`, and a handler that also knew would
 * be a second place for the scope check — and for the tag check that stops this
 * deleting a real meeting — to be forgotten.
 *
 * ## Why it usually says nothing
 *
 * The diary already matching is the normal case sixteen times a day.
 * `jobs.announce` is set true by the duty dispatcher because a duty's output is
 * usually the point (0100); here it is not, so the handler turns it off when
 * nothing moved. Announcing every quarter-hour that the calendar is unchanged
 * is how a person stops reading the channel that would have told them it broke.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { planTasksForCalendar, syncTasksToCalendar } from '../google/calendar-write.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import type { Plan } from '../tools/plan.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export function calendarTasksHandler(db: SqlExecutor): Handler {
  return {
    kind: 'google.write_calendar_tasks',
    /*
      What it would do (#131). The same function the sync itself calls to
      decide what to do -- settings, credential, scope and the SQL that works
      out the difference -- stopping before the first outward write. There is
      no second description of the work here, which is the only reason this
      can be trusted to match what happens next.
    */
    plan: async (): Promise<Plan> => (await planTasksForCalendar(db)).plan,
    handle: async (job: Job): Promise<HandlerOutput> => {
      const outcome = await syncTasksToCalendar(db)

      const moved = outcome.created + outcome.updated + outcome.removed
      if (outcome.ok && moved === 0) {
        await db.execute(
          `update public.jobs set announce = false where job_id = ${lit(job.jobId)}::uuid`,
        )
      }

      if (!outcome.ok) {
        /*
          Not thrown, for the same reason the reader does not throw: a calendar
          that will not accept a write is a §18 degradation rather than a job
          failure. Retrying five times would not fix a missing scope, and the
          tasks themselves are untouched — the office's own record is fine, it
          is only the copy in the diary that is behind.
        */
        return {
          body:
            `I could not put the tasks in the diary: ${outcome.note}. Nothing on the ` +
            'task list changed, and the connection light says the same thing.',
          confidence: 'high',
          evidence: 'verified',
          sources: ['google:calendar'],
          contradictions: null,
          path: 'deterministic_retrieval',
          model: null,
        } satisfies HandlerOutput
      }

      return {
        body: `Diary and task list: ${outcome.note}.`,
        /*
          The structure beside the prose (#130).

          "Nothing changed" is this duty's answer sixteen times a day, and every
          consumer of it -- the studio, #52's noticing pass, a follow-up asking
          whether anything came of something -- has had to read the sentence to
          establish that. The sentence stays; a boolean sits next to it.
        */
        shape: 'nothing_happened',
        facts: { changed: moved > 0, looked_at: moved },
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
