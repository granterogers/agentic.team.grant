/*
  M1 - the model router's per-request deadline and its four-model chain, driven with deterministic fakes and a fake
  clock. Nothing here touches a network; a hung provider is a promise that never settles, so every test that waits for
  one asserts on a FLAG after advancing the fake clock, never on the promise itself. A test whose subject can hang
  must not be able to hang the suite (a deliberately removed deadline turns these red rather than stuck).
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { classifyFailure } from '../../src/inference/policy.ts'
import {
  AllCandidatesFailedError,
  DEFAULT_CHAIN_BUDGET_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  ProviderRouter,
  ProviderTimeoutError,
} from '../../src/providers/router.ts'

class Db implements SqlExecutor {
  readonly kind = 'fake'
  readonly statements: string[] = []
  constructor(private readonly models: Record<string, unknown>[]) {}
  async execute(sql: string): Promise<SqlResult> {
    this.statements.push(sql)
    if (sql.includes('app.model_order(')) return { rows: this.models }
    if (sql.includes('provider_available')) return { rows: [{ ok: true }] }
    return { rows: [] }
  }
  /** Every inference_usage row written, as its outcome. */
  usage(): string[] {
    return this.statements
      .filter((s) => s.includes('insert into public.inference_usage'))
      .map((s) => /'(ok|empty_completion|provider_error|rate_limited|transport_error|malformed_response|refused_paid|unavailable)',/.exec(s)?.[1] ?? '?')
  }
  usageSql(): string[] {
    return this.statements.filter((s) => s.includes('insert into public.inference_usage'))
  }
  count(fragment: string): number {
    return this.statements.filter((s) => s.includes(fragment)).length
  }
}

const CHAIN = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.7-flash',
  'mistralai/mistral-small-3.2-24b-instruct',
  'some/free-tier:free',
]
const row = (id: string): Record<string, unknown> => ({
  provider: 'openrouter',
  model_id: id,
  pricing_prompt: '0',
  pricing_completion: '0',
  base_url: 'https://openrouter.ai/api/v1',
  free_only: true,
  secret_ref: null,
  standing: 'unproven',
  why: 'm1',
})
const MESSAGES = [{ role: 'user', content: 'hi' }] as const
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })
const good = (model: string): Response =>
  json({
    model,
    choices: [{ message: { content: `answer from ${model}` } }],
    usage: { cost: 0, prompt_tokens: 3, completion_tokens: 2 },
  })
const modelOf = (init: { body: string }): string =>
  String((JSON.parse(init.body) as { model: string }).model)

type Step = (model: string, signal: AbortSignal) => Promise<Response>
/** A fetch whose behaviour per call number is scripted; records the model asked and the signal it was given. */
const scripted = (steps: readonly Step[]) => {
  const asked: string[] = []
  const signals: AbortSignal[] = []
  const impl = vi.fn(async (_u: string, init: { body: string; signal: AbortSignal }) => {
    const m = modelOf(init)
    asked.push(m)
    signals.push(init.signal)
    const step = steps[Math.min(asked.length - 1, steps.length - 1)] as Step
    return step(m, init.signal)
  }) as unknown as typeof fetch
  return { impl, asked, signals }
}

// The three step shapes the scenarios are built from.
const answers: Step = async (m) => good(m)
const hangs: Step = () => new Promise<Response>(() => undefined) // ignores its signal on purpose
const slowThen =
  (ms: number, make: (m: string) => Response): Step =>
  (m) =>
    new Promise<Response>((resolve) => setTimeout(() => resolve(make(m)), ms))

const T = 1000 // the per-request deadline used by most scenarios
const router = (db: Db, impl: typeof fetch, options = {}): ProviderRouter =>
  new ProviderRouter(db, 'k', impl, DEFAULT_MAX_ATTEMPTS, { requestTimeoutMs: T, ...options })

