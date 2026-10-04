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
| HQ-ACCT-001 | Login/logout/account control is extremely small | B | NOT INSPECTED | |
| HQ-ACCT-002 | …subtle | | NOT INSPECTED | |
| HQ-ACCT-003 | …positioned top-right | | NOT INSPECTED | |
| HQ-ACCT-004 | …minimal screen consumption; never dominates project UI | | NOT INSPECTED | |

### HQ-LAYOUT — freeform workspace
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-LAYOUT-001 | Modules move continuously (no cell snapping) | D | NOT INSPECTED | |
| HQ-LAYOUT-002 | Modules resize continuously | D | NOT INSPECTED | |
| HQ-LAYOUT-003 | No mandatory fixed increments (the 12-col/44px grid unit is removed) | D | NOT INSPECTED | |
| HQ-LAYOUT-004 | Gentle alignment guides while dragging/resizing | D | NOT INSPECTED | |
| HQ-LAYOUT-005 | Overlap is permitted | D | NOT INSPECTED | |
| HQ-LAYOUT-006 | Overlap does not force reflow of other modules | D | NOT INSPECTED | |
| HQ-LAYOUT-007 | Auto Arrange / Tidy control exists (subtle) | D | NOT INSPECTED | |
| HQ-LAYOUT-008 | Auto Arrange lightly tidies, does not redesign | D | NOT INSPECTED | |
| HQ-LAYOUT-009 | Reset View control exists | B | NOT INSPECTED | |
| HQ-LAYOUT-010 | Reset View resets presentation only (positions, dimensions, zoom, layout state) | B | NOT INSPECTED | |
| HQ-LAYOUT-011 | Reset View cannot delete Post-it content / tasks / documents / events / project data | | NOT INSPECTED | |
| HQ-LAYOUT-012 | Layouts are project-specific and independent | A | NOT INSPECTED | |
| HQ-LAYOUT-013 | Positions persist | A | NOT INSPECTED | |
| HQ-LAYOUT-014 | Dimensions persist | A | NOT INSPECTED | |
| HQ-LAYOUT-015 | Visibility persists | A | NOT INSPECTED | |
| HQ-LAYOUT-016 | Tints persist | D | NOT INSPECTED | |
| HQ-LAYOUT-017 | Zoom persists | D | NOT INSPECTED | |
| HQ-LAYOUT-018 | Other relevant presentation state persists (z-order) | D | NOT INSPECTED | |
| HQ-LAYOUT-019 | Architecture for named layouts | D | NOT INSPECTED | |
| HQ-LAYOUT-020 | Save current layout under a name | D | NOT INSPECTED | |
| HQ-LAYOUT-021 | Load / switch layout | D | NOT INSPECTED | |
| HQ-LAYOUT-022 | Rename layout | D | NOT INSPECTED | |
| HQ-LAYOUT-023 | Delete layout | D | NOT INSPECTED | |
| HQ-LAYOUT-024 | Preset: Overview | D | NOT INSPECTED | |
| HQ-LAYOUT-025 | Preset: Planning | D | NOT INSPECTED | |
| HQ-LAYOUT-026 | Preset: Research | D | NOT INSPECTED | |
| HQ-LAYOUT-027 | Preset: Documents | D | NOT INSPECTED | |
| HQ-LAYOUT-028 | Dashboard stays constrained to the browser viewport | | NOT INSPECTED | |
| HQ-LAYOUT-029 | No infinite canvas | | NOT INSPECTED | |
| HQ-LAYOUT-030 | Keyboard can still move/resize a module | A | NOT INSPECTED | |
| HQ-LAYOUT-031 | Mobile/phone keeps a usable stacked layout (free layout is desktop) | A | NOT INSPECTED | |
| HQ-LAYOUT-032 | Modules cannot be dragged fully off the stage | | NOT INSPECTED | |

