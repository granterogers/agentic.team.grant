/**
 * Reading the host's own counters (Supabase degradation forensics, 4 October 2026).
 *
 * `GET /v1/projects/<ref>/analytics/endpoints/metrics` returns the project's Prometheus exposition text: node-level counters
 * (memory, swap, paging, CPU by mode, disk bytes and I/O time, pressure-stall information when the kernel exports it) and
 * Postgres counters (temp files, connections, checkpoints). It is a POINT-IN-TIME scrape of cumulative counters; there is no
 * history API. A rate needs two scrapes a known number of seconds apart, which is what `rates()` does.
 *
 * Pure functions only: no network, no clock, so they are tested against synthetic exposition text (and a control that must
 * come back empty on an exposition that has none of the series: a found-nothing reader needs one).
 */

/**
 * The Management API's read-only query endpoint wants schema-qualified references. The statistics views live in pg_catalog and
 * pg_stat_statements in `extensions`. Only `from <view>` is rewritten: a function call or a column is left alone.
 */
export const qualify = (sql: string): string =>
  sql
    .replace(/\bfrom (pg_stat_statements)\b/g, 'from extensions.$1')
    .replace(/\bfrom (pg_(?!stat_statements\b|catalog\b)\w+)\b/g, 'from pg_catalog.$1')

export interface Sample {
  readonly name: string
  readonly labels: Readonly<Record<string, string>>
  readonly value: number
}

/** The series a memory / swap / I/O diagnosis needs, matched by name. Everything else in the scrape is ignored. */
export const WANTED = [
  /^node_memory_(MemTotal|MemFree|MemAvailable|Cached|Buffers|SwapTotal|SwapFree|SwapCached|Dirty|Writeback|Active_anon|Inactive_anon|Shmem)_bytes$/,
  /^node_vmstat_(pswpin|pswpout|pgmajfault|pgfault|pgpgin|pgpgout|oom_kill|allocstall_normal|pgscan_direct|pgscan_kswapd|pgsteal_direct|pgsteal_kswapd)$/,
  /^node_cpu_seconds_total$/,
  /^node_load(1|5|15)$/,
  /^node_disk_(read|written)_bytes_total$/,
  /^node_disk_(reads|writes)_completed_total$/,
  /^node_disk_(io_time_seconds_total|io_time_weighted_seconds_total|read_time_seconds_total|write_time_seconds_total|io_now)$/,
  /^node_pressure_(cpu_waiting|memory_waiting|memory_stalled|io_waiting|io_stalled)_seconds_total$/,
  /^pg_stat_database_(temp_bytes|temp_files|xact_commit|xact_rollback|blks_read|blks_hit|deadlocks|conflicts|numbackends)$/,
  /^pg_stat_bgwriter_/,
  /^pg_stat_checkpointer_/,
  /^pg_settings_(shared_buffers|work_mem|max_connections|effective_cache_size|temp_file_limit)_bytes?$/,
  /^pg_stat_activity_count$/,
  /^pg_wal_/,
  /^pg_database_size_bytes$/,
]

const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+(\S+)(\s+\d+)?$/
const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g

/**
 * Parse exposition text into samples. By default only the WANTED series are kept (the Management API scrape is read for a short
 * summary). `parseAll` keeps every series, which is what the raw-evidence collector needs. Comment lines, malformed lines and
 * non-numeric values (NaN, +Inf) are skipped either way: a missing sample is not a zero.
 */
const parseWith = (text: string, keep: (name: string) => boolean): Sample[] => {
  const out: Sample[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const m = LINE.exec(line)
    if (m === null) continue
    const name = m[1] ?? ''
    if (!keep(name)) continue
    const value = Number(m[4])
    if (!Number.isFinite(value)) continue
    const labels: Record<string, string> = {}
    for (const l of (m[3] ?? '').matchAll(LABEL)) labels[l[1] ?? ''] = l[2] ?? ''
    out.push({ name, labels, value })
  }
  return out
}
export const parseMetrics = (text: string): Sample[] =>
  parseWith(text, (name) => WANTED.some((re) => re.test(name)))
