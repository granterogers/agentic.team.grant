# Autonomous run state

**Read this immediately after `CLAUDE.md` if you are a fresh session.** It says
what the mission is, where the work is, what the standing sequence is, and what
to do next. It is kept current deliberately, because a compaction has already
destroyed one specification in this repository.

**Context compaction is EXPECTED and is NOT a stopping condition.** If it
happens: reread `CLAUDE.md`, reread this file, reread
`docs/spec/ux-qa-v2-2026-09-15.md`, reconstruct the backlog from the GitHub
issues named below, identify the current checkpoint, and **continue
autonomously**. Do not return control to Grant merely because compaction
occurred.

The recovery procedure, in four words Grant gave:
**REREAD REPOSITORY STATE → RECONSTRUCT BACKLOG → IDENTIFY CURRENT CHECKPOINT →
CONTINUE AUTONOMOUSLY.**

---

## THE MANDATE IN FORCE — second eight-hour run, 16 September 2026

**Grant, 2026-09-16T05:02Z, lifting the hold on #25 himself:**

> *"start working on 25 and you have the next eight hours to implement all open
> issues in terms of feature requests and everything else um, yeah just
> implement everything for the next eight hours uninterrupted don't ask for any
> more prompts just go ahead and do it thank you"*

| | |
|---|---|
| **Started** | 2026-09-16T05:02Z |
| **Minimum duration** | **8 hours**, to 13:02Z — uninterrupted, no further prompting |
| **First task, named by him** | **#25** — the project dashboard as a living map |
| **Then** | every open issue that is a feature request or otherwise implementable |
| **Branch** | `claude/phase-7-communications-kh8ow8` |

**#25 IS NO LONGER HELD.** The earlier instruction — *"dont start implementation
yet"* — is revoked by the sentence above. `docs/spec/project-dashboard-design-direction-2026-09-15.md`
is the verbatim brief and the thing to build against.

