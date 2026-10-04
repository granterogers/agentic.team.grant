# Supabase incident, 3 to 4 October 2026: forensics

Evidence first. Every time is UTC. Everything below was read from the provider's own log stream (`/analytics/endpoints/logs`, ClickHouse SQL, bounded windows, one query a minute), the project's Postgres statistics and short timed probes. No load test, no retry loop, no upgrade, no deployment, no change to the 16 queued duty jobs. The metrics scrape endpoint (`/analytics/endpoints/metrics`, and the project's own `/customer/v1/privileged/metrics`) answered 500 and 504 during the incident, so there is **no direct CPU, memory or disk-I/O series**; that is the main thing missing.

## What happened, in one paragraph

At about 19:30 the database host became starved. From then on every statement, including trivial ones, took seconds to minutes, new connections could not finish their handshake inside 15 s, auth and the worker's edge function timed out, and it stayed that way for at least five hours **with almost no traffic**. It was not connection-slot exhaustion (no slot error in the whole window), not a pathological query (the slowest statements are one-line functions), and not worker-deployment amplification (the failures began before the deployments that were suspected, and the worker received only 4 to 9 calls per half hour during the degradation, against 30 normally). The pattern is a database host out of CPU and/or I/O budget, probably burst-credit depletion on a very small instance, triggered by a heavy half hour of my own acceptance traffic and then kept down by the standing background load. That is a hypothesis consistent with every measurement; the one measurement that would prove it (the host's CPU and I/O-budget graphs) is not obtainable from here.

> **Update, 4 October 06:50 UTC: the working conclusion above is revised by section "Programmatic evidence" below.** The platform had recovered by then (everything ok, queue empty), the metrics scrape answered, and it shows the host has **434 MiB of RAM, is permanently swapping, and its CPU steal is negligible**. That contradicts CPU-credit depletion as the mechanism and points at chronic memory starvation and paging I/O. Read that section before the classification table; the table keeps its original rows and gets a revised verdict there.

## Timeline

| Time | Observation | Source |
|---|---|---|
| 16:00 to 19:00 | Worker invoked about once a minute, every call 200 (30 per half hour). Normal. | `function_edge_logs` |
| 18:50 to 19:30 | The heaviest period of the day: 5,242 gateway requests, 1,210 auth requests, 4,392 function log lines in 30 min (about 3 requests a second). This is the signed-in phone, laptop and desktop tours, the chat and delegation harnesses and two worker deploys (v945 earlier, v947 about 19:00, healthy afterwards). | `logs` by source |
| 19:00 to 19:30 | First statement timeouts (7, 6, then 18 in the 19:30 bucket), client disconnects (18). Worker calls still mostly 200 (63) | `postgres_logs` |
| about 19:30 | **Onset.** Worker calls go to 504 and 546 and never recover; auth token endpoint begins "upstream request timeout". | `function_edge_logs`, harness output |
| 19:30 on | Traffic collapses (gateway requests 504, then 84, then 14 per half hour) yet degradation continues. Statement timeouts 4 to 18 every 15 min for the whole period, until the end of the window. | `logs` by source |
| 20:22 | Worker v949 deployed; its probe calls 200 and 401 at 20:22:12. The next worker POSTs are 546 at 20:24:43, 20:26:44, 20:33:07 and 504 at 20:43:59. `booted (time: 72 ms)` then `shutdown`: the function boots in 72 ms and is killed. | `function_logs` |
| 20:35 to 20:38 | pgbouncer: TLS handshake errors; a new server connection took 3 s to complete SSL and was then closed `connect timeout (age=15s)`. The database host could not complete a connection handshake in 15 s. | `pgbouncer_logs` |
| 21:05 | Worker v951 deployed; the following kick 504. Same failure as before the deploy. | harness, logs |
| 21:26 | Last duty job created (16 queued, all `attempt 0`, never claimed). Nothing after: the dispatcher stopped producing. | queue read |
| 23:33 to 00:10 | Provider health label flaps; REST (served by PostgREST, quick path) answers in 24 to 90 ms throughout; auth 7 to 40 s; `select 1` 2.6 to 40 s. | timed probes |
| 00:2x | Server-side planning time 476 ms for `select count(*) from generate_series(1,2000000)` (a healthy host: under 1 ms) and execution **6.9 s** (healthy: about 200 to 300 ms). `count(*)` over `public.jobs` (22,084 index entries, 10,466 heap fetches): **75.6 s execution, 1.1 s planning**. A 200k-row count in the snapshot command: plan 60 ms, run 593 ms (healthy 20 to 40). | `explain analyze` |

