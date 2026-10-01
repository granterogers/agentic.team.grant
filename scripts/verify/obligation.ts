/**
 * An obligation is not a job — #312/#315/#316/#317's common shape.
 *
 *   npm run verify:obligation
 *
 * `jobs.state = 'complete'` says one job stopped executing. Nothing meant
 * "what Grant asked for has been done", and four separate fixes each rebuilt
 * that idea out of descendants.
 *
 * Canonical ground truth this was written against:
 *
 *     real parent/child pairs                56
 *     child finished AFTER the parent        53   (95%)
 *     branch_groups that are real traffic     0
 *     real children outside any group      1055
 *     real turns convening 2+ specialists      0
 *
 * Every case below runs inside a transaction that is rolled back, because
 * `enqueue_inbound` and the job writers create rows a DELETE can never take
 * back (#210: wrap the CALL, not the assertion).
 */

import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const run = Date.now().toString(36)

/*
  One script, rolled back, answers carried out in a plpgsql variable — the
  same shape `verify:context` uses, and for the same three reasons: the
  writers cannot be undone by a DELETE, the rollback has to come at the END so
  later shapes see earlier ones, and anything written to a TABLE before the
  rollback goes with it.
*/
const scenario = async (name: string, body: string): Promise<Record<string, string>> => {
  const sql = `
    create temp table if not exists answers (k text primary key, v text);
    delete from answers;
    do $outer$
    declare
      v_p uuid; v_root uuid; v_a uuid; v_b uuid; v_other uuid;
      v_ans jsonb := '{}'::jsonb; k text; v text;
    begin
      select project_id into v_p from public.projects
       where status = 'active' and not is_fixture
         and slug <> 'unnamed' order by updated_at desc limit 1;
      if v_p is null then
        insert into answers values ('skipped', 'no real, named, active project');
        return;
      end if;
      ${body}
      raise exception 'rolling back' using errcode = 'RS001';
    exception when sqlstate 'RS001' then
      for k, v in select * from jsonb_each_text(v_ans) loop
        insert into answers values (k, v);
      end loop;
    end
    $outer$;
    select k, v from answers`
  const { rows } = await db.execute(sql)
  const out: Record<string, string> = {}
  for (const r of rows as { k: string; v: string }[]) out[r.k] = r.v
  if (out.skipped !== undefined) console.log(`  (skipped ${name}: ${out.skipped})`)
  return out
}

/** A job, in a state, under an optional parent. */
const JOB = (into: string, key: string, state: string, parent: string | null) => `
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state${parent === null ? '' : ', parent_job_id'})
  values (extensions.gen_random_uuid(), v_p, '${key}-${run}', 'office.instruction',
          'teamhq:grant', 10, '${state}'${parent === null ? '' : `, ${parent}`})
  returning job_id into ${into};`

/** Carry a job all the way to complete through the legal states. */
const FINISH = (v: string) => `
  update public.jobs set state = 'running' where job_id = ${v};
  update public.jobs set state = 'output_created' where job_id = ${v};
  update public.jobs set state = 'quality_review' where job_id = ${v};
  update public.jobs set state = 'committing' where job_id = ${v};
  update public.jobs set state = 'committed' where job_id = ${v};
  update public.jobs set state = 'notifying' where job_id = ${v};
  update public.jobs set state = 'complete', finished_at = app.now_utc() where job_id = ${v};`

const answer = (k: string, of: string) => `
  v_ans := v_ans || jsonb_build_object('${k}', app.obligation_state(${of})::text);`

console.log(`\n#312 — an obligation is not a job  (run ${run})\n`)

// ---------------------------------------------- one child completing prematurely
{
  /*
    THE SABOTAGE TARGET: one child completing must never mark a multi-child
    obligation fulfilled. `working` is tested before any settled verdict, so
    this is a property of the ORDER rather than of a count.
  */
  const r = await scenario(
    'premature',
    `${JOB('v_root', 'obl-root', 'queued', null)}
     ${FINISH('v_root')}
     ${JOB('v_a', 'obl-a', 'queued', 'v_root')}
     ${JOB('v_b', 'obl-b', 'queued', 'v_root')}
     ${FINISH('v_a')}
     ${answer('oneOfTwo', 'v_root')}
     ${FINISH('v_b')}
     ${answer('bothDone', 'v_root')}`,
  )
  if (r.skipped === undefined) {
    ok('one of two children finishing leaves it working', r.oneOfTwo === 'working', r.oneOfTwo)
    ok('and both finishing fulfils it', r.bothDone === 'fulfilled', r.bothDone)
  }
}

// ------------------------------------------------ the parent finishes first
{
  /*
    The shape that ALWAYS happens: 53 of 56 real children finished after their
    parent. `jobs.state` says complete for the whole window and the obligation
    is plainly not.
  */
  const r = await scenario(
    'parentfirst',
    `${JOB('v_root', 'obl-pf', 'queued', null)}
     ${FINISH('v_root')}
     ${JOB('v_a', 'obl-pfa', 'queued', 'v_root')}
     ${answer('whileRunning', 'v_root')}
     v_ans := v_ans || jsonb_build_object('jobSays',
       (select state::text from public.jobs where job_id = v_root));`,
  )
  if (r.skipped === undefined) {
    ok('the job says complete', r.jobSays === 'complete', String(r.jobSays))
    ok('and the obligation says working', r.whileRunning === 'working', String(r.whileRunning))
  }
}

