# Production stabilisation release: dependency graph, proofs, rollout and rollback

Branch `claude/efficiency-stabilisation`, built from `origin/claude/multi-user-p4` (the line production runs: migrations through 0891, then the
public Sample's 0897-0905 applied out of order; `hq-api` v891, `signin` v126). Nothing here has been applied to production. The only production
contact in this phase was one health read (all four services UNHEALTHY, so Q1-Q4 were NOT run).

## 0. Where it stands

| Gate | State |
|---|---|
| Q1-Q4 (read-only growth set) | NOT RUN: the canary read NO-GO (auth, db, rest, storage all UNHEALTHY). No retry, no polling. Run once when one fresh health reading is GO. |
| Dependency graph | COMPLETE (section 1). |
| Replica at production's true schema | Rebuilt: 0891 + 0897-0905, seeded to 22.6k jobs / 94 MB heap. |
| Equivalence, sabotage and isolation proofs on it | PASS (section 3). |
| Unit suite, tsc, secrets, migrations, templates | 4526/4526, 0, 0, 0, 0 (biome exits 1 on `origin/claude/multi-user-p4` itself with warnings in files this release does not touch; every changed file is clean). |
| Startup harness (desktop and phone) | PASS: signed-in office, no-office, refused credential, Sample visitor, set-up flow, Settings lazy-load, poll cadence. |
| Production migration, deploy | NOT DONE. Awaiting health GO and authorisation per write. |

## 1. Exact dependency graph

"Production-equivalent" means production already has the object this migration replaces, so `create or replace` is a pure swap.

| Migration | Replaces | Introduced by | Calls (all must exist in production) | Production has it? | Strictly required? |
|---|---|---|---|---|---|
| **1023** `office_health`, `last_progress` | `app.office_health(uuid,integer)`, `app.last_progress(uuid)` | 0750 / 0753 | `app.require_office`, `app.harness_job`, `public.jobs`, `cron.job_run_details` | Yes, code-identical to the frozen reference (comments aside) | Yes: it is the 912,800-buffer health read the poll and Settings make |
| **1025** `studio_unseen`, `studio_team_work` | the same two | the studio readers on the p4 line | `app.require_office`, `app.harness_job`, `public.outputs`, `public.jobs`, `public.project_seen` | Yes, code-identical | Yes: both run on every page load and refresh |
| **1027** `hq_pulse` | `app.hq_pulse(uuid)` | the p4 line | as above | Yes, code-identical | Yes: the 20 s poll |
| **1028** new `app.cannot_think(uuid)` + `public.cannot_think(uuid)` | nothing (additive) | this release | `app.require_office`, `app.harness_job`, `public.jobs` | n/a (new) | Yes, for the single thinking read; must exist BEFORE `hq-api` is deployed |
| 1024 `studio_activity` via-join | `app.studio_activity` | integration 0920 | `app.event_via_label`, `events.origin_channel` | NO (0920 unapplied; fails at create) | NOT in this release |
| 1029 `hq_studio_lately` | `app.hq_studio_lately` | 0920 | `app.event_via_label`, `events.origin_channel` | NO (a plpgsql body, so it would create and then fail on every call) | NOT in this release. Was inside 1025; split out. |
| 1026 | self-improvement budget | n/a | n/a | n/a | Not carried: the benefit did not reproduce on a production-sized heap |

Code and page dependencies:

* `hq-api`: `thinking: { fn: 'cannot_think', office: true }` needs `public.cannot_think` (1028) first. Session single-flight changes only in-process behaviour.
* Page (`web/studio/app.js`, `web/studio/bc/account.js`): lazy Settings/Usage, no-office and refused-credential guards, one thinking read. Works against the old gateway (the `thinking` section already exists) so page-before-gateway is safe; gateway-before-migration is NOT.
* Worker connection retry: excluded (cannot prove the deployed worker equals the tip).
* Migration numbers: 1023, 1025, 1027, 1028 leave a gap at 1024/1026 on purpose; `check:migrations` is clean. Before any `npm run migrate`, Q1 must show which of 0892-0896 are applied: `migrate` applies pending files in order and must be pointed at the four files only, never wholesale.

## 2. Measured on the production-true replica (per call, hit + read = buffer pages touched)

| Path | Statements before to after | Buffer pages before to after | Seq scans of jobs | ms |
|---|---|---|---|---|
| `office_health` (also what `thinking` called) | 62,224 to 1,138 | 912,800 to 88,747 (-90%) | 4 to 2 | 817 to 62 |
| thinking reading (`cannot_think`) vs the old whole-health call | 62,224 to 7 | 912,800 to 53 | 4 to 0 | 817 to 0.7 |
| `studio_team_work` | 20,231 to 3,525 | 357,662 to 90,366 (-75%) | 1 to 1 | 302 to 68 |
| `hq_pulse` | 8 to 13 | 138,838 to 70,734 (-49%) | 4 to 2 | 145 to 48 |
| `studio_unseen` | 82,375 to 130,752 | 248,073 to 194,319 (-22%) | 0 to 0 | 367 to 325 |
| `hq_portfolio_tasks` | 10 to 10 | 73 to 73 | 0 | unchanged |

Caveats, stated rather than rounded away: `read` (disk) counts depend on cache warmth and the first call after a restart is cold, which is why buffer pages
(hit + read) are compared. `studio_unseen` touches FEWER pages but more nested statements; its benefit is the smallest of the four and it is carried because it
runs on every page load, not because it is a large win. These are structural counts on a replica. They are NOT production measurements and no replica
saving (polling -91.6%, page load -71%) is claimed until measured on production (section 6).

Budget: `scripts/forensics/resource-budget.stabilisation.json`, PASS for the six paths this release changes. The full `resource-budget.json` is
deliberately red on `lately`, `defer_over_budget`, `dispatch_due`, `idle_pass`, which later work (1024/1029 and worker-side changes) addresses.

## 3. Proofs run on the production-true replica (all PASS)

`poll-readers-equivalence`, `page-readers-equivalence` (reports `hq_studio_lately skipped (0920 absent)`), `pulse-equivalence`, `thinking-equivalence`
(not reachable by anon, reach not widened), `office-isolation-changed-readers` (refusal on null/unknown office, A unchanged by a burst in B, sabotaged copy
leaks and is caught). Each equivalence proof carries a mutated-copy control that must disagree.

## 4. Rollback map (each step is reversible by `create or replace`, no data changes)

| Step | Roll back with | Needs |
|---|---|---|
| 1023 | `scripts/isolated/reference/poll-readers.0750-0753.sql` bodies as `app.last_progress`, `app.office_health` | verified code-identical to production's current definitions (comments stripped) |
| 1025 | `studio_unseen`, `studio_team_work` from `page-readers.pre-1025.sql` (NOT `hq_studio_lately`: this release never touched it) | same |
| 1027 | `pulse.pre-1027.sql` | same |
| 1028 | roll back `hq-api` FIRST (v891), then `drop function public.cannot_think(uuid); drop function app.cannot_think(uuid)` | additive, so the drop is safe once nothing calls it |
| hq-api | redeploy the previous bytes (live bytes captured before the deploy by `hq-function-staged.ts`) | |
| page | redeploy the previous page files (`hq-page-delta.ts`) | |

Before step A, capture production's exact current definitions with `pg_get_functiondef` (one read, inside the already-authorised read-only guard) so the rollback
is byte-exact; the frozen references are the fallback and are code-identical.

## 5. Rollout log (fill one block per step; never continue through a failed gate)

```
STEP:                A 1023 | C 1025 | E 1027 | G 1028 | K deploy hq-api | M deploy page
CHANGE:              exactly one logical change
CANARY BEFORE:       health (auth/db/rest/storage), cron job-1 last 5 runs and duration, runs/10min, startup-timeout in 1 h
CANARY AFTER:        same
HEALTH:              GO | NO-GO, with the readings
ROLLBACK NEEDED?:    yes/no, and which
NEXT STEP SAFE?:     yes/no
```

Order: baseline (`npx tsx scripts/forensics/canary-check.ts --counters`), Q1-Q4 and report, then A, canary, C, canary, E, canary, G, canary, K, canary, M,
canary. Stop and roll back the immediately preceding step if health materially worsens (any service UNHEALTHY, cron job-1 failing or over 1 s, runs/10 min
under 10, or "job startup timeout" in the last hour). Every step is authorised separately; one authorisation does not extend to the next.

Verification after each step that touches behaviour: signed-in office, no-office, refused credential (one read, no poll), Sample guest (acts only through
GUEST_MAY), phone startup, Settings lazy-load, poll cadence (about 3 pulse reads a minute visible), office isolation (cross-office check), no auth or
provenance change. `npm run verify:startup` and `verify:startup:phone` run locally; production checks are read-only and low-rate, never the heavy suites.

## 6. After the rollout (observation, not a claim)

Under ordinary traffic only: gateway requests per minute, buffer-hit and read deltas (`canary-check.ts --counters`, a delta needs two readings a known time
apart), cron job-1 duration, startup-timeout events, health episodes, database growth, page behaviour. Compare with the baseline taken immediately before
step A. Reassess Nano versus Micro only from that evidence. No compute change during the rollout. Vercel cleanup and deletion are untouched.

## 7. Not done, and why

* Q1-Q4: production unhealthy. * `check:gateway-wrappers`, `check:callers`, `check:pressable`, `check:anon-exposure` read production catalogues: run them as
  production reads once health is GO, before step K. * The `hq-api` and page deploy tools were not run (production writes).
