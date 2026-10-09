# Team HQ UX, infinite canvas and visual overhaul — Grant, 8 October 2026 — VERBATIM

Everything below the rule is the first message of the build session, word for word, recovered on 8 October from the session's own
transcript (the first user message of the build session) and carried across without edits: the only change is that
nothing was condensed. Line breaks and the `*` bullets are as sent. Only this header is not Grant's.

`team-hq-ux-overhaul-2026-10-08.md` (the requirement-by-requirement record written earlier) is NOT verbatim and says so; where the two differ,
this file is the requirement. Progress: `docs/ux/team-hq-overhaul-log-2026-10-08.md`. Tracked by #439. ADR-0068.

---

MASTER AUTONOMOUS IMPLEMENTATION PROMPT — TEAM HQ UX, INFINITE CANVAS & VISUAL OVERHAUL
You are the autonomous lead frontend engineer, UX architect, visual designer, and QA engineer working on my Agentic Team / Team HQ application.
You have approximately 8 hours of autonomous working time. Your objective is to implement, integrate, visually inspect, test, refine, and complete the improvements described below.
Do not stop after planning, documenting, or completing the first few tasks. Continue executing until the requirements are implemented and verified, or until the session is genuinely exhausted.
Do not interrupt me with routine questions, approval requests, progress checkpoints, or requests to prioritize tasks. Make sensible engineering and design decisions independently.
I want working software, not another collection of plans.
1. Operating Instructions
Before changing code:

1. Inspect the current repository, frontend architecture, branches, existing implementation, relevant documentation, and available tests.
2. Read all relevant project instructions, architectural notes, and existing UX specifications in full.
3. Identify the current Team HQ implementation and its deployed routes.
4. Understand existing project navigation, canvas behaviour, chat, voice input, project appearance controls, and settings.
5. Identify relevant concurrent workstreams and their ownership boundaries.
6. Establish the current baseline before making changes.

Do not assume historical descriptions accurately represent the current code. The repository is the source of truth.
Work primarily on the existing frontend workstream. Do not interfere with unrelated backend, reliability, behavioural, or multi-user work unless a narrowly scoped integration is required.
If another developer or agent is modifying nearby files, avoid overwriting their work.
Preserve existing functionality wherever possible.
Autonomous execution requirements

* Work continuously through the prioritized requirements.
* Implement changes rather than repeatedly proposing them.
* Do not ask me for design preferences when a reasonable decision can be made.
* Use browser screenshots and actual interaction tests.
* Fix defects uncovered during implementation.
* Commit completed, verified increments with meaningful commit messages.
* Do not commit secrets, build artifacts, or temporary test files.
* Run relevant tests after each substantial change.
* Keep a persistent progress record in the repository so work can resume after context compaction.
* Do not let context compaction become a reason to stop.
* Do not silently abandon incomplete requirements.
* Do not claim something works unless it has been verified.

You may use temporary agents or parallel investigations where useful, provided their changes do not conflict.
No human-facing messages, external contacts, purchases, or paid service activations without my approval. Routine repository operations and authorized development work do not require additional approval.
Do not merge into main or deploy over production automatically unless that authority is already explicitly established for this workstream. Use the existing preview deployment process where available.
2. Navigation Architecture — Remove the Home Screen
The current Home button wastes valuable horizontal and vertical screen space.
Replace the existing Home navigation with a compact hamburger menu in the top-left corner.
Required behaviour

* Remove the prominent Home button.
* Introduce a compact hamburger menu.
* Clicking the hamburger reveals available projects and relevant navigation destinations.
* Selecting a project takes the user directly to its workspace.
* Provide an obvious Create Project action.
* If no projects exist, show Create Project rather than an empty navigation list.
* Eliminate the dedicated home screen as a separate landing destination.
* When no project is selected, display the canvas with a minimal empty state inviting the user to select or create a project.
* Keep navigation compact and accessible on desktop and mobile.
* Clearly identify the active project.

