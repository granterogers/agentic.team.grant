# Production test budgets (a PROPOSAL)

Written 5 October 2026. **Everything below is a proposal grounded in measured evidence, for Grant to accept, change or reject.**
Where a number is a judgement rather than a measurement, it says so. Nothing here has been run against production: it was built
and proved with unit tests, fake transports and a local static server.

## Why: the evidence

The production database is a 434 MiB Nano host that also runs Grant's real duties. Two documents establish what verification does
to it (`docs/ops/supabase-forensics-2026-10-04.md`, `docs/ops/supabase-forensics-2026-10-05.md`):

* **Section 3 (MEASURED).** Daily gateway requests were 3 to 5 thousand on 28 September to 1 October, then **29,864 on 2 October,
  60,326 on 3 October and 54,724 on 4 October**, the days verification ran. Every persistent degradation episode (E1, E2, E4) had a
  burst of **2,300 to 3,000 gateway requests in ten minutes** at or before its onset: 2,303 at 07:20 on 2 October, 3,039 at 17:50 and
  2,279 at 19:10 on 3 October, 2,079 requests per ten minutes at 15:20 on 4 October.
* **Section 12.3 (MEASURED counts; the reading is INFERRED).** One Team HQ page load is about **25 gateway requests**, so 3,000
  requests in ten minutes is on the order of **a hundred page loads**. The bursts are largely our own verification traffic, and the
  E2 and E4 bursts were run against a host that was already stalled.
* **Section 12.1 (MEASURED).** pg_cron job 1 (the worker heartbeat) records every run in `cron.job_run_details` with its duration and,
  when the host could not start a backend, a `job startup timeout`. It kept recording through every episode, so it is a free
  per-minute probe of host health.

**What this does not establish.** The same section shows the launcher stalls in E2 and E4 and on 3 October 11:00 to 13:09 began at
**idle**, with no burst inside them, so the host is intermittently unwell without our load, and a delayed consequence of earlier load is
not excluded. Request rate alone did not predict onset (the first 3 October onset came after hours of 14.6k and 11.5k per hour that the
host tolerated). The budgets below limit what **we** add and refuse to add it to a host that is visibly unwell; they do not claim that
load is the whole cause.

## What changed in the guard

The existing guard (`src/safety/production-gate.ts`, `docs/production-access-guard.md`) is a gate on **intent**: was a person asked.
It had no counter of **volume**, `scripts/p4`, `p5` and `p6` sat outside the suite guard, and `scripts/suite.ts` failed open when the
access token was unset. Now:

| Mechanism | Where | Enforced |
|---|---|---|
| Request budget: a per-process counter of production-bound requests, with class defaults | `src/safety/request-budget.ts`, counted in the fetch guard (`guardFetch`), `ManagementApiExecutor` (per attempt, retries included) and `PgExecutor` (remote only) | **yes**, in every Node process started from `scripts/` |
| Page accounting: a Playwright page's production requests and main-frame loads count against the same budget, and the page's context is closed when it is spent | `src/safety/page-accounting.ts`, wired into `scripts/p4/browser.ts`, `scripts/p4/chat-reload.ts`, `scripts/p6/account-ui.ts` | **yes**, in those three scripts only |
| Canary precondition: GO / NO-GO from provider health, the last 5 heartbeat runs, 10 runs in 10 minutes, no startup timeout in the hour; fail closed | `src/safety/canary.ts`, used by `scripts/suite.ts` and `scripts/verify/auth-acceptance.ts` | **yes**, for runs started through `npm run suite` and for `verify:auth-acceptance` |
| In-run abort rule (boundary over 15 s, canary run over 1.5 s, missing run) | `judgeInRun` in `src/safety/canary.ts` | **a library function only**: nothing polls it yet |
| Suite guard coverage of `scripts/p4`, `p5`, `p6` | `src/db/suite-guard.ts`, `src/safety/require-suite-intent.ts`, `tests/safety/p-streams-need-intent.test.ts` | **yes** |
| Fail-closed suite runner | `scripts/suite.ts` via `src/safety/suite-preflight.ts` | **yes** |

### The request budget

