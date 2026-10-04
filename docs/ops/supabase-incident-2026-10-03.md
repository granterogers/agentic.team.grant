# Supabase incident, 3 to 4 October 2026: forensics

Evidence first. Every time is UTC. Everything below was read from the provider's own log stream (`/analytics/endpoints/logs`, ClickHouse SQL, bounded windows, one query a minute), the project's Postgres statistics and short timed probes. No load test, no retry loop, no upgrade, no deployment, no change to the 16 queued duty jobs. The metrics scrape endpoint (`/analytics/endpoints/metrics`, and the project's own `/customer/v1/privileged/metrics`) answered 500 and 504 during the incident, so there is **no direct CPU, memory or disk-I/O series**; that is the main thing missing.

## What happened, in one paragraph

At about 19:30 the database host became starved. From then on every statement, including trivial ones, took seconds to minutes, new connections could not finish their handshake inside 15 s, auth and the worker's edge function timed out, and it stayed that way for at least five hours **with almost no traffic**. It was not connection-slot exhaustion (no slot error in the whole window), not a pathological query (the slowest statements are one-line functions), and not worker-deployment amplification (the failures began before the deployments that were suspected, and the worker received only 4 to 9 calls per half hour during the degradation, against 30 normally). The pattern is a database host out of CPU and/or I/O budget, probably burst-credit depletion on a very small instance, triggered by a heavy half hour of my own acceptance traffic and then kept down by the standing background load. That is a hypothesis consistent with every measurement; the one measurement that would prove it (the host's CPU and I/O-budget graphs) is not obtainable from here.

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

## Tooling

`npm run incident:snapshot` takes the measurements that told this incident apart from its label, once, sequentially, with short timeouts: the health label, timed database, auth, REST and storage, a server-side CPU micro-benchmark, connections against the limit, heartbeat and pause state, queue depth and the last 30 minutes of timeout and slot-error counts. It is read only and prints no secret. The log endpoint is throttled to about one query a minute.
