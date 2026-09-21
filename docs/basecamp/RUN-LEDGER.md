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

`npm run basecamp:gate` runs the eight this workstream owns, in order.

| Gate | Result | What it covers |
|---|---|---|
| `verify:basecamp-classes` | clean | every class the markup names is defined in the stylesheet |
| `verify:basecamp-actions` | 4 calls clean | every action and required argument exists at the gateway |
| `verify:basecamp-covered` | clean | every rendered surface has a capture at every viewport |
| `verify:basecamp-routes` | 50/50 | both addresses boot; every tool address renders what it names; hand-offs correct the URL; every Jump result goes somewhere of its own; a record round-trips through Back and a reload; no surface sits on a skeleton |
| `verify:basecamp-controls` | 250 pressed, 0 findings | every visible control at desktop and phone changes something, or is marked current |
| `verify:basecamp-journey` | 51/51 | the task journey, the record page and the agent-output journey, in a browser over real HTTP |
| `verify:basecamp-keyboard` | 31/31 | skip link, focus, trap, keyboard map, full search, reduced motion, 200% zoom |
| `verify:basecamp-preservation` | 26/26 | every destination reachable; hand-offs resolve; default unchanged |
| `verify:basecamp-states` | 64/64 | adversarial content and the §12 states at three widths |
| `basecamp:measure` | no violations | geometry at four viewports; chips are chips; the card treatment and full bleed agree; one fixed bottom bar; the experience does not follow the studio's scheme |

Repository gates, run on this branch:

| Gate | Result |
|---|---|
| `smoke` · `lint` (`biome ci`) · `typecheck` | exit 0 |
| `npm test` | 2207/2207 tests; one FILE cannot load without `SUPABASE_ACCESS_TOKEN` |
| `verify:wired` | 77 control attributes across 21 screens, no dead controls |
| `verify:layouts` | 64 states, 0 findings |
| `verify:controls` | 37 + 21 + 71 pressed, 0 unpressable, 0 findings |
| `space` | clean |
| `verify:design` | 18/20 — identical on the baseline; both failures need credentials |
| `verify:arrangement` | could not run — needs `SUPABASE_ACCESS_TOKEN` |

### Every detector was proved able to fail

A sabotage that does not apply is not a passing control, so each one printed
its own effect before the check ran.

| Detector | Sabotage | Result |
|---|---|---|
| `verify:basecamp-actions` | call a non-existent action | red, naming it |
| `verify:basecamp-actions` | misspell a required argument | red, naming it |
| `verify:basecamp-journey` | remove the optimistic rollback | red, 1 check |
| `verify:basecamp-journey` | make the office non-idempotent | red, 1 check |
| `verify:basecamp-preservation` | point the team sub-views at their own ids | red, naming all four |
| `verify:basecamp-classes` | misspell one class | red, naming it |
| `verify:basecamp-states` | clamp `.bcitemtitle` to 20px | red, 9 checks |
| `basecamp:measure` | reuse the tray class for a link row | red, naming it |
| `verify:basecamp-routes` | stop kicking the My Tasks read | red, naming the surface |
| `tests/studio/command.test.ts` | push a dead-view row into the command bar | red, naming `desk` |

**One sabotage did not prove anything and was replaced.** Forcing
`signedIn = true` on My Tasks left the skeleton check green, because the read
then ran, failed and rendered an error state. Only removing the call that
kicks the read reproduced the original defect. A sabotage has to exercise the
path the check claims to cover, not a neighbour of it.

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
| 12 | `.bcprose` was written against an anchor an earlier edit had renamed, so the rule never existed while five callers named it | opening the capture |
| 13 | `.bcskelwrap` and `.bcaddform` named and never defined | the new class check, on its first run |
| 14 | the project's hand-off links reused `.bctray`, which the phone rules make a fixed bottom bar — so at 390px they were lifted out of the page and hidden under the real tray | opening the phone capture |
| 15 | `Shift+Enter` promoted the query to `/?q=`, which nothing reads and `keepUrl` strips — the search was silently discarded | reading the default studio |
| 16 | emptying the assignee sent null, which `hq_task_update` treats as "leave it alone", so a cleared field saved nothing | reading the RPC signature |
| 17 | the task record's Open control was drawn only where `t.id` existed, and no prototype task has one — the whole screen was in no capture on any viewport | a capture run reporting what it could not reach |
| 18 | My Tasks showed a skeleton that never resolved: the read was kicked on navigation and by nothing on arrival, and signed out there is no list to read at all | opening the capture |
| 19 | a status chip stretched to fill its grid cell at every viewport — 299px for the word "Blocked" — so it read as a progress bar | measuring |
| 20 | at 1024 and 768 the main surface ran edge to edge while keeping a card's radius and shadow, destroying the canvas/surface relationship | opening the capture |
| 21 | the Overview was six bordered boxes in a 3×2 grid — the card wall §14 forbids by name | comparing two variants side by side |
| 22 | `/basecamp/p/:slug/settings` rendered the Overview **while the address went on saying `/settings`** — a bookmark permanently lying about what it opens | probing every address |
| 23 | Contacts, one of six rendered tools, was in no capture at all | comparing the capture list against the tool list |
| 24 | every list row answered the pointer, including the four tools whose rows lead nowhere — a destination promised and not there | opening the Contacts capture |
| 25 | the experiment marked **nothing** as current: no `aria-current` anywhere, while the default studio's rail has carried it since it was written | the new control audit |
| 26 | a task record was not in the address, so it could not be linked, a reload lost it, and Back left the application entirely | probing history behaviour |
| 27 | **eight Jump results all navigated to the home page** — every specialist row, in the one surface built entirely out of destinations | opening the Jump capture |
| 28 | Jump's four direct destinations sat below the fold of a 495px sheet, behind eight rows that were not destinations | opening the Jump capture |
| 29 | the sticky shell named no project, so scrolling an overview lost the container entirely | measuring the scrolled state |
| 30 | five repeated "Open" words down a task list, with the row's content pushed left | opening the capture |

