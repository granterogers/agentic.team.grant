# UX overnight backend (branch claude/ux-overnight-be-act): notes and contracts

Four items, migrations **0920-0923**, all UNAPPLIED to production. Proofs run only against the local replica copy.

| Migration | Item | Proof (local, rolls back) |
|---|---|---|
| 0920_an_activity_row_says_which_door_it_came_through | Activity provenance | scripts/isolated/ux-be/01-activity-via.sql |
| 0921_one_search_across_a_projects_stores | Unified project search | .../02-project-search.sql |
| 0922_an_external_assistant_works_the_project_through_named_tools | MCP tool projections | .../03-mcp-tools.sql |
| 0923_a_project_can_have_a_house_style | Style profiles | .../04-style-profiles.sql |

Order matters: 0922 uses 0920 (`mcp_clients.kind`, `app.via`), 0921 is independent, 0923 uses 0920 (`events.origin_channel`). Renumber together if
a sibling takes the numbers; file names carry no cross-references except the comments.

## 1. Activity provenance (0920)

Both readers now add `via` and `category` to every row.
`app.studio_activity(project, limit)` rows: `{who, verb, what, when, at, detail, via, category}`.
`app.hq_studio_lately(office, limit)` `office[]` rows gain `via`, `category` (a folded row has `times`).
* `via`: `"Team HQ" | "ChatGPT" | "Claude" | "External assistant" | "Telegram" | "Slack" | "Voice" | "Google sync" | "Notion sync" | null`. **null = unknown, never guessed**: a person's own Team HQ press that writes no event/job channel stays null.
* `category`: `task | document | calendar | sync | research | other` (from `app.activity_category(action_type)`).
* Where it comes from: `events.origin_channel` (new, written by `app.append_event` from the transaction's `app.via` setting; no signature change), else the event's job (`app.job_via`: MCP client kind, `inbound_commands.context.via`, or the inbound `origin_channel`), else `tasks.added_by = 'mcp:<client>'` / `documents.added_by = <client>`.
* New: `mcp_clients.kind` (`chatgpt|claude|other`, derived by trigger from the registered name). Documents an MCP client adds (origin `source`, connector `mcp`) now appear in project Activity (they did not before).
* Both readers also exclude events whose job is harness traffic (`app.harness_job`).
* Deliberately NOT done: `inbound_commands/deliveries/notification_preferences` CHECKs were not widened with chatgpt/claude (see the 0920 header: those answer "where can the office reply", and no adapter or `DeliveryChannel` serves these). `DeliveryChannel` and `adapter_key_ok` are unchanged on purpose.
* Frontend filters: user = `kind=user`... (existing `kind` on lately rows), agent, integration (`via` in ChatGPT/Claude/Telegram/Slack), sync/documents/tasks/calendar = `category`.

## 2. Project search (0921)

Gateway: `GET hq-api?section=project_search&q=<1-200 chars>[&project=<uuid>][&kinds=task,page]` -> rows
`{kind, id (text), title, snippet, project_slug, url_hint, score, at}`. kinds: `document source page task message answer research postit event`.
`GET hq-api?section=project_search_providers` -> `[{provider, kinds[], available}]` (events is `available:false` until 0897).
Providers are `app.psearch_{documents,tasks,chat,research,postits,events}` unioned by `app.project_search`. Calendar is dynamic SQL behind `to_regclass('public.project_events')`; it reads `event_id|id, office_id, project_id, title, starts_at|start_at` and optional `description|notes|detail`, `location`, and returns nothing (no error) if the shape differs. Post-its are read from the `__workspace` entry of `dashboard_layouts.panels` (surface `basecamp`, owner = office actor). `url_hint` is `/p/<slug>/<tool>[?focus=<id>]` (the `focus` param is a suggestion for the UI; nothing reads it yet).

## 3. MCP (0922 + supabase/functions/mcp/tools.ts)

New tools: search_project, list_tasks, create_task, update_task, list_events, create_event, update_event (calendar tools listed only when `mcp_optional_tools` says the database has `public.hq_event_list/create/update`), inspect_activity, ask_team, start_research, generate_artifact. See docs/ux-external-assistants.md. Also fixed: the scope-refusal audit call omitted `p_office` (so refusals were never recorded).
Assumed calendar contract (UNVERIFIED against 0897): see the 0922 comment; adjust `app.mcp_event_*` only.

## 4. Style profiles (0923)

Table `public.style_profiles` (RLS on, no direct grants). Gateway: `GET hq-api?section=style[&slug=<project>]` -> `{scope, project, profile, inherited_from{"palette.primary":"project"|"office",...}, office_profile, project_profile, vocabulary{fonts, palette, title_pages, densities}}`.
Actions: `style_set {p_patch, p_slug?}`, `style_clear {p_slug?, p_field?}` (person only; channel written as `teamhq` by the wrapper). Patch semantics: JSON null removes a key; arrays replace; objects merge per key; refused patches are named and store nothing. No automatic style extraction exists: `source` only records what a person said.
Renderer: `renderReport(report, style?)`; `src/artifacts/style.ts`; `handlers/artifact.ts` loads the resolved profile (`loadStyle`, fails open). Honoured: palette (primary, accent, ink, paper, wash, rule), heading/body face (Helvetica or Times), title page `band`. Not drawn: logo (no image support), tone/terminology/structure/instructions (stored for drafting prompts; NOT yet fed into the drafting prompt). The chart title still uses the literal bold face. Default output is byte-identical (pinned by hash in tests/artifacts/style.test.ts). Sample: /tmp/ux-style-sample.pdf rasterised and inspected (no collisions).

## Not verified / remaining live verification

* Nothing applied to or tested against production; no deployment of edge functions.
* `check:callers`, `check:consumed`, `check:anon-exposure`, `check:gateway-wrappers`, scripts/check-office-*.ts REFUSE without a production token (correctly) and were not run. Expected: public wrappers added for every gateway/MCP target; `app.mcp_event_*` reach 0897 only dynamically (check:callers may want a baseline entry with that reason).
* The worker was not run: an `ask_team` turn (origin `unknown`) answering and writing to the thread, and `artifact.report` honouring `announce=false`, are unverified end to end.
* Calendar contract unverified (0897 absent). `vitest` full run: 298/299 files pass; `tests/sessions/weather-is-not-a-failure.test.ts` exits with process.exit(2) and fails identically at the base commit.
* `check:pressable` baseline gained four entries with reasons (style_set, style_clear, project_search, project_search_providers).
