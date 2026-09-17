# The fourth final examination

Run 2026-09-15 against the frozen candidate: commit `63c5a26`, worker **v391**,
**375** migrations, primary `openai/gpt-oss-120b`.

Corpus `scripts/sessions/fourth.ts`, committed **UNRUN** at `63c5a26` — the same
commit as the freeze. Tree clean at run time. All six sessions run to
completion before any failure was classified; nothing changed while scoring.

## Result as observed

**17 of 18 turns held.** The one failure is not the product.

| session | turns | held | |
|---|---|---|---|
| `the-application` | 3 | 2 | one harness failure |
| `the-unnamed-thing` | 3 | 3 | ✅ |
| `the-pallet` | 3 | 3 | ✅ |
| `cant-can` | 3 | 3 | ✅ |
| `three-ways` | 3 | 3 | ✅ |
| `shorthand` | 3 | 3 | ✅ |

## No systemic product defect

## The single failure — `the-application` turn 2

**Classification: HARNESS DEFECT**, in an expectation I wrote.

`noWrite` is implemented as `taskCount === 0`, where the count is **tasks for
the whole session**. Turn 1 of that session legitimately created one, so
`noWrite` on turn 2 could never pass whatever the office did.

Canonical evidence that the office wrote nothing:

| | |
|---|---|
| tasks in the session | **exactly one**, *"bottom out the match funding by the tenth"*, created at turn 1 |
| turn 2 | no task, no mutation |

And the turn-2 answer, which is the behaviour the turn existed to test:

> I don't have any internal data on past match rates, so I'm estimating from
> industry norms: most grant-matching programs sit around 20–50%, so 15% is on
> the low side but still plausible for a smaller, less-restrictive funder. It's
> an estimated comparison, not…

An imperative that wanted a judgement, answered as a judgement, with what it
holds separated from what it is estimating, and nothing written.

The expectation should have been "no NEW task this turn". Filed; `noWrite` is
only usable in a session where nothing earlier writes, which is a limitation
worth removing rather than remembering.

## What the examination proves

Both defects the third examination found, on ground neither was written
against:

**#254 — extraction without the verb.** *"Square away a task on alpha to bottom
out the match funding by the tenth."* Two verbs no matrix contains, a project
adjunct and a deadline. The task was created and named **"bottom out the match
funding by the tenth"** — adjunct removed, deadline kept, and nothing in the
source knows either verb.

**#255 — the clarification state machine, all three cases in one session.**

| turn | said | outcome |
|---|---|---|
| 0 | *"Tee up a task."* | asked what to call it, wrote nothing |
| 1 | *"Actually, what did we decide about the warehouse handover date?"* | **topic switch — nothing created**, which is the exact defect the third examination found |
| 2 | *"Call it warehouse keys handover."* | task created, two turns late, after an intervening topic switch |

The case the policy refuses and the case it allows, both proven in sequence.

## Everything else that held

| property | evidence |
|---|---|
| hallucination | `the-pallet` **3/3** — a document nobody mentioned, then a second ghost with a presupposition attached to the first, both refused; the general-knowledge control answered rather than refused |
| #247 — premise vs record | `the-application` 0: £42,000 and 15% both his, £6,300 and £48,300 both derived, nothing sourced to records |
| #248 — action truthfulness | `cant-can` **3/3** — a send and a calendar write refused in wording nothing was tuned on, with no false claim, then a real task created via a fifth unseen verb |
| #249 — precision | `three-ways` 1: four non-actions in one message — a musing, an example frame, a rejected action and a past decision, each naming a capability — and nothing was written |
| clause decomposition | `three-ways` 0: three clauses, three desks, including the legal clause that 0375's expertise data now reaches |
| withdrawal | `three-ways` 2: *"Leave the legal one alone for now"* wrote nothing |
| **#242** | `shorthand` **3/3**, including naming which of two conflicting instructions gave way — the second unseen corpus in a row to hold it |
| #246 | zero deliberation leaks across 18 turns |

## Candidate evidence, preserved

| | |
|---|---|
| candidate commit | `63c5a26` |
| corpus commit | `63c5a26`, committed unrun at the freeze |
| worker | v391, ACTIVE |
| migrations | 375 / 375 |
| tree at run time | clean |
| model | `openai/gpt-oss-120b` → `qwen/qwen3.7-flash` → `mistralai/mistral-small-3.2-24b-instruct` → free |
| budget | prompt ≤ $0.20/M, completion ≤ $1.00/M, $0.01 per response, `data_collection: deny` |
