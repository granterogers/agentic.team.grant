# Supabase degradation forensics, round 2 (5 October 2026)

Follows `supabase-forensics-2026-10-04.md`. Every claim is labelled **MEASURED** (read from a provider API, a log, a counter or our
own probe), **DERIVED** (arithmetic on measured values, shown), **INFERRED** (a reading that fits the evidence and is not proved) or
**UNKNOWN**. Raw evidence is committed, sanitised, in `docs/ops/evidence/2026-10-05/`; the one-clock table is
`docs/ops/forensics-timeline-2026-10-05.md` (regenerate with `npm run forensics:timeline`). Nothing here changed compute, work_mem,
connection limits, disk settings or any configuration, and no production write was made.

## 0. Answers

**Most likely causal chain (INFERRED, moderate confidence in the class, low confidence in the specific resource).**

1. The Nano host is structurally oversubscribed. MEASURED: 433.9 MiB RAM, `shared_buffers` 224 MB (52% of RAM), 1 GiB swap of which
   **551 to 613 MiB is in use at healthy idle**, `Shmem` 3.8 to 28.9 MiB (the 224 MB buffer cache is largely not resident), paging
   continuously (swap-in 33 to 248 pages/s, swap-out up to 381 pages/s, 83 to 513 major faults/s) while the CPU is 94% idle.
2. A short surge of demand pushes some resource past a threshold. MEASURED surges before every long episode: a two-hour heavy-write
   run of our own migration work (1 Oct), and verification bursts of 2,300 to 3,000 gateway requests per ten minutes (2 Oct 07:20,
   3 Oct 17:50 and 19:10, 4 Oct 15:20 to 15:40).
3. Once past it, the host stalls: statements that normally take milliseconds take 30 to 118 s, the server's 120 s `statement_timeout`
   cancels them (336 in the last 24 h), Auth, PostgREST and Storage fail their health checks, and the metrics scrape returns 500
   (5 of 5 readings in an episode, and 11 of 11 in the healthy state answered 200).
4. It persists with **no application traffic** (zero gateway requests for 13 hours on 4 to 5 Oct) and ends as a **step change** at idle
   (3 Oct 01:35 to 01:40, 5 Oct about 07:15), after 18.3 h and 15.8 h. A step recovery after many idle hours is what a refilled budget
   or credit balance looks like; it is not what a cache re-warming looks like.

**Strongest competing explanation (INFERRED).** A provider or shared-host event, not our workload: two episodes show a stall at
effectively zero traffic before any burst (cron starts 10 per 10 min fall to 1, 0, 2 at 3 Oct 17:20 to 17:49; to 4 at 4 Oct 14:20
to 14:40), and recoveries happen at idle with nothing of ours changing. It cannot be excluded without a provider incident record.

**Which of the six outcomes the evidence supports.**

| # | Question | Verdict | Label |
|---|---|---|---|
| 1 | A pathological Team HQ workload or query we can fix | **No single pathological query.** The slowest statements are victims. But the standing workload is IO-heavy (the model-order query read 441,971 blocks = 3.4 GB over 6,213 calls; sequential reads of `jobs` account for 6.43 M block reads = 51 GB since 25 Aug) and is worth cutting. Contributory, not shown causal. | MEASURED / INFERRED |
| 2 | Multi-user materially caused it | **Not through steady load; yes as a trigger through its verification activity.** Real (non-harness) jobs per day: 365 to 381 on 25 to 29 Sep with one office, 297 to 343 on 2 to 4 Oct with two. Gateway traffic rose 10 to 20 times from verification (3 to 5k a day to 30 to 60k) and a burst precedes every persistent onset from 2 Oct. Stalls already existed on 28 to 30 Sep. Not the root cause. | MEASURED / INFERRED |
| 3 | Nano cannot support the normal workload | **Supported as a memory fact, not yet as the whole mechanism.** Swap use of 551 to 613 MiB at idle with a 224 MB `shared_buffers` is an oversubscribed host. Whether more RAM ends the episodes is not proven. | MEASURED / INFERRED |
| 4 | Disk IO burst exhaustion | **Consistent, not shown.** The published symptoms match (see section 7); healthy idle already uses about 60% of the 250 IOPS baseline; the one CPU-only datum from the first incident argues against IO alone. The budget balance is not observable by API. | INFERRED / UNKNOWN |
| 5 | A Supabase process | **The platform exporter is a victim and a symptom, not the load.** Its role has used 8,960 s in 33 days against 79,754 s for our app role. A provider fault is not excluded. | MEASURED / UNKNOWN |
| 6 | A missing observation | **Yes: the host's CPU steal, IOPS and swap rates during an episode, and the Disk IO % consumed chart.** | UNKNOWN |

**Is paying for more compute supported by the evidence yet?** Partly. The memory finding (section 5) is strong enough to make
more RAM a justified experiment. It does not yet distinguish memory from IO budget from CPU credit, and a free test exists first
(section 11). The price was not verified here.

**Is a manual dashboard observation unavoidable?** One only: **Disk IO % consumed** (Observability, Database Health). See section 8.

## 1. What was verified against current documentation

| Item | Result | Source | Label |
|---|---|---|---|
| Customer Metrics API | `GET https://<ref>.supabase.co/customer/v1/privileged/metrics`, HTTP Basic, user `service_role`, password a secret API key (`sb_secret_`), scrape once a minute; page says the API is in beta | supabase.com/docs/guides/telemetry/metrics, supabase-grafana README | MEASURED |
| Management metrics scrape | `GET /v1/projects/{ref}/analytics/endpoints/metrics`, bearer token; documented 400 "Project must be active and healthy" and 500 "Failed to fetch project's metrics" | OpenAPI v1 | MEASURED |
| Logs endpoint | `GET /v1/projects/{ref}/analytics/endpoints/logs`, **ClickHouse SQL**, unified `logs` table with a `source` column, range per query at most 24 h. `logs.all` is deprecated and answers 410. | OpenAPI v1, log field reference | MEASURED |
| Log retention | **Longer than 24 h.** Rows for 25 Sep were returned on 5 Oct (10 days). The 24 h is a limit per query, not a retention period. Earlier notes that said logs expire in 24 h were wrong. | probes, this round | MEASURED |
| Usage API | `usage.api-counts?interval=15min|30min|1hr|3hr|1day|3day|7day` returns auth, rest, storage and realtime counts. `3day` gives **hourly** points, `7day` daily. They equal the gateway log counts exactly (12,083 in the 08:00 hour on 4 Oct). | OpenAPI v1, probes | MEASURED |
| Postgres config API | `PUT /v1/projects/{ref}/config/database/postgres`, `log_temp_files` is a string in the body, `restart_database` is a separate optional flag | OpenAPI v1 (read live) | MEASURED |
| Disk IO budget | Nano baseline **5 MB/s and 250 IOPS**, burst to 261 MB/s and 11,800 IOPS. "Compute sizes up to 2XL can burst above their baseline for short periods of time, drawing on a disk IO budget. Once the budget is exhausted, performance returns to baseline." Read it under Database Health. | supabase.com/docs/guides/platform/compute-and-disk, troubleshooting "High Disk I/O" | MEASURED |
| Metrics exported | 306 families in the live scrape: node memory, vmstat (swap, major faults, oom_kill), cpu by mode including steal and iowait, per-device disk, filesystem, 51 Postgres families (bgwriter, database, WAL size, statements totals, exporter health), PgBouncer, PostgREST pool, Auth pool waits. **No pressure-stall (PSI) series.** | live scrape | MEASURED |
| Disk IO % consumed or burst balance via API | **Not found.** 0 hits for budget, burst, balance, consumed in the 349 KB OpenAPI document; none in the 306 families; the Metrics page does not list it. I did not find the vendor sentence that says it is "not exported"; the absence is established from the spec and the exposition. | OpenAPI v1, live scrape, docs | MEASURED |

