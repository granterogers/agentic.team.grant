# Basecamp-inspired Team HQ — run ledger

Durable record for the `claude/basecamp-team-hq` workstream. Written so the run
survives a context compaction: mission, baseline, decisions, evidence and the
next autonomous action are all here rather than in a conversation.

**On compaction, reread in this order:** this file → `basecamp_clone.md` →
`git status` / `git log --oneline origin/main..HEAD` → continue at NEXT ACTION.

---

## Mission

Implement the Basecamp-inspired Team HQ reference slice described in the
top-level `basecamp_clone.md`, inside the existing `web/studio` frontend,
**without replacing the current default Team HQ experience**, and operating on
canonical Agentic Team data.

## Baseline

| | |
|---|---|
| Branch | `claude/basecamp-team-hq` |
| Base commit | `3c9415084f4b2664bf8147d995412609e58a24f8` |
| Base commit subject | docs: add Basecamp-inspired interface implementation specification |
| Remote main at start | same SHA |
| Spec | `basecamp_clone.md`, 752 lines, read in full |
| Baseline `npm run smoke` | PASS — every route renders, nothing thrown |
| Chromium | 141.0.7390.37 via `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` |

## Parallel workstream isolation

A separate Claude Code Cloud session owns the **Human Simulation / Shadow
Grant** harness. That session owns behavioural simulation, the evaluator and
judge, agent semantics, routing/delegation and its corpora.

**This branch must not modify:** `src/agents/**`, routing/delegation, the
evaluator, human-simulation harness, Shadow Grant corpora, production worker
behaviour, or `migrations/` unless genuinely unavoidable.

`scripts/verify/**` is shared ground. This workstream touches only
frontend/browser/visual verification files it needs.

---

## Architecture facts established by inspection (not assumed)

1. **Deployment.** `scripts/deploy/hq.ts` walks `web/studio` and uploads every
   file **twice** — once at the deployment root (`app.js`) and once under
   `studio/` (`studio/app.js`). `web/studio/index.html` ships as root
   `index.html` and as `studio/index.html`.
2. **Asset resolution.** `index.html` links root-absolute `/tokens.css`,
   `/skins.css`, `/studio.css`, `/fonts/fonts.css` and `/app.js`. Root-absolute
   means asset resolution is **independent of the visited path** — a nested
   experimental route needs no asset changes.
3. **SPA rewrite.** `vercel.json` rewrites
   `/:path((?!api/|studio/|samples/|fonts/)[^.]*)` to `/index.html`. A
   dotless path that does not begin `api/`, `studio/`, `samples/` or `fonts/`
   therefore boots the same SPA. `/basecamp/...` qualifies; `/studio/basecamp/`
   does **not** (excluded from the rewrite, and it is a real static directory).
4. **Routing is centralised.** `goToPath(path)` (app.js:8541) parses
   `location.pathname` into `state`; `pathNow()` (app.js:8522) writes it back;
   `keepUrl()` pushes/replaces on every paint. Two functions, not forty call
   sites.
5. **`keepUrl()` writes the path only** — it discards the query string. So
   `?experience=basecamp` would be **erased on the first render**. A query-param
   experience flag is architecturally hostile here; a path prefix is not.
6. **Persistent DOM outside `#root`.** `dock`, `undobar`, `#settings`,
   `#viewer` and `droplayer` live outside `#root` because `render()` replaces
   everything inside it. This lifecycle must survive.
7. **Monoliths.** `app.js` is 607 KB, `studio.css` is 325 KB. The spec forbids
   appending another all-screen implementation to either.
8. **Local harness servers have no SPA fallback.** `smoke.ts`, `studio.ts`,
   `controls.ts`, `layouts.ts` each embed their own `createServer` that 404s any
   path that is not a file on disk, and they all navigate to `/` and drive state
   in-page. Capturing a deep experimental path locally needs a server with a
   fallback.

---

## Decisions

### D1 — experimental address is the path prefix `/basecamp`

Chosen after inspecting the real deployment, not invented. Rationale:

- the SPA rewrite already routes it to `index.html`, so no `vercel.json`
  change and no new deployment entry is needed;
- assets are root-absolute, so they resolve identically at any depth;
- one codebase, one router, one backend, one set of data adapters;
- the default routes (`/`, `/tasks`, `/activity`, `/p/:slug[/:tab]`) are
  untouched, so the production experience cannot be silently replaced;
- rejected `?experience=basecamp` because `keepUrl()` drops the query;
- rejected `/studio/basecamp/` because `studio/` is excluded from the rewrite.

