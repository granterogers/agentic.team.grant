# RUN LEDGER

**This file is the survival mechanism for the current run.** After a
compaction: read `CLAUDE.md`, then this file, then the latest handover in
`docs/testing/`, then `git log`, then the live issues, and **continue**.
Compaction is not permission to stop, restart, re-plan or ask Grant what to do
next.

---

# CURRENT RUN — 6.5-hour completion & evolution run, 18 September 2026

## §0 reconciliation, done first and the answer was reassuring

The external observation that `main` did not carry
`docs/testing/handover-2026-09-18-run.md` was correct and the cause was not
lost work:

| | |
|---|---|
| local HEAD | `954ea0b`, clean tree, **0 unpushed** |
| `origin/claude/phase-7-communications-kh8ow8` | `954ea0b` — identical |
| `origin/main` | `927073c` — **14 commits behind** |

Nothing was local-only. The previous run's 14 commits were all pushed to the
branch; `main` had simply not been fast-forwarded since the one merge earlier
that day. Gate re-run green before merging (lint 0 · typecheck 0 · **1,747
tests** · secrets 0 · migrations 493 · templates clean), then `main` was
fast-forwarded to `954ea0b` and pushed. §18's requirement is satisfied and
verified: `RUN-LEDGER.md` and all three handovers are on the default branch.

**Starting HEAD for this run: `954ea0b`.**

## The mission

> *"Make the actual Agentic Team demonstrably work, reduce the remaining real
> product backlog, aggressively discover weaknesses through real use, and begin
> laying the foundations for an Agentic Team that can continuously test, learn
> and improve itself."*

Two operating principles, the second new:

- **Reality is a stronger oracle than code inspection.**
- **The office should eventually become capable of discovering how to improve
  the office.**

## The verification rule this run inherits

`CHECK + CONTROL + REAL EXECUTION`. **Do not trust a green check without
knowing what its control proves.** The previous run shipped three inert-green
checks, and twelve browser unit tests missed a failure the real network found
in one call. Hunt specifically for: inert tests · identical control/test
observations · mocks that cannot fail · fixture assumptions · assertions that
restate the implementation · success without state change · queued-but-never-
completed · generated-but-never-delivered · rendered-but-inoperable controls ·
failure handlers that themselves fail.

And two explicit prohibitions from this brief, both of which the previous run
broke once each: **do not commit known-unverified work because of an external
throttle** — record the blocker and move on — and **do not push a known-red
tree**.

## Live issues at the start of this run: 10

| # | title | plan |
|---|---|---|
| **41** | deep end-to-end systems test | **the spine** — act like Grant, invent real and awkward requests |
| **258** | first-class artifact generation | drive to a delivered, rendered, inspected PDF |
| **135 / 16 / 261** | browser + computer cluster | one capability; exercise the eleven cases the brief names |
| **172** | Gmail project intelligence | preserve epistemic honesty; close if acceptance is met |
| **259** | unified personal tasks | exercise every state; close if acceptance is met |
| **260** | NotebookLM artifacts | verify what the API actually exposes before designing |
| **213 / 18** | credential rotations | **external to Grant.** Documented, skipped, not rediscovered. |

## Team Evolution — the new foundation

A governed, cost-aware, measurable capability whose loop is
OBSERVE → QUESTION → HYPOTHESISE → RESEARCH → SIMULATE → TEST → PROPOSE →
EXPERIMENT → INDEPENDENTLY EVALUATE → PROMOTE/REJECT → MEASURE → LEARN.

Hard constraints: **not a second agent platform** — it orchestrates the office
that exists; **not its own judge** — production → observations → lab →
candidate → independent evaluation → held-out + adversarial regression →
promote/reject/rollback; **cost-aware** — deterministic code → free model →
mid-tier → frontier, escalating only when justified.

## CURRENT TASK

Reconciliation complete. Starting the #41 spine: real use, acting as Grant.

## COMPLETED THIS RUN

### Batch 1 — #41: acting like Grant found two defects in his own project list

Drove eight requests a person would plausibly type through the REAL handler —
real routing, real retrieval, real model, real gates — in process, so the
worker could not post eight test messages to Slack. Enqueued through
`app.enqueue_inbound` with a `verify-act-…` actor so `is_fixture` generates
true, and cancelled the instant they were queued.

**The harness was wrong first.** Its first version handed the handler a
fabricated `Job` with the instruction in `pinnedConfig`; the handler re-reads
`pinned_config` from the row by id, correctly, so all eight answers came back
about a `verify:transport` fixture. Validate the test before believing the
finding — for the fourth time this week.

