# Efficiency run, 5 to 6 October 2026: what was changed, measured, rejected and left

> **Numbers superseded 6 October 2026 by `efficiency-reconciliation-2026-10-06.md`.** The measurements below were taken on a replica whose
> `jobs` heap was 14 MB; production's is about 94 MB. The reconciled re-measurement (production-sized heap, on the product base completed with
> the public Sample) is authoritative, and it did not reproduce the worker idle-pass saving (migration 1026, not carried). The method, the
> root cause and the rejections stand.

**NO PRODUCTION CHANGES WERE MADE.** Nothing here is applied, deployed or configured in production. Migrations 1023 to 1028 were
applied to the isolated local replica only. No production query was run in this run.

Branch `claude/efficiency-deep-optimization`, from `6e8032f` (integration). `claude/eloquent-cerf-rv2gum` is untouched.
Labels: **MEASURED** (observed on the seeded replica or in a local browser), **DERIVED** (arithmetic from measured values),
**INFERRED** (reasoned, not observed), **DISPROVEN**, **UNKNOWN**.

Replica = `scripts/isolated/replica.sh` seeded by `scripts/isolated/seed-production-scale.sql` to the 5 October production shape
(22.6k jobs, 168k transitions, 10k outputs; counts from `docs/ops/evidence/2026-10-05`). It says how much WORK a path is. It does
not say how a 434 MiB host behaves, and the seed's row widths (`pinned_config`) are UNKNOWN against production.

## 1. The one root cause behind most of it (MEASURED)

`app.harness_job(job_id)` (several index probes up the parent chain, costed as a function call) was evaluated for every job an
office has ever had, **before** the time window that keeps a few hundred. `app.now_utc()` has a `SET` clause so it cannot be
inlined and is costed the same, equal-cost quals keep written order, and a window written against a CTE column or the outer row is
a join qual that is not ordered ahead of a function. Fix in each reader: compute the window once as a plpgsql variable (a cheap
parameter), or fence the windowed rows (`MATERIALIZED` / `OFFSET 0`) and ask the harness question of those only.
`app.harness_job` itself was **not touched** (about 25 readers depend on it and its strict direction is the safe one).

## 2. Database readers (each: frozen-reference equivalence proof, sabotage controls, office-isolation proof)

| Migration | Reader (caller, frequency) | Before | After | Proof |
|---|---|---|---|---|
| 1023 | `office_health`, `last_progress` (the `thinking` poll, every 20 s per tab) | 915 ms, 394,209 hits, 41k `jobs` probes, 4 seq scans | 178 ms, ~31k hits (whole reading); `last_progress` 4 joins to 2 limit-1 lookups | `poll-readers-equivalence.ts` |
| 1024 | `studio_activity` (per project, in `hq_studio`: page load and every refresh) | 1.85 s for 5 projects | 0.30 s | `studio-activity-equivalence.ts` (every `app.job_via` branch) |
| 1025 | `studio_unseen` | 1,969,521 hits, 1478 ms | 70,956 hits, ~320 ms | `page-readers-equivalence.ts` |
| 1025 | `hq_studio_lately` | 681,997 hits, 422 ms | 22,386 hits, 24 ms | same |
| 1025 | `studio_team_work` | 733,276 hits, 450 ms | 128,790 hits, 78 ms | same |
| 1026 | `self_improvement_spent` (every worker pass) | idle pass: 6,006 hits, 1 seq scan of `jobs` | 2,633 hits, 0 seq scans | `self-improvement-equivalence.ts` |
| 1027 | `hq_pulse` (every 20 s per tab) | 24,937 hits, 4 seq scans, 53 ms | 13,741 hits, 2 seq scans, 31 ms | `pulse-equivalence.ts` (keeps the fixture asymmetry byte for byte) |
| 1028 | `thinking` section (every 20 s per tab) | 81,475 hits (after 1023), 1,058 statements | 56 hits, 7 statements | `thinking-equivalence.ts` |

Hits are shared-buffer hits per call (nested statements counted). All MEASURED on the replica. The generic-plan risk was tested:
twelve consecutive calls in one session stay at 213 to 286 ms, no slide to a worse plan (MEASURED, DISPROVES that concern).

`office-isolation-changed-readers.ts`: a null or unknown office is refused (`42501 no_office`); office A's answer is unchanged by a
burst of real and harness jobs written into office B; a copy of `studio_team_work` with its office predicate removed DOES move, so
the check can fail. 1028 adds: `anon` and `authenticated` cannot execute the new functions, `service_role` can the public one, and
reach is not wider than `office_health`'s.

Replaying the whole chain `0599` to `1028` on a fresh clone of the replica applies without error (MEASURED).

## 3. Team HQ requests (MEASURED, local Chromium against a fake gateway, `npm run verify:startup`)

