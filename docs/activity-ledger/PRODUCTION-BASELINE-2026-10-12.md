# Production capacity and health baseline, 12 October 2026

**Executed.** Read-only, under approval A3 only (granted in the Phase 9 brief). Taken 12 October 2026 between 08:11 and 08:16 UTC against project `baujwlzcziasnfhhkchg` (the production project; the platform health API read auth, db, rest and storage `ACTIVE_HEALTHY` before and during the reads).
**Production changes: none.** No write, migration, deploy, flag change, deletion, rewrite, maintenance command or purchase. Evidence labels: **MEASURED-LIVE** (a production read in this document, with its time), **RECORDED** (an earlier production reading in this repository), **INFERRED**, **UNVERIFIED**. Nothing here is a replica figure; where the replica is used it says so.

## 1. How the reads were made, and why they are safe

| Control | Detail |
|---|---|
| Endpoint | the Management API's **read-only** query endpoint (`/database/query/read-only`), which runs as `supabase_read_only_user`: the database refuses any write whatever the statement says |
| Static rule in front | `scripts/release/preflight-read.ts` sends a statement only if it is one plain `select` (no second statement; none of insert, update, delete, drop, alter, create, truncate, grant, revoke, copy, call, do, pg_sleep, nextval, setval, set_config, lock). `tests/release/capacity-baseline.test.ts` holds both files to it, proves the rule can refuse, and proves the two copies of the query file are identical |
| Load | one statement at a time, 20 s client timeout each, no retry; 0.9 to 4.2 s each (Q09 jobs by office kind 4.2 s and Q10 30-day counts 3.1 s were the slowest); no `pg_stat_statements` read; no table scan except the catalogue and two small tables |
| Not run | `backup:prune` (see section 6: its own gate needs the production-write flag even for a dry run, which this approval does not grant; the retention planner was run locally over read-only metadata instead). Q06 (`pgstattuple_approx`) failed harmlessly: the extension is not installed in production |
| Credentials | existing environment credentials; no value printed or written |
| Files | `docs/audit/ACTIVITY-CAPACITY-BASELINE-QUERIES-2026-10-12.sql` (Q01 to Q23, the file the read-only tool can load; `scripts/ops/capacity-baseline.sql` is its identical copy) and `docs/audit/ACTIVITY-CAPACITY-BACKUPS-INVENTORY-2026-10-12.sql` (B01, B02: object names, counts, sizes, times; nothing downloaded) |

## 2. Database capacity (Q01, Q02, 08:12:15 UTC)

| | |
|---|---|
| Database size | **381,521,043 bytes** (381.5 MB decimal) |
| Quota | 500 MB (free tier; the platform counts it in decimal or in MiB, UNVERIFIED which) |
| Used | **76.3 percent** of 500 MB decimal; 72.8 percent of 500 MiB |
| **Headroom** | **118.5 MB** (decimal); 142.8 MB if the allowance is 500 MiB. The conservative figure is used throughout |
| Capacity watch (`public.capacity_samples`, Q11) | database 378.6 MB on 10 Oct, 380.9 MB on 11 Oct, 381.5 MB on 12 Oct, level 1 (warning band) |
| By schema | `public` 333.1 MB (150 relations), `pg_catalog` 22.5, `storage` 14.8, `cron` 8.1, `auth` 2.5, `net` 0.8, `app` 0.27, `vault` 0.18 |

**Growth since the 9 October reading** (374,803,603 bytes, RECORDED): **+6,717,440 bytes (+1.79 percent) in about three days, about 2.2 MB a day.** Against the 5 October reading (371,772,563) it is +9.75 MB in seven days, **about 1.4 MB a day**. Both are real; the 5 to 9 October figure of 0.75 MB a day used in the 11 October audit was a quiet few days and understated the rate, so **the 11 October "143 days" runway is replaced by about 50 to 80 days** (section 4). Components (Q03 against the 9 October tables): `job_state_transitions` +2.7 MB (about 3,200 transitions a day at 264 B a row, 0.85 MB a day), `job_traces` +0.6 MB, `events` +0.5 MB, `cron` schema +1.6 MB in a week (`cron.job_run_details`, not looked at further), `jobs` flat at 108.2 MB. Growth is append-only ledgers, not bloat.

