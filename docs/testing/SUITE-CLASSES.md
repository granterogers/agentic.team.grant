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