| Class | Max production requests per process | Max page loads per process |
|---|---|---|
| smoke | 100 | 5 |
| sample | 250 | 20 |
| disposable-multi-user | 400 | 20 |
| production-heavy | 200 | 10 |
| p4 browser scripts (`scripts/p4/*`) | 500 | 40 |
| default (unclassified) | 150 | 10 |

* The class is `HQ_SUITE_CLASS`, which `npm run suite` sets from the suite's class (`docs/testing/suite-classes.json`; the
  `disposable` list names the suites that create disposable people), or, when absent, derived from the entry script (`scripts/p4/` is
  p4-browser; anything else is default). It is **declared, not authenticated**: it has the same trust model as `HQ_PRODUCTION_INTENT`.
* `HQ_PRODUCTION_REQUEST_BUDGET=<n>` (and `HQ_PRODUCTION_PAGE_LOAD_BUDGET=<n>`) may **lower** the number freely. Raising it above the
  class default is **refused** unless `HQ_PRODUCTION_BUDGET_REASON="<why>"` (at least 8 characters) is also set; the reason is printed to
  stderr at start-up. An unreadable value is refused, not ignored.
* What counts: requests the fetch guard lets through to `*.supabase.co`, `*.supabase.com`, `*.vercel.app` or the project ref; every
  Management API query attempt (a retry is a second request); every statement over a remote Postgres connection; and, through
  `accountPage`, a page's requests to those hosts. What does not: localhost, a Unix-socket replica, a request the production gate
  **refused** (nothing was sent), and anything inside Deno (the edge worker is the production office).
* Applies to a Node process whose entry script is under `scripts/`, or any process that sets `HQ_PRODUCTION_REQUEST_BUDGET`.
* On exceeding it the process prints a sentence naming the budget, the count and the class, sets exit code 5, runs the teardowns the
  harness registered with `registerBudgetTeardown` (which get a bounded allowance of 50 further requests), and refuses every later
  production request for good. The refused request throws `ProductionBudgetExceeded`, so a script's own `finally` also runs.
* **A budget of 100 to 250 requests is tight on purpose.** Many existing suites make more than that and will now stop; the way to run
  one is the stated-reason raise, which is the point: the volume is a decision somebody makes in words.

### The canary precondition

Pure functions with injected readers (`canaryPrecondition`). GO needs **all** of: every service `ACTIVE_HEALTHY`; the last five runs
of cron job 1 all `succeeded`, each **under 1.0 s**; **10 runs present** in the previous 10 minutes; **no `job startup timeout`** in
the last hour. It reads the heartbeat in one query. It **fails closed**: if health or the canary cannot be read (no token, a timeout,
an empty reading) the answer is NO-GO with the reason printed, after one retry. `--skip-canary-because="<reason>"` (at least 8
characters) goes ahead anyway **only when the reading could not be made**; a canary that reads and says the host is unwell stays NO-GO
whatever is passed. Health is read first and a bad reading stops there, so an unwell host is not asked for more.

In-run abort rule (`judgeInRun`): any boundary over 15 s, any canary run over 1.5 s or not succeeded, or a missing run (a gap over two
minutes between runs, or since the latest) aborts the run. The caller polls `IN_RUN_SQL` and passes the reading; today only the
suite's own boundary limit (`auth-acceptance`) is wired.

## The classes, with every limit (PROPOSAL)

"Enforced" marks what the code refuses today; every other limit is a rule for the person or agent running the suite.

| Class | Max gateway requests per run (enforced) | Max disposable users / offices | Max jobs / model calls | Max page loads (enforced) | Cool-down after a run | Preconditions |
|---|---|---|---|---|---|---|
| **local** | 0 production | 0 | 0 | 0 | none | none |
| **smoke** | 100 | 0 | 0 | 5 | 10 min | `ALLOW_PRODUCTION_CHECKS=1`; health green (enforced) |
| **sample** (the Sample Person) | 250 | 0 (the Sample is the person) | 10 | 20 | 30 min | the two above, plus the heartbeat canary (enforced) |
| **disposable multi-user** (`account-lifecycle`, `account-ui`, `auth-acceptance`) | 400 | 2 | 10 | 20 | 60 min | the canary (enforced), a stated intent, teardown proven in the suite |
| **production-heavy** | 200 | 0 new offices | 20 | 10 | 60 min | `HQ_PRODUCTION_INTENT=1` and both production flags, the canary (enforced); a person says why |
| **p4 browser scripts** | 500 | 2 | 5 | 40 | 60 min | intent and both flags (enforced for an unclassified p4 script), the canary |
| **default** (unclassified) | 150 | 0 | 0 | 10 | 30 min | as production-heavy: unclassified means heavy |