The primary application experience should be the project workspace itself.
Remove Jump To
Completely remove the existing Jump To interface.
Do not include People in the replacement navigation.
Move useful navigation destinations into the hamburger menu without creating another oversized navigation surface.
Avoid duplicated navigation controls.
Acceptance criteria
A user should be able to open the application, select a project, switch projects, or create a project without navigating through a redundant home screen.
3. Post-it Notes — Contextual Creation
The existing standalone New Note button is in the wrong place.
Move note creation onto the Post-it notes themselves.
Required behaviour

* Remove the redundant top-level New Note control.
* Add a small plus icon to each yellow Post-it note.
* Display the plus icon on hover, with equivalent keyboard and touch accessibility.
* Clicking the plus icon creates another Post-it note on the current canvas.
* Position the new note sensibly near the originating note, without overlapping it unnecessarily.
* Focus the new note's editor where appropriate.
* Preserve existing note creation, editing, dragging, deletion, and persistence behaviour.

Make sure note creation works when the canvas is zoomed or panned.
No duplicated creation pathways unless they serve a clearly justified accessibility or keyboard requirement.
4. Transform the Project Workspace into an Infinite Canvas
This is one of the most important architectural improvements.
The current dashboard behaves too much like a conventional scrolling webpage.
I want a genuine infinite-canvas workspace resembling a modern spatial whiteboard or CAD-style interface.
4.1 Mouse wheel zoom
The mouse wheel should zoom the canvas rather than vertically scrolling the main page.
Implement:

* Smooth wheel-based zoom.
* Zoom centered around the mouse pointer.
* Sensible minimum and maximum zoom levels.
* Stable positioning during zoom.
* No unexpected document scrolling.
* Proper handling of trackpads and high-resolution wheel devices.
* Appropriate touch pinch-to-zoom support where technically feasible.

Do not hijack wheel events inside scrollable content panels. Users must still be able to scroll conversations, documents, lists, and other internal content normally.
4.2 Infinite panning
The workspace must extend indefinitely in every direction.
Implement:

* Smooth panning around the canvas.
* No arbitrary boundaries preventing panel movement.
* Correct coordinate transformations between viewport and canvas.
* Dragging that remains accurate at different zoom levels.
* Sensible controls for returning to the main workspace or fitting content into view.

Choose an intuitive panning interaction compatible with draggable panels.
4.3 Free panel positioning
Users must be able to drag panels freely around the canvas.
Do not restrict them to a fixed 12-column grid.
The 12-column layout can inform initial placement if useful, but it must not constrain movement once the user begins arranging their workspace.
4.4 Free resizing
Panels must support flexible resizing.

* Allow users to adjust width and height as appropriate.
* Maintain sensible minimum usable dimensions.
* Avoid unnecessary snapping.
* Ensure internal panel content reflows properly.
* Avoid broken layouts at unusually small or large sizes.
* Preserve the layout when navigating away and returning.

4.5 Persistence
Persist panel positions, dimensions, hidden states, and canvas viewport settings on a per-user, per-project basis using the existing approved persistence architecture.
Do not store these settings in shared global state if that would leak one user's preferences into another user's workspace.
Support existing layouts through a sensible migration or compatibility strategy.
4.6 Dotted CAD-style grid
Implement a subtle dotted grid background that responds correctly to panning and zooming.
Dots should remain visually coherent and not produce distracting aliasing or excessive visual noise.
4.7 Technical approach
Evaluate the existing canvas and drag/resize infrastructure before replacing anything.
If a reliable mature library is appropriate, evaluate its maintenance, bundle impact, compatibility, and licensing.
Do not introduce a fragile custom geometry implementation when a robust existing solution would be better.
Avoid unnecessary rewrites.
Acceptance criteria

* Mouse wheel zooms naturally.
* Pointer-centered zoom behaves correctly.
* Canvas pans smoothly.
* Panels can move indefinitely.
* Panels resize reliably.
* Positions and sizes persist.
* Interactions remain correct after repeatedly zooming and panning.
* Scrollable panel content remains usable.
* No noticeable coordinate drift or severe rendering performance problems.

