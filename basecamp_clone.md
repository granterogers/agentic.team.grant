# Basecamp Clone — Complete Claude Implementation Instruction

**Status:** implementation-ready reference specification  
**Confidence:** 99% that a competent implementation team can reproduce the observed Basecamp interaction model and visual rhythm from this specification.  
**Scope boundary:** reproduce the usability, hierarchy, density, responsive behaviour and interaction grammar inside Agentic Team. Do not copy Basecamp's name, logos, illustrations, proprietary assets, source code, or unlicensed Graphik font files. The result must remain visibly and legally Agentic Team.

This file is the complete standalone instruction for Claude. Claude must read the entire file before changing code and treat it as the implementation contract. It defines the target, implementation order, measurements, page recipes, states, validation matrix and stopping conditions. It is deliberately finite and is not permission for a general beautification run.

---

## 1. What “99% confident” means

The benchmark was inspected live in a logged-in Basecamp account using both populated and empty projects, desktop and mobile viewports, keyboard navigation, the global jump/search flow, contextual menus, creation forms, record details and all principal project tools.

The remaining one percent is not uncertainty about the design system. It covers account-specific features, rare permission combinations, browser/platform font rasterisation, and Basecamp changes made after this audit. It does not prevent implementation.

The clone is successful when an experienced Basecamp user recognises the same interaction logic without mistaking the product for Basecamp:

- projects are stable containers;
- the overview is a live table of contents;
- navigation is shallow and contextual;
- records share one detail-page grammar;
- creating and editing happens close to the affected content;
- the interface feels fast because it avoids unnecessary choices and movement;
- mobile preserves hierarchy while changing geometry;
- Agentic Team's agents, jobs, provenance and relationships remain first-class.

## 2. Non-negotiable product rules

1. Modify the existing `web/studio` product. Do not create a second frontend or restore retired `web/hq` work.
2. Revise the existing project Overview in place. Do not add a Canvas tab or a third overview mode.
3. Preserve every existing Agentic Team capability through the new shell or an explicit compatibility route.
4. Keep project tasks, personal tasks and agent jobs as distinct domains.
5. Use real backend records in the reference slice. Fixtures may support tests but may not be the only source rendered.
6. Every mutation must show pending, success and recoverable failure feedback.
7. Do not import Basecamp CSS, JavaScript, HTML, iconography or assets.
8. Do not bundle Graphik unless Agentic Team owns a licence. Use the approved Agentic Team face or the metric-conscious system stack below.
9. A new visual component is allowed only when an existing primitive cannot express the requirement.
10. Stop after the reference slice passes the Definition of Done. Review it before expanding to the remaining screens.

## 3. Reference surfaces inspected

The following live surfaces form the benchmark:

- global Home and project entry;
- populated project Overview;
- empty project and Add a tool menu;
- Message Board list, categories menu, message detail and new-message editor;
- To-dos in list and card views, inline creation and detail;
- Card Table columns and cards;
- Docs & Files grid/list, add menu and document detail;
- Calendar and Agenda;
- project Chat and composer;
- project and global Activity;
- Jump Menu, full search and filters;
- bookmarks, notifications and the personal-tools tray;
- desktop at 1440 × 900;
- narrower/tablet layouts;
- mobile at 390 × 844;
- keyboard focus and `Shift+J` behaviour.

The populated reference project used six tools: Message Board, To-dos, Card Table, Docs & Files, Calendar and Chat. The empty-project tool menu also exposed Automatic Check-ins and Email Forwards.

## 4. Design tokens

Define these once as CSS custom properties. Do not scatter near-matching literals through the application.

### 4.1 Colour tokens — observed dark theme

