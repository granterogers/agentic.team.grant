# Storage recovery and cleanup audit, 15 October 2026

**Status: read-only.** Nothing in production was deleted, purged, vacuumed, rewritten or altered. Every production contact was a
SELECT or a storage listing through `npm run q` (`ALLOW_PRODUCTION_CHECKS=1`). No retention policy was changed. No branch other than
this one was touched. Deployed commit: `f23af36c` (main).

Units: `pg_size_pretty` prints binary megabytes (MiB). Byte totals below are exact; "MB" with a number from a byte count is decimal.

## 1. Current utilisation (measured 15 October 2026)

| Quota | Used | Limit | Headroom |
|---|---|---|---|
| Database (`pg_database_size`) | **389.1 MB** (371 MiB) | 500 MB | 111 MB |
| Object storage (all buckets, sum of `metadata.size`) | **690.5 MB** (659 MiB) | 1 GB | ~310 MB |

Storage by bucket (7,568 objects):

| Bucket | Objects | Bytes | Oldest | Newest | Notes |
|---|---|---|---|---|---|
| `backups` | 7,220 | 612.6 MB | 8 Sep | 14 Oct | 49 backup runs: 27 `run-<uuid>` folders and 22 legacy `aiteamhq-*.json.gz` files. 202 MB of it is the last seven days. |
| `build` | 132 | 66.1 MB | 10 Sep | 24 Sep | Build-diary screenshots. No upload since 24 Sep. |
| `avatars` | 16 | 9.8 MB | 5 Sep | 7 Sep | 8 PNGs referenced by `staff.avatar_ref`; 8 JPGs served as studio faces (`web/studio/backend.js` `AVATARS`). |
| `files` | 200 | 2.0 MB | 11 Sep | 14 Oct | User documents. Not touched. |

Database, largest relations (total with indexes and TOAST):

| Relation | Total | Heap | Indexes | Live rows | Growth |
|---|---|---|---|---|---|
| `jobs` | 103 MB | 94 MB | 9 MB | 26,744 | ~1,000 per day |
| `job_state_transitions` | 45 MB | 21 MB | 24 MB | 179,857 | append-only (section 2) |
| `events` | 33 MB | 25 MB | 7 MB | 15,772 | append-only ledger |
| `inference_usage` | 24 MB | 18 MB | 6 MB | 16,976 | cost ledger |
| `document_chunks` | 20 MB | 8 MB | 7 MB + 5 MB TOAST | 5,530 | derived, see section 4 |
| `deliveries` | 18 MB | 15 MB | 3 MB | 4,716 | send records |
| `storage.objects` (metadata) | 15 MB | 4.5 MB | 11 MB | 7,568 | follows object count |
| `job_traces` | 12 MB | 9 MB | 3 MB | 43,056 | 30-day window, enforced |

Dead tuples are modest and autovacuum is current: `job_traces` 9.1%, `jobs` 11.8%, `deliveries` 11.1%, `projects` 13.7%
(`n_dead_tup` 313 of 2,283). Dead tuples are reusable space inside the file; they are not returned to the quota without a rewrite.

Activity Ledger (`activity_events`, migration 1060): 0 rows, 88 kB. Migration 1060 notes "the table is never pruned"; there is no
retention rule yet (section 7).

### Historical comparison

| Date | Database | Source |
|---|---|---|
| 17 Sep | 63 MB | `docs/ops/capacity-scenarios-2026-10-06.md` |
| 2 Oct | 328 MiB (343 MB) | same |
| 4 Oct | 346 MiB (363 MB) | same |
| 5 Oct | 371.8 MB decimal (354.5 MiB) | same |
| 15 Oct | 389.1 MB decimal (371 MiB) | this audit |

Growth since 5 October is **about 1.7 MB a day** (17.3 MB in ten days). Growth from 4 to 15 October is about 2.4 MB a day. Earlier
"9 to 26 MB a day" figures in the capacity document mixed MiB and MB and should not be used.

Backup run size grew from 9.6 MB (18 Sep) to 35 MB (14 Oct). A nightly dump is now a copy of the whole database, so it tracks database
size times the compression ratio (about 9%).

## 2. Classification of candidates

