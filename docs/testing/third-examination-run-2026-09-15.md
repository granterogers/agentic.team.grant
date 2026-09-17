# The third final examination, run against the paid candidate

Run 2026-09-15 against the frozen candidate: commit `2bcaf1d`, worker **v389**,
**374** migrations, primary `openai/gpt-oss-120b`.

Corpus `scripts/sessions/third.ts`, committed **UNRUN** at `2bcaf1d` — the same
commit as the freeze. All six sessions run to completion before any failure was
classified. Nothing was changed while scoring.

## Result as observed

**12 of 18 turns held.**

| session | turns | held | |
|---|---|---|---|
| `the-shortlist` | 3 | 1 | two failures |
| `the-ledger` | 3 | 2 | one failure |
| `marek` | 3 | 3 | ✅ |
| `out-of-bounds` | 3 | 2 | one failure |
| `three-desks` | 3 | 2 | one failure |
| `house-style` | 3 | 2 | one failure |

## VERDICT: GREEN IS REVOKED

A **SYSTEMIC PRODUCT DEFECT**, and the uncomfortable part is what it is: #249
fixed action RECOGNITION on grammar and left argument EXTRACTION enumerated by
verb. The same defect, one layer in, in the fix for itself.

---

## Failure 1 and 4 — extraction is still a list of verbs

**Classification: SYSTEMIC PRODUCT DEFECT.**

`the-shortlist` turn 1: *"Line up a task on alpha to take up references for the
two we keep."* The office answered:

> Happy to add that. What should it be called? A title is all I need — a due
> date and an owner are optional and I can leave them off.

`out-of-bounds` turn 2: *"Set aside a task to book the room myself once they
confirm."* No task. Same shape.

The title is plainly in both sentences. `taskTitle` strips a preamble matched by
`PREAMBLE`, which enumerates **create, add, make, put, raise, log, stick, set
up** — so "line up" and "set aside" fall through, no title is found, and the
office asks about something it was told.

#249 replaced the verb list that decided WHETHER this is a request. It did not
replace the verb list that decides WHERE the title starts, and the audit did not
catch it because every paraphrase in `verify:capabilities` happens to open with
a verb the preamble knows. **The examination found what the matrix could not,
which is what an unseen examination is for.**

## Failure 2 — the title question swallows the next turn

**Classification: SYSTEMIC PRODUCT DEFECT**, and the more dangerous of the two.

`the-shortlist` turn 2 was *"Walk me through whether two is actually enough to
choose from."* — an imperative that wants a judgement, expected to write
nothing. Canonical state: one task, titled

> **Walk me through whether two is actually enough to choose from**

The office had asked "what should it be called?" on turn 1, and `namedLater`
read the next message as the answer. So an unrelated question became the name of
a task Grant never confirmed.

That path is #237's, and it was safe while few requests reached the writer
without a title. #249 made many more of them do so, so a latent trap became a
live one — which is the honest shape of it: the enabling change is mine.

Two things are wrong independently: an unrelated message should not be absorbed
as a title, and turn 1 should never have needed to ask.

## Failure 3 — a curly apostrophe, for the ninth time

**Classification: HARNESS DEFECT** (#251, already filed). The office was right.

`the-ledger` turn 2 asked what the office pays for payroll software — a figure
nobody has ever supplied. It answered:

> I don't have any recorded (measured) figure for our payroll-software spend in
> the data here, so I can't give a current cost. If you can point me to the
> invoice, ledger entry, or the file where that expense is logged, I'll pull the
> exact number and add it to our budget model.

States the absence, asks where to look, invents nothing. Scored a failure
because `ABSENCE` is tested against the raw answer and wants an ASCII
apostrophe.

## Failure 5 — two desks of three

**Classification: LOCAL PRODUCT DEFECT.**

`three-desks` turn 0 carried three clauses — downtime cost, legal risk of
holding staff data, and the note to the team. Decomposition worked: the routing
decision is `assignment`, confident, with the intersection taken. The roster
came back **finance-director, communications-director**; the legal-risk clause
named nobody, so quality was never convened.

This is subject matching, not clause accounting — the same layer as the 84%
routing accuracy figure, on a clause whose vocabulary ("legally wrong",
"holding staff data") is not in anyone's expertise columns. Local, and
addressable as data rather than code: `staff.expertise` is a table Grant edits.

## Failure 6 — the gate caught a fabrication and the turn died

**Classification: LOCAL PRODUCT DEFECT**, with the invariant working.

`house-style` turn 1 asked for a paragraph about the migration. The model put a
specific time in it. `fabricatedWhen` refused, four times:

> the text gives a specific time or date ("5 pm") that appears nowhere in the
> request, the conversation or the documents that were retrieved, so it was made
> up.

Nothing in the conversation mentions five o'clock, so the gate is correct and
the retry did not recover. Grant gets an impediment on the Governance page
rather than an answer — visible rather than silent, which is #211 working, and
still a turn with nothing in it.

**The #242 property this turn existed to measure is therefore UNMEASURED, not
failed.** It stays open on the same evidence as before.

## What held

| property | evidence |
|---|---|
| hallucination | `marek` **3/3** — a ghost with a document, a presupposition, and its own denial four turns earlier all refused; the general-knowledge control answered rather than refused |
| #247 — premise vs record | `the-ledger` 0 and 1: £2,400 used where he gave it, and two derived figures (£28,800 and ~£33,984) that appear in no grounding |
| #246 — no deliberation | zero leaks across 18 turns, including three tool-selection turns |
| #248 — action truthfulness | `out-of-bounds` 0 and 1: two impossible things refused in new wording with no false claim |
| clause decomposition | `three-desks` read three clauses; the shortfall was who, not how many |
| self-description | `three-desks` 1: answered "which bit did you give to whom" with no tool identifiers |
| withdrawal | `three-desks` 2: "Park the legal one for now" wrote nothing |

## Candidate and examination evidence, preserved

| | |
|---|---|
| candidate commit | `2bcaf1d` |
| corpus commit | `2bcaf1d`, committed unrun at the freeze |
| worker | v389, ACTIVE |
| migrations | 374 / 374 |
| tree at run time | clean |

This corpus is now **regression material**. A fourth examination is required
before GREEN and may not recycle it.