The jobs / model-calls and disposable-people limits are **not** counted by code; they are the author's rules and are numbers of
judgement (no measurement of a "safe" job count exists).

### Global rules, until the host is resized

1. **Fewer than 1,000 production requests in any 10-minute window**, and **fewer than 5,000 a day** across **all** verification
   together. (Judgement, set well below the 2,300 to 3,000 per ten minutes that preceded every persistent episode, and the 30,000 a
   day of 2 to 4 October.) **Not enforced across processes**: each process counts only itself, so two suites run at once each get their
   own budget. Whoever starts several runs adds their budgets up. A shared ledger would enforce this and has not been built.
2. **After a run above 500 requests, wait an hour and re-read the canary before the next production run.** (Judgement, from the
   observed delay of 36 minutes to about 2.5 hours between a burst and the next stall; 12.3, caution 1.)
3. A degraded platform is not something to add load to: a NO-GO is an answer, not an obstacle. Do not retry it in a loop.

## Where each class should run

| Class | Run it on | Production only when |
|---|---|---|
| UX, screenshots, interaction, sabotage, attack, fixtures | **local, or the isolated replica** (`bash scripts/isolated/replica.sh`, then `scripts/isolated/*`): no flag, no budget, no host | never |
| Anything that writes, or presses on the office | the **isolated replica**, or **preview / staging** once one exists (`npm run staging:preflight`; `docs/production-access-guard.md`, "Staging binding") | the proof is specifically about production (a deployed function, the real gateway's CORS from the real origin, the real auth provider) and cannot be shown elsewhere |
| A signed-in journey as an ordinary person | the **Sample Person** through the real gateway (`docs/multi-user/SAMPLE-PERSON.md`) | it is the Sample, which is production by design, so budget and canary apply |
| A deploy probe, a health check, "is it up" | **production smoke**: a handful of reads, cheap | always allowed, within the smoke budget |
| Disposable-person lifecycle, first login | the replica for logic; production for the one deployed path only (`verify:auth-acceptance`, deliberately about 30 requests) | the question is about the deployed sign-in path |

Smoke is **not made impossible** by any of this: a small, health-gated run still works when the person states intent
(`ALLOW_PRODUCTION_CHECKS=1`, and `npm run suite -- <name>` for a classed suite), the platform reports healthy, and the run stays inside
100 requests.

## Known gaps and ways it can still fail open

* The budget class is **declared**: setting `HQ_SUITE_CLASS=p4-browser` raises the limit to 500 with no reason. The raise-needs-a-
  reason rule covers `HQ_PRODUCTION_REQUEST_BUDGET`, not the class name.
* The counter is **per process**. The global 1,000-per-10-minutes and 5,000-a-day rules are not enforced across processes.
* A script that is not run from `scripts/` and does not set `HQ_PRODUCTION_REQUEST_BUDGET` is not budgeted (a unit test, a REPL).
* **Browser traffic is counted only in three scripts.** Any other Playwright script that drives the deployed site is invisible to the
  budget (the production gate's `require-production-site` still asks for the flag). Wiring one is one line: `accountPage(page)`.
* A request made through a transport other than global `fetch`, the Management API executor, a remote `pg` connection or
  `accountPage` (a raw socket, `child_process` calling `curl`, another HTTP client) is not counted.
* `judgeInRun` has no caller; the in-run canary poll is not wired into any suite.
* The suite runner reads the canary through the Management API, which itself rate-limits and answers 500 during episodes (12.1 notes
  the metrics scrape did); an unreadable canary is then NO-GO, which is the intended failure, and `--skip-canary-because` is the
  stated escape.
* Browser-recorded counts over-count (a production-host request answered by a suite's own route handler still counts), which is the
  safe direction.