| Class | Meaning here |
|---|---|
| **A** | Safe: disposable, unused or redundant, no dependencies. |
| **B** | Conditional: removable after retention, ownership, reference and recovery checks. |
| **C** | Preserve: operational, historical, user-owned or compliance data. |
| **D** | Uncertain: insufficient evidence. Must not be deleted. |

### 2a. Harness (fixture) rows

Measured in production: fixture jobs 11,100 of 26,744 (41%), fixture trace rows 15,078 of 43,063 (35%), fixture transitions
62,201 of 179,857 (35%), fixture projects 1,461 of 1,970 (74%). Live bytes of the fixture share in `jobs`, `job_traces` and
`job_state_transitions` are 5.5 MB, 2.6 MB and 6.8 MB: **about 15 MB**, before index and bloat share.

Class **C/D**. `jobs` and `job_state_transitions` are append-only by product rule (§6; migrations 0282, 0629). Deleting fixture jobs
requires a decision that changes that rule, not a cleanup. The fixture *projects* can be removed only through the project deletion
path, which refuses a project that holds a job. This is a policy decision for the owner (section 6).

### 2b. Backup runs (`backups` bucket) — **B, the largest single opportunity**

The owner's retention policy (`docs/ops/backup-retention-policy.md`, 7 October) keeps the newest seven days that have a verified run,
plus the newest verified run from each of the previous eight ISO weeks. It is **recorded and tested but has never been executed**. The
bucket therefore grows by about 29 MB a day (the mean of the last seven days).

Applying the policy to the measured runs (dates in UTC, assuming each listed run verifies):

| Kept | Run | Size |
|---|---|---|
| Daily 7 Oct to 12 Oct, and 14 Oct (seven days with a run; 13 Oct has only 126 of about 306 objects, so it is **unknown**, not kept or deleted) | one per day | 214 MB |
| Week 40 (28 Sep to 4 Oct) | 4 Oct | 24 MB |
| Week 39 (21 to 27 Sep) | 27 Sep | 16 MB |
| Week 38 (14 to 20 Sep) | 20 Sep | 11 MB |
| Week 37 (7 to 13 Sep) | 12 Sep (newest of two runs, estimated) | ~3 MB |
| Unknown, kept by rule | 13 Oct | 14 MB |