### HQ-ZOOM
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-ZOOM-001 | Zoom scales the actual module workspace | D | NOT INSPECTED | |
| HQ-ZOOM-002 | Visible controls  −  100%  +  | D | NOT INSPECTED | |
| HQ-ZOOM-003 | Zoom reset control | D | NOT INSPECTED | |
| HQ-ZOOM-004 | Mouse/trackpad zoom via modifier-wheel (Ctrl/Cmd+wheel, pinch) | D | NOT INSPECTED | |
| HQ-ZOOM-005 | Plain wheel still scrolls inside Chat/Tasks/Documents/Calendar | | NOT INSPECTED | |
| HQ-ZOOM-006 | Fluid (animated) zoom feel | D | NOT INSPECTED | |
| HQ-ZOOM-007 | Zoom is bounded and keeps stage inside viewport | | NOT INSPECTED | |

### HQ-DENSITY — module chrome
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-DENSITY-001 | Thinner / subtler borders | | NOT INSPECTED | |
| HQ-DENSITY-002 | Compact headers | | NOT INSPECTED | |
| HQ-DENSITY-003 | Tighter padding | | NOT INSPECTED | |
| HQ-DENSITY-004 | Smaller handles | | NOT INSPECTED | |
| HQ-DENSITY-005 | Reduced dead space; content fills most of a module | | NOT INSPECTED | |
| HQ-CTRL-001 | Module controls hidden by default | A | NOT INSPECTED | |
| HQ-CTRL-002 | Revealed on hover | A | NOT INSPECTED | |
| HQ-CTRL-003 | Revealed on keyboard focus | A | NOT INSPECTED | |
| HQ-CTRL-004 | Revealed appropriately on touch | | NOT INSPECTED | |
| HQ-CTRL-005 | Reveal is elegant (no layout shift) | | NOT INSPECTED | |

### HQ-TINT
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-TINT-001 | Each module has an independent subtle tint | D | NOT INSPECTED | |
| HQ-TINT-002 | ≈8–12 curated tasteful tints | D | NOT INSPECTED | |
| HQ-TINT-003 | Tiny colour control per module | D | NOT INSPECTED | |
| HQ-TINT-004 | Custom colour where straightforward | D | NOT INSPECTED | |
| HQ-TINT-005 | Tint persists per project/layout | D | NOT INSPECTED | |
| HQ-TINT-006 | Tint legible in light and dark (text contrast kept) | | NOT INSPECTED | |

### HQ-MAX — maximize + spatial animation
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-MAX-001 | Every normal module except Post-its can maximize | B | NOT INSPECTED | |
| HQ-MAX-002 | Maximized module occupies nearly the whole usable screen | B | NOT INSPECTED | |
| HQ-MAX-003 | Only a small unobtrusive Back/Close control plus essential navigation | B | NOT INSPECTED | |
| HQ-MAX-004 | Post-its have no maximize | | NOT INSPECTED | |
| HQ-ANIM-001 | Card visually expands FROM its dashboard position into maximized state | D | NOT INSPECTED | |
| HQ-ANIM-002 | Restore animates back toward the originating card | D | NOT INSPECTED | |
| HQ-ANIM-003 | Animation is smooth, restrained, premium, physically coherent, responsive | D | NOT INSPECTED | |
| HQ-ANIM-004 | prefers-reduced-motion respected | | NOT INSPECTED | |
| HQ-ANIM-005 | Spatial transition is applied as a general principle where appropriate (drag lift, layout switch, zoom, post-it creation) | D | NOT INSPECTED | |
| HQ-HIST-001 | Browser Back restores the previous dashboard/module state when maximized | D | NOT INSPECTED | |
| HQ-HIST-002 | Mouse Back button does the same | D | NOT INSPECTED | |
| HQ-HIST-003 | Back never navigates unexpectedly to another Team HQ page | D | NOT INSPECTED | |
| HQ-HIST-004 | Uses browser history/state appropriately (push on open) | D | NOT INSPECTED | |

