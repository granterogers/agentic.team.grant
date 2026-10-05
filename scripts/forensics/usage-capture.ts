/**
 * The project's request counts from the supported usage API (Supabase degradation forensics, 5 October 2026). READ ONLY.
 *
 *   npm run forensics:usage
 *
 * `GET /v1/projects/<ref>/analytics/endpoints/usage.api-counts?interval=<15min|30min|1hr|3hr|1day|3day|7day>` returns timestamped
 * `total_auth_requests`, `total_realtime_requests`, `total_rest_requests` and `total_storage_requests`. It answers the question
 * "does failure follow real application traffic, or does it happen under an idle workload". Each interval is asked ONCE, a few
 * seconds apart; a 429 or a server error stops the run. The raw response is saved whole, with the status and duration, and the
 * granularity the API actually returns is recorded rather than assumed.
 *
 * `usage.api-requests-count` is also read once (a single count, no time axis).
 */
import '../../src/safety/require-production-checks.ts'
import { mgmt, REF, record, requireToken, saveRaw, sleep } from './common.ts'

requireToken()
const INTERVALS = (
  process.argv.find((a) => a.startsWith('--intervals='))?.slice(12) ?? '1day,3day,7day'
)
  .split(',')
  .filter((x) => x !== '')
const run = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16)

const asks: { name: string; path: string }[] = [
  ...INTERVALS.map((i) => ({
    name: `api-counts-${i}`,
    path: `/v1/projects/${REF}/analytics/endpoints/usage.api-counts?interval=${i}`,
  })),
  {
    name: 'api-requests-count',
    path: `/v1/projects/${REF}/analytics/endpoints/usage.api-requests-count`,
  },
]
let first = true
for (const a of asks) {
  if (!first) await sleep(5000)
  first = false
  const r = await mgmt(a.path, 60_000)
  let points = 0
  let note = r.error === null ? '' : `transport: ${r.error}`
  try {
    const j = JSON.parse(r.text) as { result?: unknown[]; error?: unknown }
    points = Array.isArray(j.result) ? j.result.length : 0
    if (j.error !== undefined && j.error !== null) note = JSON.stringify(j.error).slice(0, 200)
  } catch {
    note = r.text.slice(0, 120)
  }
  const file = saveRaw(
    `usage/${run}`,
    `${a.name}.json`,
    JSON.stringify({ name: a.name, path: a.path, status: r.status, ms: r.ms, note, body: r.text }),
  )
  record('usage', { name: a.name, status: r.status, ms: r.ms, points, note, file })
  console.log(
    `usage ${a.name}: http ${String(r.status)} in ${String(r.ms)} ms, ${String(points)} point(s)${note === '' ? '' : ` (${note})`}`,
  )
  if (r.status === 0 || r.status === 429 || r.status >= 500) {
    console.log(`STOPPED at ${a.name}: http ${String(r.status)}. Nothing further is asked.`)
    process.exitCode = 1
    break
  }
}
console.log(`raw results in .out/forensics/usage/${run}/`)
