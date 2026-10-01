/**
 * Apply ONE ownership migration to production the way P2 requires, and record it in the ledger exactly as
 * `npm run migrate` would (same name, same SHA-256).
 *
 *   npx tsx scripts/p2/apply-wave.ts 0657_wave_1_projects_duties_and_jobs_have_an_owner.sql
 *
 * Why not `npm run migrate`: the waves are applied ONE AT A TIME with a verification between each, and each is applied
 * with `lock_timeout` so a wave that cannot get its locks in ten seconds gives up instead of queueing behind the worker
 * and stalling every writer behind it, then retries when a deadlock (40P01) or a lock timeout (55P03) says it lost the
 * race. A wave is one request and one transaction: a failure leaves nothing behind.
 *
 * It refuses to run if a job is running (the worker would hold row locks on the tables the wave rewrites) unless
 * `--even-if-busy` is given, prints what the queue looked like before it started, and does NOT touch the worker.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const name = process.argv[2] ?? ''
if (!name.endsWith('.sql')) {
  console.error('usage: tsx scripts/p2/apply-wave.ts <migration.sql> [--even-if-busy]')
  process.exit(2)
}
const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const sql = await readFile(join('migrations', name), 'utf8')
const checksum = createHash('sha256').update(sql, 'utf8').digest('hex')
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

const done = (
  await db.execute(`select checksum from app.schema_migrations where name = ${lit(name)}`)
).rows[0] as { checksum?: string } | undefined
if (done !== undefined) {
  console.log(
    done.checksum === checksum
      ? `${name} is already applied, unchanged.`
      : `${name} is applied with a DIFFERENT checksum - stop.`,
  )
  process.exit(done.checksum === checksum ? 0 : 1)
}

const q = (
  await db.execute(`
  select (select count(*) from public.jobs where state in ('running'))::int as running,
         (select count(*) from public.jobs where state in ('queued', 'retrying'))::int as waiting,
         (select count(*) from pg_stat_activity where state <> 'idle' and pid <> pg_backend_pid()
             and xact_start < now() - interval '20 seconds')::int as long_txns`)
).rows[0] as {
  running: number
  waiting: number
  long_txns: number
}
console.log(
  `before: ${String(q.running)} job(s) running, ${String(q.waiting)} waiting, ${String(q.long_txns)} transaction(s) older than 20s`,
)
if (q.running > 0 && !process.argv.includes('--even-if-busy')) {
  console.error('a job is running; wait for it, or pass --even-if-busy')
  process.exit(3)
}

const started = Date.now()
let lastError = ''
for (let attempt = 1; attempt <= 8; attempt += 1) {
  try {
    await db.execute(`set local lock_timeout = '10s';\n${sql}`)
    const took = Date.now() - started
    await db.execute(
      `insert into app.schema_migrations (name, checksum, duration_ms) values (${lit(name)}, ${lit(checksum)}, ${String(took)})
       on conflict (name) do update set checksum = excluded.checksum, duration_ms = excluded.duration_ms`,
    )
    console.log(`applied ${name} in ${String(took)} ms (attempt ${String(attempt)}) and recorded`)
    process.exit(0)
  } catch (e) {
    lastError = String((e as Error).message)
    const retry = /40P01|55P03|deadlock detected|lock timeout/.test(lastError)
    console.log(
      `attempt ${String(attempt)} did not apply${retry ? ' (lost a lock race; the transaction rolled back whole)' : ''}: ${lastError.slice(0, 220)}`,
    )
    if (!retry) break
    await new Promise((r) => setTimeout(r, 5000 * attempt))
  }
}
console.error(`${name} NOT applied: ${lastError.slice(0, 400)}`)
process.exit(1)
