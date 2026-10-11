# Storage capacity decision for the Unified Activity Ledger

11 October 2026. Branch `release/activity-ledger-v1`, PR #462 (draft). **No production access of any kind was used for this document.** Nothing was deployed, migrated, activated, deleted, rewritten or bought.

Evidence labels, used on every number: **RECORDED** (a production reading already in this repository; the file and date are named), **MEASURED** (the isolated replica with the final candidate schema; the script is named), **INFERRED** (arithmetic from the first two), **ASSUMED**, **UNVERIFIED** (a vendor behaviour that could not be checked offline).

## 1. The decision, first

| Question | Answer |
|---|---|
| Is production read access authorised for this task? | **No.** This request says not to infer it. The earlier authorised reads (5, 7 and 9 October) were for other tasks and are used here only as RECORDED history. The exact read-only procedure is ready: `scripts/ops/capacity-baseline.sql`. |
| Actual database size today | **UNVERIFIED.** Last reading **374,803,603 bytes on 9 October** (RECORDED, `docs/audit/V1-FINAL-PRODUCTION-PREFLIGHT-2026-10-09.md`, P04b): 74.96 percent of 500 MB decimal (headroom **125.2 MB**), 71.5 percent of 500 MiB (headroom 149.5 MB). Which unit the platform counts in is UNVERIFIED; the conservative decimal figure is used. |
| Did the 6 October forecast hold? | **No.** It projected the database full between 10 and 19 October. It read 371.8 MB on 5 October, 369.7 MB on 7 October and 374.8 MB on 9 October (RECORDED): about **0.75 MB a day** over those four days, not 9 to 26. The earlier rate came from a backfill and an outage period. |
| What does the ledger really cost? | **One-off about 6.4 MB** (the three migrations 0.26 MB measured; the eleven read indexes about 6.2 MB, range 4 to 9, at the recorded row counts). **Per native event 742 to 800 bytes** typical, 1.4 KB for the largest payload the table accepts, 780 B for an outside worker's report (MEASURED). The earlier figure of 21 MB for the indexes was **wrong**: it was inferred from table bytes, which are inflated by bloat, not from row counts. |
| Does the ledger fit in the existing 500 MB allowance? | **Yes, for a single-office canary, by a wide margin, if the 9 October reading still holds**: one-off 6.4 MB plus 90 days at 250 events a day 17.9 MB, plus 25 percent, is **30 MB against 125 MB of headroom**. |
| Does the runbook's 65 MB gate pass? | The gate was computed from the wrong 21 MB. The measured requirement is **30 MB**; the gate is corrected. On the 9 October figure it passes with 4 times the margin. It must be re-evaluated on a fresh reading. |
| Time to capacity | **Without the ledger, 166 days** at 0.75 MB a day (47 days at the 7 to 9 October peak of 2.5 MB a day). **With the ledger at the current office, about 143 days** (range 125 to 154). The existing tables' growth dominates; the ledger moves the date by weeks. It matters more with several offices, heavy outside-worker reporting, or if the existing growth returns to its earlier rate. |
| Is a paid upgrade needed? | **No evidence for one.** The ledger fits; the long-term pressure is the existing update-heavy tables, where a measured model says a rewrite could return a large share (section 6). Re-assess only if a fresh baseline shows under 30 MB free **and** a rewrite cannot recover enough. |
| The nearer limit | **File Storage, not the database**: 504.7 MB of 1 GB on 9 October, 83 percent of it the `backups` bucket, growing about 0.9 MB a night, projected full about 23 to 28 October (RECORDED, `TIER1-PRODUCTION-EVIDENCE-2026-10-07.md`). The ledger adds to it through the nightly archive (section 4). `npm run backup:prune` (a dry run by default) is the existing, cheap answer and is Grant's to approve separately. |
| Release recommendation | **D now: block deployment pending one read-only production baseline** (the last measurement is two days old and the forecast already proved wrong once). **The evidence says it will resolve to A (deploy within the existing capacity)**, with B (rewrite the bloated tables) held in reserve. **C (more capacity) is not supported.** |

