-- What everything is costing, in one place, with its denominator.
--
-- Issue #61. Grant:
--
--     "a dashboard dedicated to usage across the various API keys, third party
--      services, you know, everything... a fraction of what's being spent over,
--      like, a monthly, weekly, daily quota... and if it can be broken down
--      into what's being consumed the most."
--
-- ## A fraction, not a number
--
-- He asked for fractions three times over. That is the design constraint: a
-- figure with no denominator cannot be acted on. "1,284 model calls" is a
-- number; "1,284 calls, all on free models, £0.00 against a ~£0 target" is an
-- answer. So every service here reports `used`, `limit` and `of_limit`, and a
-- service with no meaningful ceiling says so rather than inventing one.
--
-- ## Every figure carries its provenance
--
-- Until this morning the Settings page claimed "Supabase storage is at 82% of
-- the free tier — 412 MB of 500 MB". Nobody measured it. The real numbers are
-- 6.3% and 4%. It was written to make a mock look realistic and it was the
-- single most consequential number on the page.
--
-- A usage dashboard is ENTIRELY numbers, so the same failure would be the whole
-- feature. `provenance` is therefore not optional metadata — it is rendered:
--
--   measured   we counted it, from our own rows
--   reported   the provider told us
--   estimated  our own count of something the provider does not publish
--
-- The notebook allowance is the live example of the third: 40 units per
-- five-hour window is OUR guess, because Google exposes no usage API. A
-- briefing already turned that into a bare "35/40 left" once today, which is
-- exactly how an estimate becomes a fact.
--
-- ## One projection, not two
--
-- `web/hq` has cost, usage and trends tabs and the studio is getting a usage
-- tab. Two projections would give two answers to "what did we spend", and the
-- one Grant would find out about is the day they disagree.

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
    -- ---------------------------------------------------------------------
    -- Models. The only line that could ever carry real money.
    -- ---------------------------------------------------------------------
    (select jsonb_build_object(
      'key', 'openrouter',
      'name', 'Model calls',
      'detail', 'OpenRouter, free tier',
      -- Spend is the meaningful measure here, not calls: a thousand free calls
      -- cost the same as none, and the number that would change his mind is
      -- the first one that is not zero.
      'unit', 'usd',
      'used', round(coalesce(sum(u.cost_usd), 0)::numeric, 6),
      'limit', null,
      'of_limit', null,
      'secondary', jsonb_build_object(
        'calls', count(*),
        'tokens', coalesce(sum(u.prompt_tokens + u.completion_tokens), 0),
        'failed', count(*) filter (where u.outcome <> 'ok')
      ),
      -- Our own arithmetic from `model_prices` versus what the provider said.
      -- The two disagreeing is worth knowing and is invisible if only one is
      -- shown.
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

    -- ---------------------------------------------------------------------
    -- Notebook. The one with a real ceiling, and an estimated one.
    -- ---------------------------------------------------------------------
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
      -- The important one. See the header.
      'provenance', 'estimated',
      'note', 'Our own count. Google publishes no usage figure for this.',
      'day', coalesce(sum(s.units) filter
             (where s.occurred_at >= app.now_utc() - interval '1 day'), 0),
      'week', coalesce(sum(s.units) filter
              (where s.occurred_at >= app.now_utc() - interval '7 days'), 0),
      'month', coalesce(sum(s.units) filter
               (where s.occurred_at >= app.now_utc() - interval '30 days'), 0)
    ) from public.notebook_spend s),

    -- ---------------------------------------------------------------------
    -- Speech. A published allowance, so a real fraction.
    -- ---------------------------------------------------------------------
    (select jsonb_build_object(
      'key', 'tts',
      'name', 'Speech',
      'detail', 'Google Chirp 3',
      'unit', 'characters',
      'used', coalesce(sum(t.characters) filter
              (where t.billing_month = to_char(app.now_utc(), 'YYYY-MM')), 0),
      'limit', 1000000,
      'of_limit', null,
      'window', 'this month',
      'secondary', jsonb_build_object('failed', count(*) filter (where t.failed)),
      -- Counted by us against an allowance Google publishes. The allowance is
      -- theirs; the count is ours, and Google exposes no live counter.
      'provenance', 'measured',
      'note', 'Counted by us — Google exposes no live counter for Chirp 3.',
      'day', coalesce(sum(t.characters) filter
             (where t.created_at >= app.now_utc() - interval '1 day'), 0),
      'week', coalesce(sum(t.characters) filter
              (where t.created_at >= app.now_utc() - interval '7 days'), 0),
      'month', coalesce(sum(t.characters) filter
               (where t.created_at >= app.now_utc() - interval '30 days'), 0)
    ) from public.tts_usage t),

    -- ---------------------------------------------------------------------
    -- Supabase, both halves. Measured directly by 0180.
    -- ---------------------------------------------------------------------
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

    -- ---------------------------------------------------------------------
    -- The tool surface. No ceiling, but "nothing is calling it" is a fact
    -- worth seeing rather than an empty panel.
    -- ---------------------------------------------------------------------
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

  /*
    What is eating it — his "broken down into what's being consumed the most".

    Ranked by MODEL, not by service, because the service answer is already on
    the cards above and would just repeat them. This is the level at which a
    person can act: switch a model, or stop asking for the thing that uses it.
  */
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

  /*
    A shape for the chart, and only a shape a number could not carry.

    §14A forbids a decorative chart, and a sparkline of a flat zero would be
    exactly that. So this is calls per day — which does vary, does show when
    the office was busy, and is the one series here with anything to say.
  */
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

comment on function app.usage_overview(integer) is
  'Every service, with its denominator and its provenance (#61). One '
  'projection so the studio and the build page cannot give two answers to '
  '"what did we spend".';

create or replace function public.usage_overview(p_days integer default 30)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.usage_overview(p_days) $$;

commit;