| Token | Value | Use |
|---|---:|---|
| `--canvas` | `#0B151B` | Browser-level surround and quiet margins |
| `--surface` | `#1B2930` | Main work surface, menus, inputs |
| `--surface-selected` | `#2A4259` | Selected command/search row |
| `--text` | `#E1E5E8` | Body text |
| `--text-strong` | `#F2F4F5` | Important headings where extra contrast is needed |
| `--text-muted` | `#A8AFB3` | Dates, section separators, secondary metadata |
| `--accent` | `#6AB3FD` | Primary actions, links, active focus accents |
| `--accent-ink` | `#0E1D24` | Text/icons on the accent background |
| `--section-accent` | `#FBBDA8` | Tool headings on the project overview |
| `--border-subtle` | `rgba(225,229,232,.10)` | Shell and quiet-card borders |
| `--border-control` | `rgba(225,229,232,.15)` | Input and button outlines |
| `--border-popover` | `#475257` | Floating menu outline |
| `--hover` | `rgba(255,255,255,.08)` | Hovered neutral control |
| `--focus-fill` | `rgba(255,255,255,.10)` | Focused nav control background |
| `--danger` | Agentic Team existing destructive token | Destructive actions only |
| `--success` | Agentic Team existing success token | Persisted/completed feedback only |

Contrast is a release gate: normal text must reach 4.5:1; large text and essential graphical controls 3:1. If an observed value fails after substituting Agentic Team's font, adjust luminance minimally and record the exception.

### 4.2 Typography

Observed stack: Graphik followed by native system faces. Unless licensed, implement:

```css
font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont,
  "Segoe UI", Helvetica, Arial, sans-serif;
```

Recommended scale:

| Role | Size / line height | Weight | Tracking |
|---|---|---:|---:|
| Body | 16 / 24 px | 400 | -0.1 px |
| Compact control/meta | 14 / 21 px | 400–600 | normal |
| Tool heading | 18 / 24 px | 600 | -0.1 px |
| Project/page title | 36 / 41.4 px desktop | 800 | tight |
| Mobile project title | 18–22 / 24–28 px | 700–800 | tight |
| Section title | 28 / 32.2 px | 800 | tight |
| Day separator | 14 / 15.4 px | 800 | normal |
| Editor body | 20 / 30 px | 400 | normal |

Use sentence case. Prefer plain verbs: `New message`, `Add a to-do`, `Post this message`, `Save draft`. Avoid technical nouns in primary actions.

### 4.3 Spacing and geometry

Use a 4 px base grid. Primary increments are 4, 8, 12, 16, 24, 32, 40, 48 and 64 px.

- Desktop outer navigation margin: 16 px vertically; 8 px horizontally.
- Desktop sticky navigation height: approximately 40 px.
- Desktop main surface: 1088 px wide at 1440 px viewport, centred at x=171.
- Desktop main padding: 40 px top/right/left and 144 px bottom.
- Desktop overview: three equal columns, approximately 325 px each, 16 px gutters.
- Preview tile: approximately 324 × 324 px, 8 px radius.
- Mobile content padding: 16 px.
- Ordinary control radius: 8 px.
- Context-menu radius: 6 px.
- Sheet/dialog radius: 16 px.
- Compact menu-row radius: approximately 5 px.
- Minimum interactive target: 44 × 44 CSS px on touch layouts; visually smaller 32 px desktop controls must retain an expanded hit target where necessary.
- Main surface shadow: `0 0 30px rgba(0,0,0,.08)`.
- Floating menu shadow: subtle stacked shadow ending near `0 4px 8px -2px rgba(0,0,0,.10)`.
- Large command sheet shadow: ending near `0 16px 32px -8px rgba(0,0,0,.10)`.

Do not add shadows to every card. Hierarchy should come mainly from spacing, borders, content and surface changes.

## 5. Motion and perceived-speed contract

Motion explains state; it must never delay work.

| Interaction | Duration | Easing | Behaviour |
|---|---:|---|---|
| Canvas/theme colour | 200 ms | ease-out | Colour only |
| Sticky navigation reveal/settle | 300 ms | ease-out | Transform only |
| Page content replace | 250 ms max | ease-out | Opacity; no theatrical slide |
| Input focus/shadow | 125 ms | ease-out | Box-shadow/border |
| Menu/sheet entrance | 120–160 ms | ease-out | Fade plus 4–8 px movement |
| Menu/sheet exit | 90–120 ms | ease-in | Faster than entrance |
| Optimistic row mutation | immediate | — | Update locally, then confirm |

Perceived-speed rules:

