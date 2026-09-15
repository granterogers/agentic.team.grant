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
| 5a | **All five P0s are done and pushed** — #214, #215, #216, #217, #218, plus #222's Activity/Lately half | ✅ done |
| 5b | P1: #219 homepage, #220 widgets, #158 settings, #188 desktop header, #25 the plane | 🔨 next |
| 5c | P2: #221 icons, #160 typography, #222's Tasks check | not started |
| 6 | PHASE 2 — FULL UX QA, Level 2, per §70's fifty-three-step order | not started |
| 7 | Final report in §74's format, exactly one of PASS / PASS WITH WARNINGS / FAIL | not started |

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