// ------------------------------------------- a stale result after cancellation
{
  /*
    SABOTAGE TARGET: a child completing after the obligation was called off
    must not revive it. #315 cancels the descendants; this is the case where
    one had already got past the cancellation.
  */
  const r = await scenario(
    'stale',
    `${JOB('v_root', 'obl-st', 'queued', null)}
     ${JOB('v_a', 'obl-sta', 'queued', 'v_root')}
     update public.jobs set state = 'cancelled', finished_at = app.now_utc()
      where job_id = v_root;
     ${FINISH('v_a')}
     ${answer('afterCancel', 'v_root')}`,
  )
  if (r.skipped === undefined) {
    ok(
      'a child landing after cancellation does NOT fulfil it',
      r.afterCancel === 'cancelled',
      String(r.afterCancel),
    )
  }
}

// ------------------------------------------------- a failed child is not success
{
  /*
    SABOTAGE TARGET: a failed child presented as successful. And the
    difference between "none of it worked" and "some of it did", which is a
    real distinction rather than a rounding — he asked for two things and got
    one, and calling that failed loses the one.
  */
  const r = await scenario(
    'failure',
    `${JOB('v_root', 'obl-f', 'queued', null)}
     ${FINISH('v_root')}
     ${JOB('v_a', 'obl-fa', 'queued', 'v_root')}
     update public.jobs set state = 'failed', finished_at = app.now_utc() where job_id = v_a;
     ${answer('oneFailed', 'v_root')}
     ${JOB('v_b', 'obl-fb', 'queued', 'v_root')}
     ${FINISH('v_b')}
     ${answer('mixed', 'v_root')}`,
  )
  if (r.skipped === undefined) {
    /*
      The root completed and the only child failed. Not `failed` — the root
      itself produced an answer — and not `fulfilled`, which is the defect.
    */
    ok('a failed child is not fulfilled', r.oneFailed === 'partially_complete', String(r.oneFailed))
    ok('and a mix stays partially complete', r.mixed === 'partially_complete', String(r.mixed))
  }
}

// ------------------------------------------------------- waiting on Grant
{
  /*
    #317's half. `waiting_on_user` is tested BEFORE `working` because "still
    going" and "it needs you" are different answers and only one of them is
    his to act on.
  */
  const r = await scenario(
    'blocked',
    `${JOB('v_root', 'obl-w', 'queued', null)}
     ${FINISH('v_root')}
     ${JOB('v_a', 'obl-wa', 'queued', 'v_root')}
     insert into public.blockers (project_id, job_id, requested_action, why_needed,
       consequences_of_delay, approval_options, originating_agent, work_can_continue, state)
     values (v_p, v_a, 'which one', 'cannot choose for you', 'it stays half done',
             array['this', 'that'], 'chief-of-staff', false, 'open');
     ${answer('blocked', 'v_root')}
     update public.blockers set state = 'resolved', resolved_at = app.now_utc()
      where job_id = v_a;
     ${answer('unblocked', 'v_root')}`,
  )
  if (r.skipped === undefined) {
    ok(
      'an open blocker reads as waiting on him',
      r.blocked === 'waiting_on_user',
      String(r.blocked),
    )
    ok('and answering it returns to working', r.unblocked === 'working', String(r.unblocked))
  }
}

// ------------------------------------- results must not cross obligations
{
  /*
    SABOTAGE TARGET: results crossing conversations or projects. The tree is
    walked by `parent_job_id`, so a job in another obligation can never be
    counted in this one — asserted rather than assumed, because every other
    reader in this family had to be taught the same lesson (#315's
    cross-conversation stop, #316's conversation-scoped key).
  */
  const r = await scenario(
    'crossing',
    `${JOB('v_root', 'obl-x', 'queued', null)}
     ${FINISH('v_root')}
     ${JOB('v_other', 'obl-xo', 'queued', null)}
     ${JOB('v_a', 'obl-xa', 'queued', 'v_other')}
     ${answer('mine', 'v_root')}
     v_ans := v_ans || jsonb_build_object('treeSize',
       (select count(*)::text from app.obligation_tree(v_root)));`,
  )
  if (r.skipped === undefined) {
    ok(
      'another obligation running does not make mine working',
      r.mine === 'fulfilled',
      String(r.mine),
    )
    ok('and my tree holds only my own job', r.treeSize === '1', String(r.treeSize))
  }
}

// --------------------------------------- a terminal child cannot strand it
{
  /*
    SABOTAGE TARGET: a parent waiting for ever because a terminal child cannot
    satisfy aggregation. There is no counter here to get stuck — the state is
    DERIVED — so every terminal combination settles. Asserted across all three
    terminal states rather than argued.
  */
  const r = await scenario(
    'terminal',
    `${JOB('v_root', 'obl-t', 'queued', null)}
     ${FINISH('v_root')}
     ${JOB('v_a', 'obl-ta', 'queued', 'v_root')}
     update public.jobs set state = 'cancelled', finished_at = app.now_utc() where job_id = v_a;
     ${answer('cancelledChild', 'v_root')}`,
  )
  if (r.skipped === undefined) {
    ok(
      'a cancelled child settles rather than stranding it',
      r.cancelledChild === 'partially_complete',
      String(r.cancelledChild),
    )
  }
}

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed\n`)
process.exit(fail === 0 ? 0 : 1)
