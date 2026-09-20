# ADR-0045 — A plan is a proposal, and permission is asked twice

**Status:** Accepted · 2026-09-20 · Issue #283

## Context

ADR-0044 settled the sentence *"the model understands the human; deterministic
code controls reality"* one level up, at understanding. #283 asked whether the
same inversion holds one level DOWN, at planning and orchestration — and found
that it did not, because there was no planning layer at all. `plan.ts` admits
it in its own header, five of six probe requests produced no action, and the
recogniser cascade handled **0 of 16** multi-step requests in the measured
corpus.

Adding a planner means letting a model decide what the office DOES, which is
the exact place where a design goes wrong quietly. This record states the four
constraints that keep it honest, because each of them is a line a future change
could cross without noticing.

## Decision

### 1. The planner runs ONLY where the cascade declined

`src/handlers/instruction.ts` consults `planAndPursue` at one point: after
every recogniser has had the message and none of them acted. Those turns
produce prose and nothing else today, so the addition is strictly additive and
a regression of ADR-0044's semantic contract is impossible **by construction**
rather than by assertion.

A planner running BESIDE the cascade would be a second thing deciding what a
turn does. Two deciders disagree, the disagreement is invisible, and this
repository already records what that costs three separate times. One decision,
one place.

### 2. A plan is a proposal. Permission is asked at plan time AND at do time.

`validate` in `src/agents/goal.ts` rules on a proposed plan against
`public.tool_permissions`: a closed vocabulary, backwards-only dependencies,
bounded size, a real roster, nothing at level 3, and no delivery capability
aimed at an outside audience.

That is not sufficient, because **a plan is data on a job**. The child can
queue, retry, resume after a restart, and be carried out much later — and in
between, Grant can revoke a capability on the Team page or turn a project's
autonomy down. So `src/agents/perform.ts` asks `app.may_act` again at the
moment each step runs, and a withdrawn capability, a missing one, a level-3 one
or a dial set to `observe` all become honest impediments recorded through
`app.cannot`.

`jobAskedFor` is deliberately NOT passed. 0423 lets work a person asked for
proceed without asking again, and what Grant asked for is the GOAL — the steps
are what a model derived from it. Treating the derivation as consent would make
LLM interpretation into authorization.

### 3. Existing is not the same question as performable

`goal.ts` asks whether a capability EXISTS and may be proposed — about the
registry. `perform.ts` asks whether code exists that DOES it. A registry row
can claim anything (0298), so a granted capability with no executor becomes an
impediment rather than a silent no-op, and a plan made entirely of such
capabilities is never started at all.

### 4. Audience is not a delivery channel

`PlanStep.audience` is `office | grant | outside | null`. The model DECLARES
it; deterministic code uses it in one direction only — **to refuse**. A step
claiming `office` is granted nothing by saying so, because the policy still
rules at execution. A delivery capability aimed at `outside` is refused
outright rather than downgraded to a draft, because substituting a different
action is how an approved plan stops matching what runs.

## What was rejected

**A second workflow engine.** #263 forbids one and `checkpoint.ts` says so in
its own header. A plan compiles into `Step[]` and the existing loop runs it:
skip what is recorded, park an interrupted external write, refuse a checkpoint
written by different code. The durable machinery was already built; `compile`
is a compiler, not a runtime.

**Letting the planner run on every message.** The first measurement asked it
about *"How many projects have we got open?"* and got `db.read` followed by
`draft.create` — it padded a trivial question into work. A short single-clause
sentence never reaches the model, and a one-step plan starts nothing, because
one step is exactly what the cascade already does.

**Trusting an executor's observation as prose.** Every executor returns
canonical facts, and `found` separates *"I looked and there was nothing"* from
*"I could not look"*. The narration is assembled from those, so it cannot claim
more than state proves.

**Letting retrieved material into the system turn.** `draft.create` is the one
executor that spends a model. Its material arrives in a user turn inside a
named fence, with the system turn stating that nothing inside it is an
instruction.

## What would reverse this

Evidence from real use that the planner is worse than the cascade on the turns
it claims — measurably, on a held-out corpus, not impressionistically. The
instrument for that already exists: `npm run verify:plans` scores both
architectures by the same rule in the same run, and
`docs/testing/goal-corpus-heldout.json` was committed unrun against a frozen
implementation.

A second reason would be cost: the planner is one model call on turns that
today produce prose. If those turns become common and the composition rate
stays where it is, the fast path's threshold is the dial to turn, not the
feature to remove.

### 5. The planner reads what Grant said, and knows what the office can do

Two later corrections, both of which had looked like model nondeterminism.

`understand` hands the CASCADE a cleaned sentence, by contract and by
measurement. Handing the planner the same text lost the purpose clause on a
third of runs, and purpose is what decides whether a goal has a second step. The
planner gets his own words — except where he corrected himself mid-message,
where the raw text still holds the fragment he withdrew and the readings are the
only reconstruction available.

And the catalogue sheet marks a capability with no executor **NOT YET BUILT**,
because a planner that does not know keeps choosing them. Marked rather than
removed: the validator still accepts one, so a plan that genuinely needs it
still records the impediment that becomes a proposal.

## What this does NOT claim

The planner is a free model. After the two corrections above it composed the
identical plan on four consecutive end-to-end runs and on eight paired direct
calls — but that is **one sentence**, and the held-out corpus was spent before
those fixes existed, so nothing frozen has scored them. `verify:composes`
asserts first-attempt composition, which is what goes red if the instability
returns; it does not establish a rate across the space of things Grant says.
