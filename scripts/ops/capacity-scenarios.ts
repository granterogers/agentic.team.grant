/**
 * The arithmetic behind docs/ops/capacity-scenarios-2026-10-06.md, reproducible.
 *
 *   npx tsx scripts/ops/capacity-scenarios.ts
 *
 * No network, no database, no production contact: every input below is a figure RECORDED in the repository's own
 * documents (the file and line each came from is in the document), or an assumption labelled INFERRED, and the output
 * is only arithmetic over them. Change an assumption here and the tables in the document are what to regenerate.
 */
import { DEFAULT_POLICY, planRetention, type RunInfo } from '../../src/backup/retention.ts'

const MB = 1_000_000
const DAY = 86_400_000
const at = (iso: string): number => Date.parse(iso)

/** RECORDED database sizes (decimal MB; see the unit caveat in the document). */
const DB_POINTS: readonly [string, number][] = [
  ['2026-09-14T12:00:00Z', 50],
  ['2026-09-17T12:00:00Z', 63],
  ['2026-10-02T14:33:00Z', 328],
  ['2026-10-03T12:00:00Z', 329],
  ['2026-10-04T06:53:00Z', 346],
  ['2026-10-05T07:37:00Z', 371.772563],
]
const T0 = at('2026-10-05T07:37:00Z')
const B0 = 371.772563

const dbAt = (t: number): number => {
  const first = DB_POINTS[0] as [string, number]
  if (t <= at(first[0])) return 48 // the undated early-September reading
  for (let i = 1; i < DB_POINTS.length; i++) {
    const [ta, a] = DB_POINTS[i - 1] as [string, number]
    const [tb, b] = DB_POINTS[i] as [string, number]
    if (t <= at(tb)) return a + ((b - a) * (t - at(ta))) / (at(tb) - at(ta))
  }
  return B0
}

interface Scenario {
  readonly name: string
  readonly dbRate: number // MB a day, from T0
  readonly ratio: number // archive bytes per database byte
  readonly fixedStorage: number // MB of everything in Storage that is not a backup
}
const SCENARIOS: readonly Scenario[] = [
  { name: 'optimistic', dbRate: 9, ratio: 0.07, fixedStorage: 40 },
  { name: 'central', dbRate: 17, ratio: 0.1, fixedStorage: 80 },
  { name: 'pessimistic', dbRate: 26, ratio: 0.15, fixedStorage: 150 },
]

const fmt = (t: number): string => new Date(t).toISOString().slice(0, 10)
const LINES = [70, 80, 85, 90, 95, 100]

console.log(
  '## Database: date each line is crossed (limit 500 MB decimal; reading 371.8 MB at 5 Oct 07:37 UTC)\n',
)
console.log(`| Scenario | MB/day | ${LINES.map((l) => `${String(l)}%`).join(' | ')} |`)
console.log(`|---|---|${LINES.map(() => '---').join('|')}|`)
for (const s of SCENARIOS) {
  const cells = LINES.map((l) => {
    const need = (500 * l) / 100 - B0
    return need <= 0 ? 'crossed' : fmt(T0 + (need / s.dbRate) * DAY)
  })
  console.log(`| ${s.name} | ${String(s.dbRate)} | ${cells.join(' | ')} |`)
}
console.log('\nSame, against the 524.3 MB (500 MiB) line `app.free_tier_headroom()` uses today:\n')
console.log(`| Scenario | 85% | 90% | 95% | 100% |`)
console.log('|---|---|---|---|---|')
for (const s of SCENARIOS) {
  const cells = [85, 90, 95, 100].map((l) =>
    fmt(T0 + (((524.288 * l) / 100 - B0) / s.dbRate) * DAY),
  )
  console.log(`| ${s.name} | ${cells.join(' | ')} |`)
}

// ---- Storage ------------------------------------------------------------------------------------------------------

/** One nightly run a day at 12:30 UTC from 27 Aug (26 runs held on 21 Sep, with 17 Sep missing). */
const FIRST_RUN = at('2026-08-26T12:30:00Z')
const MISSING = fmt(at('2026-09-17T12:30:00Z'))

const runSize = (t: number, ratio: number, scenario: Scenario | null): number => {
  const db = scenario !== null && t > T0 ? B0 + (scenario.dbRate * (t - T0)) / DAY : dbAt(t)
  return db * ratio
}

