# Capacity scenarios: when the free tier runs out, what is warning about it, and what can safely be given back

6 October 2026. Written for G-1 of `docs/audit/DEEP-SYSTEMS-AUDIT-2026-10-06.md`. **No production contact of any kind was made to produce
this.** Every number below is either RECORDED in this repository's own documents (the file is named) or INFERRED, and the arithmetic is
reproducible with `npm run capacity:scenarios` (`scripts/ops/capacity-scenarios.ts`).

## The answer first

1. **The database is at roughly 74% of a conservative 500 MB line and is growing 9 to 26 MB a day. On the evidence recorded it reaches
   100% between 10 and 19 October.** That is a window of days, not weeks.
2. **File storage may reach its 1 GB line BEFORE the database reaches its 500 MB line, and nothing recorded in the repository says
   which.** Backups are never deleted, each nightly run is a tenth or so of the database and growing with it, and they sit in the same
   1 GB as everything else. On the central assumptions storage crosses 85% on 12 October and 100% on 15 October; on the pessimistic ones
   it is already past 85% today. **This is the finding that changes what Grant should look at first, and it is INFERRED, not measured.**
3. **One read settles it** and it is parked because it is a production read: `npm run qq -- "select jsonb_pretty(app.free_tier_headroom())"`
   (with `ALLOW_PRODUCTION_CHECKS=1`, Grant's decision). It returns the database bytes, the storage bytes, the five largest tables and,
   since migration 1026, the growth projection. The replacement for that manual reading is below: the office now measures this itself.
4. **A warning now exists that does not wait to be asked** (migration 1026, below), and a safe way to give storage back exists
   (`npm run backup:prune`, a dry run by default). Neither deletes anything unless a person says so.

## Evidence key

| Mark | Meaning |
|---|---|
| **RECORDED** | read from a document or a committed capture in this repository; the source is given |
| **INFERRED** | derived from recorded facts by arithmetic or reasoning; the derivation is shown and can be wrong |
| **ASSUMED** | a parameter chosen for a scenario, with its basis |
| **UNVERIFIED** | a vendor or platform figure from documented knowledge that could not be checked offline |
| **REPLICA-PROVEN** | driven on the isolated replica with controls (`scripts/isolated/capacity-warning.ts`, `backup-restore-typed.ts`) |
| **UNPROVEN** | needs a production read; parked |

## What is recorded

| Fact | Value | Source |
|---|---|---|
| Free-tier limits | database **500 MB** (the "recommended maximum" on the free Nano), Storage **1 GB** | `docs/ops/supabase-forensics-2026-10-04.md` line 82; `migrations/0180` constants; `CLAUDE.md` Hard constraints |
| Database size, early September, undated | 48 MB | `supabase-forensics-2026-10-04.md` line 111 |
| 14 September | 50 MB | same |
| 17 September | **63 MB** | same |
| 2 October 14:33 | **328 MB** | same |
| 3 October | 329 MB | same, and `SUPABASE-DEGRADATION-2026-10.md` fact 1 |
| 4 October | **346 MB** | same, `supabase-incident-2026-10-03.md` line 97 |
| 5 October 07:37 UTC | **371,772,563 bytes** | `docs/ops/evidence/2026-10-05/capture-2026-10-05.jsonl`, `database_size` |
| Composition on 5 October | `public` 330.5 MB, `pg_catalog` 22.3, `storage` 10.4, `cron` 6.5, `auth` 2.2, `app` 0.26, `net` 0.23, `vault` 0.18 | same, `schema_sizes` |
| Largest relations, 5 October | `jobs` **108.2 MB**, `job_state_transitions` 38.5, `events` 33.5, `inference_usage` 24.9, `document_chunks` 21.0, `deliveries` 19.3, `documents` 17.5, `job_traces` 10.4, `inbound_commands` 8.8, `projects` 8.0, `documents_search` 7.9 | same, `biggest_relations` |
| `jobs` | 22,647 live rows, 1,083,313 updates since 25 Aug (about 49 a row, 5% HOT), 94 MB heap for 22k rows | same, `jobs_table_health`; `supabase-efficiency-2026-10-04.md` |
| Volume disk | 2 GB gp3, 676 MB used of 1.93 GiB on 3 October (includes WAL and system) | `supabase-incident-2026-10-03.md` line 79 |
| Backup run, 18 September | 107,255 rows, **9.6 MB**, 120 objects | `docs/testing/handover-2026-09-18-run.md` |
| Backup run, 21 September | 153,259 rows, **12.5 MB**, 246 objects, **26 runs held** | `docs/ops/evidence/backup-restore-rpo-rto.md` |
| Backup cadence and gaps | nightly; 17 September missing; nothing is ever deleted | same; `src/handlers/backup.ts` |
| `build` bucket, 16 September | 160 objects, 74 MB (before pruning of orphans) | `docs/adr/0034-the-build-diary-bucket-stays-public-and-its-pictures-expire.md` |
| Storage objects' metadata in the database | `storage` schema 8 relations, 10.4 MB | `capture-2026-10-05.jsonl`, `schema_sizes` |

### A unit ambiguity that the audit's "9 to 26 MB a day" probably comes from

`371,772,563` bytes is 371.8 MB **decimal** and 354.5 **MiB**. `pg_size_pretty` prints MiB, and `docs/ops/supabase-forensics-2026-10-05.md` line 391
quotes "355 MB in all", which is that same byte count printed that way. The earlier readings (328, 329, 346) are not labelled, so each may be
MB or MiB. Read as decimal, 4 to 5 October is +26 MB in 24.7 hours. Read as MiB, 346 MiB is 362.8 MB and the same day is +9 MB. **INFERRED, not
provable from the documents.** The scenarios below use the whole range and the conservative (decimal) line.

## Database: when each line is crossed

Reading 371.8 MB at 5 October 07:37 UTC; limit 500,000,000 bytes. The rate is ASSUMED with the basis given; the dates are arithmetic.

| Scenario | MB/day | Basis | 70% | 80% | 85% | 90% | 95% | 100% |
|---|---|---|---|---|---|---|---|---|
| optimistic | 9 | the 4 to 5 October day read as MiB; also about half the 17 Sep to 2 Oct mean, on the argument that 0655 to 0660 backfilled 63,803 rows and harness bursts now run in the TEST office | already (74%) | 8 Oct | 11 Oct | 14 Oct | 16 Oct | **19 Oct** |
| central | 17 | the 17 Sep to 2 Oct mean (265 MB in 15 days = 17.7), the 3 to 4 Oct day (17), and the 2 to 5 Oct mean (16.2) | already | 6 Oct | 8 Oct | 9 Oct | 11 Oct | **12 Oct** |
| pessimistic | 26 | the 4 to 5 October day read as decimal; the latest 24 hours, and rising | already | 6 Oct | 7 Oct | 8 Oct | 9 Oct | **10 Oct** |

Against the **524.3 MB (500 MiB)** line that `app.free_tier_headroom()` has used since 0180 (less conservative, so the old display reads about 71% when
the conservative figure reads 74%): 85% on 8 to 13 October, 100% on 11 to 22 October.

What would change these: a prune that frees space does not return it to the operating system unless the table is rewritten (see `jobs` below),
so the line is crossed on **allocated** size and a delete alone does not move it. `jobs` alone is 108 MB for 22,647 rows, 4.8 KB a row, which is
bloat from 49 updates a row.

**What happens at 100% is UNVERIFIED.** The documented behaviour of Supabase free projects over the database limit (read-only mode) could not be
checked offline. If it holds, the office cannot enqueue a job and every duty stops, including the one that would announce it.

## Storage: backups that are never deleted

The model, all of it ASSUMED or INFERRED and printed by the script:

* one nightly run from 26 August (26 held on 21 September, with 17 September missing, matches the recorded 26);
* each run's size is `ratio x the database that day`, with the database interpolated between the recorded readings before 5 October and growing at the scenario's rate after;
* `ratio` is calibrated: 9.6 MB on 18 Sep is 11.9% of the interpolated 81 MB, 12.5 MB on 21 Sep is 9.4% of the interpolated 134 MB. Scenarios use **7%, 10% and 15%** (the last is the 18 September archive against the 17 September database, the highest reading);
* non-backup Storage (the `build` bucket, uploaded files, avatars) is ASSUMED **40, 80 and 150 MB**: the `build` bucket alone was 74 MB on 16 September, the `files` bucket's size is unrecorded;
* every night succeeds. The outages of 2 to 5 October will have cost some nights, which makes this slightly pessimistic for storage and is the reason the model is a bound and not a forecast. Partial run folders left by interrupted nights also occupy space and are not counted.

| Scenario | Archive/DB | Non-backup | Held on 21 Sep (recorded: 26 runs) | Total at 5 Oct 07:37 | 70% | 80% | 85% | 90% | 95% | 100% |
|---|---|---|---|---|---|---|---|---|---|---|
| optimistic | 7% | 40 MB | 26 runs, 105 MB | 377 MB (38%) | 17 Oct | 19 Oct | 21 Oct | 22 Oct | 24 Oct | **25 Oct** |
| central | 10% | 80 MB | 26 runs, 150 MB | 561 MB (56%) | 9 Oct | 11 Oct | 12 Oct | 13 Oct | 14 Oct | **15 Oct** |
| pessimistic | 15% | 150 MB | 26 runs, 226 MB | 872 MB (87%) | already | already | already | 6 Oct | 7 Oct | **8 Oct** |

One nightly archive: 26 / 37 / 56 MB on 5 October and 35 / 61 / 110 MB on 19 October (optimistic / central / pessimistic).

**Reading it.** In the optimistic scenario storage is not the problem and the database is. In the central and pessimistic ones storage is reached
first, by days. The two readings that would separate them are the total bytes in `storage.objects` and the number of retained runs. The size of the
`storage` schema in the database (10.4 MB on 5 October, mostly `storage.objects` rows and indexes) is consistent with several thousand objects: each
run is about 246 objects, so 26 to 40 runs is 6,000 to 10,000. That does not distinguish the scenarios, and it does not contradict any of them.

### What giving backups back buys

The policy `keep the newest 7 plus the newest of each of the last 8 ISO weeks` (`src/backup/retention.ts`), applied once on 8 October and then nightly:

| Scenario | Total on 8 Oct before | after | 70% | 80% | 85% | 90% | 95% | 100% |
|---|---|---|---|---|---|---|---|---|
| optimistic | 485 MB | 254 MB | 29 Nov | 6 Dec | 13 Dec | 20 Dec | 27 Dec | 27 Dec |
| central | 722 MB | 391 MB | 25 Oct | 1 Nov | 1 Nov | 3 Nov | 8 Nov | 8 Nov |
| pessimistic | 1121 MB | 626 MB | 11 Oct | 13 Oct | 15 Oct | 17 Oct | 18 Oct | 18 Oct |

It roughly halves total storage on 8 October and buys one to eight weeks (a few days in the pessimistic case). **It does not fix the pessimistic case**, in which one archive is 83 to 110 MB by
mid October and the policy still keeps fifteen: that case needs the database itself to stop growing at 26 MB a day, or a paid tier (the budget
constraint is Grant's call, and the cost and a free alternative are named in `docs/ops/supabase-forensics-2026-10-05.md` line 449).

## What now watches this (migration 1026 and `src/handlers/capacity-watch.ts`)

REPLICA-PROVEN by `scripts/isolated/capacity-warning.ts`, whose checks all pass and which goes red when the level function is replaced by a constant 0 (14 checks fail) and when only the hysteresis is removed (4 fail).

| Piece | What it does |
|---|---|
| `public.capacity_samples` | one row per UTC day per scope (`database`, `storage`, `bucket:<id>`, `table:<schema.name>` for the fifteen largest relations); sizes only; pruned at 180 days in 2,000-row steps by the function that writes it; about 18 rows a day |
| `app.capacity_level`, `capacity_growth`, `capacity_days_to_limit` | pure functions: levels at **70 / 85 / 95%** of the **conservative decimal** limits with three points of hysteresis; the projection is the **fastest** of the 3, 7 and 28 day rates in integer arithmetic. They are compared case by case with `src/ops/capacity.ts` (1,764 level cases, 300 random series) so the two copies cannot drift |
| `app.capacity_sample()` / `app.capacity_watch()` | measure, record, and return both readings with level, previous level, projected days and the five largest tables |
| `app.chores_for_capacity()` | a chore on each operator's My Tasks per resource and level (`capacity:<scope>:<level>`): one on the crossing, none on the next pass, replaced by the deeper level, cleared when the level falls. Called from `app.chores_for_credentials`, which the DEPLOYED `office.chores` handler already runs hourly, so **it works with no worker deploy** (0540's argument) |
| duty `capacity-watch`, every 6 h on the system office | the handler composes the notice IN CODE from the figures and gives `app.say_once` a topic that changes only on a crossing: a crossing speaks at once, the same level again is quiet, and a still-high level speaks at most once in 20 hours. It runs when the worker carrying it is deployed |
| `app.free_tier_headroom()` | gains a `growth` key (level, percent, projected days); every existing key is unchanged |

What this does **not** do, and what is unproven: it cannot reach a person while the worker cannot run (a database near its limit may be exactly
when that is true); the chore reaches the task list and not the phone (`docs/ops/evidence/final-proof-pass.md` section 4 says the same of the backup
chore); and whether an announcement from a **system**-office duty is delivered to Grant's Telegram or Slack was not driven here, because the proof
must not message a person. The mechanism it uses is the one `office.backup` uses for a failed backup. **UNPROVEN until it fires once in production
with Grant watching.**

## Retention and compaction: what is required, and what is safe

Nothing here was deleted or compacted. `reject_ledger_mutation` (migration 0003, "master spec section 6") refuses UPDATE, DELETE **and TRUNCATE** on
fifteen ledger tables, so changing any of them is a spec decision with an ADR, not a clever migration. (That same guard is why the typed restore
must disable user triggers before it truncates: the first sabotage run of the restore failed with `public.autonomy_settings is append-only: TRUNCATE
is never permitted`.)

| Table (5 Oct size) | Requirement | Evidence | Safe action now | NOT safe |
|---|---|---|---|---|
| `jobs` (108 MB) | **provenance**: a job is the unit of "what the office did"; `job_state_transitions` holds a foreign key to it, so a job **can never be deleted** | `CLAUDE.md` ("a job can never be deleted"); `project_delete` refuses a project with jobs; FK from transitions | **rewrite to reclaim bloat** (VACUUM FULL or `pg_repack` on a table that is 94 MB for 22k rows). Frees allocated space without deleting a row. It takes an ACCESS EXCLUSIVE lock on the hottest table, so it is a maintenance window and Grant's decision. The size it would free is **UNPROVEN** (needs `pgstattuple` in production) | deleting rows; truncating; dropping `pinned_config` history |
| `job_state_transitions` (38.5 MB) | **audit**: ledger, append-only by trigger | `reject_ledger_mutation` on it; enforced legal-transition table | none | any DELETE or rollup without a spec change |
| `events` (33.5 MB) | **audit and undo and health**: the ledger of what the office did; `backup.rehearsed` is read from it by `app.backup_health()`; undo and the Recent activity feed derive from it | `0003`, `0537`, `0871`, `0472` | none now. A future archive-then-prune needs a decision on how long Grant wants the audit trail | any DELETE; the trigger refuses it |
| `inference_usage` (24.9 MB) | **billing and health and learning**: the daily budget (`app.over_budget`), the billing month views (0191, 0192), and `app.model_order` (a 30-day window of which model did well per kind) | `model_order(p_window_days default 30)`; `budget.pence_*_per_day`; `model_record` view | none. Only the last ~35 days affect behaviour; the rest is history for cost reports. Archiving it needs the same decision as `events` | any DELETE |
| `document_chunks` (21 MB) and `documents_search` (7.9 MB) | **derived**: chunks and the tsvector are computed from `documents.content` | 5,444 chunks over 149 documents; `0894` re-indexes whitespace-only chunks; `app.index_file_text`; `drive-index` | rebuildable, so droppable in an emergency (retrieval degrades until reindexed). **Not needed at 29 MB.** A reindex path exists and was exercised for 0894 | dropping `documents` (user content, not derived) |
| `documents` (17.5 MB) | **user content** (uploads, imports, office-made reports) | `#408`, `0872`, ADR-0066 | none | any expiry; a detached source's documents leave retrieval but are kept (0896) |
| `deliveries` (19.3 MB) | **exactly-once and audit**: the dedupe key that stops a second send; `known_escapes` references it; `check:chatter` and `undelivered` read it | `0544`, `0583` | none now. Rows for fixture jobs are derivable harness debris: `app.harness_job` names them, but sweeping them is a data-correctness change with its own proof (`check:leaks` is the witness) | deleting a real delivery: the next retry would send it again |
| `job_traces` (10.4 MB) | **debugging only**: rolled up on the job, each step is detail | `0257`, `0258` (explicit pruning precedent) | **already pruned at 30 days, hourly, 5,000 a pass** (REPLICA-PROVEN below) | shortening below the rollups |
| `inbound_commands` (8.8 MB) | **origin evidence**: the namespace of the dedupe key says whether a turn was real; a BEFORE DELETE trigger preserves it onto the job; `conversation_before` reads a 1,440-minute window | `CLAUDE.md` trap "Only suite teardowns delete `public.inbound_commands`"; `conversation.window_minutes` | none: 8.8 MB is not the problem | expiring it before the origin is on the job (68 of 206 turns once had no origin evidence) |
| `projects` (8.0 MB) | **user content**; 8 MB for a few dozen rows is bloat from the backfills (`0655` to `0660` rewrote 63,803 rows) | `supabase-forensics-2026-10-04.md` | rewrite with the other bloated tables | deleting projects (ADR-0014 order) |
| `cron.job_run_details` (cron schema 6.5 MB) | **operations**: the database's only per-minute record of the host, used as the witness in the October forensics ("a log pipeline that loses lines under pressure produced a false finding, and the table next to it contradicted it") | `CLAUDE.md`, 4 Oct forensics entry | a prune to 30 days is standard and frees a few MB, but removes the only history of the incident pattern. **Keep until the October investigation closes**; then prune | pruning during an open incident |
| `net._http_response` | platform, pruned by it after a few hours | `0544` | none | n/a |
| Storage `backups` bucket | **recovery**, and the largest consumer on the central assumptions | this document | **`npm run backup:prune`**: dry run by default; keeps the newest 7 plus one a week for 8 weeks; refuses unless the newest backup has just been verified byte for byte; never touches a file it did not create; at most 30 runs a pass; manifest removed last | automatic deletion on a schedule (Grant's rule); deleting the only copy |
| Storage `build` bucket | **diary pictures**, expire with their rows | ADR-0034, 0413 | already pruned daily by `build-shot-retention` | n/a |

### The three explicit pruning precedents, checked against what actually runs

REPLICA-PROVEN in `scripts/isolated/capacity-warning.ts` chapter 7. **None of these was read in production.**

| Precedent | Runs? | Bounded? | Finding |
|---|---|---|---|
| `job_traces`, `office.prune_job_traces`, duty `job-trace-retention` | **Yes**: an enabled hourly duty on the system office; the dispatcher fires it once and then waits out the period | **Yes**: 5,000 rows a pass. A 12,000-step backlog drained in 5,000 + 5,000 + 2,000, said so (`announce`) only while more was waiting, kept all 100 recent steps | works as designed. If the table grows faster than 120,000 rows a day (5,000 x 24) it falls behind and says so |
| `build_steps`, pruned inside `app.build_step` | **Only when a build session writes a step.** There is no schedule | The delete is not capped, but the table is small | acceptable: the table is not among the twelve largest. Not a retention duty, and not described as one |
| `build_shots`, `office.prune_build_shots`, duty `build-shot-retention` | **Yes**: an enabled daily duty on the system office (dispatch proven) | `app.build_shots_orphaned(p_limit)` takes 200 at a time; the deletion through Storage was **not driven** (the emulator serves the `backups` bucket only) | the schedule is proven, the Storage call is not |
| `mail_messages`, `app.forget_mail_before(office, 180)` | **No, not in production**: it is called by the `google.read_mail` handler, and `mail-refresh` is seeded OFF and was off on 5 October (Google revoked: `deployment-readiness-2026-10-05.md`). The function itself works: it removed a 400-day-old message, kept a 2-day-old one, and refused a 10-day window | **No cap** on the delete, but the cache is a few hundred rows (`CLAUDE.md` records 274 cached messages) | **a retention that does not run while its duty is off.** The cache cannot grow while Google is revoked, so nothing is at risk today; if Google is reconnected, the prune comes back with the duty |

## What to do, in order (a recommendation; nothing here has been done)

1. **Read `app.free_tier_headroom()` once** (Grant authorises the production read). It names the larger problem in one number.
2. If storage is above 60%: `npm run backup:prune` (dry run), read the list, then `-- --go`. This is the cheap move and it is reversible in the only sense that matters (the
   newest verified copy and a weekly tail remain).
3. Deploy the worker carrying `capacity-watch` and apply migration 1026 together (a migration is not a deploy). Until then the hourly chore is the warning, and only the chore works once 1026 is applied.
4. Schedule a maintenance window for rewriting `jobs` and `projects` once `pgstattuple` has said how much it frees.
5. Decide, with an ADR, how long the audit ledgers (`events`, `inference_usage`, `job_state_transitions`) are to be kept in the live database and whether an archive-then-prune is wanted. Until that decision the answer to "can we shrink these" is no.
6. Name the off-project copy (`docs/ops/restore-procedure.md`): it also takes the pressure off Storage, because once a sealed copy lives elsewhere the in-project copies can be thinned harder.

## Parked: needs production evidence

* `app.free_tier_headroom()` in full: database bytes, storage bytes, per-bucket bytes, number and size of retained backup runs.
* `app.backup_health()`: whether any backup has finished since the 2 to 5 October outages (the last verified rehearsal on record is 21 September at migration 0533).
* What the platform does at 100% of the database limit, and whether Storage over its limit refuses writes (the backup would then fail silently and be reported by the existing chore).
* `pgstattuple` for `jobs`, `projects`, `events`, `job_state_transitions`: how much a rewrite frees.
* Whether an announcement from the system-office duty reaches Grant's phone.