## 2. What is using the database (RECORDED, 5 October 07:37 UTC, `docs/ops/evidence/2026-10-05/capture-2026-10-05.jsonl`; sizes are `pg_total_relation_size`: heap, TOAST and indexes)

Total 371,772,563 bytes: `public` 330.5 MB, `pg_catalog` 22.3, `storage` 10.4, `cron` 6.5, `auth` 2.2, `app` 0.26, `net` 0.23, `vault` 0.18.

| # | Table | MB | Live rows | Total bytes a live row | Churn | Kind |
|---|---|---|---|---|---|---|
| 1 | `jobs` | 108.2 | 22,647 | **4,780** | 1,083,313 updates, 5 percent HOT, 10 indexes | essential operational; tasks and jobs |
| 2 | `job_state_transitions` | 38.5 (42.1 on 9 Oct) | 146,893 | 262 | append only | audit ledger |
| 3 | `events` | 33.5 | about 11,400 (1 Oct exact 9,958, scaled) | about 2,900 | append only | audit ledger |
| 4 | `inference_usage` | 24.9 | about 17,400 | about 1,400 | append only | billing, budget and model choice |
| 5 | `document_chunks` | 21.0 | 5,444 | 3,860 | 144 updates | derived (from `documents.content`) |
| 6 | `deliveries` | 19.3 | 4,554 | **4,240** | 206,362 updates, 0.2 percent HOT | exactly-once and audit |
| 7 | `documents` | 17.5 | 149 | | | user content (knowledge) |
| 8 | `job_traces` | 10.4 (11.5 on 9 Oct) | about 33,000 | | append only, already pruned at 30 days | debugging |
| 9 | `inbound_commands` | 8.8 | about 3,200 | | | conversations, origin evidence |
| 10 | `projects` | 8.0 | 1,958 | **4,100** | 89,416 updates, 0.5 percent HOT | user content |

Largest index recorded: `job_transitions_job_idx` 7.8 MB; it was the only index in the twelve largest relations, so **no other index exceeded 7.8 MB** (Q04 gives the full list). Also in the top twelve: `documents_search` 7.9 MB (derived). The ten tables are 298 MB of the 330 MB in `public`.

**By your classes** (sizes from the table above): essential operational and tasks/projects/jobs: `jobs` 108 + `projects` 8 = **116 MB**; conversations and messages: `inbound_commands` 8.8 MB and the outputs (under 7.8 MB); memory and knowledge: `documents` + `document_chunks` + `documents_search` = **46 MB** (lessons: 658 rows, small); native audit events: **none yet** (the ledger is off), existing audit ledgers `job_state_transitions` + `events` = **72 MB**; diagnostic: `job_traces` 10 MB and the model-call accounting 25 MB; temporary or reproducible: the derived knowledge indexes (29 MB of the 46), `job_traces`, `net._http_response`; index overhead: **not separable from the recorded figures** (Q03 splits heap, TOAST and index); other: `pg_catalog` 22 MB, `storage` 10 MB, `cron` 6.5 MB, `auth` 2 MB.

**What the growth is made of.** The evidence points at **update churn, not volume**:
- `jobs`, `deliveries` and `projects` hold 4.1 to 4.8 KB a live row. A freshly built `jobs` table on the replica is 0.7 KB a row with its ten indexes (MEASURED, `scripts/isolated/capacity-bloat-model.ts`). They are the three tables with tens of updates a row and almost no HOT updates, so every update writes a new row version and an entry in every index of the table. `jobs` has ten indexes (`jobs_dequeue_idx`, `_in_flight_idx`, `_correlation_idx`, `_parent_idx`, `_project_state_idx`, `_office_idx`, `_id_office_key`, `_one_live_per_idempotency_key`, `_finished_with_spend_idx`, the primary key).
- Autovacuum keeps the dead rows from accumulating (1,747 dead against 22,647 live on 5 October, 129 autovacuums) but **never returns the pages**: the file stays at its high-water mark. The migrations 0655 to 0660 rewrote 63,803 rows, which set a high mark that the table has not come down from.
- The append-only audit ledgers are healthy per row (`job_state_transitions` 262 B a row). `events` and `inference_usage` are 2.9 KB and 1.4 KB a row, which is more than their row width explains: **UNEXPLAINED from the recorded figures**; payload width, index count or bloat. Q03 and Q05 decide it. They are append-only audit and billing records and are not candidates for any change here.
- About half of the jobs are the TEST office's (10,068 person, 9,938 test, 529 system on 1 October, `P2-OWNERSHIP.md`). They cannot be deleted (a job has foreign keys from its transitions) and are not touched here.

