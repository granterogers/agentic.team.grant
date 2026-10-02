/**
 * A budget that says no (#134).
 *
 *   npm run verify:budget
 *
 * Grant: *"The £0/month constraint is a hard one. The honest way to hold it is
 * a limit that says no, not a number that goes red after the money is gone."*
 *
 * ## Why every check here needs a control
 *
 * The office spends nothing most days — it runs on free models — so every
 * assertion about a budget has a happy path of "found nothing", and CLAUDE.md
 * is blunt about what that is worth: *"When a check's happy path is 'found
 * nothing', assert first that the thing it searches is non-empty."* So the
 * limit is set to zero inside a transaction, a real job is put in front of it,
 * and the refusal is observed rather than assumed.
 *
 * Everything runs inside `begin … rollback`. Lowering Grant's real budget to
 * zero is the most destructive thing in this file and it lasts for the length
 * of one statement.
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
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const rolled = async (sql: string): Promise<Record<string, unknown>> =>
  await one(`begin; ${sql} rollback;`)

console.log('#134 — a budget that refuses, rather than a number that goes red\n')

const project = await one(`
  select project_id::text as id from public.projects
   where status = 'active' and not is_fixture order by created_at limit 1`)

/** A job that looks like real work, created and abandoned in one transaction. */
const REAL_JOB = `
  insert into public.jobs (project_id, correlation_id, kind, state, requested_by,
                           recipient_agent, priority, idempotency_key)
  values ('${String(project.id)}'::uuid, gen_random_uuid(), 'office.instruction', 'queued',
          'teamhq:grant', 'research-director', 5, 'budget-suite-' || gen_random_uuid()::text);`

{
  const r = await rolled(`${REAL_JOB}
    update public.system_config set value = to_jsonb(0)
     where key = 'budget.pence_for_the_office_per_day';
    insert into public.jobs (project_id, correlation_id, kind, state, requested_by,
                             recipient_agent, finished_at, trace_pence, idempotency_key)
    values ('${String(project.id)}'::uuid, gen_random_uuid(), 'office.instruction', 'complete',
            'teamhq:grant', 'research-director', app.now_utc(), 5,
            'budget-spent-' || gen_random_uuid()::text);
    select coalesce(app.over_budget('research-director'), '(under)') as r;`)
  check(
    'over the office limit, the answer is a sentence and not a boolean',
    String(r.r),
    String(r.r).includes('daily limit') && String(r.r).includes('office'),
  )
}

{
  const r = await rolled(`${REAL_JOB}
    update public.system_config set value = to_jsonb(1)
     where key = 'budget.pence_per_agent_per_day';
    insert into public.jobs (project_id, correlation_id, kind, state, requested_by,
                             recipient_agent, finished_at, trace_pence, idempotency_key)
    values ('${String(project.id)}'::uuid, gen_random_uuid(), 'office.instruction', 'complete',
            'teamhq:grant', 'research-director', app.now_utc(), 9,
            'budget-spent-' || gen_random_uuid()::text);
    select coalesce(app.over_budget('research-director'), '(under)') as r;`)
  check(
    'and the per-agent limit names the agent',
    String(r.r),
    String(r.r).includes('research-director') && String(r.r).includes('daily limit'),
  )
}

{
  const r = await rolled(`${REAL_JOB}
    update public.system_config set value = to_jsonb(0)
     where key = 'budget.pence_for_the_office_per_day';
    insert into public.jobs (project_id, correlation_id, kind, state, requested_by,
                             recipient_agent, finished_at, trace_pence, idempotency_key)
    values ('${String(project.id)}'::uuid, gen_random_uuid(), 'office.instruction', 'complete',
            'teamhq:grant', 'research-director', app.now_utc(), 5,
            'budget-spent-' || gen_random_uuid()::text);
    select app.defer_over_budget();
    select (app.held_for_budget(app.operator_office()))::text as r;`)
  const held = JSON.parse(String(r.r ?? '{}')) as { jobs?: number; why?: string; until?: string }
  check(
    'the queued work is HELD, with the reason on it',
    `${String(held.jobs)} job(s): ${String(held.why).slice(0, 60)}`,
    (held.jobs ?? 0) > 0 && String(held.why).includes('daily limit'),
  )
  check(
    'and it says when it lifts, rather than just stopping',
    String(held.until ?? '(never)'),
    typeof held.until === 'string' && held.until !== '',
  )
}

