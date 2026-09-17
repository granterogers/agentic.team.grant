-- `tts_usage.billing_month` is a date, not a string.
--
-- Issue #61. 0191 compared it to `to_char(now, 'YYYY-MM')`:
--
--     ERROR: operator does not exist: date = text
--
-- Which is the trap already written down in CLAUDE.md — *"Guessing column names
-- wastes hours. Query information_schema first"* — in its other form: the name
-- was right and the TYPE was guessed. `billing_month` reads like a string and
-- is a date, and the difference is invisible until the function runs.
--
-- It also failed in the good way, at the first call rather than silently
-- returning a wrong month, because a type error cannot be quietly true.

begin;

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
begin
  select app.free_tier_headroom() into head;

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
        'failed', count(*) filter (where u.outcome <> 'ok')
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
      where u.occurred_at >= app.now_utc() - make_interval(days => days)),

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
    ) from public.notebook_spend s),

    (select jsonb_build_object(
      'key', 'tts',
      'name', 'Speech',
      'detail', 'Google Chirp 3',
      'unit', 'characters',
      -- `billing_month` is a DATE. Truncating both sides rather than
      -- formatting one of them into a string, so the comparison stays an index
      -- -usable date comparison and cannot drift on locale.
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
      'window', 'now',
      'provenance', 'measured',
      'note', null,
      'secondary', jsonb_build_object('largest', head -> 'largest')
    ),
    jsonb_build_object(
      'key', 'supabase_storage', 'name', 'File storage', 'detail', 'Supabase, free tier',
      'unit', 'bytes',
      'used', (head -> 'storage' ->> 'bytes')::bigint,
      'limit', (head -> 'storage' ->> 'limit_bytes')::bigint,
      'of_limit', (head -> 'storage' ->> 'percent')::numeric,
      'window', 'now',
      'provenance', 'measured',
      'note', null,
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
       where u.occurred_at >= app.now_utc() - make_interval(days => days)
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
       where u.occurred_at >= app.now_utc() - make_interval(days => days)
       group by 1
    ) d;

  return jsonb_build_object(
    'generated_at', app.now_utc(),
    'window_days', days,
    'target', 'about £0 / month',
    'services', services,
    'top_models', top,
    'by_day', spark
  );
end;
$$;

commit;