| Scenario | Base `6e8032f` | Now |
|---|---|---|
| Established office, on load | 15 requests (`thinking` twice) | **8**, each section once |
| Same, over a visible minute | pulse x3, thinking x3 | unchanged (the documented poll) |
| Signed in, no office yet | 16 requests on load, 6 more a minute, ever | **2** (studio, one `whoami`), **0** more |
| A credential the office refuses | 8 reads, 6 more a minute | **1**, **0** more |
| Office created from the set-up screen | studio only; no reads, **no poll started** | everything starts, poll runs |
| Settings opened | 15 | 14, the 6 Settings/Usage reads arrive when Settings (or the project Sources tab) is first drawn |

Changes: `needSettings()` (Settings and Usage are read on first need; `refresh` re-reads them only once asked); a no-office and a
refused-credential stop in `live()`; `startOfficeReads()` is started by `refresh` when the office appears; one `thinking` read per
load (the poll's priming tick already runs it); a single-flight on the set-up screen's `whoami`. A TDZ trap (a `let` declared after a
deep link opens the sheet at module evaluation) was caught by the harness and the declaration moved to the top. The baseline gap in
row 5 (creating an office never started the poll) is a defect found by this work, not only a saving.
Gateway (`hq-api`): concurrent callers of the same credential now share one session resolution (`tests/gateway/session-resolution-single-flight.test.ts`
runs the shipped wrapper over a stand-in resolver and is sabotage-proved). **DERIVED**, not measured against a real isolate: a load's
eight parallel reads on a cold isolate made eight three-step resolutions (24 upstream calls) and now make one (3). Not deployed.
Not done: adaptive polling (the poll already stops while the tab is hidden; slowing it while idle is a product decision).

## 4. Worker and background

* An empty pass is now 71 statements, 2,633 hits, 0 `jobs` seq scans, 16 ms (was 6,006 hits, 1 seq scan, 23 ms) (MEASURED).
  The other 13 recurring paths (`requeue_retrying`, `settle_exhausted`, `resume_paused`, `resumable_now`, `recover_stalled`,
  `claim_pending`, `defer_over_budget`, `enqueue_orphans`, `dispatch_due`, `provision_channels`, `fire_pending_signals`) are each 4 to 12
  statements and 44 to 156 hits with no heap scan. **The Pass-1 claim that the retrying/paused sweeps scan `jobs` is DISPROVEN**:
  the partial live-key index serves them.
* `model_order`: 17 ms warm for the busiest kind, 64 ms cold across kinds, O(usage history): `model_record` aggregates ALL history and
  `model_order` filters the window afterwards. Windowing it changes which models are demoted (a product decision), so it is NOT changed
  here. Budgeted as a known cost (one seq scan).
* `supabase/functions/worker/index.ts`: a failed direct database connection is retried after 5 minutes (it was final for the instance's
  life, pinning every later pass to the Management API at 17 to 22 s). Source-level test, sabotage-proved.
* Regression budget: `npm run forensics:budget` (`scripts/forensics/resource-budget.json`, structural counts only). A too-tight budget and
  a budget naming a probe that did not run both fail (proved).

## 5. Write churn (MEASURED, `job-lifecycle-cost.ts`, now attributed per table)

One job's life: 1 insert, 10 updates, **0 HOT**, 8 `job_state_transitions` inserts, about 22 to 27 KB WAL, 10 `jobs` indexes. Production's
counters agree (1.08 M updates on 22.6k rows, 5.1% HOT). Seven of the ten updates are the state walk, which changes an indexed and
predicate column by definition; three are lease heartbeats, which change `leased_until` (a key of `jobs_in_flight_idx`). So the HOT
rate cannot be raised by a `fillfactor`. The one structural lever is moving the lease out of `jobs` into a narrow table, which changes
what recovery reads and is **not attempted** (it touches the recovery contract). Auditability is untouched by this run.

## 6. Index review

* `(office_id, created_at)` on `jobs`: **REJECTED**. Trial on the replica after the rewrites: no plan used it, no hit count moved
  (MEASURED). It would add an entry to every one of 10 non-HOT updates per job.
* No index removed. Quarantine candidates (replica scans are not production scans; production `pg_stat_user_indexes` is UNKNOWN to
  this run): `jobs_correlation_idx` (0 scans on the replica; code does read by correlation, so verify before anything),
  `jobs_parent_idx` (1 scan). `jobs_id_office_key` is a composite-FK target: keep.

## 7. Working set (MEASURED cold, `pg_buffercache` after a restart, distinct pages)

Idle worker pass about 10.5 MB distinct (2.9 MB of that is a near-empty control). A cold Team HQ load about 84 MB; the studio payload alone
68 MB, of which 45 MB is `jobs` TOAST (`pinned_config` read by `harness_job`; the seeded width is UNKNOWN against production, so the
magnitude does not transfer, the mechanism does). Against 224 MB `shared_buffers` a cold page load can occupy a third of the cache
(INFERRED for production). The remaining dominant cost is `harness_job` once per output inside `studio_activity` (9,055 calls, 173 of
360 ms in `hq_studio`).

## 8. Rejected (with the evidence)

* `(office_id, created_at)` index (above).
* A cutoff to bound the `answered` branch of `studio_activity`: result equal, but no gain on the seed (the cutoff is null there, so the
  bound never bites). Not shipped for a gain nobody measured.
* Removing the `thinking` section: the page needs it; it was made cheap instead.
* Realtime for the pulse: needs a second browser credential path and RLS reads the architecture forbids.

## 9. Production-test protections and Vercel (agent work, reviewed and merged; see their own documents)

`docs/testing/production-test-budgets.md` (request budget, canary gate, suite guard coverage; PROPOSAL; 354 test files passed in the
agent's run) and `docs/performance/vercel-deploy-efficiency.md` (excludeFiles, page fingerprint, retention planner; the live Vercel API
shapes are UNVERIFIED until a first real deploy, and the fingerprint fails open toward deploy). Their caveats stand: the defaults are
tight and will stop suites that make more than 100 to 250 requests until a stated-reason raise.

## 10. Database growth (DERIVED from preserved evidence, `docs/ops/evidence/2026-10-05`; no new production read)

Database size: 48 MB early Sep, 63 MB (17 Sep), 328 MB (2 Oct), 346 MB (4 Oct), **371.8 MB (5 Oct 07:37)**; public schema 330 MB.
Largest relations: `jobs` 108 MB, `job_state_transitions` 38.5, `events` 33.5, `inference_usage` 24.9, `document_chunks` 21, `deliveries`
19.3, `documents` 17.5, `job_traces` 10.4, `inbound_commands` 8.8, `projects` 8.0 (a six-row table: bloat). Growth 3 to 5 Oct was
about 17 to 26 MB a day. The documented free-plan ceiling is 500 MB (read-only above it). **At that rate the headroom (about 128 MB)
is about 5 to 8 days (DERIVED; whether the daily growth is product or harness residue is UNKNOWN without a classification query).**
This, not CPU, is the nearest hard limit. Lifecycle proposals (none applied): classify and archive harness-origin jobs, outputs,
traces and transitions (the readers already treat them as excluded); a retention horizon for `job_traces`/`events`; a one-off reclaim of
`jobs` and `projects` bloat (needs a maintenance window and Grant's approval). All need a decision; none is a deletion in this run.

## 11. Compute verdict

**NOT YET DETERMINABLE for CPU/memory.** The work reduced the recurring per-tab cost by a measured 50 to 99.9 % per reader and removed
the idle pass's heap scan, but the host's behaviour under the reduced load cannot be observed without production measurement, which this
run did not do. The storage ceiling (section 10) is the nearer constraint. Micro (1 GB, 11 MB/s) would address the memory and I/O
headroom; it is the same question as before and is Grant's decision. These changes make Nano more likely to be sufficient, not proven.

## 12. Rollout (for later approval; nothing is to be done now)

Order: (1) DB migrations 1023 to 1027 (CREATE OR REPLACE only; each alters one function and is independently revertible); (2) 1028, then
deploy `hq-api` (the gateway calls `cannot_think`); (3) deploy the Team HQ pages; (4) deploy the worker. Rollback: re-apply the frozen
definitions in `scripts/isolated/reference/*` (1023, 1024, 1025, 1027) or the 0216 definition quoted in 1026's header (migrations are
function-only, no data changed); roll the gateway back before dropping the 1028 function. Before each step run the read-only canary and watch `forensics:budget` numbers on a staging copy first.

## 13. Decisions for Grant

1. Whether to window `model_record` (changes which models are demoted).
2. Whether the lease should move out of `jobs` (recovery contract).
3. A classification query (read-only, production) to learn how much of the 17 to 26 MB a day is harness residue, and a retention policy.
4. Whether the production request-budget defaults are acceptable (they will stop heavy suites).
5. Whether to slow the poll while a tab is visible but idle.

## 14. Process disclosures

Three edits were made with `python3 -c`/heredoc-assisted scratch scripts or `sed` instead of Edit (a seed script replace, a proof-script
loop count, and one no-op `sed` aimed at `/dev/null`); `biome format --write` was used on own new files. No repository file other than
those was affected. The Stop hook asked repeatedly to commit the untracked `scripts/forensics/audit-reads.ts`; it was not committed,
moved or changed (not authorised).
