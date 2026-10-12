# Unified Activity Ledger - one consolidated approval request

11 October 2026, updated 12 October (Phase 9). Everything that needs no approval is done. What follows is what only Grant (or a named reviewer) can authorise. **Approving one item approves nothing else.** **A3 has been used once** (12 October 08:11 to 08:16 UTC, read-only, 20 statements and two metadata reads; results in `PRODUCTION-BASELINE-2026-10-12.md`). Nothing else has touched production.

## 1. The release candidate

Branch `release/activity-ledger-v1`, commit: **see the head of the branch on PR #462** (the commit this file is part of; verify with `git rev-parse HEAD` and compare the migration hashes in `HUMAN-REVIEW-PACKAGE.md`). Based on `main` `5fa1fbdc`, which has not moved. Migrations `1060`, `1061`, `1062` (unapplied). PR: https://github.com/granterogers/agentic.team.grant/pull/462, open and **draft**.

## 2. What changed in this phase

F2 closed (cooperative budget, gateway 504, page error state; the hard bound needs your decision), F3 not reproduced and a real own-office cost fixed, storage measured and a diagnostic cap added, a third review and its fixes, the human-review package, the runbook with a storage gate and the baseline reads. See `RELEASE-READINESS.md`, Phase 8 addendum.

## 3. The things you should know before deciding

1. **Capacity does not block the ledger, but file storage is the nearest limit in the whole release.** Read live on 12 October 08:12 UTC: the database is **381.5 MB of 500 MB, 118.5 MB free**, growing about 1.4 to 2.2 MB a day (so about seven weeks of runway, with or without the ledger). The ledger costs about **7 MB once** and 0.2 MB a day at 250 events a day, so the migration gate (about 31.5 MB) **passes 3.8 times over**; no extra capacity is needed. **File storage is 602.9 MB of 1 GB and is growing about 36 MB a night** (87 percent of it backups): the nightly backup would fail on **about 22 to 24 October**. That is independent of the ledger and **needs decision A11 before then**. The bloated tables (about 136 MB estimated recoverable) are a rewrite decision (A9) that can wait inside the seven weeks.
2. **A human must read the SQL and the redactor** (`HUMAN-REVIEW-PACKAGE.md`). Three model-assisted reviews are not that.
3. **The hard read bound is a production setting** nobody has chosen. Without it, one slow database pass is not interruptible (the rest is bounded).
4. Nothing destructive is proposed or done. Retention of old diagnostic events is your decision (`STORAGE-AND-RETENTION.md`).

## 4. The approvals, separately (each is a yes or a no; none implies another)

