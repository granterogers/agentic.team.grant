/**
 * Does a job actually carry on where it stopped, and does it refuse to when it
 * cannot be sure?
 *
 *   npm run verify:checkpoints
 *
 * Issue #263. Its verification list, in order, plus the CONTROL it asks for by
 * name: remove the checkpoint persistence and the recovery must fail.
 *
 * ## What is driven and what is not
 *
 * Everything here runs at the database, inside `begin … rollback`, against
 * FIXTURE jobs. That is deliberate rather than convenient: the property under
 * test is "a second attempt sees what the first one recorded", and the cheapest
 * honest way to produce a second attempt is to call `step_begin` twice — a
 * killed worker and a redeployed one arrive at exactly the same place.
 *
 * What it does NOT prove is that a real handler's steps are declared with the
 * right effect kinds. Nothing can prove that but reading them, and
 * `artifact.report` is the one that exists.
 *
 * No backticks in any comment that sits inside a template literal below.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

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
    console.log(`  ok   ${what}${note === '' ? '' : ` — ${note}`}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
/*
  A SQL error is a FAILED CHECK, not a crashed suite.

  The control this suite exists to satisfy — remove the checkpoint persistence
  and watch recovery break — did break it, and it broke it by throwing 23514
  out of the immutability trigger four sections from the end. That is the
  defence in depth working and it is a terrible report: an exception says
  nothing about which property was lost and stops every later check from
  running. So a section that throws records one named failure and the rest of
  the suite carries on.
*/
let section = '(before the first section)'
const one = async (sql: string): Promise<Record<string, unknown>> => {
  try {
    return ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
  } catch (error) {
    ok(`${section} could not run at all`, false, String((error as Error).message).slice(0, 160))
    return {}
  }
}
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Math.random().toString(36).slice(2, 10)

