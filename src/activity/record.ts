/**
 * The worker's way into the unified activity ledger (migrations 1060 and 1061, docs/activity-ledger/).
 *
 * Two rules, both written down because the first draft of any logging code breaks one of them:
 *
 *   1. BEST EFFORT, NEVER FATAL. The ledger is an observer of the work, not a step in it. Every call here goes through
 *      `app.record_activity_safely`, which does not raise and does not record an activity about its own failure, and the
 *      TypeScript wrapper swallows a transport failure too. A worker that cannot reach the ledger still drains the queue.
 *      Where an event MUST commit or roll back with a state change, the caller uses the strict SQL writer inside the same
 *      transaction instead; nothing in this file does, and the rows it writes are the ones with no state change of their own.
 *   2. NO NEW SOURCE OF TRUTH. A job transition, a delivery, an approval or a model call is already a row in the table that
 *      owns it, and the read model reads it from there. This file records only what has no such row: a recovery sweep
 *      reclaiming work, a throttle, a threshold. It never writes a job_started or a delivery_sent beside the real one.
 *
 * The writers are default-off: with `activity.ledger_enabled` false the SQL returns null and writes nothing, so shipping this
 * before the switch is flipped changes no behaviour.
 */
import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface RecoveredJob {
  readonly jobId: string
  readonly fromState: string
  readonly reason: string
}

/**
 * One `system.recovered` event per job the sweep reclaimed.
 *
 * The idempotency key is the job and its attempt, so the same reclaim can never be recorded twice (a retried tick, two workers
 * sweeping at once) while a job reclaimed again on a LATER attempt is a new event. The office, project and correlation are read
 * from the job's own row by the database, never supplied by the caller.
 */
export const recordRecovered = async (
  db: SqlExecutor,
  recovered: readonly RecoveredJob[],
): Promise<void> => {
  for (const r of recovered) {
    await db
      .execute(
        `select app.record_activity_safely(
           p_office => j.office_id,
           p_event_type => 'system.recovered',
           p_idempotency_key => 'recovery:' || j.job_id::text || ':' || j.attempt::text,
           p_actor_kind => 'system',
           p_actor => 'worker',
           p_summary => 'Recovered a stalled job: ' || j.kind,
           p_status => 'completed',
           p_project_id => j.project_id,
           p_job_id => j.job_id,
           p_correlation_id => j.correlation_id,
           p_source_interface => 'worker',
           p_metadata => jsonb_build_object('from_state', ${lit(r.fromState.slice(0, 40))}, 'attempt', j.attempt),
           p_evidence_ref => jsonb_build_object('kind', 'job', 'id', j.job_id))
           from public.jobs j where j.job_id = ${lit(r.jobId)}::uuid`,
      )
      .catch(() => undefined)
  }
}

export type ToolPhase = 'requested' | 'completed' | 'failed'

export interface ToolCall {
  readonly jobId: string
  /** The registered capability the step performs (tool_permissions.tool), e.g. `drive.read`. */
  readonly capability: string
  /** The plan step's own id: a short word, never its inputs. */
  readonly step: string
  readonly specialist?: string
  readonly phase: ToolPhase
  /** completed only: whether the tool found something, found nothing, or asked the plan to wait. */
  readonly outcome?: 'found' | 'nothing' | 'paused'
  readonly durationMs?: number
  /** failed only: the error's CLASS (its constructor name), never its message, which can hold what the tool was given. */
  readonly errorClass?: string
}

const TOOL_SUMMARY: Readonly<Record<ToolPhase, string>> = {
  requested: 'Started',
  completed: 'Finished',
  failed: 'Failed',
}

/**
 * One tool-call event from the plan executor (`diagnostic`: debugging detail, hidden from the ordinary view).
 *
 * WHAT IT RECORDS: the capability, the step id, the specialist, the phase, how long it took and whether it found anything. WHAT IT
 * NEVER RECORDS: the step's inputs, what the tool returned, or an error message - a tool is handed a person's data and may echo it,
 * and the ledger holds references, not payloads. It is called AFTER the autonomy policy (`mayAct`) has answered `proceed`, so it
 * observes what the office did and decides nothing; a refusal or a question is already a row in `blockers` or `job_impediments`.
 *
 * Best effort in both directions: the SQL writer never raises, and a transport failure is swallowed here, so a ledger that is down
 * cannot fail a step. The idempotency key is job, step, phase and attempt, so a retried attempt is a new event and a redelivered
 * one is not a second.
 */
export const recordToolCall = async (db: SqlExecutor, call: ToolCall): Promise<void> => {
  const agent = call.specialist
  const status = call.phase === 'requested' ? 'requested' : call.phase
  const meta = [
    `'tool', ${lit(call.capability.slice(0, 80))}`,
    `'step', ${lit(call.step.slice(0, 40))}`,
    `'phase', ${lit(call.phase)}`,
    ...(call.outcome === undefined ? [] : [`'outcome', ${lit(call.outcome)}`]),
    ...(call.durationMs === undefined
      ? []
      : [`'duration_ms', ${String(Math.max(0, Math.round(call.durationMs)))}`]),
    ...(call.errorClass === undefined
      ? []
      : [`'error_class', ${lit(call.errorClass.slice(0, 60))}`]),
  ].join(', ')
  await db
    .execute(
      `select app.record_activity_safely(
         p_office => j.office_id,
         p_event_type => ${lit(`tool.call_${call.phase}`)},
         p_idempotency_key => left('tool:' || j.job_id::text || ':' || ${lit(call.step.slice(0, 60))} || ':' || ${lit(call.phase)} || ':' || j.attempt::text, 200),
         p_actor_kind => ${agent === undefined ? `'system'` : `'agent'`},
         p_actor => ${lit(agent ?? 'office')},
         p_summary => ${lit(TOOL_SUMMARY[call.phase])} || ' ' || ${lit(call.capability.slice(0, 80))},
         p_status => ${lit(status)},
         ${agent === undefined ? '' : `p_agent_slug => ${lit(agent)},`}
         p_project_id => j.project_id,
         p_job_id => j.job_id,
         p_correlation_id => j.correlation_id,
         p_source_interface => 'worker',
         p_metadata => jsonb_build_object(${meta}),
         p_evidence_ref => jsonb_build_object('kind', 'job', 'id', j.job_id))
         from public.jobs j where j.job_id = ${lit(call.jobId)}::uuid`,
    )
    .catch(() => undefined)
}