- acknowledge every click within one animation frame;
- keep navigation under 500 ms on a warm local/server response; the observed sample felt near 400 ms;
- preserve the shell while page content changes;
- use skeletons only where shape is predictable and loading exceeds about 250 ms;
- never show a full-page spinner for an object-level operation;
- preserve scroll/focus when an inline edit saves;
- prefetch a tool when its preview receives pointer hover or keyboard focus, where safe;
- cache last successful preview data and mark stale content rather than replacing it with blankness.

Under `prefers-reduced-motion: reduce`, remove translations and nonessential fades, set durations to effectively zero, and preserve only instantaneous state cues.

## 6. Global shell

### 6.1 Desktop

Use a three-part sticky top row:

- left: `Home`;
- centre: Agentic Team product/jump control;
- right: notifications/attention;
- below content: persistent personal tray.

At 1440 px, the observed grid was approximately 615.5 / 166.5 / 615.5 px with 8 px gaps. The exact middle width may adapt to Agentic Team's wordmark, but visual balance must remain centred.

The bottom personal tray contains:

- account/avatar;
- My Tasks;
- My Events;
- Bookmarks;
- My Activity;
- Notes/Inbox;
- Support.

In Agentic Team, the notification side control becomes the attention queue for mentions, approvals, blocked jobs and failures. It must not become a permanent wide sidebar.

### 6.2 Mobile

- Keep the top row approximately 40 px high.
- Reduce personal-tray destinations to icon plus accessible label; never remove the destination.
- Reserve safe-area padding and enough bottom content clearance that the tray never covers the last actionable row.
- Remove desktop quiet margins: the working surface fills the viewport.
- Put the project title and first useful preview above the fold. Fix the existing issue where 385 px/46% of a 390 × 844 screen can be consumed before the first module.

### 6.3 Breadcrumb and record actions

Every tool and record page uses this order:

1. project breadcrumb;
2. optional containing-tool breadcrumb;
3. page/record title;
4. Bookmark;
5. Edit when permitted;
6. overflow/options.

Do not invent different toolbar arrangements per object type.

## 7. Universal Jump and Search

### 7.1 Open behaviour

- Click the centre shell control or press `Shift+J` anywhere outside a text composition context.
- Return focus to the invoker on Escape or close.
- Trap focus within the open sheet.
- Typing filters recent places, projects, people and direct product destinations immediately.
- `Shift+Enter` promotes the current query into full search.

### 7.2 Desktop geometry

At 1440 × 900:

- sheet: 480 px wide, near x=475/y=20, up to about 495 px tall;
- background `--surface`;
- 1 px `--border-subtle`;
- 16 px radius;
- search section sticks to the top with 12 px horizontal, 12 px top and 8 px bottom padding;
- input: about 454 × 42 px, 8 px radius, 12 px left and 16 px right padding;
- focused border `--accent` with a restrained two-pixel glow;
- selected result: about 454 × 32 px, `--surface-selected`, pill-like 16 px radius.

### 7.3 Keyboard map

- `ArrowDown` / `ArrowUp`: selection;
- `Enter`: open selected destination;
- `Shift+Enter`: full search for entered text;
- `Escape`: close and restore focus;
- `Tab`: moves among search, filters and available actions without leaving the modal unexpectedly;
- type-ahead must not steal shortcuts when an editor has focus.

### 7.4 Full search

Provide filters for project, object/tool type, person/agent, time, archived projects, sort and whether chats/transient messages are included. Results show type, project, title, useful excerpt, owner/author and date. Search must include Agentic Team documents, project tasks, contacts, sources, agents and outputs while preserving access controls.

## 8. Project overview

The overview is a live table of contents, not a generic metrics dashboard.

### 8.1 Header

Show, in this priority order:

- people and agent presence;
- project status label when exceptional;
- project options;
- title;
- short description;
- concise recent-activity sentence or link.

Allow inline project-title editing. The edit surface also exposes description, dates and optional progress status. Do not route a simple title change through a settings maze.

### 8.2 Tool grid

Desktop uses three columns. Mobile uses two compact columns when the preview remains legible, falling to one for content-heavy previews. Never force a wide board/calendar into a narrow card; use a purpose-built summary.

