/**
 * Derived readings from two raw scrapes of the customer Metrics API (Supabase degradation forensics, 5 October 2026).
 *
 * Pure functions, no network, no clock. The raw exposition text is the evidence and is kept whole by the collector; everything
 * here is a DERIVED value, labelled as such in the report, and is never presented as Supabase's own "Disk IO % consumed" (the
 * burst balance is not an exported series; see the report). A rate is null when either scrape lacks the series or a counter went
 * backwards (a restart): a missing value is never a zero.
 */
import type { Sample } from './metrics.ts'

const MiB = 1024 * 1024
const r1 = (v: number): number => Math.round(v * 10) / 10
const r3 = (v: number): number => Math.round(v * 1000) / 1000

const gauge = (s: readonly Sample[], name: string): number | null => {
  const hits = s.filter((x) => x.name === name)
  return hits.length === 0 ? null : hits.reduce((a, x) => a + x.value, 0)
}
const counterDelta = (
  a: readonly Sample[],
  b: readonly Sample[],
  name: string,
  where?: (l: Record<string, string>) => boolean,
): number | null => {
  const pick = (x: readonly Sample[]): number | null => {
    const hits = x.filter((y) => y.name === name && (where === undefined || where(y.labels)))
    return hits.length === 0 ? null : hits.reduce((acc, y) => acc + y.value, 0)
  }
  const p = pick(a)
  const q = pick(b)
  if (p === null || q === null || q < p) return null
  return q - p
}

/**
 * Which role a block device plays, from the mountpoints the SAME scrape reports for it. The Postgres data volume is mounted under
 * /data; the root volume (system, and the swap file when swap is a file) at /. A device the filesystem series do not mention is
 * `unmapped`, not guessed: swap on a raw partition has no mountpoint and must be named from its own label by a person.
 */
