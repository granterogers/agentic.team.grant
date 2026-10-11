# Hermes integration: interface contracts

Implements `ARCHITECTURE-DECISIONS.md` (HD-n). Every name here is the name to build. A change to a contract is a change to this file
in the same commit. Labels as defined in `ARCHITECTURE-DECISIONS.md`.

Contents: §1 vocabulary · §2 schema (migration 1070) · §3 SQL functions · §4 engine gateway HTTP · §5 bridge ↔ Hermes · §6 Hermes host
configuration · §7 TypeScript types · §8 handler seam · §9 MCP server changes · §10 Team HQ and adapters · §11 error and cancellation matrix.

---

## 1. Vocabulary

| Term | Meaning |
|---|---|
| **engine** | Who writes the draft answer for one turn: `team` (today, default) or `hermes`. Chosen by the person, stored on `inbound_commands.engine`, never changed afterwards. |
| **engine run** | One attempt by an outside engine to answer one job. Row in `public.engine_runs`. At most one per job (v1). |
| **bridge** | The outbound-only process on the Hermes host. Holds a bridge credential. Never touches the database. |
| **engine gateway** | The new edge function `engine`: the bridge's only door into the office. |
| **engine MCP client** | An `mcp_clients` row of kind `engine`, owned by one bridge, read tools only (v1). |

### 1.1 Run states

```
open ──claim──► running ──finish(completed)──► completed
  ▲                │  ├──finish(failed)──────► failed
  │   lease lapses │  ├──finish(cancelled)───► cancelled
  └── (claims < 3) ┘  └──deadline passes─────► expired
       claims = 3 and lease lapses ──────────► failed (reason 'bridge_lost')
```

`completed`, `failed`, `cancelled` and `expired` are terminal and write-once (a trigger refuses any later update of `state`).

---

## 2. Schema: migration `1070_an_outside_engine_answers_one_turn_and_the_office_keeps_everything_else.sql`

Number **1070** is reserved for this work (1060–1061 belong to the activity ledger). Before applying, confirm 1070 is still free against
`migrations/applied.json` and every branch (`git ls-tree` over `origin/*`), per `CLAUDE.md`. Follow the repository's office-model rules:
every new carrier table has `office_id uuid not null`, same-office composite foreign keys, the write-once-office trigger, forced RLS, and an
entry in `docs/multi-user/ownership-manifest.json`; `check:ownership`, `check:office-edges`, `check:carrier-writers` must pass.

