/**
 * The daily capacity report §22 asks for.
 *
 * §22's scenario A ends: *"all actions versioned → usage visible in-app and in
 * the daily capacity report."* The in-app half has existed since 0077 — the
 * Usage tab. The report did not exist at all, and neither did anything that
 * could have produced one: `responsibilities` held the shape of a recurring
 * duty and had no rows, and nothing called `app.due_responsibilities()`.
 *
 * ## Why it is assembled from SQL and not written by a model
 *
 * Every line is a number with a provenance, and §11 draws a hard line between a
 * measured figure and a modelled one. A model asked to summarise these would
 * produce a fluent paragraph in which "35 of 40 by our own count, because
 * Google publishes no usage API" became "35 of 40 remaining" — which is the
 * same sentence with the only important part removed.
 *
 * So the numbers are counted and the sentences are written, and the one place
 * an estimate appears it says whose estimate it is.
 *
 * ## What it deliberately does not do
 *
 * It does not page. `jobs.announce` is false for a duty (0098) and the report
 * itself is routine, which is below the pager's floor — §12 gives Telegram one
 * interrupting voice and a daily digest is not it. It goes to Slack, where a
 * daily report is a thing you scroll back to rather than something that buzzes.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { count } from '../text/plain.ts'
import { sayAs } from '../text/voice.ts'

interface Day {
  jobs_done: number
  jobs_failed: number
  model_calls: number
  spend: number
  delivered: number
  undelivered: number
  blockers: number
  blockers_overdue: number
  instructions: number
}

/**
 * Work this system did for Grant, as opposed to work it did to test itself.
 *
 * The first version of the daily report told him 129 things had failed
 * yesterday. 96 of those were `verification.probe` rows retired by
 * `verify:jobs`, and most of the rest were fixtures from `verify:worker` and
 * `verify:agents` — a report counting its own test suite, which is a report
 * that cries wolf every morning until nobody reads it.
 *
 * `requested_by` separates them cleanly: every suite stamps its own name there
 * ('phase-1-verification', 'verify:worker', 'verify:agents'). Matching on that
 * rather than on job kind, because kinds like `research.live` are used by both
 * the suite and the real thing, and the requester never is.
 */
const NOT_A_TEST = "coalesce(requested_by, '') not ilike '%verif%'"

/** One number per question, all over the same window, in one round trip. */
const DAY = `
  select
    (select count(*)::int from public.jobs
      where state = 'complete' and finished_at > app.now_utc() - interval '24 hours'
        and ${NOT_A_TEST})
      as jobs_done,
    (select count(*)::int from public.jobs
      where state = 'failed' and finished_at > app.now_utc() - interval '24 hours'
        and ${NOT_A_TEST})
      as jobs_failed,
    -- inference_usage, not inference_calls. The first version guessed the name
    -- from the concept and the handler failed on its first real firing; the
    -- schema is the authority and it is one query away. (No backticks in this
    -- comment: it is inside a template literal, and they ended the string.)
    (select count(*)::int from public.inference_usage
      where occurred_at > app.now_utc() - interval '24 hours') as model_calls,
    (select coalesce(sum(cost_usd), 0)::numeric from public.inference_usage
      where occurred_at > app.now_utc() - interval '24 hours') as spend,
    (select count(*)::int from public.deliveries
      where state = 'sent' and updated_at > app.now_utc() - interval '24 hours')
      as delivered,
    -- Failed only. 'suppressed' is a decision, not a failure, and 'claimed' is
    -- a delivery still in flight — counting either as undelivered would make
    -- the one line worth acting on the one line that is always non-zero.
    (select count(*)::int from public.deliveries
      where state = 'failed'
        and updated_at > app.now_utc() - interval '24 hours') as undelivered,
    (select count(*)::int from public.blockers where state = 'open') as blockers,
    (select count(*)::int from public.blockers
      where state = 'open' and real_deadline is not null and real_deadline < app.now_utc())
      as blockers_overdue,
    (select count(*)::int from public.inbound_commands
      where received_at > app.now_utc() - interval '24 hours') as instructions
`