/*
  Tolerant of nothing, because a section that could not run returns nothing.

  Without this the first failed section takes the suite down on a TypeError one
  line later, which is the crash this file was just changed to stop.
*/
const asJson = (v: unknown): Record<string, unknown> => {
  if (v === null || v === undefined) return {}
  return (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
}

console.log('\nverify:checkpoints — does a job carry on, and refuse when it cannot be sure\n')

/*
  One fixture job, made the way every suite here makes one: a fixture project
  and a `verify-` requester, so `jobs.is_fixture` is generated true and nothing
  this writes reaches Grant's health readings.
*/
const JOB = `
  (select job_id from public.jobs where idempotency_key = ${lit(`ckpt-${run}`)})`

const SETUP = `
  insert into public.projects (name, slug, status)
  values (${lit(`Fixture checkpoints ${run}`)}, ${lit(`fixture-checkpoints-${run}`)}, 'paused');
  insert into public.jobs
    (kind, idempotency_key, correlation_id, requested_by, project_id, state)
  values ('office.instruction', ${lit(`ckpt-${run}`)}, gen_random_uuid(),
          ${lit(`teamhq:verify-ckpt-${run}`)},
          (select project_id from public.projects where slug = ${lit(`fixture-checkpoints-${run}`)}),
          'queued');
  update public.jobs set state = 'running' where idempotency_key = ${lit(`ckpt-${run}`)};
`

// ---------------------------------------------------------------------------
console.log('a second attempt sees what the first one did')
section = 'a second attempt sees what the first one did'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;

    -- Attempt one: three steps, two of them finished.
    insert into r select 'a1', app.step_begin(app.job_office(${JOB}), ${JOB}, 'gather', 0, 'none', 1, 'v1');
    insert into r select 'd1', app.step_done(app.job_office(${JOB}), ${JOB}, 'gather', '{"documents": 8}'::jsonb);
    insert into r select 'a2', app.step_begin(app.job_office(${JOB}), ${JOB}, 'draft', 1, 'none', 1, 'v1');
    insert into r select 'd2', app.step_done(app.job_office(${JOB}), ${JOB}, 'draft', '{"title": "A report"}'::jsonb);

    -- and then the worker dies. Attempt two asks the same questions.
    insert into r select 'b1', app.step_begin(app.job_office(${JOB}), ${JOB}, 'gather', 0, 'none', 1, 'v1');
    insert into r select 'b2', app.step_begin(app.job_office(${JOB}), ${JOB}, 'draft', 1, 'none', 1, 'v1');
    insert into r select 'b3', app.step_begin(app.job_office(${JOB}), ${JOB}, 'store', 2, 'local', 1, 'v1');

    select (select v from r where k = 'b1') as gather_again,
           (select v from r where k = 'b2') as draft_again,
           (select v from r where k = 'b3') as store_first,
           app.job_progress(${JOB}) as progress;
    rollback;`)

  const gather = asJson(got.gather_again)
  const draft = asJson(got.draft_again)
  const store = asJson(got.store_first)
  const progress = asJson(got.progress)

  ok(
    'a finished step is skipped on the next attempt',
    gather.skip === true && draft.skip === true,
    `gather=${String(gather.skip)} draft=${String(draft.skip)}`,
  )
  ok(
    'and it hands back what it produced, so the next step does not redo the work',
    asJson(draft.outcome).title === 'A report',
    JSON.stringify(draft.outcome),
  )
  ok(
    'a step never reached is run for the first time',
    store.do === true && store.first === true,
    JSON.stringify(store),
  )
  const steps = (progress.steps ?? []) as Record<string, unknown>[]
  ok(
    'and the progress a person reads names each step and whether it is done',
    steps.length === 3 && steps.filter((s) => s.done === true).length === 2,
    `${String(steps.length)} step(s), ${String(steps.filter((s) => s.done === true).length)} done`,
  )
}

// ---------------------------------------------------------------------------
console.log('\nan interrupted EXTERNAL write is never repeated')
section = 'an interrupted EXTERNAL write is never repeated'
// ---------------------------------------------------------------------------

{
  /*
    The requirement the Issue calls the most important one. A step that began,
    declared that it acts outside the office, and never finished cannot be
    retried and cannot be skipped: nobody here can tell whether the message was
    sent, so the job parks and a person reconciles.
  */
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;

    insert into r select 'post', app.step_begin(app.job_office(${JOB}), ${JOB}, 'post', 0, 'external', 1, 'v1');
    -- and the worker dies here, between the send and the record.
    insert into r select 'again', app.step_begin(app.job_office(${JOB}), ${JOB}, 'post', 0, 'external', 1, 'v1');

    -- The same shape, but the step only touched the office.
    insert into r select 'local', app.step_begin(app.job_office(${JOB}), ${JOB}, 'tidy', 1, 'local', 1, 'v1');
    insert into r select 'local_again', app.step_begin(app.job_office(${JOB}), ${JOB}, 'tidy', 1, 'local', 1, 'v1');

    select (select v from r where k = 'again') as external_again,
           (select v from r where k = 'local_again') as local_again;
    rollback;`)

  const ext = asJson(got.external_again)
  const loc = asJson(got.local_again)
  ok(
    'an unfinished EXTERNAL step parks rather than being run twice',
    ext.park === true,
    String(ext.why ?? JSON.stringify(ext)).slice(0, 90),
  )
  ok(
    'CONTROL: and an unfinished LOCAL step is simply run again',
    loc.do === true && loc.again === true,
    JSON.stringify(loc),
  )
}

