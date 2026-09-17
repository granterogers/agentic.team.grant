# ADR-0029 — the office runs on a paid model, inside a budget the registry holds

- **Status:** accepted
- **Date:** 2026-09-15
- **Supersedes in part:** ADR-0009 (measured free-model allow-list), which
  stands except where it says "free"

## Context

The office had run since day one on OpenRouter's free tier. That was the right
call while nothing was funded, and master spec §11 built four enforcement
layers to keep it honest. Every one of them was hardcoded to **zero**.

Two things forced the question on 2026-09-15.

The free tier ran out. 1,014 calls in a day — test load, against a measured
real peak of 48 — exhausted the free-model daily allowance, and the acceptance
run that decides whether Grant can start using the office daily could not
happen. Adding $10 of credit raised the tier from 50 to 1,000 requests a day
and did **not** refill the spent counter, so the block stood until midnight UTC.

The deeper reason is quality. Every free model on that tier is a small
reasoning model, and the office's two hardest open problems — following a
multi-clause instruction without silently dropping a clause, and acknowledging
a constraint it was given (#242) — are exactly the things those models are
worst at. Grant asked to move to a low-cost paid model prioritising instruction
following, tool calling and agentic performance.

## Decision

**The budget becomes a number the registry holds, and the four layers compare
against it.** No layer is removed. Three columns on `public.providers`:

| Column | Unit | Layer |
|---|---|---|
| `max_price_prompt` | USD per **million** prompt tokens | 1, refuses an endpoint before it runs |
| `max_price_completion` | USD per **million** completion tokens | 1 |
| `max_cost_per_call_usd` | USD for **one** response | 4, refuses a response after it arrives |

All three default to **0**, so a provider nobody has funded behaves exactly as
it did before this change. `free_only` already existed and does the rest.

`assertResponseWasFree` becomes `assertResponseWithinBudget(model, usage,
ceilingUsd = 0)`. The default reproduces the old behaviour exactly. The half
that does **not** relax is the unverifiable case: a provider that reports no
cost is still refused, and more firmly than before, because an unreported
charge against a funded key is a charge nobody can see.

**The model chosen is `openai/gpt-oss-120b`**, at $0.037 / $0.170 per million
prompt / completion tokens. `qwen/qwen3.7-flash` and
`mistralai/mistral-small-3.2-24b-instruct` sit behind it as fallbacks, from
three different families with three different upstream host sets.

**Which model is tried first stops being alphabetical.** `usable_models`
ordered by provider priority and then `model_id`, which was a tiebreak
masquerading as a decision — harmless while every model was an interchangeable
free one, and not harmless when it decides both quality and money.
`provider_models.priority` makes it a decision.

**`allow_fallbacks` follows the budget**: false at zero, true once a ceiling
exists. This reads like a safeguard being relaxed and is the opposite. The flag
chooses among the upstream **hosts** serving one model; it has never been able
to change which **model** answers, because that is the top-level `models` array
and this office does not send one. The hazard it was written for was "a refused
free model lands on a host that charges", and with `max_price` at zero the flag
*was* the price bound. Now the price bound is the price bound.

## Consequences

**Cost.** At the measured busiest real day — 46 calls, 81,943 prompt and 30,432
completion tokens — **$0.0082/day, about $0.25/month**. Five times that traffic
is $1.23/month. A day at the full 1,000-call test load is $4.92/month. The $10
already on the account covers roughly 1,200 days at the measured rate. The
~£0/month constraint survives; it is now ~£0.20/month.

**Availability improved, and this was measured, not assumed.** Pinned to its
cheapest upstream host, the chosen model returned `429 queue_timeout` from
AkashML; the identical request with fallbacks allowed and the same ceiling was
served by Groq at http 200. A paid model pinned to one host has a free model's
availability, which is most of what the money was spent to leave behind.
`verify:router` then found the second half of the same hole — inject a failure
on the first candidate and the next two were exhausted free models — which is
what the two paid fallbacks are for.

**The free-model candidate is preserved, not deleted.** The frozen GREEN
candidate (commit `6de6dfc`, worker v364, 372 migrations) is tagged
`candidate-green-free-v364`, and the free models remain in the registry at
priority 100. Restoring it is `update public.providers set free_only = true,
max_price_prompt = 0, max_price_completion = 0, max_cost_per_call_usd = 0 where
provider = 'openrouter'` — that one statement makes every paid model fail the
`usable_models` predicate and hands the office back to the free tier, whatever
is deployed.

**What this does not settle.** The acceptance evidence gathered so far
describes the free-model configuration. Evidence for a configuration Grant does
not run is evidence for the wrong thing — this repository has three recorded
instances of a suite passing because it was pointed somewhere other than the
deployed product. Whether to re-freeze the candidate on the paid model and run
the hostile corpus against that is his call, and it is recorded in the
candidate-build note rather than decided here.

## Alternatives rejected

**Stay on the free tier and wait for midnight.** Free, and it leaves both the
quality problem and the daily cliff in place during human beta.

**A frontier model.** Claude Haiku 4.5 is $0.245/day at this volume — still
small, and twenty-nine times the chosen model for a workload whose hard parts
are instruction-following rather than reasoning depth. Worth revisiting if
measured answer quality says so; not worth assuming.

**`google/gemini-2.5-flash-lite`.** Probed in the same run and refused with
`404 No endpoints found that satisfy the max price` under `data_collection:
deny`. The privacy posture is not negotiable for a price.

**`openai/gpt-5-nano`.** Worked, answered correctly, and cost 4.8× the chosen
model for the same answer.
