# ADR-0005 — Inference cost posture: configurable, Grant chooses

**Status:** Proposed — awaiting Grant's decision (**D2**) · **Date:** 2026-09-02

## Context

The original principles required free-tier-only secondary inference and no
silent paid usage. Research found the constraint fails — but **on data terms,
not on cost**:

- **Quota works.** OpenRouter meters `:free` by requests (20 RPM / 1,000 RPD),
  and a realistic day (~135 requests, ~2.4M tokens) fits.
- **Privacy does not.** Google states free-tier content improves Google products
  and that human reviewers may read API input and output. Many OpenRouter free
  endpoints exist *because* the provider harvests traffic — so
  `data_collection: "deny"` may empty the free registry.
- **A zero balance cannot be the guarantee.** The 1,000 RPD tier requires a $10
  lifetime credit purchase; verified live, the current key reports
  `is_free_tier: true`, i.e. the **50/day** tier.
- **The paid floor is trivial** — $2.83–8.25/month.

A first recommendation of "hard-capped ~$10/month" was **not accepted**: Grant
asked for the analysis to be finished and the options presented without the
choice being made for him.

## Decision

**Do not choose. Implement all three as configuration, and let Grant select.**

| Config | Cost | Character |
|---|---|---|
| **A** | **$0** | free only; request-starved at 50/day; poor privacy; unsuitable for confidential material |
| **B** | **~$3/mo + $10 one-off** | 1,000 req/day, `data_collection: deny`, hard-capped |
| **C** | **~$8–32/mo** | stronger models, optionally plus voice |

The **enforcement layers are identical in all three** and are not optional:

1. `provider.max_price` with `allow_fallbacks: false` — prevents execution.
2. A dedicated key with a hard spend limit — out-of-band backstop.
3. Allow-list rebuilt from live `/api/v1/models`.
4. Post-response circuit breaker on `usage.cost > 0`.

All injected by the HTTP wrapper, never by callers.

## Consequences

- The cost posture becomes a runtime setting, not an architectural commitment.
- Principle 8 is preserved exactly as written: spend is **never silent** in any
  configuration.
- Config A ships as the default until Grant decides, so the system cannot spend
  anything without an explicit choice.

## Three silent hazards this must guard

- **`openrouter/auto:free` still charges** — `:free` on a router is a no-op.
  `openrouter/free` is the safe one.
- **`allow_fallbacks` defaults to `true`.**
- **`data_collection` defaults to `"allow"`.**

## Open question, to test first in Phase 2

**Does `data_collection: "deny"` empty the OpenRouter free registry?** Untested,
cheap to test, and it decides whether Config A is viable at all.
