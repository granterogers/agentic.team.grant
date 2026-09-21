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

| Destination | Default route | Status in experiment |
|---|---|---|
| Portfolio / home board | `/` | pending |
| Cross-project Tasks | `/tasks` | pending |
| Activity / Lately | `/activity` | pending |
| Project Overview | `/p/:slug` | pending |
| Project — AI Team | `/p/:slug/team` | pending |
| Project — Documents | `/p/:slug/documents` | pending |
| Project — Tasks | `/p/:slug/tasks` | pending |
| Project — Contacts | `/p/:slug/contacts` | pending |
| Project — Sources | `/p/:slug/sources` | pending |
| Project — Project Settings | `/p/:slug/settings` | pending |
| Project — Team board | `/p/:slug/board` | pending |
| Project — Chat | `/p/:slug/chat` | pending |
| Project — Active jobs | `/p/:slug/jobs` | pending |
| Project — Outputs | `/p/:slug/outputs` | pending |
| Dock (team conversation) | persistent, outside `#root` | pending |
| Undo bar | persistent, outside `#root` | pending |
| Settings page | page, not route (#158) | pending |
| Document viewer | persistent `#viewer` | pending |
| Drop-to-upload layer | persistent `droplayer` | pending |

---

## Evidence index

Captures land in `.out/basecamp/`. Each entry below is written only after the
image has been **opened and inspected**, per §14A — an unreviewed capture is a
failed visual-verification phase.

_(none yet)_

---

## HUMAN_BLOCKED

_(none yet)_

---

## NEXT ACTION

Establish the `/basecamp` route and prove both addresses boot, before any
visual work.