```sql
-- 2.1 The person's choice, on the command (HD-13)
alter table public.inbound_commands
  add column if not exists engine text not null default 'team'
  constraint inbound_commands_engine_known check (engine in ('team', 'hermes'));

-- 2.2 A bridge: one Hermes host, one office, one engine (HD-3, HD-6)
create table public.engine_bridges (
  bridge_id        uuid primary key default extensions.gen_random_uuid(),
  office_id        uuid not null references public.offices(office_id),
  engine           text not null check (engine in ('hermes')),
  display_name     text not null check (length(btrim(display_name)) between 3 and 60),
  token_sha256     text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  mcp_client_id    text not null references public.mcp_clients(client_id),
  enabled          boolean not null default true,
  disabled_reason  text,
  last_seen_at     timestamptz,
  created_at       timestamptz not null default app.now_utc(),
  constraint engine_bridges_disabled_has_reason check (enabled or disabled_reason is not null),
  unique (bridge_id, office_id)
);

-- 2.3 One outside attempt at one turn (HD-4)
create table public.engine_runs (
  run_id           uuid primary key default extensions.gen_random_uuid(),
  office_id        uuid not null,
  job_id           uuid not null,
  project_id       uuid,
  engine           text not null check (engine in ('hermes')),
  state            text not null default 'open'
                     check (state in ('open','running','completed','failed','cancelled','expired')),
  bridge_id        uuid,
  claim_gen        integer not null default 0 check (claim_gen between 0 and 3),
  lease_until      timestamptz,
  deadline_at      timestamptz not null,
  request          jsonb not null check (pg_column_size(request) <= 65536),   -- §7 HermesRunRequest, sent verbatim
  hermes_run_id    text check (hermes_run_id ~ '^run_[0-9a-f]{32}$'),
  result           jsonb check (result is null or pg_column_size(result) <= 32768), -- §7 EngineRunResult
  failure          text check (failure is null or length(failure) <= 300),     -- redacted, one line
  created_at       timestamptz not null default app.now_utc(),
  started_at       timestamptz,
  finished_at      timestamptz,
  foreign key (job_id, office_id)     references public.jobs (job_id, office_id),
  foreign key (project_id, office_id) references public.projects (project_id, office_id),
  foreign key (bridge_id, office_id)  references public.engine_bridges (bridge_id, office_id),
  constraint engine_runs_running_is_held check (state <> 'running' or (bridge_id is not null and lease_until is not null)),
  constraint engine_runs_terminal_has_time check (state in ('open','running') or finished_at is not null)
);
create unique index engine_runs_one_per_job on public.engine_runs (office_id, job_id);
create unique index engine_runs_one_running_per_bridge on public.engine_runs (bridge_id) where state = 'running';
create index engine_runs_claimable on public.engine_runs (office_id, created_at) where state = 'open';

-- 2.4 Every MCP call the office served to a run: the observation record and the grounding source (HD-8)
create table public.engine_run_calls (
  call_id          uuid primary key default extensions.gen_random_uuid(),
  office_id        uuid not null,
  run_id           uuid not null,
  at               timestamptz not null default app.now_utc(),
  tool             text not null check (tool ~ '^[a-z][a-z0-9_]{1,39}$'),   -- the MCP tool name, e.g. search_documents
  verdict          text not null check (verdict in ('served','refused','failed')),
  because          text check (because is null or length(because) <= 200),
  args_sha256      text not null check (args_sha256 ~ '^[0-9a-f]{64}$'),
  domain           text check (domain is null or domain in ('documents','projects','tasks','mail','calendar','contacts')),
  complete         boolean not null default false,   -- the read returned a whole list (a census), not a search
  result_chars     integer not null default 0,
  result_excerpt   text check (result_excerpt is null or length(result_excerpt) <= 4000),  -- redacted (app.activity_redact twin or src/text/secrets.ts)
  foreign key (run_id) references public.engine_runs (run_id)   -- plus (run_id, office_id) composite per the office rules
);
-- Append-only: update and delete refused by the trigger public.events already uses.

-- 2.5 The engine MCP client kind (HD-5): widen mcp_clients_kind_known (0920) to include 'engine'.
--     Read the live constraint first (pg_get_constraintdef) and add the one value; do not retype the list from memory.

-- 2.6 inference_usage needs a providers row for its foreign key (HD-8). Disabled, so the office router can never pick it.
insert into public.providers (provider, …, enabled, disabled_reason)
values ('hermes', …, false, 'An outside engine, recorded for provenance; never a router candidate.')
on conflict (provider) do nothing;
--     Read public.providers' NOT NULL columns first; base_url must satisfy providers_https_only (use the OpenRouter base URL Hermes calls).
--     VERIFY the router filters enabled = true (src/providers/router.ts) and add a unit test that it never selects 'hermes'.

-- 2.7 Settings, in system_config, in the pattern app.answer_envelope_on already uses (0887). Absent or malformed = off.
--   engine.hermes.offices        jsonb array of office ids where Hermes may be chosen       (default: absent = nowhere)
--   engine.hermes.daily_runs     jsonb integer, runs per office per UTC day                  (default 20)
--   engine.hermes.deadline_s     jsonb integer, seconds from open to expiry                  (default 900, bounds 120..1800)
```

Retention: rows are kept (the repository deletes nothing by job); `result_excerpt` is bounded and redacted; `pg_column_size` checks cap
growth. At 20 runs a day with ~10 calls each the tables grow by well under 5 MB a month.

---

## 3. SQL functions

