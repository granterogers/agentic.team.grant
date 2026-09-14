# Agentic Team Grant — Master UX QA Governance Prompt

> **Verbatim.** Grant supplied this on 14 September 2026 as
> `agentic_team_master_ux_qa_governance_updated.html`. The markup is converted;
> **every word is kept**, per CLAUDE.md's rule about requirements documents.
>
> **This is the canonical QA document** that §61 of it asks for. The concise
> standing rule it specifies is installed in CLAUDE.md under
> *"UX QA, in proportion to risk"*.
>
> Two notes for a future reader, neither a change to the text:
>
> - §11 lists `web/hq` as a surface to audit. **It was deleted in #68**
>   (ADR-0019) and `verify:design` fails if a second frontend reappears.
>   `web/studio` is the product. The instruction still reads correctly as
>   "audit the current equivalents".
> - §55's Issue list is explicitly not frozen — *"Newer Issues outrank it."*
>   The 14 September UX pass is #223 and its children #214–#222.

---

AGENTIC TEAM GRANT — MASTER UX QA GOVERNANCE PROMPT
Proportionate Routine QA + Full Deep Audit

TARGET REPOSITORY
granterogers/agentic.team.grant

PURPOSE

This prompt defines the enduring UX/frontend QA standard for Agentic Team Grant.

It is NOT an instruction to run the entire deep audit after every small UI edit.

It establishes TWO levels of QA:

LEVEL 1 — ROUTINE / CHANGE-AWARE UX QA
Run automatically whenever user-facing UI/UX changes.

LEVEL 2 — FULL UX QA
Run the complete deep audit only when:
- the owner explicitly asks for FULL UX QA / full UX audit / deep UX audit;
- the change has broad/shared blast radius;
- shared navigation/layout primitives change;
- global CSS/design tokens/themes change;
- accessibility infrastructure changes;
- conversation/communications architecture changes;
- auth/connections/credential flows change;
- browser QA tooling itself changes;
- a significant redesign lands;
- repeated regressions suggest scoped QA is insufficient;
- preparing for a major release or milestone.

The repository should enforce the master standard proportionately.

A minor local visual fix should not trigger a systems marathon.
A navigation rewrite should.

RULE:
DO THE SMALLEST QA THAT CAN CREDIBLY PROVE THE CHANGE IS GOOD.
ESCALATE ACCORDING TO BLAST RADIUS.
NEVER MARK USER-FACING WORK COMPLETE WITHOUT REAL BROWSER EVIDENCE.

==================================================
0. SHORT PERSISTENT RULE
==================================================

Whenever user-facing UI/UX code changes:

1. Identify affected surface(s).
2. Determine blast radius.
3. Run proportionate real-browser UX QA.
4. Inspect visually.
5. Exercise relevant interaction(s).
6. Check phone + desktop when applicable.
7. Check keyboard/accessibility when semantics/interactions change.
8. Check console/network when runtime behaviour changes.
9. Run relevant regression tests.
10. Fix defects.
11. Retest.
12. Create/update GitHub Issues for material unresolved defects.
13. Escalate to FULL UX QA only when scope/risk warrants it or the owner explicitly asks.

NO GRAPHICAL CHANGE IS COMPLETE SOLELY BECAUSE IT COMPILES, RENDERS, OR PASSES A STATIC CHECK.

==================================================
1. CURRENT CODE FIRST
==================================================

Do not blindly assume main is current.

Before serious QA inspect:

git status --short --branch
git branch --show-current
git log --all --decorate --oneline -30
git branch -a

Also inspect:
- active PRs
- recent Issues
- current worktree
- active development branch
- recent UX/testing commits

Do not QA an obsolete branch.
Do not destroy unrelated uncommitted work.
Current repo reality outranks this prompt.

==================================================
2. READ STANDING REPO RULES
==================================================

Read current equivalents of:
- CLAUDE.md
- docs/HANDOFF.md
- AI_TEAM_HQ_MASTER_SPEC.md
- docs/spec/frontend-build-prompt-2026-09-10.md
- docs/spec/project-dashboard-ia-2026-09-10.md
- relevant ADRs
- current frontend/UX/testing Issues

Persist requirements immediately.
GitHub Issues are durable project memory.

