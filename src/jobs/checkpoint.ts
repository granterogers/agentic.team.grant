/**
 * Running a job as steps that survive being interrupted (#263).
 *
 * The office already has durable jobs, enforced transitions, leasing, recovery
 * and retries. What it did not have is a way for a job that finished steps one
 * to seven of ten to carry on at step eight — a retry means DO THE JOB AGAIN,
 * which for a job that spent a model call and wrote a file is both expensive
 * and unsafe.
 *
 * 0436 is the storage. This is the thing a handler actually calls, and it is
 * deliberately small: a handler declares its steps and this decides, for each
 * one, whether to run it, skip it or stop.
 *
 * ## The four answers, and why parking is one of them
 *
 * `app.step_begin` returns exactly one of: **do** (nothing recorded, or an
 * earlier attempt that is safe to repeat), **skip** (already finished, here is
 * what it produced), **park** (it started, it never finished, and it acts
 * outside the office so nobody here can tell whether it committed) or
 * **stale** (a different version of the code wrote that checkpoint).
 *
 * Park is the one that matters and it is the Issue's own instruction: *"Where
 * an external system cannot prove whether an interrupted write committed, the
 * job should park for reconciliation rather than guess."* §7 already says the
 * same thing about ambiguous notebook writes; this generalises it.
 *
 * ## Declaring the effect kind is the whole safety property
 *
 * A step says what it is about to do BEFORE it does it, and that declaration
 * is what a later attempt reads. Getting it wrong in the permissive direction
 * — calling an external write `local` — means a resume repeats it, so the
 * default is `none` and a handler has to say otherwise deliberately.
 *
 * ## Nothing here is a workflow engine
 *
 * No graph, no conditions, no retries of its own. A handler runs its steps in
 * order in ordinary TypeScript and this records what happened. The Issue
 * forbids a second engine and the smallest thing that satisfies it is a loop.
 */

import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const json = (v: unknown): string => lit(JSON.stringify(v ?? {}))

/**
 * The shape of the checkpoints this code understands.
 *
 * Bumped when the MEANING of a step's `outcome` changes, never for a new step
 * or a reworded name. A resume under a different number does not skip and does
 * not redo: it parks, because "the code changed" is exactly when continuing
 * quietly is worst.
 */
export const CHECKPOINT_SCHEMA = 1

/** What a step is about to do outside the office. */
export type Effect = 'none' | 'local' | 'external'

export interface Paused {
  readonly reason: string
  readonly detail: string
  readonly resumeWhen: string
  readonly resumable?: boolean
  /** Do not try again before this. */
  readonly until?: Date
  /** After this, waiting is not worth it. */
  readonly expiresAt?: Date
}

/** What a step hands to the steps after it. Operational state, never prose. */
export type Outcome = Record<string, unknown>

export interface StepResult {
  /** What the next steps may read. Kept small: this is stored and inspectable. */
  readonly outcome?: Outcome
  /** What it did outside the office, if anything. */
  readonly effectRef?: string
  /** Set to stop the job here rather than continue. */
  readonly pause?: Paused
}

export interface Step {
  readonly name: string
  readonly effect?: Effect
  readonly run: (done: Readonly<Record<string, Outcome>>) => Promise<StepResult> | StepResult
}

export type RunEnd =
  | { readonly kind: 'done'; readonly outcomes: Readonly<Record<string, Outcome>> }
  | { readonly kind: 'paused'; readonly at: string; readonly pause: Paused }

/**
 * Run the steps, skipping what is already recorded.
 *
 * Returns rather than throws on a pause, because pausing is an outcome and not
 * a failure — a handler that treated it as one would burn an attempt and
 * eventually exhaust `max_attempts` on a job that is waiting for a person.
 */
export async function runSteps(
  db: SqlExecutor,
  jobId: string,
  codeVersion: string,
  steps: readonly Step[],
): Promise<RunEnd> {
  const outcomes: Record<string, Outcome> = {}

  for (const [index, step] of steps.entries()) {
    const effect: Effect = step.effect ?? 'none'
    const { rows } = await db.execute(
      `select app.step_begin(${lit(jobId)}::uuid, ${lit(step.name)}, ${String(index)},
                             ${lit(effect)}, ${String(CHECKPOINT_SCHEMA)},
                             ${lit(codeVersion)}) as r`,
    )
    const raw = rows[0]?.r
    const verdict = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>

    if (typeof verdict.error === 'string') {
      throw new Error(`checkpointing "${step.name}" failed: ${verdict.error}`)
    }
    if (verdict.skip === true) {
      outcomes[step.name] = (verdict.outcome as Outcome | undefined) ?? {}
      continue
    }
    if (verdict.park === true) {
      const pause: Paused = {
        detail: String(verdict.why ?? 'an interrupted external write'),
        reason: 'needs_reconciliation',
        resumable: false,
        resumeWhen:
          `Check whether "${step.name}" actually happened outside the office. ` +
          'If it did, mark the step finished; if it did not, clear it and I will run it again.',
      }
      await pauseJob(db, jobId, pause)
      return { at: step.name, kind: 'paused', pause }
    }
    if (verdict.stale === true) {
      const pause: Paused = {
        detail: String(verdict.why ?? 'the checkpoint was written by different code'),
        reason: 'checkpoint_stale',
        resumable: false,
        resumeWhen: 'A person decides whether the earlier steps still hold under the current code.',
      }
      await pauseJob(db, jobId, pause)
      return { at: step.name, kind: 'paused', pause }
    }

    const result = await step.run(outcomes)
    if (result.pause !== undefined) {
      /*
        Paused BEFORE the step is marked finished, deliberately.

        A step that decided to wait has not done its work, and recording it as
        done would make the resume skip the very thing it is waiting for.
      */
      await pauseJob(db, jobId, result.pause)
      return { at: step.name, kind: 'paused', pause: result.pause }
    }
    await db.execute(
      `select app.step_done(${lit(jobId)}::uuid, ${lit(step.name)},
                            ${json(result.outcome ?? {})},
                            ${result.effectRef === undefined ? 'null' : lit(result.effectRef)})`,
    )
    outcomes[step.name] = result.outcome ?? {}
  }

  return { kind: 'done', outcomes }
}

/** Stop the job where it is, with a reason a person can act on. */
export async function pauseJob(db: SqlExecutor, jobId: string, pause: Paused): Promise<void> {
  const when = (d: Date | undefined): string =>
    d === undefined ? 'null' : `${lit(d.toISOString())}::timestamptz`
  await db.execute(
    `select app.pause_job(${lit(jobId)}::uuid, ${lit(pause.reason)}, ${lit(pause.detail)},
                          ${lit(pause.resumeWhen)}, ${String(pause.resumable ?? true)},
                          ${when(pause.until)}, ${when(pause.expiresAt)})`,
  )
}
