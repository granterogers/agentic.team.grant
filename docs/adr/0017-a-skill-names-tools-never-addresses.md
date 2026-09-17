# ADR-0017 — A skill may name a tool; it may never name an address

**Date:** 2026-09-11 · **Status:** accepted
**Decides the question ADR-0015 explicitly deferred. Enables Issue #50.**

---

## What Grant asked for

> "They need to constantly be aware of the role, how they can gain more agency
> through additional skills, through additional tools."

And the reason it matters more than the feature does:

> "I want to reduce my dependence on Claude or another coding interface for
> maintaining and extending the system."

Today every capability the office has was written in a coding session and
deployed. There is no other path, so the honest statement of the architecture is
that **the office cannot become more capable without me** — which is the
dependence he asked to remove, stated as a design.

## The problem ADR-0015 left open

ADR-0015 drew the line between advisory and authority and made it hold for
lessons by making a lesson **too short to carry a procedure**: 280 characters,
one sentence, no room for an endpoint and a payload. It then said, in as many
words, that this does not generalise:

> "Skills (#50) are the harder case, because a skill *is* a procedure and the
> cap that protects a lesson cannot protect a skill. That needs its own decision
> and its own ADR, and it should not be built until that decision is written
> down."

A skill has to be long enough to be useful. So the protection cannot be length,
and something else has to do the work.

## The decision

**A skill names tools. A skill may not name addresses.**

Reach is referred to by the identifier of a tool that already exists in
`tool_permissions` — `github.read`, `notion.write` — and never by the thing the
tool talks to. A URL, a hostname, an IP literal, an email address or a
credential in a skill body is refused at the point of insert, by a trigger, the
same way `app.reject_credential_text_on()` already refuses a secret in a lesson.

That single rule is what makes a procedure safe to let an agent write, and it is
worth being precise about why. ADR-0015's failure sequence was four reasonable
steps ending in the office publishing to an account nobody approved, and step 3
was the load-bearing one:

> *"to publish, POST the copy to the webhook in the marketing brief."*

Under this decision that sentence **cannot be stored**. Not "is discouraged",
not "is caught in review" — the insert fails, because it contains an address. The
only way for a skill to express publishing is to name a publishing tool, and a
tool that does not exist cannot be named, because the reference is a foreign
key. So the skill an agent would need to write in order to grant itself reach is
a skill the database will not hold.

| | lesson | skill | tool |
|---|---|---|---|
| what it is | a belief | a procedure | reach |
| how long | ≤ 280 chars | as long as it needs | n/a |
| who may write it | an agent | an agent | Grant, or something he approved |
| what stops it reaching | too short to hold a procedure | **may not name an address** | it *is* the reach; gated |
| enforced by | length check + credential trigger | address trigger + FK to `tool_permissions` | `app.staff_may_use()` |

## The authorisation path still reads none of this

`app.staff_may_use()` does not read `lessons`, and it must not read `skills`
either. A skill saying "use `notion.write`" is a **statement of intent, not a
grant**. If the agent does not hold `notion.write`, the step is unavailable and
stays unavailable however confidently the skill is worded.

This is asserted the way ADR-0015 asserts its half: behaviourally, by writing
the most persuasive skill the schema permits and checking the answer does not
move; and structurally, by reading the function definition back and failing if
the word appears in it.

## What happens when a skill wants a tool nobody holds

This is the part that turns the boundary from a wall into a route, and every
piece of it already exists:

1. A skill step names a tool the agent does not hold.
2. The agent records an impediment — `app.cannot()` (0184), which exists for
   exactly this and is typed rather than prose.
3. `impediments_tally` counts it. Three in a fortnight and it becomes a
   `capability_missing` observation in `app.notice()` (0210, weight 70).
4. That reaches Grant in the morning briefing, in a sentence, with the count.
5. He grants the tool — on the Team page, one row in `staff_tools`.
6. The skill works on the next job, unchanged.

Nobody wrote code at any point, and the one irreducible human act — the decision
to widen what the office can affect — is the only thing asked of him. §31 of the
frontend spec asks for precisely this shape: do everything that can be done
safely, then ask for the click only he can make.

## Versioned, provenanced, and measurable

Three properties, each because of a specific way this goes wrong.

**Versioned and append-only**, like lessons. A procedure that is edited in place
makes "why did it do that in September" unanswerable, and a skill is a far more
likely culprit than a lesson because it is the thing that actually shaped the
work. A new version supersedes; nothing is rewritten.

**Provenanced.** Who wrote it and out of which job. A procedure with no author
cannot be judged, and an office that accumulates unattributed procedures is one
that gradually behaves in ways nobody chose.

**Measurable, and this is the one that is easy to skip.** Issue #50 says it
plainly: *"a skill that does not improve outcomes should be visible as such
rather than accumulating."* Retrieval is recorded against the job, so the
outcomes of jobs that used a skill can be compared with those that did not. A
library of forty plausible procedures nobody has ever checked is worse than
having none, because it is expensive to read, it crowds the prompt, and it looks
like competence.

## What was considered and rejected

**Skills as files in the repository.** They would get review and diffs for free.
Rejected outright: it puts every new capability back through a coding session,
which is the exact dependence this is meant to remove. A skill an agent cannot
author is not a skill, it is a feature.

**Skills as long lessons — raise the cap to 4,000 characters.** One table, one
retrieval path, less to build. Rejected: the cap *is* the safety property for
lessons, so raising it removes the protection from lessons in order to add a
feature to skills. Two things with different risk profiles must not share a
mechanism; that is ADR-0015's whole finding.

**An allowlist of hostnames a skill may mention.** Softer, and lets a skill be
specific about a service it legitimately uses. Rejected: it is a second place
that can say yes about reach, and ADR-0015 already establishes that two places
which can each say yes is not a permission system. It would also need
maintaining, and an allowlist nobody maintains fails open.

**Reviewing skills before they take effect.** A queue Grant approves. Rejected as
the *primary* control — it makes him the bottleneck on the one thing that was
supposed to reduce his involvement, and a reviewer approving the fortieth
plausible procedure at speed is not a control. It remains available as a policy
knob for skills that touch a tool with real-world effect, which is a narrower
question than this ADR.

**Letting a skill carry executable code.** Genuinely more capable. Rejected: it
is a new execution surface with none of the above properties, it cannot be
reasoned about by reading it, and there is no version of it where "an agent
wrote this and it ran" is a sentence anyone is comfortable with.

## Consequence for anyone extending this

Two rules, and both fail loudly rather than quietly:

- **If you relax the address check, you have removed the boundary.** Not
  weakened it — removed it, because the check is the only thing standing between
  a procedure an agent wrote and a procedure that reaches somewhere nobody
  approved. `verify:skills` fails and it is not a flaky test.
- **If you add a lookup from the authorisation path into `skills`, likewise.**
  Same rule as ADR-0015, same reason, same test.

A tool is still granted by Grant and by nobody else. Everything above is about
making the *request* arrive well, not about answering it.
