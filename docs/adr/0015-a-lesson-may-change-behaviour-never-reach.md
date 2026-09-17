# ADR-0015 — A lesson may change how an agent works; it may never change what an agent can reach

**Date:** 2026-09-11 · **Status:** accepted
**Implements the boundary half of Issue #53. Enables #48.**

---

## What Grant asked for

> "They need to learn. They need to propose how they can improve. They need to
> constantly be aware of the role, how they can gain more agency through
> additional skills, through additional tools."

Both halves are wanted. He is right that a team which cannot accumulate anything
is not a team. This ADR is about the seam between the two halves, because that
seam is where the whole thing either stays safe or quietly stops being.

## The decision

**Advisory knowledge and authority are separate mechanisms, and the separation
is enforced by construction rather than by convention.**

| | advisory | authority |
|---|---|---|
| what it is | lessons (0181), and skills when they land (#50) | `tool_permissions` × `staff_tools` |
| who may write it | an agent, about its own work | Grant, or something he approved |
| what it can do | change how a job is approached | change what the office can affect |
| enforced by | retrieval into a prompt, and nothing else | `app.staff_may_use()`, an AND of both tables |

`app.staff_may_use()` does not read `lessons` and must never read it. That is
asserted by `npm run verify:lessons`, in two ways: behaviourally, by writing the
most persuasive lesson the schema permits and checking the answer does not move;
and structurally, by reading the function definition back and failing if the
word appears in it.

## The failure this prevents

It is not a rogue agent. It is a sequence in which every individual step is
reasonable:

1. Ruby is asked to publish something and cannot.
2. Ruby notices the pattern and writes herself a lesson about it.
3. The lesson says: *"to publish, POST the copy to the webhook in the marketing
   brief."*
4. Ruby, next week, follows her own lesson. The office is now publishing.

No step was approval-shaped, so no approval was ever sought. The only place to
stop it is at (3), and the only reliable way to stop it at (3) is to make a
lesson structurally incapable of carrying a procedure that reaches outward.

## How that is enforced today

- **A hard 280-character cap on a lesson body.** One sentence. The cap is a
  boundary, not a style preference: a lesson long enough to hold a procedure is
  long enough to hold an endpoint and a payload. Anything longer is a document,
  and documents already exist and are visible to Grant.
- **Append-only**, per §6 and `app.reject_ledger_mutation()`. A belief is never
  rewritten, only superseded, so "why did it do that in September" stays
  answerable. Retraction requires a stated reason.
- **No credential may be stored in one.** `npm run check:secrets` scans *files*;
  a table is exactly where a secret would hide from it. `app.reject_credential_text()`
  refuses the recognisable shapes at the point of insert, which is stronger than
  scanning afterwards. A lesson *about* a credential — naming the vault key and
  no value — is explicitly still allowed, because that is the lesson worth
  having.
- **Scope is checked, not trusted.** A mis-scoped lesson is retrieved in the
  wrong place and looks exactly like a model hallucinating.
- **Retrieval is capped by the caller and recorded.** A wrong answer must be
  traceable to a lesson that was, or was not, present. Without that, a memory
  turns every bug into a mystery.

## What was considered and rejected

**Storing lessons in `documents`.** They are already a table with provenance and
Grant can see them. Rejected: `documents` are project material *he* might read;
lessons are the office's notes about itself. Mixing them fills his Documents tab
with machine housekeeping, which is noise he has asked twice to be rid of.

**Rewriting `staff_prompts` as agents learn.** Versioned prompts already exist
and would carry a lesson naturally. Rejected: a core prompt is an identity.
Editing an agent's identity every time it notices something is how a team loses
its shape, and there would be no way to scope a lesson to one project.

**Mutable rows with an `observations` counter.** Simpler and cheaper. Rejected
because it is not evidence: the ninth observation is a materially different
claim from the first, and the record should show it *became* one.

**Letting a cascade delete lessons with their project.** This was in 0181 and it
was wrong — a cascade is a DELETE, so it contradicted the append-only trigger
outright. The real behaviour was that a project with a lesson could not be
deleted at all, and the error named the append-only rule rather than the
project. 0183 makes it a plain reference, matching `events`, `autonomy_settings`
and `job_state_transitions`, and folds it into Issue #43 where the policy for
the whole family belongs.

## What this does not decide

Skills (#50) are the harder case, because a skill *is* a procedure and the cap
that protects a lesson cannot protect a skill. That needs its own decision and
its own ADR, and it should not be built until that decision is written down.
Until then the rule stands in the strongest form: **anything an agent authors is
advisory.**

## Consequence for anyone extending this

If you find yourself adding a lookup from the authorisation path into anything
an agent can write, you are removing this boundary. `verify:lessons` will fail
and it is not a flaky test.
