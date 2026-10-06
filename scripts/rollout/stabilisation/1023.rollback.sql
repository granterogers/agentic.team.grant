-- ROLLBACK for migration 1023: restores the predecessor definitions of app.office_health(uuid, integer) and app.last_progress(uuid).
-- These are the exact bodies production ran before 1023 (migrations 0750 and 0753), taken with pg_get_functiondef from the
-- production-equivalent replica and verified code-identical to the frozen references. Data: none changes. Grants and owner:
-- unchanged (create or replace keeps them). Apply only with scripts/rollout/step.ts, which first checks the live definitions
-- are the ones 1023 installed.

begin;

CREATE OR REPLACE FUNCTION app.office_health(p_office uuid, p_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                 and created_at > app.now_utc() - make_interval(hours => p_hours)
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
         and created_at > app.now_utc() - make_interval(hours => p_hours)
    )
  )
    from public.jobs
   where office_id = p_office and not app.harness_job(job_id)
     and created_at > app.now_utc() - make_interval(hours => p_hours)
  );
end
$function$;

CREATE OR REPLACE FUNCTION app.last_progress(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
  select jsonb_build_object(
    -- Not "did the heartbeat fire". app.kick_worker() returns null silently
    -- when its secret is missing and cron records `succeeded, 1 row` either
    -- way, so the cron log cannot answer this and never could.
    'last_dequeue_at', (
      select max(t.occurred_at) from public.job_state_transitions t
         join public.jobs tj on tj.job_id = t.job_id and tj.office_id = p_office
       where t.to_state = 'running'),
    'last_completion_at', (
      select max(t.occurred_at) from public.job_state_transitions t
         join public.jobs tj on tj.job_id = t.job_id and tj.office_id = p_office
       where t.to_state = 'complete'),
    'last_delivery_at', (select max(d.sent_at) from public.deliveries d
                          where d.office_id = p_office and d.state = 'sent'),
    'minutes_since_dequeue', (
      select round(extract(epoch from (app.now_utc() - max(t.occurred_at))) / 60.0)
        from public.job_state_transitions t
         join public.jobs tj on tj.job_id = t.job_id and tj.office_id = p_office where t.to_state = 'running'),
    'minutes_since_completion', (
      select round(extract(epoch from (app.now_utc() - max(t.occurred_at))) / 60.0)
        from public.job_state_transitions t
         join public.jobs tj on tj.job_id = t.job_id and tj.office_id = p_office where t.to_state = 'complete'),
    -- A queue with nothing in it and no recent completion is IDLE, not stuck,
    -- and the difference is the whole reason this is reported beside the
    -- waiting count rather than instead of it.
    'runnable_now', (
      select count(*) from public.jobs j
       where j.office_id = p_office and j.state in ('queued', 'retrying')
         and not app.harness_job(j.job_id))
  )
  );
end
$function$;

commit;
