/**
 * The Gate 5 disposition table.
 *
 * Gate 5 names eight cases. Six of them are failures whose *consequence* is the
 * thing being tested: whether the work queues or Grant gets paged. These tests
 * are that table, because the spec's acceptance sentence is a claim about
 * behaviour, and a claim about behaviour has to be executable to be evidence.
 */
import { describe, expect, it } from 'vitest'
import { classifyFailure, decide, type JobContext } from '../../src/inference/policy.ts'
import { PaidCallPreventedError } from '../../src/providers/guards.ts'
import {
  EmptyCompletionError,
  NoUsableModelError,
  ProviderUnavailableError,
} from '../../src/providers/router.ts'

const URGENT_MAX = 20

const job = (over: Partial<JobContext> = {}): JobContext => ({
  jobId: '11111111-1111-1111-1111-111111111111',
  correlationId: '22222222-2222-2222-2222-222222222222',
  priority: 100,
  attempt: 0,
  maxAttempts: 5,
  kind: 'research.summarise',
  ...over,
})

describe('classifyFailure', () => {
  it('calls a refused paid call systemic, because a retry meets the same guard', () => {
    const c = classifyFailure(new PaidCallPreventedError('openai/gpt-4o', 'not free'))
    expect(c.nature).toBe('systemic')
    expect(c.outcome).toBe('refused_paid')
  })

  it('calls an empty allow-list systemic', () => {
    expect(classifyFailure(new NoUsableModelError()).nature).toBe('systemic')
  })

  it('calls an open circuit breaker transient', () => {
    const c = classifyFailure(new ProviderUnavailableError('openrouter'))
    expect(c.nature).toBe('transient')
    expect(c.outcome).toBe('unavailable')
  })

  it('calls an empty completion transient — the call worked, the budget was wrong', () => {
    const c = classifyFailure(new EmptyCompletionError('m', 'length', 512))
    expect(c.nature).toBe('transient')
    expect(c.outcome).toBe('empty_completion')
  })

  it('recognises a 429 by its code, not by provider wording', () => {
    expect(classifyFailure(new Error('provider openrouter refused: 429 ')).outcome).toBe(
      'rate_limited',
    )
    expect(classifyFailure(new Error('Rate limit exceeded')).outcome).toBe('rate_limited')
  })

  it('calls unparseable JSON malformed rather than a transport failure', () => {
    expect(classifyFailure(new SyntaxError('Unexpected token < in JSON')).outcome).toBe(
      'malformed_response',
    )
  })

  it('defaults an unrecognised error to transient', () => {
    // The default direction matters: an unknown provider hiccup must not page
    // Grant, because §12 reserves his attention for work that is truly blocked.
    const c = classifyFailure(new Error('socket hang up'))
    expect(c.nature).toBe('transient')
    expect(c.outcome).toBe('transport_error')
  })

  it('never puts a secret-shaped string in the summary it stores', () => {
    const c = classifyFailure(new Error('failed with Bearer sk-abc123def456'))
    expect(c.summary).not.toContain('sk-abc123def456')
  })
})

describe('decide — the Gate 5 acceptance table', () => {
  it('queues non-urgent work on a transient failure (retry while budget remains)', () => {
    const d = decide(classifyFailure(new ProviderUnavailableError('openrouter')), job(), URGENT_MAX)
    expect(d.action).toBe('retry')
  })

  it('still does not page Grant once a non-urgent job exhausts its retries', () => {
    const d = decide(
      classifyFailure(new ProviderUnavailableError('openrouter')),
      job({ attempt: 5, maxAttempts: 5 }),
      URGENT_MAX,
    )
    expect(d.action).toBe('queue')
  })

  it('raises a blocker when urgent work is blocked by a transient failure', () => {
    const d = decide(
      classifyFailure(new ProviderUnavailableError('openrouter')),
      job({ priority: 5 }),
      URGENT_MAX,
    )
    expect(d.action).toBe('blocker')
    if (d.action !== 'blocker') throw new Error('unreachable')
    // Other work is genuinely unaffected by one urgent job waiting, and saying
    // so is what stops the blocker reading as a system-wide alarm.
    expect(d.blocker.workCanContinue).toBe(true)
  })

  it('raises a blocker for a systemic failure even when the job is not urgent', () => {
    // The important asymmetry. A systemic refusal never becomes correct by
    // waiting, so it must not sit in `retrying` draining its budget.
    const d = decide(
      classifyFailure(new PaidCallPreventedError('openai/gpt-4o', 'not free')),
      job({ priority: 900 }),
      URGENT_MAX,
    )
    expect(d.action).toBe('blocker')
    if (d.action !== 'blocker') throw new Error('unreachable')
    expect(d.blocker.workCanContinue).toBe(false)
  })

  it('treats the urgency boundary as inclusive, and reads it from its argument', () => {
    const atBoundary = decide(
      classifyFailure(new ProviderUnavailableError('openrouter')),
      job({ priority: 20 }),
      URGENT_MAX,
    )
    const justOutside = decide(
      classifyFailure(new ProviderUnavailableError('openrouter')),
      job({ priority: 21 }),
      URGENT_MAX,
    )
    expect(atBoundary.action).toBe('blocker')
    expect(justOutside.action).toBe('retry')

    // And the boundary is not baked in: a different configuration moves it.
    expect(
      decide(classifyFailure(new ProviderUnavailableError('openrouter')), job({ priority: 21 }), 50)
        .action,
    ).toBe('blocker')
  })

  it('gives every blocker all the fields §12 requires, with none left blank', () => {
    const d = decide(classifyFailure(new NoUsableModelError()), job({ priority: 3 }), URGENT_MAX)
    if (d.action !== 'blocker') throw new Error('expected a blocker')
    const b = d.blocker
    // The database rejects a short field; catching it here names which one.
    expect(b.requestedAction.length).toBeGreaterThan(3)
    expect(b.whyNeeded.length).toBeGreaterThan(3)
    expect(b.consequencesOfDelay.length).toBeGreaterThan(3)
    expect(b.approvalOptions.length).toBeGreaterThanOrEqual(1)
    expect(b.originatingAgent).not.toBe('')
    expect(typeof b.workCanContinue).toBe('boolean')
  })
})