All `security definer`, `set search_path to ''`, `revoke all … from public, anon, authenticated, service_role` on the `app.` function. The
edge functions reach them through `public.` wrappers granted to `service_role` only; the wrapper's first argument is the office, filled by the
edge function from the verified credential, never from a request body. Every function calls `app.require_office(p_office)` first and
checks every id it is given against that office (the pattern of `app.authorize_effect` **[REPO migrations/0782…:299-307]**). Use **named
arguments** at every call site (this repository's three-argument trap).

| Function | Returns | Contract |
|---|---|---|
| `app.engine_enabled(p_office uuid, p_engine text)` | `boolean` | True only when `system_config['engine.hermes.offices']` is a JSON array containing the office id. Anything else is false. |
| `app.engine_available(p_office uuid, p_engine text)` | `jsonb {available, because}` | `available` iff enabled AND an enabled bridge for the office has `last_seen_at` within 120 s AND today's runs < `daily_runs`. `because` is one plain sentence naming the first failed condition ("Hermes isn't switched on for this office", "Hermes's host hasn't checked in for 7 minutes", "Hermes has used today's 20 runs"). |
| `app.engine_run_open(p_office uuid, p_job uuid, p_engine text, p_request jsonb)` | `jsonb {run_id, state, opened}` | Idempotent on the job: returns the existing run with `opened=false` if one exists. Otherwise requires `engine_available`; refuses with `{error, because}` if not. Also refuses unless the job came through a person's own door, asked with the same predicate `app.may_act_outside` uses (`app.job_origin`; read its live definition, do not restate it), because only a person can choose an engine. Copies `project_id` from the job. `deadline_at = now + deadline_s`. Validates `p_request` against §7 `HermesRunRequest` (keys, types, sizes) and refuses on any extra key. |
| `app.engine_run_for_job(p_office uuid, p_job uuid)` | `jsonb` or `null` | The run row (without `request`) for the handler's resume path. Also performs expiry: a non-terminal run past `deadline_at` becomes `expired` here. |
| `app.engine_bridge_for(p_token_sha256 text)` | `jsonb {bridge_id, office_id, engine, mcp_client_id}` or `null` | Authentication for the engine gateway. Null for unknown or disabled. Updates `last_seen_at` (at most once per 10 s). Not office-first because the office is what it establishes. |
| `app.engine_run_claim(p_office uuid, p_bridge uuid)` | `jsonb {run}` or `{run: null}` | 1) If this bridge already holds a `running` run, return it (a restarted bridge resumes, does not orphan). 2) Lapsed leases in this office: `running` with `lease_until < now` → `open` if `claim_gen < 3` else `failed('bridge_lost')`. 3) Expiry as above. 4) Take the oldest `open` run of this office whose job is `paused` and not stop-requested, `for update skip locked`; set `running`, `bridge_id`, `claim_gen = claim_gen + 1`, `lease_until = now + 90 s`, `started_at = coalesce(started_at, now)`. Returns §7 `ClaimedRun`. |
| `app.engine_run_heartbeat(p_office uuid, p_bridge uuid, p_run uuid, p_claim_gen int, p_hermes_run_id text default null)` | `jsonb {stop, because, lease_until}` | Fenced: the run must be `running`, held by this bridge, with this `claim_gen`; otherwise `{stop: true, because: 'not yours'}`. Sets `hermes_run_id` once (refuses a different value later). Extends `lease_until = now + 90 s`. `stop = true` when: the job is `cancelled`/`failed`/`complete`; `app.stop_requested(job)` is true **[REPO src/jobs/checkpoint.ts:371-375]**; `deadline_at` passed; the engine was switched off for the office. |
| `app.engine_run_finish(p_office uuid, p_bridge uuid, p_run uuid, p_claim_gen int, p_outcome text, p_result jsonb)` | `jsonb {ok, resumed}` | Fenced as heartbeat. `p_outcome in ('completed','failed','cancelled')`. Validates `p_result` against §7 `EngineRunResult` (answer ≤ 16,000 chars; `failure` redacted and cut to 300). Writes the terminal state and `finished_at`. Writes ONE `inference_usage` row: provider `hermes`, `model_id` = served model or `hermes-agent`, `correlation_id` and `job_id` of the job, outcome mapped onto the table's existing vocabulary (read `inference_usage_outcome_known`), tokens from `usage`, `cost_usd 0`, `provider_reported_cost null`. If the job is `paused` with reason `dependency_wait`, calls `app.resume_job` so the handler runs now. Idempotent: a second finish with the same claim returns `{ok: true, resumed: false}` and changes nothing. |
| `app.engine_tool_gate(p_office uuid, p_mcp_client text, p_tool text)` | `jsonb {allow, run_id, project_id, job_id, because}` | Called by the MCP edge before EVERY `tools/call` from an `engine` client. `allow` iff the client belongs to an enabled bridge of this office, that bridge has exactly one `running` run, the run's lease is live, and `p_tool` is in the v1 allowlist (§9). Returns the run's project and job so the edge binds the call to them. |
| `app.engine_record_call(p_office uuid, p_run uuid, p_tool text, p_verdict text, p_args_sha256 text, p_domain text, p_complete boolean, p_result_chars int, p_result_excerpt text, p_because text)` | `void` | Append one `engine_run_calls` row; redacts `p_result_excerpt` again in SQL (do not rely on the caller). Refuses when the run is terminal. |
| `app.engine_run_grounding(p_office uuid, p_run uuid)` | `jsonb {excerpts: text[], domains: text[], complete_domains: text[], tools: text[]}` | Served calls only, oldest first, excerpts capped at 24,000 characters in total (oldest dropped first, and the count dropped is returned as `dropped`). |
| `app.engine_propose_skill(p_office uuid, p_run uuid, p_offer jsonb)` (M8, migration 1071) | `jsonb {suggestion_id}` or `{refused}` | Writes one `public.suggestions` row: `kind 'engine.skill'`, `subject_ref` = sha256 of the normalised procedure (so a dismissed proposal is not raised again), `body` = one-sentence summary (10–400 chars), `offer_kind 'teach_skill'`, `offer_args` = `TeachSkillOffer` + `dropped`. Refuses when the run is not `completed`, not this office's, already proposed, or the office has 3 proposals today. Never writes `public.skills` itself. |
| `app.engine_mint_bridge(p_office uuid, p_engine text, p_display text, p_bridge_token_sha256 text, p_mcp_token_sha256 text)` | `jsonb {bridge_id, mcp_client_id}` | Operator only: NO public wrapper. Creates the `mcp_clients` row (`kind 'engine'`, `scopes {read}`, display `Hermes · <display>`) and the bridge. The tokens are generated by the operator script, shown once, never stored in clear. |
| `app.engine_retire_bridge(p_office uuid, p_bridge uuid, p_reason text)` | `jsonb` | Disables the bridge and its MCP client in one statement; a running run becomes `failed('bridge retired')`. Offered on the Settings page (M6) and as an operator command. |

