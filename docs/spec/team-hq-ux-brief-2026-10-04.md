# Team HQ UX / product brief, 4 October 2026 (verbatim)

Stored verbatim from the first message of the overnight run, so the final audit reads the ORIGINAL words rather than the ledger's rendering of them.

---

You are beginning a long autonomous implementation run on:

granterogers/agentic.team.grant

MISSION

Spend up to approximately 12 hours implementing, integrating, testing, visually QAing, refining, committing and pushing as much of the UX/product specification below as can safely be completed.

This is NOT a planning/audit-only session.

The desired result tomorrow morning is a substantial amount of WORKING, TESTED, VISUALLY POLISHED SOFTWARE.

Equally important: NONE of the detailed wishlist decisions in this specification may be silently forgotten.

If twelve hours is insufficient to implement everything, unfinished requirements must remain explicitly tracked.

NOT IMPLEMENTED because time ran out is acceptable.

FORGOTTEN, SILENTLY DROPPED, OR INCORRECTLY ASSUMED COMPLETE is not acceptable.

Do not stop after reconnaissance.
Do not stop after writing a plan.
Do not stop after one feature.
Do not wait for user feedback unless there is a genuinely unrecoverable blocker.
Make sensible engineering decisions yourself.
Work persistently through the highest-value remaining requirements for the full available run.

==================================================
0. CRITICAL ISOLATION / PRODUCTION SAFETY

Concurrent V1 closure work is happening on:

claude/multi-user-p4

DO NOT interfere with it.

Before modifying anything:

1. Fetch latest refs.
2. Determine the CURRENT HEAD of claude/multi-user-p4.
3. Create a NEW isolated git worktree.
4. Create a NEW branch from that current HEAD.

Use something clearly named, for example:

claude/team-hq-ux-overnight

or, if necessary:

claude/team-hq-ux-overnight-YYYYMMDD

ALL implementation for this run happens in that isolated worktree.

DO NOT:

* modify the existing multi-user-p4 worktree
* merge into multi-user-p4
* merge into main
* rebase/rewrite the concurrent branch
* force-push
* deploy

SUPABASE PRODUCTION IS CURRENTLY UNHEALTHY.

ABSOLUTELY DO NOT:

* apply production migrations
* modify production schema
* modify production data
* change production Supabase configuration
* run tests against production
* deploy frontend/backend changes
* change production secrets
* change production OAuth configuration
* perform “just a quick production test”

If schema changes are necessary:

* write proper migration files
* leave them UNAPPLIED to production
* test using local Supabase, isolated databases, fixtures, mocks or replicas
* document exactly what remains unapplied

Local implementation is allowed.
Local/isolated testing is allowed.
Commits are allowed.
Push this new branch periodically.

==================================================

1. RECONCILE THE ACTUAL REPOSITORY FIRST
    ==================================================

Before building, inspect the ACTUAL CURRENT REPOSITORY.

Do not assume everything described below is missing.

There is already substantial Team HQ/new-interface work under web/studio and web/studio/bc, including existing layout, Drive, document ordering, jump/navigation, command, account, miniatures, voice and related functionality.

Determine what already exists before changing it.

For every requirement classify it as:

A. already implemented correctly
B. partially implemented
C. existing primitive should be extended/reused
D. genuinely missing

Prefer extending existing architecture over parallel implementations.

Reuse existing:

* project model
* tenant model
* authentication
* Supabase abstractions
* tasks
* documents
* Drive
* integrations
* calendar primitives
* activity/audit system
* command/jump system
* Team HQ components
* design tokens
* autonomy/mayAct system
* test infrastructure

where they genuinely exist.

Do not resurrect the obsolete interface.

All UX work targets the CURRENT/NEW Team HQ interface.

Do not introduce “Basecamp” into new user-facing names or branding.

TIMEBOX initial reconnaissance to roughly 30–45 minutes unless genuine code archaeology requires slightly longer.