### D2 — the experience is a presentation layer over the same state

`goToPath` sets an experience flag and then parses the remainder exactly as
today. Same `state`, same data adapters, same mutations. The Basecamp-inspired
shell is a different renderer over the same canonical model, not a fork.

---

## Failure register (pre-mortem — defended against continuously)

| | Failure | Defence in this run |
|---|---|---|
| A | Basecamp-coloured generic dashboard | judge IA and interaction grammar before cosmetics; Overview is a live table of contents |
| B | polished but wrong density | use the spec's measured geometry; measure with `probe`/`space`, never "looks good" |
| C | clone theatre | real APIs; a control with no effect is not complete |
| D | destructive replacement | alternate address first; preservation matrix; no default cutover |
| E | capability regression hidden by new navigation | preservation matrix below |
| F | monolith inflation | new modules under `web/studio/basecamp/`; no all-screen append to app.js |
| G | desktop success, responsive failure | build mobile concurrently; four viewports |
| H | screenshot overfitting | adversarial content and edge states |
| I | accessibility sacrificed | part of the target, not cleanup |
| J | all features everywhere | progressive disclosure |
| K | domain collapse | project tasks / My Tasks / agent jobs stay distinct |
| L | provenance loss | Add to project is idempotent and keeps lineage |
| M | route/deployment collision | route smoke tests for both addresses |
| N | CSS cascade regression | scoped experience root; token layer |
| O | tests certify DOM not experience | captures inspected, not archived |
| P | endless beautification | vertical slice first |

---

## Preservation matrix

Every destination reachable in the default experience today. The experimental
experience must reach each one, or record an explicit exception.

