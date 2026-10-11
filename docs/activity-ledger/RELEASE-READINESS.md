# Unified Activity Ledger - release readiness, hardening and independent verification

Branch `feature/unified-activity-ledger`, 11 October 2026. Phase 2 of the ledger work: no new feature, but an independent review, the migration and index safety, audit durability,
query performance, native instrumentation, Team HQ and Hermes compatibility, and a regression, sabotage and release-readiness pass. **Nothing here touched `main` or production**
(section 16). Every number was produced in this session and is on the isolated replica unless it says otherwise; where only replica evidence exists this document says so and does not call it production verification.

## The three conclusions

| Question | Verdict | In one line |
|---|---|---|
| **MERGE READINESS** | **READY** | Additive, default off, one function body replaced (1062). A trial merge of `origin/main` (80 commits ahead) conflicts in one documentation file only; on the merged tree 6 924 unit tests, 68 critical proofs, nine ledger proofs and every static check pass. Three mechanical notes below |
| **DEPLOYMENT READINESS** | **CONDITIONAL** | Safe to apply with the switch off, once the index build is run as its own step and the seven catalogue checks are run against production by a person who has authorised that. Production table sizes and the Management API's handling of `CREATE INDEX CONCURRENTLY` are unmeasured |
| **ACTIVATION READINESS** | **CONDITIONAL** | Correct and bounded on the replica; not yet shown on the real host. Needs the indexes valid, real-host latency, the catalogue checks on production, and a rendered look at the Activity page with ledger rows. The switch is deployment-wide, not per office |

What would change a verdict is in section 13.

---

## 1. Independent architectural and security review

A reviewer (a separate model agent, given the migrations, the gateway sections and the page hook, not my reasoning) cloned the replica, switched the ledger on **in the clone only**, seeded two offices
and reproduced each finding with SQL before reporting it. It is independent of my reasoning, not of model class: **a human review of the SQL has not happened and is recommended before the switch.**

Areas it checked and found sound: office isolation (a second office read as `operator` saw none of the first office's data by any filter), keyset paging (limits 1, 2, 3, 7 and 50 over 55 events including 40 at one
instant, identical to the full list), the writers' refusals, privileges on every function, and the gateway's parameter validation. It did **not** run the existing proofs (it said so); I ran them (section 12).

