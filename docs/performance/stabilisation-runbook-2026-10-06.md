# Stabilisation release: recommendation, command sheet, rollback sheet (PREPARED BUT HELD)

**Status: HELD.** Nothing in this document has been run against production. Production contact in this phase: **zero**. The last
reading (two earlier, single, read-only canary reads) was NO-GO with all four services UNHEALTHY. Nothing below runs until the platform
reads healthy and Grant authorises the first write explicitly. One authorisation covers one step, never the next.

The candidate is frozen at tag `stabilisation-candidate-1` (commit `b2a73d8f`). Everything added after it on `claude/efficiency-stabilisation`
is rollout, rollback or verification tooling and documentation: no product behaviour changed.

## 1. Recommendation

**Smallest useful first release: step 1023 alone.** It is one migration that replaces two functions (`office_health`, `last_progress`),
needs no gateway deploy and no page deploy, and removes the heaviest recurring read: the health reading the page polls every 20 seconds
per visible tab (912,800 buffer pages and 62,224 nested statements per call on a production-shaped replica, down to 84,828 and 894).

| Wave | Steps | Why this order |
|---|---|---|
| **1** | **1023** | Largest standing-load cut for the smallest change. No code deploy. |
| 2 | 1027, then 1028 + `hq-api` | 1027 halves the pulse (the other poll read). 1028 + `hq-api` removes the rest of the thinking poll's cost and carries the session single-flight (fewer calls to the auth service, which was one of the four unhealthy services). |
| 3 | 1025 | Page-load readers only. Real but second-order; see section 3. |
| 4 | Team HQ page | Largest blast radius (a 15,000-line client). Its benefit is fewer requests, which is not measured in the database; hold until the earlier waves are observed. |

**Does 1025 belong in the first emergency release? No.** It is not poll load (it runs on page load and on a refresh), it is independent of every
other step, and 1023 + 1027 + 1028 deliver most of the standing-load reduction with less risk (section 2). It stays proven and ready as wave 3,
and moves earlier only if the baseline shows that tabs refresh often (section 3).

## 2. The four candidate release sets (replica at production's true schema, 22.6k jobs, 90 MB heap)

Buffer pages touched (hit + read) per visible tab per hour = 60 x (3 pulse + 3 thinking reads per minute) + r x (one page refresh), where r is
how often the digest changes and the page re-reads everything. **r cannot be known offline**, so it is shown at four values.

| Set | Poll per hour (M pages) | r=0 | r=12 | r=30 | r=60 | Risk | Rollback | User-visible | Dependency surface |
|---|---|---|---|---|---|---|---|---|---|
| today | 189.3 | 189.3 | 223.8 | 275.7 | 362.0 | n/a | n/a | n/a | n/a |
| **A** 1023 | 40.3 | 40.3 (-79%) | 64.9 (-71%) | 101.8 (-63%) | 163.3 (-55%) | lowest: 2 function bodies, same references | one SQL file, byte-exact | none | none new (proved: no function or table referenced that the predecessor did not) |
| **B** + 1027 | 28.0 | 28.0 (-85%) | 51.8 (-77%) | 87.5 (-68%) | 147.0 (-59%) | low: 1 more function | one SQL file | none | none new |
| **C** + 1028 + hq-api | 12.7 | 12.7 (-93%) | 35.5 (-84%) | 69.7 (-75%) | 126.6 (-65%) | medium: adds 2 functions with grants; a gateway deploy that also carries the session single-flight | gateway first, then drop the functions | none (same answer, faster) | gateway source, in-process only |
| **D** + 1025 | 12.7 | 12.7 (-93%) | 30.0 (-87%) | 55.8 (-80%) | 98.9 (-73%) | medium: 2 more function bodies | one SQL file | none | none new |

Per tick (one pulse + one thinking read), pages: today 1,051,638; A 223,666; B 155,566; C and D 70,788.

What these numbers do and do not say:

* They are structural counts on a replica, not production measurements, and a 434 MiB host can behave very differently from a replica.
  No saving is claimed until it is measured on production (the protocol is section 8).
* After D, **studio (902,249 pages) and lately (319,216) are 85% of what is left per refresh.** They are not touched by any step here: their fixes
  need migration 0920, which production has not applied (1024 and 1029, held). So at high r the floor stays high whatever is shipped.
