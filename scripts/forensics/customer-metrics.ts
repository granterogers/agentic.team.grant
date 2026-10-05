/**
 * The customer Metrics API collector (Supabase degradation forensics, 5 October 2026). READ ONLY.
 *
 *   npm run forensics:metrics -- --check               # is a secret API key available? names and types only, no value is read
 *   npm run forensics:metrics                          # ONE scrape now: raw kept whole, derived rates against the previous raw sample
 *   npm run forensics:metrics -- --watch=30 [--every=60]   # about one scrape a minute for up to 30 minutes; stops itself at the first failure
 *   npm run forensics:metrics -- --via=management|customer # force a route (default auto)
 *
 * Endpoint (current Supabase documentation): `GET https://<ref>.supabase.co/customer/v1/privileged/metrics`, HTTP Basic auth,
 * user `service_role`, password a SECRET API KEY (`sb_secret_...`). The vendor says to scrape about once a minute. The endpoint is
 * current-state only: it exports cumulative counters and gauges at the instant of the request and has no history parameter, so
 * the only history is the scrapes WE keep. Each one is saved whole (gzip) under `.out/forensics/metrics/`, named by epoch ms.
 *
 * The key. The project already has a secret key (named `default`). It is never created or rotated here. It comes from
 * `SUPABASE_SECRET_KEY` if set, otherwise a read in memory through the Management API's api-keys listing. On 5 October that read
 * was REFUSED (403, "not the necessary privileges") for this access token, so the customer route is unavailable until Grant either
 * puts the key in `SUPABASE_SECRET_KEY` or uses a token allowed to reveal it. The key is never printed, never written, never put
 * in a record and never sent anywhere except this project's own endpoint; every stored string is redacted and the key itself is
 * stripped by value. When the customer route is unavailable the collector uses the Management API's own Prometheus scrape (same
 * exposition, bearer token) and says so; which route a record used is written into the record.
 *
 * A failed scrape is evidence, not an absence of activity: status, duration, error name and a clipped body are recorded. Nothing
 * is retried, and a watch stops at the first non-200 answer, so a sick host is never hammered.
 */
