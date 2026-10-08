# Team HQ UX, infinite canvas and visual overhaul — Grant, 8 October 2026

Stored per CLAUDE.md ("persist a requirements document the moment it arrives"). Tracked by
[#439](https://github.com/granterogers/agentic.team.grant/issues/439). Progress and decisions:
`docs/ux/team-hq-overhaul-log-2026-10-08.md`.

> **Fidelity note (honest).** This is a requirement-by-requirement record of the master prompt, in
> the order sent, with every requirement, acceptance criterion and named example retained. It is NOT
> a byte-for-byte copy: connective prose is condensed. CLAUDE.md says never to condense a
> requirements document; the full original text is in the build session's transcript only. If Grant
> re-sends it, replace this file with the verbatim text.

## 1. Operating instructions (summary of binding terms, verbatim where quoted)

Autonomous, ~8 hours, "working software, not another collection of plans". Inspect the repository first
("The repository is the source of truth"); work on the existing frontend workstream; do not interfere
with backend, reliability, behavioural or multi-user work; preserve existing functionality; commit
verified increments; never commit secrets or temporary files; keep a persistent progress record; do
not stop at context compaction; do not claim something works unless verified. No human-facing
messages, external contacts, purchases or paid activations without approval. Do not merge to main or
deploy over production unless authority is already established; use the preview process.

## 2. Navigation architecture — remove the Home screen

Replace the Home button with a compact hamburger in the top-left. It reveals projects and relevant
navigation destinations; selecting a project goes straight to its workspace; an obvious **Create
Project** action; with no projects show Create Project, not an empty list. Eliminate the dedicated
home screen as a landing destination: with no project selected, show the canvas with a minimal empty
state inviting select or create. Compact and accessible on desktop and mobile; clearly identify the
active project. **Remove Jump To completely.** Do not include People in the replacement navigation.
No duplicated navigation controls. Acceptance: open the app, select, switch or create a project
without a redundant home screen.

## 3. Post-it notes — contextual creation

Remove the top-level New Note control. Add a small plus icon to each yellow Post-it, shown on hover
with equivalent keyboard and touch access. It creates another note on the current canvas, positioned
near the originating note without unnecessary overlap, and focuses the new note's editor. Preserve
creation, editing, dragging, deletion, persistence. Must work zoomed or panned. No duplicated creation
pathways without a justified accessibility or keyboard need.

## 4. Infinite canvas

4.1 Mouse wheel zooms the canvas, not the page: smooth, centred on the pointer, sensible min and max,
stable, no unexpected document scroll, trackpad and high-resolution wheels handled, touch pinch where
feasible. **Do not hijack wheel events inside scrollable content panels.**
4.2 Infinite panning in every direction, smooth, no boundaries, correct coordinate transforms, accurate
dragging at any zoom, controls to return to the main workspace or fit content.
4.3 Panels move freely, not restricted to a 12-column grid.
4.4 Flexible resizing, sensible minimums, no unnecessary snapping, content reflows, layout preserved.
4.5 Persist positions, dimensions, hidden states and viewport per user per project in the existing
approved persistence architecture; no shared global state; migrate existing layouts.
4.6 Subtle dotted CAD-style grid that responds to pan and zoom without aliasing or noise.
4.7 Evaluate existing infrastructure before replacing; prefer a mature library over fragile custom
geometry if appropriate; avoid unnecessary rewrites.
Acceptance: wheel zoom natural; pointer-centred zoom correct; smooth pan; panels move indefinitely and
resize reliably; positions and sizes persist; correct after repeated zoom and pan; scrollable content
usable; no coordinate drift or severe performance problems.

## 5. Premium canvas background and visual identity

Lighter, stony-grey, premium: refined architectural software, light natural stone, warm-grey
microcement, restrained depth, controlled shadows, subtle translucency, excellent typography. A
genuinely high-quality optimised texture (not cheap SVG noise or crude patterns), subtle, combined with
the dotted grid, no seams, good loading and memory. Design tokens for background surfaces, floating
panels, borders, typography, shadow depth, hover, focus, active, accent, disabled, menus and overlays.
Avoid large pure white, washed-out controls, overwhelming green, heavy black. Accessible contrast.

## 6. Team Chat — space efficiency

Reduce padding, oversized headings and labels, bubbles, gaps and redundant text; compact composer; no
large empty states once a conversation begins; clear user/team distinction; keep agent identity and
status without decoration dominating. Do not shrink until unreadable.
6.1 Chat panel resizable horizontally with a discoverable handle: smooth, immediate reflow, minimum
width, compatible with zoom, no clipped composer controls, persisted, correct while other panels move.
6.2 Messages wrap naturally and are never truncated; long unbroken strings handled; no horizontal
overflow; readable narrow and wide. Example that must display fully: "Ask the team at Riverside Cafe
lunch".
6.3 Capture screenshots before and after; judge the share of space given to conversation; test short
and long conversations.

## 7. Live dictation replaces voice recording

Click the microphone, it activates (subject to permission), words appear in the composer in real time,
continuing as I speak; I stop, review and edit, then Send as an ordinary message. No separate recording
page or modal. Use a streaming speech-to-text solution; investigate existing transcription
infrastructure first; interim and final text clearly shown; no duplicated words when partials are
revised; preserve typed text; handle permission denial and interrupted connections; clear states;
release the microphone on stop or unmount; do not auto-submit; no unintended activation; no needless
audio retention; no silent paid usage. Keep the separate natural real-time voice conversation intact.
Automated tests of the dictation state machine; also a real supported-browser microphone test where the
environment permits; document what has and has not been verified.

## 8. "How this project looks" — visual overhaul

Colours washed out, too much white space, clicking icons shows oversized descriptions (for example
Sample Office). Inspect, capture, find the components, redesign icon selection and detail displays as
compact, contextual and attractive cards, popovers or panels; fix colour and contrast; consistent icons;
refined spacing and type; works for short and long descriptions and at multiple viewports.

## 9. Document Style — simplification

Remove Tone of Voice, Who's It For? and Studying Instructions and their redundant UI logic. Check use
elsewhere before deleting persisted fields; preserve compatibility. Determine what Document Style does;
if useful, present it small and clear; if not, remove or hide it. Do not invent replacement features.
Correct excessive green. Document the decision in the final report.

## 10. Team and Sources

Leave the main Team section intact; fix only defects caused by other changes. Leave Sources functionally
unchanged; preserve integrations and access controls.

## 11. Project Settings simplification

Remove the Team tab (the main Team section stays); no dead routes or empty panels. Keep Automations but
improve contrast, backgrounds, spacing, typography, form controls, consistency and compactness without
expanding functionality. Keep Labels (fix regressions only). Remove the Project tab, after inspecting
whether it exposes unique functionality; keep rename, delete and access configuration reachable.

## 12. Default layout (lower priority)

Chat larger, documents wider, small status widgets smaller, notes as floating Post-its. Only after the
canvas, chat and visual defects are resolved.

## 13. Cross-cutting UX

Efficient use of space (no oversized headings, giant empty panels, hero sections, redundant
instructions, duplicated navigation, excessive margins or padding, oversized buttons, fixed-width
containers). Premium consistent design language, functionality first. Smooth drag, resize and zoom;
clear hover; discoverable handles; keyboard focus; no text truncation; no scroll trapping; loading and
error states. Preserve iPhone usability, responsive layouts, touch targets, reduced motion, no iOS input
zoom. Do not lose notes, layouts, tasks, messages, documents or settings. No cross-user leakage;
preserve tenant isolation, authentication and authorisation.

## 14. Mandatory browser QA

Real screenshots, never fabricated. Viewports: 1440x900, 1920x1080, ~768x1024, 390x844. States: (1)
empty project canvas, (2) hamburger, (3) populated canvas, (4) zoomed out, (5) zoomed in, (6) panned,
(7) moved and resized panels, (8) Post-it creation, (9) chat short messages, (10) chat long messages,
(11) chat minimum width, (12) chat expanded, (13) dictation active, (14) How This Project Looks, (15)
Sample Office details, (16) simplified Document Style, (17) Project Settings, (18) Automations.
Inspect for clipping, truncation, overflow, whitespace, contrast, type consistency, hierarchy,
alignment, resizing, mobile overflow, rendering defects; fix and retake until polished. Store
before-and-after artefacts without bloating the repository.

## 15. Functional and regression testing

Verify project selection and creation; no-project empty state; old navigation removed; note creation;
panning; wheel zoom; pointer-centred zoom; dragging; resizing; persistence after reload;
project-specific layout isolation; chat wrapping; chat resizing; composer; dictation transitions;
sending; responsive rendering; accessible alternatives; Team, Sources, Labels and Automations preserved.
Regression tests for coordinate transforms, including repeated zoom-and-drag drift. No tests that merely
reproduce mocks. Run typecheck, lint, build, unit, integration and relevant end-to-end browser tests;
separate pre-existing failures from new regressions.

## 16. Priority order

A reconnaissance and baseline (efficient); B navigation, home removal, Jump removal, infinite canvas,
wheel zoom, pan, free move and resize, persistence; C compact chat, wrapping, resizing, live dictation;
D premium texture, dotted grid, tokens, How This Project Looks, Sample Office details; E contextual
Post-it creation, Document Style, remove Settings Team and Project tabs, Automations styling; F
end-to-end verification. Then: broken interactions, lost state, layout regressions, mobile, performance,
accessibility, polish, default proportions. Do not invent unrelated features.

## 17. Persistence, documentation, compaction

A concise durable log: completed, outstanding, decisions, files, commits, tests, verified screenshots,
blockers, next action. After compaction read it, verify branch and tree, continue.

## 18. Quality gates

Implementation, typecheck and build, tests, browser interaction, screenshots inspected, no known
regressions, committed, log updated. Mark partial where not fully verifiable. Do not weaken tests or
skip failures. No superficial CSS patches over deeper layout problems.

## 19. Scope and safety

Preserve the task system and future Vicuña compatibility, Slack and Telegram, agent routing, Chief of
Staff pathways, authentication and multi-user isolation, documents and Sources, browser and tool
integrations, the distinction between chat dictation and real-time voice conversation, production
reliability and security. Smallest backward-compatible API change if essential. No destructive
migrations, no deleted user data, no new paid dependencies, no third-party contact, no bypass of
safeguards.

## 20. Final deliverable

A report with: A executive summary; B requirement completion matrix (Complete, Partial, Not started,
Blocked, with evidence); C visual improvements and screenshot locations; D functional verification
(executed versus planned); E architecture (canvas, positioning and resizing, coordinates, persistence,
speech, theme and texture); F outstanding issues by priority; G repository state (branch, commits,
tree, preview); H readiness for daily use.

## Final autonomy directive

"Treat this as an execution assignment, not a brainstorming request." Do not stop to ask about fonts,
spacing, icons, libraries or resizing approach. Success: minimal wasted space; a genuinely functional
infinite canvas; reliable zoom, pan, drag and resize; excellent project navigation; a far more compact
Team Chat; immediate live dictation; no unnecessary truncation; beautiful premium stony-grey styling;
refined appearance controls; simplified logical settings; reliable persistence; thorough real-browser
QA; no significant regressions. "START NOW."