* The first three sets share one shape: most of the gain comes from the first step. A alone is 79% of the maximum possible poll cut.

## 3. 1025 re-checked adversarially

Question asked: `studio_unseen` showed more nested statements than the function it replaces; could that cost CPU or backend time on a Nano, and is the page
reduction worth the complexity?

**My first reading was wrong, and the correction matters.** I had compared the unmigrated replica with a copy my own proof runs had altered (15 extra queued
duty jobs and different statistics), and read +59% statements. Measured like for like:

| Seen-state of the person's projects | Old: pages / statements / ms | New: pages / statements / ms | Change |
|---|---|---|---|
| never seen (new person) | 248,076 / 82,375 / 319 | 55,356 / 70,330 / 149 | pages -78%, time -53% |
| seen just now (nothing new) | 13,597 / 50,238 / 104 | 13,544 / 50,236 / 100 | 0%, -4% |
| seen 3 days ago | 1,193,548 / 211,318 / 1,120 | 253,276 / 152,551 / 415 | pages -79%, time -63% |
| seen 30 days ago (window caps at 7 days) | 1,193,548 / 211,318 / 1,161 | 294,364 / 155,119 / 409 | pages -75%, time -65% |
| the proof-worn replica's own state | 277,425 pages, 52,626 `harness_job` calls, ~1.1 s | 67,101 pages, 46 calls, ~0.35 s | pages -76%, time -68% |

* **The new function was never worse in any state tested.** The expensive question (`app.harness_job`) is asked 12,057 times by the old function and 12 by
  the new one in the same state; in the proof-worn state 52,626 against 46.
* **The "extra statements" are `select now()`.** One `pg_stat_statements` read of a single call shows 70,292 calls of `select now()` (the
  `app.now_utc()` wrapper) in BOTH old and new: 0 pages, 10 ms in total. It is identical in the two, so it is not overhead the change introduced, and it is
  not CPU worth worrying about. Nested statement count is a poor proxy here; pages and milliseconds are the honest measures.
* **The plan is the same shape in both databases** (a sequential scan of `outputs`, then a primary-key probe of `jobs` per output, repeated per project).
  The remaining cost is that scan, proportional to the number of active projects x the size of `outputs`; Q2 will show `outputs`' size in production. If it
  is large, the new function's absolute cost is larger too, but it is still no higher than the old one.
* **The fence is a documented planner behaviour** (`OFFSET 0` is not pulled up), and even if production's statistics chose another plan, the harness
  question is asked of the rows in the window only, which is bounded by the window and never more than the old function asked.
* Equivalence is proved against the frozen definition for every office including a stale seen-time, with a sabotage control (the windowless copy
  disagrees in 1 of 3 offices): `scripts/isolated/page-readers-equivalence.ts`.

**Verdict: 1025 is safe and worthwhile, but it is not first.** It matters through the refresh path: every digest change re-reads the whole page payload
(`web/studio/app.js` `refresh()`), so the page-load readers are standing load per visible tab scaled by r. At r=30 it is worth 14 points (69.7M to 55.8M); at
r=12, 8 points. It does not touch the poll. Move it to wave 2 only if the baseline's hq-api request mix shows frequent refreshes.

## 4. What each step writes (and does not)

Every step is a single SQL file containing only `begin`, `commit`, `create or replace function` (a jsonb-returning security-definer function in `app` or
`public`), `drop function if exists` (rollback of 1028 only), and `revoke`/`grant execute on function`. `scripts/rollout/shape.ts` refuses any other
statement and `tests/rollout/shape.test.ts` proves it refuses an insert, update, delete, truncate, table, alter table, index, trigger, policy, table
grant, extension, role change, a function granted to anon, a function left executable by public, a function the manifest does not name, a statement
smuggled after a function body, and an empty file (20 tests). So "no data change, no structure change" is enforced by the tool, not asserted here.

