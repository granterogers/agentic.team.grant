# Backend readiness — 14 September 2026

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
