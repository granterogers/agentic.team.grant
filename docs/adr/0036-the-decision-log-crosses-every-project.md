# ADR-0036 — The decision log crosses every project

**Status:** accepted · 2026-09-17 · Issue #129 · migrations 0425–0426

## Context

`app.retrieval` searches within a dashboard project, which is right for
documents. #129 is what that makes impossible:

> *"an agent cannot notice that this question was answered three weeks ago on a
> different project, that Grant already declined this approach, that the office
> already tried this and it did not work. Every job begins as though the office
> has never met him."*

The Issue asks for this decision to be recorded **before** the thing is built,
because it is the one retrieval surface where a project boundary is not a
privacy boundary.

## Decision

**`public.decisions` is scoped to the office.** `project_id` records where a
decision came up and is **never** a filter on reading. `app.decisions_about`
takes no project argument at all, which is the strongest form of the rule: not
"we choose not to scope it" but "there is nothing to scope it by".

This is safe here and would not be for documents, and the difference is what
each thing IS. A document is material Grant was given about one piece of work;
its contents may be commercially or personally particular to that work. A
decision is a sentence the office wrote about how it works — *"we chose Notion
over Drive because the team needs to edit in place"* — and there is exactly one
office. Withholding that from a job on another project protects nothing and
costs the whole feature.

**A decision is not a document, a lesson, a proposal or a routing decision.**
Each was checked before the table was added:

| Existing | What it is | Why it is not this |
|---|---|---|
| `documents` | material the office was GIVEN | mixing them means an agent citing its own past guess as a source — 0169's rule, one level up |
| `lessons` | a correction that stuck, a rule about HOW to behave | "keep answers to one paragraph" is a lesson; "we chose Notion over Drive" is not |
| `proposals` | what an agent WANTS, with a verdict | scoped to capability requests; cannot hold a choice between two tools nobody proposed |
| `routing_decisions` | which agent answers | a different noun wearing the same word — the table comment says so, because 0311 was a migration spent undoing two words for one thing and this is the mirror risk |

**Append-only, superseded never edited.** The same three triggers
`job_impediments` carries. A log that can be rewritten cannot answer *when did
we change our mind*, which is most of its value. `decisions_live` derives what
is current rather than storing a flag, because a flag would need an UPDATE this
table refuses — and because 0310's rule holds: do not store a fact you can
already read.

**`ruled_out` is NOT NULL with no default.** Grant's sentence is the whole
argument: *"'We chose Notion for project pages' is worth a fraction of 'we
chose Notion over Drive because the team needed to edit in place' — the second
stops the question being reopened; the first invites it."* An empty array is a
legitimate value meaning nothing else was on the table; a missing one would let
a writer skip the field the table exists for.

**Who decided decides how it may be used.** `decided_by = 'grant'` is a record
of what HE said, which `provenance.ts` counts as evidence and the handler puts
in `saidBefore`. A staff slug is the office's own conclusion, which it does
not, and goes to `answeredBefore`. Folding both into one list would let a
conclusion the office drew become a fact it may cite — the same asymmetry that
keeps an assistant turn out of `established()`.

## Consequences

- Two writers fill it from places where a decision is **already** being made in
  a structured way, so nothing is inferred from prose: answering a blocker (the
  options Grant did not pick are `ruled_out`, exactly and for free) and
  settling a proposal (a declined remedy is `ruled_out`, which is #129's second
  bullet verbatim).
- An agent writing one **as it works** is not built. It would need the model to
  declare it, and the office has no tool channel — a model that wrote JSON into
  its answer would be violating a rule the prompt states plainly. It waits for
  a structured output path.
- `ruled_out` is not in the generated search vector, because `array_to_string`
  is STABLE and Postgres refuses a generated column containing it. The reader
  matches it with a trigram instead, where a stable function is legal. Found by
  the migration being refused on its first run.

## Alternatives rejected

- **A `superseded` boolean.** Needs an UPDATE the table refuses, and duplicates
  a fact the `supersedes` column already carries.
- **Scoping reads to the project.** Would make the feature nothing: every one
  of #129's three examples is about a question settled somewhere else.
- **Putting decisions in `documents` with a type.** The confusion the Issue
  names first, and the one 0169 already paid for in the other direction.
