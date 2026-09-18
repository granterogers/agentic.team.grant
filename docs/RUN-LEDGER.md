# RUN LEDGER — 8-hour autonomous completion run, 18 September 2026

**This file is the survival mechanism for this run.** After a compaction:
read `CLAUDE.md`, then this file, then `git log`, then the live issues, and
**continue**. Compaction is not permission to stop, restart, re-plan or ask
Grant what to do next.

## The mission, in Grant's words

> *"Drive Agentic Team as close as reasonably possible to finished, proven,
> usable and beautiful during this run."*
>
> IMPLEMENT → EXERCISE → FIX → VERIFY → COMMIT → PUSH → CLOSE PROVEN-COMPLETE
> ISSUES → CONTINUE
>
> *"Do not spend the run generating plans or a larger backlog."*

**The governing question:** *does the Agentic Team actually work when Grant
uses it?*

## The lesson this run is built on

The beta session immediately before it found **four defects from two real
reports**, two of them live for days while every gate stayed green. So:

**A green gate is necessary evidence, not sufficient evidence.** For every
user-facing capability ask: can Grant reach it · can he operate it · does
canonical state change · does it survive reload · does the message/file
actually arrive · does failure visibly and truthfully reach him.

And the failure-visibility class, from the Slack rotation defect: *a failure
can occur correctly while the mechanism meant to tell Grant fails silently.*
Audit `failure → handler → provenance → output gate → delivery → visible
notification` on every consequential async workflow.

## Acceptance rules

- A button that renders has not been tested until pressed.
- A job that queues has not been tested until completed.
- A message generated has not been tested until delivered.
- A file generated has not been tested until opened or rendered.
- A failure handler has not been tested until a controlled failure reaches the
  user-facing surface.
- Every report distinguishes **TESTED** from **INFERRED** from **NOT TESTED**.
- When a defect appears: root cause → search for siblings → define the
  invariant → fix at the narrowest correct shared layer → regression-test the
  class → exercise the original path.

## Starting state (reconciled, not assumed)

| | |
|---|---|
| **starting HEAD** | `927073c`, and `origin/main` is the same commit |
| **branch** | `claude/phase-7-communications-kh8ow8`, restarted from `origin/main` (its PR is merged) |
| **working tree** | clean |
| **migrations** | 488 applied |
| **unit tests** | 1,716 passing |
| **live open issues** | **12**, matching the brief exactly |

### The twelve, with the brief's priority order

| # | title | priority |
|---|---|---|
| **276** | 27 gateway actions/sections with no control | **P1 — first** |
| **272** | 40 capabilities in `check:callers`' baseline | **P1 — first** |
| **41** | deep end-to-end systems test | **P2** |
| **258** | first-class artifact generation | P3 |
| **172** | Gmail project intelligence | P4 |
| **261** | persistent agent computer runtime | P5 (with 16, 135) |
| **135** | a browser tab in every project | P5 |
| **16** | browser-capable agents | P5 |
| **259** | unified personal tasks | P6 |
| **260** | NotebookLM generated artifacts | P7 |
| **213** | rotate Slack bot token + signing secret | **BLOCKED — Grant** |
| **18** | `github.read_token` still live | **BLOCKED — Grant** |

#18 and #213 need Grant's action on an external account. Documented, skipped,
not rediscovered.

---

## CURRENT TASK

Reconciliation complete. Starting **#276** — drive the pressable baseline down
by exercising each entry, not by rendering controls.

## COMPLETED THIS RUN

*(nothing yet — appended as each batch verifies)*

## BLOCKERS

*(none yet)*

## NEXT ACTION

Read `docs/testing/pressable-baseline.json`, run `check:pressable` and
`check:callers`, and triage both against what Grant can actually reach.
