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
  j1 uuid; j2 uuid; j3 uuid; c3 uuid; p uuid; a jsonb; b jsonb; c jsonb; d jsonb; e jsonb; f jsonb;
begin
  -- Two harness jobs, so nothing here can reach Grant's list or health.
  /*
    The control job must be in a DIFFERENT conversation: my_task_add also
    merges the same title asked twice in one conversation within ten minutes
    (ledger R18), which is a different property with its own check below.
  */
  select c.job_id into j1 from public.inbound_commands c
   where c.job_id is not null and app.harness_job(c.job_id) order by c.received_at desc limit 1;
  select c.job_id into j2 from public.inbound_commands c
   where c.job_id is not null and app.harness_job(c.job_id)
     and split_part(c.origin_ref, ':', 1) <> (select split_part(origin_ref, ':', 1) from public.inbound_commands where job_id = j1)
   order by c.received_at desc limit 1;
  /* A second turn of j1's conversation, so the R18 property has a subject. */
  insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, project_id, subject)
    select origin_channel, split_part(origin_ref, ':', 1) || ':again', actor, instruction,
           origin_channel || ':verify:retrywrites-' || md5(random()::text), app.now_utc(), project_id, subject
      from public.inbound_commands where job_id = j1
    returning command_id into c3;
  j3 := (app.enqueue_inbound(c3) ->> 'job_id')::uuid;
  select project_id into p from public.projects where is_fixture and status <> 'archived' limit 1;
  a := app.my_task_add(p_office => app.test_office(), p_title => 'verify retry-writes subject', p_job => j1);
  b := app.my_task_add(p_office => app.test_office(), p_title => 'Verify Retry-Writes subject ', p_job => j1);
  c := app.my_task_add(p_office => app.test_office(), p_title => 'verify retry-writes subject', p_job => j2);
  f := app.my_task_add(p_office => app.test_office(), p_title => 'verify retry-writes subject', p_job => j3);
  d := app.task_add(p_office => app.test_office(), p_project => p, p_title => 'verify retry-writes project', p_job => j1);
  e := app.task_add(p_office => app.test_office(), p_project => p, p_title => 'verify retry-writes project', p_job => j1);
  raise exception 'RESULT %', jsonb_build_object(
    'personal_same_job', (a->>'id') = (b->>'id'),
    'personal_other_job_distinct', (a->>'id') <> (c->>'id'),
    'same_conversation_repeat', (f->>'id') = (a->>'id') and (f->>'repeated') = 'true',
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
    'CONTROL: a job in another conversation asking the same thing gets its own task',
    result.personal_other_job_distinct === true,
  ],
  [
    'the same message sent twice in one conversation is one task, and says so (R18)',
    result.same_conversation_repeat === true,
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
