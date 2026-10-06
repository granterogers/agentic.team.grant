import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LogQueryRefused, readLedger, withLogGuard } from '../../scripts/forensics/log-guard.ts'
import {
  bytesProcessedOf,
  DEFAULT_QUERIES,
  type Env,
  isLogQuery,
  judgeLogQuery,
  type LedgerRow,
  parseLogRequest,
  sqlHash,
} from '../../src/safety/log-query-budget.ts'

const NOW = new Date('2026-10-06T12:00:00Z')
const SQL = "select count() as n from logs where source = 'edge_logs'"
const REASON = 'baseline gateway rate for one ten minute window; no capture covers it'
const path = (o: { sql?: string; mins?: number; end?: Date } = {}): string => {
  const end = o.end ?? new Date(NOW.getTime() - 5 * 60_000)
  const start = new Date(end.getTime() - (o.mins ?? 10) * 60_000)
  return `/v1/projects/p/analytics/endpoints/logs?sql=${encodeURIComponent(o.sql ?? SQL)}&iso_timestamp_start=${start.toISOString()}&iso_timestamp_end=${end.toISOString()}`
}
const req = (p = path()) => {
  const r = parseLogRequest(p)
  if (r === null) throw new Error('not a log query')
  return r
}
const ok: Env = { LOG_QUERY_REASON: REASON }
const verdict = (p = path(), ledger: LedgerRow[] = [], env = ok, now = NOW) =>
  judgeLogQuery(req(p), ledger, env, now)
const refusedWith = (v: ReturnType<typeof verdict>): string => (v.ok ? '' : v.reason)

let n = 0
const intent = (minutesAgo: number, over: Partial<LedgerRow> = {}): LedgerRow => {
  n += 1
  return {
    at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    phase: 'intent',
    id: `id${n}`,
    kind: 'logs',
    sqlHash: sqlHash(SQL),
    windowStart: null,
    windowEnd: null,
    windowMin: 10,
    reason: 'x',
    ...over,
  }
}
const outcome = (of: LedgerRow, over: Partial<LedgerRow> = {}): LedgerRow => ({
  ...of,
  phase: 'outcome',
  status: 200,
  ...over,
})

describe('what counts as a log query', () => {
  it('matches the log and usage endpoints and not the Prometheus scrape or the database', () => {
    expect(isLogQuery('/v1/projects/p/analytics/endpoints/logs?sql=x')).toBe(true)
    expect(isLogQuery('/v1/projects/p/analytics/endpoints/usage.api-counts?interval=1hr')).toBe(
      true,
    )
    expect(isLogQuery('/v1/projects/p/analytics/endpoints/metrics')).toBe(false)
    expect(isLogQuery('/v1/projects/p/database/query')).toBe(false)
  })
})

