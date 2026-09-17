-- 0270 — a queued job is not a failed job
--
-- Issue #112. Nine hourly `google.write_calendar_tasks` jobs sat queued for
-- eight hours. The duty enqueued one an hour exactly as designed, the handler
-- existed and was registered exactly as designed, and **the deployed worker had
-- been built before either of them existed.** It dequeued a kind it had never
-- heard of and left it.
--
-- Nothing was red for eight hours, and the reason is one sentence:
--
--     `app.office_health()` counts `complete`, `failed` and in-flight.
--     A job nobody has taken is none of those.
--
-- So the one number CLAUDE.md tells everyone to trust could not have shown
-- this, and the failure mode is the nastiest kind: quiet and cumulative. The
-- office looked healthy the whole time it was falling behind.
--
-- ## What "stuck" means, and why the duty's own period defines it
--
-- A fixed threshold is wrong in both directions. Ten minutes would cry wolf at
-- the nightly backup; two hours would have taken two hours to notice the
-- calendar duty, and would never notice `drive.watch`, which runs every ten.
--
-- **The duty that created a job already says how long is too long.** A job of a
-- kind that runs hourly and has been queued for more than an hour means the
-- previous one was not taken before the next arrived, which is the definition
-- of falling behind. `responsibilities.period_minutes` is that number and it is
-- already maintained.
--
-- For a kind no duty creates — an instruction, a notebook collect — there is no
-- period, so the floor is an hour. A job nobody has picked up in an hour is
-- stuck whatever made it.
--
-- ## Only `queued`
--
-- Deliberately not `retrying`, which is a job being worked on and failing, and
-- has its own count. Not `blocked` either: that one is waiting for Grant, which
-- is the system working. This is specifically *nobody has taken it*.
--
-- ## Fixtures excluded, as everywhere
--
-- `jobs.is_fixture` exists because harness traffic was once reported to Grant
-- as the office collapsing. A verification suite that leaves a queued fixture
-- behind must not turn the dashboard orange.

begin;

/**
 * Jobs nobody has taken, past the point where somebody should have.
 *
 * Named by kind rather than counted, because "3 stuck" sends you looking and
 * "3 stuck, all google.write_calendar_tasks, oldest 8h" is the answer. The same
 * reasoning as `failing_kinds` above it, and as `npm run wide` naming the
 * element rather than reporting that the page overflows.
 */
create or replace function app.jobs_stuck_queued(p_floor_minutes int default 60)
returns table (kind text, n bigint, oldest_minutes int, period_minutes int)
language sql
stable
security definer
set search_path = ''
as $$
  with limits as (
    -- One row per kind a duty creates, carrying how long is too long for it.
    -- Aggregated because two duties can share a kind, and the SHORTER period
    -- is the honest threshold: whichever duty fires more often is the one
    -- falling behind first.
    select r.job_kind as kind, min(r.period_minutes) as period
      from public.responsibilities r
     where r.enabled
     group by r.job_kind
  )
  select j.kind,
         count(*) as n,
         max(extract(epoch from (app.now_utc() - j.created_at)) / 60)::int as oldest_minutes,
         coalesce(l.period, p_floor_minutes) as period_minutes
    from public.jobs j
    left join limits l on l.kind = j.kind
   where not j.is_fixture
     and j.state = 'queued'
     and j.created_at < app.now_utc()
         - make_interval(mins => coalesce(l.period, p_floor_minutes))
   group by j.kind, l.period
   order by count(*) desc, j.kind
$$;

comment on function app.jobs_stuck_queued is
  '#112. A queued job is not a failed job, which is why nine of them went '
  'unnoticed for eight hours. Too long is the period of the duty that made the '
  'job -- an hourly kind queued for over an hour means the last one was not '
  'taken before the next arrived.';

create or replace function public.jobs_stuck_queued(p_floor_minutes int default 60)
returns table (kind text, n bigint, oldest_minutes int, period_minutes int)
language sql stable security definer set search_path = public, pg_catalog
as $$ select * from app.jobs_stuck_queued(p_floor_minutes) $$;

/**
 * The one number, with the third state it was missing.
 *
 * `stalled` sits beside `failed` rather than inside it, because they need
 * different actions: a failure is a handler that ran and could not do the job,
 * and a stall is a handler that is not there at all. Telling Grant "3 failed"
 * for the second would send him to the wrong place.
 *
 * The rest of the function is 0142's, reproduced from `pg_get_functiondef`
 * rather than from memory.
 */
create or replace function app.office_health(p_hours integer default 24)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select jsonb_build_object(
    'window_hours', p_hours,
    'finished', count(*) filter (where state = 'complete'),
    'failed', count(*) filter (where state = 'failed'),
    'in_flight', count(*) filter (where state not in ('complete', 'failed', 'cancelled')),
    -- Named, because "3 failed" is a number and "3 failed, all notebook.generate"
    -- is something a person can act on.
    'failing_kinds', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'n', k.n)
             order by k.n desc), '[]'::jsonb)
        from (select kind, count(*) n
                from public.jobs
               where not is_fixture and state = 'failed'
                 and created_at > app.now_utc() - make_interval(hours => p_hours)
               group by kind order by count(*) desc limit 5) k
    ),
    /*
      Jobs nobody has taken (#112).

      NOT restricted to the window. A stall is measured from the job's own age
      against its duty's period, and the whole failure this comes from was a
      backlog growing older than any window you would pick to look through.
      Filtering it to 24 hours would hide exactly the case that has gone on
      longest.
    */
    'stalled', (select coalesce(sum(s.n), 0) from app.jobs_stuck_queued() s),
    'stalled_kinds', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', s.kind, 'n', s.n, 'oldest_minutes', s.oldest_minutes,
               'period_minutes', s.period_minutes) order by s.n desc), '[]'::jsonb)
        from app.jobs_stuck_queued() s
    ),
    'excluded_fixtures', (
      select count(*) from public.jobs
       where is_fixture
         and created_at > app.now_utc() - make_interval(hours => p_hours)
    )
  )
    from public.jobs
   where not is_fixture
     and created_at > app.now_utc() - make_interval(hours => p_hours)
$function$;

grant execute on function app.jobs_stuck_queued(int) to ai_team_app;

commit;