## 2. What was collected, and how

| Collector | What | Command |
|---|---|---|
| Logs | 21 first-pass queries over every source, then an hourly panel for each day 27 Sep to 5 Oct (postgres, applications, services), then 10-minute windows around each onset and recovery. 80+ queries, one a minute, no 429. | `npm run forensics:logs -- --set=... [--day=] [--start= --end= --tag=]` |
| Usage | hourly counts 2 to 5 Oct | `npm run forensics:usage` |
| Metrics | raw exposition kept whole (gzip), per-device role from mountpoint, cpu by mode, swap, faults, WAL/bgwriter deltas | `npm run forensics:metrics [-- --watch=8]` |
| Database | 28 bounded read-only statements, refuses unless `select 1` answers in 2 s | `npm run forensics:capture -- --db` |
| Preserve | sanitised copy (emails, IPs masked, then re-scanned) | `npm run forensics:preserve -- --to=docs/ops/evidence/<date>` |

**The credential for the customer route is not readable by this token. MEASURED.** The project has a secret key (`default`, created
2 Sep). Listing keys works; revealing it returns 403 "Your account does not have the necessary privileges". `/v1/profile` answers
"requires a user-scoped access token", so this token is narrower than a personal access token. Nothing was created, rotated or
worked around. The collector therefore uses the Management API scrape, which returns the same exposition, and records the route in
every record. If Grant puts the existing key in `SUPABASE_SECRET_KEY`, the customer route is used automatically.

**The scrape fails exactly when it is needed. MEASURED.** In an episode the Management route returned 500 after about 10 s on 5 of 5
readings (21:18, 23:02, 01:08, 03:11, 05:14); none of those requests appears in the gateway log, so the failure is upstream of the project's gateway. In the healthy
state it answered 200 in 1.2 to 6.2 s on 11 of 11. It is current-state only (no history parameter), so the only history is the
scrapes we keep.

## 3. Episodes on one clock (MEASURED, from the logs and the usage API)

"Episode" is a period of statement timeouts, slow-statement lines of 10 to 120 s and failed cron starts.

| Episode | Onset | Recovery | Length | What preceded the onset | Traffic during |
|---|---|---|---|---|---|
| 28 to 30 Sep | 28 Sep 15h (13 timeouts); 29 Sep 17h to 19h (104 slow lines, our worker, up to 103 s); 30 Sep 21h (44 slow lines) | within the hour | 1 to 2 h | not captured | 3 to 5 k requests a day |
| **E0** 1 Oct | 12:40 | 14:40 | 2 h | **our own migration and backfill work** through the Management API: checkpoints of 8,500 to 15,900 buffers (normal about 100), slow statements are `mgmt-api` queries over `public.jobs` | none at the gateway |
| **E1** 2 Oct | 07:20 (slow statements from 06:48 and 07:04) | 3 Oct 01:35 to 01:40, step change | **18.3 h** | a 37.8 s `count(*)` over `jobs` at 06:48, then a burst of 2,303 requests in ten minutes at 07:20 | fell to 1 to 2 an hour at 14:00 to 15:00 with a single checkpoint and a single cron start in that hour |
| **E2** 3 Oct | transient 17:20 to 18:10, persistent 19:10 | 4 Oct about 06:00 | about 10.7 h | **a stall at zero traffic** (cron starts 8, 1, 0, 2 per ten minutes, 17:10 to 17:49), then bursts of 3,039 (17:50) and 2,279 (19:10) | 98, 19, 24 requests an hour |
| E3 4 Oct | 07:23 | 09:00 | 1.6 h | traffic burst (3.6 k then 12 k requests an hour) | |
| **E4** 4 Oct | transient 14:20 to 14:40 (cron 4 per ten minutes under about 100 requests), persistent 15:30 | 5 Oct about 07:15, step change | **15.8 h** | the cron stall, a quiet interval, then 51 then 2,079 requests per ten minutes at 15:20 | 0 requests for 13 h from 18:00 |

Daily gateway requests (usage API): 28 Sep to 1 Oct 3 to 5 k, **2 Oct 29,864, 3 Oct 60,326, 4 Oct 54,724**. The first onset on 3 Oct at 5.7 k an
hour came after hours of 14.6 k and 11.5 k that the host tolerated, so instantaneous request rate does not predict onset.

## 4. The questions asked

**A. What happens immediately before each degradation.** MEASURED. A surge, in every persistent case: our own write-heavy migration
work (E0), or 2,300 to 3,000 requests per ten minutes (E1, E2, E4). In E2 and E4 a **stall at near-zero traffic comes first** (cron
launches stop for 20 to 30 minutes) and recovers on its own before the burst arrives. Slow statements appear before the burst in E1
(06:48, 07:04) and E4 (14:15).

**B. What stays elevated during it.** MEASURED. Statement timeouts 13 to 26 an hour, 37 to 59 slow-statement lines an hour with a
maximum of 98 to 119 s, client resets, a failing cron heartbeat (87 of 120 runs in the last two hours before recovery failed, mean 26 s),
fsync times of 1.0 to 1.97 s on five files in some hours (healthy: 0.003 to 0.005 s), no checkpoint or cron progress in the worst hour
(2 Oct 15:00: one of each).

**C. What changes when it recovers.** MEASURED. A step within one ten-minute bucket: timeouts go to 0, checkpoint sync falls from
0.05 to 0.09 s to 0.003 s, and the checkpointer then flushes a backlog (140 to 443 buffers against 4 to 25). It happened at zero
gateway traffic both times and without any action of ours.

**D. Does it occur while Team HQ workload is idle.** MEASURED. Yes, in three ways: persistence (13 h at zero requests), the pre-onset
stalls in E2 and E4, and recovery. The standing workload that does run at idle is cron every minute, about 14 jobs an hour and the
platform's own scrapes.

**E. Is multi-user activity temporally associated with the transitions.** MEASURED association, INFERRED role. See question 2 above.
Offices: 2 active person offices (created 1 and 2 Oct), 21 throwaway acceptance offices created and disabled on 3 Oct, 1 test, 1 system.
Real jobs per day did not rise. Test-office jobs: 354 on 2 Oct, 94 on 4 Oct (53 of them in the 15:00 hour, at the E4 onset). The
first multi-user migration work (office backfill) is E0 itself.