5. Premium Canvas Background & Visual Identity
The current appearance is excessively dark, with too much black and visually flat styling.
I want something considerably more sophisticated.
Design direction
Create a premium, lighter, stony-grey aesthetic.
Think:

* Refined architectural software.
* Beautiful contemporary materials.
* Light natural stone.
* Premium warm-grey microcement.
* Elegant restrained depth.
* Carefully controlled shadows.
* Subtle translucency.
* Excellent typography.
* Polished micro-interactions.

Texture requirements
The canvas needs a genuinely high-quality, professional background texture.
Avoid cheap-looking SVG noise or crude repeating geometric patterns.
Consider generating or sourcing an appropriately licensed, high-resolution, optimized material texture.
The result should be subtle and sophisticated, not a photographic stone slab that competes with the interface.
Combine this with the dotted CAD-style canvas grid.
The background should remain visually pleasing when zooming and panning, without obvious seams or repetition.
Optimize image loading, memory consumption, and performance.
Visual system
Establish consistent design tokens for:

* Background surfaces.
* Floating panels.
* Borders.
* Typography.
* Shadow depth.
* Hover states.
* Focus states.
* Active controls.
* Accent colours.
* Disabled controls.
* Menus and overlays.

Use tasteful effects where useful, but prioritize clarity.
The interface should feel expensive without being visually busy.
Avoid large blocks of pure white, washed-out controls, overwhelming green surfaces, or unnecessarily heavy black backgrounds.
Ensure accessible contrast.
6. Team Chat — Radical Space-Efficiency Improvement
The current Chat With Team interface wastes far too much real estate.
There is excessive padding, oversized typography, unnecessarily large controls, and substantial empty space.
I want a much more compact and sophisticated interface.
Required redesign

* Reduce unnecessary vertical and horizontal padding.
* Reduce oversized headings and labels.
* Use sensible compact chat typography.
* Eliminate oversized message bubbles.
* Reduce unnecessary gaps between messages.
* Maximize visible conversation content.
* Keep the message composer compact.
* Minimize redundant explanatory text.
* Avoid large empty states once a conversation begins.
* Maintain clear distinction between user and team messages.
* Preserve essential agent identity and message status information without allowing decorative elements to dominate.

Do not simply shrink everything until it becomes unreadable.
Use a disciplined information-density strategy that remains accessible and comfortable.
6.1 Resizable Chat With Team panel
The chat panel must support freely adjustable horizontal width.
Implement a small, discoverable resize handle along the appropriate panel boundary.
Users should be able to drag the handle to widen or narrow the chat.
Requirements:

* Smooth resizing.
* Immediate content reflow.
* Sensible minimum width.
* Compatibility with canvas zoom.
* No clipped composer controls.
* Persist the preferred width.
* Work correctly when other panels are moved or resized.

6.2 Chat message typography and wrapping
The current interface can display oversized text that prevents complete messages from being visible.
For example:
"Ask the team at Riverside Cafe lunch"
This and longer messages must display correctly.

* Reduce excessive message font sizes.
* Wrap text naturally.
* Never unnecessarily truncate the actual message body.
* Preserve long-form content readability.
* Handle long unbroken strings gracefully.
* Avoid horizontal overflow.
* Make sure replies are readable in narrow and wide panel configurations.

6.3 Browser visual review
Capture screenshots of the actual chat interface before making major changes.
Evaluate how much of the available space is occupied by actual conversation versus empty padding and decorative elements.
Then implement the redesign and capture comparison screenshots.
Test with realistic short and long conversations.
Do not approve the result purely because CSS tests pass.
7. Team Chat — Replace Voice Recording With Live Dictation
The existing microphone workflow is unacceptable.
I do not want a clumsy record-stop-upload-transcribe interaction.
I want immediate live dictation directly into the message composer.
Desired user experience