### Largest tables (Q03; heap, TOAST and indexes; MB)

| Table | Total | Heap | TOAST | Indexes | Live rows | Dead | Updates (HOT) | Bytes a live row |
|---|---|---|---|---|---|---|---|---|
| `jobs` | 108.2 | 98.8 | 0.02 | 9.4 | 25,487 | 3,114 | 1,112,862 (60,615) | 4,247 |
| `job_state_transitions` | 44.8 | 21.0 | 0.01 | 23.8 | 169,922 | 0 | 0 | 264 |
| `events` | 34.0 | 26.6 | 0.02 | 7.3 | 14,514 | 9 | 471,542 (272) | 2,340 |
| `inference_usage` | 24.9 | 18.5 | 0.01 | 6.4 | 16,905 | 0 | 687,099 (230) | 1,476 |
| `document_chunks` | 21.1 | 8.3 | 5.5 | 7.2 | 5,458 | 144 | 144 (0) | 3,859 |
| `deliveries` | 19.3 | 16.1 | 0.01 | 3.2 | 4,678 | 470 | 206,511 (438) | 4,135 |
| `job_traces` | 12.1 | 8.7 | 0.01 | 3.4 | 44,643 | 108 | 0 | 271 |
| `inbound_commands` | 8.8 | 6.8 | 0.01 | 2.0 | 4,570 | 108 | 118,806 (139) | 1,932 |
| `documents` | 8.7 | 0.3 | 6.2 | 2.3 | 167 | 13 | 6,169 (197) | 52,341 |
| `outputs` | 8.2 | 6.4 | 0.06 | 1.7 | 18,715 | 181 | 5,068 (7) | 439 |
| `projects` | 8.0 | 2.2 | 0.01 | 5.8 | 1,968 | 308 | 89,418 (472) | 4,075 |

### Largest indexes (Q04; MB, scans since the statistics reset on 25 August)