Activity-ledger hook (HD-11): inside `engine_run_open`, `engine_run_claim` (first claim), `engine_run_finish`, and the proposal writer, call
`app.record_external_activity(p_office, 'hermes', <type>, 'run:<run_id>:<event>', <summary>, …, p_job_id, p_project_id, p_evidence_ref)`
only when `to_regprocedure('app.record_external_activity(uuid,text,text,text,text,text,text,uuid,uuid,uuid,jsonb,jsonb)') is not null`.
The idempotency key makes a repeated finish one event.

---

## 4. Engine gateway (new edge function `supabase/functions/engine`)

Deno, `verify_jwt = false` (a bridge has no Supabase JWT, the same reason as `mcp`), bearer token = bridge token. Deployed by a new
`npm run deploy:engine` modelled on `deploy:mcp` (with its probe, provenance and production-write gate). Every response
`cache-control: no-store`; no CORS (no browser calls it). Request bodies over 64 KB are refused (413). Unknown path 404. Every handler:
`sha256(token)` → `engine_bridge_for` → 401 `{error:'unauthorized'}` if null.

| Method · path | Request body | Response 200 | Notes |
|---|---|---|---|
| `GET /engine/health` | — | `{ok: true}` | Liveness, no auth, names nothing. |
| `POST /engine/claim` | `{bridge_version: string, hermes_ok: boolean, toolsets_ok: boolean}` | `{run: ClaimedRun \| null, poll_after_s: number}` | The bridge reports its own preflight (§5.1); if either is false the gateway records the bridge as unhealthy (no claim) and returns `{run: null, refused: '...'}`. `poll_after_s`: 15 when idle (the bridge backs off to 60 after 10 idle minutes), 0 right after a finish. |
| `POST /engine/heartbeat` | `{run_id, claim_gen, hermes_run_id?: string, progress: {events: number, tools: number, last_event: string}}` | `{stop: boolean, because: string \| null, lease_until: string}` | Every 5 s while a run is live. `progress` is logged in the response metrics only, never stored as content. |
| `POST /engine/finish` | `{run_id, claim_gen, outcome: 'completed'\|'failed'\|'cancelled', result: EngineRunResult}` | `{ok: true, resumed: boolean}` | Idempotent. |
| `POST /engine/proposal` (M8) | `{run_id, claim_gen, skill: HermesSkillDraft}` | `{ok, suggestion_id?, refused?}` | See `LEARNING-AND-SKILL-TRANSFER.md` §4–5. |
| `GET /engine/skills` (M8) | — | `{skills: {slug, name, when_to_use, procedure}[], generated_at}` | The office's live skills that are global or `source = hermes`, for the read-only export (`LEARNING-AND-SKILL-TRANSFER.md` §6). At most 200, procedures as stored. |

Errors: 400 `{error:'bad_request', field}` for shape errors; 401 unknown credential; 403 `{error:'disabled', because}` for a retired
bridge or an office where Hermes is off; 409 `{error:'not_yours'}` for a fenced call that lost its claim; 429 when a bridge claims more than
once per 5 s; 503 when the database is unavailable (the bridge backs off, never retries in a tight loop).

---

## 5. Bridge ↔ Hermes (exactly these calls, nothing else)

Base `http://127.0.0.1:8642`, header `Authorization: Bearer ${API_SERVER_KEY}`.

### 5.1 Preflight (at start and every 10 minutes; a failure stops claiming)

1. `GET /health` → 200.
2. `GET /v1/capabilities` → `features.run_events_sse`, `run_stop`, `approval_events` are `true` **[SRC api_server.py:66-77]**.
3. `GET /v1/toolsets` → every enabled toolset is the office MCP server; any other enabled toolset (terminal, file, web, browser, memory,
   skills, code_execution, delegation, cronjob, messaging, tts, image_gen, vision, session_search, connections, kanban, …) fails the
   preflight **[SRC api_server.py:2953-2963 builds this list]** **[ASSUMPTION V1: exact response shape]**.

### 5.2 Running one claimed run

