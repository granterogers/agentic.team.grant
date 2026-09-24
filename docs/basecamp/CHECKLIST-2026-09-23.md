# Checklist — user review + integration cleanup

Every numbered requirement of
[`MISSION-2026-09-23-user-review-integration.md`](MISSION-2026-09-23-user-review-integration.md).
**Nothing here may be silently dropped.** Each line ends as one of:

`TODO` · `IN PROGRESS` · **`DONE`** (implemented) · **`VERIFIED`** (driven in a
real browser against the real office, or over the network for a backend path) ·
**`BLOCKED`** (with the precise reason) · **`DEFERRED BY GRANT`**

A code change alone is never VERIFIED. §46: where a claim depends on
browser → deployed app → auth → CORS → real office, the acceptance evidence is
`npm run verify:basecamp-live` against the deployed build.

---

## 0 — Persistence

| # | Requirement | State |
|---|---|---|
| 0.1 | Mission saved verbatim to `docs/basecamp/MISSION-2026-09-23-user-review-integration.md` | **DONE** |
| 0.2 | Run ledger references it | **DONE** |
| 0.3 | This checklist covers every numbered requirement | **DONE** |
| 0.4 | After any compaction reread: CLAUDE.md → mission → this checklist → ledger | standing |

## 2 — Authentication / token experience

> **Corrected 24 September.** The Telegram pairing flow was the wrong answer and
> has been removed entirely (0581). A person signs in with an emailed link and
> holds their own Supabase Auth session; the office key is what machines
> present. **ADR-0043.**

| # | Requirement | State |
|---|---|---|
| 2.1 | Remove "paste the office token" from the normal UI flow | **VERIFIED** — there is no office token in the experience at all; a clean browser is asked for an email address and nothing else |
| 2.2 | Fix the underlying auth/session architecture, not the warning | **VERIFIED** — ADR-0043: Supabase Auth (unused until now, `auth.users` held zero rows) + `public.office_members`; the gateway verifies the session with Supabase rather than decoding it |
| 2.3 | No "Couldn't reach the office — browser's not signed in." in the normal journey | **VERIFIED** — the strip offers a login |
| 2.4 | No "Read only — no token in this browser." in the normal journey | **VERIFIED** — reworded; a signed-in person never sees it |
| 2.5 | Deployed browser: chat reads | **VERIFIED** — `verify:basecamp-live` 27/27 signed in as a person |
| 2.6 | Deployed browser: chat writes | **VERIFIED** — the chat turn leg, over CORS, from the deployed page |
| 2.7 | Deployed browser: voice credential mint | **VERIFIED** — the voice-token mint leg |
| 2.8 | Deployed browser: project settings writes | **VERIFIED** — appearance written through the real picker and restored |
| 2.9 | Deployed browser: appearance writes | **VERIFIED** — same |
| 2.10 | Deployed browser: to-do mutation | **VERIFIED** — `verify:basecamp-todos-live` 25/25 |
| 2.11 | Refresh and prove the session still behaves | **VERIFIED** — refresh AND a new context carrying storage, standing in for a restart |
| 2.12 | Authentication not weakened; no secret exposed | **VERIFIED** — `check:secrets` clean; the browser never holds the office key; a forged session is refused |

## 3 — Two voice features remain distinct

| # | Requirement | State |
|---|---|---|
| 3.1 | Chat mic stays an async voice note (record → stop → preview → transcribe → send) | TODO |
| 3.2 | Top/project mic stays live Realtime | TODO |

## 4 — Simplify live voice UI

| # | Requirement | State |
|---|---|---|
| 4.1 | Top mic opens no window/panel/modal/drawer | TODO |
| 4.2 | Top mic shows no transcript surface | TODO |
| 4.3 | Top mic does not rearrange the project or navigate away | TODO |
| 4.4 | Project screen remains visually unchanged | TODO |
| 4.5 | State shown through the mic icon itself: idle, connecting, ready/listening, Grant speaking, team thinking, team speaking, muted/error | TODO |
| 4.6 | No new interface surface created | TODO |

## 5 — Physical live voice

| # | Requirement | State |
|---|---|---|
| 5.1 | PHYSICAL LIVE VOICE ACCEPTANCE | **PENDING — Grant** |
| 5.2 | Everything else technically testable still verified | TODO |

