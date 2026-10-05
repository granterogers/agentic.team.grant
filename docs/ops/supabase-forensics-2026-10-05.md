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

`npm run forensics:temp-logging` now prints a requirements check. **STATUS: WAITING (platform was not healthy when last run; now healthy) and
READY FOR APPROVAL once healthy.** MEASURED: the key is in the documented request body; the access-control table gives database configuration
updates to Owner and Administrator; this token is not a user-scoped token and is refused when revealing the secret key, which is evidence of a
role or scope below Administrator. Whether the PUT is allowed is UNKNOWN until it is made, and a 403 would refuse cleanly. The value is `0`. Nothing was
applied. To apply: `GRANT_APPROVED_DB_CONFIG=log_temp_files npm run forensics:temp-logging -- --apply`.

## 10. Corrections to earlier statements

* "Logs expire after 24 hours": wrong. Retention is at least 10 days; the limit is 24 h per query.
* "CPU-credit depletion is unsupported": too strong; withdrawn (section 5).
* "The first outage was 3 October": there were stalls on 28, 29 and 30 Sep, a two-hour episode on 1 Oct, an 18-hour episode on 2 Oct, and long ones on 3 and 4 Oct.
* The `--db` guard required HTTP 200 where the read-only endpoint returns 201, so it refused a healthy host. Fixed with a tested predicate.
* `statements_by_temp_written` used a column Postgres 17 removed (`blk_read_time`). Fixed.
* A scratch script was created with a shell heredoc, against the File editing rule; deleted, never committed.

## 11. Next experiments, and what is decided

1. **Free, most informative:** a **controlled ramp** of the verification burst (500, 1,000, 2,000 requests per ten minutes through the Sample office), with a
   scrape every minute and the Database Health chart open, aborting at the first statement timeout or cron dip (both are visible in logs within a minute). It
   reproduces the pre-onset window under observation. It may start a 10 to 19 hour outage, so it needs Grant's decision.
2. **Free, configuration:** lower `shared_buffers` (224 MB on a 434 MiB host). Needs a restart and is a tuning change, so it needs approval.
3. **Paid:** more compute, only after (1) or the Disk IO % consumed chart separates the mechanisms.
4. **Deployment queue: held.** The latest instruction says not to deploy unrelated product work, and steps 6 to 9 (browser acceptance suites, gate parts, the
   Sample tour) are the same kind of burst that preceded E1, E2 and E4. The migrations and deploys themselves are light. Decision needed from Grant.
