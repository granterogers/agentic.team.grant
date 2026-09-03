# Phase 2 evidence — the four inference enforcement layers

**Date:** 2026-09-03 · **Key spend before and after: `usage: 0`, `limit: 5`**

§11 requires four enforcement layers, *"all injected by the HTTP wrapper — never
by callers"*, and Gate 5 requires proving a paid call **cannot happen**. These
are the live measurements the layers are built on.

## Layer 1 — `max_price` all-zero with `allow_fallbacks: false`

§11 claims this is *"documented to prevent execution, not derank"*. Confirmed:

```
model openai/gpt-4o-mini   + max_price 0 + allow_fallbacks false
  -> 404 No endpoints found that satisfy the max price for this request

model openrouter/auto      + max_price 0 + allow_fallbacks false
  -> 404 No endpoints found that satisfy the max price for this request

model openrouter/auto:free + max_price 0 + allow_fallbacks false
  -> 429 Provider returned error
```

A refusal, not a cheaper substitution. Nothing was charged.

## The three silent hazards §11 names, all reproduced

| Hazard | Measured |
|---|---|
| `openrouter/auto:free` still charges — `:free` on a router is a no-op | `openrouter/auto` and `auto:free` both report `pricing.prompt = -1`; only `openrouter/free` reports `0` |
| `allow_fallbacks` defaults to `true` | set to `false` explicitly on every call |
| `data_collection` defaults to `"allow"` | set to `"deny"` explicitly; its cost is quantified below |

## Layer 3 — and why pricing is not enough

Phase 2's required question: *does `data_collection: "deny"` empty the free
registry?* **No — but it costs 8 of 21 models, and pricing predicts availability
badly.** All 21 zero-priced models probed with the production guard set:

```
✅ cohere/north-mini-code:free                          USABLE   cost=0
✅ dots-studio/dots-3-note-preview:free                 USABLE   cost=0
❌ google/gemma-4-26b-a4b-it:free                       REFUSED  429 Provider returned error
❌ google/gemma-4-31b-it:free                           REFUSED  429 Provider returned error
❌ google/lyria-3-clip-preview                          REFUSED  502 Provider returned error
❌ google/lyria-3-pro-preview                           REFUSED  502 Provider returned error
✅ inclusionai/ling-3.0-flash-fin:free                  USABLE   cost=0
❌ liquid/lfm-2.5-2.6b:free                             REFUSED  404 No endpoints found matching your data policy (Free model tra
✅ minimax/minimax-m2.7:free                            USABLE   cost=0
✅ minimax/minimax-m3:free                              USABLE   cost=0
❌ nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free   REFUSED  404 No endpoints found matching your data policy (Free model tra
❌ nvidia/nemotron-3-super-120b-a12b:free               REFUSED  404 No endpoints found matching your data policy (Free model tra
❌ nvidia/nemotron-3-ultra-550b-a55b:free               REFUSED  404 No endpoints found matching your data policy (Free model tra
❌ nvidia/nemotron-3.5-content-safety:free              REFUSED  404 No endpoints found matching your data policy (Free model tra
❌ nvidia/nemotron-3.5-lightning:free                   REFUSED  404 No endpoints found matching your data policy (Free model tra
❌ openrouter/free                                      REFUSED  429 Provider returned error
❌ poolside/laguna-s-2.1:free                           REFUSED  404 No endpoints found matching your data policy (Free model tra
❌ poolside/laguna-xs-2.1:free                          REFUSED  404 No endpoints found matching your data policy (Free model tra
❌ thinkingmachines/inkling-small:free                  REFUSED  403 thinkingmachines/inkling-small:free is only available on age
❌ thinkingmachines/inkling:free                        REFUSED  403 thinkingmachines/inkling:free is only available on agentic h
❌ z-ai/glm-5.2:free                                    REFUSED  429 Provider returned error

```

Re-probed three times each to separate transient from persistent:

```
google/gemma-4-26b-a4b-it:free   429, 429, 429  -> persistently unavailable
google/gemma-4-31b-it:free       429, 429, 429  -> persistently unavailable
z-ai/glm-5.2:free                429, 429, 429  -> persistently unavailable
google/lyria-3-*-preview         502, 502, 502  -> persistently unavailable (media models)
openrouter/free                  429 then OK    -> intermittent, real
```

**5 of 21 confirmed usable.** Recorded as [ADR-0009](../adr/0009-free-allowlist-from-probes.md):
the allow-list is built from probe results, with pricing as a pre-filter. Three
failure classes are invisible to pricing — the data-policy trade (8 models are
free only if training is permitted), harness gating (`403 … only available on
agentic harnesses`, absent from our research), and persistent provider
unavailability.

A spec-faithful layer 3 would have allow-listed 21 models, **16 of them broken**,
each surfacing later inside a job as an unexplained provider error.

## Still to prove in Phase 2

- ⬜ Layer 2 — the per-key cap is set (`limit: 5`) but has never been *hit*; an untested backstop is a belief
- ⬜ Layer 4 — post-response breaker on `usage.cost > 0`, needs the HTTP wrapper
- ⬜ Router with no ad-hoc provider calls anywhere else in the codebase
