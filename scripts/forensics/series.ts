/**
 * The metrics time series, rebuilt from the raw scrapes we kept (Supabase degradation forensics, 5 October 2026). READ ONLY, local.
 *
 *   npm run forensics:series [-- --out=docs/ops/forensics-series-2026-10-05.md]
 *
 * Every `.out/forensics/metrics/<epoch ms>.prom.gz` is a whole exposition, so any rate can be recomputed later with a better
 * derivation. This pairs consecutive samples that are 20 to 150 s apart (a longer gap hides a burst, so it is not paired), derives
 * rates with `derive`, and prints one row per interval plus two summaries that are the point of keeping the raw text: which
 * intervals wrote temp files (the producer of the unexplained 389 GB), and how far apart the paging bursts are. A row is DERIVED
 * from counters; nothing here is a reading of Supabase's own "Disk IO % consumed".
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseAll, type Sample } from './metrics.ts'
import { derive } from './metrics-derive.ts'

export interface Row {
  readonly at: string
  readonly seconds: number
  readonly swapIn: number | null
  readonly swapOut: number | null
  readonly faults: number | null
  readonly rootReads: number | null
  readonly rootWrites: number | null
  readonly dataWrites: number | null
  readonly iowait: number | null
  readonly steal: number | null
  readonly tempBytes: number | null
  readonly tempFiles: number | null
  readonly checkpointBufs: number | null
}

const sum = (d: Record<string, number>, ...names: string[]): number | null => {
  for (const n of names) if (d[n] !== undefined) return d[n] ?? null
  return null
}

/** Pair consecutive samples (oldest first) whose gap is 20 to 150 s and derive one row per pair. */
export const rowsFrom = (samples: { at: number; s: readonly Sample[] }[]): Row[] => {
  const out: Row[] = []
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1]
    const b = samples[i]
    if (a === undefined || b === undefined) continue
    const secs = (b.at - a.at) / 1000
    if (secs < 20 || secs > 150) continue
    const d = derive(a.s, b.s, secs)
    const root = Object.values(d.devices).find((v) => v.role === 'system-root')
    const data = Object.values(d.devices).find((v) => v.role === 'postgres-data')
    out.push({
      at: new Date(b.at).toISOString(),
      seconds: Math.round(secs),
      swapIn: d.swapInPagesPerS,
      swapOut: d.swapOutPagesPerS,
      faults: d.majorFaultsPerS,
      rootReads: root?.readsPerS ?? null,
      rootWrites: root?.writesPerS ?? null,
      dataWrites: data?.writesPerS ?? null,
      iowait: d.cpuPercent.iowait ?? null,
      steal: d.cpuPercent.steal ?? null,
      tempBytes: sum(
        d.pgDeltas,
        'pg_stat_database_temp_bytes_total',
        'pg_stat_database_temp_bytes',
      ),
      tempFiles: sum(
        d.pgDeltas,
        'pg_stat_database_temp_files_total',
        'pg_stat_database_temp_files',
      ),
      checkpointBufs: sum(d.pgDeltas, 'pg_stat_bgwriter_buffers_checkpoint_total'),
    })
  }
  return out
}

/** Minutes between the starts of consecutive bursts: a row whose paging is more than three times the median counts as one. */
export const burstSpacing = (rows: readonly Row[]): { minutes: number[]; threshold: number } => {
  const v = rows.map((r) => (r.swapIn ?? 0) + (r.swapOut ?? 0)).sort((x, y) => x - y)
  const median = v[Math.floor(v.length / 2)] ?? 0
  const threshold = Math.max(100, median * 3)
  const times = rows
    .filter((r) => (r.swapIn ?? 0) + (r.swapOut ?? 0) > threshold)
    .map((r) => Date.parse(r.at))
  const minutes: number[] = []
  for (let i = 1; i < times.length; i += 1) {
    const a = times[i - 1]
    const b = times[i]
    if (a !== undefined && b !== undefined) minutes.push(Math.round((b - a) / 6000) / 10)
  }
  return { minutes, threshold }
}

const f = (v: number | null): string => (v === null ? '-' : String(Math.round(v * 10) / 10))

export const render = (rows: readonly Row[]): string => {
  const head =
    '| time (UTC) | s | swap in/s | swap out/s | major faults/s | root reads/s | root writes/s | data writes/s | iowait % | steal % | temp bytes | temp files | ckpt buffers |'
  const lines = [
    head,
    `|---|${head
      .split('|')
      .slice(2, -1)
      .map(() => '---:')
      .join('|')}|`,
  ]
  for (const r of rows)
    lines.push(
      `| ${r.at.slice(5, 19).replace('T', ' ')} | ${r.seconds} | ${f(r.swapIn)} | ${f(r.swapOut)} | ${f(r.faults)} | ${f(r.rootReads)} | ${f(r.rootWrites)} | ${f(r.dataWrites)} | ${f(r.iowait)} | ${f(r.steal)} | ${f(r.tempBytes)} | ${f(r.tempFiles)} | ${f(r.checkpointBufs)} |`,
    )
  return lines.join('\n')
}

const main = (): void => {
  const dir = '.out/forensics/metrics'
  const files = readdirSync(dir)
    .filter((n) => n.endsWith('.prom.gz'))
    .sort()
  const samples = files.map((n) => ({
    at: Number(n.replace('.prom.gz', '')),
    s: parseAll(gunzipSync(readFileSync(`${dir}/${n}`)).toString('utf8')),
  }))
  const rows = rowsFrom(samples)
  const spacing = burstSpacing(rows)
  const temp = rows.filter((r) => (r.tempBytes ?? 0) > 0)
  const md = [
    '# Metrics series from the kept raw scrapes (generated)',
    '',
    `${String(samples.length)} raw samples, ${String(rows.length)} intervals of 20 to 150 s. All values DERIVED from counters.`,
    '',
    `**Intervals with temp-file writes:** ${String(temp.length)} of ${String(rows.length)}${temp.length > 0 ? ` (${temp.map((r) => `${r.at.slice(11, 19)}: ${f(r.tempBytes)} B in ${f(r.tempFiles)} files`).join('; ')})` : ''}`,
    '',
    `**Paging bursts (swap in + out above ${f(spacing.threshold)} pages/s):** spacing in minutes ${spacing.minutes.length > 0 ? spacing.minutes.join(', ') : 'n/a'}`,
    '',
    render(rows),
    '',
  ].join('\n')
  const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6)
  if (out === undefined) console.log(md)
  else {
    writeFileSync(out, md)
    console.log(
      `wrote ${out}: ${String(rows.length)} intervals, ${String(temp.length)} with temp writes`,
    )
  }
}

if (process.argv[1]?.endsWith('series.ts')) main()