**What the office does WELL**, worth recording because a defect list is not a
verdict: *"That is not what I meant at all."* → *"Sorry — let me not guess at
that. What were you after?"*, deterministic and verified. *"Ring the client"* →
honestly cannot, and offers an email or a task instead. *"Did you send that
email yesterday?"* → *"I have no record of it, so I didn't send it."*

**Defect 1 — a reserved bucket counted as one of his projects.** *"What
projects do we have open?"* → *"Here are the five open projects: 1. Unnamed,
…"*. He has four. `unnamed` is ADR-0024's reserved place where a message
naming no project lands, `projects.reserved_reason` marks it, and **nothing in
`src/`, `supabase/` or `web/` read that column.** Fixed in `projectSpine`,
which names the bucket rather than hiding it, because "what has ended up in
the unnamed project?" is a fair question.

**And the first fix made two of three answers worse**, which only real
execution could show: it ended *"…so do not count it as a project or offer it
as one"*, and *"What projects do we have open?"* then came back *"I have
nothing on it here"* from a prompt listing all four. A negative imperative
beside the data it is about invites over-obedience. Restated as a fact; all
three correct. **A sentence the model must obey is one it can over-obey.**

**Defect 2 — ten fixture projects in his switcher.** `verify:recovers` created
`fixture-recovers-<run>` every run, hung four jobs on it, and tore down only
the jobs — and a job can never be deleted, so each project is PERMANENT. One
per gate run, nineteen active projects where he has four. Fixed at the cause
(one stable reused project) and swept: **19 active → 5**, his four plus the
reserved bucket. `app.stuck_fixture_projects()` names the class that
`check:leaks` cannot, because it sweeps what it can DELETE and this is about
what it cannot.

Evidence: 6 unit tests on `projectSpine` with **two sabotages each red**;
`verify:recovers` 19/19 with no new project; 0494 drives its reader with a
control that must see a planted row; **1,753 tests**.

## BLOCKERS

*(none)*

---

# PREVIOUS RUN — 8-hour autonomous completion run, 18 September 2026

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

**PROVED END TO END.** Attempt 1 banked **111 of 120 steps** before the
function was killed; the lease expired, `app.recover_stalled_jobs` moved it to
`retrying`, and **attempt 2 finished all 120**. The office's own report:

> Backed up **107,255 rows across 119 tables** — 9627KB compressed, one object
> per table in `backups/run-9d15a37f-…`

Then `npm run backup:rehearse` against that folder:

```
✅ there is a backup to restore from — folder run-9d15a37f-…, 119 table object(s)
✅ every object in it is the one that was written, byte for byte — 120 object(s) checksum clean
✅ the next backup would contain every table in the database — 119 table(s), none skipped
✅ the rows load back into a database — 107255 of 107255 row(s) restored into restore_rehearsal
✅ and every table came back with the number of rows the archive claims — 94 table(s), every count matched
```

**The first backup to complete since 16 September, and the first restore ever
rehearsed from one.**

Two defects of my own, found by running it rather than reading it:
`ensureBucket` answers with what it DID, so the first message told Grant his
backup was in `already private/run-…`, which is not a place; and the rehearsal
printed the same line twice. Both fixed. The reads are batched eight at a
time — 240 sequential round trips took over fifteen minutes with nothing
printed, in a script that is IN the `verify:db` gate.

### Batch 6 — #258: every report printed Grant's request on its cover

§6 says render and inspect the PDFs. Nothing did. Pulled the newest out of
Storage and opened it: the body is genuinely good — heading hierarchy, a
captioned table, running header, page numbers — and page one carried exactly
one piece of content, *"Write me a PDF report on the coaching course modules,
from what we hold."*, above two thirds of an empty page.

Both call sites passed `subtitle: brief.slice(0, 400)`. `validatePdf` was green
over it and correctly so: it checks structure, and a structural check cannot
see this. `coverLine` takes the document's own opening clause instead.

Then the fix had the defect CLAUDE.md warns about and **my test passed on it**:
a 197-character cap rendered *"…client enga…"* onto the cover, and the test
asserted the LENGTH and the ELLIPSIS, both true of that. Cuts at a word now,
and the test asserts the word boundary. Rendered, looked at, fixed, rendered
again.

Also: I read `npm run lint`'s tail instead of its exit code and pushed a red
tree, which is the trap CLAUDE.md records twice. Fixed in the next commit.

### Batch 7 — the gate found a defect in batch 1, and the drive found another