| # | Finding (reproduced by the reviewer) | Disposition | Where it is held |
|---|---|---|---|
| H1 | A blocker answered "Cancel the job" or "Ignore these" was reported as "You said yes" (several writers name no decline) | **Fixed.** No yes or no is inferred: `granted` only for a question that is positively an approval and an answer that is not the named decline; `denied` only for the named decline; otherwise the new `approval.answered` with the option as text; "closed" for a question nobody answered | `activity-ledger-review`, sabotage S18 |
| H2 | A delivery a person marked "it arrived" was shown as provider-confirmed | **Fixed.** `completed`, `provider_confirmed: false`, "marked as delivered by you" | S22 |
| H3 | Selective filters silently missed events on a busy office; `activity_chain` said `complete: true` over a lifecycle missing its first events | **Fixed.** Filters pushed into each source (section 7); a job filter includes every descendant; the chain reports `partial` and is bounded exactly | `activity-ledger-review`, `activity-ledger-equivalence`, S20, S21 |
| H4 | The Team HQ rows carried a display name where the page looks a face up by slug, so every agent row rendered as the first crew member | **Fixed.** `who` is the raw slug as `hq_studio_lately` sends it; `who_name` is the display name | `activity-ledger-review` |
| M1 | External door: evidence not cleaned or capped; `kind` forgeable into a link to an approval; correlation unvalidated; no volume cap; a worker could assert `external.review_decided` | **Fixed.** Cleaned, 1 KB, always `kind: external`; correlation taken from the job; 300 an hour per worker and 1 000 per office (a retry is never refused); `review_decided` is no longer worker-writable | S19, S24 |
| M2 | `activity_redact` is quadratic: a cheap CPU hold at the door (6.1 s at 80 000 characters) | **Fixed.** First 4 000 characters only; 15 ms | S23 |
| M3 | A stale `state_reason` shown against later transitions | **Fixed.** Shown only for a state a reason explains, and only to a diagnostic reader | `activity-ledger-review` |
| M4 | Invented actors: an approval's child shown as "handed to a specialist"; a person's stop shown as the agent's | **Fixed.** Only a child is delegated; a person's stop is theirs; worker bookkeeping is the office's | `activity-ledger-review` |
| M5 | A job-less row in a fixture project was shown (a regression against the page it replaces) | **Fixed.** | S25 |
| M6 | A native event makes a project permanently undeletable (composite foreign key on an append-only table) | **Documented, accepted.** Same class as a project that has gathered a job; refused gracefully; no product path writes a native event to a project without a job | `SECURITY.md` |
| M7 | Native `tool.requested` collides with the action ledger's own type of that name and was hidden at user level | **Fixed.** Renamed `tool.call_requested`, `_completed`, `_failed` | `activity-ledger-review` |
| L1 | Events in one transaction share a timestamp and are ordered by id | **Documented.** Deterministic, not causal; causality is `causation_id` | `EVENT-CONTRACT.md` |
| L2 | `delivery.failed` / `suppressed` are dated `updated_at`, which a later update moves | **Documented.** The only column that records when; a consumer needing the first time reads the delivery | `EVENT-CONTRACT.md` |
| L3 | A job filter included descendants only from the tree root | **Fixed** (every depth) | S21 |
| L4 | The chain's "500 row" bound could return 600 and dropped the originating request | **Fixed** (exact bound); when cut it drops the **oldest** events and says `truncated: oldest` | `activity-ledger-review` |
| L5 | A causation link can name a diagnostic event the caller cannot see | **Documented** | `SECURITY.md` |
| L6 | `p_visibility => null` escalated to the widest level | **Fixed** (refused) | `activity-ledger-review` |
| L7 | Future-dated native events; the reported visibility was the type's, not the row's; token-count keys blanked; redactor misses (URL userinfo, `password=`, short Stripe keys, `Token:x`, zero-width-space splits) | Future dates, reported visibility and token counts **fixed**; the redactor shapes are **not fixed**: they match the TypeScript twin, so changing them changes the office-wide redactor, which was out of scope. Listed as a residual risk | `SECURITY.md` |
| L8 | Failure reasons (handler or provider text) in user-visible metadata | **Fixed** (diagnostic only) | `activity-ledger-review` |
| L9 | Eleven non-concurrent index builds | **Fixed** (section 5) | `activity-indexes` |

Defects found by my own checks, not by the reviewer, in this phase: running the sabotage runner showed that the pushdown had made an existing paging check vacuous (S9: removing the validity check left
the proof green), repaired by using a filter that cannot be pushed; `check:pressable`, never run on this branch before, named three gateway sections nothing presses (baselined with reasons); the ADR number
collided with main's new 0071 and 0072 (renumbered 0073); and my own `office_actor($1)` call and two test strings tripped `check:office-callers`.

## 2. Defects fixed

Section 1 is the list; each fix has a check that fails on the code before it. `scripts/isolated/activity-ledger-review.ts` (35 checks) was run against the pre-fix migrations and went red on 15 of 20 of
the checks that existed then; it is shown red individually by sabotages S17-S25 (section 9).

## 3. Remaining risks