| | 1023 | 1025 | 1027 | 1028 |
|---|---|---|---|---|
| Objects changed | `app.office_health(uuid,integer)`, `app.last_progress(uuid)` | `app.studio_unseen(uuid)`, `app.studio_team_work(uuid,integer)` | `app.hq_pulse(uuid)` | adds `app.cannot_think(uuid)`, `public.cannot_think(uuid)` |
| Predecessor definition | `1023.rollback.sql` (exact bodies from migrations 0750/0753; comments kept) | `1025.rollback.sql` | `1027.rollback.sql` | none: they do not exist |
| New definition | `migrations/1023_...sql` | `migrations/1025_...sql` | `migrations/1027_...sql` | `migrations/1028_...sql` |
| Data changes | NO | NO | NO | NO |
| Table / column / index / trigger changes | NO | NO | NO | NO |
| Grants | unchanged (create or replace keeps them) | unchanged | unchanged | `revoke all` from public, anon, authenticated on both; `grant execute` on the public one to `service_role` only |
| Security definer / volatility / search_path / owner | unchanged, checked live before and after | same | same | new: security definer, stable, owner `postgres`, `search_path` empty (app) and `public, pg_catalog` (public wrapper) |
| New references (functions, tables) vs predecessor | none | none | none | n/a (reads `provider_health`, calls `app.require_office`: the same expression `office_health` already used) |
| Depends on | `app.require_office`, `app.harness_job`, `app.jobs_stuck_queued`, `app.jobs_waiting`, `app.now_utc`, `app.office_sees_the_deployment`, `app.backup_health`, `app.held_for_budget`, `public.jobs`, `public.provider_health`, `public.job_state_transitions`, `public.deliveries` | `app.require_office`, `app.harness_job`, `app.now_utc`, `app.office_actor`, `public.documents`, `tasks`, `outputs`, `jobs`, `job_impediments`, `project_seen`, `projects`, `staff` | `app.require_office`, `app.now_utc`, `public.jobs`, `outputs`, `tasks`, `documents`, `projects`, `inbound_commands` | `app.require_office`, `public.provider_health` |
| Callers that get the faster version | the page poll (until 1028), voice state, the capacity and chores duties, the health page | page load and refresh | the page poll | the gateway `thinking` section (after the `hq-api` deploy) |
| Rollback | `step.ts 1023 rollback --go` | `step.ts 1025 rollback --go` | `step.ts 1027 rollback --go` | roll back `hq-api` first, then `step.ts 1028 rollback --go --gateway-rolled-back` |
| Proof | `poll-readers-equivalence` | `page-readers-equivalence` | `pulse-equivalence` | `thinking-equivalence` |

Exact predecessor `pg_get_functiondef` md5 on the replica (comments included), to compare with the `exact_md5` the `defs` read prints:
`app.office_health` `27c7d545016cfe3cb669502fe64348e0`, `app.last_progress` `78b5b84667132252eedd08fb5e334b3d`, `app.studio_unseen`
`41c318e000ee39b462409fa6d0ea29fb`, `app.studio_team_work` `9a35e12c6995830d654e1f2d338385cf`, `app.hq_pulse` `182c7912e09a28af2ed2129de154f9d7`.
The tool's gate is the comment-stripped, whitespace-normalised md5 in `scripts/rollout/stabilisation/manifest.json`. A mismatch in production means production is not what
the replica was: stop and look.

## 5. Command sheet (literal; nothing here has been run)

Conventions. Run from the repository root on branch `claude/efficiency-stabilisation`. `SUPABASE_ACCESS_TOKEN` (and `VERCEL_TOKEN` for the page) are
read from the environment and never printed. The guard flag is given inline, per command, and only by the person who authorised that command. There is
**no `npm run migrate`, no `deploy:*` and no wildcard** anywhere below: `migrate` would apply 0892-1022. Every database write below names exactly one step
and refuses unless the file's sha256 equals the pin in `manifest.json`.

### 5.1 Before anything (reads only; stop on any NO-GO)

