# MASTER CONTINUATION PROMPT — BASECAMP FRONTEND: USER REVIEW + INTEGRATION CLEANUP

**Stored verbatim, 23 September 2026.** Grant's words, unedited. CLAUDE.md:
*"Never condense a requirements document... Convert the markup, keep every word.
If you are writing 'the gist is', stop."* A specification has already been lost
to a compaction once; this file is why it cannot happen again.

Branch: `claude/basecamp-team-hq`. **DO NOT MERGE.**
This prompt supersedes earlier instructions where they conflict.

---

MASTER CONTINUATION PROMPT
BASECAMP FRONTEND — USER REVIEW + INTEGRATION CLEANUP

Continue on:

claude/basecamp-team-hq

DO NOT MERGE.

This prompt supersedes earlier instructions where they conflict.

============================================================
0. PERSIST THIS MISSION BEFORE DOING ANYTHING
============================================================

Before implementation:

1. Save this entire mission into a durable repository document, for example:

docs/basecamp/MISSION-2026-09-23-user-review-integration.md

2. Update the existing autonomous/run ledger to reference it.

3. Create a checklist containing EVERY numbered requirement below.

4. After any context compaction/restart, reread:
   - this mission document
   - the run ledger
   - CLAUDE.md
   - relevant existing Basecamp mission/acceptance documents

Do not rely on chat history to remember the mission.

Every requirement must finish in one of these states:

DONE
VERIFIED
BLOCKED — with precise reason
DEFERRED BY GRANT

Never silently drop an item.

============================================================
1. CURRENT STATE
============================================================

Important established state:

- Chromium public HTTPS access has been fixed correctly.
- The sandbox proxy CA is now installed into Chromium's NSS store.
- TLS verification remains enabled.
- Invalid/expired/self-signed/wrong-host certificates remain rejected.
- `verify:basecamp-live` can now drive the real deployed Vercel application against the real office.
- This live deployed-browser path should now be preferred whenever a claim depends upon:

browser
-> deployed application
-> authentication
-> CORS
-> real office/backend

Stable experimental application:

https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app

Do not merge.

Do not replace default Team HQ.

Keep `/basecamp` isolated.

2. USER REVIEW — AUTHENTICATION / TOKEN EXPERIENCE

> **SUPERSEDED IN PART, 24 September 2026 (overnight correction). Read the
> correction FIRST; the original text below it is kept verbatim because it is
> still the record of the complaint, but its remedy is no longer acceptable.**
>
> ---
>
> ### THE CORRECTION, in Grant's words
>
> ```
> STOP developing the new Telegram office-token approval flow.
>
> This is NOT what Grant asked for.
>
> Grant did not ask to replace:
>
> "Paste the office token"
>
> with:
>
> "Approve an office token through Telegram."
>
> He does not want an office-token interaction in the normal user experience
> AT ALL.
>
> The intended experience is:
>
> OPEN AGENTIC TEAM
> -> APPLICATION LOADS
> -> USER IS AUTHENTICATED
> -> USE APPLICATION
>
> If an internal credential/token is required for secure communication with
> the office, that is an IMPLEMENTATION DETAIL.
>
> The normal user should not:
>
> - see an office token
> - paste an office token
> - copy an office token
> - receive an office token
> - approve an office token through Telegram
> - enter a pairing code
> - understand what an office token is
> - repeatedly authorize their own browser
>
> Do not improve the office-token UX.
>
> REMOVE OFFICE-TOKEN HANDLING FROM THE NORMAL UX.
> ```
>
> Further, verbatim:
>
> ```
> Prefer the application's existing canonical identity/session mechanism.
> Do NOT invent another parallel authentication system if one already exists.
> If the Basecamp frontend is failing to inherit the real application session,
> integrate it correctly.
>
> A returning authenticated user should normally experience:
> open app -> session restored -> project loads
> No token ceremony. No Telegram ceremony. No pairing ceremony.
>
> Do NOT solve this by: embedding privileged secrets in frontend JavaScript;
> shipping the office token in static assets; making a secret publicly
> readable; hardcoding credentials; disabling authorization; weakening RLS;
> opening privileged endpoints anonymously; broadening CORS indiscriminately;
> bypassing origin restrictions; storing privileged secrets insecurely;
> accepting arbitrary fake tokens; trusting browser-provided identity without
> verification.
>
> The backend authorization boundary must remain real.
> Authentication should become INVISIBLE, not nonexistent.
>
> If a new user genuinely needs to LOG IN to the product, that is different
> from asking them for an internal office token. Use the product's proper
> authentication experience. Do not disguise an internal token exchange as
> login.
> ```
>
> **Acceptance is a CLEAN BROWSER, not the one that already holds a
> credential**: an existing authenticated session, a clean context, a refresh,
> and a new context. And the abandoned pairing work is to be removed cleanly —
> no dead endpoints, tables, UI, polling, secrets, tests or documentation —
> after tracing callers.
>
> **The architectural conclusion reached on the correction is recorded in
> `docs/adr/` so a compaction cannot resurrect the wrong design.** Anything in
> the text below that implies Telegram approval is an acceptable final answer
> is void.
>
> ---
>
> ### The original §2, verbatim, as the record of the complaint
2. USER REVIEW — AUTHENTICATION / TOKEN EXPERIENCE
============================================================