// ---------------------------------------------------------------------------
console.log('\na checkpoint from different code is refused, not guessed through')
section = 'a checkpoint from different code is refused, not guessed through'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'a', app.step_begin(app.job_office(${JOB}), ${JOB}, 'gather', 0, 'none', 1, 'v1');
    insert into r select 'b', app.step_done(app.job_office(${JOB}), ${JOB}, 'gather', '{"documents": 8}'::jsonb);
    -- The schema changed. The step is finished and must still not be skipped.
    insert into r select 'c', app.step_begin(app.job_office(${JOB}), ${JOB}, 'gather', 0, 'none', 2, 'v2');
    select (select v from r where k = 'c') as under_new_code;
    rollback;`)

  const stale = asJson(got.under_new_code)
  ok(
    'a finished step recorded under another schema is neither skipped nor redone',
    stale.stale === true && stale.skip === undefined && stale.do === undefined,
    JSON.stringify(stale).slice(0, 110),
  )
}

// ---------------------------------------------------------------------------
console.log('\nwhat a step recorded cannot be rewritten')
section = 'what a step recorded cannot be rewritten'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v text) on commit drop;
    select app.step_begin(app.job_office(${JOB}), ${JOB}, 'post', 0, 'external', 1, 'v1');
    select app.step_done(app.job_office(${JOB}), ${JOB}, 'post', '{"sent": true}'::jsonb, 'telegram:389');

    /*
      A plpgsql block, because a plain SQL script has no exception handler and
      the thing being tested is a refusal. Two separate blocks so one failing
      does not hide the other.
    */
    do $x$
    begin
      update public.job_steps set outcome = '{"sent": false}'::jsonb
       where job_id = (select job_id from public.jobs
                        where idempotency_key = ${lit(`ckpt-${run}`)}) and step = 'post';
      insert into r values ('edit', 'ALLOWED');
    exception when others then insert into r values ('edit', sqlerrm);
    end $x$;

    do $x$
    begin
      delete from public.job_steps
       where job_id = (select job_id from public.jobs
                        where idempotency_key = ${lit(`ckpt-${run}`)}) and step = 'post';
      insert into r values ('delete', 'ALLOWED');
    exception when others then insert into r values ('delete', sqlerrm);
    end $x$;

    -- Finishing twice is a retry, not an error.
    insert into r select 'twice', (app.step_done(app.job_office(${JOB}), ${JOB}, 'post', '{}'::jsonb) ->> 'already');

    select (select v from r where k = 'edit') as edit,
           (select v from r where k = 'delete') as del,
           (select v from r where k = 'twice') as twice;
    rollback;`)

  ok(
    'a finished step cannot be edited, and the refusal says why',
    String(got.edit ?? '').includes('already finished'),
    String(got.edit ?? '').slice(0, 80),
  )
  ok(
    'and it cannot be deleted',
    String(got.del ?? '').includes('cannot be unhappened'),
    String(got.del ?? '').slice(0, 80),
  )
  ok(
    'CONTROL: finishing the same step twice is idempotent, not an error',
    String(got.twice) === 'true',
    `already=${String(got.twice)}`,
  )
}

// ---------------------------------------------------------------------------
console.log('\npausing, and what may resume on a tick')
section = 'pausing, and what may resume on a tick'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;

    /*
      The eighth argument is the fingerprint of what is being approved (0457).
      An approval pause without one is refused now, deliberately: an approval
      that binds to nothing cannot stop a resumed worker doing something else.
      This section predates that and asserted the weaker contract.
    */
    insert into r select 'pause', app.pause_job(${JOB}, 'awaiting_approval',
      'It wants to publish the report and nobody has said yes.',
      'Grant approves it on the Governance page.', true, null, null,
      ${lit('c'.repeat(64))});

    select (select state::text from public.jobs where job_id = ${JOB}) as state,
           (select waiting_on from public.jobs where job_id = ${JOB}) as waiting_on,
           app.job_progress(${JOB}) -> 'paused' as paused,
           (select count(*) from jsonb_array_elements(app.resumable_now()) x
             where (x ->> 'job_id')::uuid = ${JOB}) as on_a_tick;
    rollback;`)

  const paused = asJson(got.paused)
  ok(
    'a paused job says so in the state the office already had a word for',
    got.state === 'paused',
    String(got.state),
  )
  ok(
    'and says what would let it carry on, in words',
    String(got.waiting_on ?? '').includes('Governance') && paused.reason === 'awaiting_approval',
    `${String(paused.reason)} — ${String(got.waiting_on ?? '').slice(0, 50)}`,
  )
  ok(
    'CONTROL: a job waiting for a PERSON is not resumed by a tick',
    Number(got.on_a_tick) === 0,
    `${String(got.on_a_tick)} on the tick list`,
  )
}

{
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'p', app.pause_job(${JOB}, 'rate_limited',
      'OpenRouter said no more for now.', 'The window resets.', true,
      app.now_utc() - interval '1 minute', null);
    insert into r select 'tick', jsonb_build_object('n',
      (select count(*) from jsonb_array_elements(app.resumable_now()) x
        where (x ->> 'job_id')::uuid = ${JOB}));
    insert into r select 'resume', app.resume_job(${JOB}, 'the window reset');
    select (select v from r where k = 'tick') -> 'n' as on_a_tick,
           (select state::text from public.jobs where job_id = ${JOB}) as state,
           (select waiting_on from public.jobs where job_id = ${JOB}) as waiting_on,
           (select count(*) from public.job_pauses
             where job_id = ${JOB} and resumed_at is not null) as closed;
    rollback;`)

  ok(
    'a job waiting on a CLOCK is offered to the tick once its time has come',
    Number(got.on_a_tick) === 1,
    `${String(got.on_a_tick)} on the tick list`,
  )
  ok(
    'resuming puts it back in the queue and clears what it was waiting on',
    got.state === 'queued' && got.waiting_on === null,
    `${String(got.state)}, waiting_on=${String(got.waiting_on)}`,
  )
  ok(
    'and the pause is closed rather than left open for ever',
    Number(got.closed) === 1,
    `${String(got.closed)} closed`,
  )
}

