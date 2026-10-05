-- FROZEN reference copies of the poll readers as they stood in production on 5 October 2026 (0750 last_progress, 0753 office_health).
-- scripts/isolated/poll-readers-equivalence.ts runs them beside the optimised definitions and requires equal results.
-- Do not "improve" this file: its only job is to stay exactly what production ran. Lives in its own schema so it can never be
-- mistaken for, or called by, the product.
drop schema if exists proof_ref cascade;
create schema proof_ref;

create function proof_ref.last_progress(p_office uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  select jsonb_build_object(
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
    'runnable_now', (
      select count(*) from public.jobs j
       where j.office_id = p_office and j.state in ('queued', 'retrying')
         and not app.harness_job(j.job_id))
  )
  );
end
$function$;

create function proof_ref.office_health(p_office uuid, p_hours integer default 24)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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
    'waiting', (
      select jsonb_build_object(
        'jobs', coalesce(sum(w.n), 0),
        'oldest_minutes', coalesce(max(w.oldest_minutes), 0),
        'threshold_minutes', 15,
        'kinds', coalesce(jsonb_agg(jsonb_build_object('kind', w.kind, 'n', w.n)
                 order by w.n desc) filter (where w.kind is not null), '[]'::jsonb))
        from app.jobs_waiting(p_office, 15) w
    ),
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
    'progress', proof_ref.last_progress(p_office),
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