## What the measurements say

* **Connections.** No `remaining connection slots` or `too many connections` message anywhere in 18:30 to 00:45. At rest 5 to 17 of 57 usable backends were in use, 14 and 17 during the incident. Not saturation.
* **Pathology.** The cumulative `pg_stat_statements` (since 2 September) shows maxima of 63 to 118 s on one-line statements (`app.enqueue_orphans()` 117.9 s, `insert into cron.job_run_details` 78.9 s, `app.kick_worker()` 25.4 s, `app.defer_over_budget()` 77 s, `app.dispatch_due_responsibilities()` 102.8 s) as well as on the heavy ones. A trivial statement taking a minute is the host stalling, not the statement. Buffer cache hit ratio 99.71 %, so it is not a working set that fell out of memory.
* **CPU.** A pure-CPU count of two million generated rows took 6.9 s with 476 ms of planning. No I/O is involved in that query. The host's CPU was throttled or stolen.
* **I/O.** An index-only scan with 10,466 heap fetches took 75 s, about 7 ms per fetch. Each fetch is a random read; that is a throttled or saturated volume. `track_io_timing` is off (block read and write time read 0), so this is inferred, not measured.
* **Checkpoints.** 2 to 3 per 15 min, constant before and during. Not a change. (`log_temp_files` is off, so spills are not logged.)
* **Temp spill, unattributed.** `pg_stat_database`: 68,156 temporary files, 362 GB written in 31 days of uptime (about 12 GB a day). The statement statistics account for about 1 GB of it, so the large part is not attributable from here. It is real disk write traffic on a very small volume and is a candidate contributor; it is not shown to be one on 3 October.
* **Auth and Storage.** Both are Go services behind the same database. Auth settings reads took 7 to 40 s and storage's bucket list answered 400 quickly (it does not reach the database for that call), while REST's schema-cache path answered in 24 ms. They were waiting on the database: the pgbouncer log shows new connections failing their 15 s connect timeout at the same time.

## Causes, classified