Anything material discovered but not repaired now gets a GitHub Issue.
Search first; do not duplicate.

==================================================
3. USE EXISTING QA STACK
==================================================

Discover current package.json scripts.

The repo has or has recently had equivalents of:

npm run smoke
npm run verify:ui
npm run verify:layouts
npm run verify:controls
npm run verify:wired
npm run verify:access
npm run verify:motion
npm run verify:offline
npm run verify:talk
npm run verify:hq
npm run shots
npm run probe
npm run wide
npm run space
npm run check:leaks

Use live equivalents.

Do not add a parallel browser QA stack without a concrete need.
Playwright remains the browser substrate.

==================================================
4. QA LEVELS
==================================================

LEVEL 1A — SMALL LOCAL VISUAL CHANGE

Examples:
- spacing
- one card style
- one icon
- one local empty state
- local typography/copy

Minimum:
- smoke/static checks
- render affected screen
- visually inspect
- relevant desktop or phone
- other device if responsive CSS can be affected
- no overflow on affected surface
- relevant interaction still works
- targeted accessibility if semantics changed
- targeted regression

Do not run full repo deep audit.

LEVEL 1B — INTERACTIVE FEATURE CHANGE

Examples:
- button behaviour
- form/dialog/sheet
- navigation
- composer
- project switcher
- command bar
- Settings control
- connection flow

Minimum:
- all Level 1A
- real browser interaction
- keyboard where relevant
- console/network
- relevant control audit
- desktop + phone if applicable
- failure/empty/degraded state where applicable
- relevant accessibility
- targeted regression

LEVEL 1C — SHARED FRONTEND CHANGE

Examples:
- shared primitive
- common card behaviour
- global rail/header
- shared responsive CSS
- theme/tokens
- modal system
- shared agent/project identity
- cross-screen navigation

Minimum:
- all Level 1B
- affected route sweep
- layout verification
- phone overflow scan
- representative screenshots
- both themes if theme-sensitive
- reduced motion if motion-sensitive
- broader browser regression

Escalate to FULL UX QA if blast radius is hard to bound.

LEVEL 2 — FULL UX QA

Run the complete deep audit below.

==================================================
5. DO NOT TURN MASTER QA INTO DAILY FRICTION
==================================================

This document is the constitution, not a mechanical per-edit checklist.

Future agents should select relevant sections for routine work.

But "proportionate" is NOT permission to skip the thing actually changed.

If modal changed: test open/close/focus/Escape.
If mobile composer changed: test mobile/safe area.
If connection form changed: test validation/error states.
If theme changed: inspect both themes.
If shared CSS changed: broaden route sweep.

==================================================
6. FULL UX QA HAS TWO SUBJECTS
==================================================

A. PRODUCT — does it work and feel excellent?
B. QA HARNESS — would current QA catch meaningful failures?

A green script is evidence only if coverage is trustworthy.

==================================================
7. CONTROL AUDIT MUST REPORT COVERAGE
==================================================

Do not accept verify:controls only because exit code is green.

Record:
- controls discovered
- pressed
- skipped
- deliberately excluded
- unreachable
- unpressable
- routes covered
- Settings coverage
- desktop coverage
- phone coverage

Critical surfaces require:
ZERO UNEXPLAINED SKIPS.

Inspect current Issue #183 or successor if still relevant.
Do not add blanket exclusions to make numbers look clean.

==================================================
8. AUDIT STATE MUST NOT POLLUTE NEXT CONTROL
==================================================

A click can leave:
- open sheet
- menu
- command bar
- overlay
- focus trap
- transition
- changed route state

Reset/dismiss as needed between independent control checks.

==================================================
9. PROVE IMPORTANT DETECTORS CAN FAIL
==================================================

When writing/repairing important checks:

1. reproduce/simulate bad state
2. confirm red
3. restore/fix
4. confirm green

Do not commit deliberate defects.

==================================================
10. REAL BROWSER INTERACTION
==================================================

Click.
Type.
Tab.
Enter.
Space.
Escape.
Open.
Close.
Navigate.
Reload.
Resize.
Scroll.
Drag where applicable.
Switch project.
Switch theme.
Open Settings.
Trigger empty/error/degraded states.

Do not infer behaviour from source alone.