Two of my own regressions were caught by the geometry check on the run after
I wrote them: the named jump control overlapping the attention control by
15px at 768, and then overlapping both neighbours by 10px at 390 once it was
centred at its natural width. That check measures overlap rather than only
overflow, and this is what the distinction is for.

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

Re-checked on 21 September 2026 at commit `e15f13d`. **Both items are blocked
twice over**, and the second blocker is the one that matters: even handing
this session a token would not unblock it.

| Item | Missing credential | And also |
|---|---|---|
| Deploy a Vercel preview | no `VERCEL_TOKEN` | the environment's egress policy refuses `api.vercel.com` and `vercel.app` — `403` at CONNECT |
| Exercise the real backend | no `HQ_API_TOKEN`, no `SUPABASE_ACCESS_TOKEN` | the same policy refuses `baujwlzcziasnfhhkchg.supabase.co` and `supabase.com` |

Verified rather than assumed: `registry.npmjs.org` returns 200 and GitHub is
reachable through the same proxy, so the network works and these four hosts
specifically are denied. The proxy's own status endpoint lists each refusal by
host. Its README says to report a policy denial rather than work around it.

**What this prevents, exactly:**

- there is no live URL for the experimental experience, and none for a
  preview of this branch;
- no journey has been run against Grant's real projects, tasks, documents or
  outputs — every capture and every check uses the studio's example projects
  or an in-process stand-in that speaks the gateway's contract;
- `verify:design`'s deployed-page check and `verify:arrangement` cannot run.

**What unblocks it:** a session whose egress policy permits `vercel.app` and
`supabase.co`, carrying `VERCEL_TOKEN` and `HQ_API_TOKEN`. No code change is
needed — `deploy:hq` already walks `web/studio/**` recursively, so
`web/studio/bc/**` ships with everything else.

**In the meantime**, the captures are published as a review gallery so the
§19.9 decision can be made by looking:
<https://claude.ai/artifact/3syBAAQ7DqFMDuB9SUhhsn>. It states on its face
that it is screenshots and not a running app.

**Three generated audit reports were reverted, deliberately.** Running
`verify:controls` on this branch rewrites `docs/testing/controls-*.md`, and
the only differences were caused by this environment rather than by this
branch: the provenance line degrades from
`web/hq read from: 16/16 live projections` to `empty (no SUPABASE_ACCESS_TOKEN)`.
Committing them would replace a record made with credentials by a worse one
made without, so they are restored to the baseline each time. Re-generate them
where the token exists. The counts on this branch were 37 / 21 / 72 controls
pressed with 0 unpressable and 0 findings, and `verify:wired` (77 attributes,
21 screens) and `verify:layouts` (64 states, 0 findings) are unchanged.

_(A run on 21 September briefly showed 71 rather than 72 on one route. A later
run of the same command on the same commit showed 72 again, so that was
run-to-run variance in the audit and not an effect of this branch.)_

**Harness caveat, not a product defect.** Chromium in this sandbox renders a
native date input as `mm/dd/yyyy` regardless of the context locale or
`--lang=en-GB`. The format is the browser's, not the page's; Grant's own
browser will show `dd/mm/yyyy`. Captures of the task form misrepresent that
one field.

---

## §20 Discrepancy analysis — the reference slice against real Basecamp

