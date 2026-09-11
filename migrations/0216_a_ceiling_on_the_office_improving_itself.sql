-- A ceiling on the office improving itself, enforced rather than hoped for.
--
-- Issue #53, ADR-0018. The hard constraint is ~£0/month on a free tier, and
-- reflection, noticing and proposing all cost tokens. A self-improvement loop
-- with no ceiling is a loop that can discover it should improve its own
-- noticing.
--
-- ## At dequeue, not in the handlers
--
-- The same argument every other central rule in this codebase makes: a check in
-- the caller is a check in ONE OF the callers, and a handler that forgets it is
-- a handler that spends. §11 says the tool router enforces permissions
-- centrally for exactly this reason. So a governed kind is simply not handed
-- out once the budget is spent, and no handler has to know the rule exists.
--
-- ## The ceiling exists before the loop does, on purpose
--
-- Three of the four kinds seeded below have no handler yet — they are #49's and
-- #52's, and they will arrive over the next few sessions. Writing the ceiling
-- afterwards means writing it under pressure, when something is already
-- spending, and it means every kind added in between is ungoverned by default.
-- A governed-by-default table that currently governs mostly-future work is the
-- cheap version of this, and it is the version where nobody has to remember.
--
-- ## What is deliberately NOT governed
--
-- `office.capacity_report` is the office reporting on its own spend, and it is
-- how Grant finds out a budget was hit. Starving it is the one thing that turns
-- a visible, recoverable state into a silent one.
--
-- `briefing.morning` likewise: it is the daily message he actually reads, and
-- an office that goes quiet because it thought too much is worse than one that
-- thinks a little less.

begin;

create table if not exists public.self_improvement_kinds (
  kind       text primary key,
  /** Why this counts as the office working on itself rather than on his work. */
  why        text not null check (length(btrim(why)) > 0),
  created_at timestamptz not null default app.now_utc()
);

comment on table public.self_improvement_kinds is
  'Job kinds that count against the self-improvement token budget (#53). '
  'Governed at dequeue, so a handler cannot forget the rule. Work FOR Grant is '
  'never in here — only the office working on itself.';

alter table public.self_improvement_kinds enable row level security;
alter table public.self_improvement_kinds force  row level security;
grant select on public.self_improvement_kinds to ai_team_app;
create policy self_improvement_kinds_app_read on public.self_improvement_kinds
  for select to ai_team_app using (true);

insert into public.self_improvement_kinds (kind, why) values
  ('office.notice',
   'Looking for what nobody asked about (#52). Useful, and the easiest thing '
   'in the office to run too often.'),
  ('office.reflect',
   'Reading its own past work to draw a lesson (#49). Costs a model call per '
   'pass and produces something advisory rather than something Grant asked for.'),
  ('office.propose',
   'Writing up a proposed improvement (#49). The output is a suggestion, so an '
   'expensive one that is declined has cost tokens for nothing.'),
  ('office.learn',
   'Turning an observation into a stored lesson or skill (#48, #50).')
on conflict (kind) do nothing;

-- ---------------------------------------------------------------------------
-- What it has spent on itself
-- ---------------------------------------------------------------------------
/*
  Tokens rather than pounds, deliberately.

  The models in use are free ones, so `cost_usd` is honestly zero and a budget
  denominated in money would never bind — it would look like a control and stop
  nothing. Tokens are what is actually rationed on a free tier, they are
  measured rather than modelled, and a ceiling in tokens binds on the day the
  free tier's own rate limit would otherwise bite instead.

  Fixtures excluded. A verification run that spent the office's daily thinking
  budget would be a test suite that breaks the thing it tests.
*/
create or replace function app.self_improvement_spent(p_hours integer default 24)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(u.prompt_tokens + u.completion_tokens), 0)::bigint
    from public.inference_usage u
    join public.jobs j on j.job_id = u.job_id
   where j.kind in (select kind from public.self_improvement_kinds)
     and not j.is_fixture
     and u.occurred_at > app.now_utc()
                         - (greatest(coalesce(p_hours, 24), 1) || ' hours')::interval
$$;

create or replace function app.self_improvement_budget()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (value #>> '{}')::bigint from public.system_config
      where key = 'jobs.self_improvement_tokens_per_day'),
    -- Roughly a dozen substantial passes a day. Chosen to be generous enough
    -- that ordinary reflection never notices it and small enough that a loop
    -- talking to itself hits it within an hour.
    200000)
$$;

create or replace function app.self_improvement_within_budget()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.self_improvement_spent(24) < app.self_improvement_budget()
$$;

comment on function app.self_improvement_within_budget() is
  'Whether the office may keep working on itself today. Read by '
  'app.dequeue_job, which is the only place it needs to be read (#53).';

/** The same thing in a shape a page or a briefing can print. */
create or replace function app.self_improvement_headroom()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'spent_tokens', app.self_improvement_spent(24),
    'budget_tokens', app.self_improvement_budget(),
    'left_tokens', greatest(app.self_improvement_budget() - app.self_improvement_spent(24), 0),
    'within_budget', app.self_improvement_within_budget(),
    'governed_kinds', (select coalesce(array_agg(kind order by kind), '{}')
                         from public.self_improvement_kinds),
    -- Named so a page can say WHEN it comes back rather than only that it is
    -- stopped. A ceiling with no stated end reads like a fault.
    'window', '24 hours, rolling'
  )
