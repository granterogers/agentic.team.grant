/**
 * What a write would do, before it does it (#131).
 *
 * ## The gap this closes
 *
 * Approvals gate WHETHER an action may happen. Nothing showed WHAT it would do.
 * An agent proposing to write six pages into Notion, or to change eleven
 * calendar events, asked a yes/no question about an action Grant could not see.
 *
 * **Approving something you cannot see is not an approval. It is consent to a
 * category.**
 *
 * ## The rule that makes a dry run trustworthy
 *
 * #131 states it and it is the whole reason this file exists rather than a
 * `dryRun` boolean on each handler:
 *
 *   > The plan must be produced by the same code path that performs the action,
 *   > differing only at the final call. A dry run implemented as a second
 *   > description of what would happen is a second thing to keep in sync, and
 *   > the day it drifts is the day Grant approves one thing and gets another.
 *
 * So the shape here is not "ask the handler to describe itself". It is: the
 * handler **computes a plan**, and performing the work means **carrying that
 * plan out**. A dry run is the first half without the second. There is no
 * second description to drift, because there is no second description.
 *
 * `app.calendar_task_plan()` was already the good version of this — one query
 * decides what to create, update and remove, and the executor only carries it
 * out — and this generalises it.
 *
 * ## What a step is, and what it is not
 *
 * A step is one outward effect: one page created, one event changed, one source
 * added. It is deliberately NOT one HTTP call — a create that costs a POST and
 * three block appends is one step, because one page appearing is what a person
 * is approving. `writes` records the calls, so a check can hold the two against
 * each other without conflating them.
 *
 * ## What it also gives
 *
 * - **Testing destructive paths without being destructive**, at runtime rather
 *   than only inside a `begin … rollback`.
 * - **A say-back that cannot drop a step** (#60), because the step is in the
 *   plan rather than in a sentence somebody wrote separately.
 */

/** One outward effect. Not one HTTP call — see above. */
export interface PlanStep {
  readonly verb: 'create' | 'update' | 'remove' | 'send'
  /** The thing, as a person would name it. "Module 3 — Handling objections". */
  readonly what: string
  /** Where it lands. "Notion · Coaching Course", "Google Calendar". */
  readonly where: string
  /**
   * How many HTTP calls carrying it out is expected to cost.
   *
   * Not decoration: it is what lets a check hold the plan against the actual
   * traffic. A step that says one call and makes four is a plan that is not
   * describing the work.
   */
  readonly writes: number
}

export interface Plan {
  /** The `tool_permissions` row this needs. 'notion.write', 'calendar.write'. */
  readonly tool: string
  /** Services it reaches outside the office. Empty for a plan that does nothing. */
  readonly reaches: readonly string[]
  readonly steps: readonly PlanStep[]
  /**
   * Why there is nothing to do, when there is nothing to do.
   *
   * An empty plan with no note reads as "we did not work it out"; an empty plan
   * with one reads as "we worked it out and the answer is nothing". The second
   * is the useful answer sixteen times a day for the calendar duty.
   */
  readonly note?: string
}

/** A plan that would do nothing, and says why. */
export const nothingToDo = (tool: string, why: string): Plan => ({
  tool,
  reaches: [],
  steps: [],
  note: why,
})

/** How many HTTP writes carrying this plan out should cost, in total. */
export const plannedWrites = (plan: Plan): number =>
  plan.steps.reduce((total, step) => total + step.writes, 0)

/**
 * The plan in a sentence.
 *
 * Counted by verb rather than listed, because an approval that scrolls is an
 * approval nobody reads — and the counts are the part that makes somebody stop.
 * *"6 to add"* is the difference between a yes and a second look.
 */
export function summarise(plan: Plan): string {
  if (plan.steps.length === 0) return plan.note ?? 'nothing to do'
  const count = (verb: PlanStep['verb']): number => plan.steps.filter((s) => s.verb === verb).length
  const parts: string[] = []
  const say = (n: number, word: string): void => {
    if (n > 0) parts.push(`${String(n)} to ${word}`)
  }
  say(count('create'), 'add')
  say(count('update'), 'change')
  say(count('remove'), 'take away')
  say(count('send'), 'send')
  const where = [...new Set(plan.steps.map((s) => s.where))]
  const place = where.length === 1 ? ` in ${where[0] ?? ''}` : ''
  return `${parts.join(', ')}${place}`
}

/**
 * The plan in full, for an approval request.
 *
 * Every step named, capped, because an approval carrying two hundred lines is
 * one nobody reads to the end — and the cap says how many it is hiding rather
 * than trailing off, so the number is never smaller than the truth.
 */
export function detail(plan: Plan, most = 12): string {
  if (plan.steps.length === 0) return plan.note ?? 'Nothing to do.'
  const shown = plan.steps.slice(0, most)
  const lines = shown.map((s) => `· ${s.verb} ${s.what} → ${s.where}`)
  const hidden = plan.steps.length - shown.length
  if (hidden > 0) lines.push(`· …and ${String(hidden)} more`)
  return lines.join('\n')
}

/**
 * A handler that works out what it would do before doing it.
 *
 * Optional on `Handler`, because most handlers only read and a plan for a read
 * is noise. What makes it honest is the pairing: a handler that implements
 * `plan` performs the work by carrying THAT plan out.
 */
export interface Planned {
  /**
   * What this job would change outside the office. Must make no outward write
   * of its own — a dry run that writes anything is not a dry run, and
   * `verify:dryrun` fails a handler whose planning phase touches the network.
   */
  plan(job: { readonly jobId: string; readonly payload: unknown }): Promise<Plan>
}
