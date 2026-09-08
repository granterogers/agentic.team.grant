-- 0129 — A worker that can be asked to wait
--
-- Since 0121 a pass runs every minute, for good reasons: Grant's messages were
-- waiting on a GitHub cron that fired six times in fourteen hours. There is a
-- consequence nobody had before today, and `verify:jobs` found it:
--
--   | hard kill | killed in running (in-flight) | swept to queued, expected retrying | ❌ |
--   | hard kill | recovered jobs re-enter the queue rather than jumping to running | ❌ |
--
-- Neither is a defect in recovery. `recover_stalled_jobs` does move an
-- in-flight job to `retrying`, exactly as the test expects. But `drain()` also
-- calls `app.requeue_retrying()`, so the heartbeat promotes it to `queued`
-- within the minute — and the suite, which used to be the only thing touching
-- the queue, now reads the state after somebody else has moved it. Two runs
-- minutes apart scored 25/34 and 30/34 on identical code, which is the
-- signature of a race rather than a bug.
--
-- A verification suite that fails at random is worse than no suite: it teaches
-- everyone to re-run it until it passes, and then it cannot fail usefully.
--
-- ## The switch
--
-- One setting. `app.kick_worker()` returns without calling anything while it is
-- on, and the Edge Function checks it too so a webhook kick is held as well —
-- both, because either alone leaves a path open and the point is that NOTHING
-- touches the queue while a suite is measuring it.
--
-- Deliberately a setting rather than an argument: a pause has to survive the
-- process that asked for it. A suite killed halfway must not leave the queue
-- paused forever either, which is what `paused_until` is for — it lapses on its
-- own, and the front end shows it while it holds.
--
-- ## Why not exclude fixture jobs instead
--
-- Tempting, and wrong. The suite's whole subject is the real recovery path;
-- exempting its jobs from the real worker would test a code path nothing else
-- uses. Better to stop the world briefly and measure the thing itself.

begin;

insert into public.system_config (key, value, description)
values
  ('worker.paused_until', to_jsonb(''::text),
   'RFC3339 time until which no pass may run, or empty. Set by verification '
   'suites so they can measure the queue without the heartbeat moving it, and '
   'readable on the front end so a pause is never invisible. Lapses on its '
   'own: a suite that dies must not stop the office permanently.')
on conflict (key) do nothing;

/**
 * Is the office paused, and until when?
 *
 * Returns false for an unset, empty or past value, so every caller can treat
 * "no pause" and "a pause that has lapsed" identically — which they are.
 */
create or replace function app.worker_paused()
returns boolean
language sql
stable
as $$
  select coalesce(
    (select (value #>> '{}')::timestamptz > app.now_utc()
       from public.system_config
      where key = 'worker.paused_until'
        and coalesce(value #>> '{}', '') <> ''),
    false
  )
$$;

grant execute on function app.worker_paused() to ai_team_app, service_role;

/**
 * Hold the queue for a bounded number of seconds.
 *
 * Capped at fifteen minutes. A verification suite takes seconds; a cap means a
 * mistyped argument cannot silence the office for a day, and the longest suite
 * still fits comfortably.
 */
create or replace function app.pause_worker(p_seconds integer default 120)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_until timestamptz;
begin
  v_until := app.now_utc() + make_interval(secs => greatest(1, least(900, p_seconds)));
  update public.system_config
     set value = to_jsonb(to_char(v_until, 'YYYY-MM-DD"T"HH24:MI:SSOF'))
   where key = 'worker.paused_until';
  return v_until;
end;
$$;

create or replace function app.resume_worker()
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  update public.system_config set value = to_jsonb(''::text)
   where key = 'worker.paused_until'
$$;

revoke all on function app.pause_worker(integer) from public;
revoke all on function app.resume_worker() from public;
grant execute on function app.pause_worker(integer) to service_role;
grant execute on function app.resume_worker() to service_role;

-- The heartbeat honours it.
create or replace function app.kick_worker()
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_secret text;
  v_ref    text;
begin
  -- Before anything else. A paused office must cost nothing, not merely
  -- decline late.
  if app.worker_paused() then
    return null;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'worker.kick_secret';
  if v_secret is null or v_secret = '' then
    return null;
  end if;

  select value #>> '{}' into v_ref from public.system_config where key = 'db.project_ref';
  if v_ref is null or v_ref = '' then return null; end if;

  return net.http_post(
    url     := format('https://%s.supabase.co/functions/v1/worker', v_ref),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function app.kick_worker() from public;
grant execute on function app.kick_worker() to service_role;

create or replace function public.worker_paused()
returns boolean language sql stable security definer set search_path = public, pg_catalog
as $$ select app.worker_paused() $$;

revoke all on function public.worker_paused() from public;
grant execute on function public.worker_paused() to service_role;

commit;