## 3. What the ledger adds (MEASURED, final schema, `scripts/isolated/activity-storage.ts`, in the extended gate)

| Item | Result |
|---|---|
| Migrations 1060 to 1062 | **+0.26 MB** database size (empty tables and indexes, function bodies 0.05 MB). Nothing is written. |
| Native event, typical tool call, no project or job | heap 410 + indexes 332 + TOAST 0 = **742 B** |
| the same with a project and a job | 442 + 354 + 0 = **797 B** |
| an outside worker's report through the door | 444 + 336 + 0 = **780 B** |
| the largest payload the table accepts (300 character summary, about 3.8 KB metadata, 1 KB evidence) | 1,046 + 326 + 0 = **1,371 B**; still no TOAST |
| the previous estimates | 750 B measured and 850 B planned: **confirmed** (742 to 797, planning figure kept at 850 for margin) |
| Idempotent replay | adds no row and no byte (4,000 events written twice: 4,000 rows) |
| The eleven read indexes, bytes of index per row of the table they index (unique timestamps; concurrent build) | transitions 23.3; model calls 43.0; deliveries 3 x 48.6 = 145.9; outputs 33.7; events, inbound commands and blockers 45 (ASSUMED: no rows in the replica); impediments 30 (ASSUMED) |
| The same at the recorded production row counts | **6.15 MB** (range 4.3 to 9.2). The build on the replica: 0.1 s for 2,703 jobs, WAL about equal to the index size, **no temp files** (they sort inside `maintenance_work_mem`; 32 MB recorded). Scaled to production: well under a minute on the replica, seconds to a minute on the host (UNVERIFIED), WAL about 6 MB, transient. |
| Is anything copied from a source table? | **No.** The Activity read model reads the owning tables; reading a page writes no row. The projections add only the indexes above. |

**Correction of the earlier estimate.** The 21 MB inferred in phase 8 divided recorded table BYTES by replica bytes-per-row to guess row counts. Recorded row counts exist (transitions 146,893 and deliveries 4,554 on 5 October; the rest exact on 1 October and scaled by the jobs growth), and production rows are 5 to 9 times wider than replica rows because of bloat, so the guess over-counted rows by about 3.5 times. The runbook's 65 MB gate followed from it and is corrected to **30 MB**.

## 4. Forecast (`npm run activity:storage [headroom-MB] [other-growth-MB-a-day]`)

**Where events come from** (read from the code): an executed plan step with a capability writes **2** events (`requested`, then `completed` or `failed`; `src/agents/perform.ts`); a stalled job reclaimed by the sweep writes 1; a budget threshold at most 1 a day per office and agent (migration 1062); an outside worker's report 1 each (capped at 300 an hour per worker, 1,000 an hour and 4,000 a day per office). **A message, a task or a delivery writes none**: the read model reads their own rows. Events a day is therefore 2 x executed plan steps + reclaimed jobs + thresholds + external reports, not one per message.
**Rate** (INFERRED, ASSUMED until Q10 is read): the office has recorded 4,906 `job_steps` in all since August, about 120 a day counting every harness job, so the current office writes **at most about 240 events a day and probably 25 to 150**; 100 a day is used as central, 250 as the upper end of "current".

Native event storage, MB, at 797 B an event (range 742 to 1,371 B in the last column):

