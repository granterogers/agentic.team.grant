/**
 * The office running a workflow on demand (#17).
 *
 * Thin on purpose: the ceiling is in the database and the API call is in
 * `src/ci/dispatch.ts`. What this adds is the sentence Grant reads, and the
 * rule that a refusal is an ANSWER rather than a failure — a job that threw
 * because the month's minutes are spent would burn attempts and eventually
 * land in `failed`, which is a table he does not read.
 */

import { dispatchWorkflow } from '../ci/dispatch.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface CiDispatchDeps {
  readonly db: SqlExecutor
}

export function ciDispatchHandler(deps: CiDispatchDeps): Handler {
  const { db } = deps
  return {
    kind: 'ci.dispatch',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        contradictions: null,
        evidence: 'verified' as const,
        model: null,
        path: 'deterministic_retrieval' as const,
        sources: [`job:${job.jobId}`],
      }
      const say = (body: string): HandlerOutput => ({ ...base, announce: true, body })

      // raw-sql[2]: keyed by the claimed job; it reads the payload of the job the worker holds.
      const pinned = (
        (
          await db.execute(
            `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
          )
        ).rows[0] as { pinned_config?: Record<string, unknown> } | undefined
      )?.pinned_config
      const workflow = String(pinned?.workflow ?? '').trim()
      const reason = String(pinned?.reason ?? '').trim()

      if (workflow === '') {
        return say('I was asked to run a workflow and not told which one.')
      }
      /*
        A reason is required, and it is not ceremony: the ledger is what Grant
        reads in three months when he asks where the month's minutes went, and
        a row saying only "backup" answers nothing.
      */
      if (reason === '') {
        return say(`I can run ${workflow}, but not without a reason to record against it.`)
      }

      const done = await dispatchWorkflow(db, {
        jobId: job.jobId,
        reason,
        requestedBy: String(pinned?.requested_by ?? 'grant'),
        workflow,
      })

      if (!done.ok && done.refusedByCeiling) {
        return say(`I have not run ${workflow}: ${done.detail}`)
      }
      if (!done.ok) return say(done.detail)

      const budget = (await db.execute('select app.ci_budget() as b')).rows[0]?.b as
        | Record<string, unknown>
        | string
        | undefined
      const left = (
        (typeof budget === 'string' ? JSON.parse(budget) : (budget ?? {})) as {
          left_minutes?: number
        }
      ).left_minutes

      return say(
        `${done.detail}${
          left === undefined ? '' : ` About ${String(left)} minutes are left this month.`
        }`,
      )
    },
  }
}