/** Start a call and report whether it has settled, so a hang can be asserted without being awaited. */
const start = (r: ProviderRouter) => {
  const state: { done: boolean; ok?: Awaited<ReturnType<ProviderRouter['complete']>>; err?: Error } =
    { done: false }
  const raw = r.complete({ messages: MESSAGES }).then(
    (v) => {
      state.done = true
      state.ok = v
    },
    (e: Error) => {
      state.done = true
      state.err = e
    },
  )
  // Awaiting `p` asserts the call settled; it never waits for a call that cannot (see `done`).
  const p: PromiseLike<void> = { then: (a, b) => done(raw).then(a, b) }
  return { state, p }
}

/**
 * Assert that a started call has settled, WITHOUT waiting for it. Called after the fake clock was advanced past every
 * deadline: a router with no deadline leaves the promise pending for ever, and awaiting it would hang the suite
 * instead of failing it. Only microtasks are flushed; the clock is not touched.
 */
const done = async (p: Promise<unknown>): Promise<void> => {
  let settled = false
  void p.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  for (let i = 0; i < 50; i += 1) await Promise.resolve()
  if (!settled) throw new Error('HUNG: the call had not settled after the fake clock passed every deadline')
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the arithmetic is the documented one', () => {
  it('a chain of pure timeouts fits under the 150s edge wall clock and the 300s lease', () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(4)
    expect(DEFAULT_REQUEST_TIMEOUT_MS * DEFAULT_MAX_ATTEMPTS).toBeLessThanOrEqual(DEFAULT_CHAIN_BUDGET_MS)
    expect(DEFAULT_CHAIN_BUDGET_MS).toBeLessThan(150_000)
  })
})

describe('the provider outcomes, one at a time', () => {
  it('success: one row, ok, no failure recorded', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl, asked } = scripted([answers])
    const result = await router(db, impl).complete({ messages: MESSAGES })
    expect(result.model).toBe(CHAIN[0])
    expect(asked).toEqual([CHAIN[0]])
    expect(db.usage()).toEqual(['ok'])
    expect(db.count('record_provider_failure')).toBe(0)
  })

  it('429 (body error) moves on and is recorded rate_limited', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl } = scripted([async () => json({ error: { code: 429, message: 'slow down' } }), answers])
    const result = await router(db, impl).complete({ messages: MESSAGES })
    expect(result.model).toBe(CHAIN[1])
    expect(db.usage()).toEqual(['rate_limited', 'ok'])
  })

  it('HTTP 429 with no error object is a rate limit too', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl } = scripted([async () => json({ message: 'too many' }, 429), answers])
    await router(db, impl).complete({ messages: MESSAGES })
    expect(db.usage()).toEqual(['rate_limited', 'ok'])
  })

  it('HTTP 500 with a bare body is a provider failure, NOT an empty completion recorded as a success', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl } = scripted([async () => json({ detail: 'upstream exploded' }, 500), answers])
    const result = await router(db, impl).complete({ messages: MESSAGES })
    expect(result.model).toBe(CHAIN[1])
    expect(db.usage()).toEqual(['provider_error', 'ok'])
    expect(db.count('record_provider_failure')).toBe(1)
    // exactly one success: the second model's. The 500 must not have told the breaker "provider is fine".
    expect(db.count('record_provider_success')).toBe(1)
  })

  it('a network error moves on and the failed call is accounted (it was a real call)', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl } = scripted([
      async () => {
        throw new TypeError('fetch failed')
      },
      answers,
    ])
    const result = await router(db, impl).complete({ messages: MESSAGES })
    expect(result.model).toBe(CHAIN[1])
    expect(db.usage()).toEqual(['transport_error', 'ok'])
    expect(db.count('record_provider_failure')).toBe(1)
  })

  it('a malformed body (not JSON, or JSON that is not an object) moves on as malformed_response', async () => {
    for (const bad of ['<html>502</html>', 'null', '[1,2]']) {
      const db = new Db(CHAIN.map(row))
      const { impl } = scripted([async () => new Response(bad, { status: 200 }), answers])
      const result = await router(db, impl).complete({ messages: MESSAGES })
      expect(result.model, bad).toBe(CHAIN[1])
      expect(db.usage(), bad).toEqual(['malformed_response', 'ok'])
    }
  })
})

