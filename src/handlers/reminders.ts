/**
 * The handler behind the `task-reminders` duty (#259, migration 0512).
 *
 * `remind_at` has been on `public.tasks` since 0482. The editor sets it,
 * `app.my_tasks` reads it into the Today bucket, the studio draws it on the
 * card — and nothing in this directory had ever read it. A person could say
 * *"remind me Friday at nine"*, watch the office confirm it, see the time on
 * the card, and hear nothing on Friday.
 *
 * CLAUDE.md names the class: *"A dial with no reader is worse than no dial,
 * because it looks like a decision."*
 *
 * ## The one duty that is supposed to interrupt
 *
 * `office.chores` sets `announce: false` and says why — the list IS the
 * notification, and a message every hour about the same dead credential is
 * narration Grant has twice asked not to get. A reminder is the opposite case
 * and the exception proves the rule: its entire purpose is to reach him at a
 * moment he chose. So it announces when there is something, and is silent when
 * there is not, which is the same principle applied to a different job.
 *
 * ## Read, compose, THEN mark
 *
 * `app.reminders_due()` is a pure read and `app.reminders_sent()` is a
 * separate call. Doing it in one `update … returning` would be atomic and
 * would lose a reminder for ever the moment anything after it failed — and
 * plenty can fail after a handler returns, because the output insert has gates
 * in front of it. At-least-once is the correct direction here: a reminder said
 * twice is an annoyance, a reminder never said is the feature not existing.
 *
 * The mark is therefore the LAST thing, after the body is in hand.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { count } from '../text/plain.ts'

interface Due {
  readonly id: string
  readonly title: string
  readonly remind_at: string
  readonly due_on: string | null
  readonly project: string | null
  readonly overdue: boolean
}

/**
 * What the office says when reminders fall due.
 *
 * Exported so it can be tested without a database: this is the sentence Grant
 * actually receives, and the wording is the product.
 */
export function remindersBody(due: readonly Due[]): string {
  if (due.length === 0) return 'Nothing to remind you about.'
  /*
    One reminder gets a sentence; several get a list. A list of one reads like
    a system report, and a paragraph of five is unscannable — #209 is this
    repository's record of what a run-together list costs, and the fix there
    was the element the language already has.
  */
  const line = (d: Due): string =>
    `${d.title}${d.project === null ? '' : ` — ${d.project}`}${d.overdue ? ' (overdue)' : ''}`
  if (due.length === 1) {
    const only = due[0] as Due
    return `Reminder: ${line(only)}.`
  }
  return (
    `${count(due.length, 'reminder', 'reminders')}:\n\n` + due.map((d) => `- ${line(d)}`).join('\n')
  )
}

export function remindersHandler(db: SqlExecutor): Handler {
  return {
    kind: 'tasks.remind',
    handle: async (job: Job): Promise<HandlerOutput> => {
      /*
        One office's reminders: the CLAIMED job's. The duty is a responsibility of one office, and every office has
        its own, so nobody's reminder is sent from, or marked by, somebody else's tick.
      */
      const office = `app.job_office('${job.jobId.replace(/'/g, "''")}'::uuid)`
      /*
        FIRST, WHAT EARLIER TICKS SAID (C3, migration 1027). A reminder is marked reminded when its message was DELIVERED,
        and delivery finishes after the job that announced it, so the answer is read here, on a later tick: delivered
        ends the occurrence (a series moves on in place), a lost or refused message is due again (up to three sends),
        and one still in flight is left alone. A database without the function (or without 1029's
        app.job_delivery_state) cannot tell, and then the older rule applies: marked once said, so a reminder is never
        said twice.
      */
      const tracksDelivery = await db
        .execute(`select app.reminders_settle(${office}) as s`)
        .then(() => true)
        .catch((error: unknown) => {
          // Only "that function is not there" means this database cannot track delivery. Any other failure is a failure
          // of the tick (the job retries), never a reason to quietly go back to marking before delivery.
          if (/does not exist|42883/i.test(String((error as Error)?.message ?? error))) return false
          throw error
        })
      const raw = (await db.execute(`select app.reminders_due(${office}) as r`)).rows[0] as
        | { r?: unknown }
        | undefined
      /*
        The executor hands a jsonb column back as an OBJECT, and CLAUDE.md
        records `JSON.parse(String(x))` on one producing
        "[object Object] is not valid JSON" — a guessed shape that reads like a
        corrupt payload. Accept either.
      */
      const parsed = typeof raw?.r === 'string' ? JSON.parse(raw.r) : (raw?.r ?? [])
      const due = (Array.isArray(parsed) ? parsed : []) as Due[]

      const body = remindersBody(due)

      /*
        Marked last, and only for what was actually named in the body. A task
        that arrived between the read and here is not in `due`, so it is not
        marked, so it is said on the next tick.
      */
      if (due.length > 0) {
        const ids = due.map((d) => `'${d.id.replace(/'/g, "''")}'::uuid`).join(',')
        if (tracksDelivery) {
          // In flight, not sent: the settle on a later tick decides, from what the delivery layer recorded.
          await db.execute(
            `select app.reminders_announced(${office}, array[${ids}], '${job.jobId.replace(/'/g, "''")}'::uuid)`,
          )
        } else {
          await db.execute(`select app.reminders_sent(${office}, array[${ids}])`)
        }
      }

      return {
        confidence: 'high',
        evidence: 'verified',
        sources: [`job:${job.jobId}`, 'db:tasks'],
        contradictions: null,
        path: 'deterministic_retrieval',
        model: null,
        /*
          The exception to the office's quiet default, and the reason is the
          feature: a reminder that does not interrupt is a row in a table.
          Silent when there is nothing, so a quarter-hourly duty cannot become
          ninety-six messages a day saying nothing is due.
        */
        announce: due.length > 0,
        body,
        /*
          WHAT THIS ANNOUNCEMENT IS ABOUT: these occurrences, not these words (found by the Version 1 acceptance suite).

          `app.say_once` keeps a duty from saying one thing every hour by fingerprinting the BODY for twenty hours, and
          `tasks.remind` is a duty. A body is only the title, so "take the pills" at 4pm and "take the pills" at 8pm are the
          same fingerprint: the second reminder was muted as "already said", the settle step read a muted job as a lost
          delivery and re-opened it, the next tick was muted too, and after the third send the reminder was marked
          finished having reached nobody. A reminder is already said at most once per occurrence (a task in flight or
          reminded is not due), so the fingerprint is the occurrence: each task and the time it was set for. A retry of the
          SAME occurrence after a definite failure keeps the same topic and is let through by
          `app.reopen_duty_voice`, exactly as before.
        */
        ...(due.length > 0
          ? { topic: `reminders:${due.map((d) => `${d.id}@${d.remind_at}`).join(',')}` }
          : {}),
      } satisfies HandlerOutput
    },
  }
}
