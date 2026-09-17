/**
 * The tasks inside a document become real tasks, and can be taken back (#130).
 *
 *   npm run verify:extract
 *
 * `readTasks` is unit-tested — it is pure text and that is where thirty cases
 * cost milliseconds. This is the half unit tests cannot reach: whether the
 * database accepts the shape, whether the tasks really land, and whether the
 * undo actually undoes.
 *
 * ## The reversal is the reason this exists
 *
 * `app.undo_offer` records a promise and `app.hq_undo` performs it from a
 * CLOSED case that raises on a verb it does not know. 0398 taught it
 * `tasks_from_job`, and a migration that applies cleanly is not a function
 * that works — #147 shipped four defects that way in one afternoon, every one
 * of them invisible from reading and every one found by driving the press.
 *
 * ## Inside a rollback, wrapping the CALL
 *
 * `app.task_add` writes into the list Grant looks at and the reversal DELETES.
 * `verify:disconnect` is the cautionary tale: it wrapped the assertions and
 * not the call, and the day a refusal became a real disconnect every run
 * deleted Slack's credentials. Each arc below is one statement — begin, the
 * work, one select, rollback.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, string>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, string>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
console.log(`\nverify:extract — ${run}\n`)

/* ------------------------------------------------------------------ *
 * The shape the office had declared and never produced.
 * ------------------------------------------------------------------ */
console.log('the contract accepts what the handler writes')

const shaped = await one(`
  begin;
  create temp table _r (k text primary key, v text);
  do $$
  declare v_project uuid; v_job uuid; v_err text;
  begin
    select project_id into v_project
      from public.projects where status = 'active' and not is_fixture limit 1;
    insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
    values (extensions.gen_random_uuid(), v_project, ${lit(`x-${run}`)},
            'office.extract_tasks', ${lit(`teamhq:verify-extract-${run}`)})
    returning job_id into v_job;
    insert into _r values ('job', v_job::text);

    /*
      The real thing the handler writes. If the trigger refuses this, the
      handler fails every time it succeeds - which is the shape of defect a
      declared-but-unproduced contract hides.
    */
    begin
      insert into public.outputs (job_id, body, confidence, evidence, deterministic, shape, facts)
      values (v_job, 'I read the brief and pulled out 2 things that need doing.',
              'high', 'verified', true, 'tasks_extracted',
              jsonb_build_object(
                'from', 'The brief',
                'tasks', jsonb_build_array(
                  jsonb_build_object('title', 'Draft the outreach note', 'detail', null, 'due_on', null),
                  jsonb_build_object('title', 'Pick three price points', 'detail', 'page 2', 'due_on', '2026-10-01'))));
      insert into _r values ('accepted', 'true'), ('why', '');
    exception when others then
      insert into _r values ('accepted', 'false'), ('why', sqlerrm);
    end;

    /*
      CONTROL. The same shape with the required key missing must be REFUSED.
      Without this, "accepted" above would read the same whether the trigger
      was enforcing anything or had been dropped.
    */
    begin
      insert into public.outputs (job_id, body, confidence, evidence, deterministic, shape, facts)
      values (v_job, 'x', 'high', 'verified', true, 'tasks_extracted',
              jsonb_build_object('from', 'The brief'));
      insert into _r values ('bad_accepted', 'true'), ('bad_why', '');
    exception when others then
      insert into _r values ('bad_accepted', 'false'), ('bad_why', sqlerrm);
    end;
  end $$;
  select (select v from _r where k = 'accepted')     as accepted,
         (select v from _r where k = 'why')          as why,
         (select v from _r where k = 'bad_accepted') as bad_accepted,
         (select v from _r where k = 'bad_why')      as bad_why;
  rollback;
`)
check(
  'a tasks_extracted output is accepted',
  shaped.accepted === 'true' ? 'accepted' : `refused: ${shaped.why}`,
  shaped.accepted === 'true',
)
check(
  'CONTROL: the same output missing its tasks is refused',
  String(shaped.bad_why ?? '').slice(0, 74),
  shaped.bad_accepted === 'false' && String(shaped.bad_why ?? '').includes('tasks'),
)

/* ------------------------------------------------------------------ *
 * The tasks land, and the undo takes back only what the office did.
 * ------------------------------------------------------------------ */
console.log('\nthe tasks are real, and can be taken back')

