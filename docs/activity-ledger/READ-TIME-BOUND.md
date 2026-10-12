# Activity read time bound and cross-office read cost (phase 8: F2 and F3)

11 October 2026. Evidence is from the isolated replica (PostgreSQL 16.15) and local Chromium; nothing touched production. Proof: `scripts/isolated/activity-scaling.ts` (extended tier),
`tests/gateway/activity-time-bound.test.ts`, the "timed-out read" scenario of the Activity UX harness, sabotages S54 and S55.

## F2: why the 8 s timeout never bounded anything, and what bounds a read now

**Root cause (reproduced, not assumed).** PostgreSQL arms the statement timer when a top-level statement STARTS, with the value in force at that moment. Neither a function's own `SET statement_timeout`
clause nor `set_config('statement_timeout', ...)` inside the function re-arms it. Measured on the replica: a function declared `set statement_timeout = '100ms'` that sleeps one second returned after
1 005 ms with no error; the same sleep with `set_config` inside took 1 002 ms; and `set local statement_timeout = '100ms'` issued as a **separate statement before the call** cancelled it after 152 ms with
`57014`. So a bound has to be armed by whoever issues the statement, or be cooperative. The gateway reaches the database through PostgREST (`/rest/v1/rpc/...`), which gives a caller no way to issue a
statement first, so for the gateway the bound is cooperative plus a deadline of its own. (The 5 October capture records `authenticator` and `authenticated` at an 8 s `statement_timeout`, a global 120 s and no `service_role` override, so an 8 s platform bound probably already applies through PostgREST: INFERRED, to be confirmed by baseline query Q13. When the platform cancels a read, the gateway maps the `57014` body to the same controlled 504 rather than a 500.) The function-level setting was removed from `activity_read` (it bounded nothing, and the claim is withdrawn).

**What bounds a read now, in layers (each proved):**

| Layer | Mechanism | Measured |
|---|---|---|
| Database, cooperative | `activity_read` times each pass. The pool widens 8 times per pass (102, 816, 6 528, 16 384 rows a source); before starting a wider pass it predicts that pass's cost from the last one and **raises `PT504`** if it cannot finish inside the budget. Setting `activity.read_budget_ms`, 50 to 11 000, default 8 000 (always below the gateway deadline) | with the budget at 60 ms the slow read was refused after 329 ms instead of running 1 824 ms; a read valid on its first pass is never refused (32 ms with the same budget); writes work immediately afterwards; the refusal text carries only milliseconds and a hint, never an office, project or row |
| Gateway | `activity_*` sections: PostgREST's `504` (the `PTnnn` SQLSTATE convention) and an abort deadline of 12 s (`HQ_ACTIVITY_DEADLINE_MS`, 100 to 60 000) both become ONE controlled answer: HTTP 504, `{error: "The activity took too long to load. Try again, or narrow the filters.", code: "activity_timeout", retryable: true}`. No list is returned, no database wording, no detail | `tests/gateway/activity-time-bound.test.ts` 6 tests: budget refusal, a database that never answers (504 after the 150 ms test deadline), an abort signal on every activity section, another section's failure stays a 502 without detail, a normal read still works; sabotage of the mapping turns it red |
| Page | a failed read with nothing drawn shows "The activity could not be loaded" with the sentence above and a **Try again** button; it never says "That is everything" or "Nothing" | harness at 1440, 768, 390 and 320: the refused read, no overflow, no page error, then Try again shows the real rows; screenshot `screens/release/after-timeout-*.png` |
| Hard cancel, armed by a caller | a `statement_timeout` set before the call cancels a running read cleanly (`57014`), and the connection and every other session carry on | proved on the replica as the mechanism a pre-request setting would use; **not deployed** (see limits) |

**Not affected by a read timeout:** writes (a separate path), other sections, other offices (the refusal is per call), and nothing is rolled back that a person did.