describe('the rules, each with the case that must pass beside the case that must be refused', () => {
  it('passes a narrow, filtered, stated, recent query (the control: every refusal below changes exactly one thing)', () => {
    expect(verdict().ok).toBe(true)
  })

  it('refuses without a stated reason, or with a thin one', () => {
    expect(refusedWith(verdict(path(), [], {} as typeof ok))).toContain('LOG_QUERY_REASON')
    expect(refusedWith(verdict(path(), [], { LOG_QUERY_REASON: 'because' }))).toContain(
      'LOG_QUERY_REASON',
    )
  })

  it('refuses a whole-day window, which is what the meter charged for, and any window over an hour', () => {
    expect(refusedWith(verdict(path({ mins: 1440 })))).toContain(
      'the most this tooling may ask for',
    )
    expect(refusedWith(verdict(path({ mins: 61 })))).toContain('60 minutes')
    expect(verdict(path({ mins: 60 })).ok).toBe(true)
  })

  it('refuses a request with no window at all, never assuming the service default is small', () => {
    const p = `/v1/projects/p/analytics/endpoints/logs?sql=${encodeURIComponent(SQL)}`
    expect(refusedWith(verdict(p))).toContain('the most this tooling may ask for')
  })

  it('refuses a window that ends in the future', () => {
    const end = new Date(NOW.getTime() + 30 * 60_000)
    expect(refusedWith(verdict(path({ end })))).toContain('future')
  })

  it('refuses SQL that does not filter on source, and accepts both = and in', () => {
    expect(refusedWith(verdict(path({ sql: 'select count() from logs' })))).toContain('`source`')
    expect(
      verdict(path({ sql: "select 1 from logs where source in ('edge_logs','auth_logs')" })).ok,
    ).toBe(true)
    // a source mentioned in a string is not a filter on it
    expect(
      refusedWith(
        verdict(path({ sql: "select 'source' from logs where event_message like '%x%'" })),
      ),
    ).toContain('`source`')
  })

  it('refuses the sixth-plus query in 24 hours, counting an intent that never got an outcome', () => {
    const rows = Array.from({ length: DEFAULT_QUERIES }, (_, i) =>
      intent(70 + i * 70, { windowMin: 10 }),
    )
    expect(refusedWith(verdict(path(), rows))).toContain('log queries in the last 24 hours')
    // the control: one fewer is allowed, and a row older than 24 hours does not count
    expect(verdict(path(), rows.slice(1)).ok).toBe(true)
    expect(verdict(path(), [...rows.slice(1), intent(25 * 60)]).ok).toBe(true)
  })

  it('refuses when the window-minutes already spent plus this one pass the daily total', () => {
    const rows = [
      intent(100, { windowMin: 60 }),
      intent(200, { windowMin: 60 }),
      intent(300, { windowMin: 55 }),
    ]
    expect(refusedWith(verdict(path({ mins: 10 }), rows))).toContain('window-minutes')
    expect(verdict(path({ mins: 5 }), rows).ok).toBe(true)
  })

  it('refuses once the service has REPORTED a gigabyte processed, and calls unreported spend UNKNOWN rather than zero', () => {
    const a = intent(100)
    const spent = [a, outcome(a, { bytesProcessed: 1_000_000_000 })]
    expect(refusedWith(verdict(path(), spent))).toContain('processed')
    const b = intent(100)
    const quiet = [b, outcome(b, { bytesProcessed: 5_000_000 })]
    expect(verdict(path(), quiet).ok).toBe(true)
    const c = intent(100)
    const v = verdict(path(), [c, outcome(c)])
    expect(v.ok && v.notes.join(' ')).toContain('UNKNOWN')
  })

  it('answers a repeated question from the file it already wrote, only when that window covers this one', () => {
    const end = new Date(NOW.getTime() - 5 * 60_000)
    const start = new Date(end.getTime() - 30 * 60_000)
    const a = intent(60, { windowStart: start.toISOString(), windowEnd: end.toISOString() })
    const done = [a, outcome(a, { file: '.out/forensics/logs/win-x/m1_edge.json' })]
    const inside = new Date(end.getTime() - 5 * 60_000)
    expect(refusedWith(verdict(path({ end: inside, mins: 10 }), done))).toContain('m1_edge.json')
    // controls: a window NOT covered, a different query, and a failed earlier attempt are all allowed
    expect(verdict(path({ end: new Date(NOW.getTime() - 60_000), mins: 10 }), done).ok).toBe(true)
    expect(
      verdict(
        path({ sql: "select 2 from logs where source = 'auth_logs'", end: inside, mins: 10 }),
        done,
      ).ok,
    ).toBe(true)
    expect(
      verdict(path({ end: inside, mins: 10 }), [a, outcome(a, { file: 'f', status: 500 })]).ok,
    ).toBe(true)
  })

  it('refuses a second query inside 65 seconds, across processes, and allows it after', () => {
    const rows = [intent(0.5)]
    expect(refusedWith(verdict(path(), rows))).toContain('wait')
    expect(verdict(path(), [intent(2)]).ok).toBe(true)
  })

  it('opens the breaker on a 402 for 24 hours and on a 429 for 15 minutes, and stays shut inside them', () => {
    const a = intent(30)
    expect(refusedWith(verdict(path(), [a, outcome(a, { status: 402 })]))).toContain('402')
    const b = intent(1000)
    expect(refusedWith(verdict(path(), [b, outcome(b, { status: 402 })]))).toContain('402')
    const c = intent(10)
    expect(refusedWith(verdict(path(), [c, outcome(c, { status: 429 })]))).toContain('429')
    // controls: the 429 has expired, and the 402 is a day old
    const d = intent(20)
    expect(
      verdict(path(), [
        d,
        outcome(d, { status: 429, at: new Date(NOW.getTime() - 20 * 60_000).toISOString() }),
      ]).ok,
    ).toBe(true)
    const e = intent(25 * 60)
    expect(verdict(path(), [e, outcome(e, { status: 402 })]).ok).toBe(true)
  })
})