**125 issues are open and they cannot all be done in eight hours.** Five of them
(#113, #114, #136, #137, #138) are explicitly proposals *awaiting Grant's pick*
and must not be implemented on a guess. The order is: #25 and its children
first, because he named it; then the frontend and UX issues that make the
product usable; then anything else that can be finished and verified. Say at the
end what was not reached, rather than leaving it implied.

Everything in the previous run's contract still applies — §1 do not interrupt,
§2 the only three early-exit conditions, §3 what is not a blocker, and
**context compaction is expected and is NOT a stopping condition**.

### What this run has delivered so far

Newest first. Each row is committed, gated and pushed unless the last column
says otherwise. **After a compaction, read this table first** — it is the
cheapest reconstruction of where the run is.

| Issue | What landed | Migrations |
|---|---|---|
| **#268** | filed and fixed in the same run — every model call in `src/` now names the job it was for, or states why it cannot. A source check with a proven synthetic failure | — |
| **#156** | a project's history as a sequence — `app.project_history` derives it from the timestamps the rows carry, because `public.events` holds agent actions and no lifecycle. Found and fixed a ONE-WAY DOOR #25 shipped this morning: choosing Panels removed the toggle that switched back | 0401, 0402 |
| **#124** | density is a control — and appearance moved to the OFFICE (0400), because ADR-0021 says a preference about how the work is shown is not the browser's. Found that `verify:arrangement` had been failing since #25 landed this morning, so ADR-0021's guarantee was unverified | 0400 |
| **#123** | an empty section says so — and the check that says so can now FAIL. The floor measured the whole page (always 361+ characters) so it never could. Found two more defects in the audit itself: every settings pane measured the section behind it, and "the call" was a route to a screen #214 removed | — |
| ~~#124~~ | ~~looked at, not started~~ — done later the same morning, see above. The note below was written before I re-read ADR-0021, which answers the scope question itself. It is not a token swap: appearance is `localStorage`-only and ADR-0021 says a preference like this belongs in the office. The scope question — whether scheme/palette/texture move too — is Grant's. Recorded on the issue | — |
| **#130** (part) | the office can pull the tasks out of a document and create them — `office.extract_tasks`, a deterministic recogniser, the `tasks_extracted` shape's first rows, and one undo for the batch. `npm run verify:extract` 11/11. **Still open** for `research_summary` and `draft_document` | 0398, 0399 |
| **#37** | search can ask the graph — filters by kind, tag, date and one `related_to` that asks `app.relations_of`, so agent/contact/source/collection are one mechanism. `verify:search` 12/12 → 26/26 | 0397 |
| #269 | filed: 268 of 276 `public.staff` rows are retired harness specialists (invisible to Grant — checked) | — |
| **#131** | the plan Grant approved is the import that happens — `office.notion_import` executes the STORED plan instead of a second model call. `PlanStep.payload` makes the plan one artefact rather than two. Six unit tests with a control that must come back one | — |
| **#127** | a model is chosen on what it has actually done, per kind of work — `public.model_record` derived from inference_usage, quality may only DEMOTE, exploration by staleness, the choice explained in `job_traces`. `npm run verify:routing-quality` 13/13, ADR-0031. **`verify:fallback` caught my first attempt inverting the certified model chain** | 0394–0396 |
| **#147** | a correction becomes a standing rule on one press — `src/agents/correction.ts`, the offer on the Governance page, `npm run verify:rules` 24/24, ADR-0030. Four latent defects found by DRIVING the press, none visible from reading | 0390–0393 |
| #266, #181, #241 | harness traffic on three tables Grant reads | 0388, 0389 |
| #134 | a budget that says no | 0386, 0387 |
| #149 | ask the office from the portfolio, and see where the question went | 0385 |
| #155 | a team page, not an org chart | — |
| #125 | a project as one page you can hand to someone | — |
| #150, #189 | act on several tasks at once; a deploy that waits for its own function | — |
| #152 | a document is a row you can edit | 0382, 0383, 0384 |
| #122 | what changed since you last looked | 0381 |
| #157 | the studio can be linked to | — |
| #154, #179 | one filter idiom; the pills reach 44px | — |
| **#25** | **the project dashboard is a living map** — the item he named first | 0378, 0379, 0380 |

**Not reached, and why**, to be kept current rather than reconstructed at the
end: #113, #114, #136, #137 and #138 are proposals awaiting his pick and their
aesthetic children must not be implemented on a guess. #178 needs a change to
his own Notion workspace. Candidates identified and not yet started: #123
(empty sections), #124 (density preference), #126 (drag a file onto a project),
#156 (project history as a sequence), #128 (agent hands work to another agent),
#187 (a Slack channel per project), #123 (empty sections), #124 (density
preference), #126 (drag a file onto a project).

---

## THE MISSION

**UX BACKLOG IMPLEMENTATION, THEN FULL UX QA (LEVEL 2), AUTONOMOUSLY, FOR A
MINIMUM OF EIGHT HOURS.**

Grant, 15 September 2026:

> *"Now, implement all the UX changes, suggestions, feedback, etc from the back
> log, run completely autonomously... then begin this UX QA script."*
>
> *"No more prompting, continue for the next 8 hours on first UX improvement,
> then UX QA as instructed."*

| | |
|---|---|
| **Canonical spec** | `docs/spec/ux-qa-v2-2026-09-15.md` — **verbatim, 75 sections. Read it. Do not condense it.** |
| **Started** | 2026-09-15T18:58Z |
| **Minimum duration** | **8 hours** — a minimum, not a maximum |
| **Branch** | `claude/phase-7-communications-kh8ow8` |
| **Phase 1** | every UX change, suggestion and piece of feedback in the backlog |
| **Phase 2** | the FULL UX QA script, Level 2, as its own phase after Phase 1 |

### The eight-hour execution contract, in Grant's terms

