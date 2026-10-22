-- 1093 — The heartbeat knocks only when there is work
--
-- `worker-heartbeat` has called the worker Edge Function every minute since 0121, whether or
-- not anything was waiting. That is about 1,440 invocations a day, and each one is a logged
-- request, so it was the largest steady source of Edge Function invocations and of log
-- ingestion on the Free plan, and it wrote a row to cron.job_run_details every time.
--
-- The worker pass also does housekeeping that is not in the queue itself: it recovers jobs a
-- dead worker left holding a lease, fires undecided signals, expires stale CI reservations
-- and resumes paused jobs. So the heartbeat no longer knocks blindly. It knocks when one of
-- those has something to do, and otherwise once every five minutes as a floor. A source this
-- predicate does not name is therefore at most five minutes late, never lost.
--
-- Work that arrives from outside the database still wakes the worker at once: Telegram,
-- Slack and the Team HQ gateway kick the function directly on enqueue, and are not affected.

begin;

/**
 * Is there anything for a pass to do right now?
 *
 * Jobs in any state a pass moves them through. `waiting_external` and `waiting_user` are
 * left out on purpose: they wait on a provider or a person, not on the queue, and a pass
 * cannot move them. Terminal states (`complete`, `cancelled`, `failed`) are left out too.
 *
 * Signals are counted only for fifteen minutes, so one that never fires cannot keep the
 * heartbeat awake for ever. CI reservations count once their expiry has passed.
 */
create or replace function app.worker_has_work()
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
           select 1 from public.jobs j
            where j.state in ('queued', 'running', 'committing', 'committed', 'output_created',
                              'quality_review', 'notifying', 'retrying', 'paused')
         )
      or exists (
           select 1 from public.signals s
            where s.received_at > app.now_utc() - interval '15 minutes'
              and not exists (select 1 from public.trigger_firings f where f.signal_id = s.signal_id)
         )
      or exists (
           select 1 from public.ci_runs r
            where r.settled_at is null and r.expires_at <= app.now_utc()
         )
$$;

revoke all on function app.worker_has_work() from public;
grant execute on function app.worker_has_work() to service_role;

/**
 * The per-minute cron entry point. Knocks when there is work, and otherwise once in every
 * five minutes, so a source the predicate misses is late by five minutes at most.
 *
 * `app.kick_worker()` still checks the pause switch first, so a paused office costs nothing
 * whether or not there is work.
 */
create or replace function app.kick_worker_if_due()
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not app.worker_has_work()
     and extract(minute from (app.now_utc() at time zone 'UTC'))::int % 5 <> 0 then
    return null;
  end if;
  return app.kick_worker();
end;
$$;

revoke all on function app.kick_worker_if_due() from public;
grant execute on function app.kick_worker_if_due() to service_role;

-- Same name as 0121's entry, so pg_cron replaces the command rather than adding a second job.
select cron.schedule('worker-heartbeat', '* * * * *', $cron$ select app.kick_worker_if_due() $cron$);

commit;