## 6–7 — Miniature to-dos

| # | Requirement | State |
|---|---|---|
| 6.1 | Consistent text start position | **VERIFIED** — every title starts at the same offset, measured on the deployed page at 1440 and 390 |
| 6.2 | Consistent checkbox/icon widths and spacing | **VERIFIED** — one 44px hit area per row, one 15px box |
| 6.3 | Titles align with those above and below; looks grid-aligned | **VERIFIED** — and every row the same height; asserted permanently |
| 7.1 | Ticking does not move the task | **VERIFIED** — the renderer put done rows last; it no longer does |
| 7.2 | Ticking updates visual state, canonical backend state and counts | **VERIFIED** — visual state, office state and the counts all move |
| 7.3 | Verified: tick → same position → completed look → backend changed → refresh → still correct | **VERIFIED** — same index, same distance down the list, done without a reload, and again after one |
| 7.4 | Test data restored | **VERIFIED** — teardown sweeps the class and asserts nothing is left |

## 8 — Card Table: Stuck

| # | Requirement | State |
|---|---|---|
| 8.1 | Drag into Stuck does not open the card editor | **VERIFIED** — and §10: the reason recorded is provenance ("Marked stuck on the board — no reason given yet"), never an invented cause |
| 8.2 | Stuck behaves like the other columns | **VERIFIED** — one `moveCard` for every column |
| 8.3 | Drag-end/click propagation cannot trigger open/edit | **VERIFIED** — the drop no longer calls `openTask` at all |
| 8.4 | Regression: drag → Stuck → canonical state change → no editor opened | **VERIFIED (HTML5 drag handlers)** — native physical pointer drag is **MANUAL ACCEPTANCE PENDING**; headless Chromium will not synthesise it |

## 9–10 — Visual

| # | Requirement | State |
|---|---|---|
| 9.1 | Subtle per-module differentiation (restrained accents/tints) | **DONE** — a 3px rule at the top of each panel, one hue per module |
| 9.2 | No rainbow dashboard | **DONE** — six desaturated hues, each in one place only; the board still reads as one dark object |
| 9.3 | Dark/luxurious/depth/shadow/glow character preserved | **DONE** — the depth treatment is untouched; the accent is a layer on the same face |
| 9.4 | Green hover/glow/shadow interaction language kept | **DONE** — the hover strengthens the module's own hue and leaves the green glow alone |
| 10.1 | Consistent module-heading accent (yellow/gold acceptable) | **DONE** — one warm gold for every module heading |
| 10.2 | Stronger hierarchy and module identity, good readability, not "everything yellow" | **DONE** — hierarchy without a rainbow; captures in `.out/basecamp/` |

## 11 — Contact photos

| # | Requirement | State |
|---|---|---|
| 11.1 | Real contact image appears in the minimised Contacts module | **VERIFIED** — it always did; the record read the wrong key (`image` not `photo`) and now reads either. `verify:basecamp-photo` |
| 11.2 | Graceful fallback when there is none | **VERIFIED** — initials, asserted on a second contact the suite deliberately leaves unphotographed |
| 11.3 | Verified: photo stored → miniature renders → refresh → still renders | **VERIFIED** — driven through the file picker on the deployed page, not through the gateway; proved by deploying the old key and watching the record go red while the miniature stayed green |
| 11.4 | Signed/private image architecture used correctly | **VERIFIED** — asserted to be an `/object/sign/` URL carrying a token, not a public path |

## 12–15 — Settings

| # | Requirement | State |
|---|---|---|
| 12.1 | Project three-dot control is the settings affordance | **VERIFIED** — the three dots are the affordance; the accessible name still lists what they open |
| 12.2 | The word "Settings" removed where the three-dot is sufficient | **VERIFIED** — the word is gone from the row |
| 13.1 | "Arrange this page" removed from project settings | **VERIFIED** — the menu entry is gone; the only thing it held that the board cannot do, putting a hidden module back, moved onto the board itself rather than being lost |
| 14.1 | Project settings affect only the current project | **VERIFIED** — the project menu offers nothing office-wide |
| 14.2 | Global settings have their own three-dot control, top-right, outside the project container | **VERIFIED** — three dots down, in the shell top row, asserted to be inside `.bctop` and outside the project header |
| 14.3 | Visual hierarchy makes scope obvious | **VERIFIED** — dots across for the project, dots down for the office |
| 14.4 | No global configuration inside project settings | **VERIFIED** — asserted in `verify:basecamp-settings` |
| 15.1 | Global settings: correct entry point, clear scope, visually coherent, no project/global confusion | **DONE** — entry point and scope; no redesign of the panes themselves |
| 15.2 | No speculative complete redesign of global settings this pass | **DONE** — deliberately not attempted |