### HQ-POSTIT
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-POSTIT-001 | Project-specific Post-it notes | D | NOT INSPECTED | |
| HQ-POSTIT-002 | Initially one attractive yellow Post-it/note affordance | D | NOT INSPECTED | |
| HQ-POSTIT-003 | Click directly and type; no editor modal | D | NOT INSPECTED | |
| HQ-POSTIT-004 | Autosave while typing | D | NOT INSPECTED | |
| HQ-POSTIT-005 | Create/pull out additional Post-its | D | NOT INSPECTED | |
| HQ-POSTIT-006 | Each is an independent dashboard object | D | NOT INSPECTED | |
| HQ-POSTIT-007 | Individually movable | D | NOT INSPECTED | |
| HQ-POSTIT-008 | Individually resizable where sensible | D | NOT INSPECTED | |
| HQ-POSTIT-009 | Explicitly removable | D | NOT INSPECTED | |
| HQ-POSTIT-010 | Persist between sessions | D | NOT INSPECTED | |
| HQ-POSTIT-011 | Scoped to the current project | D | NOT INSPECTED | |
| HQ-POSTIT-012 | Deliberately simple: NO AI extraction | | NOT INSPECTED | |
| HQ-POSTIT-013 | NO task conversion | | NOT INSPECTED | |
| HQ-POSTIT-014 | NO calendar conversion | | NOT INSPECTED | |
| HQ-POSTIT-015 | Attractive without excessive skeuomorphism | | NOT INSPECTED | |
| HQ-POSTIT-016 | Post-its searchable in unified search | D | NOT INSPECTED | |

### HQ-CAL — calendar
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-CAL-001 | Day view | D | NOT INSPECTED | |
| HQ-CAL-002 | Week view | D | NOT INSPECTED | |
| HQ-CAL-003 | Month view | B | NOT INSPECTED | |
| HQ-CAL-004 | Large module → full calendar | D | NOT INSPECTED | |
| HQ-CAL-005 | Medium module → condensed calendar | D | NOT INSPECTED | |
| HQ-CAL-006 | Small module → agenda/upcoming events | B | NOT INSPECTED | |
| HQ-CAL-007 | Never crush a full month into an unreadable tiny card | | NOT INSPECTED | |
| HQ-CAL-008 | Each project has its own calendar | D | NOT INSPECTED | |
| HQ-CAL-009 | Scope control: This Project | D | NOT INSPECTED | |
| HQ-CAL-010 | Scope control: All Projects | D | NOT INSPECTED | |
| HQ-CAL-011 | Scope control: Google / combined calendar | D | NOT INSPECTED | |
| HQ-CAL-012 | Events created in a project belong to that project automatically | D | NOT INSPECTED | |
| HQ-CAL-013 | Project events synchronise toward Google Calendar when connected | D | NOT INSPECTED | |
| HQ-CAL-014 | Existing Google events may remain external | D | NOT INSPECTED | |
| HQ-CAL-015 | An external Google event can be assigned to a project | D | NOT INSPECTED | |
| HQ-CAL-016 | Google sync: create | D | NOT INSPECTED | |
| HQ-CAL-017 | Google sync: edit | D | NOT INSPECTED | |
| HQ-CAL-018 | Google sync: delete | D | NOT INSPECTED | |
| HQ-CAL-019 | Live Google E2E not performed on production (mocks/fixtures; remaining verification documented) | | NOT INSPECTED | |
| HQ-CAL-020 | Create / edit / delete events in the UI | D | NOT INSPECTED | |
| HQ-CAL-021 | Tasks with due dates still appear on the calendar | A | NOT INSPECTED | |

### HQ-GOOG — connect Google
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-GOOG-001 | One clean tenant-level Connect Google experience | B | NOT INSPECTED | |
| HQ-GOOG-002 | V1 assumes one Google account per tenant | | NOT INSPECTED | |
| HQ-GOOG-003 | Architecture does not preclude multiple accounts | | NOT INSPECTED | |
| HQ-GOOG-004 | After connect: subtle "Google — Connected" with Drive ✓ Calendar ✓ Gmail ✓ | D | NOT INSPECTED | |
| HQ-GOOG-005 | Notebook capability shown only where real | | NOT INSPECTED | |
| HQ-GOOG-006 | Not four independent onboarding experiences | B | NOT INSPECTED | |
| HQ-GOOG-007 | Reuse existing OAuth infrastructure | A | NOT INSPECTED | |
| HQ-GOOG-008 | Do not broaden OAuth scopes | | NOT INSPECTED | |
| HQ-GOOG-009 | Do not modify production OAuth configuration | | NOT INSPECTED | |
| HQ-GOOG-010 | Do not claim NotebookLM capabilities Google's APIs lack | | NOT INSPECTED | |