describe('usage reads are a SEPARATE class: their own count, no window or source rule, not added to the log allowance', () => {
  const usage = (interval: string) =>
    `/v1/projects/p/analytics/endpoints/usage.api-counts?interval=${interval}`
  const usageRows = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      intent((i + 1) * 70, { kind: 'usage', sqlHash: sqlHash('') }),
    )
  it('allows every interval the endpoint offers, because nothing shows they consume the Logs Query meter', () => {
    for (const i of ['15min', '1hr', '1day', '3day', '7day'])
      expect(verdict(usage(i)).ok, i).toBe(true)
  })
  it('allows the single count (no interval) and needs no source filter', () => {
    expect(verdict('/v1/projects/p/analytics/endpoints/usage.api-requests-count').ok).toBe(true)
  })
  it('refuses the seventh usage read in 24 hours (our policy), and allows the sixth', () => {
    expect(verdict(usage('1day'), usageRows(5)).ok).toBe(true)
    expect(refusedWith(verdict(usage('1day'), usageRows(6)))).toContain('usage read')
  })
  it('usage reads do not spend the log allowance, and log queries do not spend the usage allowance', () => {
    // six usage reads leave the full six log queries available...
    expect(verdict(path(), usageRows(6)).ok).toBe(true)
    // ...and six log queries (180 window-minutes) leave the usage reads available
    const logs = Array.from({ length: DEFAULT_QUERIES }, (_, i) =>
      intent(70 + i * 70, { windowMin: 30 }),
    )
    expect(verdict(usage('1day'), logs).ok).toBe(true)
    // a usage read's interval is not window-minutes: a 7-day interval does not eat the 180
    expect(verdict(path({ mins: 60 }), [intent(100, { kind: 'usage', windowMin: 10080 })]).ok).toBe(
      true,
    )
  })
  it('still needs a stated reason, and a 402 or 429 from the analytics service stops usage reads too', () => {
    expect(refusedWith(verdict(usage('1day'), [], {} as Env))).toContain('LOG_QUERY_REASON')
    const a = intent(30, { kind: 'usage' })
    expect(refusedWith(verdict(usage('1day'), [a, outcome(a, { status: 402 })]))).toContain('402')
  })
})

describe('the emergency override: audited, narrow, and not a way round the ceilings', () => {
  const EMERGENCY =
    'incident 2026-10-06: need edge, auth and postgres streams together to place the first failing request'
  const multi = path({ sql: 'select count() from logs' })
  it('is the only thing that lets an unfiltered query through, and it is recorded as an override', () => {
    expect(refusedWith(verdict(multi))).toContain('`source`')
    const v = verdict(multi, [], { ...ok, LOG_QUERY_EMERGENCY_REASON: EMERGENCY })
    expect(v.ok && v.override).toBe('emergency')
    expect(v.ok && v.notes.join(' ')).toContain('EMERGENCY OVERRIDE')
  })
  it('needs a real reason: a short one overrides nothing', () => {
    expect(
      refusedWith(verdict(multi, [], { ...ok, LOG_QUERY_EMERGENCY_REASON: 'it is an emergency' })),
    ).toContain('`source`')
  })
  it('raises the allowances to their ceilings and the window to six hours, and no further', () => {
    const rows = Array.from({ length: DEFAULT_QUERIES }, (_, i) => intent(70 + i * 70))
    expect(verdict(multi, rows, { ...ok, LOG_QUERY_EMERGENCY_REASON: EMERGENCY }).ok).toBe(true)
    expect(
      verdict(path({ mins: 360 }), [], { ...ok, LOG_QUERY_EMERGENCY_REASON: EMERGENCY }).ok,
    ).toBe(true)
    expect(
      refusedWith(
        verdict(path({ mins: 361 }), [], { ...ok, LOG_QUERY_EMERGENCY_REASON: EMERGENCY }),
      ),
    ).toContain('360')
    expect(
      verdict(path({ mins: 1440 }), [], { ...ok, LOG_QUERY_EMERGENCY_REASON: EMERGENCY }).ok,
    ).toBe(false)
  })
  it('does not lift the breaker, the spacing or the cache rule', () => {
    const emergency = { ...ok, LOG_QUERY_EMERGENCY_REASON: EMERGENCY }
    const a = intent(30)
    expect(refusedWith(verdict(path(), [a, outcome(a, { status: 402 })], emergency))).toContain(
      '402',
    )
    expect(refusedWith(verdict(path(), [intent(0.5)], emergency))).toContain('wait')
  })
})

