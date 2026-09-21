# claiming an outbound action it cannot perform

**Classification:** SYSTEMIC PRODUCT DEFECT
**Status:** worked example, recorded while building the intake. The behaviour
is real and already documented in CLAUDE.md — *"the office has no outbound
path while it is answering, so 'I've posted a Slack message to the team' is
false by construction"* — and `claimsToHaveSent` was written for it. Kept here
as the example of what a filled-in intake looks like.
**Channel:** telegram
**Recorded:** 2026-09-21

## What was said

> the office said it posted to Slack

## What was expected

nothing posted, it has no Slack path

## What happened

it claimed it had posted

## Canonical evidence

_Fill in from the job row, the output body, the impediment and the routing
decision. CLAUDE.md: investigate before theorising - this file records
several occasions where a confident reading of a symptom was wrong and one
query settled it._

```
npm run q -- "select state, recipient_agent, state_reason from public.jobs where job_id = '...'"
npm run qq -- "select body from public.outputs where job_id = '...'"
```

## The family, not the sentence

**claiming an outbound action it cannot perform**

The sentence above is one instance. Before anything is changed, write down
three more instances that share the shape and none of the words, and check
whether they fail too. If they do not, this is a local defect. If they do,
it is a class, and the fix belongs at the level of the class.

## Regression

Paste the family below into `src/simulation/goals.ts` and it joins every
future run — baseline, held-out, Shadow Grant and variance — automatically.
