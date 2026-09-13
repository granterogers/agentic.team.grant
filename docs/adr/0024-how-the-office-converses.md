# ADR-0024 — Three answers about how the office converses

**Date:** 2026-09-13
**Status:** Accepted
**Context:** #191 (Phase 7 — Communications), #193, #194, #187

## Context

Planning Phase 7 (#191) surfaced three questions that could not be answered
from the repository, because each had two coherent readings that would build
differently. Grant answered all three on 13 September. They are recorded here
rather than only in the Issues, because each is a decision a future agent could
reverse by accident while doing something else.

---

## 1. Only the Chief of Staff speaks in a project's Slack channel — but Grant may address anyone

**Grant:** *"For now, we can have the only chief speaks in the project Slack
channel. But, of course, I should be able to message each individual if I
choose to."*

`telegram.only_chief_speaks` has been true since 0136 and expresses *"I only
get messages from the chief of staff."* The open question was whether it also
governs a project's Slack channel (#187), where a channel with eight staff
posting is a different product from one where only Claire does.

### Decision

**Outbound is Claire.** In a project's Slack channel the office speaks with one
voice. Everyone else still does the work and still writes output — the
dashboard shows all of it — they just do not post.

**Inbound is unrestricted.** Grant addressing an individual is not the office
choosing to speak; it is him choosing who to ask, and #26's whole premise is
that *"Ask Emma and Daniel"* is an instruction rather than a guess. Addressing
must work in Slack exactly as it does in the studio, and the reply comes back
attributed to the person he asked.

The asymmetry is the point. The rule exists so eight bots do not each message
him unbidden, not to stop him reaching a named person.

### How it must be built

- **A stored preference, not a constant.** *"For now"* is doing real work in
  that sentence. `telegram.only_chief_speaks` is already config; the Slack
  equivalent must be too, so changing it later is a settings write rather than
  a code change. §4: all such identifiers are configuration, never constants.
- It governs **unprompted** posts. A reply to a message Grant addressed to
  Emma is prompted, and is Emma's.
- Do not implement it in the adapter. §5 — adapters may only translate. Who
  speaks is a canonical-layer decision.

### The trap this creates

A future agent reading `only_chief_speaks` and applying it uniformly will
suppress Emma's direct reply, and it will look like the rule working. The
check must assert that a message addressed to a named agent comes back **from
that agent**, not merely that unprompted posts are Claire's — otherwise it is
CLAUDE.md's *"a refusal for the wrong reason looks exactly like the rule
working"* in a new place.

---

## 2. A conversation with no project belongs to a reserved catch-all project

**Grant:** *"You can just create an untitled or undefined project. Stuff that's
not a specific project. You can just go in unnamed project as a title or
category or whatever."*

In a private Telegram chat there is no project in the room. *"What's the
status"* with nothing named had nowhere to land (#194).

### Decision

**One reserved dashboard project, created by migration, that unattributed
conversation lands in.** Not a nullable `project_id`.

### Why not a nullable project

Everything in this system hangs off `project_id` — documents, jobs, tasks,
collections, and now conversations. A nullable one would ripple into every
reader and, worse, into #192's project-isolation criterion: a check that a
reader scoped to one project cannot see another's has to decide what "scoped
to null" means, and that is the kind of question that gets answered
inconsistently in four places.

A real row costs one migration and changes nothing downstream.

### It is a real project, and that has consequences

**A "dashboard project" is a row in `public.projects`.** This one is too, which
means it appears in Grant's project switcher and portfolio. That is
**deliberate and desirable** — it is where the unattributed conversation is,
so he must be able to go and look at it — but it is a visible change to the
portfolio and is called out here so nobody later removes it as clutter.

It must **not** be `is_fixture`. That column is GENERATED from the slug and
matches `fixture-%`, `verify-%`, `ledger-proof-%`; a fixture is excluded from
`app.resolve_project_by_name` and from anything Grant reads, which is the
opposite of what this project is for.

### It must be protected, or it will be swept

This is the part most likely to go wrong, and there is no protection column on
`projects` today.

- `npm run check:leaks` sweeps **active, non-fixture** projects matching debris
  patterns — `newsroom-%`, `gate4-probe-%`, `clash-%`, `untitled-notebook-%`,
  `dbg-%`, `probe-%`. Note `untitled-notebook-%` is already there. **Do not
  name this project anything beginning `untitled`.**
- ADR-0022 says a project is archived, not deleted, and `app.project_delete`
  refuses one holding documents or jobs. This project will hold jobs almost
  immediately, so it is incidentally protected — but incidentally is not
  protected.

So the migration that creates it must also:

- give it a **reserved, stable slug** that matches no sweep pattern and reads
  as deliberate;
- make `app.project_delete` **refuse it by name**, with a message saying why;
- exempt it from the leak sweep explicitly, with a comment pointing at this ADR
  rather than at a slug list a future reader has to interpret;
- carry a table comment saying what it is, so somebody finding it in the
  switcher does not conclude it is debris.

### Grant's standing rule about creating projects

> *"Please don't assume I wish to create a new project — this is a large task
> and should always be confirmed."*

**He confirmed this one, explicitly, in the sentence quoted above.** That
authorisation covers this single reserved project and nothing else; it is not
a general licence, and the rule stands unchanged for every other project.

---

## 3. Slack synchronisation is convergent, not a mirror

**Grant:** *"Convergent is fine."*

The two readings of "bidirectional synchronization" (#193):

- **Full mirror** — every studio message appears in Slack and vice versa.
  Simple to state, and it fills Grant's Slack with his own typing echoed back.
- **Convergent** — both surfaces write to one canonical history (#192); each
  renders what is relevant to it.

### Decision

**Convergent.** Slack and the studio are two windows onto one conversation, not
two conversations kept in step.

### What follows from it

- There is **one history**, in #192. Neither surface is the authority; Postgres
  is, which is 0014's canonical-store claim restated: *"could the application
  be rebuilt from Postgres alone, with an empty Slack workspace?"* Convergence
  keeps that true; a mirror would quietly make Slack an ordering authority.
- Because each surface renders a subset, **there must be a rule for what Slack
  does not show**, and it has to be written down. Decision 1 supplies most of
  it: unprompted posts are Claire's.
- Convergence makes #195 — message identity, deduplication, loop prevention —
  load-bearing rather than defensive. Two windows on one history is exactly the
  arrangement where an echo is indistinguishable from a new message.

---

## Consequences

- #193 builds convergent, with Claire as the outbound voice and inbound
  addressing preserved.
- #194 gets a reserved catch-all project, protected as above.
- #187 has its open question answered.
- A new stored preference governs the Slack voice, so *"for now"* remains true
  without a code change.
- The portfolio gains one project that is not a client project.

## Alternatives rejected

- **Nullable `project_id` for unattributed conversation** — ripples into every
  reader and makes project isolation ambiguous at exactly the point it must be
  provable.
- **Full mirror for Slack** — makes Slack an ordering authority and echoes
  Grant's own messages back at him.
- **A hardcoded constant for the Slack voice rule** — contradicts §4 and makes
  *"for now"* expensive to revisit.
