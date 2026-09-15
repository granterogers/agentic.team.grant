# Autonomous run state

**Read this immediately after `CLAUDE.md` if you are a fresh session.** It says
where the work is, what the standing sequence is, and what to do next. It is
kept current deliberately, because a compaction has already destroyed one
specification in this repository.

**Context compaction is EXPECTED and is NOT a stopping condition.** If it
happens: reread `CLAUDE.md`, reread this file, reconstruct the backlog from the
GitHub issues named below, identify the current checkpoint, and **continue
autonomously**. Do not return control to Grant merely because compaction
occurred.

---

## Last updated

2026-09-15, end of the backend certification campaign and the start of UX work.

## Where the project is

| | |
|---|---|
| **Backend** | **CERTIFIED GREEN and CLOSED.** See `CLAUDE.md` → *Where the project is: GRANT HUMAN BETA*, and `docs/testing/backend-acceptance-verdict-2026-09-15.md`. Do not reopen. Do not write another synthetic examination. |
| **Certified candidate** | commit `63c5a26`, worker v391, 375 migrations, `openai/gpt-oss-120b` |
| **Current phase** | **UX.** Changes first, then QA. |

## The sequence Grant set, 15 September

He stated it across several messages. In order:

1. **Capture the project-dashboard design direction in GitHub.** ✅ **DONE** —
   see the checkpoint table below.
2. **Absorb an advanced UX QA prompt** he will send. Absorb it; do not execute
   it on arrival.
3. **Perform all requested UX changes and improvements FIRST.**
4. **Only then run the UX QA process.**

> *"before execution, I wish for you to run all the UX changes, improvements
> that have been requested. only after those changes have been performed, will
> you run the UX QA process"*

**Do not run QA before the changes.** That ordering is his, and it is the whole
point of the sequence.

## The persistence protocol for the next master prompt

Grant's instruction, 15 September, to be executed **before** any substantive
work on the next master prompt he sends:

1. Read it completely.
2. **BEFORE beginning implementation**, persist its operational requirements
   into the canonical instruction/run-state files — `CLAUDE.md`, this file, the
   QA documentation, or a dedicated file as appropriate.
3. Preserve enough detail that a **completely fresh session** could reconstruct:
   the full mission; the permanent UX QA v2 architecture; Level 1 proportionate
   QA rules; Level 2 FULL UX QA rules; the visual-coherence / design-system
   gate; QA-harness audit requirements; the first-run minimum **8-hour**
   autonomous execution contract; the no-routine-interruption rule; the current
   backlog and priorities; testing requirements; and the exact continuation
   procedure.
4. **Do NOT merely write "continue UX QA" or a short summary.** Persist the
   operational rules needed to execute it correctly.
5. Record that compaction is expected and is not a stopping condition.
6. Record that after compaction you must reread the canonical instructions and
   this file and immediately continue.
7. Make the persistence update **before** beginning the long audit.
8. **Verify** the files contain the required continuation state.

Then begin the mission.

## Checkpoints

| # | Checkpoint | State |
|---|---|---|
| 1 | Backend certification → GREEN, accepted, campaign closed | ✅ done |
| 2 | Project-dashboard design direction persisted verbatim at `docs/spec/project-dashboard-design-direction-2026-09-15.md` | ✅ done |
| 3 | Direction captured in GitHub: #25 (primary), #220 (grid-vs-plane conflict), #223 (epic), #81 (superseded) | ✅ done |
| 4 | Receive and persist the advanced UX QA master prompt | ⏳ **NEXT** |
| 5 | Perform all requested UX changes | not started |
| 6 | Run UX QA | not started, and **must not start before 5** |

## The UX backlog, as it stands

**The epic is #223** — nineteen items from the 14 September remediation pass,
mapped onto children. Read `docs/spec/ux-remediation-2026-09-14.md` (verbatim)
before implementing any of it.

| priority | issues |
|---|---|
| **P0** | #214 (Call the Team is a modal, should be a toggle that stops audio) · #215 (Message the Team: no in-app reply, no request states) · #216 (no way back to the homepage; rename Studio; simplify header) · #217 (Documents `+` traps you; Outputs does nothing) · #218 (the studio can enter a crashed state) |
| **P1** | #219 (homepage as global command dashboard) · #220 (panels as real widgets — **see the conflict below**) · #158 / #39 / #36 (settings architecture) · #188 (project header too tall) |
| **P2** | #221 (icon library and cover image — now in tension with the 15 Sept restraint direction) · #222 (remove Activity; rename Lately; verify Tasks loads) · #160 (typography changes between routes) |

**The project dashboard direction is #25**, and it carries the acceptance
criteria. Verbatim source: `docs/spec/project-dashboard-design-direction-2026-09-15.md`.

### One open decision that blocks code

**#220's widget grid versus #25's spatial plane.** They are different layout
primitives and building both produces two systems that drift. The likely split —
flagged as interpretation, not Grant's words — is that the **project** dashboard
becomes the plane and **#219's global homepage** stays a grid. Comparison table
is on #220. **Ask Grant before writing the layout code**; do not average them.

### One open question from the 14 September brief

*"Project deletion"* appears in Grant's P1 list but in none of the nineteen
numbered items. Not filed, because it could mean a UI control, a change to
`app.project_delete`'s refusal rule, or something else. Worth one question.

## Standing rules that govern this work

From `CLAUDE.md`, which is the authority — these are pointers, not copies:

- **Never condense a requirements document.** Persist it verbatim the moment it
  arrives, before doing anything with it.
- **UX QA in proportion to risk**, §61 of
  `docs/spec/ux-qa-governance-2026-09-14.md`: pick 1A / 1B / 1C by blast radius;
  Level 2 only when Grant asks or the radius cannot be bounded.
- **No graphical change is complete because it compiles or renders.** Capture
  it, open the image, critique it.
- **Paste every screenshot URL into the reply.** Grant: *"I can't see
  anything.. you will always have to give me the image links each time to
  judge."*
- **Everything in the foreground.** Give long commands a real timeout rather
  than backgrounding them.
- **`npm run space` / `probe` / `wide` before believing a capture.** Three of
  four findings read off a PNG once were wrong.
- **Before you push**: lint, typecheck, test, `check:migrations`,
  `check:secrets`, `check:templates`, then `verify:wired`, `verify:hq`,
  `verify:ui`, `verify:talk` if the UI changed, then `npm run shots`.

## Beta failures

Genuine failures Grant hits in real use are now the primary source of
behavioural findings. For each: read the canonical evidence before theorising,
classify with evidence, fix at the appropriate abstraction, convert into
permanent regressions with semantic neighbours, and run the affected gates.
`CLAUDE.md` carries the five steps in full.
