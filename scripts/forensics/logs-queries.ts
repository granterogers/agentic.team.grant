/**
 * The named log queries (ClickHouse SQL over the unified `logs` table). Every query is bounded in rows, grouped in the log service
 * rather than downloaded, and answers one question about the outage mechanism. The attribute keys used here were READ FROM A PROBE
 * of this project's own stream (`--set=probe`, 5 October), not guessed. Sources with no rows in the window (supavisor_logs,
 * realtime_logs) are recorded as absent by the probe rather than queried.
 *
 * Time buckets are ten minutes: fine enough to see an onset, coarse enough that a day is about 144 rows a series.
 * A string that could carry a statement is clipped and redacted by the runner before it is stored.
 */
export interface LogQuery {
  readonly why: string
  readonly sql: string
}

const T10 = 'toStartOfInterval(timestamp, INTERVAL 10 minute)'
const SEV = "log_attributes['parsed.error_severity']"
const NORM = "replaceRegexpAll(substring(event_message, 1, 160), '[0-9]+', 'N')"

export const LOG_SETS: Record<string, LogQuery> = {
  probe_sources: {
    why: 'which sources exist in the unified stream, how many rows each and the time range each covers',
    sql: 'select source, count() as n, min(timestamp) as first, max(timestamp) as last from logs group by source order by n desc',
  },
  probe_attributes: {
    why: 'one real attribute map per source, so every later query names a key that exists',
    sql: 'select source, any(log_attributes) as attrs, any(event_message) as sample from logs group by source order by source',
  },

  // ---- postgres_logs -------------------------------------------------------------------------------------------------------
  pg_severity_10min: {
    why: 'volume of postgres log lines by severity, so a quiet host and a noisy one are told apart',
    sql: `select ${T10} as t, ${SEV} as sev, count() as n from logs where source = 'postgres_logs' group by t, sev order by t`,
  },
  pg_events_10min: {
    why: 'timeouts, checkpoints, autovacuum, temp files, kills, memory, lock waits, connection drops and recovery, in ten-minute buckets',
    sql: `select ${T10} as t, multiIf(event_message ilike '%statement timeout%','statement_timeout', event_message ilike '%checkpoint complete%','checkpoint_complete', event_message ilike '%checkpoints are occurring too frequently%','checkpoint_too_frequent', event_message ilike '%automatic vacuum%','autovacuum', event_message ilike '%automatic analyze%','autoanalyze', event_message ilike '%temporary file%','temp_file', event_message ilike '%terminated by signal%','killed_by_signal', event_message ilike '%out of memory%','out_of_memory', event_message ilike '%could not fork%','fork_failed', event_message ilike '%remaining connection slots%','conn_slots_full', event_message ilike '%still waiting for%' or event_message ilike '%deadlock detected%','lock_wait', event_message ilike '%idle-in-transaction%','idle_in_txn_timeout', event_message ilike '%could not receive data%','client_reset', event_message ilike '%could not send data%','client_broken_pipe', event_message ilike '%could not accept ssl%','ssl_eof', event_message ilike '%database system%' or event_message ilike '%starting postgresql%' or event_message ilike '%redo%' or event_message ilike '%recovery%','startup_recovery', event_message ilike '%cron job%starting%','cron_start', '') as k, count() as n from logs where source = 'postgres_logs' and k != '' group by t, k order by t`,
  },
  pg_error_templates: {
    why: 'the distinct ERROR, FATAL and PANIC messages, with counts and first and last time (numbers normalised)',
    sql: `select ${SEV} as sev, ${NORM} as msg, count() as n, min(timestamp) as first, max(timestamp) as last from logs where source = 'postgres_logs' and ${SEV} in ('ERROR','FATAL','PANIC') group by sev, msg order by n desc limit 40`,
  },
  pg_lifecycle: {
    why: 'every startup, recovery, shutdown and kill line (a restart would be here)',
    sql: `select timestamp, ${SEV} as sev, substring(event_message, 1, 200) as msg from logs where source = 'postgres_logs' and (event_message ilike '%database system%' or event_message ilike '%starting postgresql%' or event_message ilike '%shutdown%' or event_message ilike '%terminated by signal%' or event_message ilike '%server process%' or event_message ilike '%redo %' or event_message ilike '%recovery%') order by timestamp limit 80`,
  },
  pg_timeout_backends: {
    why: 'which backend types hit statement timeouts, per hour (an exporter, a pooler login, an app role, cron)',
    sql: `select toStartOfHour(timestamp) as h, log_attributes['parsed.backend_type'] as backend, count() as n from logs where source = 'postgres_logs' and event_message ilike '%statement timeout%' group by h, backend order by h`,
  },
  pg_timeout_statements: {
    why: 'the statements that were running in the sessions that timed out (the STATEMENT line of the same session)',
    sql: `select ${NORM} as q, count() as n, min(timestamp) as first, max(timestamp) as last from logs where source = 'postgres_logs' and ${SEV} = 'STATEMENT' and log_attributes['parsed.session_id'] in (select log_attributes['parsed.session_id'] from logs where source = 'postgres_logs' and event_message ilike '%statement timeout%') group by q order by n desc limit 30`,
  },
  pg_checkpoints: {
    why: 'every checkpoint-complete line: buffers written, write and sync seconds (the sync time is a direct fsync measurement)',
    sql: `select timestamp, substring(event_message, 1, 260) as msg from logs where source = 'postgres_logs' and event_message ilike '%checkpoint complete%' order by timestamp limit 400`,
  },
  pg_autovacuum: {
    why: 'autovacuum and autoanalyze lines that were logged (elapsed time, buffer and WAL usage)',
    sql: `select timestamp, substring(event_message, 1, 300) as msg from logs where source = 'postgres_logs' and (event_message ilike '%automatic vacuum%' or event_message ilike '%automatic analyze%') order by timestamp limit 60`,
  },
  pg_cron: {
    why: 'pg_cron start lines per ten minutes and per job, the standing background work',
    sql: `select ${T10} as t, ${NORM} as job, count() as n from logs where source = 'postgres_logs' and event_message ilike 'cron job%starting%' group by t, job order by t`,
  },

  // ---- the hourly panel (run per UTC day with --day=, so baseline days and outage days are measured identically) ---------------
  d_pg_hourly: {
    why: 'per hour: statement timeouts, client resets, FATAL, slow-statement lines and the slowest, checkpoints with their longest fsync and buffers written, cron starts, autovacuum lines',
    sql: `select toStartOfHour(timestamp) as h, countIf(event_message ilike '%statement timeout%') as timeouts, countIf(event_message ilike '%could not receive data%') as resets, countIf(${SEV} = 'FATAL') as fatal, countIf(event_message like 'duration:%') as slow, max(if(event_message like 'duration:%', toFloat64OrZero(extract(event_message, 'duration: ([0-9.]+) ms')), 0)) as slow_max_ms, countIf(event_message ilike 'checkpoint complete%') as ckpts, max(if(event_message ilike 'checkpoint complete%', toFloat64OrZero(extract(event_message, 'sync=([0-9.]+) s')), 0)) as sync_max_s, sumIf(toFloat64OrZero(extract(event_message, 'wrote ([0-9]+) buffers')), event_message ilike 'checkpoint complete%') as ckpt_bufs, countIf(event_message ilike 'cron job%starting%') as cron, countIf(event_message ilike '%automatic vacuum%' or event_message ilike '%automatic analyze%') as autovac, count() as lines from logs where source = 'postgres_logs' group by h order by h`,
  },
  d_pg_apps_hourly: {
    why: 'per hour and application (the platform exporter, our worker, PostgREST, pg_cron, the Management API): slow-statement lines with their mean and maximum, and statement timeouts',
    sql: `select toStartOfHour(timestamp) as h, log_attributes['parsed.application_name'] as app, countIf(event_message like 'duration:%') as slow, round(avgIf(toFloat64OrZero(extract(event_message, 'duration: ([0-9.]+) ms')), event_message like 'duration:%')) as slow_avg_ms, round(maxIf(toFloat64OrZero(extract(event_message, 'duration: ([0-9.]+) ms')), event_message like 'duration:%')) as slow_max_ms, countIf(event_message ilike '%statement timeout%') as timeouts from logs where source = 'postgres_logs' and app in ('postgres_exporter','postgres.js','PostgREST 14.5','pg_cron','mgmt-api','supabase_auth','storage') group by h, app having slow > 0 or timeouts > 0 order by h`,
  },
  d_service_hourly: {
    why: 'per hour and service (gateway, functions, auth, storage): request count by status class and the slowest/95th-percentile latency in milliseconds',
    sql: `select toStartOfHour(timestamp) as h, source, multiIf(toUInt16OrZero(multiIf(source in ('edge_logs','function_edge_logs'), log_attributes['response.status_code'], source = 'auth_logs', log_attributes['status'], log_attributes['res.statusCode'])) >= 500, '5xx', toUInt16OrZero(multiIf(source in ('edge_logs','function_edge_logs'), log_attributes['response.status_code'], source = 'auth_logs', log_attributes['status'], log_attributes['res.statusCode'])) >= 400, '4xx', 'ok') as cls, count() as n, round(quantile(0.95)(multiIf(source = 'edge_logs', toFloat64OrZero(log_attributes['response.origin_time']), source = 'function_edge_logs', toFloat64OrZero(log_attributes['execution_time_ms']), source = 'auth_logs', toFloat64OrZero(log_attributes['duration']) / 1000000, toFloat64OrZero(log_attributes['responseTime'])))) as p95_ms, round(max(multiIf(source = 'edge_logs', toFloat64OrZero(log_attributes['response.origin_time']), source = 'function_edge_logs', toFloat64OrZero(log_attributes['execution_time_ms']), source = 'auth_logs', toFloat64OrZero(log_attributes['duration']) / 1000000, toFloat64OrZero(log_attributes['responseTime'])))) as max_ms from logs where source in ('edge_logs','function_edge_logs','auth_logs','storage_logs') group by h, source, cls order by h`,
  },

  // ---- second pass: attribution -----------------------------------------------------------------------------------------------
  pg_attr_keys: {
    why: 'every attribute key that occurs on postgres log rows (the probe sampled only one row, and keys such as user or application name occur on some rows only)',
    sql: "select arrayJoin(mapKeys(log_attributes)) as k, count() as n from logs where source = 'postgres_logs' group by k order by n desc limit 60",
  },
  pg_timeout_query_ids: {
    why: 'the query id of each statement that timed out: it maps to pg_stat_statements.queryid when the database can be read, which names the statement without the log carrying its text',
    sql: `select log_attributes['parsed.query_id'] as qid, count() as n, min(timestamp) as first, max(timestamp) as last from logs where source = 'postgres_logs' and event_message ilike '%statement timeout%' group by qid order by n desc limit 25`,
  },
  pg_lifecycle2: {
    why: 'startup, recovery, shutdown and kill lines only (the first lifecycle query matched every checkpoint line)',
    sql: `select timestamp, ${SEV} as sev, substring(event_message, 1, 220) as msg from logs where source = 'postgres_logs' and event_message not ilike 'checkpoint %' and (event_message ilike '%database system was%' or event_message ilike '%database system is ready%' or event_message ilike '%starting postgresql%' or event_message ilike '%received fast shutdown%' or event_message ilike '%received smart shutdown%' or event_message ilike '%shutting down%' or event_message ilike '%terminated by signal%' or event_message ilike '%was terminated%' or event_message ilike '%startup process%' or event_message ilike '%automatic recovery%' or event_message ilike '%end-of-recovery%') order by timestamp limit 60`,
  },
  pg_fatal_hours: {
    why: 'FATAL and PANIC lines per hour with their message template',
    sql: `select toStartOfHour(timestamp) as h, ${SEV} as sev, ${NORM} as msg, count() as n from logs where source = 'postgres_logs' and ${SEV} in ('FATAL','PANIC') group by h, sev, msg order by h`,
  },
  pg_slow_statements: {
    why: 'statements the server itself logged as slow (duration lines, with the plan header when auto_explain is on): when, how long, which statement',
    sql: `select timestamp, toFloat64OrZero(extract(event_message, 'duration: ([0-9.]+) ms')) as ms, substring(replaceRegexpAll(substring(event_message, position(event_message, 'Query Text:') + 11, 400), '[[:space:]]+', ' '), 1, 160) as q from logs where source = 'postgres_logs' and event_message like 'duration:%' order by ms desc limit 40`,
  },
  pg_slow_by_hour: {
    why: 'how many slow-statement lines per hour and the slowest, to see whether slow statements exist at idle',
    sql: `select toStartOfHour(timestamp) as h, count() as n, max(toFloat64OrZero(extract(event_message, 'duration: ([0-9.]+) ms'))) as max_ms from logs where source = 'postgres_logs' and event_message like 'duration:%' group by h order by h`,
  },
  pg_timeout_by_role: {
    why: 'who timed out: database role and application name, before and after 17:00 on 4 October (when application traffic stopped)',
    sql: `select if(timestamp >= toDateTime('2026-10-04 17:00:00'), 'after17', 'before17') as period, log_attributes['parsed.user_name'] as usr, log_attributes['parsed.application_name'] as app, count() as n from logs where source = 'postgres_logs' and event_message ilike '%statement timeout%' group by period, usr, app order by n desc limit 30`,
  },
  pg_slow_by_role: {
    why: 'who ran the slow statements (the server logged their duration): role, application, how many and how slow, before and after 17:00',
    sql: `select if(timestamp >= toDateTime('2026-10-04 17:00:00'), 'after17', 'before17') as period, log_attributes['parsed.user_name'] as usr, log_attributes['parsed.application_name'] as app, count() as n, round(avg(toFloat64OrZero(extract(event_message, 'duration: ([0-9.]+) ms')))) as avg_ms, round(max(toFloat64OrZero(extract(event_message, 'duration: ([0-9.]+) ms')))) as max_ms from logs where source = 'postgres_logs' and event_message like 'duration:%' group by period, usr, app order by n desc limit 30`,
  },
  pg_top_query_text: {
    why: 'the statement text carried on log rows for the query ids that timed out most (a query id is the same statement wherever it appears)',
    sql: `select log_attributes['parsed.query_id'] as qid, any(log_attributes['parsed.user_name']) as usr, any(log_attributes['parsed.application_name']) as app, count() as n, any(substring(replaceRegexpAll(log_attributes['parsed.query'], '[[:space:]]+', ' '), 1, 220)) as q from logs where source = 'postgres_logs' and log_attributes['parsed.query_id'] in ('-8285757822602875730','5197431765113000632','189633985216629022','-8319712432728059206','-1121979162422898360','-1502055705838882675') and log_attributes['parsed.query'] != '' group by qid order by n desc`,
  },
  auth_connect_errors: {
    why: 'the auth service failing to reach or wait for the database: time and message',
    sql: `select timestamp, substring(event_message, 1, 420) as msg from logs where source = 'auth_logs' and (event_message ilike '%failed to connect%' or event_message ilike '%deadline exceeded%' or event_message ilike '%context canceled%') order by timestamp limit 40`,
  },
  fn_error_templates: {
    why: 'the distinct error-level function log lines (the worker failing), with counts and times',
    sql: `select ${NORM} as msg, count() as n, min(timestamp) as first, max(timestamp) as last from logs where source = 'function_logs' and log_attributes['level'] = 'error' group by msg order by n desc limit 20`,
  },

  // ---- edge, functions, auth, storage, postgrest, pooler --------------------------------------------------------------------
  edge_families_10min: {
    why: 'gateway request volume by service family and status class, and upstream (origin) time, so traffic and failures share a clock',
    sql: `select ${T10} as t, multiIf(log_attributes['request.path'] ilike '/rest/%','rest', log_attributes['request.path'] ilike '/auth/%','auth', log_attributes['request.path'] ilike '/storage/%','storage', log_attributes['request.path'] ilike '/functions/%','functions', log_attributes['request.path'] ilike '/realtime/%','realtime', log_attributes['request.path'] ilike '/customer/%','metrics', 'other') as fam, multiIf(toUInt16OrZero(log_attributes['response.status_code']) >= 500,'5xx', toUInt16OrZero(log_attributes['response.status_code']) >= 400,'4xx','ok') as cls, count() as n, round(quantile(0.5)(toFloat64OrZero(log_attributes['response.origin_time']))) as p50_ms, round(quantile(0.95)(toFloat64OrZero(log_attributes['response.origin_time']))) as p95_ms, round(max(toFloat64OrZero(log_attributes['response.origin_time']))) as max_ms from logs where source = 'edge_logs' group by t, fam, cls order by t`,
  },
  edge_metrics_scrapes: {
    why: 'every scrape of the customer metrics endpoint by the platform (user agent mgmt-api): when it answered, with which status, how slowly',
    sql: `select timestamp, log_attributes['response.status_code'] as status, log_attributes['response.origin_time'] as origin_ms, log_attributes['request.headers.user_agent'] as ua from logs where source = 'edge_logs' and log_attributes['request.path'] ilike '%privileged/metrics%' order by timestamp limit 400`,
  },
  edge_slowest: {
    why: 'the slowest gateway responses of the window with the path family, to see what stalled and when',
    sql: `select timestamp, log_attributes['request.method'] as method, substring(log_attributes['request.path'], 1, 60) as path, log_attributes['response.status_code'] as status, log_attributes['response.origin_time'] as origin_ms from logs where source = 'edge_logs' order by toFloat64OrZero(log_attributes['response.origin_time']) desc limit 40`,
  },
  fn_edge_10min: {
    why: 'edge function invocations per ten minutes by function path and status, with execution time (504 and 546 are the worker being killed)',
    sql: `select ${T10} as t, splitByChar('/', log_attributes['request.pathname'])[4] as fn, log_attributes['response.status_code'] as status, count() as n, round(avg(toFloat64OrZero(log_attributes['execution_time_ms']))) as avg_ms, round(max(toFloat64OrZero(log_attributes['execution_time_ms']))) as max_ms from logs where source = 'function_edge_logs' group by t, fn, status order by t`,
  },
  fn_logs_10min: {
    why: 'function runtime events per ten minutes (boot, shutdown, errors) and the boot time',
    sql: `select ${T10} as t, log_attributes['event_type'] as ev, log_attributes['level'] as lvl, count() as n, round(max(toFloat64OrZero(log_attributes['boot_time']))) as max_boot_ms from logs where source = 'function_logs' group by t, ev, lvl order by t`,
  },
  auth_10min: {
    why: 'auth requests per ten minutes by status class with request duration (nanoseconds), the sign-in path under load',
    sql: `select ${T10} as t, multiIf(toUInt16OrZero(log_attributes['status']) >= 500,'5xx', toUInt16OrZero(log_attributes['status']) >= 400,'4xx','ok') as cls, count() as n, round(avg(toFloat64OrZero(log_attributes['duration'])) / 1e6) as avg_ms, round(max(toFloat64OrZero(log_attributes['duration'])) / 1e6) as max_ms from logs where source = 'auth_logs' group by t, cls order by t`,
  },
  auth_errors: {
    why: 'the distinct auth messages at warning level or worse, with counts and times',
    sql: `select log_attributes['level'] as lvl, ${NORM} as msg, count() as n, min(timestamp) as first, max(timestamp) as last from logs where source = 'auth_logs' and log_attributes['level'] in ('error','warning','fatal') group by lvl, msg order by n desc limit 30`,
  },
  auth_audit_10min: {
    why: 'sign-in events per ten minutes split into the second-person acceptance harness and everyone else (no identity is stored)',
    sql: `select ${T10} as t, multiIf(log_attributes['auth_audit_event.actor_username'] ilike '%acceptance%' or log_attributes['auth_audit_event.actor_username'] ilike '%sample%','harness_person','other') as who, log_attributes['auth_audit_event.action'] as action, count() as n from logs where source = 'auth_audit_logs' group by t, who, action order by t`,
  },
  storage_10min: {
    why: 'storage requests per ten minutes by status class with response time',
    sql: `select ${T10} as t, multiIf(toUInt16OrZero(log_attributes['res.statusCode']) >= 500,'5xx', toUInt16OrZero(log_attributes['res.statusCode']) >= 400,'4xx','ok') as cls, count() as n, round(avg(toFloat64OrZero(log_attributes['responseTime']))) as avg_ms, round(max(toFloat64OrZero(log_attributes['responseTime']))) as max_ms from logs where source = 'storage_logs' group by t, cls order by t`,
  },
  postgrest_10min: {
    why: 'every postgrest log line by hour with its message template (it logs errors and timeouts)',
    sql: `select toStartOfHour(timestamp) as h, ${NORM} as msg, count() as n from logs where source = 'postgrest_logs' group by h, msg order by h limit 80`,
  },
  pgbouncer_10min: {
    why: 'pooler connection handshakes, closes, timeouts and login failures per ten minutes',
    sql: `select ${T10} as t, multiIf(event_message ilike '%connect timeout%' or event_message ilike '%server connect failed%','connect_failed', event_message ilike '%login failed%','login_failed', event_message ilike '%tls%' or event_message ilike '%ssl%','tls', event_message ilike '%closing because%','closing', event_message ilike '%pooler error%' or event_message ilike '%no more connections%','pool_full', event_message ilike '%stats:%','stats', '') as k, count() as n from logs where source = 'pgbouncer_logs' and k != '' group by t, k order by t`,
  },
  pgbouncer_templates: {
    why: 'the distinct pooler messages that are not routine, to see errors the buckets above did not name',
    sql: `select replaceRegexpAll(replaceRegexpAll(substring(event_message, 1, 160), '0x[0-9a-f]+', 'P'), '[0-9]+', 'N') as msg, count() as n, min(timestamp) as first, max(timestamp) as last from logs where source = 'pgbouncer_logs' group by msg order by n desc limit 30`,
  },
}
