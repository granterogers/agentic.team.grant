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

| # | Requirement | State |
|---|---|---|
| 2.1 | Remove "paste the office token" from the normal UI flow | **VERIFIED** — the ask is a button; the field is folded away behind a disclosure, proved by `checkVisibility`, and the detector was proved able to fail |
| 2.2 | Fix the underlying auth/session architecture, not the warning | **VERIFIED** — 0577 + `signin` edge function + `web/studio/session.js`; the token and the constant-time check are unchanged |
| 2.3 | No "Couldn't reach the office — browser's not signed in." in the normal journey | **VERIFIED** — the strip now offers a press, not a paste |
| 2.4 | No "Read only — no token in this browser." in the normal journey | **VERIFIED** — reworded to name the fix: "press Sign in at the top" |
| 2.5 | Deployed browser: chat reads | **VERIFIED** — `verify:basecamp-live` 26/26, signed in by asking |
| 2.6 | Deployed browser: chat writes | **VERIFIED** — the chat turn leg, same run |
| 2.7 | Deployed browser: voice credential mint | **VERIFIED** — the voice-token mint leg, same run |
| 2.8 | Deployed browser: project settings writes | **VERIFIED** — the appearance write is a settings write through the real picker |
| 2.9 | Deployed browser: appearance writes | **VERIFIED** — written at the office and restored |
| 2.10 | Deployed browser: to-do mutation | **VERIFIED** — `verify:basecamp-todos-live` ticks a seeded task on the deployed page and the office records it |
| 2.11 | Refresh and prove the session still behaves | **VERIFIED** — `verify:basecamp-signin`: a reload keeps it signed in |
| 2.12 | Authentication not weakened; no secret exposed | **VERIFIED** — `check:secrets` clean; the wrapper that returns a bot token is service_role only |

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
| 8.1 | Drag into Stuck does not open the card editor | **VERIFIED** — the drop supplies the reason the office requires instead of asking for it |
| 8.2 | Stuck behaves like the other columns | **VERIFIED** — one `moveCard` for every column |
| 8.3 | Drag-end/click propagation cannot trigger open/edit | **VERIFIED** — the drop no longer calls `openTask` at all |
| 8.4 | Regression: drag → Stuck → canonical state change → no editor opened | **VERIFIED** — `verify:basecamp-todos-live`: drag → Stuck → office state `blocked` with a reason → nothing opened, with a positive control proving a press still opens one |

## 9–10 — Visual

| # | Requirement | State |
|---|---|---|
| 9.1 | Subtle per-module differentiation (restrained accents/tints) | TODO |
| 9.2 | No rainbow dashboard | TODO |
| 9.3 | Dark/luxurious/depth/shadow/glow character preserved | TODO |
| 9.4 | Green hover/glow/shadow interaction language kept | TODO |
| 10.1 | Consistent module-heading accent (yellow/gold acceptable) | TODO |
| 10.2 | Stronger hierarchy and module identity, good readability, not "everything yellow" | TODO |

## 11 — Contact photos

| # | Requirement | State |
|---|---|---|
| 11.1 | Real contact image appears in the minimised Contacts module | TODO |
| 11.2 | Graceful fallback when there is none | TODO |
| 11.3 | Verified: photo stored → miniature renders → refresh → still renders | TODO |
| 11.4 | Signed/private image architecture used correctly | TODO |

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
| 18.1 | Opening a waiting item explains exactly what is required | TODO |
| 18.2 | Decision / information / approval / answer can be given and submitted | TODO |
| 18.3 | Waiting state resolves and project state updates | TODO |
| 18.4 | Built on the canonical waiting/decision/approval architecture | TODO |

## 19 — What the team has made

| # | Requirement | State |
|---|---|---|
| 19.1 | Concept kept; outputs/artifacts shown | TODO |
| 19.2 | Clicking an output opens/views it | TODO |
| 19.3 | "Add to project" kept where meaningful | TODO |

## 20 — Legacy escape hatches

