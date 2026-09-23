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

### Pass 1 — deliberate retries, repeats and cancellation (deployed v783 → v784)

Territory: idempotency crossed with deliberate retries; repeating a request;
the authorisation that permits duplication. Materially different from pass 0.

**NOT CLEAN — three systemic PRODUCT defects, all fixed.**

1. **The clause that authorises duplication read a paraphrase.**
   `wantsAnotherGo` was reading the thread resolver's rewrite. Driven live,
   both directions occur: a deliberate retry lost, and one manufactured.
   Fourth instance of the grounding-asymmetry class, and the first where the
   rule is asymmetric — a guard that PERMITS may not read a paraphrase at all.
2. **A reminder to make something was read as a request to make it now**
   (#325, closed). Both recognisers fire on his own words; the artifact
   reading won and the reminder was never added.
3. **A repeated request was narrated as deduplicated and started anyway.**
   `alreadyOn` gated the roster hand-off and `planAndPursue` and not the three
   branches that start work.

Evidence: `scripts/poc/resolver-vs-retry.ts` (the live resolver against four
elliptical retry fragments) and `npm run verify:another-go` (three real turns
through the deployed worker; it found defect 3 on its first honest run).

Sabotage: seven in total across the three fixes, each printed as landed and
each turning the intended checks red.

Measured frequency: zero occurrences of `again`, `remind` or an artifact
deferral in Grant's 313 real messages, against a control finding `report` 5
times and `task` 9 — so the filter works and these shapes have not yet arisen
in a corpus this size. All three are features he asked for, and the
consequence of each is silent: duplicated work, or work silently replaced by
different work.

Also classified, and **not** defects: eight real specialist answers finished
after their parent and were never delivered — five `notebook.generate`, two
`notebook.add_source` (mechanical steps the parent relays, `announce=false`)
and two belonging to `verify:escapes`' deliberately real-looking positive
control. EXPECTED BEHAVIOUR and INSTRUMENT respectively.

Clean-pass count after pass 1: **0 of 5.**

## Outstanding investigations

- ~~**#325**~~ — closed in pass 1. The collision was demonstrated on his own
  words and does not need the resolver at all.
- **`verify:escapes` leaves two children attributed `telegram:grant`.** Its
  teardown rewrites its parents and not the work they handed on, so two jobs
  sit permanently in every "real traffic" query. Measurement contamination
  rather than an escape — nothing was delivered.
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
