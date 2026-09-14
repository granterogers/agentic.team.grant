# Agentic Team — UX/UI Feedback & Fixes

> **Verbatim.** Grant sent this on 14 September 2026. It is stored exactly as
> received, before anything was done with it — CLAUDE.md's first rule, because
> a compaction has already destroyed one specification. Do not condense it.
> The Issues raised from it are mapped in **#223** (tracking):
>
> | item | Issue |
> |---|---|
> | 1 Call the Team | #214 |
> | 2 Message the Team | #215 |
> | 3 Homepage dashboard | #219 |
> | 4 Project icons and images | #221 |
> | 5, 6 Navigation and header | #216 |
> | 7, 8, 19 Activity, Lately, Tasks | #222 |
> | 9, 10 Settings | #158 (with #39, #36) |
> | 11 Project header | #188 |
> | 12, 13, 14 Panels, distinction, Contacts | #220 |
> | 15, 16 Documents plus, Outputs | #217 |
> | 17 Crashes | #218 |
> | 18 Typography | #160 |
>
> Two corrections recorded in #223: there is no React or hydration in this
> codebase (ADR-0002, ADR-0011), and "project deletion" appears in the
> priority list but in none of the numbered items, so it was not filed.

---

Treat the following as a UX/UI remediation pass. Before implementing anything, inspect the existing architecture and current implementation so that fixes build on what already exists rather than duplicating functionality or introducing unnecessary structural changes.
Prioritize broken interactions and navigation first, then layout/usability improvements, then visual polish.
1. “Call the Team” behaviour
The current call interaction is wrong.
Required behaviour
When Call the Team is pressed:

* Do not open a modal/dialog.
* Start the team voice/audio session directly.
* Change the button/icon state visually to indicate that a live call is active.
* Use a clear active-state treatment such as green/red, glow, pulse, waveform, or similar.
* The state change should be obvious but not intrusive.

The same button should function as a toggle:

* First click → connect/start audio.
* Second click → disconnect/stop audio.
* Stopping the call must genuinely terminate the audio/session, not merely hide UI.
* There should be no modal that remains stuck open.
* Any X/close control associated with the existing implementation must correctly terminate/close its state if it remains anywhere in the codebase.

The experience should feel like toggling a live microphone/call, not opening another page.
2. “Message the Team”
The sidebar interaction is good and should remain.
However:

* Messages sent here must receive their replies inside this messaging interface.
* Slack and Telegram may also receive/synchronize the conversation where configured, but they are not substitutes for an in-app reply.
* Investigate why a message can currently be sent and still have no response several minutes later.
* Surface useful states such as:
   * Sending
   * Thinking/processing
   * Delivered
   * Failed
   * Retry

Do not leave the user wondering whether anything happened.
3. Homepage redesign
The current homepage consisting mainly of project cards is not useful enough.
The homepage should become the global command dashboard for the entire Agentic Team workspace.
It should include:
Global Tasks
Show tasks across all projects, with useful filtering/sorting such as:

* Due soon
* Overdue
* Priority
* Project
* Assigned agent/person
* Status

Projects
Continue showing all projects, but make them one component of the dashboard rather than the purpose of the entire page.
Rearrangeable dashboard
The homepage should use the same modular dashboard philosophy as project pages:

* Drag modules
* Reorder modules
* Resize modules
* Collapse modules
* Persist layout

Do not hard-code one rigid arrangement.
4. Project icons and images
The existing generic coloured-square project identifiers are not useful.
Replace this with a proper icon system.
Provide a high-quality bundled SVG icon library with approximately 300–500 standard icons covering common categories such as:

* Business
* Finance
* Health
* Technology
* AI
* Research
* Education
* Travel
* Property
* Communications
* Creative work
* Documents
* People
* Science
* Engineering
* etc.

Use a reputable open-source SVG icon library rather than manually creating hundreds of icons.
New project defaults
Every newly created project should automatically receive a distinct icon where practical instead of another generic coloured square.
Users must subsequently be able to:

* Change the icon
* Search/browse icons
* Change icon styling where appropriate
* Upload/select a custom project image

A project may therefore have both:

1. a recognisable icon
2. an optional custom project image/cover

5. Navigation
There is currently no obvious way to return to the homepage after entering a project.
Fix this.
At the top left:

* Rename Studio to My Agentic Team.
* The logo/icon beside it should be clickable.
* Clicking the logo or My Agentic Team should always return to the global homepage/dashboard.

This navigation mechanism should be consistently available throughout the application.
6. Remove unnecessary top-right clutter
The small Chief of Staff/team-member photographs currently shown in the top-right navigation area do not add sufficient value.
Remove them unless they are performing an important interaction that is currently hidden.
Simplify the global header.
7. Activity
The current Activity feature is vague and appears to provide little usable information.
It is not clear:

* What it represents
* Why entries are shown
* What users can do with them

If Activity has no meaningful interaction or drill-down, remove it from the current interface.
Do not keep UI elements simply because they already exist.
If useful activity/history data exists internally, it can later be surfaced through a better-designed Recent Activity / Recent Actions component.
8. Rename “Lately”
“Lately” is vague and does not communicate what the module contains.
Rename it to something clearer such as:
Recent Actions
or, if the underlying data better fits:
Recent Activity
Use the same terminology consistently across the application.
9. Settings architecture
There are effectively two kinds of settings, but the current interface does not communicate this clearly.
Separate them explicitly into:
Global Settings
Workspace/application-level settings such as:

* Integrations
* Connections
* AI/provider settings
* User preferences
* Notifications
* Security
* Global defaults
* etc.

Project Settings
Settings specific to the currently selected project.
Rename the project-level settings UI explicitly to:
Project Settings
Do not make users guess which scope they are editing.
10. Settings should be a full page
The current settings modal/pop-up is too constrained for the amount of configuration available.
Replace the modal approach with a proper full-page settings interface.
Use:

* Full available content width
* Settings navigation/sidebar or tabs
* Logical categories
* Clear section headings
* Responsive mobile layout

Settings has enough complexity to justify being a first-class page.
11. Project overview — reduce oversized header
The project title/header consumes far too much vertical space.
Reduce it substantially.
The important project content should begin much higher on the screen.
Keep:

* Project icon/image
* Project name
* Possibly concise metadata/actions

But avoid a large hero-style header unless it provides actual value.
12. Project overview panels
The modular panel concept is correct, but the implementation needs significantly more flexibility.
Panels should support:

* Dragging
* Free rearrangement
* Resizing horizontally
* Resizing vertically where appropriate
* Reordering
* Collapse/expand
* Removal
* Adding again
* Persistent layout

Currently adding a panel tends to place it underneath existing panels without allowing natural rearrangement.
Fix the underlying grid/layout system so modules genuinely behave like dashboard widgets.
13. Panel visual distinction
Different modules currently blend together too much.
Give module categories subtle visual differentiation.
For example:

* Slightly different border accent
* Small icon/category marker
* Very subtle tonal/background differences

Keep this tasteful. Do not turn the dashboard into a collection of brightly coloured boxes.
The objective is faster visual parsing.
14. Contacts panel
Add a Contacts module to the project overview/dashboard system.
Contacts should be available like the other optional panels and eventually support:

* Name
* Organisation
* Role
* Email
* Phone/contact channels
* Notes
* Links
* Project relationship

It should participate in the same drag/resize/layout system as other modules.
15. Documents panel behaviour
Opening an existing document appears to work reasonably well.
Preserve that.
However, pressing + currently results in a large/full-screen interface that either does nothing or feels broken.
Fix this workflow.
Adding/importing/creating a document should use a properly designed interface that:

* Does not unexpectedly monopolize the entire screen
* Is resizable where appropriate
* Clearly explains what action is available
* Provides working controls
* Can be cancelled
* Never leaves the user trapped in an empty view

16. AI Team → Outputs
Clicking Outputs currently appears to do nothing.
Investigate and fix the route/action.
Outputs should display the artifacts/results generated by the AI team, or clearly state that none exist yet.
A navigation control should never silently do nothing.
17. Stability / crash investigation
During normal navigation involving areas such as:

* AI Team
* Outputs
* Documents
* Project navigation

the application appears capable of entering a crashed/broken state.
Reproduce this and inspect:

* Browser console
* React errors
* Route errors
* Network failures
* State-management problems
* API failures
* hydration/rendering errors

Fix the root cause rather than merely suppressing the visible error.
18. Typography consistency
The typography appears to change when moving from the global homepage into a project.
This should not happen unless there is a deliberate design reason.
Audit:

* Font family
* Font loading
* font-weight
* heading scale
* body text
* route-specific CSS
* inherited styles

Use one coherent typography system throughout the application.
19. Tasks
The Tasks section currently reports that nothing is present.
Do not heavily redesign this yet, but verify that:

* The route works
* Tasks actually load where they exist
* Empty states are intentional
* Global and project-level task models can eventually coexist

The new global homepage should ultimately aggregate project tasks.
Implementation approach
Do not treat this as a cosmetic checklist.
First inspect the current implementation and determine which problems stem from shared architectural issues.
In particular investigate whether several complaints can be solved together through:

* A proper dashboard/grid layout system
* Shared application shell/navigation
* A unified typography/theme system
* Clear global-vs-project routing
* Better async request state handling
* A consistent settings architecture

Prefer fixing shared primitives over adding page-specific hacks.
Regression requirements
After implementation, test at minimum:

1. Global homepage → project → homepage navigation
2. Call Team start
3. Call Team stop
4. Confirm audio genuinely terminates
5. Message Team send
6. Message Team receives in-app response
7. Project creation and automatic icon assignment
8. Project icon change
9. Custom image selection/upload
10. Dashboard panel add
11. Dashboard panel drag
12. Dashboard panel resize
13. Dashboard panel remove
14. Layout persistence after refresh
15. Contacts panel
16. Documents panel +
17. Existing document opening
18. AI Team → Outputs
19. Global Settings
20. Project Settings
21. Desktop viewport
22. Tablet viewport
23. Mobile viewport
24. Font consistency between routes
25. Browser console contains no unexpected errors

Do not mark this task complete simply because pages render. Exercise the actual controls and interactions.
Priority
P0 — broken functionality

* Team messaging not returning responses
* Call disconnect behaviour
* Crashes
* Dead Outputs control
* Broken Documents + workflow
* Missing homepage navigation

P1 — major usability

* Global homepage/dashboard
* Draggable/resizable project panels
* Settings architecture
* Project deletion
* Global/project settings distinction
* Smaller project header

P2 — UX/polish

* Project icon library
* Custom project imagery
* Contacts panel
* Module border differentiation
* Remove redundant avatars/activity UI
* Rename Lately
* Typography consistency

Before implementation, check the repository's existing issues/backlog so this work does not create duplicates. Where a concern already exists, update/consolidate it rather than creating parallel implementations.