Every tool block contains:

1. 18/24 semibold accent heading;
2. a single large preview link;
3. current, useful content rather than decorative numbers;
4. accessible name announcing the tool and preview summary;
5. empty state with a direct create/configure action.

Recommended Agentic Team tools:

- Brief / Messages;
- Tasks;
- Work Board;
- Documents & Assets;
- Schedule;
- Project Chat;
- Agentic Team;
- Sources & Integrations;
- Activity.

Use existing underlying objects. The Agentic Team preview should show team state, running/waiting/blocked work and the latest meaningful output—not raw worker telemetry.

### 8.3 Preview recipes

- **Messages:** author/avatar, date, title, excerpt and discussion count for the latest important posts.
- **Tasks:** two or three active lists with incomplete items, assignee and nearest due dates; completed work visually recedes.
- **Work Board:** column names and counts plus a small number of representative cards.
- **Documents:** latest/pinned document thumbnail, title and excerpt or file metadata.
- **Schedule:** mini month plus next three dated commitments; on small screens show agenda only.
- **Chat:** recent messages with identity, time and clipped content.
- **Agentic Team:** roster/availability, current assignments, blockers and latest output.
- **Sources:** connection health and recently imported knowledge; do not show setup noise when healthy.
- **Activity:** day-grouped human and agent events, with technical background noise suppressed.

### 8.4 Empty project

Use one calm empty state with explanatory copy and `Add a tool`. The menu may include Brief/Messages, Tasks, Documents, Schedule, Chat, Work Board, Agentic Team and Sources. Do not render nine empty analytics tiles.

## 9. Shared record-page grammar

Messages, tasks, documents, events, agent jobs and outputs must feel related.

Order:

1. breadcrumb/action bar;
2. title and status;
3. creator, created/updated date and provenance;
4. primary content;
5. structured metadata and relationships;
6. boosts/reactions when supported;
7. comments/discussion;
8. followers/subscribers and notification control;
9. related records/activity.

Agentic additions:

- agent output always names the originating job, task/instruction, input sources and time;
- `Add to project` creates or relates a canonical project record without duplicating the output;
- `Send back to agent` opens a scoped follow-up composer with existing context attached;
- running jobs show progress, Waiting for input, Blocked, Completed or Failed in human terms;
- Stop is present for cancellable work and requires a lightweight confirmation only if cancellation is irreversible.

## 10. Tool specifications

### 10.1 Brief / Message Board

List controls: `New message`, Categories, sort and Filter. Separate pinned messages from the chronological list. Rows show author, category, date, title, excerpt and discussion count.

Observed controls:

- primary button: 32 px high, 8 px radius, 14/21 type, `--accent` background and `--accent-ink` text;
- secondary button: transparent, 32 px high, 8 px radius;
- compact filter: about 150 × 32 px, 1 px control border, 8 px radius;
- category menu: about 218 px wide with 16 px padding, 6 px radius and 32 px rows.

Message editor:

- project breadcrumb at top left;
- schedule/post-later, Save draft and primary Post at top right;
- optional category;
- borderless 36/41.4 bold title;
- restrained formatting toolbar;
- 20/30 body editor;
- notification choice: subscribers, selected people or no one;
- duplicate the primary action at the bottom of a long form;
- warn about a non-empty unsaved draft on destructive navigation.

### 10.2 Tasks

Provide list and card views and remember the chosen view. Lists remain the underlying grouping.

Task row/card shows:

- completion control;
- title;
- assignee(s);
- due date/status;
- comment count;
- short notes where helpful.

Inline `Add a to-do` expands in place and focuses the name field. It exposes:

- name;
- Assigned to;
- notify-on-completion recipients;
- due date;
- notes/attachments with formatting;
- subtasks;
- primary Add and Cancel.

Cancel must restore the collapsed state and previous focus without creating a record. Completed tasks collapse behind a count. Task detail follows the shared record grammar and supports contextual edits for assignment, due date and notes.

Do not merge:

- project commitments/tasks;
- a person's private/global My Tasks;
- agent execution jobs.

Relationships may connect them, but their state machines and ownership remain distinct.

