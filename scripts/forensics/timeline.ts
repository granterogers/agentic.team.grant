/**
 * One clock for the outage evidence (Supabase degradation forensics, 5 October 2026). READ ONLY: it reads `.out/forensics/` and
 * writes a markdown file; it asks nothing of the platform.
 *
 *   npm run forensics:timeline -- --out=docs/ops/forensics-timeline-2026-10-05.md
 *
 * Every column is MEASURED (a count, a time or a duration read from the provider's own log stream, usage API or our own readings);
 * nothing in the table is derived or inferred. A cell that no capture covers is `-`, never zero: a missing hour is not a quiet
 * hour. Hours before the second capture window come from the first (23:00 on 3 October to 23:00 on 4 October), which kept the
 * Postgres counts in ten-minute buckets and the checkpoint lines, so the left edge of the table reaches the first outage.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const ROOT = '.out/forensics'

type Row = Record<string, unknown>
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
const str = (v: unknown): string => String(v ?? '')
/** `2026-10-04T17:30:00` -> `2026-10-04T17`. Works for ISO strings with or without a zone. */
export const hourOf = (t: string): string => t.slice(0, 13)

/** The newest raw result of a named log query across every run directory, or [] when it was never captured. */
const latest = (name: string): Row[] => {
  const dirs = readdirSync(`${ROOT}/logs`).sort()
  for (let i = dirs.length - 1; i >= 0; i -= 1) {
    try {
      const j = JSON.parse(readFileSync(`${ROOT}/logs/${dirs[i]}/${name}.json`, 'utf8')) as {
        rows?: Row[]
      }
      return j.rows ?? []
    } catch {
      // not in this run
    }
  }
  return []
}

/** Records of one kind from every capture-<date>.jsonl, oldest first. */
const records = (kind: string): { at: string; body: Row }[] =>
  readdirSync(ROOT)
    .filter((f) => /^capture-.*\.jsonl$/.test(f))
    .sort()
    .flatMap((f) =>
      readFileSync(`${ROOT}/${f}`, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as { at: string; kind: string; body: Row })
        .filter((r) => r.kind === kind),
    )

export type Cols = Record<string, Record<string, number>>
const add = (c: Cols, hour: string, col: string, v: number, mode: 'sum' | 'max' = 'sum'): void => {
  const h = c[hour] ?? {}
  h[col] = mode === 'sum' ? (h[col] ?? 0) + v : Math.max(h[col] ?? 0, v)
  c[hour] = h
}

const SYNC = /sync=([\d.]+) s/
const BUFS = /wrote (\d+) buffers/