describe('a hung provider releases control to the next model', () => {
  it('a connection that never answers is abandoned at the deadline and the second model answers', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl, asked, signals } = scripted([hangs, answers])
    const { state, p } = start(router(db, impl))

    await vi.advanceTimersByTimeAsync(T - 1)
    expect(state.done, 'must still be waiting just before the deadline').toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    await p
    // The flag, not the promise, is what a sabotaged router fails on: see the sabotage note in the report.
    expect(state.done).toBe(true)
    expect(state.ok?.model).toBe(CHAIN[1])
    expect(asked).toEqual([CHAIN[0], CHAIN[1]])
    expect(signals[0]?.aborted, 'the abandoned request was told to drop the socket').toBe(true)
    expect(signals[1]?.aborted).toBe(false)
    // one row for the abandoned call, one for the answer: no double count
    expect(db.usage()).toEqual(['transport_error', 'ok'])
  })

  it('the abandoned call is recorded with an UNKNOWN cost and no invented tokens', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl } = scripted([hangs, answers])
    const { p } = start(router(db, impl))
    await vi.advanceTimersByTimeAsync(T + 1)
    await p
    const aborted = db.usageSql()[0] ?? ''
    // provider_reported_cost is NULL (not 0), provenance estimated, zero tokens
    expect(aborted).toMatch(/null,\s*'estimated'/)
    expect(aborted).toMatch(/0, 0,/)
  })

  it('headers that arrive and a body that stalls is hung too (the deadline covers the body read)', async () => {
    const db = new Db(CHAIN.map(row))
    const stalledBody: Step = async () =>
      ({
        status: 200,
        json: () => new Promise(() => undefined),
      }) as unknown as Response
    const { impl } = scripted([stalledBody, answers])
    const { state, p } = start(router(db, impl))
    await vi.advanceTimersByTimeAsync(T + 1)
    await p
    expect(state.ok?.model).toBe(CHAIN[1])
    expect(db.usage()).toEqual(['transport_error', 'ok'])
  })

  it('a slow answer just BELOW the deadline succeeds and is counted once', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl, asked } = scripted([slowThen(T - 1, good), answers])
    const { state, p } = start(router(db, impl))
    await vi.advanceTimersByTimeAsync(T - 1)
    await p
    expect(state.ok?.model).toBe(CHAIN[0])
    expect(asked).toEqual([CHAIN[0]])
    expect(db.usage()).toEqual(['ok'])
    expect(db.count('record_provider_failure')).toBe(0)
  })

  it('a slow answer beyond the deadline is DISCARDED: the late response is never applied or recorded', async () => {
    const db = new Db(CHAIN.map(row))
    // The first model answers (validly!) 500ms after being abandoned.
    const { impl, asked } = scripted([slowThen(T + 500, good), answers])
    const { state, p } = start(router(db, impl))
    await vi.advanceTimersByTimeAsync(T + 1)
    await p
    expect(state.ok?.model).toBe(CHAIN[1])
    // let the late response arrive and be ignored
    await vi.advanceTimersByTimeAsync(2000)
    expect(state.ok?.content).toBe(`answer from ${CHAIN[1]}`)
    expect(asked).toEqual([CHAIN[0], CHAIN[1]])
    expect(db.usage()).toEqual(['transport_error', 'ok'])
    expect(db.count('record_provider_success')).toBe(1)
  })

  it('a timeout is its own class: transient, distinguishable from malformed, and the chain error says so', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl } = scripted([hangs])
    const { state, p } = start(router(db, impl))
    await vi.advanceTimersByTimeAsync(T * 4 + 10)
    await p
    expect(state.err).toBeInstanceOf(AllCandidatesFailedError)
    const cause = (state.err as AllCandidatesFailedError).cause
    expect(cause).toBeInstanceOf(ProviderTimeoutError)
    const klass = classifyFailure(state.err)
    expect(klass.nature).toBe('transient')
    expect(klass.summary).toMatch(/did not answer within/)
    expect(klass.summary).not.toMatch(/not valid JSON/)
    expect(classifyFailure(new SyntaxError('x')).summary).toMatch(/not valid JSON/)
    expect(classifyFailure(cause).summary).toBe(klass.summary)
  })
})

