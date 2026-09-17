/**
 * Do several specialists really work at once, and can the answer lie about it?
 *
 *   npm run verify:parallel
 *
 * Issue #262. The office has fanned out for weeks — `speaker()` convenes a
 * roster and `instruction.ts` enqueues one child each — and what was missing is
 * the fan-in. So most of this suite is about the answer rather than about the
 * branches: the branches were already real, and the way this feature fails is
 * an answer that reads as though four people contributed when two did.
 *
 * Driven at the database inside `begin … rollback`, with one exception noted
 * where it appears. The synthesis PROMPT is not exercised here — a model call
 * per run would make the suite slow and non-deterministic — and the property
 * that matters about it is pure, so `namedWithoutEvidence` is unit-tested
 * instead and this proves what reaches it.
 *
 * No backticks in any comment inside a template literal below.
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
let section = '(before the first section)'
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}${note === '' ? '' : ` — ${note}`}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const one = async (sql: string): Promise<Record<string, unknown>> => {
  try {
    return ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
  } catch (error) {
    ok(`${section} could not run at all`, false, String((error as Error).message).slice(0, 170))
    return {}
  }
}
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const asJson = (v: unknown): Record<string, unknown> => {
  if (v === null || v === undefined) return {}
  return (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
}
const run = Math.random().toString(36).slice(2, 10)

/*
  `running -> complete` is not a legal transition and the first draft of this
  suite used it five times, reporting FAIL about a product that was right.

  The real path is running -> output_created -> quality_review -> committing ->
  committed -> notifying -> complete, and walking it is what a finished job
  actually looks like — so the fixtures are indistinguishable from real ones
  rather than merely close.
*/
const FINISH = (job: string): string =>
  ['output_created', 'quality_review', 'committing', 'committed', 'notifying', 'complete']
    .map((state) => `update public.jobs set state = '${state}' where job_id in ${job};`)
    .join('\n    ')

console.log('\nverify:parallel — several specialists at once, and one honest answer after\n')

/*
  A parent and three branch jobs, made the way the handler makes them: children
  of the parent, each `addressed_to` a real specialist, none announcing.
*/
const PARENT = `(select job_id from public.jobs where idempotency_key = ${lit(`par-${run}`)})`
const CHILD = (n: string): string =>
  `(select job_id from public.jobs where idempotency_key = ${lit(`par-${run}-${n}`)})`

const SETUP = `
  insert into public.projects (name, slug, status)
  values (${lit(`Fixture parallel ${run}`)}, ${lit(`fixture-parallel-${run}`)}, 'paused');
  insert into public.jobs
    (kind, idempotency_key, correlation_id, requested_by, project_id, state)
  values ('office.instruction', ${lit(`par-${run}`)}, gen_random_uuid(),
          ${lit(`teamhq:verify-par-${run}`)},
          (select project_id from public.projects where slug = ${lit(`fixture-parallel-${run}`)}),
          'queued');
  insert into public.jobs
    (kind, idempotency_key, correlation_id, parent_job_id, requested_by, project_id,
     state, recipient_agent, announce)
  select 'office.instruction', ${lit(`par-${run}`)} || '-' || w.slug,
         (select correlation_id from public.jobs where idempotency_key = ${lit(`par-${run}`)}),
         ${PARENT}, ${lit(`teamhq:verify-par-${run}`)},
         (select project_id from public.projects where slug = ${lit(`fixture-parallel-${run}`)}),
         'queued', w.slug, false
    from (values ('research-director'), ('finance-director'), ('growth-director')) w(slug);
`

const BRANCHES = `jsonb_build_array(
  jsonb_build_object('job_id', ${CHILD('research-director')}, 'agent', 'research-director',
                     'purpose', 'what the competitors charge', 'required', true),
  jsonb_build_object('job_id', ${CHILD('finance-director')}, 'agent', 'finance-director',
                     'purpose', 'what it does to the margin', 'required', true),
  jsonb_build_object('job_id', ${CHILD('growth-director')}, 'agent', 'growth-director',
                     'purpose', 'how we would take it to market', 'required', false))`

