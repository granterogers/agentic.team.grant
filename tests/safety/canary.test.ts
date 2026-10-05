/**
 * The canary precondition decides GO / NO-GO from injected readers, so every branch is driven here without a network,
 * including the branch where the canary cannot be read (which must be NO-GO), and the controls that prove each judge can fail.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  BOUNDARY_LIMIT_MS,
  canaryPrecondition,
  clip,
  fetchProviderHealth,
  IN_RUN_CANARY_LIMIT_S,
  judgeHealth,
  judgeInRun,
  judgeLastRuns,
  judgePreconditionRow,
  judgeTimeouts,
  judgeWindow,
  LAST_RUNS_SQL,
  PRECONDITION_SQL,
  parseSkipCanary,
  type Row,
  readLastRunsCanary,
} from '../../src/safety/canary.ts'

const HEALTHY = [
  { status: 'ACTIVE_HEALTHY' },
  { status: 'ACTIVE_HEALTHY' },
  { status: 'ACTIVE_HEALTHY' },
  { status: 'ACTIVE_HEALTHY' },
]
const run = (d: number, status = 'succeeded') => ({ d, status })
const GOOD5 = [run(0.1), run(0.2), run(0.1), run(0.3), run(0.1)]
const goodRow = (over: Partial<Row> = {}): Row => ({
  last5: GOOD5,
  runs_in_window: 10,
  startup_timeouts_1h: 0,
  ...over,
})
const noSleep = async () => undefined

const go = (over: Partial<Parameters<typeof canaryPrecondition>[0]> = {}) =>
  canaryPrecondition({
    readHealth: async () => HEALTHY,
    readRows: async () => [goodRow()],
    sleep: noSleep,
    ...over,
  })

describe('the individual judges', () => {
  it('health: all ACTIVE_HEALTHY, and at least one reading', () => {
    expect(judgeHealth(HEALTHY).ok).toBe(true)
    expect(judgeHealth([]).ok).toBe(false)
    expect(judgeHealth([{ status: 'ACTIVE_HEALTHY' }, { status: 'UNHEALTHY' }]).ok).toBe(false)
    expect(judgeHealth([{ status: 'COMING_UP' }]).ok).toBe(false)
  })

  it('last five runs: five rows, all succeeded, all under 1.0 s', () => {
    expect(judgeLastRuns(GOOD5).ok).toBe(true)
    expect(judgeLastRuns(GOOD5.slice(0, 4)).ok).toBe(false) // a missing row
    expect(judgeLastRuns([...GOOD5.slice(0, 4), run(0.1, 'failed')]).ok).toBe(false)
    expect(judgeLastRuns([...GOOD5.slice(0, 4), run(1.0)]).ok).toBe(false) // not UNDER 1.0
    expect(judgeLastRuns([...GOOD5.slice(0, 4), run(0.99)]).ok).toBe(true)
    expect(judgeLastRuns([...GOOD5.slice(0, 4), run(Number.NaN)]).ok).toBe(false)
  })

  it('window: ten runs in ten minutes', () => {
    expect(judgeWindow(10).ok).toBe(true)
    expect(judgeWindow(11).ok).toBe(true)
    expect(judgeWindow(9).ok).toBe(false)
    expect(judgeWindow(0).ok).toBe(false)
    expect(judgeWindow(Number.NaN).ok).toBe(false)
  })

  it('startup timeouts: none in the hour', () => {
    expect(judgeTimeouts(0).ok).toBe(true)
    expect(judgeTimeouts(1).ok).toBe(false)
    expect(judgeTimeouts(Number.NaN).ok).toBe(false)
  })

  it('a canary row of the wrong shape is NO-GO, never a pass', () => {
    expect(judgePreconditionRow(undefined).every((c) => !c.ok)).toBe(true)
    expect(judgePreconditionRow({ last5: 'not json', runs_in_window: 10 }).some((c) => !c.ok)).toBe(
      true,
    )
    expect(judgePreconditionRow({ last5: {}, runs_in_window: 10 }).some((c) => !c.ok)).toBe(true)
    expect(judgePreconditionRow(goodRow()).every((c) => c.ok)).toBe(true)
  })

  it('accepts the json column as an object or as a string (the executor gives either)', () => {
    expect(judgePreconditionRow(goodRow({ last5: JSON.stringify(GOOD5) })).every((c) => c.ok)).toBe(
      true,
    )
  })
})

describe('canaryPrecondition: every branch', () => {
  it('GO when health, the last five runs, the window and the timeouts are all fine', async () => {
    const v = await go()
    expect(v.go).toBe(true)
    expect(v.skipped).toBe(false)
    expect(v.reasons).toEqual([])
    expect(v.checks.every((c) => c.ok)).toBe(true)
  })

  it('reads the heartbeat in ONE query', async () => {
    const readRows = vi.fn(async () => [goodRow()])
    await go({ readRows })
    expect(readRows).toHaveBeenCalledTimes(1)
    expect(readRows).toHaveBeenCalledWith(PRECONDITION_SQL)
  })

  it('NO-GO on unhealthy services, and does not ask the unwell host any more', async () => {
    const readRows = vi.fn(async () => [goodRow()])
    const v = await go({
      readHealth: async () => [{ status: 'ACTIVE_HEALTHY' }, { status: 'UNHEALTHY' }],
      readRows,
    })
    expect(v.go).toBe(false)
    expect(v.reasons[0]).toMatch(/does not report every service healthy/)
    expect(readRows).not.toHaveBeenCalled()
  })

  it('NO-GO on a slow, failed or missing recent run', async () => {
    for (const last5 of [
      [run(1.4), ...GOOD5.slice(1)],
      [run(0.1, 'failed'), ...GOOD5.slice(1)],
      GOOD5.slice(0, 3),
    ]) {
      const v = await go({ readRows: async () => [goodRow({ last5 })] })
      expect(v.go).toBe(false)
      expect(v.reasons[0]).toContain('quick and succeeding')
    }
  })

  it('NO-GO when fewer than ten runs are present in the window', async () => {
    const v = await go({ readRows: async () => [goodRow({ runs_in_window: 7 })] })
    expect(v.go).toBe(false)
    expect(v.reasons[0]).toContain('7 present')
  })

  it('NO-GO on a job startup timeout in the last hour', async () => {
    const v = await go({ readRows: async () => [goodRow({ startup_timeouts_1h: 2 })] })
    expect(v.go).toBe(false)
    expect(v.reasons[0]).toContain('2 in the last hour')
  })

  it('names every failing check, not only the first', async () => {
    const v = await go({
      readRows: async () => [goodRow({ runs_in_window: 3, startup_timeouts_1h: 1 })],
    })
    expect(v.reasons[0]).toContain('3 present')
    expect(v.reasons[0]).toContain('1 in the last hour')
  })
})

describe('FAIL CLOSED: a canary that cannot be read is NO-GO', () => {
  it('health unreadable (empty, or throws) is NO-GO with the reason', async () => {
    for (const readHealth of [
      async () => [],
      async () => {
        throw new Error('connect ETIMEDOUT')
      },
    ]) {
      const readRows = vi.fn(async () => [goodRow()])
      const v = await go({ readHealth, readRows })
      expect(v.go).toBe(false)
      expect(v.reasons[0]).toContain('could not be read')
      expect(v.reasons[0]).toContain('--skip-canary-because')
      expect(readRows).not.toHaveBeenCalled()
    }
  })

  it('the canary query throwing is NO-GO, after one retry, with the reason printed', async () => {
    const readRows = vi.fn(async () => {
      throw new Error('upstream request timeout')
    })
    const v = await go({ readRows })
    expect(v.go).toBe(false)
    expect(readRows).toHaveBeenCalledTimes(2)
    expect(v.reasons[0]).toContain('could not read: upstream request timeout')
  })

  it('a canary that fails once and then reads is read, not refused', async () => {
    let n = 0
    const v = await go({
      readRows: async () => {
        n += 1
        if (n === 1) throw new Error('blip')
        return [goodRow()]
      },
    })
    expect(v.go).toBe(true)
  })

  it('an empty result (no row at all) is NO-GO', async () => {
    const v = await go({ readRows: async () => [] })
    expect(v.go).toBe(false)
  })

  it('never prints a token it was holding', async () => {
    const v = await go({
      readRows: async () => {
        throw new Error('Bearer sbp_0123456789abcdef refused')
      },
    })
    const printed = JSON.stringify(v)
    expect(printed).not.toContain('sbp_0123456789abcdef')
    expect(clip(new Error('Bearer abc.def'))).toContain('[held]')
  })
})

describe('--skip-canary-because only ever covers "could not read"', () => {
  it('lets a run go ahead when the canary cannot be read, and says so', async () => {
    const v = await go({
      skipBecause: 'the Management API is throttled and the gateway is the subject',
      readRows: async () => {
        throw new Error('429')
      },
    })
    expect(v.go).toBe(true)
    expect(v.skipped).toBe(true)
    expect(v.reasons.join(' ')).toContain('SKIPPED the canary')
    expect(v.reasons.join(' ')).toContain('throttled')
  })

  it('lets a run go ahead when health cannot be read, and still reads the canary', async () => {
    const readRows = vi.fn(async () => [goodRow()])
    const v = await go({
      skipBecause: 'health endpoint is rate limited today',
      readHealth: async () => [],
      readRows,
    })
    expect(v.go).toBe(true)
    expect(v.skipped).toBe(true)
    expect(readRows).toHaveBeenCalledTimes(1)
  })

  it('does NOT override a canary that was read and says the host is unwell', async () => {
    const v = await go({
      skipBecause: 'I am in a hurry, honestly',
      readRows: async () => [goodRow({ startup_timeouts_1h: 4 })],
    })
    expect(v.go).toBe(false)
  })

  it('does NOT override a health reading that says a service is unhealthy', async () => {
    const v = await go({
      skipBecause: 'I am in a hurry, honestly',
      readHealth: async () => [{ status: 'UNHEALTHY' }],
    })
    expect(v.go).toBe(false)
  })

  it('parses the flag, and refuses one with no reason or a token reason', () => {
    expect(parseSkipCanary(['x', '--production'])).toBeNull()
    expect(parseSkipCanary(['--skip-canary-because=the heartbeat table is being rebuilt'])).toBe(
      'the heartbeat table is being rebuilt',
    )
    expect(() => parseSkipCanary(['--skip-canary-because'])).toThrow(/needs a reason/)
    expect(() => parseSkipCanary(['--skip-canary-because='])).toThrow(/needs a reason/)
    expect(() => parseSkipCanary(['--skip-canary-because=x'])).toThrow(/needs a reason/)
  })
})

describe('the in-run abort rule', () => {
  const ok = [
    { d: 0.2, status: 'succeeded', age_s: 20 },
    { d: 0.3, status: 'succeeded', age_s: 80 },
    { d: 0.1, status: 'succeeded', age_s: 140 },
  ]
  it('does not abort a healthy run', () => {
    expect(judgeInRun({ boundaryMs: 900, canaryRows: ok }).abort).toBe(false)
    expect(judgeInRun({}).abort).toBe(false)
  })
  it('aborts on a boundary over 15 s, and not at exactly 15 s', () => {
    expect(judgeInRun({ boundaryMs: BOUNDARY_LIMIT_MS + 1 }).abort).toBe(true)
    expect(judgeInRun({ boundaryMs: BOUNDARY_LIMIT_MS }).abort).toBe(false)
  })
  it('aborts on a canary run over 1.5 s, and on one that did not succeed', () => {
    const one = (d: number, status: string) =>
      judgeInRun({ canaryRows: [{ d, status, age_s: 10 }] })
    expect(one(IN_RUN_CANARY_LIMIT_S + 0.01, 'succeeded').abort).toBe(true)
    expect(one(0.1, 'failed').abort).toBe(true)
    expect(one(IN_RUN_CANARY_LIMIT_S, 'succeeded').abort).toBe(false)
  })
  it('aborts on a missing run: a stale latest run, a gap, or no runs at all', () => {
    const stale = judgeInRun({ canaryRows: [{ d: 0.1, status: 'succeeded', age_s: 200 }] })
    expect(stale.abort).toBe(true)
    expect(
      judgeInRun({
        canaryRows: [
          { d: 0.1, status: 'succeeded', age_s: 10 },
          { d: 0.1, status: 'succeeded', age_s: 200 },
        ],
      }).reasons.join(' '),
    ).toContain('gap')
    expect(judgeInRun({ canaryRows: [] }).abort).toBe(true)
  })
  it('an unreadable age is an abort, never a pass', () => {
    expect(judgeInRun({ canaryRows: [{ d: 0.1, status: 'succeeded', age_s: null }] }).abort).toBe(
      true,
    )
  })
})

/** The function this suite had before it moved, verbatim in behaviour: the reference the library must still equal. */
const legacyCanary = async (q: (sql: string) => Promise<Row[]>) => {
  let why = ''
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const rows = await q(LAST_RUNS_SQL)
      const good =
        rows.length === 5 && rows.every((r) => r.status === 'succeeded' && Number(r.d) < 1)
      return { ok: good, detail: rows.map((r) => `${String(r.d)}s ${String(r.status)}`).join(', ') }
    } catch (e) {
      why = `could not read: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  return { ok: false, detail: why }
}

describe('auth-acceptance behaviour is unchanged by the move', () => {
  const cases: [string, Row[] | Error][] = [
    ['all good', GOOD5 as Row[]],
    ['one slow', [run(1.2), ...GOOD5.slice(1)] as Row[]],
    ['one failed', [run(0.1, 'failed'), ...GOOD5.slice(1)] as Row[]],
    ['only three rows', GOOD5.slice(0, 3) as Row[]],
    ['no rows', []],
    ['throws', new Error('boom')],
  ]
  for (const [name, input] of cases)
    it(`gives the library and the legacy function the same answer: ${name}`, async () => {
      const q = async () => {
        if (input instanceof Error) throw input
        return input
      }
      expect(await readLastRunsCanary(q, { sleep: noSleep })).toEqual(await legacyCanary(q))
    })

  it('still asks the exact query auth-acceptance asked, and retries once', async () => {
    const q = vi.fn(async () => {
      throw new Error('x')
    })
    await readLastRunsCanary(q, { sleep: noSleep })
    expect(q).toHaveBeenCalledTimes(2)
    expect(q).toHaveBeenCalledWith(LAST_RUNS_SQL)
  })

  it('fetches provider health through the injected fetch, and reads nothing as no reading', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(HEALTHY)))
    expect(await fetchProviderHealth('ref', 'tok', f as unknown as typeof fetch)).toEqual(HEALTHY)
    const bad = vi.fn(async () => {
      throw new Error('net')
    })
    expect(await fetchProviderHealth('ref', 'tok', bad as unknown as typeof fetch)).toEqual([])
    const obj = vi.fn(async () => new Response('{"message":"throttled"}'))
    expect(await fetchProviderHealth('ref', 'tok', obj as unknown as typeof fetch)).toEqual([])
  })
})

describe('controls: each judge can fail', () => {
  // The sabotage runs recorded in the commit message replace each judge by one that approves and show these go red.
  it('every judge refuses the input it exists to refuse', () => {
    expect(judgeWindow(0).ok).toBe(false)
    expect(judgeTimeouts(5).ok).toBe(false)
    expect(judgeLastRuns([]).ok).toBe(false)
    expect(judgeHealth([]).ok).toBe(false)
  })
})