export const build = (): { cols: Cols; first: string } => {
  const cols: Cols = {}
  // First capture window: Postgres counts and checkpoint lines for 3-4 October, for the hours the second window does not reach.
  const old = records('logs').map((r) => r.body)
  const oldBy = (n: string): Row[] =>
    (old.find((b) => b.name === n)?.rows as Row[] | undefined) ?? []
  const cutoff = '2026-10-04T06'
  for (const r of oldBy('postgres_categories_by_10min')) {
    const h = hourOf(str(r.t))
    if (h >= cutoff) continue
    if (r.k === 'statement_timeout') add(cols, h, 'timeouts', num(r.n))
    if (r.k === 'connection_reset') add(cols, h, 'resets', num(r.n))
  }
  for (const r of oldBy('checkpoint_complete_lines')) {
    const h = hourOf(str(r.timestamp))
    if (h >= cutoff) continue
    const msg = str(r.event_message)
    add(cols, h, 'ckpts', 1)
    add(cols, h, 'ckptBufs', num(BUFS.exec(msg)?.[1]))
    add(cols, h, 'syncMaxS', num(SYNC.exec(msg)?.[1]), 'max')
  }
  // Second capture window.
  for (const r of latest('pg_events_10min')) {
    const h = hourOf(str(r.t))
    if (r.k === 'statement_timeout') add(cols, h, 'timeouts', num(r.n))
    if (r.k === 'client_reset') add(cols, h, 'resets', num(r.n))
    if (r.k === 'cron_start') add(cols, h, 'cron', num(r.n))
  }
  for (const r of latest('pg_checkpoints')) {
    const h = hourOf(str(r.timestamp))
    const msg = str(r.msg)
    add(cols, h, 'ckpts', 1)
    add(cols, h, 'ckptBufs', num(BUFS.exec(msg)?.[1]))
    add(cols, h, 'syncMaxS', num(SYNC.exec(msg)?.[1]), 'max')
  }
  for (const r of latest('pg_slow_by_hour')) {
    add(cols, hourOf(str(r.h)), 'slowN', num(r.n))
    add(cols, hourOf(str(r.h)), 'slowMaxS', num(r.max_ms) / 1000, 'max')
  }
  for (const r of latest('edge_families_10min')) {
    const h = hourOf(str(r.t))
    add(cols, h, 'gw', num(r.n))
    if (r.cls === '5xx') add(cols, h, 'gw5xx', num(r.n))
    add(cols, h, 'gwP95S', num(r.p95_ms) / 1000, 'max')
  }
  for (const r of latest('fn_edge_10min')) {
    const h = hourOf(str(r.t))
    add(cols, h, 'fn', num(r.n))
    if (['500', '502', '503', '504', '546'].includes(str(r.status))) add(cols, h, 'fnBad', num(r.n))
  }
  for (const r of latest('auth_10min')) {
    const h = hourOf(str(r.t))
    add(cols, h, 'auth', num(r.n))
    if (r.cls !== 'ok') add(cols, h, 'authBad', num(r.n))
  }
  for (const r of latest('pgbouncer_10min')) {
    if (r.k === 'tls') add(cols, hourOf(str(r.t)), 'pooler', num(r.n))
  }
  // The supported usage API (hourly for three days): the only source that reaches back before the log window.
  const usageDirs = readdirSync(`${ROOT}/usage`).sort()
  for (const d of usageDirs) {
    try {
      const j = JSON.parse(readFileSync(`${ROOT}/usage/${d}/api-counts-3day.json`, 'utf8')) as {
        body: string
      }
      const res = (JSON.parse(j.body) as { result: Row[] }).result
      for (const r of res) {
        const h = hourOf(str(r.timestamp))
        add(
          cols,
          h,
          'usage',
          num(r.total_auth_requests) +
            num(r.total_rest_requests) +
            num(r.total_storage_requests) +
            num(r.total_realtime_requests),
        )
      }
    } catch {
      // that run has no 3-day capture
    }
  }
  fillCoverage(
    cols,
    latest('pg_severity_10min').map((r) => hourOf(str(r.t))),
    oldBy('postgres_categories_by_10min').map((r) => hourOf(str(r.t))),
  )
  const first = Object.keys(cols).sort()[0] ?? ''
  return { cols, first }
}

const COUNTS_NEW = [
  'gw',
  'gw5xx',
  'fn',
  'fnBad',
  'auth',
  'authBad',
  'timeouts',
  'resets',
  'slowN',
  'cron',
  'ckpts',
  'ckptBufs',
  'pooler',
  'usage',
]
const COUNTS_OLD = ['timeouts', 'resets', 'ckpts', 'ckptBufs']

/** Every hour from `a` to `b` inclusive, as `YYYY-MM-DDTHH`. */
export const hoursBetween = (a: string, b: string): string[] => {
  const out: string[] = []
  for (let t = Date.parse(`${a}:00:00Z`); t <= Date.parse(`${b}:00:00Z`); t += 3_600_000)
    out.push(new Date(t).toISOString().slice(0, 13))
  return out
}