1. **Production table sizes are unmeasured**, so the index build time there is unknown (section 5).
2. **Real-host latency is unmeasured.** Replica figures are a laptop; the production host has about 434 MiB of memory where cold reads cost ten to a hundred times the warm ones. A 500-event chain took about 0.9 s on the replica at 24 000 transitions.
3. **The Activity page with ledger rows has not been looked at.** Unit tests run the hook's real source through every state; nobody has rendered the page with ledger rows (it needs a signed-in office with the switch on). While on, the list is unfolded (no "x3") and the counters above it come from `hq_studio_lately`.
4. **The switch is deployment-wide** (one `system_config` key): it cannot be turned on for one office first.
5. **Tool-call events cover the plan executor only.** A handler that uses a capability outside a plan step is visible through its outputs and the action ledger, not as a `tool.call_*`.
6. **Rate limits of Slack, Notion, GitHub and Telegram are recorded nowhere** (each client handles its own). Model-provider throttles are visible through `inference_usage` and `job_pauses`.
7. **The redactor does not know five shapes** (section 1, L7).
8. **A project that received a native event cannot be deleted.**
9. **`e2e-tasks` was red in one of sixteen runs** (a foreign-key error in `my_task_delete`, at the 29th assertion): it passed alone twelve times, in two further full critical runs, and on a replica built from `main`. The proof script is byte-identical to main's and no migration of mine touches `tasks`. **The cause is not established** and it is not attributable to the ledger; the failing log is `.out/gate/cab643/e2e-tasks.log`.
10. **No four-replica mixed-version matrix** (old worker on new schema is true by construction; new worker on old schema is proved by the missing-writer cases).
11. **No retention job** (nothing is deleted); `activity_write_failures` is not pruned.
12. **Whether the Management API accepts `CREATE INDEX CONCURRENTLY` is unverified** (section 5).

## 4. Production-catalogue checks

Seven checks read a database catalogue and refuse to contact production without `ALLOW_PRODUCTION_CHECKS=1`, which was not given and was not set. Each now has `--replica` (`scripts/lib/catalogue-db.ts`): the same
catalogue read from the local replica built from this repository's migrations (refused without the replica marker table; it prints that it is not production verification); the production mode is unchanged and still
gated (`tests/safety`, 69 tests, pass). The replica is faithful to production's schema by the measurement in `scripts/isolated/replica.sh` (25 September: 2 589 objects identical) but it is **not production**.

