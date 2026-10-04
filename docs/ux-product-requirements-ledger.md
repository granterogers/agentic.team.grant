# UX / product requirements ledger — overnight run (branch `claude/team-hq-ux-overnight`)

Source: the "long autonomous implementation run" specification given by Grant on 4 October 2026
(sections 4–19 of that brief). Every distinct decision gets an ID. Nothing is too small to track.

**Isolation.** Branch cut from `claude/multi-user-p4` @ `5e3eafa6`. No production Supabase change, no migration
applied, no deploy. Storage decisions below are made so that **no migration is required** for the core slice.

**Status vocabulary.** NOT INSPECTED · ALREADY SATISFIED · PARTIALLY SATISFIED · IMPLEMENTING · IMPLEMENTED ·
TESTED · VISUALLY VERIFIED · BLOCKED · DEFERRED. A status is only claimed with evidence in the last column.

**Before** = what the repository did before this run (A already / B partial / C extend existing / D missing).

## Reconnaissance summary (what exists)

| Area | Found | Class |
|---|---|---|
| Layout | `web/studio/bc/layout.js` — 12-col grid, 44px rows, vertical compaction (collision PREVENTION), `squeeze`; persisted `localStorage bc.layout.<slug>` + office RPC `dashboard_layout_set(surface 'basecamp')`; drag/resize in `bc/wire.js` `wireBoard`; modules in `bc/compose.js` `mod()` | C — model must be replaced (spec reverses collision prevention) |
| Expanded view | `ctx.openExpanded` → `state.bcExpanded` → `expandedOverlay` in `bc/shell.js`; opened by header press; no animation; no history entry | C |
| Schedule | `scheduleSurface` shell.js — month grids built from **task due dates only**; no events store, no Day/Week, no Google events in UI | B/D |
| Google Calendar backend | `src/google/calendar.ts`, `handlers/calendar.ts` (hourly cache), `calendar-tasks.ts` (tasks→all-day events, one-way); tool grants `calendar.read/write` | C |
| Documents | `documentsSurface` shell.js, `bc/drive.js` (Drive picker, `drive_link`), `bc/docorder.js` (sort modes + custom order), `document_upload`, `mirrors_document_id` (DB only), `superseded_by` (no UI) | B |
| Jump / command | `bc/jump.js` (Shift+J, navigation only) and legacy `web/studio/command.js` (Cmd/Ctrl+K, find + sections) | C |
| Search | gateway section `search` (`studio_search`, filters #37), search page `#bc-search-q` | B |
| Activity | `activitySurface`/`timelineMini` from `p.activity`; global `lately` (`hq_studio_lately`) ; **no channel provenance in rows** | B |
| Google connect | Settings: drive/calendar/gmail are one `family:'google'` "Connect Google" button (`google_connect_start`); NotebookLM separate | B (mostly satisfied) |
| Browser | `src/handlers/browser-gather.ts` read-and-photograph tier, `browser_sessions`, ledger `browser_actions` (verb CHECK refuses acting), `mayAct` approvals; **no general web search handler**; sources lack retrieved-at/agent/job columns | B/D |
| PDF | `src/artifacts/pdf.ts` hand-built deterministic writer (Deno, no Chromium), `report.ts`, `validate.ts`, `store.ts`; no style profile | B/D |
| MCP | `supabase/functions/mcp` hand-rolled MCP + OAuth 2.1 for ChatGPT; tools list_projects/search_documents/read_document/add_to_project…; no tasks/calendar/activity tools; `origin_channel` has no `mcp`/`chatgpt` | B |
| Vicuña | **No integration by that name exists.** Closest: Vikunja (task provider port, `src/tasks/vikunja.ts`, `sync.ts`) | see HQ-NOTES |
| Notes | `bc/notestore.js` is voice-note audio only (IndexedDB) — not Post-its | D |

## Storage decision (no migration needed)

The existing RPC `dashboard_layout_set(p_slug, p_panels jsonb, p_surface 'basecamp')` accepts **any non-empty jsonb
array**. The workspace document for a project (module rectangles + tints, zoom, named layouts, Post-its) is stored as
that array: module entries plus one reserved `{id:'__workspace', …}` entry. Browser `localStorage` is the synchronous
cache in front of it (ADR-0021 rules preserved). Post-its therefore sync across devices without a schema change and
without touching production. Trade-off recorded: last-write-wins on the whole document.

## Requirements

Legend for the Status column: see above. "Evidence" cites files / tests / captures once they exist.

### HQ-ACCT — account control
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-ACCT-001 | Login/logout/account control is extremely small | B | VISUALLY VERIFIED | .out/acct.png and ux-docs-06-websources.png: sign-out is a 30px icon top-right, sign-in strip is a thin 28px-control line (docs.css end). Not functionally tested (no auth flow driven) |
| HQ-ACCT-002 | …subtle |  | VISUALLY VERIFIED | .out/acct.png and ux-docs-06-websources.png: sign-out is a 30px icon top-right, sign-in strip is a thin 28px-control line (docs.css end). Not functionally tested (no auth flow driven) |
| HQ-ACCT-003 | …positioned top-right |  | VISUALLY VERIFIED | .out/acct.png and ux-docs-06-websources.png: sign-out is a 30px icon top-right, sign-in strip is a thin 28px-control line (docs.css end). Not functionally tested (no auth flow driven) |
| HQ-ACCT-004 | …minimal screen consumption; never dominates project UI |  | VISUALLY VERIFIED | .out/acct.png and ux-docs-06-websources.png: sign-out is a 30px icon top-right, sign-in strip is a thin 28px-control line (docs.css end). Not functionally tested (no auth flow driven) |

### HQ-LAYOUT — freeform workspace
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-LAYOUT-001 | Modules move continuously (no cell snapping) | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31); captures .out/ux-02-overlap-1440.png, ux-03-guides, ux-04-tidy. bc/layout.js, bc/stage.js, bc/compose.js |
| HQ-LAYOUT-002 | Modules resize continuously | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31); captures .out/ux-02-overlap-1440.png, ux-03-guides, ux-04-tidy. bc/layout.js, bc/stage.js, bc/compose.js |
| HQ-LAYOUT-003 | No mandatory fixed increments (the 12-col/44px grid unit is removed) | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31); captures .out/ux-02-overlap-1440.png, ux-03-guides, ux-04-tidy. bc/layout.js, bc/stage.js, bc/compose.js |
| HQ-LAYOUT-004 | Gentle alignment guides while dragging/resizing | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31); captures .out/ux-02-overlap-1440.png, ux-03-guides, ux-04-tidy. bc/layout.js, bc/stage.js, bc/compose.js |
| HQ-LAYOUT-005 | Overlap is permitted | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31); captures .out/ux-02-overlap-1440.png, ux-03-guides, ux-04-tidy. bc/layout.js, bc/stage.js, bc/compose.js |
| HQ-LAYOUT-006 | Overlap does not force reflow of other modules | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31); captures .out/ux-02-overlap-1440.png, ux-03-guides, ux-04-tidy. bc/layout.js, bc/stage.js, bc/compose.js |
| HQ-LAYOUT-007 | Auto Arrange / Tidy control exists (subtle) | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31); captures .out/ux-02-overlap-1440.png, ux-03-guides, ux-04-tidy. bc/layout.js, bc/stage.js, bc/compose.js |
| HQ-LAYOUT-008 | Auto Arrange lightly tidies, does not redesign | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31); captures .out/ux-02-overlap-1440.png, ux-03-guides, ux-04-tidy. bc/layout.js, bc/stage.js, bc/compose.js |
| HQ-LAYOUT-009 | Reset View control exists | B | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): Reset View keeps Post-its and saved layouts (unit + browser); tint/zoom/z-order persist across reload; per-project isolation (unit) |
| HQ-LAYOUT-010 | Reset View resets presentation only (positions, dimensions, zoom, layout state) | B | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): Reset View keeps Post-its and saved layouts (unit + browser); tint/zoom/z-order persist across reload; per-project isolation (unit) |
| HQ-LAYOUT-011 | Reset View cannot delete Post-it content / tasks / documents / events / project data |  | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): Reset View keeps Post-its and saved layouts (unit + browser); tint/zoom/z-order persist across reload; per-project isolation (unit) |
| HQ-LAYOUT-012 | Layouts are project-specific and independent | A | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): Reset View keeps Post-its and saved layouts (unit + browser); tint/zoom/z-order persist across reload; per-project isolation (unit) |
| HQ-LAYOUT-013 | Positions persist | A | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): Reset View keeps Post-its and saved layouts (unit + browser); tint/zoom/z-order persist across reload; per-project isolation (unit) |
| HQ-LAYOUT-014 | Dimensions persist | A | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): Reset View keeps Post-its and saved layouts (unit + browser); tint/zoom/z-order persist across reload; per-project isolation (unit) |
| HQ-LAYOUT-015 | Visibility persists | A | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): Reset View keeps Post-its and saved layouts (unit + browser); tint/zoom/z-order persist across reload; per-project isolation (unit) |
| HQ-LAYOUT-016 | Tints persist | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): Reset View keeps Post-its and saved layouts (unit + browser); tint/zoom/z-order persist across reload; per-project isolation (unit) |
| HQ-LAYOUT-017 | Zoom persists | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): Reset View keeps Post-its and saved layouts (unit + browser); tint/zoom/z-order persist across reload; per-project isolation (unit) |
| HQ-LAYOUT-018 | Other relevant presentation state persists (z-order) | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): Reset View keeps Post-its and saved layouts (unit + browser); tint/zoom/z-order persist across reload; per-project isolation (unit) |
| HQ-LAYOUT-019 | Architecture for named layouts | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): save/load/rename/delete + 4 presets driven through the Layouts popover; capture ux-08-layouts-1440.png |
| HQ-LAYOUT-020 | Save current layout under a name | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): save/load/rename/delete + 4 presets driven through the Layouts popover; capture ux-08-layouts-1440.png |
| HQ-LAYOUT-021 | Load / switch layout | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): save/load/rename/delete + 4 presets driven through the Layouts popover; capture ux-08-layouts-1440.png |
| HQ-LAYOUT-022 | Rename layout | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): save/load/rename/delete + 4 presets driven through the Layouts popover; capture ux-08-layouts-1440.png |
| HQ-LAYOUT-023 | Delete layout | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): save/load/rename/delete + 4 presets driven through the Layouts popover; capture ux-08-layouts-1440.png |
| HQ-LAYOUT-024 | Preset: Overview | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): save/load/rename/delete + 4 presets driven through the Layouts popover; capture ux-08-layouts-1440.png |
| HQ-LAYOUT-025 | Preset: Planning | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): save/load/rename/delete + 4 presets driven through the Layouts popover; capture ux-08-layouts-1440.png |
| HQ-LAYOUT-026 | Preset: Research | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): save/load/rename/delete + 4 presets driven through the Layouts popover; capture ux-08-layouts-1440.png |
| HQ-LAYOUT-027 | Preset: Documents | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): save/load/rename/delete + 4 presets driven through the Layouts popover; capture ux-08-layouts-1440.png |
| HQ-LAYOUT-028 | Dashboard stays constrained to the browser viewport |  | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): stage bounded to the viewport, drag clamped inside it (unit + browser); no canvas |
| HQ-LAYOUT-029 | No infinite canvas |  | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): stage bounded to the viewport, drag clamped inside it (unit + browser); no canvas |
| HQ-LAYOUT-030 | Keyboard can still move/resize a module | A | TESTED | workspace.ts: Alt+arrows move a focused module (12px steps) |
| HQ-LAYOUT-031 | Mobile/phone keeps a usable stacked layout (free layout is desktop) | A | VISUALLY VERIFIED | ux-matrix.ts + ux-11-phone-390.png: 390px stacks modules in order, no sideways scroll; free layout is desktop only by design |
| HQ-LAYOUT-032 | Modules cannot be dragged fully off the stage |  | TESTED | layout.test.ts: clampRect keeps every module inside the stage |