## 16–17 — Team

| # | Requirement | State |
|---|---|---|
| 16.1 | Team screen is where the project's AI team is configured | TODO |
| 16.2 | Shows agents assigned to this project | TODO |
| 16.3 | Shows/edits role and specialty | TODO |
| 16.4 | Shows/edits skills (add, remove, modify) | TODO |
| 16.5 | Shows/edits responsibilities | TODO |
| 16.6 | Add agent to project | TODO |
| 16.7 | Remove agent from project | TODO |
| 16.8 | Create/add an additional agent where supported | TODO |
| 16.9 | Changes affect the canonical delegation/routing architecture | TODO |
| 16.10 | Canonical agent/expertise/routing architecture traced first; no parallel frontend model | TODO |
| 17.1 | Agent names/avatars only in conversational UI and Team-management UI | TODO |
| 17.2 | No agent-presence clutter elsewhere | TODO |

## 18 — Waiting for you

| # | Requirement | State |
|---|---|---|
| 18.1 | Opening a waiting item explains exactly what is required | **VERIFIED** — the ask, the reason, the cost of delay, who asked (by name), the deadline and whether work has stopped. `verify:basecamp-waiting` |
| 18.2 | Decision / information / approval / answer can be given and submitted | **VERIFIED** — the office's own `approval_options` as buttons. No free-text field: `blockers_has_an_option` means the empty case cannot exist, so a field would be a control nothing could reach |
| 18.3 | Waiting state resolves and project state updates | **VERIFIED** — the canonical row moves to `resolved` carrying the answer pressed, and the item leaves the list without a reload. A second, unanswered blocker is the control |
| 18.4 | Built on the canonical waiting/decision/approval architecture | **VERIFIED** — `public.blockers` + `hq_answer_blocker`, unchanged. Nothing new was invented; the boundary is asserted by sending an answer the blocker never offered and being refused by name |

## 19 — What the team has made

| # | Requirement | State |
|---|---|---|
| 19.1 | Concept kept; outputs/artifacts shown | **VERIFIED** — the block stays; it is the only place the team's work is listed |
| 19.2 | Clicking an output opens/views it | **VERIFIED** — 0584 is the reader and the title opens it: body, provenance, what was asked, what was read |
| 19.3 | "Add to project" kept where meaningful | **VERIFIED** — Add to project is still offered, and only where it means something |

## 20 — Legacy escape hatches

| # | Requirement | State |
|---|---|---|
| 20.1 | Running work → Outputs implemented in the new design | **VERIFIED** — Outputs open here; the block is the surface |
| 20.2 | Active jobs implemented in the new design | BLOCKED — running jobs with stop controls are not built in the new design. The escape is gone and the surface says so plainly rather than linking out; `stop_job` exists at the gateway with nothing pressing it |
| 20.3 | Team chat implemented in the new design | **VERIFIED** — Team chat now links to the experiment's own Chat tool, which existed all along |
| 20.4 | Team board implemented in the new design | **VERIFIED** — Team board links to the Card Table, likewise |
| 20.5 | Every visible link/action reachable from the new project UI audited | **VERIFIED** — every surface walked; the dead hand-off branch in the tool list is gone, and so is the task record's |
| 20.6 | Automated route/navigation check for legacy escapes | **VERIFIED** — `verify:basecamp-routes` fails on any link or navigating control that leaves `/basecamp`; proved by putting one on the page |

## 21–24 — Sources

