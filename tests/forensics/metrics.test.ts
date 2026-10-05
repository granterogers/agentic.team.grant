import { describe, expect, it } from 'vitest'
import {
  answered,
  parseMetrics,
  qualify,
  rates,
  snapshot,
} from '../../scripts/forensics/metrics.ts'

describe('answered: the read-only endpoint answers 201 on success', () => {
  it('accepts 200 and 201 (a POST that ran), and refuses a timeout, a server error and a throttle', () => {
    expect(answered(201)).toBe(true)
    expect(answered(200)).toBe(true)
    expect(answered(0)).toBe(false)
    expect(answered(500)).toBe(false)
    expect(answered(429)).toBe(false)
  })
})

const MIB = 1024 * 1024
/** A synthetic exposition shaped like the host's: a small box that pages at rest. */
const scrape = (o: {
  swapIn: number
  swapOut: number
  faults: number
  idle: number
  iowait: number
  steal: number
  user: number
  system: number
  read: number
  written: number
  ioTime: number
  temp: number
  stalled?: number
}): string =>
  [
    '# HELP node_memory_MemTotal_bytes Memory information field MemTotal_bytes.',
    `node_memory_MemTotal_bytes ${String(434 * MIB)}`,
    `node_memory_MemAvailable_bytes ${String(106 * MIB)}`,
    `node_memory_SwapTotal_bytes ${String(1024 * MIB)}`,
    `node_memory_SwapFree_bytes ${String(500 * MIB)}`,
    `node_vmstat_pswpin ${String(o.swapIn)}`,
    `node_vmstat_pswpout ${String(o.swapOut)}`,
    `node_vmstat_pgmajfault ${String(o.faults)}`,
    'node_vmstat_oom_kill 0',
    `node_cpu_seconds_total{cpu="0",mode="idle"} ${String(o.idle / 2)}`,
    `node_cpu_seconds_total{cpu="1",mode="idle"} ${String(o.idle / 2)}`,
    `node_cpu_seconds_total{cpu="0",mode="iowait"} ${String(o.iowait)}`,
    `node_cpu_seconds_total{cpu="0",mode="steal"} ${String(o.steal)}`,
    `node_cpu_seconds_total{cpu="0",mode="user"} ${String(o.user)}`,
    `node_cpu_seconds_total{cpu="0",mode="system"} ${String(o.system)}`,
    `node_disk_read_bytes_total{device="nvme0n1"} ${String(o.read)}`,
    `node_disk_read_bytes_total{device="nvme0n1p1"} ${String(o.read)}`,
    `node_disk_written_bytes_total{device="nvme1n1"} ${String(o.written)}`,
    `node_disk_io_time_seconds_total{device="nvme0n1"} ${String(o.ioTime)}`,
    ...(o.stalled === undefined
      ? []
      : [`node_pressure_io_stalled_seconds_total ${String(o.stalled)}`]),
    `pg_stat_database_temp_bytes{datname="postgres"} ${String(o.temp)}`,
    'unrelated_metric_total 99',
    'garbage line that is not a metric',
  ].join('\n')

describe('parseMetrics', () => {
  it('keeps the series a memory and I/O diagnosis needs and drops the rest', () => {
    const s = parseMetrics(
      scrape({
        swapIn: 1,
        swapOut: 1,
        faults: 1,
        idle: 100,
        iowait: 1,
        steal: 0,
        user: 1,
        system: 1,
        read: 1,
        written: 1,
        ioTime: 1,
        temp: 1,
      }),
    )
    expect(s.some((x) => x.name === 'node_memory_MemTotal_bytes')).toBe(true)
    expect(s.some((x) => x.name === 'unrelated_metric_total')).toBe(false)
    expect(s.find((x) => x.name === 'node_cpu_seconds_total')?.labels.mode).toBe('idle')
  })

  it('CONTROL: an exposition with none of the series yields nothing, so "nothing found" is a real answer', () => {
    expect(parseMetrics('# nothing\nfoo_total 1\nbar{a="b"} 2\n')).toEqual([])
    const snap = snapshot([])
    expect(snap.memTotalMiB).toBeNull()
    expect(snap.swapUsedMiB).toBeNull()
    expect(rates([], [], 60).swapInPagesPerS).toBeNull()
  })
})

