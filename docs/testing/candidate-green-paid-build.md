# Candidate GREEN — the paid build

The configuration whose GREEN verdict matters. Frozen 2026-09-15 at Grant's
instruction, after he confirmed the paid configuration is the one he intends to
use in real beta.

It replaces, and does not delete, the free-model candidate recorded in
`candidate-green-build.md`. That one remains reproducible as historical
evidence; it is simply no longer the thing being certified.

## The candidate

| | |
|---|---|
| **Commit** | `f757499` on `claude/phase-7-communications-kh8ow8` |
| **Worker** | **v373**, ACTIVE, deployed FROM this commit with a clean tree |
| **Migrations** | **374** applied, 374 recorded |
| **Primary model** | `openai/gpt-oss-120b`, priority 10 |
| **Fallback 1** | `qwen/qwen3.7-flash`, priority 20 |
| **Fallback 2** | `mistralai/mistral-small-3.2-24b-instruct`, priority 30 |
| **Free models** | 7 of them, priority 100 — retained, unreachable in practice (see below) |
| **Provider** | `openrouter`, enabled, `free_only = false`, provider priority 10 |
| **Privacy** | `data_collection: 'deny'` on every request, not configurable |
| **Price ceiling** | prompt ≤ **$0.20/M**, completion ≤ **$1.00/M** |
| **Per-call budget** | **$0.01** for one response |
| **Router** | `DEFAULT_MAX_ATTEMPTS = 3`; `allow_fallbacks` true because the budget is non-zero; no `models` array is ever sent, so the model cannot change under failover |
| **Conversation** | `max_turns` 12, `window_minutes` 1440, `max_specialists_per_job` 3 |
| **Messaging** | `telegram.only_chief_speaks` true, `direct_to_grant` chief-of-staff, `pager_floor` important |

### Why the free models are retained but unreachable

`DEFAULT_MAX_ATTEMPTS` is 3 and there are exactly three paid models ahead of
them, so the router will never walk to a free model while all three are in the
allow-list. They are kept because they are the restore path: one UPDATE to
`free_only` puts the office back on them without a deploy.

## Freeze verification

Taken immediately before the hostile corpus run.

| Claim | How it was checked | Observed |
|---|---|---|
| source tree clean | `git status --porcelain` | 0 lines |
| deployed worker matches recorded source | deployed from this commit, tree clean at deploy time | v373 ACTIVE, liveness ok, 401 on unauthenticated kick, 200 on authenticated |
| migrations match | `npm run check:migrations` | 374 migrations, 374 recorded as applied |
| routing selects the primary first | `usable_models order by priority, model_priority, model_id` | `openai/gpt-oss-120b -> qwen/qwen3.7-flash -> mistralai/mistral-small-3.2-24b-instruct` |
| qwen is priority 20 | same query | 20 |
| mistral-small is priority 30 | same query | 30 |
| free models are priority 100 | same query | all 7 at 100 |
| `data_collection: deny` intact | `verify:fallback` | 10 of 10 usable models, and all 3 candidates in a driven full failover |
| no enforcement layer weakened | `verify:fallback`, `verify:router`, `verify:boundary`, unit tests | see below |
| budget limits actually enforced | `verify:fallback` | an injected $1.01 charge against a $0.01 ceiling threw `PaidCallPreventedError` and did NOT fail over |

### "No enforcement or safety layer was weakened" — the specific claim

§11 has four layers. None was removed; each gained a number to compare against,
defaulting to zero, so an unfunded provider behaves exactly as before (ADR-0029).

| Layer | Before | Now | Proof |
|---|---|---|---|
| 1 `max_price` | all zero | the registry's ceiling | an over-ceiling model still 404s; `verify:fallback` checks the body of every candidate |
| 2 key spend cap | unchanged | unchanged | — |
| 3 measured allow-list | unchanged | unchanged | `anthropic/claude-opus-4.1` refused before any request, 0 requests made |
| 4 post-response | `cost > 0` throws | `cost > ceiling` throws | driven with an injected charge |
| — unverifiable cost | refused | **still refused** | a provider reporting no cost is refused, and this got stricter, not looser: an unreported charge against a funded key is a charge nobody can see |
| privacy | `data_collection: deny` | unchanged, and not configurable | asserted over all 10 usable models |

`allow_fallbacks` moved from always-false to following the budget. ADR-0029
records the full argument; the short form is that the flag chooses among
upstream HOSTS for one model and never among models, so with `max_price` at
zero it *was* the price bound, and now the price bound is.

## Deterministic gates run before the freeze

| gate | result |
|---|---|
| `npm run lint` | clean (1 pre-existing info) |
| `npm run typecheck` | clean |
| `npm test` | **1,266 passing across 66 files** |
| `npm run check:secrets` | clean, 1,184 files |
| `npm run check:templates` | clean, 25 files |
| `npm run check:migrations` | 374 / 374 |
| `npm run verify:router` | **14/14** |
| `npm run verify:fallback` | **16/16** |
| `npm run verify:boundary` | **57/57** |
| `npm run verify:reach` | **9/9** |
| `npm run verify:schema` | 2/2 |
| `npm run verify:transitions` | the two state machines are identical |
| `npm run verify:recovers` | **17/17** on runs 2 and 3; **15/17** on run 1 — filed as #244, cause not established |

#244 is recorded rather than waved past. Both failing lines came from one fact —
the suite's job was still `queued` when the section asserted on it — so the
failure mode is "nothing ran", not "the office said something untrue". It is the
suite's own orchestration, and changing a gate while it is qualifying a
candidate is how a gate stops meaning anything.

## The hostile corpus

`scripts/sessions/hostile.ts`, committed **UNRUN** at `4743021` on 2026-09-15,
**before this paid candidate existed**. It has not been modified since:
`git diff --stat 4743021 HEAD -- scripts/sessions/hostile.ts` is empty at the
freeze commit.

It was written against the free-model candidate and is deliberately unchanged
now that the model has changed. Rewriting an examination because the candidate
changed is how an examination stops being one. Five sessions, 18 turns:
`bad-morning`, `planting`, `two-desks`, `out-of-reach`, `long-way-back`.

## Restoring the free candidate

```bash
git checkout 6de6dfc          # tag candidate-green-free-v364, local only
npm run deploy:worker
npm run q -- "update public.providers set free_only = true, max_price_prompt = 0, \
  max_price_completion = 0, max_cost_per_call_usd = 0 where provider = 'openrouter'"
```
