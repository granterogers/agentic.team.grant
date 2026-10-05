import { describe, expect, it } from 'vitest'
import { familyCounts, parseAll, parseMetrics } from '../../scripts/forensics/metrics.ts'
import { derive, diskRoles, memory } from '../../scripts/forensics/metrics-derive.ts'

const MIB = 1024 * 1024
const L = 'supabase_project_ref="p",service_type="db"'

/** A synthetic exposition in the endpoint's real shape: labelled node series, two disks, two mountpoints, two cpus. */
const scrape = (o: {
  user: number
  system: number
  iowait: number
  steal: number
  idle: number
  dataReads: number
  dataWrites: number
  dataBytes: number
  dataIoTime: number
  rootReads: number
  rootWrites: number
  rootBytes: number
  swapOut: number
  tempBytes?: number
}): string =>
  [
    '# TYPE node_cpu_seconds_total counter',
    ...['0', '1'].flatMap((cpu) =>
      (['user', 'system', 'iowait', 'steal', 'idle'] as const).map(
        (mode) => `node_cpu_seconds_total{${L},cpu="${cpu}",mode="${mode}"} ${String(o[mode] / 2)}`,
      ),
    ),
    `node_memory_MemTotal_bytes{${L}} ${String(434 * MIB)}`,
    `node_memory_MemAvailable_bytes{${L}} ${String(40 * MIB)}`,
    `node_memory_MemFree_bytes{${L}} ${String(8 * MIB)}`,
    `node_memory_SwapTotal_bytes{${L}} ${String(1024 * MIB)}`,
    `node_memory_SwapFree_bytes{${L}} ${String(500 * MIB)}`,
    `node_vmstat_pswpout{${L}} ${String(o.swapOut)}`,
    `node_vmstat_pswpin{${L}} 0`,
    `node_filesystem_size_bytes{${L},device="/dev/nvme1n1p1",fstype="ext4",mountpoint="/data"} 2000000000`,
    `node_filesystem_size_bytes{${L},device="/dev/nvme0n1p1",fstype="ext4",mountpoint="/"} 8000000000`,
    `node_disk_reads_completed_total{${L},device="nvme1n1"} ${String(o.dataReads)}`,
    `node_disk_writes_completed_total{${L},device="nvme1n1"} ${String(o.dataWrites)}`,
    `node_disk_read_bytes_total{${L},device="nvme1n1"} ${String(o.dataBytes)}`,
    `node_disk_written_bytes_total{${L},device="nvme1n1"} 0`,
    `node_disk_io_time_seconds_total{${L},device="nvme1n1"} ${String(o.dataIoTime)}`,
    `node_disk_io_now{${L},device="nvme1n1"} 7`,
    `node_disk_reads_completed_total{${L},device="nvme0n1"} ${String(o.rootReads)}`,
    `node_disk_writes_completed_total{${L},device="nvme0n1"} ${String(o.rootWrites)}`,
    `node_disk_read_bytes_total{${L},device="nvme0n1"} ${String(o.rootBytes)}`,
    `pg_stat_database_temp_bytes{${L},datname="postgres"} ${String(o.tempBytes ?? 0)}`,
  ].join('\n')

const base = {
  user: 100,
  system: 50,
  iowait: 10,
  steal: 5,
  idle: 835,
  dataReads: 1000,
  dataWrites: 500,
  dataBytes: 100 * MIB,
  dataIoTime: 10,
  rootReads: 100,
  rootWrites: 50,
  rootBytes: 10 * MIB,
  swapOut: 1000,
}

