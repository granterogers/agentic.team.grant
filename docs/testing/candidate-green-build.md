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

## Freeze verification — 2026-09-15 11:58 UTC

Checked read-only, immediately before the hostile-corpus run, so that a later
reader can tell whether the run was made against the thing this file records.

| Recorded | Command | Observed |
|---|---|---|
| commit `6de6dfc` | `git diff --stat 6de6dfc HEAD -- src/ supabase/ migrations/` | no output — identical |
| corpus `4743021` | `git diff --stat 4743021 HEAD -- scripts/sessions/hostile.ts` | no output — identical |
| worker v364 | `GET /v1/projects/<ref>/functions/worker` | `version 364`, `ACTIVE` |
| 372 migrations | `npm run check:migrations` | 372 migrations, 372 recorded as applied |
| clean tree | `git status --porcelain` | empty |

HEAD is `6e88ed0`; the two commits since the freeze touch `docs/` only, which is
why the first row can be empty while HEAD has moved.

**The worker version was read, never deployed.** `npm run deploy:worker` would
have taken it to v365 and invalidated the record above, so the check is a plain
read of the Management API rather than the deploy script's own probe.

## Why the run has not happened yet

`provider_health` for `openrouter`: `state = open`, `consecutive_failures = 10`,
`last_error = 429 Rate limit exceeded: free-models-per-day-high-balance`. The
free tier is a PER-DAY allowance and resets at 00:00 UTC. The breaker half-opens
on `next_probe_at` correctly — verified three ways earlier in the campaign — and
the deployed worker consumes each probe, 429s, and reopens it, which is the
breaker working, not a defect.

Classification: **ENVIRONMENT / PROVIDER FAILURE**, not a product defect. The day's
consumption was test load (1,014 calls) against a real peak of 48/day.

### Credit was added; the allowance is a daily counter, not a balance

2026-09-15 12:14 UTC, after $10 of credit was added to the existing OpenRouter
account. One minimal probe, made directly with the vaulted key so the answer
does not depend on the breaker's own schedule:

    credits endpoint: 200 {"total_credits":10,"total_usage":0}
    chat status: 429
    Rate limit exceeded: free-models-per-day-high-balance
      X-RateLimit-Limit: 1000
      X-RateLimit-Remaining: 0
      X-RateLimit-Reset: 1789516800000   (2026-09-16 00:00:00 UTC)
      limit_source: openrouter_free_tier_daily

The credit registered and it did what credit does here: it raised the free-model
tier from 50 to **1,000 requests a day**. It does not refill a counter that is
already spent. Remaining is 0 against a limit of 1,000 and the provider names the
reset itself — midnight UTC.

**The paid path was deliberately not taken.** With a balance, non-free models are
now reachable and are not subject to that daily cap, so the run could have gone
ahead today. It would have produced acceptance evidence for a model configuration
Grant is not going to run, which is the wrong-payload trap wearing a different
hat: a suite that passes against something other than the deployed thing passes
for the wrong reason. It would also change the frozen candidate before testing
it, which the acceptance brief forbids, and add a recurring cost against the ~£0
constraint. The run waits for the reset instead.

**Tomorrow the fresh 1,000 goes to the hostile corpus first.** Today's exhaustion
was 1,014 calls of test load; the corpus is 18 turns and must not be queued
behind another suite that eats the allowance before it.

## The candidate is now historical: the office moved to a paid model

2026-09-15, after the quota probe above. Grant funded the OpenRouter account and
asked the office to switch from the free tier to a low-cost paid model. That is
done and verified (ADR-0029), which means **the configuration this file records
is no longer the configuration the office runs.**

Nothing is lost. The candidate is preserved three ways:

| Piece | Where it is |
|---|---|
| the code | git tag `candidate-green-free-v364` at `6de6dfc` |
| the free models | still in `provider_models`, status usable, priority 100 |
| the switch back | one UPDATE, below |

```bash
git checkout candidate-green-free-v364
npm run deploy:worker
npm run q -- "update public.providers set free_only = true, max_price_prompt = 0, \
  max_price_completion = 0, max_cost_per_call_usd = 0 where provider = 'openrouter'"
```

The third line is the one that decides which model answers: with `free_only`
true every paid model fails the `usable_models` predicate, whatever is deployed.

### What this means for the hostile corpus, which is still unrun

The corpus at `4743021` is still genuinely unseen, and the freeze on it holds.
What has changed is which candidate it should be run against, and that is a
real decision rather than a formality:

- **Against the frozen free candidate.** Honours the acceptance brief exactly.
  Produces a verdict about a configuration Grant is not going to use, which is
  the wrong-payload trap this repository has recorded three times — a suite that
  passes while pointed somewhere other than the deployed product.
- **Against a re-frozen paid candidate.** Produces a verdict about what he will
  actually run, and can happen immediately rather than waiting for midnight,
  because the paid model has no daily cliff. Costs a new freeze: a new commit, a
  new worker version, and this file rewritten.

The second is the useful one, and it is Grant's call, not this session's. Until
he says, the scheduled run stays pointed at the free candidate via the restore
above.