### HQ-DOC — unified documents
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-DOC-001 | Documents is a unified VIEW across sources, not synonymous with Supabase storage | B | NOT INSPECTED | |
| HQ-DOC-002 | Sources: Google Drive | A | NOT INSPECTED | |
| HQ-DOC-003 | Sources: Notebook material where technically supported | | NOT INSPECTED | |
| HQ-DOC-004 | Sources: Supabase uploads | A | NOT INSPECTED | |
| HQ-DOC-005 | Sources: generated Team HQ artifacts | A | NOT INSPECTED | |
| HQ-DOC-006 | Extensible provider architecture for future providers | D | NOT INSPECTED | |
| HQ-DOC-007 | Default view: All Documents | | NOT INSPECTED | |
| HQ-DOC-008 | Source filters: All / Google Drive / Uploaded / Generated / Notebook | D | NOT INSPECTED | |
| HQ-DOC-009 | Sort by filename | A | NOT INSPECTED | |
| HQ-DOC-010 | Sort by modified date | B | NOT INSPECTED | |
| HQ-DOC-011 | Sort by added date | D | NOT INSPECTED | |
| HQ-DOC-012 | Sort by file size | D | NOT INSPECTED | |
| HQ-DOC-013 | Sort by file type | D | NOT INSPECTED | |
| HQ-DOC-014 | Sort by source | D | NOT INSPECTED | |
| HQ-DOC-015 | Sort/filter by project (where multi-project scope) | D | NOT INSPECTED | |
| HQ-DOC-016 | Search within documents | D | NOT INSPECTED | |
| HQ-DOC-017 | List view | A | NOT INSPECTED | |
| HQ-DOC-018 | Thumbnail/grid view | A | NOT INSPECTED | |
| HQ-DOC-019 | Sensible type filters | D | NOT INSPECTED | |
| HQ-DOC-020 | Very small subtle provenance indicator on every document | D | NOT INSPECTED | |
| HQ-DOC-021 | No giant provider badges | | NOT INSPECTED | |
| HQ-DOC-022 | Dedup: one logical item where identity is determinable safely | D | NOT INSPECTED | |
| HQ-DOC-023 | Dedup uses source IDs / canonical IDs / hashes only | D | NOT INSPECTED | |
| HQ-DOC-024 | No dangerous fuzzy merging | | NOT INSPECTED | |
| HQ-DOC-025 | External documents need not be copied into Supabase | A | NOT INSPECTED | |
| HQ-DOC-026 | External docs remain fully searchable by agents | B | NOT INSPECTED | |
| HQ-DOC-027 | External docs remain readable on demand | B | NOT INSPECTED | |
| HQ-DOC-028 | External docs previewable while source connected | D | NOT INSPECTED | |
| HQ-DOC-029 | Cache lightweight derived data (metadata, thumbnails, extracted text, preview pages) without copying the binary | B | NOT INSPECTED | |
| HQ-DOC-030 | Explicit Import action creating a durable Team HQ-managed copy | D | NOT INSPECTED | |
| HQ-DOC-031 | Import survives the original source disappearing | D | NOT INSPECTED | |
| HQ-DOC-032 | Never silently import every Drive document | | NOT INSPECTED | |
| HQ-DOC-033 | No production import performed | | NOT INSPECTED | |
| HQ-DOC-034 | In-app preview: PDFs | B | NOT INSPECTED | |
| HQ-DOC-035 | In-app preview: images | B | NOT INSPECTED | |
| HQ-DOC-036 | In-app preview: text/documents | B | NOT INSPECTED | |
| HQ-DOC-037 | Preview shows useful metadata | D | NOT INSPECTED | |
| HQ-DOC-038 | Thumbnails | A | NOT INSPECTED | |
| HQ-DOC-039 | Routine viewing does not require opening Drive | B | NOT INSPECTED | |
| HQ-DOC-040 | "Open Source" action where appropriate | B | NOT INSPECTED | |
| HQ-DOC-041 | Agents may read/search/create/edit/organise/move/transform documents | B | NOT INSPECTED | |
| HQ-DOC-042 | Agents do NOT autonomously delete source documents by default | | NOT INSPECTED | |
| HQ-DOC-043 | Explicit user deletion acceptable | | NOT INSPECTED | |
| HQ-DOC-044 | Logical document versioning (Report → v1 v2 v3), not filename suffixes | D | NOT INSPECTED | |
| HQ-DOC-045 | Retain history | D | NOT INSPECTED | |
| HQ-DOC-046 | Retain provenance | D | NOT INSPECTED | |
| HQ-DOC-047 | Rollback architecture where feasible | D | NOT INSPECTED | |

