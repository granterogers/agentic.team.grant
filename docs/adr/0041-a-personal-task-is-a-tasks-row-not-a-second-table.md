# ADR-0041 — A personal task is a `tasks` row, not a second table

**Status:** accepted · **Date:** 2026-09-18 · **Issue:** #259

## The decision

**A Personal Task is a row in `public.tasks` with `assigned_to_human = true`.**
There is no second table, no second id space and no second set of writers.
Vikunja, if it is ever connected, is a projection of those rows and never their
home.

## Why this, when the Issue describes a whole domain

#259 opens with the instruction that decides it:

> *"Audit the existing task/job/human-action architecture and avoid creating
> competing abstractions."*

The audit found `public.tasks` already carrying almost the whole of what the
Issue's "Personal Task domain" paragraph asks for:

| the Issue asks for | the column that already exists |
|---|---|
| project | `project_id`, **nullable** — a task with no project is representable today |
| title, details | `title`, `detail` |
| status | `state`, with `done_at` |
| priority | `priority` |
| due / start dates | `due_on`, `starts_on` |
| parent / subtask | `parent_task_id` |
| origin / creator | `added_by` |
| timestamps | `created_at`, `updated_at`, `done_at` |
| related Agent Job | `job_id` |
| **human vs agent work** | **`assigned_to_human`** |

Four things were genuinely missing and are added by migration 0482: `labels`,
`remind_at`, and a pair of recurrence columns.

CLAUDE.md is blunt about the alternative: *"Before inventing a noun — Skill,
Capability, Tool, Plugin, Action, Integration, Agent, Workflow, Task,
Evaluator — check whether this office already has one. It has all ten."*
A `personal_tasks` table would be the eleventh, and #169's whole finding was
that eight of ten "new" systems were already in the schema.

## The finding that made the decision easy, and uncomfortable

`public.tasks` holds **one row**. `assigned_to_human` has **never been true**
for any row in its history, and **nothing in `src/`, `scripts/` or `web/` reads
that column.**

So the distinction the Issue's second invariant turns on — *"Personal Tasks ≠
Agent Jobs"* — was already modelled, already correct, and completely inert.
That is the same shape as `autonomy_settings`, which had a table, a function
and a Settings control and no reader in `src/` until #15 was finished: a dial
with no reader is worse than no dial, because it looks like a decision.

The lesson is why this ADR exists rather than a comment in a migration.
Extending an unused column is cheap; discovering a second task system in three
months is not.

## What follows from it, precisely

1. **One id space.** A personal task and a project task share `task_id`, so
   `parent_task_id` can cross between them, `job_id` can link one to the agent
   job that needs it, and the human-action bridge in #259 is a foreign key that
   already exists rather than a new join.
2. **One set of writers.** `app.hq_task_state` completes and reopens both.
   `app.hq_task_update` edits both. The new fields get ONE narrow writer of
   their own rather than three more arguments on a function that already takes
   ten — CLAUDE.md records that a function with eight arguments will be called
   with seven.
3. **`assigned_to_human` is the only thing that separates them**, and every
   reader states which it wants. A reader that forgets is a reader that shows
   Grant the office's work as his own to-do list, which is the one failure this
   decision can produce.
4. **A project dashboard shows both**, marked. #259 asks for exactly that, and
   with one table it is a flag on a row rather than a union of two queries.
5. **Vikunja is a provider, not a schema.** The external mapping, when it is
   built, is `(task_id, provider, external_id, …)` in its own small table —
   which is a mapping, not a competing model. Nothing about that is built yet
   and this ADR does not pretend otherwise.

## What this decision does NOT claim

- It does not say personal tasks and project tasks should LOOK the same. They
  do not: My Tasks is its own surface with the Inbox / Today / Upcoming /
  Overdue buckets the Issue names, and a project's Tasks tab is a project view.
- It does not decide anything about Vikunja hosting. #261's standing decision
  is *"Do not enable or purchase paid infrastructure"*, and a Vikunja server is
  infrastructure. The provider boundary is designed for; the provider is not
  built and the hosting question stays Grant's.
- It does not make `assigned_to_human` a security boundary. This is a
  single-person office; the column separates two kinds of work, not two
  tenants.

## The risk, named

One table means one place to get a filter wrong, and the failure is
asymmetric: a personal task missing from My Tasks is an annoyance, and the
office's internal work appearing in Grant's personal list is the thing that
makes him stop trusting the list. So every reader added here asserts the
boundary in BOTH directions in `verify:mytasks` — the personal one appears and
the agent one does not — rather than asserting only that the right rows show
up. A suite of positives passes against a reader that returns everything.
