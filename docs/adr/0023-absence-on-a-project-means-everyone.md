# ADR-0023 — Absence on a project means everyone

**Status:** Accepted · 2026-09-13 · Issue #36 · Migrations 0323, 0324, 0328

## Context

Project Settings (#36) asks for two things that had never existed: **which
agents work on this project**, and **automations Grant can create and edit
entirely in the UI**. Both are per project, because Legacy Coaching and AI
Learning want different answers, and both have an obvious shape that is wrong.

### Who works here

The obvious shape is an explicit roster: a `project_staff` table that names the
people who are on a project, and a router that convenes only those.

It breaks on the day it ships. Grant has four active projects and eight agents;
adding the table creates it empty, so every project has an empty roster and
nobody is convened for anything until somebody fills eight rows in four times.
The symptom is not an error. It is work quietly not being done, on a system
whose whole purpose is doing work without being watched.

This repository has refused the same shape twice already, for the same reason.
0177 refused a sentinel `connector = 'link'` because a row that satisfies the
constraint and answers no questions truthfully is worse than no row. 0284 found
`documents.produced_by` declared `not null default ''`, which made
`coalesce(d.produced_by, 'The team')` dead code in four readers for months —
a default that satisfies the schema and lies about the world.

### Automations

The obvious shape is a form over `responsibilities` with a `job_kind` dropdown.

Three things are wrong with it. Half the kinds are plumbing —
`office.prune_job_traces` is not a thing a person asks for. A kind with no
handler produces jobs that fail for ever, and nothing in SQL can know which
kinds have handlers, because the handlers are TypeScript. And it is not what
Grant asked for: his example is *"when a document lands in this collection,
have Emma summarise it"*, which is a sentence, not an enum value.

## Decision

### 1. A row in `project_staff` is a DECISION, not a membership

A project with no rows is a project the whole office works on. The table
records departures from that default, in either direction: `active = false` is
Grant taking someone off, `active = true` is him putting them back, recorded
rather than deleted so the decision survives.

`app.staff_on_project` therefore left-joins from `staff` and includes anyone
with no row. The default falls out of the query rather than being a branch
somebody has to remember.

**The Chief of Staff cannot be excluded.** `telegram.only_chief_speaks` is
true, so a project she is off is a project that cannot report to Grant at all.
The writer refuses with a sentence rather than a silent no-op, because a switch
that springs back and explains nothing is worse than one that is not drawn.

### 2. The setting takes effect in the router

`pickRoster` gained a fourth argument and filters its ceiling by who is on the
project. #36 asks for this in as many words — *"configurable AND TAKES
EFFECT"* — and a setting nothing reads is #64 with the sign reversed: being
told NO about something possible costs a feature request, being told YES about
something that does not happen costs the work, silently.

The empty-roster branch distinguishes its two causes. A `thought` convenes
nobody because §9 says trivial work spawns no subagents; an `assignment` on a
project Grant has emptied ALSO convenes nobody, and reporting that as "trivial
work" would hide his own setting from him in the one place he would look.

### 3. A per-project brief sits on the same row, and is applied ON TOP

What a person is told here belongs on the row that says they are on the
project: it is one decision about one person, and a separate Agent
configuration screen would mean finding two places to say one thing.

It is added to the prompt after the remit and the communication style, never
instead of them. A per-project note that REPLACED the global brief would let
one line typed into a text box delete §12.

### 4. An automation is a standing instruction, not a job kind

`app.create_automation` writes a `responsibilities` row with
`job_kind = 'office.instruction'` and the sentence in `pinned_config`.
`office.instruction` already understands every sentence Grant types — the
router reads it, picks a roster, and the work happens the way it happens when
he asks in Slack. There is exactly one kind to validate and it always has a
handler.

Two columns made it possible, and both were being dropped on the floor:
`responsibilities.pinned_config`, which the dispatcher never copied onto the
job, and `recipient_agent`. Before 0324 a duty of kind `office.instruction`
fired a job whose handler immediately threw *"the command carried no
instruction"* — the capability was one column short of existing and looked
complete.

An automation nobody is named on belongs to the Chief of Staff (0328), which is
what an empty roster means everywhere else here.

### 5. No new table

`public.responsibilities` is the automation table. It has had `project_id`,
`staff_id`, `job_kind`, `period_minutes`, `at_time`, `timezone` and `enabled`
since it was written, `app.dispatch_due_responsibilities` fires them every
tick, and twelve rows in it run the office today. What it never had was a
writer — every one of the twelve came from a migration.

This is #169's rule applied before inventing the noun: the office already has
an Automation and it is called a responsibility.

## Consequences

**Good.** Nothing changes for a project Grant has not configured, which is all
four of them, so the migration is a no-op until he uses it. An automation he
writes in the UI is a capability he has, which is the long-range goal that
outranks most others in CLAUDE.md. Removing an agent is reversible and visible.

**The cost.** `project_staff` cannot answer "who is on this project" without
reading `staff` too, so every caller goes through `app.staff_on_project` or
`app.project_team` rather than selecting from the table. That is the right
trade — the alternative was eight rows per project written at creation, which
is the explicit roster in a different disguise and rots the moment a ninth
person is hired.

**What this does not decide.** Whether an automation should be able to trigger
on an EVENT rather than a schedule — Grant's own example is *"when a document
lands in this collection"*, and this delivers the schedule half. The event half
needs a trigger vocabulary and is left to #36's remaining work rather than
guessed at here.

## Alternatives rejected

- **An explicit roster, seeded for every project at creation.** Correct on day
  one and wrong on the day a ninth agent is hired or a project is created by an
  agent that forgets to seed it. The default belongs in the query, not in rows.
- **A `job_kind` dropdown for automations.** See Context. It offers Grant a
  list of things that mostly cannot help him and some that cannot work.
- **A separate Agent configuration screen.** Two places to make one decision.
- **Replacing the staff prompt per project.** One text box that can delete §12.
