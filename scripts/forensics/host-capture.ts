/**
 * The capture protocol, as a tool (Supabase degradation forensics, 4 October 2026). READ ONLY. Changes nothing, ever.
 *
 *   npm run forensics:capture -- --control-plane            # health label, two metrics scrapes 60 s apart, rates
 *   npm run forensics:capture -- --logs                     # the provider's log stream for the window, 1 query / 65 s
 *   npm run forensics:capture -- --db                       # database statistics; REFUSES unless the host answers fast
 *   npm run forensics:capture -- --watch=30 --every=60      # a bounded run of scrapes; stops itself on any degradation
 *
 * Why three modes: they have different blast radii, and the outage rule is that nothing touches the database while the
 * platform is unhealthy.
 *
 *   --control-plane   Management API only. The health label, and the project's Prometheus scrape (node memory, swap,
 *                     paging, CPU by mode, disk bytes and I/O time, pressure-stall information if exported). The scrape is
 *                     served by the host's exporters; the Postgres series in it are read by an exporter connection, so on a
 *                     sick host it may answer 500/504, which is recorded as a finding and never retried.
 *   --logs            The analytics log endpoint (a separate service from the project's database; throttled to one query a
 *                     minute, a 24-hour window). The one capture whose evidence EXPIRES, so it is safe to run while the
 *                     database is down and is the thing to do first.
 *   --db              Runs statements on the project's database. Refuses to start unless a trivial statement answers inside
 *                     two seconds, and stops at the first slow one. Never run while the provider says anything is unhealthy.
 *
 * Output: one JSON line per capture appended to `.out/forensics/capture-<UTC date>.jsonl` (gitignored), and a short summary on
 * stdout. The access token is read from SUPABASE_ACCESS_TOKEN and is never printed. Log lines pass through `redactSecrets` and
 * are truncated, because a Postgres error line can carry a statement.
 */
import '../../src/safety/require-production-checks.ts'
import { appendFileSync, mkdirSync } from 'node:fs'
import { redactSecrets } from '../../src/text/secrets.ts'
import { answered, parseMetrics, qualify, rates, snapshot } from './metrics.ts'

const REF = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const args = process.argv.slice(2)
const flag = (n: string): string | undefined =>
  args.find((a) => a === `--${n}` || a.startsWith(`--${n}=`))?.split('=')[1] ??
  (args.includes(`--${n}`) ? '' : undefined)
const has = (n: string): boolean => flag(n) !== undefined
const API = 'https://api.supabase.com'

if (TOKEN === '') {
  console.error(
    'SUPABASE_ACCESS_TOKEN is not set (read it from the vault or your shell; it is never printed).',
  )
  process.exit(2)
}
if (!has('control-plane') && !has('logs') && !has('db') && !has('watch')) {
  console.error(
    'Choose a mode: --control-plane, --logs, --db or --watch=<minutes>. See the header of this file.',
  )
  process.exit(2)
}

