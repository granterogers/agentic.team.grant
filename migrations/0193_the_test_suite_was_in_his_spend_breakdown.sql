-- The test suite was in his spend breakdown.
--
-- Issue #61. 0191/0192's "what is being consumed the most" ranked:
--
--     cohere/north-mini-code:free      249
--     fixture/free-model                42     <- not a model
--     dots-studio/dots-3-note-preview   32
--     gpt-image-1-mini                  24
--     gate5-probe                       15     <- not a model
--
-- `fixture/free-model` and `gate5-probe` are verification harness rows. They
-- would have appeared on Grant's usage dashboard as the second and fifth
-- biggest consumers, and one of them is not a model at all.
--
-- This is the same mistake for the third time in one day, which is the reason
-- for writing it down properly rather than just filtering:
--
--   * `verify:identity` used fixture subjects against a function that excludes
--     fixtures, and failed eleven checks on a feature that works.
--   * `job_impediments` defaulted `is_fixture` to false, so a verification run
--     would have raised proposals asking Grant to buy things.
--   * and now the usage dashboard, where it is most visible of all.
--
-- The rule, stated once: **anything Grant reads must join through `jobs` and
-- filter `not is_fixture`.** `inference_usage.job_id` has been there all along.
--
-- ## Why LEFT JOIN and not JOIN
--
-- Not every model call belongs to a job — a probe during deployment has no
-- `job_id`. An inner join would silently drop those, which is the opposite
-- error: real spend disappearing from a spend report. So the join is left, and
-- a call with no job counts as real, because a call we cannot attribute is
-- still a call we made.
--
-- What that leaves is `gate5-probe`, which has no job and IS harness traffic.
-- It is excluded by name, in one place, with the list stated — a name-based
-- rule that grows quietly is how `not ilike '%verif%'` once missed four
-- patterns and reported 264 harness failures as the office falling over.

begin;

create or replace function app.usage_is_harness(p_model text, p_provider text)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select coalesce(p_model, '') in ('fixture/free-model', 'gate5-probe', 'probe')
      or coalesce(p_model, '') like 'fixture/%'
      or coalesce(p_model, '') like 'gate%-probe'
      or coalesce(p_provider, '') in ('fixture', 'probe')
$$;

comment on function app.usage_is_harness(text, text) is
  'A model call made by the verification suites rather than by the office. '
  'Named in ONE place: a name-based rule that grows quietly is how a previous '
  'one missed four patterns and reported 264 harness failures to Grant as the '
  'office collapsing.';

/*
  Rebuilt with the filter applied everywhere a figure is shown, not only in
  the ranking. Filtering the breakdown and not the total would produce a
  dashboard whose parts do not add up to its headline — which is worse than
  either error alone, because it makes both numbers untrustworthy.
*/
create or replace function app.usage_overview(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  days      integer := greatest(coalesce(p_days, 30), 1);
  head      jsonb;
  services  jsonb;
  top       jsonb;
  spark     jsonb;
  harness   integer;
begin
  select app.free_tier_headroom() into head;

  -- Counted and reported rather than hidden. "We made 1,140 calls of which 57
  -- were our own tests" is honest; silently showing 1,083 invites the question
  -- of where the others went the first time he compares it to something.
  select count(*)::int into harness
    from public.inference_usage u
   where u.occurred_at >= app.now_utc() - make_interval(days => days)
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
      where u.occurred_at >= app.now_utc() - make_interval(days => days)
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
     where coalesce(j.is_fixture, false) = false),

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
    ) from public.mcp_calls c)
  );

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
       where u.occurred_at >= app.now_utc() - make_interval(days => days)
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
       where u.occurred_at >= app.now_utc() - make_interval(days => days)
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
    'by_day', spark
  );
end;
$$;

commit;
