/**
 * What does one IDLE minute of the office cost the database? Run the real worker pass on an isolated replica and count.
 *
 *   npx tsx scripts/forensics/idle-pass-cost.ts <replica-db> [passes=20]
 *
 * Why it exists (Supabase degradation forensics, 4 October 2026): the host is kicked every minute, all day, whether or not
 * anyone is using the office, so the standing cost of ONE EMPTY PASS is multiplied by 1,440 a day. Production measurements
 * (docs/ops/supabase-efficiency-2026-10-04.md) say about thirty statements a minute. This measures the same thing on a
 * database nobody else is using, so two code-and-schema generations can be compared: run it from a worktree of the old commit
 * against the old schema, and from HEAD against HEAD.
 *
 * Method: duties are switched off in the replica so that nothing is due (the pass is then the pure standing path: setup,
 * callbacks, orphans, duty dispatch, recovery, expiry, claim); the network is refused (a fetch throws and is counted);
 * `pg_stat_statements` is reset for this database; N passes run one after another; the statistics are read back. It reports
 * statements and buffer traffic per pass. It is a count of WORK, not a prediction of how a small host behaves, and it spends no
 * model call. It runs only against a marked local replica (guard.ts).
 */
import { buildPass } from '../../src/office/pass.ts'
import { isolated } from '../isolated/guard.ts'

const database = process.argv[2] ?? 'post'
const N = Number(process.argv[3] ?? 20)
const db = await isolated(database)
const q = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

let refused = 0
globalThis.fetch = (async () => {
  refused += 1
  throw new Error('REFUSED: the idle-pass measurement never leaves the replica')
}) as typeof fetch

await q(`update public.responsibilities set enabled = false`)
const queued = Number(
  (
    await q(
      `select count(*)::int n from public.jobs where state in ('queued','retrying','running')`,
    )
  )[0]?.n,
)
await q(
  `select pg_stat_statements_reset(0, (select oid from pg_database where datname = current_database()), 0)`,
)

/*
  The memory ONE backend holds after it has done the worker's standing work. Production keeps 5 to 17 backends open on a host
  with 434 MiB of RAM, each caching the catalog and the plans of every function it has run, so a schema that grew (more tables,
  triggers, policies and functions) makes every backend heavier. pg_backend_memory_contexts describes the CURRENT backend, and
  this process uses one connection throughout, so the numbers below are the pass's own backend.
*/
const memory = async (): Promise<{
  total_kib: number
  used_kib: number
  cache_kib: number
  top: string
}> => {
  const t = (
    await q(`select (sum(total_bytes)/1024)::bigint total, (sum(used_bytes)/1024)::bigint used,
                    (sum(total_bytes) filter (where name in ('CacheMemoryContext','CachedPlan','CachedPlanQuery','RelCache','TopMemoryContext') or parent = 'CacheMemoryContext')/1024)::bigint cache
               from pg_backend_memory_contexts`)
  )[0] as Record<string, unknown>
  const top = (
    await q(
      `select name, (total_bytes/1024)::bigint kib from pg_backend_memory_contexts order by total_bytes desc limit 4`,
    )
  )
    .map((r) => `${String(r.name)}=${String(r.kib)}KiB`)
    .join(', ')
  return {
    total_kib: Number(t.total),
    used_kib: Number(t.used),
    cache_kib: Number(t.cache),
    top,
  }
}
const memoryBefore = await memory()

const pass = await buildPass(db, `forensic-${database}`, { log: () => undefined, max: 1 })
const t0 = Date.now()
let handled = 0
for (let i = 0; i < N; i += 1) {
  const r = await pass()
  handled += r.handled
}
const ms = Date.now() - t0
const memoryAfter = await memory()

const rows = await q(`
  select calls::bigint calls, rows::bigint rows, shared_blks_hit::bigint hit, shared_blks_read::bigint read,
         wal_bytes::bigint wal, total_exec_time::float8 ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 110) q
    from pg_stat_statements
   where dbid = (select oid from pg_database where datname = current_database())
     and query not ilike '%pg_stat_statements%'
   order by calls desc`)
const sum = (k: string): number => rows.reduce((a, r) => a + Number(r[k]), 0)
const per = (x: number): number => Math.round((x / N) * 10) / 10
console.log(
  JSON.stringify(
    {
      database,
      passes: N,
      queued_work_at_start: queued,
      jobs_handled: handled,
      network_attempts_refused: refused,
      ms_per_pass: per(ms),
      statements_per_pass: per(sum('calls')),
      distinct_statements: rows.length,
      shared_blocks_hit_per_pass: per(sum('hit')),
      shared_blocks_read_per_pass: per(sum('read')),
      wal_bytes_per_pass: per(sum('wal')),
      db_exec_ms_per_pass: per(sum('ms')),
      backend_memory_before: memoryBefore,
      backend_memory_after_passes: memoryAfter,
      top_by_calls: rows.slice(0, 12).map((r) => ({
        per_pass: Math.round((Number(r.calls) / N) * 10) / 10,
        blks_hit_per_call: Math.round(Number(r.hit) / Math.max(1, Number(r.calls))),
        q: r.q,
      })),
    },
    null,
    1,
  ),
)
await db.end()
