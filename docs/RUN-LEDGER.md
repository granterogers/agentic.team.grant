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

### Batch 4 — every failure the office recognises was a suite's

Following the chain from the backup that failed silently at 22:19 on 17 Sep,
the question was: which link is broken? Answer: the briefing (batch 3), and
then a second one underneath it.

`public.failure_signatures` (#132) feeds `app.recurring_failures`, which the
noticing pass turns into a suggestion weighted **75** and
`app.morning_briefing_facts` puts in the message Grant reads every day.
**Every row in that table was harness traffic** — 138 of them saying
`office.instruction` had failed, which is how his own messages are answered
and which had 14 complete, 6 cancelled and **zero real failures** in the same
period. Including `research.explodes`, a suite whose entire job kind is to
fail on purpose.

**0491** fixes both ends of the pipe rather than adding a flag to an aggregate
(0303's frozen-copy trap): the writer refuses a harness job, the reader
excludes a signature whose last job is harness, and the debris is swept. The
control in the drive proves a REAL repeated failure still surfaces — otherwise
the migration would simply have switched #132 off.

**The regression caught itself being inert again.** `verify:notice`'s first
version asked `app.recurring_failures` — the reader 0491 had just taught to
filter — so planting a harness signature left it GREEN. It asks the TABLE now,
and the reader's half is tested separately by planting one on purpose.
**33/33, red on the sabotage, green restored.**

Also confirmed, and worth NOT building: the failure-visibility chain is
otherwise intact. Ten silent failures in all of history, most from early
September. `app.office_health()` reports failures with a 24h window and the
briefing carries them — the break was the briefing itself.

### Batch 5 — the nightly backup could never finish again (IN PROGRESS)

The backup that failed silently on 17 Sep is not a flake. Its own transition
log is five ticks of `worker edge-… died holding this in running` and then
`5 attempts exhausted`. Measured: `buildArchive` takes **148 seconds** for 119
tables, 107,193 rows, 52 MB raw — on a fast machine with no function limit. An
edge function does not get that long. **The last backup that completed was 16
September**, and the archive grows every night.

**0492 (code, no migration)** makes the archive a FOLDER: one gzipped object
per table plus a manifest, each table a checkpointed `runSteps` step. A killed
tick banks everything before it and the next attempt resumes. No tick holds
more than one table.

- the prefix is derived from the JOB, never the clock — a timestamped prefix
  would give a resumed tick a different folder and nothing would ever finish,
  which is this defect reintroduced one layer down;
- the effect is `local`, not `external`: the key is deterministic and the
  upload is an upsert, so repeating a step is harmless, where `external` would
  park on the first interruption and defeat the whole change;
- the manifest is written LAST, so its presence is what makes a folder a
  complete backup rather than an interrupted one;
- `readFolder` + `newestFolder` keep `backup:rehearse` — which is IN the
  `verify:db` gate — working, preferring a folder and falling back to the
  legacy single files still in the bucket.

**Observed live:** attempt 1 banked **111 of 120 steps** before the function
was killed, which is the mechanism working. Waiting on the lease to expire so
recovery resumes it at step 112.

## BLOCKERS

*(none)*

## NEXT ACTION

#41/§4: audit the rest of the failure chain — `failure → handler → provenance
→ output gate → delivery → visible notification` — for the other shapes it can
break in. Then #258.

(Superseded: #276: the 15 pressable entries. `section:staff` and `section:studio` are
documented SUPERSEDED — the studio half turned out to be a false reason and is
now fixed.)
