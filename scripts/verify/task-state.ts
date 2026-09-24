/**
 * Finishing or calling off a task from the conversation (ledger R3, R5; 0593).
 *
 *   npm run verify:task-state
 *   npm run verify:task-state -- --with migrations/0593_a_referent_names_its_candidates.sql
 *
 * One transaction that raises at the end, so nothing commits. It builds a
 * harness conversation of its own (a command, a job, two tasks the job made),
 * then asks the referent what that conversation can point at and presses the
 * writer the handler presses.
 *
 * Properties, each with its control:
 *   - a HARNESS turn sees the tasks its own conversation made (R5)
 *   - CONTROL: a REAL turn never sees a harness task
 *   - project tasks are candidates only when asked for (p_any_task)
 *   - candidates carry ids, so a name can pick exactly one
 *   - app.hq_task_state moves the picked task and ONLY that task
 */
import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const i = process.argv.indexOf('--with')
const migration = i === -1 ? '' : readFileSync(String(process.argv[i + 1]), 'utf8')
const run = Math.random().toString(36).slice(2, 10)

const sql = `begin;
${migration}
do $v$
declare
  proj uuid; c1 uuid; c2 uuid; j uuid; t_personal jsonb; t_project jsonb;
  harness_personal jsonb; harness_any jsonb; real_any jsonb; real_cmd uuid; moved jsonb;
begin
  select project_id into proj from public.projects where is_fixture and status <> 'archived' limit 1;
  insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, project_id)
    values ('teamhq', 'verify-taskstate-${run}:1', 'verify-taskstate-${run}', 'add two tasks', 'teamhq:verify:taskstate-${run}-1', app.now_utc(), proj)
    returning command_id into c1;
  j := (app.enqueue_inbound(c1) ->> 'job_id')::uuid;
  update public.jobs set announce = false where job_id = j;
  t_personal := app.my_task_add(p_title => 'Book the minibus ${run}', p_job => j);
  t_project := app.task_add(p_project => proj, p_title => 'Chase the caterers ${run}', p_job => j);
  insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, project_id)
    values ('teamhq', 'verify-taskstate-${run}:2', 'verify-taskstate-${run}', 'bin the minibus one', 'teamhq:verify:taskstate-${run}-2', app.now_utc(), proj)
    returning command_id into c2;
  perform app.enqueue_inbound(c2);
  update public.jobs set announce = false where job_id = (select job_id from public.inbound_commands where command_id = c2);
  harness_personal := app.my_task_referent(c2);
  harness_any := app.my_task_referent(c2, p_any_task => true);
  /*
    A REAL conversation holding a harness-marked task, so the control can
    fail. A command inserted here is synthetic by construction (0575 denies
    by default), so the real conversation is Grant's own most recent one, and
    the harness task is a loose one (no job) created inside it - which the
    referent would offer as "he made it himself since the conversation
    began" if the harness filter let it through. Never committed.
  */
  select c.command_id into real_cmd from public.inbound_commands c
   where c.job_id is not null and not app.harness_job(c.job_id) order by c.received_at desc limit 1;
  perform app.task_add(p_project => proj, p_title => 'Harness in a real chat ${run}', p_added_by => 'verify:control');
  real_any := app.my_task_referent(real_cmd, '48:00'::interval, true);
  moved := app.hq_task_state(t_personal ->> 'id', 'cancelled');
  raise exception 'RESULT %', jsonb_build_object(
    'harness_job', app.harness_job(j),
    'harness_personal', harness_personal,
    'harness_any', harness_any,
    'real_is_real', not app.harness_job((select job_id from public.inbound_commands where command_id = real_cmd)),
    'real_any', real_any,
    'real_sees_harness', coalesce((select bool_or(app.harness_task(t.is_fixture, t.job_id))
        from jsonb_array_elements(coalesce(real_any->'candidates', '[]'::jsonb)) x
        join public.tasks t on t.task_id = (x->>'id')::uuid), false),
    'moved_state', moved ->> 'state',
    'personal_state', (select state from public.tasks where task_id = (t_personal->>'id')::uuid),
    'project_state', (select state from public.tasks where task_id = (t_project->>'id')::uuid),
    'personal_id', t_personal->>'id', 'project_id', t_project->>'id');
end $v$;
commit;`

let r: Record<string, unknown> = {}
try {
  await db.execute(sql)
  console.error('the probe committed, which it must never do')
  process.exit(2)
} catch (error) {
  const m = /RESULT (\{.*\})/s.exec(String((error as Error).message))
  if (m === null) {
    console.error(String((error as Error).message).slice(0, 900))
    process.exit(2)
  }
  r = JSON.parse(String(m[1])) as Record<string, unknown>
}
const any = (r.harness_any ?? {}) as { candidates?: { id: string }[] }
const personal = (r.harness_personal ?? {}) as { id?: string; candidates?: { id: string }[] }
const ids = (any.candidates ?? []).map((c) => c.id)
const checks: [string, boolean, string][] = [
  ['the probe conversation is harness traffic', r.harness_job === true, String(r.harness_job)],
  [
    'a harness turn sees the personal task its conversation made',
    personal.id === r.personal_id,
    JSON.stringify(personal).slice(0, 120),
  ],
  [
    'candidates carry ids',
    (personal.candidates ?? []).length === 1,
    String((personal.candidates ?? []).length),
  ],
  [
    'with p_any_task the project task is a candidate too',
    ids.includes(String(r.project_id)) && ids.includes(String(r.personal_id)),
    ids.join(','),
  ],
  ['the control conversation is real traffic', r.real_is_real === true, String(r.real_is_real)],
  [
    'CONTROL: a real conversation sees no harness task',
    r.real_sees_harness === false && r.real_any === null,
    JSON.stringify(r.real_any),
  ],
  [
    'the writer moved the picked task',
    r.moved_state === 'cancelled' && r.personal_state === 'cancelled',
    String(r.personal_state),
  ],
  ['CONTROL: and only that task', r.project_state === 'todo', String(r.project_state)],
]
let failed = 0
for (const [what, ok, got] of checks) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` — ${got}`}`)
  if (!ok) failed += 1
}
console.log(
  `\ntask-state: ${String(checks.length - failed)}/${String(checks.length)} (rolled back; nothing committed)`,
)
process.exit(failed === 0 ? 0 : 1)