### HQ-SEARCH / HQ-CMD / HQ-ACT
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-SEARCH-001 | Unified project search across real stores | B | NOT INSPECTED | |
| HQ-SEARCH-002 | Provider: documents | A | NOT INSPECTED | |
| HQ-SEARCH-003 | Provider: tasks | B | NOT INSPECTED | |
| HQ-SEARCH-004 | Provider: chats | D | NOT INSPECTED | |
| HQ-SEARCH-005 | Provider: Post-its | D | NOT INSPECTED | |
| HQ-SEARCH-006 | Provider: calendar events | D | NOT INSPECTED | |
| HQ-SEARCH-007 | Provider: saved webpages | B | NOT INSPECTED | |
| HQ-SEARCH-008 | Provider: sources | B | NOT INSPECTED | |
| HQ-SEARCH-009 | Provider: agent research | D | NOT INSPECTED | |
| HQ-SEARCH-010 | Never fabricate results | | NOT INSPECTED | |
| HQ-SEARCH-011 | Clean extensible search-provider architecture | D | NOT INSPECTED | |
| HQ-CMD-001 | Cmd+K on macOS opens the palette in Team HQ | D | NOT INSPECTED | |
| HQ-CMD-002 | Ctrl+K elsewhere | D | NOT INSPECTED | |
| HQ-CMD-003 | FIND: documents | D | NOT INSPECTED | |
| HQ-CMD-004 | FIND: tasks | D | NOT INSPECTED | |
| HQ-CMD-005 | FIND: events | D | NOT INSPECTED | |
| HQ-CMD-006 | FIND: sources | D | NOT INSPECTED | |
| HQ-CMD-007 | FIND: project content generally | D | NOT INSPECTED | |
| HQ-CMD-008 | ACTION: create task | D | NOT INSPECTED | |
| HQ-CMD-009 | ACTION: open Calendar | B | NOT INSPECTED | |
| HQ-CMD-010 | ACTION: open Documents | B | NOT INSPECTED | |
| HQ-CMD-011 | ACTION: switch project | A | NOT INSPECTED | |
| HQ-CMD-012 | ACTION: open module | B | NOT INSPECTED | |
| HQ-CMD-013 | ACTION: ask Claire/team where architecture supports | D | NOT INSPECTED | |
| HQ-CMD-014 | ACTION: change layout | D | NOT INSPECTED | |
| HQ-CMD-015 | ACTION: choose preset | D | NOT INSPECTED | |
| HQ-CMD-016 | Reuse existing jump system; no competing second command system | | NOT INSPECTED | |
| HQ-ACT-001 | Project Activity module (human-readable history) | B | NOT INSPECTED | |
| HQ-ACT-002 | Uses real audit/event infrastructure; nothing fabricated | A | NOT INSPECTED | |
| HQ-ACT-003 | Filter: user | D | NOT INSPECTED | |
| HQ-ACT-004 | Filter: agent | D | NOT INSPECTED | |
| HQ-ACT-005 | Filter: integration | D | NOT INSPECTED | |
| HQ-ACT-006 | Filter: synchronisation | D | NOT INSPECTED | |
| HQ-ACT-007 | Filter: documents | D | NOT INSPECTED | |
| HQ-ACT-008 | Filter: tasks | D | NOT INSPECTED | |
| HQ-ACT-009 | Filter: calendar | D | NOT INSPECTED | |
| HQ-ACT-010 | Channel provenance preserved (via Team HQ / ChatGPT / Claude / Telegram / Slack) | D | NOT INSPECTED | |
| HQ-ACT-011 | Channel provenance shown in rows as "Grant via X" | D | NOT INSPECTED | |

