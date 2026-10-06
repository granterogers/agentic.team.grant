/**
 * Normal-load benchmark on two LOCAL replicas (efficiency run, 6 October 2026). No production contact, no model call.
 *
 *   npx tsx scripts/forensics/normal-load.ts <baseline-db> <candidate-db> [--day]
 *
 * Both databases are marked local replicas seeded to production shape (`scripts/isolated/seed-production-scale.sql`); the baseline is
 * the production line BEFORE the efficiency migrations and the candidate the full chain. It drives `resource-probe.ts` once per
 * database (with `--quiesce`, so queued work does not stand in for the standing path), prices a few scenarios against the results
 * and prints buffers touched and statements per minute and once, before and after. See normal-load-lib.ts for the arithmetic.
 *
 * It measures what the DATABASE does for a request. It cannot say how many tabs are open, how a 434 MiB host behaves, or what the
 * gateway and Auth cost; those are other documents' numbers.
 */
import { spawnSync } from 'node:child_process'
import { type Cost, change, price, SCENARIOS, touched } from './normal-load-lib.ts'

const args = process.argv.slice(2)
const [baseDb, candDb] = args
if (baseDb === undefined || candDb === undefined) {
  console.error('usage: normal-load.ts <baseline-db> <candidate-db> [--day]')
  process.exit(2)
}
const perDay = args.includes('--day')

const PROBES = [
  'worker.idle_pass',
  'team_hq.pulse',
  'team_hq.health_whole',
  'team_hq.thinking',
  'team_hq.studio',
  'team_hq.portfolio_tasks',
  'team_hq.lately',
  'team_hq.unseen',
  'team_hq.team_work',
]

const probe = (db: string, only: string[]): Record<string, Cost> => {
  const r = spawnSync(
    'npx',
    [
      'tsx',
      'scripts/forensics/resource-probe.ts',
      db,
      '--json',
      '--quiesce',
      `--only=${only.join(',')}`,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: '', SUPABASE_PROJECT_REF: '' },
    },
  )
  if (r.status !== 0) {
    console.error(`probe on ${db} failed:\n${r.stderr.slice(0, 600)}`)
    process.exit(1)
  }
  const j = JSON.parse(r.stdout) as { results: Record<string, Cost> }
  return j.results
}

// The baseline predates migration 1028, so its gateway's `thinking` was the whole health reading: run that, and map it.
const baseline = probe(
  baseDb,
  PROBES.filter((p) => p !== 'team_hq.thinking'),
)
const before = baseline['team_hq.health_whole']
if (before === undefined) throw new Error('the baseline run has no team_hq.health_whole')
baseline['team_hq.thinking'] = before
const candidate = probe(candDb, PROBES)

const k = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(Math.round(n))
const pct = (x: number | undefined): string =>
  x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`
const unit = perDay ? 'day' : 'minute'
const factor = perDay ? 1440 : 1

console.log(
  `baseline ${baseDb} -> candidate ${candDb}; buffers touched (hit+read) and statements per ${unit}\n`,
)
console.log('per-call (touched buffers, statements):')
for (const p of PROBES) {
  const b = baseline[p]
  const c = candidate[p]
  if (b === undefined || c === undefined) continue
  console.log(
    `  ${p.padEnd(26)} ${k(touched(b)).padStart(7)} -> ${k(touched(c)).padStart(7)}  (${pct(change(touched(b), touched(c)))})   stmts ${k(b.statements)} -> ${k(c.statements)}`,
  )
}
console.log()
for (const s of SCENARIOS) {
  const b = price(s, baseline)
  const c = price(s, candidate)
  console.log(`${s.name}: ${s.what}`)
  if (Object.keys(s.perMinute).length > 0)
    console.log(
      `  per ${unit}: touched ${k(b.touchedPerMinute * factor)} -> ${k(c.touchedPerMinute * factor)} (${pct(change(b.touchedPerMinute, c.touchedPerMinute))}); statements ${k(b.statementsPerMinute * factor)} -> ${k(c.statementsPerMinute * factor)} (${pct(change(b.statementsPerMinute, c.statementsPerMinute))})`,
    )
  if (b.touchedOnce > 0 || c.touchedOnce > 0)
    console.log(
      `  once: touched ${k(b.touchedOnce)} -> ${k(c.touchedOnce)} (${pct(change(b.touchedOnce, c.touchedOnce))}); statements ${k(b.statementsOnce)} -> ${k(c.statementsOnce)} (${pct(change(b.statementsOnce, c.statementsOnce))})`,
    )
}
process.exit(0)
