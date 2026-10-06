# Working a project from ChatGPT or Claude

An external assistant reaches the office through one endpoint, the MCP server (`supabase/functions/mcp`). Everything
below is **unapplied and undeployed** until Grant says otherwise: migrations 0920-0922 are on a branch.

## Connecting

The endpoint is `https://<project>.supabase.co/functions/v1/mcp`.

**ChatGPT** (developer mode, "Add MCP server"): choose OAuth, give the URL above. ChatGPT registers itself, shows
Grant a consent page that names the client, and asks for his Team HQ sign-in. Approve with `read write` to let it add
tasks and ask the team; approve with `read` only for a look-but-don't-touch connector.

**Claude** (Settings, Connectors, "Add custom connector"): the same URL; the same OAuth flow.

Each connection becomes a row in `public.mcp_clients` bound to ONE office for life (the office of the person who
consented). Withdraw one without affecting the other: `npm run mcp:revoke`.

`mcp_clients.kind` (0920) is `chatgpt`, `claude` or `other`, derived from the name the client registered under. It is
the only thing that decides what Activity prints ("via ChatGPT"). A client that names itself something else shows as
"External assistant" - never as Team HQ.

## Scopes

| Scope | May |
|---|---|
| `read` | list_projects, search_documents, read_document, list_staff, recent_work, check_job, search_project, list_tasks, list_events, inspect_activity |
| `write` | everything above plus add_to_project, notebook_generate, push_to_notebook, ask_notebook, create_task, update_task, create_event, update_event, ask_team, start_research, generate_artifact |

The scope is checked twice: at the edge, before the call, and again in the database function (`app.mcp_write_client`),
so reaching `public.mcp_*` without the edge function is no better.

## Tools added in this change

| Tool | Does | Notes |
|---|---|---|
| `search_project` | one query over documents, saved webpages, tasks, conversation, Post-its, calendar events, research | typed results; `kinds` narrows; omit `project` for every project in the office |
| `list_tasks` | tasks, optionally by state | cancelled are never listed |
| `create_task` | adds a task | stamped `added_by = mcp:<client>`, so Activity says "via ChatGPT" |
| `update_task` | state (todo, doing, blocked, done), title, detail, due date | cannot cancel or delete; a blocked task needs a reason; writes a `task.updated` event carrying the door |
| `list_events`, `create_event`, `update_event` | calendar | **only listed where the database has the calendar (0906, written as 0897)**; see below |
| `inspect_activity` | the Activity feed with `via` and `category` | one project or the whole office |
| `ask_team` | puts a question to the team (optionally one specialist) | returns a job id; read the answer with `check_job` |
| `start_research` | asks the research director to investigate (optional https start page) | policy first: see below |
| `generate_artifact` | a PDF report from what the project holds | policy first: see below |

## What an assistant cannot do

* **Delete or cancel anything.** No tool deletes; `update_task` refuses `cancelled`; there is no event delete (see below).
* **Choose its office or its identity.** The office comes from the credential; the client id from the credential. Any
  `p_office` a model supplies is overwritten (`rpcArgs`, unit-tested).
* **Reach outside the office on its own say-so.**
  * `start_research` and `generate_artifact` call the owner's autonomy policy first (`app.authorize_effect` for
    `web.read` and `document.create`, the SQL half of `mayAct`). Only a verdict of `proceed` starts anything. `ask` or
    `refuse` returns `{status: "needs_approval" | "refused", because: ...}` and creates **no job** - the owner decides in
    Team HQ.
  * `ask_team` is deliberately **not a trusted turn**. The Team HQ composer's turns are Grant's own words and may act
    outside the office; text an assistant forwards is a model's rendering, so its job is `origin_class = unknown`:
    the team may think, answer and draft, and the containment guard (`src/jobs/containment.ts`) refuses anything it
    then tries to do to Notion, NotebookLM, Slack, Google and the rest.
  * No assistant request pushes to Grant's phone: `generate_artifact` jobs are `announce = false`.
* **See secrets.** No tool returns credentials; no tool takes one.

## Provenance: "Grant via ChatGPT"

The Activity feeds (`app.hq_studio_lately`, `app.studio_activity`) now return `via` and `category` on every row.

| Source | `via` comes from |
|---|---|
| a task or document an assistant added | `added_by` (the client id) -> `mcp_clients.kind` |
| an event an assistant caused | `events.origin_channel`, written from the transaction's `app.via` by `app.append_event` |
| an event or answer a job produced | the job: MCP client, `inbound_commands.context.via` (ask_team) or the inbound `origin_channel` (Telegram, Slack, Voice, Team HQ) |
| a Google or Notion sync | `Google sync` / `Notion sync`, only for a system actor |
| anything else | `null` - **unknown is shown as unknown**, never guessed as Team HQ |

`category` is `task`, `document`, `calendar`, `sync`, `research` or `other`, derived from the action type
(`app.activity_category`).

## The calendar tools (0906, written as 0897, + 0924)

The calendar tools call the real project calendar, never beside it: `app.mcp_event_list` -> `app.hq_project_events`,
`app.mcp_event_create` -> `app.hq_event_add`, `app.mcp_event_update` -> `app.hq_event_update`. Each checks the client
first (office, `write` scope, active non-fixture project) and sets the door (`app.via` = the client's kind).

* **channel** stored on the event (`project_events.origin_channel`): `chatgpt`, `claude`, else `external`.
* **authority** is always `agent`, so the calendar's sync asks the approval policy (tool `calendar.write`) before anything
  reaches Google. Neither value is a tool argument; a model cannot choose them.
* **Activity** reads "via ChatGPT" / "via Claude" / "via External assistant", category `calendar`.
* `list_events` returns what the Calendar tab shows (Team HQ events and Google events filed under the project); omit
  `project` for every active project. Window defaults to now + 90 days.
* `create_event`: project, title, starts_at, ends_at, all_day, location, notes. `update_event`: uuid + patch (only sent
  fields change; moving the start keeps the length). A Google-only event cannot be changed by an assistant.
* **No delete tool.** `app.hq_event_delete` hard-deletes an event that never reached Google (no tombstone, nothing to
  restore), so exposing it would break "nothing is deleted". Left out on purpose.
* Calendar tools are listed only when `public.hq_project_events` / `hq_event_add` / `hq_event_update` exist.

## Deploying (not done)

1. Apply 0920-0924 (0924 after the calendar, 0906) with `npm run migrate`. `npm run migrate` applies the pending files in filename order, so 0906 precedes 0924 on its own; the Public Sample Office's 0897 to 0905 are already applied and are not part of this.
2. `npm run deploy:mcp` (it probes tools/list).
3. Reconnect the connector in ChatGPT / Claude so it re-lists the tools.
