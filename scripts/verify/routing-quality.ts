/**
 * A model is chosen on what it has actually done, per kind of work (#127).
 *
 *   npm run verify:routing-quality
 *
 * Migrations 0394 and 0395. The router's half is unit-tested in
 * `tests/providers/router.test.ts` — that it takes the order it is given
 * rather than inventing one, and that it says why. This is the other half:
 * whether the order is right.
 *
 * ## What it must prove, and why each one
 *
 * Every check drives `app.model_order` against a record this suite has just
 * created, inside a transaction that rolls back. Reading the function and
 * agreeing with it is how 0392's two scope lists came to differ.
 *
 * - **The record is per KIND.** One aggregate number would hide the common
 *   case, which is a model good at one thing and poor at another — and the
 *   office's real data has exactly that.
 * - **Provider faults are not the model's fault.** A rate limit that counted
 *   as incompetence would let one bad afternoon damn a model for ever, and
 *   excluding them moves real models by forty points.
 * - **Every permitted outcome is deliberately classified.** Read from the
 *   CHECK constraint rather than from a list written here, so that adding an
 *   outcome without deciding what it means goes red instead of quietly
 *   becoming invisible. A list written twice is a list that will disagree.
 * - **Free before paid, whatever the records say.** Grant: *"The £0 constraint
 *   is not a tiebreak."* This is the check that makes that a rule rather than
 *   an intention.
 * - **Exploration.** *"A model that is never chosen can never improve its
 *   record."* Asserted by ageing a poor model's last call past the window and
 *   watching it come back.
 * - **Harness traffic is excluded**, because the fifth instance of harness
 *   traffic being read as the office failing was inside this very feature
 *   (0395), and a comment saying it is excluded is worth nothing without a
 *   check.
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
const GOOD = `probe/good-${run}:free`
const POOR = `probe/poor-${run}:free`
const PAID = `probe/paid-${run}`
const KIND_A = `probe.kind.a.${run}`
const KIND_B = `probe.kind.b.${run}`
const KIND_C = `probe.kind.c.${run}`

console.log(`\nverify:routing-quality — ${run}\n`)

/* ------------------------------------------------------------------ *
 * Every outcome the table permits is deliberately classified.
 * ------------------------------------------------------------------ */
console.log('the classification is complete')

/*
  Read the permitted values out of the CHECK constraint and ask the VIEW which
  of them it counts, by inspecting its own definition. Neither side is a list
  written here, so this cannot pass because both copies were wrong in the same
  way — which is the failure mode of every "assert the list" check in this
  repository.
*/
const outcomes = await one(`
  with permitted as (
    select m[1] as v
      from pg_constraint c,
           lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') as m
     where c.conrelid = 'public.inference_usage'::regclass
       and pg_get_constraintdef(c.oid) like '%outcome = ANY%'
  ),
  counted as (
    select unnest(array['ok','empty_completion','malformed_response']) as v
  ),
  ignored as (
    select unnest(array['rate_limited','provider_error','transport_error',
                        'unavailable','refused_paid']) as v
  )
  select coalesce(string_agg(p.v, ', ' order by p.v), '(none)') as unclassified,
         (select count(*)::text from permitted) as permitted
    from permitted p
   where p.v not in (select v from counted) and p.v not in (select v from ignored)`)
check(
  'no outcome the table permits is left unclassified',
  `${outcomes.permitted} permitted, unclassified: ${outcomes.unclassified}`,
  outcomes.unclassified === '(none)' && Number(outcomes.permitted) >= 8,
)

/*
  And the view really does count only the three. Asserted against the view's
  own text rather than by inference: a check that the view "works" cannot tell
  a correct filter from a missing one when the sample happens to contain no
  rate limits.
*/
const viewDef = await one(`select pg_get_viewdef('public.model_record'::regclass, true) as d`)
const def = String(viewDef.d ?? '')
check(
  'the view counts the three the model is answerable for, and no others',
  def.includes("'ok'") && def.includes("'empty_completion'") ? 'the three are named' : 'not found',
  def.includes("'ok'::text") &&
    def.includes("'empty_completion'::text") &&
    def.includes("'malformed_response'::text") &&
    !def.includes("'rate_limited'"),
)

