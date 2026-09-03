# ADR-0008 — The job state machine has fourteen states, not nine

**Status:** Accepted · **Date:** 2026-09-03

**Resolves** a contradiction between `AI_TEAM_HQ_MASTER_SPEC.md` §6 and both
`docs/design/core-invariants.md` §4 and `docs/implementation-plan.md`.

## Context

Master spec §6 lists **fourteen** job states:

```
queued · running · waiting_external · waiting_user · output_created
quality_review · committing · committed · notifying · complete
retrying · paused · cancelled · failed
```

`core-invariants.md` §4 describes **nine**: `queued → running → output_created →
quality_review → committed → notified → complete`, plus `failed` and `retrying`.
`implementation-plan.md` inherited that count, and its Phase 1 acceptance
criterion reads *"a job survives a hard kill at every one of its nine states"*.

The master spec is canonical and says so in its own header, so the count was
never really in doubt. What is worth recording is that the nine-state version is
not merely smaller — **it cannot express two things Phase 1 is required to
prove.**

### `committing` and `notifying` are what make §18 testable

§18 requires an explicit degradation test for a **crash after commit but before
notification**. With nine states there is one `committed` state and delivery
happens somewhere inside it, so a job found in `committed` after a crash is
ambiguous: did it notify or not? The only options are to notify again (Grant
gets duplicates) or assume it did (Grant silently never hears).

Splitting `committing → committed → notifying` makes the crash point a matter of
record rather than inference. A job in `committed` is durable work with delivery
outstanding; a job in `notifying` was mid-delivery. Both are recoverable, and
neither requires guessing.

### `waiting_external` and `waiting_user` are a policy distinction, not a detail

§12 requires anything needing Grant to become a structured **blocker object**
with a deadline, consequences and approval options. Nothing of the sort is
required when a job is merely waiting on a provider. §6 separately requires
long-running work to surface *"blocked / waiting-on-provider / waiting-on-Grant"*
rather than looking stuck.

Collapsing both into `running` — as nine states must — means the distinction has
to be recovered from a side field, and the state machine no longer answers the
question the UI asks it.

### `paused` and `cancelled`

§6 makes cancellation and pause first-class: *"stop that", "pause it", "cancel
the research" must work.* Nine states has `cancelled` nowhere at all.

## Decision

**Fourteen states, exactly as §6 lists them, in that order.**

Transitions are an explicit allow-list in `src/jobs/states.ts`, because §6
requires transitions to be *"constrained and logged"* and an allow-list is the
only form of that a test can prove. Four consequences of the graph are worth
naming, since each encodes a rule from elsewhere in the spec:

| Edge that does **not** exist | Why |
|---|---|
| `output_created → committing` | §10: the quality gate cannot be bypassed by the caller. The only route to `committing` runs through `quality_review`, and a test enumerates every path to confirm it. |
| `committing → cancelled` | A cancel racing the commit would make `committed` unreliable, and `committed` is the one thing recovery reads. |
| `committed → cancelled` | It happened. Undo is a compensating event (§6), never a state change. |
| `retrying → running`, `paused → running` | §6 enforces capacity **at dequeue**. Re-entering `running` directly would let a retry storm walk straight past the limits. Both go back to `queued`. |

The states are also partitioned into three groups, and a test asserts the
partition is total and non-overlapping:

- **terminal** (3): `complete`, `cancelled`, `failed`
- **in-flight** (6): the boot recovery sweep must reconcile these
- **dormant** (5): no worker holds them; the sweep must leave them alone

**`committed` belongs to in-flight**, which is the subtle part and was got wrong
in the first draft of the implementation. Work in `committed` needs no redoing —
but delivery has not happened, so the sweep must carry it to `notifying`. Treating
it as stable produces correct work that Grant never hears about, which is the
quietest possible failure. Conversely `paused` must stay dormant, or every
restart silently resumes work Grant told it to stop.

## Consequences

- `core-invariants.md` §4 and `implementation-plan.md` are corrected to fourteen.
  The acceptance criterion becomes *"survives a hard kill at every one of its
  fourteen states"* — five more kill tests than planned.
- The `job_state` database enum has fourteen values, and the transition
  allow-list is enforced in both application code and a database trigger, so a
  direct SQL write cannot make an illegal move either.
- Five extra states mean five more ways to be stuck, so the "long-running work
  must not look stuck" requirement is more load-bearing, not less.

## What would reverse this

Nothing short of the master spec changing. If a state proves genuinely
unreachable in practice after Phase 3, that is an argument for removing that
state with evidence and a new ADR — not for reverting to the nine-state sketch,
which fails §18 by construction.

## Lesson recorded

A subordinate design document paraphrased the specification and lost two
requirements in the paraphrase — silently, because the paraphrase read as
reasonable. The count was the visible symptom; the missing crash-recovery
precision was the actual cost.

Where a document restates a canonical requirement, it should **quote or
reference** it rather than re-describe it. `src/jobs/states.ts` now transcribes
§6's list, and the test transcribes it a second time independently, so a drift
between spec and code fails CI rather than surviving review.
