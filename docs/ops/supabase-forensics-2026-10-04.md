# Supabase instability forensics and capture protocol, 4 October 2026

Written while the platform was UNHEALTHY. Nothing here changed production: no migration, deploy, suite, model call, queue change,
configuration change, upgrade, resize or retry. The one production contact in this pass is disclosed under "What touched production".
Every time is UTC. The report keeps three lists apart, as asked: **MEASURED** (a number read from an instrument, with its source),
**INFERRED** (a conclusion drawn from measurements, with the assumption that would break it) and **UNKNOWN** (nothing here can say).

Companion documents, not repeated here: `supabase-incident-2026-10-03.md` (the 3-4 October incident, programmatic evidence),
`supabase-efficiency-2026-10-04.md` (the efficiency pass), `../multi-user/SUPABASE-DEGRADATION-2026-10.md` (the 2-3 October analysis),
`../multi-user/P4-SECOND-USER-ACCEPTANCE.md` section 21 (the 2 October episodes).

## The short answers

1. **`log_temp_files` is configurable, and our earlier "blocked by the platform" was never tested.** The current Supabase docs list it
   as "CLI + SQL, no restart" and the Management API spec accepts it in the Postgres-config body. The earlier conclusion rested on a
   privilege check that cannot see how Supabase grants it. Whether THIS project's token may do it is not established, and it is a
   configuration change, so it is **Grant's decision**. Ready, dry-run by default, gated: `npm run forensics:temp-logging`. Details below.
2. **The mechanism is not established.** The evidence fits a small host that is short of memory and is paging through a disk with a small
   sustained-throughput allowance, with a burst budget that a workload can spend. It does not fit CPU-credit depletion (no CPU is stolen) and
   it is not caused by our request volume at the moment of failure (outages persist with the queue empty). The single decisive observation,
   the dashboard's per-minute memory, swap and disk-IO charts for an incident window, has **not** been read by anyone and **cannot be
   collected through any API**. Free-plan charts keep 24 hours, so the 4 October episode is readable until about 17:00 UTC on 5 October.
3. **Multi-user made the standing workload a little heavier, and that is not enough to be the cause.** Measured on the replica, same
   Postgres, same code path: an empty worker pass does 10% more statements and 24% more buffer reads, a job's life writes 19% more WAL and
   touches 31% more buffers, a backend holds 5% more memory. At the observed job volume that is about 18 MB a day of WAL against about
   14 GB a day of data-volume writes. What multi-user did add, per additional **active** office, is one more statement a pass. The count of
   active offices in production is UNKNOWN. Separately, the **database grew from 63 MB (17 September) to 328 MB (2 October)** before the
   first documented outage, and that growth, not the per-unit cost, is the stronger candidate for pushing the working set past a 434 MiB host.
   Its composition is unknown and a capture query will answer it.

## What touched production in this pass

