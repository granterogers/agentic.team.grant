# ADR-0031 — A model is chosen on what it has actually done, and quality may only demote

**Status:** accepted · 16 September 2026 · Issue #127 · migrations 0394–0396

## Context

Grant's statement of the gap:

> *"`usable_models` picks by cost, free models first. That is the right default
> and an incomplete rule: **nothing records that a particular model is reliably
> wrong at a particular kind of work.** A free model that fails at extraction
> and a free model that is excellent at it are interchangeable to the router."*

And his warning about the obvious fix:

> *"The £0 constraint is not a tiebreak. A measured-quality router that quietly
> starts preferring paid models has broken a hard constraint, not optimised a
> soft one."*

## Decision

### 1. The record is derived, not stored

`public.model_record` is a view over `inference_usage` joined to `jobs`. There
is no `model_outcomes` table. `inference_usage` already holds the model and the
outcome and `jobs` holds the kind, so a second copy would be a fact in two
places — and 0303/0304 are this repository's pair about a denormalised copy
that froze and then lied, while `public.relations` is the one that had never
held a row while six columns held the same facts.

Nothing to backfill, nothing to keep in step, and the record cannot disagree
with the calls it is made of.

### 2. Per `(model, kind)`, because one number hides the common case

`cohere/north-mini-code:free` is 94% on `knowledge.read_source` and 74% on
`office.instruction`. A model good at one thing and poor at another is the
normal case, and an aggregate would average it away.

### 3. Only outcomes the model is answerable for count

| counted | excluded |
|---|---|
| `ok`, `empty_completion`, `malformed_response` | `rate_limited`, `provider_error`, `transport_error`, `unavailable`, `refused_paid` |

The provider failing is not the model being bad at the work, and a router that
conflated them would let one bad afternoon damn a model for ever. It is not a
rounding difference: excluding them moves `qwen/qwen3.7-flash` from 58% to 100%
on unattributed calls while leaving it unchanged where it genuinely failed.

An outcome in neither list is not counted — the cheap direction — and
`verify:routing-quality` reads the CHECK constraint and fails if any permitted
outcome is unclassified, so adding one without deciding what it means goes red
rather than silently becoming invisible.

### 4. Quality may only DEMOTE — this is the whole safety argument

A model with a poor record for this kind goes to the back. **Nothing is ever
moved forward.** Two things follow, and they are stronger than the rule they
replaced:

- no model is tried earlier than the registry would have tried it;
- therefore no demotion can cause a paid call that would not have happened
  anyway — whatever the records say and whichever models happen to be paid.

**0394 got this wrong and `verify:fallback` caught it.** It put `is_free desc`
in front of the registry's order, reading #127's "£0 is not a tiebreak"
literally. But `provider_models.priority` encodes the **certified model
chain** — `gpt-oss-120b → qwen3.7-flash → mistral-small-3.2-24b-instruct → free
tier`, named in CLAUDE.md, funded deliberately by #134's budget and held down
by a per-call ceiling and a daily allowance. Free-first did not protect the
constraint; it silently moved the whole office off its certified models onto
the free tier.

Where #127 (12 September) and the registry disagree, the registry is the later
decision and the one Grant made with the evidence in front of him. The £0
constraint is enforced by **spend** — which is what he actually constrained —
not by refusing to reach a paid model at all.

### 5. Exploration is staleness, not a coin flip

> *"A model that is never chosen can never improve its record."*

True, and the issue suggests reserving a random share of runs. This does it by
age: a demoted model returns to its normal place once its last attributable
call is older than the explore window (24h), gets a turn, and climbs back out
if it has improved.

Deterministic on purpose. 0361 is the lesson — `verify:agents` scored 56/56 and
then 55/56 against identical code because of a random tiebreak, and both runs
were honest. A router whose choice cannot be reproduced is one nobody can
debug, and a quality measure built on it is a coin flip with a decimal point:
exactly what #127 says not to build.

### 6. One assembler, and the reason travels with the order

`app.model_order` returns the list already ordered, each row carrying `why`.
The router does not re-sort — it previously restated the view's `ORDER BY`,
because a view's ordering does not survive being selected from, and the two
copies then disagreed. `verify:fallback` restated it a third time and now asks
the same function.

The chosen model and its reason go into `job_traces` as a `decision` step,
written from the same row the order came from, so the explanation cannot drift
from the decision. Proved end to end on a real job:

```json
{"chose": "openai/gpt-oss-120b",
 "because": "no record yet for office.instruction (12 of 20 calls needed)"}
```

## Consequences

- **Nothing is demoted today**, and that is the mechanism working. On real
  traffic the whole `office.instruction` record is 105 calls at 91%, 12 at 92%
  and 9 at 78% — nothing meets the twenty-call floor at a failing rate.
- **The alarming numbers were harness traffic.** 0394's own header quoted raw
  `inference_usage` — 211 calls at 17% — and the view it created excludes
  harness jobs, which makes the same row 9 calls at 78%. 0395 records the
  correction. This was the fifth time harness traffic was about to be reported
  as the office failing and the first time it happened inside a feature built
  to measure the office, which is the worst place for it.
- **Most calls cannot inform any record.** Roughly 1,700 of 1,860 carry no
  `job_id` and land under `(unattributed)`. The `jobId` field exists for this
  and most callers outside the worker do not pass it; the per-kind record stays
  thin until they do. Filed, not fixed here.

## Alternatives rejected

**A `model_outcomes` table updated on each call.** A stored copy of a fact two
tables already hold, and the copy is the one that rots.

**Success measured by a judge on every job (#116).** The issue makes #127
depend on it, and the judge costs a model call per job and is itself
non-deterministic — two consecutive runs of an unchanged corpus gave 16/19 and
16/18. What is recorded instead is whether the model produced usable content,
which is cheap, already stored, and not a matter of opinion.

**Free before paid, unconditionally.** Rejected above: it inverts the certified
chain. Kept as an Issue-level intent, enforced by the budget rather than by the
ordering.
