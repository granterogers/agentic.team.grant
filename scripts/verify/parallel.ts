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

import { readFileSync } from 'node:fs'
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

    -- A fan-in over NOTHING has nothing to wait for (0563).
    insert into r select 'none', app.fan_in_over(${PARENT}, 'x', '[]'::jsonb,
      'office.synthesise', null);

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

    -- ONE branch is a fan-in now, and this runs LAST for that reason: it
    -- succeeds, and an existing group makes every later call return early
    -- saying the group is already registered, which is how the two controls
    -- above silently stopped being controls the moment 0563 landed.
    -- No backticks in this comment: it lives inside a template literal.
    insert into r select 'one', app.fan_in_over(${PARENT}, 'x', jsonb_build_array(
      jsonb_build_object('job_id', ${CHILD('research-director')}, 'agent', 'research-director',
                         'purpose', 'p')), 'office.synthesise', null);

    select (select v from r where k = 'none') ->> 'error' as none,
           (select v from r where k = 'stolen') ->> 'error' as stolen,
           (select v from r where k = 'ghost') ->> 'error' as ghost,
           coalesce(((select v from r where k = 'one') ->> 'ok')::boolean, false) as one_ok,
           (select count(*) from public.branch_groups where parent_job_id = ${PARENT}) as groups;
    rollback;`)

  /*
    0563 CHANGED THIS POSTURE DELIBERATELY, so the assertion changed with it
    rather than being deleted.

    It asserted that one branch is refused "because a fan-in over one branch
    is just a job". True about the WORK and wrong about the OWNERSHIP:
    canonical traffic is 5138 real turns convening nobody, 2 convening one and
    **none ever convening two**, so the rule stood one above the only shape
    that happens and a lone specialist's answer had nothing responsible for
    delivering it.

    What replaces it is what the new posture requires: nothing is still
    refused, one is accepted, and the restraint moved to `synthesise.ts`,
    which RELAYS a single branch instead of spending a model to draw one
    answer together.
  */
  ok(
    'a fan-in over NOTHING is refused — there is nothing to wait for',
    String(got.none ?? '').includes('nothing to wait for'),
    String(got.none ?? '').slice(0, 60),
  )
  ok(
    'and a fan-in over ONE branch is accepted, so the answer has an owner',
    got.one_ok === true,
    String(got.one_ok),
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
    'CONTROL: and the two refusals left no group behind — only the accepted one did',
    Number(got.groups) === 1,
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

// ---------------------------------------------------------------------------
console.log('permissions never combine')
section = 'permissions never combine'
// ---------------------------------------------------------------------------

{
  /*
    #262 states it plainly: *"A parent that delegates to Emma and Daniel does
    not receive the union of their external reach."*

    Every agent currently holds the same sixteen tools, so there is no natural
    asymmetry to measure — the difference has to be MADE, inside a rollback, or
    the check would pass on a roster where everybody can do everything and mean
    nothing at all.

    A fixture tool is granted to one branch agent only. What is asserted is
    that delegating to them does not give the parent their reach, and the
    control is that the branch agent really does have it — without that, a
    `staff_may_use` that refused everybody would read as the invariant holding.
  */
  const TOOL = `fixture.branch_${run}`
  const got = await one(`
    begin;
    ${SETUP}
    insert into public.tool_permissions (tool, description, level, enabled, delivered_by)
    values (${lit(TOOL)}, 'A fixture tool, granted to one branch agent only.', 0, true,
            'handler');
    insert into public.staff_tools (staff_slug, tool)
    values ('finance-director', ${lit(TOOL)});
    create temp table u (k text primary key, v jsonb) on commit drop;
    insert into u values ('fan', app.fan_in_over(${PARENT},
      'Is this worth doing?', ${BRANCHES}, 'office.synthesise', null));
    select (select v from u where k = 'fan') as fan,
           app.staff_may_use('finance-director', ${lit(TOOL)}) as branch_may,
           app.staff_may_use('chief-of-staff', ${lit(TOOL)}) as parent_may,
           app.staff_may_use('research-director', ${lit(TOOL)}) as sibling_may;
    rollback;`)

  const truthy = (v: unknown): boolean => v === true || v === 'true' || asJson(v).allowed === true
  /*
    Tolerant of nothing, because a section that could not run returns nothing —
    the same guard `asJson` carries two hundred lines up, and the reason the
    first draft of this section took the suite down on a TypeError one line
    after the SQL error it should have reported.
  */
  const said = (v: unknown): string => (v === undefined ? '(nothing came back)' : JSON.stringify(v))

  ok(
    'CONTROL: the branch agent really does hold the tool',
    truthy(got.branch_may),
    said(got.branch_may).slice(0, 50),
  )
  ok(
    'the parent that delegated to them does NOT gain their reach',
    !truthy(got.parent_may),
    said(got.parent_may).slice(0, 50),
  )
  ok(
    'and neither does a sibling branch',
    !truthy(got.sibling_may),
    said(got.sibling_may).slice(0, 50),
  )
  ok(
    'CONTROL: and the delegation being tested really happened',
    ((asJson(got.fan).branches ?? []) as unknown[]).length >= 2,
    `${String(((asJson(got.fan).branches ?? []) as unknown[]).length)} branch(es) registered`,
  )
}

// ---------------------------------------------------------------------------
console.log('nothing serialises the branches, and nothing fans out alone')
section = 'concurrency and restraint'
// ---------------------------------------------------------------------------

{
  /*
    Two boxes that are really one question: does the office run branches
    concurrently WHEN it should, and leave a single-domain request alone?

    Concurrency is asserted as the absence of anything that would prevent it,
    which is the honest form: the branches are ordinary queued jobs with no
    dependency between them, nothing is `paused`, and none carries a
    `not_before` that would hold it back. Whether two actually overlap on the
    clock is the worker's capacity, which this suite does not control and
    should not pretend to.
  */
  const got = await one(`
    begin;
    ${SETUP}
    select app.fan_in_over(${PARENT},
      'Is this worth doing?', ${BRANCHES}, 'office.synthesise', null);
    /*
      The BRANCHES, not every child. The synthesis job is a child of the same
      parent — correctly — so counting children reported four of three and the
      test was wrong rather than the product.
    */
    select count(*) filter (where j.state = 'queued')::int as queued,
           count(*) filter (where j.not_before is not null)::int as held_back,
           count(*) filter (where j.waiting_on is not null)::int as waiting,
           count(distinct j.recipient_agent)::int as agents
      from public.jobs j
      join public.job_branches b on b.job_id = j.job_id
     where j.parent_job_id = ${PARENT};
    rollback;`)

  ok(
    'every branch is queued and eligible at the same moment',
    Number(got.queued) === 3,
    `${String(got.queued)} of 3 queued`,
  )
  ok(
    'nothing holds one back behind another',
    Number(got.held_back) === 0 && Number(got.waiting) === 0,
    `${String(got.held_back)} with a not_before, ${String(got.waiting)} waiting on something`,
  )
  ok(
    'and each goes to a different specialist, which is what makes concurrency worth having',
    Number(got.agents) === 3,
    `${String(got.agents)} distinct agent(s)`,
  )

  /*
    RESTRAINT MOVED, AND THE ASSERTION MOVED WITH IT (0563).

    This asserted that one specialist is structurally incapable of becoming a
    group, in both halves — `instruction.ts` at `>= 2` and `fan_in_over`
    refusing `v_count < 2`. The two agreed with each other and neither was
    reachable: 5138 real turns convened nobody, 2 convened one, **none has
    ever convened two**. So a lone specialist's answer finished after the
    Chief had spoken and nothing owned it.

    Restraint is still the point and it is now where the cost is: a lone
    branch is RELAYED by `office.synthesise`, verbatim and attributed,
    spending no model call. Asserted here as the property that made the old
    rule worth having — a single-domain question must not cost a synthesis —
    rather than as the rule itself, which is the artefact.
  */
  const alone = await one(`
    begin;
    ${SETUP}
    create temp table alone_r (k text, v jsonb) on commit drop;
    insert into alone_r select 'v', app.fan_in_over(${PARENT}, 'A single-domain question',
      jsonb_build_array(jsonb_build_object('job_id', ${CHILD('research-director')},
                         'agent', 'research-director',
                         'purpose', 'the only thing being asked', 'required', true)),
      'office.synthesise', null);
    -- Counted in its OWN statement: a count beside the call reads a snapshot
    -- that predates the insert the function performed, so it comes back 0 over
    -- a group that exists. CLAUDE.md records the same shape twice.
    select (select v from alone_r where k = 'v') as v,
           (select count(*)::int from public.branch_groups
             where parent_job_id = ${PARENT}) as groups;
    rollback;`)
  ok(
    'a single-domain request is registered, so its answer has an owner',
    asJson(alone.v).ok === true && Number(alone.groups) === 1,
    `${String(asJson(alone.v).error ?? 'ok')}, ${String(alone.groups)} group(s)`,
  )
  ok(
    'and a lone branch is relayed rather than synthesised, so it costs no model call',
    /if \(outputs\.length === 1\)/.test(readFileSync('src/handlers/synthesise.ts', 'utf8')),
    'synthesise.ts has no one-branch relay',
  )
}

// ---------------------------------------------------------------------------
console.log('the ceiling on how wide a question may go')
section = 'the ceiling'
// ---------------------------------------------------------------------------

{
  /*
    #262's cost section asks for a deterministic max branch count, and
    `fan_in_over` reads one from `system_config` rather than hard-coding it —
    so the check reads the same setting rather than asserting a number, which
    would go red the day Grant changes it.
  */
  const cap = await one(`
    select coalesce(nullif(value #>> '{}', '')::int, 3) as cap
      from public.system_config where key = 'parallel.max_branches'`)
  const capN = Number(cap.cap ?? 3)

  const got = await one(`
    begin;
    ${SETUP}
    insert into public.jobs
      (kind, idempotency_key, correlation_id, parent_job_id, requested_by, project_id,
       state, recipient_agent, announce)
    select 'office.instruction', ${lit(`par-${run}`)} || '-extra-' || g,
           (select correlation_id from public.jobs where idempotency_key = ${lit(`par-${run}`)}),
           ${PARENT}, ${lit(`teamhq:verify-par-${run}`)},
           (select project_id from public.projects where slug = ${lit(`fixture-parallel-${run}`)}),
           'queued', 'research-director', false
      from generate_series(1, ${String(capN + 1)}) g;
    select app.fan_in_over(${PARENT}, 'A question asked too many ways', (
        select jsonb_agg(jsonb_build_object(
          'job_id', j.job_id, 'agent', 'research-director',
          'purpose', 'one of too many', 'required', false))
          from public.jobs j
         where j.parent_job_id = ${PARENT}
           and j.idempotency_key like ${lit(`par-${run}-extra-%`)}
      ), 'office.synthesise', null) as v,
      (select count(*)::int from public.branch_groups where parent_job_id = ${PARENT}) as groups;
    rollback;`)

  ok(
    `more branches than the office allows is refused, and names the ceiling`,
    String(asJson(got.v).error ?? '').includes('allows') && Number(got.groups) === 0,
    `${String(asJson(got.v).error ?? '(it was allowed)').slice(0, 70)}`,
  )
  ok(
    'CONTROL: and the ceiling is a setting Grant can change, not a number in the code',
    capN >= 2,
    `parallel.max_branches = ${String(capN)}`,
  )
}

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
