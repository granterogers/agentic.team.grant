-- 0373 — a budget is a number the registry holds, not a zero in the code
--
-- Grant funded the OpenRouter account and asked the office to move off the
-- free tier onto a low-cost paid model: better instruction following, better
-- tool calling, cost still negligible at his measured volume.
--
-- This migration does NOT remove an enforcement layer. Master spec section 11
-- has four, and every one of them was hardcoded to zero because the office had
-- never had money. Each now compares against a number held here, on the
-- provider row, defaulting to zero -- so a provider nobody has funded behaves
-- exactly as it did this morning, and the one Grant funded behaves as he asked.
--
-- Three columns, three different units, deliberately not merged:
--
--   max_price_prompt / max_price_completion  US dollars per MILLION tokens.
--       This is the unit OpenRouter's provider.max_price speaks. It refuses an
--       endpoint BEFORE it runs, with a 404, which is the only layer that can
--       stop a charge rather than report one.
--   max_cost_per_call_usd                    US dollars for ONE response.
--       This is the unit usage.cost speaks, checked after the response. It is
--       a tripwire on a single call, not a spend limit; the spend limit is the
--       cap on the key itself.
--
-- Comparing a per-million ceiling against a per-call charge is how a
-- thousandfold overspend passes a check that looks present, which is why they
-- are separate columns with their units in the names and in these comments.

alter table public.providers
  add column if not exists max_price_prompt      numeric not null default 0,
  add column if not exists max_price_completion  numeric not null default 0,
  add column if not exists max_cost_per_call_usd numeric not null default 0;

alter table public.providers
  add constraint providers_budget_non_negative
  check (max_price_prompt >= 0 and max_price_completion >= 0 and max_cost_per_call_usd >= 0);

comment on column public.providers.max_price_prompt is
  'Layer 1 ceiling on prompt tokens, US dollars per MILLION tokens. Zero means '
  'free endpoints only, which is the default and was the only behaviour before 0373.';
comment on column public.providers.max_price_completion is
  'Layer 1 ceiling on completion tokens, US dollars per MILLION tokens.';
comment on column public.providers.max_cost_per_call_usd is
  'Layer 4 ceiling on ONE response, US dollars. Not a spend limit -- a tripwire '
  'sized so a routine answer never approaches it and a mis-route cannot complete quietly.';

-- ---------------------------------------------------------------------------
-- Which model is tried FIRST, said out loud
-- ---------------------------------------------------------------------------
--
-- usable_models ordered by provider priority and then by model_id, which is
-- alphabetical. That was harmless while every model was an interchangeable
-- free one. It is not harmless now: alphabetical order would put
-- cohere/north-mini-code:free ahead of openai/gpt-oss-120b and the office
-- would spend its first two attempts on models it has deliberately moved off.
--
-- A tiebreak that is really a coin flip has already cost this repository a day
-- (0361, order by uuid). The order in which models are tried is a decision, so
-- it gets a column.

alter table public.provider_models
  add column if not exists priority integer not null default 100;

comment on column public.provider_models.priority is
  'Order models are tried in within one provider, lowest first. Default 100. '
  'Set it deliberately: before 0373 the order was alphabetical by model_id, '
  'which is a tiebreak masquerading as a decision.';

create or replace view public.usable_models as
  select m.provider, m.model_id, m.pricing_prompt, m.pricing_completion,
         m.last_success_at, p.priority, p.base_url, p.secret_ref,
         m.priority as model_priority
  from public.provider_models m
  join public.providers p on p.provider = m.provider
  where m.status = 'usable'
    and p.enabled
    -- Under free_only, zero-priced is required IN ADDITION to a successful
    -- probe. Belt and braces: a probe proves callable, pricing proves free.
    -- With free_only false the probe still has to have happened -- what
    -- changes is that "executed at zero cost" becomes "executed within the
    -- budget above", never "listed in the catalogue".
    and (not p.free_only or (m.pricing_prompt = '0' and m.pricing_completion = '0'))
  order by p.priority, m.priority, m.model_id;

-- ---------------------------------------------------------------------------
-- The switch itself
-- ---------------------------------------------------------------------------
--
-- Chosen model: openai/gpt-oss-120b. Listed 2026-09-15 at $0.037 per million
-- prompt tokens and $0.170 per million completion tokens.
--
-- Probed 2026-09-15 12:24 UTC with allow_fallbacks false and
-- data_collection deny, the office's real posture:
--
--   http 200, served openai/gpt-oss-120b, 3.1s
--   124 prompt + 183 completion tokens, usage.cost 0.00003483
--   answered a two-part instruction correctly, including acknowledging the
--   constraint it had been given -- which is the shape issue #242 is about.
--
-- Two alternatives were probed in the same run and rejected on evidence:
--   google/gemini-2.5-flash-lite  404, no endpoint satisfies the price ceiling
--                                 under data_collection deny
--   openai/gpt-5-nano             worked, correct, and 4.8x the cost for the
--                                 same answer (0.00016835 on a shorter prompt)
--
-- The ceilings below are roughly five times the chosen model's listed price,
-- which leaves room for a same-class replacement and still refuses everything
-- in the tier above. The per-call ceiling is a hundredfold headroom over a
-- measured turn.

update public.providers
set free_only             = false,
    max_price_prompt      = 0.20,
    max_price_completion  = 1.00,
    max_cost_per_call_usd = 0.01,
    notes                 = 'Primary router. Funded 2026-09-15: low-cost paid '
                            'models within the budget columns. openrouter/auto '
                            'and auto:free still report -1 and remain denied (section 11).'
where provider = 'openrouter';

insert into public.provider_models
  (provider, model_id, status, pricing_prompt, pricing_completion, priority, last_success_at)
values
  ('openrouter', 'openai/gpt-oss-120b', 'usable', '0.000000037', '0.00000017', 10, now())
on conflict (provider, model_id) do update
  set status             = 'usable',
      pricing_prompt     = excluded.pricing_prompt,
      pricing_completion = excluded.pricing_completion,
      priority           = excluded.priority,
      last_success_at    = excluded.last_success_at,
      consecutive_failures = 0,
      last_error         = null;

-- The free models stay exactly as they are, at the default priority 100, so
-- they remain the fallback when the paid model is rate-limited or erroring.
-- Nothing about the frozen free-model candidate is deleted: restoring it is
-- `update public.providers set free_only = true, max_price_prompt = 0,
--  max_price_completion = 0, max_cost_per_call_usd = 0 where provider =
--  'openrouter'`, which makes the paid model fail the usable_models predicate
--  and hands the office straight back to the free tier.