Written 21 September 2026, **before any code was changed**, after studying the
nine reference screenshots Grant supplied and after reading the canonical data
model rather than guessing at it. §20 asks for this to be critical. The tests
are green and 30 defects were found and fixed, and none of that is evidence
about the thing the redesign prompt is actually complaining about, so none of
it appears below as a defence.

**The correction in one sentence.** I built an attractive directory of places
you can navigate to. Basecamp builds a page where the project itself is
present. Every discrepancy below is a consequence of that one reading.

**The structural proof of it, and it is not an impression.** `shell.js` has a
single preview primitive:

    const row = (title, meta, extra = '', done = false) => …

and all six previews call it. `tasksPreview`, `teamPreview`,
`documentsPreview`, `activityPreview`, `contactsPreview` and `sourcesPreview`
differ only in which fields they join into `meta` with a middle dot. So the
six tiles on the project home are, at the DOM level, the same tile six times.
That is the generic-dashboard failure stated as a fact about the source, and
it is why no amount of capture-reading found it: every tile is individually
well-formed, legible, non-overflowing and accessible. The defect is that they
are interchangeable.

### 1. Information density

Basecamp's project home carries far more per screen than mine, and does not
read as busy. Its To-dos tile shows lists with names and several tasks under
each; its Card Table tile shows columns with counts; its Calendar tile shows a
dated agenda. Mine shows five lines of `title · meta` per tool and then a
grey "3 more open". I cut density in the name of calm and got sparseness,
which §3 names exactly. The room exists: the 324×324 tile is barely half used
in the tasks tile in every capture.

### 2. Project-at-a-glance comprehension (the 5–10 second test)

Mine fails it. Reading my Overview tells you which tools this project has and
one sample row from each. It does not tell you whether the project is on
track, what is late, who is waiting, or what happened yesterday. The
information needed to answer that is already in the payload — `state_raw`,
`due_on`, `blocked`, `waiting`, `activity` — and the composition spends it on
one row apiece instead of aggregating it.

### 3. Visual hierarchy

Six equal tiles in a three-column grid is an explicit statement that the six
tools are equally important, which is false for every real project. Basecamp's
own home is not equal-weight: the tools most used sit first and the
composition is asymmetric. I have no mechanism for "this project is mostly
to-dos" because the layout is hard-coded in `overview(p)` rather than read from
the stored arrangement — see 13.

### 4. Live content vs navigation

This is the central charge and it lands. My tiles are affordances with a
content sample inside them; Basecamp's tiles are the content, and the content
is the affordance. Concretely: in mine, ticking a task is impossible from the
Overview — you press the tile, land on the tasks surface, and tick it there.
Two navigations to do the thing the tile is showing you. §4 says content is the
affordance, and mine puts a link in front of the content.

### 5. Tool-specific visual grammar

Absent, per the `row()` proof above. What each tool should look like, from the
screenshots: To-dos is nested lists with checkboxes and per-list progress;
Card Table is columns with stage names and counts; Calendar is dated, with the
month legible; Documents is thumbnails and file identity, not a text row;
Activity is a chronological timeline with time on one axis; Chat is speech
with avatars. Six grammars, one of which (Documents) I already have the
machinery for — `pageSvg(title, kind)` in `app.js` generates document page
illustrations and the Basecamp slice does not use it.

### 6. To-do category / list structure

**My model is flat and it is wrong.** `tasksPreview` and `tasksSurface` treat
a project as a bag of tasks. §6 requires PROJECT → LIST → TASK, and the
screenshot of the full To-dos tool shows named lists with their own
descriptions and completion counts.

**This needs no new backend contract, and I confirmed that rather than
assuming it.** `migrations/0171_a_task_is_a_first_class_thing.sql` adds
`is_milestone boolean not null default false` and
`parent_task_id uuid references public.tasks(task_id)`, with the comment *"A
milestone is a task with no work of its own that others hang off, rather than
a separate table."* `app.studio_modules(p_project_id)`
(`0286_a_module_is_a_milestone_that_gathers.sql`) already returns
`{id, n, name, state, docs, tasks}` per milestone, and `app.studio_tasks()`
already returns `milestone` and `parent` on every row. The hierarchy has been
in the database since 0171 and the Basecamp slice ignored it. That is the
worst finding in this analysis: not a missing capability, a capability I did
not look for.

### 7. Team / chat presence

My `teamPreview` prints crew names as text rows. There are no faces on the
project home at all, although `CREW[].face` exists and the default studio uses
it. Basecamp's chat tile makes the team feel present — avatars, names, the
last few utterances, a timestamp. Mine makes the team feel like a list of
assignees. And project chat history exists as a real reader
(`project_history`, argument `p_project`), which the Basecamp slice does not
call: the project surface has no chat at all, so §7 is not under-built, it is
unbuilt.

### 8. Agentic Team presence