### 10.3 Work Board / Card Table

- First column is an intake/ideas area.
- Workflow columns continue horizontally on desktop.
- Header shows name, item count, watchers, collapse and overflow.
- Cards show title, creator/time, assignee, checklist/comments and explicit hold/block state.
- Empty columns remain visible.
- Keyboard and pointer users can move a card; drag is never the only method.
- Mobile defaults to one column at a time with a labelled column switcher or horizontally snapped columns. It must not shrink the entire board to illegibility.

### 10.4 Documents & Assets

One surface covers native documents, uploaded files/images, folders and external links. Include:

- name/type filter;
- sort;
- grid/list toggle;
- Add menu for document, folder, upload and external link;
- visible file type, size/source and updated date;
- consistent detail view with provenance, comments and followers.

Agent outputs that become documents must preserve origin and relationships. Never copy an artifact silently and lose its job/task/source trail.

### 10.5 Schedule

- Primary `New event`;
- Calendar/Agenda toggle;
- Filter;
- unfinished dated tasks and events in one temporal view;
- six-week month grid on wide screens;
- agenda-first presentation on narrow screens;
- event detail follows the shared record grammar;
- timezone is visible when participants differ or the time is otherwise ambiguous.

### 10.6 Chat

Continuous, day-grouped stream. Each entry exposes identity, time, mentions, links, reactions and contextual options. Composer supports text, emoji, attachment, voice note and formatting.

Chat is not the project's organising spine. Any commitment, durable decision, asset or deliverable can be promoted/related to the appropriate project record.

### 10.7 Activity

Activity is day-grouped and human-readable. Offer timeline/wrap-up presentations plus project, person/agent and text filters. Keep the repository decision to fold Activity into Overview; provide a focused expanded surface from its preview rather than restoring tab sprawl.

Activity copy should say what changed and why it matters. Collapse repetitive streaming progress. Preserve a route to technical logs for diagnosis without making them the main feed.

### 10.8 Agentic Team

Use Basecamp's project-tool grammar but retain Agentic Team's unique value:

- roster with role, state, current assignment and last meaningful output;
- `Ask the team` composer with target and context/source chips;
- active work grouped by Running, Waiting for input, Blocked and Completed;
- output cards with Preview, Discuss, Add to project, Relate to task and Send back;
- visible provenance;
- job Stop/control where supported;
- explicit permissions and failure recovery.

Do not present the ordinary project user with worker names, queue identifiers, JSON payloads or orchestration internals unless they open a diagnostic view.

## 11. Menus, dialogs and forms

### 11.1 Context menus

- Anchor to the invoking control and remain within the viewport.
- 16 px panel padding for small menus; 8 px may be used for dense action menus.
- 32–40 px desktop row; at least 44 px touch target on mobile.
- selected/hovered rows use `--hover`; active selection may use `--surface-selected`.
- destructive actions are separated and labelled; never rely on red alone.
- Escape closes; outside click closes; focus returns to invoker.
- arrow keys traverse menu items; Home/End jump to extremes.

### 11.2 Sheets/dialogs

- Use the 16 px-radius floating sheet for jump/search and substantial pickers.
- On mobile, convert wide centre dialogs to a bottom sheet or nearly full-width inset panel.
- Focus trap, labelled title, explicit close, Escape support and background inertness are mandatory.
- Do not nest modals. Replace or step forward within the same surface.

### 11.3 Inputs

- Labels remain visible for consequential fields; placeholder-only labelling is forbidden.
- Neutral inputs use `--surface`, a 1 px `--border-control` border and 8 px radius.
- Focus uses `--accent` border plus visible outer ring; never remove the outline without replacement.
- Validation appears by the field and is repeated in a short form-level summary when submission fails.
- Saving does not unexpectedly move the page.

### 11.4 Rich text

Keep one shared editor for messages, task notes, docs and comments where capability permits. Toolbar order should remain stable. Hide advanced actions behind a More control on narrow screens. Keyboard shortcuts must be discoverable and must not conflict with global Jump.

## 12. Interaction states

Every component and page must have all applicable states below before it is considered complete.

### Loading

