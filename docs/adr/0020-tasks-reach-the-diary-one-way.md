# ADR-0020 — Tasks reach the diary one way, and only ever touch events we made

**Date:** 2026-09-11 · **Status:** accepted · **Issue:** [#94](https://github.com/granterogers/agentic.team.grant/issues/94)

## The ask

Grant, 11 September, and his own emphasis:

> *"Add Google Calendar task synchronization: Allow connecting Google Calendar
> and synchronizing project tasks. **Treat this as a high-priority
> requirement.**"*

It is the only item in a thirty-item review that he ranked himself.

## What already existed

More than the issue assumed, which is worth recording because it changed the
shape of the work:

- `google_services` already carries a **calendar** row, and its scopes are
  `calendar.events` **and** `calendar.readonly`. The write scope is already
  granted — no re-consent, no new OAuth screen.
- `public.calendar_events` exists and holds six real events from Grant's diary.
- `src/google/calendar.ts` and `src/handlers/calendar.ts` refresh that cache
  hourly, and `scripts/verify/calendar.ts` covers it.

So **reading** the diary was finished. What was missing is the other direction:
a task in a dashboard project appearing in the diary.

## Decision

### 1. One way. Tasks become events; events never become tasks.

A two-way sync needs conflict resolution, and every two-way sync ever built has
eventually written something wrong into someone's calendar. The failure is also
silent and slow: you find out weeks later that a meeting moved because a task
did.

One-way is a day's work and cannot corrupt anything, because nothing in the
diary is ever read back as authoritative. If moving an event should move a
task, that is a second ADR and a deliberate decision, not a thing this drifts
into.

### 2. We only ever touch events carrying our own task id.

Every event this writes gets `extendedProperties.private.hqTaskId`. Every
update and every delete is matched on that property and on a link row we
stored, never on a title, a date or a search.

This is the rule that makes the whole feature safe. The office has write access
to a real human calendar. An implementation that found "its" events by matching
titles would eventually match a meeting Grant typed himself, and there is no
version of that which is acceptable.

### 3. The target calendar is `primary` unless he names another.

`calendar.events` can create events on a calendar; it **cannot create a
calendar** — that needs the broader `calendar` scope and a fresh consent
screen. So a dedicated per-project calendar, which the issue floated and which
would be tidier, is not available without asking him to re-authorise.

`calendar.target` therefore defaults to `primary` and can be set to any
calendar id he already has. If he makes an "AI Team" calendar in Google and
pastes its id, everything lands there and can be hidden or deleted wholesale —
the benefit of a dedicated calendar without the scope.

### 4. Only tasks that are dated, open, and not fixtures.

`due_on` is a `date` — note the name, not `due_at` — so events are **all-day**
events. A task with no date is not a diary entry; a calendar of undated todos
is noise, and noise in a diary is worse than absence because it trains you to
ignore the diary.

`is_fixture` is excluded for the reason it exists: harness traffic was once
reported to Grant as the office collapsing, and harness traffic in his actual
diary would be worse.

### 5. A task that leaves the open states has its event removed.

Done or cancelled, the event goes. A stale "do this today" in a diary is
actively misleading, and this only ever deletes an event carrying our own task
id — never anything he made.

This is a delete without a prompt, which sits against *"always check before
making any destructive action"*. The judgement: the object being deleted is one
the office created, representing a task the office is watching, and the
alternative is a diary that fills with completed work. The setting that turns
the whole sync off is one switch, and turning it off leaves the events in place
rather than sweeping them.

### 6. It is off until he turns it on.

`calendar.sync_tasks` defaults to false. Writing to a person's real calendar is
not something to begin because a feature shipped.

## Consequences

- A `task_calendar_links` table is the record of what we put there. Losing it
  would orphan events, so it stores enough to find them again: the calendar id,
  the event id, and the task id they came from.
- A content hash per link, so an unchanged task costs no API call. Sixteen
  refreshes a day against an unchanged task list should be free.
- Free tier: the Calendar API's quota is far above anything this will use, and
  polling stays on the worker rather than a cron, because GitHub Actions are
  off.
- If Grant later wants the other direction, this is not in the way — nothing
  here reads events back.