Closest to right, and still framed wrongly. §8 asks for the agents as native
project participants. `teamPreview` reads roster state, blockers and the
latest output, which is the right material — but it renders them in the same
`row()` as documents and contacts, so an agent reads as a database record
rather than as a colleague. No face, no voice, nothing that distinguishes
"Emma is working on this" from "a row exists".

### 9. Calendar grammar

There is no calendar. Dates appear as `t.due` inside a task's meta string,
which is the opposite of temporal: it is a date used as an adjective.
`app.studio_tasks()` returns both `due_on` and `starts_on`, so a month grid or
a dated agenda is buildable from real records today.

**The one genuine missing contract, documented rather than faked:** there is
no *events* table. The office has dated work (tasks with `due_on` /
`starts_on`) and no notion of a meeting or an appointment. So a Calendar built
here can honestly show scheduled work and must not pretend to show a diary.
§19 requires that gap be stated on the surface rather than filled with
invention.

### 10. Card Table grammar

There is no card table. The stages exist as real data — `state_raw` is the
enum `todo | doing | blocked | done | cancelled` — so the compressed
workflow-state summary §10 asks for is derivable now, with no new contract and
no invented vocabulary. My tasks tile collapses all five states into
"open / done", which discards precisely the information a workflow summary is
made of.

### 11. Documents grammar

`documentsPreview` renders a document as `title · kind · origin · size`. A
document should look like a document. `pageSvg(title, kind)` already exists in
`app.js` and already generates a page illustration per kind; the slice renders
text instead. This is the cheapest of the seventeen to fix and among the most
visible.

### 12. Activity grammar

`activityPreview` renders `"${who} ${verb} ${what}"` with the time as meta —
so the time, which is the axis the whole tool is organised around, is a
trailing grey fragment. Basecamp's My Activity screenshot is a chronological
story with the day as a structural element. Mine is a list of sentences that
happen to be in order. Related and separately wrong: the same six-row list
appears in both the tile and the full surface, which is the duplicated-screen
class I was hunting last pass and did not recognise here because both copies
are correct.

### 13. Configurable tools

Not built. `overview(p)` hard-codes the tool order, so Grant cannot add,
remove or reorder anything on his own project home — §14 requires all three.
The contract exists: `plane_layout` / `hq_plane_layout` read, with
`plane_layout_set` and `plane_layout_reset` as writers. §14's hard constraint
is the one to encode structurally rather than to remember: **removing a tool
from the home must not delete the underlying records**, so visibility has to
be a layout concern that no delete path can be reached from.

### 14. External services

Not built, and the trap is named in advance. §15 asks for a simple chooser in
the user's language. The sources tile currently prints `s.kind` straight from
the record, which is how developer terminology reaches a project surface
without anybody deciding to put it there. Two absolutes: no API keys, scopes
or OAuth vocabulary on the project surface, and no service offered as
available when it is not connectable.

### 15. Unnecessary navigation and chrome

My shell is defensible and still louder than Basecamp's. The tray repeats what
the Overview already offers, so the same six destinations are reachable twice
within one viewport — and because my tiles are navigation rather than content,
the tray and the tiles are doing the *same job*, not two jobs. §16 says the
project must dominate the chrome. Today the chrome and the project are about
equal in ink.

### 16. Desktop first viewport

At 1440×900 the first screen shows a header, a tray, and six near-identical
tiles each with up to five thin rows. Roughly half of each tile is empty. A
person looking at that screen learns the project's shape and nothing about its
state. §17 permits substantial desktop redesign and this is the screen that
needs it.

### 17. Mobile first viewport

At 390×844 the six tiles stack, so the first screen is the header plus one and
a half tiles — and which tool comes first is an accident of the hard-coded
order rather than a decision about what matters on a phone. §18 gives a
priority order and the current build has no concept of priority to apply it
to. Mobile is where the sparseness costs most: one tile per screen means six
screens of scrolling to learn what one desktop screen could say.

### What this analysis changes about the next step

The fix is not six better tiles. It is a different composition, which is why
§21 asks for two materially different experiments before any of the seventeen
above is addressed individually. Anything built before that choice is made
would be built against the layout I am being told is wrong.

---
## NEXT ACTION

**§21 — two materially different Overview compositions, before anything else.**
Build both, capture each at 1440x900 and 390x844, open the captures, choose
one, and record in this ledger why the winner won and what the loser was
better at. Only then implement the tool-specific grammars.

The §20 analysis above is the input to that choice. The three findings that
constrain it: the To-do hierarchy already exists in the database (0171 /
0286), Card Table stages already exist as `state_raw`, and there is no events
table, so Calendar may show scheduled work and must say that is what it is
showing.

Still not to be merged, still not promoted to the default route, and the
default Team HQ stays untouched.