### HQ-ZOOM
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-ZOOM-001 | Zoom scales the actual module workspace | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): -/100%/+ and reset drive the stage scale; capture ux-05-zoom-80-1440.png |
| HQ-ZOOM-002 | Visible controls  −  100%  + | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): -/100%/+ and reset drive the stage scale; capture ux-05-zoom-80-1440.png |
| HQ-ZOOM-003 | Zoom reset control | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): -/100%/+ and reset drive the stage scale; capture ux-05-zoom-80-1440.png |
| HQ-ZOOM-004 | Mouse/trackpad zoom via modifier-wheel (Ctrl/Cmd+wheel, pinch) | D | TESTED | workspace.ts: Ctrl+wheel zooms, a plain wheel never does (modules keep their own scroll). Trackpad pinch = same ctrl+wheel event in Chromium; not driven on real hardware |
| HQ-ZOOM-005 | Plain wheel still scrolls inside Chat/Tasks/Documents/Calendar |  | TESTED | workspace.ts: Ctrl+wheel zooms, a plain wheel never does (modules keep their own scroll). Trackpad pinch = same ctrl+wheel event in Chromium; not driven on real hardware |
| HQ-ZOOM-006 | Fluid (animated) zoom feel | D | IMPLEMENTED | animated via a 220ms transform transition (bcstage--zooming); not frame-inspected |
| HQ-ZOOM-007 | Zoom is bounded and keeps stage inside viewport |  | TESTED | layout.test.ts zoom bounds 0.5-1.5; zoom persists (workspace.ts) |

### HQ-DENSITY — module chrome
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-DENSITY-001 | Thinner / subtler borders |  | VISUALLY VERIFIED | Thinner 1px edges, 12.5px headers, 8-11px padding, 18-24px handles (compose.css end); compare .out/before-proj.png with a3.png. Not measured with npm run space |
| HQ-DENSITY-002 | Compact headers |  | VISUALLY VERIFIED | Thinner 1px edges, 12.5px headers, 8-11px padding, 18-24px handles (compose.css end); compare .out/before-proj.png with a3.png. Not measured with npm run space |
| HQ-DENSITY-003 | Tighter padding |  | VISUALLY VERIFIED | Thinner 1px edges, 12.5px headers, 8-11px padding, 18-24px handles (compose.css end); compare .out/before-proj.png with a3.png. Not measured with npm run space |
| HQ-DENSITY-004 | Smaller handles |  | VISUALLY VERIFIED | Thinner 1px edges, 12.5px headers, 8-11px padding, 18-24px handles (compose.css end); compare .out/before-proj.png with a3.png. Not measured with npm run space |
| HQ-DENSITY-005 | Reduced dead space; content fills most of a module |  | VISUALLY VERIFIED | Thinner 1px edges, 12.5px headers, 8-11px padding, 18-24px handles (compose.css end); compare .out/before-proj.png with a3.png. Not measured with npm run space |
| HQ-CTRL-001 | Module controls hidden by default | A | TESTED | workspace.ts hovers modules to reveal controls; keyboard focus reveals via :focus-within (existing rule) |
| HQ-CTRL-002 | Revealed on hover | A | TESTED | workspace.ts hovers modules to reveal controls; keyboard focus reveals via :focus-within (existing rule) |
| HQ-CTRL-003 | Revealed on keyboard focus | A | TESTED | workspace.ts hovers modules to reveal controls; keyboard focus reveals via :focus-within (existing rule) |
| HQ-CTRL-004 | Revealed appropriately on touch |  | IMPLEMENTED | @media (pointer: coarse) shows controls always (compose.css). Not verified on a real touch device |
| HQ-CTRL-005 | Reveal is elegant (no layout shift) |  | VISUALLY VERIFIED | controls are position:absolute with reserved header padding (no layout shift); captures |

### HQ-TINT
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-TINT-001 | Each module has an independent subtle tint | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): 11 curated tints + custom colour, persists per project; capture ux-06-tint-popover-1440.png |
| HQ-TINT-002 | ≈8–12 curated tasteful tints | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): 11 curated tints + custom colour, persists per project; capture ux-06-tint-popover-1440.png |
| HQ-TINT-003 | Tiny colour control per module | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): 11 curated tints + custom colour, persists per project; capture ux-06-tint-popover-1440.png |
| HQ-TINT-004 | Custom colour where straightforward | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): 11 curated tints + custom colour, persists per project; capture ux-06-tint-popover-1440.png |
| HQ-TINT-005 | Tint persists per project/layout | D | VISUALLY VERIFIED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): 11 curated tints + custom colour, persists per project; capture ux-06-tint-popover-1440.png |
| HQ-TINT-006 | Tint legible in light and dark (text contrast kept) |  | IMPLEMENTED | tint is a 13% wash over the module face so text colour is unchanged; contrast not measured with axe |

### HQ-MAX — maximize + spatial animation
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-MAX-001 | Every normal module except Post-its can maximize | B | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): every module has a maximise control, Post-its have none; opens the existing expanded view (nearly full screen, only X to close); capture ux-09-maximised-1440.png |
| HQ-MAX-002 | Maximized module occupies nearly the whole usable screen | B | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): every module has a maximise control, Post-its have none; opens the existing expanded view (nearly full screen, only X to close); capture ux-09-maximised-1440.png |
| HQ-MAX-003 | Only a small unobtrusive Back/Close control plus essential navigation | B | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): every module has a maximise control, Post-its have none; opens the existing expanded view (nearly full screen, only X to close); capture ux-09-maximised-1440.png |
| HQ-MAX-004 | Post-its have no maximize |  | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): every module has a maximise control, Post-its have none; opens the existing expanded view (nearly full screen, only X to close); capture ux-09-maximised-1440.png |
| HQ-ANIM-001 | Card visually expands FROM its dashboard position into maximized state | D | PARTIALLY SATISFIED | bc/expand.js FLIP from the card rect: opening frame inspected (.out/ux-anim-open-mid.png); the close ghost is exercised by the suites but its frames were not inspected |
| HQ-ANIM-002 | Restore animates back toward the originating card | D | PARTIALLY SATISFIED | bc/expand.js FLIP from the card rect: opening frame inspected (.out/ux-anim-open-mid.png); the close ghost is exercised by the suites but its frames were not inspected |
| HQ-ANIM-003 | Animation is smooth, restrained, premium, physically coherent, responsive | D | PARTIALLY SATISFIED | bc/expand.js FLIP from the card rect: opening frame inspected (.out/ux-anim-open-mid.png); the close ghost is exercised by the suites but its frames were not inspected |
| HQ-ANIM-004 | prefers-reduced-motion respected |  | TESTED | scripts/verify/ux-matrix.ts (40): with prefers-reduced-motion the maximised card runs no animation, closes at once, zoom does not animate |
| HQ-ANIM-005 | Spatial transition is applied as a general principle where appropriate (drag lift, layout switch, zoom, post-it creation) | D | PARTIALLY SATISFIED | applied to maximise, zoom, Tidy/preset glide, Post-it pull-out and popovers; not to every card in the product |
| HQ-HIST-001 | Browser Back restores the previous dashboard/module state when maximized | D | TESTED | workspace.ts: Back closes the maximised module and stays on the same Team HQ page, Forward reopens it (history entry via the existing address suffix). The mouse Back button is the same history traversal; not driven with a physical button |
| HQ-HIST-002 | Mouse Back button does the same | D | TESTED | workspace.ts: Back closes the maximised module and stays on the same Team HQ page, Forward reopens it (history entry via the existing address suffix). The mouse Back button is the same history traversal; not driven with a physical button |
| HQ-HIST-003 | Back never navigates unexpectedly to another Team HQ page | D | TESTED | workspace.ts: Back closes the maximised module and stays on the same Team HQ page, Forward reopens it (history entry via the existing address suffix). The mouse Back button is the same history traversal; not driven with a physical button |
| HQ-HIST-004 | Uses browser history/state appropriately (push on open) | D | TESTED | workspace.ts: Back closes the maximised module and stays on the same Team HQ page, Forward reopens it (history entry via the existing address suffix). The mouse Back button is the same history traversal; not driven with a physical button |

