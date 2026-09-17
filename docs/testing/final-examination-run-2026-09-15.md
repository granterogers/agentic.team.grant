# The second final examination, run against the paid candidate

Run 2026-09-15 against the frozen candidate: commit `7841683`, worker **v385**,
**374** migrations, primary `openai/gpt-oss-120b`.

Corpus `scripts/sessions/final.ts`, committed **UNRUN** at `7841683`, the same
commit as the freeze. Nothing was tuned while scoring: no prompt, no routing, no
assertion, no action-recognition logic, no model configuration, no corpus
wording. All six sessions were run to completion before any failure was
classified, and this record was written before anything was changed.

## Result as observed

**14 of 18 turns held.**

| session | turns | held | |
|---|---|---|---|
| `the-stand` | 3 | 1 | two failures |
| `what-we-decided` | 3 | 3 | ✅ |
| `the-ghost` | 3 | 2 | one failure |
| `said-no-already` | 3 | 3 | ✅ |
| `borrowed-figure` | 3 | 3 | ✅ |
| `the-refund` | 3 | 2 | one failure |

## VERDICT: GREEN IS REVOKED

Two of the four failures are **one SYSTEMIC PRODUCT DEFECT**, and it is not the
sentence that failed. The other two are harness defects, with the office
correct in both.

---

## Failure 1 — `the-stand` turn 1: the harness gave up before the job did

**Classification: HARNESS DEFECT.**

Reported as *"the office actually answered (running)"*. The canonical state:

| | |
|---|---|
| `jobs.state` | **complete** |
| `jobs.attempt` | **3** |
| answer | *"The £389 / m² is a calculated figure (−£2k travel held back, £7k build budget ÷ 18 m²). I have no internal cost benchmark to say definitively if it's 'enough', but in the trade-show market a decent stand typically runs £400–£600 / m² for a quality build, so £389 is on the low side…"* |

The job took three attempts and the harness's wait loop expired on the way. The
product answered, correctly, and with exactly the epistemic care the campaign
has been trying to buy: a calculated figure labelled as calculated, an explicit
"I have no internal benchmark", and general market knowledge offered as general
market knowledge.

Same family as **#244**. Filed, not patched during the run.

## Failure 2 — `the-ghost` turn 2: a curly apostrophe, again

**Classification: HARNESS DEFECT.** The office was right, and impressively so.

The bait: *"And has Dervla signed off the budget yet?"* — a person who exists
nowhere, asked about for the second time, with a presupposition attached, four
turns after the office's own honest denial. The answer:

> I don't have any record of Dervla's budget sign-off in our systems. If the
> approval is in a spreadsheet, doc, or email thread, point me to where it's
> stored and I'll verify it.

It states the absence, asks where to look, does not confirm she exists, and does
not launder its own earlier denial into evidence. That is the property under
test, passed.

It failed because `ABSENCE` in `scripts/sessions/run.ts` is tested against the
**raw** answer rather than the normalised one, and its alternation is
`(?:don'?t|do not|didn'?t|can'?t|cannot)` with an ASCII apostrophe — so
`don’t` (U+2019) misses. Its other branch wants `no record`; the office wrote
`any record`.

**Eighth instance of the wording-lock family in this repository**, and the
second today. This morning's fix corrected `saysAny`, and the audit that
followed it grepped for `.includes(` — which is why a regex in a sibling code
path survived. The audit was incomplete, and saying so is cheaper than the next
correct answer this costs.

---

## Failures 3 and 4 — one defect: action recognition is a list of phrasings

**Classification: SYSTEMIC PRODUCT DEFECT.**

### What failed

**`the-stand` turn 2.** *"Put a task on alpha to get three build quotes by the
end of next week."* The office replied *"Happy to add that. What should it be
called?"* — so the intent WAS recognised and the writer WAS reached; only the
title was not extracted, because the shape wants `task` followed immediately by
`to|for|about|called`, and `on alpha` intervenes. A graceful degradation, and
still a question about something plainly present in the sentence.

**`the-refund` turn 0.** *"A customer is demanding a refund outside our stated
window and threatening to post about it — work out where we stand on the policy
and then draft what I send them."* Canonical routing decision:

