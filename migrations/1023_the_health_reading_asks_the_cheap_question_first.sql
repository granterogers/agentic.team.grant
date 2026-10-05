-- 1023 - the health reading asks the cheap question first (efficiency run, 5 to 6 October 2026; NOT applied to production).
--
-- WHAT WAS MEASURED (isolated replica seeded to production's 5 Oct shape: 22.6k jobs, 168k transitions, 10k outputs;
-- scripts/isolated/seed-production-scale.sql, scripts/forensics/resource-probe.ts):
--   public.office_health(office, 24)  915 ms,  394,209 buffer hits, 41,495 index probes on jobs, 4 sequential scans of jobs.
-- Team HQ reads this every 20 seconds for every visible tab ("thinking" is read on every pulse tick), so on production's table
-- one open tab spent about 2.7 s of database time and 1.2 million buffer touches a minute on it.
--
-- WHY. Two independent defects.
--  1. The 24-hour window was written  created_at > app.now_utc() - make_interval(hours => p_hours).  app.now_utc() carries a
--     SET clause, so Postgres cannot inline it and costs it as a function call (100). app.harness_job(job_id) costs the same.
--     Equal-cost quals keep the order they were written in, and `not app.harness_job(job_id)` was written FIRST, so it ran for
--     every job the office has ever had (20,356 of them) and only then did the window cut the set to about 500. Three aggregates
--     in the function did this, so harness_job (3 to 6 index probes, recursive up the parent chain) ran about 60,000 times.
--     The window start is now computed ONCE into a variable. A plpgsql variable reaches the query as a parameter, which costs
--     almost nothing, so the window is applied before the function is asked about any row.
--  2. app.last_progress asked four times for the newest transition into a state (twice for 'running', twice for 'complete'),
--     each as `max(occurred_at)` over a join of ALL transitions into that state with jobs. The join has no office column on
--     the transition side, so the planner hashed 22k jobs against 20k transitions four times. The question is "when did this
--     office's newest job reach this state", and the index job_transitions_state_time_idx (to_state, occurred_at desc) answers it
--     by reading transitions newest first and stopping at the first one whose job belongs to the office. Asked once per state.
--
-- WHAT DOES NOT CHANGE. Every key of the returned jsonb, in the same shape, from the same rows, for the same window. The harness
-- exclusion is the same predicate asked of the same rows (app.harness_job itself is untouched: about twenty-five readers depend
-- on it and its strict direction is the safe one). Office isolation is unchanged: both functions still start with
-- app.require_office(p_office) and every jobs/transitions read is bound to p_office.
-- The proof is scripts/isolated/poll-readers-equivalence.ts: the frozen previous definitions run beside these on the same data
-- and the results must be equal, with a sabotage that makes them differ and must go red.
--
-- Roll back by re-applying the 0753 and 0750 definitions of these two functions (create or replace; no data changed).

begin;