**F. What would falsify memory starvation.** A scrape during an episode showing free or available memory normal, swap-in and out near
zero and iowait low; or episodes continuing after RAM is raised; or a stall with `Shmem` and `Cached` high (the cache resident).
Also: a recovery that tracks cache warming rather than a step.

**G. What distinguishes memory thrash from IO-budget exhaustion from CPU credit.** All three need an episode-time scrape:
swap in/out and available memory high with IOPS under baseline means memory; IOPS pinned at the baseline (250), latency rising, queue
depth high, throughput at 5 MB/s means IO budget; `steal` high with idle near zero means CPU credit. The IO budget itself is the
dashboard stat. Not obtained.

**H. Is database growth causal.** INFERRED: contributory or correlated, not shown causal. 372 MB now against 434 MiB RAM and a
224 MB buffer cache; the escalation from 1 to 2 h episodes to 10 to 19 h episodes follows both growth and the 10 to 20 times traffic
increase, and the two cannot be separated from here. 63 to 328 MB was recorded before the first long outage.

## 5. Resource evidence

**Healthy idle, 07:37 to 08:05 UTC, 11 scrapes (MEASURED; rates DERIVED from counters).**

| | mean | max |
|---|---|---|
| CPU idle / iowait / steal | 93.7% / 3.0% / **0.0%** | 78% / 10% / 0% |
| swap-in pages/s | 109 | 248 |
| swap-out pages/s | 67 | 381 |
| major faults/s | 178 | 513 |
| system disk `nvme0n1` reads/s, MB/s | 152, 3.0 | 460, 10.0 |
| Postgres data disk `nvme1n1` reads/s, MB/s | 3.2, 0.2 | 6.6, 0.5 |
| both disks, IOPS per minute | 59 to 638 (7 samples) | **638 against the 250 baseline** |
| read latency | 0.6 to 1.0 ms | |

**Where the I/O is. DERIVED.** Device role comes from the mountpoint in the same scrape (`/` system, `/data` Postgres). The I/O at idle is on
the **system** disk, which is where swap lives; the Postgres data volume is nearly idle. One minute in seven exceeded 250 IOPS and 5 MB/s
(2.5 and 2.3 times). Caveat: AWS counts I/O in normalised units, so these block-layer counts are indicative against the vendor
table, not the budget.

**Memory. MEASURED.** 07:37: available 105 MiB, free 9.6, cached 120.5, anon 108.4, shmem 28.9, swap used 551 of 1,024. 08:05: available
118.7, free 24.9, cached 84.7, shmem 3.8, swap used 613. `shared_buffers` 224 MB, `effective_cache_size` 384 MB, `work_mem` 2.1 MB,
`max_connections` 60. Postgres has run since 2 Sep with no restart and no OOM kill (`node_vmstat_oom_kill` 0, no startup, recovery or
kill line in ten days of logs). CPU steal was 0 in the healthy state: it says nothing about an episode.

**What the first incident left that bears on CPU. MEASURED (first notes).** A pure-CPU `count(*)` over `generate_series(1,2000000)` took 6.9 s
with 476 ms of planning during an episode, about 28 times a healthy run. That is hard to explain by disk throttling alone and fits CPU throttling
or process stalls. My earlier line that CPU-credit depletion was "unsupported" rested on steal measured after recovery and is withdrawn.

## 6. Who times out, and on what (MEASURED)

* 336 timeouts in 24 h, 328 `client backend`. By role and application after 17:00: **`postgres_exporter` (the platform) 198**, `postgres.js` (our worker) 68,
  mgmt-api 3. Before 17:00: PostgREST 73.
* Statements behind the top ids: the exporter's `normalized_pg_stat_statements` query (122) and its `pg_stat_statements` totals query (63); our worker's job-notification
  query (44, mean 5.2 s, max 110 s) and its model-order query (19; 6,213 calls, 441,971 blocks read); PostgREST schema introspection (28 and 12).
* The exporter is a victim: it runs on every scrape and is the most frequent long statement. Its query reads a full statistics store (4,911 of 5,000
  entries, 2.1 MB of text, 101 evictions) and took 13 to 19 s even in healthy hours. That is a cost we add and the platform pays, and worth shrinking
  (reset or trim `pg_stat_statements`, a change that needs approval because it destroys evidence). Not shown causal.
* **A hypothesis tested and refuted:** that the 12 GB a day of temp files is the exporter materialising `pg_stat_statements`. The exporter's role shows 0 temp
  blocks. The temp counter is 389.6 GB over 71,065 files (5.5 MB a file); tracked statements account for about 1.2 GB. The producer is still UNKNOWN.
* Cost-0.26 plans such as `select app.defer_over_budget()` taking 100 s are the outer node of PL/pgSQL functions that read tables inside; they are not evidence of a pure-CPU stall.

## 7. Hypotheses, scored

| Hypothesis | For | Against | State |
|---|---|---|---|
| Memory starvation and swap thrash | 551 to 613 MiB swapped at idle; shared_buffers 52% of RAM and barely resident; constant major faults; the exporter and the worker are the first to time out; DB (372 MB) larger than the cache | recovery is a step at idle rather than gradual; no episode-time memory reading | INFERRED, leading |
| Disk IO budget exhaustion | idle I/O is about 60% of baseline IOPS and on the swap disk, so memory pressure converts into budget use; vendor lists exactly these symptoms (slow responses, IO wait, backups and autovacuum disrupted, unresponsive); step recovery after idle hours | a CPU-only 28 times slowdown in the first notes; checkpoint write volumes are small against 18 GB an hour of baseline throughput; no budget reading | INFERRED, possible |
| CPU credit exhaustion | the CPU-only slowdown; zero steal at idle says healthy CPU is under baseline; recovery by refill | the vendor says burst relates to disk IO; no episode-time steal | INFERRED, not excluded |
| Provider or shared-host fault | stalls at zero traffic before bursts; idle step recoveries; auth, storage and the exporter all fail together | none of our own evidence can show it | UNKNOWN |
| Pathological Team HQ query | the worker's notification and model-order queries are heavy readers | trivial statements stall equally; 25 to 30 Sep stalls had the same signature at far lower traffic | not supported |
| Multi-user as a feature | verification bursts precede onsets; E0 is the office backfill | real job volume flat; idle-pass +10% statements (replica); stalls pre-date it | trigger, not cause |

## 8. The one manual evidence gap

