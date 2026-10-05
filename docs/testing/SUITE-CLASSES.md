# Which suites may run where

Written 3 October 2026. 173 of the 237 `verify:*` suites reach the production database, and until now nothing said which of
them should. Grant's production office is one small Supabase instance (t3a.nano class) that also runs his real duties, his
Telegram and his Slack.

| Class | What it may do | Examples | How to run |
|---|---|---|---|
| **local** | no database, no real session: static server, jsdom, unit tests | `verify:wired`, `verify:layouts`, `smoke`, `p5/settings-qa` | freely |
| **sample** | the Sample Person's own office through the real gateway | `verify:sample-settings`, `sample:seed` | freely; it measures Grant's office before and after |
| **smoke** | a handful of cheap reads of production, or one named proof | `verify:pulse`, `verify:wrappers`, `verify:schema`, `p5/signout`, `p5/person-prompt` | `npm run suite -- <name>`; refuses while Supabase is unhealthy |
| **production-heavy** | writes fixtures into, or presses on, the real office | everything else that touches the database (181 today) | `npm run suite -- <name> --production`; refuses while Supabase is unhealthy |

Rules:

1. UX, screenshot, interaction, sabotage, attack and fixture-heavy work runs **local or sample**. If a flow needs a signed-in
   writer, the Sample Person is that writer. A real office is not a fixture generator.
2. A production-heavy suite needs `--production`: intent is stated, not defaulted.
3. A degraded platform is not something to add load to. `suite.ts` asks the project health API once and stops.
4. A new `verify:*` script is classified by what its source touches (database or production host -> production-heavy) unless
   `docs/testing/suite-classes.json` says otherwise. `npm run check:suite-classes` fails on a stale manifest entry or a suite
   classed local whose source reaches the database, and carries a control (a suite that plainly uses the Management API must
   come back production-heavy).

`npm run suite -- --list` prints every suite and its class; `--classify` prints the counts
(`{"production-heavy":182,"local":48,"smoke":3,"sample":1}` on the day this was written).

## Enforcement, and what is NOT done

* **The guard is at the executor, not only the runner (3 October 2026).** `src/db/suite-guard.ts` is asked by
  `ManagementApiExecutor.execute` before the first statement leaves the process. A Node process whose entry script is a
  production-heavy suite under `scripts/verify/` or `scripts/poc/` is refused with a sentence unless `HQ_PRODUCTION_INTENT=1`,
  which `npm run suite -- <name> --production`, `npm run gate` and `npm run e2e` set. So `npx tsx scripts/verify/x.ts` and
  `npm run verify:x` stop at the first query, and the unclassified default is "heavy". It is inert in the worker and edge
  functions (no such entry script; `node:fs` is reached through `process.getBuiltinModule`, so the Deno bundle has no import to
  resolve). `tests/db/suite-guard.test.ts` runs a real heavy suite with a bogus token and asserts it is refused before any
  request. Not covered: a suite that opens its own `pg` connection or calls `fetch` against the gateway without the executor;
  `check:suite-classes` still classes by source for those.
* The classification is by source, not by measured cost. Which of the 181 are actually heavy has not been measured.
* `verify:ui` and `verify:keyboard` were repaired, both because the TEST was stale: `verify:ui` called the section functions
  without the office P3 added (it now reads the Sample's office and is class smoke); `verify:keyboard` used a made-up writer
  token that the page only kept while the browser could not reach Supabase, so once it could, the office refused it and the
  writer-only controls (the mark picker's pencil) vanished. It now says "the office is unreachable" with an explicit route abort.

## Volume, not only intent (5 October 2026, a PROPOSAL)

The classes above gate **intent**. The forensics (`docs/ops/supabase-forensics-2026-10-05.md` sections 3 and 12.3) say volume is what
precedes degradation: 2,300 to 3,000 gateway requests in ten minutes before every persistent episode, and 30,000 to 60,000 a day
during verification against 3,000 to 5,000 otherwise. The full proposal, with the evidence and its limits, is
`docs/testing/production-test-budgets.md`. In short:

| Class | Max requests / process | Max page loads | Preconditions (enforced by `npm run suite`) |
|---|---|---|---|
| local | none (no production) | none | none |
| smoke | 100 | 5 | health green |
| sample | 250 | 20 | health green + heartbeat canary |
| disposable multi-user (`disposable` list in `suite-classes.json`) | 400 | 20 | health green + canary |
| production-heavy | 200 | 10 | `--production` + canary |
| p4 browser scripts | 500 | 40 | intent + both flags |
| default (unclassified) | 150 | 10 | as production-heavy |

* The budget is enforced in every Node process started from `scripts/`; `HQ_PRODUCTION_REQUEST_BUDGET=<n>` lowers it freely and
  raises it only with `HQ_PRODUCTION_BUDGET_REASON="<why>"`, printed. Exceeding it aborts with the budget, the count and the class,
  and runs the harness's registered teardown.
* `npm run suite` now **fails closed**: with no `SUPABASE_ACCESS_TOKEN`, or a health label or canary it cannot read, a smoke, sample
  or production-heavy run does not start, unless `--skip-canary-because="<reason>"` states why (it never overrides a reading that says
  the host is unwell). Sample and production-heavy runs also need the heartbeat canary (`src/safety/canary.ts`).
* **`scripts/p4`, `p5` and `p6` are under the suite guard now.** An unclassified one is production-heavy (needs
  `HQ_PRODUCTION_INTENT=1` plus both production flags); one named in the manifest as sample, smoke or local passes as a verify suite
  does. `src/safety/require-suite-intent.ts` is the import-time form for a script with no executor, and
  `tests/safety/p-streams-need-intent.test.ts` fails when a p4/p5/p6 script that can reach production has neither.
* Global rules while the host is unresized: fewer than 1,000 requests in any 10 minutes and fewer than 5,000 a day across all
  verification (**not enforced across processes**), and after a run above 500 requests wait an hour and re-read the canary.
* Where to run what: UX, sabotage, attack and fixture work on the isolated replica or locally; writers on the replica or staging; an
  ordinary person's journey as the Sample Person; production only for smoke or for a proof that is specifically about production.
