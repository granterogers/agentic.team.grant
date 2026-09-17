# ADR-0022 — A project is archived, not deleted

**Status:** Accepted · 2026-09-12 · Issues #43, #45

## Context

`public.projects` has twenty-nine children and, before this, five different
opinions about what happens when one is deleted. Eight cascade; the rest take no
action. `documents` was among the second group by accident rather than by
decision — its constraint was still named `notebook_sources_project_id_fkey`,
from before documents were called documents.

The consequence is that `delete from projects` half-works, and which half
depends on which tables that particular project happens to have rows in. A
project with only tasks deletes cleanly. A project with one document cannot be
deleted at all, and says so by naming a table that no longer exists.

Found by `verify:assets`, whose teardown failed, left rows behind, and made the
*next* run fail a different assertion somewhere unrelated. That second-order
failure is the real cost of an inconsistent policy.

There were three defensible answers and they mean different things to Grant's
data. 86 real documents currently hang off four projects.

## Decision

**Archive is how a project ends. Deletion is for debris.**

1. `documents.project_id` is an explicit `on delete restrict`, renamed to say
   what it guards. ADR-0013 already says a route may be closed and the corpus is
   kept; this makes the schema agree with it.
2. `app.project_delete(slug)` is the one sanctioned path. It refuses a project
   holding documents, refuses one with jobs against it, and otherwise removes
   the children in ADR-0014's order — archive, then attachments, then the
   project.
3. Every other child keeps the policy it has. Making the old tables match the
   new ones — cascade everywhere — would be the reverse of safe.

A project with **jobs** can never be hard-deleted at all, and that is not a
limitation to work around: `job_state_transitions` is append-only by §6 and has
a foreign key to `jobs`, so a job can only ever be cancelled. A project that was
worked on is history.

## Why not cascade

It is the tidier schema and it silently destroys 86 documents the first time
somebody deletes the wrong row. Grant's standing instruction is explicit:

> *"You should always check before making any destructive action with me."*

A cascade is precisely the action that does not check.

## Why not restrict everywhere

It would refuse to remove the thirty debris projects a year of verify runs has
left behind, which is the other half of the problem (#45). Debris should be
cheap to remove; content should be impossible to lose by accident. Those are
different rules and the shape above is what lets both be true.

## Consequences

- A teardown has one call to make, and a refusal is a sentence rather than a
  constraint name.
- Nineteen archived debris projects that carry a job each stay archived for
  ever. That is correct — they are history — and it costs nothing, because
  archived projects do not appear in the switcher.
- The harm those rows actually caused is fixed separately and non-destructively:
  `project_aliases` had a GLOBAL unique index on the normalised phrase, so 561
  phrases were held by retired probes. Uniqueness is now enforced among
  **active** projects only, by a trigger — a partial unique index cannot express
  it, because the predicate has to read `projects.status` and a partial index
  may only reference its own table.
- `app.project_debris()` names what looks left-behind and whether it can be
  removed, so `npm run check:leaks` can fail on a NEW leak without failing on
  history nobody can delete.

## What would reverse this

A future agent tidying the schema into one cascade for consistency. That is why
this file exists. The inconsistency is deliberate: the tables that cascade hold
configuration a project generated, and the tables that restrict hold work
somebody did.