**Disk IO % consumed** (Dashboard, Observability, Database Health). It is not in the OpenAPI document, not in the 306 exported families, and the
documentation says to read it under Database Health. I did not use any undocumented dashboard endpoint. Please capture, **before about 15:30 UTC on
5 October**, the Database Health page for the last 24 hours (it must show E4's onset at 15:30 on 4 Oct and the recovery at about 07:15), and the same
chart's range selector for the longest window the plan offers (3 Oct 19:30 and 2 Oct 07:20 are the other onsets). This is the only metric that
cannot be had by API at all.

**A second, narrower fact, stated so it is not hidden.** For the episodes that have already happened, the CPU (steal, iowait), memory, swap and IOPS
history exists only in the dashboard's Reports, because the scrape is current-state and returned 500 throughout every episode (section 2). That is a
limit of timing, not of the API: any future episode captured by a scrape that answers needs no screenshot. If Grant is willing to capture the same
24-hour window of CPU, memory (with swap) and disk IOPS for E4 at the same time, it would answer question G for that episode without the risky experiment in
section 11. That request is optional; the Disk IO % consumed one is the required one.

## 9. log_temp_files

**Outcome (MEASURED, 5 October, platform healthy, Grant's approval stated, preflight passed, nothing else changed).** The PUT was sent three times with
`0`, `0B` and `0kB`. Each answered **HTTP 400** `Invalid size: <value>. Allowed values: >= -1024B <= 2TB.` The API's validator rejects zero in every
spelling. It is a validation error, **not a permission refusal**, so it says nothing against this token's role. The setting was read back and is
unchanged (`-1`, off). The attempts are recorded as `config_attempt` rows in the capture log. Per the instruction, the refusal is recorded and the setting
left alone.

**Second attempt, with Grant's approval: `1B` was accepted (HTTP 200).** MEASURED: the database reported `log_temp_files = 0` (the setting's unit is kB,
so 1 byte rounds to "log every file"); no restart (postmaster start time unchanged, 2 September 17:46); only this setting was sent. It was on from about
09:29:42 to 09:50:45 UTC on 5 October, then **restored**: the override was removed, the config endpoint reads `{}` again and the database reports
`log_temp_files = -1`. Both verified.

## 9a. Who writes the unexplained temp files (the bounded `log_temp_files` experiment, 09:29 to 09:51 UTC, 5 October)

Raw: `evidence/2026-10-05/logs/win-tempfiles-*`. 41 temp-file lines in the window. Nothing else wrote one.

* **MEASURED (conclusive on WHO):** all 41 lines are role `supabase_admin`, application `postgres_exporter`, from **one long-lived backend (pid 670393)**,
  except one line from my own controlled read (below). No Team HQ application role, no worker, no PostgREST, Auth or Storage backend wrote a temp file.
* **MEASURED:** every exporter cycle is **3 files**: 1,946,722 B (or 1,947,013 B later) and two of 4,041,588 B (or 4,042,254 B later), about **10.03 MB**.
  The sizes repeat to the byte across cycles and drift by a few hundred bytes as the statement store changes.
* **MEASURED, our scraping versus the platform's.** Phase A, my Management scrape every ~63 s (09:30:25 to 09:35:44, six scrapes): six bursts, at 09:30:28,
  09:31:29, 09:32:35, 09:33:38, 09:34:41, 09:35:44, **one per scrape of mine, each within ~3 s of it**. Phase B, no scraping from me (09:35:44 to 09:48): bursts at
  09:37:40, 09:38:40, 09:40:40, 09:42:40, 09:44:42, 09:46:40, 09:48:41, so the **platform's own baseline is one burst about every 120 s** (the
  09:37:40 and 09:38:40 pair is one minute apart and not explained). One extra 4 MB file at 09:34:41 is a platform cycle landing on mine.
* **DERIVED:** the baseline is 10.03 MB per 120 s = **5.0 MB a minute = about 7.2 GB a day, 1.5 files a minute**. Each scrape of mine adds the same 10.03 MB, so
  1/min scraping would add 14 GB a day; the 12.4 GB a day average since 25 August (389.6 GB over 31.5 days) is the platform baseline plus extra, and I did
  not measure the earlier extra, so that gap (about 5 GB a day) is **UNKNOWN**. This corrects the earlier "5 MB and 1.5 files per scrape": it is 10 MB and 3 files per
  scrape, and the platform scrapes every other minute at the spill level.
* **MEASURED, and the statement:** the provider's log does not keep the STATEMENT line (the lines are bare), so the text is not logged. A controlled single
  read of `extensions.pg_stat_statements` selecting the query text, as `supabase_read_only_user` at 09:48:38, wrote **a temp file of exactly 4,041,588 bytes**,
  the same size as the exporter's two large files. So the large files are **the materialised `pg_stat_statements` result with query text (a function
  result larger than `work_mem`'s 2.1 MB)**. MEASURED as a byte-for-byte match, INFERRED as an identity. The **1.95 MB file's statement is UNKNOWN** (a second
  projection of the same store is plausible, not shown). A second read of mine that sorted all rows by `query` at 09:49:24 produced no temp-file line, which I
  cannot explain (a different plan, or a log lag at the time I looked): UNKNOWN, not resolved.
* **DERIVED, why this matters for the IO question:** 5.0 MB a minute is about 83 KB/s against a 5 MB/s baseline throughput, 1.6%, on the data volume. The exporter's
  spill is **not** a plausible consumer of the disk IO budget. The system volume is the large user: at idle it did 128 reads/s and 29 writes/s (157 IOPS, 63% of the
  250 IOPS baseline), from swap (section 5). The spill is still the biggest recorded write source on the data volume, and the exporter is the first role to time
  out in an episode (198 of 336 timeouts after 17:00), so it is a victim and a small contributor, not a cause.
* **Decided after independent review (5 October, late): the exporter temp-file finding is treated as substantially resolved, and cumulative `temp_bytes` is
  demoted as an outage hypothesis.** No change is to be made to `pg_stat_statements.max`, `track_utility`, `work_mem` or any other setting to address the
  exporter spill. Section 12 supersedes the earlier suggestion here.

## 9b. Restarts and recoveries (new)

* MEASURED: host booted 2 September 17:44 UTC, Postgres up since 2 September, Auth since 15 September. **No restart, reboot or counter reset at any
  recovery.** A recovery is therefore not a restart.

## 9c. Vendor documentation, checked 5 October 2026, and whether the recovery timing fits

* **Supabase (MEASURED from the page text):** Nano is listed at baseline 5 MB/s and 250 IOPS, maximum 261 MB/s and 11,800 IOPS. "Compute sizes up to 2XL can burst above
  their baseline for short periods of time, drawing on a disk IO budget"; "once the budget is exhausted, performance returns to baseline". The troubleshooting page
  gives the symptoms (response times, CPU rising from IO wait, backups and autovacuum disrupted, unresponsive instance). **Neither page says how the budget is
  refilled or how long it lasts, and neither describes CPU credits for Nano.** I could not find a Supabase statement of a refill period.
* **AWS, instance-level EBS burst (AWS Compute Blog, EBS-optimized instance burst capability):** the burst gives "at least 30 minutes each day"; "we top off the
  burst buckets every 24 hours"; "the refill rate for a burst bucket is the difference between the baseline rate and the instance I/O activity". That is a documented
  24-hour top-off plus a continuous refill that is zero when activity is at baseline. It is the only documented fixed period I found. Whether this host's budget IS that
  mechanism is not stated by Supabase: **UNKNOWN**.