- Shell remains interactive.
- After 250 ms, show shape-matched skeletons or a local progress label.
- Announce longer loading through an unobtrusive live region.
- Never discard previously rendered data solely because it is refreshing.

### Empty

- State what this area is for.
- Offer one primary next action.
- Do not imply error or decorate with meaningless charts.

### Error

- Keep user input.
- Explain the failed action in plain language.
- Offer Retry when safe.
- If stale content exists, keep it visible and identify it as stale.

### Degraded service

Use a nonblocking banner for partial outages such as uploads being unavailable while reading/editing still works. The banner can coexist with the current page and must name the affected capability.

### Permission denied

Explain which action is unavailable and, where known, who can grant access. Do not render a blank page or generic 404 for an existing inaccessible record.

### Offline

Indicate offline status, keep readable cached content, queue only operations with safe and understandable reconciliation, and never claim a mutation was saved before server confirmation.

### Success

Prefer visible object change over a toast. Use a brief confirmation when the result is otherwise off-screen or delayed. Avoid permanent success banners.

### Optimistic mutation

Mark the affected item pending, reconcile with the server, and roll back visibly on failure. Generate idempotency keys for operations that could duplicate jobs, comments, imports or documents.

## 13. Hover, focus and pressability

- Neutral controls gain an approximately 8% light background on hover.
- Keyboard focus may use a 10% light fill plus a 2 px high-contrast ring and small offset.
- Focus is shown only for keyboard-style navigation with `:focus-visible` where supported.
- Links never depend solely on colour when embedded in body copy.
- Preview cards and rows communicate clickability through hover/focus, cursor and a clear accessible name.
- Disabled controls explain why where ambiguity would block work.
- Pressed toggles use `aria-pressed`; active navigation uses `aria-current`.
- No clickable `div` without equivalent keyboard semantics.

## 14. Responsive rules

Use content-driven breakpoints, with these verification widths:

### Wide desktop — 1440 × 900

- 1088 px centred main surface;
- 40 px internal padding;
- three-column overview;
- contextual menus remain anchored;
- boards may scroll horizontally within their tool, never at page level.

### Compact desktop/tablet landscape — 1024 × 768

- reduce outer margins and main padding before shrinking readable content;
- preserve at least two overview columns where previews remain useful;
- long action bars may wrap into two logical rows;
- bottom tray remains labelled if it fits without collision.

### Tablet portrait — 768 × 1024

- two-column overview for compact previews;
- one column for documents, message excerpts and schedule when necessary;
- menus reposition to remain visible;
- replace dense board/calendar geometry with focussed column/agenda presentations.

### Mobile — 390 × 844

- full-width surface with 16 px padding;
- title and first useful module above the fold;
- two compact tool tiles or one content-rich tile;
- icon personal tray with accessible labels;
- sticky primary action allowed only when it does not cover content;
- no page-level horizontal overflow;
- minimum 44 px touch targets;
- editor toolbars scroll or collapse independently without widening the page.

Container queries are preferred for tool previews because the same component appears in the overview, sheets and full tool pages.

## 15. Accessibility contract

- Meet WCAG 2.2 AA for the completed slice.
- Provide a first-focus Skip to main content link.
- Maintain one logical `h1`; tool/section headings descend correctly.
- All avatar-only and icon-only actions have accessible names.
- Preserve visible focus and DOM order that matches visual order.
- Announce dynamic status without stealing focus.
- Do not encode agent/job state by colour alone.
- Modal background is inert; focus is trapped and restored.
- Completion checkboxes have explicit names and states.
- Drag-and-drop has keyboard and menu alternatives.
- Dates use semantic `<time>` with machine-readable values.
- Respect browser zoom to 200% without losing essential content or actions.

## 16. Agentic Team repository map

