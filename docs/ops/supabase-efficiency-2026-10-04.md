# Supabase efficiency pass, 4 October 2026

Follows `supabase-incident-2026-10-03.md`. Read-only measurement first, then two evidence-backed changes. Nothing was
resized, no `work_mem` or other setting was changed, nothing was disabled.

## WHAT WAS MEASURED

| Measurement | Value | How |
|---|---|---|
| Idle worker load | about 30 statements a minute (one pass a minute), each cheap warm | `pg_stat_statements` calls diffed over 75 s |
| Dominant statement by total time | `app.dequeue_job`, 29,500 calls, 12,400 s in 32 days (mean 0.19 s to 1.9 s) | `pg_stat_statements` since 2 Sep |
| `app.model_order` | 12,500 calls, 6,800 s, 68 blocks read a call; 370-470 ms warm, 4.8 s cold | `pg_stat_statements`, timed warm |
| Share of `model_order` that is `app.harness_job()` | over 98 % (join alone is 6 ms; 4,419 distinct jobs, 16,274 usage rows) | timed pieces |
| Jobs already named harness by two cheap generated flags | 3,789 of 4,419 (86 %) | counted |
| `jobs` table | 94 MB heap for 22,000 rows; 1.08 M updates since 25 Aug (about 49 a row, 5 % HOT); no index on `finished_at` | `pg_stat_user_tables`, `pg_indexes` |
| Cold versus warm | `over_budget` 4.8 s first call, 35-55 ms after; `model_order` 4.8 s then 0.4 s | timed |
| Temp bytes since `pg_stat_database` reset (25 Aug) | 365 GB over 69,100 files (about 5 MB a file) | `pg_stat_database` |
| Temp bytes `pg_stat_statements` can attribute (since 2 Sep) | about 1.07 GB, and 0.1 GB of that is my own diagnostics | `pg_stat_statements` |
| Temp growth while nothing of mine runs | about 1-3 MB a minute (a 3 minute window, after subtracting my own two queries at about 4 MB each) | counter read before and after |
| Live temp files caught in the act | none in eight samples a minute | `pg_ls_tmpdir()` |
| Full migration chain rehearsed against production | 42 times (every `ALTER TABLE jobs ...` has 42 calls) | `pg_stat_statements` |
| Connections | 6 of 57 at rest | snapshot |

## WHAT WAS CHANGED

* **0875, 0876: `public.model_record` stops asking about every row.** The view returned the same 27 rows as before
  (compared both ways with `EXCEPT`, before applying each). 0875 wrote the flags first and the planner pushed the
  expensive call back down into the scan of `inference_usage` (visible in `EXPLAIN`, and a warm `model_order` stayed at
  about 430 ms); 0876 uses a `CASE`, which the planner does not rewrite, so `harness_job()` is asked only for the 14 %
  of jobs the flags do not already name. Warm `model_order`: **about 430 ms to about 100-118 ms.** This runs on every
  model call.
* **0875: partial index `jobs_finished_with_spend_idx`.** The predicate `app.spent_today` already has, so the daily
  budget check reads an index instead of the 94 MB heap. Estimated cost 12,504 to 61 once analysed (autovacuum does that
  by itself; it was analysed by hand here to prove the plan).

Not changed, on purpose: `app.harness_job` itself (about twenty-five readers depend on it and the strict direction is the
safe one), the budget arithmetic, the model order, anything an office can see. No schedule was lengthened and no work
was skipped.

## WHAT WAS INFERRED

* The product's own recurring statements are individually cheap warm. Their cost is the cold start: `over_budget` and
  `model_order` were 40 to 100 times slower the first time they ran after the cache had been evicted. That is what a host
  with about 434 MiB of memory and about 530 MiB of swap in use would do, and it is consistent with memory pressure, but
  it does not prove it.
* Scanning `jobs` (94 MB) on a per-call basis is the main way the product itself evicts hot pages. The index and the view
  change remove two of those.
