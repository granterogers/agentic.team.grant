# MISSION — project workspace overhaul, 22 September 2026

**Read this first if the conversation has been compacted.** It is Grant's brief,
verbatim, followed by a requirement ledger that is updated as work proceeds.
Compaction is NOT a stopping condition and NOT a reason to ask him to repeat
anything: recover the mission from this file and continue.

Branch: `claude/basecamp-team-hq`. Never merge to `main`. Never damage or
replace the default Team HQ. Never claim verification that did not happen.

---

## His brief, verbatim

You are continuing the UX and functional overhaul of the Agentic Team project interface.
This is an implementation task, not a planning exercise and not a GitHub-issue-writing exercise. Inspect the existing implementation, reproduce the defects where appropriate, make the changes, test them in the real interface, and continue until this entire batch has been addressed as far as technically possible.

CRITICAL: SURVIVE CONTEXT COMPACTION
Before substantial implementation work:

1. Persist this complete mission and its acceptance criteria in an appropriate repository handover/autonomous-run document.
2. Record progress against each requirement as work proceeds.
3. Record important architectural decisions, discoveries, remaining defects, and verification results.
4. If the conversation is compacted, immediately recover the mission from the repository rather than relying on conversational memory.
5. Do not treat compaction as a reason to stop, ask Grant to repeat instructions, or quietly drop requirements.
6. Before declaring completion, reconcile the implementation against the persisted requirements one by one.
7. A requirement is not complete merely because code exists. Verify actual user-visible behaviour wherever practical.

Do not create dozens of GitHub issues instead of doing the work. Fix defects directly. Create an issue only where genuinely useful for something that cannot responsibly be completed during this run.

### PROJECT HOMEPAGE / MODULE SYSTEM

**Expand/collapse behaviour**
At present, expanding some minimized panels requires clicking precisely on the title text.
Change this so that the entire module header/top section is the interaction target for expanding/collapsing the module.
It should feel obvious and forgiving rather than requiring pixel-precise clicking.
Do not allow interactive controls within the header, such as three-dot menus, to accidentally trigger expansion.

**Dynamic module layout**
The project homepage is intended to behave as a configurable workspace, not a static collection of cards.
Implement proper:

* drag-and-drop module repositioning;
* dynamic module resizing;
* sensible minimum sizes;
* sensible maximum sizes;
* collision prevention;
* responsive rearrangement;
* persistence of the user's chosen layout where appropriate.

Grant should be able to make Documents larger, make another module smaller, reposition modules, etc.
Do not substitute crude up/down controls for genuine spatial rearrangement.
Modules must not overlap or create broken layouts.

**Panel overflow**
Remove patterns such as "One More" being used merely because additional content does not fit.
Modules containing more data than their visible area should instead become internally scrollable.
Implement attractive, unobtrusive, visually consistent scrollbars across modules wherever overflow exists.
The scrollbar treatment should fit the premium visual direction of the new UI rather than looking like an unstyled browser default.

**Screen width**
The project homepage currently wastes too much horizontal screen space.
Allow the workspace to occupy substantially more of the available viewport width while retaining a tasteful outer margin.
The layout should adapt intelligently to larger desktop displays rather than remaining unnecessarily constrained.

### TO-DOS
The miniature To-Dos module remains functionally broken.
Fix interaction so that:

* task checkboxes work;
* tasks themselves can be clicked where appropriate;
* changes immediately update the interface;
* state persists correctly;
* the miniature view reflects the real underlying task state.

The expanded To-Dos interface has the same fundamental problem.
Fix it so that tasks and checkboxes are genuinely interactive there as well.
Do not accept an interface that merely looks interactive.
Change: "Add a List" to: "Add a Task" unless there is a genuine separate list-creation function that requires a distinct command.

### DOCS & FILES
File behaviour is inconsistent.
Some PDFs can be clicked while other assets cannot.
Audit the file/document interaction rather than patching only one example.
Known examples include:

* the Grant Rogers avatar document having no useful thumbnail and not opening;
* audio files not being clickable/useful.

Support the file types represented in the project properly.
Where appropriate:

* clicking a file should open/preview it;
* thumbnails/previews should appear;
* audio should have usable playback;
* unsupported preview formats should still have a sensible open/download/details action;
* broken/missing thumbnails should have attractive fallbacks.

Do not design Docs & Files around PDFs alone.

### SCHEDULE
Schedule entries currently contain broken references.
For example, clicking "Conduct first five interviews" can produce: "This task is not in the project anymore."
Investigate the underlying relationship between schedule entries and tasks rather than hiding the error.
Repair stale/broken references where possible and ensure schedule entries resolve to the correct underlying object.
The schedule must not routinely display clickable objects that lead nowhere.

### SOURCES
In the three-dot menu, replace the wording "Where the material comes from" with simply "Sources".
Grant has repeatedly requested visual identification of sources.
Add the appropriate logo/icon next to each source.
Do not leave this as another text-only source list.
The source should be recognizable visually as well as by name.

### CHAT WITH TEAM
Rename the current "Chat" button to "Chat with Team".
Clicking it should open the team chat sidebar.
Clicking the same button again should close the sidebar.
The control therefore behaves as a genuine toggle.
The sidebar should expose useful chat history, rather than behaving as though every interaction starts from nothing.
Keep team avatars/photos confined to the chat experience where they are useful; do not scatter agent portraits around unrelated project modules.

### VOICE TEAM / MICROPHONE
The microphone control next to Chat with Team currently appears to do nothing.
This is a functional defect.
Wire the microphone button into the intended pure voice conversation with the Agentic Team using the OpenAI voice/realtime interface.
Trace the interaction end-to-end: button to voice interface/session to microphone/audio permissions to connection to conversation to cleanup/end state.
Do not merely attach a click handler that does not result in a usable voice session.
Verify the real behaviour.
The microphone control should also have appropriate visual prominence.
It currently feels undersized relative to Chat with Team.
Make its button/icon sizing, hit area, spacing and visual weight harmonious with the adjacent Chat with Team control.
The two controls should clearly look like sibling primary communication actions: Chat with Team | Microphone
while remaining visually distinct enough that the user understands one is text chat and the other is immediate voice conversation.
Provide sensible loading, permission, connecting, active, error and disconnected states where applicable.

### REMOVE AGENTIC TEAM DASHBOARD PANEL
The standalone Agentic Team panel on the project homepage is superfluous.
Remove it.
Configuration/management of the agentic team belongs in Settings rather than consuming project-dashboard real estate.
Do not remove the actual team/chat functionality - only the redundant homepage panel.

### CONTACTS
Change "Add Someone" to "Add Contact".
Expand Contacts from a mostly static display into an editable contact-management component.
Each contact should support an optional profile/client image upload.
Contacts should support useful metadata including, where appropriate:

* name;
* organisation/company;
* role;
* email;
* telephone;
* website;
* Instagram/social profile;
* other relevant links;
* notes;
* image/avatar;
* other existing contact fields.

Do not force every field to be populated.

**Editing**
Existing contacts must be editable.
Grant should be able to open a contact and:

* change existing data;
* add missing data;
* replace/remove the image;
* add or update website/social information;
* edit notes;
* correct details later.

**Notes**
Notes must not be read-only decoration.
They should be genuinely editable and persisted.
The general rule should be: If information about a contact is displayed as user-managed contact data, there should be a sensible way to edit it.
Use appropriate validation for URLs/email/etc. without making the interface cumbersome.

### CARD TABLE
The Card Table module currently appears to be interactive but clicking it can do nothing.
Fix this.
When opened, the Card Table itself needs a substantial functional pass.
Cards must be dynamically draggable between columns.
Moving a card must update its actual underlying state rather than merely animating the UI.
Make column/status differences immediately legible.
Use tasteful colour coding according to the card's current column/status.
The result should feel like a real lightweight Kanban board.
Test: opening the Card Table; moving cards; persistence; moving repeatedly between columns; empty columns; long columns; scrolling; responsive behaviour.

### NAVIGATION / BACK BUTTON
At present, using the browser Back button or a mouse Back button while inside an expanded module can immediately throw the user back to Project Selection.
Improve navigation-state handling.
Desired hierarchy:

1. If a modal/expanded module/detail view is open, Back should close that first.
2. If an internal project navigation state can sensibly be reversed, Back should reverse it.
3. Only when the user is genuinely back at the root project view should another Back action navigate away toward Project Selection/Home.

Where technically appropriate, use browser history/state correctly rather than hijacking the Back button in a brittle way.
Test this specifically with browser Back and mouse Back navigation.

### LATEST ACTIVITY
Latest Activity currently appears acceptable.
Do not redesign it simply for the sake of changing something.
Only touch it if necessary for consistency or because testing exposes a genuine defect.

### REMOVE REDUNDANT "ELSEWHERE ON THIS PROJECT" MODULE
Remove the "Elsewhere on this project..." style module.
Its purpose is redundant because Project Settings already exists within the three-dot project menu.
Avoid duplicate navigation and unnecessary dashboard clutter.

### PROJECT SETTINGS
Project Settings is still exposing the old-fashioned/legacy interface.
Do not continue mixing the redesigned project UI with legacy screens.
Project Settings should be migrated to the same current visual system and interaction language as the redesigned interface.
However, do not invent or unnecessarily expand the Settings information architecture during this pass.
The immediate requirement is:

* stop dropping the user into an obviously legacy-looking interface;
* make Project Settings visually coherent with the new application;
* preserve existing settings functionality;
* avoid regressions.

A more detailed settings review can happen separately.

### GLOBAL SETTINGS
The global Settings page is also still using the old interface.
This is now explicitly technical debt that must be addressed.
Create a replacement interface using the same design system as the new project experience:

* typography;
* spacing;
* card/panel treatment;
* borders;
* shadows;
* controls;
* buttons;
* navigation;
* interaction states;
* responsive behaviour;
* premium visual finish.

Do not simply recolour the legacy page.
Move it properly into the new design system while preserving the underlying settings capabilities.
This can be treated as its own coherent workstream within this run if appropriate.

### VISUAL / INTERACTION QUALITY
Throughout this work, preserve the intended premium character of the interface.
Controls should have: obvious but tasteful hover states; generous hit targets; consistent border weights; attractive shadows/depth where appropriate; coherent typography; polished animations/transitions; visible focus states; clear disabled/loading/error states.
Avoid thin, lifeless borders and controls that technically exist but do not visually communicate interactivity.
Do not sacrifice usability for decorative effects.

### SYSTEMIC AUDIT
Do not assume that the examples Grant reported are the only occurrences.
For each defect class, search for the systemic cause.
Examples: If one checkbox is dead, inspect other checkbox implementations. If one document cannot open, inspect file handling generally. If one schedule item references a deleted task, inspect reference integrity generally. If one module cannot resize, inspect the entire dashboard layout architecture. If one legacy screen remains, inspect navigation routes that can unexpectedly expose other legacy UI.
Fix the class of defect where practical rather than playing whack-a-mole with individual examples.

### VERIFICATION
Use the real running application/browser-based testing wherever practical.
Do not declare success solely from: TypeScript compiling; tests passing; components rendering; click handlers existing.
Exercise the interface as a user would.
At minimum verify the important journeys:

* expand/collapse modules by clicking their headers;
* resize modules;
* reposition modules;
* scroll overflowing modules;
* tick miniature To-Dos;
* tick expanded To-Dos;
* add a task;
* open multiple file types;
* play/open an audio asset;
* open schedule entries;
* inspect Sources and their icons;
* open Chat with Team;
* close Chat with Team using the same button;
* inspect chat history;
* launch voice from the microphone;
* edit an existing contact;
* upload/change a contact image;
* edit contact notes;
* open Card Table;
* drag cards between columns;
* verify card state persists;
* exercise browser/mouse Back behaviour;
* open Project Settings;
* inspect global Settings;
* verify removed redundant modules are genuinely gone;
* test at relevant desktop widths and responsive/mobile sizes.

Where something cannot be fully tested because an external credential/service is unavailable, distinguish clearly between: implemented, automatically verified, and requires external/live verification.
Never represent the third category as fully verified.

### COMPLETION STANDARD
Before stopping:

1. Re-read the persisted mission document.
2. Compare every requirement against the actual implementation.
3. Run relevant automated tests.
4. Perform browser/user-journey testing.
5. Check for regressions.
6. Check responsive layouts.
7. Check console/runtime errors.
8. Check persistence after reload where applicable.
9. Check that no legacy or duplicate implementation remains accidentally exposed.
10. Update the persistent run/handover document with exact final status.

Do not stop merely because the first obvious defects have been fixed.
Continue through this complete batch autonomously.
At the end, provide Grant with a concise reconciliation: what was fixed; what was changed systemically; what was tested in the real interface; anything genuinely remaining; anything requiring credentials/external verification; relevant commits/deployment status.

The objective is not to make the screenshots look approximately right.
The objective is to make the project workspace actually behave like the polished, configurable, interactive project-management interface Grant has been describing.

---

## Requirement ledger

Status words mean exactly one thing each:

- **implemented** — the code is written and the gates pass.
- **verified** — driven in a real browser in this repository's harness, and the
  user-visible behaviour was asserted.
- **live-only** — needs a credential or an external service this sandbox does
  not have. Never reported as verified.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Whole module header expands/collapses; header controls do not | **verified** | verify:basecamp-board — pressed 60px from the header's right edge, empty space, opens the module; the cross does not |
