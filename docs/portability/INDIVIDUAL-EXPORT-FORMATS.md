# Individual export formats (Workstream C, first slice)

Status: **serialisers implemented and unit-tested; not yet wired to a gateway route, a download button or a restore path.**
Code: `src/portability/formats.ts`. Tests: `tests/portability/formats.test.ts` (31 checks, including a sabotage control
that removes the `;` escape and turns two of them red).

## Formats

| Record | Format | Function | Standard |
|---|---|---|---|
| Contacts | vCard 4.0, one card per contact, CRLF | `contactsToVcard` | RFC 6350 |
| Calendar events | iCalendar 2.0, one `VEVENT` per event | `eventsToIcal` | RFC 5545 |
| Tasks | CSV, header row, RFC 4180 quoting | `tasksToCsv` | RFC 4180 |
| Any record set | JSON envelope `{format, version, exported_at, project, count, records}` | `toJsonExport` | — |

## Field mapping

**Contacts → vCard.** `name`→`FN` (required by the standard), `kind`→`KIND` (`company`/`supplier`→`org`, otherwise
`individual`), `role`→`TITLE`, `org`→`ORG`, `email`→`EMAIL`, `phone`→`TEL;VALUE=text` (free text is not forced into a
URI), `website`→`URL` only when it is a real http(s) address after an `https://` is added, otherwise `X-WEBSITE`,
`instagram`→`X-INSTAGRAM`, `where`→`ADR` in the street slot, `note` + `next` + `next_due`→`NOTE`, `stage`→`X-STAGE`,
`last_at`→`X-LAST-CONTACTED`, `updated_at`→`REV`, `contact_id`→`UID` as a `urn:uuid`. Empty optional fields are omitted.

**Calendar → iCalendar.** `event_id` and `calendar_id` form the `UID`; `starts_at`/`ends_at` are written in UTC;
`all_day` events are written as `VALUE=DATE` in the **office's zone** (passed in by the caller). `summary`→`SUMMARY`,
`location`→`LOCATION`, `excerpt`→`DESCRIPTION`, `html_link`→`URL` (http(s) only), `status`→`STATUS` (confirmed,
tentative, cancelled; any other value is omitted), `remote_updated_at`→`LAST-MODIFIED`.

**Tasks → CSV.** Columns: `task_id, title, detail, state, blocked_on, due_on, starts_on, priority, is_milestone,
parent_task_id, assigned_to_human, added_by, created_at, updated_at, done_at`. A null is an empty cell, never the word
`null`.

## Deliberate limits

- **Attendee names are not exported.** The calendar cache stores a count, by design (migration 0109). No `ATTENDEE`
  lines are written.
- **Recurrence is not exported.** The cache holds expanded instances, not the rule.
- **Contact `where` is an unstructured address.** It is placed in the street slot, not parsed into components.
- **Tasks are CSV only, plus JSON.** There is no iCalendar `VTODO` yet.
- **Spreadsheet formula guard.** A text cell beginning `=`, `+`, `-`, `@`, tab or CR is prefixed with an apostrophe
  (OWASP mitigation). Numbers and booleans are never prefixed. A title that is a formula therefore reads with a leading
  apostrophe in the file. This is a known, deliberate change to the value.
- **Timestamps** are UTC. Local display is the consumer's job.

## Verified

- `npx vitest run tests/portability`: 31 passed.
- Sabotage: removing the `;` escape turns 2 tests red (`escapeText`, and the populated-contact test). Restored and green.
- `npx biome ci src/portability tests/portability`: exit 0.
- `npx tsc --noEmit`: no errors in these files (the repository has 283 pre-existing errors in `scripts/verify`, unchanged).

## Not verified

- No file has been opened in a real vCard or calendar client (Apple Contacts, Google Calendar import, Outlook). The
  output follows the RFCs and round-trips through an independent CSV parser, but import into a real client is an owner
  check.
- No export has been produced from a real project. The functions take rows; reading them from the database for a given
  project is the next step and is not done.

## Next steps (tracked as Issues)

1. A read path: one gateway section per export kind, scoped by the caller's office and project, reading through the
   existing SQL executor with the project-scoped predicate. Row-level security must still hold for that read.
2. A download button in project settings that calls the gateway and saves the returned text. Large projects should
   stream rather than buffer.
3. The archive: ZIP with a manifest, checksums and the original document files, built on the existing backup manifest
   conventions in `src/backup/manifest.ts`.