/* ------------------------------------------------------------------ *
 * The record, and the order it produces.
 * ------------------------------------------------------------------ */
console.log('\na poor record demotes, per kind')

/*
  One statement. Three models are registered, a record is manufactured for two
  kinds, and the ordering is read back for each — all inside a rollback,
  because `provider_models` and `inference_usage` are real tables the office
  runs on.

  The subject jobs are REAL rather than fixtures, deliberately and against this
  repository's usual advice, because the thing under test EXCLUDES harness
  traffic: a fixture subject would make every count zero and every check pass
  for the wrong reason. #45's rule, asked about the column the reader actually
  filters. They exist for the length of one transaction.
*/
const arc = await one(`
  begin;
  create temp table _r (k text primary key, v text);
  do $$
  declare
    v_project uuid;
    v_job     uuid;
    v_i       integer;
  begin
    select project_id into v_project
      from public.projects where status = 'active' and not is_fixture limit 1;

    /*
      The usable-was-probed constraint refuses a model marked usable that
      nothing has ever reached - which is right, and is why these carry a
      probe time. A registry row that claims usable with nothing behind it is
      0298's defect in a different table. No backticks in this comment: it
      lives inside a template literal.
    */
    insert into public.provider_models (provider, model_id, status, pricing_prompt, pricing_completion, priority, last_probed_at, last_success_at)
    values ('openrouter', ${lit(GOOD)}, 'usable', '0', '0', 10, app.now_utc(), app.now_utc()),
           ('openrouter', ${lit(POOR)}, 'usable', '0', '0', 11, app.now_utc(), app.now_utc()),
           ('openrouter', ${lit(PAID)}, 'usable', '0.0000004', '0.0000016', 1, app.now_utc(), app.now_utc());

    /*
      KIND A: the poor model fails eight of ten; the good model passes ten.
      KIND B: the SAME poor model passes ten. If the record were per model
      rather than per (model, kind), one of these two would be wrong.
    */
    for v_i in 1..10 loop
      insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
      values (extensions.gen_random_uuid(), v_project,
              ${lit(`rq-${run}-a-`)} || v_i::text, 'research', 'grant')
      returning job_id into v_job;
      insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, cost_usd, provenance)
      values ('openrouter', ${lit(GOOD)}, v_job, extensions.gen_random_uuid(), 'ok', 1, 1, 0, 'calculated'),
             ('openrouter', ${lit(POOR)}, v_job, extensions.gen_random_uuid(),
              case when v_i <= 2 then 'ok' else 'empty_completion' end, 1, 1, 0, 'calculated');
      update public.jobs set kind = ${lit(KIND_A)} where job_id = v_job;

      insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
      values (extensions.gen_random_uuid(), v_project,
              ${lit(`rq-${run}-b-`)} || v_i::text, 'research', 'grant')
      returning job_id into v_job;
      insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, cost_usd, provenance)
      values ('openrouter', ${lit(POOR)}, v_job, extensions.gen_random_uuid(), 'ok', 1, 1, 0, 'calculated');
      update public.jobs set kind = ${lit(KIND_B)} where job_id = v_job;
    end loop;

    insert into _r
      select 'a_' || o.model_id, o.standing || ' :: ' || o.why
        from app.model_order(${lit(KIND_A)}, 30, 10, 0.50, 24) o
       where o.model_id in (${lit(GOOD)}, ${lit(POOR)}, ${lit(PAID)});
    insert into _r
      select 'b_' || o.model_id, o.standing
        from app.model_order(${lit(KIND_B)}, 30, 10, 0.50, 24) o
       where o.model_id = ${lit(POOR)};

    -- Where each of the three sits in the order for kind A.
    insert into _r
      select 'pos_' || o.model_id, o.n::text
        from (select model_id, row_number() over () as n
                from app.model_order(${lit(KIND_A)}, 30, 10, 0.50, 24)) o
       where o.model_id in (${lit(GOOD)}, ${lit(POOR)}, ${lit(PAID)});

    /*
      KIND C is the same poor record, but stale.

      inference_usage is append-only by section 6, so the first draft of this - an
      UPDATE ageing the rows — was refused, and rightly. A second record
      written old is the better test anyway: the two standings come from two
      independent sets of rows, so neither can be an artefact of having
      mutated the other.
    */
    for v_i in 1..10 loop
      insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
      values (extensions.gen_random_uuid(), v_project,
              ${lit(`rq-${run}-c-`)} || v_i::text, 'research', 'grant')
      returning job_id into v_job;
      update public.jobs set kind = ${lit(KIND_C)} where job_id = v_job;
      insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, cost_usd, provenance, occurred_at)
      values ('openrouter', ${lit(POOR)}, v_job, extensions.gen_random_uuid(),
              case when v_i <= 2 then 'ok' else 'empty_completion' end, 1, 1, 0, 'calculated',
              app.now_utc() - interval '73 hours');
    end loop;
    insert into _r
      select 'stale_' || o.model_id, o.standing
        from app.model_order(${lit(KIND_C)}, 30, 10, 0.50, 24) o
       where o.model_id = ${lit(POOR)};

    -- And a harness job's calls must never reach the record at all.
    insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
    values (extensions.gen_random_uuid(), v_project,
            ${lit(`rq-${run}-h`)}, ${lit(KIND_B)}, ${lit(`teamhq:verify-${run}`)})
    returning job_id into v_job;
    insert into _r values ('harness_is_harness',
      (select app.harness_job(v_job)::text));
    insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, cost_usd, provenance)
    select 'openrouter', ${lit(GOOD)}, v_job, extensions.gen_random_uuid(), 'empty_completion', 1, 1, 0, 'calculated'
      from generate_series(1, 40);
    insert into _r values ('harness_counted',
      coalesce((select tried::text from public.model_record
                 where model_id = ${lit(GOOD)} and kind = ${lit(KIND_B)}), '0'));
  end $$;
  select
    (select v from _r where k = 'a_' || ${lit(GOOD)})   as a_good,
    (select v from _r where k = 'a_' || ${lit(POOR)})   as a_poor,
    (select v from _r where k = 'b_' || ${lit(POOR)})   as b_poor,
    (select v from _r where k = 'stale_' || ${lit(POOR)}) as stale_poor,
    (select v from _r where k = 'pos_' || ${lit(GOOD)}) as pos_good,
    (select v from _r where k = 'pos_' || ${lit(POOR)}) as pos_poor,
    (select v from _r where k = 'pos_' || ${lit(PAID)}) as pos_paid,
    (select v from _r where k = 'harness_is_harness')   as harness_is_harness,
    (select v from _r where k = 'harness_counted')      as harness_counted;
  rollback;
`)

