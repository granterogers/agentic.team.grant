-- 0118 — What each outcome actually costs
--
-- Grant: *"Cost per outcome. Yes. This is... I want this for sure. You can show
-- it graphically as well as numerically on the front end."*
--
-- Building it turned up three defects first, and they are worth writing down
-- because two of them made the obvious version of this page a liar.
--
-- ## 1. `inference_usage.job_id` was almost never written
--
-- 49 rows out of 172, and every one of those 49 came from two avatar-generation
-- scripts that passed it by hand. The router — the single place every
-- production model call goes through — never passed it at all, because its
-- private `account()` helper took a `correlationId` and nothing else. So the
-- natural query, "join usage to jobs on job_id and group by kind", returned
-- zero calls for every kind of work the team actually does. Fixed in
-- `src/providers/router.ts` (the request now carries `jobId`), which fixes it
-- going forward and does nothing for the 123 rows already written.
--
-- ## 2. A correlation id is a thread, not a job
--
-- The tempting repair is to attribute historic rows by `correlation_id`. That
-- is wrong and this migration does not do it: a parent job and every child it
-- spawns share one correlation id, so attributing a call to "the job with that
-- correlation id" would multiply one call across every job in the thread. Rows
-- with no `job_id` are counted at THREAD grain and reported separately, under
-- `unattributed_calls`. A number with a stated coverage is usable; the same
-- number with the gap hidden is not.
--
-- ## 3. Every row costs exactly $0.00, and that is correct
--
-- Layer 4 of the router (`assertResponseWasFree`) throws if a provider reports
-- a non-zero cost, so a paid call cannot complete. Every one of the 172 rows
-- has `cost_usd = 0` because every call really was free. A "cost per outcome"
-- page that displays $0.00 across the board is therefore accurate and useless.
--
-- So this reports both figures §11 distinguishes:
--
--   * MEASURED — `spent_usd`, what was actually charged. Currently always zero,
--     and it must keep being shown, because the day it stops being zero is the
--     day someone needs to know.
--   * MODELLED — `modelled_usd`, what the same tokens would have cost on a
--     named paid model, from a price table. This is the number that answers
--     "what would it cost to run this off the free tier", which is the question
--     behind the request.
--
-- The two are separate columns with separate names and never summed together.
-- §11: a modelled figure presented as a measured one is the specific error.

begin;

/**
 * Published per-token prices, so a token count can be turned into money.
 *
 * A table rather than a constant in the code because prices change without
 * asking us, and because the front end has to be able to show WHERE a figure
 * came from. `source_url` is not decoration — a modelled cost whose price
 * nobody can check is a number with a dollar sign in front of it.
 *
 * `effective_from` keeps history: re-pricing last month's tokens at this
 * month's rate would silently rewrite the past.
 */
create table public.model_prices (
  model_id        text        not null,
  effective_from  timestamptz not null default app.now_utc(),
  input_usd_per_mtok   numeric(12,4) not null check (input_usd_per_mtok  >= 0),
  output_usd_per_mtok  numeric(12,4) not null check (output_usd_per_mtok >= 0),
  -- Where the figure came from, so it can be checked and re-checked.
  source_url      text        not null,
  note            text,
  primary key (model_id, effective_from)
);

comment on table public.model_prices is
  'Published prices per million tokens, used ONLY to produce the modelled cost '
  'column. Never used to produce a measured one: what was actually charged is '
  'in inference_usage.cost_usd and comes from the provider (§11).';

alter table public.model_prices enable row level security;
alter table public.model_prices force  row level security;
grant select on public.model_prices to ai_team_app;
create policy model_prices_app_read on public.model_prices
  for select to ai_team_app using (true);

