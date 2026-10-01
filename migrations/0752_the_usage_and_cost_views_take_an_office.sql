-- 0752 - the usage and cost views take an office (multi-user P3, cluster e-views).
--
-- inference_usage rows with no job are the deployment's own calls: they sit in the system office and were never any
-- person's spend. An office sees only its own usage; the operator additionally sees those calls as an explicit
-- 'unattributed (system)' line that is never added to anybody's totals. The size of the database, the speech quota and
-- the notebook budget are the deployment's and are withheld from every other office.

-- app.hq_series
create function app.hq_series(p_office uuid, p_days integer DEFAULT 30)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  with span as (
    select
      least(greatest(p_days, 7), 90) as days,
      coalesce(
        (select value #>> '{}' from public.system_config where key = 'grant.timezone'),
        'UTC'
      ) as tz
  ),
  days as (
    select (generate_series(
      (app.now_utc() at time zone (select tz from span))::date - ((select days from span) - 1),
      (app.now_utc() at time zone (select tz from span))::date,
      interval '1 day'
    ))::date as day
  )
  select jsonb_build_object(
    'timezone', (select tz from span),
    'days', (select days from span),
    'inference_cost_usd', coalesce((
      select jsonb_agg(jsonb_build_array(d.day, round(coalesce(u.cost, 0), 6)) order by d.day)
      from days d
      left join (
        select (occurred_at at time zone (select tz from span))::date as day,
               sum(cost_usd) as cost
        from public.inference_usage
        where office_id = p_office
        group by 1
      ) u on u.day = d.day
    ), '[]'::jsonb),
    'inference_calls', coalesce((
      select jsonb_agg(jsonb_build_array(d.day, coalesce(u.n, 0)) order by d.day)
      from days d
      left join (
        select (occurred_at at time zone (select tz from span))::date as day,
               count(*)::int as n
        from public.inference_usage
        where office_id = p_office
        group by 1
      ) u on u.day = d.day
    ), '[]'::jsonb),
    'jobs_completed', coalesce((
      select jsonb_agg(jsonb_build_array(d.day, coalesce(j.n, 0)) order by d.day)
      from days d
      left join (
        select (occurred_at at time zone (select tz from span))::date as day,
               count(*)::int as n
        from public.job_state_transitions
        where to_state = 'complete'
          and job_id in (select jx.job_id from public.jobs jx where jx.office_id = p_office)
        group by 1
      ) j on j.day = d.day
    ), '[]'::jsonb),
    'messages_sent', coalesce((
      select jsonb_agg(jsonb_build_array(d.day, coalesce(m.n, 0)) order by d.day)
      from days d
      left join (
        select (sent_at at time zone (select tz from span))::date as day,
               count(*)::int as n
        from public.deliveries
        where office_id = p_office and sent_at is not null
        group by 1
      ) m on m.day = d.day
    ), '[]'::jsonb)
  )
  );
end
$function$;
revoke all on function app.hq_series(uuid, integer) from public, anon, authenticated, service_role;

-- public.hq_series
create function public.hq_series(p_office uuid, p_days integer DEFAULT 30)
 returns jsonb
 language sql
 SECURITY DEFINER
 set search_path to ''
as $f$
 select app.hq_series(p_office, p_days) 
$f$;

