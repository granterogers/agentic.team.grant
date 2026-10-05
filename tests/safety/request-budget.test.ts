/**
 * The production request budget counts exactly, refuses past the number, runs a registered teardown, and cannot be raised
 * without a stated reason. Everything runs through a fake transport: no request here can leave the machine.
 *
 * Each detector is shown able to FAIL (the controls near the end), because a counter that has only ever been shown agreeing
 * with itself reads as working whether it counts everything or nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { guardFetch } from '../../src/safety/production-gate.ts'
import {
  BUDGET_CLASSES,
  type BudgetClass,
  classOf,
  ENV_BUDGET,
  ENV_CLASS,
  ENV_PAGE_BUDGET,
  ENV_REASON,
  ProductionBudget,
  ProductionBudgetExceeded,
  ProductionBudgetRefused,
  planBudget,
  resetProductionBudgetForTest,
  TEARDOWN_ALLOWANCE,
} from '../../src/safety/request-budget.ts'

const OPEN = { ALLOW_PRODUCTION_CHECKS: '1', ALLOW_PRODUCTION_WRITES: '1' }
const PROD = 'https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/hq-api?section=pulse'

const budgetFor = (limit: number, cls: BudgetClass = 'smoke', pageLoadLimit = 5) => {
  const lines: string[] = []
  let code = 0
  const b = new ProductionBudget(
    { cls, limit, pageLoadLimit, defaultLimit: limit, raised: [] },
    { write: (l) => lines.push(l), setExitCode: (c) => (code = c) },
  )
  return { b, lines, code: () => code }
}

const fake = () => vi.fn(async () => new Response('[]', { status: 200 }))

/** The real guard around a fake transport, with production reads and writes opened and THIS budget counting. */
const via = (inner: typeof fetch, b: ProductionBudget, env: Record<string, string> = OPEN) =>
  guardFetch(
    inner,
    () => env,
    () => b,
  )

describe('class budgets and the way they are configured', () => {
  it('has the proposed defaults', () => {
    expect(
      Object.fromEntries(Object.entries(BUDGET_CLASSES).map(([k, v]) => [k, v.requests])),
    ).toEqual({
      smoke: 100,
      sample: 250,
      'disposable-multi-user': 400,
      'production-heavy': 200,
      'p4-browser': 500,
      default: 150,
    })
  })

  it('uses the class default when nothing is set', () => {
    expect(planBudget({}, 'sample').limit).toBe(250)
    expect(planBudget({}, 'default').limit).toBe(150)
  })

  it('lets a person LOWER the number freely, with no reason', () => {
    const p = planBudget({ [ENV_BUDGET]: '20' }, 'smoke')
    expect(p.limit).toBe(20)
    expect(p.raised).toEqual([])
  })

  it('refuses a raise with no reason, and with a reason too short to be one', () => {
    expect(() => planBudget({ [ENV_BUDGET]: '101' }, 'smoke')).toThrow(ProductionBudgetRefused)
    expect(() => planBudget({ [ENV_BUDGET]: '101' }, 'smoke')).toThrow(/Say why/)
    expect(() => planBudget({ [ENV_BUDGET]: '101', [ENV_REASON]: 'more' }, 'smoke')).toThrow(
      /Say why/,
    )
  })

  it('accepts a raise with a stated reason and records it so it can be printed', () => {
    const p = planBudget(
      { [ENV_BUDGET]: '300', [ENV_REASON]: 'one-off migration rehearsal approved by Grant' },
      'smoke',
    )
    expect(p.limit).toBe(300)
    expect(p.raised).toHaveLength(1)
    expect(p.raised[0]?.reason).toContain('approved by Grant')
    expect(new ProductionBudget(p).describe()).toContain('RAISED')
  })

  it('refuses a value it cannot read instead of ignoring it', () => {
    for (const bad of ['abc', '0', '-5', '1.5', '1e3', ' ']) {
      expect(() => planBudget({ [ENV_BUDGET]: bad }, 'smoke'), bad).toThrow(ProductionBudgetRefused)
    }
  })

  it('applies the same rule to the page-load budget', () => {
    expect(planBudget({ [ENV_PAGE_BUDGET]: '2' }, 'smoke').pageLoadLimit).toBe(2)
    expect(() => planBudget({ [ENV_PAGE_BUDGET]: '6' }, 'smoke')).toThrow(/page loads/)
  })

  it('takes the class from the runner, else from where the script lives', () => {
    expect(classOf({ [ENV_CLASS]: 'production-heavy' }, 'x/scripts/verify/a.ts')).toBe(
      'production-heavy',
    )
    expect(classOf({}, '/r/scripts/p4/browser.ts')).toBe('p4-browser')
    expect(classOf({}, '/r/scripts/verify/a.ts')).toBe('default')
    expect(classOf({ [ENV_CLASS]: 'nonsense' }, undefined)).toBe('default')
  })
})

