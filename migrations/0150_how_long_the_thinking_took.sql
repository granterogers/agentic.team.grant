-- How long the thinking took.
--
-- Grant asked for a reply inside a minute on Telegram and Slack. Measured
-- today: 57 seconds and 67. The queue wait was part of it and 0149 fixed that;
-- the rest — forty seconds and more — is one model call.
--
-- Every model in the allow-list is an OpenRouter `:free` variant, which is
-- config A of the open decision D2 that has never been settled. Free models
-- are queued behind paying traffic, and their latency is neither published nor
-- stable: one call today took five and a half minutes.
--
-- ## Why measure before choosing
--
-- Because "free models are slow" is not actionable and "this model answers in
-- 9 seconds and that one in 90" is. There are seven usable models and nothing
-- has ever recorded how long any of them takes, so the router picks by a
-- static priority that encodes nobody's measurement.
--
-- `latency_ms` on the usage row is the missing fact. Once a few hundred calls
-- have gone through it, the router can prefer the fast one for work somebody
-- is waiting on and leave the slow one for the overnight duties — which costs
-- nothing and needs no decision from Grant.
--
-- Nullable, because every row written before this migration has no answer and
-- inventing one would poison the average it exists to produce.

begin;

alter table public.inference_usage
  add column if not exists latency_ms integer;

comment on column public.inference_usage.latency_ms is
  'Wall-clock milliseconds for this attempt, request to last byte. Null for '
  'rows written before 0150 and for anything that failed before it was sent. '
  'The basis for preferring a fast model when somebody is waiting.';

-- What each model actually costs in time. Deliberately a view over recent
-- rows: a model that was fast last month and is queued today should read as
-- slow today.
create or replace function app.model_speed(p_days integer default 7)
returns table (
  model_id text,
  attempts integer,
  median_ms integer,
  worst_ms integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.model_id,
         count(*)::int as attempts,
         (percentile_cont(0.5) within group (order by u.latency_ms))::int as median_ms,
         max(u.latency_ms)::int as worst_ms
    from public.inference_usage u
   where u.latency_ms is not null
     and u.outcome = 'ok'
     and u.occurred_at > app.now_utc() - make_interval(days => greatest(1, p_days))
   group by u.model_id
   order by 3
$$;

comment on function app.model_speed(integer) is
  'Median and worst latency per model over recent successful calls. The '
  'measurement behind any future decision about which model answers Grant.';

grant execute on function app.model_speed(integer) to ai_team_app;

create or replace function public.model_speed(p_days integer default 7)
returns table (model_id text, attempts integer, median_ms integer, worst_ms integer)
language sql stable security definer set search_path = public, pg_catalog
as $$ select * from app.model_speed(p_days) $$;

commit;
