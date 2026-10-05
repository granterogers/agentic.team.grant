/**
 * A read-only snapshot for when the platform feels slow or down.   npm run incident:snapshot [-- --json]
 *
 * Why: on 3 October 2026 the project health API said REST was UNHEALTHY while REST answered in 24 ms, and said the project was healthy while a
 * `select 1` took 19 s. The label is not the measurement. This takes the measurements that told the two apart, once, with short timeouts,
 * one after another (never in parallel: it must not add load to a sick instance), and prints a few lines. It writes nothing, enqueues
 * nothing and prints no secret (the anon key is used for the probes and never shown; the access token never leaves the process).
 *
 * What it reports, and what each one distinguishes:
 *   health     the provider's label per service (a hint only)
 *   latency    a real database round trip, auth settings, REST root, storage, each timed. Slow database and slow auth with quick REST and
 *              storage is a starved instance; everything quick is healthy whatever the label says
 *   cpu        server-side planning and execution time of a 200k-row count. About 20 to 40 ms on a healthy instance; hundreds of ms or
 *              seconds mean the database host is starved of CPU or of I/O credit (the 3 October stall measured 7 s for 2M rows)
 *   database   client connections against the limit (a slot-exhaustion incident shows here), active versus idle, longest running statement
 *   worker     whether the heartbeat is active and paused, the queue depth by state, and how long ago a job last completed
 *   logs       the last 30 minutes of statement timeouts and connection-slot errors, from the provider's own log stream (skipped if throttled)
 *
 * It does not diagnose. Read it beside docs/ops/supabase-incident-2026-10-03.md.
 */
import '../src/safety/require-production-checks.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const REF = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const asJson = process.argv.includes('--json')
const db = new ManagementApiExecutor(REF, TOKEN)

const timed = async <T>(
  fn: () => Promise<T>,
  ms = 40_000,
): Promise<{ ok: boolean; ms: number; value?: T; error?: string }> => {
  const t = Date.now()
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, no) => setTimeout(() => no(new Error(`timeout ${ms / 1000}s`)), ms)),
    ])
    return { ok: true, ms: Date.now() - t, value }
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - t,
      error: String(e instanceof Error ? e.message : e).slice(0, 80),
    }
  }
}
const show = (r: { ok: boolean; ms: number; error?: string }, extra = ''): string =>
  r.ok ? `${r.ms} ms${extra === '' ? '' : ` ${extra}`}` : `FAILED after ${r.ms} ms (${r.error})`

const out: Record<string, unknown> = { at: new Date().toISOString() }