{
  const r = await rolled(`${REAL_JOB}
    update public.system_config set value = to_jsonb(0)
     where key = 'budget.pence_for_the_office_per_day';
    insert into public.jobs (project_id, correlation_id, kind, state, requested_by,
                             recipient_agent, finished_at, trace_pence, idempotency_key)
    values ('${String(project.id)}'::uuid, gen_random_uuid(), 'office.instruction', 'complete',
            'teamhq:grant', 'research-director', app.now_utc(), 5,
            'budget-spent-' || gen_random_uuid()::text);
    select app.defer_over_budget();
    select ((app.office_health(app.operator_office(), 24))->'held_for_budget')::text as r;`)
  const line = JSON.parse(String(r.r ?? '{}')) as { jobs?: number }
  check(
    'office_health carries it as its own state, not as stalled',
    `held_for_budget.jobs = ${String(line.jobs)}`,
    (line.jobs ?? 0) > 0,
  )
}

{
  /*
    The control that matters most on a free tier.

    Nearly everything this office does costs nothing. A budget that counted
    free work would throttle the office over money it never spent, which is
    worse than having no budget at all.
  */
  const r = await rolled(`${REAL_JOB}
    update public.system_config set value = to_jsonb(1)
     where key = 'budget.pence_for_the_office_per_day';
    insert into public.jobs (project_id, correlation_id, kind, state, requested_by,
                             recipient_agent, finished_at, trace_pence, idempotency_key)
    select '${String(project.id)}'::uuid, gen_random_uuid(), 'office.instruction', 'complete',
           'teamhq:grant', 'research-director', app.now_utc(), 0,
           'budget-free-' || g::text || '-' || gen_random_uuid()::text
      from generate_series(1, 40) g;
    select coalesce(app.over_budget('research-director'), '(under)') as r;`)
  check('CONTROL: forty free jobs do not touch the budget', String(r.r), String(r.r) === '(under)')
}

{
  /*
    A limit of ONE, not zero.

    The first draft set it to zero and the check went red saying "the office has
    spent 0p today, which is its daily limit of 0p" — which is the product being
    right: the harness's 900p WAS excluded, and zero is still not under zero. A
    control that cannot distinguish "excluded" from "over the limit" is not a
    control.
  */
  const r = await rolled(`
    update public.system_config set value = to_jsonb(1)
     where key = 'budget.pence_for_the_office_per_day';
    insert into public.jobs (project_id, correlation_id, kind, state, requested_by,
                             recipient_agent, finished_at, trace_pence, idempotency_key)
    values ('${String(project.id)}'::uuid, gen_random_uuid(), 'office.instruction', 'complete',
            'verify:budget-probe', 'research-director', app.now_utc(), 900,
            'budget-harness-' || gen_random_uuid()::text);
    select coalesce(app.over_budget('research-director'), '(under)') as r;`)
  check(
    'CONTROL: a suite spending money is not the office spending money',
    String(r.r),
    String(r.r) === '(under)',
  )
}

{
  const now = await one(`
    select (select (value #>> '{}') from public.system_config
             where key = 'budget.pence_for_the_office_per_day') || ' / ' ||
           (select (value #>> '{}') from public.system_config
             where key = 'budget.pence_per_agent_per_day') as r`)
  check(
    'and the real budgets are exactly as they were found',
    `office ${String(now.r)}`,
    String(now.r) === '200 / 60',
  )
}

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
process.exit(passed === checks.length ? 0 : 1)