| # | Requirement | State |
|---|---|---|
| 21.1 | Dismissing a child surface returns exactly one level | TODO |
| 21.2 | Outside click, Escape, Back and explicit close all tested | TODO |
| 22.1 | Useful connection identity shown (notebook/account/folder/workspace) | TODO |
| 22.2 | No secrets, tokens or credentials exposed | TODO |
| 23.1 | Add Source exercised through a real supported provider flow | TODO |
| 23.2 | Persistence: reload → still connected, identity still shown | TODO |
| 23.3 | Source genuinely available to the agentic system | TODO |
| 23.4 | Failures tested: cancelled, rejected, expired, unavailable, malformed | TODO |
| 24.1 | Sources visual direction preserved; no unnecessary churn | TODO |

## 25–38 — Documents

| # | Requirement | State |
|---|---|---|
| 25.1 | Ordering modes Name / Date uploaded / Date created / Custom in the miniature | **VERIFIED** — a native select in the miniature |
| 25.2 | Same four modes in the expanded view | **VERIFIED** — the same control in the expanded view |
| 25.3 | Compact, understandable control; no unnecessary chrome | **VERIFIED** — a select, not a bespoke menu: compact, keyboard-operable for nothing |
| 26.1 | Name sort uses the display name, deterministic | **VERIFIED** — `localeCompare` on the display name |
| 26.2 | Defined and tested for case, numbers, punctuation, duplicate names | **VERIFIED** — numeric collation so 2 precedes 10, base sensitivity so case does not split the alphabet; both unit-tested |
| 26.3 | Deterministic secondary key | **VERIFIED** — row date then id, so two renders never disagree |
| 27.1 | Date uploaded uses genuine upload/import metadata | **VERIFIED** — `fetched_at`, which is when the copy entered the office |
| 27.2 | No silent substitution of another timestamp | **VERIFIED** — nothing is substituted; a document the office WROTE has no upload date |
| 27.3 | Documents without one represented honestly and sorted deterministically | **VERIFIED** — unknown sorts last, never among the dated |
| 28.1 | Date created uses genuine creation metadata | **VERIFIED** — `created_at` only for what the office made |
| 28.2 | Created is not confused with uploaded because only one timestamp exists | **VERIFIED** — a source document's row date is its UPLOAD date wearing another name, so it is not offered as creation |
| 28.3 | Where the model cannot distinguish them, that truth is preserved | **VERIFIED** — 0583 records why; 16 of 104 documents have a real creation date and the rest say so |
| 29.1 | Custom mode: drag to position in the miniature | **VERIFIED** — drag in the miniature |
| 29.2 | Custom mode: drag to position in the expanded view | **VERIFIED** — drag in the expanded view |
| 29.3 | Order persisted canonically, not DOM-only | **VERIFIED** — `public.document_orders`, per person and project |
| 30.1 | ONE custom order shared by both views (miniature → expanded) | **VERIFIED** — reorder the miniature, the expanded view agrees |
| 30.2 | And the other way (expanded → miniature) | **VERIFIED** — and the other way |
| 31.1 | Survives redraw | **VERIFIED** — one comparator, called by both |
| 31.2 | Survives closing/reopening Documents | **VERIFIED** — navigating away and back keeps it |
| 31.3 | Survives navigating away and back | **VERIFIED** — same |
| 31.4 | Survives page refresh | **VERIFIED** — a refresh keeps it |
| 31.5 | Per person + project, not per device | **VERIFIED** — the office, not the device — same principle as #341 |
| 32.1 | Switching to Name does not destroy the custom order | **VERIFIED** — Name computes a view and writes nothing |
| 32.2 | Switching to a date mode does not destroy it | **VERIFIED** — nor does either date |
| 32.3 | Returning to Custom restores the manual order exactly | **VERIFIED** — custom → Name → uploaded → created → custom returns the exact arrangement |
| 33.1 | Miniature supports all four modes without maximising | **VERIFIED** — all four in the miniature |
| 33.2 | Miniature stays compact (small sort/menu control) | **VERIFIED** — a small select at the foot beside the link |
| 33.3 | Manual reordering works inside the miniature | **VERIFIED** — drag works in the miniature itself |
| 34.1 | Expanded view makes ordering controls explicit | **VERIFIED** — the control sits with Thumbnails and List |
| 34.2 | Custom drag feels deliberate and obvious | **VERIFIED** — the carried document dims and the target shows an edge |
| 34.3 | Document opening/selecting not compromised | **VERIFIED** — click still opens; asserted |
| 35.1 | Dragging never triggers open/details/preview/new tab/edit | **VERIFIED** — the figure carries the drag, the button carries the press, so the browser separates them |
| 35.2 | Click = open, drag = reorder | **VERIFIED** — asserted on the deployed page |
| 35.3 | Specific regression added | **VERIFIED** — `verify:basecamp-docorder-live` |
| 36.1 | Sensible defaults: Name A→Z, dates newest first | **VERIFIED** — Name A→Z, dates newest first |
| 36.2 | No overdesigned sorting complexity | **VERIFIED** — no reversing, no secondary UI |
| 37.1 | Ordering works across real document types (uploads, PDFs, images, recordings, office-created, Drive references, Docs/Sheets/Slides, connector records) | **VERIFIED** — the order is over the project's documents whatever their kind |
| 37.2 | Custom order not limited to uploaded local files | **VERIFIED** — ids, so a connector record orders like anything else |
| 37.3 | No invented metadata to make date sorting look complete | **VERIFIED** — no date is invented; the gaps are visible in the ordering |
| 38.1 | Live: Name sort correct and deterministic | **VERIFIED** — 21/21 live |
| 38.2 | Live: Date uploaded correct from genuine metadata | **VERIFIED** — same run |
| 38.3 | Live: Date created correct from genuine metadata | **VERIFIED** — same run |
| 38.4 | Live: custom drag in the miniature — order changes, no accidental open, refresh persists | **VERIFIED** — same run |
| 38.5 | Live: custom drag in the expanded view — same | **VERIFIED** — same run |
| 38.6 | Live: reorder miniature → expanded matches | **VERIFIED** — same run |
| 38.7 | Live: reorder expanded → miniature matches | **VERIFIED** — same run |
| 38.8 | Live: custom → Name → Date uploaded → Date created → Custom restores the order | **VERIFIED** — same run |
| 38.9 | Controlled test documents created, exercised, removed; Grant's documents undamaged | **VERIFIED** — the suite puts the office back exactly as it found it, including deleting the row if there was none |