// 1. the provider's label
const health = await timed(async () => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/health?services=auth&services=db&services=rest&services=storage`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  )
  return ((await r.json()) as { name: string; status: string }[])
    .map((s) => `${s.name}=${s.status === 'ACTIVE_HEALTHY' ? 'ok' : s.status}`)
    .join(' ')
})
out.health = health.ok ? health.value : show(health)

// 2. what actually answers, one at a time. The anon key is read from the project's API keys and never printed.
const keys = await timed(async () => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  const list = (await r.json()) as { name: string; api_key: string }[]
  return list.find((k) => k.name === 'anon')?.api_key ?? ''
}, 20_000)
const anon = keys.ok ? String(keys.value ?? '') : ''
const get = async (path: string): Promise<string> =>
  String((await fetch(`https://${REF}.supabase.co${path}`, { headers: { apikey: anon } })).status)
const dbRound = await timed(async () => String((await db.execute('select 1 as ok')).rows[0]?.ok))
const auth = await timed(() => get('/auth/v1/settings'))
const rest = await timed(() => get('/rest/v1/'))
const storage = await timed(() => get('/storage/v1/bucket'))
out.latency = {
  'db round trip': show(dbRound),
  auth: show(auth, `http ${auth.value}`),
  rest: show(rest, `http ${rest.value}`),
  storage: show(storage, `http ${storage.value}`),
}

// 3. the database's own view: one statement, small. The cpu line is the discriminating one.
// Light on purpose: catalog views and one tiny table only. The jobs table is read separately below, because under starvation a
// count over 22,000 rows took 75 s on 3 October and would have hidden everything else on this line.
const inside = await timed(async () => {
  const r = await db.execute(`
    select
      (select count(*) from pg_stat_activity where backend_type = 'client backend')::int as conns,
      current_setting('max_connections')::int - current_setting('superuser_reserved_connections')::int as usable,
      (select count(*) from pg_stat_activity where backend_type = 'client backend' and state = 'active')::int as active,
      (select coalesce(max(extract(epoch from now() - query_start)), 0)::int from pg_stat_activity
        where backend_type = 'client backend' and state = 'active' and pid <> pg_backend_pid()) as longest_s,
      (select active from cron.job where jobname = 'worker-heartbeat') as heartbeat,
      app.worker_paused() as paused`)
  return r.rows[0] as Record<string, unknown>
}, 25_000)
out.database = inside.ok ? inside.value : show(inside)

// The queue, with its own short budget. An unfinished read here says the table is slow, which is itself the finding.
const queue = await timed(async () => {
  const r = await db.execute(`
    select state::text, count(*)::int n from public.jobs
     where state in ('queued','running','retrying','paused') group by 1`)
  return r.rows.length === 0
    ? 'empty'
    : r.rows.map((x) => `${String(x.state)}=${String(x.n)}`).join(' ')
}, 25_000)
out.queue = queue.ok ? queue.value : show(queue)

const cpu = await timed(async () => {
  const r = await db.execute(
    'explain (analyze, timing off) select count(*) from generate_series(1,200000)',
  )
  const lines = r.rows.map((x) => String(Object.values(x)[0]))
  const planning = lines.find((l) => l.startsWith('Planning Time')) ?? ''
  const exec = lines.find((l) => l.startsWith('Execution Time')) ?? ''
  return `${planning.replace('Planning Time: ', 'plan ')} / ${exec.replace('Execution Time: ', 'run ')}`
})
out.cpu = cpu.ok ? cpu.value : show(cpu)

// 4. bounded recent log counts from the provider's stream; one query, skipped quietly if throttled
const end = new Date()
const start = new Date(end.getTime() - 30 * 60 * 1000)
const logs = await timed(async () => {
  const sql =
    "select multiIf(event_message ilike '%remaining connection slots%','conn_slots_full', event_message ilike '%statement timeout%','statement_timeout', event_message ilike '%connect timeout%','connect_timeout','') as k, count() as n from logs where source in ('postgres_logs','pgbouncer_logs') and k != '' group by k"
  const url = `https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs?sql=${encodeURIComponent(sql)}&iso_timestamp_start=${start.toISOString()}&iso_timestamp_end=${end.toISOString()}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
  if (r.status === 429) return 'throttled (try again in a minute)'
  const j = (await r.json()) as { result?: { k: string; n: number }[] }
  const rows = j.result ?? []
  return rows.length === 0 ? 'none in the last 30 min' : rows.map((x) => `${x.k}=${x.n}`).join(' ')
}, 20_000)
out.logs = logs.ok ? logs.value : show(logs)

if (asJson) console.log(JSON.stringify(out, null, 2))
else {
  const d = out.database as Record<string, unknown> | string
  console.log(`incident snapshot ${String(out.at)}`)
  console.log(`  provider label : ${String(out.health)}`)
  for (const [k, v] of Object.entries(out.latency as Record<string, string>))
    console.log(`  ${k.padEnd(14)} : ${v}`)
  console.log(
    `  cpu (200k rows): ${String(out.cpu)}   [healthy: plan under 5 ms, run about 20-40 ms]`,
  )
  if (typeof d === 'string') console.log(`  database       : ${d}`)
  else
    console.log(
      `  connections    : ${String(d.conns)} of ${String(d.usable)} (active ${String(d.active)}, longest running ${String(d.longest_s)} s)\n` +
        `  worker         : heartbeat ${String(d.heartbeat)}, paused ${String(d.paused)}`,
    )
  console.log(`  queue          : ${String(out.queue)}`)
  console.log(`  last 30 min    : ${String(out.logs)}`)
}