WORK CONTINUOUSLY AND AUTONOMOUSLY FOR AT LEAST EIGHT HOURS WITHOUT RETURNING
CONTROL TO GRANT FOR ROUTINE QUESTIONS, PROGRESS REPORTS, PRIORITISATION,
APPROVALS OR NEXT-STEP DECISIONS.

**None of these is permission to stop** (§0 of the spec): installing the QA
system · finishing the initial audit · finishing P0 · finishing P1 · green
tests · finishing the existing GitHub backlog · finishing one frontend · one
redesign pass · one visual inspection · one test suite · one commit · all
initially discovered defects. **When one task finishes, choose the next
highest-value task yourself.**

### Do not interrupt Grant (§1)

Assume he is unavailable for at least eight hours. Do **not** stop to ask: what
next · should I continue · which screen · which colour · do you like this ·
should I create an issue · should I run this test · should I commit · should I
update screenshots · should I fix this adjacent defect · should I proceed with
P2 · would you like me to continue. **Make reasonable professional decisions
yourself.**

### The only three early-interruption conditions (§2)

**A. Genuine external blocker** — further useful work is genuinely impossible
because a credential, permission, infrastructure or external service is
unavailable AND no legitimate alternative work remains. *One unavailable tool or
browser is not automatically a blocker.*

**B. Dangerous / irreversible action** — the next necessary action risks
destroying real data, exposing secrets, meaningful financial cost, irreversible
production modification, or a destructive external-service action, and genuinely
needs owner approval. *Continue all independent work first.*

**C. Environment-forced termination** — the runtime prevents further execution.
*Persist complete continuation state before it does.*

### These are NOT blockers (§3)

test failures · browser failures · build failures · lint failures · flaky tests ·
stale tests · broken tests · difficult CSS · an unexpected architectural problem ·
an unavailable optional provider · one unavailable browser · a safely resolvable
git conflict · **context compaction** · an obsolete screenshot baseline · more
defects than expected · several reasonable options · finishing the current task ·
finishing the current issue · green automated tests.

**Investigate. Classify. Fix or work around legitimately. Continue.**

### No routine progress interruptions (§67)

Do not return control merely to report: issue fixed · tests green · commit
pushed · next issue selected · screenshot generated. **Persist progress and
continue. Grant wants the final result, not supervision duty.**

---

## THE PERMANENT UX QA v2 ARCHITECTURE

Two levels. This is the permanent governance model the spec installs; it
supersedes and subsumes `docs/spec/ux-qa-governance-2026-09-14.md`, which stays
valid as the detailed escalation text.

### LEVEL 1 — proportionate, change-aware (the permanent default)

Run automatically whenever user-facing UI/UX changes, scaled to blast radius.

| Level | The change | Minimum |
|---|---|---|
| **1A** | small local visual — label, icon, local spacing, local component styling | static/smoke checks · render the actual changed surface · exercise the affected interaction · **visually inspect** · relevant viewport · overflow check · targeted accessibility · regression for the changed property |
| **1B** | interactive — dialog, form, menu, conversation control, call control, Settings interaction, task interaction | all of 1A · real interaction · keyboard · focus · console/network · control coverage · desktop **and** phone where relevant · loading/error/empty states · accessibility |
| **1C** | shared / broad — navigation, global CSS, design tokens, typography, shared primitives, project shell, communications architecture, auth, theme, Settings architecture | all of 1B · representative route sweep · layout verification · phone overflow · screenshot comparison · themes · reduced motion · broader regression · **cross-screen visual coherence** |

### LEVEL 2 — FULL UX QA

Only when: explicitly requested (FULL UX QA / deep UX audit / master QA) · a
major redesign occurs · shared architecture changes have broad blast radius · a
release warrants it · systemic quality concerns justify it.

**This first run IS Level 2.**

### The wording rule (§71)

- *"run UX QA"* → **proportionate Level 1**, unless context clearly requires
  escalation.
- *"RUN FULL UX QA"* → **Level 2**.

