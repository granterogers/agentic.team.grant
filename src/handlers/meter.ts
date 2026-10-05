/**
 * Asking the meter before spending, and telling it afterwards.
 *
 * Grant, pasting Google's own notice: *"be good for the agents and stuff to
 * know not to just generate things constantly. And if it's possible for you to
 * actually query what the usage is left every time I make a request, that'd be
 * good. And especially if the quota's used up, you'd obviously have to schedule
 * one."*
 *
 * ## The first thing to say is that we cannot query it
 *
 * Google's counter lives behind Settings → Usage in their own interface. The
 * adapter library exposes `AccountLimits` — how many notebooks, how many
 * sources, which tier — and nothing whatsoever about compute. There is no RPC.
 * Any figure this system showed as "Google says" would be a figure this system
 * made up.
 *
 * So everything here is OUR ledger of OUR spending (0078), and every sentence
 * it produces says so. That is not a consolation prize: §11 already requires
 * exactly this discipline for the free inference tier, on the same reasoning —
 * a ceiling you cannot read is a ceiling you must not guess at.
 *
 * ## What happens when there is nothing left
 *
 * The work is scheduled, not refused. `jobs.not_before` (0074) already exists
 * for artifacts that take minutes; a window that turns over in ninety minutes
 * is the same mechanism with a longer number. Google's own answer to this is a
 * "Generate later" button, so only the automation is ours.
 */

import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * An SQL expression for the office a NotebookLM spend belongs to (migration 0802). The ledger, the allowance and the
 * refusals are the OFFICE's, so every call says whose. The only constructor is the claimed job: never an id taken
 * from a request, a payload field or a model answer.
 */
export type OfficeSql = string & { readonly __officeSql: true }
export const officeOfJob = (jobId: string): OfficeSql =>
  `app.job_office(${lit(jobId)}::uuid)` as OfficeSql

export interface Allowance {
  readonly allowed: boolean
  readonly windowSpent: number
  readonly windowCeiling: number
  readonly windowLeft: number
  readonly weekLeft: number
  readonly weekCeiling: number
  readonly operationCost: number | null
  /** When our own window frees up, or when Google said it would. */
  readonly resetsAt: Date | null
  /** False while the ceiling is still a guess rather than a measured refusal. */
  readonly measured: boolean
}

/** What the meter says about doing this now. */
export async function allowance(
  db: SqlExecutor,
  office: OfficeSql,
  operation: string,
): Promise<Allowance> {
  const { rows } = await db.execute(
    `select app.notebook_allowance(${office}, ${lit(operation)}) as a`,
  )
  const a = (rows[0] as { a: Record<string, unknown> }).a
  const blocked = a.blocked_until === null ? null : String(a.blocked_until)
  const resets = a.window_resets_at === null ? null : String(a.window_resets_at)
  const when = blocked ?? resets
  return {
    allowed: a.allowed === true,
    windowSpent: Number(a.window_spent ?? 0),
    windowCeiling: Number(a.window_ceiling ?? 0),
    windowLeft: Number(a.window_left ?? 0),
    weekLeft: Number(a.week_left ?? 0),
    weekCeiling: Number(a.week_ceiling ?? 0),
    operationCost: a.operation_cost === null ? null : Number(a.operation_cost),
    resetsAt: when === null ? null : new Date(when),
    measured: a.ceiling_is_measured === true,
  }
}

/**
 * One sentence a person can act on, hedged exactly as much as it deserves.
 *
 * "About" and "our own count" are load-bearing. A message that said "you have
 * 22 units left" would be read as Google's number within a week, and then a
 * refusal at 15 would read as our bug rather than as our estimate being wrong.
 */
export function describe(a: Allowance): string {
  const basis = a.measured
    ? 'our own count, with the ceiling measured from a refusal'
    : 'our own count — Google publishes no usage API, so this is an estimate'
  return (
    `About ${String(a.windowLeft)} of ${String(a.windowCeiling)} left in this five-hour ` +
    `window and ${String(a.weekLeft)} for the week (${basis}).`
  )
}

/** Charge the meter. Called after the operation, with what actually happened. */
export async function record(
  db: SqlExecutor,
  office: OfficeSql,
  operation: string,
  context: {
    readonly notebook?: string | null
    readonly projectId?: string | null
    readonly jobId?: string | null
    readonly succeeded?: boolean
  } = {},
): Promise<void> {
  await db.execute(`
    select app.notebook_record_spend(
      ${office}, ${lit(operation)},
      ${context.notebook === undefined || context.notebook === null ? 'null' : lit(context.notebook)},
      ${context.projectId === undefined || context.projectId === null ? 'null' : `${lit(context.projectId)}::uuid`},
      ${context.jobId === undefined || context.jobId === null ? 'null' : `${lit(context.jobId)}::uuid`},
      ${context.succeeded === false ? 'false' : 'true'}
    )
  `)
}

/**
 * Google said no. Write down what we had spent, because that is the only real
 * measurement of the ceiling we will ever get.
 */
export async function refused(
  db: SqlExecutor,
  office: OfficeSql,
  operation: string,
  detail: string,
  resetsAt?: Date | null,
): Promise<{ loweredTo: number | null }> {
  const { rows } = await db.execute(`
    select app.notebook_record_refusal(
      ${office}, ${lit(operation)}, ${lit(detail)},
      ${resetsAt === undefined || resetsAt === null ? 'null' : `${lit(resetsAt.toISOString())}::timestamptz`}
    ) as r
  `)
  const r = (rows[0] as { r: Record<string, unknown> }).r
  return {
    loweredTo: r.ceiling_lowered_to === null ? null : Number(r.ceiling_lowered_to),
  }
}

/**
 * How long to wait before trying again, in a form `not_before` understands.
 *
 * Padded by a minute past the reset. A job that wakes at the exact moment the
 * window turns over is a job that races Google's own clock, and losing that
 * race costs another whole window.
 */
export function deferUntil(a: Allowance): Date {
  const base = a.resetsAt ?? new Date(Date.now() + 60 * 60 * 1000)
  return new Date(base.getTime() + 60_000)
}
