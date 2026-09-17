# Backend readiness — 14 September 2026

> **Updated later the same day.** The five limits below were then worked
> through. Four are closed and one is measured and bounded; the summary of that
> second pass is at the end of this document under **What changed after the
> first pass**. The verdict is unchanged at ORANGE, for reasons that are now
> narrower and better understood.

The report `docs/spec/backend-acceptance-2026-09-14.md` asks for, written after
the deep acceptance pass. Issue #224.

Branch `claude/phase-7-communications-kh8ow8`. 361 migrations applied.

---

## OVERALL STATUS: 🟠 ORANGE

**The backend is sufficiently trustworthy to begin human testing, and there are
five named reasons not to trust it completely.** They are listed at the bottom
and none of them is a reason to wait.

Not GREEN, and the specification is explicit about why that word has to be
earned: *"Do not answer yes merely because existing suites are green. Base the
answer on what was genuinely exercised."* Two backend domains have **never been
exercised by anything**, the behavioural corpus is seven historical cases, and
three connectors are proven only against a fake.

Not RED. No severe correctness, persistence, isolation, hallucination, security,
delegation or reliability defect remains that this pass could find. The two it
did find are fixed, and both now have regression cover.

---

## COVERAGE

From `npm run coverage`, which derives the matrix from the repository rather
than restating it by hand.

| | |
|---|---|
| backend domains | **30** |
| fully exercised | **17** |
| partially exercised | **11** |
| **not exercised at all** | **2** |
| human-only | 5 items, listed below |

**The two with no suite at all:**

- **NotebookLM.** `src/notebook/` has five modules and `handlers/notebook.ts`
  exists, and nothing tests any of it. ADR-0013 forbids reviving the unattended
  sync — there is no public API and an unattended client would have to
  impersonate a browser session — so the honest deliverable is a capability
  probe that records each limitation as data. The specification says the same
  thing in its own words: *"Browser-only functionality is not programmatic
  capability."*
- **Recurring duties.** `verify:worker` reaches duty backlog incidentally. Due
  detection, the execution record, retry, duplicate prevention, disabled duties
  and stale detection are unexercised. This is the one that matters most for
  human testing, because a duty misfiring is something Grant would experience as
  the office being unreliable rather than as a test failing.

---

## TEST EXECUTION

| | |
|---|---|
| `verify:*` suites in the repository | **97** |
| backend suites attempted | **74** |
| passed | **72** on the sweep, **74** after both fixes were verified individually |
| failed | 2, both real, both fixed |
| timed out | **0** |
| could not be run | **0** |
| not attempted (frontend) | 18 — out of scope here; the UX QA standard covers them |
| unit tests | **1,017** across 62 files |
| behavioural cases | 7 |
| wall clock, backend sweep | roughly 95 minutes across seven batches |
| inference cost | £0 — free-tier models only, and the judge refuses a priced one |

A **fast readiness gate** now exists and did not before: `npm run gate`,
15 curated checks, **384 seconds**. The script whose name suggested one is not
one — `verify:all` is `verify` + `audit:credentials` + `verify:db`, and
`verify:db` is a 47-command chain ending in `purge:fixtures --go` and
`slack:tidy --go`, which are destructive sweeps rather than checks.

---

## FINDINGS

### Severe defects — none remaining

### Ordinary defects, found and fixed in this pass

1. **"The latest switch wins" was decided by a coin flip.** (0361)
   `app.current_project` ordered by `switched_at desc, switch_id desc`. Both
   halves are undecided: `switched_at` is `now()`, the *transaction* timestamp,
   so two switches in one transaction share an instant; and `switch_id` is
   `gen_random_uuid()`, so ordering by it is ordering by noise. **In production
   this means a chat can be pointed at the project from two switches ago while
   looking entirely reasonable** — the precise failure 0291's own comment says
   it exists to prevent. Fixed with a monotonic identity column. Regression
   check asserts the property ten times over.

2. **`app.project_delete` could not delete a project that had ever had a Slack
   channel, and failed by raising rather than refusing.** (0360) 32 foreign keys
   point at `public.projects` and only nine cascade. `check:leaks --sweep` died
   five projects into eleven and abandoned the rest. Fixed both halves: the
   mapping is cleared, and any remaining foreign key violation becomes a
   sentence naming what holds the project.

3. **`scripts/e2e.ts` always exited 0.** A sweep with twelve failures reported
   success to any caller. It exits non-zero now, on failures *and* on
   could-not-run.

4. **The sweep report was written to a filename with a date baked into it,** so
   every run after the eleventh overwrote a file whose own name lied about when
   it was generated.

5. **`check:leaks --sweep` aborted on the first failure.** It continues now and
   says how many it could not remove — a sweep that stops early looks exactly
   like a sweep that finished.