import '../../src/safety/require-production-checks.ts'
import { readdirSync, readFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { redactSecrets } from '../../src/text/secrets.ts'
import { clean, evidenceDir, mgmt, REF, record, requireToken, saveRaw, sleep } from './common.ts'
import { familyCounts, parseAll } from './metrics.ts'
import { derive, memory } from './metrics-derive.ts'

requireToken()
const args = process.argv.slice(2)
const flag = (n: string): string | undefined =>
  args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`))?.split('=')[1] ??
  (args.includes(`--${n}`) ? '' : undefined)
const URL_ = `https://${REF}.supabase.co/customer/v1/privileged/metrics`
const SCRAPE_TIMEOUT_MS = 30_000

interface KeyInfo {
  readonly name: string
  readonly type: string
  readonly secretLike: boolean
}

/** Names and types of the project's API keys. No value is read: the listing is asked WITHOUT `reveal`. */
const listKeys = async (): Promise<{ status: number; keys: KeyInfo[] }> => {
  const r = await mgmt(`/v1/projects/${REF}/api-keys`, 20_000)
  if (r.status !== 200) return { status: r.status, keys: [] }
  try {
    const j = JSON.parse(r.text) as { name?: string; type?: string }[]
    return {
      status: 200,
      keys: j.map((k) => ({
        name: String(k.name),
        type: String(k.type),
        secretLike: k.type === 'secret',
      })),
    }
  } catch {
    return { status: 200, keys: [] }
  }
}

/** The secret key value, held in memory only. Returns null when none can be had (the reason is returned, never the value). */
const secretKey = async (): Promise<{ key: string | null; why: string }> => {
  const env = process.env.SUPABASE_SECRET_KEY ?? ''
  if (env.startsWith('sb_secret_')) return { key: env, why: 'from SUPABASE_SECRET_KEY' }
  const r = await mgmt(`/v1/projects/${REF}/api-keys?reveal=true`, 20_000)
  if (r.status !== 200)
    return { key: null, why: `api-keys listing answered http ${String(r.status)}` }
  try {
    const j = JSON.parse(r.text) as { name?: string; type?: string; api_key?: string }[]
    const secrets = j.filter((k) => k.type === 'secret' && typeof k.api_key === 'string')
    const pick = secrets.find((k) => k.name === 'default') ?? secrets[0]
    if (pick?.api_key === undefined || !pick.api_key.startsWith('sb_secret_'))
      return { key: null, why: 'no readable secret key in the listing' }
    return { key: pick.api_key, why: 'read in memory from the Management API api-keys listing' }
  } catch {
    return { key: null, why: 'api-keys listing unreadable' }
  }
}

interface Scrape {
  readonly at: string
  readonly status: number
  readonly ms: number
  readonly error: string | null
  readonly bytes: number
  readonly text: string
  readonly headers: Record<string, string>
}

/**
 * Two supported routes to the SAME exposition. `customer` is the documented one (Basic auth with the secret key, straight to the
 * project's own gateway). `management` is the Management API's Prometheus scrape (`/analytics/endpoints/metrics`, bearer token),
 * which fetches it on our behalf and can answer 400/500 when the project is not active and healthy. Which one a record used is
 * written into the record, because a failure on one route says nothing about the other.
 */
type Via = 'customer' | 'management'
const MGMT_URL = `https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/metrics`

const scrapeOnce = async (via: Via, key: string | null): Promise<Scrape> => {
  const at = new Date().toISOString()
  const t = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), SCRAPE_TIMEOUT_MS)
  try {
    const r = await fetch(via === 'customer' ? URL_ : MGMT_URL, {
      headers:
        via === 'customer'
          ? {
              Authorization: `Basic ${Buffer.from(`service_role:${key ?? ''}`).toString('base64')}`,
              Accept: 'text/plain',
            }
          : {
              Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN ?? ''}`,
              Accept: 'text/plain',
            },
      signal: ctl.signal,
    })
    const text = await r.text()
    const headers: Record<string, string> = {}
    for (const h of [
      'content-type',
      'x-envoy-upstream-service-time',
      'retry-after',
      'sb-request-id',
    ])
      headers[h] = r.headers.get(h) ?? ''
    return {
      at,
      status: r.status,
      ms: Date.now() - t,
      error: null,
      bytes: text.length,
      text,
      headers,
    }
  } catch (e) {
    const name = e instanceof Error ? e.name : String(e)
    return { at, status: 0, ms: Date.now() - t, error: name, bytes: 0, text: '', headers: {} }
  } finally {
    clearTimeout(timer)
  }
}

/** The most recent raw sample kept on disk, for a rate. Returns null when there is none. */
const previous = (): { at: number; text: string } | null => {
  try {
    const dir = `${evidenceDir}/metrics`
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.prom.gz'))
      .sort()
    const last = files[files.length - 1]
    if (last === undefined) return null
    // Raw samples are named by epoch milliseconds, so the sort above is chronological and the time needs no parsing.
    const at = Number(last.replace('.prom.gz', ''))
    if (!Number.isFinite(at)) return null
    return { at, text: gunzipSync(readFileSync(`${dir}/${last}`)).toString('utf8') }
  } catch {
    return null
  }
}

const show = (label: string, v: unknown): void => console.log(`  ${label}: ${JSON.stringify(v)}`)

const once = async (via: Via, key: string | null): Promise<boolean> => {
  const s = await scrapeOnce(via, key)
  // The key is stripped by value from anything that could echo it, then the generic redactor runs.
  const body = clean(key === null ? s.text : s.text.split(key).join('[key]'), 240)
  if (s.status !== 200) {
    record('cmetrics', {
      at: s.at,
      via,
      status: s.status,
      ms: s.ms,
      error: s.error,
      headers: s.headers,
      body: s.status === 0 ? '' : redactSecrets(body),
    })
    console.log(
      `metrics via ${via}: http ${String(s.status)} after ${String(s.ms)} ms${s.error === null ? '' : ` (${s.error})`}${body === '' ? '' : ` | ${body.slice(0, 120)}`}  [recorded; not retried]`,
    )
    return false
  }
  const prev = previous()
  const raw = saveRaw(
    'metrics',
    `${String(Date.parse(s.at))}.prom.gz`,
    gzipSync(Buffer.from(s.text, 'utf8')),
  )
  const samples = parseAll(s.text)
  const mem = memory(samples)
  const fams = familyCounts(samples)
  record('cmetrics', {
    at: s.at,
    via,
    status: 200,
    ms: s.ms,
    bytes: s.bytes,
    headers: s.headers,
    series: samples.length,
    families: Object.keys(fams).length,
    raw,
    memory: mem,
  })
  console.log(
    `metrics via ${via}: http 200 in ${String(s.ms)} ms, ${String(s.bytes)} bytes, ${String(samples.length)} series in ${String(Object.keys(fams).length)} families`,
  )
  show('memory (MiB)', mem)
  const pgFamilies = Object.keys(fams).filter((n) => /^(pg_|postgres)/.test(n))
  show(
    'postgres series exported',
    pgFamilies.length === 0
      ? 'NONE in this scrape'
      : `${String(pgFamilies.length)} families, e.g. ${pgFamilies.slice(0, 4).join(', ')}`,
  )
  for (const n of [
    'postgresql_restarts_total',
    'node_vmstat_oom_kill',
    'node_load1',
    'supavisor_connections_active',
  ])
    if (fams[n] !== undefined)
      show(
        n,
        samples.filter((x) => x.name === n).map((x) => x.value),
      )
  if (prev !== null) {
    const secs = (Date.parse(s.at) - prev.at) / 1000
    if (secs >= 20 && secs <= 900) {
      const d = derive(parseAll(prev.text), samples, secs)
      record('cmetrics_rates', { at: s.at, ...d })
      console.log(`  over ${String(Math.round(secs))} s since the previous raw sample:`)
      show('cpu %', d.cpuPercent)
      show('swap in/out pages/s', [d.swapInPagesPerS, d.swapOutPagesPerS])
      show('major faults/s', d.majorFaultsPerS)
      for (const [dev, v] of Object.entries(d.devices)) show(`disk ${dev} [${v.role}]`, v)
      show('postgres counter deltas', d.pgDeltas)
    } else {
      console.log(
        `  previous raw sample is ${String(Math.round(secs))} s away: no rate is computed across that gap`,
      )
    }
  } else {
    console.log('  no previous raw sample: this one is the baseline for the next rate')
  }
  return true
}

if (flag('check') !== undefined) {
  const k = await listKeys()
  console.log(`api-keys listing (names and types only, no value): http ${String(k.status)}`)
  for (const x of k.keys) console.log(`  ${x.name} [${x.type}]`)
  record('cmetrics_check', { status: k.status, keys: k.keys })
  console.log(
    `a secret key ${k.keys.some((x) => x.secretLike) ? 'EXISTS (not created, not rotated, value not read)' : 'does NOT exist: one would need to be created, which needs approval'}`,
  )
} else {
  // --via=customer | management | auto (default). Auto uses the documented customer route when the secret key can be read, and
  // otherwise the Management API route; the reason the customer route was not used is printed and recorded, never silent.
  const want = flag('via') ?? 'auto'
  let via: Via = 'management'
  let key: string | null = null
  if (want !== 'management') {
    const got = await secretKey()
    key = got.key
    if (key === null) {
      console.log(`customer route unavailable: ${got.why}`)
      record('cmetrics_route', { want, customer: 'unavailable', why: got.why })
      if (want === 'customer') process.exit(1)
    } else {
      via = 'customer'
      console.log(`secret key: ${got.why} (the value is never printed or stored)`)
    }
  }
  console.log(`scrape route: ${via}`)
  const minutes = Math.min(60, Number(flag('watch') ?? 0))
  const every = Math.max(60, Number(flag('every') ?? 60))
  const ok = await once(via, key)
  if (ok && minutes > 0) {
    const until = Date.now() + minutes * 60_000
    while (Date.now() + every * 1000 < until) {
      await sleep(every * 1000)
      if (!(await once(via, key))) {
        console.log('STOPPED: a scrape failed. A watch never keeps asking a sick host.')
        break
      }
    }
  }
  if (!ok) process.exitCode = 1
}
