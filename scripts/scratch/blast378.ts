// Read-only: #378 blast radius with the new witness, over all history.
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { provenanceSql } from '../leak-witness.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const sql = provenanceSql(`'-infinity'::timestamptz`)
const q = async (s: string) => (await db.execute(s)).rows
console.log('by class/prefix/channel/target:')
console.table(
  await q(`select coalesce(breach,'-') as breach, split_part(key,':',1) as ns, channel, target_ref, named, count(*)::int as n,
  min(sent_at)::date::text as first, max(sent_at)::date::text as last from (${sql}) x group by 1,2,3,4,5 order by n desc limit 40`),
)
console.log('disagreements:')
console.table(
  await q(`select harness as witness, guard_says_harness as guard, split_part(key,':',1) as ns, channel, count(*)::int as n,
  min(sent_at)::text as first, max(sent_at)::text as last, max(key) as sample from (${sql}) x where harness <> guard_says_harness group by 1,2,3,4 order by n desc`),
)