-- app.hq_usage
create function app.hq_usage(p_office uuid)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  select jsonb_build_object(
    'inference', jsonb_build_object(
      'provenance', 'measured',
      'note', 'Every inference attempt is recorded locally, successes and failures alike.',
      'calls_30d', (
        select count(*)::int from public.inference_usage
        where office_id = p_office and occurred_at > app.now_utc() - interval '30 days'
      ),
      'cost_usd_30d', (
        select coalesce(sum(cost_usd), 0)::numeric(12,6) from public.inference_usage
        where office_id = p_office and occurred_at > app.now_utc() - interval '30 days'
      ),
      'by_outcome', coalesce((
        select jsonb_object_agg(outcome, n) from (
          select outcome::text as outcome, count(*)::int as n
          from public.inference_usage
          where office_id = p_office and occurred_at > app.now_utc() - interval '30 days'
          group by 1
        ) o
      ), '{}'::jsonb)
    ),
    'tts', jsonb_build_object(
      'provenance', 'measured',
      'note', 'Counted by us: Google exposes no live counter for Chirp 3.',
      'characters_this_month', case when app.office_sees_the_deployment(p_office) then app.tts_characters_this_month('google.chirp3-hd') end,
      'monthly_free_allowance', 1000000
    ),
    'notebook', jsonb_build_object(
      -- The important one. There is no API for this and there never was; the
      -- figures come from a capability probe, and calling them anything but
      -- estimated would be the exact misrepresentation §11 forbids.
      'provenance', 'estimated',
      'note', 'Notebook publishes no usage counters. These are inferred from a capability probe and may be wrong.',
      'detected_tier', (select detected_tier from public.notebook_budget where app.office_sees_the_deployment(p_office)),
      'notebook_limit', (select notebook_limit from public.notebook_budget where app.office_sees_the_deployment(p_office)),
      'source_limit', (select source_limit from public.notebook_budget where app.office_sees_the_deployment(p_office)),
      'daily_chat_budget', (select daily_chat_budget from public.notebook_budget where app.office_sees_the_deployment(p_office)),
      'computed_at', (select computed_at from public.notebook_budget where app.office_sees_the_deployment(p_office))
    ),
    'queue', jsonb_build_object(
      'provenance', 'measured',
      'max_concurrent', app.capacity_limit('max_concurrent_jobs', 3),
      'in_flight', (
        select count(*)::int from public.jobs
        where office_id = p_office and state not in ('complete', 'cancelled', 'failed')
      )
    ),
    'delivery', coalesce((
      select jsonb_agg(row_to_json(d)) from (
        select channel, state, deliveries, needed_more_than_one_attempt, leases_expired
        from app.delivery_health_in(p_office)
      ) d
    ), '[]'::jsonb),
    'models', coalesce((
      -- Explicitly WITHOUT secret_ref and base_url. A secret reference is not a
      -- secret, and it is still not something a dashboard needs.
      select jsonb_agg(row_to_json(m)) from (
        select provider, model_id, priority, last_success_at
        from public.usable_models
        order by priority, provider
      ) m
    ), '[]'::jsonb)
  )
  );
end
$function$;
revoke all on function app.hq_usage(uuid) from public, anon, authenticated, service_role;

-- public.hq_usage
create function public.hq_usage(p_office uuid)
 returns jsonb
 language sql
 SECURITY DEFINER
 set search_path to ''
as $f$
 select app.hq_usage(p_office) 
$f$;

