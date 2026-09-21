# ADR-0046 — Re-planning never expands authorization, and a finished plan is not a met goal

**Status:** Accepted · 2026-09-21 · Issue #283

## Context

ADR-0045 settled what a plan IS: a proposal, whose every acting step is asked
for permission twice — once when it is planned, and again, deterministically,
at the moment it runs. That leaves two questions it deliberately did not
answer.

The first is what happens when a plan runs to the end and the goal is still not
met. A step that finds nothing is not the same as a goal that cannot be
achieved: *"find out what we agreed about the pricing"* may look in the wrong
place first. Without a second attempt the office gives up at the first empty
result, which is the behaviour a person would call unhelpful rather than
careful.

The second is how the office knows the difference at all. Every orchestration
layer in this repository reported success the same way — every step ended —
and CLAUDE.md records what that costs: an output can contradict its own
metadata, and nothing was comparing them. **"All plan steps ended" is not
equivalent to "Grant's goal was achieved."**

Both additions are exactly the kind that go wrong quietly. A re-planning loop
is an unbounded loop until somebody bounds it, and a re-planned action is an
action nobody approved unless the authorization is re-asked. This record states
the lines, because each is one a future change could cross without noticing.

## Decision

### 1. The loop is bounded by construction, not by intention

`src/handlers/pursue.ts` runs at most **3 rounds** and **120 seconds**. Both
are constants in the handler, checked before a round begins, and a run that
reaches either bound reports what it achieved rather than failing.

Bounds are not enough on their own, because a model can produce the same plan
for ever inside three rounds. `tried` is a Set of
`${goal}|${sorted unmet step ids}` — a fingerprint of the STATE the round is
reacting to — and a round whose fingerprint has been seen ends the loop. So
does a re-plan that returns the fallback plan, and one that returns a plan
identical to the plan just run.

### 2. A round re-plans because of a new observation

`planFor(..., again?: Again)` takes what was learned, what is still unmet and
what has already been tried, and instructs the model to *"plan ONLY another
route to the unachieved part."* The fast path is skipped when `again` is
supplied.

The distinction this protects is between re-planning because the world turned
out differently and re-planning because the model changed its mind. Only the
first is a reason, and only the first can produce a fingerprint that has not
been seen.

### 3. Re-planning never expands authorization

This is the line that matters most, and it is kept by having no separate path:
a re-planned step is compiled by the same `compile()` and executed by the same
executors as a first-round step, so it passes the same `mayAct` check, at the
same moment — execution time, not planning time.

Three consequences follow, and each has a check behind it:

- a permission revoked between planning and acting stops the step, whichever
  round planned it;
- an `ask` verdict pauses the job with `awaiting_approval` bound to the step,
  the capability and the project, and raises a blocker that appears on Grant's
  list — a re-planned action cannot slip past the question a first-round action
  would have asked;
- a refusal, or a capability the registry says is not built, is **`final()`**
  in `src/agents/satisfied.ts`: it is never worth another route, *however much
  else in the plan succeeded*. Re-planning around a refusal is the one way this
  design could have become an authorization bypass, and it is closed by a
  shared predicate rather than by a rule in two places.

### 4. Goal completion is assessed deterministically, and never authorizes

`src/agents/satisfied.ts` returns one of seven verdicts — `satisfied`,
`partially_satisfied`, `blocked`, `awaiting_grant`, `impossible_here`,
`temporarily_unavailable`, `failed` — from canonical effects: the step
outcomes, the impediments, and the receipts in `public.job_steps`. No model is
asked. The assessor decides only *whether another route is worth trying*; it
cannot start one, cannot grant anything, and has no access to an executor.

`satisfied` requires a **receipt** when the plan contained an acting step. A
plan that only reads is satisfied by having read. This is what stops the office
claiming it created a task when nothing in canonical state says it did.

### 5. Missing capability is not bad planning

The catalogue the planner is shown marks a declared-but-unbuilt capability
`NOT YET BUILT — the office can only refuse it`, and the prompt tells the model
to prefer a built capability or answer `unreachable`. So *"the planner did not
use something it had"* and *"the office does not have it"* are different
verdicts arrived at by different routes, and neither is improved by inventing
`web.search`.

## Consequences

- A goal that a first plan does not meet gets one other route, and no more than
  two, and the second route is authorized exactly as strictly as the first.
- Grant is told which of seven things happened, in ordinary language, with the
  steps that ran and the receipts that prove them.
- The loop cannot run away: three bounds, a fingerprint, and two plan-identity
  checks, all deterministic.
- The cost of this honesty is that `satisfied` is harder to reach than "every
  step ended". That is the intended direction. A wrong `partially_satisfied` is
  a sentence Grant can argue with; a wrong `satisfied` is a claim he acts on.

## What would reverse this

Any of these, and each should be treated as a defect rather than a refinement:

- a re-planned step that is executed through a path other than `compile()`;
- `final()` gaining an exception, so a refusal can be routed around;
- the assessor being handed a model, or being allowed to return an action;
- the bounds becoming configuration a plan can raise;
- `satisfied` being reachable without a receipt for an acting plan.
