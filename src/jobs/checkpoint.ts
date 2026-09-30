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
  /**
   * What this pause is waiting to have approved, as the step describes it.
   *
   * REQUIRED when the reason is `awaiting_approval`, and the database refuses
   * the pause without it. #263: *"Do not let the resumed worker regenerate a
   * materially different action after Grant approved the earlier one."*
   *
   * The step decides what is material, because only the step knows. A
   * timestamp inside a draft changes on every regeneration and means nothing;
   * the recipient means everything. Pass the parts that must not change —
   * `fingerprint()` turns them into the sha256 the pause stores.
   */
  readonly binds?: unknown
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
   * Somebody asked for this job to stop, and it stopped between steps.
   *
   * Deliberately NOT a pause and deliberately not a new job state. A pause
   * invites resumption and the person asked for the opposite; a new state
   * would need the transition table, the recovery loop and every reader to
   * learn a word for something the existing ones already express. The job
   * finishes normally, saying what it managed before it was stopped, and the
   * completed steps stay recorded so nothing is repeated if it is asked for
   * again.
   */
  | {
      readonly kind: 'stopped'
      readonly at: string
      readonly outcomes: Readonly<Record<string, Outcome>>
    }

/** What `app.step_begin` said about one step, as the caller has to act on it. */
export type StepGate =
  | { readonly kind: 'do' }
  | { readonly kind: 'skip'; readonly outcome: Outcome }
  | { readonly kind: 'paused'; readonly pause: Paused }

/**
 * Ask whether a step may run, and pause the job when it may not.
 *
 * The one implementation of the four answers (`do`, `skip`, `park`, `stale`): `runSteps` calls it for
 * every step, and a handler with ONE external effect it must not repeat calls it directly rather than
 * being rewritten as a list of steps. A step that acts outside the office and was interrupted answers
 * `paused`, never `do`.
 */
export async function beginStep(
  db: SqlExecutor,
  jobId: string,
  name: string,
  index: number,
  effect: Effect,
  codeVersion: string,
): Promise<StepGate> {
  const { rows } = await db.execute(
    `select app.step_begin(${lit(jobId)}::uuid, ${lit(name)}, ${String(index)},
                           ${lit(effect)}, ${String(CHECKPOINT_SCHEMA)},
                           ${lit(codeVersion)}) as r`,
  )
  const raw = rows[0]?.r
  const verdict = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
  if (typeof verdict.error === 'string') {
    throw new Error(`checkpointing "${name}" failed: ${verdict.error}`)
  }
  if (verdict.skip === true) {
    return { kind: 'skip', outcome: (verdict.outcome as Outcome | undefined) ?? {} }
  }
  if (verdict.park === true) {
    const pause: Paused = {
      detail: String(verdict.why ?? 'an interrupted external write'),
      reason: 'needs_reconciliation',
      resumable: false,
      resumeWhen:
        `Check whether "${name}" actually happened outside the office. ` +
        'If it did, mark the step finished; if it did not, clear it and I will run it again.',
    }
    await pauseJob(db, jobId, pause)
    return { kind: 'paused', pause }
  }
  if (verdict.stale === true) {
    const pause: Paused = {
      detail: String(verdict.why ?? 'the checkpoint was written by different code'),
      reason: 'checkpoint_stale',
      resumable: false,
      resumeWhen: 'A person decides whether the earlier steps still hold under the current code.',
    }
    await pauseJob(db, jobId, pause)
    return { kind: 'paused', pause }
  }
  return { kind: 'do' }
}

/**
 * Claim the ONE external effect a handler must not repeat, allowing for an attempt that failed CLEANLY.
 *
 * `job_steps` is written once, so a claim cannot be released. Two different ways to fail need two
 * different records: an attempt the remote system REFUSED (it knows nothing happened) is finished with
 * `failed: true` by `failedCleanly`, and the next attempt claims the next name (`base.retry1`); an
 * attempt that may or may not have reached the remote system is left open, and the next attempt to claim
 * that name parks. A step that finished with a result is `skip`.
 */
export async function claimExternal(
  db: SqlExecutor,
  jobId: string,
  base: string,
  codeVersion: string,
): Promise<{ readonly name: string; readonly gate: StepGate }> {
  for (let n = 0; n < 6; n += 1) {
    const name = n === 0 ? base : `${base}.retry${String(n)}`
    const gate = await beginStep(db, jobId, name, n, 'external', codeVersion)
    if (gate.kind === 'skip' && gate.outcome.failed === true) continue
    return { name, gate }
  }
  const pause: Paused = {
    detail: `${base} was refused six times in a row`,
    reason: 'needs_reconciliation',
    resumable: false,
    resumeWhen: 'A person looks at why the other side keeps refusing, and asks again.',
  }
  await pauseJob(db, jobId, pause)
  return { name: base, gate: { kind: 'paused', pause } }
}

/** The remote system refused this attempt, so nothing happened and the next attempt may go ahead. */
export async function failedCleanly(
  db: SqlExecutor,
  jobId: string,
  name: string,
  why: string,
): Promise<void> {
  await finishStep(db, jobId, name, { failed: true, why: why.slice(0, 200) })
}