| UX surface | Existing implementation/data | Required change |
|---|---|---|
| Product shell/projects | `web/studio/app.js`; portfolio and `/p/:slug` routes | Simplify shell and make project Overview the natural landing surface |
| Overview | `web/studio/plane.js`, `panels.js`; stored dashboard layouts | Recompose existing content into a live tool table of contents; no new overview mode |
| Tasks | project `tasks` route and canonical Postgres tasks | Apply shared list/detail grammar; integrate without duplicating #259 Personal Tasks |
| Documents/assets | project `documents`, viewer, connector-backed documents | Unify list/detail/add flows and preserve artifact provenance |
| Agent roster/jobs | project `team`, in-tray and job surfaces | Reframe as a project tool; keep execution controls and state machine |
| Artifact import | existing approve/discard/import paths | Make `Add to project` obvious, idempotent and provenance-safe |
| Contacts | `web/studio/people.js`, project `contacts` | Add to Jump and shared record grammar |
| Sources | project `sources`; Settings/Connections | Separate healthy project knowledge from setup/connection diagnostics |
| Jump/search | `web/studio/command.js` candidate model | Add global `Shift+J`, recents, direct destinations and full-search promotion |
| Schedule/activity | existing time/activity data; Activity in Overview | Add schedule/agenda preview and expanded activity without restoring tab sprawl |
| Settings | `web/studio/project-settings.js` | Keep admin/destructive actions in focussed settings and overflow |

Architectural caution: `app.js` and `studio.css` are already large. Build focused components/modules and token layers; do not append another all-screen implementation to either monolith.

## 17. Reference vertical slice — exact build order

### Phase 0: baseline and preservation

1. Record current routes, controls and screenshots at the four target viewports.
2. Run the existing verification suite relevant to routes, controls, map, tasks, documents, keyboard, accessibility, responsive width, space, motion, offline state and pressability.
3. Create a preservation matrix for every current project tab and action.
4. Do not remove or rename backend operations in this phase.

### Phase 1: foundations

1. Add design tokens and typography roles.
2. Build shared Button, IconButton, Input, Menu, Sheet, Breadcrumb, RecordActions, Status, EmptyState, ErrorState and Skeleton primitives.
3. Add consistent focus, reduced-motion and touch-target rules.
4. Add component tests before consuming the primitives broadly.

### Phase 2: shell and Jump

1. Implement desktop/mobile global shell.
2. Add personal tray and attention queue entry.
3. Extend existing command candidate model rather than replace it.
4. Implement click and `Shift+J`, recents, keyboard navigation and full-search promotion.

### Phase 3: project overview

1. Make Overview the project landing surface.
2. Compress the mobile header so useful content appears above the fold.
3. Render real previews for Tasks, Documents, Work Board, Schedule, Activity and Agentic Team.
4. Preserve access to Contacts, Sources and Settings.
5. Add tool-empty and project-empty states.

### Phase 4: task journey

1. Overview task preview opens task tool/detail.
2. Inline Add creates a real task.
3. Assignment, status and due-date changes persist through reload.
4. Comments, relations and activity remain accessible.
5. Verify no collision with Personal Tasks or agent jobs.

### Phase 5: agent-output journey

1. Overview Agentic Team preview opens team surface.
2. Select/start a job using existing mechanisms.
3. Show progress and recoverable errors.
4. Open one output and Add to project.
5. Confirm the canonical document/asset exists with job/task/source provenance.
6. Repeating the operation must not duplicate it.

### Phase 6: browser validation

Run the acceptance matrix below, fix failures, record deliberate exceptions, then stop for review.

## 18. Acceptance matrix

### Functional journeys

- Home -> project -> Overview opens without an extra view-selection step.
- Preview -> tool -> record -> project return path is always clear.
- Jump opens by mouse and `Shift+J`; search filters immediately; `Shift+Enter` reaches full search.
- Inline task creation can be completed and cancelled without losing context.
- Task assignment/state/due date persists after reload.
- Agent job/output -> Add to project -> document detail works once and remains idempotent.
- Existing Contacts, Sources, Settings, documents, tasks and team actions remain reachable.

### Visual/responsive

- Capture 1440 × 900, 1024 × 768, 768 × 1024 and 390 × 844.
- No essential text/control clipping.
- No page-level horizontal overflow.
- At 390 × 844, title and first useful module appear before 40% of the viewport height; target materially better than the recorded 46% chrome defect.
- Preview cards share spacing/radius/type rules and do not become generic blank metrics.
- Popovers remain inside the viewport and point back to their invoker.
- Bottom tray never covers final content or primary actions.

