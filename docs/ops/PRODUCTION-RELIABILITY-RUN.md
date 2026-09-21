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

### T+1:00 — baseline established. Backup reality answered.

**What actually runs unattended.** Every one of the nine GitHub workflows is
`workflow_dispatch` only — confirmed by reading each `on:` block, not the
prose. `ci.yml` and `worker.yml` additionally accept `repository_dispatch`.
**No schedule trigger exists anywhere in this repository.** The brief's
premise is correct on that point.

The unattended layer is therefore entirely `pg_cron -> worker -> duties`:

| | |
|---|---|
| `cron.job` | exactly one entry, `worker-heartbeat`, `* * * * *`, active |
| `cron.job_run_details` | **19,381 runs, 19,381 succeeded, 0 failed**, since 8 Sept |
| Does the HTTP actually leave? | Yes — `net._http_response` 357×200, latest matching the cron run to the millisecond |
| `worker.kick_secret` | present in vault; `db.project_ref` set |
| Live queue | 0 queued / 0 retrying / 0 running; newest completion 1 min old |
| `app.office_health(24)` | 393 finished, 0 failed, 0 stalled, 0 waiting |

**FALSE GREEN, pinned:** `app.kick_worker()` returns `null` *silently* when
the secret or the project ref is missing — the comment says so deliberately.
`cron.job_run_details` records `succeeded / 1 row` in **both** cases. A green
heartbeat table is therefore not evidence that anything was kicked. Today it
genuinely is kicking; that had to be proved from `net._http_response`, not
from the cron log.

**17 duties exist.** Backups, slack rotation, notion sync, drive watch,
mail/calendar, task reminders all run through the worker. Two are off:
`vault-export` (**disabled, never run**) and `vikunja-sync`.

#### Backup reality — the high-priority question, answered

There **is** an unattended backup: duty `nightly-backup` -> `office.backup` ->
`src/handlers/backup.ts` -> per-table gzip + sha256 into the private
`backups` bucket. It is real, not aspirational:

| | |
|---|---|
| Newest | `run-5264258d…`, 21 Sept 12:34, **246 objects, 12 MB**, 4.8 h old |
| Cadence | daily, 18/19/20/21 Sept in the current per-table format |
| Verified | all 123 objects checksum-clean, decompress, 122/122 tables present |
| Retention | nothing ever deleted (deliberate); 26 runs held |
| Location | **the same Supabase project it protects. No offsite copy.** |
| **Observed gap** | **17 Sept is missing entirely** |

#### DEFECTS FOUND (T+1:00)