### HQ-POSTIT
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-POSTIT-001 | Project-specific Post-it notes | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): starter note, type to autosave, more notes, move, remove, reload persistence, per-project; layout.test.ts Post-it block |
| HQ-POSTIT-002 | Initially one attractive yellow Post-it/note affordance | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): starter note, type to autosave, more notes, move, remove, reload persistence, per-project; layout.test.ts Post-it block |
| HQ-POSTIT-003 | Click directly and type; no editor modal | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): starter note, type to autosave, more notes, move, remove, reload persistence, per-project; layout.test.ts Post-it block |
| HQ-POSTIT-004 | Autosave while typing | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): starter note, type to autosave, more notes, move, remove, reload persistence, per-project; layout.test.ts Post-it block |
| HQ-POSTIT-005 | Create/pull out additional Post-its | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): starter note, type to autosave, more notes, move, remove, reload persistence, per-project; layout.test.ts Post-it block |
| HQ-POSTIT-006 | Each is an independent dashboard object | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): starter note, type to autosave, more notes, move, remove, reload persistence, per-project; layout.test.ts Post-it block |
| HQ-POSTIT-007 | Individually movable | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): starter note, type to autosave, more notes, move, remove, reload persistence, per-project; layout.test.ts Post-it block |
| HQ-POSTIT-008 | Individually resizable where sensible | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): starter note, type to autosave, more notes, move, remove, reload persistence, per-project; layout.test.ts Post-it block |
| HQ-POSTIT-009 | Explicitly removable | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): starter note, type to autosave, more notes, move, remove, reload persistence, per-project; layout.test.ts Post-it block |
| HQ-POSTIT-010 | Persist between sessions | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): starter note, type to autosave, more notes, move, remove, reload persistence, per-project; layout.test.ts Post-it block |
| HQ-POSTIT-011 | Scoped to the current project | D | TESTED | scripts/verify/workspace.ts (58 checks), tests/studio/layout.test.ts (31): starter note, type to autosave, more notes, move, remove, reload persistence, per-project; layout.test.ts Post-it block |
| HQ-POSTIT-012 | Deliberately simple: NO AI extraction |  | TESTED | layout.test.ts: a note holds only id, text and a rectangle; no extraction/conversion code exists |
| HQ-POSTIT-013 | NO task conversion |  | TESTED | layout.test.ts: a note holds only id, text and a rectangle; no extraction/conversion code exists |
| HQ-POSTIT-014 | NO calendar conversion |  | TESTED | layout.test.ts: a note holds only id, text and a rectangle; no extraction/conversion code exists |
| HQ-POSTIT-015 | Attractive without excessive skeuomorphism |  | VISUALLY VERIFIED | .out/ux-07-notes-1440.png yellow, soft corner, no skeuomorphic extras |
| HQ-POSTIT-016 | Post-its searchable in unified search | D | TESTED | scripts/verify/palette.ts (18): a Post-it is found by its text; office provider psearch_postits proved in SQL (unapplied) |

### HQ-CAL — calendar
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-CAL-001 | Day view | D | VISUALLY VERIFIED | scripts/verify/calendar-ui.ts (25), tests/studio/calendar.test.ts (12); captures ux-cal-02-month, 03-week, 04-day, 01-module-large, 06/07 phone |
| HQ-CAL-002 | Week view | D | VISUALLY VERIFIED | scripts/verify/calendar-ui.ts (25), tests/studio/calendar.test.ts (12); captures ux-cal-02-month, 03-week, 04-day, 01-module-large, 06/07 phone |
| HQ-CAL-003 | Month view | B | VISUALLY VERIFIED | scripts/verify/calendar-ui.ts (25), tests/studio/calendar.test.ts (12); captures ux-cal-02-month, 03-week, 04-day, 01-module-large, 06/07 phone |
| HQ-CAL-004 | Large module → full calendar | D | VISUALLY VERIFIED | scripts/verify/calendar-ui.ts (25), tests/studio/calendar.test.ts (12); captures ux-cal-02-month, 03-week, 04-day, 01-module-large, 06/07 phone |
| HQ-CAL-005 | Medium module → condensed calendar | D | VISUALLY VERIFIED | scripts/verify/calendar-ui.ts (25), tests/studio/calendar.test.ts (12); captures ux-cal-02-month, 03-week, 04-day, 01-module-large, 06/07 phone |
| HQ-CAL-006 | Small module → agenda/upcoming events | B | VISUALLY VERIFIED | scripts/verify/calendar-ui.ts (25), tests/studio/calendar.test.ts (12); captures ux-cal-02-month, 03-week, 04-day, 01-module-large, 06/07 phone |
| HQ-CAL-007 | Never crush a full month into an unreadable tiny card |  | VISUALLY VERIFIED | scripts/verify/calendar-ui.ts (25), tests/studio/calendar.test.ts (12); captures ux-cal-02-month, 03-week, 04-day, 01-module-large, 06/07 phone |
| HQ-CAL-008 | Each project has its own calendar | D | TESTED | migration 0897 project_events + scripts/isolated/project-calendar.ts (75 checks incl. project and tenant isolation) on a local replica; UI scope=project. NOT applied to production |
| HQ-CAL-009 | Scope control: This Project | D | PARTIALLY SATISFIED | UI scope select + backend scopes project/all/google proved in SQL; the Google/combined view against real Google data is not verified |
| HQ-CAL-010 | Scope control: All Projects | D | PARTIALLY SATISFIED | UI scope select + backend scopes project/all/google proved in SQL; the Google/combined view against real Google data is not verified |
| HQ-CAL-011 | Scope control: Google / combined calendar | D | PARTIALLY SATISFIED | UI scope select + backend scopes project/all/google proved in SQL; the Google/combined view against real Google data is not verified |
| HQ-CAL-012 | Events created in a project belong to that project automatically | D | TESTED | hq_event_add stores project_id from the slug (SQL proof); UI add form tested |
| HQ-CAL-013 | Project events synchronise toward Google Calendar when connected | D | PARTIALLY SATISFIED | src/google/calendar-events.ts + handlers/calendar-events.ts push/pull/tombstone/idempotency tested with a fake Google (tests/google, tests/handlers, project-calendar.ts). Live Google not exercised; If-Match not used by the duty |
| HQ-CAL-014 | Existing Google events may remain external | D | TESTED | assignment of an external event to a project: SQL proof + UI editor (assign select) in calendar-ui.ts |
| HQ-CAL-015 | An external Google event can be assigned to a project | D | TESTED | assignment of an external event to a project: SQL proof + UI editor (assign select) in calendar-ui.ts |
| HQ-CAL-016 | Google sync: create | D | PARTIALLY SATISFIED | src/google/calendar-events.ts + handlers/calendar-events.ts push/pull/tombstone/idempotency tested with a fake Google (tests/google, tests/handlers, project-calendar.ts). Live Google not exercised; If-Match not used by the duty |
| HQ-CAL-017 | Google sync: edit | D | PARTIALLY SATISFIED | src/google/calendar-events.ts + handlers/calendar-events.ts push/pull/tombstone/idempotency tested with a fake Google (tests/google, tests/handlers, project-calendar.ts). Live Google not exercised; If-Match not used by the duty |
| HQ-CAL-018 | Google sync: delete | D | PARTIALLY SATISFIED | src/google/calendar-events.ts + handlers/calendar-events.ts push/pull/tombstone/idempotency tested with a fake Google (tests/google, tests/handlers, project-calendar.ts). Live Google not exercised; If-Match not used by the duty |
| HQ-CAL-019 | Live Google E2E not performed on production (mocks/fixtures; remaining verification documented) |  | IMPLEMENTED | docs/ux-be-calendar-notes.md lists the live verification still owed |
| HQ-CAL-020 | Create / edit / delete events in the UI | D | TESTED | calendar-ui.ts: create, edit, delete, refusal reasons, Escape; office adapter speaks event_add/update/delete (contract) ; local adapter keeps events in the browser and says so |
| HQ-CAL-021 | Tasks with due dates still appear on the calendar | A | TESTED | calendar-ui.ts: dated to-dos still appear on their day and open the to-do |