describe('the counter is exact', () => {
  it('counts N production requests through the guarded fetch as N, and sends N', async () => {
    const { b } = budgetFor(25)
    const inner = fake()
    const guarded = via(inner, b)
    for (let i = 0; i < 17; i += 1) await guarded(PROD)
    expect(b.used).toBe(17)
    expect(inner).toHaveBeenCalledTimes(17)
  })

  it('does not count localhost, a replica or a test server', async () => {
    const { b } = budgetFor(5)
    const inner = fake()
    const guarded = via(inner, b)
    for (const u of [
      'http://localhost:4797/',
      'http://127.0.0.1:54321/rest/v1/x',
      'http://hq-acceptance.test.localhost:4797/',
      'http://[::1]:3000/',
    ])
      await guarded(u)
    expect(b.used).toBe(0)
    expect(inner).toHaveBeenCalledTimes(4)
  })

  it('does not count a request the production gate refused (nothing was sent)', async () => {
    const { b } = budgetFor(5)
    const inner = fake()
    const guarded = via(inner, b, {}) // flags unset
    await expect(guarded(PROD)).rejects.toThrow(/REFUSED/)
    expect(b.used).toBe(0)
    expect(inner).not.toHaveBeenCalled()
  })

  it('counts every kind of production host the gate recognises', async () => {
    const { b } = budgetFor(10)
    const guarded = via(fake(), b)
    await guarded('https://api.supabase.com/v1/projects/x/health')
    await guarded('https://ai-team-hq.vercel.app/')
    await guarded('https://something.supabase.co/rest/v1/x')
    expect(b.used).toBe(3)
  })
})