/** Record that a step finished, and what it produced. */
export async function finishStep(
  db: SqlExecutor,
  jobId: string,
  name: string,
  outcome: Outcome,
  effectRef?: string,
): Promise<void> {
  await db.execute(
    `select app.step_done(${lit(jobId)}::uuid, ${lit(name)}, ${json(outcome)},
                          ${effectRef === undefined ? 'null' : lit(effectRef)})`,
  )
}

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
    /*
      Asked BEFORE each step rather than during one.

      The runtime doing the work is somewhere else and there is no connection
      to interrupt, so Stop is a fact in the database that this loop reads. A
      step already in flight finishes -- interrupting it is what the effect
      declarations exist to avoid.
    */
    if (await stopRequested(db, jobId)) {
      return { at: step.name, kind: 'stopped', outcomes }
    }
    const gate = await beginStep(db, jobId, step.name, index, step.effect ?? 'none', codeVersion)
    if (gate.kind === 'skip') {
      outcomes[step.name] = gate.outcome
      continue
    }
    if (gate.kind === 'paused') return { at: step.name, kind: 'paused', pause: gate.pause }

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
    await finishStep(db, jobId, step.name, result.outcome ?? {}, result.effectRef)
    outcomes[step.name] = result.outcome ?? {}
  }

  return { kind: 'done', outcomes }
}

/**
 * A stable sha256 of what a step is promising to do.
 *
 * Keys are sorted, so two objects that differ only in property order agree.
 * Deliberately NOT a deep normaliser: a step that wants an array ignored
 * should not pass it. Guessing which fields are material is how a check
 * either refuses every resume or waves through a changed recipient.
 */
export async function fingerprint(action: unknown): Promise<string> {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable)
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, stable(x)]),
      )
    }
    return v
  }
  const bytes = new TextEncoder().encode(JSON.stringify(stable(action)))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface BindingVerdict {
  readonly matched: boolean
  /** False means nothing was ever approved, which is a handler bug, not a change. */
  readonly approvedAnything: boolean
  readonly why: string
}

/**
 * Is the action this step is about to take the one that was approved?
 *
 * Called by a step AFTER a resume, before it acts. A mismatch is not an error
 * to throw: the job parks for a person, because an action that changed while
 * it was waiting needs looking at rather than sending.
 */
export async function approvalStillBinds(
  db: SqlExecutor,
  jobId: string,
  action: unknown,
): Promise<BindingVerdict> {
  const fp = await fingerprint(action)
  const { rows } = await db.execute(
    `select app.approval_binds(${lit(jobId)}::uuid, ${lit(fp)}) as r`,
  )
  const raw = rows[0]?.r
  const v = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
  return {
    approvedAnything: v.approved_anything === true,
    matched: v.matched === true,
    why: String(v.why ?? 'it matches what was approved'),
  }
}

/** Has somebody asked for this job to stop? */
export async function stopRequested(db: SqlExecutor, jobId: string): Promise<boolean> {
  const { rows } = await db.execute(`select app.stop_requested(${lit(jobId)}::uuid) as r`)
  return rows[0]?.r === true
}

/**
 * The credential a step needs, or a pause that says which one is missing.
 *
 * #263 lists `credential_required` among the reasons a job must be able to
 * wait for, and the distinction it draws is the useful one: a job that cannot
 * proceed because a secret is absent has not FAILED, it is waiting for a
 * person to supply something. Failing would burn attempts and land it in a
 * table Grant does not read; pausing puts it where he looks, naming the
 * secret.
 *
 * Returns the value when it is there, and a `Paused` when it is not, so a
 * step reads as `const got = await credential(...); if ('reason' in got)
 * return { pause: got }`.
 */
export async function credential(
  db: SqlExecutor,
  name: string,
  whatFor: string,
): Promise<{ value: string } | Paused> {
  const { rows } = await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = ${lit(name)}`,
  )
  const value = String((rows[0] as { v?: string } | undefined)?.v ?? '').trim()
  if (value !== '') return { value }
  return {
    detail: `${whatFor} needs ${name}, and the vault does not have it`,
    reason: 'credential_required',
    /*
      Resumable. A person adding the secret is exactly the condition, and the
      tick does not wake this reason — `resumable_now` lists only the four
      that wait on something other than a person — so it sits until the
      credential arrives and somebody resumes it.
    */
    resumable: true,
    resumeWhen: `Add ${name} in Settings, then resume this job and it will carry on from here.`,
  }
}

/** Ask for a job to stop. It ends after its current step. */
export async function requestStop(db: SqlExecutor, jobId: string, who: string): Promise<void> {
  await db.execute(`select app.request_stop(${lit(jobId)}::uuid, ${lit(who)})`)
}

/** Stop the job where it is, with a reason a person can act on. */
export async function pauseJob(db: SqlExecutor, jobId: string, pause: Paused): Promise<void> {
  const when = (d: Date | undefined): string =>
    d === undefined ? 'null' : `${lit(d.toISOString())}::timestamptz`
  const binds = pause.binds === undefined ? null : await fingerprint(pause.binds)
  await db.execute(
    `select app.pause_job(${lit(jobId)}::uuid, ${lit(pause.reason)}, ${lit(pause.detail)},
                          ${lit(pause.resumeWhen)}, ${String(pause.resumable ?? true)},
                          ${when(pause.until)}, ${when(pause.expiresAt)},
                          ${binds === null ? 'null' : lit(binds)})`,
  )
}