{
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'p', app.pause_job(${JOB}, 'needs_reconciliation',
      'A post may or may not have gone out.', 'Somebody checks.', false, null, null);
    insert into r select 'try', app.resume_job(${JOB}, 'a tick tried');
    select (select v from r where k = 'try') ->> 'error' as refused,
           (select state::text from public.jobs where job_id = ${JOB}) as state;
    rollback;`)

  {
    /*
    Every resumable reason gets a check, because the first live fan-in found
    the one that did not have one.

    `dependency_wait` was left out of `resumable_now`, so a synthesis whose
    three specialists had all finished sat paused for eighteen minutes and the
    answer was never written. The suite had not asked. A reason that nothing
    wakes is indistinguishable from a reason nobody uses, and the way to stop
    that recurring is to assert the LIST rather than an instance of it.
  */
    const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select reason, app.pause_job(
      (select job_id from public.jobs where idempotency_key = ${lit(`ckpt-${run}`)}),
      reason, 'x', 'y', true, app.now_utc() - interval '1 minute', null)
      from (values ('scheduled_wait'), ('rate_limited'), ('provider_unavailable'),
                   ('dependency_wait')) w(reason)
     where false;

    select coalesce(jsonb_agg(w.reason order by w.reason), '[]'::jsonb) as wakeable
      from (values ('scheduled_wait'), ('rate_limited'), ('provider_unavailable'),
                   ('dependency_wait')) w(reason)
     where exists (
       select 1 from pg_get_functiondef('app.resumable_now()'::regprocedure) d(t)
        where d.t like '%' || w.reason || '%');
    rollback;`)

    const wakeable = (asJson({ v: got.wakeable }).v ?? []) as string[]
    ok(
      'every reason that waits on something other than a person can be woken',
      wakeable.length === 4,
      wakeable.join(', '),
    )
  }

  ok(
    'a pause marked not-resumable refuses to be resumed automatically',
    String(got.refused ?? '').includes('needs a person') && got.state === 'paused',
    `${String(got.refused ?? '').slice(0, 60)} — still ${String(got.state)}`,
  )
}