Remove the unexpected browser sign-in / office-token requirement from the normal UI flow.

Grant did NOT ask for:

"Paste the office token"

as a normal sign-in experience.

It currently causes failures such as:

"Couldn't reach the office — browser's not signed in."

and:

"Read only — no token in this browser."

It has interfered with:

- Chat
- Voice
- Project appearance
- Settings
- write actions

Fix the UNDERLYING authentication/session architecture.

Do NOT merely hide the warning.

The normal intended signed-in user journey should obtain/use the appropriate authenticated office session without requiring Grant to manually paste an internal token.

After fixing, verify from the deployed browser:

- Chat reads
- Chat writes
- voice credential mint
- project settings writes
- appearance writes
- To-do mutation
- other representative write operations

Refresh and prove the session still behaves correctly.

Do not weaken authentication.

Do not expose secrets.

============================================================
3. TWO VOICE FEATURES STILL EXIST
============================================================

Preserve the distinction:

A. CHAT MICROPHONE
=
asynchronous voice note

record
-> stop
-> preview/play
-> transcribe
-> send through canonical Chat
-> team responds normally

B. PROJECT/TOP MICROPHONE
=
live natural OpenAI Realtime conversation

These remain separate features.

============================================================
4. SIMPLIFY LIVE VOICE UI
============================================================

Grant has now reviewed the interface and wants the live microphone substantially simpler.

Clicking the TOP/PROJECT microphone must NOT:

- open a window
- open a panel
- open a modal
- open a drawer
- show a transcript surface
- rearrange the project
- navigate away

The existing project screen should remain visually unchanged.

Interaction:

press microphone
-> icon changes state
-> connection establishes
-> icon makes READY/LISTENING state obvious
-> Grant talks
-> team responds audibly
-> conversation flows

Represent states through restrained treatment of the microphone itself.

Possible states include:

idle
connecting
ready/listening
Grant speaking
team thinking
team speaking
muted/error

Do this through subtle:

- colour
- glow
- animation
- pulse
- icon treatment
- tooltip/accessibility text where useful

Do NOT create another interface surface.

The experience should feel like:

PRESS MIC AND TALK.

============================================================
5. PHYSICAL LIVE VOICE REMAINS UNVERIFIED
============================================================

Do not claim physical voice acceptance until a human has actually:

pressed microphone
-> spoken through physical microphone
-> OpenAI/team heard speech
-> team responded
-> audible response came from speakers
-> second conversational turn worked

Grant will perform this later.

Keep:

PHYSICAL LIVE VOICE ACCEPTANCE — PENDING

Do not simulate it into a pass.

Everything else technically testable should still be verified.

============================================================
6. MINIMIZED TO-DOS — ALIGNMENT
============================================================

Task titles currently begin at inconsistent horizontal positions.

Fix the miniature To-dos layout.

Establish a consistent text start position.

Checkbox/icon widths and spacing must be consistent.

Every title should align cleanly with those above/below it.

The result should look intentionally grid-aligned.

============================================================
7. MINIMIZED TO-DOS — DO NOT REORDER ON COMPLETE
============================================================

Currently ticking a To-do can move it.

Do not do that.

Completion should:

- update visual state
- update canonical backend state
- update counts

but retain the task's position.

Verify:

tick
-> task remains same position
-> completed appearance
-> backend state changed
-> refresh
-> task remains correctly represented

Then restore test data.

============================================================
8. MINIMIZED CARD TABLE — STUCK
============================================================

Current defect:

dragging a card into `Stuck` can open the card/task editor instead of simply dropping it.

Fix event semantics.

`Stuck` must behave like the other columns.

DRAG
-> DROP INTO STUCK
-> STATE CHANGES
-> NO CARD OPEN

Do not allow drag-end/click propagation to trigger open/edit.

Add a specific regression:

drag card
-> Stuck
-> canonical state change
-> editor/modal/window did NOT open

============================================================
9. MODULE VISUAL DIFFERENTIATION
============================================================