// ---------------------------------------------------------------------------
console.log('the branches are real jobs, and the group knows which')
section = 'the branches are real jobs'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'fan', app.fan_in_over(${PARENT},
      'Is the new tier commercially viable?', ${BRANCHES}, 'office.synthesise', null);
    insert into r select 'again', app.fan_in_over(${PARENT},
      'Is the new tier commercially viable?', ${BRANCHES}, 'office.synthesise', null);

    select (select v from r where k = 'fan') as fan,
           (select v from r where k = 'again') as again,
           (select count(*) from public.job_branches b
             join public.branch_groups g using (group_id)
            where g.parent_job_id = ${PARENT}) as branches,
           (select count(*) from public.jobs
             where parent_job_id = ${PARENT} and kind = 'office.synthesise') as synths,
           (select count(distinct j.state::text) from public.job_branches b
             join public.branch_groups g using (group_id)
             join public.jobs j on j.job_id = b.job_id
            where g.parent_job_id = ${PARENT}) as states;
    rollback;`)

  const fan = asJson(got.fan)
  const again = asJson(got.again)
  ok(
    'a fan-in registers every branch as its own job',
    fan.ok === true && Number(got.branches) === 3,
    `${String(got.branches)} branch(es)`,
  )
  ok(
    'and enqueues exactly one job to write the answer',
    Number(got.synths) === 1,
    `${String(got.synths)} synthesis job(s)`,
  )
  ok(
    'CONTROL: a retried parent does not fan in twice',
    again.already === true && Number(got.synths) === 1,
    `already=${String(again.already)}, still ${String(got.synths)} synthesis job(s)`,
  )
}

// ---------------------------------------------------------------------------
console.log('\nthe ceilings, and who may be a branch')
section = 'the ceilings'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;

    -- One branch is not a fan-out.
    insert into r select 'one', app.fan_in_over(${PARENT}, 'x', jsonb_build_array(
      jsonb_build_object('job_id', ${CHILD('research-director')}, 'agent', 'research-director',
                         'purpose', 'p')), 'office.synthesise', null);

    -- Somebody else's child cannot be claimed as a branch.
    insert into r select 'stolen', app.fan_in_over(${PARENT}, 'x', jsonb_build_array(
      jsonb_build_object('job_id', ${PARENT}, 'agent', 'research-director', 'purpose', 'p'),
      jsonb_build_object('job_id', ${CHILD('finance-director')}, 'agent', 'finance-director',
                         'purpose', 'p')), 'office.synthesise', null);

    -- And nobody who is not on the roster.
    insert into r select 'ghost', app.fan_in_over(${PARENT}, 'x', jsonb_build_array(
      jsonb_build_object('job_id', ${CHILD('research-director')}, 'agent', 'nobody-at-all',
                         'purpose', 'p'),
      jsonb_build_object('job_id', ${CHILD('finance-director')}, 'agent', 'finance-director',
                         'purpose', 'p')), 'office.synthesise', null);

    select (select v from r where k = 'one') ->> 'error' as one,
           (select v from r where k = 'stolen') ->> 'error' as stolen,
           (select v from r where k = 'ghost') ->> 'error' as ghost,
           (select count(*) from public.branch_groups where parent_job_id = ${PARENT}) as groups;
    rollback;`)

  ok(
    'a fan-in over one branch is refused, and says it is just a job',
    String(got.one ?? '').includes('just a job'),
    String(got.one ?? '').slice(0, 60),
  )
  ok(
    'CONTROL: a job that is not a child of this question cannot be claimed as a branch',
    String(got.stolen ?? '').includes('not a child'),
    String(got.stolen ?? '').slice(0, 60),
  )
  ok(
    'CONTROL: and nobody off the roster can be a branch',
    String(got.ghost ?? '').includes('nobody on the roster'),
    String(got.ghost ?? '').slice(0, 60),
  )
  ok(
    'CONTROL: and none of the three refusals left a group behind',
    Number(got.groups) === 0,
    `${String(got.groups)} group(s)`,
  )
}

