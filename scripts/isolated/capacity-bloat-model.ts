// biome-ignore-all lint/suspicious/noExplicitAny: the replica's rows are untyped
// biome-ignore-all lint/style/noNonNullAssertion: a model over rows it has just created
// biome-ignore-all format: a dense model script kept readable as written
/**
 * What update churn does to a table's size, and what a rewrite gives back (capacity investigation, 11 October 2026).
 *
 *   npx tsx scripts/isolated/capacity-bloat-model.ts <replica-db> [rows] [updates-a-row]
 *
 * The recorded production `jobs` table was 108 MB for 22 647 live rows after about 1.08 million updates (about 48 a row, 5 percent of them HOT),
 * that is 4.8 KB a row against a row that is a small fraction of that. This applies the same churn (every update changes an indexed column, so
 * none can be HOT, and a vacuum runs between rounds the way autovacuum does) to a copy of the real `jobs` table on a replica and reports how large
 * the table and its indexes get, how large they would be freshly built, and what a rewrite (VACUUM FULL, the table is locked for its duration)
 * takes, needs and returns. It is a MODEL: the factor depends on row width and on how often vacuum runs, and the production figure comes from
 * the baseline reads (Q03, Q05, Q06 of scripts/ops/capacity-baseline.sql). Disposable replica only.
 */
import { cloneVolume } from './activity-scale-seed.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const dbName = process.argv[2] ?? 'ledger'
const ROWS = Number(process.argv[3] ?? 3000)
const UPDATES = Number(process.argv[4] ?? 48)
const db = await isolated(dbName)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, any>
const mb = (b: number) => (b / 1_000_000).toFixed(2)
const total = async () => Number((await one(`select pg_total_relation_size('public.jobs') as b`)).b)
const dbSize = async () => Number((await one(`select pg_database_size(current_database()) as b`)).b)

let exit = 1
try {
  const grant = String((await one(`select app.operator_office() as o`)).o)
  const root = await realParent(db)
  const project = String((await one(`select project_id::text as p from public.jobs where job_id = ${lit(root)}::uuid`)).p)
  await db.execute(`select app.enqueue_child(app.job_office(${lit(root)}::uuid), ${lit(root)}::uuid, 'office.instruction', '{}'::jsonb, interval '0', true, ${lit(project)}::uuid) from generate_series(1, 300)`)
  await cloneVolume(db, grant, grant, project, Math.ceil(ROWS / 300), 300)
  await db.execute('alter table public.jobs set (autovacuum_enabled = false)')
  await db.execute('vacuum (analyze) public.jobs')
  const rows = Number((await one(`select count(*) as c from public.jobs`)).c)
  const fresh = await total()
  const rowWidth = Number((await one(`select round(avg(pg_column_size(j.*))) as w from public.jobs j`)).w)
  const indexes = Number((await one(`select count(*) as c from pg_index where indrelid = 'public.jobs'::regclass`)).c)
  console.log(`jobs copy: ${rows} rows, ${indexes} indexes, average row ${rowWidth} B; freshly loaded ${mb(fresh)} MB (${(fresh / rows).toFixed(0)} B a row with its indexes)`)
  console.log(`   (production: 22 647 rows, 108.2 MB, 4 780 B a row with its indexes, about ${UPDATES} updates a row since August)`)
  const trace: string[] = []
  let peak = fresh
  for (let round = 1; round <= UPDATES; round++) {
    // every update changes a column an index names (trace_pence is in the predicate of jobs_finished_with_spend_idx), so none can be HOT, and the
    // table has ten indexes that each need an entry for every new row version: the state reason travels with the row, as it does in production
    await db.execute(`begin; set local session_replication_role = replica;
      update public.jobs set updated_at = now(), trace_pence = coalesce(trace_pence, 0) + 0.0001, state_reason = md5(random()::text); commit`)
    if (round % 6 === 0) await db.execute('vacuum public.jobs') // what autovacuum does on a churning table, about once a minute
    const t = await total()
    peak = Math.max(peak, t)
    if (round % 12 === 0) trace.push(`${round} updates a row: ${mb(t)} MB`)
  }
  await db.execute('vacuum public.jobs')
  const churned = await total()
  console.log(`after ${UPDATES} updates a row with a vacuum every six rounds: ${mb(churned)} MB (${(churned / rows).toFixed(0)} B a row), ${(churned / fresh).toFixed(1)} times the fresh size; ${trace.join('; ')}`)
  const dead = Number((await one(`select n_dead_tup as d from pg_stat_user_tables where relname = 'jobs'`)).d)
  console.log(`   dead tuples now ${dead} (the free space is inside the pages: the file does not shrink)`)
  const before = await dbSize()
  let peakDuring = before
  const sampler = setInterval(() => void dbSize().then((s) => { peakDuring = Math.max(peakDuring, s) }).catch(() => undefined), 20)
  const t0 = performance.now()
  await db.execute('vacuum full public.jobs')
  const ms = performance.now() - t0
  clearInterval(sampler)
  const rewritten = await total()
  await db.execute('alter table public.jobs reset (autovacuum_enabled)')
  console.log(`VACUUM FULL: ${ms.toFixed(0)} ms for ${mb(churned)} MB, the table locked throughout; after it ${mb(rewritten)} MB (${(rewritten / rows).toFixed(0)} B a row), ${mb(churned - rewritten)} MB returned (${(((churned - rewritten) / churned) * 100).toFixed(0)}%)`)
  console.log(`   the database peaked ${mb(Math.max(peakDuring - before, 0))} MB above its starting size while the new copy was written (the old file is freed at the end)`)
  const share = (churned - rewritten) / churned
  console.log(`\nIf production's jobs table has the same churn, its 108.2 MB would return about ${mb(share * 108_249_088)} MB; a table with less slack returns less. Measure first (Q05 and Q06).`)
  if (!(rewritten < churned)) throw new Error('a rewrite returned nothing: the model did not produce slack')
  exit = 0
} finally {
  await db.end()
}
process.exit(exit)