-- app.hq_cost_per_outcome
create function app.hq_cost_per_outcome(p_office uuid, p_days integer DEFAULT 30)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  with window_start as (
    select app.now_utc() - make_interval(days => greatest(1, least(365, p_days))) as t
  ),
  -- Every usage row in the window, priced.
  priced as (
    select u.usage_id,
           u.job_id,
           u.correlation_id,
           u.outcome::text as outcome,
           u.model_id,
           u.cost_usd,
           u.prompt_tokens,
           u.completion_tokens,
           round(
             (u.prompt_tokens     / 1000000.0) * pr.input_usd_per_mtok +
             (u.completion_tokens / 1000000.0) * pr.output_usd_per_mtok
           , 6) as modelled_usd
      from public.inference_usage u
      cross join window_start w
      left join lateral app.model_price_at(u.model_id, u.occurred_at) pr on true
     where u.office_id = p_office and u.occurred_at > w.t
  ),
  -- Completed work in the window. Only completed: a cost per outcome divided
  -- by attempts is a cost per attempt, and the two differ most exactly when a
  -- kind of work is going badly, which is when the number matters.
  done as (
    select j.job_id, j.kind, j.correlation_id,
           extract(epoch from (j.finished_at - j.started_at)) as secs
      from public.jobs j
      cross join window_start w
     where j.office_id = p_office and j.state = 'complete' and j.finished_at > w.t
  ),
  by_kind as (
    select d.kind,
           count(distinct d.job_id)::int as outcomes,
           count(p.usage_id)::int                               as calls,
           coalesce(sum(p.prompt_tokens + p.completion_tokens), 0)::bigint as tokens,
           coalesce(sum(p.cost_usd), 0)::numeric(14,6)          as spent_usd,
           coalesce(sum(p.modelled_usd), 0)::numeric(14,6)      as modelled_usd,
           round(avg(d.secs)::numeric, 1)                       as avg_secs
      from done d
      left join priced p on p.job_id = d.job_id
     group by d.kind
  ),
  by_staff as (
    -- `staff_behind_job` returns a SLUG, and `staff.staff_id` is a uuid. The
    -- first version joined the two and Postgres refused with "operator does
    -- not exist: uuid = text", which is the error doing its job.
    select coalesce(app.staff_behind_job(d.job_id), 'unassigned') as slug,
           count(distinct d.job_id)::int as outcomes,
           coalesce(sum(p.modelled_usd), 0)::numeric(14,6) as modelled_usd,
           coalesce(sum(p.cost_usd), 0)::numeric(14,6)     as spent_usd
      from done d
      left join priced p on p.job_id = d.job_id
     group by 1
  ),
  -- The honesty column. Calls in the window that no completed job can claim,
  -- either because job_id was never written (everything before this migration)
  -- or because the job they belong to has not finished.
  gap as (
    select count(*) filter (where p.job_id is null)::int as unattributed_calls,
           count(*)::int                                 as total_calls,
           coalesce(sum(p.modelled_usd) filter (where p.job_id is null), 0)::numeric(14,6)
             as unattributed_modelled_usd
      from priced p
  )
  select jsonb_build_object(
    'generated_at', app.now_utc(),
    'window_days', greatest(1, least(365, p_days)),
    -- Said in words on the page, because a reader who does not know that every
    -- provider here is free-tier will read $0.00 as a bug.
    'measured_note',
      'Measured spend is what providers actually charged. It is currently zero '
      'because the router refuses any call a provider prices above zero.',
    'modelled_note',
      'Modelled cost is what the same tokens would have cost on a paid model, '
      'from the published prices in model_prices. It was never charged.',
    'coverage', (
      select jsonb_build_object(
        'total_calls', g.total_calls,
        'unattributed_calls', g.unattributed_calls,
        'unattributed_modelled_usd', g.unattributed_modelled_usd,
        'attributed_pct', case when g.total_calls = 0 then 100
             else round(100.0 * (g.total_calls - g.unattributed_calls) / g.total_calls) end
      ) from gap g
    ),
    -- Model calls that no job, and so no office, can claim belong to the deployment. They are never part of an
    -- office's own spend; the operator sees them as a line of their own.
    'unattributed_system', case when app.office_sees_the_deployment(p_office) then (
      select jsonb_build_object(
        'label', 'unattributed (system)',
        'calls', count(*)::int,
        'tokens', coalesce(sum(u.prompt_tokens + u.completion_tokens), 0),
        'spent_usd', coalesce(sum(u.cost_usd), 0)::numeric(14,6))
        from public.inference_usage u, window_start w
       where u.office_id = (select so.office_id from public.offices so where so.kind = 'system')
         and u.job_id is null and u.occurred_at > w.t) end,
    'totals', (
      select jsonb_build_object(
        'outcomes', coalesce(sum(outcomes), 0),
        'calls', coalesce(sum(calls), 0),
        'tokens', coalesce(sum(tokens), 0),
        'spent_usd', coalesce(sum(spent_usd), 0),
        'modelled_usd', coalesce(sum(modelled_usd), 0)
      ) from by_kind
    ),
    'by_kind', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', k.kind,
        'outcomes', k.outcomes,
        'calls', k.calls,
        'tokens', k.tokens,
        'avg_secs', k.avg_secs,
        'spent_usd', k.spent_usd,
        'modelled_usd', k.modelled_usd,
        'modelled_usd_each', round(k.modelled_usd / greatest(k.outcomes, 1), 6)
      ) order by k.modelled_usd desc, k.outcomes desc)
      from by_kind k), '[]'::jsonb),
    'by_staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', s.slug,
        'name', coalesce((select st.name from public.staff st where st.slug = s.slug),
                         'Unassigned'),
        'outcomes', s.outcomes,
        'spent_usd', s.spent_usd,
        'modelled_usd', s.modelled_usd
      ) order by s.modelled_usd desc, s.outcomes desc)
      from by_staff s), '[]'::jsonb)
  )
  );