| # | Requirement | State |
|---|---|---|
| 20.1 | Running work → Outputs implemented in the new design | TODO |
| 20.2 | Active jobs implemented in the new design | TODO |
| 20.3 | Team chat implemented in the new design | TODO |
| 20.4 | Team board implemented in the new design | TODO |
| 20.5 | Every visible link/action reachable from the new project UI audited | TODO |
| 20.6 | Automated route/navigation check for legacy escapes | TODO |

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
| 25.1 | Ordering modes Name / Date uploaded / Date created / Custom in the miniature | TODO |
| 25.2 | Same four modes in the expanded view | TODO |
| 25.3 | Compact, understandable control; no unnecessary chrome | TODO |
| 26.1 | Name sort uses the display name, deterministic | TODO |
| 26.2 | Defined and tested for case, numbers, punctuation, duplicate names | TODO |
| 26.3 | Deterministic secondary key | TODO |
| 27.1 | Date uploaded uses genuine upload/import metadata | TODO |
| 27.2 | No silent substitution of another timestamp | TODO |
| 27.3 | Documents without one represented honestly and sorted deterministically | TODO |
| 28.1 | Date created uses genuine creation metadata | TODO |
| 28.2 | Created is not confused with uploaded because only one timestamp exists | TODO |
| 28.3 | Where the model cannot distinguish them, that truth is preserved | TODO |
| 29.1 | Custom mode: drag to position in the miniature | TODO |
| 29.2 | Custom mode: drag to position in the expanded view | TODO |
| 29.3 | Order persisted canonically, not DOM-only | TODO |
| 30.1 | ONE custom order shared by both views (miniature → expanded) | TODO |
| 30.2 | And the other way (expanded → miniature) | TODO |
| 31.1 | Survives redraw | TODO |
| 31.2 | Survives closing/reopening Documents | TODO |
| 31.3 | Survives navigating away and back | TODO |
| 31.4 | Survives page refresh | TODO |
| 31.5 | Per person + project, not per device | TODO |
| 32.1 | Switching to Name does not destroy the custom order | TODO |
| 32.2 | Switching to a date mode does not destroy it | TODO |
| 32.3 | Returning to Custom restores the manual order exactly | TODO |
| 33.1 | Miniature supports all four modes without maximising | TODO |
| 33.2 | Miniature stays compact (small sort/menu control) | TODO |
| 33.3 | Manual reordering works inside the miniature | TODO |
| 34.1 | Expanded view makes ordering controls explicit | TODO |
| 34.2 | Custom drag feels deliberate and obvious | TODO |
| 34.3 | Document opening/selecting not compromised | TODO |
| 35.1 | Dragging never triggers open/details/preview/new tab/edit | TODO |
| 35.2 | Click = open, drag = reorder | TODO |
| 35.3 | Specific regression added | TODO |
| 36.1 | Sensible defaults: Name A→Z, dates newest first | TODO |
| 36.2 | No overdesigned sorting complexity | TODO |
| 37.1 | Ordering works across real document types (uploads, PDFs, images, recordings, office-created, Drive references, Docs/Sheets/Slides, connector records) | TODO |
| 37.2 | Custom order not limited to uploaded local files | TODO |
| 37.3 | No invented metadata to make date sorting look complete | TODO |
| 38.1 | Live: Name sort correct and deterministic | TODO |
| 38.2 | Live: Date uploaded correct from genuine metadata | TODO |
| 38.3 | Live: Date created correct from genuine metadata | TODO |
| 38.4 | Live: custom drag in the miniature — order changes, no accidental open, refresh persists | TODO |
| 38.5 | Live: custom drag in the expanded view — same | TODO |
| 38.6 | Live: reorder miniature → expanded matches | TODO |
| 38.7 | Live: reorder expanded → miniature matches | TODO |
| 38.8 | Live: custom → Name → Date uploaded → Date created → Custom restores the order | TODO |
| 38.9 | Controlled test documents created, exercised, removed; Grant's documents undamaged | TODO |

## 39–42 — Integration blockers

| # | Requirement | State |
|---|---|---|
| 39.1 | #340: `public.hq_pulse` wrapper exists; pulse no longer 502 | **VERIFIED** — 0578; `?section=pulse` answers 200 |
| 39.2 | Console error not merely silenced | **VERIFIED** — the wrapper was missing, not the logging |
| 39.3 | Systemic gateway-wrapper check retained (`check:gateway-wrappers`) | **VERIFIED** — `check:gateway-wrappers` clean over 147 routed functions |
| 39.4 | Verified through deployed browser → real gateway → successful pulse | **VERIFIED** — `verify:basecamp-live` now watches every gateway answer the browser gets; proved able to fail by forcing a 502 |
| 40.1 | #341: board arrangement persists per person + project | TODO |
| 40.2 | Device A change visible to device B for the same person | TODO |
| 40.3 | Backend persistence, not copied localStorage | TODO |
| 40.4 | Verified with two independent browser contexts | TODO |
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
| 52.8 | Document sort controls keyboard accessible | TODO |
| 52.9 | Accessible alternative to drag for custom ordering | TODO |
| 53.1 | No dumping into `shell.js`; coherent domains extracted incrementally with tests | TODO |
| 53.2 | Document ordering lives in a documents domain | TODO |
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
