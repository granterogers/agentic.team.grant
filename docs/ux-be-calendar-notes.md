# Project calendars - backend notes (branch claude/ux-overnight-be-cal)

Each dashboard project has its own calendar. Events made in a project belong to it from birth and synchronise toward
Google Calendar when Google is connected (create, edit, delete, both directions). Existing Google events stay Google's
and can be FILED under a project. Everything below is **unapplied to production**; it was driven only against a local
replica.

## What is in the branch

| Piece | File |
|---|---|
| Tables, functions, wrappers, duty | `migrations/0897_project_calendar_events.sql` |
| Google REST adapter (create / patch / delete, typed outcomes) | `src/google/calendar-events.ts` |
| The sync duty, kind `calendar.sync_events` | `src/handlers/calendar-events.ts`, registered in `src/office/pass.ts`, classified in `src/jobs/containment.ts` |
| `refreshCalendar` now says whether it really refreshed, and which calendar | `src/google/calendar.ts` (two optional fields) |
| Gateway wiring | `supabase/functions/hq-api/index.ts` |
| Proof against a local replica | `scripts/isolated/project-calendar.ts` |
| Unit tests | `tests/google/calendar-events.test.ts`, `tests/handlers/calendar-events.test.ts` |
| Pressable baseline (UI not built yet) | `docs/testing/pressable-baseline.json` |