describe('qualify (the read-only endpoint wants schema-qualified references)', () => {
  it('qualifies a statistics view, the extension, and leaves functions and columns alone', () => {
    expect(qualify('select 1 from pg_stat_database where datname = current_database()')).toBe(
      'select 1 from pg_catalog.pg_stat_database where datname = current_database()',
    )
    expect(qualify('select q from pg_stat_statements order by 1')).toBe(
      'select q from extensions.pg_stat_statements order by 1',
    )
    expect(qualify('select pg_postmaster_start_time(), pg_backend_pid() as pg_stat_x')).toBe(
      'select pg_postmaster_start_time(), pg_backend_pid() as pg_stat_x',
    )
  })

  it('does not double-qualify what is already qualified', () => {
    expect(qualify('select 1 from pg_catalog.pg_locks')).toBe('select 1 from pg_catalog.pg_locks')
  })
})

describe('snapshot', () => {
  it('reports memory, swap in use and the pressure series only when the kernel exports them', () => {
    const s = parseMetrics(
      scrape({
        swapIn: 1,
        swapOut: 1,
        faults: 1,
        idle: 100,
        iowait: 1,
        steal: 0,
        user: 1,
        system: 1,
        read: 1,
        written: 1,
        ioTime: 1,
        temp: 1,
      }),
    )
    const snap = snapshot(s)
    expect(snap.memTotalMiB).toBe(434)
    expect(snap.swapUsedMiB).toBe(524)
    expect(snap.pressure.io_stalled).toBeNull()
    const withPsi = snapshot(
      parseMetrics(
        scrape({
          swapIn: 1,
          swapOut: 1,
          faults: 1,
          idle: 1,
          iowait: 1,
          steal: 0,
          user: 1,
          system: 1,
          read: 1,
          written: 1,
          ioTime: 1,
          temp: 1,
          stalled: 7,
        }),
      ),
    )
    expect(withPsi.pressure.io_stalled).toBe(7)
  })
})

describe('rates', () => {
  const a = parseMetrics(
    scrape({
      swapIn: 1000,
      swapOut: 500,
      faults: 4000,
      idle: 1000,
      iowait: 10,
      steal: 1,
      user: 20,
      system: 10,
      read: 100 * MIB,
      written: 50 * MIB,
      ioTime: 100,
      temp: 1000 * MIB,
    }),
  )
  const b = parseMetrics(
    scrape({
      swapIn: 1000 + 60 * 48,
      swapOut: 500 + 60 * 19,
      faults: 4000 + 60 * 145,
      idle: 1000 + 115,
      iowait: 10 + 2,
      steal: 1,
      user: 20 + 2,
      system: 10 + 1,
      read: 100 * MIB + 60 * 2.6 * MIB,
      written: 50 * MIB + 60 * 0.5 * MIB,
      ioTime: 100 + 30,
      temp: 1000 * MIB + 120 * MIB,
      stalled: 0,
    }),
  )

  it('turns two cumulative scrapes into per-second rates', () => {
    const r = rates(a, b, 60)
    expect(r.swapInPagesPerS).toBe(48)
    expect(r.swapOutPagesPerS).toBe(19)
    expect(r.majorFaultsPerS).toBe(145)
    expect(r.diskReadMBps).toBe(2.6)
    expect(r.tempMiBPerMin).toBe(120)
  })

  it('counts a whole disk once: a partition of it is not added again', () => {
    expect(rates(a, b, 60).diskReadMBps).toBe(2.6)
  })

  it('reads the busiest whole disk as a share of wall time', () => {
    expect(rates(a, b, 60).diskBusyShare).toBe(0.5)
  })

  it('splits CPU by mode and shows steal and iowait separately', () => {
    const r = rates(a, b, 60)
    expect(r.cpu.idle).toBeGreaterThan(90)
    expect(r.cpu.steal).toBe(0)
    expect(r.cpu.iowait).toBeGreaterThan(0)
  })

  it('refuses to invent a rate across a counter reset (a restart)', () => {
    const reset = parseMetrics(
      scrape({
        swapIn: 5,
        swapOut: 5,
        faults: 5,
        idle: 1,
        iowait: 0,
        steal: 0,
        user: 0,
        system: 0,
        read: 1,
        written: 1,
        ioTime: 1,
        temp: 1,
      }),
    )
    const r = rates(b, reset, 60)
    expect(r.swapInPagesPerS).toBeNull()
    expect(r.tempMiBPerMin).toBeNull()
  })
})