export function capacityHandler(
  db: SqlExecutor,
  /**
   * Who writes it. Null leaves the assembled version, which is correct and
   * reads like a form.
   *
   * The header below argues that a model asked to SUMMARISE these numbers
   * would turn "35 of 40 by our own count" into "35 of 40 remaining", and that
   * argument still holds — which is why the model is never shown the numbers
   * to summarise. It is handed the finished sentences as facts and asked to
   * say them as Claire would. §11's line stays on this side of the boundary.
   */
  router: ProviderRouter | null = null,
): Handler {
  return {
    kind: 'office.capacity_report',
    handle: async (job: Job): Promise<HandlerOutput> => {
      // `as unknown as`, because a row comes back as Record<string, unknown> and
      // TypeScript is right that the two do not overlap. The shape is asserted by
      // the SQL above, which names every column.
      const day = (await db.execute(DAY)).rows[0] as unknown as Day
      const meter = (await db.execute('select app.notebook_allowance() as a')).rows[0] as {
        a?: {
          window_spent?: number
          window_ceiling?: number
          week_spent?: number
          week_ceiling?: number
          ceiling_is_measured?: boolean
          blocked_until?: string | null
        }
      }
      const nb = meter.a ?? {}

      /*
        Written as a colleague's morning note, not a status board.

        It used to be six lines each opening `**Something.**` — a bold label
        with a full stop after it, which is a report format. Grant: *"I want
        messages in general from everyone to be more human and easier to
        read."* So: the important thing first, plain sentences, and the
        quiet parts left out entirely rather than printed as zeroes.

        The strongest version of "easier to read" is fewer lines. A day with
        nothing wrong should be two sentences, not six headings saying nothing
        happened.
      */
      const lines: string[] = []

      // What needs him, first, because it is the only part that is an ask.
      if (Number(day.blockers) > 0) {
        lines.push(
          `Morning. ${count(Number(day.blockers), 'decision is', 'decisions are')} waiting on you` +
            (Number(day.blockers_overdue) === 0
              ? '.'
              : `, and ${String(day.blockers_overdue)} of those are past a real deadline.`),
        )
      } else {
        lines.push('Morning. Nothing is waiting on you.')
      }

      // Then what we did. One sentence, and the failures only if there were any.
      lines.push(
        Number(day.jobs_failed) === 0
          ? `We finished ${count(Number(day.jobs_done), 'piece', 'pieces')} of work yesterday, ` +
              'and nothing failed.'
          : // NOT "n of them failed". Finished and failed are separate counts
            // over the same window, and the first draft read "We finished 101
            // pieces of work yesterday. 129 of them failed." — which is not
            // merely clumsy, it is arithmetic nonsense and would make a reader
            // distrust every other number in the note.
            `We finished ${count(Number(day.jobs_done), 'piece', 'pieces')} of work yesterday, ` +
              `and ${count(Number(day.jobs_failed), 'one', 'others')} failed.`,
      )

      // Undelivered messages are the failure that looks like silence, so they
      // get their own line. When everything arrived, that is not news.
      if (Number(day.undelivered) > 0) {
        lines.push(
          `${count(Number(day.undelivered), 'message', 'messages')} we sent never arrived. ` +
            'That is the one that looks like silence from your end, so it is worth a look.',
        )
      }

      // Cost, only when there is any. "Costing nothing" every single morning
      // is a line that trains you to stop reading.
      if (Number(day.spend) > 0) {
        lines.push(
          `${count(Number(day.model_calls), 'model call', 'model calls')}, ` +
            `costing $${Number(day.spend).toFixed(4)}.`,
        )
      }

      // Notebook, only when it is close to a limit or actually refusing.
      // The full accounting lives on the Usage page; this is a nudge.
      if (nb.window_ceiling !== undefined) {
        const spent = Number(nb.window_spent ?? 0)
        const ceiling = Number(nb.window_ceiling)
        const blocked = nb.blocked_until !== null && nb.blocked_until !== undefined
        if (blocked) {
          lines.push(
            `Notebook is refusing us until ${new Date(String(nb.blocked_until)).toUTCString()}.`,
          )
        } else if (ceiling > 0 && spent / ceiling > 0.7) {
          lines.push(
            `We are ${String(spent)} of ${String(ceiling)} through what we think Notebook ` +
              'allows. That ceiling is our own guess — Google publish no usage figure.',
          )
        }
      }

      const assembled = lines.join('\n\n')

      return {
        // Grant: *"you were supposed to make these people pass the Turing
        // test."* A morning note that opens "Morning. Nothing is waiting on
        // you." every single day for a month is the clearest possible tell
        // that nobody wrote it. Claire writes it now, from these exact lines.
        body: await sayAs(db, router, 'chief-of-staff', {
          purpose:
            'Write Grant his morning note. You send this every day, so vary ' +
            'it — some mornings there is something to remark on and most ' +
            'there is not. Lead with whatever actually matters today.',
          facts: lines,
          fallback: assembled,
          words: 90,
        }),
        confidence: 'high',
        // Every figure is counted from our own tables. The one inference in it
        // — the notebook ceiling — is labelled as one inside the sentence.
        evidence: 'verified',
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval',
        model: null,
      } satisfies HandlerOutput
    },
  }
}

/** Exported so a verification can assert on the same window the handler reads. */
export { DAY as CAPACITY_WINDOW_SQL }

/**
 * Fire whatever recurring duties are due, and say what happened.
 *
 * Called by the worker before it drains, so a duty fired this tick is worked
 * this tick rather than five minutes later. Not fatal: a dispatcher that
 * throws must not stop the queue from being drained, because the queue holds
 * work Grant actually asked for and the duties are work nobody is waiting on.
 */
export async function fireDueDuties(db: SqlExecutor): Promise<readonly string[]> {
  try {
    const { rows } = await db.execute('select * from app.dispatch_due_responsibilities()')
    // `duty_slug`, not `slug`: inside plpgsql an OUT column named `job_id`
    // shadowed `jobs.job_id` and Postgres refused the whole call (0099), so
    // every OUT column here is prefixed.
    return (rows as { duty_slug: string; outcome: string }[])
      .filter((r) => r.outcome === 'fired')
      .map((r) => r.duty_slug)
  } catch (error) {
    return [`duties could not be dispatched: ${(error as Error).message.slice(0, 120)}`]
  }
}