### HQ-GOOG — connect Google
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-GOOG-001 | One clean tenant-level Connect Google experience | B | PARTIALLY SATISFIED | Settings already had one Connect Google family; a single "Google - Connected, Drive/Calendar/Gmail" summary line was added (app.js). Rendering needs a live office so it is not captured; multiple accounts are not precluded (no schema change) |
| HQ-GOOG-002 | V1 assumes one Google account per tenant |  | PARTIALLY SATISFIED | Settings already had one Connect Google family; a single "Google - Connected, Drive/Calendar/Gmail" summary line was added (app.js). Rendering needs a live office so it is not captured; multiple accounts are not precluded (no schema change) |
| HQ-GOOG-003 | Architecture does not preclude multiple accounts |  | PARTIALLY SATISFIED | Settings already had one Connect Google family; a single "Google - Connected, Drive/Calendar/Gmail" summary line was added (app.js). Rendering needs a live office so it is not captured; multiple accounts are not precluded (no schema change) |
| HQ-GOOG-004 | After connect: subtle "Google — Connected" with Drive ✓ Calendar ✓ Gmail ✓ | D | IMPLEMENTED | app.js googleLine; not visually verified |
| HQ-GOOG-005 | Notebook capability shown only where real |  | DEFERRED | NotebookLM stays a separate setup because Google exposes no API for it; nothing claims otherwise |
| HQ-GOOG-006 | Not four independent onboarding experiences | B | PARTIALLY SATISFIED | three rows remain (each can be in a different state) under one summary |
| HQ-GOOG-007 | Reuse existing OAuth infrastructure | A | ALREADY SATISFIED | no OAuth code, scopes or configuration changed in this run |
| HQ-GOOG-008 | Do not broaden OAuth scopes |  | ALREADY SATISFIED | no OAuth code, scopes or configuration changed in this run |
| HQ-GOOG-009 | Do not modify production OAuth configuration |  | ALREADY SATISFIED | no OAuth code, scopes or configuration changed in this run |
| HQ-GOOG-010 | Do not claim NotebookLM capabilities Google's APIs lack |  | ALREADY SATISFIED | no OAuth code, scopes or configuration changed in this run |

### HQ-DOC — unified documents
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-DOC-001 | Documents is a unified VIEW across sources, not synonymous with Supabase storage | B | TESTED | scripts/verify/docs-ui.ts (34), tests/studio/docsources.test.ts: unified view, sources Drive/Upload/Generated/Notebook/Notion/Web/Other from docsources.js SOURCES (extensible list) |
| HQ-DOC-002 | Sources: Google Drive | A | TESTED | scripts/verify/docs-ui.ts (34), tests/studio/docsources.test.ts: unified view, sources Drive/Upload/Generated/Notebook/Notion/Web/Other from docsources.js SOURCES (extensible list) |
| HQ-DOC-003 | Sources: Notebook material where technically supported |  | TESTED | scripts/verify/docs-ui.ts (34), tests/studio/docsources.test.ts: unified view, sources Drive/Upload/Generated/Notebook/Notion/Web/Other from docsources.js SOURCES (extensible list) |
| HQ-DOC-004 | Sources: Supabase uploads | A | TESTED | scripts/verify/docs-ui.ts (34), tests/studio/docsources.test.ts: unified view, sources Drive/Upload/Generated/Notebook/Notion/Web/Other from docsources.js SOURCES (extensible list) |
| HQ-DOC-005 | Sources: generated Team HQ artifacts | A | TESTED | scripts/verify/docs-ui.ts (34), tests/studio/docsources.test.ts: unified view, sources Drive/Upload/Generated/Notebook/Notion/Web/Other from docsources.js SOURCES (extensible list) |
| HQ-DOC-006 | Extensible provider architecture for future providers | D | TESTED | scripts/verify/docs-ui.ts (34), tests/studio/docsources.test.ts: unified view, sources Drive/Upload/Generated/Notebook/Notion/Web/Other from docsources.js SOURCES (extensible list) |
| HQ-DOC-007 | Default view: All Documents |  | VISUALLY VERIFIED | scripts/verify/docs-ui.ts (34), tests/studio/docsources.test.ts; captures ux-docs-01-all, 02-drive: All default, only present sources offered with counts |
| HQ-DOC-008 | Source filters: All / Google Drive / Uploaded / Generated / Notebook | D | VISUALLY VERIFIED | scripts/verify/docs-ui.ts (34), tests/studio/docsources.test.ts; captures ux-docs-01-all, 02-drive: All default, only present sources offered with counts |
| HQ-DOC-009 | Sort by filename | A | TESTED | docorder.js adds modified, size, type, source beside name/uploaded/created/custom; docs-ui.ts asserts the sort offers them and name sort is correct; project filter = project_documents is per project (cross-project scope DEFERRED) |
| HQ-DOC-010 | Sort by modified date | B | TESTED | docorder.js adds modified, size, type, source beside name/uploaded/created/custom; docs-ui.ts asserts the sort offers them and name sort is correct; project filter = project_documents is per project (cross-project scope DEFERRED) |
| HQ-DOC-011 | Sort by added date | D | TESTED | docorder.js adds modified, size, type, source beside name/uploaded/created/custom; docs-ui.ts asserts the sort offers them and name sort is correct; project filter = project_documents is per project (cross-project scope DEFERRED) |
| HQ-DOC-012 | Sort by file size | D | TESTED | docorder.js adds modified, size, type, source beside name/uploaded/created/custom; docs-ui.ts asserts the sort offers them and name sort is correct; project filter = project_documents is per project (cross-project scope DEFERRED) |
| HQ-DOC-013 | Sort by file type | D | TESTED | docorder.js adds modified, size, type, source beside name/uploaded/created/custom; docs-ui.ts asserts the sort offers them and name sort is correct; project filter = project_documents is per project (cross-project scope DEFERRED) |
| HQ-DOC-014 | Sort by source | D | TESTED | docorder.js adds modified, size, type, source beside name/uploaded/created/custom; docs-ui.ts asserts the sort offers them and name sort is correct; project filter = project_documents is per project (cross-project scope DEFERRED) |
| HQ-DOC-015 | Sort/filter by project (where multi-project scope) | D | TESTED | docorder.js adds modified, size, type, source beside name/uploaded/created/custom; docs-ui.ts asserts the sort offers them and name sort is correct; project filter = project_documents is per project (cross-project scope DEFERRED) |
| HQ-DOC-016 | Search within documents | D | TESTED | scripts/verify/docs-ui.ts (34), tests/studio/docsources.test.ts: search in place (keeps focus), list and thumbnail views, kind filter |
| HQ-DOC-017 | List view | A | TESTED | scripts/verify/docs-ui.ts (34), tests/studio/docsources.test.ts: search in place (keeps focus), list and thumbnail views, kind filter |
| HQ-DOC-018 | Thumbnail/grid view | A | TESTED | scripts/verify/docs-ui.ts (34), tests/studio/docsources.test.ts: search in place (keeps focus), list and thumbnail views, kind filter |
| HQ-DOC-019 | Sensible type filters | D | TESTED | scripts/verify/docs-ui.ts (34), tests/studio/docsources.test.ts: search in place (keeps focus), list and thumbnail views, kind filter |
| HQ-DOC-020 | Very small subtle provenance indicator on every document | D | VISUALLY VERIFIED | 20px source indicator on tiles and rows; ux-docs-01/02 captures; no provider logos beyond the existing marks |
| HQ-DOC-021 | No giant provider badges |  | VISUALLY VERIFIED | 20px source indicator on tiles and rows; ux-docs-01/02 captures; no provider logos beyond the existing marks |
| HQ-DOC-022 | Dedup: one logical item where identity is determinable safely | D | TESTED | tests/studio/docsources.test.ts + scripts/isolated/project-documents.ts (85): merge only on canonical id / (connector,external_ref) / identical sha+size; same-title negative controls |
| HQ-DOC-023 | Dedup uses source IDs / canonical IDs / hashes only | D | TESTED | tests/studio/docsources.test.ts + scripts/isolated/project-documents.ts (85): merge only on canonical id / (connector,external_ref) / identical sha+size; same-title negative controls |
| HQ-DOC-024 | No dangerous fuzzy merging |  | TESTED | tests/studio/docsources.test.ts + scripts/isolated/project-documents.ts (85): merge only on canonical id / (connector,external_ref) / identical sha+size; same-title negative controls |
| HQ-DOC-025 | External documents need not be copied into Supabase | A | PARTIALLY SATISFIED | external documents are listed by reference with cached extracted text (backend app.hq_project_documents, indexed flag); agent read/search through document_chunks already existed. Thumbnail generation for external files not built |
| HQ-DOC-026 | External docs remain fully searchable by agents | B | PARTIALLY SATISFIED | external documents are listed by reference with cached extracted text (backend app.hq_project_documents, indexed flag); agent read/search through document_chunks already existed. Thumbnail generation for external files not built |
| HQ-DOC-027 | External docs remain readable on demand | B | PARTIALLY SATISFIED | external documents are listed by reference with cached extracted text (backend app.hq_project_documents, indexed flag); agent read/search through document_chunks already existed. Thumbnail generation for external files not built |
| HQ-DOC-028 | External docs previewable while source connected | D | PARTIALLY SATISFIED | external documents are listed by reference with cached extracted text (backend app.hq_project_documents, indexed flag); agent read/search through document_chunks already existed. Thumbnail generation for external files not built |
| HQ-DOC-029 | Cache lightweight derived data (metadata, thumbnails, extracted text, preview pages) without copying the binary | B | PARTIALLY SATISFIED | external documents are listed by reference with cached extracted text (backend app.hq_project_documents, indexed flag); agent read/search through document_chunks already existed. Thumbnail generation for external files not built |
| HQ-DOC-030 | Explicit Import action creating a durable Team HQ-managed copy | D | PARTIALLY SATISFIED | Import control and gateway document_import tested; DB copies cached text now or records a pending request. Fetching the binary of a Drive file on demand is NOT wired (no job enqueued) - documented |
| HQ-DOC-031 | Import survives the original source disappearing | D | PARTIALLY SATISFIED | Import control and gateway document_import tested; DB copies cached text now or records a pending request. Fetching the binary of a Drive file on demand is NOT wired (no job enqueued) - documented |
| HQ-DOC-032 | Never silently import every Drive document |  | TESTED | import only on an explicit press (docs-ui.ts stub asserts); no import performed anywhere |
| HQ-DOC-033 | No production import performed |  | TESTED | import only on an explicit press (docs-ui.ts stub asserts); no import performed anywhere |
| HQ-DOC-034 | In-app preview: PDFs | B | TESTED | in-app viewer renders PDF pages (.out/ux-docs-05-pdf.png), images (ux-docs-07-image.png, driven), text, audio, shows metadata, Open source and Open the file; supersedes the 22 Sept new-tab rule on purpose (basecamp-home updated) |
| HQ-DOC-035 | In-app preview: images | B | TESTED | in-app viewer renders PDF pages (.out/ux-docs-05-pdf.png), images (ux-docs-07-image.png, driven), text, audio, shows metadata, Open source and Open the file; supersedes the 22 Sept new-tab rule on purpose (basecamp-home updated) |
| HQ-DOC-036 | In-app preview: text/documents | B | TESTED | in-app viewer renders PDF pages (.out/ux-docs-05-pdf.png), images (ux-docs-07-image.png, driven), text, audio, shows metadata, Open source and Open the file; supersedes the 22 Sept new-tab rule on purpose (basecamp-home updated) |
| HQ-DOC-037 | Preview shows useful metadata | D | TESTED | in-app viewer renders PDF pages (.out/ux-docs-05-pdf.png), images (ux-docs-07-image.png, driven), text, audio, shows metadata, Open source and Open the file; supersedes the 22 Sept new-tab rule on purpose (basecamp-home updated) |
| HQ-DOC-038 | Thumbnails | A | TESTED | in-app viewer renders PDF pages (.out/ux-docs-05-pdf.png), images (ux-docs-07-image.png, driven), text, audio, shows metadata, Open source and Open the file; supersedes the 22 Sept new-tab rule on purpose (basecamp-home updated) |
| HQ-DOC-039 | Routine viewing does not require opening Drive | B | TESTED | in-app viewer renders PDF pages (.out/ux-docs-05-pdf.png), images (ux-docs-07-image.png, driven), text, audio, shows metadata, Open source and Open the file; supersedes the 22 Sept new-tab rule on purpose (basecamp-home updated) |
| HQ-DOC-040 | "Open Source" action where appropriate | B | TESTED | in-app viewer renders PDF pages (.out/ux-docs-05-pdf.png), images (ux-docs-07-image.png, driven), text, audio, shows metadata, Open source and Open the file; supersedes the 22 Sept new-tab rule on purpose (basecamp-home updated) |
| HQ-DOC-041 | Agents may read/search/create/edit/organise/move/transform documents | B | TESTED | project-documents.ts proves no function deletes documents; agents only archive via a person press |
| HQ-DOC-042 | Agents do NOT autonomously delete source documents by default |  | TESTED | project-documents.ts proves no function deletes documents; agents only archive via a person press |
| HQ-DOC-043 | Explicit user deletion acceptable |  | TESTED | project-documents.ts proves no function deletes documents; agents only archive via a person press |
| HQ-DOC-044 | Logical document versioning (Report → v1 v2 v3), not filename suffixes | D | TESTED | versions derived from superseded_by; new_version/rollback (SQL, 85 checks); UI lists v3,v2,v1 and posts document_rollback (docs-ui.ts stub). Applied nowhere but a local replica |
| HQ-DOC-045 | Retain history | D | TESTED | versions derived from superseded_by; new_version/rollback (SQL, 85 checks); UI lists v3,v2,v1 and posts document_rollback (docs-ui.ts stub). Applied nowhere but a local replica |
| HQ-DOC-046 | Retain provenance | D | TESTED | versions derived from superseded_by; new_version/rollback (SQL, 85 checks); UI lists v3,v2,v1 and posts document_rollback (docs-ui.ts stub). Applied nowhere but a local replica |
| HQ-DOC-047 | Rollback architecture where feasible | D | TESTED | versions derived from superseded_by; new_version/rollback (SQL, 85 checks); UI lists v3,v2,v1 and posts document_rollback (docs-ui.ts stub). Applied nowhere but a local replica |