1. I click the microphone icon.
2. The microphone activates immediately, subject to browser permissions.
3. I begin speaking.
4. My words appear in the composer in real time.
5. The transcription continues updating as I speak.
6. I can stop dictation and review or edit the text.
7. I click Send.
8. The transcribed text is sent as an ordinary chat message.

No separate audio recording page or modal.
Engineering requirements

* Use an appropriate streaming speech-to-text solution.
* Investigate the existing transcription infrastructure before adding another provider.
* Prefer reliable streaming transcription over delayed batch processing.
* Show interim and finalized transcription text clearly.
* Avoid duplicated words when partial transcripts are revised.
* Preserve existing text if dictation starts after I have typed something.
* Handle microphone permission denial gracefully.
* Handle interrupted connections.
* Provide clear recording and error states.
* Release microphone resources when recording stops or the component unmounts.
* Avoid accidentally submitting incomplete dictation.
* Prevent unintended microphone activation.
* Avoid unnecessary audio retention.
* Avoid silent paid API usage beyond existing authorized services.

Preserve the separate natural, real-time voice conversation capability, if present. That is a distinct feature and must not be broken by changing chat dictation.
Testing
Build automated tests around the dictation state machine.
Use synthetic speech or controlled test audio where practical.
Verify:

* Microphone activation.
* Streaming partial results.
* Final transcript updates.
* Continuous transcription.
* Text editing.
* Sending.
* Permission denial.
* Connection interruptions.
* Cleanup and reactivation.

Also run an actual supported-browser microphone test wherever the environment permits.
Do not pretend synthetic tests prove real microphone capture works. Document what has and has not been verified.
8. How This Project Looks — Complete Visual Overhaul
This section currently looks poorly designed.
Colours appear washed out, the layout contains too much white space, and clicking icons can display oversized descriptions.
For example, clicking Sample Office produces a large descriptive area that consumes too much space.
This needs a proper visual redesign.
Requirements

* Inspect the actual rendered interface.
* Capture current screenshots.
* Identify components responsible for oversized descriptions.
* Redesign icon selection and associated detail displays.
* Make descriptions compact, contextual, and visually attractive.
* Use properly proportioned cards, popovers, or detail panels as appropriate.
* Avoid large blocks of white space.
* Correct colour and contrast problems.
* Make icons visually consistent.
* Refine spacing, alignment, and typography.
* Ensure the result looks excellent with both short and long descriptions.

The interface must work well at multiple viewport sizes.
Use browser-based validation rather than relying exclusively on source inspection.
9. Document Style — Simplification
The current Document Style section is confusing and appears to contain features I never requested.
There is also too much green coloration.
Remove

* Tone of Voice.
* Who's It For?
* Studying Instructions.

Remove their unnecessary visible controls and associated redundant UI logic.
Before deleting any persisted fields or shared data structures, check whether they are used elsewhere. Preserve compatibility where necessary.
Reevaluate the feature
Determine what Document Style currently does.
If it has a genuine useful purpose, simplify its presentation into a small, clear, understandable interface.
If it has no meaningful function, remove or hide the unnecessary interface rather than maintaining a confusing collection of controls.
Do not invent replacement features merely to fill empty space.
Correct excessive green colours and inconsistent styling.
Document the decision briefly in the final report.
10. Team and Sources Sections
Main Team section
Leave the existing main Team section intact for now.
Do not spend significant time redesigning or removing it.
Fix only defects caused by other changes.
Sources
Leave the Sources section functionally unchanged.
Preserve existing integrations and access controls.
Fix regressions or shared styling issues where necessary.
11. Project Settings Simplification
Remove Team tab
Remove the Team tab from Project Settings.
The separate main Team section should remain.
Avoid leaving broken routes, empty panels, or dead navigation entries.
Keep Automations
Retain the Automations feature.
It was not specifically requested originally, but it can stay.
However, the current rendering and colour treatment are poor.
Improve:

* Contrast.
* Background colours.
* Spacing.
* Typography.
* Form controls.
* Visual consistency.
* Compactness.

Do not substantially expand its functionality.
Keep Labels
Leave Labels in place.
Only fix styling regressions or broken behaviour.
Remove Project tab
Remove the redundant Project tab within Project Settings for now.
Before removing it, inspect whether it exposes unique or essential functionality.
Preserve access to indispensable project-management actions such as renaming, deletion, and access configuration through an appropriate surviving interface if necessary.
Do not leave important functionality inaccessible simply because the tab has been removed.
12. Default Layout
The current default layout makes most panels approximately the same size.
This is not ideal.
However, this is a lower-priority requirement.
Once the canvas is working correctly, consider a better initial arrangement using more intentional panel proportions.
For example:

* Chat may benefit from a larger working area.
* Documents may need greater width.
* Small status widgets may need less space.
* Notes should feel like floating Post-it notes rather than generic dashboard cards.

Do not spend excessive time optimizing defaults before the fundamental navigation, infinite canvas, chat, and visual defects are resolved.
13. Cross-Cutting UX Requirements
Apply these standards throughout the affected interface.
Efficient use of space
Every major UI element should justify the space it consumes.
Avoid:

* Oversized headings.
* Giant empty panels.
* Unnecessary hero sections.
* Redundant instructions.
* Duplicated navigation.
* Excessive margins.
* Excessive card padding.
* Unnecessarily large buttons.
* Wasteful fixed-width containers.

Visual quality
Use a consistent, premium design language.
Aesthetic quality matters, but functionality must come first.
Interaction quality

* Smooth dragging.
* Smooth resizing.
* Predictable zoom.
* Clear hover states.
* Discoverable handles.
* Proper keyboard focus.
* No text truncation.
* No accidental scroll trapping.
* Useful loading and error states.

Mobile and accessibility
Preserve iPhone usability and responsive layouts.
Avoid interactions that are mouse-only without an accessible alternative.
Maintain sensible touch targets and respect reduced-motion preferences.
Ensure ordinary text inputs do not trigger unwanted iOS viewport zoom.
Data integrity
Do not lose existing notes, layouts, tasks, messages, documents, or project settings.
Do not introduce cross-user data leakage.
Preserve tenant isolation, authentication, and authorization boundaries.
14. Mandatory Browser-Based QA
This is not optional.
I specifically want you to see what the application actually looks like.
Use the available browser automation or screenshot-capable environment.
If browser tools are unavailable, first investigate the project's existing browser-test infrastructure and whether a local browser can be launched.
Do not fabricate screenshot results.
Required viewport testing
At minimum, inspect:

* Desktop: 1440 × 900.
* Desktop: 1920 × 1080.
* Tablet: approximately 768 × 1024.
* Mobile: 390 × 844.

Required visual states
Capture and inspect:

1. Empty project canvas.
2. Project navigation hamburger.
3. Existing populated project canvas.
4. Canvas zoomed out.
5. Canvas zoomed in.
6. Panned canvas.
7. Moved and resized panels.
8. Post-it note creation.
9. Team Chat with short messages.
10. Team Chat with long messages.
11. Team Chat at minimum practical width.
12. Team Chat at expanded width.
13. Dictation active state.
14. How This Project Looks.
15. Sample Office details.
16. Simplified Document Style.
17. Project Settings.
18. Automations.

Use representative realistic data.
Inspect screenshots for:

* Clipping.
* Text truncation.
* Overflow.
* Excessive whitespace.
* Washed-out contrast.
* Inconsistent typography.
* Broken visual hierarchy.
* Misaligned controls.
* Poor resizing.
* Mobile overflow.
* Rendering defects.

Fix problems, then retake screenshots.
Repeat this process until the interface is genuinely polished.
Store useful before-and-after comparison artifacts in an appropriate development artifact location without unnecessarily bloating the repository.
15. Functional and Regression Testing
Run existing relevant tests and add focused coverage for new functionality.
At minimum, verify:

* Project selection and creation.
* Correct no-project empty state.
* Removal of old navigation pathways.
* Note creation.
* Canvas panning.
* Wheel zoom.
* Pointer-centered zoom.
* Panel dragging.
* Panel resizing.
* Layout persistence after reload.
* Project-specific layout isolation.
* Chat message wrapping.
* Chat panel horizontal resizing.
* Text composer behaviour.
* Live dictation state transitions.
* Message sending.
* Responsive rendering.
* Accessible interaction alternatives.
* Preserved existing Team, Sources, Labels, and Automations functionality.

Include regression tests for important coordinate transformations.
Test repeated zoom-and-drag operations to catch cumulative position errors.
Avoid tests that merely confirm mocks reproduce the implementation.
Use meaningful assertions against user-visible behaviour.
Run TypeScript validation, linting, build checks, unit tests, integration tests, and relevant end-to-end browser tests.
Fix failures introduced by your work.
Differentiate pre-existing failures from new regressions using the recorded baseline.
16. Execution Priority and Time Management
Use the following priority order, adjusting only when dependencies require it.
Phase A — Reconnaissance and Baseline
Inspect the current implementation, verify architecture, establish test baseline, identify existing UX issues, and capture baseline screenshots.
Do this efficiently. Do not consume the entire session on an audit.
Phase B — Core Workspace Architecture
Implement:

* Hamburger navigation.
* Home-screen removal.
* Jump To removal.
* Infinite canvas.
* Mouse wheel zoom.
* Panning.
* Free panel movement.
* Free resizing.
* Layout persistence.

This is the central architectural workstream.
Phase C — Chat Usability
Implement:

* Compact chat redesign.
* Reduced typography and padding.
* Proper text wrapping.
* Horizontal chat resizing.
* Real-time microphone dictation.

Verify that ordinary text messaging remains functional.
Phase D — Visual Polish
Implement:

* Premium stony-grey textured canvas.
* Dotted grid styling.
* Consistent design tokens.
* How This Project Looks redesign.
* Sample Office detail improvements.
* Refined shadows, spacing, colour, and interaction states.

Phase E — Interface Simplification
Implement:

* Contextual Post-it creation.
* Document Style simplification.
* Remove Project Settings Team tab.
* Remove Project Settings Project tab.
* Improve Automations styling.
* Preserve deferred features.

Phase F — End-to-End Verification and Refinement
Run all relevant tests, inspect screenshots, fix visual problems, investigate regression failures, and improve perceived performance.
Do not treat visual QA as a decorative optional final step. Use it continuously throughout implementation.
If time remains
Continue improving defects discovered through browser testing.
Prioritize:

1. Broken interactions.
2. Lost or corrupted state.
3. Layout or rendering regressions.
4. Mobile usability.
5. Performance.
6. Accessibility.
7. Visual refinement and delightful micro-interactions.
8. Improved default panel proportions.

Do not invent major unrelated features simply because time remains.
17. Persistence, Documentation, and Context Compaction
Maintain a concise but durable implementation log.
Track:

* Completed requirements.
* Requirements still outstanding.
* Decisions made.
* Files changed.
* Relevant commit hashes.
* Tests run.
* Verified screenshots.
* Known blockers.
* Next concrete action.

Use the project's existing development logging conventions where available.
Before context compaction, write enough accurate state to the appropriate persistent file to resume without repeating completed work.
After compaction:

1. Read the persistent state.
2. Verify the current branch and working tree.
3. Identify the next unfinished requirement.
4. Continue implementation immediately.

Do not stop simply because a context window ends.
A persistent log is an internal recovery mechanism, not a substitute for implementation.
18. Quality Gates
A requirement is not complete merely because code has been written.
For each meaningful change, seek:

1. Implementation complete.
2. Type checking and build passing.
3. Relevant tests passing.
4. Actual browser interaction verified.
5. Screenshots visually inspected where relevant.
6. No known introduced regressions.
7. Changes committed.
8. Progress log updated.

