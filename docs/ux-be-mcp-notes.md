# External assistants / MCP calendar - backend notes (branch claude/ux-overnight-be-mcp)

> **Migration numbering (6 Oct 2026).** Written when the project calendar was migration 0897; it is now **0906** (the Public Sample Office applied its own 0897 to 0905 to production first). Read "0897" below as 0906.

Everything here is **unapplied to production**; driven only against the local replica `cand_mcp`.

## Changes

* `migrations/0924_the_assistant_calendar_tools_call_the_real_calendar.sql` replaces `app.mcp_event_list/create/update`
  (and their `public` wrappers) so they call the real 0897 calendar (`hq_project_events`, `hq_event_add`,
  `hq_event_update`) with `p_channel` from `mcp_clients.kind` and `p_authority 'agent'`. Signatures changed (create and
  update gain `p_all_day`; update's id is a uuid), so the old overloads are dropped by exact signature. The by-name
  dispatcher `app.mcp_event_call` is dropped (nothing called it). `app.mcp_optional_tools` now keys on the real
  wrapper names. Adds `app.mcp_event_channel`.
* `supabase/functions/mcp/tools.ts`: schemas and args for list/create/update_event (all_day added; no channel or
  authority offered to the model). `index.ts` needed no change.
* No `delete_event`: `hq_event_delete` hard-deletes unsynced events (no tombstone), so it is not exposed.
* `scripts/isolated/ux-be/05-mcp-calendar.sql` (new proof); `03-mcp-tools.sql` updated (the stand-in calendar section
  was removed; optional tools now expect all three).
* `tests/mcp/tools.test.ts`: three new tests.
* `docs/ux-external-assistants.md` updated.

## Apply order / merge notes

0897 (calendar) must be applied before 0924 (the wrappers are looked up at call time and tools are hidden if absent,
so applying 0924 first is safe but the tools stay hidden). 0920-0923 before 0924. Deploy the `mcp` function after.

## Not verified

* Nothing run against production or the real Google API; the approval policy gate on sync was not exercised here
  (only that authority 'agent' is stored).
* `scripts/isolated/ux-be/02-project-search.sql` fails on a replica that has the real 0897: it builds a stand-in
  `public.project_events` and hits "relation already exists". Pre-existing and out of this task's scope; 0921's search
  provider against the REAL events columns was not re-driven.
* The deployed edge function was not exercised (no `deploy:mcp`).