* **AWS, CPU credits (EC2 burstable instances guide):** for t4g.nano, 2 vCPU, 6 credits earned an hour, baseline 5% per vCPU, balance capped at 144 (24 hours of earning),
  credits earned **continuously**; T4g is **Unlimited by default**, where exhaustion is billed rather than throttled; only Standard mode throttles to baseline. So a CPU-credit
  recovery would be continuous, not a clock event, and throttling needs Standard mode, which is unknown for Supabase. This host (2 CPUs, 433.9 MiB) matches a t4g.nano
  only circumstantially (INFERRED); Supabase does not say which instance Nano is.
* **Does the observed timing fit?** Recoveries (clock, from 10-minute buckets, about plus or minus 10 min): 1 Oct 14:40 (E0), 3 Oct 01:37, 4 Oct 06:00, 4 Oct 09:00 (E3), 5 Oct 07:15.
  Spacing 28.4 h, then 25.3 h (E2 to E4), or 22.3 h from E3 to E4. A fixed daily top-off would put recoveries at one clock time; they span 01:37 to 07:15, 5.6 hours, far
  more than the timing error. Durations 18.3, 10.8, 15.8 h are not equal. **So a fixed 24-hour top-off phase is not supported by three events; a rolling mechanism (24 hours
  since the last top-off or exhaustion, or a continuous refill that depends on activity) is not excluded.** I do not infer a refill period from n = 3.

## 9d. The five hypotheses, kept separate (all INFERRED unless a line says MEASURED)

| # | Hypothesis | For | Against | Signature it predicts | In our evidence? | The one measurement that discriminates |
|---|---|---|---|---|---|---|
| 1 | Disk IO burst exhaustion and refill | MEASURED: system volume at 157 IOPS (63% of the 250 baseline) at idle, so little headroom; vendor symptoms match; budget is documented; idle recovery fits a refill when activity drops below baseline | no budget reading; the swap traffic is real and constant, so idle activity never falls to zero; the documented 24 h top-off does not match the 5.6 h clock spread | root volume IOPS pinned at about 250 with rising latency and iowait during an episode; Disk IO % consumed falls to 0 at onset and rises at recovery | **no**: IOPS and latency at healthy idle only; no episode-time reading (the scrape returned 500 in every episode) | the **Disk IO % consumed chart** across an episode (dashboard only) |
| 2 | CPU credit exhaustion and refill | nano-class CPU, near-baseline credit economics would throttle to about 10% of two vCPUs; continuous refill would give a gradual, activity-dependent recovery | MEASURED: CPU 94 to 96% idle and steal 0 to 0.1% at healthy idle; T4g defaults to Unlimited, which does not throttle; Supabase documents the burst as disk IO | steal rising and user CPU capped at about 10% of total across both vCPUs during an episode, with load high | **no**: only healthy-state CPU | CPU steal and per-mode utilisation during an episode (dashboard CPU chart, or one scrape that answers in an episode) |
| 3 | Provider or shared-host event without restart | stalls at zero traffic before bursts; all services fail together; abrupt recoveries at idle with no restart (MEASURED: boot 2 Sep, no counter reset) | nothing in our evidence can show it; a purely external cause predicts no relation to our bursts, but onsets follow bursts in E1, E2, E4 | healthy host metrics (no steal, no IO pinning, memory normal) while the database is unresponsive | **no** | a provider incident record for the host, or episode-time host metrics showing nothing abnormal (also needs a support request) |
| 4 | Memory and swap thrashing | MEASURED: 551 to 613 MiB swapped, 120 swap-in pages/s and 199 major faults/s at healthy idle; `shared_buffers` 224 MB on 434 MiB; the exporter and worker time out first | recovery is a step at idle, not a drain; thrash alone does not say why the host leaves it | MemAvailable near zero, swap pinned, major faults and swap I/O far above idle, runnable queue long | **partly**: the healthy baseline is already paging; no episode reading | MemAvailable, swap and major-fault rate during an episode (dashboard memory chart) |
| 5 | Application backlog or workload | onsets follow verification bursts (2,300 to 3,000 requests per 10 min) and our own migration work (E0) | MEASURED: 13 h at zero gateway requests; cron starts fall to 0 to 4 per 10 minutes, which is Postgres-internal; stalls on 28 to 30 Sep at 3 to 5 k requests a day; the worker's real jobs are flat | many active backends, lock waits, a long queue draining through the episode | **partly**: bursts precede onsets (a trigger); no signature of work being done during the episode | `pg_stat_activity` and statement counts during an episode (not obtainable while the database is down; the statement store before and after is) |

**Revised ranking (INFERRED, confidence low to moderate):** (a) hypotheses 1 and 4 acting together are the best fit: constant paging puts the system volume at about two thirds of
its baseline at idle, any burst pushes it over, a budget (if the host has one) runs out, and the host stays pinned until activity falls and the allowance refills; (b) the
provider event, 3, cannot be excluded and cannot be tested by us; (c) CPU credit, 2, is weakest: healthy CPU idle and steal show no pressure, the AWS default does not throttle, and
Supabase does not describe it; (d) application workload, 5, is the **trigger** and not the cause; the temp-file spill is **not** a candidate cause (about 1.6% of baseline throughput).
Nothing here is proven. The same missing measurement, one episode-time reading of the host, separates 1, 2, 3 and 4.

## 9e. Paging bursts

MEASURED: two paging bursts 70.5 minutes apart in the kept scrapes. n = 2, so no period is claimed.

## 10. Corrections to earlier statements

* "Logs expire after 24 hours": wrong. Retention is at least 10 days; the limit is 24 h per query.
* "CPU-credit depletion is unsupported": too strong; withdrawn (section 5).
* "The first outage was 3 October": there were stalls on 28, 29 and 30 Sep, a two-hour episode on 1 Oct, an 18-hour episode on 2 Oct, and long ones on 3 and 4 Oct.
* The `--db` guard required HTTP 200 where the read-only endpoint returns 201, so it refused a healthy host. Fixed with a tested predicate.
* `statements_by_temp_written` used a column Postgres 17 removed (`blk_read_time`). Fixed.
* A scratch script was created with a shell heredoc, against the File editing rule; deleted, never committed.

## 11. Next experiments, and what is decided

0. **Decided by Grant, 5 October: the controlled 500/1000/2000 ramp is NOT to be run** (it risks another 10 to 19 hour outage), and artificial load is not
   to be generated to provoke an outage. The office stays in forensic observation: one low-impact scrape and health reading per check, raw samples kept,
   and a naturally occurring onset captured from logs and usage. If the platform becomes unhealthy, database access stops and only control-plane and log
   evidence is collected.
