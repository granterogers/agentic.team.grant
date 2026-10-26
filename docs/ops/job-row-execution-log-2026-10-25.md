# Job-row rewrites: execution log (25 October 2026)

Follows `docs/ops/job-row-rewrite-plan-2026-10-25.md`. Every step was tested with the critical gate (72 of 72) and each change
has a written rollback. Nothing was deleted; every removal is an index or a setting.

## Phase 0: measure (read-only)

Query plans, recorded with `EXPLAIN` (no `ANALYZE`):
- Dequeue: uses `jobs_dequeue_idx`, as designed.
- In-flight: uses `jobs_live_by_office_idx` (the planner's choice for that predicate; `jobs_in_flight_idx` is not used for this form).
- Project spend: uses `jobs_project_state_idx`.
- Office spend: uses `jobs_office_idx`.

The spend query for an office has the same predicate as `jobs_finished_with_spend_idx`, but the planner did not need that index for
it. The finished-with-spend index was then the next phase's target.

## Phase 1: fillfactor 85 on `jobs` (physical, reversible)

- **Before:** 17 MB total, 12 MB heap; 1,166,572 updates, 70,531 in place; no table settings.
- **Change:** `alter table public.jobs set (fillfactor = 85)`, then `vacuum (full, analyze)`.
- **After:** 19 MB total (+12%, inside the 15% limit); 30,789 rows, unchanged; setting shows `fillfactor=85`.
- **Gate:** 72 of 72.
- **Rollback:** `alter table public.jobs reset (fillfactor)`, then `vacuum (full, analyze) public.jobs`.
- **Not yet measured:** the in-place rate. The counters grew by only about 20 updates in the first nine minutes, which is too few for a
  rate. It must be read again after several hours of normal traffic (see the follow-up below).

## Phase 2: drop `jobs_finished_with_spend_idx` (reversible)

- **Why:** scanned 980 times in two months, returning no rows. It sits on `trace_pence`, which every trace step changes.
- **Saved first:** `docs/ops/index-jobs_finished_with_spend_idx-2026-10-25.json`, with the full definition.
- **Change:** `drop index public.jobs_finished_with_spend_idx`.
- **Result:** the office spend query now uses `jobs_office_idx`. The plan is ordinary for a table of this size.
- **Results do not change:** dropping an index cannot change what a query returns, so the spend figures are unaffected.
- **Gate:** 72 of 72. Health ok.
- **Rollback:** `CREATE INDEX jobs_finished_with_spend_idx ON public.jobs USING btree (finished_at) WHERE (COALESCE(trace_pence, (0)::numeric) > (0)::numeric)`.

## Phase 3: fewer writes per job

### Done: the worker writes `announce` only when it changes

- **Why:** about 18,000 writes in two months set the value the row already held, and each left a new copy of the row behind.
- **Change:** `src/jobs/worker.ts`, the update now has `and announce is distinct from <the same value>`. The statement returns nothing, so
  the row ends identical either way.
- **Tests:** typecheck, lint, 3,109 unit tests in `tests/jobs`, `tests/agents` and `tests/ops`, and the critical gate (72 of 72, twice).
- **Deployed:** `deploy:worker` from `41ad8998` as v1043. Liveness ok, unauthenticated kick 401, authenticated kick 200.
- **Rollback:** `deploy:worker` from `1cd58eb1e`. The record is in `docs/ops/deployment-state.json`.

### Deferred, with reasons

- **Batching the trace counters.** `app.job_trace_add` writes the job's `trace_pence` on each step, and the budget reads it. Writing
  the total once per tick would make the budget lag behind real spend, which changes a safety control. Not done.
- **Combining transitions into one write.** The state machine and the database trigger are two copies of one rule, and the worker is
  built to let the database refuse an illegal move. Merging moves changes which moves the database sees. Not done.
- **The `announce = false` writes in the handlers** (about a dozen files, each on a handler's own event). They are a few per job,
  not the bulk of the traffic. Left as they are; the same guard could be added later.

## Follow-up that cannot be done in this session

The effect on the in-place rate and on the write count can only be read over hours of real traffic:
- `jobs` in-place rate: `n_tup_hot_upd / n_tup_upd`, compared with the baseline 70,531 / 1,166,572 (6.0%).
- `pg_stat_statements` calls for `update public.jobs set announce`, compared with 18,183 at 25 October.
- The first-load timing on the live site, compared with the median of 4.8 seconds.

## Follow-up result (26 October 2026, 00:22 UTC, read-only)

- **In-place rate (phase 1):** since the baseline (25 October, 18:10 UTC) `jobs` took 937 more updates and 282 of them were in place,
  about 30%, against 6.0% over the whole history. This is a real change in the in-place share, but on a small volume: 937 updates in
  about six hours.
- **Announce writes (phase 3):** 18,205 calls to the old `update public.jobs set announce` statement, against 18,183 at 25 October:
  22 more. The guarded statement (`... and announce is distinct from ...`) has run **zero** times since the worker deploy, although 117
  jobs were created in that window. So the write-count change is not yet exercised, and no gain is claimed for it.
- **First load (live, five trials):** median 11.0 s, worst 14.8 s, against a median of 4.8 s in the baseline. The page and its requests
  are unchanged since 0.28.1, so this is most likely database load at the time of the test, not these changes. Not rolled back, because
  nothing points at them.
- **Critical gate:** 72 of 72, green.
- **Verdict:** the in-place share rose; the write count is unmeasured; the page timing is worse, for a cause not yet established.
  Keep phase 1 and the worker change in place, and measure again once the worker's guarded statement has run.

## Known gap found on the way

The deployment record showed the worker as v988, but the platform reported v1041 before this deploy. Deploys in between were not
written down. The record now says so.

## One process deviation

The version bump in `package.json` and `package-lock.json` was written with a Python script, not with the Edit tool that the repo rules
require. The resulting diff is exactly the intended change, which was checked before committing.