Note on the file name: the brief asked for `src/google/calendar-write.ts`, but that file already exists (it puts dated
TASKS in the diary, #94). The new adapter is `src/google/calendar-events.ts`; `calendar-write.ts` is untouched.

## Gateway contract (hq-api)

All calls carry the usual session bearer. The office is always the verified session's; a client-sent office is discarded.

### Section `project_events` - `GET ?section=project_events`

| Query | Meaning |
|---|---|
| `scope` | `project` (default if omitted by the function; the gateway only forwards it when sent) \| `all` \| `google`. Anything else: 400 naming the allowed words |
| `project` (or `p_slug`) | project slug. Required for `scope=project`, ignored otherwise |
| `from`, `to` | window; dates or timestamps (`2026-10-01` or `2026-10-01T09:00:00Z`). Defaults: from = now - 30 days, to = from + 90 days. Max 400 days |

Response (`hq_project_events`):

```json
{
  "ok": true, "scope": "project", "project": "alpha",
  "from": "2026-10-01T00:00:00+00:00", "to": "2026-11-30T00:00:00+00:00",
  "google_connected": true,
  "events": [
    {
      "id": "<uuid>" , "source": "team_hq", "title": "Site walk",
      "starts_at": "2026-10-12T09:00:00+00:00", "ends_at": "2026-10-12T10:00:00+00:00", "all_day": false,
      "notes": null, "location": null,
      "project_slug": "alpha", "project_name": "Alpha",
      "sync": "pending", "sync_error": null,
      "external_url": null, "origin_channel": "teamhq", "editable": true
    },
    {
      "id": "g:primary:<googleEventId>", "source": "google", "title": "Board meeting",
      "starts_at": "...", "ends_at": "...", "all_day": false, "notes": "<first 300 chars>", "location": null,
      "project_slug": "alpha | null", "project_name": "Alpha | null",
      "sync": "external", "sync_error": null,
      "external_url": "https://www.google.com/calendar/event?eid=...", "origin_channel": "google_sync", "editable": false
    }
  ]
}
```

On refusal: `{ "error": "<why>" }` (HTTP 200, like sibling functions) - unknown project, bad scope, bad date, window too long.

* `scope=project`: that project's native events + Google events assigned to it.
* `scope=all`: every active, non-fixture project's native events + every Google event assigned to such a project.
* `scope=google`: the whole Google cache (unassigned events have `project_slug: null`), plus native events that are
  `pending|synced|error` (i.e. live in Google). A native event whose Google twin is in the cache appears ONCE, as the
  native. Cancelled Google events and tombstoned native events never appear. Fixture projects never leak.
* All-day events: `starts_at`/`ends_at` are UTC midnights and **the end is exclusive** (a one-day event ends the next
  day), exactly as Google writes them. `all_day: true` is the cue to render a date, not a time.
* `sync`: `local` (Google not connected, never sent) / `pending` (owed to Google) / `synced` / `error` (Google refused;
  `sync_error` says why; editing the event retries) / `external` (a Google event, read-only here).

### Actions - `POST {action, args}`

All five are person-only (none is in `SERVICE_MAY`, so the machine key gets 403 `person_required`). Each returns
`{ok: true, ...}` or `{error: "<why>"}`.

| Action | Required args | Optional args | Returns |
|---|---|---|---|
| `event_add` | `p_slug`, `p_title`, `p_starts_at` | `p_ends_at`, `p_all_day` (false), `p_notes`, `p_location`, `p_channel` (`teamhq`) | `{ok, id, project, sync, starts_at, ends_at, all_day}` |
| `event_update` | `p_event` (uuid) | `p_title`, `p_starts_at`, `p_ends_at`, `p_all_day`, `p_notes`, `p_location`, `p_channel` | `{ok, id, changed, sync, ...}` |
| `event_delete` | `p_event` | `p_channel` | `{ok, id, mode: "deleted" \| "tombstoned"}` |
| `event_assign` | `p_calendar_id`, `p_event_id`, `p_slug` | `p_channel` | `{ok, id: "g:<cal>:<event>", project, changed}` |
| `event_unassign` | `p_calendar_id`, `p_event_id` | `p_channel` | `{ok, id}` |

Semantics worth knowing before building the UI:

* `event_update` is a PATCH: an omitted/null arg is left alone. `p_notes: ""` / `p_location: ""` clear them. Moving the
  start without an end keeps the event's length. An update that changes nothing returns `changed: false`.
* Without `p_ends_at`, a timed event lasts one hour and an all-day event one day. For all-day, `p_ends_at` is the
  EXCLUSIVE end day.
* `event_delete`: an event that never reached Google is deleted outright; one that did is tombstoned (hidden at once)
  and removed from Google by the duty, then purged.
* For `event_assign`/`event_unassign` take `calendar_id` and `event_id` from the event's `id` (`g:<calendar>:<event>`; the
  event id never contains a colon, so split on the LAST colon). A Google event that is the twin of a native one
  cannot be assigned (it is already the native's).
* `p_channel` is a word of the shape `[a-z][a-z0-9_]{1,31}` (`teamhq`, `chatgpt`, `claude`, `telegram`, `slack`,
  `voice`, `google_sync` ...). It is stored on the event/assignment and in the Activity entry. A person's browser sends
  nothing (default `teamhq`). **Also accepted but not for the page:** `p_authority` (`person` | `agent`, default
  `person`) on add/update/delete: `agent` marks a row as an agent's proposal so the sync asks the approval policy
  before writing it outward. The page should not send it.
* Activity gets `event.created`, `event.updated`, `event.deleted`, `event.assigned`, `event.unassigned`, with the channel
  as the event's `trigger` and in `after_state.channel`; Google-side changes are recorded as `event.updated` /
  `event.deleted` with channel `google_sync` and actor `google_sync`.

## How Google sync works

1. A write sets `sync_state = 'pending'` when Google is connected (`app.google_calendar_connected`: the office's
   `connection_health` row for `google_calendar/oauth_client` is `ok`, written by every Google duty) or the event is
   already linked; otherwise `local`. When Google later connects, the duty promotes local events to pending.
2. The duty `calendar-event-sync` (job kind `calendar.sync_events`, every 15 minutes, seeded for every office that
   already has `calendar-refresh`; owner Marcus) runs: promote, push, refresh the cache, pull, purge. The calendar used
   is `calendar.calendar_id` (default `primary`), the same setting the other two Google calendar duties use.
3. Push: create asks Google first for an event tagged `extendedProperties.private.agenticEventId = <our id>` and adopts
   it if present (so a crash between Google accepting and us recording does not double-create); otherwise POST. Update is
   a PATCH. Delete reads the event back, checks our tag, then DELETEs; an event that is not ours is left alone.
4. A row edited while its push was in flight is NOT marked synced (the guard compares `updated_at`).
5. Agent proposals (`authority = 'agent'`) go through `governOutward` (tool `calendar.write`, level 2) once per batch.
   Grant's office currently holds a standing yes for `calendar.write` (0424), under which agent rows go out; revoke it
   and they are held with a question while the person's own rows still go.
6. Pull (`app.project_events_pull`), last writer wins by timestamp, every override recorded on the row (`sync_error`) and in
   Activity: a newer Google edit overwrites an older pending local edit and vice versa; Google cancelling an event
   tombstones the native; a linked event missing from a freshly refreshed cache, inside the cache window, counts as deleted
   in Google. **Notes are not pulled** (the cache keeps a 300-character excerpt only), so a Google-side description edit
   does not reach Team HQ and a later Team HQ edit of the notes overwrites it.
7. Failures are values: permanent ones (e.g. 403) park the row at `error` with the reason (a later edit retries);
   transient ones (429, 5xx, network) stay `pending`. No token is ever in a stored or returned string.

## What is unapplied

* `migrations/0897_project_calendar_events.sql` is NOT applied to production (nor anything else). It adds two tables, a
  composite unique key on `public.calendar_events (calendar_id, event_id, office_id)`, 14 `app` functions, 6 `public`
  wrappers, an update to `tool_permissions.delivered_by` for `calendar.write`, and the `calendar-event-sync` duty row.
* The worker must be deployed WITH the migration (the handler kind `calendar.sync_events` is registered in
  `src/office/pass.ts`). The duty row is created by the migration; a worker that does not know the kind would fail those
  jobs until deployed, so apply the migration and deploy the worker together (CLAUDE.md: a migration is not a deploy).
* The `hq-api` edge function must be deployed for the section and actions to exist.
* Deleting a project cascades to its native events and assignments (`on delete cascade`); a linked event deleted that
  way is not removed from Google. `app.project_delete` already refuses projects that hold jobs, so this is rare.

## What was verified, and what remains

Verified locally (see the report in the PR/handoff for the exact commands): `scripts/isolated/project-calendar.ts` (every
function driven on a marked replica inside a rolled-back transaction: scopes, project and office isolation, fixture and
archived exclusion, tombstones, assignment rules, audit entries with channel, pull conflict rules, and the real handler
against a fake Google incl. idempotence, adoption, approval holding and failure recording, with two sabotages shown red),
the vitest suite, `tsc`, `biome ci`, `check:migrations`, `check:templates`, `check:secrets`, `check:pressable`,
`check:suite-classes`, `check:office-raw-sql`, `check:suite-offices`.

NOT verified (needs Google, production, or a database-backed checker this sandbox must not run):

* A real Google connection: real tokens, real calendar, the `privateExtendedProperty` lookup, etag/`updated` values,
  `If-Match` (the adapter supports `ifMatch`; the duty does not pass it - last writer wins by timestamp instead),
  recurring events (we only create single events; a Google recurring series stays external), time zones beyond UTC.
* `check:gateway-wrappers`, `check:callers`, `check:consumed`, `check:anon-exposure`, `check:capabilities`,
  `check:office-*`, `check:ownership` query the production database through the Management API, so they were not
  run as a gate (see the honest note in the report about the one that ran by accident). Expected results by reading:
  the six wrappers exist in 0897; every new function is named by the gateway or the handler; both new tables
  `revoke all`; no new tool_permissions row.
* `npm run verify:*` suites and `deploy:*`.
* Whether the ownership manifest (`src/ownership/manifest.ts`, `check:ownership`) wants the two new tables classified.

## Merge notes

* Migration number: `0897`. Sibling branches use 0900-0919 (docs) and 0920-0939 (activity). The multi-user-p4 branch may
  also claim `0897`; if so rename this file to the next free number (it depends on nothing after 0896 and nothing depends
  on it), then re-run `npm run check:migrations`.
* `docs/testing/pressable-baseline.json`: six entries (`action:event_*`, `section:project_events`) must be REMOVED in the
  merge that wires the calendar UI (the check fails on a baseline entry that has become pressed).
* `src/google/calendar.ts` gained two optional fields on `CalendarOutcome`; nothing else of existing behaviour changed.
* The duty's period (15 min) is the minimum the schedule allows near it; `responsibilities_period_sane` requires >= 10.