describe('bytes scanned: the cap fires only on a number the service reported', () => {
  it('says bytes are UNKNOWN while no response has reported them, so nobody reads the cap as a bound', () => {
    const v = verdict()
    expect(v.ok && v.notes.join(' ')).toContain('cannot fire')
  })
  it('stops saying so once a response has reported bytes', () => {
    const a = intent(100)
    const v = verdict(path(), [a, outcome(a, { bytesProcessed: 1000 })])
    expect(v.ok && v.notes.join(' ')).not.toContain('cannot fire')
  })
})

describe('the evidence of 4 and 5 October is preserved and pinned (no new query is ever needed to read it)', () => {
  const lines = (f: string): { kind: string; body: Record<string, unknown> }[] =>
    readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as { kind: string; body: Record<string, unknown> })
  it('holds 106 recorded log queries on 5 October and 4 on 4 October, every one answered 200', () => {
    const d5 = lines('docs/ops/evidence/2026-10-05/capture-2026-10-05.jsonl').filter(
      (r) => r.kind === 'logs2',
    )
    const d4 = lines('docs/ops/evidence/2026-10-05/capture-2026-10-04.jsonl').filter(
      (r) => r.kind === 'logs',
    )
    expect(d5.length).toBe(106)
    expect(d4.length).toBe(4)
    for (const r of [...d5, ...d4]) expect(r.body.status).toBe(200)
  })
  it('records calls and timing and never bytes scanned, which is why the 85 GB cannot be attributed from it', () => {
    const d5 = lines('docs/ops/evidence/2026-10-05/capture-2026-10-05.jsonl').filter(
      (r) => r.kind === 'logs2',
    )
    for (const r of d5) expect(Object.keys(r.body)).not.toContain('total_bytes_processed')
  })
  it('no saved usage response carries a bytes field either', () => {
    const dir = 'docs/ops/evidence/2026-10-05/usage'
    const files = readdirSync(dir).flatMap((d) =>
      readdirSync(join(dir, d)).map((f) => join(dir, d, f)),
    )
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toContain('total_bytes_processed')
  })
})

describe('the raise reason lifts the allowances to a hard ceiling and no further', () => {
  const raised = {
    ...ok,
    LOG_QUERY_RAISE_REASON: 'a six hour incident window needs the whole panel once',
  }
  it('allows a longer window with a stated raise, capped at six hours', () => {
    expect(
      verdict(path({ mins: 120 }), [], { ...raised, LOG_QUERY_MAX_WINDOW_MIN: '180' }).ok,
    ).toBe(true)
    expect(
      refusedWith(
        verdict(path({ mins: 400 }), [], { ...raised, LOG_QUERY_MAX_WINDOW_MIN: '9999' }),
      ),
    ).toContain('360')
  })
  it('never allows a whole day, with or without the raise reason', () => {
    expect(
      verdict(path({ mins: 1440 }), [], { ...raised, LOG_QUERY_MAX_WINDOW_MIN: '1440' }).ok,
    ).toBe(false)
  })
  it('the environment lowers freely but cannot raise without the reason', () => {
    expect(
      refusedWith(verdict(path({ mins: 30 }), [], { ...ok, LOG_QUERY_MAX_WINDOW_MIN: '20' })),
    ).toContain('20 minutes')
    expect(
      refusedWith(verdict(path({ mins: 120 }), [], { ...ok, LOG_QUERY_MAX_WINDOW_MIN: '180' })),
    ).toContain('60 minutes')
  })
  it('a thin raise reason raises nothing', () => {
    expect(
      refusedWith(
        verdict(path({ mins: 120 }), [], {
          ...ok,
          LOG_QUERY_RAISE_REASON: 'please',
          LOG_QUERY_MAX_WINDOW_MIN: '180',
        }),
      ),
    ).toContain('60 minutes')
  })
})

describe('the helpers', () => {
  it('hashes whitespace and case differences to the same query and different queries apart', () => {
    expect(sqlHash('select  1\nfrom logs')).toBe(sqlHash('SELECT 1 from   logs'))
    expect(sqlHash('select 1')).not.toBe(sqlHash('select 2'))
  })
  it('reads total_bytes_processed when present and leaves it absent, never zero, when not', () => {
    expect(bytesProcessedOf('{"total_bytes_processed":1234,"result":[]}')).toBe(1234)
    expect(bytesProcessedOf('{"result":[]}')).toBeUndefined()
    expect(bytesProcessedOf('not json')).toBeUndefined()
  })
})

