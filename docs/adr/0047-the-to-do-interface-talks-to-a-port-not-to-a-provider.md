# ADR-0047 — The To-dos interface talks to a port, never to a provider

**Status:** accepted · 22 September 2026 · project home v2 ·
`web/studio/bc/todos.js` · experimental branch `claude/basecamp-team-hq`

## The decision

The experimental Team HQ's To-dos interface calls **one module** —
`web/studio/bc/todos.js` — and never calls a task writer directly. That module
names the operations a to-do interface needs, in a vocabulary of its own:
`lists`, `task`, `setDone`, `setStage`, `add`, `addList`, `update`, `canWrite`.
The office's own task API satisfies them today through `act()`.

Grant asked for this in these words:

> *"The To-dos system is intended to interface with Vikunja. Architect the
> To-do implementation accordingly from the outset. Do not build a
> disconnected visual mock-up that subsequently needs to be rebuilt for
> Vikunja integration."*

## What this is NOT

It is **not** a second Vikunja integration and it never reaches Vikunja over
the network. [ADR-0043](0043-supabase-is-the-task-list-and-a-provider-is-a-projection.md)
already settled where a provider sits: `public.tasks` is the task list and a
provider holds a copy the office keeps in step. A browser that called Vikunja
itself would be a second answer to "what is on Grant's list", which is the one
thing that ADR forbids — and it would need a credential in a page.

So the port is the UI's half of the same decision: the interface is written
against operations rather than against today's RPC names, and a provider
arriving underneath changes nothing above it.

## The two things the port exists to absorb

Both were read out of Vikunja's own OpenAPI document rather than remembered,
because guessing another product's API is the same mistake as guessing a
column name with a network in between.

1. **A list is not the same kind of thing in the two systems.** This office
   models a list as a MILESTONE TASK that others name as their parent (0171).
   Vikunja models it as a nested project (`parent_project_id`) or as a kanban
   bucket. The port therefore carries an **opaque list id** and never exposes
   "the parent task": an interface built on `parent_task_id` is one that has
   to be rebuilt, which is exactly what Grant asked to avoid.
2. **Priority runs the other way.** In `public.tasks` a LOWER number is more
   important — the live rows are 20 and 100. In Vikunja a HIGHER number is. The
   port speaks in words (`urgent | high | normal | low`), so neither
   convention leaks into the interface and the adapter that gets it backwards
   is the only thing that can be wrong.

## What could reverse this by accident

A control wired straight to `act('task_state', …)` because it is two lines
shorter. That is how the interface stops being portable, one control at a
time, and it will not announce itself: the press works. Routing the remaining
direct calls in `web/studio/bc/wire.js` through the port is open work, named
in the run ledger rather than left as a comment.