export const parseAll = (text: string): Sample[] => parseWith(text, () => true)

/** The metric families an exposition declares, with the series count of each (what the endpoint ACTUALLY exports). */
export const familyCounts = (samples: readonly Sample[]): Record<string, number> => {
  const c: Record<string, number> = {}
  for (const s of samples) c[s.name] = (c[s.name] ?? 0) + 1
  return c
}

const sumOf = (
  s: readonly Sample[],
  name: string,
  where?: (l: Record<string, string>) => boolean,
): number | null => {
  const hits = s.filter((x) => x.name === name && (where === undefined || where(x.labels)))
  return hits.length === 0 ? null : hits.reduce((a, x) => a + x.value, 0)
}

/** Devices that carry data: a partition or a loop device would double count. */
const isWholeDisk = (l: Record<string, string>): boolean =>
  /^(nvme\d+n\d+|sd[a-z]+|vd[a-z]+|xvd[a-z]+)$/.test(l.device ?? '')

export interface Snapshot {
  readonly memTotalMiB: number | null
  readonly memAvailableMiB: number | null
  readonly swapTotalMiB: number | null
  readonly swapUsedMiB: number | null
  readonly dirtyMiB: number | null
  readonly load1: number | null
  readonly oomKills: number | null
  readonly pressure: Record<string, number | null>
  readonly tempBytes: number | null
  readonly tempFiles: number | null
  readonly backends: number | null
}

const MiB = 1024 * 1024
const mib = (v: number | null): number | null =>
  v === null ? null : Math.round((v / MiB) * 10) / 10

/** The point-in-time reading: what is true at the instant of the scrape. */
export const snapshot = (s: readonly Sample[]): Snapshot => {
  const swapTotal = sumOf(s, 'node_memory_SwapTotal_bytes')
  const swapFree = sumOf(s, 'node_memory_SwapFree_bytes')
  const pressure: Record<string, number | null> = {}
  for (const n of ['cpu_waiting', 'memory_waiting', 'memory_stalled', 'io_waiting', 'io_stalled']) {
    pressure[n] = sumOf(s, `node_pressure_${n}_seconds_total`)
  }
  return {
    memTotalMiB: mib(sumOf(s, 'node_memory_MemTotal_bytes')),
    memAvailableMiB: mib(sumOf(s, 'node_memory_MemAvailable_bytes')),
    swapTotalMiB: mib(swapTotal),
    swapUsedMiB: swapTotal === null || swapFree === null ? null : mib(swapTotal - swapFree),
    dirtyMiB: mib(sumOf(s, 'node_memory_Dirty_bytes')),
    load1: sumOf(s, 'node_load1'),
    oomKills: sumOf(s, 'node_vmstat_oom_kill'),
    pressure,
    tempBytes: sumOf(s, 'pg_stat_database_temp_bytes'),
    tempFiles: sumOf(s, 'pg_stat_database_temp_files'),
    backends: sumOf(s, 'pg_stat_database_numbackends'),
  }
}

export interface Rates {
  readonly seconds: number
  readonly swapInPagesPerS: number | null
  readonly swapOutPagesPerS: number | null
  readonly majorFaultsPerS: number | null
  readonly cpu: Record<string, number | null>
  readonly diskReadMBps: number | null
  readonly diskWriteMBps: number | null
  readonly diskReadsPerS: number | null
  readonly diskWritesPerS: number | null
  /** Share of wall time the busiest whole disk had I/O in flight (1 = saturated). */
  readonly diskBusyShare: number | null
  readonly pressureShare: Record<string, number | null>
  /** MiB of temp-file bytes written per minute by the whole database (counter delta). */
  readonly tempMiBPerMin: number | null
}

