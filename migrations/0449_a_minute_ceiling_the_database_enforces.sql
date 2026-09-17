-- Reopening GitHub Actions on demand, under a ceiling (#17).
--
-- ## What actually happened
--
-- 1,800 of 2,000 free minutes in one month went to a five-minute cron, and
-- Grant's instruction was *"stop using github actions completely please, find
-- another way to do thing... for any process."* Every schedule and push
-- trigger was removed on 2026-09-08 and `workflow_dispatch` was kept.
--
-- He has now agreed to reopen it for on-demand runs only, with a monthly
-- ceiling **enforced in the database**. This is that ceiling.
--
-- ## Why a reservation, and not a running total
--
-- A total counted when a run FINISHES cannot stop ten dispatches in the same
-- minute: each asks "how much has been spent" while the other nine are still
-- running, and every one of them is told yes. So a dispatch RESERVES the
-- minutes it expects before the run starts, the reservation counts against the
-- ceiling immediately, and the real figure replaces it when the run reports.
--
-- That is the whole safety property and it is why the gate cannot be a view.
--
-- ## Why the run reports its own minutes
--
-- Reading what GitHub actually billed needs `actions:read`, and the only
-- credential this office holds is `github.dispatch_token`, which carries
-- contents and nothing else -- probed, not assumed: the repo endpoint answers
-- 200 and every `/actions/` endpoint answers 403.
--
-- Asking Grant to widen a PAT would be an avoidable request for manual
-- configuration (§31), and it is not needed: the runner already holds
-- `SUPABASE_ACCESS_TOKEN`, so the job posts its own elapsed time at the end.
-- That is MORE accurate than the API would be, because GitHub bills per JOB
-- rounded up to the minute, and only the job knows when it started.
--
-- A run that is cancelled or dies reports nothing, so a reservation that is
-- never settled EXPIRES rather than holding minutes for ever -- and it expires
-- into the spend, not out of it, because a cancelled run still cost whatever
-- it had used. The cheap direction is over-counting.
--
-- ## The ceiling is below the real one, deliberately
--
-- GitHub gives 2,000 free minutes a month on a private repository. The default
-- here is 1,500. The incident was not "we went slightly over"; it was that
-- nobody was counting, and a ceiling with no margin tells you at the moment it
-- is too late.

create table if not exists public.ci_workflows (
  workflow text primary key check (workflow ~ '^[a-z][a-z0-9-]{1,40}$'),
  purpose text not null check (length(trim(purpose)) >= 12),
  /*
    What a run of this costs, as minutes, for the reservation. Not a guess kept
    in TypeScript: Grant can change it, and every report the runner sends
    refines it (see app.ci_report).
  */
  expected_minutes numeric not null default 5 check (expected_minutes > 0),
  /** Highest a single run of this may reserve, however the estimate drifts. */
  cap_minutes numeric not null default 30 check (cap_minutes > 0),
  enabled boolean not null default true,
  disabled_reason text not null default '',
  created_at timestamptz not null default app.now_utc(),
  updated_at timestamptz not null default app.now_utc(),
  constraint ci_workflow_estimate_under_cap check (expected_minutes <= cap_minutes),
  constraint ci_disabled_says_why check (enabled or length(trim(disabled_reason)) > 0)
);

comment on table public.ci_workflows is
  'Which workflows the office may run on demand, and what each is expected to '
  'cost. A workflow absent from this table cannot be dispatched at all.';

create table if not exists public.ci_runs (
  ci_run_id uuid primary key default gen_random_uuid(),
  workflow text not null references public.ci_workflows(workflow),
  /** What the office told GitHub. Matches repository_dispatch event_type. */
  event_type text not null,
  requested_by text not null default 'grant',
  job_id uuid references public.jobs(job_id),
  reason text not null default '',
  reserved_minutes numeric not null check (reserved_minutes > 0),
  /** What the run said it actually cost. Null until it reports. */
  actual_minutes numeric check (actual_minutes >= 0),
  jobs_reported integer not null default 0 check (jobs_reported >= 0),
  dispatched_at timestamptz not null default app.now_utc(),
  /** After this, an unsettled reservation is treated as spent and closed. */
  expires_at timestamptz not null,
  settled_at timestamptz,
  outcome text check (outcome in ('reported', 'expired', 'refused_by_github')),
  detail text not null default ''
);

comment on table public.ci_runs is
  'Every dispatch, what it reserved, and what it actually cost. The reservation '
  'is what makes the ceiling hold under concurrency; the actual figure is '
  'posted by the run itself, because the office holds no actions:read scope.';

create index if not exists ci_runs_month on public.ci_runs (dispatched_at desc);
create index if not exists ci_runs_open on public.ci_runs (expires_at)
  where settled_at is null;

/*
  Minutes charged to the current month.

  An open reservation counts at its RESERVED figure and a settled run at what it
  actually cost. Written once, here, so the gate and the reader cannot disagree
  -- 0355's lesson about two independent queries to one definition.
*/
create or replace function app.ci_spent_this_month()
returns numeric
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(sum(
           case when r.settled_at is null then r.reserved_minutes
                else coalesce(r.actual_minutes, r.reserved_minutes) end), 0)::numeric
    from public.ci_runs r
   where r.dispatched_at >= date_trunc('month', app.now_utc());
$fn$;

create or replace function app.ci_budget()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  with cap as (
    select coalesce((select nullif(value #>> '{}', '')::numeric
                       from public.system_config where key = 'ci.monthly_minutes'),
                    1500)::numeric as minutes
  ), spent as (
    select app.ci_spent_this_month() as used,
           (select count(*)::int from public.ci_runs
             where settled_at is null and expires_at > app.now_utc()) as in_flight,
           (select count(*)::int from public.ci_runs
             where dispatched_at >= date_trunc('month', app.now_utc())) as runs
  )
  select jsonb_build_object(
    'cap_minutes', round(cap.minutes, 1),
    'used_minutes', round(spent.used, 1),
    'left_minutes', round(greatest(cap.minutes - spent.used, 0), 1),
    'in_flight', spent.in_flight,
    'runs_this_month', spent.runs,
    'exhausted', spent.used >= cap.minutes,
    /*
      Named so nobody reads this as GitHub's own figure. It is what the office
      believes, which is the reservation until a run says otherwise.
    */
    'source', 'the office''s own ledger, not GitHub''s billing page'
  ) from cap, spent;
$fn$;

/**
 * May this workflow run right now, and what would it reserve?
 *
 * Answers rather than raises, because the caller is a handler that has to tell
 * Grant why not. A refusal names the ceiling and what is left.
 */
create or replace function app.ci_may_run(p_workflow text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  w public.ci_workflows%rowtype;
  v_cap numeric;
  v_used numeric;
  v_want numeric;
begin
  select * into w from public.ci_workflows where workflow = p_workflow;
  if not found then
    return jsonb_build_object('may', false, 'why',
      format('%L is not a workflow the office may run. The ones it may are listed '
             'in ci_workflows.', p_workflow));
  end if;
  if not w.enabled then
    return jsonb_build_object('may', false, 'why',
      format('%s is switched off: %s', p_workflow, w.disabled_reason));
  end if;

  v_cap := coalesce((select nullif(value #>> '{}', '')::numeric
                       from public.system_config where key = 'ci.monthly_minutes'), 1500);
  v_used := app.ci_spent_this_month();
  v_want := least(w.expected_minutes, w.cap_minutes);

  if v_used + v_want > v_cap then
    return jsonb_build_object('may', false, 'reserve', v_want, 'why',
      format('that would take this month past %s CI minutes — %s are already '
             'committed and this run expects %s. It resets on the first of next month.',
             round(v_cap, 0), round(v_used, 1), round(v_want, 1)));
  end if;

  return jsonb_build_object('may', true, 'reserve', v_want,
    'left_after', round(v_cap - v_used - v_want, 1));
end;
$fn$;

/**
 * Take the reservation. The only door to a dispatch.
 *
 * Re-checks the ceiling inside the same statement that writes the row, so two
 * concurrent dispatches cannot both read "there is room" and both take it.
 */
create or replace function app.ci_reserve(
  p_workflow text, p_event_type text, p_reason text, p_by text, p_job uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_verdict jsonb;
  v_id uuid;
  v_minutes numeric;
begin
  -- Serialises dispatches against each other without locking anything else.
  perform pg_advisory_xact_lock(hashtext('app.ci_reserve'));

  v_verdict := app.ci_may_run(p_workflow);
  if (v_verdict ->> 'may') is distinct from 'true' then
    return v_verdict;
  end if;
  v_minutes := (v_verdict ->> 'reserve')::numeric;

  insert into public.ci_runs
    (workflow, event_type, requested_by, job_id, reason, reserved_minutes, expires_at)
  values (p_workflow, p_event_type,
          coalesce(nullif(trim(coalesce(p_by, '')), ''), 'grant'), p_job,
          left(coalesce(p_reason, ''), 400), v_minutes,
          app.now_utc() + interval '6 hours')
  returning ci_run_id into v_id;

  return jsonb_build_object('may', true, 'ci_run_id', v_id, 'reserved', v_minutes);
end;
$fn$;

/**
 * The run says what it cost. Called BY the workflow, from inside the runner.
 *
 * Additive across jobs, because GitHub bills per job rounded up to the minute
 * and a workflow has several. The run settles when it reports; a later job
 * reporting after that adds to the same row rather than being refused, so the
 * order jobs finish in cannot lose a minute.
 */
create or replace function app.ci_report(p_ci_run uuid, p_minutes numeric, p_detail text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_total numeric;
  v_jobs int;
begin
  if p_minutes is null or p_minutes < 0 then
    return jsonb_build_object('error', 'a run cannot have cost less than nothing');
  end if;
  update public.ci_runs
     set actual_minutes = coalesce(actual_minutes, 0) + ceil(p_minutes),
         jobs_reported = jobs_reported + 1,
         settled_at = app.now_utc(),
         outcome = 'reported',
         detail = left(coalesce(nullif(trim(coalesce(p_detail, '')), ''), detail), 400)
   where ci_run_id = p_ci_run
  returning actual_minutes, jobs_reported into v_total, v_jobs;

  if not found then
    return jsonb_build_object('error', 'there is no dispatch by that id');
  end if;
  return jsonb_build_object('ok', true, 'total_minutes', v_total, 'jobs_reported', v_jobs);
end;
$fn$;

/**
 * Close reservations nothing ever reported against.
 *
 * They settle as SPENT at the reserved figure, not released: a run that was
 * cancelled or crashed still consumed whatever it had used, and 0304's rule
 * says take the direction that cannot hide a cost.
 */
create or replace function app.ci_expire_stale()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_n int;
begin
  update public.ci_runs
     set settled_at = app.now_utc(), outcome = 'expired',
         detail = case when detail = '' then
           'it never reported — counted at what it reserved, because a run that '
           'died still cost something' else detail end
   where settled_at is null and expires_at <= app.now_utc();
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'expired', v_n);
end;
$fn$;

create or replace function app.ci_lately(p_limit int default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(jsonb_agg(x.v order by x.ord), '[]'::jsonb) from (
    select row_number() over (order by r.dispatched_at desc) as ord,
           jsonb_build_object(
             'workflow', r.workflow, 'at', r.dispatched_at, 'by', r.requested_by,
             'reason', r.reason, 'reserved', r.reserved_minutes,
             'actual', r.actual_minutes, 'outcome',
             coalesce(r.outcome, 'running'), 'detail', r.detail) as v
      from public.ci_runs r
     order by r.dispatched_at desc
     limit greatest(coalesce(p_limit, 20), 1)
  ) x;
$fn$;

insert into public.system_config (key, value, description)
values ('ci.monthly_minutes', to_jsonb(1500),
        'The office refuses to dispatch a workflow past this many GitHub Actions '
        'minutes in a calendar month. GitHub gives 2,000 free on a private '
        'repository; the margin is deliberate, because the 2026-09 incident was '
        'nobody counting rather than a small overshoot.')
on conflict (key) do nothing;