| 2 | Drag-and-drop module repositioning | **verified** | verify:basecamp-board — a real pointer drag moves Docs & Files and the drop survives a reload |
| 3 | Module resizing, min and max sizes | **verified** | verify:basecamp-board — the corner grip grows it; dragged 900px inwards it stops at the minimum; dragged 4000px out it stops at the board |
| 4 | Collision prevention, no overlap | **verified** | asserted on the RENDERED boxes after every gesture, plus 10 unit tests in tests/studio/layout.test.ts |
| 5 | Responsive rearrangement | **verified** | 2-up under 1180px, stacked under 860px, measured on a 390px phone with no sideways scroll |
| 6 | Layout persistence | **verified** | per device, per project; reload check in the board suite. Not yet in the office — Issue 299 |
| 7 | No "one more" overflow; modules scroll internally | **verified** | every summary line removed; the suite fails on any /\d+ more/ and asserts a pane actually scrolls |
| 8 | Styled, consistent scrollbars | **verified** | verify:basecamp-board measures scrollbar-width and scrollbar-color on every scrolling pane, and asserts the WebKit half of the treatment exists too — a pseudo-element cannot be read from script, and "styled in one syntax and forgotten in the other" is the failure being guarded against |
| 9 | Workspace uses much more viewport width, tasteful margin | **verified** | 1088px measure became min(1680px, 94%); measured at 94% of a 1600px window |
| 10 | Miniature To-dos: checkboxes work, immediate, persisted | **verified** | verify:basecamp-todos — no box is disabled, ticking redraws the row at once, it survives a reload, and the expanded view agrees |
| 11 | Expanded To-dos genuinely interactive | **verified** | same suite — unticking in the expanded view puts it back and the miniature agrees the moment the modal closes |
| 12 | "Add a List" becomes "Add a Task" | **verified** | Add a Task is the primary action; list creation is genuinely separate (a list is a milestone task, 0171) so it is kept as a demoted "New list" |
| 13 | Docs and Files: every file type opens sensibly | **verified** | verify:basecamp-docs presses EVERY document in both views and asserts a tab, a player or a details view — never nothing. Proved by restoring the empty reference |
| 14 | Thumbnails or attractive fallbacks for every type | **verified** | a rendered page where there is one, a drawn page where there is not, and a stroked glyph for audio, sheets, slides, mind maps, images and video; no tile collapses |
| 15 | Audio playback | **verified** | the recording plays in the detail view; the suite asserts a real source AND calls play(), which resolves |
| 16 | Schedule entries resolve to the right object; no dead links | **verified** | the cause was one key scheme too many; EVERY schedule entry is now opened by the suite and must show the task it names. Proved by a sabotage that put the old key back |
| 17 | Three-dot wording becomes "Sources" | **verified** | verify:basecamp-words asserts the menu says Sources and that the old sentence is gone |
| 18 | Source logos or icons | **verified** | drawn marks for Notion, Google Drive, NotebookLM, GitHub and Slack in their own colours, with a lettered tile as the fallback; in the miniature and the full surface, from one function |
| 19 | "Chat" becomes "Chat with Team" and toggles the sidebar | **verified** | ctx.toggleDock reads the dock's own state, so closing it by its X leaves the button honest; aria-pressed painted from that state |
| 20 | Sidebar shows chat history | **verified** | chat.thread falls back to the project's own conversation; the dock and the Chat surface were two readers of one fact and the quieter one was the sidebar |
| 21 | Avatars only in the chat experience | **verified** | the dock bubbles carry faces; verify:basecamp-home asserts there is no .bcface anywhere on the project home |
| 22 | Microphone starts a real voice session, end to end | **verified to the network boundary; a real conversation is live-only** | verify:basecamp-voice presses it with a fake microphone and granted permission: the office voice-token endpoint is asked, getUserMedia is called, the SDP request to api.openai.com is made. A real conversation needs the deployed function and a live key — the suite says so in its own output and does not claim it |
| 23 | Microphone sizing and weight harmonious with Chat with Team | **verified** | both 44px tall, beside each other, distinct shapes — measured rather than eyeballed. The first run found the pair mismatched the OTHER way (44 against 32) because only the microphone was being measured |
| 24 | Voice states: loading, permission, connecting, active, error, ended | **verified** | every sentence the voice path produces was written into the call PANEL, which this experience never opens — which is the whole of "the microphone appears to do nothing". A data-callsay element beside the control now carries them, restored after each render, and the button paints idle / connecting / live |
| 25 | Agentic Team panel removed from the project home | **verified** | off the board, still reachable from the three-dot menu; asserted by the journey and the preservation suite |
| 26 | "Add Someone" becomes "Add Contact" | **verified** | miniature, surface head and form title |
| 27 | Contacts editable, all fields, image upload, notes | **verified in the prototype; the office path needs a migration and a gateway deploy** | verify:basecamp-contacts (23 checks) edits every field, changes and removes an image through a real file input, and RELOADS after each. `public.contacts` had never had an update path: migration 0534 adds `hq_contact_update` and `image_url`, and the gateway gains `contact_update`. **Neither is applied or deployed from this branch** — see the run ledger |
| 28 | Card Table opens | **verified** | verify:basecamp-cards — the miniature is the board, its cards open their to-do, and the header opens the full table |
| 29 | Cards drag between columns and persist | **verified** | dragged, RELOADED, asserted; then round the board four times; the select is the second path. Proved by a sabotage that broke the drop |
| 30 | Column colour coding | **verified** | one stage palette used by both views; the suite asserts four distinct column colours |
| 31 | Back closes a modal first, then reverses project state | **verified** | verify:basecamp-back drives page.goBack() — the real history traversal a mouse Back performs — through all three levels, plus Forward and a reload. The fix is the address, not a handler: an expanded view is a place. Proved by removing the suffix |
| 32 | "Elsewhere on this project" removed | **verified** | the function is gone; preservation still proves every section is reachable |
| 33 | Project Settings in the new design system | **verified** | it is the experience's own surface now — no hand-off out of the experiment — drawn by the SAME project-settings.js with the same wiring, inside a scoped stylesheet that gives it this experience's type, spacing, panels, edges, shadows, controls and states. verify:basecamp-settings measures the rendered pixels and compares the panel edge with the board's |
| 34 | Global Settings in the new design system | **verified** | a centred dialog with a scrim rather than a flush drawer pinned beside a rail this experience does not have; same tab strip, panels, controls and typography. All nine tabs still there and still switching |
| 35 | Visual and interaction quality throughout | **verified where it is measurable; judged by eye elsewhere** | hover, focus-visible and disabled states on every new control; 44px floors enforced by basecamp:measure at four widths; reduced-motion guards; 100 captures opened and judged. Three of my own visual defects were found this way and are named in the run ledger |
| 36 | Systemic audit per defect class | **verified** | four classes searched rather than waited for: the token-gated control (three instances), the two-key-schemes reference (schedule, board, miniature, record), the document reference written twice, and the door still pointing at the legacy studio (two doors, one screen) |