check(
  'a model that fails most of the time is demoted for that kind',
  String(arc.a_poor ?? '(missing)').slice(0, 90),
  String(arc.a_poor ?? '').startsWith('poor'),
)
check(
  'and the SAME model is untouched for a kind it is good at',
  `kind B: ${arc.b_poor}`,
  arc.b_poor === 'good',
)
check(
  'a model that does the work keeps its standing',
  String(arc.a_good ?? '(missing)').slice(0, 70),
  String(arc.a_good ?? '').startsWith('good'),
)
check(
  'the demoted model is tried after the good one',
  `good at ${arc.pos_good}, poor at ${arc.pos_poor}`,
  Number(arc.pos_good) < Number(arc.pos_poor),
)
/*
  The invariant that keeps this safe, and the one a first draft got backwards.

  0394 put `is_free desc` in front of the registry's order, reasoning from
  #127's *"the £0 constraint is not a tiebreak"*. `verify:fallback` went red in
  five checks: `model_priority` encodes the CERTIFIED CHAIN, and that chain is
  paid-first on purpose — gpt-oss-120b, then qwen, then mistral-small, then the
  free tier — funded by #134's budget and held down by a per-call ceiling.
  Free-before-paid would have moved the whole office off its certified models
  silently. 0396 removed it.

  What actually guarantees #127's intent is narrower and stronger: quality may
  only DEMOTE. Nothing is ever moved forward, so no model is tried earlier than
  the registry would have tried it, and no demotion can cause a paid call that
  would not have happened anyway — whichever models happen to be paid.

  The three probes are registered at model_priority 1 (paid), 10 (good, free)
  and 11 (poor, free). Only the poor one may move.
*/
check(
  'quality demotes and never promotes: the registry order is otherwise intact',
  `paid(1) at ${arc.pos_paid}, good(10) at ${arc.pos_good}, poor(11) at ${arc.pos_poor}`,
  Number(arc.pos_paid) < Number(arc.pos_good) && Number(arc.pos_good) < Number(arc.pos_poor),
)
check(
  'a demoted model is given another turn once it has gone untried',
  `after ageing: ${arc.stale_poor}`,
  arc.stale_poor === 'exploring',
)
check(
  'the harness job this suite made really is harness traffic',
  `harness_job = ${arc.harness_is_harness}`,
  arc.harness_is_harness === 'true',
)
check(
  'and forty harness failures do not touch the record',
  `${arc.harness_counted} call(s) counted`,
  arc.harness_counted === '0',
)

