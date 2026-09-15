# Backend acceptance — the verdict

**2026-09-15. VERDICT: GREEN.**

Candidate `63c5a26`, worker **v391**, **375** migrations, primary
`openai/gpt-oss-120b`.

## The question

> Is there any backend or intelligence reason Grant should NOT begin serious
> daily human use and UX testing on the current paid production configuration?

**No.**

## What that rests on

Four final examinations, each written after the previous one, each committed
unrun against its own frozen candidate, and none of them recycled.

| examination | result | what it found |
|---|---|---|
| `hostile.ts` vs `6de6dfc`/v364 | 15/18 | #246 deliberation in user-facing output, #247 a premise read as a records claim |
| `final.ts` vs `7841683`/v385 | 14/18 | #248 claiming an action that did not happen, #249 action recognition as a list of phrasings |
| `third.ts` vs `2bcaf1d`/v389 | 12/18 | #254 extraction still enumerated by verb, #255 a pending question consuming the next turn |
| **`fourth.ts` vs `63c5a26`/v391** | **17/18** | **no systemic defect** |

The fourth examination's single failure is an expectation this session wrote:
`noWrite` is implemented as "no task exists for the session", and turn 1 of that
session legitimately created one. Canonically verified — exactly one task, from
turn 1 — and the turn-2 answer was an imperative-that-is-a-question answered as
a judgement, with what the office holds separated from what it was estimating.

Three examinations found real defects and the fourth did not. That pattern is
the evidence, not any single run.

## Gates at the verdict

| gate | result |
|---|---|
| `npm run gate` | **19/20** |
| unit tests | **1,415** across 72 files |
| `verify:asks` | recall **37/37**, held out **21/21**, precision **41/41** including 20 semantic mutations |
| `verify:capabilities` | **10/10** — every advertised action classified, `task.create` proven end to end |
| `verify:harness` | 3/3 |
| `verify:answers` | 6/6 |
| `verify:attests` | 11/11 |
| `verify:recovers` | 17/17 |
| `verify:reach` | 9/9 |
| `verify:router` | 14/14 |
| `verify:fallback` | 16/16 |
| `verify:boundary` | 57/57 |
| `npm run matrix` | 96/96 applicable cells |
| `npm run breadth` | 37/37 dimensions |

The one red in the gate is `verify:routing-breadth`'s trivial-work check —
**#252**, a filed stochastic gate that fails on the pre-#249 baseline too and
names different cases on each run. Every other check in that suite is green,
including all seven reachability checks and the canonical-agreement check.

## What GREEN does not claim

| | |
|---|---|
| **#242 / L19** | The office still does not reliably say which constraint it set aside. The condition held in two unseen corpora on different wording — `what-we-decided` and `shorthand`, both 3/3 — which is materially better evidence than before and is **not** the repeated-runs evidence #242 itself asks for. The mechanism it wants still does not exist. **Open. A caveat on GREEN, not a bar**: the office does the most useful thing, it sometimes omits saying what it dropped. |
| **L25** | Four advertised mutations — a calendar entry, a Notion page, a NotebookLM artifact, a Slack message — are recognised and argument-extracted correctly and have never been canonically executed by a suite, because doing so would break the standing test rules. The first time Grant asks for one in real work is the proof. |
| **L26 / #253** | A task's due date, assignee and detail are representable and never extracted. A gap, not a loss: the deadline stays in the title where Grant can read it. |
| **L27** | #250 and #252, harness only. |

## Cost

**$0.0082 a day** at the busiest measured real traffic — about **$0.25 a
month**. The ~£0/month constraint survives.

## The campaign ends here

Three examinations earned a fourth by finding real defects. The fourth passed
the defined acceptance standard, so the standard is met and the campaign stops.
Not because nothing further could be tested — an unbounded number of tests can
always be imagined, and that is not a reason.

**Next phase: Grant human beta.** Real usage becomes the primary source of
behavioural findings, and every genuine failure found there becomes a permanent
regression.