==================================================
11. TEST ACTUAL USER SURFACES
==================================================

Audit current equivalents of:
- web/studio
- web/hq

Know:
- exact URL/file
- deployed equivalent
- auth state
- data source
- permissions

Testing a non-deployed prototype does not prove production UX.

==================================================
12. COMMUNICATION UX IS PART OF UX
==================================================

Agentic Team is experienced through:
- web
- Telegram
- Slack
- voice

FULL UX QA includes representative communication presentation and interaction where safe.

==================================================
13. HUMAN MESSAGING STANDARD
==================================================

Messages should feel like a person, not:
- database output
- a form
- debug log
- internal schema
- AI template

Inspect representative Slack and Telegram messages.

Check:
- redundant sender labels
- repeated project name
- raw slugs
- database jargon
- excessive metadata
- overly technical confidence/evidence phrasing
- giant button stacks
- internal terminology

Use human project names in human-facing output.

==================================================
14. PROVENANCE: HONEST BUT NOT FURNITURE
==================================================

ROUTINE REPLY
- acknowledgement
- greeting
- simple confirmation
May not need visible provenance.

FINDING / CLAIM
- database result
- research result
- document-grounded claim
- inference
Must preserve current evidence/provenance policy.

If More detail exists, verify it exposes full provenance.

Goal:
human first surface + honesty where it matters.

==================================================
15. PHONE MESSAGE DENSITY
==================================================

Inspect communication on phone.

A short reply should not consume most of a screen because of:
- duplicate identity
- repeated project title
- full-width action buttons
- verbose footers
- unnecessary labels

==================================================
16. CREDENTIAL ENTRY IS UX + SECURITY
==================================================

Test credential forms with SYNTHETIC, NON-SECRET values shaped like realistic credentials.

Check:
- whitespace
- pasted newline
- zero-width chars
- case where appropriate
- valid-shaped token
- malformed token
- valid-shaped secret
- wrong field order if safely distinguishable
- clear safe error feedback

Never print live credentials or leak them into screenshots/issues/traces.

A form that falsely rejects realistic valid-shaped input is a UX-security defect.

==================================================
17. PROJECT IDENTITY ACROSS SURFACES
==================================================

The same project should have one human identity across:
- dashboard
- Slack
- Telegram
- search
- conversation
- outputs
- notifications
- links

Do not expose slug/connector refs as if they were user-facing names.

==================================================
18. CONVERSATION UX
==================================================

Inspect live Phase 7 communications Issues/code.

Conversation QA includes:
- history
- project scope
- one agent
- selected agents
- whole team
- addressee visibility
- context attachments
- composer
- drafts
- live updates
- voice dictation
- Slack sync
- Telegram sync
- dedupe
- loop prevention
- error state
- search/history
- mobile behaviour

==================================================
19. MOBILE CONVERSATION / IPHONE
==================================================

Use touch-capable device emulation.

Verify:
- composer visible
- safe-area insets
- home-indicator clearance
- bottom-nav interaction
- latest message visibility
- draft persistence
- send usability
- multiline input
- long reply
- addressee picker
- no horizontal overflow
- input font >=16px
- coarse-pointer touch targets >=44px where applicable

==================================================
20. TOUCH IS NOT WIDTH
==================================================

A 390px desktop viewport with mouse is not an iPhone.

Use hasTouch / coarse-pointer semantics appropriately.

==================================================
21. FIXED-POSITION CONTAINING-BLOCK TRAP
==================================================

Remember:
backdrop-filter
filter
transform
perspective
will-change

can affect fixed descendants.

Inspect actual containing blocks before patching mobile offsets.

==================================================
22. MOBILE SPACE / COMPOSITION
==================================================

Use npm run space or current equivalent.

Measure:
- first useful content pixel
- project header
- tab/header furniture
- fixed bars
- duplicated controls

Known risk:
most of first phone screen becomes furniture.

Do not solve this only by shrinking everything.
It is a composition problem.

==================================================
23. HORIZONTAL OVERFLOW
==================================================

Use npm run wide/current equivalent.

Identify actual offending element.

If SVG/canvas elements are filtered, inspect those manually where relevant.

==================================================
24. USE PROBE, NOT CSS GUESSING
==================================================