### HQ-SEARCH / HQ-CMD / HQ-ACT
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-SEARCH-001 | Unified project search across real stores | B | TESTED | page search + palette search tasks and documents (existing providers) and the new providers; palette.ts |
| HQ-SEARCH-002 | Provider: documents | A | TESTED | page search + palette search tasks and documents (existing providers) and the new providers; palette.ts |
| HQ-SEARCH-003 | Provider: tasks | B | TESTED | page search + palette search tasks and documents (existing providers) and the new providers; palette.ts |
| HQ-SEARCH-004 | Provider: chats | D | PARTIALLY SATISFIED | chat provider searches the loaded conversation locally; the office provider searches stored messages (SQL proof, unapplied) |
| HQ-SEARCH-005 | Provider: Post-its | D | TESTED | palette.ts finds a Post-it and a calendar event |
| HQ-SEARCH-006 | Provider: calendar events | D | TESTED | palette.ts finds a Post-it and a calendar event |
| HQ-SEARCH-007 | Provider: saved webpages | B | PARTIALLY SATISFIED | saved pages/sources/research via 0921 psearch_* in SQL (02-project-search.sql PASS) and the palette consumes project_search (stubbed gateway test). Not run against a real office |
| HQ-SEARCH-008 | Provider: sources | B | PARTIALLY SATISFIED | saved pages/sources/research via 0921 psearch_* in SQL (02-project-search.sql PASS) and the palette consumes project_search (stubbed gateway test). Not run against a real office |
| HQ-SEARCH-009 | Provider: agent research | D | PARTIALLY SATISFIED | saved pages/sources/research via 0921 psearch_* in SQL (02-project-search.sql PASS) and the palette consumes project_search (stubbed gateway test). Not run against a real office |
| HQ-SEARCH-010 | Never fabricate results |  | TESTED | every provider reads real stores; a stub that returns nothing yields nothing; unapplied office section degrades silently |
| HQ-SEARCH-011 | Clean extensible search-provider architecture | D | TESTED | finder.js PROVIDERS list + SQL one-function-per-store union |
| HQ-CMD-001 | Cmd+K on macOS opens the palette in Team HQ | D | VISUALLY VERIFIED | scripts/verify/palette.ts (18): Ctrl+K and Meta+K open Team HQ palette (not the classic bar); ux-palette-02-find.png |
| HQ-CMD-002 | Ctrl+K elsewhere | D | VISUALLY VERIFIED | scripts/verify/palette.ts (18): Ctrl+K and Meta+K open Team HQ palette (not the classic bar); ux-palette-02-find.png |
| HQ-CMD-003 | FIND: documents | D | TESTED | scripts/verify/palette.ts (18): finds tasks, documents, events, Post-its, office results; Enter opens the record |
| HQ-CMD-004 | FIND: tasks | D | TESTED | scripts/verify/palette.ts (18): finds tasks, documents, events, Post-its, office results; Enter opens the record |
| HQ-CMD-005 | FIND: events | D | TESTED | scripts/verify/palette.ts (18): finds tasks, documents, events, Post-its, office results; Enter opens the record |
| HQ-CMD-006 | FIND: sources | D | TESTED | scripts/verify/palette.ts (18): finds tasks, documents, events, Post-its, office results; Enter opens the record |
| HQ-CMD-007 | FIND: project content generally | D | TESTED | scripts/verify/palette.ts (18): finds tasks, documents, events, Post-its, office results; Enter opens the record |
| HQ-CMD-008 | ACTION: create task | D | PARTIALLY SATISFIED | "New to-do" navigates to the To-dos surface (its add form); it does not create a task in one step |
| HQ-CMD-009 | ACTION: open Calendar | B | TESTED | palette: New event, Zoom, Tools list (Schedule alias "calendar"), project switch via Jump rows |
| HQ-CMD-010 | ACTION: open Documents | B | TESTED | palette: New event, Zoom, Tools list (Schedule alias "calendar"), project switch via Jump rows |
| HQ-CMD-011 | ACTION: switch project | A | TESTED | palette: New event, Zoom, Tools list (Schedule alias "calendar"), project switch via Jump rows |
| HQ-CMD-012 | ACTION: open module | B | TESTED | palette: New event, Zoom, Tools list (Schedule alias "calendar"), project switch via Jump rows |
| HQ-CMD-013 | ACTION: ask Claire/team where architecture supports | D | IMPLEMENTED | "Ask the team: ..." row sends via chatSend; deliberately last in the list; not driven (it would send a message) |
| HQ-CMD-014 | ACTION: change layout | D | TESTED | palette.ts: Layout presets, saved layouts, Tidy, Reset the view, Zoom |
| HQ-CMD-015 | ACTION: choose preset | D | TESTED | palette.ts: Layout presets, saved layouts, Tidy, Reset the view, Zoom |
| HQ-CMD-016 | Reuse existing jump system; no competing second command system |  | TESTED | extends bc/jump.js; no second command system; classic bar yields to it in Team HQ |
| HQ-ACT-001 | Project Activity module (human-readable history) | B | ALREADY SATISFIED | existing project Activity module over real events; unchanged source |
| HQ-ACT-002 | Uses real audit/event infrastructure; nothing fabricated | A | ALREADY SATISFIED | existing project Activity module over real events; unchanged source |
| HQ-ACT-003 | Filter: user | D | TESTED | scripts/verify/activity-ui.ts (9): filters offered only when something can match; backend adds via/category (0920 SQL proof) |
| HQ-ACT-004 | Filter: agent | D | TESTED | scripts/verify/activity-ui.ts (9): filters offered only when something can match; backend adds via/category (0920 SQL proof) |
| HQ-ACT-005 | Filter: integration | D | TESTED | scripts/verify/activity-ui.ts (9): filters offered only when something can match; backend adds via/category (0920 SQL proof) |
| HQ-ACT-006 | Filter: synchronisation | D | TESTED | scripts/verify/activity-ui.ts (9): filters offered only when something can match; backend adds via/category (0920 SQL proof) |
| HQ-ACT-007 | Filter: documents | D | TESTED | scripts/verify/activity-ui.ts (9): filters offered only when something can match; backend adds via/category (0920 SQL proof) |
| HQ-ACT-008 | Filter: tasks | D | TESTED | scripts/verify/activity-ui.ts (9): filters offered only when something can match; backend adds via/category (0920 SQL proof) |
| HQ-ACT-009 | Filter: calendar | D | TESTED | scripts/verify/activity-ui.ts (9): filters offered only when something can match; backend adds via/category (0920 SQL proof) |
| HQ-ACT-010 | Channel provenance preserved (via Team HQ / ChatGPT / Claude / Telegram / Slack) | D | PARTIALLY SATISFIED | "via ChatGPT/Claude/Telegram/Slack" chips tested in the UI; backend derives it (events.origin_channel, MCP client kind, job) in 0920 SQL proof. The origin_channel CHECK on inbound_commands was deliberately not widened |
| HQ-ACT-011 | Channel provenance shown in rows as "Grant via X" | D | PARTIALLY SATISFIED | "via ChatGPT/Claude/Telegram/Slack" chips tested in the UI; backend derives it (events.origin_channel, MCP client kind, job) in 0920 SQL proof. The origin_channel CHECK on inbound_commands was deliberately not widened |

