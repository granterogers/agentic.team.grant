/**
 * The provider's unified log stream, captured raw and bounded (Supabase degradation forensics, 5 October 2026). READ ONLY.
 *
 *   npm run forensics:logs -- --set=probe                 # which sources exist, their time range, one attribute map each
 *   npm run forensics:logs -- --set=<name>[,<name>...]    # named sets from logs-queries.ts (or --set=all)
 *   npm run forensics:logs -- --set=all --hours=24        # a whole-window capture (the default window is 24 h)
 *
 * The endpoint is `GET /v1/projects/<ref>/analytics/endpoints/logs`, the CURRENT one. `logs.all` is retired and answers 410, and
 * is never called here. SQL is the ClickHouse dialect over the unified `logs` table (`source` selects the stream). The window is at
 * most 24 hours and is rounded to the minute. The stream is a separate service from the project's database, so this is safe to run
 * while the database is down; it is also the one capture whose evidence EXPIRES.
 *
 * Rate: one query every 65 seconds. A 429 (rate limit), 402 (usage exceeded), any 5xx or a timeout STOPS the run and records why;
 * nothing is retried. Each result is written whole to `.out/forensics/logs/<run>/<name>.json` with the query, the window, the
 * status and the duration, and a one-line summary is appended to the day's evidence file. String values are redacted and clipped.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import {
  clean,
  cleanRow,
  evidenceDir,
  mgmt,
  REF,
  record,
  requireToken,
  saveRaw,
  sleep,
} from './common.ts'
import { LOG_SETS } from './logs-queries.ts'

requireToken()
const args = process.argv.slice(2)
const flag = (n: string): string | undefined =>
  args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const wanted = (flag('set') ?? '').split(',').filter((x) => x !== '')
const hours = Math.min(24, Number(flag('hours') ?? 24))
const gap = Math.max(65, Number(flag('gap') ?? 65)) * 1000
if (wanted.length === 0) {
  console.error(`Choose --set=probe, --set=all or names from: ${Object.keys(LOG_SETS).join(', ')}`)
  process.exit(2)
}
const probes = Object.keys(LOG_SETS).filter((n) => n.startsWith('probe_'))
// A name ending in an asterisk selects every set with that prefix (for example pg_* or edge_*), so a long capture can be split into
// runs that each fit a shell's ten-minute ceiling.
const names = wanted.flatMap((n) =>
  n === 'all'
    ? Object.keys(LOG_SETS).filter((x) => !x.startsWith('probe_'))
    : n === 'probe'
      ? probes
      : n.endsWith('*')
        ? Object.keys(LOG_SETS).filter((x) => x.startsWith(n.slice(0, -1)))
        : [n],
)
const unknown = names.filter((n) => LOG_SETS[n] === undefined)
if (unknown.length > 0) {
  console.error(`Unknown set(s): ${unknown.join(', ')}`)
  process.exit(2)
}

// --start/--end ask for an explicit window (at most 24 hours, rounded to the minute by the service). It is how retention is tested:
// a window older than the one already captured either returns rows or does not.
// --day=YYYY-MM-DD selects that UTC day (00:00 to 24:00, or to now for today). A baseline day is captured with the same panel
// as an outage day so the two can be compared hour for hour.
const dayFlag = flag('day')
const dayStart = dayFlag === undefined ? null : new Date(`${dayFlag}T00:00:00Z`)
const end =
  dayStart !== null
    ? new Date(Math.min(dayStart.getTime() + 24 * 3600 * 1000, Date.now()))
    : flag('end') === undefined
      ? new Date()
      : new Date(flag('end') ?? '')
end.setSeconds(0, 0)
const start =
  dayStart !== null
    ? dayStart
    : flag('start') === undefined
      ? new Date(end.getTime() - hours * 3600 * 1000)
      : new Date(flag('start') ?? '')
// --tag=<name> names the run directory for a window captured around a known transition (win-<name>).
const tag = flag('tag')
const run =
  tag !== undefined
    ? `win-${tag}`
    : dayFlag === undefined
      ? end.toISOString().replace(/[:.]/g, '-').slice(0, 16)
      : `day-${dayFlag}`
// The service allows about one query a minute. The spacing is enforced across RUNS too, through a stamp file, so two commands
// started back to back cannot add up to a burst.
const STAMP = `${evidenceDir}/.last-log-query`
const waitForTurn = async (): Promise<void> => {
  let last = 0
  try {
    last = Number(readFileSync(STAMP, 'utf8'))
  } catch {
    // no earlier query
  }
  const wait = last + gap - Date.now()
  if (wait > 0) await sleep(wait)
}
for (const name of names) {
  const q = LOG_SETS[name]
  if (q === undefined) continue
  await waitForTurn()
  writeFileSync(STAMP, String(Date.now()))
  const url = `/v1/projects/${REF}/analytics/endpoints/logs?sql=${encodeURIComponent(q.sql)}&iso_timestamp_start=${start.toISOString()}&iso_timestamp_end=${end.toISOString()}`
  const r = await mgmt(url, 70_000)
  let rows: unknown[] = []
  let note = r.error === null ? '' : `transport: ${r.error}`
  try {
    const j = JSON.parse(r.text) as { result?: unknown[]; error?: unknown }
    rows = Array.isArray(j.result) ? (j.result.map((x) => cleanRow(x)) as unknown[]) : []
    if (j.error !== undefined && j.error !== null) note = clean(JSON.stringify(j.error), 300)
  } catch {
    if (r.text !== '') note = clean(r.text, 200)
  }
  const file = saveRaw(
    `logs/${run}`,
    `${name}.json`,
    JSON.stringify({
      name,
      why: q.why,
      sql: q.sql,
      window: [start.toISOString(), end.toISOString()],
      status: r.status,
      ms: r.ms,
      note,
      rows,
    }),
  )
  record('logs2', { name, status: r.status, ms: r.ms, rows: rows.length, note, file })
  console.log(
    `logs ${name}: http ${String(r.status)} in ${String(r.ms)} ms, ${String(rows.length)} row(s)${note === '' ? '' : ` (${note})`}`,
  )
  // A refusal or a sick service is itself the finding; asking again is only more load.
  if (r.status === 0 || r.status === 429 || r.status === 402 || r.status >= 500) {
    console.log(
      `STOPPED at ${name}: http ${String(r.status)}. Nothing further is asked, nothing is retried.`,
    )
    process.exitCode = 1
    break
  }
}
console.log(`raw results in .out/forensics/logs/${run}/`)
