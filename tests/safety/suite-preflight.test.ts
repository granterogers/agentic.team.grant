/**
 * `scripts/suite.ts` fails CLOSED. Before 5 October 2026 it returned "unknown" when the access token was unset and went ahead;
 * now a production-class run that cannot read the platform does not start unless a person says why. Every branch is driven
 * through injected readers, so nothing here can reach production.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  budgetClassFor,
  EXIT_BAD_ARGUMENT,
  EXIT_NO_GO,
  EXIT_NO_PRODUCTION_FLAG,
  EXIT_NO_TOKEN,
  preflightSuite,
  type SuiteClass,
} from '../../src/safety/suite-preflight.ts'

const HEALTHY = [{ status: 'ACTIVE_HEALTHY' }, { status: 'ACTIVE_HEALTHY' }]
const good5 = Array.from({ length: 5 }, () => ({ d: 0.1, status: 'succeeded' }))
const goodRow = { last5: good5, runs_in_window: 10, startup_timeouts_1h: 0 }

const run = (
  cls: SuiteClass,
  over: Partial<Parameters<typeof preflightSuite>[0]> = {},
  args: string[] = ['x', '--production'],
) =>
  preflightSuite({
    cls,
    args,
    token: 'tok',
    readHealth: async () => HEALTHY,
    readRows: async () => [goodRow],
    sleep: async () => undefined,
    ...over,
  })

describe('local suites are not asked anything', () => {
  it('start with no token, no health and no canary', async () => {
    const readHealth = vi.fn(async () => HEALTHY)
    const s = await run('local', { token: undefined, readHealth }, ['x'])
    expect(s.ok).toBe(true)
    expect(readHealth).not.toHaveBeenCalled()
  })
})

describe('the existing intent rule is kept', () => {
  it('a production-heavy suite without --production is refused first, before anything is read', async () => {
    const readHealth = vi.fn(async () => HEALTHY)
    const s = await run('production-heavy', { readHealth }, ['x'])
    expect(s.exit).toBe(EXIT_NO_PRODUCTION_FLAG)
    expect(readHealth).not.toHaveBeenCalled()
  })
})

describe('FAIL CLOSED when the access token is unset', () => {
  for (const cls of ['smoke', 'sample', 'production-heavy'] as const)
    for (const token of [undefined, '']) {
      it(`${cls} with token ${JSON.stringify(token)} does not start`, async () => {
        const s = await run(cls, { token }, ['x', '--production'])
        expect(s.ok).toBe(false)
        expect(s.exit).toBe(EXIT_NO_TOKEN)
        expect(s.lines.join(' ')).toContain('SUPABASE_ACCESS_TOKEN is not set')
      })
    }

  it('--skip-canary-because lets it start, and the reason is printed', async () => {
    const s = await run('sample', { token: undefined }, [
      'x',
      '--skip-canary-because=the token is a vault secret read by the suite itself',
    ])
    expect(s.ok).toBe(true)
    expect(s.lines.join(' ')).toContain('SKIPPED')
    expect(s.lines.join(' ')).toContain('vault secret')
  })

  it('a skip with no real reason is refused as a bad argument, not ignored', async () => {
    const s = await run('sample', { token: undefined }, ['x', '--skip-canary-because=ok'])
    expect(s.ok).toBe(false)
    expect(s.exit).toBe(EXIT_BAD_ARGUMENT)
  })
})

describe('smoke: the provider label, read, and fail closed', () => {
  it('starts when every service is healthy', async () => {
    expect((await run('smoke')).ok).toBe(true)
  })
  it('NO-GO on an unhealthy label', async () => {
    const s = await run('smoke', { readHealth: async () => [{ status: 'UNHEALTHY' }] })
    expect(s.exit).toBe(EXIT_NO_GO)
  })
  it('NO-GO when the label cannot be read (empty, or throwing) - it used to start', async () => {
    for (const readHealth of [
      async () => [],
      async () => {
        throw new Error('ECONNRESET')
      },
    ])
      expect((await run('smoke', { readHealth })).exit).toBe(EXIT_NO_GO)
  })
  it('a skip covers an unreadable label only, never an unhealthy one', async () => {
    const skip = ['x', '--skip-canary-because=health endpoint rate limited today']
    expect((await run('smoke', { readHealth: async () => [] }, skip)).ok).toBe(true)
    expect(
      (await run('smoke', { readHealth: async () => [{ status: 'UNHEALTHY' }] }, skip)).ok,
    ).toBe(false)
  })
  it('does not spend a canary query: a smoke run is a handful of reads', async () => {
    const readRows = vi.fn(async () => [goodRow])
    await run('smoke', { readRows })
    expect(readRows).not.toHaveBeenCalled()
  })
})

describe('sample and production-heavy need the heartbeat canary', () => {
  for (const cls of ['sample', 'production-heavy'] as const) {
    it(`${cls}: GO when the canary is good, and the checks are printed`, async () => {
      const s = await run(cls)
      expect(s.ok).toBe(true)
      expect(s.lines.join('\n')).toContain('cron canary')
    })
    it(`${cls}: NO-GO on a startup timeout in the last hour`, async () => {
      const s = await run(cls, { readRows: async () => [{ ...goodRow, startup_timeouts_1h: 3 }] })
      expect(s.exit).toBe(EXIT_NO_GO)
    })
    it(`${cls}: NO-GO when the canary cannot be read`, async () => {
      const s = await run(cls, {
        readRows: async () => {
          throw new Error('timeout')
        },
      })
      expect(s.exit).toBe(EXIT_NO_GO)
      expect(s.lines.join(' ')).toContain('could not read: timeout')
    })
    it(`${cls}: a skip lets an unreadable canary through but not a bad reading`, async () => {
      const skip = ['x', '--production', '--skip-canary-because=pg_cron is being re-created today']
      const unreadable = await run(
        cls,
        {
          readRows: async () => {
            throw new Error('timeout')
          },
        },
        skip,
      )
      expect(unreadable.ok).toBe(true)
      const bad = await run(
        cls,
        { readRows: async () => [{ ...goodRow, runs_in_window: 2 }] },
        skip,
      )
      expect(bad.ok).toBe(false)
    })
  }
})

describe('the request-budget class a suite runs under', () => {
  it('is the suite class, except disposable-person suites and local ones', () => {
    expect(budgetClassFor('smoke', 'verify:pulse', [])).toBe('smoke')
    expect(budgetClassFor('sample', 'verify:history', [])).toBe('sample')
    expect(budgetClassFor('production-heavy', 'verify:worker', [])).toBe('production-heavy')
    expect(budgetClassFor('sample', 'verify:account-ui', ['verify:account-ui'])).toBe(
      'disposable-multi-user',
    )
    expect(budgetClassFor('local', 'verify:talk', [])).toBe('default')
  })
  it('every suite the manifest calls disposable is a real npm script', () => {
    const manifest = JSON.parse(readFileSync('docs/testing/suite-classes.json', 'utf8')) as {
      disposable: string[]
    }
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(manifest.disposable.length).toBeGreaterThan(0)
    for (const n of manifest.disposable) expect(pkg.scripts[n], n).toBeDefined()
  })
})

describe('controls', () => {
  it('a preflight that fails open (the old behaviour) would be caught: no token must not be ok', async () => {
    const s = await run('production-heavy', { token: undefined })
    expect(() => expect(s.ok).toBe(true)).toThrow() // the old code would have said ok here
  })
})
