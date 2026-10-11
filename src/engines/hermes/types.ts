/**
 * Types and shape validators for the Hermes engine (INTERFACE-CONTRACTS section 7). Pure: no Deno or Node API, so the worker handler and
 * the bridge import the same file. The database validates the same shapes in SQL (app.engine_request_problem and
 * app.engine_result_problem); `src/engines/hermes/shape-cases.ts` is the one table of specimens both are run against, and the replica
 * proof fails if the two ever disagree.
 */
import { LIMITS } from './timing.ts'

export type EngineName = 'team' | 'hermes'
export type EngineRunState = 'open' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired'
export type EngineOutcome = 'completed' | 'failed' | 'cancelled'

/** What the office sends Hermes, verbatim. Stored on engine_runs.request and serialised with sorted keys. */
export interface HermesRunRequest {
  readonly input: string
  readonly instructions: string
  readonly conversation_history: readonly {
    readonly role: 'user' | 'assistant'
    readonly content: string
  }[]
  readonly model?: string
}

export interface ClaimedRun {
  readonly run_id: string
  readonly claim_gen: number
  readonly job_id: string
  readonly deadline_at: string
  readonly request: HermesRunRequest
  /** Set only when THIS attempt already started Hermes: the bridge attaches instead of starting. */
  readonly hermes_run_id: string | null
  /** An earlier attempt's Hermes run, to be stopped before this attempt starts (M0 D-2). */
  readonly previous_hermes_run_id: string | null
}

export interface EngineRunResult {
  readonly hermes_run_id?: string | null
  readonly answer?: string
  readonly model?: string
  readonly usage?: { readonly input_tokens: number; readonly output_tokens: number }
  readonly turn_exit_reason?: string
  readonly failure?: string
  readonly tools_started: number
  readonly approvals_denied: number
  readonly notes?: readonly string[]
}

/** Handler-side view of a run (app.engine_run_for_job). */
export interface EngineRunRow {
  readonly run_id: string
  readonly state: EngineRunState
  readonly engine: 'hermes'
  readonly deadline_at: string
  readonly result: EngineRunResult | null
  readonly failure: string | null
}

/** What the engine gateway answers a claim with. */
export interface ClaimAnswer {
  readonly run: ClaimedRun | null
  readonly refused?: string
}

export interface HeartbeatAnswer {
  readonly stop: boolean
  readonly because: string | null
  readonly lease_until: string | null
}

export interface FinishAnswer {
  readonly ok: boolean
  readonly resumed?: boolean
  readonly state?: EngineRunState
  readonly error?: string
  readonly because?: string
}

/** Bridge configuration, from the host environment. */
export interface BridgeConfig {
  readonly gatewayUrl: string
  readonly bridgeToken: string
  readonly hermesUrl: string
  readonly hermesKey: string
  readonly officeToolPrefix: string
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isWhole = (v: unknown, digits: number): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && String(v).length <= digits
const HERMES_ID = /^run_[0-9a-f]{32}$/
const MODEL_SLUG = /^[a-z0-9][a-z0-9._/:-]{2,120}$/

/** Null when the request is acceptable, else the first problem in plain words. Mirrors app.engine_request_problem. */
export const requestProblem = (r: unknown): string | null => {
  if (!isObject(r)) return 'the request is not an object'
  for (const k of Object.keys(r))
    if (!['input', 'instructions', 'conversation_history', 'model'].includes(k))
      return `the request has a key it may not have: ${k.slice(0, 40)}`
  if (typeof r.input !== 'string' || r.input.trim().length === 0 || r.input.length > LIMITS.input)
    return 'input must be a non-empty string of at most 20,000 characters'
  if (typeof r.instructions !== 'string' || r.instructions.length > LIMITS.instructions)
    return 'instructions must be a string of at most 12,000 characters'
  if (!Array.isArray(r.conversation_history)) return 'conversation_history must be an array'
  let total = 0
  for (const turn of r.conversation_history as unknown[]) {
    const shape = 'every conversation turn is exactly {role: user or assistant, content: string}'
    if (!isObject(turn)) return shape
    if (
      Object.keys(turn).length !== 2 ||
      (turn.role !== 'user' && turn.role !== 'assistant') ||
      typeof turn.content !== 'string'
    )
      return shape
    total += turn.content.length
  }
  if (r.conversation_history.length > LIMITS.historyTurns)
    return 'conversation_history has more than 20 turns'
  if (total > LIMITS.historyChars) return 'conversation_history is longer than 24,000 characters'
  if ('model' in r && (typeof r.model !== 'string' || !MODEL_SLUG.test(r.model)))
    return 'model must be a model slug'
  return null
}

/** Null when the result is acceptable for this outcome. Mirrors app.engine_result_problem. */
export const resultProblem = (outcome: EngineOutcome, r: unknown): string | null => {
  if (!isObject(r)) return 'the result is not an object'
  const allowed = [
    'hermes_run_id',
    'answer',
    'model',
    'usage',
    'turn_exit_reason',
    'failure',
    'tools_started',
    'approvals_denied',
    'notes',
  ]
  for (const k of Object.keys(r))
    if (!allowed.includes(k)) return `the result has a key it may not have: ${k.slice(0, 40)}`
  if (!isWhole(r.tools_started, 6) || !isWhole(r.approvals_denied, 6))
    return 'tools_started and approvals_denied are required whole numbers'
  if ('answer' in r && (typeof r.answer !== 'string' || r.answer.length > LIMITS.answer))
    return 'answer must be a string of at most 16,000 characters'
  if (outcome === 'completed' && (typeof r.answer !== 'string' || r.answer.trim().length === 0))
    return 'a completed run needs a non-empty answer'
  if (outcome === 'failed' && (typeof r.failure !== 'string' || r.failure.trim().length === 0))
    return 'a failed run needs a failure sentence'
  if ('model' in r && (typeof r.model !== 'string' || r.model.length > 160))
    return 'model must be a short string'
  if (
    'hermes_run_id' in r &&
    r.hermes_run_id !== null &&
    (typeof r.hermes_run_id !== 'string' || !HERMES_ID.test(r.hermes_run_id))
  )
    return 'hermes_run_id is not a Hermes run id'
  if (
    'usage' in r &&
    (!isObject(r.usage) || !isWhole(r.usage.input_tokens, 9) || !isWhole(r.usage.output_tokens, 9))
  )
    return 'usage must be {input_tokens, output_tokens} as whole numbers'
  if (
    'turn_exit_reason' in r &&
    (typeof r.turn_exit_reason !== 'string' || r.turn_exit_reason.length > 80)
  )
    return 'turn_exit_reason must be a short string'
  if ('notes' in r) {
    if (!Array.isArray(r.notes)) return 'notes must be an array'
    if (
      r.notes.length > LIMITS.notes ||
      r.notes.some((n) => typeof n !== 'string' || n.length > 120)
    )
      return 'notes are at most five short strings'
  }
  return null
}

/** Whether Hermes may be chosen is a fact about the office; this only reads a stored command value, failing toward the team. */
export const engineOf = (value: unknown): EngineName => (value === 'hermes' ? 'hermes' : 'team')