Then IMPLEMENT.

==================================================
2. NON-NEGOTIABLE ATOMIC REQUIREMENTS LEDGER

Before implementation, create:

docs/ux-product-requirements-ledger.md

The detailed requirements below are NOT merely broad suggestions.

Break the ENTIRE specification into ATOMIC requirements.

Every distinct behaviour or product decision receives an ID.

For example:

HQ-LAYOUT-001 — modules move continuously
HQ-LAYOUT-002 — modules resize continuously
HQ-LAYOUT-003 — no mandatory fixed resizing increments
HQ-LAYOUT-004 — gentle alignment guides
HQ-LAYOUT-005 — overlap permitted
HQ-LAYOUT-006 — overlap does not force reflow
HQ-LAYOUT-007 — Auto Arrange exists
HQ-LAYOUT-008 — Auto Arrange lightly tidies rather than redesigning
HQ-LAYOUT-009 — Reset View exists
HQ-LAYOUT-010 — Reset View changes presentation only
HQ-LAYOUT-011 — Reset View cannot delete Post-its
HQ-LAYOUT-012 — layouts are project-specific
HQ-LAYOUT-013 — positions persist
HQ-LAYOUT-014 — dimensions persist
HQ-LAYOUT-015 — tints persist
HQ-LAYOUT-016 — zoom persists

Continue this atomic treatment through EVERY SECTION BELOW.

NOTHING IS TOO SMALL TO TRACK.

Every requirement must have a status such as:

NOT INSPECTED
ALREADY SATISFIED
PARTIALLY SATISFIED
IMPLEMENTING
IMPLEMENTED
TESTED
VISUALLY VERIFIED
BLOCKED
DEFERRED

For each requirement record:

* ID
* area
* atomic requirement
* existing implementation discovered
* files/components involved
* implementation performed
* functional evidence/test
* visual QA evidence where relevant
* final status
* remaining work/blocker

Do NOT mark ALREADY SATISFIED because something vaguely similar exists.

Inspect its actual behaviour.

Do NOT mark IMPLEMENTED until code exists.

Do NOT mark TESTED unless an appropriate test actually passed.

Do NOT mark VISUALLY VERIFIED unless the rendered result/interaction was actually inspected.

Maintain traceability:

USER DECISION
→ REQUIREMENT ID
→ CODE
→ FILES
→ TEST
→ VISUAL QA

NO SILENT OMISSIONS.

If something cannot be completed tonight:

BLOCKED or DEFERRED

with the reason.

At approximately:

* 4 hours
* 8 hours
* end of run

briefly re-read THIS ORIGINAL SPECIFICATION and compare it against the ledger.

This is important.

Do not merely check the ledger against itself.

Catch anything accidentally omitted from the ledger.

Then continue implementation.

These reviews are short checkpoints, NOT stopping points.

==================================================
3. IMPLEMENTATION STRATEGY

Work in coherent vertical slices.

Suggested priority:

P0 — workspace interaction foundation
P1 — Post-its + persistence + layouts
P2 — Calendar
P3 — Documents
P4 — unified search / command palette / Activity
P5 — unified Google connection
P6 — browser/research
P7 — artifact/PDF publishing
P8 — external AI/API/MCP and Vicuña

After repository reconciliation, REORDER if the existing implementation makes another sequence materially more efficient.

Prefer genuinely completed vertical slices over touching twenty features superficially.

However, never remove untouched requirements from the ledger.

==================================================
4. TEAM HQ WORKSPACE

LOGIN / LOGOUT

Login/logout/account control should be:

* extremely small
* subtle
* top-right
* minimal screen consumption

Account controls must not dominate project UI.

FREEFORM MODULE LAYOUT

Replace unwanted rigid snapping/predefined sizing behaviour.

Modules should support:

* smooth continuous movement
* smooth continuous resizing
* no mandatory 20px-style increments
* no predefined size increments where unnecessary
* gentle alignment guides
* free placement
* overlap permitted
* no forced reflow merely because modules overlap