```
POST /v1/runs
  Idempotency-Key: engine-run-<run_id>-<attempt>    (PER ATTEMPT. M0 D-2: after a Hermes restart the same key replays the dead
                                                     `interrupted` run, so a re-claim after a crash uses the next attempt number;
                                                     a re-attach to a LIVE Hermes run goes by hermes_run_id, not by re-POST)
  Content-Type: application/json
  body: the claimed run's `request` serialised with sorted keys, PLUS {"session_id": "<run_id>"}   (byte-identical on every claim)
→ 202 {run_id: "run_<32 hex>", status: "started"|…}          [ASSUMPTION V2: exact accepted-response keys]
  409 invalid/conflicting idempotency → report failed('idempotency_conflict')

POST /engine/heartbeat with hermes_run_id               (immediately, so a Stop can reach this run)

GET /v1/runs/<hermes_run_id>/events    (SSE; reconnect with Last-Event-ID on a dropped stream, at most 5 reconnects)
  tool.started     {tool, preview}          → count; if `tool` is not an office MCP tool → POST stop, finish failed('containment: <tool>')
  tool.completed   {tool, duration, error}  → count
  approval.request {…}                      → POST /v1/runs/<id>/approval {"choice":"deny","all":true}; continue; note in result.notes
  message.delta    {delta}                  → ignored (the office delivers the finished answer, not a stream; HD-8)
  run.completed    {output, usage, …}       → finish completed
  run.failed       {error, turn_exit_reason}→ finish failed
  run.cancelled / run.interrupted           → finish cancelled (if the office asked) else failed('interrupted')

Every 5 s:  POST /engine/heartbeat → if stop: POST /v1/runs/<id>/stop, keep reading events until terminal (max 30 s), then finish cancelled.
Deadline:   the bridge's own wall clock = deadline_at + 30 s → stop, finish failed('deadline').
No progress: M0 D-3: Hermes retries a provider 500 indefinitely (run stays `running`), so the bridge also stops a run with no
            event for `no_progress_s` (default 90) and finishes failed('no_progress'). A provider 429 fails the run by itself
            ("HTTP 429: Rate limit exceeded: free-models-per-min") and maps to the plain sentence below.
If the SSE stream cannot be re-established: GET /v1/runs/<id> for the terminal status and output.
```

The event names, fields and terminal semantics are **[SRC api_server_runs.py:91-99, 176-200, 857-986]**. The tool name Hermes reports for
an MCP tool is **observed in M0 (V12): `mcp__office__<tool>`** (so `BridgeConfig.officeToolPrefix = 'mcp__office__'`); the bridge's
containment check matches the office tool names from §9 against the reported name with that prefix and fails closed on anything else.
Also observed in M0: `approval.request` carries `command, pattern_key(s), description, allow_permanent, allow_session, request_id,
choices`; the approval POST body is `{choice, request_id?}` (an unknown choice is 400, nothing pending 409); a second concurrent run is
refused 429 "Too many concurrent runs (max 1)"; the host config must set `tools.tool_search.enabled: "off"` (quoted: bare `off` is a
YAML boolean) or the MCP tools are hidden behind a bridge tool; in multiplex mode every profile reads its own `.env` (D-6).

---

## 6. Hermes host configuration (`docs/hermes/host/config.yaml`, committed as a template in M5)

```yaml
model:
  provider: openrouter
  default: "<a :free slug chosen in M0, ≥64K context, tool calling>"   # V5
auxiliary:
  free_only: true                       # [SRC agent/auxiliary_client.py:6, 2274-2281]
background_review:
  enabled: false                        # no post-turn self-improvement fork (M8 revisits)
memory:
  memory_enabled: false
  user_profile_enabled: false
skills:
  creation_nudge_interval: 0
gateway:
  api_server:
    max_concurrent_runs: 1              # HD-6   [SRC api_server.py:1360-1362]
platform_toolsets:
  api_server: [office]                  # the MCP server name below is the ONLY toolset   [SRC hermes_cli/tools_config.py:573-640]
agent:
  disabled_toolsets: [terminal, file, web, search, browser, vision, image_gen, skills, skills_hub, todo, tts, cronjob,
                      memory, session_search, code_execution, delegation, clarify, messaging, connections, kanban,
                      project, context_engine, computer_use]   # runs last, overrides everything; V1 confirms the effective set
mcp_servers:
  office:
    url: "https://<project-ref>.supabase.co/functions/v1/mcp"
    headers:
      Authorization: "Bearer ${OFFICE_ENGINE_MCP_TOKEN}"    # ${VAR} interpolation   [SRC tools/mcp_tool_config.py:1-3]
    trust: full                                             # HD-5: the office enforces policy server side
    connect_timeout: 20
    tools:
      include: [list_projects, search_documents, read_document, search_project, list_tasks, list_staff,
                recent_work, check_job, inspect_activity, list_events]
```

`.env` on the host (never committed; `docs/hermes/host/.env.example` lists names only): `API_SERVER_ENABLED=true`, `API_SERVER_KEY`
(≥32 random bytes), `API_SERVER_HOST=127.0.0.1`, `OPENROUTER_API_KEY` (the Hermes-only zero-credit key, HD-12),
`OFFICE_ENGINE_MCP_TOKEN`, and for the bridge `ENGINE_BRIDGE_TOKEN`, `ENGINE_GATEWAY_URL`. `HERMES_YOLO_MODE` must be unset
(the bridge preflight refuses to claim if it is set in the bridge's environment, a proxy for the host's).

---

## 7. TypeScript types (`src/engines/hermes/types.ts`, imported by the handler AND the bridge; pure, no Deno or Node APIs)

