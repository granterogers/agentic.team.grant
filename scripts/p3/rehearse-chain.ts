/**
 * Rehearse a chain of migrations against a real database and leave nothing behind (multi-user P3).
 *
 *   npx tsx scripts/p3/rehearse-chain.ts --from 0683            # production, read-write for the length of one transaction
 *   P3_DB=p3_attack_pre npx tsx scripts/p3/rehearse-chain.ts --from 0683
 *
 * Every migration from `--from` up that is not already recorded is run, in order, in ONE transaction, and the transaction ends
 * in a deliberate exception that carries a report. A migration that cannot apply, a splice anchor that no longer matches the
 * live definition, an object that is already there, a constraint the real data violates: each shows up here, with the file
 * named, and nothing it did survives.
 *
 * It takes ACCESS EXCLUSIVE locks for as long as the transaction lives (P2 deadlocked a live suite and the worker with it), so
 * pause the worker first: `npx tsx scripts/p3/worker-heartbeat.ts pause`. `lock_timeout` is set so that a lost lock race fails
 * the rehearsal instead of queueing behind a writer.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { PgExecutor } from '../../src/db/pg-executor.ts'

const fromAt = process.argv.indexOf('--from')
const from = fromAt > -1 ? (process.argv[fromAt + 1] ?? '') : ''
if (!/^\d{4}$/.test(from)) throw new Error('usage: rehearse-chain.ts --from NNNN')

const local = process.env.P3_DB
let db: SqlExecutor
if (local !== undefined) {
  const pg = new PgExecutor(`postgresql://postgres@/${local}?host=/tmp/pgs&port=55432`)
  await pg.connect()
  db = pg
} else
  db = new ManagementApiExecutor(
    process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
    process.env.SUPABASE_ACCESS_TOKEN ?? '',
  )

const recorded = new Set<string>()
try {
  for (const r of (await db.execute(`select name from app.schema_migrations`)).rows as {
    name: string
  }[])
    recorded.add(r.name)
} catch {
  // a clone built by psql has no ledger: every file from --from up is the chain
}
const files = readdirSync('migrations')
  .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) >= from && !recorded.has(f))
  .sort()
if (files.length === 0)
  throw new Error('nothing to rehearse: every file from --from is already recorded')

const chain = files
  .map((f) => `-- ===== ${f}\n${readFileSync(join('migrations', f), 'utf8')}\n`)
  .join('\n')
const report = `
do $report$
declare
  v_office_fns integer;
  v_open_app integer;
  v_legacy integer;
begin
  select count(*) into v_office_fns from pg_proc p
   where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
     and pg_get_function_identity_arguments(p.oid) like 'p_office uuid%';
  select count(*) into v_open_app from pg_proc p
   where p.pronamespace = 'app'::regnamespace and p.prokind = 'f'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  select count(*) into v_legacy from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and p.prokind = 'f'
     and pg_get_function_identity_arguments(p.oid) not like 'p_office uuid%'
     and exists (select 1 from pg_proc q where q.pronamespace = p.pronamespace and q.proname = p.proname
                    and q.oid <> p.oid and pg_get_function_identity_arguments(q.oid) like 'p_office uuid%');
  raise exception 'REHEARSAL-OK files=${String(files.length)} office_functions=% app_functions_open_to_browser_roles=% office_less_overloads_beside_office_first=%',
    v_office_fns, v_open_app, v_legacy;
end
$report$;
`
console.log(
  `rehearsing ${String(files.length)} migration(s): ${files[0]} .. ${files[files.length - 1]}`,
)
const started = Date.now()
try {
  await db.execute(`set local lock_timeout = '10s';\n${chain}\n${report}`)
  console.log('UNEXPECTED: the transaction committed (the report should have raised)')
  process.exitCode = 1
} catch (e) {
  const m = String((e as Error).message)
  const ok = m.includes('REHEARSAL-OK')
  console.log(ok ? m.slice(m.indexOf('REHEARSAL-OK')).split('\n')[0] : m.slice(0, 1200))
  console.log(
    `-- ${ok ? 'the chain applies cleanly and was rolled back' : 'the chain DID NOT apply'} (${String(Date.now() - started)} ms)`,
  )
  if (!ok) process.exitCode = 1
}
if (db instanceof PgExecutor) await db.end()