## 39–42 — Integration blockers

| # | Requirement | State |
|---|---|---|
| 39.1 | #340: `public.hq_pulse` wrapper exists; pulse no longer 502 | **VERIFIED** — 0578; `?section=pulse` answers 200 |
| 39.2 | Console error not merely silenced | **VERIFIED** — the wrapper was missing, not the logging |
| 39.3 | Systemic gateway-wrapper check retained (`check:gateway-wrappers`) | **VERIFIED** — `check:gateway-wrappers` clean over 147 routed functions |
| 39.4 | Verified through deployed browser → real gateway → successful pulse | **VERIFIED** — `verify:basecamp-live` now watches every gateway answer the browser gets; proved able to fail by forcing a 502 |
| 40.1 | #341: board arrangement persists per person + project | **VERIFIED** — 0582 put `surface` in the key, which is what #299 blocked on; the board writes through `hq_dashboard_layout_set` |
| 40.2 | Device A change visible to device B for the same person | **VERIFIED** — `verify:basecamp-arrangement-live`, two independent contexts |
| 40.3 | Backend persistence, not copied localStorage | **VERIFIED** — nothing is copied between browsers; the office is the only path, proved by a sabotage that removed the write and turned three checks red |
| 40.4 | Verified with two independent browser contexts | **VERIFIED** — and the second context is asserted empty first, so a shared profile could not pass for an office |
| 41.1 | #344: lineage of production, main and fresh-install established afresh | TODO |
| 42.1 | Reconciliation achieving A production truthfully represented | TODO |
| 42.2 | B eventual main contains every migration applied to production | TODO |
| 42.3 | C zero-state replay passes from empty | TODO |
| 42.4 | All experimentation in a disposable worktree/branch/local DB | TODO |
| 42.5 | Production not mutated to make a test green | TODO |
| 42.6 | Mapping documented: old identity, new repository identity, production ledger mapping, fresh-install identity, why history stays truthful | TODO |
| 42.7 | Not merged by me | TODO |

## 43–45 — Integration

