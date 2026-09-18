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

Batch 1 done and deployed. Next: **#276**'s pressable baseline (15, each with a
stated reason) and the rest of #272's eight.

## COMPLETED THIS RUN

### Batch 1 — #272/#49: the office could not tell Grant what it cannot do

`check:callers` was at **10**, not the 40 in #272's title — it has already been
driven down. Triaging the survivors found the one the check exists to find.

**`app.proposals_to_send` and `app.proposals_sent` had never had a production
caller.** 0295 built them so Claire tells Grant ONCE what the office cannot do;
without a caller the office raised proposals correctly and said nothing, so the
only way he learned it was stuck was by opening the Governance page. Same class
as the morning's Slack rotation defect: a mechanism that exists, is correct, and
never speaks.

- **0489** — `proposals.delivered_by_job`, `proposals_sent(ids, job)` and
  `app.proposals_undeliver()`. Marking a batch delivered *before* the delivery
  is confirmed loses it for ever, and what is lost is the message saying the
  office is stuck. The claim is now checkable and recoverable; the sweep can
  only ever put a proposal BACK.
- **`src/handlers/propose.ts`** — sweeps, raises, then speaks. Silent when
  nothing is undelivered (a daily count is narration), announces when there is
  (the request itself). Router passed in `pass.ts`.
- **0490** — and the defect 0489 introduced. Its sweep said
  `delete … where app.harness_label(needed)`; the two harness proposals on
  Grant's page say *"speak fluent welsh q7mjvwn5"* and that pattern is
  separator-anchored, so **it deleted nothing and reported success** — the exact
  trap CLAUDE.md records, committed by the session quoting it. No pattern over
  the wording can work: `verify:proposes` names its subject to read real on
  purpose (#45). `app.harness_proposal` DERIVES it from the provenance of the
  impediments instead, the way 0355 derived `app.harness_job`, and the three
  readers ask it.

**Evidence.** 0489 and 0490 each drive their functions for real inside a
rollback, including the control that the derivation discriminates rather than
refusing everything. Six unit tests in `tests/handlers/propose-speaks.test.ts`,
**three sabotages each watched go red** (never speak · mark without naming the
job · sweep after sending) and green when restored. The whole round driven
against the real database in process — announced, named the gap, marked against
its own job, was not re-offered, and came back when the job did not deliver.
Not through the worker, deliberately: that would have sent Grant a real message
about a gap the drive invented.

`public.proposals` is now **0 rows** — the Welsh debris is gone from the
Governance page. `check:callers` **10 → 8**. Worker deployed.

### Batch 2 — #276: the pressable check could not see the studio's own payload

`section:studio` was in the baseline with the reason *"SUPERSEDED by the
per-project reader the page actually calls"*. False: `data.js:510` fetches
`?section=studio` and it is the studio's PRIMARY payload. `pressed()` matched a
quoted name only, so the URL form was invisible. **A baseline entry with a
false reason is worse than no entry.** Matcher fixed, one control per form,
sabotage proved it goes red. Baseline **15 → 14**.

### Batch 3 — the failure-visibility class, and it was live

§5's rule applied to this morning's Slack defect: **instance or class?** Class.
Five handlers hardcoded `path: 'deterministic_retrieval'` on a return that
spends a model, so `enforce_deterministic_claim` threw the answer away and
failed the job. Confirmed against `public.jobs`, not inferred:

| kind | failures | latest |
|---|---|---|
| `office.slack_rotate` | 10 | 07:13 18 Sep (fixed this morning) |
| `briefing.morning` | 2 | **04:00 18 Sep — Grant got no briefing** |
| `office.capacity_report` | 2 | 15:00 17 Sep |
| `office.sync` | 2 | 08:02 18 Sep |

All four remaining handlers now ask `howComposed`, overridden per return so the
templated branches keep the exemption.

**The regression caught itself being inert twice**, which is the part worth
keeping: `tests/handlers/determinism-claims.test.ts` first scanned return
blocks by jumping to the end of each match, so the enclosing
`return { kind, handle }` swallowed the file and it found **zero** blocks
containing `sayAs` — green, and green under sabotage. Its control caught that.
Then the fixed version was still inert for the two handlers that assign
`sayAs` to a variable first. **All six handlers sabotaged in turn, all six now
red, green when restored.**

## BLOCKERS

*(none)*

## NEXT ACTION

#41/§4: audit the rest of the failure chain — `failure → handler → provenance
→ output gate → delivery → visible notification` — for the other shapes it can
break in. Then #258.

(Superseded: #276: the 15 pressable entries. `section:staff` and `section:studio` are
documented SUPERSEDED — the studio half turned out to be a false reason and is
now fixed.)