const arc = await one(`
  begin;
  create temp table _r (k text primary key, v text);
  do $$
  declare v_project uuid; v_job uuid; v_one uuid; v_undo jsonb;
  begin
    select project_id into v_project
      from public.projects where status = 'active' and not is_fixture limit 1;
    insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
    values (extensions.gen_random_uuid(), v_project, ${lit(`y-${run}`)},
            'office.extract_tasks', ${lit(`teamhq:verify-extract-${run}`)})
    returning job_id into v_job;

    -- Three tasks, the way the handler writes them: named arguments, and the
    -- JOB carried so the reversal has something exact to key on.
    perform app.task_add(p_project => v_project, p_title => ${lit(`Draft the note ${run}`)},
                         p_job => v_job);
    perform app.task_add(p_project => v_project, p_title => ${lit(`Pick the price points ${run}`)},
                         p_job => v_job);
    perform app.task_add(p_project => v_project, p_title => ${lit(`Book the venue ${run}`)},
                         p_job => v_job);
    insert into _r values ('made',
      (select count(*)::text from public.tasks where job_id = v_job));

    /*
      And Grant starts one of them. This is the case the reversal must NOT
      take back - it is his work, and deleting it is the destructive action he
      has said to always check about first.
    */
    select task_id into v_one from public.tasks
     where job_id = v_job and title = ${lit(`Book the venue ${run}`)};
    update public.tasks set state = 'doing' where task_id = v_one;

    v_undo := app.undo_tasks_from_job(v_job);
    insert into _r values ('undo', v_undo::text);
    insert into _r values ('left',
      (select count(*)::text from public.tasks where job_id = v_job));
    insert into _r values ('his_survived',
      (select count(*)::text from public.tasks where task_id = v_one));

    -- And undoing again takes nothing, rather than reporting a second success.
    insert into _r values ('again', app.undo_tasks_from_job(v_job)::text);
  end $$;
  select (select v from _r where k = 'made')         as made,
         (select v from _r where k = 'undo')         as undo,
         (select v from _r where k = 'left')         as left_over,
         (select v from _r where k = 'his_survived') as his_survived,
         (select v from _r where k = 'again')        as again;
  rollback;
`)
check('three tasks are really created', `${arc.made} row(s)`, arc.made === '3')
check(
  'the undo takes back the two the office made and nobody touched',
  String(arc.undo ?? ''),
  String(arc.undo ?? '').includes('"removed": 2'),
)
check(
  'the one Grant had started is left alone',
  `${arc.his_survived} survived, ${arc.left_over} left on the job`,
  arc.his_survived === '1' && arc.left_over === '1',
)
check(
  'and it says so rather than implying it took everything',
  String(arc.undo ?? '').slice(0, 110),
  String(arc.undo ?? '').includes('"kept": 1'),
)
check(
  'undoing twice takes nothing the second time',
  String(arc.again ?? ''),
  String(arc.again ?? '').includes('"removed": 0'),
)

/* ------------------------------------------------------------------ *
 * The offer names a reversal hq_undo can actually perform.
 * ------------------------------------------------------------------ */
console.log('\nthe offer is not a claim with nothing behind it')

/*
  `app.hq_undo` performs from a closed case and RAISES on a verb it does not
  know. An offer naming one it cannot perform is a control that claims
  something nothing does - 0298's defect. Driven, not read.
*/
const offered = await one(`
  begin;
  create temp table _r (k text primary key, v text);
  do $$
  declare v_project uuid; v_job uuid; v_id uuid; v_out jsonb;
  begin
    select project_id into v_project
      from public.projects where status = 'active' and not is_fixture limit 1;
    insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
    values (extensions.gen_random_uuid(), v_project, ${lit(`z-${run}`)},
            'office.extract_tasks', ${lit(`teamhq:verify-extract-${run}`)})
    returning job_id into v_job;
    perform app.task_add(p_project => v_project, p_title => ${lit(`Only task ${run}`)},
                         p_job => v_job);

    v_id := app.undo_offer('tasks_extracted', 'the 1 task pulled out of The brief',
      jsonb_build_object('action', 'tasks_from_job',
                         'args', jsonb_build_object('p_job', v_job::text)), 120);
    insert into _r values ('offer', coalesce(v_id::text, ''));

    begin
      v_out := app.hq_undo(v_id::text);
      insert into _r values ('undone', v_out::text), ('raised', '');
    exception when others then
      insert into _r values ('undone', ''), ('raised', sqlstate || ' ' || sqlerrm);
    end;
    insert into _r values ('left',
      (select count(*)::text from public.tasks where job_id = v_job));
  end $$;
  select (select v from _r where k = 'offer')  as offer,
         (select v from _r where k = 'undone') as undone,
         (select v from _r where k = 'raised') as raised,
         (select v from _r where k = 'left')   as left_over;
  rollback;
`)
check(
  'an undo is offered',
  `id ${String(offered.offer ?? '').slice(0, 8)}`,
  (offered.offer ?? '') !== '',
)
check(
  'and pressing it performs the reversal rather than raising',
  `${String(offered.undone ?? '').slice(0, 90)}${offered.raised === '' ? '' : ` RAISED ${offered.raised}`}`,
  offered.raised === '' && String(offered.undone ?? '').includes('"ok": true'),
)
check('the task really went', `${offered.left_over} left on the job`, offered.left_over === '0')

/* ------------------------------------------------------------------ *
 * Nothing this suite did survives it.
 * ------------------------------------------------------------------ */
console.log('\nteardown')

const left = await one(`
  select (select count(*)::text from public.tasks where title like ${lit(`%${run}%`)}) as t,
         (select count(*)::text from public.jobs
           where idempotency_key in (${lit(`x-${run}`)}, ${lit(`y-${run}`)}, ${lit(`z-${run}`)})) as j`)
check(
  'no probe task or job is left behind',
  `${left.t} task(s), ${left.j} job(s)`,
  left.t === '0' && left.j === '0',
)

const bad = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - bad)}/${String(checks.length)} checks passed\n`)
process.exit(bad === 0 ? 0 : 1)
