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

### 3.1 M1 as built: where the migration differs from the tables and functions above

Migration `1070_an_outside_engine_answers_one_turn_and_the_office_keeps_everything_else.sql` is canonical; `scripts/isolated/engine-runs.ts`
(131 checks, 15 sabotages, in `verify:critical`) proves it. Where it differs from the text above, the migration wins and the reason is here:

| Id | Contract said | Built | Why |
|---|---|---|---|
| D-7 | `app.mcp_client_for` already returns `kind` (§9.1) | It does **not** (it returns client_id, display_name, scopes, office_id). `app.engine_tool_gate` therefore answers for EVERY client: a client that is not an engine client gets `{allow: true, is_engine: false}`, unbound and untouched. | Changing `mcp_client_for` means a drop-and-create of a function and its wrapper that Claude and ChatGPT use, plus the conversion manifests. M3 either makes one extra gate call per `tools/call` (measured then) or adds `kind` to `mcp_client_for` additively. Decided in M3 with a measurement. |
| D-8 | One stable `hermes_run_id`, set once | `hermes_run_id` is per ATTEMPT: `engine_runs.hermes_claim_gen` records which claim it belongs to; a new claim hands the bridge `previous_hermes_run_id` (to stop first) and `hermes_run_id: null` (start fresh). A restarted bridge that re-claims its own live run gets its own `hermes_run_id` to attach to. Heartbeat refuses a different id within one attempt. | M0 D-2 (a Hermes restart replays the dead run under the same key). `ClaimedRun` gained `previous_hermes_run_id`. |
| D-9 | `engine_run_finish` writes one `inference_usage` row | One row **only when the engine spent model capacity**: a completed answer, or any reported tokens. A failed or stopped run that spent nothing writes none; outcome maps onto the table's vocabulary (`ok`, `rate_limited` for a 429, else `provider_error`); provenance is `estimated`, cost 0, no provider figure. | `howComposed` counts inference rows by correlation: a plain code-composed "Hermes couldn't finish" sentence must not read as model-composed. |
| D-10 | `engine_bridges` has no health column | `healthy` and `unhealthy_reason`, set by `app.engine_bridge_report` (public wrapper for the gateway's claim preflight). An unhealthy bridge claims nothing and is "not ready" in `engine_available`. At most one ENABLED bridge per office and engine (partial unique index). | §4's claim endpoint says a failed preflight is recorded; this is where. |
| D-11 | Ledger hook at open, first claim, finish, proposal | Mirrored at first claim (`external.research_started`), finish (`external.research_completed` or `external.worker_error`), expiry, bridge loss and retirement. Not at open (the office's own act; native events cover it). A refused or failed mirror is written to `engine_runs.ledger_note`, never swallowed. | Idempotency key `run:<run_id>:<event>`. The door is called by `to_regprocedure` only when it exists; no ledger table is created. |
| D-12 | Several wrappers | Public wrappers exist only for what an edge function calls: `engine_bridge_for`, `engine_bridge_report`, `engine_run_claim`, `engine_run_heartbeat`, `engine_run_finish` (the engine gateway, M2) and `engine_tool_gate`, `engine_record_call` (the MCP function, M3). `engine_run_open`, `engine_run_for_job`, `engine_run_grounding` and `engine_available` are read by the worker through the database directly; `engine_mint_bridge` and `engine_retire_bridge` have none (operator and Settings, M2/M6). | The least reach that works. |
| D-13 | Settings | `engine.hermes.offices`, `.daily_runs` (default 20, 0..1000), `.deadline_s` (default 900, clamped 120..1800) only. The bridge's no-progress limit (90 s) is bridge configuration, not a setting. Absent or malformed is off or the default. | M0 D-3. |

`engine_run_open` requires `app.job_origin = 'trusted'` (a person's own door), which is stricter than `app.may_act_outside` (it also admits
the office's own internal work): a duty or a hand-off never chooses Hermes. `mcp_client_for`'s office binding, the same-office composite
keys, the write-once office trigger, forced row security and the ownership manifest follow the office model; `check:ownership` and
`check:office-edges` pass on the replica.

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

**M2 as built** (`supabase/functions/engine/{index,routes}.ts`, proved by `scripts/isolated/engine-gateway.ts`, 33 checks and 6 sabotages in
`verify:critical`; undeployed). Differences from the table above, each with its reason:

* **D-14. Retired and unknown are both 401.** `app.engine_bridge_for` returns null for an unknown, retired or disabled bridge, so the gateway
  cannot tell them apart; it never answers 403 `disabled` for a bridge. A 403 is only the database refusing an inactive office. "Hermes is
  off for this office" is not a 403 either: a claim returns `{run: null}` and the office's own availability sentence says why.
* **D-15. The throttle is best effort.** A stateless edge function remembers each bridge's last claim in memory per isolate (`Throttle`),
  so the 429 is a courtesy against a runaway bridge, not a guarantee; the bridge's own 15 s poll is the rate and a claim is one indexed read.
  It never refuses the first claim of an isolate.
* A claim body is exactly `{bridge_version, hermes_ok, toolsets_ok}`; any other key (an `office_id`, say) is a 400 naming it. The gateway
  calls `app.engine_bridge_report` with the preflight result before it claims (an unhealthy bridge is told so, handed nothing, and asked to
  wait 60 s), and `poll_after_s` is 15 with no run and 0 with one.
* A heartbeat or finish whose claim is lost is **409 `not_yours`** (the SQL `{stop:true, because:'not yours'}` is mapped, so the bridge cannot
  misread it as a stop instruction); a finish for a run that is not running is 409 `not_running`; an unacceptable result is 400 with the reason.
* The body ceiling is read while streaming (64 KB, 413), so an oversized request is never held in memory; `content-length` is only a shortcut.
* `/engine/proposal` and `/engine/skills` are M8 and answer 404 until then. The bridge-credential command and `deploy:engine` exist, are
  unit-tested, and have never been run against production.

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

### 5.3 M5 as built (`scripts/hermes-bridge/`, `docs/hermes/host/`)

Canonical: `scripts/hermes-bridge/{sse,hermes-client,gateway-client,config,bridge,main}.ts`. Proved by `tests/engines/bridge.test.ts` (58 checks against a fake
Hermes and a fake gateway on loopback, 7 sabotages recorded in `IMPLEMENTATION-PROGRESS.md`), `tests/engines/host-kit.test.ts`, and
`scripts/isolated/engine-bridge.ts` (21 checks with a REAL Hermes, evidence in `docs/hermes/m5-evidence/`). The Hermes shapes were OBSERVED
(`scripts/hermes-m0/m5-observe.ts`), not read from source. Differences from 5.1 and 5.2, each with its reason:

| Id | Contract said | Built | Why |
|---|---|---|---|
| D-23 | `GET /v1/toolsets` lists every enabled toolset; any but the office server fails | `{data: [{name, enabled, tools}]}`; the bridge fails the preflight if any ENABLED name is not `office`, or if the list cannot be read (`toolsets_ok: false`, not undefined). | M0 V1 left the response shape an assumption; observed here. An unreadable list fails closed. |
| D-24 | The bridge refuses a non-loopback Hermes URL and a non-https gateway URL | Also refuses: credentials, a query or a fragment in the gateway URL; any `SUPABASE_*`, `DATABASE_URL`, `POSTGRES*` in its environment; `HERMES_YOLO_MODE` when on. The one exception, loopback http for the gateway, needs `ENGINE_BRIDGE_ALLOW_INSECURE_LOOPBACK=1` and exists for the replica proofs. The error text names the variable, never a value. | "No database client, no Supabase key" is enforced, not hoped for. |
| D-25 | The bridge imports only `types.ts` and `timing.ts` | Plus `src/safety/require-production-writes.ts` in `main.ts` only, first. `tests/engines/bridge.test.ts` reads every file's imports (with a control that proves the reader can fail). `npm run hermes:bridge` is in the production-write list: on a real host the person sets `ALLOW_PRODUCTION_CHECKS=1` and `ALLOW_PRODUCTION_WRITES=1` in the service's own environment, so an authoring session without them cannot start it. | The bridge writes to the office's database through the gateway; the repository's rule is that anything that does needs the same switches a deploy needs. |
| D-26 | `approval.request` is denied with `{"choice":"deny","all":true}` | `{"choice":"deny","request_id":<id>}` | M0 observed the accepted body (`choice` and an optional `request_id`). |
| D-27 | After a stop, read events up to 30 s, then finish | The bridge's OWN decision (containment, no progress, the deadline, the office's Stop) is final: it wins over whatever Hermes then reports, and the report goes at the earlier of Hermes's terminal event and the stop wait. | A stopped run whose model then "completes" must not be reported as an answer. |
| D-28 | One heartbeat every 5 s | The first heartbeat goes out at once and carries `hermes_run_id`, so the office knows which Hermes run a restarted bridge should attach to. A heartbeat the gateway answers 409 abandons the run: Hermes is stopped and NOTHING is reported (the office already moved on). A bridge that has had no heartbeat accepted for 80 s abandons the run too, because its lease has gone. | The restart proof (R15, R16) and a lost claim. |
| D-29 | (not specified) a finish the gateway cannot take | Retried every 5 s for up to 60 s while the gateway is down (the lease outlives a short outage and a dropped report drops the answer), never retried on a 409 or 401, and a 400 is replaced by a plain `bridge_result_invalid` failure the office accepts. A result that fails `resultProblem` is replaced the same way. | Every outbound shape is validated by the same function the database mirrors. |

Observed about the real Hermes (all in the M5 evidence): a provider 429 fails the run itself (`run.failed`, `HTTP 429: Rate limit exceeded...`); a provider
500 keeps the run alive for ever, so the no-progress limit is what ends it and frees Hermes's single slot; Hermes **repairs an unknown tool name to the nearest
offered one** (a request for `create_task` ran as `list_tasks`), which is harmless while only read tools are offered and is why `engine_run_calls` records the tool
that actually ran; and the office's MCP function narrows `tools/list` for an engine client, so a Hermes configured with write tools in its `include` list still
never offers them. A restarted bridge re-attaches to the SAME live Hermes run: one model conversation, not two.

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

### 8.6 M4 as built: where the code differs from 8.1 to 8.5

Canonical: `src/engines/hermes/{turn,brief,result,drain}.ts` and the two calls in `src/handlers/instruction.ts`. Proved by
`scripts/isolated/engine-turn.ts` (29 checks on a replica, real worker, handler, gateway and MCP function; 7 sabotages run by hand and recorded
in `IMPLEMENTATION-PROGRESS.md`) and `tests/engines/{brief,result,turn,drain}.test.ts`.

| Id | Contract said | Built | Why |
|---|---|---|---|
| D-17 | `engineOf` / `engineRunFor` fail toward the team on any error (8.1) | They fail toward the team ONLY for a job with no command or a database that predates the engine (`42883`, `42703`, "does not exist"). Any other failure is RETHROWN, so the worker retries the job. | Failing toward the team on a transient read error is an automatic engine switch: a message the person sent to Hermes would be answered by the team's paid model because a query timed out. The first draft of 8.1 contradicted the rule it was written to protect. Both doors have a negative control. |
| D-18 | A code-composed sentence is `evidence 'verified'` with no source (8.2, 8.3) | It cites `job:<id>`, like every other code-composed sentence in the handler. | The output-metadata gate refuses `verified` with no source (`incoherent output metadata: sources`); the first end-to-end run refused the unavailable sentence and the job was cancelled with nothing said. Found by driving the handler, not by reading it. |
| D-19 | `announce` left undefined on the final output (8.5) | `announce: true` on the answer and on a failed, expired or empty ending; `false` for a cancelled run only when the person pressed Stop. | The waiting pass returns `announce: false`, and the worker writes that onto the job. Left undefined, the final answer inherited it: the run completed, the job completed ("nothing worth announcing") and the person received nothing. The sabotage that removes `announce: true` turns `E11` red. |
| D-20 | `resumeHermesTurn(deps, job, run)` reads the conversation again | It reads the stored request (`engine_runs.request`) for `asked`, the earlier conversation and the expiry window, and never calls the conversation reader a second time. | The request is the evidence of what Hermes was given; re-reading the conversation could differ. `conversationBefore` is passed in as a closure (`HermesTurnDeps.turnsBefore`) instead of exported, so `turn.ts` has no import from `instruction.ts` and the diff there stays at two calls and one import. |
| D-21 | The answer's staff attribution is unspecified | `recipient_agent = 'chief-of-staff'` is set (keyed by the claimed job and its office) on the first pass and on every ending, as the team path does. | Without it the output had no staff and the reply went out unattributed. Hermes wrote the words; the Chief of Staff relays them, so the person still hears only from her. The label "Hermes" is read from the engine run, never from this column. |
| D-22 | The waiting pass pauses with `until = now + 20 s` | `until = now + 60 s`, `expiresAt = deadline_at + 60 s`. | Every pass that writes a parked output row costs one row; a finished run wakes the job at once, so the look is only the safety net that settles an expired deadline or a silent bridge. About fifteen parked "working on it" rows per run at most. They are reviewed, never delivered. M6 must not render them as messages. |

Also built here, not in the contract: `src/engines/hermes/drain.ts` and `npm run engine:drain` (production-write gated, never run). It refuses and
stops nothing while Hermes is still switched on for an office that holds a live run, then stops each live run's job with the office's own stop
(`app.request_stop`, no named actor); runs themselves are left to expire or be told to stop at the next heartbeat. It is the first half of the
worker rollback (blueprint D4).

The brief carries no tool names (the reply style says so) and only standing rules the PERSON gave (`stated`): a specialist's inferred belief is not
an order. The project census (`holds.projects`) is declared only when the run was actually served the project list.

**Not covered by M4, so do not claim it:** the answer has passed the unit and replica gates with a scripted Hermes only; what a real Hermes answers,
and whether the coherence gates then refuse it, is M5/M7. A voice note chosen for Hermes is opened from the transcript but the "Heard:" quote is not
sent (the parked pass is silent); recorded as a limitation for M6.

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
   **As built (M3, D-16):** a tool takes a project iff its own schema declares a `project` property (`takesProject`, derived, not listed);
   for those the function SETS the run's project slug (`bindProject`) whether the model omitted, named or nulled it, and a refusal inside a
   run carries `run_id`, so it is recorded against the run. `list_events` is in the engine list only where the database serves the calendar.
   A gate that cannot answer refuses a client it cannot classify (fail closed); an ordinary client's "not an engine" answer is remembered for
   60 s, an engine client is asked on every call. Proof: `scripts/isolated/engine-mcp.ts` (real function, replica, 5 sabotages) and
   `tests/engines/mcp-engine-tools.test.ts`.
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

### 10.1 M6 as built, and where it differs from the table above

| ID | Table says | Built | Why |
|---|---|---|---|
| D-30 | hq-api action `engine_retire_bridge` | **Not added.** Minting and retiring a bridge stay operator commands (`scripts/ops/engine-bridge-credential.ts`). | A person pressing "retire" on the Hermes host from Settings is a destructive control with no caller in this milestone, and `check:pressable` would list it as an unpressed action. The operator tool is the door until a Settings pane exists (M8+). |
| D-31 | The control is "disabled, with the reason as its label, when `engine_available` says no" | The control is drawn **only** for an office that has been given Hermes (`enabled`). When it is not available the **Hermes option stays selectable**, is marked "(not available)", and the sentence from `engine_available` is shown beside it. | Disabling the option would make the page choose for the person, and a stored choice of Hermes would then fall back to the team silently. Selecting an unavailable Hermes sends nothing to the team: the office answers with the reason (HD-1, no automatic switching). |
| D-32 | The control lives in `web/studio/bc/shell.js` and `bc/wire.js` | It lives in `web/studio/engine.js` and is drawn from `app.js` in the dock composer and the Chat page composer (the two composers the thread has). | The dock composer is built in `app.js`; `bc/shell.js` only supplies the dictate button. One module, two callers. |
| D-33 | Thread label "Hermes" and "Hermes is working on it" with Stop | A message sent to Hermes carries "To Hermes"; an answer reads "<person> · answered by Hermes" and its screen-reader line says so; the waiting row reads "With Hermes. It is working on it." and uses the **existing** Stop. | The label is read from `engine_runs` in the history reader (migration 1072), never from the text. |
| D-34 | (not specified) the notes Hermes leaves while it works | The history reader hides every output of a job that has a run **written before the run finished**; a job with no run is untouched. | The handler parks the job on each look and writes one "working on it" row each time (D-22); left in, a thread shows a dozen. The sentence "I haven't sent this to Hermes" (no run opened) is the office speaking and stays. |
| D-35 | (not specified) a Hermes message that cannot be recorded | The voice door answers 503 `hermes_not_sent` in words and records nothing; it is **never** stored as a team message. | A silent team fallback is an automatic switch. |
| D-36 | (not specified) deploy order | `deploy:voice` reads the LIVE worker bundle and refuses unless it carries the two awaited engine calls (`scripts/deploy/lib/engine-order.ts`). | A worker that predates the seam would answer a Hermes-chosen message as the team, with nothing saying so. |

### 10.2 M9 as built (Telegram `/hermes `, Slack `hermes:`)

| ID | Table says | Built | Why |
|---|---|---|---|
| D-37 | "prefixes translated in the adapters" | Each rule is a small exported function **inside its own adapter file** (`telegramEngine` in `src/channels/telegram.ts`, `slackEngine` in `src/slack/events.ts`), not a shared module. | `deploy:telegram` and `deploy:slack` upload those files flat, beside the entrypoint and nothing else of `src/`; an import of `../engines/...` would resolve in the repository and fail in the deployed function. |
| D-38 | (not specified) which messages can select | Only a **typed, non-forwarded** message that BEGINS with the prefix and has something after it. A bare `/hermes`, a prefix in the middle, the other channel's prefix, a forwarded or shared message, a voice note and a button press are the team's and are stored untouched. On Slack the leading `<@bot>` mention is addressing and is removed first. | A prefix is a power: forwarded text is somebody else's words, and a recording has no words yet. |
| D-39 | (not specified) a database that predates 1070 | A Hermes-prefixed message whose insert fails (no `engine` column) takes the doors' existing failure path (Telegram retries, Slack is told to retry); it is never stored as a team message. Ship order: migrations, then the worker, then the two doors. | Same rule as D-35: no automatic switch. |

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
