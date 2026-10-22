-- 1094 — A paused job that waits on a person does not keep the heartbeat awake
--
-- 1093 counted every job in state `paused` as work. Checking the usage page after it went live showed
-- the heartbeat still calling the worker every minute: one job was paused, and it was paused on a
-- person, so no pass could resume it. The pass only resumes a pause that `app.resumable_now()`
-- returns (a clock, a rate limit, a provider outage or a dependency), so the predicate should ask
-- that same question rather than look at the state.
--
-- Everything else in 1093 is unchanged: the same live states, the signal window, the CI reservations,
-- and the five-minute floor.

begin;

create or replace function app.worker_has_work()
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
           select 1 from public.jobs j
            where j.state in ('queued', 'running', 'committing', 'committed', 'output_created',
                              'quality_review', 'notifying', 'retrying')
         )
      or jsonb_array_length(app.resumable_now()) > 0
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

commit;