Removable under the policy: 612.6 − 268 − 14 ≈ **330 MB**, all of it older than 8 October and all of it a whole run. Each deletion
is one run and its manifest last (the executor's rule). **Verification is not yet read from production**; the dry run reads every
object once (about 610 MB of egress), which is why the estimate is a range (section 3).

### 2c. Overdue build-diary screenshots (`build` bucket) — **B**

111 objects (about 58 MB) are older than 30 days. All 111 are still linked to `build_steps` rows (145 steps remain, oldest 10 Sep).
The cause is in the code: `build_steps` is pruned at 30 days **only on write** (`migrations/0170`, `app.build_step_record`), and the
diary has written nothing since 24 September, so the prune has not run. The screenshot duty (`office.prune_build_shots`) runs
daily and deletes only objects that no step links to (`app.build_shots_orphaned`), so it is correctly waiting. Removing these 111
objects needs a scheduled prune of old steps (a migration or duty change, approval required), after which the existing duty removes
the objects.

### 2d. Unused indexes — **A/B (schema change, approval required)**

Statistics have been collected since 25 August 2026 (`pg_stat_database.stats_reset`), so zero scans over seven weeks is evidence.

| Index | Size | Scans |
|---|---|---|
| `projects_name_trgm` | 5.1 MB | 0 |
| `decisions_search` | 1.1 MB | 0 |
| `mail_messages_search` | 0.76 MB | 0 |
| `events_reversible_idx` | 0.25 MB | 0 |
| 16 small indexes on `outputs`, `documents`, `contact_labels`, `notebook_sync_queue` and others | 0.02 to 0.1 MB each | 0 |

Total about **7.4 MB**. Before any drop, confirm the query paths that would use each index (`projects_name_trgm` is the most likely to
be used by a project-name lookup that Postgres plans differently; `decisions_search` and `mail_messages_search` back search surfaces that
may not yet have been exercised). Class **D** until the query paths are checked. Dropping an index frees its pages immediately and needs
no rewrite.

### 2e. Physical bloat in heap — **B, needs a rewrite (approval and a window)**

`pg_stats` widths and `reltuples` give an estimate of live data per table. Heap bytes minus estimated live bytes:

| Table | Heap | Estimated live | Estimated slack |
|---|---|---|---|
| `jobs` | 94 MB | ~17 MB | ~75 MB |
| `events` | 25 MB | ~6 MB | ~19 MB |
| `inference_usage` | 18 MB | ~2.5 MB | ~16 MB |
| `deliveries` | 15 MB | ~1.6 MB | ~14 MB |
| `job_state_transitions` | 21 MB | ~20 MB | ~2 MB |

Total estimated slack about **125 MB**. These are estimates from column widths; `pgstattuple` would give an exact figure but is not installed
and installing it is a schema change. Slack is reusable space inside the file, so it does not reduce the quota until the table is rewritten.
A rewrite (`VACUUM FULL` or `pg_repack`) takes an exclusive lock for the duration and needs temporary space roughly equal to the table.
`pg_repack` is not installed. **Section 6 gives the approval-gated route. Nothing here runs `VACUUM FULL`.**

### 2f. Other candidates examined and not recommended

| Candidate | Size | Class | Reason |
|---|---|---|---|
| `job_traces` older than 30 days | 4 rows | — | Already enforced by `office.prune_job_traces` (migration 0258). Working as designed. |
| `document_chunks` in state `stale` | 216 rows, 229 kB text | A, negligible | Superseded revisions. Not worth a migration. |
| Archived documents | 39 documents, 1.5 MB | C | User-owned. |
| `avatars` JPGs | 0.27 MB | C | Served by the studio as staff faces. |
| `avatars` PNGs | 9.6 MB | C | Referenced by `staff.avatar_ref`. |
| `events`, `inference_usage`, `deliveries`, `inbound_commands`, `routing_decisions` | 33 + 24 + 18 + 9 + 4 MB | C | Ledgers of what the office did and what it cost. Age spread: 14 to 45 days. Retention needs an owner decision. |
| Activity ledger | 0 rows | D | No retention yet; see section 7. |

## 3. Estimated recoverable space

Recoverable = bytes removed from the quota. Logical deletion can free storage immediately; database space needs a rewrite.

| Candidate | Class | Conservative | Realistic | Optimistic |
|---|---|---|---|---|
| Backup runs outside policy (object storage) | B | 300 MB (verified runs only) | 330 MB | 330 MB + 14 MB 13 Oct if it verifies and falls outside |
| Overdue build screenshots and steps (object storage) | B | 0 (until the prune fix ships) | 58 MB | 58 MB |
| **Object storage total** | | **300 MB** | **~390 MB** | **~400 MB** |
| Unused indexes (database, logical) | A/D | 2 MB (three search and event indexes) | 7 MB (all listed) | 7 MB |
| Heap slack (database, physical, needs rewrite) | B | 40 MB (half of the `jobs` slack) | 70 MB | 125 MB |
| Harness rows (database, policy decision) | C/D | 0 | 5 MB | 15 MB live + index share |
| **Database total** | | **~42 MB** | **~82 MB** | **~150 MB** |

Database logical deletion alone recovers 2 to 7 MB. The rest needs a rewrite. The 1 GB storage limit is the nearer constraint.

## 4. Growth forecast

Assumptions: database +2 MB a day (measured 1.7 to 2.4); backups +29 MB a day with no pruning; other object storage flat.

**Without action:**

| Horizon | Database | Object storage |
|---|---|---|
| Today (15 Oct) | 389 MB of 500 | 690 MB of 1 GB |
| 30 days | ~450 MB | ~1.56 GB (**over the limit around 26 October**) |
| 90 days | ~570 MB (**over 500 around 9 December**) | ~3.3 GB |
| 180 days | ~750 MB | ~5.9 GB |

**With the retention policy executed now** (removing about 390 MB, leaving about 300 MB of object storage):

| Horizon | Database | Object storage (estimate) |
|---|---|---|
| 30 days | ~450 MB | ~600 MB (15 runs at about 40 MB, older weekly runs smaller) |
| 90 days | ~570 MB | ~800 MB |
| 180 days | ~750 MB | **about 1 GB: the policy alone is not enough at this growth** |

So the retention policy is necessary but not sufficient. Once the database passes roughly 600 MB, each nightly run exceeds 50 MB and
fifteen runs approach the object-storage limit. Solutions, in order of cost: slimmer dumps (exclude or compress harness rows, drop
derived `document_chunks` from the dump and rebuild them on restore), fewer weekly keepers (the policy's eight is the owner's choice),
or a second bucket on a free-tier-compatible provider (the comparison in `docs/storage/PROVIDER-COMPARISON-2026-10-14.md` recommended
Cloudflare R2, which has a free tier, but that needs an owner decision).

The database limit is reached around December without any action, and the 180-day figure exceeds 500 MB by a wide margin, so the
largest long-term database lever is retention of the append-only tables, which needs the owner (section 6).

## 5. Repository (separate from both quotas)

| Measure | Value | Notes |
|---|---|---|
| Local `.git` (this clone) | 3.7 GB; pack 3.59 GiB; 19,083 historical blobs (4.2 GiB uncompressed) | Driven by `.out/` screenshots committed in history: 5,847 blobs, 3.65 GiB. The three `.out/` files still tracked are 3.2 MB. `.out/` is in `.gitignore` (line 138) and was committed before that. |
| Tracked source | 4,283 files, 32.7 MB | |
| `docs/` tracked | 111.5 MB, of which 103 MB is raster screenshots (for example `docs/integration/ux-pass-2026-10-10/*.png`, 0.8 to 0.9 MB each) | Review evidence. Move to an artifact store, not deletion. |
| `assets/avatars/cartoon/` | 10.6 MB | The one file compared (`chief-of-staff.png`, 1,196,651 bytes) matches the production `avatars` copy exactly. The other seven were not compared. Keep one copy of each once confirmed. |
| `web/studio/vendor/pdf.worker.mjs` | 1.36 MB | Needed by the PDF viewer. Keep. |
| Deployed page `web/studio` | 8.1 MB uncompressed; 293 files | Deployment size, not storage. |
| Deployed functions `supabase/functions` | 0.4 MB source | |
| Runtime dependencies | 2 (`dependencies`), 8 (`devDependencies`) | Nothing to remove. |
| Runtime memory | **Not measured** | No read access to the host. The 434 MiB host figure is from earlier forensics and is not a current measurement. |

Repository history is the largest of these by bytes, but it is not a Supabase quota. Rewriting history (`git filter-repo` on `.out/`)
is destructive, changes every commit hash after the first `.out/` commit, and needs your approval and a coordinated force-push.

## 6. Recommended cleanup sequence, for approval

Nothing below has been executed.

| # | Action | Class | Approval | Expected recovery | Verification | Rollback |
|---|---|---|---|---|---|---|
| 1 | **Run `npm run backup:prune` as a dry run** (no `--attended`, no write flags). It reads and verifies every run and prints the plan. | — | None needed (read only; about 610 MB egress) | Turns the 300–390 MB range into an exact plan | Plan lists each run as keep, remove, unknown | None needed |
| 2 | **Execute the retention policy** on the runs the dry run marks `remove`, one attended pass, with `ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npm run backup:prune -- --attended`. Oldest first, at most 30 runs a pass. | B | **Yes**: the policy's own gate requires your separate approval of the exact list | ~330 MB object storage | Re-list `backups`; confirm the kept set equals the plan; restore rehearsal on the newest kept run | Runs are deleted whole; retention cannot delete a run it has not verified. Before deleting, copy the list of run folders to the repository (`docs/ops/`). |
| 3 | **Schedule the 30-day `build_steps` prune** (a small migration that calls the existing delete from a duty, or a duty that deletes steps older than 30 days then lets the screenshot duty remove the objects). | B | **Yes**: a migration and a duty change | ~58 MB object storage (111 objects) | Count `build` objects older than 30 days after the first run; should fall to zero | Migration is additive; the duty can be disabled in `responsibilities` |
| 4 | **Drop the three unused search and event indexes** (`decisions_search`, `mail_messages_search`, `events_reversible_idx`) after confirming their query paths. Keep `projects_name_trgm` until its use is checked. | A/D | **Yes**: a schema change | 2 MB (later 7 MB) | `pg_stat_user_indexes` shows the index gone; search surfaces still work in the Sample | Recreate the index from its definition (`pg_get_indexdef`) |
| 5 | **Heap rewrite of `jobs`, `events`, `inference_usage`, `deliveries` (approximately 125 MB of slack)**. Use `pg_repack` if it is available on the platform, otherwise `VACUUM FULL` one table at a time in a low-traffic window. | B | **Yes**: an exclusive lock, temporary space, and a window | 40 to 125 MB database | Re-read `pg_relation_size` and `pg_database_size`; run `check:deployment-state` and a worker tick | Table is rebuilt from its own rows; a failed rewrite leaves the original. Take a verified backup first. |
| 6 | **Fixture-row policy**: decide whether harness rows in append-only tables may be redacted, archived to a separate table, or left. | C/D | **Yes**: this changes §6 | 15 MB live, plus index share | Count fixture rows before and after | None without an approved design |
| 7 | **Activity Ledger retention**: set a window (for example 90 days) before the table grows. | C | **Yes**: a retention policy | Prevents future growth | Row count against the window | Policy is a prune job, recorded in `responsibilities` |
| 8 | **Storage slimming**: exclude harness rows and derived `document_chunks` from the dump; or move the backups to a second bucket. | B | **Yes**: changes the backup format or provider | Needed before about 180 days | Size of one nightly run against the 40 MB line | Old format remains readable |
| 9 | **Untrack `.out/` from git and rewrite history** (`git filter-repo --path .out --invert-paths`, then force-push). | Repository only | **Yes**: force-push of history | Repository size only (3.6 GiB local) | `git count-objects -vH` | Tags and forks of the old history need their own handling |
| 10 | **Move `docs/` review screenshots (103 MB) out of git** into an artifact store. | Repository only | **Yes**: changes where evidence is kept | Repository size only | Links in docs resolve | Restore from the artifact store |

Items 1 and 2 are the only ones that change the storage quota meaningfully in the next week, and they need your approval for step 2.
Without step 2, the object-storage limit is reached around 26 October.

## 7. Recommended long-term retention and maintenance policy

Proposed for approval. Nothing here changes a policy by itself.

| Data | Policy |
|---|---|
| Backup runs | As written (7 daily plus 8 weekly, verified). Execute it nightly with the attended gate; alarm at 80% of object storage. |
| `job_traces` | 30 days (already enforced). |
| `build_steps` and build screenshots | 30 days, pruned by a scheduled duty (item 3). |
| `jobs`, `job_state_transitions`, `events`, `inference_usage`, `deliveries` | Append-only. Keep, but review yearly. Redaction of harness rows needs a decision (item 6). |
| `document_chunks` | Keep for active documents; drop superseded revisions when a document is replaced. |
| Activity Ledger | Propose 90 days (item 7). |
| Storage alarms | Database at 400 MB and object storage at 800 MB, both via `app.free_tier_headroom()` (which uses a 500 MiB line; correct it to 500 MB decimal). |
| Maintenance | Autovacuum as configured. Heap rewrite only on approval (item 5). No `VACUUM FULL` in any automated job. |

## 8. Access that would tighten the estimates

1. **Approval to run `pgstattuple`** (requires `create extension`, a schema change; or Supabase support to enable it). This gives exact bloat.
2. **Egress for `backup:prune` dry run** (about 610 MB read once). This turns section 3's range into an exact plan.
3. **Supabase dashboard usage page** for the storage quota (to confirm the 1 GB line, which the repository states but no reading confirms).
4. **Query paths for the unused indexes** (a day of gateway logs, or your confirmation).
5. **Confirmation that the 13 October backup is incomplete**, or a read of its manifest.

## 9. What was not done, and why

- No deletion, purge, truncate, `VACUUM FULL`, `REINDEX`, index drop, migration, policy change, deployment or merge.
- No object was read or listed except by metadata (names, sizes, dates). No backup content was downloaded.
- Runtime memory was not measured.
- `pgstattuple` was not used (not installed).