### HQ-WEB / HQ-PDF / HQ-STYLE
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-WEB-001 | Investigate existing browser/search tooling first; no rebuild |  | TESTED | backend recon in docs/ux-be-web-notes.md |
| HQ-WEB-002 | Autonomous: search web | D | PARTIALLY SATISFIED | web.research handler + DuckDuckGo port + one-hop link follow + safe download allow-list, all tested against fakes (tests/browser, isolated web-research.ts). The DuckDuckGo parser has never seen the real service; unapplied migration 0930 |
| HQ-WEB-003 | Autonomous: browse pages | A | ALREADY SATISFIED | existing browser.gather tier (read, extract, screenshot, authenticated sessions by named address) |
| HQ-WEB-004 | Autonomous: follow links | D | PARTIALLY SATISFIED | web.research handler + DuckDuckGo port + one-hop link follow + safe download allow-list, all tested against fakes (tests/browser, isolated web-research.ts). The DuckDuckGo parser has never seen the real service; unapplied migration 0930 |
| HQ-WEB-005 | Autonomous: read / extract | A | ALREADY SATISFIED | existing browser.gather tier (read, extract, screenshot, authenticated sessions by named address) |
| HQ-WEB-006 | Autonomous: screenshot | A | ALREADY SATISFIED | existing browser.gather tier (read, extract, screenshot, authenticated sessions by named address) |
| HQ-WEB-007 | Autonomous: safe downloads | D | PARTIALLY SATISFIED | web.research handler + DuckDuckGo port + one-hop link follow + safe download allow-list, all tested against fakes (tests/browser, isolated web-research.ts). The DuckDuckGo parser has never seen the real service; unapplied migration 0930 |
| HQ-WEB-008 | Authenticated resources where safely permitted | A | ALREADY SATISFIED | existing browser.gather tier (read, extract, screenshot, authenticated sessions by named address) |
| HQ-WEB-009 | Useful pages become persistent project Sources | A | TESTED | 0930 provenance reader + web_sources section (SQL proof) and the Sources UI (docs-ui.ts stub); evidence kept through citedSource |
| HQ-WEB-010 | Provenance stored: URL | A | TESTED | 0930 provenance reader + web_sources section (SQL proof) and the Sources UI (docs-ui.ts stub); evidence kept through citedSource |
| HQ-WEB-011 | …title | A | TESTED | 0930 provenance reader + web_sources section (SQL proof) and the Sources UI (docs-ui.ts stub); evidence kept through citedSource |
| HQ-WEB-012 | …retrieval/access date | D | TESTED | 0930 provenance reader + web_sources section (SQL proof) and the Sources UI (docs-ui.ts stub); evidence kept through citedSource |
| HQ-WEB-013 | …project | A | TESTED | 0930 provenance reader + web_sources section (SQL proof) and the Sources UI (docs-ui.ts stub); evidence kept through citedSource |
| HQ-WEB-014 | …agent | D | TESTED | 0930 provenance reader + web_sources section (SQL proof) and the Sources UI (docs-ui.ts stub); evidence kept through citedSource |
| HQ-WEB-015 | …originating job/research task | D | TESTED | 0930 provenance reader + web_sources section (SQL proof) and the Sources UI (docs-ui.ts stub); evidence kept through citedSource |
| HQ-WEB-016 | …extracted/indexed content | B | TESTED | 0930 provenance reader + web_sources section (SQL proof) and the Sources UI (docs-ui.ts stub); evidence kept through citedSource |
| HQ-WEB-017 | …citations/evidence retained when research contributes to a report | B | TESTED | 0930 provenance reader + web_sources section (SQL proof) and the Sources UI (docs-ui.ts stub); evidence kept through citedSource |
| HQ-WEB-018 | Approval required: send/post/publish/email/contact a human/consequential form/purchase/booking/external upload | A | TESTED | tests/handlers/web-research-boundary.test.ts + 05-web-sources.sql: acting verbs refused, authorize_effect gates, harness never reaches a destination |
| HQ-WEB-019 | Reuse mayAct/approval architecture; no parallel approval system |  | TESTED | tests/handlers/web-research-boundary.test.ts + 05-web-sources.sql: acting verbs refused, authorize_effect gates, harness never reaches a destination |
| HQ-PDF-001 | Investigate existing artifact generation first |  | TESTED | recon recorded in docs/ux-be-artifacts-notes.md |
| HQ-PDF-002 | "Find latest report → beautiful PDF" pipeline: resolve source | D | TESTED | src/artifacts/source.ts resolver (asks when unclear; negative controls) + 05-artifacts.ts end to end with a fake model |
| HQ-PDF-003 | …read it | D | TESTED | src/artifacts/source.ts resolver (asks when unclear; negative controls) + 05-artifacts.ts end to end with a fake model |
| HQ-PDF-004 | …structure/edit content | D | TESTED | src/artifacts/source.ts resolver (asks when unclear; negative controls) + 05-artifacts.ts end to end with a fake model |
| HQ-PDF-005 | …apply project style | D | TESTED | style profile applied by style.ts; hash recorded in document_provenance |
| HQ-PDF-006 | …appropriate visual design | B | PARTIALLY SATISFIED | deterministic hand-built PDF writer with a design brief; sample PDFs rasterised and viewed at 50dpi by the build agent; logo images cannot be drawn |
| HQ-PDF-007 | …render polished artifact | B | PARTIALLY SATISFIED | deterministic hand-built PDF writer with a design brief; sample PDFs rasterised and viewed at 50dpi by the build agent; logo images cannot be drawn |
| HQ-PDF-008 | …QA output | A | TESTED | layoutCollisions check red on the intro-over-title defect, green fixed; found two real defects |
| HQ-PDF-009 | …save to Documents | B | TESTED | 05-artifacts.ts: v1, v2, v3 + rollback v4 through app.document_revise_made; unapplied 0940 |
| HQ-PDF-010 | …retain provenance | B | TESTED | 05-artifacts.ts: v1, v2, v3 + rollback v4 through app.document_revise_made; unapplied 0940 |
| HQ-PDF-011 | …new versions for revisions | D | TESTED | 05-artifacts.ts: v1, v2, v3 + rollback v4 through app.document_revise_made; unapplied 0940 |
| HQ-PDF-012 | Does not require Claude API; provider-independent publishing |  | TESTED | no model call in the rendering path (source scan test) |
| HQ-PDF-013 | Deterministic renderer; LLM only for editorial/design decisions | A | TESTED | no model call in the rendering path (source scan test) |
| HQ-PDF-014 | High visual quality; polished vertical slice over enormous engine |  | PARTIALLY SATISFIED | polished vertical slice, not an engine; cover remains 2/3 empty by design |
| HQ-STYLE-001 | Project style/design profile model + storage | D | TESTED | 0923 style_profiles + validator (SQL proof); all fields storable; logo/tone/structure stored but only palette/fonts/title band are rendered |
| HQ-STYLE-002 | Contents: brand colours | D | TESTED | 0923 style_profiles + validator (SQL proof); all fields storable; logo/tone/structure stored but only palette/fonts/title band are rendered |
| HQ-STYLE-003 | …typography | D | TESTED | 0923 style_profiles + validator (SQL proof); all fields storable; logo/tone/structure stored but only palette/fonts/title band are rendered |
| HQ-STYLE-004 | …logos | D | TESTED | 0923 style_profiles + validator (SQL proof); all fields storable; logo/tone/structure stored but only palette/fonts/title band are rendered |
| HQ-STYLE-005 | …writing tone | D | TESTED | 0923 style_profiles + validator (SQL proof); all fields storable; logo/tone/structure stored but only palette/fonts/title band are rendered |
| HQ-STYLE-006 | …terminology | D | TESTED | 0923 style_profiles + validator (SQL proof); all fields storable; logo/tone/structure stored but only palette/fonts/title band are rendered |
| HQ-STYLE-007 | …preferred document structures | D | TESTED | 0923 style_profiles + validator (SQL proof); all fields storable; logo/tone/structure stored but only palette/fonts/title band are rendered |
| HQ-STYLE-008 | …formatting conventions | D | TESTED | 0923 style_profiles + validator (SQL proof); all fields storable; logo/tone/structure stored but only palette/fonts/title band are rendered |
| HQ-STYLE-009 | …chart style | D | TESTED | 0923 style_profiles + validator (SQL proof); all fields storable; logo/tone/structure stored but only palette/fonts/title band are rendered |
| HQ-STYLE-010 | …image style | D | TESTED | 0923 style_profiles + validator (SQL proof); all fields storable; logo/tone/structure stored but only palette/fonts/title band are rendered |
| HQ-STYLE-011 | …audience assumptions | D | TESTED | 0923 style_profiles + validator (SQL proof); all fields storable; logo/tone/structure stored but only palette/fonts/title band are rendered |
| HQ-STYLE-012 | …reusable instructions | D | TESTED | 0923 style_profiles + validator (SQL proof); all fields storable; logo/tone/structure stored but only palette/fonts/title band are rendered |
| HQ-STYLE-013 | "Save this as this project's report style" interaction | D | DEFERRED | "save this report as the style" needs style extraction, deliberately not faked |
| HQ-STYLE-014 | Tenant default → project inherits → project overrides | D | TESTED | field-level inheritance with inherited_from (SQL proof) shown in the UI form |
| HQ-STYLE-015 | Style editing UI | D | VISUALLY VERIFIED | scripts/verify/style-ui.ts (8) + .out/ux-style-02-form.png |
| HQ-STYLE-016 | Style integrated into the PDF renderer | D | TESTED | src/artifacts/style.ts + report.ts render palette, faces, title band and compact density; default output byte-identical (hash test) |
| HQ-STYLE-017 | No faked automatic style extraction |  | ALREADY SATISFIED | no extraction exists to fake |