| # | Approval | What it allows | What it does not allow | Needed before |
|---|---|---|---|---|
| A1 | **Human SQL and redactor review** by a named person | their sign-off recorded in `HUMAN-REVIEW-PACKAGE.md` | anything on its own | A3 onward |
| A2 | **Merge PR #462** into `main` | the merge commit (the change is dormant: ledger off, nothing applied) | deploying, migrating, activating | nothing |
| A3 | **Production read-only checks** (`ALLOW_PRODUCTION_CHECKS=1`), the baseline reads in `MIGRATION-PLAN.md` step 0 | reading headroom, table sizes, index state, role timeouts, error baselines, the platform health reading | any write | A4 |
| | **A3 status: EXECUTED once on 12 October** (Phase 9). Re-read Q01, Q11, Q12, Q19 on the day of any migration; a new run needs a new authorisation | | | |
| A4 | **Production migrations** (both production flags), `1060`, `1061`, `1062` one at a time, then the concurrent index build | applying the three files and building eleven indexes, in a quiet window, stopping on any unexpected result | deploying services, activating | A1, A3, the storage gate |
| A5 | **Production deployment** of the worker, then `hq-api`, then the page, with the master switch off | the three deploys, each probing itself | activating | A4 |
| A6 | **Hard read bound** (one of: role `statement_timeout`; PostgREST pre-request hook; or accept the cooperative bound) | the chosen setting, after reading the current values | anything else | A5 (or accept) |
| A7 | **Canary activation** for ONE named office, with the observation window (suggested 7 days) and the rollback limits in the runbook | `npm run activity:switch -- --canary <office> --apply` | any other office, the global mode | A5 and A6 |
| A8 | **Retention and capacity decisions** | the diagnostic cap value (default 500 a day), the retention horizon for diagnostic events (for example 90 days), whether to record `tool.call_requested`, whether any paid capacity may be bought (no price is assumed) | none done without this | before more than one office |
| A9 | **Rewrite the bloated tables** (`jobs`, `events`, `inference_usage`, `deliveries`, `inbound_commands`, `projects`) in an idle-queue window; production write | about 136 MB estimated, a peak of about 30 MB transient space, minutes of table locks, no data change | any deletion; any other maintenance | within about six weeks, or sooner if headroom falls under 60 MB; **not before the ledger** |
| A10 | **Archive/retention mechanism for diagnostic events** | as rehearsed on the replica | anything before the ledger holds data | before more than one office |
| A11 | **Backup prune** (`npm run backup:prune -- --attended` with both production flags) for the exact list the dry run prints | about 263 MB if all 35 backups verify (24 runs; 11 kept), after a restore rehearsal | any other deletion | **before about 22 October** (file storage) |
| A12 | **Any paid capacity** | nothing is requested; the evidence does not support it | | |

## 5. How each step is done and undone (full commands and stop conditions: `MIGRATION-PLAN.md`)

- **Baseline (A3):** five reads, recorded. Stop if any service is unhealthy, a name collides, an `activity.*` setting already exists, or the storage gate fails.
- **Schema and indexes (A4):** `npm run migrate:one -- migrations/106x_*.sql` ×3, then `npm run activity:indexes` (direct connection, quiet window). Undo: the three files are additive; indexes drop independently; nothing already recorded is deleted.
- **Deploy (A5):** `deploy:worker`, `deploy:hq-api`, the page; compare live bytes with `origin/main` first. Undo: redeploy the previous version; the schema needs no change.
- **Canary (A7):** plan with `--canary <office>`, read CURRENT and PROPOSED, apply. Check at 1 h, 24 h and daily: `activity_health` clean; table size against forecast; newest page p95 under 2 s; activity 504s near zero. **Kill switch:** `--off --apply`.
- **Acceptance (after A7):** real events visible in Team HQ for that office only, an approval and a delivery shown with correct provenance, no other office's rows, rollback exercised, release record and `docs/ops/deployment-state.json` updated. Production acceptance is not declared before all of that is observed.

## 6. Evidence (replica, local browser, model-assisted; all rerunnable)

vitest 7 047 passed, 21 skipped. Critical gate 68 of 68 (3 682 assertions). Extended 85 of 85 (2 130). Sabotage 56 of 56. Rehearsal 19 of 19. Activity UX harness 288 of 288 at 1440, 768, 390 and 320 (axe, contrast, no overflow, timed-out read state). Mixed versions: old code on the new schema 66 of 68 (two structural reds), new code on the old schema 4 of 4. Static checks clean; two known baseline failures from main (`check:carrier-writers`); `check:icons` not run (production-gated). Not tested: a real iPhone or Safari, a real screen reader.

## 7. Outstanding risks

R1 one database pass is not interruptible without the hard bound (A6). R2 capacity (above). R3 the cap is soft under concurrent writers. R4 a gateway abort may not cancel the database work. R5 caller-asserted external worker name until an authenticated boundary exists. R6 no human review yet. R7 the model-assisted findings are a floor, not a ceiling.

## 8. What this phase did NOT do

Merge, deploy, apply a migration, **write** to production, change a flag, activate any office, contact anyone, spend money, or touch the Hermes branch. (Phase 9 did read production, read-only, under A3 only.)