Dashboard modules currently look too similar.

Give individual modules subtle visual differentiation.

Use restrained accents/tints.

Do NOT create a rainbow dashboard.

Preserve the existing visual character:

- dark
- luxurious
- depth
- shadows
- subtle glow
- green interaction feedback

Grant specifically likes the existing green hover/glow/shadow treatment.

Keep that shared interaction language.

Module differentiation should be subtle and compatible with it.

============================================================
10. MODULE TITLE HIERARCHY
============================================================

Module headings do not all need to remain white.

Introduce a consistent heading accent treatment.

Yellow/gold is an acceptable direction.

Use judgment.

The goal is:

- stronger hierarchy
- clearer module identity
- good readability

not:

make everything yellow.

============================================================
11. CONTACT PHOTOS IN MINI CONTACTS
============================================================

Grant added an image to a contact.

It does not currently appear in the minimized Contacts module.

Fix that.

If a contact has a real image:

show it.

If not:

show a graceful fallback.

Verify:

contact photo stored
-> miniature renders it
-> refresh
-> still renders

Use signed/private image architecture correctly.

============================================================
12. PROJECT SETTINGS ENTRY
============================================================

Do not display the word:

Settings

where the three-dot project menu is sufficient.

Use the project-level three-dot control as the settings affordance.

============================================================
13. REMOVE ARRANGE THIS PAGE FROM PROJECT SETTINGS
============================================================

Remove:

Arrange this page

from project settings.

The page already supports direct manipulation.

Do not duplicate functionality.

============================================================
14. PROJECT SETTINGS VS GLOBAL SETTINGS
============================================================

These are distinct scopes.

PROJECT SETTINGS
affect only the current project.

GLOBAL/APPLICATION SETTINGS
affect the application/user generally.

Global settings should have their own three-dot control in the TOP-RIGHT, OUTSIDE the project window/container.

The visual hierarchy must make scope obvious.

Do not mix global configuration into project settings.

============================================================
15. GLOBAL SETTINGS — LIMITED PASS
============================================================

Global settings currently contain a lot of content/scrolling.

Do NOT undertake a speculative complete redesign during this pass.

For now:

- establish correct global entry point
- establish clear scope
- keep it visually coherent
- eliminate project/global confusion

Detailed global-settings information architecture can be reviewed separately.

============================================================
16. TEAM SCREEN — CURRENT PRODUCT REQUIREMENT
============================================================

IMPORTANT:

Grant's current requirement is that the Team screen IS the place where the AI team assigned to the project is configured.

This supersedes earlier instructions that would have removed team-management functionality entirely.

The Team screen should allow Grant to understand/configure:

- agents assigned to this project
- agent role/specialty
- agent skills
- responsibilities

Allow:

- add agent to project
- remove agent from project
- create/add additional agent where supported
- choose specialty
- modify role/responsibility
- add skills
- remove skills
- modify skills

This must NOT merely be cosmetic profile editing.

It needs to affect the underlying agentic system.

The Chief of Staff/router/delegation architecture should be capable of using configured:

- role
- specialty
- skills
- project assignment

when determining which agent receives work.

Trace the existing canonical agent/expertise/routing architecture before implementing.

Do NOT build a parallel frontend-only agent model.

============================================================
17. AGENT IDENTITY RULE
============================================================

The Team-management screen is now an intentional exception to the earlier identity restriction.

Agent names/avatars may appear in:

1. conversational UI
2. Team-management UI

Do NOT reintroduce agent-presence clutter elsewhere.

Still avoid decorative:

- project-header agent strips
- workload portraits
- who-is-working-on-what panels
- agent presence widgets
- random avatars around project modules

unless Grant explicitly asks for them later.

============================================================
18. WAITING FOR YOU MUST BE ACTIONABLE
============================================================

Items marked:

Waiting for you

currently tell Grant something needs him without providing a useful resolution path.

Every waiting item needs to be actionable.

Expected journey:

Waiting for you
-> click/open item
-> understand exactly what is required
-> provide decision / information / approval / answer
-> submit
-> waiting state resolves
-> project state updates

Do not merely display status.

Trace the canonical waiting/decision/approval architecture.

Use the real underlying state.

============================================================
19. WHAT THE TEAM HAS MADE
============================================================

Keep this concept.

It is useful as project output/history.

Show artifacts/documents/outputs produced by the team.

But interaction must NOT be limited to:

Add to project

Clicking an output should allow Grant to:

OPEN
VIEW

the artifact directly.

`Add to project` can remain where meaningful.

Viewing the artifact is a first-class action.

============================================================
20. NO LEGACY UI ESCAPE HATCHES
============================================================

