# ADR-0075: The Card Table renames and hides its columns; it does not add or remove them

**Status:** Accepted

**Date:** 22 October 2026

## Context

Grant's brief asked for the Card Table to start with four columns and to allow columns to be added, removed and renamed
by hand. The four columns are the four task states the backend keeps (`todo`, `doing`, `blocked`, `done`). A new column
would be a new task state, which means a backend change and a migration. Removing a column would need a rule for the tasks
already in it. Neither can be decided in the page.

## Decision

1. Each of the four states keeps its place and its meaning. A column can be **renamed** (up to 24 characters) and
   **hidden**. A hidden column keeps its tasks, and they reappear when it is shown again.
2. The names and visibility are stored in the project's layout document (`columns: { names, hidden }`), with the other
   layout settings. No backend change and no migration.
3. At least one column is always shown. Hiding all four is refused.
4. A name equal to the default is not kept as a rename.
5. The Card Table's header carries a **Columns** button. Its popover holds a name field and a show checkbox for each state.

## Why

- It delivers the part of the request that a person can use now, without a backend change or a production write.
- It leaves the task states as the one source of truth: a task is always in exactly one of the four states, whatever its
  column is called.

## Rejected

- **Add and remove columns as real states.** It needs a migration to the task-state constraint, and a rule for removed
  states. It is a production write and a schema decision, so it needs its own ADR and Grant's approval.
- **Column names per device.** The layout is saved for the project, so the names follow the project, as the layout does.

## What would reverse it

- Grant asks for real custom states. That supersedes this ADR: a new ADR records the states, the migration and the rule for
  removing one.

## Verification

- `tests/studio/columns-and-dates.test.ts`: defaults, renames, the 24-character limit, hiding, the refusal to hide all four,
  dropping unknown ids, and the round trip through the saved document.
- Browser check on the Sample at 1440 px: the popover takes focus, a rename and a hide appear in the Card Table, the header
  summary uses the new names, and Escape returns focus to the Columns button. No overlaps, no page errors.