### HQ-EXT / HQ-VIC / HQ-CONV / HQ-AUTO
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-EXT-001 | Audit existing GPT/external access path |  | TESTED | recon + tools.ts catalogue as pure data (tests/mcp/tools.test.ts) |
| HQ-EXT-002 | Reusable secure permissioned tool interface, not vendor-bespoke | B | TESTED | recon + tools.ts catalogue as pure data (tests/mcp/tools.test.ts) |
| HQ-EXT-003 | Tool: list projects | A | PARTIALLY SATISFIED | tools: search_project, list_tasks, create/update_task, list/create/update_event, inspect_activity, ask_team, start_research, generate_artifact (0922/0924 SQL proofs 03 and 05). delete_event deliberately omitted. Not run through a real ChatGPT/Claude connection or a deployed edge function |
| HQ-EXT-004 | Tool: search project | B | PARTIALLY SATISFIED | tools: search_project, list_tasks, create/update_task, list/create/update_event, inspect_activity, ask_team, start_research, generate_artifact (0922/0924 SQL proofs 03 and 05). delete_event deliberately omitted. Not run through a real ChatGPT/Claude connection or a deployed edge function |
| HQ-EXT-005 | Tool: search documents | A | PARTIALLY SATISFIED | tools: search_project, list_tasks, create/update_task, list/create/update_event, inspect_activity, ask_team, start_research, generate_artifact (0922/0924 SQL proofs 03 and 05). delete_event deliberately omitted. Not run through a real ChatGPT/Claude connection or a deployed edge function |
| HQ-EXT-006 | Tool: read documents | A | PARTIALLY SATISFIED | tools: search_project, list_tasks, create/update_task, list/create/update_event, inspect_activity, ask_team, start_research, generate_artifact (0922/0924 SQL proofs 03 and 05). delete_event deliberately omitted. Not run through a real ChatGPT/Claude connection or a deployed edge function |
| HQ-EXT-007 | Tool: list/create/update tasks | D | PARTIALLY SATISFIED | tools: search_project, list_tasks, create/update_task, list/create/update_event, inspect_activity, ask_team, start_research, generate_artifact (0922/0924 SQL proofs 03 and 05). delete_event deliberately omitted. Not run through a real ChatGPT/Claude connection or a deployed edge function |
| HQ-EXT-008 | Tool: inspect calendar | D | PARTIALLY SATISFIED | tools: search_project, list_tasks, create/update_task, list/create/update_event, inspect_activity, ask_team, start_research, generate_artifact (0922/0924 SQL proofs 03 and 05). delete_event deliberately omitted. Not run through a real ChatGPT/Claude connection or a deployed edge function |
| HQ-EXT-009 | Tool: create/update events | D | PARTIALLY SATISFIED | tools: search_project, list_tasks, create/update_task, list/create/update_event, inspect_activity, ask_team, start_research, generate_artifact (0922/0924 SQL proofs 03 and 05). delete_event deliberately omitted. Not run through a real ChatGPT/Claude connection or a deployed edge function |
| HQ-EXT-010 | Tool: ask team | D | PARTIALLY SATISFIED | tools: search_project, list_tasks, create/update_task, list/create/update_event, inspect_activity, ask_team, start_research, generate_artifact (0922/0924 SQL proofs 03 and 05). delete_event deliberately omitted. Not run through a real ChatGPT/Claude connection or a deployed edge function |
| HQ-EXT-011 | Tool: inspect Activity | B | PARTIALLY SATISFIED | tools: search_project, list_tasks, create/update_task, list/create/update_event, inspect_activity, ask_team, start_research, generate_artifact (0922/0924 SQL proofs 03 and 05). delete_event deliberately omitted. Not run through a real ChatGPT/Claude connection or a deployed edge function |
| HQ-EXT-012 | Tool: trigger safe research | D | PARTIALLY SATISFIED | tools: search_project, list_tasks, create/update_task, list/create/update_event, inspect_activity, ask_team, start_research, generate_artifact (0922/0924 SQL proofs 03 and 05). delete_event deliberately omitted. Not run through a real ChatGPT/Claude connection or a deployed edge function |
| HQ-EXT-013 | Tool: trigger artifact generation | B | PARTIALLY SATISFIED | tools: search_project, list_tasks, create/update_task, list/create/update_event, inspect_activity, ask_team, start_research, generate_artifact (0922/0924 SQL proofs 03 and 05). delete_event deliberately omitted. Not run through a real ChatGPT/Claude connection or a deployed edge function |
| HQ-EXT-014 | Channel provenance "Grant via ChatGPT / Claude" | D | TESTED | 05-mcp-calendar.sql: an event made by a chatgpt-kind client shows origin chatgpt and "via ChatGPT" |
| HQ-EXT-015 | No secrets exposed |  | TESTED | scope, office-from-token, write scope, approval via authorize_effect proved in SQL; no secrets in outputs |
| HQ-EXT-016 | Tenant isolation not weakened |  | TESTED | scope, office-from-token, write scope, approval via authorize_effect proved in SQL; no secrets in outputs |
| HQ-EXT-017 | Approval policies not bypassed |  | TESTED | scope, office-from-token, write scope, approval via authorize_effect proved in SQL; no secrets in outputs |
| HQ-EXT-018 | Does not block UX work |  | ALREADY SATISFIED | external work stayed in sibling branches and never blocked the UI |
| HQ-VIC-001 | Locate the ACTUAL Vicuña/Vacunia integration; do not assume spelling |  | NOT INSPECTED |  |
| HQ-VIC-002 | Audit real code |  | NOT INSPECTED |  |
| HQ-VIC-003 | Verify create/update note → persistence → sync → representation → read-back |  | NOT INSPECTED |  |
| HQ-VIC-004 | Determine canonical source |  | NOT INSPECTED |  |
| HQ-VIC-005 | Determine sync behaviour |  | NOT INSPECTED |  |
| HQ-VIC-006 | Determine duplicate prevention |  | NOT INSPECTED |  |
| HQ-VIC-007 | Determine failure behaviour |  | NOT INSPECTED |  |
| HQ-VIC-008 | Fix concrete defects where possible |  | NOT INSPECTED |  |
| HQ-VIC-009 | Record what remains to verify if external E2E impossible |  | NOT INSPECTED |  |
| HQ-CONV-001 | Workspace operations exposed as reusable actions (conversational control later) | D | IMPLEMENTED | workspace operations are plain exported functions (layout.js: place, setTint, applyPreset, setZoom, saveLayout, add/remove) already invoked by the palette; no natural-language bridge built |
| HQ-CONV-002 | Examples supported architecturally: bigger / move / tint / zoom / hide / save layout | D | PARTIALLY SATISFIED | the operations exist; mapping "make Documents bigger" to them is not built |
| HQ-AUTO-001 | Agents may autonomously generate documents/PDFs/versions/non-destructive artifacts | A | TESTED | artifact tests: generating/saving/versioning needs no approval; delivery only to the requesting channel; existing gate untouched |
| HQ-AUTO-002 | Approval required before emailing / publishing / external share / third-party upload | A | TESTED | artifact tests: generating/saving/versioning needs no approval; delivery only to the requesting channel; existing gate untouched |
| HQ-AUTO-003 | Uses existing approval architecture |  | TESTED | artifact tests: generating/saving/versioning needs no approval; delivery only to the requesting channel; existing gate untouched |