Grant found several destinations that return to the old interface:

Running work -> Outputs
Active jobs
Team chat
Team board

This is unacceptable in the new Basecamp experience.

Implement these destinations within the NEW interface/design system.

Then audit EVERY visible link/action reachable from the new project interface.

No hidden escape hatches into the legacy UI.

Do not simply patch these four examples.

Create/extend an automated route/navigation check that identifies Basecamp UI actions which resolve into legacy surfaces.

============================================================
21. SOURCES — MODAL/BACK BEHAVIOUR
============================================================

Current example:

Sources
-> Notion
-> dismiss individual source popup by clicking outside

Current wrong behaviour:

returns all the way to project Home.

Correct:

Sources
-> Notion details
-> dismiss
-> Sources

Closing a child surface should return exactly ONE level.

Preserve navigation context.

Test:

outside click
Escape
Back
explicit close

where applicable.

============================================================
22. SOURCES — USEFUL CONNECTION INFORMATION
============================================================

`Connected` alone is insufficient.

Show enough information to understand WHAT is connected.

Examples:

NotebookLM:
- relevant notebook/project/workspace where available

Google Drive:
- connected account/location/folder/workspace where available

Other providers:
- equivalent useful identity/context

Never expose:

- secrets
- tokens
- credentials

The Sources page should answer:

"What is this connection actually pointing at?"

at a glance.

============================================================
23. ADD SOURCE — REAL ACCEPTANCE
============================================================

Do not assume Add Source works because a button/modal exists.

Exercise actual supported connection flows.

Verify:

Add Source
-> actual provider flow
-> persistence
-> reload
-> still connected
-> useful connection identity displayed
-> source genuinely available to the agentic system

Test relevant failures:

- cancelled
- rejected
- expired
- unavailable
- malformed configuration

Do not fake successful connection states.

============================================================
24. PRESERVE SOURCES VISUAL DESIGN
============================================================

Grant generally likes the Sources visual direction.

Do not redesign it unnecessarily.

Make targeted fixes:

- navigation
- details
- real connection state
- Add Source behaviour

Avoid visual churn.

============================================================
25. DOCUMENTS — SORTING AND CUSTOM ORDER
============================================================

Grant wants explicit document sorting and manual arrangement in BOTH:

A. the miniature Docs & Files module on Project Home

and

B. the expanded/maximized Documents / Docs & Files view.

Provide these ordering modes:

- Name
- Date uploaded
- Date created
- Custom

The control should be compact and understandable.

Do not create unnecessary UI chrome.

============================================================
26. DOCUMENTS — NAME SORT
============================================================

Name sorting should use the document/file's actual display name.

Use deterministic ordering.

Define and test sensible behaviour for:

- case differences
- numbers
- punctuation
- duplicate names

Use a deterministic secondary key so equal names do not randomly change order between renders.

============================================================
27. DOCUMENTS — DATE UPLOADED
============================================================

Date uploaded means the date/time the file/document was actually added/uploaded/imported into the office/project, where that metadata genuinely exists.

Do NOT silently substitute another timestamp merely because an upload timestamp is missing.

If some document types — particularly connector/reference records — do not have a meaningful upload date, represent that honestly and sort them deterministically.

Do not invent dates.

============================================================
28. DOCUMENTS — DATE CREATED
============================================================

Date created means the genuine creation date where that information is available from the canonical record/provider.

Examples may include:

- canonical office creation timestamp
- original provider creation timestamp where trusted and available

Do not confuse:

date created
with
date uploaded

merely because only one timestamp exists.

If the underlying model cannot currently distinguish the two for a particular document class, preserve that truth in the data/UI rather than manufacturing precision.

============================================================
29. DOCUMENTS — CUSTOM ORDER
============================================================

Custom mode means Grant manually controls the document order.

In BOTH miniature and expanded views:

Grant must be able to:

enter/use Custom ordering
-> drag a document
-> place it in the desired position
-> order updates
-> order persists

This is not merely local DOM reordering.

Persist the custom order canonically.

============================================================
30. DOCUMENTS — ONE SHARED CUSTOM ORDER
============================================================

The miniature and expanded views must NOT maintain independent custom orders.

There should be ONE underlying custom order for that project's documents.

Example:

miniature view:
A
B
C

Grant drags C above A.

Result:

C
A
B

Open expanded Documents:

C
A
B

Rearrange expanded to:

B
C
A

Return to miniature:

B
C
A

Both surfaces are views onto the SAME canonical ordering state.

============================================================
31. DOCUMENTS — CUSTOM ORDER PERSISTENCE
============================================================

Custom order must survive:

- redraw
- closing/reopening Documents
- navigating away/back
- page refresh

