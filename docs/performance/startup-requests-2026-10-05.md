# Team HQ startup reads: measured, reduced, and pinned

5 October 2026. Supabase efficiency audit, area "Team HQ fan-out" (issue #422). Local and isolated: **no production contact, no
credentials, no flag.** This is evidence about requests, not about database cost; see "What this does not show".

## Question

A page load asks the gateway for many sections. #422 recorded about 25 reads per load and 11 refused 403s for a person who has
signed in and has no office yet. Which of those are needed, and what does a load actually cost now?

## Method

`npm run verify:startup` (`scripts/verify/startup-requests.ts`) serves `web/studio` from localhost in a real Chromium and answers
a fake gateway in the browser, so every request is counted and none leaves the machine. It signs in as a **person** (a session, as
a second person has one) and runs three scenarios against explicit budgets:

1. an established office: every section read at most once on load, and exactly the 14 sections the page needs (silence cannot
   pass); the poll runs at its documented cadence;
2. a signed-in person with no office: one read (the studio payload that says so), then nothing over a visible minute;
3. the same person setting their office up: the reads and the poll **start** when the office exists.

The poll is timed on the page's own fake clock one 20-second interval at a time, with a real pause between. The first version
jumped a whole minute at once, so the watcher's overlap guard skipped two of three ticks and the harness reported one poll where
there are three. That was the harness, and it was fixed before any product code was touched.

## Before and after

BEFORE is the unmodified `HEAD` in a clean worktree, run by the same final harness. AFTER is the working tree.

| Scenario | Before | After |
|---|---|---|
| Established office, requests on load | 15 (`thinking` twice) | **14**, each section once |
| Established office, a visible minute | `pulse` x3, `thinking` x3 | unchanged: `pulse` x3, `thinking` x3 |
| No office, office reads on load | **15**, all refused | **1** (-93%) |
| No office, all requests on load | 17 (including 2 identity asks) | **2** (1 read, 1 identity ask) |
| No office, a visible minute | **6 more** reads, all refused | **0** |
| After setting the office up | 8 requests; `lately`, `workspace`, `pulse` never started by the setup | 15; the same 14 reads an arrival makes, each once, and the poll runs |

The 14 sections, once each: `studio`, `pulse`, `portfolio_tasks`, `lately`, `unseen`, `team_work`, `thinking`, `workspace`,
`slack_link`, `channel_link`, `conversation_channels`, `studio_settings`, `conversation_growth`, `usage_overview`.

## What changed (`web/studio/app.js`, `web/studio/bc/account.js`)

1. **`live()` no longer starts the post-arrival reads for a person with no office.** The studio payload has just said so
   (403 `no_office`), so every following read was refused, and the poll then kept being refused for as long as the tab stayed open.
2. **Those reads and the poll are now one idempotent function, `startOfficeReads()`**, called by `live()` when an office exists
   and by `refresh()` the first time it finds one (which is where office set-up already lands). Parity with an arrival; no
   double start.
3. **`thinking` is read once.** `pulse.watch()` primes itself with an immediate tick whose first act is that read, and `live()`
   also read it directly. A tab that is hidden at load now reads it when it is shown.
4. **The set-up screen asks who the person is one question at a time.** It drew again while the first answer was on its way and
   each draw asked again.

The diff is 51 insertions and 11 deletions. The body of the old tail of `live()` was not rewritten, only moved under a function
header.

## Proof the harness can fail

Each fix was removed in turn and the harness run, with a marker confirmed in the file before reading the result:

| Sabotage | Result |
|---|---|
| remove the call that starts the reads after set-up | 4 FAIL: `lately`, `workspace`, `pulse` not read, and **0 polls** after set-up (a person would have been left with a page that never updates) |
| call `thinking` directly again | 1 FAIL: `thinking x2` |
| remove the no-office guard | 5 FAIL: 14 reads and 6 polls a minute for a person with no office, and the set-up checks |

All markers removed afterwards (`grep` confirms zero).

## Checks run

`npm run smoke` (every route renders, nothing thrown), `check:templates`, `verify:wired` (no dead controls), `verify:routes`
(8/8), `verify:keyboard` (32/32), `tsc`, `biome ci` on the new files, `check:secrets`; the full unit suite: 5,308 tests pass,
21 skipped, one file fails, `tests/sessions/weather-is-not-a-failure.test.ts`, which fails identically on untouched `HEAD`
(issue #429). The set-up screen and the post-set-up welcome screen were captured at desktop and phone width and looked at: both
render, no horizontal overflow, no page errors.

## Evidence rows (same format as the Supabase table)

| AREA | BASELINE | PROBLEM PROVEN? | CHANGE | AFTER | IMPROVEMENT | CONFIDENCE | NOTES |
|---|---|---|---|---|---|---|---|
| Team HQ fan-out, person with no office | 15 office reads on load, 6 refused polls a minute (isolated, fake gateway) | **Yes** (request waste); database cost UNPROVEN | No post-arrival reads or poll until an office exists; started by `refresh()` on set-up | 1 read, 0 polls | **-93% reads, -100% polling** in the harness | High on the count, low on production IO | Volume of such loads in production unknown |
| Team HQ fan-out, duplicate read | `thinking` x2 on every load, every person | **Yes** | one read, from the poll's priming tick | x1 | -1 of 15 loads' requests (-6.7%) | High | Applies to everyone |
| Team HQ fan-out, established office | 15 requests on load | Partly: 6 of 14 feed a page most visits never open | None yet | 14 | -6.7% | Medium | Deferring the Settings and Usage reads is the larger lever; UNPROVEN until what depends on them is checked and production cost is known |
| Startup regression guard | none | n/a | `npm run verify:startup` budgets | pass; fails under 3 sabotages | n/a | High | Local only |

## What this does not show

- **Database cost.** A request is not a statement, and a statement is not disk IO. How much each of the 14 sections costs the
  database in production is **UNPROVEN**; it needs matched statement counters or per-section plans from production, which is a
  read that has not been authorised.
- **How often it happens.** How many real page loads come from a person with no office is unknown. With two people on the
  deployment it may be small, so the saving may be small in practice. The harness proves the rule; it does not prove the volume.
- **A real gateway.** The fake answers every section with an empty payload. A real office has projects, and the page then
  reads more (#422 saw about 25).
- **Hidden tabs.** The one behavioural change is that a hidden tab no longer reads `thinking` at load. It is unobservable by
  anyone until the tab is shown, and then it is read at once.

## The larger lever this exposed (not done)

Six of the fourteen reads on every load, `studio_settings`, `slack_link`, `channel_link`, `conversation_channels`,
`conversation_growth` and `usage_overview`, feed the Settings page, which `refresh()`'s own comment says "most visits never
open". They are 43% of an established office's load and are read eagerly. Deferring them is the largest candidate, and it is **not
safe to assume**: the settings payload also decides what Settings may offer ("depends on who is looking"), so something may read
the viewer role at arrival. It needs a check of what depends on it, a before/after, and the production cost per section to know
whether it is worth doing. Recorded here and on #422, not changed.
