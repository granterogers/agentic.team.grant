/**
 * The worked example in docs/ops/backup-retention-policy.md, computed, not typed.
 *
 *   npx tsx scripts/ops/backup-retention-example.ts
 *
 * It runs the pure planner (src/backup/retention.ts) over the SHAPE of the 16-day nightly series recorded in
 * docs/audit/TIER1-PRODUCTION-EVIDENCE-2026-10-07.md: one backup a night from 21 September to 6 October, 12.6 MB at the
 * start and 26.0 MB at the end (sizes between the two are interpolated, which is an approximation; only the endpoints and
 * the day count come from the document). No bucket is read and no network is touched: it imports a pure function and
 * prints. It deletes nothing and cannot.
 */
import { DEFAULT_POLICY, planRetention, type RunInfo } from '../../src/backup/retention.ts'

const NIGHTS = 16
const FIRST = Date.parse('2026-09-21T02:00:00Z')
const DAY = 86_400_000
const MB = 1_000_000
const NOW = new Date('2026-10-07T12:00:00Z')

const series = (unverifiedDays: readonly string[]): RunInfo[] =>
  Array.from({ length: NIGHTS }, (_, i) => {
    const at = new Date(FIRST + i * DAY).toISOString()
    return {
      name: `run-${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
      at,
      bytes: Math.round((12.6 + ((26.0 - 12.6) * i) / (NIGHTS - 1)) * MB),
      complete: true,
      verified: !unverifiedDays.includes(at.slice(0, 10)),
    }
  })

const show = (title: string, runs: RunInfo[]): void => {
  const plan = planRetention(runs, NOW, DEFAULT_POLICY)
  const day = (name: string): string => (runs.find((r) => r.name === name)?.at ?? '').slice(0, 10)
  const mb = (b: number): string => (b / MB).toFixed(1)
  console.log(`\n## ${title}`)
  if (plan.refused !== null) console.log(`refused: ${plan.refused}`)
  const total = runs.reduce((a, r) => a + r.bytes, 0)
  console.log(`held ${String(runs.length)} runs, ${mb(total)} MB`)
  console.log('| Night | Decision | Rule |')
  console.log('|---|---|---|')
  const rows = [
    ...plan.keep.map((d) => ({ d: day(d.name), v: 'keep', r: d.rule })),
    ...plan.remove.map((d) => ({ d: day(d.name), v: 'DELETE', r: d.rule })),
    ...plan.unknown.map((d) => ({ d: day(d.name), v: 'unknown (reported)', r: d.rule })),
  ].sort((a, b) => a.d.localeCompare(b.d))
  for (const r of rows) console.log(`| ${r.d} | ${r.v} | ${r.r} |`)
  console.log(
    `keep ${String(plan.keep.length)} (${mb(plan.keep.reduce((a, d) => a + d.bytes, 0))} MB), delete ${String(plan.remove.length)} (${mb(plan.freedBytes)} MB), unknown ${String(plan.unknown.length)}`,
  )
}

show('A. every night verified', series([]))
show(
  'B. the nights of 3 and 5 October are NOT verified (hypothetical)',
  series(['2026-10-03', '2026-10-05']),
)
show(
  'C. only the newest night is verified (hypothetical: no older run has been read back yet)',
  series([]).map((r, i) => ({ ...r, verified: i === NIGHTS - 1 })),
)