const delta = (
  a: readonly Sample[],
  b: readonly Sample[],
  name: string,
  where?: (l: Record<string, string>) => boolean,
): number | null => {
  const x = sumOf(a, name, where)
  const y = sumOf(b, name, where)
  if (x === null || y === null) return null
  // A counter that went backwards was reset (a restart): refuse to invent a rate across it.
  return y < x ? null : y - x
}
const per = (v: number | null, seconds: number, digits = 1): number | null =>
  v === null || seconds <= 0 ? null : Math.round((v / seconds) * 10 ** digits) / 10 ** digits

/** Rates between two scrapes `seconds` apart. A rate is null when either side lacks the series or a counter reset. */
export const rates = (a: readonly Sample[], b: readonly Sample[], seconds: number): Rates => {
  const cpuNow = new Map<string, number>()
  const cpuTotal = (x: readonly Sample[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const s of x.filter((y) => y.name === 'node_cpu_seconds_total')) {
      m.set(s.labels.mode ?? '?', (m.get(s.labels.mode ?? '?') ?? 0) + s.value)
    }
    return m
  }
  const ca = cpuTotal(a)
  const cb = cpuTotal(b)
  let all = 0
  for (const [mode, v] of cb) {
    const d = v - (ca.get(mode) ?? v)
    if (d >= 0) cpuNow.set(mode, d)
    all += d >= 0 ? d : 0
  }
  const cpu: Record<string, number | null> = {}
  for (const mode of ['user', 'system', 'iowait', 'steal', 'idle']) {
    cpu[mode] =
      ca.size === 0 || all <= 0 ? null : Math.round(((cpuNow.get(mode) ?? 0) / all) * 1000) / 10
  }
  const busy = (() => {
    const devs = new Set(
      b
        .filter((s) => s.name === 'node_disk_io_time_seconds_total' && isWholeDisk(s.labels))
        .map((s) => s.labels.device ?? ''),
    )
    let top: number | null = null
    for (const d of devs) {
      const dv = delta(a, b, 'node_disk_io_time_seconds_total', (l) => l.device === d)
      if (dv !== null && (top === null || dv > top)) top = dv
    }
    return top === null || seconds <= 0 ? null : Math.round((top / seconds) * 1000) / 1000
  })()
  const press: Record<string, number | null> = {}
  for (const n of ['cpu_waiting', 'memory_waiting', 'memory_stalled', 'io_waiting', 'io_stalled']) {
    const d = delta(a, b, `node_pressure_${n}_seconds_total`)
    press[n] = d === null || seconds <= 0 ? null : Math.round((d / seconds) * 1000) / 1000
  }
  const readB = delta(a, b, 'node_disk_read_bytes_total', isWholeDisk)
  const writB = delta(a, b, 'node_disk_written_bytes_total', isWholeDisk)
  const temp = delta(a, b, 'pg_stat_database_temp_bytes')
  return {
    seconds,
    swapInPagesPerS: per(delta(a, b, 'node_vmstat_pswpin'), seconds),
    swapOutPagesPerS: per(delta(a, b, 'node_vmstat_pswpout'), seconds),
    majorFaultsPerS: per(delta(a, b, 'node_vmstat_pgmajfault'), seconds),
    cpu,
    diskReadMBps: readB === null ? null : per(readB / MiB, seconds, 2),
    diskWriteMBps: writB === null ? null : per(writB / MiB, seconds, 2),
    diskReadsPerS: per(delta(a, b, 'node_disk_reads_completed_total', isWholeDisk), seconds),
    diskWritesPerS: per(delta(a, b, 'node_disk_writes_completed_total', isWholeDisk), seconds),
    diskBusyShare: busy,
    pressureShare: press,
    tempMiBPerMin:
      temp === null || seconds <= 0 ? null : Math.round(((temp / seconds) * 60) / 1024) / 1024,
  }
}
