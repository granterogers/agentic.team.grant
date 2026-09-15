# Candidate GREEN build — 15 September 2026

**Tracking:** #231. This file exists so that "the implementation was frozen"
is a checkable fact rather than an intention. Everything scored against this
build must be scored against exactly this, and any `src/` change after it voids
the freeze and requires a new candidate and a new unseen corpus.

## The build

| | |
|---|---|
| **Commit** | `6de6dfc53cb9046a11f4a4dabc1a2af7ee26eea4` |
| **Branch** | `claude/phase-7-communications-kh8ow8` |
| **Worker** | Supabase edge function **v364**, status ACTIVE, liveness ok=true configured=true |
| **Migrations** | **372 applied**, newest `0372_the_office_says_when_it_cannot_think.sql` |
| **Unit tests** | 1,255 across 66 files |

### Configuration that changes behaviour

| key | value | why it matters to a score |
|---|---|---|
| `conversation.max_turns` | 12 | the working window; turns beyond it need `app.recall_conversation` |
| `conversation.window_minutes` | 1440 | #238 — a working day, not thirty minutes |
| `agents.max_specialists_per_job` | 3 | the tunable roster cap under the hard ceiling of five |
| `telegram.only_chief_speaks` | true | Grant hears one voice |
| `telegram.direct_to_grant` | `chief-of-staff` | which chat |

Provenance permissions on the instruction path, which decide what the office
may assert:

- **consulted** — `documents` (the search runs every turn, whether or not it
  finds anything) and `projects`;
- **complete** — `projects` only. A search is not a census.
- Nothing reads the diary, the inbox, tasks or contacts on this path, so no
  claim about them can be grounded — positive or negative. The office may
  still say it has no record of one; that is the third state.

### How to verify the freeze

```
git diff 6de6dfc53cb9046a11f4a4dabc1a2af7ee26eea4 HEAD -- src/ supabase/ migrations/
```

Empty means the candidate is intact. Documentation, corpora and test files may
move; `src/`, the edge functions and the migrations may not.

## What is proven against it

| | |
|---|---|
| Agent x Capability | **96/96** applicable cells, negative control clean |
| Coverage dimensions | **37/37** have at least one case |
| Sessions (development corpus) | 250/250 expectations across 59 turns |
| Provenance regressions | **65** unit cases — the three values, eight domains, 16 semantic neighbours |
| Failure recovery | `verify:recovers` **17/17**, RED proved and discriminating |
| Gate checks run individually | 17 of 19 green; `verify:routing-breadth` and `verify:collaborates` need a model |
| Routing, held out | 21/28, 11/11 checks |

## What is NOT proven, and is the reason this is a CANDIDATE

1. **The unseen adversarial corpus has not run.** OpenRouter's daily free-model
   quota is exhausted (#239) and the breaker reopens on the first real call.
   Until it runs against this exact build, GREEN is unavailable.
2. **#242** — saying which constraint was set aside is a coin flip. Deliberately
   not fixed before the freeze: it is the one invariant left with only a prompt
   behind it, the fix needs a gate validated against live traffic, and shipping
   an unvalidated gate into a frozen candidate is worse than a documented gap.
3. **The "suppose" gap.** A figure Grant floats in a hypothetical is his words,
   so it is in the grounding by construction and no text-comparison check can
   refuse it. Only the prompt separates a supposition from a price.
4. **Real-traffic Level 4.** `npm run measure` reports 3 of 8 agents ever
   chosen and `delegation_depth` 0 in GRANT'S OWN traffic, and `task.create`
   granted to eight and never exercised for real. All are honest: the fixes
   that make those reachable are days old and his traffic predates them. Only
   he can close them.