AUTO ARRANGE

Add a subtle:
Auto Arrange / Tidy

It should lightly tidy the existing layout.

It must NOT completely redesign it.

RESET VIEW

Add:
Reset View

Reset presentation only.

It may reset:

* positions
* dimensions
* zoom
* layout/presentation state

It MUST NOT delete:

* Post-it content
* tasks
* documents
* events
* project data

PROJECT-SPECIFIC LAYOUTS

Each project has its own independent layout.

Persist:

* position
* dimensions
* visibility
* tint
* zoom
* other relevant presentation state

SAVED LAYOUTS

Support architecture for named layouts.

If practical tonight implement:

* save layout
* load/switch layout
* rename layout
* delete layout

Provide useful presets such as:

* Overview
* Planning
* Research
* Documents

VIEWPORT

Dashboard remains constrained to the browser viewport.

DO NOT build an infinite canvas.

ZOOM

Zoom scales the actual module workspace/grid.

Provide visible controls such as:

−   100%   +

plus reset.

Support intuitive mouse/trackpad zoom.

Aim for a fluid Railway-like experience.

However, do not break scrolling inside:

* Chat
* Tasks
* Documents
* Calendar

Use modifier-wheel/pinch behaviour where appropriate.

MODULE DENSITY

Reduce useless chrome:

* thinner/subtler borders
* compact headers
* tighter padding
* smaller handles
* reduced dead space

Useful content should occupy most of each module.

MODULE CONTROLS

Controls normally remain hidden.

Reveal elegantly on:

* hover
* keyboard focus
* appropriate touch interaction

MODULE TINTS

Each module can have a subtle independent tint.

Provide approximately 8–12 curated tasteful tints.

Provide a tiny colour control.

Custom colour is welcome where straightforward.

Tint persists per project/layout.

MAXIMIZE

Every normal module except Post-its should support maximize.

A maximized module occupies nearly the whole usable screen.

Keep only a small unobtrusive Back/Close control plus essential navigation.

==================================================
5. SPATIAL ANIMATION DESIGN SYSTEM

Smooth spatial transition is a GENERAL TEAM HQ DESIGN PRINCIPLE.

Do not simply pop maximized modules into existence.

A card should visually expand FROM its current dashboard position into its maximized state.

When restored, it should animate naturally back toward the originating card.

Animations should be:

* smooth
* restrained
* premium
* physically coherent
* responsive
* not gimmicky

Apply this design philosophy consistently to cards where appropriate.

Respect:
prefers-reduced-motion

BROWSER/MOUSE BACK IS CRITICAL.

If a module is maximized and the user presses:

* browser Back
* mouse Back

restore the previous dashboard/module state.

DO NOT navigate unexpectedly to another Team HQ page.

Use browser history/state appropriately.

==================================================
6. POST-IT NOTES

Add project-specific Post-it notes.

Desired behaviour:

* initially provide one attractive yellow Post-it/note affordance
* click directly and type
* no unnecessary editor modal
* autosave while typing
* create/pull out additional Post-its
* each becomes an independent dashboard object
* individually movable
* individually resizable where sensible
* explicitly removable
* persistent between sessions
* scoped to current project

Keep them deliberately SIMPLE.

Do NOT add:

* AI extraction
* task conversion
* calendar conversion
* complex intelligence

They are intentionally “dumb notes” for now.

Make them attractive without excessive novelty skeuomorphism.

Post-its do NOT need maximize.

==================================================
7. CALENDAR

Upgrade Calendar into a real calendar.

Support:

* Day
* Week
* Month

RESPONSIVE MODULE

Calendar presentation adapts to module size.

Example:

Large:
full calendar

Medium:
condensed calendar

Small:
agenda/upcoming events

Do NOT crush a full month calendar into an unreadable tiny card.

PROJECT CALENDARS

