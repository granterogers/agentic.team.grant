# ADR-0076: The heartbeat knocks when there is work, and the pulse asks once a minute

**Status:** Accepted

**Date:** 22 October 2026

## Context

The Supabase Free plan's usage page showed Log Ingestion at 150% of its allowance, Log Query at 105%, Cached Egress at
87% and Database Size at 84%. Three things set the pace:

- `worker-heartbeat` (pg_cron, every minute since migration 0121) called the worker Edge Function every minute whether or
  not anything waited. About 1,440 invocations a day, each a logged request, and a row in `cron.job_run_details` each time.
- The Team HQ pulse asked `hq-api?section=pulse` every 20 seconds per open tab, about 4,300 requests a day per tab.
- A production read on 22 October (table sizes only) showed `public.jobs` at 103 MB, `job_state_transitions` at 51 MB and
  `cron.job_run_details` at about 10 MB with 64,000 rows. The first two are the main database growth and need a retention
  decision, which this ADR does not make.

## Decision

1. **The heartbeat knocks only when there is work.** `app.kick_worker_if_due()` (migration 1093) is the per-minute entry
   point. It calls `app.kick_worker()` when `app.worker_has_work()` is true: a job in a live state, an undecided signal
   from the last fifteen minutes, or an expired unsettled CI reservation. Otherwise it knocks once every five minutes.
2. **The five-minute floor is deliberate.** The predicate names the sources the pass acts on today. A source it does not
   name is then at most five minutes late, never lost.
3. **The pulse asks once a minute** (`web/studio/pulse.js`, `EVERY = 60_000`). It still asks at once when the tab comes
   back to the front (`onShow`), so a person returning to the page sees the current state.
4. **Inbound work is not delayed.** Telegram, Slack and the gateway kick the worker directly when they enqueue, so a
   message from Grant does not wait for the heartbeat.

## Why

- Most of the invocations and logs came from work that was not there. A gate on the database removes that cost without
  adding a paid dependency, and the pause switch (`app.kick_worker` checks `app.worker_paused()`) still applies first.
- Grant approved the heartbeat change and a 60-second pulse on 22 October 2026, after the trade-off was stated: other
  devices see changes up to a minute later rather than twenty seconds.

## Rejected

- **Remove the heartbeat.** Recovery of stalled jobs, resumed pauses and the signal scan all run inside the pass, so
  removing it would strand work until something else woke the worker.
- **A longer heartbeat interval with no gate.** It cuts invocations by the same proportion but keeps knocking on an empty
  queue, and it lengthens latency for every source, including the ones that have work.

## Not yet decided

- **Retention for `public.jobs` and `public.job_state_transitions`.** Pruning finished history is a production write and
  a question about the audit trail. It needs Grant's decision.
- **Pruning `cron.job_run_details`.** Still growing at about 1,440 rows a day for the heartbeat alone. A daily prune
  is a production write and needs approval.
- **Cached Egress.** The pulse response is still sent in full on each poll. A 304 response when nothing changed is a
  possible `hq-api` change, not made here.

## What would reverse it

- Grant asks for the pulse to be faster again, or for the heartbeat to run every minute regardless. The gate can then be
  removed by a new migration that reschedules `worker-heartbeat` to `select app.kick_worker()`.
- A source that the predicate does not name turns out to need sub-minute latency. That source is added to
  `app.worker_has_work()`, not the floor shortened.