6. **A security check cried wolf.** `verify:hq`'s token-shape list contained a
   bare `/xox[abposr]-/`, which matched the Slack credentials field's own
   `placeholder` and help text. Nothing leaked. A security check that cries wolf
   is one somebody starts overriding, which is the expensive direction. The two
   bare prefixes now require twelve characters of token material — unreachable
   by any label a person would write, unavoidable by any real credential — and a
   **control** shows each of the six a synthetic credential of its own kind, so
   the list cannot be weakened until it matches nothing.

### Test-suite defects

- **`verify:agents` was flaky and nobody knew**, because it reported 56/56 on
  11 September and 55/56 on 14 September against identical code. Both runs were
  honest; the behaviour underneath was random. This is the single most useful
  thing the sweep produced, and it was only visible because the same suite ran
  twice against the same code.
- **The first draft of the regression check for it failed 10 of 10 and looked
  exactly like a live ordering defect.** It had reused a subject an earlier
  section already retired; a retired project is a fixture, a fixture switch
  correctly reads as no scope, and every null counted as the older switch
  winning. *The test was wrong and the fix was right, in the one direction that
  sends somebody rewriting a working function.* Validate the test first.

### Fixture hygiene

- **11 archived debris projects were sitting in Grant's views** and are gone.
  `check:leaks` is now part of the gate, so this is measured on every run rather
  than remembered.
- **3 harness documents remain in a real corpus** (`legacy-coaching-course`,
  "Verification page …"). Deleting the rows will not help: the pages are still
  shared in Notion and the next sync restores them. Archiving them is a change
  to Grant's workspace and therefore his call.
- 21 archived projects each carry a job and can **never** be deleted — a job
  cannot be removed because `job_state_transitions` is append-only. That is
  history, not a leak, and `check:leaks` says so.

### Coverage gaps

- `verify:chaos` covers **7 of the 20** failure cases the master spec §18 names.
  The missing 13: cold starts, a 100MB file, a zero-byte file, two workers
  leasing one job, a migration applied twice, clock skew.
- **No mutation testing.** Nothing generates nearby variants of a strong case,
  so a capability that survives only its own wording is currently invisible.
- **The behavioural corpus is 7 cases, all historical.** `npm run eval` reports
  a mean of 2.71/5, and that number says nothing about the office today — the
  corpus is deliberately loaded with answers Grant corrected, so a low mean is
  the instrument working. What it *does* say is that **agreement with Grant's
  own labels is 7/7: the judge is calibrated and the instrument is sound.** The
  gap is corpus size, and it belongs to #171.

### External and provider limitations

- **Gmail, Drive and Calendar are proven only against a fake Google.** Real
  transport needs a Phase 9 OAuth client in a project Grant owns (ADR-0013).
  A readiness report must not count this as coverage, so it does not.
- **NotebookLM has no programmatic path** and ADR-0013 decided it deliberately.

---

## HUMAN-TESTING HANDOFF

Only what genuinely cannot be proven automatically. Nothing mechanically
testable has been pushed onto Grant.

1. **Real microphone capture and release**, and whether the voice call feels
   responsive in the hand.
2. **Conversational naturalness** — whether the office reads like a colleague
   rather than a report. #186 changed this and only a person can judge it.
3. **Visual taste and the WOW gate.**
4. **Notification feel** — whether a buzz at that moment was welcome.
5. **Subjective latency tolerance.**

Two items need Grant for a different reason — they are credentials only he can
rotate: **#213** (the Slack pair pasted into chat) and **#18** (the GitHub token,
unrotated since 10 September).

---

## THE MOST IMPORTANT QUESTION

> *"Is the backend sufficiently trustworthy to begin human testing, and what are
> the remaining reasons not to trust it?"*

**Yes — begin.** The canonical layer, the job engine, persistence, isolation,
routing, delegation, capability honesty and the anti-hallucination invariant are
all exercised through real execution paths and read back independently. The
office was *used* rather than inspected: fixture projects created and torn down,
tasks moved through legal and illegal transitions, messages driven through four
surfaces, credentials revoked and restored, failures injected, and cleanup
proven rather than assumed.

**Five reasons not to trust it completely**, in the order they would bite:

1. **Recurring duties have never been tested.** If something misfires in front
   of Grant, this is the likeliest place. A duty is also the one thing that acts
   without him asking.
2. **Gmail, Drive and Calendar have never touched a real Google.** They may work
   perfectly; nothing here is evidence either way.
3. **The behavioural corpus is seven cases.** Deterministic state is well
   covered. *Whether the answers are any good* rests on a calibrated judge with
   almost nothing to judge.