```bash
# 0. offline: what each step is, and that its SQL is function-only
for s in 1023 1025 1027 1028; do npx tsx scripts/rollout/step.ts $s plan; done

# 1. a fresh single canary (health API for auth/db/rest/storage; cron job 1: last 5 runs under 1 s, 10 runs in 10 min; no "job startup timeout" in 1 h)
ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/forensics/canary-check.ts --counters      # baseline reading B1; exits 1 on NO-GO

# 2. Q1 to Q4 (docs/performance/db-growth-readonly-query-set.md, unchanged; catalog and statistics only), one at a time, in this order
ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/read.ts q1    # which of 0892-0905 and 1023-1029 are applied
ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/read.ts q2    # heap / index / TOAST bytes per relation, 30 largest
ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/read.ts q3    # live and dead rows, bytes per live row, HOT %
ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/read.ts q4    # 20 largest indexes and whether they are used
# (Q5 and Q6 are separate, conditional, and need their own authorisation.)

# 3. capture the current production definitions: exact text to .out/rollout/ (outside git) and a comparison with what each step expects
ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/read.ts defs     # must end "every function a step touches is the predecessor the step expects"
ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/read.ts attrs    # security definer, volatility, search_path, grants, owner

# 4. the gateway request rate over the last hour (the log service is separate from the database); one query, 65 s apart if more are added
ALLOW_PRODUCTION_CHECKS=1 npm run forensics:logs -- --set=m1_edge --hours=1

# 5. ten minutes later, with nothing changed in between: the second counter reading B2 (rates are differences of two readings)
ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/forensics/canary-check.ts --counters
```

Seven reads in step 2 and 3 plus two canary reads is the whole baseline. No other production reads are made.

### 5.2 One step (the same pattern for 1023, 1025, 1027, 1028; example 1023)

```bash
ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/step.ts 1023 precheck      # live definitions must equal the predecessor; exits 1 otherwise
ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/step.ts 1023 apply         # DRY RUN: canary-free read of the same, prints what would run
ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/step.ts 1023 apply --go    # canary first (NO-GO stops it), precheck, ONE request, postcheck, attribute check
ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/forensics/canary-check.ts --counters   # canary after (A0); wait 10 minutes, repeat for A1; classify with section 8
```

`apply --go` verifies after the write that each function equals the new fingerprint AND that security definer, volatility, search_path, grants and owner
are unchanged, and for 1028 that `anon` and `authenticated` cannot execute either function while `service_role` can execute the public one. On any mismatch it
prints `ROLLBACK RECOMMENDED` and exits 1.

When a step has been observed and kept (not before): `ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/step.ts <step> record --go` writes the one
`app.schema_migrations` row, so a later `migrate` does not apply the file again. It refuses unless the live functions are the new ones. After all kept steps,
`migrations/applied.json` in the repository is updated to match (housekeeping, not a production step).

### 5.3 hq-api (after step 1028 only; deploy order is migration first, then gateway)

```bash
# stage the change: the working tree's two files (24 new lines, 2 gone against the p4 tip: the thinking section and the session single-flight)
mkdir -p .out/stage/hq-api && cp supabase/functions/hq-api/index.ts supabase/functions/hq-api/file-text.ts .out/stage/hq-api/

# dry run: recovers the LIVE source from the function's own source map, saves it as the rollback, and prints how the staged files differ from it
ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/deploy/hq-function-staged.ts .out/stage/hq-api --save-live=.out/rollout/hq-api-live
#   EXPECTED: index.ts about 24 new / 2 gone and file-text.ts 0 / 0. Anything else means the live function is not the p4 tip: STOP.

# deploy: guard, canary, upload, then probes (unauthenticated 401, authenticated 200, thinking section 200 with a cannot_think list)
ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/deploy/hq-function-staged.ts .out/stage/hq-api --go --probe-thinking
```

### 5.4 Team HQ page (wave 4; not part of the first release)

```bash
# dry run: compares file NAMES with the live deployment, prints the live deployment id (the rollback point), deploys nothing
ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/deploy/hq-page-delta.ts
# deploy: guard, then only the files Vercel does not hold; prints the rollback command
ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/deploy/hq-page-delta.ts --go
```

## 6. Rollback sheet (literal)

Order for an emergency, newest first: page, `hq-api`, 1028, 1027, 1025, 1023. Each is independent; roll back only what is needed. A rollback is never
gated on health (it is the remedy), and it never retries into a failing host: one attempt, then read once.

