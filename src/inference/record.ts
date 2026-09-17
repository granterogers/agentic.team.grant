/**
 * Writing usage and blockers to the database.
 *
 * Separate from `policy.ts` on purpose: the decision is pure and heavily
 * tested, the writing is I/O. Mixing them would mean every policy test needed
 * a database.
 *
 * §11 requires usage to be tracked "for every provider even where provider-side
 * metrics exist", and classified. The classification is decided here, once,
 * from what the provider actually returned — not by each caller.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { BlockerDraft, UsageOutcome } from './policy.ts'

/** Single-quote escaping for SQL literals. Values here are never secrets. */
const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`
const nullableLit = (value: string | undefined): string =>
  value === undefined ? 'null' : lit(value)

export interface UsageRecord {
  readonly provider: string
  readonly modelId: string
  readonly correlationId: string
  readonly jobId?: string | undefined
  readonly outcome: UsageOutcome
  readonly promptTokens?: number
  readonly completionTokens?: number
  /**
   * What the provider said the cost was. `null` means it reported nothing,
   * `undefined` is not accepted — the distinction is the whole point, because
   * `null` is precisely when the figure must not be called authoritative.
   */
  readonly providerReportedCost: number | null
  /**
   * Wall-clock milliseconds, request to last byte.
   *
   * Optional because a call that failed before it was sent has no answer, and
   * a zero there would drag every average it appears in towards a speed
   * nothing achieved. Null is the honest value for "we do not know".
   */
  readonly latencyMs?: number | undefined
}

/**
 * Classify per §11.
 *
 * AUTHORITATIVE only when the provider reported a cost. Otherwise ESTIMATED:
 * CALCULATED would require "a known quota plus complete local accounting", and
 * OpenRouter's free tier publishes no per-model quota, so claiming CALCULATED
 * here would be the exact error §11 warns about.
 */
const provenanceFor = (reported: number | null): 'authoritative' | 'estimated' =>
  reported === null ? 'estimated' : 'authoritative'

export const recordUsage = async (db: SqlExecutor, record: UsageRecord): Promise<void> => {
  const reported = record.providerReportedCost
  await db.execute(`
    insert into public.inference_usage
      (provider, model_id, correlation_id, job_id, outcome,
       prompt_tokens, completion_tokens, cost_usd, provider_reported_cost, provenance,
       latency_ms)
    values
      (${lit(record.provider)}, ${lit(record.modelId)}, ${lit(record.correlationId)},
       ${nullableLit(record.jobId)}::uuid, ${lit(record.outcome)},
       ${String(record.promptTokens ?? 0)}, ${String(record.completionTokens ?? 0)},
       ${String(reported ?? 0)}, ${reported === null ? 'null' : String(reported)},
       ${lit(provenanceFor(reported))}::public.usage_provenance,
       ${record.latencyMs === undefined ? 'null' : String(Math.round(record.latencyMs))})
  `)
}

/** Returns the new blocker's id, so the caller can put it in the ledger. */
export const raiseBlocker = async (db: SqlExecutor, draft: BlockerDraft): Promise<string> => {
  const options = draft.approvalOptions.map((o) => lit(o)).join(', ')

  /*
    An offer may only promise what the press can perform (#15, and the rule
    0390 cost four defects to learn).

    `app.hq_answer_blocker` refuses an answer that is not one of the options,
    so a `standingOption` missing from the list is a standing authorization
    nobody could ever grant — the control that exists and cannot be pressed.
    Caught here rather than by a check constraint, because the constraint
    cannot see inside a text array.
  */
  if (draft.standingOption !== undefined && !draft.approvalOptions.includes(draft.standingOption)) {
    throw new Error(
      `standingOption ${JSON.stringify(draft.standingOption)} is not one of the approval options`,
    )
  }
  // Same rule for the option that PERFORMS something, and for the same reason:
  // `hq_answer_blocker` refuses an answer outside the list, so an `onAnswer`
  // naming an option nobody offered is work nobody could ever trigger.
  if (draft.onAnswer !== undefined && !draft.approvalOptions.includes(draft.onAnswer.option)) {
    throw new Error(
      `onAnswer option ${JSON.stringify(draft.onAnswer.option)} is not one of the approval options`,
    )
  }
  const { rows } = await db.execute(`
    insert into public.blockers
      (project_id, job_id, requested_action, why_needed, consequences_of_delay,
       approval_options, originating_agent, work_can_continue,
       standing_tool, standing_option, on_answer)
    values
      (${nullableLit(draft.projectId)}::uuid, ${lit(draft.jobId)}::uuid,
       ${lit(draft.requestedAction)}, ${lit(draft.whyNeeded)},
       ${lit(draft.consequencesOfDelay)},
       array[${options}]::text[], ${lit(draft.originatingAgent)},
       ${draft.workCanContinue ? 'true' : 'false'},
       ${nullableLit(draft.standingTool)}, ${nullableLit(draft.standingOption)},
       ${draft.onAnswer === undefined ? 'null' : `${lit(JSON.stringify(draft.onAnswer))}::jsonb`})
    returning blocker_id::text as blocker_id
  `)
  const id = rows[0]?.blocker_id
  if (typeof id !== 'string') throw new Error('blocker insert returned no id')
  return id
}

/**
 * The urgency boundary, from configuration rather than a constant (§4).
 *
 * A missing key is a fault, not a reason to fall back to a default. A silent
 * default here would decide who gets paged, and would do it invisibly.
 */
export const urgentPriorityMax = async (db: SqlExecutor): Promise<number> => {
  const { rows } = await db.execute(
    `select value::text as value from public.system_config where key = 'jobs.urgent_priority_max'`,
  )
  const raw = rows[0]?.value
  if (typeof raw !== 'string') {
    throw new Error('system_config key jobs.urgent_priority_max is missing')
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) {
    throw new Error(`jobs.urgent_priority_max is not an integer: ${raw}`)
  }
  return parsed
}