```ts
export type EngineName = 'team' | 'hermes'
export type EngineRunState = 'open' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired'

/** What the office sends Hermes, verbatim. Stored on engine_runs.request and serialised with sorted keys. */
export interface HermesRunRequest {
  /** The person's message, resolved (transcribed, dictation-cleaned, paired). The same text the team would have read. */
  readonly input: string
  /** The office brief (§8.2). Becomes Hermes's ephemeral system prompt. ≤ 12,000 characters. */
  readonly instructions: string
  /** The thread before this turn, oldest first. User turns are the person's words; assistant turns are the office's answers. ≤ 20 turns, ≤ 24,000 characters. */
  readonly conversation_history: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[]
  /** Pinned per run from engine.hermes model setting at open time; omitted = Hermes's configured default. */
  readonly model?: string
}

export interface ClaimedRun {
  readonly run_id: string
  readonly claim_gen: number
  readonly job_id: string
  readonly deadline_at: string            // ISO instant
  readonly request: HermesRunRequest
  /** Set when a previous claim already started Hermes; the bridge attaches instead of starting. */
  readonly hermes_run_id: string | null
  /**
   * Which Hermes profile runs it (M8b). Decided by the office at open time from `engine.hermes.learning_offices`, stored on the run
   * (`engine_runs.profile text not null default 'default' check (profile in ('default','hermes-learn'))`, added in migration 1071),
   * never chosen by the bridge. 'default' posts to /v1/runs; 'hermes-learn' to /p/hermes-learn/v1/runs.
   */
  readonly profile: 'default' | 'hermes-learn'
}

export interface EngineRunResult {
  readonly hermes_run_id: string | null
  /** Hermes's final_response. Required when outcome = completed; ≤ 16,000 characters. */
  readonly answer?: string
  /** The served model, from the terminal event's runtime fields, when reported. */
  readonly model?: string
  readonly usage?: { readonly input_tokens: number; readonly output_tokens: number }
  readonly turn_exit_reason?: string
  /** One redacted line. Required when outcome = failed. */
  readonly failure?: string
  /** Counts, never content. */
  readonly tools_started: number
  readonly approvals_denied: number
  readonly notes?: readonly string[]     // ≤ 5 short machine notes, e.g. 'approval.request denied'
}

/** One SSE event from /v1/runs/{id}/events, narrowed to what the bridge reads. [SRC api_server_runs.py:176-178] */
export type HermesRunEvent =
  | { readonly event: 'tool.started'; readonly run_id: string; readonly tool: string; readonly preview: string }
  | { readonly event: 'tool.completed'; readonly run_id: string; readonly tool: string; readonly duration: number; readonly error: boolean }
  | { readonly event: 'approval.request'; readonly run_id: string; readonly [k: string]: unknown }
  | { readonly event: 'message.delta'; readonly run_id: string; readonly delta: string }
  | { readonly event: 'run.completed'; readonly run_id: string; readonly output: string; readonly usage?: Record<string, number>; readonly completed: true }
  | { readonly event: 'run.failed'; readonly run_id: string; readonly error?: string; readonly turn_exit_reason?: string; readonly partial?: boolean }
  | { readonly event: 'run.cancelled' | 'run.interrupted'; readonly run_id: string; readonly turn_exit_reason?: string }
  | { readonly event: string; readonly run_id: string }      // anything else: counted, ignored

/** Handler-side view of a run (engine_run_for_job). */
export interface EngineRunRow {
  readonly run_id: string
  readonly state: EngineRunState
  readonly engine: 'hermes'
  readonly deadline_at: string
  readonly result: EngineRunResult | null
  readonly failure: string | null
}

/** Bridge configuration, from the host environment. */
export interface BridgeConfig {
  readonly gatewayUrl: string        // ENGINE_GATEWAY_URL, https only
  readonly bridgeToken: string       // ENGINE_BRIDGE_TOKEN
  readonly hermesUrl: string         // default http://127.0.0.1:8642, must be loopback
  readonly hermesKey: string         // API_SERVER_KEY
  readonly officeToolPrefix: string  // the prefix observed in M0 (V12)
}
```

Skill draft (M8): `HermesSkillDraft` is in `LEARNING-AND-SKILL-TRANSFER.md` §4.

---

## 8. The handler seam (`src/handlers/instruction.ts` → `src/engines/hermes/turn.ts`)

### 8.1 Two calls into the engine module, nothing else in `instruction.ts` changes behaviour

```ts
// (a) FIRST statement after reading `payload`, before transcription (instruction.ts ~2433):
const engineRun = await engineRunFor(deps.db, job)            // app.engine_run_for_job
if (engineRun !== null) return resumeHermesTurn(hermesDeps(deps), job, engineRun)

// (b) After `instruction` is resolved (cleanDictation + pairWithNearby, instruction.ts ~2465), before the turn/routing work:
if ((await engineOf(deps.db, payload)) === 'hermes')          // inbound_commands.engine via payload.command_id
  return openHermesTurn(hermesDeps(deps), job, { instruction, heardText, payload })
```

`engineOf` returns `'team'` for any job without a `command_id`, any error, or any value but `'hermes'` (fails toward today's behaviour,
which is the safe direction because the team path is the certified one). Duties, children and hand-offs never have `engine = 'hermes'`.

### 8.2 `openHermesTurn` (first pass)

