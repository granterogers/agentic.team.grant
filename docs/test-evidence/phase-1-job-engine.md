# Phase 1 evidence — the job engine

**Date:** 2026-09-03 · **Database:** Supabase `baujwlzcziasnfhhkchg`, PostgreSQL 17.6
**Reproduce:** `npm run verify:db` (`verify:transitions`, `verify:ledger`, `verify:jobs`)

Three of Phase 1's acceptance criteria, demonstrated against the live
database rather than asserted:

1. a job survives a hard kill at every one of its **fourteen** states and resumes correctly
2. re-enqueueing identical logical work **collides** instead of duplicating
3. capacity limits **hold across a restart**

## What "hard kill" means here

The worker vanishes without cleaning up: the row stays exactly as it was and
the lease eventually expires. Simulated by expiring the lease directly, which
produces the identical observable state — and is precisely why the recovery
sweep keys on lease expiry rather than on a shutdown hook, which a killed
process never runs.

Each of the fourteen jobs is walked to its state along its **legal route**, so
nothing is forced into place by a direct write the engine would refuse.

## The two state machines agree

The allow-list exists twice: in `src/jobs/states.ts` and in the database table
`app.job_transitions_allowed`. Each covers a gap the other cannot — TypeScript
catches the mistake at the call site with a stack trace, the database catches
the direct SQL write that never went through TypeScript. Two copies of a rule
are a liability only if they can drift in silence:

```
job_state enum:      14 values
JOB_STATES:          14 values
enum order matches:  ✅
transitions in DB:   46
transitions in TS:   46
only in DB:          none ✅
only in TS:          none ✅

The two state machines are identical.
```

## Result

| group | check | outcome | |
|---|---|---|---|
| idempotency | second enqueue of identical logical work | collided with 23505 on jobs_one_live_per_idempotency_key | ✅ |
| idempotency | same key re-enqueued after the original reached a terminal state | allowed, as designed | ✅ |
| quality gate | output_created -> committing, skipping review (§10) | refused: illegal job transition output_created -> committing | ✅ |
| transitions | reviving a complete job | refused: terminal states have no outgoing transitions | ✅ |
| transitions | every state change logged (creation + 7 moves to complete) | 8 rows in job_state_transitions, expected 8 | ✅ |
| transitions | rewriting transition history is refused | refused: append-only | ✅ |
| hard kill | killed in queued (dormant) is left alone | still queued | ✅ |
| hard kill | killed in running (in-flight) | swept to retrying, expected retrying | ✅ |
| hard kill | killed in waiting_external (dormant) is left alone | still waiting_external | ✅ |
| hard kill | killed in waiting_user (dormant) is left alone | still waiting_user | ✅ |
| hard kill | killed in output_created (in-flight) | swept to retrying, expected retrying | ✅ |
| hard kill | killed in quality_review (in-flight) | swept to retrying, expected retrying | ✅ |
| hard kill | killed in committing (in-flight) | swept to retrying, expected retrying | ✅ |
| hard kill | killed in committed (in-flight) | swept to notifying, expected notifying | ✅ |
| hard kill | killed in notifying (in-flight) | swept to retrying, expected retrying | ✅ |
| hard kill | killed in complete (terminal) is left alone | still complete | ✅ |
| hard kill | killed in retrying (dormant) is left alone | still retrying | ✅ |
| hard kill | killed in paused (dormant) is left alone | still paused | ✅ |
| hard kill | killed in cancelled (terminal) is left alone | still cancelled | ✅ |
| hard kill | killed in failed (terminal) is left alone | still failed | ✅ |
| hard kill | recovered jobs re-enter the queue rather than jumping to running | 7 moved retrying -> queued | ✅ |
| capacity | starting from an empty in-flight set | 0 in flight | ✅ |
| capacity | five dequeue attempts across five separate transactions, limit 3 | 3 jobs handed out | ✅ |
| capacity | the limit therefore holds across a restart — it is read from the database, not held in memory | 3 of 5 requests served | ✅ |
| capacity | dequeue respects priority order | 1,2,3 | ✅ |
| capacity | freeing one slot admits exactly one more job | one handed out | ✅ |
| breaker | an unknown provider is available (no failures recorded) | available=true | ✅ |
| breaker | four failures against a threshold of five leaves it closed | state=closed | ✅ |
| breaker | the fifth failure opens the breaker | state=open | ✅ |
| breaker | an open breaker refuses further calls | available=false | ✅ |
| breaker | after cooldown, exactly one probe is admitted (half_open) | available=true state=half_open | ✅ |
| breaker | a second caller is refused while the probe is in flight | available=false | ✅ |
| breaker | a failed probe re-opens immediately and backs off | state=open cooldown=120s | ✅ |
| breaker | a successful probe closes the breaker and resets the backoff | state=closed failures=0 cooldown=60s | ✅ |

34/34 checks passed

States exercised: 14 (6 in-flight, 5 dormant, 3 terminal)

## Two things worth naming

**`committed` recovers to `notifying`, not `retrying`.** This is §18's "crash
after commit but before notification" and it is the case the nine-state
paraphrase could not express at all (ADR-0008). The work is already durable, so
retrying would redo committed work, and treating it as finished would mean
Grant is never told. Both are wrong. Distinct `committed` and `notifying`
states make the crash point a matter of record instead of a guess.

**Capacity needs more than `SKIP LOCKED`.** `SKIP LOCKED` guarantees two
workers never take the *same* job. It says nothing about two workers each
reading "2 running, limit 3" and each taking a *different* job — which yields 4
running, and a limit that holds only under light load, i.e. exactly when it does
not matter. The capacity decision is therefore serialised with a
transaction-scoped advisory lock. The five dequeue attempts above are five
separate HTTPS requests, so five separate transactions on five separate
connections — the same conditions as five worker processes, and the same
conditions as a worker restart. Three were served.

## A test that failed on its own arithmetic

The first run reported 32/33. The failing check expected 7 rows in
`job_state_transitions` for a job driven to `complete`; there were 8. The
trigger was correct and the path to `complete` is seven moves plus creation —
I had written "six moves" in the label and hard-coded 7.

The assertion now derives the expected count from the path itself rather than
restating it, because a magic number in an assertion is a second thing to keep
correct and it will be the one that rots.

A second, more interesting failure: the harness's own cleanup used
`notifying -> cancelled` and the engine refused it. That transition is absent
on purpose — committed work is never cancelled, only compensated (§6). The
cleanup now drains via `failed`, which is reachable from every non-terminal
state. **The engine rejecting its own test harness is the allow-list working.**