Where the architecture supports canonical per-user/project state, it should also survive use from another browser/device for the same person.

Do not use browser-only localStorage as the canonical implementation if the intended state is user/project state.

Follow the same principle established for board arrangement:

PERSON/USER + PROJECT

rather than:

DEVICE.

============================================================
32. DOCUMENTS — SWITCHING SORT MODES MUST NOT DESTROY CUSTOM ORDER
============================================================

This is important.

Suppose Grant manually creates:

C
A
B

in Custom mode.

He then chooses:

Name

and sees:

A
B
C

He then chooses:

Date created

and sees the corresponding date order.

When he returns to:

Custom

he must get:

C
A
B

again.

Automatic sorting modes are temporary views over the collection.

They must NOT overwrite the stored custom ordering.

============================================================
33. DOCUMENTS — MINIATURE VIEW
============================================================

The miniature Docs & Files module must support the same ordering choices.

Do not require Grant to maximize Documents merely to control its order.

However, keep the miniature interface compact.

Use an appropriate small sort/menu control rather than cluttering the module.

Manual Custom reordering must work directly inside the miniature.

============================================================
34. DOCUMENTS — EXPANDED VIEW
============================================================

The expanded/maximized Documents view should make ordering controls more explicit.

Support:

- Name
- Date uploaded
- Date created
- Custom

In Custom mode, drag/reorder should feel deliberate and obvious.

Do not compromise document opening/selecting.

============================================================
35. DOCUMENTS — DRAG MUST NOT OPEN DOCUMENT
============================================================

Dragging a document for Custom ordering must NOT accidentally trigger:

- document open
- details
- preview
- new tab
- edit

This is analogous to the Card Table Stuck defect.

Interaction semantics must distinguish:

CLICK
=
open/view document

DRAG
=
reorder document

Add a regression specifically for this.

============================================================
36. DOCUMENTS — SORT DIRECTION
============================================================

Use sensible defaults.

For example:

Name:
A -> Z

Date uploaded:
newest first

Date created:
newest first

If the existing design can support reversing sort direction cleanly without clutter, that is acceptable.

But the required feature is the four ordering modes, not speculative sorting complexity.

Do not overdesign this.

============================================================
37. DOCUMENTS — REAL PROVIDER/FILE TYPES
============================================================

The ordering system must work across the document types the product actually supports, including where applicable:

- uploaded files
- PDFs
- images
- recordings
- office-created documents
- Google Drive references
- Google Docs
- Google Sheets
- Google Slides
- connector/reference records

Do not make Custom order work only for uploaded local files.

Do not invent missing metadata merely to make Date sorting appear complete.

============================================================
38. DOCUMENTS — LIVE ACCEPTANCE
============================================================

Exercise document ordering through the deployed browser.

At minimum verify:

NAME SORT
-> correct deterministic order

DATE UPLOADED
-> correct order from genuine metadata

DATE CREATED
-> correct order from genuine metadata

CUSTOM — MINIATURE
-> drag
-> order changes
-> no accidental open
-> refresh
-> order persists

CUSTOM — EXPANDED
-> drag
-> order changes
-> no accidental open
-> refresh
-> order persists

CROSS-VIEW
-> reorder miniature
-> expanded matches

and:

-> reorder expanded
-> miniature matches

SORT PRESERVATION
-> establish custom order
-> switch to Name
-> switch to Date uploaded
-> switch to Date created
-> return to Custom
-> original custom order restored

If production lacks enough suitable documents to prove these behaviours safely:

create controlled test documents/records
-> exercise
-> verify
-> remove them

Do not damage Grant's real documents.

============================================================
39. INTEGRATION BLOCKER #340 — PULSE
============================================================

The deployed application currently has:

hq-api?section=pulse -> 502

on every page load.

Root cause already identified:

`app.hq_pulse` exists
but
`public.hq_pulse` does not

and PostgREST exposes `public`.

Issue #340 exists.

Fix this safely if it does not conflict with active backend work.

Do not merely silence the console error.

Add/retain the systemic check derived from the gateway routing map so future gateway functions cannot silently lack required public wrappers.

Verify through:

DEPLOYED BROWSER
-> REAL GATEWAY
-> SUCCESSFUL PULSE

============================================================
40. INTEGRATION BLOCKER #341 — BOARD ARRANGEMENT
============================================================

Current behaviour:

board arrangement persists per DEVICE.

Required behaviour:

board arrangement persists per PERSON/USER, per project.

Same authenticated person:

Device/browser A changes arrangement
-> Device/browser B sees same arrangement

Issue #341 exists.

Fix canonically.

Do not simply copy localStorage between devices.