| Events a day | 30 days | 90 days | 180 days | 365 days | 365 days, range |
|---|---|---|---|---|---|
| 100 | 2.4 | 7.2 | 14.3 | 29.1 | 27.1 to 50 |
| 250 | 6.0 | 17.9 | 35.9 | 72.7 | 67.7 to 125 |
| 500 | 12.0 | 35.9 | 71.7 | 145 | 135 to 250 |
| 1,000 | 23.9 | 71.7 | 143 | 291 | 271 to 500 |
| 2,000 | 47.8 | 143 | 287 | 582 | 542 to 1,001 |
| 5,000 | 120 | 359 | 717 | 1,455 | 1,354 to 2,502 |

The diagnostic cap (500 a day an office; tool calls only) bounds the tool-call part. Existing-table growth is separate: recorded **0.75 MB a day** for 5 to 9 October (2.5 a day for 7 to 9 alone).

Against the recorded 125 MB headroom, after the 6.4 MB one-off cost:

| Scenario | Ledger MB a day | 90 days | 365 days | Days to full, all growth | Range | If other growth were 10x | Ledger share of growth |
|---|---|---|---|---|---|---|---|
| current single user, about 100 a day (25 to 250) | 0.08 | 7.2 | 29 | **143** | 125 to 154 | 16 | 10% |
| heavier autonomous, 500 a day (300 to 1,000) | 0.40 | 35.9 | 145 | 103 | 77 to 120 | 15 | 35% |
| two active offices (the recorded count), 250 each | 0.40 | 35.9 | 145 | 103 | 77 to 130 | 15 | 35% |
| outside workers and Hermes added, about 1,000 a day (600 to 4,500) | 0.80 | 71.7 | 291 | 77 | 27 to 97 | 14 | 52% |
| five offices at 250 a day (a future case) | 1.00 | 89.7 | 364 | 68 | 43 to 103 | 14 | 57% |

With no ledger the other growth alone fills 125 MB in 166 days. **The ledger is a small part of the database's problem at the current office and a large one only if several offices or heavy outside-worker reporting arrive.** The same arithmetic with a 10 times lower other-growth rate (0.1 MB a day) gives 660 days for the current office.

**Effect on the 1 GB file allowance through the nightly backup** (the backup is whole tables as rows and discovers tables itself, so the ledger is in it from the first night; about 82 compressed bytes a row, RECORDED 12.5 MB for 153,259 rows). At 250 events a day the nightly archive grows by about 1.84 MB after 90 days. Because backups are never deleted today that is about **84 MB of file storage over 90 days**, more than the 18 MB the ledger takes of the database; with the retention policy that `backup:prune` applies it is about 23 MB. At 100 a day: 34 MB and 9 MB.

## 5. Is the 500 MB database sufficient?

For the ledger's canary: **yes, on the last reading.** For the longer term the question is the existing tables, not the ledger: at the recorded 0.75 MB a day the headroom lasts about 5 months, at 2.5 MB a day under 2 months. That is why the next section matters more than the ledger's own cost.

## 6. Safe storage optimisations (none implemented in production; each needs the approval named)

