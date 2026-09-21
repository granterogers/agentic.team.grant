# RUN LEDGER — PRODUCTION RELIABILITY / OPERATIONS (11-hour unattended)

**Started 21 September 2026.** Branch `claude/production-reliability`.
This file is the durable mission for THIS workstream. **After a compaction,
reconstruct from: CLAUDE.md -> this file -> git log on this branch -> the
evidence directory named below. Never ask Grant to repaste the brief.**

The authoritative master prompt was delivered as an HTML document and its
full substance is transcribed into sections 1-9 below. Nothing in it depends
on a conversation that survives compaction.

---

## 0. THE MISSION, IN ONE QUESTION

> **If Grant depends on Agentic Team every day and stops watching the
> machinery, what can silently fail, how quickly will the system notice, what
> happens to queued/user work, and can it recover without losing,
> duplicating, fabricating or silently charging for anything?**

This is **not** an issue-discovery exercise. It is a
**prove -> break safely -> observe -> repair -> prove again** engineering run.
"Tests are green" is NOT sufficient. Controlled failure evidence is required.

---

## 1. ISOLATION (settled, do not redo)

| | |
|---|---|
| **Remote main at start** | `3c9415084f4b2664bf8147d995412609e58a24f8` |
| **Branch** | `claude/production-reliability`, pushed, upstream tracking set |
| **Branch point** | main `3c94150` — 0 ahead / 0 behind at creation |
| **Env-assigned branch** | `claude/trusting-heisenberg-tb5kce` — held 0 unique commits, superseded by Grant's explicit instruction |
| **Never** | work on main; merge to main; deploy another branch's unmerged work |

### Parallel workstreams — DO NOT INVADE

- `claude/human-simulation-harness` (`1b67169`) — Shadow Grant / behavioural
  intelligence / evaluator semantics.
- `claude/basecamp-team-hq` (`71cbf64`) — frontend / UX.

**THIS BRANCH OWNS:** worker/queue/scheduler reliability; health / readiness /
liveness semantics; operational observability; retries / leases /
idempotency; dead and stuck work; backup and restore; runtime and deployment
resilience; credential-health operations; provider outage and fallback
operations; cost and budget enforcement; safe chaos and failure injection;
operational runbooks; reliability-specific verification.

**THIS BRANCH DOES NOT OWN:** `web/studio/**`; Basecamp UX; Shadow Grant /
evaluator / human-simulation semantics; semantic planning and routing;
unrelated product features. A defect clearly owned by another workstream is
recorded as a precise cross-workstream finding — never fixed in their files.

**Migrations:** avoid unless a demonstrated reliability invariant genuinely
requires one. Prove the existing schema cannot express the fix first, and
check migration-number conflicts against the parallel branches before
numbering.

---

## 2. THE HISTORICAL FAILURE THAT DEFINES THIS RUN

A voice note reached the webhook, was recorded and queued, and the nominal
five-minute GitHub Actions consumer had run **six times in fourteen hours**.
Grant waited with no reply. Later work added immediate webhook kicks, a
one-minute pg_cron floor, and GitHub Actions as a slow backstop.

**The mandatory lesson: a heartbeat or scheduler can be GREEN while useful
work is NOT MOVING.**

Never equate any of these:

| Green signal | Does NOT mean |
|---|---|
| HTTP 200 | healthy |
| cron fired | queue progressed |
| worker invoked | job dequeued |
| job completed | result delivered |
| backup file exists | recovery works |
| credential exists | credential works |
| fallback configured | fallback works |
| budget configured | spend bounded |

Measure **END-TO-END PROGRESS** and invariants.

---

## 3. THE TWENTY RELIABILITY INVARIANTS

Validate, refine and pin each with evidence.