Each project has its own calendar.

Calendar UI should support/prepare:

* This Project
* All Projects
* Google / combined calendar

PROJECT EVENTS

Events created inside a project:

* belong automatically to that project
* synchronize toward Google Calendar where connected

GOOGLE EVENTS

Existing Google events:

* may remain external
* can be assigned to an Agentic Team project

GOOGLE SYNC TARGET

Bidirectional:

* create
* edit
* delete

If existing integration safely supports this locally, wire it through.

If live credentials/state prevent E2E tonight:

* implement domain/UI/adapters
* test using mocks/isolated fixtures
* do NOT touch production
* document remaining live verification

==================================================
8. SINGLE CONNECT GOOGLE EXPERIENCE

The product uses multiple Google capabilities:

* Drive
* Calendar
* potentially Gmail
* Notebook/NotebookLM-related capability where technically available

The user wants ONE clean tenant-level:

CONNECT GOOGLE

experience.

V1 may assume:
one Google account per tenant.

BUT architecture should not make future multiple accounts impossible.

After connection, UI may show subtle service status:

Google — Connected

Drive ✓
Calendar ✓
Gmail ✓
Notebook capability where real

Do not create four confusing independent onboarding experiences.

Reuse existing OAuth/integration infrastructure.

Do NOT recklessly broaden OAuth scopes.

Do NOT modify production OAuth configuration.

Do NOT claim NotebookLM capabilities that Google’s actual APIs do not provide.

==================================================
9. UNIFIED DOCUMENTS MODULE

Documents is a unified VIEW across sources.

It is NOT synonymous with Supabase storage.

Potential sources:

* connected Google Drive folder
* Notebook/NotebookLM-related available material where technically supported
* Supabase-uploaded files
* generated Team HQ artifacts
* future providers

DEFAULT VIEW:
All Documents

SOURCE FILTERS:

* All
* Google Drive
* Uploaded / Supabase
* Generated
* Notebook where genuinely supported
* extensible future providers

SORT/FILTER where metadata permits:

* filename
* modified date
* added date
* file size
* file type
* source
* project

Include:

* search
* list view
* thumbnail/grid view
* sensible type filters

PROVENANCE

Every document should have a VERY SMALL subtle indicator showing its source.

Do not fill the interface with giant provider logos/badges.

DEDUPLICATION

If the same logical file is represented through multiple relationships/sources, show one logical item where identity can be determined safely.

Use:

* source IDs
* canonical IDs
* hashes
* other high-confidence identifiers

Do NOT dangerously fuzzy-merge unrelated documents.

EXTERNAL DOCUMENTS

A file does NOT need to be copied into Supabase to be useful.

Externally stored documents should remain:

* fully searchable by agents
* fully readable on demand
* previewable

while their source connection exists.

CACHE

Team HQ may cache lightweight derived data:

* metadata
* thumbnails
* extracted text/search index
* preview pages

without copying the full binary.

IMPORT TO TEAM HQ / SUPABASE

Provide/prepare an explicit Import action.

Import means:

Create a durable Team HQ-managed copy which remains available even if the original external source later disappears.

Do NOT silently import every Drive document.

Because production Supabase is unhealthy:

* implement locally
* use abstractions/mocks/tests
* write unapplied migrations where necessary
* DO NOT production-import anything

IN-APP PREVIEW

Documents should be quickly viewable inside Team HQ.

Support as feasible:

* PDFs
* images
* text/documents
* useful metadata
* thumbnails

Routine viewing should not require opening Google Drive.

Provide:
Open Source

where appropriate.

DOCUMENT ACTIONS

Agents may broadly:

* read
* search
* create
* edit
* organize
* move
* transform

Agents should NOT autonomously delete source documents by default.

Explicit user deletion is acceptable.

DOCUMENT VERSIONING

Use proper logical document versioning.

Avoid:
report-final.pdf
report-final2.pdf
report-final-final.pdf