describe('withLogGuard: nothing is sent when a rule is not met, and the ledger is written before the request', () => {
  let dir = ''
  let cwd = ''
  let ledger = ''
  const saved = { ...process.env }
  beforeEach(() => {
    cwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), 'logbudget-'))
    process.chdir(dir)
    ledger = join(dir, 'ledger.jsonl')
    process.env.LOG_QUERY_REASON = REASON
  })
  afterEach(() => {
    process.chdir(cwd)
    process.env = { ...saved }
  })
  const now = () => NOW

  it('refuses before calling send for an over-wide request (the sabotage control: send must not run)', async () => {
    let sent = 0
    await expect(
      withLogGuard(
        path({ mins: 1440 }),
        async () => {
          sent += 1
          return { status: 200, text: '{}' }
        },
        { ledger, now },
      ),
    ).rejects.toBeInstanceOf(LogQueryRefused)
    expect(sent).toBe(0)
    expect(readLedger(ledger)).toEqual([])
  })

  it('writes the intent first, then the outcome with the reported bytes, and a second identical call is spaced', async () => {
    let sent = 0
    const r = await withLogGuard(
      path(),
      async () => {
        sent += 1
        expect(readLedger(ledger).map((x) => x.phase)).toEqual(['intent'])
        return { status: 200, text: '{"total_bytes_processed":4096,"result":[]}' }
      },
      { ledger, now },
    )
    expect(r.status).toBe(200)
    const rows = readLedger(ledger)
    expect(rows.map((x) => x.phase)).toEqual(['intent', 'outcome'])
    expect(rows[1]?.bytesProcessed).toBe(4096)
    await expect(
      withLogGuard(path(), async () => ({ status: 200, text: '{}' }), { ledger, now }),
    ).rejects.toBeInstanceOf(LogQueryRefused)
    expect(sent).toBe(1)
  })

  it('does not touch a request that is not a log query', async () => {
    const r = await withLogGuard(
      '/v1/projects/p/database/query',
      async () => ({ status: 200, text: 'x' }),
      { ledger, now },
    )
    expect(r.text).toBe('x')
    expect(readLedger(ledger)).toEqual([])
  })
})

/*
  The wiring: every file in the repository that can reach the provider's log service must do it through the guard. This reads the
  source for the endpoint string, so a new script that builds the URL itself fails here until it uses withLogGuard or mgmt.
*/
describe('every path to the provider log service goes through the guard', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      if (f === 'node_modules' || f.startsWith('.')) return []
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|mjs|js)$/.test(f) ? [p] : []
    })
  const files = [...walk('scripts'), ...walk('src'), ...walk('supabase')]
  const reach = files.filter((f) =>
    /analytics\/endpoints\/(logs|usage\.)|analytics\/endpoints\/\$\{/.test(readFileSync(f, 'utf8')),
  )
  const allowed = new Set([
    'scripts/forensics/common.ts',
    'scripts/forensics/logs-capture.ts',
    'scripts/forensics/usage-capture.ts',
    'scripts/forensics/host-capture.ts',
    'scripts/incident-snapshot.ts',
    'src/safety/log-query-budget.ts',
    'scripts/forensics/log-guard.ts',
  ])
  it('names every file that builds a log or usage URL, and each is on the known list', () => {
    expect(reach.length).toBeGreaterThan(0)
    // the detector has to be able to see the known callers, or an empty result would pass for the wrong reason
    expect(reach).toContain('scripts/forensics/logs-capture.ts')
    for (const f of reach)
      expect(allowed.has(f), `${f} reaches the log service and is not on the guarded list`).toBe(
        true,
      )
  })
  it('each file on the list either sends through withLogGuard, mgmt (which applies it) or is the guard itself', () => {
    for (const f of reach) {
      if (f.endsWith('log-query-budget.ts') || f.endsWith('log-guard.ts')) continue
      const s = readFileSync(f, 'utf8')
      expect(/withLogGuard\(|await mgmt\(/.test(s), `${f} does not call the guard`).toBe(true)
    }
  })
  it('mgmt itself applies the guard to log requests (the sabotage that removes it must turn this red)', () => {
    const c = readFileSync('scripts/forensics/common.ts', 'utf8')
    expect(c).toMatch(/isLogQuery\(path\)\s*\?\s*withLogGuard\(path,/)
  })
  it('the defaults in the callers are one hour, not a day', () => {
    expect(readFileSync('scripts/forensics/logs-capture.ts', 'utf8')).toMatch(
      /flag\('hours'\) \?\? 1\)/,
    )
    expect(readFileSync('scripts/forensics/host-capture.ts', 'utf8')).toMatch(
      /flag\('hours'\) \?\? 1\)/,
    )
  })
})