1. Accepted inbound work is durably recorded or explicitly rejected — never silently dropped.
2. Runnable work cannot remain stuck indefinitely without an operational signal.
3. Worker heartbeat alone is insufficient; queue age and progress are observable.
4. Retried external side effects cannot duplicate sends, creates or posts.
5. Uncertain external commits park and reconcile rather than blindly repeat.
6. Worker death or restart resumes durable state.
7. Delivery failure cannot turn completed work into apparent nothingness.
8. Delivery retry does not rerun substantive work.
9. Provider outage degrades, parks or falls back honestly — never fabricates success.
10. Notebook outage does not break core operations.
11. Expired or revoked credentials become actionable precisely.
12. Paid calls cannot silently exceed configured bounds.
13. Backup health requires a recent backup **AND** a proven restore.
14. Monitoring must not rely solely on the component it monitors.
15. Synthetic tests cannot pollute Grant's real data or messages.
16. Chaos cannot send unintended external effects.
17. RLS and security invariants survive restore.
18. Persistent incidents dedupe rather than alert-storm.
19. Backlog recovery does not indefinitely starve fresh conversational work.
20. Recovery cannot repeat an already-committed irreversible side effect.

---

## 4. REPOSITORY FACTS ASSERTED BY THE BRIEF — ALL REQUIRE REVALIDATION

Documentation may be stale. Each of these is a CLAIM to be checked against
current code and current deployment, and the check is recorded in section 8.

- `supabase/functions/worker/index.ts` documents immediate webhook kick +
  pg_cron every minute + GitHub Actions slow backstop.
- Worker has a 60-second start-new-work deadline and max 5 jobs per invocation.
- Worker remembers a kick received while already running (`kickPending`).
- Worker GET health exposes configuration and runtime capability but
  deliberately **not** queue depth.
- `.github/workflows/backup.yml` contains dump + restore rehearsal logic, but
  automatic triggers were removed on 2026-09-08 for Actions cost; it is
  `workflow_dispatch` only.
- That workflow's comments say Supabase Free has no backups and this was the
  only copy at the time.
- **HIGH PRIORITY QUESTION: what currently performs unattended backups, if
  anything?** If nothing does, that is a production-reliability defect.
- Credential audit code exists and checks expiry/rotation for some credentials.
- Historical docs record a dead Google refresh token (`invalid_grant`).
- Provider guards include per-call ceilings and treat a missing `usage.cost`
  as suspicious.
- DB-level budget and usage accounting exists.
- Notebook outage is architecturally intended to be degraded mode, not
  system failure.
- Existing verification includes worker, drains, recovery, credentials,
  fallback, latency, chaos, security, backup/restore and related suites.

---

## 5. THE FALSE-GREEN HUNT (pre-mortem list — work through it)

health 200 while queue dead · scheduler fires while worker auth/config/dequeue
broken · immediate kick works while floor/backstop broken · docs claim a
GitHub backstop whose schedules were removed · backup workflow exists but
nothing unattended invokes it · backup exists but restore fails · backup stale
and nobody knows · restore proves schema but not data/RLS/privileges · poison
job monopolises work · lease expiry causes duplicate execution · crash after
external commit before receipt persistence duplicates the side effect · crash
after completion before delivery strands the result · delivery retry reruns
intelligence · fallback exists but is unavailable / privacy-incompatible /
over budget · cost accounting reports overspend only after the money is spent
· missing `usage.cost` silently accepted · Vault/env credential exists but is
dead · alerts use only the channel that has failed · persistent failure floods
alerts minute by minute · time/clock/DST assumptions break leases, retries and
staleness · Supabase/runtime cold state fails recovery · tested code differs
from deployed code · Vault/env/schema/runtime configuration drift · tables
grow with no operational visibility · high overall success rate hides
user-facing delivery failures · large recovery backlog starves fresh short
work.

---

## 6. SAFE FAILURE INJECTION — THE MATRIX TO EXERCISE

Prefer injected adapters, fixtures and test tenants over production sabotage.
**Never send chaos traffic to Grant or to third parties.**

worker unavailable / 401 / 503 · DB transient failure · provider timeout / 429
/ 5xx · malformed provider response · missing usage cost · revoked credential
· Notebook unavailable · Telegram/Slack outbound failure · crash before side
effect · crash after side effect before receipt · crash after completion
before delivery · duplicate inbound · duplicate worker kick · overlapping
workers · lease expiry · stale runnable job · poison job · exhausted budget ·
backup storage unavailable · restore role/permission problems · scheduler gap.

---