```bash
# page: points production traffic at the previous deployment (Vercel instant rollback; verified endpoint POST /v1/projects/{projectId}/rollback/{deploymentId})
ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/page-rollback.ts dpl_<the id printed by the dry run>          # dry run
ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/page-rollback.ts dpl_<the id printed by the dry run> --go

# hq-api: redeploys the exact live bytes saved before the deploy
ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/deploy/hq-function-staged.ts .out/rollout/hq-api-live --go --probe-thinking

# migrations, one at a time (1028 only after hq-api is rolled back; the tool refuses without --gateway-rolled-back)
ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/step.ts 1028 rollback --go --gateway-rolled-back
ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/step.ts 1027 rollback --go
ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/step.ts 1025 rollback --go
ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/step.ts 1023 rollback --go
# and only if the ledger row had been recorded:
ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/rollout/step.ts <step> unrecord --go
```

A rollback refuses unless the live functions are exactly the new ones (it will not overwrite something it does not recognise), and verifies afterwards that they are
exactly the predecessor. Dry-run any of them by dropping `--go`.

### Rollback validated against the production-equivalent predecessor (replica at migrations 0891 + 0897-0905, seeded)

Done offline, one step at a time with `scripts/rollout/step.ts --replica=rehearse`:

* For each of 1023, 1025, 1027, 1028: precheck matches, apply, postcheck matches, the relevant equivalence proof passes, rollback, and then **every one of
  the nine functions (exact md5 including comments, plus security definer, volatility, search_path, grants and owner) equals the original predecessor**.
  Byte-exact, four times.