| Destination | Default route | In the experiment |
|---|---|---|
| Portfolio / home board | `/` | `/basecamp/` — own surface |
| Cross-project Tasks | `/tasks` | `/basecamp/tasks` — own surface, distinct domain |
| Activity / Lately | `/activity` | `/basecamp/activity` — own surface |
| Project Overview | `/p/:slug` | `/basecamp/p/:slug` — the landing surface |
| Project — AI Team | `/p/:slug/team` | own surface |
| Project — Documents | `/p/:slug/documents` | own surface |
| Project — Tasks | `/p/:slug/tasks` | own surface, full journey |
| Project — Contacts | `/p/:slug/contacts` | own surface |
| Project — Sources | `/p/:slug/sources` | own surface |
| Project — Project Settings | `/p/:slug/settings` | hand-off to the current Team HQ |
| Team board / chat / jobs / outputs | sub-views of `team` | hand-off to `/p/:slug/team` |
| Dock (team conversation) | persistent, outside `#root` | **Ask the team**, top row on desktop, tray on phone |
| Undo bar | persistent, outside `#root` | survives the render — asserted |
| Settings page | page, not route (#158) | reachable from the default experience; not duplicated |
| Document viewer | persistent `#viewer` | survives the render — asserted |
| Drop-to-upload layer | persistent `droplayer` | survives the render — asserted |

Verified by `npm run verify:basecamp-preservation` — 26/26, including that every
hand-off names a destination the default router actually has, swept across
every owned surface rather than the overview alone.

**Two defects this matrix caught**, both of which looked finished:

1. The dock survived the experimental render and had no door into it. A
   capability that exists in code and cannot be found is Failure E.
2. Work Board, Project Chat, Active jobs and Outputs were listed as project
   tools with hand-offs to `/p/:slug/board` and friends. None of those is a
   section — they are `TEAM_VIEWS`, sub-views of AI Team — so the default
   router dropped all four on the project overview. Four links, four wrong
   destinations, all rendered and pressable.

---

## Gates

| Gate | Result | What it covers |
|---|---|---|
| `verify:basecamp-routes` | 15/15 | both addresses boot, assets resolve, the default is untouched |
| `verify:basecamp-actions` | 3/3 calls | every action and required argument exists at the gateway |
| `verify:basecamp-journey` | 23/23 | the task journey end to end in a browser, over real HTTP |
| `verify:basecamp-keyboard` | 25/25 | skip link, focus, trap, keyboard map, reduced motion, 200% zoom |
| `verify:basecamp-preservation` | 26/26 | every destination reachable; hand-offs resolve; default unchanged |
| `basecamp:measure` | no violations | geometry at 1440×900, 1024×768, 768×1024, 390×844 |
| `smoke` · `lint` · `typecheck` | exit 0 | |
| `npm test` | 2207/2207 tests | one FILE fails to load: `tests/sessions/weather-is-not-a-failure.test.ts` needs `SUPABASE_ACCESS_TOKEN`; sessions harness, untouched here |
| `verify:design` | 18/20 | identical on this branch and on the baseline; both failures need credentials |

Every detector added by this run has been **proved able to fail** by a
sabotage whose own effect was printed first — a sabotage that does not apply
is not a passing control.

| Detector | Sabotage | Result |
|---|---|---|
| `verify:basecamp-actions` | call a non-existent action | red, naming it |
| `verify:basecamp-actions` | misspell a required argument | red, naming it |
| `verify:basecamp-journey` | remove the optimistic rollback | red, 22/23 |
| `verify:basecamp-preservation` | point the team sub-views at their own ids | red, naming all four |
| `tests/studio/command.test.ts` | push a dead-view row into the command bar | red, naming `desk` |

---

## Defects found, and how

Not one of these was found by reading the code.

| # | Defect | Found by |
|---|---|---|
| 1 | phone top row collided by 26px — a fixed 166px centre column against 108px sides | measuring |
| 2 | 19 controls between 22 and 37px on a 768px tablet — the 44px floor was scoped to a width, not a pointer | measuring |
| 3 | `.bcpmeta`/`.bcptitle`/`.bcpexcerpt` written as descendant selectors, used by six callers outside that descendant — every caption rendered as 16px body text | opening the capture |
| 4 | `.bcpreview` as `display:block` — a button centres its content, so sparse previews floated in the middle of a 324px tile | opening the capture |
| 5 | the portfolio borrowed the overview's 324px tile height and gave a two-line project 300px of nothing | opening the capture |
| 6 | `act('my_task_state')` — no such action; that control could never have worked, and the comment above it asserted a design ADR-0041 rejects | reading the gateway |
| 7 | Escape after Shift+J dropped focus on `body`, because opened by shortcut there is no invoker | the keyboard sweep |
| 8 | the dock survived the render with no way to open it | the preservation check |
| 9 | four hand-off links named routes the default router does not have | the preservation check |
| 10 | the "Running work" paragraph ran 170 characters across the full desktop measure | opening the capture |
| 11 | the phone top row collapsed the jump control to "J…" once a fourth control joined it | opening the capture |

Two findings were **read off a capture and were wrong**, and were discarded
after measuring:

- the overview's second row of tiles looked unequal in height; they are
  identical at 366px;
- the phone's fixed tray looked as though it overlapped the task list; that is
  an artefact of a full-page capture of a fixed element, and the viewport
  capture shows it correctly at the foot.

---

## Evidence index

Captures land in `.out/basecamp/`, 44 per run — eleven screens at four
viewports, each as a viewport shot and a full-page shot. Screens: home,
project overview, tasks, tasks mid-creation, team, documents, sources,
activity, my tasks, jump closed and jump filtered.

`npm run basecamp:shots` passes and fails nothing. It reports page errors and
names any screen it could not capture rather than dying on the first one — a
screen with no capture is a screen nobody is watching.

Inspected this run at desktop and phone: home, overview, team, tasks
mid-creation, jump filtered. Each finding above records which.

---

## HUMAN_BLOCKED

Each of these needs one credential, not more work. Everything else continued.

| Item | Why | What unblocks it |
|---|---|---|
| Proving the journey against the **production office** | no `HQ_API_TOKEN` in this environment | a token; then run `verify:basecamp-journey` against the real gateway |
| A **public preview URL** | no `VERCEL_TOKEN` | a token; the experience is already part of `deploy:hq`'s upload — `web/studio/bc/**` is walked with everything else, so no deploy change is needed |
| `verify:design`'s two failures | one needs the deployed site, one needs `SUPABASE_ACCESS_TOKEN` | identical on the baseline; not caused here |
| `tests/sessions/weather-is-not-a-failure.test.ts` | needs `SUPABASE_ACCESS_TOKEN` to load | sessions harness — Shadow Grant's ground, untouched |

**Harness caveat, not a product defect.** Chromium in this sandbox renders a
native date input as `mm/dd/yyyy` regardless of the context locale or
`--lang=en-GB`. The format is the browser's, not the page's; Grant's own
browser will show `dd/mm/yyyy`. Captures of the task form misrepresent that
one field.

---

## NEXT ACTION

Phase 5 — the agent-output journey — then the adversarial and edge-state
sweep, then the old-frontend regression pass.