Use appropriate backend/user/project persistence.

Verify with two independent browser contexts.

============================================================
41. INTEGRATION BLOCKER #344 — MIGRATION LINEAGE
============================================================

DO NOT casually modify production migration history.

Established state from the previous integration run:

- live database: 578 applied migrations
- `human-simulation-harness`: exactly 578 corresponding migration files
- `main`: missing 45 migrations already applied to production
- production therefore currently corresponds to the backend branch rather than main

Seven historical migration numbers are duplicated:

0534–0539
0543

Both historical migrations under those numbers have already been applied.

Therefore blindly renaming already-applied history would make repository history lie about what production executed.

Fresh-install additionally has three genuinely pending migrations that were safely renumbered in the trial integration to:

0572
0573
0574

That produced:

581 migration files
578 applied

and `check:migrations` passed.

HOWEVER:

zero-state replay from an empty database fails because the historical duplicate sequence numbers are both pending in a fresh database.

Observed:

ZERO-STATE FAIL around 523/581.

Issue #344 exists.

============================================================
42. #344 SUCCESS REQUIREMENTS
============================================================

Design/test the exact reconciliation required to achieve ALL THREE:

A.
Production remains truthfully represented.

B.
Eventual main contains the complete set of migrations already applied to production.

C.
A completely new office can replay the migration corpus successfully from zero.

Do all experimentation in disposable:

- worktree
- branch
- local database

Do not mutate production to make a test green.

If historical ledger identities must be reconciled, document precisely:

- old identity
- new repository identity
- production ledger mapping
- fresh-install identity
- why history remains truthful

Coordinate conceptually with the backend-owner branch.

Do not merge it yourself.

============================================================
43. CURRENT MULTI-BRANCH INTEGRATION STATE
============================================================

Previous trial integration established:

- four active branches
- `human-simulation-harness` contains `production-reliability`
- additive conflicts existed in the other branches
- package conflicts were mechanical/additive
- trial integrated tree could be constructed
- static checks passed after correct resolution
- integration preview could be deployed safely without moving the stable alias

Repeat the fetch before relying on this.

Branches may have moved.

Never integrate based on stale SHAs.

============================================================
44. NON-DESTRUCTIVE TRIAL INTEGRATION
============================================================

After implementing this feedback batch:

fetch all relevant branches again.

Create a NEW disposable trial integration.

Do NOT merge the real branches.

Reconcile:

- current main
- current backend branch
- production reliability
- fresh install/new-user work
- Basecamp branch
- any other relevant active branch

Then test the actual combined product.

A clean Git merge is not enough.

Look for semantic conflicts.

============================================================
45. ZERO-STATE TEST
============================================================

A brand-new empty PostgreSQL database must be part of final integration acceptance.

Replay the entire migration corpus.

Do not start from a database that already contains historical migrations.

Record:

TOTAL MIGRATIONS
APPLIED
FAILED MIGRATION
ERROR
FINAL RESULT

The target is:

ZERO-STATE PASS

If it remains blocked by #344, report exactly why.

============================================================
46. LIVE DEPLOYED BROWSER IS NOW A REQUIRED GATE
============================================================

The previous Chromium limitation has been solved.

Preserve:

npm run trust:proxy-ca

or equivalent established infrastructure.

Do NOT use:

--ignore-certificate-errors
ignoreHTTPSErrors
disabled TLS verification
application security exceptions

Invalid certificates must remain rejected.

Where appropriate, acceptance must now include:

REAL CHROMIUM
-> DEPLOYED VERCEL APPLICATION
-> REAL AUTHENTICATION
-> REAL OFFICE

`verify:basecamp-live` should become a permanent high-value gate.

============================================================
47. TEST AUTHENTICATION HONESTLY
============================================================

Previous discovery:

29 suites created fake writer tokens.

They happened to work while Chromium could not reach the office.

Once Chromium became properly connected, the office correctly rejected those fake tokens and the page correctly removed them.

Do not repeat this testing pattern.

Writer tests requiring authenticated writes must use a legitimate sanctioned test/auth mechanism.

Never weaken the office to make fake test credentials work.

============================================================
48. REAL DATA BOUNDARIES
============================================================

Current known production-data limitations:

- only three real tasks existed in the live office during the previous pass
- approved documents were connector records rather than uploaded file-backed documents

Do not interpret absence of suitable production data as proof a feature works.

Where safe:

- create controlled test records
- exercise them
- verify
- remove/restore them

Never damage Grant's real project data.

============================================================
49. INTERACTION QA RULE
============================================================

For every interactive surface touched:

IF IT LOOKS CLICKABLE:
CLICK IT.

