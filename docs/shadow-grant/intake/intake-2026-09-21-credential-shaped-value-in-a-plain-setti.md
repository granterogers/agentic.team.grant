# credential shaped value in a plain setting

**Classification:** SYSTEMIC PRODUCT DEFECT
**Channel:** unknown
**Recorded:** 2026-09-21

## What was said

> I pasted [redacted:slack] into the box

## What was expected

it refused

## What happened

it stored it

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

**credential shaped value in a plain setting**

The sentence above is one instance. Before anything is changed, write down
three more instances that share the shape and none of the words, and check
whether they fail too. If they do not, this is a local defect. If they do,
it is a class, and the fix belongs at the level of the class.

## Regression

Paste the family below into `src/simulation/goals.ts` and it joins every
future run — baseline, held-out, Shadow Grant and variance — automatically.