And permanently: *"Whenever user-facing UI/UX code changes, automatically run
proportionate UX QA against the affected surfaces using the master UX QA
specification. Do not run the entire deep audit unless the change has
broad/shared impact or Grant explicitly requests FULL UX QA. Escalate coverage
according to blast radius. Never mark UI work complete without rendering,
interacting with, visually inspecting and regression-testing the affected
interface in a real browser."*

### The core completion rule (§9)

**NO USER-FACING CHANGE IS COMPLETE UNTIL THE AFFECTED INTERFACE HAS BEEN
RENDERED, EXERCISED AND VISUALLY INSPECTED IN A REAL BROWSER.**

And its counterweight: **DO NOT RUN A MULTI-HOUR FULL AUDIT BECAUSE SOMEBODY
MOVED A BUTTON FOUR PIXELS.** Test in proportion to risk. The objective is
**maximal confidence per unit of effort**.

### Two passes are required to pass (§72)

Overall UX cannot PASS unless **BOTH** are true:
**FUNCTIONAL UX PASS** and **VISUAL COHERENCE PASS**.

An application with green tests, working buttons, no axe violations and no
overflow may still receive **UX QA FAIL** because it is ugly, incoherent,
bloated, inconsistent, confusing, visually amateur, typographically poor or
compositionally weak. **This is intentional.**

---

## THE VISUAL COHERENCE / DESIGN-SYSTEM GATE

§§16–23 and §52. Functional correctness is insufficient. The FULL audit must
inventory and judge, not merely measure:

- **Typography (§17)** — families, actually-loaded fonts, fallbacks, sizes,
  weights, line heights, letter spacing, heading hierarchy, labels, captions,
  buttons, navigation, conversation type. Find rogue fonts, accidental
  fallbacks, arbitrary sizes, competing type systems, inconsistent weights, poor
  hierarchy. **Do not judge typography while the intended fonts failed to load** —
  see the sandbox webfont limitation below.
- **Colour (§18)** — tokens, CSS variables, hard-coded colours, hex/rgb/hsl/oklch,
  gradients, alpha overlays, borders, shadows, semantic colours, project and
  agent identity colour. Find rogue colours, near-duplicate values, incompatible
  palettes, excessive decorative colour, inconsistent semantics, dark-mode
  mismatches.
- **Components (§19)** — how many visual implementations exist for a concept
  that should have one canonical implementation? Consolidate.
- **Geometry (§20)** — radii, shadows, borders, spacing, gaps, padding,
  container widths, header/nav/control heights, touch targets, page rhythm.
- **Information density (§23)** — for every major screen: *what can disappear?*
  Prefer **important now → context → detail on demand**. *Do not merely shrink
  clutter. Remove it.*
- **Space as a metric (§24)** — what percentage of the first viewport is useful
  information versus interface furniture? *Do not solve furniture by shrinking
  fonts. Fix composition.* Use `npm run space`.
- **Visual direction (§21)** — advanced, intelligent, sophisticated, calm,
  responsive, premium, tactile, futuristic, operational, alive. **A sophisticated
  near-future command centre, not a gaming dashboard covered in effects.** Avoid
  generic SaaS, cheap sci-fi, neon overload, random gradients, rainbow-dashboard
  syndrome, gratuitous glassmorphism, excessive glowing, every panel competing,
  giant shadows, endless rounded rectangles.
- **Fix order (§53)** — principles → typography → colour tokens →
  spacing/geometry → canonical primitives → app/project shell → page composition
  → modules → dialogs/forms → states → responsive → polish. **Do not patch
  twenty manifestations of one systemic defect.**
- **Design-director review (§65)** — after several meaningful changes, stop
  coding and look: what looks worst, what feels like another product, what is
  too dense, generic, amateur, repeated, competing with real work; which single
  change would improve the largest portion of the product. Then reprioritise.

---

## QA-HARNESS AUDIT REQUIREMENTS