describe('parseAll keeps every series; parseMetrics keeps the wanted subset', () => {
  const text = `${scrape(base)}\nsomething_unlisted_total{${L}} 3`
  it('parseAll sees a family the wanted list does not name; parseMetrics does not', () => {
    expect(parseAll(text).some((s) => s.name === 'something_unlisted_total')).toBe(true)
    expect(parseMetrics(text).some((s) => s.name === 'something_unlisted_total')).toBe(false)
  })
  it('skips NaN and +Inf and comment lines, and reports the families it kept', () => {
    const t = `# HELP x y\nx_total{a="b"} NaN\ny_total{a="b"} +Inf\nz_total{a="b"} 4\n`
    expect(parseAll(t)).toEqual([{ name: 'z_total', labels: { a: 'b' }, value: 4 }])
    expect(familyCounts(parseAll(t))).toEqual({ z_total: 1 })
  })
  it('control: an exposition with none of the series comes back empty', () => {
    expect(parseAll('')).toEqual([])
    expect(derive([], [], 60).devices).toEqual({})
  })
})

describe('disk roles come from the mountpoints in the same scrape', () => {
  const roles = diskRoles(parseAll(scrape(base)))
  it('a disk mounted under /data is the Postgres data volume; one mounted at / is the system volume', () => {
    expect(roles.nvme1n1).toBe('postgres-data')
    expect(roles.nvme0n1).toBe('system-root')
  })
  it('a disk with no mountpoint is unmapped, not guessed', () => {
    const s = parseAll(`node_disk_io_now{device="sdz"} 1`)
    expect(diskRoles(s).sdz).toBe('unmapped')
  })
})

describe('memory reading', () => {
  it('derives swap used and the available share without inventing values for absent series', () => {
    const m = memory(parseAll(scrape(base)))
    expect(m.swapUsedMiB).toBe(524)
    expect(m.availableShare).toBeCloseTo(40 / 434, 3)
    expect(m.cachedMiB).toBeNull()
    expect(memory([]).totalMiB).toBeNull()
  })
})

describe('derived rates between two scrapes', () => {
  const a = parseAll(scrape(base))
  const b = parseAll(
    scrape({
      ...base,
      user: 100 + 30,
      system: 50 + 20,
      iowait: 10 + 40,
      steal: 5 + 6,
      idle: 835 + 4,
      dataReads: 1000 + 600,
      dataWrites: 500 + 1200,
      dataBytes: 100 * MIB + 60 * MIB,
      dataIoTime: 10 + 54,
      rootReads: 100 + 6,
      rootWrites: 50 + 12,
      rootBytes: 10 * MIB + MIB,
      swapOut: 1000 + 6000,
      tempBytes: 5 * MIB,
    }),
  )
  const d = derive(a, b, 60)
  it('splits cpu time by mode, so iowait and steal are separate numbers', () => {
    // 100 units over the interval: user 30, system 20, iowait 40, steal 6, idle 4
    expect(d.cpuPercent.iowait).toBeGreaterThan(30)
    expect(d.cpuPercent.steal).toBeLessThan(10)
    expect(d.cpus).toBe(2)
  })
  it('keeps the two disks apart: per-device rates and busy share use that device only', () => {
    expect(d.devices.nvme1n1?.role).toBe('postgres-data')
    expect(d.devices.nvme1n1?.readsPerS).toBe(10)
    expect(d.devices.nvme1n1?.writesPerS).toBe(20)
    expect(d.devices.nvme1n1?.busyShare).toBeCloseTo(0.9, 3)
    expect(d.devices.nvme1n1?.ioNow).toBe(7)
    expect(d.devices.nvme0n1?.readsPerS).toBe(0.1)
    expect(d.devices.nvme0n1?.busyShare).toBeNull()
  })
  it('derives swap-out and postgres counter deltas', () => {
    expect(d.swapOutPagesPerS).toBeCloseTo(100, 0)
    expect(d.pgDeltas.pg_stat_database_temp_bytes).toBe(5 * MIB)
  })
  it('refuses a rate across a counter reset (a restart) instead of inventing one', () => {
    const reset = parseAll(scrape({ ...base, swapOut: 5, dataReads: 3 }))
    const r = derive(b, reset, 60)
    expect(r.swapOutPagesPerS).toBeNull()
    expect(r.devices.nvme1n1?.readsPerS).toBeNull()
  })
})
