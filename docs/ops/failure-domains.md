# Failure domains — what can silently fail, and how fast anything notices

Built 21 September 2026 on branch `claude/production-reliability`, from live
evidence rather than documentation. Every "detection" column names the thing
that actually detects it, and says where that thing is blind.

## The one fact that shapes everything

**No GitHub workflow in this repository has a schedule.** All nine are
`workflow_dispatch` only — read from each `on:` block. Every unattended thing
the office does runs through exactly one chain:

```
pg_cron  worker-heartbeat  * * * * *   (the only cron.job row; 19,381/19,381 succeeded)
   -> app.kick_worker()                 -- reads the vault, net.http_post, 2s timeout
   -> supabase/functions/worker         -- 60s start-new-work deadline, max 5 jobs
   -> app.dequeue_job                   -- priority asc, created_at asc, 300s lease
   -> handlers                          -- 17 duties + everything Grant asks for
   -> app.recover_stalled_jobs          -- expired leases; called every pass
```

Three surfaces accelerate it with an immediate kick: the Telegram webhook,
`slack-events`, and — **as of this run** — `hq-api`. `voice` does not.

## INBOUND

| Dependency | Failure mode | What Grant sees | Loss risk | Detected by | Latency | Recovery |
|---|---|---|---|---|---|---|
| Telegram webhook | Telegram stops delivering | no reply | **none** — nothing was accepted | nothing | — | Telegram retries |
| | accepted, kick fails | reply is late | none | `app.jobs_waiting(15)` | ≤15 min | pg_cron floor |
| | bad `addressed_to` | "could not record what you said" | the message | — | — | adapter retries once with no addressee |
| Slack events | signature secret wrong | no reply | none | `audit:credentials` | manual | re-deploy secret |
| `hq-api` | gateway 502/down | dashboard errors visibly | none | the page itself | immediate | retry |
| Voice | no kick exists | ~41 s to pick up | none | `verify:latency` | manual | pg_cron floor |

## CORE

| Dependency | Failure mode | What Grant sees | Loss risk | Detected by | Latency | Recovery |
|---|---|---|---|---|---|---|
| pg_cron | schedule dropped | everything stops | none; work queues | `app.jobs_waiting(15)`, `verify:drains` | ≤15 min | re-schedule |
| `app.kick_worker` | vault secret missing | everything waits for nothing | none | **nothing** — see below | — | restore secret |
| worker function | killed mid-job | late answer | none for a checkpointed job | `recover_stalled_jobs` | ≤ lease (300 s) | resume from checkpoint (0536) |
| | 5 failed attempts | **no answer at all** | the answer | **0535** — an impediment, on the Governance page | at failure | manual |
| Postgres | transient 5xx | retried | none | **0521/this run** — the executor retries any 5xx | immediate | automatic |
| | down | nothing works | none | everything | immediate | Supabase |
| Delivery | provider refuses | answer exists, undelivered | none | `app.undelivered()`, `verify:transport` | next read | `retry_job_deliveries` |
| | duplicate send | — | — | `claim_delivery` claims before sending | — | by construction |

**The false green, pinned:** `app.kick_worker()` returns `null` *silently*
when `worker.kick_secret` or `db.project_ref` is missing — deliberately, so a
missing secret does not fill the log. `cron.job_run_details` records
`succeeded / 1 row` in **both** cases. A green heartbeat table is therefore
**not** evidence that anything was kicked; that has to come from
`net._http_response`. Today it genuinely is kicking (357 × 200, latest
matching the cron run to the millisecond).

## DEPENDENCIES

| Dependency | Failure mode | What Grant sees | Detected by | Recovery |
|---|---|---|---|---|
| OpenRouter | 429 / daily free quota | the breaker opens | `provider_health`, surfaced as `cannot_think` in `office_health` | probe reopens it |
| | model gone | fallback chain | `verify:fallback` (16/16, a real second model answered) | automatic |
| OpenAI (voice) | key dead | voice degrades only | `audit:credentials` | manual |
| Google / Gmail / Calendar | `invalid_grant` | those tools return nothing | `connection_health` → **a chore on My Tasks** | Grant reconnects |
| NotebookLM | unavailable | degraded mode, not failure | `verify:chaos` (29/29) | automatic |
| Notion | token dead | mirroring stops | `connection_health` | manual |
| Slack config token (12 h) | Slack refuses rotation | **app-manifest changes blocked; messaging unaffected** | duty every 4 h + **a chore open since 18 Sept** | Grant re-issues |
| Supabase Storage | unavailable | no backup that night | **`app.backup_health()`** + a chore | next night |
| **Offsite storage** | **does not exist** | — | `backup_health().offsite = false`, stated every read | **HUMAN_BLOCKED** |
| Vercel | page down | dashboard unreachable | Grant | redeploy |
| GitHub Actions | — | **nothing depends on it unattended** | — | — |

## COST

| | |
|---|---|
| Per-call ceiling | enforced; a missing `usage.cost` is treated as suspicious |
| Daily / office / agent budgets | `verify:budget` 8/8 — they refuse work as designed |
| Held work | `app.held_for_budget()`, in `office_health` |
| Self-improvement kinds | wait rather than fail when the budget is spent; work for Grant is untouched |

## WHERE THE MONITORING IS STILL BLIND

1. **`app.kick_worker()`'s silent null** — a green cron log proves nothing.
   Mitigated because `app.last_progress()` (this run) answers the question the
   cron log cannot: when did work last actually *move*.
2. **Alerting depends on the office being able to run at all.** A chore is
   written by a duty executed by the worker. If the worker cannot run, no
   chore is raised — invariant 14 is only partly satisfied. `verify:drains`
   would catch it from outside, but it is run by a person.
3. **No offsite backup and no vault export.** Both HUMAN_BLOCKED, both now
   reported in every `backup_health()` read rather than discovered during a
   recovery.
4. **Voice has no kick**, so a voice note waits for the cron floor.