// ---------------------------------------------------------------------------
console.log('\nthe answer waits for what it must, and not for what it need not')
section = 'the answer waits'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'fan', app.fan_in_over(${PARENT}, 'Is it viable?', ${BRANCHES},
      'office.synthesise', null);

    -- Nothing has finished.
    insert into r select 'cold', app.fan_in_ready(
      (select group_id from public.branch_groups where parent_job_id = ${PARENT}));

    -- The two REQUIRED branches answer; the optional one is still going.
    update public.jobs set state = 'running' where job_id in
      (${CHILD('research-director')}, ${CHILD('finance-director')});
    ${FINISH(`(${CHILD('research-director')}, ${CHILD('finance-director')})`)}
    insert into r select 'required_in', app.fan_in_ready(
      (select group_id from public.branch_groups where parent_job_id = ${PARENT}));

    -- And then it answers too.
    update public.jobs set state = 'running' where job_id = ${CHILD('growth-director')};
    ${FINISH(`(${CHILD('growth-director')})`)}
    insert into r select 'all_in', app.fan_in_ready(
      (select group_id from public.branch_groups where parent_job_id = ${PARENT}));

    select (select v from r where k = 'cold') as cold,
           (select v from r where k = 'required_in') as required_in,
           (select v from r where k = 'all_in') as all_in;
    rollback;`)

  const cold = asJson(got.cold)
  const partial = asJson(got.required_in)
  const all = asJson(got.all_in)
  ok(
    'with nothing in, the answer is not ready and says who it is waiting for',
    cold.ready === false && ((cold.waiting_for ?? []) as unknown[]).length === 3,
    `${String(((cold.waiting_for ?? []) as unknown[]).length)} outstanding`,
  )
  ok(
    'with the required branches in and an optional one still going, it still waits',
    partial.ready === false && Number(partial.done) === 2,
    `done=${String(partial.done)} ready=${String(partial.ready)}`,
  )
  ok(
    'and when everybody is in, it is ready',
    all.ready === true && Number(all.running) === 0,
    `done=${String(all.done)} running=${String(all.running)}`,
  )
}

{
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'fan', app.fan_in_over(${PARENT}, 'Is it viable?', ${BRANCHES},
      'office.synthesise', app.now_utc() - interval '1 minute');
    -- Both required branches are in; the optional one has not started and the
    -- deadline has passed.
    update public.jobs set state = 'running' where job_id in
      (${CHILD('research-director')}, ${CHILD('finance-director')});
    ${FINISH(`(${CHILD('research-director')}, ${CHILD('finance-director')})`)}
    insert into r select 'late', app.fan_in_ready(
      (select group_id from public.branch_groups where parent_job_id = ${PARENT}));
    select (select v from r where k = 'late') as late;
    rollback;`)

  const late = asJson(got.late)
  ok(
    'past the deadline it answers with what it has rather than waiting for ever',
    late.ready === true && late.past_deadline === true,
    `ready=${String(late.ready)} running=${String(late.running)}`,
  )
}