| Cause | Evidence for | Evidence against | Confidence | What would confirm it |
|---|---|---|---|---|
| Connection exhaustion | the earlier session saw one `remaining connection slots` error | none in the logged window; 14 to 17 of 57 in use; pgbouncer failed on handshake time, not on a full pool | very low for this incident | slot-error messages in the log window |
| CPU saturation / starvation | 2M-row count 6.9 s with 476 ms planning; trivial statements stall for a minute; handshakes time out; persists with no traffic | no CPU series to read | **high that the host is CPU-starved**; cause of the starvation open | host CPU and credit balance graphs |
| Burst-credit depletion on a tiny instance (the specific form) | onset right after a half hour at about 3 req/s; recovery does not come while idle background work (cron every minute, about 30 statements a minute, 37k-plus calls each of enqueue_orphans, kick_worker, dispatch, defer_over_budget in a month) keeps the host above its baseline; the project documents describe a nano-class instance | the instance size is not exposed by the API (`selected_addons` empty) | **medium** | dashboard Reports, Database: CPU and "Disk IO budget"; compute size in Settings, Compute |
| Disk I/O saturation | 75 s for 10,466 random heap fetches; 12 GB a day of temp spill | no I/O series; `track_io_timing` off | **medium** | disk IOPS and bandwidth percent of budget over 19:00 to 00:00 |
| Memory pressure | cache hit ratio stayed 99.7 % | no memory series | low | host memory graph |
| Checkpoint / WAL pressure | none | checkpoint cadence unchanged | low | n/a |
| Pathological query | `app.model_order` max 63.8 s, dequeue statement max 95 s | trivial statements show the same maxima; model_order is about 400 calls a day, mean 0.4 to 0.6 s, so it was a victim, not a driver (see below) | low | one statement standing out in per-incident-window statistics (not available, statistics are cumulative) |
| Lock or long transaction | 21 deadlocks in 31 days | no lock waits seen; `pg_stat_activity` showed one active statement and wait events empty | low | `pg_locks` during a stall |
| Worker deployment / startup amplification | two of three deploys were followed by a failed kick | onset (about 19:30) precedes the 20:22 and 21:05 deploys; the v947 deploy at 19:00 was followed by 63 good calls; during the degradation the worker received 2 to 9 calls per half hour, not 30; a pass is sequential, pool 2 | very low | none needed |
| Test / harness traffic | the 18:50 to 19:30 spike of about 3 requests a second preceded the onset | cause and effect not separable without the CPU series; the office's own duties ran all day | **medium as the trigger**, not as the cause of persistence | CPU graph shows the climb at 19:0x |
| Provider-side degradation | auth and storage are Supabase-run; the health API's own labels are unreliable | the database host's own stalls are explained by the measurements above | cannot be excluded | provider incident report / support |
| Multiple interacting factors | trigger (my heavy acceptance traffic) plus a standing background load that exceeds a tiny instance's baseline, so it cannot recover | | **medium; this is the working conclusion** | as above |

## `app.model_order`

It did not cause this incident. It runs about 400 times a day in total (6,150 and 6,370 calls in 31 days), a mean 416 to 596 ms against 60 to 90 ms for a trivial statement, and its worst times (63.8 s, 101.9 s) are the same magnitude as `enqueue_orphans` (117.9 s) and a plain `cron.job_run_details` insert (78.9 s): everything stalled together. It is the heavier of the pass statements (it reads about 0.36 MB from disk per call, 4.5 GB in total), so it is a candidate for tuning, but nothing here justifies changing it now. Left unchanged.

## The 16 queued duty jobs

All `duty:` jobs at `attempt = 0`, created 20:24 to 21:26, none claimed, none newer. They never ran, so nothing partly ran. Left alone: not cancelled, duplicated or executed. To be observed draining when the host is functionally healthy.

## Application defects

None found in the incident itself. Two things worth backlog attention, neither proved to be a cause:
1. The standing load is large for the instance: five statements a minute from cron alone plus about 30 for a worker pass, 24 hours a day, for jobs that mostly find nothing (`enqueue_orphans` 38k calls, `kick_worker` 36k, `dispatch_due_responsibilities` 39k, `defer_over_budget` 28k since 2 September). Reducing idle-pass cost would raise the headroom on a small instance.
2. 12 GB a day of unattributed temp spill: turn on `log_temp_files` and find the statements.

## What is still uncertain

The host's CPU, memory and disk-I/O history; the compute size; why the host has not recovered after more than five hours (credit refill versus a stuck process versus a provider fault). The two things to read are in the Supabase dashboard: Reports, Database (CPU, memory, disk IOPS and throughput, "Disk IO budget" if shown) for 18:30 to now, and Settings, Compute and Disk. If the credit balance is empty, the fix is capacity (a larger compute size) or removing the idle load, not code.

## Programmatic evidence (added 4 October 06:50 to 07:15 UTC)

### What the API can and cannot give

