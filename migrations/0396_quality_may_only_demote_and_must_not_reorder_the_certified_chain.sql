begin;

-- ---------------------------------------------------------------------------
-- 0396 - quality may only demote, and must not reorder the certified chain (#127)
--
-- 0394 put `is_free desc` in front of the registry's own ordering, reasoning
-- from #127's sentence *"The £0 constraint is not a tiebreak"* that free must
-- always be tried before paid. `verify:fallback` went red in five checks and
-- was right to. The registry says:
--
--     openai/gpt-oss-120b                        model_priority  10   paid
--     qwen/qwen3.7-flash                         model_priority  20   paid
--     mistralai/mistral-small-3.2-24b-instruct   model_priority  30   paid
--     ...every free model...                     model_priority 100   free
--
-- That is not an accident and it is not alphabetical: it is the CERTIFIED
-- MODEL CHAIN, named in CLAUDE.md as `gpt-oss-120b -> qwen3.7-flash ->
-- mistral-small-3.2-24b-instruct -> free tier`, and `model_priority` is the
-- column 0373 added so that the chain could be stated rather than stumbled
-- into. #134's budget work funds it deliberately and holds the cost down with
-- a per-call ceiling and a daily allowance - by SPEND, which is the thing
-- Grant actually constrained, not by refusing to reach a paid model at all.
--
-- So `is_free desc` did not protect the £0 rule. It silently moved the whole
-- office off its certified models onto the free tier, which is a change to
-- what the office IS rather than to how it chooses - and it would have been
-- invisible except that one suite restates the ordering on purpose.
--
-- #127 was written on 12 September, before the budget and before
-- certification. Where it and the registry disagree, the registry is the later
-- decision and the one Grant made with the evidence in front of him.
--
-- ## The invariant that replaces it
--
-- **Quality may only DEMOTE.** A model with a poor record for this kind goes
-- to the back; nothing is ever moved forward. That is enough on its own to
-- guarantee what #127 was reaching for, and it is stronger because it does not
-- depend on which models happen to be free:
--
--   * no model is ever tried EARLIER than the registry would have tried it, so
--   * demotion can never cause a paid call that would not have happened anyway,
--     whatever the records say and whichever models are paid.
--
-- `verify:routing-quality` asserts that property directly against the registry
-- order rather than asserting free-before-paid, which was an artefact of the
-- ordering I had just invented.
-- ---------------------------------------------------------------------------

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
             when coalesce(s.tried, 0) < greatest(p_min_tried, 1) then 'unproven'
             when s.rate >= p_floor then 'good'
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
             format('%s%% good on %s over %s calls, below the %s%% floor - moved to the back',
                    round(j.rate * 100), p_kind, j.tried, round(p_floor * 100))
         end as why
    from judged j
   /*
     The registry's order, with exactly one thing inserted: a poor record sends
     a model to the back. Nothing is ever moved FORWARD, so no model is tried
     earlier than the registry would have tried it and a demotion can never
     cause a paid call that would not have happened anyway.

     `provider_priority` stays outermost and `model_priority` keeps its place
     below the quality term, so the certified chain survives intact among every
     model that is not demoted.
   */
   order by j.provider_priority,
            (case when j.standing = 'poor' then 1 else 0 end),
            j.model_priority,
            j.model_id;
$$;

comment on function app.model_order(text, integer, integer, numeric, integer) is
  'Which models to try for one kind of work, in order, each with the reason '
  '(#127, 0394; corrected 0396). Quality may only DEMOTE - a poor record for '
  'this kind goes to the back and nothing is ever moved forward, so no model '
  'is tried earlier than the registry would have tried it and no demotion can '
  'cause a paid call that would not have happened. The certified chain in '
  'model_priority is otherwise untouched. A poor model returns to its place '
  'once untried for the explore window, so a bad afternoon cannot retire it.';

commit;
