# Candidate GREEN — the third freeze

Frozen 2026-09-15, after #249 resolved the systemic action-recognition defect
and the blocker ledger was brought to where the evidence is.

## The candidate

| | |
|---|---|
| **Commit** | `2bcaf1d` on `claude/phase-7-communications-kh8ow8` |
| **Worker** | **v389**, ACTIVE |
| **Migrations** | **374** applied, 374 recorded |
| **Primary model** | `openai/gpt-oss-120b`, model priority 10 |
| **Fallback 1** | `qwen/qwen3.7-flash`, 20 |
| **Fallback 2** | `mistralai/mistral-small-3.2-24b-instruct`, 30 |
| **Free models** | 7, priority 100 — retained as the restore path, unreachable while three paid models sit ahead of them and `DEFAULT_MAX_ATTEMPTS` is 3 |
| **Provider** | `openrouter`, enabled, `free_only = false` |
| **Privacy** | `data_collection: 'deny'`, forced on every request, not configurable |
| **Price ceiling** | prompt ≤ **$0.20/M**, completion ≤ **$1.00/M** |
| **Per-call budget** | **$0.01** for one response |
| **Router** | `DEFAULT_MAX_ATTEMPTS` 3; `allow_fallbacks` true because the budget is non-zero; no `models` array is ever sent, so failover cannot change which model answers |
| **Conversation** | `max_turns` 12, `window_minutes` 1440, `max_specialists_per_job` 3 |
| **Messaging** | `telegram.only_chief_speaks` true, `direct_to_grant` chief-of-staff, `pager_floor` important |
| **Working tree** | clean |

## The examination

`scripts/sessions/third.ts`, committed **UNRUN** at `2bcaf1d` — the same commit
as the freeze. Six sessions, 18 turns, on a spine no earlier corpus used.

## What changed since the second freeze, and why it needed a third corpus

| | |
|---|---|
| #246 | deliberation and tool-call JSON out of user-facing output |
| #247 | a user premise is not a records claim; the "suppose" gap closed |
| #248 | no claiming an action that did not happen; `acted` counted for the first time |
| **#249** | **action recognition rebuilt on grammar rather than a list of phrasings** |

#249 is why `final.ts` could not be reused: it was written against the defective
abstraction, and every line of the replacement was written with its sentences in
view.

## Evidence standing behind this freeze

| gate | result |
|---|---|
| unit tests | **1,387** across 69 files |
| `verify:asks` | recall **37/37**, held-out **21/21**, precision **41/41** including 20 semantic mutations |
| `verify:capabilities` | **10/10** — every advertised action classified, `task.create` proven end to end |
| `verify:answers` | 6/6 |
| `verify:attests` | 11/11 |
| `verify:recovers` | 17/17 |
| `verify:reach` | 9/9 |
| `verify:router` | 14/14 |
| `verify:fallback` | 16/16 |
| `verify:boundary` | 57/57 |
| `npm run matrix` | 96/96 applicable cells |
| `npm run breadth` | 37/37 dimensions |
| `verify:routing-breadth` | 68/81 (84%), stable over three runs |

## Blockers outstanding at the freeze

None material to backend or intelligence.

- **L19 / #242** — constraint acknowledgement is unenforced. Open on Grant's
  explicit instruction that one successful unseen turn is evidence, not closure.
  A caveat on GREEN rather than a bar: the office still does the most useful
  thing, it sometimes omits saying which constraint it dropped.
- **L25** — four advertised mutations deliberately not executed, because doing
  so would break the standing test rules. Recognition proven; canonical
  execution is beta evidence.
- **L26 / #253** — a task's due date, assignee and detail are representable and
  never extracted. A gap, not a loss: the deadline stays where Grant can read it.
- **L27** — #250, #251, #252. Harness only.

## Restoring the free candidate

```bash
git checkout 6de6dfc          # the original free-model candidate
npm run deploy:worker
npm run q -- "update public.providers set free_only = true, max_price_prompt = 0, \
  max_price_completion = 0, max_cost_per_call_usd = 0 where provider = 'openrouter'"
```