Prefer:
Report
v1
v2
v3

Retain:

* history
* provenance
* rollback architecture where feasible

==================================================
10. UNIFIED PROJECT SEARCH

Implement/extend unified project search.

Search as many real stores as safely possible:

* documents
* tasks
* chats
* Post-its
* calendar events
* saved webpages
* sources
* agent research

Do NOT fabricate results.

Use actual current data.

If not all providers can be completed tonight, implement a clean extensible search-provider architecture and wire the highest-value real providers.

==================================================
11. CMD/CTRL + K COMMAND PALETTE

Implement/extend universal command/search.

Shortcut:

Cmd+K macOS
Ctrl+K elsewhere

Support both:

FIND

and

ACTIONS

Examples:

Find:

* document
* task
* event
* source
* project content

Actions/navigation:

* create task
* open Calendar
* open Documents
* switch project
* open module
* ask Claire/team where existing architecture supports it
* change layout
* choose preset

Existing command/jump functionality appears to exist.

REUSE IT.

Do NOT build a competing second command system unnecessarily.

==================================================
12. ACTIVITY MODULE

Add/extend a project Activity module.

Purpose:
human-readable history of what happened.

Examples:

Claire created a task

Research saved three sources

Grant via ChatGPT edited an event

Google sync updated a document

PDF v3 generated

Drive source indexed

Use existing real audit/event infrastructure.

DO NOT fabricate activity.

Support filtering where data permits:

* user
* agent
* integration
* synchronization
* documents
* tasks
* calendar

CHANNEL PROVENANCE

Preserve which interface caused an action.

Examples:

* Grant via Team HQ
* Grant via ChatGPT
* Grant via Claude
* Grant via Telegram
* Grant via Slack

These remain actions authorized as Grant, but provenance matters.

==================================================
13. AGENT BROWSER / WEB RESEARCH

Investigate existing browser/search/research tooling FIRST.

Do not rebuild existing abstractions.

Desired autonomous capabilities:

* search web
* browse pages
* follow links
* read
* extract information
* screenshot where useful
* download research material safely
* use authenticated resources where architecture safely permits

Useful webpages may become persistent project Sources.

Store provenance such as:

* URL
* title
* retrieval/access date
* project
* agent
* originating job/research task
* extracted/indexed content where appropriate
* citations/evidence

If web research materially contributes to a report or answer, evidence/provenance should be retained.

AUTONOMY BOUNDARY

Autonomous:

* search
* browse
* read
* follow links
* extract
* screenshot
* safe downloads

REQUIRES USER APPROVAL:

* send
* post
* publish
* email
* contact another human
* consequential form submission
* purchase
* booking
* external upload
* other consequential outbound action

Reuse existing autonomy/mayAct/approval architecture.

Do NOT create a parallel approval system.

==================================================
14. BEAUTIFUL PDF / ARTIFACT GENERATION

Investigate existing artifact/document generation FIRST.

Desired interaction:

“Find the latest customer research report and turn it into a beautiful PDF.”

The system should eventually perform:

1. resolve correct source
2. read it
3. structure/edit content
4. apply project style
5. create appropriate visual design
6. render polished artifact
7. QA output
8. save to Documents
9. retain provenance
10. create new versions for revisions

Do NOT require Claude API.

Make publishing provider-independent.

Prefer deterministic rendering infrastructure where appropriate, e.g.:

structured content
→ HTML/CSS or existing rendering system
→ PDF

LLM:
editorial/design decisions

Renderer:
reliable output

Aim for genuinely high-quality visual results.

Do not spend all 12 hours building an enormous publishing engine if nothing exists.

A polished working vertical slice is more valuable.

==================================================
15. PROJECT STYLE / SKILLS PROFILE

Create or prepare a project-specific style/design profile.

Potential contents:

* brand colours
* typography
* logos
* writing tone
* terminology
* preferred document structures
* formatting conventions
* chart style
* image style
* audience assumptions
* reusable instructions