When layout looks wrong:
npm run probe -- '<selector>'

After one failed styling guess, measure.

==================================================
25. ACCESSIBILITY
==================================================

Use current verify:access/axe infrastructure.

Test:
- accessible names
- landmarks
- main
- keyboard reachability
- focus visibility
- focus order
- dialogs
- focus return
- keyboard traps
- live regions
- form labels/errors
- contrast
- reduced motion
- touch targets
- dynamic updates

==================================================
26. SEMANTIC ACCESSIBILITY MUST BE USEFUL
==================================================

A screen with one h1 can pass "no heading skips" while still being useless to heading navigation.

Inspect current Issue #207 or successor.

Visible section headings should use appropriate semantic headings.
The audible hierarchy should match visible hierarchy.

After semantic tag changes:
- capture before/after
- verify typography
- rerun accessibility
- rerun visual QA

==================================================
27. CONVERSATION ACCESSIBILITY
==================================================

Check:
- meaningful new-message announcement
- typing indicator not spammy
- author/addressee exposed non-visually
- timestamps appropriate
- dictation state named
- send retains sensible focus
- open/close restores focus
- message actions keyboard reachable

==================================================
28. KEYBOARD QA
==================================================

For affected interactive work or FULL QA, run keyboard-only journeys.

Use:
Tab
Shift+Tab
Enter
Space
Escape
arrows where relevant

Mouse QA is not keyboard QA.

==================================================
29. REDUCED MOTION
==================================================

Use current verify:motion where relevant.

Under prefers-reduced-motion:
- essential meaning survives
- persistent loops stop/reduce
- still state remains intentionally designed

==================================================
30. LOADING / OFFLINE / STALE / REFUSED
==================================================

Different states must remain distinct:
- loading
- prototype/demo
- unreachable
- stale
- refused
- disconnected
- never connected
- connected but empty
- degraded provider
- blocked
- waiting for Grant

Do not collapse them into one generic empty state.

==================================================
31. EMPTY STATES
==================================================

Where useful:
1. what team can do
2. what Grant can do manually

Prefer team path when genuinely capable.
Do not add fake/dead automation CTAs.

==================================================
32. SETTINGS IS CRITICAL
==================================================

Do not omit Settings.

Test current panes and connection/destructive/error states.

==================================================
33. TEST FIXTURE / USER-DATA SEPARATION
==================================================

Tests must not contaminate:
- real projects
- real documents
- Notion
- Slack
- Telegram
- lessons/governance
- job queue
- real notifications

==================================================
34. FIXTURE POLICY DEPENDS ON WHAT IS FILTERED
==================================================

If production code deliberately excludes fixtures:
use isolated real test subjects if needed, tear down, assert cleanup.

Otherwise use fixture naming and purge safely.

Ask:
DOES THE THING UNDER TEST FILTER FIXTURES?

==================================================
35. TEARDOWN IS PART OF THE TEST
==================================================

For persistent/external test state:
1. clear stale fixture state safely
2. create unique test state
3. exercise
4. clean up
5. assert cleanup matched
6. assert residue gone

==================================================
36. LEAK DETECTION
==================================================

Use npm run check:leaks/current equivalent in FULL QA and persistent-provider tests.

Do not delete real/historical data merely to make leak checks green.

==================================================
37. SUITE ORDER INDEPENDENCE
==================================================

FULL QA should detect order dependence in important suites, especially queue-claiming paths.

A suite that only passes after purge/retry may be flaky, not fixed.

==================================================
38. TIMEOUT IS NOT ASSERTION FAILURE
==================================================

Distinguish:
- assertion failure
- process timeout
- network stall
- killed worker
- suite exceeding harness budget

Do not report timeout as product defect without evidence.

==================================================
39. DEPLOY COLD START
==================================================

If deploy QA is involved, inspect current #189/successor.

Bounded retry/warmup may be valid only for transient 502/503/504.

Do not retry wrong 200 bodies, auth failures, CORS failures, or semantic failures.

==================================================
40. BROWSER CORS MUST BE BROWSER CORS
==================================================

Server-side fetch does not prove browser CORS.

Where relevant verify actual browser origin/preflight behaviour.

==================================================
41. VISUAL STANDARD — WOW GATE
==================================================