| # | Optimisation | Estimated saving | Risk | Complexity | Reversible | Audit history | Agent function | Status |
|---|---|---|---|---|---|---|---|---|
| O1 | **Rewrite the bloated tables** (`VACUUM FULL` on `jobs`, then `deliveries`, `projects`) in a quiet window | **model: a table with this churn returns 80 percent of its size** (MEASURED on a real `jobs` copy, 48 updates a row, 10 indexes: 12.9 MB to 2.3 MB). If production's `jobs` has the same slack, **about 60 to 90 MB** from `jobs`, 13 to 16 MB from `deliveries`, 5 to 6 MB from `projects` (INFERRED; Q05 and Q06 measure it) | an exclusive lock on each table for the duration (seconds to a minute per table on this size), so the queue and duties wait; needs free space equal to the new copy (at most about 40 MB, far below the 125 MB headroom) | low (one statement a table) | **yes: the data is identical and nothing is deleted**; if interrupted it changes nothing | none: no row changes, append-only guards are on UPDATE, DELETE and TRUNCATE and a rewrite does none of them | the worker's claim blocks for the lock; run when it is quiet | **approval A9 (production write)** |
| O2 | A per-table autovacuum setting on `jobs` (`autovacuum_vacuum_scale_factor` lower) so a burst cannot set a new high-water mark | prevents recurrence, not a saving now; the model shows the plateau is set by how many versions pile up between vacuums | low | trivial (a reloption) | yes, one statement | none | none | with O1, same approval |
| O3 | Evaluate the diagnostic cap of 500 a day | **no change recommended.** The current office writes at most about 240 events a day, so the cap does not bind; at the cap one office adds 0.5 MB a day, which fits | none | | | | | **keep 500**; revisit after a week of canary data (`native_diagnostic_24h` in the health reading, added) |
| O4 | Stop recording `tool.call_requested` | halves tool-call volume (about 0.04 MB a day at the current office) | the page could no longer show a call that never finished | small, in the worker | yes | loses "started" detail | none | not recommended: the saving is small |
| O5 | Shorten the idempotency key's index (150 B of the 332 B of index per event) | about 12 percent of an event, about 3 MB a year at 250 a day | changes every writer's key | moderate | no | none | none | not recommended: low value |
| O6 | Remove a "redundant" index | none found: the eleven new indexes total 6 MB; any existing candidate needs Q04 (`idx_scan`) first | | | | | | no evidence yet |
| O7 | Archive old diagnostic native events | **49 B an event archived against 832 B online** (17 times; REHEARSED, section 7) | see section 7 | | | | | **approval A10, not before the ledger holds data** |
| O8 | `backup:prune` for the FILE allowance | up to about 190 MB of Storage (the 373.9 MB `backups` bucket under the keep-7-daily-plus-8-weekly policy) | deletes old backups; the newest verified copy and a weekly tail remain | existing tool, dry run by default | no (deletion) | none | none | **approval A11 (its own deletion approval)**; it is the nearer cliff |
| — | Already in place: `job_traces` pruned at 30 days hourly; build pictures expire; the capacity watch (migration 1026) samples size daily | | | | | | | nothing to do |

Not candidates, and why: `job_state_transitions`, `events`, `inference_usage` and `deliveries` rows (audit, billing, exactly-once; append-only by trigger); `jobs` rows (foreign keys; "a job can never be deleted"); `documents` and the derived `document_chunks` and `documents_search` (retrieval depends on them); lessons, tasks, projects, conversation rows (agent memory and user content). **Nothing in this document proposes deleting any of them.**

## 7. Retention and archiving

**Rehearsed, not assumed** (`scripts/isolated/activity-archive-rehearsal.ts`, in the extended gate, 10 checks): diagnostic native events older than a horizon are exported to gzipped JSON lines with a sha256 manifest; removed from the live table (on a disposable replica only: the product has no delete path and none is added); the Activity read still answers over what is left and every consequential event is untouched; the archive is verified against its manifest and restored; **the table is byte-identical to the original (every column of every row) and the old window reads the same events in the same order**, and a replayed idempotency key is still recognised. Measured: **49 B an event archived against 832 B online** (the synthetic payload is repetitive; expect 100 to 150 B on real text). The proposal that was rehearsed is a one-off export file, not a product capability: nothing schedules it.

Recovery already exists independently of this mechanism: the nightly backup contains whole tables, so any ledger row is recoverable from a backup (restore rehearsal last passed 21 September, now overdue; run `npm run backup:rehearse`).

| Policy | Online size of the ledger at 250 events a day (240 diagnostic, 10 consequential) | Cost | Verdict |
|---|---|---|---|
| Permanent online retention | 73 MB a year, growing without limit | none to build | **recommended for the canary**: 0.2 MB a day is small against 125 MB |
| 12 months online, older archived | steady about 73 MB, plus about 4 to 8 MB a year of archive | export, verify, delete, restore test | not needed yet |
| 90 days online, older archived | steady about **17 MB** of diagnostic plus 3 MB a year of consequential | the same | the right shape if several offices arrive |
| Tiered: consequential events permanent online, diagnostic 90 days online then archived | steady about 17 MB + 3 MB a year | the same, only for diagnostic events | **recommended target policy when the canary is widened** |

