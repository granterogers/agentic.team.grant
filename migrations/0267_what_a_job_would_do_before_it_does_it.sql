-- 0267 — what a job would do, before it does it
--
-- Issue #131. Approvals gate WHETHER an action may happen. Nothing showed WHAT
-- it would do. An agent proposing to write six pages into Notion, or to change
-- eleven calendar events, asked a yes/no question about an action Grant could
-- not see.
--
-- **Approving something you cannot see is not an approval. It is consent to a
-- category.**
--
-- ## The plan is recorded, not just computed
--
-- A dry run that only exists inside one function call is a dry run nobody can
-- put in front of a person. This is the row that an approval request, a
-- say-back (#60) and the job trace (#115) can all read — one place, so the
-- three cannot describe the same action differently.
--
-- ## One per job, replaced rather than appended
--
-- A job is retried; §6's append-only rule is about the LEDGER of what happened,
-- and `job_state_transitions` and `job_traces` carry that. This is the current
-- intention of a job that has not acted yet. A second attempt re-plans against
-- a world that has moved, and keeping both would mean an approval screen
-- showing two answers with no way to tell which is live.
--
-- ## Why `writes` is stored separately from the steps
--
-- A step is one outward EFFECT -- one page created, one event changed -- and a
-- single effect can cost several HTTP calls. `verify:dryrun` holds the two
-- against each other: a handler whose execution makes more outward calls than
-- its plan accounted for is a handler whose plan is not describing the work,
-- and that is the drift #131 is written against. A count that lived only in the
-- TypeScript could not be checked from anywhere else.

begin;

create table public.job_plans (
  job_id        uuid        primary key references public.jobs (job_id) on delete cascade,

  -- The `tool_permissions` row the work needs. Recorded rather than derived, so
  -- an approval can say what reach it is granting without re-deriving it from
  -- the job kind — which is the derivation that goes wrong when a handler grows
  -- a second effect.
  tool          text        not null,
  -- Services it touches outside the office. Empty for a plan that does nothing.
  reaches       text[]      not null default array[]::text[],

  -- The steps, each {verb, what, where, writes}. Shape validated below rather
  -- than trusted: a malformed plan is worse than none, because the approval
  -- screen renders it as though it were true.
  steps         jsonb       not null,
  -- The sentence a person reads. Written by the planner, in its own words.
  summary       text        not null,
  -- What carrying it out should cost in outward HTTP calls.
  planned_writes int        not null default 0,

  planned_at    timestamptz not null default app.now_utc(),

  constraint job_plans_tool_format
    check (tool ~ '^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)*$'),
  constraint job_plans_steps_is_an_array
    check (jsonb_typeof(steps) = 'array'),
  constraint job_plans_writes_not_negative
    check (planned_writes >= 0),
  -- A plan with steps and no summary is a plan nobody can be shown.
  constraint job_plans_summary_present
    check (length(trim(summary)) > 0)
);

comment on table public.job_plans is
  '#131. What a job would change outside the office, recorded before it acts, '
  'so an approval shows the action rather than the category. One row per job, '
  'replaced on a retry: this is the current intention, not the ledger.';

create index job_plans_by_tool on public.job_plans (tool, planned_at desc);

/**
 * Record what a job intends to do.
 *
 * Every step is checked before anything is stored. A plan half-written is
 * exactly the shape that makes an approval screen lie, so a single malformed
 * step refuses the whole thing — the same reasoning as
 * `hq_dashboard_layout_set`, where a half-saved layout is worse than an
 * unsaved one.
 */
create or replace function app.job_plan_set(
  p_job_id uuid,
  p_tool text,
  p_reaches text[],
  p_steps jsonb,
  p_summary text,
  p_writes int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_bad int;
begin
  if jsonb_typeof(p_steps) <> 'array' then
    return jsonb_build_object('error', 'steps must be an array');
  end if;

  -- `coalesce(..., 'missing')`, because `jsonb_typeof(e -> 'k')` is NULL when
  -- the key is ABSENT and a NULL comparison is dropped by the where clause --
  -- so a step missing a field entirely would pass a naive check. Migration
  -- 0251 learned this the hard way on the dashboard layout.
  select count(*) into v_bad
    from jsonb_array_elements(p_steps) e
   where coalesce(jsonb_typeof(e), 'missing') <> 'object'
      or coalesce(e ->> 'verb', '') not in ('create', 'update', 'remove', 'send')
      or coalesce(jsonb_typeof(e -> 'what'), 'missing') <> 'string'
      or coalesce(jsonb_typeof(e -> 'where'), 'missing') <> 'string'
      or coalesce(jsonb_typeof(e -> 'writes'), 'missing') <> 'number';
  if v_bad > 0 then
    return jsonb_build_object('error',
      format('%s step(s) are not {verb, what, where, writes} -- nothing was recorded', v_bad));
  end if;

  insert into public.job_plans
    (job_id, tool, reaches, steps, summary, planned_writes, planned_at)
  values (p_job_id, p_tool, coalesce(p_reaches, array[]::text[]), p_steps,
          p_summary, greatest(coalesce(p_writes, 0), 0), app.now_utc())
  on conflict (job_id) do update
    set tool = excluded.tool, reaches = excluded.reaches, steps = excluded.steps,
        summary = excluded.summary, planned_writes = excluded.planned_writes,
        planned_at = excluded.planned_at;

  return jsonb_build_object('ok', true, 'steps', jsonb_array_length(p_steps));
end;
$$;

/** What a job intends, for an approval screen or a say-back. */
create or replace function app.job_plan(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
              'tool', p.tool, 'reaches', to_jsonb(p.reaches), 'steps', p.steps,
              'summary', p.summary, 'writes', p.planned_writes,
              'at', p.planned_at)
       from public.job_plans p where p.job_id = p_job_id),
    jsonb_build_object('none', true))
$$;

-- PostgREST only exposes `public`.
create or replace function public.hq_job_plan(p_job_id text)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.job_plan(p_job_id::uuid) $$;

create or replace function public.job_plan_set(
  p_job_id uuid, p_tool text, p_reaches text[], p_steps jsonb, p_summary text, p_writes int)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.job_plan_set(p_job_id, p_tool, p_reaches, p_steps, p_summary, p_writes) $$;

alter table public.job_plans enable row level security;
alter table public.job_plans force  row level security;
grant select on public.job_plans to ai_team_app;
create policy job_plans_app_read on public.job_plans
  for select to ai_team_app using (true);
grant execute on function app.job_plan_set(uuid, text, text[], jsonb, text, int) to ai_team_app;
grant execute on function app.job_plan(uuid) to ai_team_app;

commit;
