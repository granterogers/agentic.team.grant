-- 0047 — the numbers over time
--
-- §25 asks for charts, and `hq_usage` had only current values. A single number
-- answers "how much"; it cannot answer "is this normal", which is the question
-- somebody glancing at a dashboard is usually actually asking.
--
-- A dense series, not a sparse one: `generate_series` produces every day in the
-- window and the counts are left-joined onto it, so a day with no activity is a
-- zero rather than a missing point. A sparkline drawn from sparse rows draws a
-- straight line across a quiet week and makes it look busy — the shape lies,
-- and it lies in the reassuring direction.
--
-- 30 days, in Grant's timezone rather than UTC (0043). A chart of days has to
-- agree with the person about where a day ends, and he is UTC+3.

begin;

create or replace function app.hq_series(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
        where sent_at is not null
        group by 1
      ) m on m.day = d.day
    ), '[]'::jsonb)
  );
$$;

create or replace function public.hq_series(p_days integer default 30)
returns jsonb language sql security definer set search_path = '' as $$ select app.hq_series(p_days) $$;

revoke all on function public.hq_series(integer) from public;
grant execute on function app.hq_series(integer) to ai_team_app, service_role;
grant execute on function public.hq_series(integer) to service_role;

commit;