### HQ-WEB / HQ-PDF / HQ-STYLE
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-WEB-001 | Investigate existing browser/search tooling first; no rebuild | | NOT INSPECTED | |
| HQ-WEB-002 | Autonomous: search web | D | NOT INSPECTED | |
| HQ-WEB-003 | Autonomous: browse pages | A | NOT INSPECTED | |
| HQ-WEB-004 | Autonomous: follow links | D | NOT INSPECTED | |
| HQ-WEB-005 | Autonomous: read / extract | A | NOT INSPECTED | |
| HQ-WEB-006 | Autonomous: screenshot | A | NOT INSPECTED | |
| HQ-WEB-007 | Autonomous: safe downloads | D | NOT INSPECTED | |
| HQ-WEB-008 | Authenticated resources where safely permitted | A | NOT INSPECTED | |
| HQ-WEB-009 | Useful pages become persistent project Sources | A | NOT INSPECTED | |
| HQ-WEB-010 | Provenance stored: URL | A | NOT INSPECTED | |
| HQ-WEB-011 | …title | A | NOT INSPECTED | |
| HQ-WEB-012 | …retrieval/access date | D | NOT INSPECTED | |
| HQ-WEB-013 | …project | A | NOT INSPECTED | |
| HQ-WEB-014 | …agent | D | NOT INSPECTED | |
| HQ-WEB-015 | …originating job/research task | D | NOT INSPECTED | |
| HQ-WEB-016 | …extracted/indexed content | B | NOT INSPECTED | |
| HQ-WEB-017 | …citations/evidence retained when research contributes to a report | B | NOT INSPECTED | |
| HQ-WEB-018 | Approval required: send/post/publish/email/contact a human/consequential form/purchase/booking/external upload | A | NOT INSPECTED | |
| HQ-WEB-019 | Reuse mayAct/approval architecture; no parallel approval system | | NOT INSPECTED | |
| HQ-PDF-001 | Investigate existing artifact generation first | | NOT INSPECTED | |
| HQ-PDF-002 | "Find latest report → beautiful PDF" pipeline: resolve source | D | NOT INSPECTED | |
| HQ-PDF-003 | …read it | D | NOT INSPECTED | |
| HQ-PDF-004 | …structure/edit content | D | NOT INSPECTED | |
| HQ-PDF-005 | …apply project style | D | NOT INSPECTED | |
| HQ-PDF-006 | …appropriate visual design | B | NOT INSPECTED | |
| HQ-PDF-007 | …render polished artifact | B | NOT INSPECTED | |
| HQ-PDF-008 | …QA output | A | NOT INSPECTED | |
| HQ-PDF-009 | …save to Documents | B | NOT INSPECTED | |
| HQ-PDF-010 | …retain provenance | B | NOT INSPECTED | |
| HQ-PDF-011 | …new versions for revisions | D | NOT INSPECTED | |
| HQ-PDF-012 | Does not require Claude API; provider-independent publishing | | NOT INSPECTED | |
| HQ-PDF-013 | Deterministic renderer; LLM only for editorial/design decisions | A | NOT INSPECTED | |
| HQ-PDF-014 | High visual quality; polished vertical slice over enormous engine | | NOT INSPECTED | |
| HQ-STYLE-001 | Project style/design profile model + storage | D | NOT INSPECTED | |
| HQ-STYLE-002 | Contents: brand colours | D | NOT INSPECTED | |
| HQ-STYLE-003 | …typography | D | NOT INSPECTED | |
| HQ-STYLE-004 | …logos | D | NOT INSPECTED | |
| HQ-STYLE-005 | …writing tone | D | NOT INSPECTED | |
| HQ-STYLE-006 | …terminology | D | NOT INSPECTED | |
| HQ-STYLE-007 | …preferred document structures | D | NOT INSPECTED | |
| HQ-STYLE-008 | …formatting conventions | D | NOT INSPECTED | |
| HQ-STYLE-009 | …chart style | D | NOT INSPECTED | |
| HQ-STYLE-010 | …image style | D | NOT INSPECTED | |
| HQ-STYLE-011 | …audience assumptions | D | NOT INSPECTED | |
| HQ-STYLE-012 | …reusable instructions | D | NOT INSPECTED | |
| HQ-STYLE-013 | "Save this as this project's report style" interaction | D | NOT INSPECTED | |
| HQ-STYLE-014 | Tenant default → project inherits → project overrides | D | NOT INSPECTED | |
| HQ-STYLE-015 | Style editing UI | D | NOT INSPECTED | |
| HQ-STYLE-016 | Style integrated into the PDF renderer | D | NOT INSPECTED | |
| HQ-STYLE-017 | No faked automatic style extraction | | NOT INSPECTED | |