export type DiskRole = 'postgres-data' | 'system-root' | 'other-mount' | 'unmapped'
export const diskRoles = (s: readonly Sample[]): Record<string, DiskRole> => {
  const byDev = new Map<string, Set<string>>()
  for (const x of s.filter((y) => y.name === 'node_filesystem_size_bytes')) {
    const dev = (x.labels.device ?? '').replace(/^\/dev\//, '')
    const mp = x.labels.mountpoint ?? ''
    if (dev === '' || mp === '') continue
    const set = byDev.get(dev) ?? new Set<string>()
    set.add(mp)
    byDev.set(dev, set)
  }
  const roles: Record<string, DiskRole> = {}
  const disks = new Set(
    s.filter((y) => y.name.startsWith('node_disk_')).map((y) => y.labels.device ?? ''),
  )
  for (const d of disks) {
    if (d === '') continue
    // A partition (nvme0n1p1) belongs to its disk (nvme0n1): look the mountpoint up by either.
    const mps = [
      ...(byDev.get(d) ?? []),
      ...[...byDev].filter(([k]) => k.startsWith(d)).flatMap(([, v]) => [...v]),
    ]
    roles[d] = mps.some((m) => m === '/data' || m.startsWith('/data/'))
      ? 'postgres-data'
      : mps.includes('/')
        ? 'system-root'
        : mps.length > 0
          ? 'other-mount'
          : 'unmapped'
  }
  return roles
}

export interface MemoryReading {
  readonly totalMiB: number | null
  readonly availableMiB: number | null
  readonly freeMiB: number | null
  readonly cachedMiB: number | null
  readonly buffersMiB: number | null
  readonly dirtyMiB: number | null
  readonly writebackMiB: number | null
  readonly anonMiB: number | null
  readonly shmemMiB: number | null
  readonly swapTotalMiB: number | null
  readonly swapFreeMiB: number | null
  /** DERIVED: SwapTotal - SwapFree. */
  readonly swapUsedMiB: number | null
  /** DERIVED: MemAvailable / MemTotal. */
  readonly availableShare: number | null
}
const m = (v: number | null): number | null => (v === null ? null : r1(v / MiB))

export const memory = (s: readonly Sample[]): MemoryReading => {
  const total = gauge(s, 'node_memory_MemTotal_bytes')
  const avail = gauge(s, 'node_memory_MemAvailable_bytes')
  const st = gauge(s, 'node_memory_SwapTotal_bytes')
  const sf = gauge(s, 'node_memory_SwapFree_bytes')
  return {
    totalMiB: m(total),
    availableMiB: m(avail),
    freeMiB: m(gauge(s, 'node_memory_MemFree_bytes')),
    cachedMiB: m(gauge(s, 'node_memory_Cached_bytes')),
    buffersMiB: m(gauge(s, 'node_memory_Buffers_bytes')),
    dirtyMiB: m(gauge(s, 'node_memory_Dirty_bytes')),
    writebackMiB: m(gauge(s, 'node_memory_Writeback_bytes')),
    anonMiB: m(gauge(s, 'node_memory_AnonPages_bytes')),
    shmemMiB: m(gauge(s, 'node_memory_Shmem_bytes')),
    swapTotalMiB: m(st),
    swapFreeMiB: m(sf),
    swapUsedMiB: st === null || sf === null ? null : m(st - sf),
    availableShare: total === null || avail === null || total <= 0 ? null : r3(avail / total),
  }
}

export interface DeviceRates {
  readonly role: DiskRole
  readonly readsPerS: number | null
  readonly writesPerS: number | null
  readonly readMBps: number | null
  readonly writeMBps: number | null
  /** Share of wall time with I/O in flight on the device (1 = saturated). DERIVED from node_disk_io_time_seconds_total. */
  readonly busyShare: number | null
  /** Mean queue depth. DERIVED from node_disk_io_time_weighted_seconds_total. */
  readonly queueDepth: number | null
  /** Mean milliseconds a completed read / write spent in the device (time counters over completed counters). */
  readonly readLatencyMs: number | null
  readonly writeLatencyMs: number | null
  /** Gauge at the second scrape: I/Os in flight right now. */
  readonly ioNow: number | null
}

export interface DerivedRates {
  readonly seconds: number
  /** Share of all CPU time by mode, summed over cpus, in percent. iowait and steal are the two that matter here. */
  readonly cpuPercent: Record<string, number | null>
  readonly cpus: number | null
  readonly swapInPagesPerS: number | null
  readonly swapOutPagesPerS: number | null
  readonly majorFaultsPerS: number | null
  readonly pageInKiBPerS: number | null
  readonly pageOutKiBPerS: number | null
  readonly oomKillsDelta: number | null
  readonly devices: Record<string, DeviceRates>
  /** Counter deltas for the Postgres exporter series that exist in the scrape, by family name. Empty when none are exported. */
  readonly pgDeltas: Record<string, number>
}

const per = (v: number | null, seconds: number, digits = 1): number | null =>
  v === null || seconds <= 0 ? null : Math.round((v / seconds) * 10 ** digits) / 10 ** digits

const PG_COUNTERS =
  /^(pg_stat_database_(temp_bytes|temp_files|xact_commit|xact_rollback|blks_read|blks_hit|deadlocks|conflicts|tup_(inserted|updated|deleted|fetched|returned))(_total)?|pg_stat_bgwriter_\w+_total|pg_stat_checkpointer_\w+|pg_stat_wal_\w+|pg_wal_\w+_total|pg_stat_archiver_\w+_total|pg_stat_statements_total_(queries|time_seconds))$/

export const derive = (
  a: readonly Sample[],
  b: readonly Sample[],
  seconds: number,
): DerivedRates => {
  const modes = (x: readonly Sample[]): Map<string, number> => {
    const out = new Map<string, number>()
    for (const y of x.filter((z) => z.name === 'node_cpu_seconds_total'))
      out.set(y.labels.mode ?? '?', (out.get(y.labels.mode ?? '?') ?? 0) + y.value)
    return out
  }
  const ma = modes(a)
  const mb = modes(b)
  let all = 0
  const d = new Map<string, number>()
  for (const [mode, v] of mb) {
    const dv = v - (ma.get(mode) ?? Number.NaN)
    if (Number.isFinite(dv) && dv >= 0) {
      d.set(mode, dv)
      all += dv
    }
  }
  const cpuPercent: Record<string, number | null> = {}
  for (const mode of ['user', 'system', 'iowait', 'steal', 'idle', 'nice', 'irq', 'softirq']) {
    cpuPercent[mode] =
      ma.size === 0 || all <= 0 || !d.has(mode) ? null : r1(((d.get(mode) ?? 0) / all) * 100)
  }
  const cpus =
    new Set(b.filter((y) => y.name === 'node_cpu_seconds_total').map((y) => y.labels.cpu ?? ''))
      .size || null

  const roles = diskRoles(b)
  const devices: Record<string, DeviceRates> = {}
  for (const [dev, role] of Object.entries(roles)) {
    const on = (l: Record<string, string>): boolean => l.device === dev
    const reads = counterDelta(a, b, 'node_disk_reads_completed_total', on)
    const writes = counterDelta(a, b, 'node_disk_writes_completed_total', on)
    const rb = counterDelta(a, b, 'node_disk_read_bytes_total', on)
    const wb = counterDelta(a, b, 'node_disk_written_bytes_total', on)
    const io = counterDelta(a, b, 'node_disk_io_time_seconds_total', on)
    const wt = counterDelta(a, b, 'node_disk_io_time_weighted_seconds_total', on)
    const rt = counterDelta(a, b, 'node_disk_read_time_seconds_total', on)
    const wtt = counterDelta(a, b, 'node_disk_write_time_seconds_total', on)
    devices[dev] = {
      role,
      readsPerS: per(reads, seconds),
      writesPerS: per(writes, seconds),
      readMBps: rb === null ? null : per(rb / MiB, seconds, 2),
      writeMBps: wb === null ? null : per(wb / MiB, seconds, 2),
      busyShare: io === null || seconds <= 0 ? null : r3(io / seconds),
      queueDepth: wt === null || seconds <= 0 ? null : r3(wt / seconds),
      readLatencyMs: rt === null || reads === null || reads <= 0 ? null : r1((rt / reads) * 1000),
      writeLatencyMs:
        wtt === null || writes === null || writes <= 0 ? null : r1((wtt / writes) * 1000),
      ioNow: b
        .filter((y) => y.name === 'node_disk_io_now' && on(y.labels))
        .reduce<number | null>((acc, y) => (acc ?? 0) + y.value, null),
    }
  }

  const pgNames = new Set(b.filter((y) => PG_COUNTERS.test(y.name)).map((y) => y.name))
  const pgDeltas: Record<string, number> = {}
  for (const n of pgNames) {
    const dv = counterDelta(a, b, n)
    if (dv !== null) pgDeltas[n] = dv
  }

  return {
    seconds,
    cpuPercent,
    cpus,
    swapInPagesPerS: per(counterDelta(a, b, 'node_vmstat_pswpin'), seconds),
    swapOutPagesPerS: per(counterDelta(a, b, 'node_vmstat_pswpout'), seconds),
    majorFaultsPerS: per(counterDelta(a, b, 'node_vmstat_pgmajfault'), seconds),
    pageInKiBPerS: per(counterDelta(a, b, 'node_vmstat_pgpgin'), seconds),
    pageOutKiBPerS: per(counterDelta(a, b, 'node_vmstat_pgpgout'), seconds),
    oomKillsDelta: counterDelta(a, b, 'node_vmstat_oom_kill'),
    devices,
    pgDeltas,
  }
}
