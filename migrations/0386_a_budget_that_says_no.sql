begin;

-- ---------------------------------------------------------------------------
-- 0386 - a budget that says no (#134)
--
-- Grant: *"The £0/month constraint is a hard one. The honest way to hold it is
-- a limit that says no, not a number that goes red after the money is gone."*
--
-- `usage_overview` reports spend and #15's ceiling caps self-improvement at
-- dequeue. What was missing is a per-agent, per-day budget with a real refusal,
-- and an office-wide one above it - because *"a per-agent budget with eight
-- agents is eight times the intended ceiling unless there is an office-wide one
-- above it."*
--
-- ## Three things the issue says matter more than the number
--
-- **A refusal must be visible.** *"A budget that silently defers work is
-- indistinguishable from an office that has quietly stopped - which is exactly
-- #112, where nine jobs sat queued for eight hours and nothing was red."* So a
-- job held back is not merely skipped by the dequeue predicate: it is MARKED,
-- with the sentence in `state_reason` and a `not_before` of tomorrow, and
-- `office_health` counts it separately. A skip leaves a job that looks queued;
-- a deferral says why.
--
-- **Deferral, not failure** (§18). Nothing broke. The office reached a limit it
-- was given, and `failed` would say something else.
--
-- **Free is still free.** Everything here is denominated in pence ACTUALLY
-- SPENT - `jobs.trace_pence` - so the free models the office runs on all day
-- count for nothing and the office never throttles itself over work that cost
-- nothing.
--
-- ## The numbers live in system_config
--
-- Not in this function. Grant's long-range goal outranks most others: *"I want
-- to reduce my dependence on Claude or another coding interface for maintaining
-- and extending the system."* A budget he cannot change without a deploy is a
-- budget only I can change.
-- ---------------------------------------------------------------------------

insert into public.system_config (key, value, description)
values ('budget.pence_per_agent_per_day', to_jsonb(60),
        'How many pence one agent may spend in a day before its queued work '
        'waits for tomorrow. Free-model work costs nothing and never counts.'),
       ('budget.pence_for_the_office_per_day', to_jsonb(200),
        'How many pence the whole office may spend in a day. Binds above the '
        'per-agent limit, because eight agents at their own limit is eight '
        'times the ceiling anybody intended.')
on conflict (key) do nothing;

create or replace function app.spent_today(p_agent text default null)
returns numeric
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(sum(j.trace_pence), 0)::numeric
    from public.jobs j
   where j.finished_at >= date_trunc('day', app.now_utc())
     and coalesce(j.trace_pence, 0) > 0
     and (p_agent is null or j.recipient_agent = p_agent)
     and not coalesce(app.harness_job(j.job_id), false)
$$;

comment on function app.spent_today(text) is
  'Pence actually spent today, by one agent or by the whole office (#134). '
  'Only rows with a real cost: free-model work is most of what this office '
  'does and must not throttle it. Harness traffic is excluded - a suite '
  'spending money is not the office spending money.';

/**
 * Why a job cannot start yet, or null if it can.
 *
 * Returns the SENTENCE rather than a boolean, because the sentence is the
 * feature: a deferral Grant cannot read is the silent stop the issue warns
 * about.
 */
create or replace function app.over_budget(p_agent text)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with lim as (
    select coalesce((select (value #>> '{}')::numeric from public.system_config
                      where key = 'budget.pence_per_agent_per_day'), 60) as per_agent,
           coalesce((select (value #>> '{}')::numeric from public.system_config
                      where key = 'budget.pence_for_the_office_per_day'), 200) as office
  )
  select case
    -- The office ceiling binds above the per-agent ones, and is checked first
    -- so its sentence is the one Grant sees when both are reached.
    when app.spent_today(null) >= lim.office then
      format('the office has spent %sp today, which is its daily limit of %sp',
             round(app.spent_today(null)), round(lim.office))
    when p_agent is not null and app.spent_today(p_agent) >= lim.per_agent then
      format('%s has spent %sp today, which is their daily limit of %sp',
             p_agent, round(app.spent_today(p_agent)), round(lim.per_agent))
    else null
  end
  from lim
$$;

/**
 * Hold back what cannot be afforded, and say so on the job.
 *
 * Called on the tick beside the duty dispatcher. Deliberately NOT part of the
 * dequeue predicate: a predicate that skips leaves a job looking queued, and
 * #112 is eight hours of exactly that.
 */
create or replace function app.defer_over_budget()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_held int := 0;
  v_row  record;
  v_why  text;
begin
  for v_row in
    select distinct j.recipient_agent as agent
      from public.jobs j
     where j.state = 'queued'
       and (j.not_before is null or j.not_before <= app.now_utc())
       and not coalesce(app.harness_job(j.job_id), false)
  loop
    v_why := app.over_budget(v_row.agent);
    continue when v_why is null;
    update public.jobs j
       set not_before = date_trunc('day', app.now_utc()) + interval '1 day',
           state_reason = v_why,
           updated_at = app.now_utc()
     where j.state = 'queued'
       and j.recipient_agent is not distinct from v_row.agent
       and (j.not_before is null or j.not_before <= app.now_utc())
       and not coalesce(app.harness_job(j.job_id), false);
    v_held := v_held + 1;
  end loop;
  return jsonb_build_object('agents_held', v_held);
end;
$$;

/**
 * What is waiting for tomorrow's budget rather than for the office.
 *
 * Its own reader so `office_health` can carry it as its own state, which is the
 * issue's requirement: deferred-for-budget must never be mistaken for a healthy
 * quiet day.
 */
create or replace function app.held_for_budget()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'jobs', count(*),
    'why', coalesce((array_agg(distinct j.state_reason))[1], null),
    'until', min(j.not_before))
    from public.jobs j
   where j.state = 'queued'
     and j.not_before > app.now_utc()
     and j.state_reason like '%daily limit%'
     and not coalesce(app.harness_job(j.job_id), false)
$$;

create or replace function public.held_for_budget()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.held_for_budget() $$;

revoke all on function public.held_for_budget() from public;
grant execute on function public.held_for_budget() to service_role;

commit;