4. **7 of 20 chaos cases.** The office recovers from the failures it has been
   shown and is unproven against the other thirteen.
5. **`verify:agents` was flaky for at least three days and nobody knew.** One
   was found. The honest position is that a suite passing once is weaker
   evidence than this repository has been treating it as, and nothing yet
   measures flake rate across runs.

None of the five is a reason to wait, because every one of them is a thing human
testing would surface faster than another week of automation would.

---

_Generated during the pre-human backend acceptance programme, #224.
Reproduce with `npm run e2e`, `npm run gate`, `npm run coverage`, `npm run eval`._

---

# What changed after the first pass

Same day. Grant read the five reasons and said to solve them.

| # | reason it was ORANGE | now |
|---|---|---|
| 1 | recurring duties never tested | **closed** — `verify:duties`, 21/21 (#225) |
| 2 | Gmail, Drive, Calendar never touched a real Google | **open, and his to unblock** — needs a Phase 9 OAuth client, and the consent step does not exist in the code yet |
| 3 | behavioural corpus of 7 cases | **7 → 20, and it found the judge was grading the wrong thing** (#171, #229) |
| 4 | chaos covered 7 of §18's 20 | **21 → 29 checks** (#228) |
| 5 | nothing measured flake | **closed** — per-run history keyed by commit (#226) |

**NotebookLM** also went from no suite at all to 18/18 (#227), so **all 30 domains now have a suite** — 17 full, 13 partial, none absent.

## Two more real defects, found by the new coverage

- **`app.hq_rename_project` never checked for a name clash.** `hq_create_project`
  refuses a name a live project already holds; rename did not check at all, so
  two active projects could answer to one name and Grant would be routed to
  whichever the resolver ranked first. Reachable from Project Settings. Fixed in
  **0365**. Third instance of a pre-check existing on one writer and not its
  twin.
- **Renaming a project makes it permanently undeletable** — the rename enqueues
  a job, a job can never be removed, and `project_delete` refuses a project
  holding one. Not a bug to fix; a property to know, and the reason the new
  arc runs inside a rollback.

## The finding that matters most

**The evaluator's judge was measuring compliance, not trustworthiness.** Its
rubric asked one question — *"did it do what was asked?"* — which rewards a
confident fabrication and penalises an honest refusal. On seven historical cases
it agreed with Grant 7/7. On twenty, with a `good` control beside every `poor`
case, agreement fell to 15/20 and every disagreement had the same shape: a
fabricated database read graded GOOD, an honest *"I have not checked"* graded
POOR.

That is the exact inversion of this office's first invariant. It was invisible
for as long as the corpus contained no honest refusals to grade.

Corrected (`JUDGE_VERSION` 2026-09-14.1), and the three disagreements it caused
went away and stayed away across every subsequent run at both temperatures.

## And a limit on the instrument itself

The agreement figure **moves ±2 cases between runs of an unchanged corpus**,
even with the model pinned and `temperature: 0` — established by measurement,
not assumed: two consecutive runs gave 16/19 and 16/18, one verdict flipped, and
a different case failed to parse each time. The free model does not give back
what temperature 0 asks for.

`npm run eval` now prints that margin next to the number. **Read the agreement
figure as a range, and never tune the prompt on one run.** #229 has the three
options; majority-of-three is the likely fix and it triples a run that already
takes 20–30 minutes.

## Where the numbers stand now

| | |
|---|---|
| suites recorded in the sweep | **92 of 94** · 0 failed · 0 could not run |
| the two not run | `restore` (restores a backup over the live database) and `github-token` (spends a real budget) — both excluded by name, deliberately |
| fast readiness gate | **15/15 in 395s** |
| domains | 30 · 17 full · 13 partial · **0 with no suite** |
| unit tests | 1,017 |
| migrations | 365 |
| free tier | database **50 MB of 500** · storage **102 MB of 1,024** — now asserted at an 80% ceiling rather than assumed |
| control audits | studio 304 pressed / 0 findings · team 97 / 0 · settings 92 / 0 |

## The verdict, unchanged

Still **🟠 ORANGE**, and the remaining reasons are now these:

1. **Google is unproven against a real Google**, and it is jointly blocked — the
   OAuth client is Grant's to create and the one-time consent flow is not built.
2. **The behavioural judge has a ±2 margin**, so the office's answer quality is
   known to be roughly right rather than precisely measured.
3. **Duties are tested to the point of dispatch, not through the handler.** The
   arc from *"the duty fired"* to *"the thing it exists for happened"* is
   covered only for the kinds `verify:worker` drives.

None of the three is a reason to delay human testing. The first two need Grant
or a decision from him; the third is genuinely better exercised by a person
using the office than by another suite.