§§10–12, and §§44–51. **FULL UX QA has two subjects: the product, and the QA
harness itself.** A green test is not automatically trustworthy.

**Do not trust** (§11): green tests with unexplained skips · screenshots
generated but never opened · accessibility tests exercising meaningless
structure · mouse-only mobile tests · narrow desktop viewports masquerading as
phones · server-side fetch as proof of browser CORS · teardown that never proved
it removed anything · order-dependent tests · retries that hide semantic
failures · assertions on implementation details rather than user-visible
properties.

**Prove the detector can fail.** For important QA mechanisms: introduce a
harmless temporary synthetic failure, confirm RED, restore, confirm GREEN.
**Never commit a deliberate defect.**

**Control coverage (§12)** must be quantitative — discovered, pressed, excluded,
skipped, unreachable, unpressable, desktop, phone, route coverage, Settings
coverage. **ZERO UNEXPLAINED SKIPS.** Do not exclude a control because of its
wording.

**Safety (§§44–47)**: do not contaminate Grant's real projects, documents,
tasks, Notion, Slack, Telegram, lessons, governance, job queue, build outputs or
notifications. Ask **does the layer under test filter fixtures** before choosing
a fixture name. Teardown must **assert it matched something** and that no
residue remains. Never make real data disappear to turn a test green.

**Order independence (§48)**, **timeout is not failure (§49)**, **bounded retry
only for transient 502/503/504 and never for a wrong 200, an auth failure, a
CORS failure or a semantic failure (§50)**, **browser CORS needs a real `Origin`
(§51)**.

**"Could not test" is acceptable (§69). Pretending it passed is not.** State
what, why, the dependency, the risk and the issue reference.

---

## THE TOOLING THAT ALREADY EXISTS

§7: **extend it, do not build a second QA framework.** Confirmed present in
`package.json` on 15 September:

`smoke` · `shots` · `probe` · `space` · `wide` · `gate` · `coverage` ·
`verify:ui` · `verify:layouts` · `verify:controls` (+`:studio` `:team`
`:settings`) · `verify:wired` · `verify:access` · `verify:motion` ·
`verify:offline` · `verify:talk` · `verify:hq` · `verify:design` ·
`verify:arrangement` · `verify:chat` · `verify:dictation` · `verify:settings` ·
`verify:cors` · `verify:harness` · `check:leaks` · `check:templates` ·
`check:secrets` · `check:migrations` · `purge:fixtures` · `lint` · `typecheck` ·
`test` · `e2e`.

Read `package.json` for the current truth rather than this list.

---

## CHECKPOINTS

