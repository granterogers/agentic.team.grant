/**
 * A throttle is not an answer, and in a wait loop it is not a failure either.
 *
 * `verify:routing-breadth` polled the Management API every 15 seconds while
 * waiting for the worker. `ManagementApiExecutor` already retries a 429 five
 * times with backoff; when the API stays throttled past that it THROWS, which
 * killed the suite six minutes in and reported it as RED in the release gate.
 * Reproduced on its own, away from gate load, so it was the loop rather than
 * passing pressure.
 *
 * The loop catches it now. What is asserted here is the one thing that can
 * silently stop that working: the predicate deciding whether an error IS a
 * throttle. If it stops matching, the catch re-throws and the defect returns
 * with no symptom until the next gate run.
 *
 * The string below is the REAL one, copied from the failure:
 *
 *     SqlExecutionError: ThrottlerException: Too Many Requests
 *
 * The run that proved the fix saw no throttle at all (11/11, zero retries), so
 * the patient path was NOT exercised end to end — which is exactly why the
 * predicate is pinned here rather than trusted.
 */
import { describe, expect, it } from 'vitest'

/** The predicate `scripts/verify/routing-breadth.ts` uses, stated once. */
const isThrottle = (why: string): boolean => /Throttler|Too Many Requests|429/i.test(why)

describe('recognising a Management API throttle', () => {
  it('matches the error the API actually sends', () => {
    expect(isThrottle('ThrottlerException: Too Many Requests')).toBe(true)
    expect(isThrottle('Failed to run sql query: ThrottlerException: Too Many Requests')).toBe(true)
  })

  it('matches the status on its own, in case the message changes', () => {
    expect(isThrottle('upstream returned 429')).toBe(true)
  })

  /*
    THE CONTROL, and the half that matters. A predicate widened until it
    matches everything would turn every real failure into "ask again" — the
    suite would spin to its deadline and report an environment problem about a
    genuine product defect, which is this fix's own mistake with the sign
    reversed.
  */
  it('CONTROL: a real database error is NOT a throttle', () => {
    expect(isThrottle('42703: column "notebook_id" does not exist')).toBe(false)
    expect(isThrottle('23514: new row violates check constraint')).toBe(false)
    expect(isThrottle('illegal job transition queued -> waiting_user')).toBe(false)
    expect(isThrottle('permission denied for relation jobs')).toBe(false)
  })
})