Desired eventual interaction:

“I love this report. Save this as this project’s report style.”

Future artifacts then inherit it.

Support:
tenant default style
→ inherited by project
→ project-specific overrides

If automatic style extraction is too large tonight:

* establish proper model/storage/UI
* integrate it into publishing where feasible
* test it
* do not fake extraction

==================================================
16. EXTERNAL CHATGPT / CLAUDE ACCESS

Audit the existing GPT/external access path.

Goal:

External assistants such as ChatGPT and Claude should ultimately be able to use Agentic Team deeply through a secure permissioned interface.

Potential capabilities:

* list projects
* search project
* search documents
* read documents
* list/create/update tasks
* inspect calendar
* create/update events
* ask team
* inspect Activity
* trigger safe research
* trigger artifact generation

Prefer a reusable secure API/tool/MCP-style interface rather than bespoke integration for each AI vendor.

Preserve channel provenance:

Grant via ChatGPT

Grant via Claude

DO NOT:

* expose secrets
* weaken tenant isolation
* bypass approval policies

Do not allow this infrastructure work to block higher-value UX implementation if it proves large.

==================================================
17. VICUÑA / NOTES INTEGRATION

Locate the ACTUAL existing Vicuña/Vacunia integration.

Do not assume spelling, architecture or API.

Audit real code.

Safely verify as much as possible:

Agentic Team
→ create/update note
→ persistence/synchronization
→ Vicuña representation
→ read/update back where supported

Determine:

* canonical source
* synchronization behaviour
* duplicate prevention
* failure behaviour

Fix concrete defects where possible.

If external availability prevents safe E2E testing, record exactly what remains to verify and continue with other work.

==================================================
18. OPTIONAL CONVERSATIONAL WORKSPACE CONTROL

Lower priority.

Architecture should allow Claire/team to perform workspace actions such as:

“Make Documents bigger.”

“Move Calendar right.”

“Make Tasks blue.”

“Zoom out.”

“Hide Sources.”

“Save this as Planning.”

Do not prioritize this over the direct GUI.

Where possible, expose workspace operations through reusable actions so conversational control can later invoke the same operations.

==================================================
19. GENERATED ARTIFACT AUTONOMY

Agents may autonomously:

* generate documents
* create PDFs
* create versions
* save non-destructive artifacts
* improve drafts

without asking for approval.

However, approval is required before:

* emailing them
* publishing them
* sharing externally with another human
* uploading to consequential third-party destinations
* other outbound actions

Use existing approval architecture.

==================================================
20. VISUAL QUALITY BAR

The user explicitly wants a PROPER VISUAL QA PASS.

“Functionally works” is insufficient.

Team HQ should feel:

* polished
* luxurious
* calm
* high quality
* information dense
* uncluttered
* deliberate
* coherent

Avoid:

* huge dead padding
* generic admin-dashboard appearance
* excessive borders
* arbitrary gradients
* inconsistent radii
* accidental alignment
* jarring transitions
* tiny unusable controls
* debug-looking labels
* oversized login/account controls
* giant provider branding
* obvious placeholder treatment

Preserve and improve the current Team HQ identity.

Use recognizable service logos tastefully where appropriate.

==================================================
21. MANDATORY VISUAL QA

EVERY meaningful UI slice requires visual inspection.

Workflow:

1. implement
2. run locally
3. open in a real browser
4. exercise actual interaction
5. capture screenshots where tooling permits
6. visually inspect
7. identify defects
8. fix them
9. rerun
10. inspect again

Do NOT equate unit tests with visual QA.

TEST REPRESENTATIVE VIEWPORTS:

Desktop:
approximately 1440px
approximately 1280px

Mobile:
approximately 390×844

Also inspect an intermediate/tablet-like width where practical.

Explicitly inspect:

* clipping
* overflow
* typography
* spacing
* alignment
* card density
* hover controls
* touch controls
* dragging
* resizing
* overlap
* alignment guides
* Auto Arrange
* Reset View
* zoom
* tint controls
* maximize
* maximize animation
* restore animation
* browser Back
* mouse Back
* Post-it editing
* Post-it persistence
* Calendar Day
* Calendar Week
* Calendar Month
* compact Calendar
* Documents filters
* source indicators
* thumbnails
* previews
* command palette
* unified search
* Activity
* responsive layouts
* keyboard navigation
* focus
* reduced motion
* light/dark behaviour if supported

Use Chromium/Playwright/browser tooling if already available.

Add browser tests where valuable.

Do not introduce fragile screenshot tests unnecessarily.

==================================================
22. FUNCTIONAL QA

Run existing relevant tests frequently.

Add tests for new behaviour.

Critical coverage should include where applicable:

* layout serialization
* layout restoration
* project layout isolation
* Reset View data safety
* zoom persistence
* tint persistence
* Post-it persistence
* project isolation of Post-its
* calendar project association
* document source filtering
* document deduplication
* imported versus indexed semantics
* versioning
* unified search
* command actions
* maximize/history behaviour
* browser approval boundaries
* audit provenance
* tenant isolation

Run according to actual repository tooling:

* lint
* typecheck
* unit tests
* integration tests
* E2E/browser tests
* security/tenant tests

Do NOT weaken existing tests just to make the branch green.

==================================================
23. ACCESSIBILITY / RESPONSIVENESS

Maintain or improve:

* keyboard access
* focus visibility
* appropriate ARIA
* contrast
* approximately 44px touch targets where interaction requires them
* prefers-reduced-motion
* mobile usability
* iOS input behaviour

Do not reintroduce iOS form/input zoom problems.

Desktop remains the richest workspace experience.

Mobile must remain usable and unbroken.

==================================================
24. ENGINEERING QUALITY

Avoid giant ad-hoc patches where clean abstractions are practical.

Do not make already-large frontend files dramatically worse merely for speed.

Extract focused modules where appropriate for:

* workspace state
* layout persistence
* module actions
* animation state
* document providers
* search providers
* calendar adapters
* activity events

BUT:

Do NOT:

* rewrite the frontend framework
* undertake unrelated refactoring
* replace the stack
* derail the run with architectural perfectionism

Use the existing architecture intelligently.

==================================================
25. IMPLEMENTATION LOOP

For each vertical slice:

1. select outstanding requirement IDs
2. inspect existing code
3. implement
4. test
5. run locally
6. visually inspect
7. exercise interaction
8. fix defects
9. rerun tests
10. update requirements ledger with evidence
11. commit
12. push
13. move immediately to next highest-value requirements

Do not stop after a successful slice.

==================================================
26. COMMITS / CHECKPOINTS

Commit coherent slices.

Examples:

feat(hq): add freeform persistent workspace layout

feat(hq): add project post-it notes

feat(calendar): add responsive project calendar

feat(documents): unify multi-source document browser

feat(search): add project-wide command search

feat(activity): add project activity module

Push periodically.

Do NOT leave twelve hours of work in one unpushed working tree.

Before major checkpoints:

* run relevant tests
* inspect git diff
* check for secrets
* verify no production configuration was changed

==================================================
27. DO NOT STOP EARLY

This is an autonomous overnight run.

Use the full available session intelligently.

If one feature finishes:
continue.

If blocked:
record the blocker and work on another independent requirement.

If an unrelated existing test fails:
verify whether it is pre-existing, record it and continue safely.

If a feature is too large:
implement the highest-value coherent vertical slice, retain remaining atomic requirements as outstanding, and continue.

If major functionality finishes early:
spend remaining time on:

* missing requirements
* defects
* visual refinement
* interaction refinement
* accessibility
* responsive behaviour
* performance
* tests
* edge cases

Do NOT spend remaining time writing essays.

Keep improving the software.