| # | Checkpoint | State |
|---|---|---|
| 1 | Backend certification → GREEN, accepted, campaign closed | ✅ done |
| 2 | Project-dashboard design direction persisted verbatim | ✅ done |
| 3 | Direction captured in GitHub: #25, #220, #223, #81 | ✅ done |
| 4 | **UX QA v2 master prompt persisted verbatim** at `docs/spec/ux-qa-v2-2026-09-15.md`, and this run state written | ✅ done |
| 5 | **PHASE 1 — implement the whole UX backlog** | 🔨 **IN PROGRESS** |
| 5a | **All five P0s done and pushed** — #214, #215, #216, #217, #218 | ✅ done |
| 5b | **P1 done** — #219 home board (migration 0376), #220 widgets, #158 Settings as a page, #188 phone header, #222 in full | ✅ done |
| 5c | **#25's spatial plane deliberately NOT built** — Grant said *"dont start implementation yet"* about that direction and nothing since has revoked it specifically. A major redesign is the one thing not to do autonomously. | ⏸ held, on purpose |
| 5d | P2 remaining: #221 icon library (in tension with the 15 Sept restraint direction), #160 typography — folded into Phase 2's typography inventory | ⏳ |
| 6 | **PHASE 2 — FULL UX QA, Level 2** | 🔨 **IN PROGRESS** |
| 6b | §§17–20 design-system inventory — **`npm run system`**, new | ✅ |
| 6c | §15 cross-screen design board — **`npm run board`**, new; found 10 missing captures and 2 defects | ✅ |
| 6d | #160 typography drift — the rail was the one role that changed size | ✅ |
| 6e | #207 heading structure — every screen had one heading; `verify:access` 35/35 and proved able to fail | ✅ |
| 6f | §31 motion 6/6 · §32 states `verify:offline` 23/23 · §51 CORS 13/13 | ✅ |
| 6g | #240 the office cannot think — it never reached the page at all | ✅ |
| 6h | §36 communication UX — **#208 closed**. Two defects rendering found: a Slack emoji shortcode reaching Telegram as literal text, and the unreviewed warning said twice in one message | ✅ |
| 6i | §35 credential UX — **`npm run verify:credentials`**, new, 25/25. Migration 0377: the Google form sorts its two values by shape after stripping invisible characters, and NO setting may hold a credential-shaped value. The defect was real: a secret pasted into the plaintext Client ID box was stored in `system_config` and rendered back into the page | ✅ |
| 6j | §30 keyboard journeys — **`npm run verify:keyboard`**, new, 24/24. Three product defects: a redraw dropped focus onto the body, the document viewer was a dialog with no focus trap, and the command bar's Ask row did nothing at all with no project chosen | ✅ |
| 6k | §57 command bar — it offered "Desk", a screen #77 removed, and was missing Tasks and Recent activity. `tests/studio/command.test.ts` asserts the property in both directions | ✅ |
| 6l | §14/§15 captures refreshed, board rebuilt (14 screens, 0 missing), `npm run space` re-measured: phone project Overview 632px → **481px** to first content | ✅ |
| 7 | Final report in §74's format, exactly one of PASS / PASS WITH WARNINGS / FAIL | 🔨 **last step** |

### Opened rather than done, deliberately

| Issue | Why it was not done in this run |
|---|---|
| **#267** | `npm run space` cannot see the home board's panels — a QA-harness gap (§10), found by the half of the standard that audits the harness. A reading off the capture suggests the Tasks panel reserves ~400px for one line of loading text; that is an opinion until the tool can measure it, and CLAUDE.md records what believing a capture costs |
| **#188** | the phone's furniture, updated with the new measurement rather than duplicated. What is left is spread across four small bands, which is a harder shape to fix than the one tall header it used to be |
| **#25** | the spatial plane. Grant said *"dont start implementation yet"* and nothing since has revoked it specifically |
| **#221** | the icon library, in tension with the 15 September restraint direction |

---

## THE BACKLOG

**The epic is #223** — nineteen items from the 14 September remediation pass.
Read `docs/spec/ux-remediation-2026-09-14.md` (verbatim) before implementing any
of it. **The project dashboard direction is #25**, verbatim at
`docs/spec/project-dashboard-design-direction-2026-09-15.md`.