create or replace function app.last_progress(p_office uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_dequeue  timestamptz;
  v_complete timestamptz;
begin
  perform app.require_office(p_office);
  -- The newest transition into 'running' / 'complete' that belongs to one of THIS office's jobs. Newest first, stop at the
  -- first match: the planner walks job_transitions_state_time_idx and probes jobs by primary key. `occurred_at is not null`
  -- keeps max() semantics (max ignores nulls; a descending sort would put them first).
  select t.occurred_at into v_dequeue
    from public.job_state_transitions t
   where t.to_state = 'running' and t.occurred_at is not null
     and exists (select 1 from public.jobs tj where tj.job_id = t.job_id and tj.office_id = p_office)
   order by t.occurred_at desc
   limit 1;
  select t.occurred_at into v_complete
    from public.job_state_transitions t
   where t.to_state = 'complete' and t.occurred_at is not null
     and exists (select 1 from public.jobs tj where tj.job_id = t.job_id and tj.office_id = p_office)
   order by t.occurred_at desc
   limit 1;
  return jsonb_build_object(
    -- Not "did the heartbeat fire". app.kick_worker() returns null silently
    -- when its secret is missing and cron records `succeeded, 1 row` either
    -- way, so the cron log cannot answer this and never could.
    'last_dequeue_at', v_dequeue,
    'last_completion_at', v_complete,
    'last_delivery_at', (select max(d.sent_at) from public.deliveries d
                          where d.office_id = p_office and d.state = 'sent'),
    'minutes_since_dequeue', round(extract(epoch from (app.now_utc() - v_dequeue)) / 60.0),
    'minutes_since_completion', round(extract(epoch from (app.now_utc() - v_complete)) / 60.0),
    -- A queue with nothing in it and no recent completion is IDLE, not stuck,
    -- and the difference is the whole reason this is reported beside the
    -- waiting count rather than instead of it.
    'runnable_now', (
      select count(*) from public.jobs j
       where j.office_id = p_office and j.state in ('queued', 'retrying')
         and not app.harness_job(j.job_id))
  );
end
$function$;

create or replace function app.office_health(p_office uuid, p_hours integer default 24)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  -- Computed once. See the header: as a parameter this qual is cheap and runs before app.harness_job; written inline it was
  -- costed as a function call and ran after it, for every job the office has ever had.
  v_since timestamptz := app.now_utc() - make_interval(hours => p_hours);
begin
  perform app.require_office(p_office);
  return (
  select jsonb_build_object(
    'window_hours', p_hours,
    'finished', count(*) filter (where state = 'complete'),
    'failed', count(*) filter (where state = 'failed'),
    'in_flight', count(*) filter (where state not in ('complete', 'failed', 'cancelled')),
    'failing_kinds', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'n', k.n)
             order by k.n desc), '[]'::jsonb)
        from (select kind, count(*) n
                from public.jobs
               where office_id = p_office and not app.harness_job(job_id) and state = 'failed'
                 and created_at > v_since
               group by kind order by count(*) desc limit 5) k
    ),
    'stalled', (select coalesce(sum(s.n), 0) from app.jobs_stuck_queued(p_office) s),
    'stalled_kinds', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', s.kind, 'n', s.n, 'oldest_minutes', s.oldest_minutes,
               'period_minutes', s.period_minutes) order by s.n desc), '[]'::jsonb)
        from app.jobs_stuck_queued(p_office) s
    ),
    /*
      The reading the fifteen-hour outage had no word for (#236).

      `oldest_minutes` is the one to read: eleven messages waiting two minutes
      is a busy queue and one message waiting nine hours is an office that has
      stopped. A count alone cannot tell those apart, which is part of why
      nothing noticed.
    */
    'waiting', (
      select jsonb_build_object(
        'jobs', coalesce(sum(w.n), 0),
        'oldest_minutes', coalesce(max(w.oldest_minutes), 0),
        'threshold_minutes', 15,
        'kinds', coalesce(jsonb_agg(jsonb_build_object('kind', w.kind, 'n', w.n)
                 order by w.n desc) filter (where w.kind is not null), '[]'::jsonb))
        from app.jobs_waiting(p_office, 15) w
    ),
    -- Why a morning of failures happened, when the answer is "it could not
    -- think". Empty when every provider is reachable, which is the common case
    -- and the one that should add nothing to the reading.
    'cannot_think', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'provider', h.provider,
               'since', h.opened_at,
               'next_probe_at', h.next_probe_at,
               'said', left(coalesce(h.last_error, ''), 200)) order by h.opened_at), '[]'::jsonb)
        from public.provider_health h
       where h.state = 'open'
         and h.provider not like 'probe_%'
    ),
    'backup', case when app.office_sees_the_deployment(p_office) then app.backup_health() end,
    'progress', app.last_progress(p_office),
    'held_for_budget', app.held_for_budget(p_office),
    'excluded_fixtures', (
      select count(*) from public.jobs
       where office_id = p_office and app.harness_job(job_id)
         and created_at > v_since
    )
  )
    from public.jobs
   where office_id = p_office and not app.harness_job(job_id)
     and created_at > v_since
  );
end
$function$;

commit;
