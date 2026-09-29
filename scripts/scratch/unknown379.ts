// Read-only: the sends the new witness calls UNKNOWN_SENT since the guard existed.
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { provenanceSql } from '../leak-witness.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
console.table(
  (
    await db.execute(`select x.sent_at, x.channel, x.target_ref, x.key, j.kind, j.requested_by, j.idempotency_key
      from (${provenanceSql('app.harness_guard_since()')}) x join public.jobs j on j.job_id = x.job_id::uuid
     where x.breach = 'UNKNOWN_SENT' order by x.sent_at`)
  ).rows,
)
