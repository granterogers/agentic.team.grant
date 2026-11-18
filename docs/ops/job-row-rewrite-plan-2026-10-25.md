# Job-row rewrites: measurements and plan (25 October 2026)

Status: **plan only.** Nothing in this document has been changed in production or in the worker. Each phase needs its own
approval, and each phase has a rollback that is written down before it runs.

## What was measured (read-only, production)

Statistics for `pg_stat_user_tables` and `pg_stat_user_indexes` have been counting since 25 August 2026.

| Table | Updates | In-place (HOT) updates | Share in place |
|---|---|---|---|
| `jobs` | 1,166,562 | 70,529 | 6.0% |
| `events` | 471,542 | 272 | 0.1% |
| `inference_usage` | 687,099 | 230 | 0.0% |
| `inbound_commands` | 118,894 | 141 | 0.1% |
| `deliveries` | 206,871 | 438 | 0.2% |

A rewrite that is not in place writes a new row, and writes a new entry into every index whose key or predicate it touches.
Almost every job update is not in place, because the state column is in the indexes.

**Statements that rewrite `jobs` (calls since the statistics began):**
- `update public.jobs set state = $1 where job_id = $2`: about 66,000 (from the worker's `moveTo`, `src/jobs/worker.ts` around line 480)
- `update public.jobs set state = $1::public.job_state where job_id ...`: about 52,000 (the same path)
- `update public.jobs set announce = ...`: about 18,000 (`src/jobs/worker.ts` around line 1746, plus the handlers)
- `update public.jobs set state = ..., state_reason ..., finished_at ...`: about 12,900 and 10,500 (the transition with a reason)
- `update public.jobs set recipient_agent = ...`: about 5,300
- The trace counters (`trace_steps`, `trace_tokens`, `trace_pence`, `trace_ms`) are updated by `app.job_trace_add` on every trace step.

**Indexes on `jobs` and how often they are used (scans since 25 August):**

| Index | Covers | Scans |
|---|---|---|
| `jobs_pkey` | `job_id` | 233,287,881 |
| `jobs_id_office_key` | `job_id, office_id` | 8,704,223 |
| `jobs_project_state_idx` | `project_id, state` | 6,825,105 |
| `jobs_one_live_per_idempotency_key` (partial) | `office_id, idempotency_key` | 608,347 |
| `jobs_parent_idx` (partial) | `parent_job_id` | 180,454 |
| `jobs_in_flight_idx` (partial) | `state, leased_until` | 177,078 |
| `jobs_dequeue_idx` (partial) | `priority, created_at` where queued | 175,213 |
| `jobs_office_idx` | `office_id` | 166,262 |
| `jobs_correlation_idx` | `correlation_id` | 37,681 |
| `jobs_live_by_office_idx` (partial) | `office_id` | 28,390 |
| `jobs_finished_with_spend_idx` (partial) | `finished_at` where spend is present | **980, returning 0 rows** |

Every state change touches the state-bearing indexes. Every trace step changes `trace_pence`, which the finished-with-spend
index covers. That index has returned no rows in two months, so it costs writes and gives nothing back.

## Why this is not a quick fix

Each state move is a worker decision. The state machine (`src/jobs/states.ts`) and the database trigger are two copies of one rule,
and the worker is written to let the database refuse an illegal move. Changing the number of writes per job changes that contract.
So the plan does the safe physical changes first, and changes to the worker only after tests that cover the state machine.

## Phases

### Phase 0: measure, no change (no risk)
- Read `EXPLAIN` (no `ANALYZE`) for the four hot queries: dequeue, in-flight, project-state and live-by-office. Keep the plans in
  this folder. Rollback: nothing to roll back.
- Record the baseline counts and sizes (done in this document).
- **Acceptance:** plans recorded and reviewed.

### Phase 1: physical tuning (low risk, reversible)
- `alter table public.jobs set (fillfactor = 85)`, then `vacuum (full, analyze) public.jobs` in a quiet window.
- Effect: leaves room in each page, so updates that change only non-indexed columns (`announce`, `recipient_agent`, the trace counters
  that are not indexed) can be done in place. State changes will still be out of place. Expect a small rise in table size, not a fall.
- **Rollback:** `alter table public.jobs reset (fillfactor)` and `vacuum (full, analyze) public.jobs`. Data is never changed.
- **Tests:** the critical gate on a fresh replica (`scripts/gate/run.ts --tier critical`), 72 of 72 green twice in a row. After the
  change: the in-place rate for `jobs` (`n_tup_hot_upd / n_tup_upd`), the table size, and two first-load timings on the live site.
- **Acceptance:** in-place rate rises measurably, size does not grow more than about 15%, gate green, first load not slower.

### Phase 2: drop the unused finished-with-spend index (low risk, reversible)
- It has returned zero rows in 980 scans. Without it, the spend query falls back to a scan of about 30,000 rows, which is quick.
- Save its definition first (`pg_get_indexdef`), then drop it in a single statement.
- **Rollback:** recreate it from the saved definition. The statement is in the backup file, which is committed in this repository.
- **Tests:** gate green; `EXPLAIN` of the spend query before and after; a live check that the budget figures still add up.
- **Acceptance:** trace-step updates are in place more often, and the spend figures are unchanged.

### Phase 3: fewer writes per job (code change, needs approval and tests)
- Batch the trace counters: `app.job_trace_add` writes a trace row per step, but the job counters can be written once per tick.
- Combine transitions that always happen together in the worker, so one move writes once instead of twice.
- Stop writing `announce` when its value is unchanged.
- **Rollback:** `git revert` of the change, then `npm run deploy:worker` from the previous commit. No schema change is needed.
- **Tests:** the worker and state-machine suites, the critical gate, `tg-chief-addressing`, `worker-failure-paths` and `exactly-once` in
  particular, plus the replica proofs for approvals and stale claims. Each change is tested on its own before the next.
- **Acceptance:** the same results from the state-machine proofs, and fewer `jobs` writes in `pg_stat_statements` for the same workload.

## What would not be done without a separate decision
- Deleting fixture-flagged job rows. About 12,700 of them sit inside real projects, so deleting them would delete real work.
- A larger database tier. It is paid, and the framework is £0.

## Safety rules for every phase
1. Each phase is committed and pushed before it runs, so the exact change is in the history.
2. Nothing is deleted. Every removal is an index or a setting, and each one can be restored from a saved definition.
3. The critical gate must be green before and after each change.
4. Production writes run one at a time, with the write flag set only on that command, and the result is read back afterwards.