Ask:
If all data were fake, would this still feel unusually beautiful, sophisticated, tactile and memorable?

Inspect:
- focal point
- composition
- scale contrast
- project identity
- agent identity
- depth
- shadows
- embossing
- glass
- texture
- typography
- hierarchy
- spacing
- dark design
- bespoke visual moments
- empty/loading craft
- motion
- feedback

"Clean" and "professional" are not the target ceiling.

==================================================
42. OPEN SCREENSHOTS
==================================================

Use npm run shots/current equivalent.

Generate representative desktop/phone/light/dark captures.

Then actually open them.

Generating PNGs is not visual QA.

==================================================
43. VISUAL REGRESSION
==================================================

Use current baseline system if present.

Do not blindly update baselines.

Inspect expected/actual/diff.

==================================================
44. DARK MODE IS ITS OWN DESIGN
==================================================

Inspect dark separately:
- hierarchy
- depth
- glow
- colours
- surfaces
- focus
- glass
- typography

==================================================
45. FONT LOADING
==================================================

Verify intended self-hosted fonts loaded before judging typography.

==================================================
46. COMMAND BAR / SEARCH
==================================================

Where affected or in FULL QA test:
- shortcut
- input
- ranking
- navigation
- Ask-team fallback
- no-result state
- keyboard selection
- mouse selection
- Escape
- duplicate-listener prevention

==================================================
47. CROSS-INTERFACE EQUIVALENCE
==================================================

Equivalent intent through web/Slack/Telegram/voice should reach same canonical system.

Check:
- project
- intent
- job semantics
- history
- no duplicate
- no loop
- no adapter-specific business logic

Adapters translate. They do not decide.

==================================================
48. PROJECT ISOLATION
==================================================

Use at least two projects for project-scoped isolation checks.

Prove one cannot surface another's:
conversation, documents, tasks, outputs, contacts, channel mapping, context.

==================================================
49. STATE TRUTHFULNESS
==================================================

Distinguish:
unknown
unavailable
disconnected
degraded
empty
blocked
working
completed
failed

Do not turn unknown into healthy.
Do not call something revoked unless provider confirms it.
Do not call prototype output real.

==================================================
50. NO DEAD OR LYING CONTROLS
==================================================

Every prominent control must:
- act
- truthfully explain why unavailable
- or not exist

A control that claims success while doing nothing is critical.

==================================================
51. DO NOT RE-ENABLE ROUTINE GITHUB ACTIONS
==================================================

Respect the repo's no-routine-Actions policy.

Run QA in the authoring session.
Manual workflow_dispatch may remain where intended.

==================================================
52. AUTONOMOUS REPAIR
==================================================

When safe:

observe
→ reproduce
→ find/create Issue
→ fix
→ targeted tests
→ real browser
→ visual inspection
→ accessibility where relevant
→ regression
→ leak check where relevant
→ Issue update
→ retest

==================================================
53. REGRESSION TEST THE PROPERTY
==================================================

Bug fixed = meaningful regression where practical.

Test user-visible property, not exact wording/mechanism.

==================================================
54. DO NOT CHANGE PRODUCT TO SATISFY A BROKEN TEST
==================================================

If test and intended product behaviour disagree:
determine which is wrong.

Do not weaken production safety properties for stale fixture tests.

==================================================
55. IMPORTANT CURRENT ISSUE FAMILIES
==================================================

Search live Issues first.

Recent/current UX-QA families include:
- #41 deep E2E
- #45 test debris
- #75 UX review
- #121 keyboard
- #138 aesthetics
- #164–#168 visual craft
- #178 Notion fixture leakage
- #179 missed touch targets
- #180 control false positives / Settings gap
- #181 fixture contamination in lessons
- #183 desktop control blind spot
- #184 suite order dependence
- #186 Slack human UX
- #187 project Slack identity
- #188 mobile first-screen furniture
- #189 cold-start deploy probe
- #191–#202 communications programme
- #207 semantic headings
- #208 Telegram human/personable UX
- #213 credential-entry UX/security

This list is not frozen.
Newer Issues outrank it.

==================================================
56. "COULD NOT TEST" IS A REAL RESULT
==================================================

Report:
- what
- why
- missing dependency
- risk
- Issue

