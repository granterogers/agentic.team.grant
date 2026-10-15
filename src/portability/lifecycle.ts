/**
 * The archive lifecycle of a project, as rules only. Nothing here touches the database: the caller asks
 * `canMove` before it writes a state, so the rule is one definition and not a comment repeated in each caller.
 *
 *   active --> archiving --> archived --> restoring --> active
 *
 * `archiving` and `restoring` are the states a long operation holds while it runs, so a second press cannot start
 * the same work again. A failed operation returns to the state it left, never to a state it did not reach.
 */

export const LIFECYCLE_STATES = ['active', 'archiving', 'archived', 'restoring'] as const
export type LifecycleState = (typeof LIFECYCLE_STATES)[number]

const ALLOWED: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  active: ['archiving'],
  archiving: ['archived', 'active'],
  archived: ['restoring'],
  restoring: ['active', 'archived'],
}

export const canMove = (from: LifecycleState, to: LifecycleState): boolean =>
  ALLOWED[from].includes(to)

export const isLifecycleState = (value: unknown): value is LifecycleState =>
  typeof value === 'string' && (LIFECYCLE_STATES as readonly string[]).includes(value)

/** A project that is working for the person: the only state its everyday readers should treat as live. */
export const isLive = (state: LifecycleState): boolean => state === 'active'
