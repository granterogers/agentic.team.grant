# ADR-0018 — An approval is a record with limits, and a decline is durable and specific

**Date:** 2026-09-11 · **Status:** accepted
**Completes Issue #53. Follows ADR-0015 (lessons) and ADR-0017 (skills).**

---

## Why this exists

Not something Grant asked for. It is what his request makes necessary.

> "They need to learn. They need to propose how they can improve. They need to
> constantly be aware of the role, how they can gain more agency through
> additional skills, through additional tools."

Issues #48, #50 and #52 together describe an office that writes its own
instructions, notices what it lacks, and asks for reach it does not have. Each
is sensible on its own. Together they are a system whose behaviour is no longer
fully determined by anything a person wrote, and that is a different safety
proposition from a queue with handlers.

ADR-0015 and ADR-0017 settled what an agent may **write**. This settles what
happens when it **asks**.

## The three decisions

### 1. An approval is a record, not a moment — and it grants exactly one thing

The failure mode is not somebody approving something bad. It is somebody
approving something reasonable and that approval quietly covering the next
thing that resembles it.

So an approval carries who decided, when, and its **limits**, and it applies to
**one exact tool identifier**. Approving `linkedin.read` does nothing whatever
for `linkedin.post`, and the schema cannot express a prefix, a pattern or a
family. There is no `linkedin.*`. This is the same principle as the standing
rule that agreement in one context does not carry to another, made structural
so that nobody has to remember it.

### 2. Approving a tool that does not exist is a decision to build, not a grant

This is the distinction that keeps the whole thing honest.

If the tool is in `tool_permissions`, approval is a grant: one row in
`staff_tools`, effective on the next job, no code written. That is a real
capability acquired without a coding session, which is what Issue #50's last box
asks for.

If the tool is **not** in `tool_permissions`, there is no implementation behind
the name, and approving it would grant a fiction — a permission to call
something that does not exist. So approval in that case creates no grant. It
records that Grant wants it, and says so plainly.

The tempting alternative is to insert the row anyway so the approval "works".
That produces a permission system in which a granted tool may or may not do
anything, and the first time it silently does nothing, nobody will know whether
it was a policy problem or a missing function.

### 3. The global switch stays the ceiling

0119 already settled this for per-person grants: `app.staff_may_use()` is an AND
of `tool_permissions` and `staff_tools`, so a tool disabled by policy stays
disabled however it is granted. Approval does not get an exemption. Approving
`github.write` for Marcus records the decision and grants him the row; the tool
remains globally off until Grant turns it off-and-on deliberately, and the
approval says so rather than appearing to have worked.

## Declines

**Durable**, or the office asks again next week with a slightly different
sentence and Grant's "no" costs him the same attention every time.

**Specific**, or a "no" to publishing quietly becomes a "no" to reading
analytics. Keyed on the exact tool and the exact person, so it cannot spread.

**And the bar rises.** Ninety days per decline: once → a quarter of silence,
twice → half a year. Same reasoning as the dismissal rule in `app.notice()`
(0211) and worth repeating here: what a decline means is *"not now"*, and what
it buys is silence for a while. Lowering the priority instead would be wrong,
because a capability the office keeps needing does not become less needed
because it was refused.

## Who may approve

`app.approve_tool()` and `app.decline_tool()` refuse any decider but Grant, and
**no code path an agent runs calls either of them.** That second half is the one
that matters and it is asserted the way this repository asserts things: a check
that greps the agent and handler source and fails if the name appears.

This is deliberately not dressed up as cryptographic. The worker holds the
service role and could execute any function in the database; pretending
otherwise would be worse than saying so. What is true, checkable, and enough:
the office's own code contains no route to an approval, the request path writes
only to `tool_requests` and provably does not move `staff_may_use()`, and any
future edit that changes either fails a test.

## The ceiling

> ~£0/month. Supabase free tier, Vercel Hobby, OpenRouter free models.

Reflection, noticing and proposing all cost tokens, and a self-improvement loop
with no ceiling is a loop that discovers it can improve its own noticing. So
there is a daily token budget for self-improvement work, and it is enforced **at
dequeue** — those job kinds are simply not handed out once it is spent.

Enforced there rather than in each handler for the reason every other central
rule in this codebase gives: a check in the caller is a check in *one of* the
callers. A handler that forgets it is a handler that spends.

The budget stopping work is a visible, recoverable state, not a silent one: the
kinds resume at midnight and the headroom is readable.

## Every self-change is in the ledger, with a way back

A lesson learned, a skill written, a suggestion raised, a tool requested,
approved or declined — each appends to `public.events` with `reversible` set and
a named `reversal_method`, per §6's rule that *"if the author cannot say how to
undo it, it is reversible = false."*

None of these is a compensating-event undo in the #10 sense yet, and saying they
were would be the failure §6 is written against — an Undo button that cannot
undo. What is true is that each has a stated, implemented way back
(`unlearn`, `retire_skill`, dismiss, revoke) and the ledger names it.

## What was considered and rejected

**A tool allowlist by prefix.** `linkedin.*` in one row rather than two. Rejected
for the reason decision 1 exists: it is exactly the generalisation the issue
names as the failure.

**Approval by reacting to a Telegram message.** Fewer steps for Grant and it fits
how he already works. Rejected as the *only* path: a tap is a moment and this
ADR's first decision is that an approval is a record. A tap that creates a
record with limits is fine and is worth building later; a tap that is the
approval is not.

**An approval that expires by default.** Safer, and every grant would need
renewing. Rejected: it makes the office quietly lose capability on a date nobody
remembers, and the failure surfaces as work that mysteriously stopped happening
— which 0119 already identified as the worst way for a permission system to
behave. `limits` can carry an expiry when one is meant; the default is that a
decision stands until it is reversed.

**A per-agent token budget rather than one for the whole self-improvement
class.** More precise. Rejected as premature: the constraint is a single free
tier shared by everybody, so the number that matters is the total, and eight
budgets that each look fine is how the total is exceeded.

## Consequence for anyone extending this

- **Approval takes one exact tool.** If you add a way to approve a family, a
  pattern or a prefix, you have removed decision 1.
- **The authorisation path reads no table an agent can write.** ADR-0015 and
  ADR-0017 both say this; `tool_requests` is now a third such table and the same
  rule applies.
- **The ceiling is enforced at dequeue.** Moving it into handlers reintroduces
  the "one of the callers" problem.

`verify:boundary` fails on all three, and none of them is a flaky test.
