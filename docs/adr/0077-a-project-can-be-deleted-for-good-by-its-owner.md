# ADR-0077 — A project can be deleted for good, by its owner, by typing its name

**Status:** Accepted · 2026-11-21 · Amends ADR-0022 (a project is archived, not deleted) for one case · Migrations 1111 and 1113 · Gateway action `project_purge`

## Context

ADR-0022 made archiving the only way a project leaves the project list. It was right for projects that hold history:
the activity ledger is append-only (master spec §6) and refers to projects, so a plain delete was refused, and an archive
kept everything. Since migration 1105 every project's creation is itself an activity row, so no project can be deleted
outright any more. The app therefore had no way to remove a project the owner really does not want, such as a test
project or one created by mistake, and the owner asked for one.

## Decision

The owner can delete a project for good. The rules:

1. **What is removed.** The project, and everything **stored in this office** for it: its documents (and their stored
   files), to-dos, contacts, jobs and their outputs and steps, decisions, signals, attachments, names, and every activity
   row that refers to it, together with its background picture.
2. **What is not touched.** Files and records that live in an external service (Google Drive, Google Docs, Notion, Slack,
   and similar) are not deleted, and nothing is sent to those services. Only the local copy of a link is removed.
3. **Who.** Only a person, signed in as themselves. Never a guest of the sample office, a machine key, or a test member.
4. **Two steps.** The first step counts what would go and says so. The second requires the project's exact name typed.
   The reserved catch-all project cannot be purged.
5. **One transaction.** The database removes the rows in a single transaction, or nothing. Any row still held when the
   removal is finished stops it and rolls it back. The stored files are removed by the gateway only after that commit, so
   a refusal never leaves a file gone and a row kept. A file that fails to go is reported by its path.
6. **A record that it happened.** One activity row is written with no project link, named `project.purged`, saying the
   project's name, how many records went, and that files stored elsewhere were not touched.

## The exception to the ledger, stated exactly

The append-only triggers on the tables the purge removes from are switched off for the length of that one transaction,
and switched back on before it commits. No other table, and no trigger on any other table, is changed. The function is
`app.hq_project_purge` (migration 1111). Its plan, `app.hq_project_purge_plan`, changes nothing.

This is the only place in the database that removes ledger rows. It is intentionally narrow: it is reachable only through
the gateway action, only for a named project, and only after the typed name matches.

## Consequences

- A project created in the app can now be deleted for good, rather than only archived. ADR-0022's archive remains the
  default and is still what "Put it away" does.
- Deleting removes history about that project. That is the point of the decision, and the purge record is the only trace
  kept. Owners should archive instead when the history matters.
- A purge's files are removed after the database commit. If that step fails the rows are already gone, and the failed
  paths are reported so they can be removed by hand. This is the one place a purge can leave a stray file, and it is
  named rather than hidden.
- The guard for this is in the proofs: `scripts/isolated/` checks the archive-first behaviour, the name check, the
  reserved refusal, that another project is untouched, and that the triggers are back on afterwards.

## Amendment, 21 November 2026: the lighter path (migration 1113)

A project that holds nothing but its own creation record can be deleted without typing its name. "Nothing but" means
no rows in any table except its own `project.*` activity (created, renamed, archived) and its connector and channel links.
The database decides this (`app.project_is_empty`); the page only asks. Anything else keeps the typed-name step, and a
blank name for such a project is refused. The purge record is still written.
