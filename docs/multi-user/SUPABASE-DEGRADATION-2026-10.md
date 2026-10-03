# The recurring Supabase degradation: what is known (analysis of existing evidence, 3 October 2026)

No load was generated for this. Every number below was read from the database's own statistics, the job table, the health
API and the earlier incident record (`P4-SECOND-USER-ACCEPTANCE.md` §21), in about a dozen cheap queries on a healthy day.
Supabase's host metrics (CPU, IO wait, memory, swap, disk IO budget) are **not reachable with the tooling available here**
(`infra-monitoring` is not served for this token; the logs endpoint rejected the table names tried). That is the single
largest gap, and it is the one thing Grant can close: see "What would settle it".

## FACTS (measured, with source)

1. **The instance is small.** `shared_buffers` 224 MB, `effective_cache_size` 384 MB, `work_mem` about 2 MB,
   `max_connections` 60 (settings). Database 329 MB, `jobs` 21,759 rows. Eighteen backends open at the time of reading, one active.
2. **Normal load is very low.** `pg_stat_statements` (window 2 Sep to 3 Oct, 31 days): 2,611,322 calls, **57,412 s of total
   execution time = about 2.1% of one CPU busy on average**. Buffer cache hit ratio 99.7% (`pg_stat_database`: 2.23 billion
   hits, 5.9 million reads). Real duty traffic is 15 to 20 jobs an hour.
3. **Test traffic is bursty and large by comparison.** Jobs per day over the last two weeks run 392 to 1,416, of which up to 997
   a day were fixtures. On 2 October between 02:00 and 03:00 UTC the office ran **172 and 203 jobs an hour (about ten times
   normal), almost all `research` and `office.instruction` harness jobs**: the #404 verification. That burst ended nine and a
   half hours before the 12:23 onset of the second incident.
4. **The incident shape (2 Oct):** worker heartbeat requests began timing out at 120 s at about 12:23, Auth returned plain-text
   "upstream request timeout" from about 12:00, the health API reported auth, rest, realtime and storage unhealthy at 14:33 and the
   database itself at 15:12; recovery was unprompted by about 16:06 (about 3 h 40 min). `net._http_response` over 36 hours holds 312
   successes and 19 timeouts (null status): the timeouts are the incident, not a steady drip.
5. **During the incident a count over a fully cached 311-page index took 13.6 s** with 0.5 s of planning, and with the heartbeat
   paused. Work that touches no disk ran thousands of times slower than normal. No lock waits, no idle-in-transaction sessions,
   seven connections, no runaway query.
6. **Database-wide temp-file spill is large in aggregate:** 66,439 temp files, **373 GB written since 25 August** (about 9.6 GB a
   day, an average of 5.6 MB a file). The statements responsible that `pg_stat_statements` still holds total under 1 GB, so most of
   it is not visible there (the view tracks a limited, recycled set).
7. **Three application queries dominate execution time:** `app.model_order()` (a model's standing on its record, 12,282 calls,
   mean about 370 ms, **max 63.8 s**, about 4,900 s in total, 8.5% of all tracked time), a split of `dedupe_key` that scans commands
   (130 calls, 0.8 s each, 1,371 s), and `kick_worker` (1,688 s). `model_order` reads about 22,000 buffers a call.
8. **The queue is not the cause of the slowness:** at the time of the incident there were 14 non-terminal jobs, no running jobs and
   no user instructions waiting.
9. **There is no scheduled duty for the second office** and no external traffic bound to it; the Sample Person's jobs are rare.

## LIKELY CONTRIBUTORS (consistent with the facts, not proven)

* **CPU starvation of a burstable instance** (credit exhaustion or provider-side contention). It fits fact 5 best (cached,
  disk-free work running thousands of times slower; recovery without any change of ours) and is the usual way a nano-class burstable
  host fails. Not shown: no CPU or credit metric was readable.
