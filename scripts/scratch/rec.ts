import { ManagementApiExecutor } from '../../src/db/executor.ts'
const db = new ManagementApiExecutor(process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg', process.env.SUPABASE_ACCESS_TOKEN ?? '')
for (const sql of ['select app.recover_stalled_jobs()', 'select app.requeue_retrying()', "select app.resume_paused(array['office.instruction']::text[])"]) {
  try { await db.execute(`begin; ${sql}; rollback;`); console.log('OK  ', sql) }
  catch (e) { console.log('FAIL', sql, '::', String((e as Error).message).slice(0, 300)) }
}