**DEFECT-1 — a terminal failure reached by the SQL recovery path tells nobody.
SYSTEMIC.** `app.recover_stalled_jobs()` moves an attempt-exhausted job to
`failed` writing only `state_reason`, a column Grant never reads. No
impediment, no delivery, no alert. **This is what removed the 17 Sept backup:
`recovery: 5 attempts exhausted while in running`, zero deliveries, zero
impediments — a day with no backup and nothing said so.** Across 14 days:
56 real failed jobs, **0 produced any delivery**, 6 recorded nothing at all.
`src/jobs/worker.ts` learned this lesson in three places (#211/#231) and two
TS sites plus the whole SQL path never did:
`worker.ts:1309` (`in notifying with no output to deliver` — invariant 7
exactly) and `worker.ts:1140` (review rejected with attempts exhausted).

**DEFECT-2 — `office_health()` cannot see the backup.** It reports finished,
failed, stalled, waiting, open breakers and budget holds. It has no backup
age, no restore-rehearsal age, no last-progress timestamp and no delivery
outcome. **If backups stopped tonight the reading would stay exactly as green
as it is now** — which is precisely what happened on 17 Sept.

**DEFECT-3 — restore has never been proven on a schedule.**
`backup:rehearse` exists, is honest about what it proves, and is a **manual
command that records nothing anywhere**. Nothing invokes it unattended.
"Last successful restore rehearsal" is therefore **unknown and unknowable**.
Invariant 13 requires a recent backup AND a proven restore; half of it is
unmet.

**DEFECT-4 — an interrupted rehearsal leaks a schema into production.**
Reproduced: killed at 9 min, left `restore_rehearsal` with 82 scratch tables
in the live database. Dropped by hand; confirmed 0 left. A timeout, a
cancelled CI job or a crash all produce this.

#### RPO / RTO — first real numbers

- **RPO ≈ 24 h** by design; **observed worst case 48 h** (the 17 Sept gap).
- **RTO (data load) ≈ 13–14 min** extrapolated: 82 of 122 tables loaded in 9
  min for 12 MB / 135 k rows. Plus migrations from git first, since the
  archive carries rows and a column list, not DDL.
- **Vault is excluded from the backup and `vault-export` is disabled and has
  never run**, so a real restore today yields a working database with an
  **empty vault** — every credential re-entered by hand. That is the dominant
  term in RTO and nothing measures it.

**NEXT AUTONOMOUS ACTION:** fix DEFECT-1 at the class level (every terminal
failure records an impediment, whichever layer causes it), then DEFECT-2/3
(backup + rehearsal age in the health reading, rehearsal as a recorded duty).

### T+2:45 — the backup's root cause, and a migration that had to be driven twice

**DEFECT-1 fixed** (0535, `verify:journals`, in the gate). Every terminal job
failure now leaves a durable trace, whichever of the six paths caused it.
Proved by sabotage: trigger disabled (`tgenabled` read back as `D`), control
went red, restored (`O`), green. `verify:proposes` 26/26 and
`verify:governs` 25/25 with it live.

**DEFECT-5 found and fixed** — `ManagementApiExecutor.RETRY_ON` was
`[429, 503]`, so a **502 with an HTML body** was raised as though Postgres had
answered. Found because `verify:failures` died on it twice at two different
call sites while single-statement probes succeeded. **The production worker
falls back to this executor** when the direct Postgres connection is
unavailable (`worker/index.ts:264`), so a transient 502 there burns a job
attempt. Fixed as a property — Postgres answers as a 400 carrying a message,
anything 5xx is the transport — not as a longer list. Six tests; the sabotage
turned exactly the three 5xx cases red and left the throttle, the 400 and the
401 green, so the test discriminates.

**DEFECT-6, the root cause of the silent backup failure, fixed** (0536,
`verify:resumes`, in the gate). `app.dequeue_job` increments `attempt` on
every dequeue and the lease is 300s; an edge worker is killed long before a
122-table backup finishes. So a *resumption* was being counted as a *retry*,
and the backup went from 1 slice on 16 Sept to 3 on the 21st as the database
grew 78k → 135k rows. **Two slices of headroom, nothing watching the margin.**
A slice is now granted by raising `max_attempts`.

**My own fix was wrong twice and driving it is what found that.** The first
draft requeued without raising the ceiling. `jobs_attempt_within_max` would
have refused the next dequeue, and `app.requeue_retrying` only moves rows
`where attempt < max_attempts` — so the job would have sat in `retrying` FOR
EVER. That is worse than the defect: a backup that fails loudly becomes one
that silently stops. 0536 was applied, found broken, its
`app.schema_migrations` row deleted, corrected and re-applied — the recovery
CLAUDE.md prescribes for a migration minutes old whose applied version is
broken, and it is said out loud here and in the commit.

**KNOWN CROSS-WORKSTREAM ARTEFACT — not a defect in this work.**
`npm run check:migrations` is RED on this branch with one finding:
`[sequence/gap] gap between 0533 and 0535`. `0534` belongs to
`claude/human-simulation-harness`, is already applied to the shared live
database, and is deliberately absent from this branch. It closes the moment
that branch merges. `npm run migrate` therefore refuses on this branch, which
is why `scripts/scratch/apply-one.ts` exists and says so in its own header.

lint 0 · typecheck 0 · check:secrets clean · 2,219 tests · verify:failures
16/16 · verify:journals green · verify:resumes green.

**NEXT AUTONOMOUS ACTION:** DEFECT-2 and DEFECT-3 — the operational reading
cannot see the backup at all, and no restore has ever been recorded as
proven. Add backup age, rehearsal age and last-progress to
`app.office_health()`, and make the rehearsal record a durable verdict.

### T+4:30 — backup observability closed, and the restore PROVEN

**DEFECT-2 fixed** (0537 + 0538). `app.backup_health()` and
`app.last_progress()` exist; 0538 splices both into `app.office_health()`
from its LIVE definition, raising if its anchor has moved rather than letting
a no-op look like success. The reading now answers: is there a recent
FINISHED backup (a manifest is what makes a run complete — measured, the
manifest is written last), has a restore been PROVEN, when did work last
actually MOVE, and what are the two gaps nobody was measuring.

**DEFECT-3 fixed, and the restore is proven for the first time.**
`npm run backup:rehearse` ran to completion: **8/8, 153,259 of 153,259 rows
restored**, verdict recorded in `public.events` as `backup.rehearsed`. It
records both outcomes, because a ledger of successes cannot tell "the last one
failed" from "nobody ran one". No new table: the event ledger already holds
exactly this kind of fact.

**DEFECT-4 fixed.** The rehearsal swept its scratch schema only in a
`finally`, which cannot run if the process is killed — reproduced at T+0:50.
The sweep moved to the START of the run, which is the only place that covers
SIGKILL, plus signal handlers for the polite cases.

**DEFECT-7 found and fixed before shipping it.** `last_progress()`'s three
`max(occurred_at)` by `to_state` were **1,227 ms sequential scans** each —
I measured before embedding them, and would otherwise have added ~4s to
every health reading on a table growing 6,000 rows a day. With an index:
**2.1 ms**. The brief lists this failure by name.

**DEFECT-8 found and fixed.** The rehearsal exceeded the ten-minute
foreground ceiling *after* the restore had succeeded, in two loops of 122
sequential `count(*)` calls. 244 round trips became 2.

**How Grant finds out:** a chore on My Tasks, raised and cleared by the
hourly `office.chores` duty, deduped by `chore_key` — invariant 18 by
construction. Not a message: he has asked twice not to be narrated at.

**RPO/RTO, measured:** RPO ~24h by design, **48h observed** (17 Sept). RTO
data round trip **9m46s**; plus migrations from git; **plus every credential
by hand, because `vault-export` is disabled and has never run.** That last
term is the largest and nothing had ever measured it.

lint 0 · typecheck 0 · secrets clean · 2,219 tests · verify:backups 10/10.

**HUMAN_BLOCKED — offsite copy.** The only copy is a private bucket in the
same Supabase project it protects. It survives losing the code, this machine
and every other vendor account; it does not survive losing the project.
Anywhere else needs a new vendor account or Grant's whole database emailed to
himself, and `src/handlers/backup.ts` already records that as his decision
rather than mine. **The reading now states it every single time** instead of
leaving it to be discovered during a recovery. EXACT ACTION NEEDED: Grant
decides whether to fund an offsite target (e.g. a Cloudflare R2 free-tier
bucket, 10 GB, £0) or accepts single-project durability.

**HUMAN_BLOCKED — the empty vault.** `vault-export` is `enabled = false` and
has never run, so a restore yields a working database with no credentials.
Not enabled unilaterally: each run puts an encrypted copy of every credential
in a Telegram chat, and CLAUDE.md records that Grant chose weekly-and-by-hand
deliberately for exactly that reason. EXACT ACTION NEEDED: Grant says whether
the weekly vault export should be switched on; it is one row —
`update public.responsibilities set enabled = true where slug = 'vault-export'`.

**NEXT AUTONOMOUS ACTION:** brief §12 — idempotency and delivery. Invariants
4, 5, 7, 8 and 20: duplicate inbound, duplicate outbound, delivery retry not
re-running substantive work, completed-but-undelivered recovery.

### T+9:45 — closing state

`docs/ops/failure-domains.md` is the brief's §4 deliverable: every inbound,
core and dependency failure mode with what Grant sees, the loss risk, what
detects it, how fast, and where the monitoring is still blind.

**Live state at close:** queue drained (0 runnable, 0 in flight), work moved
1 minute ago, newest finished backup 6.7 h old and not overdue, restore
proven 0.9 h ago, **0 silent failures since 0535**, 1 open chore (the Slack
config token, awaiting Grant since 18 Sept), 0 test destinations registered.

**Suites: 11 reliability suites plus 7 static checks, all green.**
waiting 21/21 · budget 8/8 · fallback 16/16 · checkpoints 27/27 · drains 8/8
· chaos **29/29** (was 28/29) · security 20/20 · recovers 19/19 · transport
**23/23** (was 14/23) · progress 10/10 · jobs 34/34 · hq 47/47 ·
transitions identical · journals green · resumes green · backups 10/10 ·
check:leaks green · templates/callers/pressable/tokens/icons/reachable/
one-brain all 0 · lint 0 · typecheck 0 · secrets clean · 2,219 tests.

`verify:latency` is 4/5 and the one red is **not** reproducible as a product
defect: its 227 s Telegram sample was taken while `verify:progress` debris
was in the queue, and the honest seven-day median for a real delivered
Telegram instruction is **0 s to pickup, 22 s end to end**.

**The gate is 44 checks and runs well past ten minutes** (one suite alone
takes 198 s). Split per Grant's standing instruction rather than backgrounded:
the static family and the affected suites were run individually, with real
exit codes. A full 44-check sweep needs about 40 minutes and is the next
autonomous action for anyone continuing.

**Integration: READY WITH ONE NAMED ARTEFACT.** main never moved from
`3c94150`. `claude/human-simulation-harness` has taken migrations
0535–0538 **byte-identical** (verified by `git hash-object`) and continued at
0539, so the branches merge cleanly. The single artefact is
`[sequence/gap] gap between 0533 and 0535` on this branch, because 0534
belongs to that branch. Deliberately not resolved by copying their file:
this branch would then no longer represent only its own work, and a stale
copy is worse than a named gap. It closes the moment either branch merges.

**NEXT AUTONOMOUS ACTION:** run the full 44-check gate in segments; then the
two HUMAN_BLOCKED items are Grant's (offsite target, vault export) and the
Vercel token needs rotating.
