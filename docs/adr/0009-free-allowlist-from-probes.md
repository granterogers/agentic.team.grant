# ADR-0009 — The free-model allow-list is built from probes, not from pricing

**Status:** Accepted · **Date:** 2026-09-03

**Amends** master spec §11's enforcement layer 3: *"Allow-list rebuilt from live
`/api/v1/models` (`pricing.prompt === "0"`)."*

## Context

Phase 2's first required experiment was: *does `data_collection: "deny"` empty
the OpenRouter free registry?* It was front-loaded because it decides whether
D2 Option B — the ~$3/month posture Grant chose, which buys both 1,000
requests/day **and** `data_collection: deny` — is viable at all.

Measured against the live API on 2026-09-03, with all four enforcement layers
active so a paid call was impossible throughout (spend confirmed `usage: 0`
before and after).

**The answer is no — but pricing is not a usable proxy for availability.**

`/api/v1/models` reports **424** models, of which **21** have
`pricing.prompt === "0"` and `pricing.completion === "0"`. Probing all 21 with
`data_collection: "deny"`:

| Outcome | Count | What it means |
|---|---|---|
| ✅ usable | **5** | executed, `cost: 0` |
| ❌ `404 No endpoints found matching your data policy (Free model training…)` | **8** | free **only if** training on your data is permitted |
| ❌ `403 … only available on agentic harnesses` | **2** | gated to listed partner apps; not callable by an API client |
| ❌ `429` on three consecutive attempts | **3** | rate-limited at the provider, not merely busy |
| ❌ `502` on three consecutive attempts | **2** | media models, no working text endpoint |
| ⚠️ `429` then success | 1 | `openrouter/free`, intermittent but real |

Confirmed usable with `deny`:

```
cohere/north-mini-code:free
dots-studio/dots-3-note-preview:free
inclusionai/ling-3.0-flash-fin:free
minimax/minimax-m2.7:free
minimax/minimax-m3:free
openrouter/free            (intermittent — retry-worthy, not reliable)
```

So layer 3 as specified would build an allow-list of 21 models, **16 of which do
not work**. Three failure classes are invisible to pricing:

1. **The data-policy trade.** Eight models are free *in exchange for* training
   rights. `data_collection: "deny"` is exactly the setting that declines that
   trade, so it must exclude them — this is the privacy posture working, not a
   bug. The cost of D2 Option B's privacy half is 8 of 21 models.
2. **Harness gating.** Two models return `403 … only available on agentic
   harnesses`. This appears nowhere in `docs/research/secondary-inference.md`
   and is a restriction on *who is calling*, which no pricing field can express.
3. **Persistent provider unavailability.** Five models fail every attempt.

## Decision

**The free allow-list is built from probe results and stored in the database,
with pricing as a pre-filter rather than the criterion.**

Concretely:
- `pricing.prompt === "0" && pricing.completion === "0"` selects *candidates*.
- Each candidate is probed with the production guard configuration —
  `data_collection: "deny"`, `allow_fallbacks: false`, all-zero `max_price` —
  and a 1-token request.
- Only a candidate that **executed with `cost: 0`** enters the allow-list.
- Every result is recorded with a timestamp, the observed status and the last
  error, which is exactly what §8's capability registry requires: *availability,
  auth state, health, last successful verification, last error.*
- A single failure does not evict a model. `openrouter/free` returned `429` then
  succeeded, so one probe is not authoritative in either direction — eviction
  requires repeated failure, and re-probing is scheduled rather than done on
  demand in a request path.

Layers 1, 2 and 4 are unchanged and were all verified working (see
`docs/test-evidence/phase-2-inference-guards.md`). Layer 1 in particular
**prevents execution** exactly as §11 claims, rather than deranking:

```
model: openai/gpt-4o-mini, max_price all zero, allow_fallbacks false
→ 404 No endpoints found that satisfy the max price for this request
```

## Consequences

- **D2 Option B remains viable.** Privacy and free inference coexist; the price
  is a smaller model pool, not an empty one.
- The usable pool is **small and volatile** — 5 confirmed models today. The
  provider registry must treat model availability as a *measured, expiring
  fact*, not configuration. Re-probing is a scheduled job.
- `openrouter/free` is worth keeping as a router because it selects among free
  endpoints server-side, but its intermittent `429` means it cannot be the only
  path. Its pricing genuinely reads `0`, unlike `openrouter/auto` at `-1`, which
  is the distinction §11 warns about and which measurement confirms.
- Five usable models is thin for §17's capacity assumptions. Whether it is
  *enough* is a Phase 3 question once real workloads exist — recorded here so it
  is not discovered as a surprise.

## What would reverse this

OpenRouter exposing availability and data-policy eligibility as queryable model
metadata, so the allow-list could be derived from one request rather than 21.
Then probing becomes a periodic audit rather than the source of truth. Worth
re-checking each time the registry is touched.

## Lesson recorded

The specification's layer 3 was written from documentation. Documentation
described pricing accurately and said nothing about harness gating or the
data-policy trade, so a faithful implementation of the spec would have shipped
an allow-list that was 76% wrong — and every failure would have surfaced later,
inside a job, as an unexplained provider error.

Same shape as ADR-0007: **careful reasoning on top of an unverified premise.**
The cheap experiment was 21 requests costing nothing.