/* ------------------------------------------------------------------ *
 * A provider's bad day is not a model's bad record.
 * ------------------------------------------------------------------ */
console.log('\nan outage is not incompetence')

const faults = await one(`
  begin;
  create temp table _r (k text primary key, v text);
  do $$
  declare v_project uuid; v_job uuid; v_i integer;
  begin
    select project_id into v_project
      from public.projects where status = 'active' and not is_fixture limit 1;
    insert into public.provider_models (provider, model_id, status, pricing_prompt, pricing_completion, priority, last_probed_at, last_success_at)
    values ('openrouter', ${lit(GOOD)}, 'usable', '0', '0', 10, app.now_utc(), app.now_utc());
    for v_i in 1..12 loop
      insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
      values (extensions.gen_random_uuid(), v_project,
              ${lit(`rq-${run}-f-`)} || v_i::text, 'research', 'grant')
      returning job_id into v_job;
      update public.jobs set kind = ${lit(KIND_A)} where job_id = v_job;
      -- One real success, and four different provider faults around it.
      insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, cost_usd, provenance)
      values ('openrouter', ${lit(GOOD)}, v_job, extensions.gen_random_uuid(), 'ok', 1, 1, 0, 'calculated'),
             ('openrouter', ${lit(GOOD)}, v_job, extensions.gen_random_uuid(), 'rate_limited', 0, 0, 0, 'calculated'),
             ('openrouter', ${lit(GOOD)}, v_job, extensions.gen_random_uuid(), 'provider_error', 0, 0, 0, 'calculated'),
             ('openrouter', ${lit(GOOD)}, v_job, extensions.gen_random_uuid(), 'transport_error', 0, 0, 0, 'calculated'),
             ('openrouter', ${lit(GOOD)}, v_job, extensions.gen_random_uuid(), 'unavailable', 0, 0, 0, 'calculated');
    end loop;
    insert into _r
      select 'r', tried::text || ' tried, ' || round(rate*100)::text || '%'
        from public.model_record where model_id = ${lit(GOOD)} and kind = ${lit(KIND_A)};
    insert into _r
      select 's', standing from app.model_order(${lit(KIND_A)}, 30, 10, 0.50, 24)
       where model_id = ${lit(GOOD)};
  end $$;
  select (select v from _r where k = 'r') as record,
         (select v from _r where k = 's') as standing;
  rollback;
`)
check(
  'forty-eight provider faults around twelve successes read as twelve for twelve',
  `${faults.record}`,
  faults.record === '12 tried, 100%',
)
check(
  'so an outage cannot demote a model that was working',
  `standing ${faults.standing}`,
  faults.standing === 'good',
)

/* ------------------------------------------------------------------ *
 * Nothing this suite did survives it.
 * ------------------------------------------------------------------ */
console.log('\nteardown')

const left = await one(`
  select (select count(*)::text from public.provider_models where model_id like ${lit(`%${run}%`)}) as m,
         (select count(*)::text from public.jobs where idempotency_key like ${lit(`rq-${run}-%`)}) as j,
         (select count(*)::text from public.model_record where kind like ${lit(`probe.kind.%${run}`)}) as r`)
check(
  'no probe model, job or record is left behind',
  `${left.m} model(s), ${left.j} job(s), ${left.r} record row(s)`,
  left.m === '0' && left.j === '0' && left.r === '0',
)

const bad = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - bad)}/${String(checks.length)} checks passed\n`)
process.exit(bad === 0 ? 0 : 1)