Deleting, archiving, removing reproducible projections and suppressing diagnostics are four different acts: the projections are never stored, so there is nothing to remove; suppression is the cap; archiving needs the rehearsed mechanism plus an audited path (a decision and a migration); **deleting without an archive is not proposed.** Historical Activity needs to be recoverable, not instantly searchable: the page asks for recent windows.
Decision needed only when the ledger is widened: **A10**.

## 8. Reading the storage in the canary (added to the health reading, no query needed)

`activity_ledger_health` now returns `native_diagnostic_24h`, `diagnostic_cap_per_day` and, **for the deployment's own office only**, `native_table_bytes` (a whole-table size says something about every office's volume). Checked: a person's office gets `null` for the size and its own counts. The runbook's daily canary check compares `native_table_bytes` to the forecast: **a table more than twice the forecast, or the database headroom under 30 MB, is a stop condition.**

## 9. Outstanding approvals (separate; none implies another)

| # | Approval | Needed for |
|---|---|---|
| **A3** | **A production READ-ONLY baseline** (`ALLOW_PRODUCTION_CHECKS=1`): the fifteen statements of `scripts/ops/capacity-baseline.sql`, one at a time | replaces every INFERRED figure here, settles the gate, and turns recommendation D into A or B. **The only decision genuinely needed before deployment.** |
| A9 | Rewrite the bloated tables (O1, O2), a production write | only if the baseline shows the headroom under the gate or Grant wants the space back |
| A10 | Retention horizon and the archive mechanism (section 7) | only when the ledger is widened beyond one office |
| A11 | `backup:prune` deletion | the file-storage allowance, independent of the ledger |
| A12 | Any paid capacity | **not requested; no evidence supports it** |
| A1, A2, A4 to A8 | as in `APPROVAL-REQUEST.md` (human SQL review, merge, migrations, deployment, hard read bound, canary, retention values) | unchanged |

## 10. The queries (all read-only; `scripts/ops/capacity-baseline.sql`; every one was parsed and run on the replica, which has the production schema and none of its data)

Q01 database size and both percentages; Q02 bytes by schema; Q03 the thirty largest tables split into heap, TOAST, indexes, live and dead rows, updates and bytes a row; Q04 the thirty largest indexes with `idx_scan`; Q05 a statistics-based estimate of wasted space per table (no extension); Q06 `pgstattuple_approx('public.jobs')` for the exact free space (optional: the extension may not be installed); Q07 row counts of what the eleven indexes cover; Q08 the two existing indexes the read plan relies on; Q09 jobs by office kind; Q10 executed plan steps and transitions a day for 30 days (**the event rate the ledger would inherit**); Q11 `capacity_samples` (daily size history, if the capacity watch has sampled); Q12 Storage by bucket; Q13 role statement timeouts (the F2 baseline: the 5 October record shows `authenticator` 8 s, `anon` 3 s, `authenticated` 8 s and a global 120 s); Q14 the settings that bound an index build; Q15 nightly backup sizes.
Procedure: `ALLOW_PRODUCTION_CHECKS=1 npm run qq -- "<one statement, comment lines removed>"`; then `npm run activity:storage <headroom from Q01> <MB a day from Q11 or the last two readings>`.

## 11. What would change this decision

A fresh Q01 under about 155 MB used (headroom under 30 MB plus margin): B first (rewrite), then reconsider C. Q05 and Q06 showing little slack in `jobs`: B recovers less, and a headroom under the gate then means C or removing something authoritative, which is not proposed. Q10 showing far more than 240 events a day: lower the cap and re-run the forecast. A second active office: the multi-office rows above. The 6 October forecast being right after all (the database much larger than 375 MB): D stands and the release stops at deployment.