// ---------------------------------------------------------------------------
console.log('\nand a job cancelled from a pause leaves nothing half-written')
section = 'and a job cancelled from a pause leaves nothing half-written'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;
    select app.step_begin(app.job_office(${JOB}), ${JOB}, 'gather', 0, 'none', 1, 'v1');
    select app.step_done(app.job_office(${JOB}), ${JOB}, 'gather', '{"documents": 8}'::jsonb);
    select app.pause_job(${JOB}, 'awaiting_human_action', 'Waiting.', 'He answers.',
                         true, null, null);
    update public.jobs set state = 'cancelled', state_reason = 'he changed his mind'
     where job_id = ${JOB};
    select (select state::text from public.jobs where job_id = ${JOB}) as state,
           (select count(*) from public.job_steps where job_id = ${JOB} and finished_at is not null) as kept,
           (select count(*) from public.job_pauses where job_id = ${JOB} and resumed_at is null) as still_open;
    rollback;`)

  ok(
    'cancelling from paused is legal and keeps the record of what was done',
    got.state === 'cancelled' && Number(got.kept) === 1,
    `${String(got.state)}, ${String(got.kept)} finished step(s) kept`,
  )
  /*
    The open pause is left open on purpose, and it is worth an assertion rather
    than a shrug: the job is cancelled, so nothing will resume it, and a pause
    row rewritten by a cancel would lose why it stopped. `resumable_now` filters
    on the job's state, so a cancelled job cannot be offered to a tick.
  */
  ok(
    'CONTROL: and a cancelled job is never offered to a tick, open pause or not',
    Number(got.still_open) === 1,
    `${String(got.still_open)} pause(s) left as history`,
  )
}

// ===========================================================================
console.log('\nan approval binds to the action it approved')
// ===========================================================================

{
  /*
    #263's approval requirement, which is a safety property and not a nicety:
    a resumed worker must not carry out a materially different action under an
    approval given for the earlier one.

    Two fingerprints, one approved. The suite asserts three separate sentences,
    because they need three different responses: this is what was approved,
    this is NOT what was approved, and nothing was ever approved. Collapsing
    the last two would make a handler bug look like the invariant firing.
  */
  const APPROVED = 'a'.repeat(64)
  const CHANGED = 'b'.repeat(64)

  /*
    The pause and the comparison are separate STATEMENTS.

    `approval_binds` is STABLE, so inside one statement it reads the snapshot
    taken before `pause_job` inserted anything and reports that nothing was
    ever approved — which is indistinguishable from the feature not working.
    CLAUDE.md records this from verify:browser this morning; a scratch table
    carries the writer's answer forward because only the last select returns.
  */
  const got = await one(`
    begin;
    ${SETUP}
    create temp table t (k text primary key, v jsonb) on commit drop;
    insert into t values ('paused', app.pause_job(${JOB}, 'awaiting_approval',
      'send the announcement', 'Grant approves it on the Governance page',
      true, null, null, ${lit(APPROVED)}));
    insert into t values ('same', app.approval_binds(${JOB}, ${lit(APPROVED)}));
    insert into t values ('different', app.approval_binds(${JOB}, ${lit(CHANGED)}));
    select (select v from t where k = 'paused') as paused,
           (select v from t where k = 'same') as same,
           (select v from t where k = 'different') as different;
    rollback;`)

  ok(
    'a pause can bind to the exact action',
    asJson(got.paused).ok === true,
    String(asJson(got.paused).error ?? 'bound'),
  )
  ok('the action that was approved is recognised', asJson(got.same).matched === true)
  ok(
    'and one that changed while it waited is refused, with a reason a person can read',
    asJson(got.different).matched === false &&
      String(asJson(got.different).why ?? '').includes('not what was approved'),
    String(asJson(got.different).why ?? '(it matched)').slice(0, 80),
  )
  ok(
    'and a changed action is told apart from nothing having been approved',
    asJson(got.different).approved_anything === true,
    'approved_anything stays true, so a handler bug does not read as the rule firing',
  )

  const never = await one(`
    begin;
    ${SETUP}
    select app.approval_binds(${JOB}, ${lit(APPROVED)}) as v;
    rollback;`)
  ok(
    'CONTROL: a job nobody approved anything for says exactly that',
    asJson(never.v).matched === false && asJson(never.v).approved_anything === false,
    String(asJson(never.v).why ?? '').slice(0, 60),
  )

  const naked = await one(`
    begin;
    ${SETUP}
    select app.pause_job(${JOB}, 'awaiting_approval', 'send it', 'Grant approves',
                         true, null, null, null) as v;
    rollback;`)
  ok(
    'an approval pause with nothing to bind to is refused outright',
    String(asJson(naked.v).error ?? '').includes('bind to the exact action'),
    String(asJson(naked.v).error ?? '(it was accepted)').slice(0, 70),
  )
  /*
    The control for that refusal. A constraint can be tightened until it
    refuses everything, and every check above would go on reading green.
  */
  const other = await one(`
    begin;
    ${SETUP}
    select app.pause_job(${JOB}, 'rate_limited', 'the provider said slow down',
                         'It tries again shortly', true, null, null, null) as v;
    rollback;`)
  ok(
    'CONTROL: and a pause that is not an approval still needs nothing — a rate limit binds to no action',
    asJson(other.v).ok === true,
    String(asJson(other.v).error ?? 'accepted'),
  )
}

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
