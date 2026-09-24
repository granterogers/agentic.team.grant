/**
 * A retried job does not write its task again (ledger R2, migration 0592).
 *
 *   npm run verify:retry-writes                      # against the live schema
 *   npm run verify:retry-writes -- --with migrations/0592_a_retry_does_not_write_the_task_again.sql
 *
 * Everything runs inside one transaction that raises at the end, so nothing
 * commits: not a task, not a function definition. `--with` applies a migration
 * inside that same transaction first, which is how the fix is proved before it
 * is deployed.
 *
 * Three properties, each with its control:
 *   - the same job asking twice for the same title gets ONE task (both writers)
 *   - title case and trailing space do not defeat it
 *   - a DIFFERENT job asking for the same title still gets its own task, so
 *     the idempotency cannot swallow a genuine second request
 */
import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const i = process.argv.indexOf('--with')
const migration = i === -1 ? '' : readFileSync(String(process.argv[i + 1]), 'utf8')

const sql = `begin;
${migration}
do $v$
declare
  j1 uuid; j2 uuid; p uuid; a jsonb; b jsonb; c jsonb; d jsonb; e jsonb;
begin
  -- Two harness jobs, so nothing here can reach Grant's list or health.
  select job_id into j1 from public.jobs where app.harness_job(job_id) order by created_at desc limit 1;
  select job_id into j2 from public.jobs where app.harness_job(job_id) and job_id <> j1 order by created_at desc limit 1;
  select project_id into p from public.projects where is_fixture and status <> 'archived' limit 1;
  a := app.my_task_add(p_title => 'verify retry-writes subject', p_job => j1);
  b := app.my_task_add(p_title => 'Verify Retry-Writes subject ', p_job => j1);
  c := app.my_task_add(p_title => 'verify retry-writes subject', p_job => j2);
  d := app.task_add(p_project => p, p_title => 'verify retry-writes project', p_job => j1);
  e := app.task_add(p_project => p, p_title => 'verify retry-writes project', p_job => j1);
  raise exception 'RESULT %', jsonb_build_object(
    'personal_same_job', (a->>'id') = (b->>'id'),
    'personal_other_job_distinct', (a->>'id') <> (c->>'id'),
    'personal_rows_for_job', (select count(*) from public.tasks where job_id = j1 and lower(title) = 'verify retry-writes subject'),
    'project_same_job', (d->>'id') = (e->>'id'),
    'project_rows_for_job', (select count(*) from public.tasks where job_id = j1 and title = 'verify retry-writes project'));
end $v$;
commit;`

let result: Record<string, unknown> = {}
try {
  await db.execute(sql)
  console.error('the probe committed, which it must never do')
  process.exit(2)
} catch (error) {
  const m = /RESULT (\{.*\})/s.exec(String((error as Error).message))
  if (m === null) {
    console.error(String((error as Error).message).slice(0, 800))
    process.exit(2)
  }
  result = JSON.parse(String(m[1])) as Record<string, unknown>
}

const checks: [string, boolean][] = [
  ['my_task_add: the same job asking twice gets one task', result.personal_same_job === true],
  ['my_task_add: one row for the job, not two', Number(result.personal_rows_for_job) === 1],
  [
    'CONTROL: a different job asking the same thing gets its own task',
    result.personal_other_job_distinct === true,
  ],
  ['task_add: the same job asking twice gets one task', result.project_same_job === true],
  ['task_add: one row for the job, not two', Number(result.project_rows_for_job) === 1],
]
let failed = 0
for (const [what, ok] of checks) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed += 1
}
console.log(
  `\nretry-writes: ${String(checks.length - failed)}/${String(checks.length)} (rolled back; nothing committed)`,
)
process.exit(failed === 0 ? 0 : 1)