### HQ-EXT / HQ-VIC / HQ-CONV / HQ-AUTO
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-EXT-001 | Audit existing GPT/external access path | | NOT INSPECTED | |
| HQ-EXT-002 | Reusable secure permissioned tool interface, not vendor-bespoke | B | NOT INSPECTED | |
| HQ-EXT-003 | Tool: list projects | A | NOT INSPECTED | |
| HQ-EXT-004 | Tool: search project | B | NOT INSPECTED | |
| HQ-EXT-005 | Tool: search documents | A | NOT INSPECTED | |
| HQ-EXT-006 | Tool: read documents | A | NOT INSPECTED | |
| HQ-EXT-007 | Tool: list/create/update tasks | D | NOT INSPECTED | |
| HQ-EXT-008 | Tool: inspect calendar | D | NOT INSPECTED | |
| HQ-EXT-009 | Tool: create/update events | D | NOT INSPECTED | |
| HQ-EXT-010 | Tool: ask team | D | NOT INSPECTED | |
| HQ-EXT-011 | Tool: inspect Activity | B | NOT INSPECTED | |
| HQ-EXT-012 | Tool: trigger safe research | D | NOT INSPECTED | |
| HQ-EXT-013 | Tool: trigger artifact generation | B | NOT INSPECTED | |
| HQ-EXT-014 | Channel provenance "Grant via ChatGPT / Claude" | D | NOT INSPECTED | |
| HQ-EXT-015 | No secrets exposed | | NOT INSPECTED | |
| HQ-EXT-016 | Tenant isolation not weakened | | NOT INSPECTED | |
| HQ-EXT-017 | Approval policies not bypassed | | NOT INSPECTED | |
| HQ-EXT-018 | Does not block UX work | | NOT INSPECTED | |
| HQ-VIC-001 | Locate the ACTUAL Vicuña/Vacunia integration; do not assume spelling | | NOT INSPECTED | |
| HQ-VIC-002 | Audit real code | | NOT INSPECTED | |
| HQ-VIC-003 | Verify create/update note → persistence → sync → representation → read-back | | NOT INSPECTED | |
| HQ-VIC-004 | Determine canonical source | | NOT INSPECTED | |
| HQ-VIC-005 | Determine sync behaviour | | NOT INSPECTED | |
| HQ-VIC-006 | Determine duplicate prevention | | NOT INSPECTED | |
| HQ-VIC-007 | Determine failure behaviour | | NOT INSPECTED | |
| HQ-VIC-008 | Fix concrete defects where possible | | NOT INSPECTED | |
| HQ-VIC-009 | Record what remains to verify if external E2E impossible | | NOT INSPECTED | |
| HQ-CONV-001 | Workspace operations exposed as reusable actions (conversational control later) | D | NOT INSPECTED | |
| HQ-CONV-002 | Examples supported architecturally: bigger / move / tint / zoom / hide / save layout | D | NOT INSPECTED | |
| HQ-AUTO-001 | Agents may autonomously generate documents/PDFs/versions/non-destructive artifacts | A | NOT INSPECTED | |
| HQ-AUTO-002 | Approval required before emailing / publishing / external share / third-party upload | A | NOT INSPECTED | |
| HQ-AUTO-003 | Uses existing approval architecture | | NOT INSPECTED | |