==================================================
28. NO FAKE COMPLETENESS

Do NOT create dead controls merely to mark requirements complete.

Examples:

A Connect Google button that does nothing is NOT implemented.

A Day/Week/Month selector with only one working view is NOT complete.

A Documents filter displaying hardcoded examples is NOT implemented.

A maximize icon without correct history restoration is only partially implemented.

A Post-it that disappears on refresh is not complete.

A source badge without real provenance is not complete.

A browser capability that bypasses approval boundaries is not acceptable.

A requirement is complete only when its intended behaviour actually works.

==================================================
29. FINAL ORIGINAL-SPECIFICATION AUDIT

Before ending the run:

RE-READ THIS ENTIRE PROMPT FROM THE BEGINNING.

Compare EVERY substantive requirement against:

docs/ux-product-requirements-ledger.md

Look specifically for small requirements buried inside larger sections.

If any requirement was omitted from the ledger:

ADD IT.

Then classify it accurately.

Do NOT hide unfinished requirements.

Final statuses must make clear:

DONE
PARTIAL
BLOCKED
DEFERRED

and why.

The final audit must answer:

“Can the user trace every wishlist decision from the conversation to either working software or an explicitly outstanding requirement?”

The answer must be YES.

==================================================
30. DEFINITION OF DONE FOR TONIGHT

SUCCESS IS NOT:

* “I analyzed the repo.”
* “Here is a roadmap.”
* “These features are possible.”
* a pile of mockups
* dead buttons
* placeholders
* untested code
* claiming the whole wishlist is complete because three headline features exist

SUCCESS IS:

* substantial real functionality implemented
* integrated into current Team HQ
* existing functionality reused rather than duplicated
* locally/isolated tested
* visually inspected
* polished
* committed
* pushed
* requirements individually tracked
* no silent wishlist omissions
* no interference with multi-user-p4
* no production Supabase changes
* no deployment

==================================================
31. MORNING REPORT

At the END provide one concise, evidence-rich report.

Include:

1. branch name
2. starting commit
3. ending commit
4. total atomic requirements identified
5. number already satisfied before run
6. number implemented tonight
7. number functionally tested
8. number visually verified
9. number partially completed
10. number blocked
11. number deferred/not reached
12. major features completed
13. defects discovered and fixed
14. visual QA performed
15. exact viewport/device coverage
16. automated test commands and results
17. migrations written but NOT applied
18. production/live verification deliberately NOT performed
19. screenshots/artifacts and locations
20. known limitations
21. recommended next implementation sequence
22. merge/rebase considerations relative to claude/multi-user-p4

Include a requirement matrix:

ID | REQUIREMENT | BEFORE | AFTER | FUNCTIONALLY TESTED | VISUALLY VERIFIED | STATUS | EVIDENCE/NOTES

Do not claim something was tested unless it actually was.

Do not describe DEFERRED requirements as implemented.

==================================================
32. FINAL OPERATING PRINCIPLE

Protect:

* production
* tenant isolation
* user data
* concurrent V1 work

Then maximize useful implementation.

RECONCILE FIRST.

WRITE THE ATOMIC LEDGER.

IMPLEMENT.

TEST CONTINUOUSLY.

VISUALLY INSPECT.

REFINE UNTIL IT LOOKS RIGHT.

COMMIT.

PUSH.

CHECK THE ORIGINAL WISHLIST AGAIN.

MOVE TO THE NEXT REQUIREMENT.

DO NOT STOP MERELY BECAUSE ONE FEATURE WORKS.

Use as much of the approximately 12-hour run as productively possible.

Tomorrow morning, the objective is not merely to have a noticeably better Team HQ.

The objective is to have:

1. as much of this complete product/UX wishlist genuinely implemented and polished as safely possible, AND
2. a precise accounting of EVERY remaining wishlist detail so that nothing from the user’s decisions in this specification can ever silently disappear.

Begin now.
