/**
 * What does one job cost the database to live and die? A local A/B between two schema generations.
 *
 *   npx tsx scripts/forensics/job-lifecycle-cost.ts <replica-db> [jobs=1500]
 *
 * Why it exists (Supabase degradation forensics, 4 October 2026): the question "did the multi-user work make the standing
 * database workload heavier?" cannot be answered from production while production is unhealthy, but the per-unit write cost of
 * the central table CAN be measured on the isolated replica, on the same Postgres, with the same code path, against the two
 * schema generations the replica can be built in (`premu` = every migration before 0654, `post` = HEAD).
 *
 * What it does: for each of N jobs, the real life a job has - one insert, the legal state walk to `complete`, and a few lease
 * heartbeats - as separate autocommit statements, the way the worker issues them, so every trigger, index and constraint of the
 * schema under test is exercised. It reports what that cost in WAL bytes, buffer traffic, wall time and index size per job.
 *
 * What it does NOT do: it is not production. There is no production data, no concurrency, a different disk and an unconstrained
 * host, so it says how much WORK a unit of the product is, never how a 0.5 GB host will behave. It spends no model call and
 * touches nothing but the replica it is pointed at (guard.ts refuses anything else).
 */
import { isolated } from './../isolated/guard.ts'

const database = process.argv[2] ?? 'post'
const N = Number(process.argv[3] ?? 1500)
const db = await isolated(database)
const q = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const hasOffice =
  (
    await q(
      `select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='office_id'`,
    )
  ).length > 0
const office = hasOffice ? String((await q(`select app.test_office()::text o`))[0]?.o) : ''
const run = Math.random().toString(36).slice(2, 8)

// The walk a worker-run job takes, one statement each (the transition trigger refuses any other order).
const WALK = [
  'running',
  'output_created',
  'quality_review',
  'committing',
  'committed',
  'notifying',
  'complete',
] as const

const lsn = async (): Promise<string> =>
  String((await q(`select pg_current_wal_lsn()::text l`))[0]?.l)
const diffBytes = async (a: string, b: string): Promise<number> =>
  Number((await q(`select pg_wal_lsn_diff(${lit(b)}::pg_lsn, ${lit(a)}::pg_lsn)::bigint d`))[0]?.d)
const stat = async (): Promise<{ blks_hit: number; blks_read: number; tup_updated: number }> => {
  const r = (
    await q(`select blks_hit, blks_read, tup_updated
               from pg_stat_database where datname = current_database()`)
  )[0] as Record<string, unknown>
  return {
    blks_hit: Number(r.blks_hit),
    blks_read: Number(r.blks_read),
    tup_updated: Number(r.tup_updated),
  }
}

/** Per-table write counters, so the cost can be attributed: which table, how many inserts and updates, how many updates were HOT. */
const tableCounters = async (): Promise<Map<string, [number, number, number]>> => {
  const out = new Map<string, [number, number, number]>()
  for (const r of await q(
    `select relname, n_tup_ins, n_tup_upd, n_tup_hot_upd from pg_stat_user_tables where schemaname = 'public'`,
  )) {
    out.set(String(r.relname), [Number(r.n_tup_ins), Number(r.n_tup_upd), Number(r.n_tup_hot_upd)])
  }
  return out
}
await q('select pg_stat_force_next_flush()').catch(() => undefined)
const tablesBefore = await tableCounters()
const before = await stat()
const l0 = await lsn()
const t0 = Date.now()
for (let i = 0; i < N; i += 1) {
  const key = `forensic-${run}-${String(i)}`
  const ins = await q(
    `insert into public.jobs (${hasOffice ? 'office_id, ' : ''}correlation_id, idempotency_key, kind, requested_by)
     values (${hasOffice ? `${lit(office)}::uuid, ` : ''}gen_random_uuid(), ${lit(key)}, 'forensic.probe', ${lit(`verify:forensic-${run}`)})
     returning job_id::text id`,
  )
  const id = String(ins[0]?.id)
  for (const state of WALK) {
    await q(
      `update public.jobs set state = ${lit(state)}::job_state${state === 'running' ? ", leased_by = 'forensic', leased_until = now() + interval '5 minutes', attempt = attempt + 1" : ''} where job_id = ${lit(id)}::uuid`,
    )
    if (state === 'running') {
      // three lease heartbeats while it runs, as the worker extends a lease
      for (let h = 0; h < 3; h += 1) {
        await q(
          `update public.jobs set leased_until = now() + interval '5 minutes' where job_id = ${lit(id)}::uuid`,
        )
      }
    }
  }
}
const ms = Date.now() - t0
const l1 = await lsn()
await q('select pg_stat_force_next_flush()').catch(() => undefined)
const after = await stat()
const wal = await diffBytes(l0, l1)
const sizes = (
  await q(`select pg_relation_size('public.jobs') heap,
                  pg_indexes_size('public.jobs') idx,
                  (select count(*) from pg_indexes where schemaname='public' and tablename='jobs')::int n_idx`)
)[0] as Record<string, unknown>
const per = (x: number): number => Math.round((x / N) * 10) / 10
const statements = 1 + WALK.length + 3
const tablesAfter = await tableCounters()
const written: Record<string, { ins_per_job: number; upd_per_job: number; hot_upd_per_job: number }> = {}
for (const [name, a] of tablesAfter) {
  const b = tablesBefore.get(name) ?? [0, 0, 0]
  const d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as [number, number, number]
  if (d[0] + d[1] > 0) written[name] = { ins_per_job: per(d[0]), upd_per_job: per(d[1]), hot_upd_per_job: per(d[2]) }
}
console.log(
  JSON.stringify(
    {
      database,
      schema: hasOffice ? 'multi-user (office_id present)' : 'pre-multi-user',
      jobs: N,
      statements_per_job: statements,
      ms_per_job: per(ms),
      wal_bytes_per_job: per(wal),
      wal_bytes_per_statement: Math.round(wal / (N * statements)),
      shared_blocks_hit_per_job: per(after.blks_hit - before.blks_hit),
      shared_blocks_read_per_job: per(after.blks_read - before.blks_read),
      tuples_updated_per_job: per(after.tup_updated - before.tup_updated),
      jobs_indexes: Number(sizes.n_idx),
      jobs_index_bytes_per_job: per(Number(sizes.idx)),
      tables_written_per_job: written,
    },
    null,
    1,
  ),
)

// Teardown: a job cannot be deleted by the product, but on a replica the rows are ours to remove.
await q(`delete from public.jobs where requested_by = ${lit(`verify:forensic-${run}`)}`).catch(
  () => undefined,
)
await db.end()
