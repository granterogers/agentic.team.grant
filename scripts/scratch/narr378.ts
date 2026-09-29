// Read-only: #378 narration/outcome recount under the canonical classifier.
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const rows = (
  await db.execute(`with n as (
    select split_part(d.dedupe_key, ':', 1) as ns, d.target_ref, d.state::text as state,
           coalesce(d.sent_at, d.created_at) as at,
           (substring(d.dedupe_key from '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'))::uuid as job
      from public.deliveries d
     where split_part(d.dedupe_key, ':', 1) in ('narration', 'outcome'))
  select ns, target_ref, n.state, (j.job_id is null) as job_missing,
         coalesce(app.harness_job(n.job), false) as harness, count(*)::int as n,
         min(at)::date::text as first, max(at)::date::text as last
    from n left join public.jobs j on j.job_id = n.job
   group by 1, 2, 3, 4, 5 order by 1, 2, 3, 5`)
).rows
console.table(rows)