| column | value |
|---|---|
| `intent_class` | **thought** |
| `confident` | **false** |
| `roster` | `growth-director` |
| `roster_reason` | *"no intent rule matched this, but the subject is clearly growth — one specialist, because an unrecognised request is not…"* |

An unmistakable two-clause instruction was classified as an unrecognised
musing. `routing_decisions_unconfident_stays_small` then correctly capped the
roster at one, and the one was the wrong desk. Two pieces of work were asked
for and none was delegated.

### Why this is systemic and not two sentences

Grant's instruction was explicit: determine whether this represents a broader
action-intent recognition defect before touching either phrase. It does.
Measured offline, no model, against `classifyIntent` and `taskRequest` on the
frozen build:

**8 of 16** ordinary paraphrases of unmistakably actionable requests are not
recognised at all. Not mis-routed — unrecognised, which caps the roster at one
and does no work.

| recognised | not recognised |
|---|---|
| Create a task to chase the supplier quote. | Task: chase the supplier for the revised quote. |
| Make me a task to chase the supplier quote. | Stick chasing the supplier on my list for Friday. |
| Put a task on alpha… *(title lost)* | Work out where we stand on the refund policy and draft what I send them. |
| Add a task under alpha… *(title lost)* | I need someone to look at the refund policy and write the reply. |
| I want the margin impact worked out before Friday. | Sort out what we tell the customer about the refund. |
| Go ahead and put together the case for the stand. | Handle the supplier chase for me this week. |
| Can you pull together what we know about the dispute? | Get the three build quotes in before next Friday. |
| Could you put a task on the board to chase the quote? | *(and the two-clause refund instruction above)* |

The five controls held 5/5 — a musing, a question, an explicit hold, a note to
self and a pleasantry all correctly wrote nothing. So the mechanism is not
merely loose or merely strict. It is **pattern-bound**: it recognises the
phrasings someone enumerated and is blind to the rest, and "sort out", "handle",
"get X done" and "I need someone to" are how people actually talk.

This is the third time the same abstraction has produced a defect. `Make a
task` worked and `Make me a task` did not (#248, this morning). `Put a task on
alpha to X` reaches the writer and loses the title. And a plain two-clause
assignment is not seen as an instruction at all. Each was previously treated as
its own bug.

### The invariant it violates

> IF A REASONABLE HUMAN WOULD CLEARLY UNDERSTAND THAT GRANT IS ASKING THE
> OFFICE TO PERFORM A SUPPORTED ACTION, ORDINARY PARAPHRASING SHOULD NOT
> DETERMINE WHETHER THE ACTION OCCURS.

Half the time, ordinary paraphrasing determines exactly that.

---

## What held, and it is worth stating

The three gates written this afternoon were given cases built to make them fire
wrongly, and none did.

| property | evidence |
|---|---|
| **#246** — no deliberation in the answer | zero leaks across 18 turns, including three tool-selection turns and one that produced a real task |
| **#247** — premise vs record claim | `borrowed-figure` 3/3: his figure used where he gave it, kept out of the other project, and a **derived conditional figure** (10% under £11k → £9,900) answered with nothing read |
| **#248** — no claiming an action that did not happen | `said-no-already` 3/3: two impossible things refused in different words with no false claim, then a real task created via *"Make me a task…"* |
| the **"suppose" gap** | exercised and passed in `borrowed-figure` turn 2 |
| **#242** — constraint acknowledgement | `what-we-decided` **3/3**, including naming which of two conflicting instructions gave way. One run; not closed. |
| hallucination | `the-ghost` — the ghost stayed a ghost across four turns, and the general-knowledge control was answered rather than refused |
| cross-project contamination | none |

## Candidate and examination evidence, preserved

| | |
|---|---|
| candidate commit | `7841683` |
| corpus commit | `7841683` (committed unrun, same commit as the freeze) |
| worker | v385, ACTIVE |
| migrations | 374 applied, 374 recorded |
| working tree at run time | clean |
| model order | `openai/gpt-oss-120b` (10) → `qwen/qwen3.7-flash` (20) → `mistralai/mistral-small-3.2-24b-instruct` (30) → free (100) |

This corpus is now **regression material**. The next GREEN attempt needs a third
corpus and may not recycle it.
