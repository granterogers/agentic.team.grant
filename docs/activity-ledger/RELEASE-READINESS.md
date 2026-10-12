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

**Phase 3 (11 October 2026) changed the evidence behind these verdicts, not the verdicts**; the section "Phase 3 addendum" at the end of this file is the current record and supersedes any figure above it that it restates
(proof counts, sabotage count 38, the redactor, the external door's caps). Merge: still **READY** (trial merge re-run at `5fa1fbdc`, 80 commits ahead, one documentation conflict, 6 933 unit tests, 68 critical proofs and eight ledger proofs green on the merged tree).
Deployment: still **CONDITIONAL**, now with the interruption rehearsals done and one fewer unknown. Activation: still **CONDITIONAL**.

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

---

## Phase 3 addendum - final security hardening, merge preparation, production readiness (11 October 2026)

Everything below was produced on the isolated replica; nothing contacted production, no production flag was set, `main` was not modified, and no human has reviewed any of it (the second review below is a model agent, not a person).

**1. Credential redaction (P0).** The ledger now has a strict redactor, `app.activity_redact` (SQL) with a byte-identical TypeScript twin `redactStrict`; the office-wide `redactSecrets` is unchanged. It is bounded (4 000 characters read), NFKC-normalised, strips invisible and bidi characters,
and removes vendor keys, URL credentials (`user:password@`), `password=` and `"token": "..."` assignments, `Token:value`, and a mixed long run, in linear time. Proof: `activity-redaction` 71/71 (a table of cases through both, a 400-string seeded fuzz, idempotence, neighbours that must survive:
token counts, durations, uuids, dates), `tests/text/secrets-strict.test.ts`, sabotage S26 to S30 and S23. Ordinary summaries cost about 66 microseconds (20 000 distinct inputs in 1.3 s); the 80 000-character case is cut first. **Limits, stated and pinned as tests:** a short secret in prose with no key name, a credential key in look-alike letters from another script, percent-encoded or base64-wrapped secrets and a secret split by ordinary punctuation are not caught. It does not claim universal detection. External metadata passes an allowlist (`app.activity_external_metadata`: counts, durations, model, cost status; everything else dropped and counted).
Source hygiene found on the way: the editing tool had turned `\u` escapes into raw invisible and bidi characters in three files; they are written as text (`\u{200B}` in TypeScript, `\x200B` in the SQL class) and checked by a byte scan.

**2. Independent SQL review (P1), a model agent, read-only, on a throwaway clone.** It found no cross-office read or write path and no SQL injection (details in `SECURITY.md`). Seven hardening findings were confirmed and are fixed with regression checks: the best-effort writer wrote a failure counter with the switch off; native `evidence_ref`, `actor`, `tool` and `model` were not cleaned; the strict writer let any holder forge a person's review decision or an external actor; external summaries could imitate the office's words;
five SECURITY DEFINER read functions put `public` before `pg_catalog` in `search_path` (proved hijackable by a role with CREATE on `public`); rotating worker names could add about 1 000 undeletable rows an hour per office; and a filter that matches nothing widened every pool (0.7 s measured). Not changed and documented: first-correction squatting, an unvalidated native `correlation_id` (no leak), `indexes_missing` visible to a signed-in office.

**3. External door (P2).** Quota count and insert were two steps: with the lock removed 304 of a 300 cap were accepted on 8 connections. A deployment-wide advisory lock now serialises counting and inserting; caps are 300 an hour per worker, 1 000 an hour and 4 000 a day per office, 5 000 an hour per deployment; keys are validated; a retry of an accepted report is never refused and never consumes quota; names and keys cannot be varied past the checks; the door returns null while off. The HTTP write boundary remains unexposed and nothing installs or calls Hermes. Proof `activity-external-attack` 47/47, sabotage S31 to S38.

**4. Human review provenance (P3).** `output.reviewed` is derived from `outputs.reviewer_status`, which four different things write; a null `reviewed_by` cannot tell a person from the system, so the event is attributed to the office with "(reviewer not recorded)" and is never attributed to a person. The Import and Decline controls take no verified identity, so no person-attributed writer was added; the contract (`EVENT-CONTRACT.md`) states the six review states and how a future verified path should record. Checks in `activity-ledger`, sabotage S33.

**5. Migration and index rehearsal (P4).** `MIGRATION-PLAN.md` was rewritten as four stages (schema, index preparation, application deployment, activation) with exact commands, expected results, failure handling and rollback. `bash scripts/isolated/activity-migration-rehearsal.sh` (17 checks): a 1061 with a failure at its end leaves none of its objects (a file is one request, one transaction); re-applying 1060 to 1062 loses no row and does not reset a switch somebody turned on; a concurrent index build cancelled while an old snapshot was held leaves an INVALID index, which the health reading names and the staged build drops and rebuilds without touching any valid index (catalogue identity unchanged); and a connection that wraps statements in a transaction is refused with the transaction-block error and reported as a failure. **Not established:** whether the Management API accepts `CREATE INDEX CONCURRENTLY` (not tried, by instruction); production table sizes.

**6. Performance (P5), 3 000 jobs, 24 003 transitions, replica:** newest page 106 ms (ref 108), severity 96 (ref 92), agent 108 (ref 108), diagnostic 192, one project 235, page 3 by cursor 208, one root job 913 ms, the existing `hq_studio_lately` baseline 757 ms. Ten times the history made the newest page 1.4 times slower. Writes 1.42 ms strict, 1.37 ms safe, 0.20 ms off; twenty concurrent writers lose nothing; 664 bytes an event with indexes. Delegation depth is capped at three by the product (a fourth level is refused by `enforce_delegation_depth`), so deep trees cannot exist; a 600-descendant tree read at the page limit in about 520 ms. External ingestion: 480 concurrent reports in a few seconds with the exact cap held. No materialised read model or second event store was added. A filter that matches nothing is now stopped by an 8 s statement timeout.
Reference figures were reproduced, not required; the 913 ms chain read at this volume is a known cost of reading by job without a pushdown and is recorded, not fixed.

**7. Team HQ (P6).** The real gateway and page, with the ledger switched on, on a person office and the Sample office (`scripts/isolated/combined-browser.ts`, now also capturing the Activity screen): all checks pass at 1440 and 390 (no page error, no overflow, the screen draws). I looked at the person office's Activity screen at both sizes: it rendered the existing list (the seeded office has no job, delivery or approval, so there were no ledger-only rows to show; **ledger rows themselves were therefore still not looked at**), and at 390 px a title that wraps onto three lines overlaps its meta line (row height does not grow). That is the existing list's styling, untouched by this branch; it should be filed and fixed separately. No visual redesign was made; the fallback to the existing list is unchanged (unit tests, 23).

**8. Regression (P7).** `npm test` 6 831 passed on the branch (6 933 on the merged tree); `verify:critical` 68/68, 3 682 assertions, six times green on the branch and once on the merged tree; eight extended ledger proofs 207 assertions green on both; sabotage 38 of 38 caught (S23 was found no longer discriminating, because normalisation re-bounded the input; it now removes both bounds and is caught); typecheck, lint, `check:migrations`, `check:secrets`, `check:templates`, `check:pressable`, `check:deployment-state` exit 0; the catalogue checks on the replica (callers, consumed, gateway-wrappers, anon-exposure, machine-key, ownership, office-edges) exit 0. `check:carrier-writers --replica` reports two writers (`app.document_preview_record`, `app.document_index_outcome`) identical on the base replica, so not the ledger. `check:branding` is red on the branch because of base drift and green on `origin/main` and on the merged tree.
`e2e-tasks`: 20 of 20 alone and 5 of 5 full critical runs green since; the one earlier red (a foreign-key error in `my_task_delete`, one run of about 37) is not reproduced and its cause is NOT established. The ledger adds no foreign key to `tasks`, no trigger to any task table and nothing the proof touches; classified as expected stochastic variance under concurrent load, pending a reproduction. The replica `post` was stale until rebuilt (a stale `post` made `replay-parity` red); rebuild it after editing 1060 to 1062.

**9. Latest main.** Trial merge of `origin/main` at `5fa1fbdc` (80 commits ahead, base `3caaebf`) in a disposable worktree: one conflict, `docs/adr/README.md`, resolved by keeping main's 0071 and 0072 and the ledger's 0073; no migration collision (main ends at 1053, this branch uses 1060 to 1062); typecheck, lint, branding, templates, secrets green; 6 933 unit tests, 68 critical proofs and eight ledger proofs green. The merge was not committed to any branch.

**10. Outstanding, production-only.** The seven catalogue checks against production (read-only, by a person who authorises it); production table sizes; whether the Management API accepts `CREATE INDEX CONCURRENTLY` (use a direct session or the SQL editor); real-host latency; a human security review of the SQL; a look at the Activity page with real ledger rows; the mixed-version matrix on deployed versions.

**11. Remaining risks.** The ledger's switch is deployment-wide (per-office rollout would be a future architectural change); the redactor is pattern-based and has the pinned limits above; the 913 ms chain read at 24 000 transitions; the first correction of an activity claims it permanently; an external boundary does not exist yet and, when built, must bind worker names to credentials; the table is append-only on a 500 MB tier and relies on the caps (a retention decision is still open).

**Migration hashes (sha256, as committed):** `1060` `3e7999f78eb7280fc0e8f00fd85722cbbe7a5eff3592c4cfbbcbaa7149aa997d`, `1061` `7c24ed0a4438b476aae033d3667aef02873bf8d25483912681c07695dcd45a3f`, `1062` `07c26ad8eb700e0fc79f8504ea60faccd90db0a97a3d59bb66b66ab90fd40534`. These supersede the hashes in section 15.

**Final verdicts.** MERGE READINESS **READY**. DEPLOYMENT READINESS **CONDITIONAL** (the conditions are item 10, none of which can be met without production access or a person). ACTIVATION READINESS **CONDITIONAL** (indexes valid, real-host latency, a rendered look at real ledger rows, a human review of the SQL, and a decision that a deployment-wide switch is acceptable).

---

## Phase 4 addendum - integration with real rows, release checklist (11 October 2026)

This section is the **current** record; where it restates a figure above it supersedes it. Local replica evidence is labelled as such and is never entered below as production evidence. Model reviews are not human review.

### What phase 4 found and fixed (all by looking at the real thing)

1. **Team HQ never drew the ledger.** The hook fed only the classic studio; Team HQ's Activity screen reads each project's own list. Activating the ledger would have changed nothing a person sees. Found by drawing genuine ledger rows (written to the owning tables and through the ledger writers) through the real gateway in a real browser; Team HQ now draws the ledger's rows when it is on and answered, and the old behaviour when it is not. 126 checks at 1440, 390 and 320 px (`bash scripts/isolated/activity-ui-browser.sh`); screenshots in `docs/activity-ledger/screens/`.
2. **Wording and attribution**: a ledger sentence would have read "Claire You said yes", an outside worker would have been shown under the first crew member, an unknown specialist likewise, and jobs read as `office.instruction`. Fixed (adapter and page), with unit tests (37 in the wiring file) and SQL checks.
3. **The 390 px overlap** (a wrapped title printing over its meta line) was the shared `.bcitemtitle` touch rule (inline-flex, 44 px, margin -11 px) built for one-line titles. Fixed for the Activity rows only (`.bcitem--log`); the same defect may exist in other lists with wrapped titles (not checked, not touched).
4. **A latency cliff**: the newest user page went from 110 ms (3 500 native events) to 1.9 s (5 550) when about two thousand diagnostic tool-call events were the newest rows (the native pool ignored the visibility floor and was widened repeatedly; past 16 384 rows it would have returned `partial`). Fixed with a pushed-down visibility predicate and a partial index (123 ms), regression with 17 000 diagnostic events, sabotage S45.
5. **The mixed-version matrix found a regression I had just introduced**: the per-office check as an office-less overload failed `p3-app-attack`; renamed `activity_ledger_covers`.
6. **A sabotage that no longer discriminated** (S11 stayed green because the new pool filter duplicated the outer filter); it now removes both.

### Per-office activation (decision)

**SUPERSEDED BY PHASE 5 (below).** Phase 4 implemented `activity.ledger_offices` so that an absent row meant every office. That fail-open default was found unacceptable and is gone: absent, null, empty or malformed now covers nobody. Existing convention surveyed: the only office-level mechanism is a global `system_config` flag; no office-scoped configuration exists to reuse.

### Mixed-version matrix (local replicas, NOT deployed versions)

Old = `origin/main` `5fa1fbdc`, new = this branch; each cell is the 68-proof critical gate. A (old/old) 68 green; B (new code, old schema) 66 green + 2 structural reds; C (old code, new schema) 66 green + the same 2; D (new/new) 68 green. The two reds (`replay-parity`, `office-ownership-sabotage`) compare the schema with the checkout's own migration history and manifest, so they cannot be green in any mixed cell and are not behavioural. Browser cells (new page/old gateway, old page/new gateway, new page and gateway over the old schema) all draw the older list, no error. New worker over a schema without the ledger: 4/4 (`activity-mixed-version.ts`). **The production matrix has not been run.**

### Performance and resources (replica, 3 000 jobs, 24 003 transitions; not production)

| Read | p50 | p95 | Reference (phase 3) |
|---|---|---|---|
| newest page | 106 ms | 120 | ~106 |
| severity >= error | 103 | 143 | ~96 |
| one agent | 113 | 145 | ~108 |
| diagnostic newest | 209 | 325 | n/a |
| page 3 by cursor | 196 | 211 | n/a |
| one correlation chain (up to 500 events) | 934 | 1 006 | ~913 |

Eight concurrent readers: newest p95 375 ms (x2.9 one reader), diagnostic 491 (x2.5), sparse 310 (x2.3), no errors. The chain read is bounded (five pages) and its cost is the 500-event cap, not a defect; no safe targeted improvement was evident and none was made. Writes 1.4 ms, 0.2 ms with the switch off. **Footprint on the 500 MB tier:** 685 bytes per native event including indexes, so 1 000 native events a day is about 0.25 GB a year and 10 000 a day about 2.5 GB, over the tier in two years. The external door is capped at 4 000 reports a day per office and 5 000 an hour for the deployment. **Real production rates are unknown**; measure after activation and decide retention before the table passes 100 MB (nothing deletes).

### Security re-review (a second model reviewer, read-only, on a throwaway clone; not human review)

No confirmed defect. Noted and dispositioned: fail-open by absence of the allowlist (documented; mitigated by the operator tool; **removed in phase 5**: absent now covers nobody); unknown-specialist misattribution in the byline (fixed); repeated worker markers in a summary (fixed, the page escapes everything regardless); `activity_health` tells an unlisted office the scope (accepted: scope only, not membership); the deployment-wide external cap can be exhausted by five offices cooperating (accepted, documented). All 45 sabotage rows were caught in a full run, and the eight that touch `1061` (S1, S9, S11, S38-S40, S44, S45) were re-run after the last SQL edit and caught.

### Counts (current)

`npm test` 6 853 passed (6 955 on the merged tree); `verify:critical` 68/68, 3 682 assertions (branch and merged tree); extended ledger tier 11 proofs, 335 assertions (branch and merged tree); UI harness 126; migration rehearsal 17; sabotage 45 of 45; typecheck, lint, `check:migrations`, `check:secrets`, `check:templates`, `check:pressable`, `check:deployment-state`, `check:proofs` exit 0 (merged tree adds `check:branding`, `check:tokens`). Catalogue checks in `--replica` mode: callers, consumed, gateway-wrappers, anon-exposure, machine-key, ownership, office-edges exit 0 (re-run in phase 3; phase 4 added `activity_ledger_covers`, `activity_kind_words` and one index, which `--replica` runs would classify the same way); `check:carrier-writers --replica` has the same two failures on the base replica as before.

### Release checklist and go/no-go

PASS means shown, on the stated target. **No production-only requirement is marked PASS from replica evidence.**

**Merge**

| Requirement | Status | Evidence | Owner / authority | Next action |
|---|---|---|---|---|
| Verified remote branch | PASS | `git ls-remote` shows `refs/heads/feature/unified-activity-ledger` at the pushed head (the earlier `unified-activity_ledger` was a typo in a report; no such ref exists) | agent | none |
| Collision-free migration numbers | PASS | main ends at 1053, this branch 1060-1062; the only other branch with new numbers (`feature/hermes-agent-integration`) uses 1070-1071; `check:migrations` 0 | agent | re-check at merge time |
| Trial merge of latest main | PASS | 80 commits ahead; 2 conflicts (`docs/adr/README.md`: keep ADR 0071, 0072, 0073; `scripts/verify/serve-studio.ts`: identical `STUDIO_ROOT` line, main's comment kept); not committed | agent | none |
| Merged-tree checks green | PASS | typecheck, lint, branding, tokens, templates, secrets, migrations, deployment-state; 6 955 unit; 68 critical; 11 extended ledger; 126 UI | agent | re-run if main moves |
| Security regressions passing | PASS | 45 sabotages caught; two model reviews; proofs above | agent | human SQL review is a deployment item |
| Docs consistent with implementation | PASS | this addendum, plan, contract, security, architecture updated in phase 4 | agent | none |
| Decision to merge | NOT RUN | requires Grant | Grant | decide |

**Deployment**

| Requirement | Status | Evidence | Owner / authority | Next action |
|---|---|---|---|---|
| Explicit approval | NOT RUN | none given | Grant | approve in writing |
| Human SQL review | NOT RUN | only two model reviews | Grant or a reviewer he names | review `1060`-`1062` (hashes below) |
| Authorised production catalogue checks | NOT RUN | replica mode only | Grant sets `ALLOW_PRODUCTION_CHECKS=1` for the seven read-only checks | run them, record results |
| Production table sizes measured | NOT RUN | not contacted | Grant | run the read-only size query in the plan, stage B |
| Index-build connection method confirmed | NOT RUN | a direct session is required and untested; the Management API's handling of `CREATE INDEX CONCURRENTLY` is unknown | Grant provides `SUPABASE_DB_URL` | confirm a direct session; otherwise print the statements and use the SQL editor |
| Healthy platform baseline | NOT RUN | not contacted | Grant | read the project health API immediately before each stage |
| Migration and rollback plan | PASS (replica rehearsal) | `MIGRATION-PLAN.md`; rehearsal 17/17 | agent | none |
| Deployment-state update | NOT RUN | done in the deploy commit | whoever deploys | update `docs/ops/deployment-state.json` with the deploy |
| Mixed-version evidence | PASS on local replicas, NOT RUN on deployed versions | matrix above | Grant | accept the local evidence or run the deployed matrix |

**Activation**

| Requirement | Status | Evidence | Owner / authority | Next action |
|---|---|---|---|---|
| Explicit approval | NOT RUN | none given | Grant | approve, choosing canary or all |
| Valid indexes | NOT RUN | production not contacted (replica: build, interruption and recovery proved) | Grant | stage B, then `activity_health.indexes_missing` empty |
| No unexpected write failures | NOT RUN | needs live traffic | Grant | read `activity_health` after the canary |
| Real-host latency within agreed bounds | NOT RUN | replica figures only; the host differs | Grant to set the bounds | measure after the canary |
| Ledger rows visually verified | PASS on genuine rows in a replica, NOT RUN on real data | screenshots in `docs/activity-ledger/screens/`, 126 checks | Grant | open Activity signed in, desktop and phone, after the canary |
| Approval and delivery provenance correct | PASS on the replica (proofs and the screen), NOT RUN on real records | `activity-ledger`, `activity-ledger-review`, UI harness | Grant | compare three real events with their source rows |
| Acceptable security findings | PASS for model review, NOT RUN for human review | section above | Grant | human review |
| Working global kill switch | PASS on the replica (master precedence proved, `--off` plans the master only), NOT RUN in production | `activity-office-scope`, planner tests | Grant | rehearse `--off` plan before activation |
| Office-scoped canary | IMPLEMENTED (fail closed, phase 5) and proved on the replica; not used | `activity:switch -- --canary`; Phase 5 addendum | Grant | choose the canary office; global activation is a separate, explicitly confirmed decision |

**Migration hashes (sha256):** superseded by phase 5 (`1060` and `1061` changed); see the Phase 5 addendum for the current values. Any earlier hash in this file is stale. Verify with `sha256sum migrations/106[012]_*.sql` before applying; the runner records name and checksum and refuses a changed applied file.

**Phase 4 verdicts.** MERGE READINESS **READY**. DEPLOYMENT READINESS **CONDITIONAL**: every locally verifiable prerequisite is done; the rest needs production access or a person (the NOT RUN rows above). ACTIVATION READINESS **CONDITIONAL**: it needs the deployment steps first, then a canary and the production measurements above.

## Phase 5 addendum - fail-closed activation, final verification, merge preparation (11 October 2026)

**The requirement.** No missing, malformed, interrupted or partially applied configuration may accidentally activate the ledger for additional offices. Phase 4 failed that: an absent allowlist covered every office, so deleting one row during a canary activated everyone. It is fixed in the database function every reader, writer, gateway section and Team HQ already asked (`app.activity_ledger_covers`), so there is one decision and no second feature-flag system.

**Switch-state truth table** (master = `activity.ledger_enabled`; list = `activity.ledger_offices`; proved for 150 master-and-list combinations (6 x 25) x 2 offices x 8 surfaces by `activity-office-scope`):

| Master | List | Covered |
|---|---|---|
| not JSON `true` (off, absent, `"true"`, `1`, `null`) | any | nobody (the master always wins) |
| `true` | absent, `null`, `[]` | nobody |
| `true` | array of office UUID strings | exactly the listed offices (junk elements, upper-case ids, nested arrays and duplicates never widen) |
| `true` | exactly `{"version":1,"mode":"all"}` | every office (the one explicit global representation) |
| `true` | anything else: bare string (including `"all"` or an office id), number, boolean, other version or mode, extra key, no version | nobody; health reports `scope: invalid` |

The migrations write neither the list nor the master on (the rehearsal proves that applying 1060 to 1062 covers no office even with the master turned on, and that re-applying leaves a list untouched). **No new migration was needed**: 1060 to 1062 are unapplied, so the fail-closed semantics ship in their first application and no intermediate schema can fail open; nothing deployed knows the ledger.

**Operator tool** (`npm run activity:switch`, `src/activity/switch.ts` and `switch-cli.ts`): status, `--canary`, `--add`, `--remove`, `--off`, `--all-offices --confirm="ALL OFFICES"`, `--dry-run`, `--apply`. Nothing is written without `--apply`; production flags are required for every run (the script refuses to start without them: tested by spawning it with the flags unset); unknown, repeated or conflicting options and invalid ids are refused with exit 2 or 1 and no write; the printed CURRENT and PROPOSED states and the exact statements come first; the list is written before the master; narrowing is one statement; each statement is a compare-and-swap on the value read, so a concurrent change or an interrupted run stops the apply and can never broaden access (proved on a real database for a race and for a change made after the plan). Repeated operations are idempotent (empty plan). Procedure, stop conditions and rollback: `MIGRATION-PLAN.md`, stage D.

**Evidence (replica and browser only; nothing here touched production).**

| Check | Result |
|---|---|
| Planner and command-line unit tests (`tests/activity`) | 75 passed |
| `activity-office-scope` state-machine proof | 16/16 (150 combinations x 2 offices x 8 surfaces, one check each for: function, three writers, read, chain, adapter, health; no-broadening; operator transitions; race; interruption; audit; isolation) |
| Gateway matrix, two signed-in offices through the real `hq-api` (`activity-gateway`) | 35/35 (16 activation states x four sections x two people; health scope; no cross-office rows) |
| Browser harness, 1440, 390 and 320 | 174/174 (adds eight activation states: canary on this office, on another, no list, empty, invalid, unknown version, explicit all, master off with a valid list; each draws the ledger or the older list, agreeing with the gateway, no page error, no overflow); mixed-version cell (new page and gateway over the old schema) 13/13 |
| External ingestion, native writers, worker, equivalence, durability, review, ledger | all green after naming their offices explicitly (they are about other properties; the explicit all-offices setting stands in for the old default) |
| Migration rehearsal | 19/19 (adds: no list written and nobody covered after applying 1060 to 1062; a re-apply does not touch the list) |
| `verify:critical` | 68/68, 3 682 assertions (branch and merged tree) |
| Extended tier | 84 proofs, 2 091 assertions, 0 red (branch and merged tree) |
| Sabotage | 50 of 50 caught (S46 to S50 new: row deleted, `else` widened, object equality, array match, health scope; S41 to S44 re-anchored to the fail-closed function; the first run found the matrix lacked a bare string naming the office, added) |
| `npm test` | 6 887 passed, 21 skipped (branch); 6 989 passed (merged tree) |
| Static | typecheck, `biome ci`, migrations (817 files, 814 recorded), secrets, templates, pressable, deployment-state, proof registry all clean; branding clean on the merged tree (on the branch alone it names one line from main's older `app.js`, resolved by the merge) |
| Catalogue checks on the replica (`--replica`) | callers, consumed, gateway-wrappers, anon-exposure, machine-key, ownership, office-edges clean; carrier-writers keeps its 2 known pre-existing failures |

**Trial merge of latest main** (disposable worktree, never committed; `origin/main` is `5fa1fbdc`, 80 commits ahead of the branch point): 2 conflicts, as expected: `docs/adr/README.md` (kept ADR 0071, 0072 and 0073) and `scripts/verify/serve-studio.ts` (identical `STUDIO_ROOT` line; main's comment kept). Migration numbers: main ends at 1053; this branch 1060 to 1062; the only other branch with numbers above 1053 is `feature/hermes-agent-integration` (1070 to 1072); no collision. On the merged tree: typecheck, lint, branding, secrets, templates, migrations, deployment-state, 6 989 unit tests, 68 critical, 84 extended, and the browser harness 174/174 are all green. The worktree was removed afterwards.

**Mixed-version safety.** The four-cell matrix of phase 4 was not rebuilt: nothing in the old checkout, the schema through 1053 or the application code changed in phase 5, and the only changed schema logic is inside unapplied functions that nothing old calls. What phase 5 re-ran is the new-code cells that exercise it (critical gate, browser compat cell over the old schema, the worker's writers over a schema without the ledger). Restrictions: deploy the schema, then worker, `hq-api` and page with the master OFF; activate only when every running version includes this change; roll back by `--off` first, then application, never the reverse.

**Migration hashes (sha256) at the final head:** `1060` `6c9c2511c372b160b09e518dde052ddff9f99ad77e6b341feaf892b91170a6c6`, `1061` `88e742634d612cbc9777b2e3a4624d96a658625d282758c822b56e33ab199d64`, `1062` `07c26ad8eb700e0fc79f8504ea60faccd90db0a97a3d59bb66b66ab90fd40534`. Verify with `sha256sum migrations/106[012]_*.sql` before applying.

**Checklist, in three separate stages.** PASS means shown on the stated target. No production-only requirement is marked PASS from replica evidence.

| Stage | Requirement | Status | Authority |
|---|---|---|---|
| **MERGE** | Remote branch exists and is current | PASS | agent |
| **MERGE** | Collision-free migration numbers; trial merge of latest main resolved in a throwaway worktree; merged-tree gates green | PASS | agent (re-run if main moves) |
| **MERGE** | Fail-closed semantics proved at database, gateway, writer, operator and browser level; 50 of 50 sabotages caught | PASS | agent |
| **MERGE** | Human review of the SQL and the redactor | NOT RUN | Grant |
| **MERGE** | Decision to merge | NOT RUN | Grant |
| **DEPLOYMENT** (schema and application rollout with the master DISABLED) | Re-read `app.schema_migrations`; hashes match; apply 1060 to 1062 with provenance (commit pushed, clean tree); `activity_health` reads master off, scope none | NOT RUN | Grant, production writes |
| **DEPLOYMENT** | Deploy worker, `hq-api`, page one at a time, each probing itself; compare live bytes against `origin/main` first | NOT RUN | Grant, production writes |
| **DEPLOYMENT** | Index build on the real host (`concurrently`, measured) and the platform health reading healthy | NOT RUN | Grant |
| **DEPLOYMENT** | Mixed-version matrix on real deployed versions | NOT RUN | Grant |
| **ACTIVATION** (approved office-scoped canary, after real-host verification) | Plan then apply `--canary <office-id>` for one `person` office; read `activity_health` (no write failures, no missing indexes) and compare three events to their source rows | NOT RUN | Grant |
| **ACTIVATION** | Real-host read latency within bounds Grant sets; the Activity page opened signed in on desktop and phone | NOT RUN | Grant |
| **ACTIVATION** | Rehearse the `--off` plan before activating; global activation (`--all-offices --confirm`) only as a later, separate decision | NOT RUN | Grant |

**Phase 5 verdicts.** MERGE READINESS **READY** (the open item is a human decision and human SQL review; the branch is mergeable and nothing was merged). DEPLOYMENT READINESS **CONDITIONAL**: all locally verifiable work is done; every remaining row needs production access or a person. ACTIVATION READINESS **CONDITIONAL**: it follows deployment, then an approved single-office canary and the real-host measurements; it is not blocked by anything in the code.

## Phase 7 addendum - release candidate `release/activity-ledger-v1` (11 October 2026)

This is release engineering, not feature work. The candidate is the backend ledger (`feature/unified-activity-ledger`, 96a7dec4) and the Activity UX (`feature/activity-ledger-ux`, e1d68ec2) merged onto `main` at `5fa1fbdc`, by two merge commits that keep both histories (no squash, no duplicated commits). **Nothing was merged to `main`, deployed, applied to production or activated, and no production credential or flag was used.** Everything below is replica, local-browser and model-assisted evidence; none of it is a production result and none of it is a human sign-off.

### The merge
Two conflicts, as predicted: `docs/adr/README.md` (kept 0071 and 0072 from main and 0073 from the ledger) and `scripts/verify/serve-studio.ts` (kept main's `STUDIO_ROOT` note). Phase 6's call-site hooks in `shell.js` were kept; main did not require otherwise, and main's own Activity range control (`ACT_RANGES`, `data-bc-actr`) survived. A clean merge was not taken as proof: `tests/activity/release-inventory.test.ts` (19 tests, three of them controls that go red on a synthetic loss) asserts every part of the 21-item list is present and wired in the integrated tree, and a removed-lines review against main found nothing of main's removed.

### Integration audit
All 21 items are present and wired (inventory test): migrations 1060 to 1062 and nothing in 1054 to 1059 or 1063 to 1069; append-only native store; projections of the owning tables with no second source of truth; the single fail-closed decision `app.activity_ledger_covers`; the master kill switch and the allowlist (no migration writes either); the external door with its quotas and idempotency; the SQL and TypeScript redactors; approval and delivery provenance read from the owning rows; the four gateway sections; the Activity timeline, Needs attention, Happening now, filters, keyset paging, details, causal history, mobile styling and the older-list fallback. The screen has no approval mechanism of its own: the autonomy and approval controls are untouched (asserted).

### Security review (model-assisted, read-only, on a throwaway clone; NOT a human review)
An adversarial reviewer read the SQL, the gateway, the writers, the redactors and the UI and reproduced each finding on a clone. **Nothing here satisfies the human SQL and redactor review in the checklist; that row stays NOT RUN.**

| # | Severity | Finding | Disposition on the candidate |
|---|---|---|---|
| F1 | Medium | The strict writer accepted `p_provenance => 'external'` from any caller, which skipped the guard and let a caller store an external actor, a confirmed `external.review_decided` or a critical row. Needs EXECUTE on the function, which only the owner and the worker role hold; no HTTP role does | **Fixed.** Provenance other than native is accepted only inside the external door, which sets a transaction-local marker and clears it afterwards. Proof checks: refused, nothing stored, door still works, the marker does not stay open. Sabotage S51 |
| F2 | Medium | The 8 s `statement_timeout` set on `activity_read` does not bound the call that is already running (a function-level SET does not re-arm the timer) | **Open, documented.** The claim is removed from the review package; the bound is the connecting role's timeout, which was not checked on the real host. Release risk R1 |
| F3 | Medium | A quiet office's read costs time proportional to other offices' transition volume (the time-ordered index is not office-leading): 91 ms with 12 000 transitions elsewhere, 431 ms with 42 000, about linear; non-pushed filters 0.65 to 1.7 s with `partial: true` at the 16 384 cap. Also a timing channel on other offices' volume | **Open, documented.** Design change (office-leading source, default time window); not made in a release phase. Release risk R2: measure on the real host before any activation beyond one canary office |
| F4 | Medium | The redactor missed prefixed credential names (`DB_PASSWORD=`, `GITHUB_TOKEN=`, `adminPassword=`, `PGPASSWORD=`) because the word anchor cannot match inside an identifier | **Fixed** in the SQL and the TypeScript twin (a bounded identifier prefix); 5 parity cases added |
| F5 | Low to Medium | Invisible characters outside the stripped set (tag characters, further variation selectors, Arabic format characters) split a token past the redactor | **Fixed** in both (explicit ranges, same list in both twins); 3 parity cases added. A general Unicode-category strip was not used because the SQL regex engine has no property classes; the known limitation stays listed in SECURITY.md |
| F6 | Low | `delivery.failed` carried provider text (`error_code`, `suppressed_reason`) at user visibility, which can name a chat id | **Fixed:** diagnostic readers only (migration 1061) |
| F7 | Low | An outside worker could report `declined` or `expired` and the page would read it as "You said no" | **Fixed at the door:** both are refused for an external worker (S52). The page's wording is unchanged because the door is the authority |
| F8 | Low | A native event with a non-boolean `metadata.reversible` made `activity_for_the_page` fail for that office for good | **Fixed:** typed read |
| F9 | Info | Stock Supabase default privileges could grant `service_role` DML on the new tables (the replica does not model that) | **Fixed:** all three tables revoked from `service_role` (S53); a check asserts it. To be verified against production's ACLs by a person (the catalogue check without `--replica`) |
| F10 | Info | External worker name is caller-asserted; the deployment-wide advisory lock is held to the end of the caller's transaction; a replay with a different payload returns the first row; length caps of agent and tool did not match the table (raised on 61 to 80 and 81 to 120 characters) | Length caps **fixed**. The others are documented and accepted: the worker name and the boundary belong to the external-boundary work, and the lock only matters at a volume of external reports no one has |

Held (checked by the reviewer and unchanged): EXECUTE privileges (`app.*` owner-only, the four public wrappers `service_role` only, nothing for anon, authenticated or public), pinned search paths, no injection in the dynamic SQL, office isolation in every read, composite keys on both write paths, quotas under six concurrent writers, append-only against every route, 24 malformed switch values, no ReDoS, escaping in the UI. Findings were edited into 1060 and 1061 in place because both are unapplied (the plan states this rule); the hashes below are those of the edited files.

### Counts on the release candidate (replica and local browser; after the fixes)
| Check | Result |
|---|---|
| `npm test` (vitest) | 7 040 passed, 21 skipped, 0 failed (450 files; the new inventory test is 19 of them) |
| `verify:critical` equivalent (`scripts/gate/run.ts --tier critical`) | 68 of 68, 3 682 assertions |
| Extended tier | 84 of 84, 2 106 assertions |
| Redaction parity proof | 79 of 79 (SQL and TypeScript agree) |
| External attack proof | 54 of 54 (includes F1, F7, F8 and F9 regression checks) |
| Ledger sabotage suite | 53 of 53 caught (50 existing, all re-run; S51 to S53 new) |
| Migration rehearsal (clean apply, re-apply, failure rollback, no implicit activation, interrupted and invalid index recovery) | 19 of 19 |
| Backend timings, 3 000 jobs, 24 003 transitions | newest page p50 102 ms, filtered 94 to 105 ms, page 3 192 ms, one root job chain 920 ms; the older `hq_studio_lately` is 752 ms at the same size; ten times the rows cost 1.38 times the time; strict native write 1.42 ms; 670 bytes an event with its indexes |
| Concurrent readers (eight) | all answered, no errors, p95 x2.4 to x3.2 of one reader |
| Activity UX browser harness (real gateway, replica, Chromium at 1440 and 390 with the rest in the screenshot set at 768 and 320) | 276 of 276 (axe clean, inputs at least 16 px, contrast at least 4.5:1 in light and dark, no overflow measured against the device width, office B outside the canary sees only the older list, master off draws the older list); page to first row 1 188 ms (gateway 346 ms), filter change 164 ms, opening an event 46 ms on a 400-event history, a 200-event page 103 ms |
| Fallback harness | green, no errors |
| Static | `biome ci` clean, typecheck clean, migrations (817 files, 814 recorded as applied), secrets, templates, pressable (14 known, may only shrink), deployment-state, branding clean |
| Not run, with the reason | `check:icons` and `check:consumed` (production-gated: they would contact production; no flag was set); `check:carrier-writers` keeps 2 pre-existing red functions from main's migrations 0990 and 1020 (existing main baseline) |

Mixed versions (replicas of the schema, code from this branch and from `origin/main`): old code on the new schema, 66 of 68 critical proofs green, the two red (`replay-parity`, `office-ownership-sabotage`) assert that the schema equals the checking-out tree's own history and manifest and are structural, not behavioural (read from their failure lines); new code on a schema without the ledger, 4 of 4 (writers resolve and never throw into the sweep or a plan step). The other two cells (old/old and new/new) are the main baseline and the candidate's own gates. This is the repository's replica method, not deployed versions.

Screenshots: `docs/activity-ledger/screens/release/` (timeline, Needs attention, Happening now, filters, detail with related history, project Activity, the older-list fallback and the disabled office, at 1440, 768, 390 and 320; light and dark at 1440 and 390). A representative sample was opened and read (the 1440 timeline, the 390 dark detail, the 320 detail with its related history): no overlap, clipping or low-contrast text found; the rest are covered by the harness's measured checks (overflow against the device width, contrast, axe) rather than by reading each image. **Avatars:** the harness serves a stand-in picture for the avatar storage address, and the Activity screen itself draws a glyph per event type and a text name rather than a photograph, so photograph rendering was not exercised here; real photographs, real iOS Safari and a real screen reader were not tested.

### Release risks that stay visible
R1 (F2) no enforced read time limit in the function. R2 (F3) read cost grows with other offices' volume and an unselective filter on a busy office is partial at the pool cap; production table sizes are not measured. R3 the 500 MB tier: a native event is about 670 bytes with indexes (66 MB per 100 000), the eleven read indexes and the `jobs`-sized heaps are the larger cost on a host with about 434 MiB of memory, and no retention policy is decided (`SECURITY.md`, Retention): the table is append-only and nothing is deleted. R4 `activity_write_failures` is unpruned. R5 the model-assisted review above is not a human review.

### Human-review package (what a person reads, and the hashes of the files as they stand on this branch)
Read, in order: `migrations/1060` (tables, `activity_ledger_covers`, `activity_redact`, `activity_clean`, `record_activity`, `record_activity_safely`, `record_external_activity`, the table and function grants at its end), `migrations/1061` (`activity_read`, `activity_chain`, `activity_for_the_page`, `activity_ledger_health`, the four public wrappers and their grants), `migrations/1062` (one `perform` spliced into `app.defer_over_budget`), `src/text/secrets.ts` (the TypeScript twin of the redactor), `supabase/functions/hq-api/index.ts` (the four sections only), `src/activity/*` (the planner and the best-effort writers). Questions for the reviewer: is a function-level `statement_timeout` an acceptable stand-in (it is not); is the external worker name acceptable as caller-asserted until the boundary exists; are the redactor's documented limitations (short secrets in prose, look-alike letters, percent-encoding, base64) acceptable for text the office writes; should the ledger tables carry row policies as well as owner-only functions.

| File | sha256 |
|---|---|
| `migrations/1060_one_ledger_of_activity_records_what_no_other_table_holds.sql` | `e82d2535647c9256154d55986b8dc5e8f20468f81a81ea46b6c1c7fdd532823f` |
| `migrations/1061_the_activity_read_model_reads_each_table_that_owns_the_state.sql` | `51fdf2caf1afa73b730be9b957a2bafe325d5dfe13376e834301a51156517085` |
| `migrations/1062_a_held_back_over_budget_agent_is_recorded_in_the_activity_ledger.sql` | `07c26ad8eb700e0fc79f8504ea60faccd90db0a97a3d59bb66b66ab90fd40534` |
| `src/text/secrets.ts` | `5b37e02263682d1b0e9e63ba304e62e705b07b692ea2d3b9d36a1b41dfd68413` |
| `supabase/functions/hq-api/index.ts` | `5c66957b7c5129cd8f1308a98d86803f2946bd05620e68eb54678bae44b1d2c0` |
| `web/studio/bc/activity.js` | `40cc98cf0bda07d4a78a5e8507e1d4fb407e293873d0c77d9328cfa742f2a01d` |
| `web/studio/bc/activity-model.js` | `27575d0fb1937bce0848ab44c9a5e30cd8cd36b429152fb2df583201415992b9` |

(Recompute before the review with `sha256sum` on the exact commit under review; these are of the working tree at the time of writing.)

### Checklist, three separate stages (PASS means shown on the stated target; no production-only requirement is PASS from replica evidence)
| Stage | Requirement | Status | Authority |
|---|---|---|---|
| **MERGE** | Candidate branch exists, builds on current `main` with both histories preserved | PASS | agent |
| **MERGE** | Integration inventory, unit, critical, extended, sabotage, rehearsal, browser and static gates on the candidate | PASS (counts above) | agent |
| **MERGE** | Model-assisted security review done and its fixable findings fixed | PASS (F2 and F3 open as documented risks) | agent |
| **MERGE** | Human review of the SQL and the redactor | NOT RUN | Grant |
| **MERGE** | Decision to merge | NOT RUN | Grant |
| **DEPLOYMENT** | Production baseline re-read and Grant's written authorisation (runbook step 0) | NOT RUN | Grant |
| **DEPLOYMENT** | Apply 1060 to 1062 with provenance; concurrent index build on the real host with the platform healthy; production ACLs on the three tables checked | NOT RUN | Grant, production writes |
| **DEPLOYMENT** | Worker, `hq-api`, page deployed one at a time with the master disabled; post-deployment checks | NOT RUN | Grant, production writes |
| **DEPLOYMENT** | Mixed-version matrix on real deployed versions | NOT RUN | Grant |
| **ACTIVATION** | Approved single-office canary through `npm run activity:switch`; real-host read latency within bounds Grant sets (R1, R2); the Activity page signed in on desktop and a real phone | NOT RUN | Grant |
| **ACTIVATION** | Retention decision for the native table and the failure counter | NOT RUN | Grant |
| **ACTIVATION** | Global activation | not proposed | a separate, later decision |

**Phase 7 verdicts.** MERGE READINESS **READY**, subject to the human review and Grant's decision (nothing was merged). DEPLOYMENT READINESS **CONDITIONAL**: every remaining step needs production access, a person, or the real-host measurements, and R1 to R3 should be looked at first. ACTIVATION READINESS **CONDITIONAL**, and **not for more than one canary office** until F3's cost is measured on the real host and retention is decided; technical readiness and authorisation are different things, and no authorisation has been given.

## Phase 8 addendum - security closure, performance hardening, storage (11 October 2026)

State verified first: PR #462 open and draft, head `8d212126` as reported, `main` still `5fa1fbdc` (already contained in the candidate), no other branch uses 1054 to 1069 (Hermes 1070 to 1078, read only). **No merge, deployment, production migration, production read or activation was performed or authorised in this phase.** All evidence below is replica, local browser or model-assisted.

- **F2 closed (with a stated limit):** root cause reproduced; cooperative read budget (`PT504`), gateway 504 and abort deadline, page error state with Try again, hard-cancel mechanism proved but not deployed (needs a production decision). `docs/activity-ledger/READ-TIME-BOUND.md`.
- **F3: not reproduced** (the reviewer withdrew it); a genuine own-office cost found and fixed (an unmatched interface filter took 2.5 to 5.2 s on a 7 000 job office, now 0.3 s); a regression guard `activity-scaling` is in the extended tier. The measured limit and the canary rollback bound are stated.
- **Storage:** 750 B an event with its indexes measured (850 planned), about 21 MB of read indexes on the recorded row counts (inferred); `STORAGE-AND-RETENTION.md`. **The database was projected to reach its 500 MB allowance between 10 and 19 October (`docs/ops/capacity-scenarios-2026-10-06.md`); the ledger cannot be activated without a baseline reading of the real headroom (a stop condition in the runbook).** A diagnostic volume cap (default 500 a day an office) was added; destructive retention and any paid capacity are **decisions for Grant, not made**.
- **Security:** a third model-assisted review of the phase 8 diff found no Critical, High or Medium issue; two Low findings were fixed (replay at the cap; budget versus deadline) and two accepted and documented. The human-review package with final hashes is `HUMAN-REVIEW-PACKAGE.md`. **Human review has not happened.**

Counts on the final candidate (replica, local browser): vitest 7 047 passed, 21 skipped; critical gate 68 of 68 (3 682 assertions); extended gate 85 of 85 (2 130 assertions, includes the new `activity-scaling`); ledger sabotage 56 of 56 caught; migration rehearsal 19 of 19; Activity UX harness 288 of 288 (1440, 768, 390, 320; axe, contrast in light and dark, overflow against device width, timed-out read scenario); fallback harness green; mixed versions unchanged (old code on the new schema 66 of 68, the two structural reds; new code on the old schema 4 of 4); typecheck and `biome ci` clean; `check:migrations`, `check:secrets`, `check:templates`, `check:pressable`, `check:deployment-state`, `check:branding`, `check:callers` and the replica forms of `check:anon-exposure`, `check:machine-key`, `check:ownership`, `check:office-edges`, `check:consumed`, `check:gateway-wrappers` clean; `check:carrier-writers` keeps its 2 known baseline failures from main's migrations; `check:icons` has no replica form and was not run. Performance on the replica (3 000 jobs, 24 003 transitions) is unchanged from phase 7: newest page p50 103 ms, one agent 111, page 3 186, a root job 885 (the older `hq_studio_lately` is 730); the UX harness measures page to first row 1 165 ms (gateway 308 ms), filter change 125 ms, opening an event 37 ms.

**Real iPhone and Safari testing was not available**: Chromium only; no claim of Safari acceptance. A real screen reader was not used.

**Checklist (three separate stages; PASS only on the stated target):**

| Stage | Requirement | Status | Authority |
|---|---|---|---|
| MERGE | Code complete, gates green on the final candidate, `main` reconciled (no new commits) | PASS (replica) | agent |
| MERGE | Human review of the SQL and the redactor (`HUMAN-REVIEW-PACKAGE.md`) | NOT RUN | a named person |
| MERGE | Decision to merge PR #462 | NOT RUN | Grant |
| DEPLOYMENT | Production baseline reads (headroom, sizes, indexes, role timeouts, errors) and the storage gate | NOT RUN | Grant (read approval) |
| DEPLOYMENT | Apply 1060 to 1062, build the indexes, deploy worker, gateway, page with the master off | NOT RUN | Grant (writes) |
| DEPLOYMENT | Decision on the hard read bound (role timeout or pre-request hook) | NOT RUN | Grant |
| ACTIVATION | Single-office canary, observation window, rollback rehearsal | NOT RUN | Grant |
| ACTIVATION | Retention horizon, diagnostic cap value, any paid capacity | NOT DECIDED | Grant |
| ACCEPTANCE | Production acceptance (real events visible, isolation, rollback verified, release record) | PENDING | after the above |

**Phase 8 verdicts.** CODE COMPLETE: YES (nothing further is needed from engineering before human review). MERGE READINESS **READY FOR APPROVAL**. DEPLOYMENT READINESS **READY FOR APPROVAL** only once the baseline passes the storage gate; if the headroom is as projected on 5 October it is **BLOCKED by capacity**, which no code change in this release can remove. ACTIVATION READINESS **BLOCKED** until deployment is verified and Grant approves a canary. PRODUCTION ACCEPTANCE **PENDING**.

## Capacity audit addendum (11 October 2026)

Full reasoning, figures and the exact approvals: `STORAGE-CAPACITY-DECISION.md`. **No production access was used.** Summary: the 6 October "full by 10 to 19 October" projection did not materialise (371.8 MB on 5 October, 374.8 MB on 9 October, RECORDED); the ledger costs about **6.4 MB once** and 742 to 800 B an event (MEASURED; the earlier 21 MB and 65 MB gate were wrong and are corrected to about 30 MB); at 250 events a day that is 17.9 MB over 90 days. Last recorded headroom 125 MB, so the ledger fits by a wide margin **on the 9 October reading, which is two days old and must be refreshed (approval A3, `scripts/ops/capacity-baseline.sql`)**. The nearer limit is the 1 GB file allowance (backups, about 23 to 28 October). Added: `npm run activity:storage`, proofs `activity-storage` (9) and `activity-archive-rehearsal` (10) in the extended gate, health keys `native_diagnostic_24h`, `diagnostic_cap_per_day`, `native_table_bytes` (operator office only), and a gateway mapping of a platform `57014` to the controlled 504. Verification at this commit: `biome ci` exit 0, `tsc` exit 0, `vitest` 7,049 passed, critical gate 68 green (3,682 assertions), extended gate 87 green (2,151 assertions, rebuilt replica), sabotages S54 and S55 caught. Migration hashes now: `1060` `6a680002590130cd771acd29042a59a407bdfad0a4885d10019823ba4f6ecf28`, `1061` `8b535909ae8b036c96c23b2b56242086b3047b6bb72baa245d002865b6eca9e4`, `1062` `07c26ad8eb700e0fc79f8504ea60faccd90db0a97a3d59bb66b66ab90fd40534`. **Recommendation D now (block pending the read-only baseline), expected to resolve to A.** Production changes: none.

## Phase 9 addendum: live production baseline (12 October 2026)

Full record: `PRODUCTION-BASELINE-2026-10-12.md`. **Approval A3 (read-only) was exercised once, 08:11 to 08:16 UTC**, through the Management API's read-only endpoint with the repository's single-select rule in front; 23 catalogue statements (Q06 failed harmlessly: no `pgstattuple`), two backup-metadata statements, one provider-log read (0 statement timeouts in 24 h) and the platform health API. **Production changes: none.** `backup:prune` was inspected and **not run**: its first import is the production-WRITES gate (even for a dry run), which A3 does not grant; the pure retention planner was run locally over read-only metadata instead.

| Finding | Reading |
|---|---|
| Database | 381.5 MB of 500 MB, **118.5 MB free** (RECORDED 9 Oct: 374.8 MB; +6.72 MB in about 3 days, about 1.4 to 2.2 MB a day) |
| Migration gate | **PASS**: about 31.5 MB needed (7.0 MB of indexes and schema, 17.9 MB for 90 days at 250 events a day, 25 percent margin) against 118.5 MB; no invalid index; no temp-space issue |
| Runway | about **50 to 80 days** to the allowance, with or without the ledger (the ledger is 3 to 15 percent of growth); no purchase needed |
| File storage | **602.9 MB of 1 GB, +36 MB a night, full about 22 to 24 October**: AT RISK, independent of the ledger; backups are 87 percent of it |
| Bloat | about 136 MB estimated recoverable (`jobs` 81 MB); a rewrite is **not** needed before the ledger release; A9 within about six weeks |
| Backup prune (planner, hypothetical) | 24 of 35 runs, about 263 MB, if all verify; storage would fall to about 340 MB; A11 |
| Production state | 814 migrations applied, highest 1053 (identical to `main`); none of 1060 to 1062; no `activity.*` setting; no ledger table |
| Hard read timeout | role settings read: `authenticator` and `authenticated` 8 s, `anon` 3 s, `service_role` none, server default 120 s; the effective bound for a `service_role` request is **UNVERIFIED** (A6 not requested); set `activity.read_budget_ms` to 6000 at activation |
| Security review inputs | `service_role` has no USAGE on schema `app`; a new `public` table inherits full DML for `service_role`, so the 1060 revoke is load-bearing; `HUMAN-REVIEW-PACKAGE.md` section 8 lists the seven files, their hashes and a checklist; **human review PENDING, nothing sent** |

Changes in this phase (no migration, gateway or application change): `docs/audit/ACTIVITY-CAPACITY-BASELINE-QUERIES-2026-10-12.sql` (Q01 to Q23; `scripts/ops/capacity-baseline.sql` is its byte-identical copy), `docs/audit/ACTIVITY-CAPACITY-BACKUPS-INVENTORY-2026-10-12.sql`, `tests/release/capacity-baseline.test.ts` (6 tests: both files parse, every statement is a single plain select, none selects a secret or message text, the copies cannot drift, the rule still refuses), the forecast script's constants (live row counts, headroom 118.5, growth 2.2) and documents. The migrations (`1060` `6a680002...`, `1061` `8b535909...`, `1062` `07c26ad8...`) and `hq-api` (`7e2a7688...`) are **unchanged since the 11 October commit**, so the critical and extended gates and the sabotage rows were **not** rerun (no relevant code changed); lint, typecheck, `check:migrations` (817 files, 814 recorded as applied), `check:secrets`, `check:templates` and the unit suite were (all exit 0; `biome ci` clean, `tsc` clean, vitest 7,055 passed and 21 skipped, 452 files).

**Gates, kept separate** (approving one does not advance another). **Merge: CONDITIONAL** (human review A1 and explicit approval A2; no capacity blocker). **Migrations: CONDITIONAL** (A4; human review first; repeat Q01, Q11, Q12, Q16, Q17, Q19 on the day). **Deployment: CONDITIONAL** (A5, after migrations). **Canary: NOT STARTED** (A7; live-host performance acceptance). **Recommendation: A for the ledger** (deploy within the existing capacity), with **A11 before about 22 October** and **A9 within about six weeks** as separate, ledger-independent decisions.

## Merge gate status (A2 granted, A1 not met)

A2 (merge) was granted conditionally on A1. **A1 is not satisfied: the review record in `HUMAN-REVIEW-PACKAGE.md` is unsigned, and PR #462 holds no review, comment or check run from any person.** An AI-assisted review is not human sign-off, so **the PR was not merged and was left a draft**. Head at the gate: `fe7d70ff` (the 12 October documentation commit; `main` `5fa1fbdc`, unchanged). Smallest remaining action: a named person reads the seven files in `HUMAN-REVIEW-PACKAGE.md` section 8 at the hashes listed and records name, date, scope, verdict and findings in the review table (or in a PR review on `fe7d70ff`); then the merge needs only re-verification that the head is unchanged. Also unresolved and to be confirmed by Grant before merge: whether a merge to `main` triggers a **Vercel production deploy of `web/`** (this PR changes `web/studio/bc/shell.js`, `wire.js` and `index.html`); no workflow in `.github/workflows` has a push or pull_request trigger (all `workflow_dispatch` or dispatch events), so no GitHub Action deploys, and no migration or function deployment is automated from the repository, but the Vercel project's git integration cannot be read from here.

*Process disclosure:* one edit to `scripts/isolated/activity-scale-seed.ts` was made with a Python heredoc instead of the Edit tool, and two no-op heredocs were run, against the File editing rule; the result was read back and checked. Everything else went through Edit or Write.