### Interaction and accessibility

- Complete each journey using keyboard only.
- Focus order follows visual reading order.
- Focus is visible on every interactive item.
- Escape closes transient surfaces and restores focus.
- Screen reader names identify icon controls, previews, completion state and agent/job state.
- 200% zoom and reduced motion retain full operation.
- Touch controls meet 44 px target requirements at mobile widths.

### State coverage

- loading;
- empty;
- stale/refreshing;
- validation failure;
- server failure with retry;
- permission denied;
- degraded service;
- offline;
- success;
- optimistic rollback;
- long titles/content;
- many assignees/participants;
- zero and very large result counts.

### Automated gates

Run the repository's existing checks for map, arrangement, map view, routes, controls desktop/phone, tasks, task UI, documents, files, artifacts/import, agents/jobs/stop, search, keyboard, accessibility, responsive width, space usage, motion, offline state and pressability. Add focused tests for new primitives, Overview landing, Jump shortcut, task persistence and artifact idempotency.

### Visual-regression rule

Establish approved Agentic Team baselines at all four viewports. Automated image diff is a signal, not the sole decision. Investigate any component-level change above roughly 2% or page-level change above roughly 5%; approve only when the hierarchy, content and accessibility remain correct. Font-antialiasing noise may be masked but content movement may not.

## 19. Definition of Done

The reference slice is done only when:

1. all preservation-matrix entries have a reachable route or an explicitly approved retirement;
2. the shell, Jump, Overview, task journey and agent-output journey use real data;
3. desktop and mobile evidence exists for every acceptance journey;
4. loading, empty, error, permission and offline states have been exercised;
5. keyboard, screen-reader semantics, reduced motion and 200% zoom pass;
6. existing relevant verification passes and new regression coverage is committed;
7. no Basecamp branding, assets, source or unlicensed fonts are present;
8. known exceptions are written down with owner and consequence;
9. the team conducts a review and explicitly chooses whether to expand the system;
10. work stops. Remaining screens become separately scoped slices.

Not done means “looks close in one desktop screenshot.” Done means the interaction contract, responsive behaviour, data persistence, agent provenance and failure states all survive real browser use.

## 20. Build-versus-integrate decision gate

In parallel with—not inside—the reference slice, timebox one Basecamp integration spike:

1. read one Basecamp project with its to-dos, messages and documents;
2. trigger one Agentic Team job from one explicit convention;
3. post one result back with a stable provenance link and idempotency key;
4. update status once without duplicate activity;
5. test permission failure, retry and reconciliation;
6. measure setup time, round-trip latency and ongoing sync complexity.

Choose Basecamp as the human-facing project layer if ordinary weekly work is complete there and Agentic Team's unique controls/provenance survive without obscure conventions or dual ownership. Choose the native Agentic Team frontend if Basecamp hides or distorts agent state, job control, source relationships, artifact provenance or permissions.

Do not maintain both full product directions indefinitely. Record one decision after the two finite experiments and stop the rejected path.

## 21. Coding-agent handoff prompt

> Implement only the reference vertical slice in this specification inside the existing `web/studio` frontend. First inspect the current routes, components, tests and dirty worktree; preserve unrelated changes. Establish a passing baseline and a feature-preservation matrix before editing. Do not create a new frontend, Canvas tab, third Overview mode, second task system, or mock-only experience. Use real existing APIs and records. Build reusable tokens and primitives, then the shell and Jump, the live project Overview, one persisted task journey, and one provenance-preserving agent-output-to-document journey. Validate at 1440×900, 1024×768, 768×1024 and 390×844, including keyboard, screen-reader semantics, reduced motion, 200% zoom, loading/empty/error/permission/offline states and no page-level horizontal overflow. Run the relevant existing verification gates and add focused regression tests. Do not copy Basecamp branding, assets, source code or unlicensed fonts. Stop when the Definition of Done is met and report screenshots, tests, preserved routes and known exceptions; do not continue into a wholesale redesign.

---

This specification is the implementation contract. Any departure that removes capability, changes a task/job/document data boundary, or adds another top-level product metaphor requires explicit review before code is written.