$$;

create or replace function public.self_improvement_headroom()
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.self_improvement_headroom() $$;

insert into public.system_config (key, value, description)
values ('jobs.self_improvement_tokens_per_day', '200000'::jsonb,
        'Tokens the office may spend in 24 hours on working on ITSELF — '
        'noticing, reflecting, proposing. Enforced at dequeue: the kinds in '
        'self_improvement_kinds wait until the rolling window moves. Work for '
        'Grant is never counted or blocked (#53).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Enforced where the work is handed out
--
-- Copied programmatically from 0147 with one clause and one variable added —
-- the discipline 0130 adopted after 0128, which existed because a long function
-- was retyped and two column names came back wrong.
-- ---------------------------------------------------------------------------
create or replace function app.dequeue_job(
  p_worker text,
  p_can_transcribe boolean default true,
  p_can_subprocess boolean default true,
  p_kinds text[] default null
)
  returns table (
    job_id          uuid,
    kind            text,
    correlation_id  uuid,
    project_id      uuid,
    idempotency_key text,
    attempt         integer,
    pinned_config   jsonb
  )
  language plpgsql
  set search_path = pg_catalog, app, public
as $$
declare
  v_limit       integer;
  v_active      integer;
  v_lease       integer;
  v_job_id      uuid;
  v_may_reflect boolean;
begin
  if p_worker is null or length(trim(p_worker)) = 0 then
    raise exception 'a worker identity is required to dequeue'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai_team_hq.job_dequeue'));

  v_limit := app.capacity_limit('max_concurrent_jobs', 3);

  select count(*) into v_active
  from public.jobs
  where state in (
    'running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying'
  );

  if v_active >= v_limit then
    return;
  end if;

  -- 0216: asked once per dequeue rather than once per candidate row. A
  -- stable function in a WHERE clause is not guaranteed to be hoisted, and
  -- the budget cannot change during a single call anyway.
  v_may_reflect := app.self_improvement_within_budget();

  select j.job_id into v_job_id
  from public.jobs j
  where j.state = 'queued'
    and j.attempt < j.max_attempts
    -- 0074: a delayed job is not a queued job yet.
    and (j.not_before is null or j.not_before <= now())
    -- 0125: an untranscribed voice note needs a worker that can hear. The Edge
    -- worker cannot — no subprocesses, no Python — and it reports that about
    -- itself at GET /functions/v1/worker. Tests the TRANSCRIPT rather than the
    -- audio, so a note already transcribed is ordinary work any worker may
    -- finish.
    and (
      p_can_transcribe
      or not exists (
        select 1 from public.inbound_commands c
         where c.job_id = j.job_id
           and c.voice_file_id is not null
           and coalesce(trim(c.transcript), '') = ''
      )
    )
    -- 0137: and the same argument for everything else that needs a local
    -- process. A kind not in the table runs anywhere.
    and (
      p_can_subprocess
      or not exists (
        select 1 from public.job_kind_needs n
         where n.kind = j.kind and n.needs_subprocess
      )
    )
    -- 0147: and the most obvious form of the same rule, which was missing.
    -- A worker that holds five handlers must not claim a job needing a sixth.
    -- Null means "everything", which is what every caller meant before this
    -- argument existed.
    and (p_kinds is null or j.kind = any(p_kinds))
    /*
      0216: and the office does not keep thinking about itself once today's
      budget is spent (#53, ADR-0018).

      Here rather than in the handlers because a check in the caller is a check
      in one of the callers. Work FOR Grant is untouched — only the kinds in
      `self_improvement_kinds` wait, and they wait rather than fail, so the
      queue drains itself when the rolling window moves.
    */
    and (
      v_may_reflect
      or not exists (
        select 1 from public.self_improvement_kinds s where s.kind = j.kind
      )
    )
  order by j.priority asc, j.created_at asc
  for update skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  v_lease := coalesce(
    (select value::text::integer from public.system_config where key = 'jobs.lease_seconds'),
    300
  );

  update public.jobs j
  set state        = 'running',
      leased_by    = p_worker,
      leased_until = now() + make_interval(secs => v_lease),
      attempt      = j.attempt + 1,
      state_reason = format('dequeued by %s', p_worker)
  where j.job_id = v_job_id;

  return query
    select j.job_id, j.kind, j.correlation_id, j.project_id,
           j.idempotency_key, j.attempt, j.pinned_config
    from public.jobs j
    where j.job_id = v_job_id;
end
$$;

comment on function app.dequeue_job(text, boolean, boolean, text[]) is
  'Capacity-limited dequeue, oldest highest-priority first, skipping jobs '
  'whose not_before has not arrived; when the caller says it cannot, '
  'untranscribed voice notes and anything needing a local subprocess; anything '
  'outside the kinds the caller handles; and, once today''s token budget is '
  'spent, anything in self_improvement_kinds (#53).';

grant execute on function app.dequeue_job(text, boolean, boolean, text[]) to ai_team_app, service_role;

commit;