{
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'fan', app.fan_in_over(${PARENT}, 'Is it viable?', ${BRANCHES},
      'office.synthesise', null);
    -- One optional branch fails, the two required ones answer.
    update public.jobs set state = 'running' where job_id = ${CHILD('growth-director')};
    update public.jobs set state = 'failed' where job_id = ${CHILD('growth-director')};
    update public.jobs set state = 'running' where job_id in
      (${CHILD('research-director')}, ${CHILD('finance-director')});
    ${FINISH(`(${CHILD('research-director')}, ${CHILD('finance-director')})`)}
    insert into r select 'after', app.fan_in_ready(
      (select group_id from public.branch_groups where parent_job_id = ${PARENT}));
    select (select v from r where k = 'after') as after;
    rollback;`)

  const after = asJson(got.after)
  const lost = (after.lost ?? []) as { agent: string }[]
  ok(
    'one failed optional branch does not destroy the work of the others',
    after.ready === true && Number(after.done) === 2,
    `done=${String(after.done)} failed=${String(after.failed)}`,
  )
  ok(
    'and the one that failed is NAMED, so the answer can say a part is missing',
    lost.length === 1 && lost[0]?.agent === 'growth-director',
    JSON.stringify(lost),
  )
}

// ---------------------------------------------------------------------------
console.log('\nthe answer can only be built from branches that really ran')
section = 'the answer can only be built from branches that really ran'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SETUP}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'fan', app.fan_in_over(${PARENT}, 'Is it viable?', ${BRANCHES},
      'office.synthesise', null);

    -- Two branches answer for real. The third finishes with NOTHING, which is
    -- the case that makes a fan-in able to lie.
    update public.jobs set state = 'running' where job_id in
      (${CHILD('research-director')}, ${CHILD('finance-director')}, ${CHILD('growth-director')});
    /*
      Marked deterministic, because section 10's commit gate refuses to commit
      an unreviewed output and these are constants a suite wrote. CLAUDE.md
      records what saying otherwise costs: two jobs stranded mid-commit for a
      day, which stopped every deploy.

      No backticks in this comment: it lives inside a template literal.
    */
    insert into public.outputs
      (job_id, body, confidence, evidence, sources, deterministic)
    values (${CHILD('research-director')}, 'They charge between forty and sixty.',
            'high', 'verified', '[]'::jsonb, true),
           (${CHILD('finance-director')}, 'It takes four points off the margin.',
            'medium', 'inferred', '[]'::jsonb, true);
    ${FINISH(`(${CHILD('research-director')}, ${CHILD('finance-director')}, ${CHILD('growth-director')})`)}

    insert into r select 'outputs', app.branch_outputs(
      (select group_id from public.branch_groups where parent_job_id = ${PARENT}));
    select (select v from r where k = 'outputs') as outputs;
    rollback;`)

  const outputs = (asJson({ v: got.outputs }).v ?? []) as { agent: string; body: string }[]
  const agents = outputs.map((o) => o.agent).sort()
  ok(
    'a branch with no output is simply not there for the answer to cite',
    outputs.length === 2 && !agents.includes('growth-director'),
    agents.join(', '),
  )
  ok(
    'and what IS there is the real body, not a name',
    outputs.some((o) => o.body.includes('forty and sixty')),
    (outputs[0]?.body ?? '').slice(0, 50),
  )
  /*
    The CONTROL the Issue asks for by name: remove true child execution and the
    test must go red. Removing the OUTPUTS is that, precisely — the jobs still
    exist, still say `complete`, and still claim three specialists worked.
  */
  const nothing = await one(`
    begin;
    ${SETUP}
    select app.fan_in_over(${PARENT}, 'Is it viable?', ${BRANCHES}, 'office.synthesise', null);
    update public.jobs set state = 'running' where parent_job_id = ${PARENT};
    ${FINISH(`(select job_id from public.jobs where parent_job_id = ${PARENT} and kind = 'office.instruction')`)}
    select jsonb_array_length(app.branch_outputs(
      (select group_id from public.branch_groups where parent_job_id = ${PARENT}))) as n;
    rollback;`)
  ok(
    'CONTROL: three branches that ran and produced nothing give the answer nothing',
    Number(nothing.n) === 0,
    `${String(nothing.n)} output(s) from 3 complete branches`,
  )
}

// ---------------------------------------------------------------------------
console.log('\ncancelling the question cancels the branches')
section = 'cancelling the question'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SETUP}
    select app.fan_in_over(${PARENT}, 'Is it viable?', ${BRANCHES}, 'office.synthesise', null);

    -- One branch has already finished. It must survive the cancellation: it did
    -- the work and its output is evidence whatever happened to the question.
    update public.jobs set state = 'running' where job_id = ${CHILD('research-director')};
    ${FINISH(`(${CHILD('research-director')})`)}

    update public.jobs set state = 'cancelled', state_reason = 'he changed his mind'
     where job_id = ${PARENT};

    select (select state::text from public.jobs where job_id = ${CHILD('research-director')}) as finished_one,
           (select state::text from public.jobs where job_id = ${CHILD('finance-director')}) as running_one,
           (select state::text from public.jobs
             where parent_job_id = ${PARENT} and kind = 'office.synthesise') as synth;
    rollback;`)

  ok(
    'a branch still going is cancelled with the question',
    got.running_one === 'cancelled',
    String(got.running_one),
  )
  ok(
    'the job that would have answered is cancelled too',
    got.synth === 'cancelled',
    String(got.synth),
  )
  ok(
    'CONTROL: and a branch that already finished is left alone',
    got.finished_one === 'complete',
    String(got.finished_one),
  )
}

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
