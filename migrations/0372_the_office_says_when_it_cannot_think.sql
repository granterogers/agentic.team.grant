/*
  0372 — say when the office cannot think.

  `app.office_health()` counts failed jobs and names the kinds. It has never
  been able to say the one thing that explains a whole morning of them: that
  the model provider is unreachable and nothing can be answered until it comes
  back.

  Found by Campaign Three running into it. OpenRouter's DAILY free-model quota
  ran out mid-session — `429 Rate limit exceeded: free-models-per-day` — the
  circuit breaker opened for an hour, and eighteen jobs failed in thirty
  minutes. The office was not broken and was not fine, and nothing it reports
  could tell Grant which.

  This matters beyond the harness. The cost constraint is about zero pounds a
  month, so there is ONE inference provider on a free daily allowance, and a
  genuinely busy day can exhaust it. That is an accepted risk; being silent
  about it is not. §31's rule is that an avoidable request for manual
  investigation is a design failure, and "why did nothing happen this morning"
  is exactly that request.

  Reported as a fact, never as a verdict: the row says which provider, since
  when, when it will next be probed and what the provider actually said. The
  surface decides how loudly to draw it.

  Harness probes excluded by name. `provider_health` carries forty rows of
  `probe_%` debris from `verify:providers` runs, and a health reading that
  counts test fixtures as outages is the trap CLAUDE.md records four times.
*/

create or replace function app.office_health(p_hours integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
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
               where not app.harness_job(job_id) and state = 'failed'
                 and created_at > app.now_utc() - make_interval(hours => p_hours)
               group by kind order by count(*) desc limit 5) k
    ),
    'stalled', (select coalesce(sum(s.n), 0) from app.jobs_stuck_queued() s),
    'stalled_kinds', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', s.kind, 'n', s.n, 'oldest_minutes', s.oldest_minutes,
               'period_minutes', s.period_minutes) order by s.n desc), '[]'::jsonb)
        from app.jobs_stuck_queued() s
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
    'excluded_fixtures', (
      select count(*) from public.jobs
       where app.harness_job(job_id)
         and created_at > app.now_utc() - make_interval(hours => p_hours)
    )
  )
    from public.jobs
   where not app.harness_job(job_id)
     and created_at > app.now_utc() - make_interval(hours => p_hours)
$function$;

comment on function app.office_health(integer) is
  'Health as a fact, not a verdict. cannot_think names any provider whose breaker is open (0372).';