| Item | Status | How |
|---|---|---|
| Compute size | **partly**: no compute add-on is selected (`billing/addons` `selected_addons: []`), so the project is on the plan's included default. The default's name and RAM come from the host itself (`MemTotal` 434 MiB, `max_connections` 60 = a nano/micro-class host), not from a field that says "Nano" | `GET /billing/addons`, metrics scrape |
| Disk type, size, IOPS, throughput | **available** | `GET /config/disk`: gp3, 2 GB, 3,000 IOPS, 125 MiB/s (volume level). `GET /config/disk/util`: 676 MB used of 1.93 GiB. Autoscale: not configured |
| Instance-level disk bandwidth (the burst limit that bites on small hosts) | **not exposed per project**; only the published per-size table is in `billing/addons` for sizes from Micro up (Micro: baseline 87 MB/s, burst 2,085) and the default size is not in that list | |
| CPU by mode (user, system, iowait, steal) | **available as cumulative counters since boot (2 September) and as a live scrape**, **not as history** | `GET /analytics/endpoints/metrics` (Prometheus text, about 860 KB, 318 series names, refreshed about once a minute, answered 500 and 504 during the incident and 200 once healthy) |
| Memory and swap | **available** (live and cumulative), not history | same |
| Disk reads, writes, IOPS, IO time per volume | **available as cumulative counters**, not history | same |
| Connections, WAL, checkpoints, temp files, database size | **available** (live and cumulative) | same, plus `pg_stat_*` |
| Request volumes (auth, REST, storage, realtime) | **available hourly** for 1 day | `usage.api-counts?interval=1day` |
| Postgres, pgbouncer, Auth, Storage, gateway, function logs for a window | **available** | `/analytics/endpoints/logs` (ClickHouse SQL, `from logs where source = ...`, throttled to about one query a minute, 24 h window) |
| Per-minute history of CPU, memory, swap, disk IO, IOPS or balance | **not available to us**; the endpoint is a point-in-time scrape and there is no historical metrics API | dashboard Reports only |
| Burst / credit balance (CPU credits, EBS burst balance) | **not exposed anywhere via API**; Supabase's own documentation says the underlying balance is not exported | dashboard at most, possibly not at all |

### What the live scrape shows (at 06:53 and 06:55, healthy)

* **Memory.** `MemTotal` **434 MiB**, `MemAvailable` 106 to 147 MiB, `MemFree` 11 MiB, **swap 1,024 MiB of which 474 to 532 MiB is in use**. `shared_buffers` is 224 MB (more than half of RAM), `work_mem` 2.1 MB, `temp_file_limit` unlimited.
* **Swap and paging, cumulative since boot (31 days).** Swapped in 161.7 million pages (about 617 GiB), swapped out 136.1 million pages (about 519 GiB), 281.6 million major page faults. No OOM kills.
* **The same, right now, while idle and healthy** (70 s between two scrapes): swap-in 48 pages/s, swap-out 19 pages/s, 145 major faults/s, the root volume (`nvme0n1`) reading 2.6 MB/s at 98 reads/s, CPU 96 % idle. The host pages continuously even when nothing is happening.
* **CPU, cumulative.** user 1.6 %, system 1.2 %, **iowait 4.68 %**, **steal 0.03 % (1,480 vCPU-seconds in 31 days)**, idle 92.5 %. Two vCPUs. Load average 0.17.
* **Disk, cumulative.** Root volume `nvme0n1`: 5.11 TB read, 0.61 TB written, 173,980 s of I/O time. Data volume `nvme1n1`: 0.66 TB read, 0.44 TB written. **Temp files account for 381 GB of the data volume's 442 GB written: 86 % of all write traffic to the data volume in a month is sort and hash spill** (`work_mem` 2.1 MB, `log_temp_files` off, so nothing says which statements).
* **Checkpoints.** 9,061 timed, 37 requested; 128 MB WAL; database size 346 MB. Not a WAL problem.
* **Connections.** 4 to 17 backends of 57 usable throughout.

### Request volumes and gateway errors

Hourly gateway requests (auth / REST / storage): 09:00 3,400 / 10,581 / 623; 13:00 2,512 / 7,718 / 1,305; 17:00 717 / 2,257 / 67; 18:00 985 / 3,011 / 311; **19:00 1,318 / 3,864 / 564**; 20:00 67 / 23 / 8; nothing logged in the hours after. By 30 minutes (`edge_logs`): 5xx first appear in the 19:00 bucket (13 REST), then 19:30 (34 auth, 16 REST), 20:00 (22 auth, 19 REST), 20:30 (5 auth). The failures follow the heaviest recent period but that period was **not** the day's heaviest: 09:00 and 13:00 carried two to three times the volume with no incident.