### HQ-QA / HQ-A11Y / HQ-ISO — cross-cutting
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-ISO-001 | New worktree + branch from current multi-user-p4 HEAD |  | TESTED | branch claude/team-hq-ux-overnight cut from multi-user-p4@5e3eafa6; that branch and its worktree untouched; never merged to it or main; no force-push |
| HQ-ISO-002 | No change to the multi-user-p4 worktree; no merge to p4/main; no rewrite; no force-push |  | TESTED | branch claude/team-hq-ux-overnight cut from multi-user-p4@5e3eafa6; that branch and its worktree untouched; never merged to it or main; no force-push |
| HQ-ISO-003 | No production migration, schema/data/config/secret/OAuth change, no prod tests, no deploy |  | PARTIALLY SATISFIED | No migration applied, no deploy. Two sub-agents ran one read-only catalogue query against production by accident (check:gateway-wrappers / possibly check:callers, check:consumed) before the guard was understood; nothing was written. Env stripped afterwards. Migrations 0897,0900,0920-0925,0924,0930,0940 are UNAPPLIED |
| HQ-ISO-004 | Schema changes only as unapplied migration files |  | PARTIALLY SATISFIED | No migration applied, no deploy. Two sub-agents ran one read-only catalogue query against production by accident (check:gateway-wrappers / possibly check:callers, check:consumed) before the guard was understood; nothing was written. Env stripped afterwards. Migrations 0897,0900,0920-0925,0924,0930,0940 are UNAPPLIED |
| HQ-ISO-005 | Push the new branch periodically |  | TESTED | pushed repeatedly to origin/claude/team-hq-ux-overnight |
| HQ-ISO-006 | No "Basecamp" in new user-facing names |  | TESTED | new copy says Team HQ / Docs & Files / Document style; no Basecamp in user-facing text (internal names kept) |
| HQ-ISO-007 | No obsolete interface resurrected |  | ALREADY SATISFIED | only web/studio/bc (Team HQ) touched; /classic untouched except the Cmd+K yield |
| HQ-QA-001 | Desktop 1440 inspected |  | VISUALLY VERIFIED | scripts/verify/ux-matrix.ts (40): 1440, 1280, 768, 390 captured for home, calendar, documents, activity and inspected (.out/ux-matrix-*.png) |
| HQ-QA-002 | Desktop 1280 inspected |  | VISUALLY VERIFIED | scripts/verify/ux-matrix.ts (40): 1440, 1280, 768, 390 captured for home, calendar, documents, activity and inspected (.out/ux-matrix-*.png) |
| HQ-QA-003 | Mobile 390×844 inspected |  | VISUALLY VERIFIED | scripts/verify/ux-matrix.ts (40): 1440, 1280, 768, 390 captured for home, calendar, documents, activity and inspected (.out/ux-matrix-*.png) |
| HQ-QA-004 | Intermediate/tablet width inspected |  | VISUALLY VERIFIED | scripts/verify/ux-matrix.ts (40): 1440, 1280, 768, 390 captured for home, calendar, documents, activity and inspected (.out/ux-matrix-*.png) |
| HQ-QA-005 | Interaction exercised (drag, resize, guides, tidy, reset, zoom, tint, maximize, back, post-it) |  | TESTED | workspace/calendar/docs/palette/activity/style suites drive real pointer and keyboard |
| HQ-QA-006 | Calendar day/week/month/compact inspected |  | VISUALLY VERIFIED | ux-cal-*, ux-docs-*, ux-palette-*, ux-activity-01 captures |
| HQ-QA-007 | Documents filters/indicators/thumbnails/preview inspected |  | VISUALLY VERIFIED | ux-cal-*, ux-docs-*, ux-palette-*, ux-activity-01 captures |
| HQ-QA-008 | Palette / search / Activity inspected |  | VISUALLY VERIFIED | ux-cal-*, ux-docs-*, ux-palette-*, ux-activity-01 captures |
| HQ-QA-009 | Keyboard navigation + focus inspected |  | PARTIALLY SATISFIED | keyboard: Alt+arrows, palette arrows/Escape/Tab trap tested; full tab-order audit not run |
| HQ-QA-010 | Reduced motion inspected |  | TESTED | ux-matrix.ts reduced-motion legs |
| HQ-QA-011 | Light/dark inspected |  | BLOCKED | Team HQ has no light theme to inspect; dark only |
| HQ-QA-012 | Existing relevant tests run; no tests weakened to go green |  | TESTED | full vitest: 4709 pass; the one file that errors needs a production token by design; basecamp-{home,journey,todos,cards,docs,back,contacts,keyboard,preservation} pass. Assertions changed only where the requirement itself changed (grid->freeform; new-tab->in-app viewer; header click position) and each is commented |
| HQ-QA-013 | Tests: layout serialisation/restoration, project isolation, reset safety, zoom/tint/post-it persistence |  | PARTIALLY SATISFIED | covered by the suites above for layout, Post-its, calendar, documents, search, palette, activity; maximize/back tested; tenant isolation proved in SQL replicas only; no test drives a real second tenant in a browser |
| HQ-QA-014 | Tests: calendar project association, document filter/dedupe/import-vs-index/versioning |  | PARTIALLY SATISFIED | covered by the suites above for layout, Post-its, calendar, documents, search, palette, activity; maximize/back tested; tenant isolation proved in SQL replicas only; no test drives a real second tenant in a browser |
| HQ-QA-015 | Tests: unified search, command actions, maximize/history, browser approval boundary, audit provenance, tenant isolation |  | PARTIALLY SATISFIED | covered by the suites above for layout, Post-its, calendar, documents, search, palette, activity; maximize/back tested; tenant isolation proved in SQL replicas only; no test drives a real second tenant in a browser |
| HQ-A11Y-001 | Keyboard access maintained/improved |  | PARTIALLY SATISFIED | native buttons/inputs, aria-pressed on toggles, dialogs with role=dialog/aria-modal, focus-visible rings; axe not run |
| HQ-A11Y-002 | Focus visibility |  | PARTIALLY SATISFIED | native buttons/inputs, aria-pressed on toggles, dialogs with role=dialog/aria-modal, focus-visible rings; axe not run |
| HQ-A11Y-003 | Appropriate ARIA |  | PARTIALLY SATISFIED | native buttons/inputs, aria-pressed on toggles, dialogs with role=dialog/aria-modal, focus-visible rings; axe not run |
| HQ-A11Y-004 | Contrast |  | PARTIALLY SATISFIED | new colours use existing tokens; contrast not measured |
| HQ-A11Y-005 | ≈44px touch targets where interaction requires |  | IMPLEMENTED | 44px floors under (pointer: coarse); not run on a touch device |
| HQ-A11Y-006 | prefers-reduced-motion |  | TESTED | ux-matrix.ts |
| HQ-A11Y-007 | Mobile usable and unbroken |  | VISUALLY VERIFIED | 390px captures |
| HQ-A11Y-008 | No iOS input-zoom regression (inputs ≥16px) |  | IMPLEMENTED | new inputs are 16px; not verified on iOS |
| HQ-VIS-001 | Feels polished, calm, dense, uncluttered, coherent; none of the listed anti-patterns |  | PARTIALLY SATISFIED | inspected at four widths; judgement is the reader's: see the morning report limitations |
| HQ-VIS-002 | Recognisable service logos used tastefully |  | PARTIALLY SATISFIED | inspected at four widths; judgement is the reader's: see the morning report limitations |
| HQ-VIS-003 | Preserve and improve current Team HQ identity |  | PARTIALLY SATISFIED | inspected at four widths; judgement is the reader's: see the morning report limitations |
| HQ-ENG-001 | Extract focused modules (workspace state, layout persistence, module actions, animation, providers, search, calendar adapters, activity) |  | TESTED | new modules: layout.js, stage.js, expand.js, calendar.js, docsources.js, docview.js, finder.js, websources.js, style.js; wire.js/shell.js grew less than they would have |
| HQ-ENG-002 | No framework rewrite / unrelated refactor |  | ALREADY SATISFIED | no framework change |

### Spec checkpoints
- 4-hour re-read: _pending_
- 8-hour re-read: _pending_
- Final re-read: _pending_

### Notes
**HQ-NOTES-VICUNA.** No code, migration or doc names "Vicuña" or "Vacunia". The only notes/to-do provider integration is **Vikunja** (CLAUDE.md ADR-0059). Audit in HQ-VIC rows.