IF IT MUTATES:
MUTATE IT.

IF IT CLAIMS PERSISTENCE:
REFRESH.

IF IT HAS BACK:
GO BACK.

IF IT HAS CLOSE:
CLOSE IT.

IF IT HAS ESCAPE:
PRESS ESCAPE.

IF IT DRAGS:
DRAG IT.

IF IT RESIZES:
RESIZE IT.

IF IT HIDES:
HIDE AND RESTORE IT.

For document ordering specifically:

IF IT SORTS:
TEST EVERY SORT MODE.

IF IT CUSTOM-ORDERS:
REORDER IT IN BOTH VIEWS.

IF IT SHARES STATE:
CHANGE ONE VIEW AND VERIFY THE OTHER.

IF IT SAVES CUSTOM ORDER:
SWITCH SORT MODES AND RETURN TO CUSTOM.

Do not accept screenshot-only evidence for interaction claims.

============================================================
50. PROJECT HOME REGRESSION PASS
============================================================

Revisit the full project Home after these changes.

Verify live modules remain coherent:

- Mine / Team To-dos
- Card Table
- Docs & Files
- Schedule
- Chat
- Contacts
- Activity
- enabled tools

Check:

- alignment
- hierarchy
- module differentiation
- title treatment
- move
- resize
- hide
- restore
- scrolling
- mobile
- no overlap
- persistence

For Docs & Files additionally verify:

- Name sort
- Date uploaded sort
- Date created sort
- Custom sort
- manual reorder
- persistence
- cross-view consistency

============================================================
51. VIEWPORTS
============================================================

Continue verifying at least:

1440x900
1024x768
768x1024
390x844

Pay particular attention to:

- title wrapping
- module headings
- miniature To-dos
- Card Table
- Docs & Files sorting controls
- Custom document drag behaviour
- project/global settings controls
- Sources
- Contacts
- Team management
- top microphone

No mid-word heading breaks such as:

CARD TABL
E

============================================================
52. ACCESSIBILITY / MOTION
============================================================

Preserve:

- keyboard operation
- visible focus
- 44px touch targets where appropriate
- reduced-motion support
- 200% zoom
- no iOS form zoom
- semantic buttons
- appropriate ARIA state
- truthful disabled states

Voice icon state cannot rely solely on colour.

Use accessible state text/labels while keeping the visual UI minimal.

Document sort controls must be keyboard accessible.

Custom document ordering must have an accessible interaction strategy where practical; do not make drag-and-drop the only possible mechanism for users who cannot drag.

============================================================
53. ARCHITECTURE
============================================================

Do not dump this work into giant `shell.js`.

The shell had already grown beyond ~2,500 lines.

Continue incremental extraction where touched domains justify it.

Potential domains:

- auth/session
- voice
- team management
- contacts
- sources
- settings
- layout
- documents

Document sorting/custom ordering belongs in the documents domain rather than generic shell state.

Do NOT undertake a giant rewrite.

Extract coherent responsibilities incrementally with tests.

============================================================
54. DEPLOYMENT DURING THE RUN
============================================================

After stable milestones, deploy the experimental Basecamp preview.

Verify returned bytes.

Then exercise the real deployed browser.

Do not wait until the very end to discover:

- CORS
- auth
- origin
- gateway
- cookie/session
- persistence

problems.

============================================================
55. FIX, DON'T JUST FILE ISSUES
============================================================

This feedback batch is implementation work.

For straightforward defects:

FIX THEM.

Do not create a pile of GitHub issues instead of working.

If something exposes a systemic cause:

fix the systemic cause.

Existing #340/#341/#344 should remain useful tracking references.

Only defer work where:

- another branch owns a dangerous conflicting change
- destructive production action would be required
- Grant's decision is genuinely required
- physical hardware/human testing is required

============================================================
56. DO NOT INVENT FUNCTIONALITY
============================================================

Implement the behaviours Grant has specified.

Do not use this mission as permission for broad speculative product redesign.

Preserve the current visual direction Grant likes.

============================================================
57. FINAL ACCEPTANCE — USER FEEDBACK
============================================================

Before calling this batch complete verify:

AUTH
[ ] no intrusive Paste Office Token normal flow
[ ] normal browser session can read/write
[ ] Chat works
[ ] settings write
[ ] appearance writes
[ ] representative mutations persist

VOICE
[ ] Chat voice note remains separate
[ ] top mic no longer opens panel/modal/window
[ ] page remains visually unchanged
[ ] icon communicates connection/listening/speaking/error
[ ] live infrastructure works
[ ] physical human conversation remains honestly pending

TO-DOS
[ ] miniature alignment fixed
[ ] completion does not reorder
[ ] canonical completion persists