`job_transitions_job_idx` 9.0 (1,736,676 scans), `job_transitions_state_time_idx` 7.6 (9,796), `job_state_transitions_pkey` 7.2 (355), `document_chunks_search` 6.4 (**1 scan**), `projects_name_trgm` 5.1 (**0 scans**), `jobs_correlation_idx` 2.6, `job_traces_pkey` 2.3, `jobs_project_state_idx` 2.3 (5.7 M scans), `documents_search` 2.0, `inference_usage_by_model` 1.9, `events_action_time_idx` 1.9. Never or almost never scanned: `projects_name_trgm`, `document_chunks_search`, `decisions_search` (1.1), `mail_messages_search` (0.8), about 13 MB together. They look like candidates; **no change is proposed** (a rarely used search index can be a feature's only path), and dropping one is a production write.
Both indexes the ledger's read plan relies on exist (Q08: `jobs_office_idx`, `job_transitions_job_idx`).

### Other health indicators

| Indicator | Reading | Note |
|---|---|---|
| Invalid indexes (Q19) | **0 of 430** public indexes | no leftover from an interrupted build |
| Connections (Q20) | 8 backends: 6 idle, 1 active, 1 background | no pressure |
| Counters since 25 Aug (Q18) | 5.52 M commits, 21,855 rollbacks, **21 deadlocks**, 0 recovery conflicts | ordinary |
| Temp files (Q18) | 88,395 files, **447 GB** | was 365 GB at the 4 October note: still about 10 GB a day from an unidentified source; unrelated to this release; `log_temp_files` was restored to off |
| Index builds (Q14) | `maintenance_work_mem` 32 MB, `max_wal_size` 1 GB, `work_mem` 2.1 MB, autovacuum on | the ledger's indexes sort in memory (at most 170k rows) |

## 3. Migration state and ledger activation (Q16, Q17, Q21)

| | Reading |
|---|---|
| Applied migrations | **814**; highest `1053_a_public_key_reaches_no_view.sql` |
| At or above 1060 | **0**: none of the ledger's three migrations is applied |
| 1042 to 1053 | applied, and **byte-for-name identical to the files in `migrations/` on `main`** (Q21 against the directory): the V1 and Dashboard Polish releases are live; `docs/ops/deployment-state.json` (9 October, 802) is a record and is behind this live reading |
| Numbering | the ledger's 1060 to 1062 apply after 1053 with nothing between; Hermes (1070+) does not collide |
| Ledger table | `public.activity_events` **does not exist** (`to_regclass` null) |
| Activity settings | **0** `activity.*` rows in `system_config`: the master switch has never been written, so it is absent, which fails closed (off) |

## 4. Migration headroom gate: PASS

The gate is: free space, after the migrations, covers **the schema additions, the index builds, the 90-day canary and a 25 percent margin** (about 31.5 MB), **and** the existing growth does not exhaust the headroom inside the observation window. Recomputed on today's row counts (`npm run activity:storage 118.5 2.2`; the row counts are Q07):

| Component | MB | Basis |
|---|---|---|
| Schema additions (1060 to 1062) | 0.26 | MEASURED on the replica (empty tables, indexes, function bodies) |
| The eleven read indexes | **6.98** (range 4.9 to 10.5) | MEASURED bytes a row on the replica x MEASURED-LIVE row counts (transitions 169,922, outputs 18,715, inference 16,905, events 14,514, deliveries 4,678, inbound 4,570, impediments 2,347, blockers 1,229) |
| Temporary overhead of the build | about 0 on disk; WAL about the size of the indexes (about 7 MB, transient, against a 1 GB `max_wal_size`) | the build sorts inside `maintenance_work_mem` (32 MB); the replica build made no temp file |
| Interrupted build | at most one invalid index, **at most 4.0 MB** (the largest, on transitions), left in place until dropped; Q19 is 0 today | `npm run activity:indexes` drops an invalid one and rebuilds it (outcome `rebuilt-after-invalid`); Q19 must read 0 before and after |
| 90 days of the canary at 250 events a day, 797 B an event | 17.9 | MEASURED per event; rate ASSUMED, ceiling for the whole deployment 330 a day (Q10: 142 to 163 executed plan steps a day, 2 to 11 October) |
| **Ledger total with 25 percent margin** | **31.5** | against **118.5 MB free: PASS, 3.8 times** |
| Existing growth over a 30-day window | 66 at 2.2 MB a day (42 at 1.4) | MEASURED-LIVE trend, not a promise |
| Runway after the migrations, existing growth plus a 100-a-day ledger | **about 49 days** (about 79 at 1.4 MB a day) | `activity:storage`; the ledger alone moves it by about 5 days |
| Runway with no ledger | 54 days (85 at 1.4) | |

**Verdict: PASS for the migration.** The migration and the canary fit in the allowance several times over, and nothing in the gate needs a purchase. **PASS does not mean the database is healthy for ever**: at the recent rate the allowance is exhausted in **about seven weeks (early December) with or without the ledger**. The ledger is 3 to 15 percent of growth at the current office. The pre-existing 136 MB of estimated table slack (section 5) is what moves that date, not the ledger. Minimum additional capacity required: **none**.
Sensitivity (all from `npm run activity:storage`): if the ledger writes 500 a day the runway is 43 days; with outside workers at 1,000 a day, 37 days; five offices at 250 a day, 35 days (the existing-growth rate dominates every case).

## 5. Table bloat (Q05; an estimate from planner statistics; the exact measure, Q06, is not available)

| Table | Pages now | Planner rows | Pages now / pages its live rows need | Estimated wasted |
|---|---|---|---|---|
| `jobs` | 12,060 | 25,451 | **5.5** | **80.9 MB** |
| `events` | 3,249 | 13,762 | 4.2 | 20.3 MB |
| `inference_usage` | 2,254 | 15,818 | 6.6 | 15.7 MB |
| `deliveries` | 1,965 | 4,472 | **9.5** | 14.4 MB |
| `inbound_commands` | 825 | 4,530 | 2.2 | 3.7 MB |
| `projects` | 263 | 1,902 | 2.0 | 1.1 MB |
| **Total** | | | | **136.1 MB** (35.7 percent of the database) |

All the append-only ledgers that are not updated (`job_state_transitions`, `job_traces`, `document_chunks`, `job_steps`) read **1.0**: healthy. The wasted space is in the tables that take many updates with almost no HOT updates (`jobs` 1.1 M updates, 5.4 percent HOT; `events` 471 k, 0.06 percent; `inference_usage` 687 k, 0.03 percent; `deliveries` 207 k, 0.2 percent). `events` and `inference_usage` are described elsewhere as append-only; the 32 and 41 updates a row are **not explained here** (a counter or status column is the likely cause) and are a finding, not a defect claim. The `jobs` heap has not shrunk at all since 5 October (108.2 MB both times) although rows grew 12 percent: autovacuum reuses the space and never returns it.

| Rewrite assessment (A9 is separate) | |
|---|---|
| **Recoverable** | about **136 MB estimated** (jobs 81, events 20, inference 16, deliveries 14, others 5); the heap only, indexes could shrink further; the replica model on a real `jobs` copy returned 80 percent (12.9 to 2.3 MB). An estimate: Q06 cannot confirm it because `pgstattuple` is not installed |
| Command and lock | a table rewrite (`VACUUM FULL`) takes an **ACCESS EXCLUSIVE** lock per table for its duration; reads and writes to that table wait. The platform's role timeouts (8 s statement, 8 s lock for the roles PostgREST uses) would make queued API requests fail rather than wait: it must be done with the worker idle, in a quiet window |
| Temporary space | the new copy plus its rebuilt indexes while the old exists: about **27 MB for `jobs`** (18 MB of heap, 9 MB of indexes), under 10 MB for each other table, one table at a time, so a peak of about 30 MB of the 118.5 MB headroom, returned at once; WAL about the same size |
| Duration | the replica rewrote a `jobs` copy in seconds; production `jobs` is 99 MB of heap on a small host, so **UNVERIFIED but expected seconds to about a minute a table**; a window of 5 to 10 minutes for all six, with the queue paused |
| Risk | an interrupted statement changes nothing (it is atomic: the old file stays until the new one is complete); no row is altered, so audit history is untouched; the risk is the stalled queue and the transient space, not data |
| Rollback | nothing to roll back after success (the data is identical); if abandoned mid-way, nothing changed. A prior verified backup exists (section 6) |
| Needed before the ledger release? | **No.** Headroom is 118.5 MB against a 31.5 MB gate. **Defer**, and schedule it inside the seven-week runway: it is the cheapest 130 MB available. A trigger worth writing into the runbook: do it if headroom falls under 60 MB |
| Stop the bloat returning | a per-table autovacuum setting on `jobs` (A9, small); the structural cause is the updates themselves |

## 6. File storage and backups (Q11, Q12, Q15, B01, B02)

| | Reading |
|---|---|
| Used | **602,896,728 bytes (602.9 MB)**: `backups` 525.0 MB (6,482 objects, 87 percent), `build` 66.1 MB (132), `avatars` 9.8 MB (16), `files` 1.9 MB (195). The four buckets sum exactly to the capacity watch's `storage` sample on 11 and 12 October |
| Allowance | 1 GB (decimal, conservative; 1,074 MB if it is 1 GiB) |
| **Headroom** | **397.1 MB** (60.3 percent used) |
| Growth | **about 36 MB a night**: the nightly archive was 26.9 MB on 9 Oct, **35.4 MB on 10 Oct and 35.8 MB on 11 Oct**; the storage figure was 504.7 MB on 9 Oct (before that night's run), 567.1 MB on 10 Oct and 602.9 MB on 11 and 12 Oct. The 8.5 MB step between the 9 and 10 October archives touches every table (`job_state_transitions` 6.1 to 10.5 MB, `document_chunks` 4.2 to 5.4 MB with no new content, `outputs` 1.8 to 2.3): it looks like a change in what the archive holds (a column or format), not data growth. **Cause not established** (INFERRED). Since then the archive grows about 0.4 MB a night |
| **Projected exhaustion** | tonight's run (about 14:23 UTC) takes it to about 639 MB. At 36 MB a night plus 0.4 MB a night of growth, the **night of 22 October** is the first to exceed 1,000 MB (24 October on 1 GiB): **about ten days from today**. The earlier 23 to 28 October projection stands, and it is **the nearest limit in the whole release** |
| What fills first | the nightly backup itself fails, then uploads and the build bucket. This is the recovery path, not just a convenience |

### Backups on hand (B01)

24 run folders (18 September to 11 October; 240 to 306 objects each; 9.9 MB growing to 35.8 MB) and 11 legacy single-file backups with their checksum files (8 to 16 September; 1.1 to 8.2 MB), **35 backup units, 525.0 MB, oldest 34 days**. Every run folder has its manifest (finished). Each is a **complete, independent snapshot** of the tables (whole-table rows), not an incremental chain: any one run restores everything as of its night, and removing one does not damage another. `backup:rehearse` last passed on 21 September (RECORDED); it is **overdue** and no backup has been read back by this baseline.

### `npm run backup:prune`: inspected, not run

The command is a dry run by default (it plans and prints; `--attended` is the only deletion path, and `applyRetention` refuses it without the production-write flags, tested). **Its first import is the production-WRITES gate, so it refuses to start without `ALLOW_PRODUCTION_WRITES=1`, even to dry-run, and it reads a service key from the vault and downloads every backup to verify it.** This approval does not grant that flag, so I did **not** set it and the command was **not run**. The default mode cannot delete, but setting the flag to find that out is not mine to do.
Instead the repository's own pure planner (`src/backup/retention.ts`, policy: newest 7 daily verified plus the newest verified of each of the previous 8 ISO weeks, nothing under 24 hours, at most 30 a pass) was run **locally over the real inventory** (B01 metadata). It can only say what the policy *would* do **if every run verifies**; today `verified` is false for all of them, and the planner then refuses (case C of `docs/ops/backup-retention-policy.md`): **it frees nothing until the runs are read back**.

| If all 35 verify (HYPOTHETICAL; read-back not done) | Runs | MB |
|---|---|---|
| Keep | 11 | 261.6 |
| Remove | 24 (14 run folders from 18 to 3 Oct, 221.8 MB; 10 legacy files from 8 to 16 Sep, 41.6 MB) | **263.4** |

Kept set: the newest verified (11 Oct) and the six daily runs before it (10 to 5 Oct), the weekly keepers 4 Oct (W40), 27 Sep (W39), 20 Sep (W38) and one legacy file (12 Sep, 5.3 MB, W37). Storage after: about **340 MB** (before tonight's run) and then growing about **5 MB a day** (15 kept archives each about 0.35 MB bigger every night), so about four months to 1 GB instead of ten days.
**Retention and restore implications:** after a pass the finest history is one a day for seven days, then one a week for four weeks (the oldest legacy file is in the older, single-file format, kept as W37); a restore to any other night is no longer possible. The newest verified backup is always kept by construction. The pass would verify (read back, byte for byte) all 35 first, about 525 MB through the Storage API, and cannot delete anything that failed to verify. **Required approval: A11**, for the exact list the attended dry run prints, with the production-write flags set by Grant; run `backup:rehearse` (a restore rehearsal) first so the kept copy is proven restorable. An old backup is not treated as disposable because of its age: the policy keeps by day and week, and the verification, not the date, decides.

## 7. Hard read timeout (Q13, Q14 and 24 hours of provider logs)

| Setting (live) | Value |
|---|---|
| `authenticator` (the role PostgREST connects as) | `statement_timeout=8s`, `lock_timeout=8s`, `session_preload_libraries=supautils, safeupdate` |
| `authenticated` | `statement_timeout=8s` |
| `anon` | `statement_timeout=3s` |
| `service_role` (the gateway's key) | **no role setting** |
| `postgres` | `search_path` only |
| Server default (`pg_settings`) | `statement_timeout` 120 s, `lock_timeout` 0 |
| Statement timeouts in the provider log, last 24 hours | **0** (so no evidence that the bound has been exercised either way) |

**Status: UNVERIFIED.** What is verified is that an 8 s role-level bound exists on the role PostgREST logs in as and on `authenticated`; what is not is that it reaches a `service_role` request: that depends on PostgREST applying role settings per request, and I cannot prove that with a read-only query. The reproduction in `READ-TIME-BOUND.md` shows a caller-issued `SET LOCAL statement_timeout` before the call does cancel (152 ms against 100 ms), and `authenticator`'s own session value is the likely bound for a `service_role` request (INFERRED). **A6 stays separate and is not requested by this report.**
Smallest safe change, only if a live probe shows no bound: `alter role service_role set statement_timeout = '10s'`, which also bounds the worker's PostgREST calls (it holds no long statement today); verification: a gateway read against a deliberately slow, purpose-made public function on a staging project returns 57014 in about 10 s; rollback: `alter role service_role reset statement_timeout`. **Nothing needs changing for the release if the operator sets `activity.read_budget_ms` to 6000 at activation** (below the 8 s platform bound, so the controlled PT504 answer comes first; the default of 8000 is level with it). The gateway already maps a platform 57014 to the same controlled 504 (tested).

## 8. Security review inputs from production (Q22, Q23)

* `service_role` has **no USAGE on schema `app`**, and neither do `authenticated` or `anon`; `service_role` cannot create objects in `public`. (This is what the ledger's `app.*` writers rely on.)
* **Default privileges: tables created by `postgres` in `public` grant `service_role` `arwdDxtm` (full DML) automatically**; `anon` and `authenticated` get nothing (0642). So a new ledger table is born writable by `service_role` unless the migration revokes it: **the `revoke all ... from service_role` in 1060 is load-bearing, and the replica's stock default privileges model the same behaviour** (sabotage S53 removes it and goes red). Functions created in `public` grant `service_role` EXECUTE by default; the migrations revoke from public and grant only the four wrappers. A human reviewer should confirm these two facts against the final ACLs after the migration, in the canary's step 3 (a read-only query, `has_table_privilege` and `aclexplode`).

## 9. Release blockers and next actions

| Gate | Status | Blocked by |
|---|---|---|
| **Capacity (database)** | PASS | none; runway about seven weeks regardless of the ledger |
| **File storage** | **AT RISK**, about ten days | A11 (prune) or another storage decision before about 22 October; independent of the ledger |
| **Merge** | CONDITIONAL | explicit approval to merge; human SQL and redactor review (A1); no capacity blocker |
| **Migrations** | CONDITIONAL | explicit production-write approval (A4); human review before it; the gate passes today and must be re-read within a day of the run |
| **Deployment** | CONDITIONAL | successful migrations, a healthy baseline (it is), rollback readiness, explicit approval (A5) |
| **Canary** | NOT STARTED | verified deployment, per-office activation, live-host performance acceptance, explicit approval (A7) |

Recommended next authorised actions, in order: (1) Grant decides **A11** (the file-storage nightly: it expires first); (2) run `backup:rehearse` (a read) so the surviving backup is proven restorable; (3) the named human reads the files listed in `HUMAN-REVIEW-PACKAGE.md`; (4) A2 to A5 as the existing plan; (5) schedule **A9** within about six weeks; (6) A6 only if the live probe shows no bound. Re-read Q01, Q11, Q12 and Q19 on the day of any migration.