* The full sequence forward (1023, 1025, 1027, 1028) and in reverse (1028, 1027, 1025, 1023): byte-exact again.
* Restoring from a `defs` capture file (the exact live text) reproduces the predecessor byte-exactly, so the capture is a second, independent rollback path.
* Proofs after rollback: the equality checks of `page-readers-equivalence`, `pulse-equivalence` and `poll-readers-equivalence` all pass. Two sabotage controls in each of the first
  two report FAIL after a rollback, **by construction**: they mutate text that exists only in the new function ("the window was removed", "the fixture exclusion
  was removed") and so cannot fire against the predecessor. That is the controls being unable to run, not an equivalence failure. `thinking-equivalence` has nothing
  to prove after 1028 is rolled back (the function is gone) and fails to find it, correctly.
* Controls on the tool itself: re-applying an applied step is refused; a tampered live definition (neither predecessor nor new) makes apply and rollback STOP and change nothing;
  a rollback of 1028 without `--gateway-rolled-back` is refused; `record` refuses unless the step is live; an unknown step and `*` are refused; without the guard
  flag every production-mode command is refused before anything is sent (checked with no flag set).

## 7. Expected benefit by step (replica structural counts; production not yet measured)

| Step | Per call, before to after (pages) | Per visible tab per hour | Statements per call |
|---|---|---|---|
| 1023 | `office_health` 912,800 to 84,828 (-91%) | poll 189M to 40M (-79%) | 62,224 to 894 |
| 1027 | `hq_pulse` 138,838 to 70,738 (-49%) | 40M to 28M | 8 to 13 (cheap ones) |
| 1028 + hq-api | thinking 84,828 to 50 (-99.9%) | 28M to 12.7M | 894 to 7 |
| 1025 | `studio_unseen` -75% to -79% typical; `studio_team_work` 357,662 to 88,526 (-75%) | per refresh -24% (2.05M to 1.44M after 1023/1027/1028) | 82k to 70k; 20k to 3.4k |

Not in this release and not changed: `hq_studio` (902k pages) and `hq_studio_lately` (319k) per refresh, the worker's over-budget deferral, dispatch and idle pass,
`model_order`, polling cadence, indexes, retention, compute, the Vercel project.

## 8. Health interpretation per step

Measure a step with two counter readings (`canary-check.ts --counters`) a known time apart, **before** (B1, B2, ten minutes apart) and **after** (A1, A2,
ten minutes apart, starting at least ten minutes after the change, with no other change in the window), plus `forensics:logs --set=m1_edge --hours=1` for the
gateway request rate. Rates are differences of cumulative counters. Latency is never the deciding signal.

| Signal | Source |
|---|---|
| S1 service health | health API: auth, db, rest, storage |
| S2 cron job 1 | the 10 latest heartbeat durations and statuses (`--counters`), runs in the last 10 minutes (canary) |
| S3 startup timeouts | canary: "job startup timeout" in the last hour |
| S4 gateway rate and errors | `m1_edge`: `fn:hq-api` requests per minute and 5xx |
| S5 database counters | `pg_stat_database` deltas: `blks_hit + blks_read` per minute, `temp_bytes`, `xact_commit` per minute, `numbackends` |

| Verdict | Rule (all must hold) | Action |
|---|---|---|
| **IMPROVED** | S1 all `ACTIVE_HEALTHY`; S2 every run succeeded and under 1 s, at least 10 runs in 10 minutes; S3 zero; S4 5xx not up; and S5 buffer traffic per `hq-api` request down by at least 25% (or absolute buffer rate down at least 25% with the request rate within +/-25% of baseline) | keep; the next step is safe after 10 more minutes of quiet |
| **UNCHANGED** | healthy as above, and buffer traffic per request within +/-15% of baseline | keep; do not read it as failure (the step may matter at a load not present now); decide the next step on the baseline, not on this one |
| **WORSE** | any one of: a service that was healthy is not; any heartbeat run failed or over 1.5 s; fewer than 10 runs in 10 minutes; any startup timeout; `hq-api` 5xx rate up by 3 points or above 2%; buffer traffic per request up by more than 15%; `numbackends` up by more than 50% | **stop; roll back only the immediately preceding step; do not continue** |
| **AMBIGUOUS** | request rate differs from baseline by more than +/-40% (traffic confound); or only one counter reading exists; or the health API or metrics could not be read | change nothing and take no further step; one more reading pair 15 minutes later; hold if still unclear; roll back only if a WORSE condition appears |

The thresholds (25%, 15%, 3 points, 50%, 40%) are judgements, set here for Grant to confirm or change before the first write. "WORSE" deliberately uses health and
heartbeat first: a step that cannot be shown to help is left in place, but one that is followed by a health fall is undone.

## 9. Residual risks

1. **A replica is not a Nano.** Page counts and statements are structural; whether they move the host is exactly what the observation protocol measures. No claim of "polling -91.6%"
   or "page load -71%" is made until measured.
2. **r (refreshes per visible tab) is unknown**, so the real benefit of 1023 against 1025 cannot be fixed offline. It is the one number the baseline should add: the ratio of `studio`
   requests to `pulse` requests per tab.
3. **Production may not be the replica.** `defs` and `precheck` are the guard: a mismatch stops the step. They compare normalised function text, not data or statistics; a different
   production plan for `studio_unseen` would change cost but not the rows returned (equivalence is proved) and not above the old function's cost (the harness question is bounded by the window).
4. **The `hq-api` deploy carries two changes** (the `thinking` section and the session single-flight, which touches the credential-resolution path). The single-flight has its own unit tests
   (concurrent callers share one resolution; a refusal is shared only with the waiters; a throttle is not a refusal) and the dry run shows the diff. If the credential path is judged too
   sensitive for an emergency release, ship a thinking-only gateway (a 2-line diff) and defer the single-flight; say so before wave 2.
5. **The production line has no access guard of its own.** `claude/multi-user-p4` predates `src/safety`; this branch carries a copy so the rollout tools, the canary CLI, `hq-function-staged.ts`,
   `hq-page-delta.ts` and `forensics:logs` are guarded. `npm run migrate` and the other `deploy:*` scripts on this branch are NOT guarded: do not use them.
6. **The page diff against production is not content-checked.** `hq-page-delta` compares file names. The page change against the p4 tip is two files (`app.js`, `bc/account.js`, 78 and 9 lines changed),
   but production's page may have drifted from the p4 tip; that is part of why the page is the last wave.
7. **The ledger.** Until `record` is run per kept step and `applied.json` updated, `app.schema_migrations` does not list 1023-1028 and `check:migrations` will keep counting them as pending.
8. **The platform is unhealthy for reasons not established.** These changes reduce standing load; they are not shown to cure the platform's own stalls. Compute is untouched; a Micro
   recommendation can only follow post-change evidence.

## 10. Production contact in this phase

**None.** No request was sent to Supabase, Vercel or any production endpoint after the second health reading. Everything above was built, run and rehearsed on local replicas and against
the repository; the only network use was reading Vercel's public documentation to verify the page-rollback endpoint. Every production command above refuses to run without an explicit
`ALLOW_PRODUCTION_CHECKS=1` or `ALLOW_PRODUCTION_WRITES=1` given by a person, and that was confirmed by running each tool once with no flag set (all refused, nothing sent).