* **One unintended control-plane run, 21:18:40 to 21:19:11.** I ran `forensics:capture --control-plane` to test argument handling, forgetting
  that the access token is in the environment. Five Management API GETs went out: `/health`, `/v1/projects/<ref>`, `/readonly`,
  `/config/disk/util` and one metrics scrape. No SQL, no write, no retry. It still counts as a reading taken against the rule, and the
  scheduled 23:00 check is unchanged. It produced real evidence (below): health `auth db rest storage` all UNHEALTHY, the project status word
  `ACTIVE_HEALTHY` (the label and the status word disagree), read-only mode **off** (so it is not a full disk), the disk-utilisation
  endpoint answered 500, and the metrics scrape answered 500 after 10.4 s (the host's exporters did not answer).
* Everything else was local: the isolated replica (a marked local socket), the published documentation, and the public OpenAPI spec.

## 1. `log_temp_files`: verified against the current docs and spec, not assumed either way

**MEASURED (read on 4 October 2026):**

* Supabase docs, "Customizing Postgres configs" (`apps/docs/content/guides/database/custom-postgres-config.mdx`, current master). Under
  "Superuser settings": the `supautils` extension "allows the `postgres` role to retain certain superuser privileges. It enables modification of
  the below reserved configurations at the `role` level", and the table includes `log_temp_files` ("Controls logging of temporary file names
  and sizes"), `log_lock_waits`, `log_min_duration_statement`, `track_io_timing`, `track_functions`, `pg_stat_statements.*` and `auto_explain.*`.
  Under "CLI supported parameters": `log_temp_files`, **CLI + SQL, Restart: No**, example `--config log_temp_files=10MB`. Also listed with no
  restart: `log_checkpoints`, `log_autovacuum_min_duration`, `log_lock_waits`, `log_connections`, `log_disconnections`.
* Management API OpenAPI spec (`https://api.supabase.com/api/v1-json`, 349 KB): `PUT /v1/projects/{ref}/config/database/postgres`, scope
  `database:write`, body `UpdatePostgresConfigBody` with `log_temp_files` as a string, plus `restart_database` (boolean). `GET` of the same path
  needs `database:read`. There is also `POST /v1/projects/{ref}/database/query/read-only`, which runs as `supabase_read_only_user`.
* Our earlier note (`supabase-efficiency-2026-10-04.md`, "BLOCKED by the platform") rested on two things: `has_parameter_privilege(current_user,
  'log_temp_files','SET')` returned false, and a `GET` of the config returned `{}`. **Neither attempted the change.** `has_parameter_privilege` asks
  about a GRANT; `supautils` works by intercepting the `SET` in a hook, so a false there says nothing, and an empty `GET` only says there are no
  overrides. The docs' own wording ("no restart", "CLI + SQL") says the opposite of "blocked".

**INFERRED:** that a `PUT` with `{"log_temp_files": "0"}` will be accepted for this project, because the spec lists the parameter and our token
runs migrations through `/database/query` (which needs the same `database:write` scope). The CLI additionally says the caller must be Owner or
Administrator in the organisation, which is UNKNOWN for the token in use.

**Two corrections to the plan recorded earlier:**

* The recommended threshold was `10240` kB (10 MB). The counter says the average temp file is about **5.5 MB** (383.5 GB over 69,295 files), so
  a 10 MB threshold would have missed most of them. Use **`0` (log every file)**: 69,295 files in 31 days is about 1.5 a minute, a trivial
  log volume. A role-level `alter role "postgres" set log_temp_files` would cover only sessions that log in as `postgres` (our worker and
  migrations); PostgREST, Auth, Storage and anything else connect as other roles, so the system-level setting is the one that can attribute.
* "Ask Supabase support" is not needed first. It stays the fallback if the request is refused.

**Prepared, not applied:** `npm run forensics:temp-logging` prints the current overrides, the exact request and the CLI equivalent. `--apply`
needs `GRANT_APPROVED_DB_CONFIG=log_temp_files` in the environment, refuses on an unhealthy platform, sends the whole desired set (it is not stated
whether a PUT merges or replaces), never sets `restart_database`, reads the result back and says if it did not take. `--revert --apply` removes it.

## 2. Is the pattern RAM and swap pressure, or disk-IO burst exhaustion?

### What the vendor says (read today, as written)

* Compute table: **Nano is the free-plan base instance, "Shared" CPU, "Up to 0.5 GB" memory, 500 MB recommended maximum database size.** Our host
  reports 434 MiB, which is that.
* "Compute sizes up to `Medium` run on shared CPU ... **The burst behavior you can observe on Supabase relates to disk IO rather than CPU.**"
* "Compute sizes up to 2XL can burst above their baseline for short periods of time, drawing on a disk IO budget. **Once the budget is exhausted,
  performance returns to baseline.**" The published limits table is a page component, not in the source; a summarising fetch of the rendered page
  gave Nano as **5 MB/s baseline throughput and 250 IOPS baseline, bursting to 261 MB/s and 11,800 IOPS**. That is consistent with an earlier
  reading of `billing/addons` (Micro 87 Mbit/s baseline is 10.9 MB/s). Treat the Nano figures as **quoted, to be confirmed on the dashboard**.
* "If the `Disk IO % consumed` stat is more than 1%, it indicates that your workload has exceeded the baseline IO throughput during the day.
  If this metric goes to 100%, the workload has used up all available disk IO budget."
* The volume itself is gp3, 3,000 IOPS and 125 MiB/s, which is not the limit that bites on a Nano; the **instance-level** allowance is.
* The Database report shows memory (with a Swap series that "only appears when the system is swapping"), CPU, disk IOPS, and throughput on Team
  and Enterprise only. Retention: Free 24 hours, Pro 7 days, Team 14 to 28 days. The report page does not say whether these are available by API.

### MEASURED (production, from the earlier forensic work; sources in the companion documents)

| What | Reading |
|---|---|
| Host | 2 vCPU, `MemTotal` 434 MiB, swap 1,024 MiB of which 474 to 532 MiB in use, `shared_buffers` 224 MB, `work_mem` 2.1 MB, `max_connections` 60 |
| Paging since boot (2 Sep, 31 days) | 161.7 M pages swapped in (617 GiB), 136.1 M out (519 GiB), 281.6 M major faults; no OOM kills |
| Paging at idle and healthy (70 s window, 4 Oct 06:53) | swap in 48 pages/s, out 19 pages/s, 145 major faults/s, root volume reading 2.6 MB/s at 98 reads/s, CPU 96% idle |
| CPU since boot | iowait 4.68%, **steal 0.03% (1,480 vCPU-seconds in 31 days)**, load 0.17 |
| Reads by volume since boot | root `nvme0n1` **5.11 TB** (88.6% of all bytes read), data `nvme1n1` 0.66 TB |
| Writes by volume since boot | root 0.61 TB, data 0.44 TB, of which **temp files 381 GB (86%)** |
| Checkpoints | 9,061 timed (about one per 4.9 minutes), 37 requested; WAL 128 MB |
| Statements | 2,611,322 calls in 31 days, 57,412 s executing (2.1% of one CPU), buffer hit ratio 99.7% |
| Connections | 4 to 17 backends of 57 usable, never saturated, no slot error in the logged windows |
| Statement stalls | `explain analyze` of a count over 2 M generated rows (pure CPU): planning 476 ms, run 6.9 s, against under 1 ms and about 250 ms healthy; a count over a fully cached 311-page index took 13.6 s |
| Episodes (all UTC) | 2 Oct 12:23 to 16:06; 2 Oct 16:50 to about 18:18; 2 Oct about 19:00 (heartbeat paused, one script running); 3 Oct about 19:30 to 4 Oct about 06:50 (flapping 20:35 to 21:12 and 23:33 to 00:10); 4 Oct afternoon (first unhealthy reading 17:28; onset earlier is possible) to **still unhealthy at 21:19** |
| Today, 21:18 to 21:19 | health all four UNHEALTHY; project status `ACTIVE_HEALTHY`; read-only mode off; disk-util endpoint 500; metrics scrape 500 after 10.4 s |
| Database size | 48 MB (an undated early-September reading in `HANDOFF.md`), 50 MB (14 Sep), **63 MB (17 Sep)**, **328 MB (2 Oct, 14:33)**, 329 MB (3 Oct), 346 MB (4 Oct) (`pg_database_size` each time) |

### INFERRED (and what would break it)

1. **CPU-credit depletion is not supported.** Steal is 1,480 vCPU-seconds in a month; a five-hour throttle of two vCPUs would be tens of thousands.
   *Breaks if* a throttled vCPU is not reported to the guest as steal. The vendor's own statement that burst "relates to disk IO rather than
   CPU" agrees.
2. **The host is short of memory, and has been for a while.** MemAvailable 106 to 147 MiB, 530 MiB in swap, continuous swap-in at rest, a
   224 MB buffer pool on 434 MiB. A pure-CPU query taking 7 s with 476 ms of planning is what a process whose pages are being faulted in looks like.
   *Breaks if* the swap in use is cold pages that are never touched again (then swap is a symptom of nothing).
3. **The cumulative counters cannot say WHEN the paging began.** I earlier reasoned that the month's average swap-in (60 pages/s) matching the idle
   rate now (48/s) showed paging "predated multi-user". That does not follow: a quiet first half and a heavy second half average the same. The
   average swap-OUT is 2.7 times the idle rate, which says there were bursts. **Withdrawn as evidence either way.**
4. **A working set that outgrew the host is a candidate trigger.** The database was 63 MB on 17 September, small enough to sit entirely in cache,
   and 328 MB on 2 October, larger than `shared_buffers`. No outage is documented before the size jump; the first is 2 October 12:23. *Breaks if*
   the size is bloat that is never read (then it costs disk, not cache), or if earlier degradations happened and nobody wrote them down (the repository
   holds no record before 2 October either way).
5. **The standing disk traffic at rest is about half of the published Nano sustained allowance.** Idle root-volume reads of 2.6 MB/s and 98 reads/s
   against a quoted 5 MB/s and 250 IOPS is 52% and 39%, before any write. If the quoted limits are right, the host idles with roughly half its
   sustained allowance spent on paging, so a modest extra demand tips it, and once a burst budget is spent the sustained allowance is all there is.
   *Breaks if* the quoted Nano limits are wrong (confirm on the dashboard) or the paging reads are served from page cache and not the device.
6. **Why it stays down with an empty queue** is consistent with a feedback loop: slow I/O keeps backends alive and holding memory, which forces more
   paging. *Not shown.* A provider-side fault is not excluded by anything here.

### UNKNOWN

The per-minute memory, swap, swap-in/out, IO wait, disk IOPS and **Disk IO % consumed** for any outage window; the plan tier (the repository says
free tier and the instance is Nano, so retention is presumably 24 hours); when paging began; what the 12 GB a day of temp files is; what occupies
the 328 MB; how many offices are `active` in production; whether the API services share the 434 MiB host; whether `track_io_timing` would show the
read latency (it is off); whether a platform incident exists for these windows; **whether `supabase_read_only_user` may read `pg_stat_statements`,
`cron`, `net` and the `public` tables** (`--db` records a refused statement as an error and moves on; only a 5xx or a timeout stops it).

## 3. Did multi-user materially contribute?

### MEASURED on the replica (same Postgres 16, same code path, empty of production data)

Two schema generations built from the repository's own migrations: `pre646` (through 0646, the schema at the start of multi-user research) and `post`
(HEAD). Reproduce with `bash scripts/forensics/replica-generations.sh` then the three tools below; every figure was identical across three runs
unless a range is given.

| Per unit | Before multi-user | HEAD | Change |
|---|---|---|---|
| Statements in one **idle** worker pass (duties off, nothing queued; `idle-pass-cost`) | 21.2 | 23.3 | **+10%** |
| Buffer touches in one idle pass | 132 | 164 | **+24%** |
| Time in one idle pass | 7.1 to 8.7 ms | 7.8 to 9.6 ms | not distinguishable |
| Heap of one backend after the standing work (`pg_backend_memory_contexts`) | 4,374 KiB | 4,604 KiB | **+5%, 230 KiB a backend** |
| WAL for one job's life, 11 statements (`job-lifecycle-cost`) | 10.6 to 10.9 KB (13.0 once) | 12.8 KB | **+18 to 20%** |
| Buffer touches for one job's life | 345 | 440 to 467 | **+31%** |
| Indexes on `jobs` | 7 | 10 | +3 |
| Triggers / foreign keys / indexes, whole `public` schema | 115 / 157 / 315 | 226 / 274 / 402 | +97% / +75% / +28% |

The idle pass also loops every `active` office that is not `system` and runs one `fire_pending_signals` for each (`src/jobs/worker.ts`), so it costs
**one more statement, about 16 buffer touches, per additional active office, every minute.** The replica has two. The gate fingerprints 25
offices; most are throwaway accounts that `verify:account-ui` leaves **disabled** (`ACCOUNT-CREATION.md`) and a disabled office is not visited.

### INFERRED

* **Scale.** 17 backends of 230 KiB is 3.9 MiB of 434. A job life is about 12.8 KB of WAL; at the largest measured day (1,416 jobs) that is 18 MB, and the
  data volume wrote about 14 GB a day over the month. Neither is the cause of a stall measured in minutes with an empty queue.
* **The standing statement count is the largest contributor to statement volume and multi-user moved it by a tenth.** 23.3 statements a pass is
  about 33,600 a day, against about 84,000 a day over the month: roughly 40% of everything the database runs is the every-minute pass.
  Multi-user's +2 statements is about 3,000 a day, plus one a minute for each active office beyond the replica's two.
* **What multi-user did that could matter more than the per-unit costs** is data, not code: two days of backfills (migrations 0655 to 0660 gave 56 carrier
  tables an `office_id` and assigned 63,803 rows) wrote new versions of those rows, and the `jobs` heap is already 94 MB for 22,000 rows. Heap that
  has grown stays grown until rewritten. This is *possible, size unknown*; the capture queries `biggest_relations` and `jobs_table_health` will settle it.
* **Timing.** The first documented outage is 2 October 12:23, about 28 hours after the first multi-user code change and within a day of the
  backfill migrations (both are commit times; when each migration was applied to production is not recorded in the repository). That is an
  association, and the repository has no record of the platform's health before 2 October.
* **Persistence.** Every episode has outlasted the load that preceded it, including one with the worker heartbeat paused and one script running.
  A cause that needs our traffic to continue cannot be what keeps the host down.

### Net verdict

**Multi-user is a small contributor to the standing load and is not shown to be the cause. The better-supported contributors are the host's memory,
the disk allowance, and the database's growth from 63 MB to 346 MB in a fortnight, of which multi-user's share is UNKNOWN but probably a minority.**

## 4. What evidence can be collected ourselves, and exactly how

| Evidence | Obtainable? | How | History or point-in-time | Safe while unhealthy? |
|---|---|---|---|---|
| RAM, swap used, swap in/out, major faults | yes, point-in-time counters | metrics scrape (`GET .../analytics/endpoints/metrics`), via `forensics:capture --control-plane` | cumulative since boot; a rate needs two scrapes | scrape answered 500 today; one attempt, no retry |
| Per-minute memory and swap history | **dashboard only** | Observability, Database report | 24 h on Free | yes (a browser, not the host) |
| IO wait, steal, CPU by mode | counters (scrape) | as above | cumulative | as above |
| Disk IOPS, throughput, **Disk IO % consumed** | **dashboard only** | Observability, Database report ("Disk IOPS"; the IO-budget stat) | 24 h on Free; throughput chart is Team plan | yes |
| Pressure-stall information (memory / IO stalled time) | maybe | in the scrape if the kernel exports `node_pressure_*`; `host-capture` prints whether it is present | cumulative | as above |
| `pg_stat_database` temp deltas, `pg_stat_statements`, `pg_stat_io`, waits, locks, cron, worker heartbeat, queue, offices, jobs by hour | yes, SQL | `forensics:capture --db`, **read-only endpoint**, refuses unless `select 1` answers in 2 s | point-in-time or cumulative | **no**: only when functionally healthy |
| Postgres, pooler and edge logs for a window (checkpoint durations, statement timeouts, handshake failures, kills, temp files if logged) | yes | `forensics:capture --logs`, one query a minute, 24 h window | history, **expires** | yes: a separate service from the database |
| Temp-file attribution | after approval | `forensics:temp-logging --apply` (Grant's approval), then read the log stream | going forward | the change itself: **no** (healthy only) |
| Whether a provider incident covers a window | status page | supabase status page, project dashboard banner | provider's own | yes |

`track_io_timing` is off, so per-statement and per-database block read time reads zero. It is role-level on Supabase
(`alter role "postgres" set track_io_timing to on`, covers our sessions only). A configuration change: Grant's decision, **not requested here**.

## 5. The capture protocol

### Phase 0, perishable, do now (a person; about 10 minutes)

The first unhealthy reading of the 4 October episode is 17:28 UTC and its onset may be earlier, so on a 24-hour window its start leaves the
chart during the afternoon of 5 October. **Capture before about 15:00 UTC on 5 October.** In the Supabase dashboard, project
`baujwlzcziasnfhhkchg`, **Observability, Database**, time range **Last 24 hours**, take a screenshot or export of each of:

1. **Memory** (with the Swap series if it appears), 2. **CPU**, 3. **Disk IOPS** (with its limit line), 4. the **Disk IO % consumed** stat and its chart,
5. **Database connections**, and note the **Compute** size in Settings, Compute and Disk, and the plan. Save with the clock time visible. These five
images decide the question. Also screenshot any incident banner.

Anything older than 24 hours on a Free plan is already gone, which includes the 2 and 3 October episodes.

### Phase 1, at the next scheduled check (control plane only; nothing touches the database)

```
npm run forensics:capture -- --control-plane --gap=0     # health label, project status, read-only flag, disk util, one scrape
npm run forensics:capture -- --logs                      # four log queries, 65 s apart, last 24 h; the only expiring evidence
```

Output goes to `.out/forensics/capture-<date>.jsonl` (gitignored; log lines are truncated and redacted; the token is never printed). The scheduled
check does this once and does not repeat `--logs` on later checks of the same incident.

### Phase 2, only when the platform is functionally healthy (all must hold)

Provider label all ok, **and** the metrics scrape answers 200, **and** `forensics:capture --db` is not refused by its own 2-second probe.

```
npm run forensics:capture -- --control-plane --gap=60    # two scrapes 60 s apart: swap in/out, faults, CPU by mode, disk MB/s and busy share, PSI, temp MiB/min
npm run forensics:capture -- --db                        # 16 bounded read-only statements, 1.5 s apart, stops at the first slow one
```

Then the deployment queue (`deployment-queue-2026-10-04.md`) proceeds in its stated order. Record `temp_bytes` first.

### Phase 3, with Grant's approval only

```
npm run forensics:temp-logging                                           # DRY RUN, prints the exact request
GRANT_APPROVED_DB_CONFIG=log_temp_files npm run forensics:temp-logging -- --apply
# a day later:
npm run forensics:capture -- --logs                                      # then read "temporary file" lines (add a query for them)
GRANT_APPROVED_DB_CONFIG=log_temp_files npm run forensics:temp-logging -- --revert --apply
```

### Phase 4, during the next incident (a bounded watch, never a probe loop)

```
npm run forensics:capture -- --watch=30 --every=60
```

Scrapes once a minute for at most 30 minutes and **stops itself on the first failure or unhealthy label**. Run it from a healthy start so the onset
is captured, with the dashboard open beside it.

### How to read the result (the signatures that tell the mechanisms apart)

| Observation at onset | Points to |
|---|---|
| Disk IO % consumed reaches 100% and disk IOPS flat-lines at about 250 with `diskBusyShare` near 1 | **disk-IO budget exhausted**, performance at baseline |
| Memory at the ceiling, swap climbing, swap-in and major faults far above 48/s and 145/s, `memory_stalled` pressure rising, IO at or below the limit | **memory starvation and paging** |
| Both of the above together | memory pressure generating the I/O that spends the budget (the current best fit) |
| CPU steal rising | CPU contention or throttling (not supported so far) |
| `checkpoint complete` lines with long `write=` or `sync=` times at onset | a volume that could not accept writes |
| Everything on the host flat and quiet, health label unhealthy, no log lines | a provider-side fault: a ticket, not a resize |
| `Disk IO % consumed` near 0 throughout | the disk-budget hypothesis is dead |

### What each outcome would imply (no action is proposed or taken here)

* Memory is the mechanism: the levers are a larger compute size (a cost, Grant's decision), a smaller working set, or settings that fit the host
  (`shared_buffers` is more than half of RAM). Application changes would reduce the standing load, not remove the cause.
* Disk-IO budget: the same, plus reducing the 12 GB a day of temp spill, which is 86% of data-volume writes.
* Provider fault: a support ticket with the capture attached.

## 6. Tools added (all local or read-only; none runs by itself)

| Tool | What it does | Touches |
|---|---|---|
| `npm run forensics:capture` | the protocol above: `--control-plane`, `--logs`, `--db`, `--watch` | production, read-only; `--db` uses the read-only endpoint, refuses unless healthy |
| `npm run forensics:temp-logging` | dry-run by default; `--apply` needs Grant's approval variable | production only with `--apply`; nothing is applied by default |
| `npm run forensics:idle-pass` | the real worker pass on a replica, counting statements, buffers, WAL and backend memory | replica only |
| `npm run forensics:job-cost` | a job's insert, state walk and heartbeats, counting WAL, buffers, index size | replica only |
| `scripts/forensics/replica-generations.sh` | builds `pre646` and `premu` beside `post` | replica only |
| `scripts/forensics/metrics.ts` and `tests/forensics/metrics.test.ts` | the exposition parser and rate maths; 10 tests including a control that a scrape with none of the series reads as nothing, and one that found a defect in `qualify` on its first run | none |

## 7. Not done, deliberately

No configuration change of any kind; no compute, `work_mem`, connection, disk or plan change; no upgrade; no support ticket; no polling. `log_temp_files`
and `track_io_timing` are Grant's to approve. The replica is not production: it holds no production data, runs on a larger host and a different disk,
and says how much WORK a unit of the product is, not how a 434 MiB host will behave.