* **A burst of our own harness load that spends credit, with the bill arriving later.** Fact 3 gives a candidate for one episode (the
  02:00 burst, nine and a half hours before onset). A credit model would make a delay of hours normal. It would not explain an
  incident with no preceding burst, which the earlier record says occurred ("one later degradation occurred without the earlier
  heavy-test pattern being clearly present").
* **Temp-file spill and 2 MB `work_mem`** adding avoidable disk writes on a small volume (fact 6). Plausible as a contributor to IO
  wait; the per-statement numbers are too small to be the whole story.

## UNPROVEN HYPOTHESES (open)

* Provider-side storage latency or noisy-neighbour effects on the underlying volume (IO wait was reported high at low IOPS; that
  fits throttled or slow storage as well as it fits CPU, and cannot be told apart without host metrics).
* Memory or swap pressure (224 MB of shared buffers on a 0.5 GB class host with 18 connections is tight; nothing measured).
* Retry amplification during an incident (the heartbeat re-fires every minute; at 120 s timeouts that stacks, but it follows the
  onset, it does not explain it, and the heartbeat was paused for part of the episode).

## RULED OUT, OR WEAKENED

* **Disk space and database size:** 329 MB against 500 MB, no growth anomaly, `jobs` 103 MB mostly index.
* **Lock contention, idle-in-transaction sessions, connection exhaustion:** none observed (7 and 18 of 60 connections). 21 deadlocks
  in six weeks, none correlated with the incident.
* **A runaway or pathological query at the time:** none found. Only two cheap periodic calls were running.
* **A table or index defect:** the same count was fast after recovery with no change.
* **"Our heavy test suite alone caused it":** **not established.** The first incident began while harness runs were active; the second
  began with the worker idle and, at least, the last burst nine and a half hours earlier; the platform recovered without a rollback or
  any change. It is also not disproven: a burst can be the thing that spends the credit.

## Is Nano still appropriate? (evidence-based, no upgrade made)

* **Normal Grant plus Sample Person usage:** adequate on the numbers. About 2% of a CPU on average, a 99.7% cache hit ratio, 15 to 20
  jobs an hour. The data volume is small.
* **The workload that is not adequate:** bursts. Anything that pushes the job rate to 100 to 200 an hour (a verification run) or runs
  `app.model_order` hundreds of times is large relative to the headroom a nano class host has.
* **Does normal activity risk exhausting it?** Not on the evidence. But the evidence is of averages; the second incident shows
  degradation without an obvious burst, so "normal use is safe" is likely and **not proven**.
* **Would a larger tier help?** It would add CPU baseline and memory, and if the cause is credit exhaustion it would very likely
  remove the failure. If the cause is provider-side storage latency it would not, and would only hide it.
* **Recommendation: do not upgrade yet; get the one measurement that decides it.** Cost is the deciding fact: a paid tier is a
  recurring cost against a project that is designed to run at about GBP 0. Open Supabase's dashboard (Reports, Database) for
  **2 October 12:00 to 16:00 UTC (the second incident) and the window of the first one, and also 2 October 02:00 to 04:00
  UTC (the 200-jobs-an-hour burst)**, and read CPU (and IO wait), the disk IO budget, memory and swap.
  * CPU pinned or at its baseline ceiling around the onset, with the IO budget healthy: **compute credit exhaustion**. Moving up one
    tier is then a reasonable, cheap fix, and the production-testing rules (`docs/testing/SUITE-CLASSES.md`) reduce the chance of
    spending the credit again.
  * IO wait high with the IO budget at zero: **storage throttling**. A larger tier gives a bigger budget but also hides it; the
    first fix is reducing temp-file spill and write volume.
  * Neither visible and Supabase's status page shows an incident for the window: **provider-side**; a ticket, not an upgrade.

## Cheap changes we could make without upgrading (not made: they are performance work, not a closure item)

* `app.model_order` is the largest consumer of tracked execution time and has a 63.8 s worst case. A cheaper way to ask "which
  model, for which kind" (cache the answer for a minute, or read a materialised record) would remove most of it. Needs its own
  investigation: it is on the inference path.
* Raising `work_mem` modestly is a platform setting; not changed.
* Timeouts were **not** increased and nothing was upgraded.

## What would settle it

Three things, in order of value: (1) Supabase dashboard CPU, IO and memory for the windows above; (2) whether the project is on
Supabase's "shared CPU" nano with the 5% baseline, which the dashboard states; (3) the next incident, with the dashboard open and
`app.office_health()` read once.