```ts
export async function openHermesTurn(deps: HermesTurnDeps, job: Job, said: OpenInput): Promise<HandlerOutput>
```
1. `app.engine_available(office, 'hermes')`. If unavailable → return a **deterministic** output, `announce` as the job's flag, body:
   *"I haven't sent this to Hermes: {because}. Nothing else was done with it. Send it again without Hermes selected if you'd like the
   team to take it."* (`evidence 'verified'`, `path` from `howComposed`, `confidence 'high'`). No fallback to the team (HD-1).
2. Build the brief (§8.4) and the `HermesRunRequest`.
3. `app.engine_run_open(...)`. An `{error}` is treated as step 1's unavailable answer.
4. `pauseJob(db, job.jobId, {reason: 'dependency_wait', detail: 'Hermes is working on it.', resumeWhen: 'Waiting for Hermes to finish.',
   resumable: true, until: now + 20 s, expiresAt: deadline_at + 60 s}, job)`.
5. Return `{announce: false, body: 'Hermes is working on it.', evidence: 'verified', confidence: 'high', path: await howComposed(...),
   sources: [], contradictions: null, model: null}`. Compute `path` AFTER any model-spending call (this file's object-literal ordering trap).

### 8.3 `resumeHermesTurn` (every later pass)

| `run.state` | Do |
|---|---|
| `open`, `running` | Pause again exactly as 8.2 step 4 (same `until` rule), return the same quiet output. |
| `completed` | Build the final output (8.5). |
| `failed` | Deterministic answer: *"Hermes couldn't finish this ({failure in plain words}). Nothing was changed. Ask again, or send it to the team."* |
| `cancelled` | *"Stopped. Hermes hadn't finished, so there's no answer to show."* (`announce` false when the person pressed Stop: the press is the acknowledgement.) |
| `expired` | *"Hermes took longer than {N} minutes, so I stopped waiting. Nothing was changed."* |

### 8.4 The brief (`src/engines/hermes/brief.ts`)

```ts
export function hermesBrief(input: {
  readonly officePersonName: string          // currentPerson().name
  readonly project: { readonly name: string; readonly slug: string } | null
  readonly projectSpine: string              // projectSpine(...) exported from instruction.ts:489
  readonly standingRules: readonly string[]  // guidanceFor(...).lessons filtered to learned_by = the person (his orders, as written)
  readonly provenanceNote: string            // provenanceNote() from src/agents/provenance.ts
  readonly canDo: readonly string[]          // the read tools, in words
  readonly cannotDo: readonly string[]       // v1: create or change anything, contact anyone, browse the web, run code
}): string
```
Fixed paragraphs, in order: who Hermes is answering and that it is working for the office (not as a team member, and must not claim to be
one); the project; his standing rules verbatim; what it can and cannot do, and that it must say plainly when the request needs something it
cannot do instead of pretending; the provenance note; the reply style the team uses (short paragraphs, no headings). ≤ 12,000 characters,
cut from the project spine first. A unit test pins the order and the bound; a wording lock is NOT asserted (this file's rule).

### 8.5 The final output (`src/engines/hermes/result.ts`)

```ts
export function hermesOutput(run: EngineRunRow, ctx: {
  readonly asked: string; readonly saidBefore: readonly string[]; readonly answeredBefore: readonly string[]
  readonly grounding: { excerpts: readonly string[]; domains: readonly Domain[]; complete_domains: readonly Domain[]; tools: readonly string[] }
  readonly holds: { projects: number }; readonly standingRules: readonly string[]
}): HandlerOutput
```
- `body` = `run.result.answer`, trimmed; empty → treated as `failed('empty answer')`.
- `confidence 'medium'`, `evidence 'inferred'`, `path 'inference'`, `model` = served model (or `'hermes-agent'`), `contradictions null`.
- `sources` = `hermes:<tool>` once per distinct served tool (shape `<scheme>:<ref>`, which the citation check accepts by shape).
- `grounding = established({asked, saidBefore, retrieved: grounding.excerpts, answeredBefore, consultedDomains, completeDomains})`.
- `consulted = {consulted: grounding.domains, complete: grounding.complete_domains}`; `holds` as the team path computes it.
- `standingRules` as given to the brief; `toolNames` = the office tool names (so the #246 leak check runs); `acted: 0` and
  `tasksChanged: 0` in v1 (the consequence gate then refuses any claim of having created or sent something, which is the truth).
- `announce` left undefined (the job's own flag decides, as for the team).

Inference usage is written by `engine_run_finish`, not here, so `howComposed` is already `inference` on the resume pass.

---

## 9. MCP server changes (`supabase/functions/mcp/index.ts`, `tools.ts`)

1. `mcp_client_for` already returns `kind`; when `kind = 'engine'`, before dispatching any `tools/call`, call
   `public.engine_tool_gate(office, client_id, tool)`. `allow = false` → the JSON-RPC result is a tool error with `because` and nothing is
   called; record the refusal with `engine_record_call(verdict 'refused')`.
2. When allowed, override the tool's `project` argument with the run's project slug **for tools that take one** (the model cannot point the
   call at another project); for `list_projects` and office-wide searches, keep office scope (the brief tells Hermes which project is in focus).
3. After the RPC, `engine_record_call(verdict 'served' | 'failed', args_sha256 = sha256(canonical JSON of the final args),
   domain, complete, result_chars, result_excerpt = first 4,000 characters of the result text)`. Domain map (in `tools.ts`, tested):
   `search_documents`/`read_document`/`search_project` → `documents`; `list_projects` → `projects` (complete); `list_tasks` → `tasks`
   (complete when unfiltered); `list_events` → `calendar`; others → null.
4. `tools/list` for an engine client returns only the v1 allowlist (the same constant `ENGINE_READ_TOOLS` in `tools.ts`), so Hermes is
   never told about a tool it may not call.
5. `app.mcp_write_client` refuses a client of kind `engine` (defence in depth; HD-7) until M10.
6. Compatibility with Hermes's MCP client is **[ASSUMPTION V4]**: the office server speaks protocol `2024-11-05`, JSON-RPC over POST,
   no SSE stream, no session id **[REPO supabase/functions/mcp/index.ts:11-16, 46]**; Hermes uses the `mcp` Python SDK 2.x streamable HTTP
   client **[SRC mcp_serve.py:24-28; tools/mcp_tool_transport.py:605-608]**, which may require a session header or a `GET` stream. M0
   decides; the likely fixes are answering `GET` with 405 and echoing the requested protocol version where the server's behaviour is
   compatible. Any fix is made for every client (Claude and ChatGPT use the same server) and re-verified with `verify:mcp` where it exists.

---

## 10. Team HQ and adapters

| Adapter | Change | Rule |
|---|---|---|
| Team HQ dashboard chat (`web/studio/chat.js` posting to `voice` `/turn`) | Body gains `engine: 'hermes'` when the person selected Hermes. | `supabase/functions/voice/index.ts` copies `body.engine === 'hermes' ? 'hermes' : 'team'` into the `inbound_commands` row it builds (~line 429-447). Any other value is `team`. |
| Team HQ composer UI (`web/studio/bc/shell.js` dock composer ~2752-2790, `bc/wire.js`) | A two-state control beside Send: **Team** (default) / **Hermes**. Disabled, with the reason as its label, when `engine_available` says no. The choice is remembered per project in `localStorage` as a convenience only. | Read availability from a new office section `engine_status` (hq-api, `office: true`) returning `{hermes: {enabled, available, because}}`. |
| Thread rendering (`web/studio/chat.js` ~103) | A Hermes answer is labelled "Hermes" with the office's existing provenance line; the waiting state reads "Hermes is working on it" and offers Stop. | The label comes from the job's engine run (join in the thread reader), never from text. |
| Telegram / Slack (M9) | A message beginning `/hermes ` (Telegram) or `hermes:` (Slack) sets `engine = 'hermes'` and the prefix is removed from `instruction`. | Translation only (§5). |
| hq-api | New section `engine_status`; new action `engine_retire_bridge` (`office: true`). | `check:pressable` and `tests/gateway/operator-only.test.ts` classify both. |

---

## 11. Error and cancellation matrix

| Situation | Office sees | Person is told | Run row |
|---|---|---|---|
| Hermes not enabled / no bridge seen for 120 s / daily ceiling reached | `engine_run_open` refuses | the `because` sentence; nothing else done | none |
| Bridge never claims before the deadline | resume finds `expired` | "took longer than N minutes" | `expired` |
| Bridge dies mid-run, comes back within 90 s | claim returns its own running run; it re-attaches by `hermes_run_id` | nothing extra | `running` |
| Bridge dies and does not come back | lease lapses → `open`, reclaimed (≤3) → else `failed('bridge_lost')` | "couldn't finish" | as stated |
| Hermes process restarted mid-run | `run.interrupted` on its side; **observed (V2-5): the old run reads back `interrupted` and the same key replays that dead run**, so the bridge finishes it `failed('interrupted')` or retries under the next attempt's key (§5.2) | "couldn't finish" | `failed` |
| Person presses Stop while paused | `request_stop` cancels the paused job **[REPO migrations/0741…:1092-1105]**; heartbeat sees the cancelled job → bridge stops Hermes → finish(cancelled) without resume | the Stop press is the acknowledgement | `cancelled` |
| Hermes asks for a dangerous-command approval | bridge denies, notes it | nothing (the answer may say it couldn't do that) | unchanged |
| Hermes reports a tool that is not an office tool | bridge stops the run: containment | "couldn't finish" | `failed('containment: <tool>')` |
| Model provider rate limit / free quota exhausted | `run.failed` with an error | "couldn't finish (the free model is over its limit for now)" | `failed` |
| The answer fails the coherence gate | the worker's existing retry with the refusal in `pinned_config` re-runs the handler, which finds `completed` and builds the SAME output | after the attempts, the existing last-word path (#211) | unchanged |

The last row is a known limitation of v1: a refused Hermes answer is not re-asked of Hermes (that would be a second run and the office does not
open one silently). The person is told the answer could not be used. M10 may add "ask Hermes again" as a person's press.