* The 365 GB of temp bytes is NOT explained by anything the application's tracked statements did (1 GB of it is). Likely
  contributors that cannot be separated from here: the 42 rehearsals of the migration chain (index builds and constraint
  validations at a 2 MB `work_mem`), DO-block and utility statements, and the platform's own services. A residual
  1-3 MB a minute continues while idle.

## WHAT REMAINS UNKNOWN

* What produces the idle temp files. `pg_stat_statements` shows nothing for them, `pg_ls_tmpdir()` caught none, and
  `log_temp_files` is off, so the platform will not name the statement. Turning `log_temp_files` on (a configuration
  change, deliberately not made here) would name the culprit within a day.
* Whether memory starvation caused the 3 October degradation. This pass added no evidence either way.
* Burst-credit state, disk burst balance and per-minute memory history remain dashboard-only.

## LATE READING (4 October, after the deploys, office idle)

`incident:snapshot`: auth, db, rest and storage all `ok`; db round trip 918 ms; 13 of 57 connections, 1 active, none long
running; worker heartbeat true, queue empty; no incident in the last 30 minutes. `pg_stat_database.temp_bytes` read
383,528,486,989 over 69,295 files. This is a single reading with no matching earlier reading taken at a known instant, so
it states no rate; it only adds a point for whoever turns on `log_temp_files` and compares.

## TEMP-FILE ATTRIBUTION ATTEMPT (4 October, second run) - the producer is NOT identified

**MEASURED**
* `log_temp_files` is `-1` (off), context `superuser`. Our role (`postgres`) is not a superuser and
  `has_parameter_privilege(current_user, 'log_temp_files', 'SET')` is false, so it cannot be enabled with `ALTER ROLE` or
  `ALTER DATABASE`. `GET /v1/projects/<ref>/config/database/postgres` returns `{}` (platform defaults), and the parameters the
  Management API documents as settable do not include `log_temp_files`. Nothing was changed. **BLOCKED by the platform.**
* Statements `pg_stat_statements` still holds account for about 1.1 GB of the 383.7 GB counter (postgres 718 MB, service_role
  388 MB, everyone else 0). The biggest are a project-usage query of ours (394 MB over 130 calls, about 3 MB a call) and
  PostgREST's own schema-introspection queries (about 380 MB over 259 calls, about 1.5 MB a call at a 2 MB `work_mem`).
* `pg_stat_statements_info.dealloc = 100` (cap 5,000 entries): entries have been evicted 100 times since the 2 September
  reset, and the statistics reset on 2 September while the database counter reset on 25 August, so the first eight days of
  the build are in the counter and in no statement.
* A 5.6-minute window (12:16:52 to 12:22:30, with a snapshot of every statement that had spilled before and after): the
  tracked statements spilled **0 MB** while the counter rose **43.7 MB**. That window contained my own reads of
  `pg_stat_statements`, one migration and one verification suite, so the idle rate is not read from it.

**INFERRED**
* The spill is mostly NOT in statements this database keeps statistics for. Candidates, none proven: evicted statement entries
  (utility and migration statements), the eight unobserved days, platform services using the same instance, and a steady
  background producer (1 to 3 MB a minute at rest would be 60 to 170 GB over 40 days, the same order as the counter).

**UNKNOWN**
* Which process writes the idle temp files. Neither `pg_stat_statements` nor `pg_ls_tmpdir()` shows it.

**To inspect next (owner action, because it needs a superuser setting)**: ask Supabase support to set `log_temp_files = 10240`
(kB, 10 MB) on this project for 24 hours; it logs the statement beside every spill of that size, at a volume bounded by the
number of large spills (a handful an hour on the evidence above). Then read the Postgres logs endpoint
(`GET /v1/projects/<ref>/analytics/endpoints/logs`) for "temporary file" lines. Restore to `-1` afterwards.

Not claimed: that the incident is solved, that memory starvation is proven, or that the instance needs resizing.