| # | Requirement | State |
|---|---|---|
| 43.1 | Branches re-fetched; no integration on stale SHAs | TODO |
| 44.1 | New disposable trial integration built | TODO |
| 44.2 | Real branches not merged | TODO |
| 44.3 | Semantic conflicts looked for, not just a clean git merge | TODO |
| 45.1 | Zero-state replay on a brand-new empty Postgres | TODO |
| 45.2 | Recorded: total, applied, failed migration, error, final result | TODO |

## 46–49 — Method

| # | Requirement | State |
|---|---|---|
| 46.1 | `npm run trust:proxy-ca` preserved | **VERIFIED** — run this session |
| 46.2 | No `--ignore-certificate-errors` / `ignoreHTTPSErrors` / disabled TLS | **VERIFIED** — neither flag appears anywhere |
| 46.3 | Invalid certificates still rejected (control) | **VERIFIED** — `trust:proxy-ca` re-asserts it on every run |
| 46.4 | `verify:basecamp-live` kept as a permanent gate | **VERIFIED** — 26/26 against the alias this session |
| 47.1 | No fake writer tokens; sanctioned auth for writer tests | **VERIFIED** — `verify:basecamp-live` now signs in through the real flow; nothing writes a made-up token |
| 47.2 | Office never weakened to accept fake credentials | **VERIFIED** — the office was never changed to accept anything it did not issue |
| 48.1 | Controlled test records created, exercised, removed | **VERIFIED** — to-do subjects seeded on the test project and swept by class |
| 48.2 | Grant's real project data undamaged | **VERIFIED** — nothing written to any project of Grant's own |
| 49.1 | Interaction QA rule applied to every surface touched | in progress — applied to the sign-in, the to-dos and the card table so far |

## 50–53 — Regression, viewports, accessibility, architecture

| # | Requirement | State |
|---|---|---|
| 50.1 | Project Home regression pass over every module | TODO |
| 50.2 | Alignment, hierarchy, differentiation, titles | TODO |
| 50.3 | Move, resize, hide, restore, scrolling, mobile, no overlap, persistence | TODO |
| 50.4 | Docs & Files: four sorts, manual reorder, persistence, cross-view consistency | TODO |
| 51.1 | 1440x900 | TODO |
| 51.2 | 1024x768 | TODO |
| 51.3 | 768x1024 | TODO |
| 51.4 | 390x844 | TODO |
| 51.5 | No mid-word heading breaks | TODO |
| 52.1 | Keyboard operation and visible focus | TODO |
| 52.2 | 44px touch targets where appropriate | TODO |
| 52.3 | Reduced motion | TODO |
| 52.4 | 200% zoom | TODO |
| 52.5 | No iOS form zoom | TODO |
| 52.6 | Semantic buttons, appropriate ARIA state, truthful disabled states | TODO |
| 52.7 | Voice state not by colour alone | TODO |
| 52.8 | Document sort controls keyboard accessible | **VERIFIED** — a native select |
| 52.9 | Accessible alternative to drag for custom ordering | **VERIFIED** — Alt with an arrow moves a document one place; asserted live |
| 53.1 | No dumping into `shell.js`; coherent domains extracted incrementally with tests | **VERIFIED** — a `docorder` domain; the shell calls it |
| 53.2 | Document ordering lives in a documents domain | **VERIFIED** — exactly there |
| 53.3 | No giant rewrite | TODO |

## 54–56 — Conduct

| # | Requirement | State |
|---|---|---|
| 54.1 | Deploy at stable milestones; verify returned bytes; exercise the deployed browser | TODO |
| 55.1 | Defects fixed rather than filed; systemic causes fixed | TODO |
| 55.2 | Deferrals only for the four permitted reasons | TODO |
| 56.1 | No invented functionality; visual direction preserved | TODO |

## 57–58 — Final acceptance

Both acceptance lists are transcribed verbatim in the mission document (§57, §58)
and are checked off there at the end of the run.

| # | Requirement | State |
|---|---|---|
| 57 | User-feedback acceptance list complete | TODO |
| 58 | Integration acceptance list complete | TODO |
| 59 | Final report in the specified format | TODO |
| 60 | Operating principle honoured: every visible control does what it appears to do | TODO |
