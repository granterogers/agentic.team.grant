/**
 * The job state machine.
 *
 * Master spec §6 is authoritative and lists **fourteen** states.
 * `docs/design/core-invariants.md` §4 and `docs/implementation-plan.md` both
 * describe nine. The spec wins (ADR-0008), and the extra five are not padding:
 *
 * - `waiting_external` / `waiting_user` distinguish "blocked on a provider" from
 *   "blocked on Grant". §12 requires a structured blocker object for the second
 *   and not the first, and §6 requires long-running work to say which it is
 *   rather than looking stuck.
 * - `committing` and `notifying` exist so that §18's "crash after commit but
 *   before notification" is a *distinguishable* state rather than a guess. Nine
 *   states cannot express it, which is exactly the failure the degradation test
 *   is designed to catch.
 * - `paused` and `cancelled` are first-class per §6: "stop that", "pause it"
 *   and "cancel the research" must work.
 */

export const JOB_STATES = [
  'queued',
  'running',
  'waiting_external',
  'waiting_user',
  'output_created',
  'quality_review',
  'committing',
  'committed',
  'notifying',
  'complete',
  'retrying',
  'paused',
  'cancelled',
  'failed',
] as const

export type JobState = (typeof JOB_STATES)[number]

/**
 * States from which no transition is legal. A job here is finished forever;
 * further work needs a new job with a new idempotency key.
 */
export const TERMINAL_STATES = ['complete', 'cancelled', 'failed'] as const satisfies readonly JobState[]
export type TerminalState = (typeof TERMINAL_STATES)[number]

/**
 * States that imply a worker is actively holding the job. Finding one of these
 * at boot means a worker died mid-flight, because nothing else can leave a job
 * here — so the recovery sweep (§6) must reconcile every one.
 */
export const TRANSIENT_STATES = [
  'running',
  'output_created',
  'quality_review',
  'committing',
  'notifying',
] as const satisfies readonly JobState[]
export type TransientState = (typeof TRANSIENT_STATES)[number]

/**
 * States in which the job is deliberately not progressing and no worker holds
 * it. These are stable — the recovery sweep must leave them alone, or a paused
 * job would silently resume on every restart.
 */
export const DORMANT_STATES = [
  'queued',
  'waiting_external',
  'waiting_user',
  'retrying',
  'paused',
] as const satisfies readonly JobState[]

/**
 * Legal transitions, as an explicit adjacency map. §6 requires transitions to
 * be "constrained and logged"; an allow-list is the only version of that which
 * a test can prove.
 *
 * Read a row as: from this state, a job may move to exactly these.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  // Dequeue, or abandon before starting.
  queued: ['running', 'cancelled', 'paused', 'failed'],

  // The main working state. It may block, produce output, or die.
  running: [
    'waiting_external',
    'waiting_user',
    'output_created',
    'retrying',
    'paused',
    'cancelled',
    'failed',
  ],

  // Blocked states return to running, or are given up on.
  waiting_external: ['running', 'retrying', 'paused', 'cancelled', 'failed'],
  waiting_user: ['running', 'paused', 'cancelled', 'failed'],

  // An output exists and must be reviewed. §10: the gate cannot be skipped, so
  // there is deliberately no edge from output_created to committing.
  output_created: ['quality_review', 'retrying', 'paused', 'cancelled', 'failed'],

  // Review may reject, sending work back rather than committing it.
  quality_review: ['committing', 'running', 'retrying', 'paused', 'cancelled', 'failed'],

  // The transactional boundary. Cancellation is not offered here: the commit is
  // either durable or it is not, and a cancel racing it would make "committed"
  // unreliable — which is the one thing recovery reads.
  committing: ['committed', 'retrying', 'failed'],

  // Committed work is never cancelled — it happened. Only delivery remains.
  committed: ['notifying', 'failed'],

  // Delivery failed is still committed work; retry delivery, never the job.
  notifying: ['complete', 'retrying', 'failed'],

  // Retry re-enters the queue rather than jumping straight back to running, so
  // capacity limits are re-applied at dequeue (§6) instead of being bypassed.
  retrying: ['queued', 'cancelled', 'failed', 'paused'],

  // Resume returns to the queue for the same reason.
  paused: ['queued', 'cancelled', 'failed'],

  // Terminal.
  complete: [],
  cancelled: [],
  failed: [],
}

export function isTerminal(state: JobState): state is TerminalState {
  return (TERMINAL_STATES as readonly JobState[]).includes(state)
}

export function isTransient(state: JobState): state is TransientState {
  return (TRANSIENT_STATES as readonly JobState[]).includes(state)
}

export function canTransition(from: JobState, to: JobState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/** Thrown instead of returning false, so an illegal transition cannot be ignored. */
export class IllegalTransitionError extends Error {
  constructor(
    readonly from: JobState,
    readonly to: JobState,
  ) {
    super(
      `illegal job transition ${from} -> ${to}. Allowed from ${from}: ` +
        (ALLOWED_TRANSITIONS[from].join(', ') || '(none — terminal)'),
    )
    this.name = 'IllegalTransitionError'
  }
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to)
}
