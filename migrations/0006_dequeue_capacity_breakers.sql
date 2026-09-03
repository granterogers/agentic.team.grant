-- 0006 — Dequeue, capacity enforcement, circuit breakers, recovery sweep
--
-- The four §6 mechanisms that make the queue survive a restart:
--
--   * capacity limits enforced AT DEQUEUE, "so they hold across restarts and
--     across all channels at once"
--   * SELECT ... FOR UPDATE SKIP LOCKED dequeue
--   * per-provider circuit breakers, "state in the database"
--   * a boot recovery sweep reconciling jobs left in transient states
--
-- All four live in the database rather than in a worker, because a worker is
-- the thing that dies.

-- ---------------------------------------------------------------------------
-- Capacity defaults (§17, deliberately conservative)
-- ---------------------------------------------------------------------------
insert into public.system_config (key, value, description, self_adjustable) values
  ('jobs.capacity',
   '{"max_concurrent_jobs": 3, "max_consultations_per_job": 3,
     "max_investigations_per_project_per_day": 5, "max_direct_alerts_per_agent_per_day": 3}'::jsonb,
   'V1 autonomy capacity limits (§17). Enforced at dequeue, not at enqueue.',
   false),
  ('jobs.lease_seconds',
   '300'::jsonb,
   'How long a dequeued job stays leased before the recovery sweep may reclaim it.',
   false),
  ('providers.breaker',
   '{"failure_threshold": 5, "cooldown_seconds": 60, "max_cooldown_seconds": 3600}'::jsonb,
   'Circuit-breaker thresholds. Cooldown backs off exponentially to the maximum.',
   false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Reading capacity
-- ---------------------------------------------------------------------------
create or replace function app.capacity_limit(p_name text, p_default integer)
  returns integer
  language sql
  stable
  set search_path = pg_catalog, public
as $$
  select coalesce(
    (select (value ->> p_name)::integer from public.system_config where key = 'jobs.capacity'),
    p_default
  )
$$;

-- ---------------------------------------------------------------------------
-- Dequeue
--
-- SKIP LOCKED alone is NOT enough to enforce a concurrency limit, and this is
-- the subtle part. It guarantees two workers never take the SAME job. It says
-- nothing about two workers each independently reading "2 running, limit 3" and
-- each taking a DIFFERENT job — which yields 4 running and a limit that holds
-- only under low load, i.e. exactly when it does not matter.
--
-- So the capacity decision is serialised with a transaction-scoped advisory
-- lock. Dequeue is a few milliseconds, so serialising it costs almost nothing;
-- the work itself remains fully concurrent. The lock is released automatically
-- when the transaction ends, including when the worker dies mid-dequeue.
-- ---------------------------------------------------------------------------
create or replace function app.dequeue_job(p_worker text)
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
  v_limit   integer;
  v_active  integer;
  v_lease   integer;
  v_job_id  uuid;
begin
  if p_worker is null or length(trim(p_worker)) = 0 then
    raise exception 'a worker identity is required to dequeue'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai_team_hq.job_dequeue'));

  v_limit := app.capacity_limit('max_concurrent_jobs', 3);

  -- Everything a worker is holding counts against capacity — not just
  -- `running`. A job sitting in `quality_review` or `notifying` is occupying a
  -- slot just as surely, and counting only `running` would let the limit be
  -- exceeded by jobs that had merely progressed.
  select count(*) into v_active
  from public.jobs
  where state in (
    'running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying'
  );

  if v_active >= v_limit then
    return;
  end if;

  select j.job_id into v_job_id
  from public.jobs j
  where j.state = 'queued'
    -- A job that has exhausted its attempts must not be handed out again: the
    -- attempt increment below would violate jobs_attempt_within_max. The
    -- recovery sweep fails such jobs explicitly.
    and j.attempt < j.max_attempts
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

comment on function app.dequeue_job(text) is
  'Capacity-limited dequeue. The advisory lock is load-bearing: SKIP LOCKED '
  'stops two workers taking the same job but not two workers each taking a '
  'different job past the limit.';

-- ---------------------------------------------------------------------------
-- Boot recovery sweep (§6)
--
-- "This sweep is the difference between a system that survives a restart and
-- one that merely claims to."
--
-- Only jobs whose LEASE HAS EXPIRED are reclaimed. A live worker holding a
-- valid lease is left alone, so running the sweep while workers are active is
-- safe — which matters, because it runs on every boot and boots overlap.
-- ---------------------------------------------------------------------------
create or replace function app.recover_stalled_jobs()
  returns table (
    job_id     uuid,
    from_state public.job_state,
    to_state   public.job_state,
    reason     text
  )
  language plpgsql
  set search_path = pg_catalog, app, public
as $$
declare
  r record;
  v_to public.job_state;
  v_reason text;
begin
  for r in
    select j.job_id, j.state, j.attempt, j.max_attempts, j.leased_by
    from public.jobs j
    where j.state in (
      'running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying'
    )
      and (j.leased_until is null or j.leased_until < now())
    order by j.created_at
    for update
  loop
    if r.state = 'committed' then
      -- The §18 case: crashed after commit, before notification. The work is
      -- DURABLE — nothing to redo — so this resumes delivery rather than
      -- retrying the job. Retrying here would redo committed work; treating it
      -- as finished would mean Grant is never told. Both are wrong, and nine
      -- states could express neither.
      v_to := 'notifying';
      v_reason := 'recovery: committed work with delivery outstanding';

    elsif r.attempt >= r.max_attempts then
      v_to := 'failed';
      v_reason := format(
        'recovery: %s attempts exhausted while in %s', r.max_attempts, r.state
      );

    else
      v_to := 'retrying';
      v_reason := format(
        'recovery: worker %s died holding this in %s',
        coalesce(r.leased_by, '(unleased)'), r.state
      );
    end if;

    update public.jobs j
    set state        = v_to,
        state_reason = v_reason,
        leased_by    = null,
        leased_until = null
    where j.job_id = r.job_id;

    return query select r.job_id, r.state, v_to, v_reason;
  end loop;
end
$$;

comment on function app.recover_stalled_jobs() is
  'Reconciles jobs a dead worker left in flight. Only touches expired leases, '
  'so it is safe to run while workers are active. `committed` resumes delivery '
  'rather than retrying, because that work is already durable (§18).';

-- ---------------------------------------------------------------------------
-- Requeue
--
-- Retry re-enters the QUEUE rather than jumping to `running`, so capacity is
-- re-applied at dequeue. Separating this from the sweep keeps scheduling
-- separate from execution (§6).
-- ---------------------------------------------------------------------------
create or replace function app.requeue_retrying()
  returns integer
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  with moved as (
    update public.jobs j
    set state = 'queued', state_reason = 'requeued after retry'
    where j.state = 'retrying'
      and j.attempt < j.max_attempts
    returning 1
  )
  select count(*) into v_count from moved;
  return v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- Per-provider circuit breakers, state in the database (§6)
--
-- In the database rather than in worker memory for two reasons: a restart must
-- not forget that a provider is down, and every worker must see the same
-- breaker rather than each learning the hard way.
-- ---------------------------------------------------------------------------
create type public.breaker_state as enum ('closed', 'open', 'half_open');

create table public.provider_health (
  provider             text                  primary key,
  state                public.breaker_state  not null default 'closed',
  consecutive_failures integer               not null default 0,
  opened_at            timestamptz,
  next_probe_at        timestamptz,
  cooldown_seconds     integer               not null default 60,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  -- Truncated on write. §15: secrets must never reach stored error traces, and
  -- provider errors are a classic place for a token to appear in a URL.
  last_error           text,
  updated_at           timestamptz           not null default app.now_utc(),

  constraint provider_health_provider_format
    check (provider ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  constraint provider_health_failures_non_negative
    check (consecutive_failures >= 0),
  constraint provider_health_open_has_probe
    check (state = 'closed' or next_probe_at is not null),
  constraint provider_health_error_is_brief
    check (last_error is null or length(last_error) <= 500)
);

comment on table public.provider_health is
  'Circuit-breaker state per provider (§6). In the database so a restart does '
  'not forget an outage and every worker sees the same breaker.';

create trigger provider_health_touch_updated_at
  before update on public.provider_health
  for each row execute function app.touch_updated_at();

-- May this provider be called right now?
create or replace function app.provider_available(p_provider text)
  returns boolean
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  h record;
begin
  select * into h from public.provider_health where provider = p_provider;

  -- Unknown provider: no failures recorded, so nothing to distrust. Refusing
  -- here would make adding a provider require a database row first.
  if not found then
    return true;
  end if;

  if h.state = 'closed' then
    return true;
  end if;

  if h.state = 'half_open' then
    -- A probe is already in flight. Exactly one caller gets through per
    -- cooldown, and it is the one that flipped open -> half_open below.
    return false;
  end if;

  if h.next_probe_at is not null and now() >= h.next_probe_at then
    -- Cooldown elapsed: let precisely one request through to test the water.
    update public.provider_health
    set state = 'half_open'
    where provider = p_provider and state = 'open';
    return true;
  end if;

  return false;
end
$$;

create or replace function app.record_provider_success(p_provider text)
  returns void
  language sql
  set search_path = pg_catalog, public
as $$
  insert into public.provider_health (provider, state, consecutive_failures, last_success_at)
  values (p_provider, 'closed', 0, now())
  on conflict (provider) do update
    set state                = 'closed',
        consecutive_failures = 0,
        opened_at            = null,
        next_probe_at        = null,
        cooldown_seconds     = 60,
        last_success_at      = now()
$$;

create or replace function app.record_provider_failure(p_provider text, p_error text)
  returns public.breaker_state
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  v_threshold integer;
  v_max_cooldown integer;
  v_failures integer;
  v_was public.breaker_state;
  v_cooldown integer;
  v_state public.breaker_state;
begin
  select coalesce((value ->> 'failure_threshold')::integer, 5),
         coalesce((value ->> 'max_cooldown_seconds')::integer, 3600)
    into v_threshold, v_max_cooldown
  from public.system_config where key = 'providers.breaker';

  v_threshold := coalesce(v_threshold, 5);
  v_max_cooldown := coalesce(v_max_cooldown, 3600);

  insert into public.provider_health (provider, consecutive_failures, last_failure_at, last_error)
  values (p_provider, 1, now(), left(p_error, 500))
  on conflict (provider) do update
    set consecutive_failures = public.provider_health.consecutive_failures + 1,
        last_failure_at      = now(),
        last_error           = left(p_error, 500)
  returning consecutive_failures, state into v_failures, v_was;

  -- A failed probe re-opens immediately and backs off. Waiting for the
  -- threshold again would hammer a provider that just told us it is still down.
  if v_was = 'half_open' then
    select least(cooldown_seconds * 2, v_max_cooldown) into v_cooldown
    from public.provider_health where provider = p_provider;
    v_state := 'open';
  elsif v_failures >= v_threshold then
    v_cooldown := 60;
    v_state := 'open';
  else
    return v_was;
  end if;

  update public.provider_health
  set state            = v_state,
      opened_at        = coalesce(opened_at, now()),
      cooldown_seconds = v_cooldown,
      next_probe_at    = now() + make_interval(secs => v_cooldown)
  where provider = p_provider;

  return v_state;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
alter table public.provider_health enable row level security;
alter table public.provider_health force  row level security;

create policy provider_health_app_read on public.provider_health
  for select to ai_team_app using (true);

-- Writes go through the recording functions, which apply the thresholds and
-- the backoff. A direct UPDATE could set `closed` while a provider is down.
grant select on public.provider_health to ai_team_app;

grant execute on function app.dequeue_job(text)                     to ai_team_app;
grant execute on function app.recover_stalled_jobs()                to ai_team_app;
grant execute on function app.requeue_retrying()                    to ai_team_app;
grant execute on function app.provider_available(text)              to ai_team_app;
grant execute on function app.record_provider_success(text)         to ai_team_app;
grant execute on function app.record_provider_failure(text, text)   to ai_team_app;
grant execute on function app.capacity_limit(text, integer)         to ai_team_app;

-- The recording functions must be able to write a table the caller cannot.
alter function app.record_provider_success(text)        security definer;
alter function app.record_provider_failure(text, text)  security definer;
alter function app.provider_available(text)             security definer;
