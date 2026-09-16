begin;

-- ---------------------------------------------------------------------------
-- 0394 - a model is chosen on what it has actually done, per kind of work (#127)
--
-- Grant's statement of the gap: *"`usable_models` picks by cost, free models
-- first. That is the right default and an incomplete rule: NOTHING RECORDS THAT
-- A PARTICULAR MODEL IS RELIABLY WRONG AT A PARTICULAR KIND OF WORK."*
--
-- The office's own data, before any of this was built:
--
--     office.instruction | dots-3-note-preview:free |  211 tried |  17% good
--     office.instruction | ling-3.0-flash-fin:free  |  174 tried |  30% good
--     office.instruction | qwen3.7-flash            |   23 tried |   0% good
--     office.instruction | north-mini-code:free     |  799 tried |  74% good
--     office.instruction | gpt-oss-120b             |  237 tried |  89% good
--
-- Four hundred calls on the office's MAIN job kind went to models that fail it
-- four times in five, and the router went on choosing them because they cost
-- nothing. And the same model differs by kind - `north-mini-code:free` is 94%
-- on `knowledge.read_source` and 74% on `office.instruction` - which is why the
-- record is per (model, KIND) and one aggregate number would hide it.
--
-- ## Derived, not stored
--
-- `inference_usage` already holds the model, the outcome and the job;
-- `public.jobs` holds the kind. The record is a JOIN, and CLAUDE.md is explicit
-- about what a second copy costs: `public.relations` had never held a row while
-- six columns held the same facts, and 0303/0304 are the pair about a
-- denormalised copy that froze and then lied. So there is no `model_outcomes`
-- table here. Nothing to backfill, nothing to keep in step, and the record
-- cannot disagree with the calls it is made of.
--
-- ## Which outcomes are the MODEL's fault
--
-- The distinction that makes this measurement honest rather than a number with
-- a decimal point:
--
--   * `ok`, `empty_completion`, `malformed_response` - the provider answered
--     and the MODEL did or did not do the work. These count.
--   * `rate_limited`, `provider_error`, `transport_error`, `unavailable`,
--     `refused_paid` - the provider or one of our own guards, not the model's
--     competence. These are EXCLUDED, because an outage that damns a model for
--     ever is a worse router than no measurement at all.
--
-- It matters: excluding them moves `qwen3.7-flash` from 58% to 100% on untyped
-- calls while leaving it at 0% of 23 on `office.instruction`, and moves
-- `gpt-oss-120b` from 87% to 100%. The rate limits were being counted as
-- incompetence.
--
-- An outcome named in NEITHER list is not counted. That is the cheap direction
-- of being wrong, and `verify:routing-quality` reads the CHECK constraint and
-- fails if any permitted outcome is unclassified - so adding one without
-- deciding what it means goes red rather than quietly becoming invisible.
--
-- ## Quality may DEMOTE and may never PROMOTE
--
-- The ordering is the registry's - `providers.priority`, then
-- `provider_models.priority`, then the model id - with exactly one thing
-- inserted: a model with a poor record for THIS kind goes to the back of its
-- own price class.
--
-- Free stays ahead of paid unconditionally. Grant's words: *"The £0 constraint
-- is not a tiebreak. A measured-quality router that quietly starts preferring
-- paid models has broken a hard constraint, not optimised a soft one."* So a
-- demoted FREE model is still tried before any paid one, and nothing here can
-- cause a paid call that would not have happened anyway.
--
-- ## Exploration is staleness, not a coin flip
--
-- *"A model that is never chosen can never improve its record."* True, and the
-- issue suggests reserving a share of runs at random. This does it by AGE
-- instead: a demoted model is returned to its normal place once its last
-- attributable call is older than the explore window, so it gets a turn, its
-- record updates, and it climbs back out if it has improved.
--
-- Deterministic on purpose. 0361 is this repository's lesson about a random
-- tiebreak: `verify:agents` scored 56/56 and then 55/56 against identical code
-- and both runs were honest. A router whose choice cannot be reproduced is one
-- nobody can debug, and a quality measure built on it is a coin flip with a
-- decimal point - the exact thing #127 says not to build.
-- ---------------------------------------------------------------------------

/*
  What every model has actually done, per kind of work.

  Harness traffic is excluded through `app.harness_job` (0355), which DERIVES
  the answer rather than trusting a flag that can be frozen wrong - the third
  time that mattered, it was 85 jobs whose project was a fixture and whose own
  flag said real.

  A call with no job at all is kept, under the kind `(unattributed)`. Those are
  real calls that really succeeded or failed; dropping them would make the
  totals disagree with `inference_usage` for no reason, and naming them says
  what they are instead of pretending they are something else.
*/
create or replace view public.model_record as
  select u.provider,
         u.model_id,
         coalesce(j.kind, '(unattributed)')                                  as kind,
         count(*)                                                            as tried,
         count(*) filter (where u.outcome = 'ok')                            as good,
         round(count(*) filter (where u.outcome = 'ok')::numeric
               / nullif(count(*), 0), 4)                                     as rate,
         max(u.occurred_at)                                                  as last_tried_at
    from public.inference_usage u
    left join public.jobs j on j.job_id = u.job_id
   where u.outcome in ('ok', 'empty_completion', 'malformed_response')
     and (u.job_id is null or not app.harness_job(u.job_id))
   group by u.provider, u.model_id, coalesce(j.kind, '(unattributed)');

comment on view public.model_record is
  'What each model has actually done, per kind of work (#127, 0394). Derived '
  'from inference_usage joined to jobs - there is no stored copy, because a '
  'copy is the thing that rots. Only outcomes the MODEL is answerable for are '
  'counted: ok, empty_completion and malformed_response. A rate limit or an '
  'outage is the provider failing, not the model being bad at the work.';

/*
  The order to try models in, for one kind of work.

  Everything the router needs to make and explain its choice, so that the
  ordering and the reason cannot drift apart - they are one row.
*/
create or replace function app.model_order(
  p_kind          text,
  p_window_days   integer default 30,
  p_min_tried     integer default 20,
  p_floor         numeric default 0.50,
  p_explore_hours integer default 24
)
returns table (
  provider           text,
  model_id           text,
  pricing_prompt     text,
  pricing_completion text,
  base_url           text,
  secret_ref         uuid,
  is_free            boolean,
  tried              bigint,
  good               bigint,
  rate               numeric,
  standing           text,
  why                text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with seen as (
    select r.provider, r.model_id, r.tried, r.good, r.rate, r.last_tried_at
      from public.model_record r
     where r.kind = p_kind
       and r.last_tried_at >= app.now_utc() - make_interval(days => greatest(p_window_days, 1))
  ),
  judged as (
    select m.provider,
           m.model_id,
           m.pricing_prompt,
           m.pricing_completion,
           m.base_url,
           m.secret_ref,
           m.priority       as provider_priority,
           m.model_priority,
           (m.pricing_prompt = '0' and m.pricing_completion = '0') as is_free,
           coalesce(s.tried, 0) as tried,
           coalesce(s.good, 0)  as good,
           s.rate,
           case
             /*
               Not enough evidence to hold anything against it. An unproven
               model keeps its registry place, which is also how it earns a
               record in the first place.
             */
             when coalesce(s.tried, 0) < greatest(p_min_tried, 1) then 'unproven'
             when s.rate >= p_floor then 'good'
             /*
               Poor, but not tried lately - give it a turn. This is the whole
               of the exploration rule, and it is why a bad afternoon cannot
               retire a model permanently.
             */
             when s.last_tried_at < app.now_utc() - make_interval(hours => greatest(p_explore_hours, 1))
               then 'exploring'
             else 'poor'
           end as standing
      from public.usable_models m
      left join seen s
        on s.provider = m.provider and s.model_id = m.model_id
  )
  select j.provider,
         j.model_id,
         j.pricing_prompt,
         j.pricing_completion,
         j.base_url,
         j.secret_ref,
         j.is_free,
         j.tried,
         j.good,
         j.rate,
         j.standing,
         case j.standing
           when 'unproven' then
             format('no record yet for %s (%s of %s calls needed)',
                    p_kind, j.tried, greatest(p_min_tried, 1))
           when 'good' then
             format('%s%% good on %s over %s calls',
                    round(j.rate * 100), p_kind, j.tried)
           when 'exploring' then
             format('%s%% good on %s over %s calls, but untried for %s hours - taking a turn to see if it has improved',
                    round(j.rate * 100), p_kind, j.tried, greatest(p_explore_hours, 1))
           else
             format('%s%% good on %s over %s calls, below the %s%% floor - tried last%s',
                    round(j.rate * 100), p_kind, j.tried, round(p_floor * 100),
                    case when j.is_free then ' of the free models' else '' end)
         end as why
    from judged j
   order by j.provider_priority,
            /*
              Free before paid, unconditionally and OUTSIDE the quality term.
              A demoted free model is still tried before a good paid one; a
              measured-quality router that reaches for a paid model has broken
              a hard constraint rather than optimised a soft one.
            */
            j.is_free desc,
            (case when j.standing = 'poor' then 1 else 0 end),
            j.model_priority,
            j.model_id;
$$;

comment on function app.model_order(text, integer, integer, numeric, integer) is
  'Which models to try for one kind of work, in order, each with the reason '
  '(#127, 0394). Quality may only DEMOTE, and only within a price class: free '
  'stays ahead of paid whatever the records say. A poor model is returned to '
  'its normal place once it has been untried for the explore window, so a bad '
  'afternoon cannot retire it for ever.';

create or replace function public.model_order(
  p_kind          text,
  p_window_days   integer default 30,
  p_min_tried     integer default 20,
  p_floor         numeric default 0.50,
  p_explore_hours integer default 24
)
returns table (
  provider           text,
  model_id           text,
  pricing_prompt     text,
  pricing_completion text,
  base_url           text,
  secret_ref         uuid,
  is_free            boolean,
  tried              bigint,
  good               bigint,
  rate               numeric,
  standing           text,
  why                text
)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select * from app.model_order(p_kind, p_window_days, p_min_tried, p_floor, p_explore_hours)
$$;

revoke all on function public.model_order(text, integer, integer, numeric, integer) from public;
grant execute on function public.model_order(text, integer, integer, numeric, integer) to service_role;

commit;