-- A single fallback row, keyed on the empty model id, used when a model has no
-- published price. Priced at the cheapest broadly-available paid tier rather
-- than at zero: an unknown model costing nothing would make the modelled total
-- fall as coverage got worse, which is exactly backwards.
--
-- `effective_from` is epoch, not now(). The first version defaulted it, which
-- put every seeded price AFTER every usage row already in the table, so
-- `effective_from <= occurred_at` matched nothing and every historic call
-- modelled as null. A price table whose first entry starts today can price
-- nothing that has already happened.
insert into public.model_prices
  (model_id, effective_from, input_usd_per_mtok, output_usd_per_mtok, source_url, note)
values
  ('', 'epoch', 0.1500, 0.6000, 'https://openrouter.ai/models',
   'Fallback for any model with no published price. Deliberately not zero: an '
   'unknown model priced at zero would make the modelled total FALL as price '
   'coverage got worse.'),
  -- The free tier really is free, and saying so is a price, not a missing one.
  -- Without these rows the fallback would apply and the page would model a
  -- charge for calls that could never be charged.
  ('cohere/north-mini-code:free',          'epoch', 0, 0, 'https://openrouter.ai/cohere/north-mini-code:free',        'Free tier.'),
  ('dots-studio/dots-3-note-preview:free', 'epoch', 0, 0, 'https://openrouter.ai/dots-studio/dots-3-note-preview:free','Free tier.'),
  ('inclusionai/ling-3.0-flash-fin:free',  'epoch', 0, 0, 'https://openrouter.ai/inclusionai/ling-3.0-flash-fin:free', 'Free tier.'),
  -- Test doubles. Priced at zero so a verification run cannot move a figure
  -- Grant reads as real spend.
  ('fixture/free-model', 'epoch', 0, 0, 'https://example.invalid/fixture', 'Test fixture, not a real model.'),
  ('gate5-probe',        'epoch', 0, 0, 'https://example.invalid/fixture', 'Test fixture, not a real model.')
on conflict (model_id, effective_from) do nothing;

/**
 * The price in force for a model at a moment.
 *
 * Falls back to the empty-string row rather than to null, so the modelled cost
 * is never null and the caller never has to decide what a missing price means.
 */
create or replace function app.model_price_at(p_model text, p_when timestamptz)
returns public.model_prices
language sql
stable
as $$
  select p.* from public.model_prices p
   where p.model_id in (p_model, '')
     and p.effective_from <= p_when
   -- Exact model beats fallback; newer price beats older.
   order by (p.model_id = '')::int, p.effective_from desc
   limit 1
$$;

grant execute on function app.model_price_at(text, timestamptz) to ai_team_app, service_role;

/**
 * What each kind of work costs, measured and modelled.
 *
 * Grouped by job kind because that is the grain an "outcome" has here: a
 * completed `office.instruction` is one answer to Grant, a completed
 * `research.live` is one piece of research. Per-staff is a second cut of the
 * same rows and is returned alongside rather than as a second function, so the
 * two can never disagree about the window.
 */
create or replace function app.hq_cost_per_outcome(p_days integer default 30)
returns jsonb
language sql
stable
as $$
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
     where u.occurred_at > w.t
  ),
  -- Completed work in the window. Only completed: a cost per outcome divided
  -- by attempts is a cost per attempt, and the two differ most exactly when a
  -- kind of work is going badly, which is when the number matters.
  done as (
    select j.job_id, j.kind, j.correlation_id,
           extract(epoch from (j.finished_at - j.started_at)) as secs
      from public.jobs j
      cross join window_start w
     where j.state = 'complete' and j.finished_at > w.t
  ),
  by_kind as (
    select d.kind,
           count(*)::int                                        as outcomes,
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
           count(*)::int                                   as outcomes,
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
$$;

grant execute on function app.hq_cost_per_outcome(integer) to ai_team_app, service_role;

create or replace function public.hq_cost_per_outcome(p_days integer default 30)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_cost_per_outcome(p_days) $$;

revoke all on function public.hq_cost_per_outcome(integer) from public;
grant execute on function public.hq_cost_per_outcome(integer) to service_role;

commit;
