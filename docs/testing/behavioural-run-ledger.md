# Behavioural discovery — durable run ledger

**This file exists so a compaction, or a fresh Claude context, can resume the
programme without losing its objective, its evidence, its stopping criteria or
its outstanding investigations.** Read it after `CLAUDE.md` and
`docs/AUTONOMOUS-RUN.md`. Append to it at the end of every pass, before
anything else.

## Objective

Discover, diagnose, fix, verify and deploy meaningful **backend behavioural and
reliability defects** found through realistic multi-turn use of the office, and
continue without waiting between iterations until a defensible stopping point
is reached.

Not in scope: frontend or UX work, merging to `main`, clearing the Issue
backlog. **Known Issues are not the work queue.**

## The loop

DISCOVER -> CLASSIFY -> ESTABLISH CANONICAL TRUTH -> ROOT CAUSE -> FIX IF
JUSTIFIED -> VERIFY -> SABOTAGE -> RECONCILE -> DEPLOY -> VERIFY THE DEPLOYED
WORKER -> CLEAN UP -> DISCOVER AGAIN.

Every surprise is classified before it is acted on: **PRODUCT / INSTRUMENT /
EXPECTED BEHAVIOUR / STOCHASTIC VARIANCE / UNKNOWN**. A red or green result is
not evidence until the check has been shown to observe the intended mechanism
and to fail under sabotage.

## Stopping criteria

**Five consecutive qualifying clean passes** across materially different
behavioural territories, then **one final adversarial synthesis pass**. A pass
qualifies as clean only when it:

1. exercised a materially different territory from the previous passes;
2. ran multi-turn, against the deployed worker, not only in unit tests;
3. produced canonical evidence (job rows, outputs, obligations, deliveries),
   not model narration;
4. classified every surprise;
5. demonstrated its own checks could fail under sabotage;
6. left no debris and no new synthetic-to-real escape;
7. found no meaningful systemic PRODUCT defect.

If the final adversarial pass finds a defect: fix it, **reset the count to
zero**, and continue.

## Containment — STOP THE LINE

No harness traffic may reach real Telegram or Slack, alter real preferences or
lessons, create tasks Grant can see, contaminate real dashboard projects, or
trigger uncontrolled external side effects. The two preserved #298 escapes are
**evidence and are never rewritten to obtain green**; they are acknowledged in
`public.known_escapes` and `check:leaks` reports them as *known historical* and
fails only on *new*. **Any new synthetic-to-real escape stops the programme.**

## Pass ledger

### Pass 0 — `long-day`, twelve turns, two projects (deployed v781)

Territory: long sessions where state changes repeatedly; dictated language;
memory-dependent work; corrections; changed intent.

**NOT CLEAN — two systemic PRODUCT defects, both fixed.**

- A status question convened two more specialists and spawned a second
  synthesis, because `aboutTheWork` read the resolver's rewrite while the
  action it guards reads Grant's own words. Third instance of the
  **grounding-asymmetry** class (after `namedLater`, #322).
- *"Write me a document on..."* and *"I want a one-pager"* were not recognised
  as artifact requests at all, so the office answered "I could not carry it
  out" over a capability it holds.

Filed and closed as **#327**. Verified live on v781: turn 1 produced 0 children
and an obligation answer; turn 2 produced one `artifact.report` child.

Clean-pass count after pass 0: **0 of 5.**

## Outstanding investigations

- **#325** — `wantsFile`'s veto reads the rewrite while `changesHis` reads his
  words. Structural watch item from the same class as #322/#327; no collision
  demonstrated yet.
- **#326** — `check:migrations` passes while migrations are applied to the
  shared database but absent from this branch.
- **#321** — `taskTitle` borrows `requestBody`'s object extraction as a title.
- **#319** — the contested-intent cap; evidence only unless real traffic shows
  routing harm.

## Invariants earned in this workstream, not to be regressed

- **#320** — the office must not deny a capability the deployed system can
  actually perform in that context, and must keep *cannot* / *needs something*
  / *this attempt failed* / *done* distinct.
- **#318** — `npm run delegation` may return an honest INCONCLUSIVE.
- **#313/#322/#327** — a veto must be at least as grounded as the thing it
  vetoes.
- **#298** — containment, and its preserved evidence.