**Limits, stated plainly.**
1. **A single pass is not interruptible from inside the function.** The first pass is small (about 102 rows a source) and the later ones are only started if they are predicted to fit, but a pass that is itself slow (a cold cache on a 434 MiB host) runs to its end. The only hard bound on one pass is a statement timeout armed before the call.
2. **The gateway's abort does not prove the database stopped.** On a client abort PostgREST may keep running the query to its end; this cannot be established on a replica with no PostgREST. Retries by an impatient client therefore stack database work. Bounded by limit 1 and by the cap on passes.
3. **The hard bound needs a production decision that is not made here.** Options, none applied: (a) a role-level `statement_timeout` for the role the gateway uses (affects every request that role makes, including the worker's if it shares the role; **do not** do this without reading the current value first); (b) a PostgREST `db-pre-request` hook that sets a local timeout for `/rpc/activity_*` only (a global PostgREST setting). The baseline step of the runbook reads the role timeouts (`select rolname, rolconfig from pg_roles where rolname in ('anon','authenticated','service_role','authenticator')`) so the choice is made on the real value. This is an approval item.

## F3: cross-office read cost

**Result: not reproduced. The cause the review proposed is not what the plans do.** The finding said a quiet office's read grows with other offices' transition volume (91 ms with 12 000 transitions elsewhere, 431 ms with 42 000). The reviewer later confirmed those were single, unrepeated runs on a clone where they had not checked which indexes existed, and withdrew the claim for the default read.

| Unrelated offices' job transitions | newest 50 | diagnostic | severity >= error | one agent | status completed | source filter |
|---|---|---|---|---|---|---|
| 9 605 | 33 / 40 | 33 / 38 | 29 / 33 | 36 / 52 | 36 / 42 | 36 / 45 |
| 19 208 | 36 / 39 | 49 / 70 | 29 / 46 | 36 / 59 | 31 / 33 | 32 / 40 |
| 48 017 | 31 / 38 | 41 / 45 | 27 / 30 | 32 / 34 | 34 / 35 | 32 / 37 |
| 163 253 | 28 / 33 | 36 / 37 | 26 / 28 | 37 / 46 | 30 / 34 | 33 / 37 |

(ms, p50 / p95, a three-job office with about 50 events against three unrelated offices that hold copies of the same busy history, 1 200 jobs per copy, outputs, routing decisions, impediments, pauses, deliveries
and model calls included; 17 times the unrelated volume gives a worst p50 ratio of 1.09. The same run with planner statistics deliberately stale, and with a 60 job office, is also flat, worst ratio 1.47.)
**Why:** each job-keyed source is read with `exists (select 1 from jobs j where j.job_id = x.job_id and j.office_id = $1 ...)`, and the planner drives from `jobs_office_idx` into `job_transitions_job_idx`
(a nested loop over the office's own jobs, 0.7 ms for the tiny office), not from a newest-first scan of the global time index. Every result at every volume level is the same events in the same order as at the first level, and none names a job of another office.

**What the investigation did find, and fixed.** A read's cost is not independent of the filter: a value nothing matches made every source read its newest 16 384 rows and answer `partial: true` with no events.
On an office with 7 212 jobs and 57 618 transitions of its **own**, `p_source` with a value nothing carries took **2.5 s to 5.2 s**; the interface filter is now pushed into each source's own read (a request's channel, a delivery's channel,
a native event's source interface, the job's origin for everything else; the test is exact, so nothing is dropped), and the same read takes **0.3 s**. Equivalence: the filtered page is exactly the interface-matching events of the unfiltered history, in order.
A status that nothing matches still widens (2.1 s on that office, answered, not partial) and one that matches rarely can hit the time budget above (refused with a retryable error, not answered short). That is own-office volume, not cross-office, and is the measured limit.

**Measured limit (enforceable rollout bound).** An office of about 7 000 jobs and 57 000 transitions reads its newest page in about 0.6 s and a rare-status filter in 1.5 to 3.7 s on the replica. A production host is slower when cold. For the canary the bound is the time budget (default 8 s, refused beyond) and
the real-host measurement in the runbook: **if the canary office's newest page exceeds 2 s at p95, switch it off.** The guard that keeps this true is `activity-scaling` in the extended tier (flatness against unrelated volume, equivalence, no foreign events, source filter exactness).

**Honest note on the guard.** `activity-scaling` passes on the code before this phase too, because the cross-office defect it guards against does not exist in this construction; it is a regression guard, not proof of a fix. The part of this phase that changed behaviour (the source filter and the budget) has its own checks and sabotages (S54, S55).