/**
 * `-` must mean "no capture covers this hour", never "nothing happened". For an hour a capture window DID cover, a count that
 * has no rows is a real zero, so it is written as 0. Coverage comes from the hours that capture actually returned rows for, not
 * from an assumption about its start and end: the first window kept only Postgres counts, so it zero-fills only those.
 */
export const fillCoverage = (cols: Cols, newHours: string[], oldHours: string[]): void => {
  const fill = (hours: string[], keys: string[]): void => {
    if (hours.length === 0) return
    const sorted = [...hours].sort()
    for (const h of hoursBetween(sorted[0] ?? '', sorted[sorted.length - 1] ?? '')) {
      const c = cols[h] ?? {}
      for (const k of keys) if (c[k] === undefined) c[k] = 0
      cols[h] = c
    }
  }
  fill(
    oldHours.filter((h) => h < '2026-10-04T06'),
    COUNTS_OLD,
  )
  fill(newHours, COUNTS_NEW)
}

const HEAD: [string, string][] = [
  ['usage', 'requests (usage API)'],
  ['gw', 'gateway req'],
  ['gw5xx', 'gateway 5xx'],
  ['gwP95S', 'gateway p95 s'],
  ['fn', 'fn calls'],
  ['fnBad', 'fn 5xx'],
  ['auth', 'auth req'],
  ['authBad', 'auth err'],
  ['timeouts', 'stmt timeouts'],
  ['resets', 'client resets'],
  ['slowN', 'slow stmts'],
  ['slowMaxS', 'slowest s'],
  ['ckpts', 'ckpts'],
  ['ckptBufs', 'ckpt bufs'],
  ['syncMaxS', 'fsync max s'],
  ['cron', 'cron starts'],
  ['pooler', 'pooler tls'],
]

const cell = (v: number | undefined, col: string): string =>
  v === undefined
    ? '-'
    : ['gwP95S', 'slowMaxS', 'syncMaxS'].includes(col)
      ? v.toFixed(v < 10 ? 2 : 0)
      : String(Math.round(v))

export const render = (cols: Cols): string => {
  const hours = Object.keys(cols).sort()
  const lines = [
    `| hour (UTC) | ${HEAD.map(([, h]) => h).join(' | ')} |`,
    `|---|${HEAD.map(() => '---:').join('|')}|`,
  ]
  for (const h of hours) {
    const c = cols[h] ?? {}
    lines.push(`| ${h.replace('T', ' ')}:00 | ${HEAD.map(([k]) => cell(c[k], k)).join(' | ')} |`)
  }
  return lines.join('\n')
}

const readings = (): string => {
  const out = ['| time (UTC) | provider health | metrics scrape |', '|---|---|---|']
  const health = records('health')
  const scrapes = [...records('scrape'), ...records('cmetrics')]
  for (const h of health) {
    const near = scrapes.find((s) => Math.abs(Date.parse(s.at) - Date.parse(h.at)) < 90_000)
    const sc =
      near === undefined
        ? '-'
        : `http ${str(near.body.status)}${near.body.ms === undefined ? '' : ` in ${str(near.body.ms)} ms`}`
    out.push(`| ${h.at.slice(0, 16).replace('T', ' ')} | ${str(h.body.label)} | ${sc} |`)
  }
  return out.join('\n')
}

const main = (): void => {
  const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6)
  const { cols } = build()
  const md = [
    '# Forensic timeline, one clock (generated)',
    '',
    'Generated by `npm run forensics:timeline` from the saved raw captures. **Every cell is MEASURED.** `-` means no capture covers that hour; it is NOT zero.',
    '',
    '## Provider health readings we took',
    '',
    readings(),
    '',
    '## Hour by hour',
    '',
    render(cols),
    '',
  ].join('\n')
  if (out === undefined) console.log(md)
  else {
    writeFileSync(out, md)
    console.log(`wrote ${out} (${String(Object.keys(cols).length)} hours)`)
  }
}

if (process.argv[1]?.endsWith('timeline.ts')) main()