`npm run gate` (for #41) went red on `verify:proposes`, and it was right.

**0490's filter ignored `p_include_fixtures`** — the parameter that has meant
"count the harness traffic too" since 0297. The tally honours it; my splice
put an unconditional predicate in the same WHERE clause. So the suite whose
job is to drive the raise path got nothing. CLAUDE.md's *"loosening a
constraint does not loosen the function that pre-checks it"*, in reverse.

And while driving the fix, its last assertion caught something worse:
**`proposals_to_send` had no harness filter at all.** 0490's splice loop
replaced a string in three functions and asserted only that it hit ONE — the
reader never contained that string, so it took no predicate and the loop
reported success on two out of three. Between 0489 and 0492 a suite could have
made the office tell Grant about a gap it invented.

**A splice loop must assert per TARGET, not in total.**

0492 fixes both. `verify:proposes`'s "it is in the batch to send" is inverted —
it was asserting against a safety rule — with a real-provenance control so the
reader cannot pass by returning nothing.

### Batch 8 — the gate finished 32/36, and all four reds are now green

`npm run gate` — 36 suites, 2,399 seconds. **32 passed.** Every one of the four
failures was real, and three of the four were defects in a CHECK rather than in
the product, which is this run's recurring shape.

| suite | what it was |
|---|---|
| `verify:proposes` | **product** — 0492's two defects, above. Now **26/26**, including the debt: it was committed unverified under a 429 and re-run as the first thing after the gate. |
| `verify:schema` | **a key I named.** `app.app_base_url -> app.base_url` — the checker reads a schema-qualified name in a function body and cannot tell a relation from a dotted string. `system_config` keys all use a DOMAIN prefix; `app.` is a schema. 0493 renames it `web.base_url`. Now **3/3**, and the live OAuth redirect still resolves through it. |
| `verify:knowledge` | **green on re-run** — 38/38. Transient. |
| `verify:mail` | **the test.** It probed "the cache as it is, which is stale" — true while Google's token was dead, false from the morning it was reconnected. The check and its control printed the IDENTICAL reading, which is the inert signature. Staleness is constructed inside the rollback now, and the two readings differ: `blank=["mail"] complete=false` against `blank=[] complete=true`. **30/30.** |

0493 also closes the CLASS: a trigger refuses any NEW config key whose prefix
is a live schema name. `vault.naming` is the same shape, unreferenced so far,
and deliberately left alone rather than renamed.

And I hit the backtick-in-a-comment-in-a-template-literal trap while writing
the mail fix — two comments below one that says not to.

### Batch 9 — #135/#16: the office could not open a page that needed no browser

`runtimeFor` resolves two Vault entries, finds neither, and hands back
`UnavailableBrowserAdapter`. So with no Cloudflare credential the office could
not open **any** page — including a plain public one that never needed a
browser.

The credential is a real blocker for a login or a JavaScript-rendered page. It
is not a blocker for fetching HTML and reading it, which is most of the
reference material a project cites. `FetchedBrowser` costs nothing, needs
nothing, and is honest about its three limits rather than returning an empty
read: **no screenshot** (refused in words), **no JavaScript** (a shell is
reported as a limit, never as "the page says nothing" — #257's false absence
through a new door), **no signing in** (an expired jar comes back through the
same `looksSignedOut` both runtimes share).

It also carries a guard the Cloudflare runtime does not need: a gather URL can
come from a document, so it is not trusted. `file://` and every private range
are refused — the one that matters is `169.254.169.254`, which answers with
cloud credentials and which no blocklist of hostnames would catch.

**The real network found a defect twelve unit tests missed.** The first floor
refused anything under 400 characters of text, and rejected **example.com** — a
complete server-rendered page of 144 characters — as "probably JavaScript". A
guard that refuses a good page teaches the office to distrust a runtime that
was right. The discriminator is markup WEIGHT, not text length: little text
*and* a great deal of page around it.

Live, with no credential of any kind: public page **ok=true, 144 chars**; a 404
refused with its status; cloud metadata refused as private. Twelve tests,
**three sabotages each red** (guard off, shell through, screenshot faked).

## BLOCKERS

*(none)*

## NEXT ACTION

#41/§4: audit the rest of the failure chain — `failure → handler → provenance
→ output gate → delivery → visible notification` — for the other shapes it can
break in. Then #258.

(Superseded: #276: the 15 pressable entries. `section:staff` and `section:studio` are
documented SUPERSEDED — the studio half turned out to be a false reason and is
now fixed.)