Never silently convert untested into PASS.

==================================================
57. ROUTINE QA REPORT
==================================================

For normal UI changes report compactly:

QA LEVEL: 1A / 1B / 1C
AFFECTED SURFACES:
BROWSER/DEVICE:
INTERACTION VERIFIED:
VISUAL INSPECTION:
ACCESSIBILITY:
CONSOLE/NETWORK:
REGRESSION:
ISSUES CREATED/UPDATED:
RESULT: PASS / PASS WITH WARNINGS / FAIL

Do not emit a giant report for a tiny local change.

==================================================
58. FULL UX QA REPORT
==================================================

For Level 2 finish with:

UX QA PASS
or
UX QA PASS WITH WARNINGS
or
UX QA FAIL

Include:

PRODUCT COVERAGE
desktop:
phone:
light:
dark:
studio:
hq:
Telegram:
Slack:
voice:

QA HARNESS COVERAGE
controls discovered:
controls pressed:
controls skipped:
controls unexplained:
routes:
settings:
accessibility:
motion:
offline:
leak check:
visual captures reviewed:

COULD NOT TEST:
...

For unresolved items:
Issue
severity
surface
reproduction
impact
blocker
evidence

==================================================
59. WHEN OWNER SAYS "RUN UX QA"
==================================================

Interpret ordinary requests like:
"run UX QA"
"check the UX"
"QA these UI changes"

as CHANGE-AWARE / PROPORTIONATE QA by default.

Steps:
1. inspect diff/current issue/recent commits
2. determine affected surfaces
3. select Level 1A, 1B or 1C
4. run targeted QA
5. fix
6. retest
7. create/update Issues
8. report concise result

DO NOT automatically run full deep audit.

==================================================
60. WHEN OWNER SAYS "RUN FULL UX QA"
==================================================

Interpret:
"run full UX QA"
"deep UX audit"
"full frontend audit"
"bulletproof the UX"
"run the master QA"

as Level 2.

Then run broad browser, accessibility, keyboard, mobile, overflow, composition, screenshots, communications, Settings, degraded states, harness audit, leak checks, suite reliability, repairs, regressions, GitHub persistence.

==================================================
61. PERSISTENT REPOSITORY RULE
==================================================

If installing this prompt into the repo:

Keep one canonical QA document.

Add a concise standing rule to CLAUDE.md / relevant repo instructions:

"Whenever user-facing UI/UX changes, automatically run proportionate real-browser UX QA against the affected surfaces using the master UX QA standard. Escalate by blast radius. Do not run the full deep audit for every small change. Run FULL UX QA when explicitly requested or when shared/high-risk changes make scoped verification insufficient. No UI work is complete without rendered, interacted-with and visually inspected evidence."

==================================================
MOST IMPORTANT PRINCIPLE
==================================================

Do not trust source code.
Do not trust a screenshot you did not open.
Do not trust a green suite that skipped important controls.
Do not trust a technically true but practically useless accessibility assertion.
Do not trust a phone viewport that still has a mouse.
Do not trust teardown without proof.
Do not trust a test that polluted the user's real workspace.
Do not trust retry as a substitute for diagnosis.
Do not trust server-side fetch as proof of browser CORS.
Do not trust internal project slugs as human output.
Do not trust a secret-entry form that pushes users toward pasting secrets into chat.
Do not trust "professional" as proof of visual excellence.

And equally:

Do not run a two-hour deep audit because someone moved a button four pixels.

TEST IN PROPORTION TO RISK.

The objective is not maximal test volume.

The objective is maximal confidence per unit of effort.

For small UI changes:
target precisely.

For shared/high-risk UI changes:
broaden aggressively.

For FULL UX QA:
challenge the whole product and the harness that protects it.

THE END STATE:

THE AGENTIC TEAM FEELS EXCELLENT TO USE, WORKS ACROSS DESKTOP AND PHONE, REMAINS ACCESSIBLE, HUMAN AND TRUTHFUL, DOES NOT POLLUTE OR ENDANGER REAL USER DATA, AND IS VERIFIED BY A QA PROCESS THAT IS THOROUGH WHEN IT NEEDS TO BE WITHOUT BECOMING DAILY DEVELOPMENT FRICTION.
