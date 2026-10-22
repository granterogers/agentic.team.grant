# ADR-0076: Microsoft To Do is a delegated copy of the office's list, one provider among the others

**Status:** Accepted

**Date:** 22 October 2026

## Context

Grant asked for the office's tasks to stay in step with his Microsoft To Do. The task-provider seam already exists
(#259: `src/tasks/provider.ts`, `src/tasks/sync.ts`, with Vikunja as the one implementation). Supabase is canonical, and
a provider is a projection that may be told everything and may report changes, but is never consulted for "what is on
Grant's list" (`app.my_tasks`).

Microsoft To Do differs from Vikunja in three ways that matter:

- its only supported access for a personal account is delegated OAuth, so there is no API token to paste (the Google
  connection, ADR-0013, is the model);
- Microsoft **rotates** the refresh token on use, so a rotated token that is not stored ends the connection at the next
  round;
- it has three importance levels against the office's four.

## Decision

1. **Microsoft To Do is one more `TaskProvider`, named `microsoft_todo`.** Everything Microsoft-shaped is in
   `src/tasks/microsoft-todo.ts`. `src/tasks/sync.ts` is unchanged and imports none of it.
2. **Delegated, on Grant's own account, with his consent.** The durable credential is a refresh token from a consent
   screen the office starts from Settings (`supabase/functions/microsoft-oauth`). It lives in the vault as
   `microsoft_todo.refresh_token`. Nothing reads it except the duty, and no error message carries it.
3. **Rotation is stored before anything else.** The provider hands a rotated token to `app.microsoft_todo_rotate_refresh`
   at the moment Microsoft issues it.
4. **Its own duty.** `microsoft.todo_sync` runs every fifteen minutes. It is a separate job kind from `tasks.sync`, so
   a Microsoft outage can never be reported as a Vikunja one. It is disabled until Grant connects, and `forget` disables
   it again.
5. **The list is the default list unless one is chosen.** When no list is stored, the first round reads Microsoft's
   default list (`wellknownListName` = `defaultList`) and remembers it. A choice of list is not offered yet.
6. **The same governance as Vikunja.** Creating and updating on the connected list is the standing yes that connecting
   gives. Deleting a remote task is an exact question each time, and a refusal holds that task on both sides.
7. **Disconnecting never loses a task.** It removes the links, the list, the health reading and the refresh token, and
   reports how many tasks it kept. The client id and secret belong to the Azure app registration, not to the connection,
   so they are kept.

## Known limits, stated rather than hidden

- **Priority.** Microsoft has three levels. Urgent (10) and important (20) both become `high`, and `high` comes back as
  20. An urgent task edited in Microsoft To Do comes back as important. This is the honest limit of the provider.
- **Due dates.** Written as midnight UTC, read back as the date part, as Vikunja does. A time set inside To Do is kept as
  its day.
- **Tenant.** The consent screen uses the `common` endpoint, so personal and work accounts both work. A work account may
  need an administrator's consent for `Tasks.ReadWrite`.

## What round-trips, measured against Microsoft's own definition (Graph v1.0, todoTask)

Checked against https://learn.microsoft.com/en-us/graph/api/resources/todotask?view=graph-rest-1.0 and the checklistItem
and linkedResource pages, 22 October 2026.

- **Held by the office and round-tripped:** title, body (as plain text), done, importance (three levels to four, see
  above), due date (day only).
- **Kept on Microsoft's side because the office never writes them:** categories, isReminderOn and reminderDateTime,
  recurrence, startDateTime, checklistItems, linkedResources, attachments, extensions, singleValueExtendedProperties,
  createdDateTime, completedDateTime.
- **Kept on update by reading Microsoft's copy first:** the due TIME and its time zone (when the date is unchanged), and
  the statuses inProgress, waitingOnOthers and deferred (when the office does not complete the task).
- **Not shown in the office, and not lost:** the fields in the second list. The office does not hold them, so it cannot
  show them, and it does not overwrite them. Showing them would need a canonical field per item, which is a decision
  for Grant, not an engine change.
- **Limits still open:** a note written as formatted text in To Do comes back as plain text; an office edit to the note
  replaces the formatting. Microsoft's own behaviour for reminders when a status changes is not verified live.

## Why

- It reuses the seam, the engine, and the governance that already keep Vikunja honest, so the two providers cannot
  drift apart in what they may do.
- A separate job kind keeps the outage messages, the health reading and the disable switch per provider. One switch
  that turned off two integrations would be a defect in the control, not a convenience.
- Storing a rotated token in the same round is the only way a delegated connection keeps working unattended.

## Rejected

- **Pasting a token, as Vikunja does.** Microsoft does not issue a long-lived API token for To Do. A pasted refresh token
  would also go stale at the first rotation the office did not catch.
- **Device-code sign-in.** It would avoid the callback, but the office already has one OAuth consent path that stores a
  refresh token in the vault. A second path is a second place for that rule to be wrong.
- **Matching tasks by title.** It duplicates every renamed task. The canonical-id mark in the body does what the seam
  requires.

## Consequences

- Grant must register an application in Microsoft Entra once, and paste its client id and secret into Settings. The steps
  are shown on the Settings card, with the redirect address. This is a human prerequisite that cannot be automated.
- The edge function `microsoft-oauth` is a new deployment. It is not deployed by this change.
- The migration that adds the connection is not applied to production by this change. Applying it is a separate,
  explicitly authorised production write.