| Check | What it reads | Replica result | Class |
|---|---|---|---|
| `check:callers` | function bodies in `pg_proc`, repository source | **pass** (exit 0) | executed on an equivalent local replica; run again on production after applying (deployment prerequisite, not merge-blocking) |
| `check:consumed` | table, function and view definitions, repository source | **pass** | same |
| `check:gateway-wrappers` | `public` functions against the gateway's `fn:` names | **pass** | same |
| `check:anon-exposure` | function, table and view privileges for `anon` / `authenticated` | **pass** | same, **and the one most worth running on production**: the replica's roles come from `platform.sql`, an approximation of Supabase's |
| `check:machine-key` | defaulted-person parameters of every `SERVICE_MAY` action | **pass** | same |
| `check:office-callers` | function bodies, repository source | **277 findings, byte-identical to `origin/main`'s 277**; none in this branch's files after two test strings were reworded | pre-existing on main; **not merge-blocking, not deployment-blocking** |
| `check:carrier-writers` | function bodies against the carrier tables | **2 findings** (`app.document_preview_record`, `app.document_index_outcome`, from main's migrations 0990 and 1020); **identical on a replica built from `origin/main`** | pre-existing on main; not blocking |

Also not run because they read production and are unrelated to this change: `check:icons`, `check:capabilities`. `verify:wired` fails identically on `origin/main` (its locator expects an invented project the Sample work removed), so it says nothing here.
**Still needing production:** all seven, once, after the migrations are applied and before activation, by a person who authorises read-only contact.

## 5. Migration and index safety

- Eleven access paths were non-concurrent `CREATE INDEX` in migration 1061. **Measured** (replica, 2 000 000 rows, 523 MB, one writer inserting every 20 ms): a plain build took 2.1 s and the writer's slowest insert was **2 061 ms**; a concurrent build took 1.8 s and the slowest insert was **88 ms**. The stall equals the build, which grows with the table, on a host with cold reads ten to a hundred times slower.
- The runner applies a file as one batch, in which `CONCURRENTLY` cannot run, so the indexes are **out of the migration** and built by `npm run activity:indexes` (`src/activity/indexes.ts`): one statement each, idempotent, resumable (an invalid leftover of an interrupted build is dropped and rebuilt, a valid index never), `--status` and `--print` modes, production-writes gated. `app.activity_ledger_health.indexes_missing` reports the gaps; activation requires it empty. The read model is correct without them and only slower.
- Proved by `activity-indexes` (11 checks): builds all eleven valid while a second connection keeps inserting (none refused, slowest insert 54 ms against a 1 542 ms build), **a control shows a plain build of the same index stalls the same writer (810 ms)**, a second run changes nothing, an invalid leftover is rebuilt, and the SQL and TypeScript lists are equal.
- Lock behaviour: `CONCURRENTLY` takes no lock that blocks a write; `lock_timeout` (3 s) applies when the connection keeps one session (a direct connection). Rollback of an index: `drop index concurrently`.
- **Rollback of the migrations** without deleting audit history: switch off; leave the tables; 1062 reverts by `create or replace` of the function without the `perform` (its header says so). Section "Rollback" of `MIGRATION-PLAN.md`.
- **Unknowns, stated:** production's table sizes; whether the Management API accepts `CREATE INDEX CONCURRENTLY` (the script says to use `SUPABASE_DB_URL` or `--print` and the SQL editor if it answers 25001).

## 6. Audit durability

`public.activity_event_types.durability` classes every type: `derived` (projected: the owning table is the record, nothing to lose), `critical` (`activity.corrected`: strict writer in the transaction of the change; the best-effort writer **refuses** it and counts the refusal),
`operational` (`system.recovered`, `budget.threshold_reached`, `external.*`: best effort or the door; failure counted, never raised), `diagnostic` (`tool.call_*`). `activity-ledger-durability` (11 checks) breaks the paths on purpose: with the ledger table renamed away
inside a rolled-back transaction the best-effort writer returns null, does not raise, leaves the caller's work and counts the failure; with its failure counter gone too it still does not raise and writes no event about itself (no loop: there is no event type about the ledger failing);
a failed strict record fails the change in its own transaction and a rolled-back change takes its record with it; the counter stops at 200 an hour. A sabotage that let the counter failure raise turns it red.

## 7. Query performance (before / after, replica, p50 ms)

| Read | 3 000 jobs before | 3 000 jobs after | change |
|---|---|---|---|
| one agent | 465 | **108** | 4.3x faster |
| severity >= error | 1 468 | **92** | 16x faster |
| newest 50, ordinary | 100 | 108 | unchanged |
| one project, diagnostic | 183 | 201 | unchanged within run-to-run spread |
| page three by cursor | 177 | 272 | within a measured 177-272 spread over four runs |
| one root job's chain (500 events, three pages) | 929 | 911 | unchanged |

Method and the 300-job column: `ARCHITECTURE.md` section 5. Selective filters (job, correlation, project, severity, category, type, agent) are pushed into each source's own query, every predicate wider than the outer filter. **What is proved is the result, not the plan:**
`activity-ledger-equivalence` compares 45 filters, alone and combined, by id and in order with the same filter applied to the whole history, over data holding every job, delivery and approval ending (red when one pushdown predicate is made too narrow, 7 of 45 filters differ). Exact results, deterministic order, never silently truncated;
a filter the read model cannot push (status, source) widens the pool and says `partial: true` past 16 384 rows per source. No materialised second source was needed. **Worst case not removed:** a rare unpushable filter on a very large office still reads wide pools (the pre-existing behaviour, bounded).

## 8. Native instrumentation coverage

| Type | State |
|---|---|
| `tool.call_requested`, `_completed`, `_failed` | **Written** by the plan executor around the one executor call, only after the autonomy policy said `proceed` (it observes, decides nothing; refusal and questions are already `blockers` / `job_impediments`). Capability, step id, specialist, duration, outcome; an error's **class** only; never an input, an output or a message. 8 unit tests (including that the call sits in the one block, ordered, and after the policy) and `activity-native-writers` |
| `budget.threshold_reached` | **Written** by migration 1062 inside `app.defer_over_budget()`, once per office, agent and day. Behaviour unchanged with the switch off (proved) |
| `integration.rate_limited` | **Projected** from `job_pauses` (reason `rate_limited`), not written: the office already records the throttle it waited out. Other services' rate limits: not recorded (risk 6) |
| `activity.corrected` | Strict writer, no automatic caller **on purpose**: a correction is an operator act, not something the product detects |
| `external.review_decided` | Not worker-writable; the office records it when a person reviews |
| `system.recovered` | Written (phase 1) |

## 9. Security and sabotage results

`scripts/isolated/activity-ledger-sabotage.sh`: **26 of 26 sabotages caught**, each by the check named for it, the unmodified control green (76/76 and 17/17) at the end of each batch. Nine are new this phase
(critical-type refusal, approval classification, the door's correlation and quota, a narrowed pushdown, the descendant filter, person-confirmed delivery, the redactor bound, fixture-project filter). One first missed (S9) because
an optimisation had made its check vacuous; the check was repaired and S9 is caught. One sabotage anchor needed updating after a change (S3) and one check substring was wrong (S21) and was corrected, not the sabotage. Also by hand: removing 1062's `perform` turns two checks red.
No secrets were stored or printed (`check:secrets` clean, 3 207 files). No approval requirement was changed. A shell `stash` was run once by mistake and immediately restored (nothing lost); see "Process slips" in `PROGRESS.md`.

## 10. Team HQ compatibility

The hook (`needLately`) starts the ledger read alongside the existing one and draws from the existing answer first (a hanging ledger cannot delay the first render), validates rows through `ledgerRows` (unique string id, parseable instant; never throws), replaces only the list, and
only when the page still holds the copy it drew. `tests/web/activity-ledger-wiring.test.ts` (23 tests) runs the extracted source through: flag off, flag on, empty, unavailable, invalid shapes, partial history, duplicate ids, multi-project rows, the existing read failing,
a ledger that never answers (first draw is not delayed), an answer after a refresh (does not overwrite), and one ask only; plus five wiring properties each with a mutant that must fail. Cross-office and fallback are server-side and proved by the gateway proof. **Not done:** a rendered look (risk 3).

## 11. Hermes readiness

Contract-only, as instructed: no Hermes code, no interference with its branch. There is **no write capability over HTTP**: no public wrapper exists for any writer, no HTTP role can execute one or use schema `app`, the gateway names none, and the contract still says the door is not exposed (`activity-ledger-review` and `tests/gateway/activity-no-write-door.test.ts`, with a control).
The one door (`app.record_external_activity`) is now bounded (section 1, M1) and a worker cannot assert a human decision. Exposing it still needs the authenticated, scoped, per-worker boundary the contract lists; that is Hermes-branch work and a deployment decision.

## 12. Complete test results (this session, final code)

| Run | Result |
|---|---|
| `npm test` (branch) | 438 files, **6 822 passed**, 21 skipped (pre-existing), 0 failed |
| `npm test` on the **trial-merged tree** | 445 files, **6 924 passed**, 0 failed |
| `npm run verify:critical` (branch, and merged tree) | **68 proofs green, 0 red, 3 682 assertions** (also 72/72 green twice before two proofs moved tier; one red `e2e-tasks` in a third run, risk 9) |
| Ledger proofs, extended tier (branch and merged tree) | 9 proofs, **219 assertions**: `activity-ledger` 76, `activity-gateway` 17, `activity-ledger-review` 35, `activity-ledger-equivalence` 8, `activity-indexes` 11, `activity-ledger-durability` 11, `activity-native-writers` 14, `activity-worker` 10, `activity-redaction` 37 |
| Sabotage | 26 of 26 caught |
| Perf proof | 7 of 7 |
| Static, on the branch | `lint`, `typecheck`, `check:migrations`, `check:secrets`, `check:templates`, `check:proofs`, `check:deployment-state`, `check:ownership --replica`, `check:office-edges --replica`, `check:pressable`, `check:suite-classes`, `check:suite-offices`, `smoke`: all exit 0 |
| `check:branding`, `check:tokens` on the **branch** | exit 1, **and exit 0 on `origin/main` and on the merged tree**: base drift. The one `check:branding` finding is `web/studio/app.js:14331` (`surface: 'basecamp'`, from main's earlier commit `ffd09d7`, not this work; main has since fixed it). No dashboard branding was modified to make this branch green |
| Production-catalogue checks (replica mode) | section 4 |

The critical tier is at its cap of 70 on `main` (`tests/gate/registry.test.ts`), so the ledger's proofs, including the two that were critical in phase 1, run in the extended tier. Moving one back is a decision about the cap.

## 13. Blockers, and what would change each verdict

- **No merge blocker.** Merge notes: (a) `docs/adr/README.md` conflicts (main took ADR 0071 and 0072; this ADR is 0073): keep all three lines in order; (b) the critical-tier cap above; (c) a human should read migration 1061 and the 1062 splice.
- **Deployment conditions:** the prerequisites in section 14. A measured table size that makes the build slow does not block (it is concurrent) but may want a quiet window.
- **Activation conditions:** `indexes_missing` empty; the seven checks pass on production; real-host p95 of `activity_feed` (user) and `activity_chain` acceptable to Grant; the Activity page looked at with ledger rows. **Would turn ACTIVATION to BLOCKED:** a failing `check:anon-exposure` on production, or a real-host read that cannot meet a bound Grant sets.
- **Would turn MERGE to CONDITIONAL:** a human reviewer's finding in 1061 or 1062 that the proofs do not cover.

## 14. Exact deployment prerequisites

All need Grant's explicit authorisation, one operation at a time; **none of this was done**.

1. Re-read `app.schema_migrations` and `git ls-remote`: 1054-1059 must still be free and 1060-1062 absent. Commit and push (done for this branch; provenance requires a pushed commit).
2. Read-only: measure row counts and sizes of `inbound_commands`, `deliveries`, `blockers`, `inference_usage`, `events`, `job_state_transitions`, `outputs`, `job_impediments` (decides whether the index step wants a quiet window).
3. Apply `1060`, `1061`, `1062` with the switch off, one at a time (`npm run migrate:one -- <file>`, never `migrate` from this branch). Check `deployment-state.json` and update it in the same commit as the record.
4. `npm run activity:indexes -- --status`, then `npm run activity:indexes` with a direct connection (`SUPABASE_DB_URL`); if only the Management API is available, try one statement from `--print` first. Expect `indexes_missing: []`.
5. Run the seven catalogue checks against production (read-only), without `--replica`.
6. Deploy the worker, then `hq-api`, then the page, in that order (`MIGRATION-PLAN.md`). Verify with the switch off: the sections answer `enabled: false`, the Activity page is unchanged.
7. Optional but recommended: the four-replica mixed-version matrix (`docs/audit/V1-FINAL-RELEASE-GATE-2026-10-08.md`).

**Activation checklist:** steps 1-6 complete; `activity_health`: `write_failures_1h` 0, `indexes_missing` empty, `critical_via_best_effort_24h` 0; read `activity_feed` for a real project and compare three events to their source rows by `evidence`; time `activity_feed` (user) and `activity_chain` on the real host; render the Activity page with ledger rows (Level 1A, both devices); then `update system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`. Roll back with the same statement set to `false`.

## 15. Final hashes

Migrations (sha256 of the files as committed): `1060` `77bb20fd7583c0c3ab7fdcb759010dccd76560153d887b5461709137eb31e114`, `1061` `8db36dcc7009ffd1a1cf0629498fd710fa56d1e92cf57336bf477ba23ddfecfa`, `1062` `843c43cf20059fce2bae0f203bba735ccaa0fdeb28ebf13b3e94de7c6569fbae`.
Code and migrations as of commit `4c919910fcfb525fed964efcd8fa5ae815496b82`; the final commit (this document, `PROGRESS.md` and a one-line fix to the perf seed script) follows it, and `git log origin/main..HEAD` is the complete list. Based on `origin/main` `3caaebf`; `origin/main` is `5fa1fbdc0643a5dac129de8f7cfcb87655c77435` at the time of writing.

## 16. Main and production are untouched

No migration was applied to any database but local replica clones; no deploy command was run; `ALLOW_PRODUCTION_CHECKS` and `ALLOW_PRODUCTION_WRITES` were never set (the environment held neither); no service key, Management API token or Supabase URL was used. `main` was never merged into this branch,
never rebased onto and never pushed to: the trial merges were in throwaway worktrees and were not committed. The only remote ref written is `feature/unified-activity-ledger`. The replica was rebuilt several times, including once from `origin/main`, to establish what is red there; those are local databases.