1. ~~Controlled ramp~~ (vetoed, kept here so the reasoning is not lost): it would reproduce the pre-onset window under observation.
2. **Free, configuration:** lower `shared_buffers` (224 MB on a 434 MiB host). Needs a restart and is a tuning change, so it needs approval.
3. **Paid:** more compute, only after (1) or the Disk IO % consumed chart separates the mechanisms.
4. **Deployment queue: held.** The latest instruction says not to deploy unrelated product work, and steps 6 to 9 (browser acceptance suites, gate parts, the
   Sample tour) are the same kind of burst that preceded E1, E2 and E4. The migrations and deploys themselves are light. Decision needed from Grant.
   Section 12.5 now gives the recommendation for steps 1 to 5.

## 12. After the independent review (5 October, late): what the new evidence says

### 12.1 The cron canary: a per-minute record of the host that the database keeps itself (MEASURED, new)

`cron.job_run_details` holds one row per pg_cron run: start, end, status. Job 1 (`worker-heartbeat`, `select app.kick_worker()`) is a tiny function that
runs every minute and posts to the worker. Before 15:00 on 4 October its runs take 0.07 to 0.25 s on average and none fail. It is an independent, free,
per-minute probe of **how fast the host can start a new backend and run one trivial statement**, it does not depend on the log pipeline or on the gateway,
and it ran through every episode. Raw: `evidence/2026-10-05/db/` (10-minute series 28 Sep to 5 Oct, and every anomalous run).

Two different failure modes appear, and the earlier notes ran them together:

| Mode | What the table shows | Where it occurs |
|---|---|---|
| **Launcher stall** | runs per 10 minutes fall from 10 to 0 to 6: pg_cron did not start the job at all | at idle, 1 to 2 h long: 2 Oct 14:30 to 16:09, 17:30 to 18:20, 18:30 to 19:09; 3 Oct 11:00 to 13:09 and 17:10 to 17:49; 4 Oct 14:20 to 14:59 |
| **Startup timeout** | 10 runs per 10 minutes, but each takes 10 to 156 s and 32 to 53 of 61 an hour end `failed` with the message **"job startup timeout"** (617 rows in E4) | the persistent phases: 2 Oct 19:13 to 3 Oct 01:41; 3 Oct 19:12 to 4 Oct 06:02; 4 Oct 16:23 to 5 Oct 07:26 |

* **MEASURED, and a correction.** In the persistent phases pg_cron **never stopped launching**: 10 runs in every 10-minute bucket from 15:00 on 4 October to 10:40 on
  5 October. What failed was **starting a new backend within the time allowed**. Running processes kept ticking; the creation of a new one did not complete.
  The earlier statement that "cron starts fall" in persistent phases came from the log pipeline, which under-counts: for 3 Oct 19:30 to 20:30 the log
  showed 3 to 7 missing starts in each 10 minutes and the database shows 10 in every bucket. The log pipeline loses lines under pressure; the table does not.
  Launcher stalls are confirmed by both.
* **INFERRED:** "a new process cannot start in time while existing ones run" is what memory starvation looks like (a new backend must fault in code, catalogs and
  its own stack from swap or disk), and it is what an IO envelope that is pinned at baseline looks like. It is not what a CPU-credit throttle looks like (CPU was
  94 to 96% idle at healthy idle and a credit throttle would slow running processes too). It does not distinguish memory from IO.
* **MEASURED:** the canary is not an earlier warning than the gateway in the persistent phases (both start within about a minute of each other), but a **launcher
  stall is**: it begins 40 to 60 minutes before the first gateway failure in E2 and E4. See 12.3.

### 12.2 Temp files: demoted

The exporter's spill (section 9a) is about 83 KB/s, 1.6% of the baseline throughput, and writes to the data volume while the heavy IO is on the system volume. It is
a victim and a small contributor, not a cause of episodes. Decision recorded: no tuning of `pg_stat_statements.max`, `track_utility`, `work_mem` or anything else for it.

### 12.3 Did host degradation begin before the bursts? (MEASURED at one-minute resolution; the reading is INFERRED)

One-minute joins of gateway requests, Postgres timeouts and the canary, per episode (raw: `evidence/2026-10-05/logs/win-m1-*`, `db/kick-*`):

| Episode | Last traffic before | First sign of degradation | Burst that "caused" it | Order |
|---|---|---|---|---|
| **E1**, 2 Oct | 07:00 to 07:04, 30 to 200 requests a minute, host healthy | **07:21**, one minute after the burst started at 07:20 (335 and 346 requests a minute): 8 gateway 5xx at 07:21, 11 Postgres timeouts at 07:22 | 07:20 | **burst, then degradation, inside a minute** |
| **E2**, 3 Oct | burst 13:10 to 14:19, a last 170 requests at 14:40, then 2 h 20 min (14:50 to 17:09) at essentially zero, cron healthy | **17:11**: launcher stall, 29 of 40 minutes with no run, at **zero traffic** | burst begins **17:50** (3,039 requests in 10 min) | **degradation first, then burst**; persistent phase begins 19:12 inside a second burst (18:50 to 19:30) |
| **E4**, 4 Oct | burst 13:40 to 13:47 (about 3,200 requests), then idle | **14:20 to 14:59**: launcher stall (4, 4, 5, 8 runs per 10 min) at 0 to 8 requests a minute | burst begins **15:22** (about 300 a minute for an hour) | **degradation first, then burst**; first timeouts 15:35; persistent phase from 16:23 as traffic ends at 16:30 |
| Also, 3 Oct | burst 08:30 to 10:20 (1 to 3 k per 10 min) | **11:00 to 13:09**: launcher stall for 2 h 10 min at 0 to 100 requests per 10 min | none in the window; it ended at 13:10 as a burst of 2,673 began | **degradation at idle, with no burst inside it** |

**Answer.** The evidence **supports "host degradation first, burst second" for the transient launcher stalls in E2 and E4**, and for the 3 Oct 11:00 stall, which happened with
no burst inside it at all. It does **not** support it for E1, where the host was healthy until the burst (INFERRED: one minute of 335 requests a minute tipped it). For the
**persistent** phases the onset is during or just after heavy traffic (E2 19:12 inside a burst; E4 16:23 at the end of an hour of about 300 requests a minute). The picture is
therefore: **a host that is intermittently unwell at idle, hours after earlier bursts, and that collapses into the persistent state when load arrives on top of it.**
Three cautions, none of which is resolved:

1. Each stall followed an earlier burst by 36 minutes to about 2.5 hours (E4 14:20 after 13:47; 3 Oct 11:00 after 10:20; E2 17:11 after the 14:40 requests). A delayed consequence of earlier
   load (a budget, a cache, a swap state) is not excluded by "no traffic in the minutes before".
2. The bursts are largely our own verification traffic, and one page load costs about 25 gateway requests (12.6), so 3,000 requests in ten minutes is on the order of a hundred
   page loads. The E2 and E4 bursts were run **against a host that was already stalled**.
3. A gateway request count is not total load. The worker and the exporter reach the database without the gateway.

### 12.4 Refining the leading model: memory starvation feeding root-volume IO, amplified by the Nano IO envelope