end
$function$;
revoke all on function app.hq_cost_per_outcome(uuid, integer) from public, anon, authenticated, service_role;

-- public.hq_cost_per_outcome
create function public.hq_cost_per_outcome(p_office uuid, p_days integer DEFAULT 30)
 returns jsonb
 language sql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $f$
 select app.hq_cost_per_outcome(p_office, p_days) 
$f$;

-- app.usage_overview
create function app.usage_overview(p_office uuid, p_days integer DEFAULT 30)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
declare
  days      integer := greatest(coalesce(p_days, 30), 1);
  head      jsonb;
  services  jsonb;
  top       jsonb;
  spark     jsonb;
  harness   integer;
  unattributed jsonb;
begin
  perform app.require_office(p_office);
  -- The database and the file store are the deployment's, not an office's: only its operator reads them.
  if app.office_sees_the_deployment(p_office) then
    select app.free_tier_headroom() into head;
  else
    head := '{}'::jsonb;
  end if;

  -- Counted and reported rather than hidden. "We made 1,140 calls of which 57
  -- were our own tests" is honest; silently showing 1,083 invites the question
  -- of where the others went the first time he compares it to something.
  select count(*)::int into harness
    from public.inference_usage u
   where u.office_id = p_office and u.occurred_at >= app.now_utc() - make_interval(days => days)
     and app.usage_is_harness(u.model_id, u.provider);

  services := jsonb_build_array(
    (select jsonb_build_object(
      'key', 'openrouter',
      'name', 'Model calls',
      'detail', 'OpenRouter, free tier',
      'unit', 'usd',
      'used', round(coalesce(sum(u.cost_usd), 0)::numeric, 6),
      'limit', null,
      'of_limit', null,
      'window', 'last ' || days::text || ' days',
      'secondary', jsonb_build_object(
        'calls', count(*),
        'tokens', coalesce(sum(u.prompt_tokens + u.completion_tokens), 0),
        'failed', count(*) filter (where u.outcome <> 'ok'),
        'harness_excluded', harness
      ),
      'provenance', case
        when count(*) filter (where u.provider_reported_cost is not null) = 0 then 'measured'
        else 'reported' end,
      'note', case
        when coalesce(sum(u.cost_usd), 0) = 0
          then 'Every call so far has been on a free model.'
        else null end,
      'day', round(coalesce(sum(u.cost_usd) filter
              (where u.occurred_at >= app.now_utc() - interval '1 day'), 0)::numeric, 6),
      'week', round(coalesce(sum(u.cost_usd) filter
              (where u.occurred_at >= app.now_utc() - interval '7 days'), 0)::numeric, 6),
      'month', round(coalesce(sum(u.cost_usd) filter
              (where u.occurred_at >= app.now_utc() - interval '30 days'), 0)::numeric, 6)
    ) from public.inference_usage u
      left join public.jobs j on j.job_id = u.job_id
      where u.office_id = p_office and u.occurred_at >= app.now_utc() - make_interval(days => days)
        and coalesce(j.is_fixture, false) = false
        and not app.usage_is_harness(u.model_id, u.provider)),

    (select jsonb_build_object(
      'key', 'notebooklm',
      'name', 'Notebook generations',
      'detail', 'Audio, slides, video, mind maps',
      'unit', 'units',
      'used', coalesce(sum(s.units) filter
              (where s.occurred_at >= app.now_utc() - interval '5 hours'), 0),
      'limit', (select (value #>> '{}')::int from public.system_config
                 where key = 'notebook.window_units'),
      'of_limit', null,
      'window', 'five hours',
      'secondary', jsonb_build_object(
        'week_used', coalesce(sum(s.units) filter
                     (where s.occurred_at >= app.now_utc() - interval '7 days'), 0),
        'week_limit', (select (value #>> '{}')::int from public.system_config
                        where key = 'notebook.week_units'),
        'operations', count(*),
        'failed', count(*) filter (where not s.succeeded)
      ),
      'provenance', 'estimated',
      'note', 'Our own count. Google publishes no usage figure for this.',
      'day', coalesce(sum(s.units) filter
             (where s.occurred_at >= app.now_utc() - interval '1 day'), 0),
      'week', coalesce(sum(s.units) filter
              (where s.occurred_at >= app.now_utc() - interval '7 days'), 0),
      'month', coalesce(sum(s.units) filter
               (where s.occurred_at >= app.now_utc() - interval '30 days'), 0)
    ) from public.notebook_spend s
      left join public.jobs j on j.job_id = s.job_id
     where s.office_id = p_office and coalesce(j.is_fixture, false) = false),

    (select jsonb_build_object(
      'key', 'tts',
      'name', 'Speech',
      'detail', 'Google Chirp 3',
      'unit', 'characters',
      'used', coalesce(sum(t.characters) filter
              (where date_trunc('month', t.billing_month)
                     = date_trunc('month', app.now_utc())), 0),
      'limit', 1000000,
      'of_limit', null,
      'window', 'this month',
      'secondary', jsonb_build_object('failed', count(*) filter (where t.failed)),
      'provenance', 'measured',
      'note', 'Counted by us — Google exposes no live counter for Chirp 3.',
      'day', coalesce(sum(t.characters) filter
             (where t.created_at >= app.now_utc() - interval '1 day'), 0),
      'week', coalesce(sum(t.characters) filter
              (where t.created_at >= app.now_utc() - interval '7 days'), 0),
      'month', coalesce(sum(t.characters) filter
               (where t.created_at >= app.now_utc() - interval '30 days'), 0)
    ) from public.tts_usage t),

    jsonb_build_object(
      'key', 'supabase_db', 'name', 'Database', 'detail', 'Supabase, free tier',
      'unit', 'bytes',
      'used', (head -> 'database' ->> 'bytes')::bigint,
      'limit', (head -> 'database' ->> 'limit_bytes')::bigint,
      'of_limit', (head -> 'database' ->> 'percent')::numeric,
      'window', 'now', 'provenance', 'measured', 'note', null,
      'secondary', jsonb_build_object('largest', head -> 'largest')
    ),
    jsonb_build_object(
      'key', 'supabase_storage', 'name', 'File storage', 'detail', 'Supabase, free tier',
      'unit', 'bytes',
      'used', (head -> 'storage' ->> 'bytes')::bigint,
      'limit', (head -> 'storage' ->> 'limit_bytes')::bigint,
      'of_limit', (head -> 'storage' ->> 'percent')::numeric,
      'window', 'now', 'provenance', 'measured', 'note', null,
      'secondary', jsonb_build_object('objects', (head -> 'storage' ->> 'objects')::int)
    ),

    (select jsonb_build_object(
      'key', 'mcp', 'name', 'Tool calls', 'detail', 'MCP clients',
      'unit', 'calls',
      'used', count(*), 'limit', null, 'of_limit', null, 'window', 'this month',
      'provenance', 'measured', 'note', null,
      'secondary', jsonb_build_object('failed', count(*) filter (where c.outcome <> 'ok')),
      'day', count(*) filter (where c.called_at >= app.now_utc() - interval '1 day'),
      'week', count(*) filter (where c.called_at >= app.now_utc() - interval '7 days'),
      'month', count(*) filter (where c.called_at >= app.now_utc() - interval '30 days')
    ) from public.mcp_calls c
      join public.mcp_clients mc on mc.client_id = c.client_id and mc.office_id = p_office)
  );

  if not app.office_sees_the_deployment(p_office) then
    select coalesce(jsonb_agg(s), '[]'::jsonb) into services
      from jsonb_array_elements(services) s
     where s ->> 'key' not in ('tts', 'supabase_db', 'supabase_storage');
  else
    -- Calls no job can claim live in the deployment's own office. The operator sees them as a line of their own,
    -- never added to an office's spend.
    select jsonb_build_object(
             'label', 'unattributed (system)',
             'calls', count(*)::int,
             'tokens', coalesce(sum(u.prompt_tokens + u.completion_tokens), 0),
             'cost', round(coalesce(sum(u.cost_usd), 0)::numeric, 6))
      into unattributed
      from public.inference_usage u
     where u.office_id = (select so.office_id from public.offices so where so.kind = 'system')
       and u.job_id is null
       and u.occurred_at >= app.now_utc() - make_interval(days => days)
       and not app.usage_is_harness(u.model_id, u.provider);
  end if;

  select coalesce(jsonb_agg(x order by (x ->> 'calls')::int desc), '[]'::jsonb)
    into top
    from (
      select jsonb_build_object(
               'name', u.model_id,
               'provider', u.provider,
               'calls', count(*)::int,
               'tokens', coalesce(sum(u.prompt_tokens + u.completion_tokens), 0),
               'cost', round(coalesce(sum(u.cost_usd), 0)::numeric, 6),
               'failed', count(*) filter (where u.outcome <> 'ok')
             ) as x
        from public.inference_usage u
        left join public.jobs j on j.job_id = u.job_id
       where u.office_id = p_office and u.occurred_at >= app.now_utc() - make_interval(days => days)
         and coalesce(j.is_fixture, false) = false
         and not app.usage_is_harness(u.model_id, u.provider)
       group by u.model_id, u.provider
       order by count(*) desc
       limit 8
    ) t;

  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'calls', d.calls, 'cost', d.cost)
                            order by d.day), '[]'::jsonb)
    into spark
    from (
      select (u.occurred_at at time zone app.grant_timezone())::date as day,
             count(*)::int as calls,
             round(coalesce(sum(u.cost_usd), 0)::numeric, 6) as cost
        from public.inference_usage u
        left join public.jobs j on j.job_id = u.job_id
       where u.office_id = p_office and u.occurred_at >= app.now_utc() - make_interval(days => days)
         and coalesce(j.is_fixture, false) = false
         and not app.usage_is_harness(u.model_id, u.provider)
       group by 1
    ) d;

  return jsonb_build_object(
    'generated_at', app.now_utc(),
    'window_days', days,
    'target', 'about £0 / month',
    'harness_excluded', harness,
    'services', services,
    'top_models', top,
    'by_day', spark,
    'unattributed_system', unattributed
  );
end;
$function$;
revoke all on function app.usage_overview(uuid, integer) from public, anon, authenticated, service_role;

-- public.usage_overview
create function public.usage_overview(p_office uuid, p_days integer DEFAULT 30)
 returns jsonb
 language sql
 STABLE SECURITY DEFINER
 set search_path to ''
as $f$
 select app.usage_overview(p_office, p_days) 
$f$;

do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('hq_series', 'hq_usage', 'hq_cost_per_outcome', 'usage_overview')
              and (pg_get_function_arguments(p.oid)) like 'p_office uuid%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $g$;

-- the old signatures go: nothing may ask without saying whose
drop function app.hq_series(integer);
drop function public.hq_series(integer);
drop function app.hq_usage();
drop function public.hq_usage();
drop function app.hq_cost_per_outcome(integer);
drop function public.hq_cost_per_outcome(integer);
drop function app.usage_overview(integer);
drop function public.usage_overview(integer);