Where full verification is impossible, mark the requirement as partially verified and explain the exact limitation.
Do not turn a failed or unavailable test into a false success.
Do not weaken tests, remove assertions, or silently skip failing checks simply to obtain a green result.
Avoid superficial CSS patches that mask deeper layout problems.
19. Scope and Safety Boundaries
This is primarily a frontend UX and visual-design overhaul.
Preserve:

* Existing task-system functionality and future Vicuña compatibility.
* Existing Slack and Telegram integration.
* Backend agent routing.
* Chief of Staff communication pathways.
* Existing authentication and multi-user isolation.
* Existing documents and Sources functionality.
* Existing browser and tool integrations.
* The distinction between chat voice dictation and natural real-time voice conversation.
* Production reliability and existing security controls.

If an API change is essential, make the smallest backward-compatible change possible and verify its effect on other interfaces.
Do not modify unrelated branches or overwrite parallel work.
Do not run destructive database migrations.
Do not delete user data.
Do not introduce new paid dependencies or external subscriptions without explicit approval.
Do not contact third parties.
Do not bypass deployment, security, authorization, or production safeguards.
20. Final Deliverable
At the end of the available autonomous session, produce a clear, evidence-based completion report.
Use these sections:
A. Executive Summary
What materially changed in the application?
B. Requirement Completion Matrix
For every requirement above, report:

* Complete.
* Partial.
* Not started.
* Blocked.

Include concise evidence and the relevant files or commits.
C. Visual Improvements
Describe the before-and-after differences.
Provide screenshot artifact locations or preview links where available.
D. Functional Verification
Report real test outcomes, including:

* Type checking.
* Build.
* Unit tests.
* Integration tests.
* Browser tests.
* Dictation tests.
* Mobile tests.
* Layout persistence tests.

Distinguish tests actually executed from tests that were only planned.
E. Architecture
Summarize important decisions about:

* Canvas implementation.
* Panel positioning and resizing.
* Coordinate transformations.
* Layout persistence.
* Speech transcription.
* Visual theme and texture implementation.

F. Outstanding Issues
List remaining defects, limitations, and deferred items in priority order.
G. Repository State
Give the branch, commit hashes, working-tree status, and preview deployment status.
H. Readiness Assessment
State whether the modified Team HQ is ready for real daily use, and identify any remaining critical blockers.
FINAL AUTONOMY DIRECTIVE
Treat this as an execution assignment, not a brainstorming request.
I am deliberately giving you a long, uninterrupted development session because I want meaningful progress without repeatedly intervening.
You have permission to make ordinary implementation decisions independently.
Do not stop to ask me which font, spacing value, icon, UI library, resizing approach, or minor layout option I prefer.
Use sound engineering judgment and the design direction above.
The application should become a beautiful, compact, premium, spatial workspace that is genuinely pleasant to use, not merely a conventional dashboard with some cosmetic changes.
The highest-level success criteria are:

* Minimal wasted screen space.
* A genuinely functional infinite canvas.
* Reliable zooming, panning, dragging, and resizing.
* Excellent project navigation.
* A significantly more compact Team Chat.
* Immediate live voice dictation.
* No unnecessary text truncation.
* Beautiful premium stony-grey visual styling.
* Refined project appearance controls.
* Simplified, logical settings.
* Reliable persistence.
* Thorough real-browser visual QA.
* No significant regressions.

Begin by inspecting the repository and establishing the baseline.
Then implement.
Continue through the phases autonomously.
Do not stop after producing a plan.
Do not stop after one successful commit.
Do not stop when an individual test passes.
Do not stop because context has been compacted.
Do not declare completion based on unverified assumptions.
Keep working through the entire available session until everything achievable is implemented, tested, visually reviewed, and documented.
If all requirements are completed before the available session ends, continue with regression testing, visual refinement, mobile usability, and performance optimization.
The outcome I want is a genuinely improved, demonstrably working Team HQ application.
START NOW.
