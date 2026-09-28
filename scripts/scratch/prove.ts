/**
 * Prove a migration inside a transaction that can never commit.
 *
 *   npx tsx scripts/scratch/prove.ts <migration.sql> <probe.sql>
 *
 * Runs BEGIN; migration; probe; and then raises, so the whole thing rolls
 * back. The probe must set a text value into the temp table _result; the raise
 * carries it back, because this executor returns only the FIRST statement's
 * rows (CLAUDE.md). Nothing survives: not the new function, not a fixture row.
 */
import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const [mig, probe] = process.argv.slice(2)
const sql = `begin;
create temp table _result (v text) on commit drop;
${mig === '-' ? '' : readFileSync(String(mig), 'utf8')}
${readFileSync(String(probe), 'utf8')}
do $prove$ begin raise exception 'PROVE_RESULT %', (select string_agg(v, ' | ') from _result); end $prove$;
commit;`
try {
  await db.execute(sql)
  console.log('UNEXPECTED: committed')
  process.exit(1)
} catch (e) {
  const m = /PROVE_RESULT (.*)/s.exec(String((e as Error).message))
  if (m === null) {
    console.log(`ERROR (rolled back): ${String((e as Error).message).slice(0, 1500)}`)
    process.exit(1)
  }
  console.log(m[1]?.replace(/\\n/g, '\n').slice(0, 4000))
}