### Verdict on the burst-credit hypothesis

*"Acceptance traffic exhausted CPU and/or disk burst capacity, after which baseline/background work prevented rapid recovery."*

* **CPU-credit depletion: weakened.** CPU steal over the whole month is 1,480 vCPU-seconds. A five-hour throttle of two vCPUs to a small baseline would show tens of thousands of stolen seconds (5 h x 2 vCPU = 36,000 vCPU-s at full demand). The month's total is a twentieth of that. *Assumption stated:* throttling of a burstable instance is reported to the guest as steal. If it is not, this argument fails and the CPU case is open again, because the counters are cumulative and cannot isolate the incident.
* **Single acceptance spike as the trigger: weakened.** Two earlier hours that day were heavier and passed.
* **Memory starvation and paging: strengthened, and it is chronic.** A 434 MiB host with a 224 MB shared-buffer pool, 530 MiB in swap, and continuous swap-in and major faults even at rest has almost no headroom. The measurements during the incident fit that mechanism: a pure-CPU count taking 7 s and 476 ms of planning (the backend's own pages and the catalogs being faulted in from disk), index scans at 7 ms per heap fetch, connection handshakes exceeding 15 s. Anything that pushes resident memory up (more concurrent backends and PostgREST and pgbouncer work from a burst of signed-in sessions, a large sort, an autovacuum) can tip it into a swap storm, and the paging reads compete with the data volume on the same instance's disk bandwidth.
* **Disk-bandwidth burst exhaustion on top of that: still open and not testable from here.** The volume is gp3 3,000 IOPS / 125 MiB/s, which is not a burst volume, but small hosts have an instance-level EBS baseline well below that with a time-limited burst (Supabase's published table; not exposed per project). The only series that would show it, per-minute disk throughput and IOPS against the instance limit, is not available through any API.
* **Why it persisted for hours with no traffic: unexplained.** A swap storm that sustains itself (a hot working set larger than RAM) is consistent; so is an I/O budget that refills slowly. The recovery by about 06:50 with an empty queue is consistent with both.

**Revised working conclusion: chronic memory starvation on a 0.5 GB host (swap thrash and paging I/O), tipped over by the heavy period at about 19:00, with disk-bandwidth burst exhaustion possible and unproven. CPU-credit depletion is not supported. Credit depletion of any kind is not proven.** Confidence: medium that memory pressure is the mechanism, low on the trigger.

### What still needs a person, and exactly what

Only the history, which no API returns. In the Supabase dashboard, Reports, Database, for 18:30 UTC on 3 October to 03:00 on 4 October (retention depends on the plan; the dashboard shows the window it keeps), read **memory used including swap**, **swap in/out**, and **disk IO consumption or throughput against the limit**, plus the **compute size** shown in Settings, Compute and Disk. Nothing else is needed from a person. If the memory chart shows the ceiling at 19:00 and swap climbing, the diagnosis is confirmed and the fix is memory (a larger compute size, or `shared_buffers` and `work_mem` and the idle background load brought down), not code.

### Cheap application-side levers this evidence suggests (none applied; not deployed)

1. Reduce standing background work: every minute the worker pass and five cron statements; most find nothing.
2. Find and fix the statements that spill 12 GB a day (`log_temp_files` is off, so first turn it on); each `work_mem`-sized spill is write traffic on the data volume.
3. The `app.model_order` and dequeue statements read the most from disk per call and run every pass.

## Tooling

`npm run incident:snapshot` takes the measurements that told this incident apart from its label, once, sequentially, with short timeouts: the health label, timed database, auth, REST and storage, a server-side CPU micro-benchmark, connections against the limit, heartbeat and pause state, queue depth and the last 30 minutes of timeout and slot-error counts. It is read only and prints no secret. The log endpoint is throttled to about one query a minute.