CARD TABLE
[ ] Stuck drag works
[ ] no accidental editor opening

VISUAL
[ ] subtle module differentiation
[ ] green hover/glow retained
[ ] stronger module-title hierarchy

CONTACTS
[ ] miniature shows real contact photo
[ ] reload persistence

SETTINGS
[ ] project settings via project three-dot
[ ] no redundant Settings word
[ ] Arrange This Page removed
[ ] global settings separate
[ ] global three-dot outside project

TEAM
[ ] actual project-agent management
[ ] roles/specialties
[ ] skills
[ ] add/remove
[ ] changes affect canonical delegation architecture

WAITING FOR YOU
[ ] item explains what is needed
[ ] actionable response path
[ ] resolving clears waiting state

TEAM OUTPUTS
[ ] outputs preserved
[ ] output can be opened/viewed
[ ] Add to Project remains where useful

LEGACY
[ ] Running Work -> Outputs stays new UI
[ ] Active Jobs stays new UI
[ ] Team Chat stays new UI
[ ] Team Board stays new UI
[ ] automated audit finds no other legacy escapes

SOURCES
[ ] child popup returns one level
[ ] useful connection identity
[ ] no secrets exposed
[ ] Add Source tested end-to-end
[ ] visual direction preserved

DOCUMENTS
[ ] miniature supports Name sort
[ ] miniature supports Date uploaded sort
[ ] miniature supports Date created sort
[ ] miniature supports Custom
[ ] expanded supports Name sort
[ ] expanded supports Date uploaded sort
[ ] expanded supports Date created sort
[ ] expanded supports Custom
[ ] manual reorder works in miniature
[ ] manual reorder works in expanded
[ ] dragging does not accidentally open document
[ ] miniature and expanded share same custom order
[ ] custom order survives refresh
[ ] custom order uses canonical persistence
[ ] Name/date sorting does not destroy custom order
[ ] returning to Custom restores manual order
[ ] Date uploaded uses truthful metadata
[ ] Date created uses truthful metadata
[ ] missing metadata is not invented
[ ] deterministic tie-breaking
[ ] keyboard-accessible sorting
[ ] accessible alternative to drag where practical

============================================================
58. FINAL ACCEPTANCE — INTEGRATION
============================================================

[ ] #340 fixed or precisely blocked
[ ] pulse no longer 502 on every page
[ ] systemic gateway-wrapper test
[ ] #341 fixed or precisely blocked
[ ] layout persists per user/project across contexts
[ ] #344 reconciliation designed
[ ] current production lineage understood
[ ] current main lineage understood
[ ] fresh-install lineage understood
[ ] zero-state replay tested
[ ] trial integrated tree constructed
[ ] full static/unit gates
[ ] Basecamp gates
[ ] default Team HQ preservation
[ ] temporary integrated deployment
[ ] deployed-browser verification
[ ] stable experimental alias remains healthy
[ ] nothing merged

============================================================
59. FINAL REPORT
============================================================

Keep the final report concise but precise.

Start with:

STATUS:
READY / NOT READY

LIVE BASECAMP URL:
HEAD:
MAIN HEAD:
INTEGRATION TRIAL HEAD:

Then:

USER FEEDBACK
- Auth:
- Voice UI:
- To-dos:
- Card Table:
- Visual modules:
- Contacts:
- Settings:
- Team:
- Waiting for you:
- Outputs:
- Legacy routes:
- Sources:
- Documents sorting:
- Documents custom order:

INTEGRATION
- #340:
- #341:
- #344:
- production migrations:
- zero-state:
- trial integration:
- default Team HQ:

VERIFICATION
- local gates:
- deployed browser:
- real backend:
- persistence:
- mobile:
- accessibility:

NOT VERIFIED
Explicitly list anything not genuinely verified.

PHYSICAL VOICE
Must remain:

PENDING

until Grant actually speaks through a real microphone and hears the team respond.

Do NOT hide limitations behind test counts.

============================================================
60. OPERATING PRINCIPLE
============================================================

The goal is not:

"make the tests green."

The goal is:

Grant opens the experimental Basecamp application and the interface behaves exactly as expected.

Every visible control should do what it appears to do.

Every mutation should genuinely persist.

Every scope should be understandable.

Every project surface should remain inside the new design.

Documents should be sortable when Grant wants an automatic order and manually arrangeable when Grant wants his own order.

Miniature and expanded document views must behave as two views of the same project state, not separate implementations.

The underlying agent system must remain real.

And the entire feature branch must have a credible path back into the rapidly moving main/backend codebase.

Persist this mission first.

Then work autonomously through it.

Do not merge.
