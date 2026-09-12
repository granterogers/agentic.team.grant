/**
 * Keeping the trace inside its window (#115, migrations 0257 and 0258).
 *
 * `job_traces` is the highest-volume table in the office — a step per prompt,
 * model call, tool call, retrieval and decision, on every one of roughly 250
 * jobs a day — and the free tier is 500 MB. A trace with no retention is a
 * feature that works beautifully for a month and then becomes the reason
 * nothing else can be written.
 *
 * ## Thin, like the other duties
 *
 * The rule lives in `app.job_trace_prune`: thirty days, capped per pass, the
 * rollup on the job kept. This handler calls it and says what happened. A
 * handler that reimplemented the window would be a second place for it to be
 * wrong, and the SQL one is the version the database can enforce.
 *
 * ## It usually says nothing
 *
 * Sixteen times a day there is nothing older than the window, and announcing
 * that is how a person stops reading the channel that would have told them it
 * broke. Same reasoning as `calendar-tasks.ts`: `announce` goes false when
 * nothing moved.
 *
 * The exception is a backlog. `job_trace_prune` returns `more` when it hit its
 * per-pass cap, which means the table is growing faster than an hourly pass can
 * clear it — that is worth saying, because it is the early warning for the free
 * tier and there is no other one.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

interface Pruned {
  readonly ok: boolean
  readonly removed: number
  readonly more: boolean
  readonly note: string
}

export function jobTracesHandler(db: SqlExecutor): Handler {
  return {
    kind: 'office.prune_job_traces',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const row = (await db.execute('select app.job_trace_prune() as r')).rows[0] as { r: Pruned }
      const out = row.r

      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
      }

      if (out.removed === 0) {
        /*
          Nothing to do is the normal case, and it is not news. Turned off here
          rather than by the dispatcher, because the dispatcher sets `announce`
          true for a duty on the reasoning that a duty's output is usually the
          point (0100) — true of a briefing, false of a cleanup.
        */
        await db.execute(
          `update public.jobs set announce = false where job_id = ${lit(job.jobId)}::uuid`,
        )
        return { ...base, body: 'No job trace steps older than thirty days.', announce: false }
      }

      if (out.more) {
        /*
          The cap was reached, which means the table is growing faster than an
          hourly pass clears it. Worth saying out loud: this is the only early
          warning the free tier has, and the alternative to noticing it here is
          noticing it as a write failure.
        */
        return {
          ...base,
          body:
            `Dropped ${String(out.removed)} job trace steps older than thirty days, and there ` +
            'are more waiting — the trace is growing faster than an hourly pass clears it. ' +
            'The rollups on each job are kept. Worth a look at how much is being traced.',
          announce: true,
        }
      }

      return {
        ...base,
        body: `Dropped ${String(out.removed)} job trace steps older than thirty days; the rollups stay.`,
        announce: false,
      }
    },
  }
}