The two are not treated as exclusive. The coupled model, with what each part predicts and whether the evidence has it:

| Prediction | Evidence | State |
|---|---|---|
| Memory pressure makes the **system volume** carry heavy IO at idle | 128 reads/s and 29 writes/s on the root volume, 120 swap-in pages/s, 199 major faults/s, 551 to 613 MiB swapped, `shared_buffers` 224 MB of 434 MiB | MEASURED |
| That IO sits **near the baseline envelope** (250 IOPS), leaving little headroom | 157 IOPS = 63% of baseline at idle | MEASURED (DERIVED ratio) |
| Extra demand therefore queues, and **new** process starts suffer first | persistent phases: runs launch on time, "job startup timeout" on 617 of them; running processes keep ticking | MEASURED |
| In an episode, root-volume IOPS is pinned at about 250 and latency and iowait rise | no episode-time reading exists (the scrape returns 500 in every episode) | UNKNOWN |
| In an episode, MemAvailable is near zero and swap/major-fault rates rise above the idle level | none | UNKNOWN |
| The envelope's burst budget (if this host has one) is exhausted at onset and refills afterwards | needs the Disk IO % consumed chart | UNKNOWN |
| A launcher stall at idle is the same mechanism at lower intensity | no instrument covers a stall; the launcher runs in the postmaster's child and wakes on a latch | UNKNOWN |

**What would separate memory from the envelope** (they may both be true): memory starvation predicts high swap and major-fault rates with the envelope not pinned; envelope
saturation predicts IOPS pinned at the baseline with latency rising whatever the swap rate. Both need one reading taken **inside** an episode. The only way to get one without
creating an episode is to take readings continuously and wait for a natural one; the scrape route fails when the host is sick, so the dashboard charts (memory with swap, root
IOPS, Disk IO % consumed) are the instrument.

### 12.5 Deployment queue: can steps 1 to 5 run separately from the heavy acceptance work? (recommendation only; nothing has been run)

Read from the migrations and scripts:

* Migrations 0892 to 0896 are `create or replace function` and `revoke`, with no table rewrite, no `alter table`, no lock held for longer than a catalog update. The only
  loop is 0894's re-index of documents whose chunks are whitespace-only (the database holds 5,444 chunks over 149 documents, 355 MB in all); it touches only affected documents.
* Steps 4 and 5 upload three edge functions and a static page delta. The probes make a handful of gateway requests.
* The earlier trap (an `ACCESS EXCLUSIVE` lock deadlocking a live suite) does not apply: nothing here is `alter table`.

**Recommendation: yes, steps 1 to 5 can be executed serially while healthy, separately from steps 6 to 9, which stay held.** Conditions, none of which has been met by being written down:

1. **Grant's explicit go.** His standing instruction to hold deployment has not been lifted, and this recommendation does not lift it.
2. **Abort rule, using the canary as the live signal:** before each step read health and the last five canary runs (all succeeded, each under 1 s) and the runs-per-10-minutes (10);
   after each step read them again. Stop at any `job startup timeout`, any canary run over 1.5 s, any missing run, any statement timeout in the log, any health label other than
   ACTIVE_HEALTHY, or any gateway section over its usual latency.
3. **A launcher stall can start on its own at idle** (six windows in the three days 2 to 4 October). If one begins during a step it is indistinguishable from an effect of the step, so the abort rule
   applies and the step is repeated later, not argued about.
4. **Add the sign-in fix as a step after 5, only after review:** `deploy:signin` (the function) and the page delta carrying `net.js`. It is new code written today, covered by 12 unit
   tests and the hang harness, and not yet read by anyone else.
5. Scrape before and after each step is kept, as asked; `forensics:metrics` plus one `cron.job_run_details` read are cheap.

### 12.6 The sign-in path is a V1 blocker (MEASURED unless stated)

**Where the deployed login hangs.** On the deployed page (`https://ai-team-hq.vercel.app`, run 11:07 UTC 5 October, platform healthy, with the sign-in request held in the browser so
nothing reached the service): the page sat on the "Loading your office" skeleton for the full 30 s with no message, **held at `ui -> signin:refresh`**. The same shape holds at the other two
sign-in boundaries (verified against a copy of the page from before the fix, `verify:auth-hang -- --root`): the link request leaves the form on "Sending…" with a disabled button, and the
first-office call leaves "Setting up your office…" forever.

**Why.** (1) Every request on the sign-in path had no deadline: the refresh and link requests in `session.js`, every office read and write in `office.js`, and the first-office call in
`bc/account.js`. The studio payload (10 s) and pulse (8 s) had one; the path in front of them did not. (2) The boot sequence awaits the refresh **before** asking for the studio payload, so the
10 s deadline was never reached. (3) The sign-in function called Auth with no deadline either. (4) **A second defect the hang hid:** the function's `refresh` mapped *every* Auth failure,
including a timeout or a 5xx, to `{ok:false, reason:'expired'}`, and the page deletes the stored session on "expired": a returning person was signed out *because Auth was down*.
(5) **Natural evidence of the stall on the live system:** on 5 October at 06:14:50 UTC one sign-in invocation took **59,096 ms** (preflight 06:13:51), and Auth returned `/otp` 500 after
22,448 ms at 06:15:37, during the last hour of E4. UNKNOWN whether that was Grant's attempt: the function log keeps no body, only time and status. Please say when it was.

**Why no suite saw it.** `verify:offline` answers every URL that is not the gateway with an empty 200 (so the sign-in function never hung) and signs in with the legacy office key, which has no refresh.
`verify:account-ui` answers the sign-in function itself. Before today no suite had ever called the real function.

**Healthy deployed path, one disposable person (`verify:auth-acceptance`; production-heavy class, run with stated intent; 17 of 19 checks):**

| Boundary | Time | Note |
|---|---|---|
| page HTML | 0.1 to 0.7 s | |
| sign-in function: whoami / refresh / refresh with a bad token | 557 / 510 / 477 ms | a bad token is reported `expired` and an outage is not |
| session adopted and office resolved (studio read, 403 `no_office`) | 4.4 s | |
| first office made (`create_office`) | 3.3 s | |
| reload keeps the session | 2.3 s | |
| sign out, then sign in again, same office | 12 s | |

The two failures: the hang above (a real defect, expected), and the "first-run screen" check, which expected `.bcfirst`. The deployed page lands a new person on the project board with the
catch-all project "Conversations"; whether the held page delta draws the first-run screen instead is UNKNOWN. The check now accepts either and reports which.

**Request fan-out (MEASURED):** every page load issues about 25 gateway reads, 11 of them to a person who has no office yet (all answered 403), each taking 1.3 to 4.7 s on a healthy
platform, and `pulse` hit its 8 s deadline once. Three loads in the acceptance run made about 75 requests. This is the main component of the request counts in the bursts above.