const day = new Date().toISOString().slice(0, 10)
mkdirSync('.out/forensics', { recursive: true })
const file = `.out/forensics/capture-${day}.jsonl`
const record = (kind: string, body: unknown): void => {
  appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), kind, body })}\n`)
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const get = async (
  path: string,
  ms: number,
): Promise<{ status: number; ms: number; text: string }> => {
  const t = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: ctl.signal,
    })
    return { status: r.status, ms: Date.now() - t, text: await r.text() }
  } catch (e) {
    return { status: 0, ms: Date.now() - t, text: String(e instanceof Error ? e.name : e) }
  } finally {
    clearTimeout(timer)
  }
}

const health = async (): Promise<{ ok: boolean; label: string }> => {
  const r = await get(
    `/v1/projects/${REF}/health?services=auth&services=db&services=rest&services=storage`,
    20_000,
  )
  if (r.status !== 200)
    return { ok: false, label: `health endpoint ${String(r.status)} after ${String(r.ms)} ms` }
  try {
    const s = JSON.parse(r.text) as { name: string; status: string }[]
    return {
      ok: s.every((x) => x.status === 'ACTIVE_HEALTHY'),
      label: s.map((x) => `${x.name}=${x.status === 'ACTIVE_HEALTHY' ? 'ok' : x.status}`).join(' '),
    }
  } catch {
    return { ok: false, label: 'health answer unreadable' }
  }
}

const scrape = async (): Promise<{
  ok: boolean
  ms: number
  status: number
  samples: ReturnType<typeof parseMetrics>
}> => {
  const r = await get(`/v1/projects/${REF}/analytics/endpoints/metrics`, 40_000)
  return {
    ok: r.status === 200,
    ms: r.ms,
    status: r.status,
    samples: r.status === 200 ? parseMetrics(r.text) : [],
  }
}

const controlPlane = async (gapSeconds: number): Promise<boolean> => {
  const h = await health()
  console.log(`health: ${h.label}`)
  record('health', h)
  // Three cheap control-plane facts that bear on the mechanism: the project's own status word, whether the database has been
  // put in read-only mode (a full disk does that), and how much of the volume is used.
  const status = await get(`/v1/projects/${REF}`, 20_000)
  const readonlyMode = await get(`/v1/projects/${REF}/readonly`, 20_000)
  const disk = await get(`/v1/projects/${REF}/config/disk/util`, 20_000)
  const pick = (r: { status: number; text: string }, keys: string[]): unknown => {
    if (r.status !== 200) return `http ${String(r.status)}`
    try {
      const j = JSON.parse(r.text) as Record<string, unknown>
      return keys.length === 0 ? j : Object.fromEntries(keys.map((k) => [k, j[k]]))
    } catch {
      return 'unreadable'
    }
  }
  const context = {
    project: pick(status, ['status']),
    readonly: pick(readonlyMode, []),
    diskUtil: pick(disk, []),
  }
  record('context', context)
  console.log(`context: ${JSON.stringify(context)}`)
  const a = await scrape()
  record('scrape', {
    ok: a.ok,
    status: a.status,
    ms: a.ms,
    series: a.samples.length,
    snapshot: a.ok ? snapshot(a.samples) : null,
  })
  if (!a.ok) {
    console.log(
      `metrics scrape: ${String(a.status)} after ${String(a.ms)} ms (a sick host often refuses this; recorded, not retried)`,
    )
    return false
  }
  const sn = snapshot(a.samples)
  console.log(
    `memory: ${String(sn.memTotalMiB)} MiB total, ${String(sn.memAvailableMiB)} available; swap ${String(sn.swapUsedMiB)} of ${String(sn.swapTotalMiB)} MiB used; oom kills ${String(sn.oomKills)}`,
  )
  console.log(
    `pressure-stall series exported: ${Object.values(sn.pressure).some((v) => v !== null) ? 'yes' : 'NO (the kernel PSI series are not in this scrape)'}`,
  )
  console.log(
    `temp files: ${String(sn.tempFiles)} / ${String(sn.tempBytes)} bytes since the counter began; backends ${String(sn.backends)}`,
  )
  if (gapSeconds > 0) {
    await sleep(gapSeconds * 1000)
    const b = await scrape()
    record('scrape', { ok: b.ok, status: b.status, ms: b.ms, series: b.samples.length })
    if (b.ok) {
      const r = rates(a.samples, b.samples, gapSeconds)
      record('rates', r)
      console.log(
        `over ${String(gapSeconds)} s: swap in ${String(r.swapInPagesPerS)} / out ${String(r.swapOutPagesPerS)} pages/s, major faults ${String(r.majorFaultsPerS)}/s`,
      )
      console.log(
        `  cpu %: ${JSON.stringify(r.cpu)}  disk read ${String(r.diskReadMBps)} MB/s write ${String(r.diskWriteMBps)} MB/s, busiest disk busy ${String(r.diskBusyShare)}`,
      )
      console.log(
        `  pressure share of wall time: ${JSON.stringify(r.pressureShare)}  temp ${String(r.tempMiBPerMin)} MiB/min`,
      )
    } else {
      console.log(`second scrape: ${String(b.status)} after ${String(b.ms)} ms`)
      return false
    }
  }
  return h.ok
}

/** The log queries. Each is bounded, grouped in the database, and answers one question about the mechanism. */
const LOG_QUERIES: { name: string; why: string; sql: string }[] = [
  {
    name: 'postgres_categories_by_10min',
    why: 'when statement timeouts, checkpoints, temp files, kills and connection-slot errors happened, in ten-minute buckets',
    sql: "select toStartOfInterval(timestamp, INTERVAL 10 minute) as t, multiIf(event_message ilike '%statement timeout%','statement_timeout', event_message ilike '%checkpoint complete%','checkpoint_complete', event_message ilike '%checkpoint starting%','checkpoint_start', event_message ilike '%terminated by signal%','killed_by_signal', event_message ilike '%out of memory%','out_of_memory', event_message ilike '%could not fork%','fork_failed', event_message ilike '%temporary file%','temp_file', event_message ilike '%automatic vacuum%','autovacuum', event_message ilike '%automatic analyze%','autoanalyze', event_message ilike '%remaining connection slots%','conn_slots_full', event_message ilike '%canceling%','canceling', event_message ilike '%connection reset%','connection_reset','') as k, count() as n from logs where source = 'postgres_logs' and k != '' group by t, k order by t",
  },
  {
    name: 'checkpoint_complete_lines',
    why: 'a checkpoint line carries its write and sync durations: a direct measure of how long the volume took to accept writes',
    sql: "select timestamp, event_message from logs where source = 'postgres_logs' and event_message ilike '%checkpoint complete%' order by timestamp limit 300",
  },
  {
    name: 'pgbouncer_by_10min',
    why: 'connection handshakes that timed out or failed, when the pooler could not reach the host',
    sql: "select toStartOfInterval(timestamp, INTERVAL 10 minute) as t, multiIf(event_message ilike '%connect timeout%','connect_timeout', event_message ilike '%server login%','server_login', event_message ilike '%tls%' or event_message ilike '%ssl%','tls', event_message ilike '%closing because%','closing','') as k, count() as n from logs where source = 'pgbouncer_logs' and k != '' group by t, k order by t",
  },
  {
    name: 'postgres_fatal_and_panic_sample',
    why: 'the first lines of anything severe (truncated and redacted before they are stored)',
    sql: "select timestamp, event_message from logs where source = 'postgres_logs' and (event_message ilike '%fatal%' or event_message ilike '%panic%' or event_message ilike '%could not%') order by timestamp limit 60",
  },
]

const logsMode = async (hours: number): Promise<void> => {
  const end = new Date()
  const start = new Date(end.getTime() - hours * 3600 * 1000)
  for (let i = 0; i < LOG_QUERIES.length; i += 1) {
    const q = LOG_QUERIES[i]
    if (q === undefined) continue
    if (i > 0) await sleep(65_000)
    const url = `/v1/projects/${REF}/analytics/endpoints/logs?sql=${encodeURIComponent(q.sql)}&iso_timestamp_start=${start.toISOString()}&iso_timestamp_end=${end.toISOString()}`
    const r = await get(url, 60_000)
    let rows: unknown[] = []
    let note = ''
    try {
      const j = JSON.parse(r.text) as { result?: unknown[]; error?: unknown }
      rows = Array.isArray(j.result) ? j.result : []
      if (j.error !== undefined && j.error !== null)
        note = redactSecrets(JSON.stringify(j.error)).slice(0, 200)
    } catch {
      note = redactSecrets(r.text).slice(0, 200)
    }
    const cleaned = rows.map((row) => {
      const o = { ...(row as Record<string, unknown>) }
      if (typeof o.event_message === 'string')
        o.event_message = redactSecrets(o.event_message).slice(0, 240)
      return o
    })
    record('logs', {
      name: q.name,
      why: q.why,
      status: r.status,
      ms: r.ms,
      window: [start.toISOString(), end.toISOString()],
      rows: cleaned,
      note,
    })
    console.log(
      `logs ${q.name}: http ${String(r.status)} in ${String(r.ms)} ms, ${String(rows.length)} row(s)${note === '' ? '' : ` (${note})`}`,
    )
  }
}

/** Database mode: every statement bounded, sequential, and the whole thing stops at the first sign of a slow host. */
const DB_QUERIES: { name: string; why: string; sql: string }[] = [
  {
    name: 'identity_and_settings',
    why: 'uptime and whether the diagnostic settings are on',
    sql: "select now() as now, pg_postmaster_start_time() as started, current_setting('track_io_timing') as track_io_timing, current_setting('log_temp_files') as log_temp_files, current_setting('work_mem') as work_mem, current_setting('shared_buffers') as shared_buffers, current_setting('log_checkpoints') as log_checkpoints",
  },
  {
    name: 'database_counters',
    why: 'temp files and bytes, buffer reads, and block I/O time (zero unless track_io_timing is on)',
    sql: 'select temp_files, temp_bytes, blks_read, blks_hit, blk_read_time, blk_write_time, xact_commit, xact_rollback, deadlocks, stats_reset from pg_stat_database where datname = current_database()',
  },
  {
    name: 'bgwriter',
    why: 'checkpoint cadence, write and sync time, buffers written by backends (a backend writing its own buffers means the writer cannot keep up); on PG17 the checkpoint columns moved to pg_stat_checkpointer',
    sql: 'select to_jsonb(b) as bgwriter from pg_stat_bgwriter b',
  },
  {
    name: 'checkpointer_pg17',
    why: 'PG17 only: checkpoint counts and write/sync time (a missing relation on older versions is expected and recorded)',
    sql: 'select to_jsonb(c) as checkpointer from pg_stat_checkpointer c',
  },
  {
    name: 'io_by_backend',
    why: 'PG16+: reads, writes, their time and evictions by backend type and context',
    sql: 'select backend_type, object, context, reads, read_time, writes, write_time, extends, hits, evictions from pg_stat_io where coalesce(reads,0) + coalesce(writes,0) > 0 order by coalesce(read_time,0) + coalesce(write_time,0) desc limit 25',
  },
  {
    name: 'statements_by_temp_written',
    why: 'which statements spill (cumulative since the statistics reset)',
    sql: "select calls, temp_blks_written, temp_blks_read, shared_blks_read, shared_blk_read_time, wal_bytes, round(total_exec_time::numeric) as total_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 120) as q from pg_stat_statements order by temp_blks_written desc limit 15",
  },
  {
    name: 'statements_by_blocks_read',
    why: 'which statements read the most from disk (the cold-cache cost on a small host)',
    sql: "select calls, shared_blks_read, shared_blks_hit, round(total_exec_time::numeric) as total_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 120) as q from pg_stat_statements order by shared_blks_read desc limit 15",
  },
  {
    name: 'statements_by_wal',
    why: 'which statements write the most WAL',
    sql: "select calls, wal_bytes, wal_records, left(regexp_replace(query, '\\s+', ' ', 'g'), 120) as q from pg_stat_statements order by wal_bytes desc limit 10",
  },
  {
    name: 'sessions_and_waits',
    why: 'who is connected, in what state, and what they wait on',
    sql: 'select backend_type, state, wait_event_type, wait_event, count(*)::int as n, max(extract(epoch from now() - coalesce(xact_start, query_start)))::int as longest_s from pg_stat_activity where pid <> pg_backend_pid() group by 1,2,3,4 order by n desc',
  },
  {
    name: 'ungranted_locks',
    why: 'lock waits',
    sql: 'select count(*) filter (where not granted)::int as waiting, count(*)::int as total from pg_locks',
  },
  {
    name: 'cron_jobs_and_runs',
    why: 'standing background work: schedules, and how long recent runs actually took',
    sql: "select j.jobid, j.jobname, j.schedule, j.active, r.status, count(r.*)::int as runs_2h, round(avg(extract(epoch from r.end_time - r.start_time))::numeric, 3) as avg_s, round(max(extract(epoch from r.end_time - r.start_time))::numeric, 3) as max_s from cron.job j left join cron.job_run_details r on r.jobid = j.jobid and r.start_time > now() - interval '2 hours' group by 1,2,3,4,5 order by 1",
  },
  {
    name: 'heartbeat_http_by_status',
    why: 'the worker kick: how often it answered, timed out or errored in the last day',
    sql: "select status_code, count(*)::int as n, round(avg(extract(epoch from now() - created))::numeric / 3600, 1) as avg_age_h from net._http_response where created > now() - interval '24 hours' group by 1 order by 1 nulls first",
  },
  {
    name: 'offices_by_kind_state',
    why: 'how many offices exist and how many the standing pass visits (state active, kind not system)',
    sql: 'select kind, state, count(*)::int as offices from public.offices group by 1,2 order by 1,2',
  },
  {
    name: 'jobs_per_hour_real_vs_harness',
    why: 'whether load came in bursts, and whether it was harness traffic; real = not a fixture and not synthetic',
    sql: "select date_trunc('hour', created_at) as hour, count(*)::int as jobs, count(*) filter (where is_fixture or synthetic)::int as harness, count(distinct office_id)::int as offices from public.jobs where created_at > now() - interval '72 hours' group by 1 order by 1",
  },
  {
    name: 'jobs_table_health',
    why: 'update churn and dead tuples on the hottest table',
    sql: "select n_live_tup, n_dead_tup, n_tup_upd, n_tup_hot_upd, last_autovacuum, last_autoanalyze, autovacuum_count from pg_stat_user_tables where relid = 'public.jobs'::regclass",
  },
  {
    name: 'biggest_relations',
    why: 'what occupies the volume and the cache',
    sql: "select relname, pg_total_relation_size(oid)::bigint as bytes from pg_class where relkind in ('r','i','m') and relnamespace in ('public'::regnamespace, 'app'::regnamespace, 'cron'::regnamespace, 'net'::regnamespace) order by 2 desc limit 12",
  },
  // ---- added 5 October: the questions the provider log analysis raised -----------------------------------------------------
  {
    name: 'settings_relevant',
    why: 'the settings that decide memory use, spill, timeouts, checkpoints and logging, with where each came from',
    sql: "select name, setting, unit, source, context from pg_settings where name in ('shared_buffers','work_mem','maintenance_work_mem','effective_cache_size','max_connections','statement_timeout','temp_file_limit','log_temp_files','log_min_duration_statement','track_io_timing','checkpoint_timeout','checkpoint_completion_target','max_wal_size','min_wal_size','wal_buffers','autovacuum','autovacuum_naptime','autovacuum_max_workers','random_page_cost','effective_io_concurrency','pg_stat_statements.max','pg_stat_statements.track','pg_stat_statements.track_utility','pg_stat_statements.save','auto_explain.log_min_duration','shared_preload_libraries','idle_in_transaction_session_timeout','log_checkpoints','log_lock_waits','jit') order by name",
  },
  {
    name: 'role_settings',
    why: 'per-role overrides, notably statement_timeout, which decides which sessions the provider logs as timed out',
    sql: 'select rolname, rolconfig from pg_roles where rolconfig is not null order by rolname',
  },
  {
    name: 'pgss_footprint',
    why: 'how big the statistics store is: entries, characters of query text and how many have been evicted. The platform exporter reads all of it on every scrape',
    sql: 'select (select count(*)::int from pg_stat_statements) as entries, (select coalesce(sum(length(query)), 0)::bigint from pg_stat_statements) as query_chars, (select coalesce(max(length(query)), 0)::int from pg_stat_statements) as longest_query, (select dealloc from extensions.pg_stat_statements_info) as evictions, (select stats_reset from extensions.pg_stat_statements_info) as stats_reset',
  },
  {
    name: 'time_by_role',
    why: 'who the database spends its time on: total execution seconds, calls and temp blocks by role (the platform exporter is supabase_admin, our app is postgres)',
    sql: 'select r.rolname, count(*)::int as statements, sum(s.calls)::bigint as calls, round(sum(s.total_exec_time)::numeric / 1000) as total_s, sum(s.temp_blks_written)::bigint as temp_blks_written, sum(s.shared_blks_read)::bigint as shared_blks_read from pg_stat_statements s join pg_catalog.pg_roles r on r.oid = s.userid group by 1 order by total_s desc',
  },
  {
    name: 'timeout_queryids',
    why: 'the statements behind the query ids that the provider log shows timing out most (the log carries ids, this names them)',
    sql: "select queryid::text as queryid, calls, round(mean_exec_time::numeric) as mean_ms, round(max_exec_time::numeric) as max_ms, temp_blks_written, shared_blks_read, left(regexp_replace(query, '\\s+', ' ', 'g'), 110) as q from pg_stat_statements where queryid::text in ('-8285757822602875730','5197431765113000632','189633985216629022','-8319712432728059206','-1121979162422898360','-1502055705838882675')",
  },
  {
    name: 'sessions_by_application',
    why: 'connected sessions by role and application name, which shows the exporter, the pooler, PostgREST, Auth and our worker side by side',
    sql: 'select usename, application_name, state, count(*)::int as n from pg_stat_activity where pid <> pg_backend_pid() and backend_type = $$client backend$$ group by 1,2,3 order by n desc',
  },
  {
    name: 'database_size',
    why: 'total database size, to correlate growth with the incident dates',
    sql: 'select pg_database_size(current_database())::bigint as bytes, now() as at',
  },
  {
    name: 'schema_sizes',
    why: 'database composition by schema: where the bytes are',
    sql: "select n.nspname, count(*)::int as relations, sum(pg_total_relation_size(c.oid))::bigint as bytes from pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','m') group by 1 order by bytes desc limit 12",
  },
  {
    name: 'autovacuum_tables',
    why: 'the tables with the most dead tuples and when autovacuum last ran on them',
    sql: 'select relname, n_live_tup, n_dead_tup, n_tup_upd, n_tup_hot_upd, last_autovacuum, last_autoanalyze, autovacuum_count, autoanalyze_count from pg_stat_user_tables order by n_dead_tup desc limit 10',
  },
  {
    name: 'wal_position',
    why: 'cumulative WAL bytes written since the cluster began; the difference between two captures is the WAL rate',
    sql: "select pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')::bigint as wal_bytes_total, now() as at",
  },
  {
    name: 'queue_state',
    why: 'work not yet finished by state, with age and how much of it is harness traffic (an idle office should show none)',
    sql: "select state, count(*)::int as n, min(created_at) as oldest, max(created_at) as newest, count(*) filter (where is_fixture or synthetic)::int as harness from public.jobs where state not in ('complete','cancelled','failed') group by 1 order by n desc",
  },
  {
    name: 'jobs_by_office_kind_72h',
    why: 'multi-user workload on the same clock: jobs in the last three days by office kind (person, sample, test, system) and how many were harness',
    sql: "select o.kind, count(distinct j.office_id)::int as offices, count(*)::int as jobs, count(*) filter (where j.is_fixture or j.synthetic)::int as harness from public.jobs j join public.offices o on o.office_id = j.office_id where j.created_at > now() - interval '72 hours' group by 1 order by jobs desc",
  },
  {
    name: 'jobs_by_hour_office_kind',
    why: 'the same, hour by hour, so multi-user activity can be laid against the outage transitions',
    sql: "select date_trunc('hour', j.created_at) as hour, o.kind, count(*)::int as jobs from public.jobs j join public.offices o on o.office_id = j.office_id where j.created_at > now() - interval '72 hours' group by 1,2 order by 1,2",
  },
]

/**
 * One statement through the Management API's READ-ONLY endpoint (it runs as `supabase_read_only_user`, so no write can happen
 * whatever the text says). No retry: a retry on a sick host is more load, and a refusal is itself the finding.
 */
const readOnly = async (
  sql: string,
  ms: number,
): Promise<{ status: number; ms: number; text: string }> => {
  const t = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(`${API}/v1/projects/${REF}/database/query/read-only`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
      signal: ctl.signal,
    })
    return { status: r.status, ms: Date.now() - t, text: await r.text() }
  } catch (e) {
    return { status: 0, ms: Date.now() - t, text: String(e instanceof Error ? e.name : e) }
  } finally {
    clearTimeout(timer)
  }
}

const dbMode = async (): Promise<boolean> => {
  const h = await health()
  console.log(`health: ${h.label}`)
  record('health', h)
  if (!h.ok) {
    console.log(
      'REFUSED: the provider reports something unhealthy. --db never runs against a sick platform.',
    )
    return false
  }
  const t0 = Date.now()
  const probe = await readOnly('select 1 as ok', 2000)
  // The endpoint answers 201 on success; the time limit is the real test (the call itself aborts at 2 s, status 0).
  if (!answered(probe.status) || Date.now() - t0 > 2000) {
    console.log(
      `REFUSED: a trivial read-only statement did not answer inside 2 s (http ${String(probe.status)}, ${String(Date.now() - t0)} ms). The host is not functionally healthy.`,
    )
    record('refused', { reason: 'select 1 not answered inside 2 s', status: probe.status })
    return false
  }
  for (const q of DB_QUERIES) {
    const r = await readOnly(qualify(q.sql), 8000)
    if (answered(r.status)) {
      let rows: unknown[] = []
      try {
        rows = JSON.parse(r.text) as unknown[]
      } catch {
        // an unreadable body is recorded as zero rows with the status
      }
      record('db', { name: q.name, why: q.why, ms: r.ms, rows })
      console.log(`db ${q.name}: ${String(rows.length)} row(s) in ${String(r.ms)} ms`)
    } else {
      const msg = redactSecrets(r.text).slice(0, 200)
      record('db', { name: q.name, why: q.why, ms: r.ms, status: r.status, error: msg })
      console.log(`db ${q.name}: http ${String(r.status)} after ${String(r.ms)} ms (${msg})`)
      // A statement that ran out of time (status 0 = our abort) or a server error says the host is degrading: stop.
      if (r.status === 0 || r.status >= 500) {
        console.log('STOPPED: a bounded statement did not complete. Nothing further is run.')
        return false
      }
    }
    await sleep(1500)
  }
  return true
}

const minutes = Number(flag('watch') ?? 0)
if (has('control-plane')) await controlPlane(Number(flag('gap') ?? 60))
if (has('logs')) await logsMode(Number(flag('hours') ?? 24))
if (has('db')) await dbMode()
if (minutes > 0) {
  const every = Math.max(60, Number(flag('every') ?? 60))
  const until = Date.now() + minutes * 60_000
  while (Date.now() < until) {
    const ok = await controlPlane(0)
    if (!ok) {
      console.log(
        'STOPPED: the platform is degraded or the scrape failed. A watch never keeps probing a sick host.',
      )
      break
    }
    await sleep(every * 1000)
  }
}
console.log(`written to ${file}`)
