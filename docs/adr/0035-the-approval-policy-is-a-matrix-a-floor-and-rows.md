# ADR-0035 — The approval policy is a matrix, a floor, and rows

**Status:** accepted · 2026-09-17 · Issue #15 · migrations 0421–0424

## Context

§31A asks for a policy distinguishing actions that proceed automatically,
actions allowed under standing authorization, and actions that genuinely need
Grant. His own words for what it is for:

> *"I am interrupted only when a genuinely necessary decision, approval or
> authentication challenge requires me."*

Every ingredient already existed and none of them were joined up.
`tool_permissions.level` had been 0/1/2/3 across 22 tools for months;
`public.autonomy_level` and `app.autonomy_for(project)` resolved a dial
project-over-global with a conservative default; `public.blockers` carried the
question, the reason, the consequence of delay and the options, with 397
resolved rows behind it.

`app.autonomy_for` was in `check:callers`' baseline. **Nothing in `src/` ever
asked what the dial said**, and the only two rows in `autonomy_settings` had
been written by a verify suite. `handlers/drive.ts` called `raiseBlocker`
unconditionally — and offered, as one of its four options, *"Just tell me when
things land here, do not ask again"*, which nothing could honour because there
was nowhere to write the answer.

## Decision

**The action class is `tool_permissions.level`.** Nothing new is invented. A
second taxonomy of "action classes" beside the levels would be two vocabularies
for one thing, which is what 0311 was spent undoing.

**The policy is a matrix, as data.** `public.autonomy_policy` holds sixteen
rows — autonomy level × action level → `proceed | ask | refuse`. Grant can edit
a cell without a code change, which a list in TypeScript would not allow
(0366's rule). `observe` is the row that gives `refuse` a meaning: a project the
office reads and does not write to. Without it `observe` and `suggest` would be
the same row.

**The floor is a CHECK, not a comment.**

```sql
check (action_level < 3 or verdict <> 'proceed')
```

A level-3 action can never resolve to `proceed`, however the matrix is edited.
#15 asks that destructive or externally-visible actions cannot bypass the
policy; this repository has four recorded occasions of a comment claiming a
property with nothing behind it, so the guarantee is structural. A companion
trigger refuses a standing authorization on a level-3 tool, because a CHECK
cannot read another table.

**"Do not ask again" is a row.** `public.standing_authorizations` upgrades
`ask` to `proceed` for one tool, in one project or everywhere. It can never
touch `refuse` — `observe` plus a live standing row still refuses — and only
Grant writes one, because both wrappers hardcode the actor exactly as
`hq_approve_tool` does. An agent cannot widen its own permissions because there
is no argument through which to try.

**Work a person asked for does not stop to ask them again.**
`jobs.requested_by` is `duty:<name>` for a schedule and `<channel>:<actor>` for
a person, so the test is a property rather than a list of job kinds that will
go stale. Below level 3 a prompted job proceeds: if Grant says *"put the module
outline in Notion"*, asking him whether he would like it in Notion is precisely
the interruption #15 exists to remove. Level 3 and `refuse` are untouched.

**A duty Grant switched on is a standing authorization — as a row, not as a
special case.** `calendar-task-sync` writes to his diary every hour. Gating it
without this would have raised a question sixteen times a day about something
he deliberately enabled: the interruption #15 exists to remove, delivered by
the feature meant to remove it. 0424 seeds the row with the duty named in its
reason, so it sits on the Behaviour page beside every other exception and
revoking it makes that duty start asking.

## Consequences

- The dial on the Settings page decides something. Four levels, each a
  different answer, driven by `verify:approval` at all sixteen cells.
- `governOutward` takes a **Plan**, not a sentence. #131: *"approving something
  you cannot see is not an approval, it is consent to a category"* — and the
  plan is produced by the code path that performs the action, so the question
  names exactly what would happen.
- **A tool that is a side effect of a job is not a tool the job was asked
  for.** Pressing *Check now* on a Drive folder asks for a look, not for
  everything in it to be taken in, so `handlers/drive.ts` deliberately does not
  pass the job. The parameter is called `jobAskedFor` to make the misuse
  visible.
- `office.notion_sync` is **not** gated, because it has no dry-run plan. Gating
  it before it can say what it would do would produce an approval request
  nobody could read. It gains the gate when it gains a plan.
- A refusal writes a `needs_permission` impediment (#211): a gate that refuses
  without recording is a lost answer, not a saved one.

## What this does NOT claim

Three outward paths are governed: `drive.watch`'s ingest, the calendar duty,
and anything routed through `governOutward`. `notion-import` and
`notebook.generate` have their own approval flows and are deliberately not
double-gated. The policy is real and unbypassable where it applies; it does not
yet apply to every line of code that can reach a connector.

## Alternatives rejected

- **A boolean per tool.** Cannot express `observe`, and makes every future
  autonomy level a schema change.
- **The matrix in TypeScript.** Faster to write and removes Grant's ability to
  change his own office's behaviour, which outranks it.
- **Parsing `blockers.approval_options` to find out what answering grants.**
  Free text a handler composes in whatever English reads best; deciding a
  permission by matching words in it is #130's parsing defect on a security
  boundary. Two columns name it instead.
- **A "duty consent" branch inside the resolver.** A second rule nobody can see
  on any page. A seeded row is visible, revocable, and uses the mechanism that
  already exists.