**What changed in the working tree (not deployed):** `web/studio/net.js` (bounded requests, a boundary trace in `window.__hqTrace` and `hq.trace`), the five unbounded paths moved onto it,
a visible reason and Try again on the strip, `signin` with a 12 s deadline on every upstream call and `unavailable` (503) instead of `expired` for an outage. `verify:auth-hang`: **14 of 14 on the
fixed page, 5 of 14 on the pre-fix page** (the detector fails when the defect is present); `tests/web/sign-in-path-ends.test.ts`: 12 tests, each source property with a control.
**Not exercised, deliberately:** the email leg (a link request spends the project's hourly email budget and could lock the owner out of his own sign-in). **Still unbounded:** the chat turn
and voice requests (`chat.js`, `call.js`), which are long by design and need a different bound.

### 12.7 Would a one-tier compute increase now be a useful controlled experiment? (an opinion, INFERRED; it needs Grant's decision and cost approval)

Vendor figures (current page): Nano 0.5 GB, 5 MB/s and 250 IOPS baseline; **Micro 1 GB, 11 MB/s and 500 IOPS**; same 261 MB/s and 11,800 IOPS maximum; Micro about $10 a month; a change
takes under two minutes of downtime, "can take longer"; Nano cannot be launched on a paid plan, so the project must be on a paid plan.

* **As a mitigation: plausibly yes.** It doubles memory and doubles the baseline IO envelope, which is exactly where the coupled model says the margin is thin (63% of baseline at idle).
* **As an experiment: yes, with two named limits.** It tests the family {memory, IO envelope} against {provider event, application} directly. If launcher stalls and startup timeouts stop for a
  pre-registered window, the envelope family is supported; if they continue at the same rate, memory and IO baseline are weakened a long way, and the provider-event and application hypotheses
  rise. **Limit one:** it changes memory and IO baseline together, so it cannot say which. **Limit two (important):** a tier change replaces the host, so it also resets any host-specific condition;
  it cannot separate the envelope family from "this particular host was unlucky". Say so before the result, not after.
* **How to make it scientifically clean:** change nothing else in the same window (no tuning, no deploy of unrelated work); fix the outcome metrics beforehand, all of which are free and
  already collected (launcher-stall minutes per day, startup-timeout runs per day, gateway 5xx per day, and the exporter-visible host rates from scrape); observe for at least 7 days of natural use,
  because the pre-change episodes occurred on 3 of 4 days; keep the observation traffic natural, with no artificial load.
* **What should come first, if possible:** the Disk IO % consumed chart that Grant is capturing. If it shows the budget at 0% during an episode, the case for the tier is made without spending.
  If it shows plenty of budget during an episode, the IO-envelope half of the model is wrong and the tier is a gamble on memory alone.
* **Rank today:** worth doing as the next controlled step after the chart is in hand, and a reasonable operational choice even without it, **if Grant accepts the paid-plan cost**. I am not recommending it
  over reading the chart first, and it is not something to do while the deployment of steps 1 to 5 is under way.

### 12.8 The sign-in reliability fix is deployed (5 October, 11:43 to 11:49 UTC) - and nothing else was

Grant's instruction: review, deploy and prove only this fix. Nothing in the held queue (migrations 0892 to 0896, `hq-api`, `slack-oauth`, `worker`, the rest of the page delta) was applied.

* **Review (one correction).** The function and the page were read line by line. One gap was found and fixed before deploying: `session.js` cleared the stored session on any refresh answer that
  was not a success, so a reply in a shape the page did not know (a 4xx about something else, a body that did not parse) would also have signed a person out. It now clears the session **only on
  an explicit `reason: 'expired'`**; anything else leaves it in place and reports that the service did not answer. The gateway (`hq-api`) was checked and already answers 503, not 401, when it
  cannot reach Auth, so the page's 401-clears-session rule cannot fire during an Auth outage. No authentication logic, office resolution or fallback changed; no secret appears in any new response.
* **Function:** `signin` v122 (the pre-fix source, confirmed against the deployed bundle) to **v124**, by `npm run deploy:signin`. That script also re-sets the same two function secrets from the vault
  (`HQ_API_TOKEN`, `SIGNIN_ALLOWED_ORIGIN`); values unchanged, nothing printed. Rollback: redeploy `supabase/functions/signin/index.ts` from commit `ca8845b7`.
* **Page:** `dpl_41Ts4Gd5PUAcaazN93dxofCvbK6M` to **`dpl_8QwvvES1oRridjeokGzu2MMGdEYm`**. `hq-page-delta` ships the whole working-tree page, which differs from the live page in thirteen files and includes unrelated queued
  changes (confirmation dialogs, the Slack card). So the deployed page was **built from the live bytes plus only the sign-in diff** (a three-way merge with the pre-fix commit as base; the other
  six differing files were put back to their live bytes) and checked three ways: it parses, the stand-in harness scores 21/21 on it, and after deployment the live page differs from the previous live page in
  exactly `app.js`, `bc/account.js`, `bc/shell.js`, `data.js`, `office.js`, `session.js` and the new `net.js`, each equal to the staged copy. Rollback: promote `dpl_41Ts4Gd5PUAcaazN93dxofCvbK6M`.
* **Healthy path, on the deployed page, one disposable person (`npm run suite -- auth-acceptance --production`): 19 of 19.** Existing session adopted from the address fragment and the fragment removed; the person with
  no office resolved to the set-up screen; first office made (2.9 s); reload keeps the session; sign out clears it; sign in again reaches the same office; teardown left no active office. An earlier run of the
  same pass failed one check (18 of 19) because **my check** matched the page's own copy too early and the next step aborted the in-flight request; the check was tightened and the pass re-run, not the product changed.
* **Degraded path, without degrading production:** with the sign-in request held in the browser (nothing sent to Supabase) the deployed page ends the wait and says the sign-in service did not answer after
  **16.2 s** (it used to wait without end). The stand-in harness (`verify:auth-hang`) covers the rest: 21 of 21 on the fixed page and **6 of 21 on the pre-fix page** (the control that shows the detector fails on the old
  defect): a timeout ends inside its deadline and names the step; a 503 "unavailable" is reported as unavailable, not expired; an unrecognised answer keeps the session; a genuine "expired" still signs out; the form
  leaves "Sending" and "Setting up"; Try again works and replaces the old session once the stand-in is back.
* **Residual risk (UNKNOWN frequency, not new):** if Auth consumes a single-use refresh token and its reply is lost, the old token is spent. Auth's short reuse window mitigates a quick retry; it cannot be removed from the page.
* **Health before and after:** every service `ACTIVE_HEALTHY` at 11:42, 11:49; the cron canary 60 of 60 and 90 of 90 runs succeeded in the surrounding hour and a half, longest 0.25 s. No launcher stall, no startup timeout, no
  Postgres timeout in the window.
* **Still held, as instructed:** migrations 0892 to 0896, `hq-api`, `slack-oauth`, `worker`, the rest of the page delta, the compute-tier decision, any `pg_stat_statements` or `log_temp_files` change (the latter is `-1`).
  Issue #422 records the page fan-out (about 25 reads a page load, 11 before an office exists); #407 is untouched.