console.log('\n## Calibration of the archive ratio against the two RECORDED archive sizes\n')
console.log('| Run | Recorded size | Database that day (interpolated, INFERRED) | Ratio |')
console.log('|---|---|---|---|')
for (const [label, iso, size] of [
  ['18 Sep (107,255 rows)', '2026-09-18T12:30:00Z', 9.6],
  ['21 Sep (153,259 rows)', '2026-09-21T12:34:00Z', 12.5],
] as const) {
  const db = dbAt(at(iso))
  console.log(
    `| ${label} | ${String(size)} MB | ${db.toFixed(0)} MB | ${((size / db) * 100).toFixed(1)}% |`,
  )
}

console.log('\n## Storage (limit 1 GB decimal; backups never deleted)\n')
const storageRows: string[] = []
const afterRows: string[] = []
const state: { s: Scenario; total: (t: number) => number; runs: (t: number) => RunInfo[] }[] = []
for (const s of SCENARIOS) {
  const runsUpTo = (t: number): RunInfo[] => {
    const out: RunInfo[] = []
    for (let r = FIRST_RUN; r <= t; r += DAY) {
      if (fmt(r) === MISSING) continue
      out.push({
        name: `run-${out.length.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
        at: new Date(r).toISOString(),
        bytes: runSize(r, s.ratio, s) * MB,
        complete: true,
        verified: true,
      })
    }
    return out
  }
  const total = (t: number): number =>
    s.fixedStorage + runsUpTo(t).reduce((a, r) => a + r.bytes, 0) / MB
  state.push({ s, total, runs: runsUpTo })
  const heldAt21 = runsUpTo(at('2026-09-21T12:40:00Z'))
  const at21 = heldAt21.reduce((a, r) => a + r.bytes, 0) / MB
  const cells = LINES.map((l) => {
    const line = (1000 * l) / 100
    if (total(T0) >= line) return 'crossed'
    for (let t = T0; t < T0 + 400 * DAY; t += DAY) if (total(t) >= line) return fmt(t)
    return 'beyond 400 days'
  })
  storageRows.push(
    `| ${s.name} | ${(s.ratio * 100).toFixed(0)}% | ${String(s.fixedStorage)} MB | ${String(heldAt21.length)} runs, ${at21.toFixed(0)} MB | ${total(T0).toFixed(0)} MB (${((total(T0) / 1000) * 100).toFixed(0)}%) | ${cells.join(' | ')} |`,
  )
  // After the proposed policy is applied on 8 Oct, nightly thereafter.
  const applyAt = at('2026-10-08T13:00:00Z')
  const kept = (t: number): number => {
    const runs = runsUpTo(t)
    const plan = planRetention(runs, new Date(t + 30 * 60_000), {
      ...DEFAULT_POLICY,
      maxDeletes: 1000,
    })
    return s.fixedStorage + plan.keep.reduce((a, d) => a + d.bytes, 0) / MB
  }
  const keptNow = kept(applyAt)
  const afterCells = LINES.map((l) => {
    const line = (1000 * l) / 100
    if (keptNow >= line) return 'crossed'
    for (let t = applyAt; t < applyAt + 400 * DAY; t += DAY) if (kept(t) >= line) return fmt(t)
    return 'beyond 400 days'
  })
  afterRows.push(
    `| ${s.name} | ${total(applyAt).toFixed(0)} MB | ${keptNow.toFixed(0)} MB | ${afterCells.join(' | ')} |`,
  )
}
console.log(
  `| Scenario | Archive/DB ratio | Non-backup Storage | Modelled held at 21 Sep (recorded: 26 runs) | Modelled total at 5 Oct 07:37 | ${LINES.map((l) => `${String(l)}%`).join(' | ')} |`,
)
console.log(`|---|---|---|---|---|${LINES.map(() => '---').join('|')}|`)
for (const r of storageRows) console.log(r)

console.log(
  '\n## Storage after the keep-last-7 plus 8 weekly policy is applied on 8 Oct (then nightly)\n',
)
console.log(
  `| Scenario | Total on 8 Oct before | Total on 8 Oct after | ${LINES.map((l) => `${String(l)}%`).join(' | ')} |`,
)
console.log(`|---|---|---|${LINES.map(() => '---').join('|')}|`)
for (const r of afterRows) console.log(r)

console.log('\n## Size of one nightly archive over the next fortnight (MB)\n')
console.log('| Scenario | 5 Oct | 12 Oct | 19 Oct |')
console.log('|---|---|---|---|')
for (const s of SCENARIOS)
  console.log(
    `| ${s.name} | ${runSize(T0, s.ratio, s).toFixed(0)} | ${runSize(T0 + 7 * DAY, s.ratio, s).toFixed(0)} | ${runSize(T0 + 14 * DAY, s.ratio, s).toFixed(0)} |`,
  )