## 7. WHAT THE OPERATIONAL HEALTH VIEW MUST ANSWER

Small durable health query plus actionable alerting — **not** a monitoring
product.

inbound accepted? · oldest runnable job age? · runnable / waiting / blocked /
stalled counts? · last successful dequeue / completion / delivery? ·
accepted-but-not-delivered work? · repeated failure fingerprints? · worker and
queue latency p50 / p95 / max? · provider failures and fallbacks? · credential
health? · last backup age? · last successful restore rehearsal age? · spend and
budget headroom? · last scheduler/worker PROGRESS? · deployed version/SHA?

**Alerts** must name the broken invariant, the user consequence and the first
useful diagnostic; dedupe and cool down; clear when appropriate; use an
independent path where practical; stay quiet for self-healing transients.

---

## 8. UNATTENDED PROTOCOL — THE RULE THAT OUTRANKS THE REST

**DO NOT STOP** for: progress reports · green suites · commits · deployment
success · one blocked credential · one unavailable provider · ordinary choices
· a classified flake · main advancing · phase completion · discovering a
production defect.

- Blocked -> mark **only that item** `HUMAN_BLOCKED` with the exact reason and
  the exact action needed, then continue with all independent work.
- Ambiguous -> choose the safest reversible path and record it.
- Unsafe live test -> use a fixture / fake / sandbox proof and continue.
- Finished early -> fresh chaos seeds, restore proof, poison and stale jobs,
  delivery recovery, independent monitoring, alert dedupe, cost
  reconciliation, credential degradation, queue fairness, cold starts,
  deployment drift, runbook rehearsal. **Do not invent low-value work to
  consume time.**

### Fix policy

reproduce -> capture evidence -> identify the SYSTEMIC cause -> fix -> add a
regression/invariant -> rerun the original failure -> run neighbouring gates.
Do not merely file issues for safely fixable defects. Do not weaken a test to
get green. Do not alter product semantics to satisfy a chaos test.

### Pacing (approximate, 11h)

`0-2h` topology, invariants, baseline, **current backup reality** ·
`2-4h` worker/queue/scheduler progress observability + chaos foundation ·
`4-6h` retry/idempotency/delivery/crash boundaries ·
`6-7.5h` backup/restore/RPO/RTO ·
`7.5-9h` provider/credential/cost/degraded modes ·
`9-10h` alerts/detection/fairness/drift/cold-state ·
`10-10.5h` fresh adversarial sweep and fixes ·
`final 30m` main reconciliation, broad gates, evidence, docs, push, readiness.

### Tests — READ BEFORE RUNNING

Some scripts touch live systems. **Do not blindly run** `verify:db`,
`verify:all`, purge/tidy, or destructive live aggregates.

### Deployment policy

Identify the exact component; ensure the branch source does not include
parallel frontend or Shadow Grant work; use the narrowest deployment; prefer
local/sandbox proof where sufficient; record the deployed SHA.

### Final report contents (at the actual end only)

final branch/SHA · starting and current main SHA · dependency map · invariants
· failures injected · defects found and fixed · false greens · queue/worker/
scheduler findings · delivery/idempotency findings · backup reality, RPO, RTO,
restore evidence · credential findings · provider/fallback/cost findings ·
monitoring and alerts · deployed components · tests and evidence ·
HUMAN_BLOCKED items · untouched parallel-owned areas · remaining risks ·
integration status **READY / READY WITH NAMED CONFLICTS / NOT READY** · exact
next action.

---

## 9. EVIDENCE LOCATION

Durable evidence for this run lives in **`docs/ops/evidence/`** and is
committed. Transient captures go to the scratchpad and are not committed.

---

## 10. LOG — appended as the run proceeds

### T+0:00 — isolation confirmed, ledger persisted

main `3c94150`; branch `claude/production-reliability` created from it and
pushed; working tree clean. Ledger written before any exploration so a
compaction in the first hour cannot erase the mission.

**NEXT AUTONOMOUS ACTION:** revalidate section 4 against current code — start
with `supabase/functions/worker/index.ts`, `.github/workflows/`, the
`package.json` script inventory, and the question of what performs unattended
backups today.
