// Read-only: #381 — the RC2 witness over all of production's sent history.
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { provenanceSql } from '../leak-witness.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const sql = provenanceSql(`'2026-09-01'::timestamptz`, { declarations: false })
const rows = (
  await db.execute(`with w as (${sql}) select breach, channel, target_ref, count(*)::int as sends,
    min(sent_at)::date::text as first, max(sent_at)::date::text as last
  from w where breach is not null group by 1, 2, 3 order by 1, 4 desc`)
).rows
console.table(rows)
const u = (
  await db.execute(`with w as (${sql}) select key, channel, target_ref, sent_at from w
  where breach = 'UNREGISTERED_ORIGIN_SENT' order by sent_at limit 40`)
).rows
console.table(u)