### HQ-QA / HQ-A11Y / HQ-ISO — cross-cutting
| ID | Requirement | Before | Status | Evidence / remaining |
|---|---|---|---|---|
| HQ-ISO-001 | New worktree + branch from current multi-user-p4 HEAD | | NOT INSPECTED | |
| HQ-ISO-002 | No change to the multi-user-p4 worktree; no merge to p4/main; no rewrite; no force-push | | NOT INSPECTED | |
| HQ-ISO-003 | No production migration, schema/data/config/secret/OAuth change, no prod tests, no deploy | | NOT INSPECTED | |
| HQ-ISO-004 | Schema changes only as unapplied migration files | | NOT INSPECTED | |
| HQ-ISO-005 | Push the new branch periodically | | NOT INSPECTED | |
| HQ-ISO-006 | No "Basecamp" in new user-facing names | | NOT INSPECTED | |
| HQ-ISO-007 | No obsolete interface resurrected | | NOT INSPECTED | |
| HQ-QA-001 | Desktop 1440 inspected | | NOT INSPECTED | |
| HQ-QA-002 | Desktop 1280 inspected | | NOT INSPECTED | |
| HQ-QA-003 | Mobile 390×844 inspected | | NOT INSPECTED | |
| HQ-QA-004 | Intermediate/tablet width inspected | | NOT INSPECTED | |
| HQ-QA-005 | Interaction exercised (drag, resize, guides, tidy, reset, zoom, tint, maximize, back, post-it) | | NOT INSPECTED | |
| HQ-QA-006 | Calendar day/week/month/compact inspected | | NOT INSPECTED | |
| HQ-QA-007 | Documents filters/indicators/thumbnails/preview inspected | | NOT INSPECTED | |
| HQ-QA-008 | Palette / search / Activity inspected | | NOT INSPECTED | |
| HQ-QA-009 | Keyboard navigation + focus inspected | | NOT INSPECTED | |
| HQ-QA-010 | Reduced motion inspected | | NOT INSPECTED | |
| HQ-QA-011 | Light/dark inspected | | NOT INSPECTED | |
| HQ-QA-012 | Existing relevant tests run; no tests weakened to go green | | NOT INSPECTED | |
| HQ-QA-013 | Tests: layout serialisation/restoration, project isolation, reset safety, zoom/tint/post-it persistence | | NOT INSPECTED | |
| HQ-QA-014 | Tests: calendar project association, document filter/dedupe/import-vs-index/versioning | | NOT INSPECTED | |
| HQ-QA-015 | Tests: unified search, command actions, maximize/history, browser approval boundary, audit provenance, tenant isolation | | NOT INSPECTED | |
| HQ-A11Y-001 | Keyboard access maintained/improved | | NOT INSPECTED | |
| HQ-A11Y-002 | Focus visibility | | NOT INSPECTED | |
| HQ-A11Y-003 | Appropriate ARIA | | NOT INSPECTED | |
| HQ-A11Y-004 | Contrast | | NOT INSPECTED | |
| HQ-A11Y-005 | ≈44px touch targets where interaction requires | | NOT INSPECTED | |
| HQ-A11Y-006 | prefers-reduced-motion | | NOT INSPECTED | |
| HQ-A11Y-007 | Mobile usable and unbroken | | NOT INSPECTED | |
| HQ-A11Y-008 | No iOS input-zoom regression (inputs ≥16px) | | NOT INSPECTED | |
| HQ-VIS-001 | Feels polished, calm, dense, uncluttered, coherent; none of the listed anti-patterns | | NOT INSPECTED | |
| HQ-VIS-002 | Recognisable service logos used tastefully | | NOT INSPECTED | |
| HQ-VIS-003 | Preserve and improve current Team HQ identity | | NOT INSPECTED | |
| HQ-ENG-001 | Extract focused modules (workspace state, layout persistence, module actions, animation, providers, search, calendar adapters, activity) | | NOT INSPECTED | |
| HQ-ENG-002 | No framework rewrite / unrelated refactor | | NOT INSPECTED | |

### Spec checkpoints
- 4-hour re-read: _pending_
- 8-hour re-read: _pending_
- Final re-read: _pending_

### Notes
**HQ-NOTES-VICUNA.** No code, migration or doc names "Vicuña" or "Vacunia". The only notes/to-do provider integration is **Vikunja** (CLAUDE.md ADR-0059). Audit in HQ-VIC rows.
