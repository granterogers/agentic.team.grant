# Which suites may run where

Written 3 October 2026. 173 of the 237 `verify:*` suites reach the production database, and until now nothing said which of
them should. Grant's production office is one small Supabase instance (t3a.nano class) that also runs his real duties, his
Telegram and his Slack.

| Class | What it may do | Examples | How to run |
|---|---|---|---|
| **local** | no database, no real session: static server, jsdom, unit tests | `verify:wired`, `verify:layouts`, `smoke`, `p5/settings-qa` | freely |
| **sample** | the Sample Person's own office through the real gateway | `verify:sample-settings`, `sample:seed` | freely; it measures Grant's office before and after |
| **smoke** | a handful of cheap reads of production, or one named proof | `verify:pulse`, `verify:wrappers`, `verify:schema`, `p5/signout`, `p5/person-prompt` | `npm run suite -- <name>`; refuses while Supabase is unhealthy |
| **production-heavy** | writes fixtures into, or presses on, the real office | everything else that touches the database (182 today) | `npm run suite -- <name> --production`; refuses while Supabase is unhealthy |

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

## What is NOT done

* `npm run verify:<name>` called directly still runs; the runner is the guarded door, not the only door. Wiring the guard into
  each heavy suite's first line (or renaming the npm scripts) is mechanical and was not done in one pass because 182 edits to
  suites that write to production is itself a risk.
* The classification is by source, not by measured cost. Which of the 182 are actually heavy has not been measured.
* `verify:ui` is broken independently of this work: it calls `app.hq_studio_settings()` with no office, a signature P3 removed.
* `verify:keyboard` has five failures that predate this work and are not about Settings (the icon-picker tab stop and the
  slash shortcut).
