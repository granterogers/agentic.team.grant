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

/** One number per question, all over the same window, in one round trip. */
const DAY = `
  select
    (select count(*)::int from public.jobs
      where state = 'complete' and finished_at > app.now_utc() - interval '24 hours')
      as jobs_done,
    (select count(*)::int from public.jobs
      where state = 'failed' and finished_at > app.now_utc() - interval '24 hours')
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

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`

export function capacityHandler(db: SqlExecutor): Handler {
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

      const lines: string[] = [
        `**Yesterday.** ${plural(Number(day.jobs_done), 'piece', 'pieces')} of work finished` +
          (Number(day.jobs_failed) === 0
            ? ' and nothing failed.'
            : `, and ${plural(Number(day.jobs_failed), 'failed', 'failed')}.`),
      ]

      lines.push(
        `**Inference.** ${plural(Number(day.model_calls), 'model call', 'model calls')}, ` +
          (Number(day.spend) === 0
            ? 'costing nothing — everything ran on a free model.'
            : `costing $${Number(day.spend).toFixed(4)}.`),
      )

      // The one estimate in the report, and it says so in the same sentence
      // rather than in a footnote nobody reads.
      if (nb.window_ceiling !== undefined) {
        lines.push(
          `**Notebook.** ${String(nb.window_spent)} of ${String(nb.window_ceiling)} used in the ` +
            `current window and ${String(nb.week_spent)} of ${String(nb.week_ceiling)} this week — ` +
            'our own count, not Google’s, because they publish no usage API. The ceiling is ' +
            (nb.ceiling_is_measured === true
              ? 'what a refusal actually measured.'
              : 'still a guess until a refusal measures it.') +
            (nb.blocked_until === null || nb.blocked_until === undefined
              ? ''
              : ` They are refusing us until ${new Date(nb.blocked_until).toUTCString()}.`),
        )
      }

      lines.push(
        Number(day.undelivered) === 0
          ? `**Messages.** ${plural(Number(day.delivered), 'message', 'messages')} sent, all of them arrived.`
          : `**Messages.** ${plural(Number(day.delivered), 'message', 'messages')} arrived and ` +
              `${plural(Number(day.undelivered), 'did not', 'did not')} — an undelivered message ` +
              'is the failure that looks like silence, so this is the line to act on.',
      )

      lines.push(
        Number(day.blockers) === 0
          ? '**Waiting on you.** Nothing.'
          : `**Waiting on you.** ${plural(Number(day.blockers), 'decision', 'decisions')}` +
              (Number(day.blockers_overdue) === 0
                ? '.'
                : `, ${String(day.blockers_overdue)} of them past a real deadline.`),
      )

      lines.push(
        `**You sent us** ${plural(Number(day.instructions), 'message', 'messages')} in the last day.`,
      )

      return {
        body: lines.join('\n\n'),
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