| priority | issues |
|---|---|
> **P0 is CLEARED.** All five, with regressions: `verify:talk` 40/40 (four new
> checks for #214's actual claim), `verify:chat` 57/57 (up from 45),
> `verify:breaks` proving the #218 boundary can fail, `verify:layouts` 64
> states / 0 findings, `verify:wired` 64 controls / 21 screens.
> First content pixel on a phone went from 632px of 844 to 500px.

| **P0 — done** | #214 Call the Team is a modal, should be an inline toggle that genuinely stops audio · #215 Message the Team has no in-app reply and no request states · #216 no way back to the homepage; rename Studio; simplify the header · #217 Documents `+` traps you, Outputs does nothing · #218 the studio can enter a crashed state |
| **P1** | #219 homepage as a global command dashboard · #220 panels as real widgets · #158 / #39 / #36 settings architecture · #188 project header too tall · #25 the project dashboard as a spatial map |
| **P2** | #221 icon library and cover image · #222 remove Activity, rename Lately, verify Tasks loads · #160 typography changes between routes |
| **P3** | polish found during the run |

Findings discovered during the run are added here and to GitHub. §63: prefer
**systemic issues with concrete evidence** over hundreds of microscopic ones.

### The one decision that was blocking layout code — RESOLVED, autonomously

**#220's widget grid versus #25's spatial plane.** §1 of the spec forbids asking,
so it is decided here and recorded: **the project dashboard becomes the spatial
plane (#25) and the global homepage (#219) stays a rearrangeable widget grid.**
They are different screens answering different questions — "what is happening
inside this project and how is it connected" versus "what needs me today across
everything" — so one primitive each is coherent rather than contradictory.
Written up on #220 so Grant can overrule it with one sentence.

---

## WHAT PHASE 1 ACTUALLY SHIPPED

Nine commits, all pushed to `claude/phase-7-communications-kh8ow8`. Every issue
carries a closing comment with its evidence.

| | |
|---|---|
| **#214** | the call is a toggle; three states; failures speak. `verify:talk` 40/40 |
| **#215** | the studio stopped inventing a reply, so waiting became visible. `verify:chat` 57/57 |
| **#216** | a way home, My Agentic Team, faces gone; the phone switcher was **1px wide** and is now full width |
| **#217** | Outputs has an empty state; the panel plus stopped meaning "add" |
| **#218** | a real failure state, proved by `verify:breaks`; the crash itself is not reproducible |
| **#219** | the home screen is a board of five panels; migration **0376** |
| **#220** | collapse, vertical resize, category tones |
| **#158** | Settings is a page called Global settings |
| **#222** | Activity removed, Lately renamed, Tasks verified honest (31 of 32 rows are fixtures → #266) |

**Measured:** first content pixel on a phone 632px → 481px of 844.
**Control coverage:** ~917 presses across every route and both device legs,
**0 unpressable, 0 findings**. Three audit defects fixed to get there.
**Migrations:** 376 applied. **Deploys:** `deploy:hq` green.

## ENVIRONMENT LIMITATIONS

Truthful, and they belong in the final report under COULD NOT TEST:

- **Webfonts do not load in the build sandbox.** Chromium cannot reach
  `fonts.googleapis.com` (curl can — a proxy difference), so every capture shows
  the fallback face. **§56 and §17 say do not judge typography under a failed
  font load** — so typography findings from sandbox captures are provisional
  until the fonts are self-hosted, which is itself a fix worth making.
- **GitHub Actions are off** by Grant's instruction (#17). §68 forbids
  reintroducing them for QA formality. Checks run in the authoring session.
- **`verify:controls` legitimately exceeds ten minutes** since #183. Give it a
  real timeout; the npm script already splits desktop and phone.

---

## STANDING RULES THAT GOVERN THIS WORK

From `CLAUDE.md`, which is the authority — pointers, not copies:

- **Never condense a requirements document.** Persist it verbatim on arrival.
- **No graphical change is complete because it compiles or renders.** Capture
  it, **open the image**, critique it.
- **Paste every screenshot URL into the reply.** Grant: *"I can't see
  anything.. you will always have to give me the image links each time to
  judge."*
- **Everything in the foreground.** Real timeouts, never backgrounding.
- **`npm run space` / `probe` / `wide` before believing a capture.** Three of
  four findings once read off a PNG were wrong.
- **Before you push**: `lint`, `typecheck`, `test`, `check:migrations`,
  `check:secrets`, `check:templates`; then `verify:wired`, `verify:hq`,
  `verify:ui`, `verify:talk` if the UI changed; then `npm run shots`.
- **Checkpoint commits (§66).** Do not hold eight hours in one diff. A commit is
  not completion — continue immediately.

## Beta failures

Genuine failures Grant hits in real use are the primary source of behavioural
findings. For each: read the canonical evidence before theorising, classify with
evidence, fix at the appropriate abstraction, convert into permanent regressions
with semantic neighbours, and run the affected gates. `CLAUDE.md` carries the
five steps in full.