describe('exceeding the budget', () => {
  it('sends exactly the budget, refuses the next, and names the budget, the count and the class', async () => {
    const { b, lines, code } = budgetFor(3, 'production-heavy')
    const inner = fake()
    const guarded = via(inner, b)
    for (let i = 0; i < 3; i += 1) await guarded(PROD)
    const err = await guarded(PROD).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProductionBudgetExceeded)
    const message = (err as Error).message
    expect(message).toContain('budget of 3')
    expect(message).toContain('production-heavy')
    expect(message).toContain('3 requests made')
    expect(inner).toHaveBeenCalledTimes(3)
    expect(b.used).toBe(3)
    expect(b.exceeded).toBe(true)
    expect(code()).toBe(5)
    expect(lines.join('\n')).toContain('budget of 3')
  })

  it('stays refused: a script that swallows the throw cannot carry on', async () => {
    const { b } = budgetFor(1)
    const inner = fake()
    const guarded = via(inner, b)
    await guarded(PROD)
    for (let i = 0; i < 5; i += 1)
      await expect(guarded(PROD)).rejects.toBeInstanceOf(ProductionBudgetExceeded)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('runs a registered teardown once, and lets it send a bounded number of requests', async () => {
    const { b } = budgetFor(2)
    const inner = fake()
    const guarded = via(inner, b)
    const cleaned = vi.fn(async () => {
      for (let i = 0; i < 3; i += 1) await guarded(PROD) // the cleanup still reaches the office
    })
    b.registerTeardown(cleaned)
    await guarded(PROD)
    await guarded(PROD)
    await expect(guarded(PROD)).rejects.toBeInstanceOf(ProductionBudgetExceeded)
    await expect(guarded(PROD)).rejects.toBeInstanceOf(ProductionBudgetExceeded)
    expect(cleaned).toHaveBeenCalledTimes(1)
    expect(inner).toHaveBeenCalledTimes(2 + 3)
  })

  it('bounds the teardown: it cannot become a second run', async () => {
    const { b } = budgetFor(1)
    const inner = fake()
    const guarded = via(inner, b)
    let refused = 0
    b.registerTeardown(async () => {
      for (let i = 0; i < TEARDOWN_ALLOWANCE + 10; i += 1)
        await guarded(PROD).catch(() => {
          refused += 1
        })
    })
    await guarded(PROD)
    await guarded(PROD).catch(() => undefined)
    expect(refused).toBe(10)
    expect(inner).toHaveBeenCalledTimes(1 + TEARDOWN_ALLOWANCE)
  })

  it('a teardown that throws is reported and does not hide the breach', async () => {
    const { b, lines } = budgetFor(1)
    const guarded = via(fake(), b)
    b.registerTeardown(() => {
      throw new Error('cleanup broke')
    })
    await guarded(PROD)
    await expect(guarded(PROD)).rejects.toBeInstanceOf(ProductionBudgetExceeded)
    expect(lines.join('\n')).toContain('a teardown failed: cleanup broke')
  })

  it('counts a browser harness synchronously and starts the same breach', async () => {
    const { b, code } = budgetFor(2, 'p4-browser')
    const cleaned = vi.fn()
    b.registerTeardown(cleaned)
    expect(b.tally('GET a')).toBe(true)
    expect(b.tally('GET b')).toBe(true)
    expect(b.tally('GET c')).toBe(false)
    await Promise.resolve()
    expect(cleaned).toHaveBeenCalledTimes(1)
    expect(code()).toBe(5)
  })

  it('has its own page-load budget', () => {
    const { b } = budgetFor(100, 'smoke', 2)
    expect(b.tallyPageLoad('/')).toBe(true)
    expect(b.tallyPageLoad('/')).toBe(true)
    expect(b.tallyPageLoad('/')).toBe(false)
    expect(b.pageLoads).toBe(3)
    expect(b.exceeded).toBe(true)
  })
})

describe('the Management API executor is counted exactly, retries included', () => {
  const saved: Record<string, string | undefined> = {}
  const KEYS = ['ALLOW_PRODUCTION_CHECKS', ENV_BUDGET, ENV_CLASS, ENV_REASON]
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k]
    process.env.ALLOW_PRODUCTION_CHECKS = '1'
    process.env[ENV_BUDGET] = '3'
    resetProductionBudgetForTest()
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    resetProductionBudgetForTest()
    process.exitCode = undefined // a real breach sets 5, which must not become the test runner's own exit code
    vi.unstubAllGlobals()
  })

  it('refuses the query after the budget, and the transport saw exactly the budget', async () => {
    const f = fake()
    vi.stubGlobal('fetch', f) // an UNGUARDED fetch: the executor must count it itself
    const db = new ManagementApiExecutor('baujwlzcziasnfhhkchg', 'sbp_not_real')
    for (let i = 0; i < 3; i += 1) await db.execute('select 1')
    await expect(db.execute('select 1')).rejects.toBeInstanceOf(ProductionBudgetExceeded)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('does not count twice when the fetch guard already counts', async () => {
    const f = Object.assign(fake(), { productionGuarded: true as const })
    vi.stubGlobal('fetch', f)
    const db = new ManagementApiExecutor('baujwlzcziasnfhhkchg', 'sbp_not_real')
    for (let i = 0; i < 6; i += 1) await db.execute('select 1')
    expect(f).toHaveBeenCalledTimes(6) // the stand-in guard here counts nothing; the executor must not either
  })

  it('does not count a local fake the executor is pointed at', async () => {
    const f = fake()
    vi.stubGlobal('fetch', f)
    const db = new ManagementApiExecutor('x', 'sbp_not_real', 'http://127.0.0.1:9')
    for (let i = 0; i < 8; i += 1) await db.execute('select 1')
    expect(f).toHaveBeenCalledTimes(8)
  })

  it('refuses an unexplained raise at the first use', async () => {
    process.env[ENV_BUDGET] = '9999'
    resetProductionBudgetForTest()
    const f = fake()
    vi.stubGlobal('fetch', f)
    const db = new ManagementApiExecutor('baujwlzcziasnfhhkchg', 'sbp_not_real')
    await expect(db.execute('select 1')).rejects.toBeInstanceOf(ProductionBudgetRefused)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('controls: the detectors can fail', () => {
  /** The property the exactness test asserts, as a function, so a sabotage can be shown to trip it. */
  const exactlyCounted = async (guard: typeof fetch, b: ProductionBudget, n: number) => {
    for (let i = 0; i < n; i += 1) await guard(PROD)
    expect(b.used).toBe(n)
  }

  it('a guard that does not count is caught by the exactness check', async () => {
    const { b } = budgetFor(50)
    // the sabotage: counting removed
    const uncounted = guardFetch(
      fake(),
      () => OPEN,
      () => null,
    )
    await expect(exactlyCounted(uncounted, b, 7)).rejects.toThrow()
    const counted = via(fake(), b)
    await exactlyCounted(counted, b, 7) // and the real wiring passes it
  })

  it('a guard that counts local traffic is caught by the localhost check', async () => {
    const { b } = budgetFor(50)
    // the sabotage: a wrapper that counts every request, whatever the host
    const countsEverything: typeof fetch = async (u) => {
      b.tally(String(u))
      return new Response('[]')
    }
    await countsEverything('http://localhost:4797/')
    expect(() => expect(b.used).toBe(0)).toThrow() // the check that the real guard passes goes red
    const { b: real } = budgetFor(50)
    await via(fake(), real)('http://localhost:4797/')
    expect(real.used).toBe(0)
  })

  it('a budget that never refuses is caught by the refusal check', async () => {
    const { b } = budgetFor(Number.MAX_SAFE_INTEGER) // the sabotage: no practical limit
    const guarded = via(fake(), b)
    for (let i = 0; i < 4; i += 1) await guarded(PROD)
    expect(() => expect(b.exceeded).toBe(true)).toThrow()
  })
})