describe('the whole chain', () => {
  it('the fourth model (free tier) IS reachable inside one call', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl, asked } = scripted([
      async () => json({ error: { code: 429, message: 'limit' } }),
      async () => json({ detail: 'boom' }, 500),
      async () => {
        throw new TypeError('fetch failed')
      },
      answers,
    ])
    const result = await router(db, impl).complete({ messages: MESSAGES })
    expect(asked).toEqual(CHAIN)
    expect(result.model).toBe(CHAIN[3])
    expect(db.usage()).toEqual(['rate_limited', 'provider_error', 'transport_error', 'ok'])
  })

  it('all providers unavailable (every model hangs): four attempts, bounded total time, ONE error naming them', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl, asked } = scripted([hangs])
    const t0 = Date.now()
    const { state, p } = start(router(db, impl))
    await vi.advanceTimersByTimeAsync(T * 4 + 10)
    await p
    expect(state.done).toBe(true)
    expect(asked).toEqual(CHAIN)
    expect(Date.now() - t0).toBeLessThanOrEqual(T * 4 + 10)
    expect(state.err).toBeInstanceOf(AllCandidatesFailedError)
    expect((state.err as AllCandidatesFailedError).candidates).toEqual(CHAIN)
    expect(db.usage()).toEqual(['transport_error', 'transport_error', 'transport_error', 'transport_error'])
  })

  it('every kind of failure at once: still four attempts, one error, rows for each real call', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl } = scripted([
      async () => json({ error: { code: 429, message: 'limit' } }),
      async () => json({ detail: 'x' }, 500),
      async () => new Response('<html>', { status: 200 }),
      hangs,
    ])
    const { state, p } = start(router(db, impl))
    await vi.advanceTimersByTimeAsync(T + 10)
    await p
    expect(state.err).toBeInstanceOf(AllCandidatesFailedError)
    expect(db.usage()).toEqual(['rate_limited', 'provider_error', 'malformed_response', 'transport_error'])
  })

  it('the chain budget caps the whole call even if the per-request deadline would allow more', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl, asked } = scripted([hangs])
    // 1000ms each but only 2500ms in total: after two the 500ms left is too little to start a third.
    const t0 = Date.now()
    const { state, p } = start(router(db, impl, { chainBudgetMs: 2500 }))
    await vi.advanceTimersByTimeAsync(5000)
    await p
    expect(state.done).toBe(true)
    expect(asked).toEqual(CHAIN.slice(0, 2))
    expect((state.err as AllCandidatesFailedError).candidates).toEqual(CHAIN.slice(0, 2))
    expect(t0).toBeLessThanOrEqual(Date.now())
  })

  it('a caller-named model gets the deadline too, and is never swapped for another', async () => {
    const db = new Db(CHAIN.map(row))
    const { impl, asked } = scripted([hangs])
    const r = router(db, impl)
    const state: { err?: Error; done: boolean } = { done: false }
    const raw = r.complete({ messages: MESSAGES, model: CHAIN[0] as string }).catch((e: Error) => {
      state.err = e
      state.done = true
    })
    await vi.advanceTimersByTimeAsync(T + 1)
    await done(raw)
    expect(state.done).toBe(true)
    expect(state.err).toBeInstanceOf(ProviderTimeoutError)
    expect(asked).toEqual([CHAIN[0]])
  })
})
