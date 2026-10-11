# Hermes integration: architecture decisions

**11 October 2026 · branch `feature/hermes-agent-integration` · architecture phase, nothing built, deployed or connected.**

This file records each decision, the alternatives, and the evidence. The other documents in `docs/hermes/` implement these
decisions and must not contradict them; if one does, this file wins and the other is the defect.

## Evidence labels used in every `docs/hermes/` file

| Label | Means |
|---|---|
| **[SRC path:line]** | Read in the Hermes source, `NousResearch/hermes-agent` at commit `d4d2ab7b5d104166e7e22a02cafd12f1fe456a31` (10 Oct 2026, MIT, `pyproject.toml` version `0.0.0`). Read only; never executed. |
| **[DOCS path]** | Hermes's own documentation in the same checkout (`website/docs/...`). Stated by the vendor, not observed running. |
| **[REPO path:line]** | Read in this repository at `main` `3caaebf`. |
| **[LEDGER path]** | Read on `origin/feature/unified-activity-ledger` (`a0c0bfcc`), which is not merged. |
| **[ASSUMPTION Vn]** | Believed from the above, not yet observed. Each has a validation experiment `Vn` in `IMPLEMENTATION-TASKS.md` M0. |
| **[PROPOSAL]** | A design choice made here. |

The earlier assessment `docs/hermes/ASSESSMENT-2026-10-11.md` on `claude/dashboard-polish-hermes` worked from vendor web pages and
marked Hermes's programmatic interface "unknown". The source settles that (HD-2), so where the two disagree this package is the later evidence.
The assessment's boundaries (never the office key, nothing in the box talks to a person, skills only as proposals) are all kept.

---

## HD-1 · Hermes is an alternative ENGINE for one turn, not a ninth staff member and not a second office

**Decision.** A person explicitly chooses, per message, whether the team answers (today's path, the default) or Hermes answers. The
choice rides on the inbound command. The office still owns the job, the obligation, the gates, the output and the delivery; Hermes
only produces the draft answer text, using only tools the office exposes to it.

**Why.** The fixed product decisions require manual selection, an authoritative task system and authoritative approvals. Making Hermes
a staff row (assessment option A) would let Claire route to it, which is automatic delegation; making it a second office (option B)
duplicates memory and approvals. An engine behind one seam keeps one owner for every fact.

**Consequences.**
- No automatic fallback in either direction. If Hermes is unavailable the office says so and does nothing else; it does not quietly
  hand the turn to the team (fixed decision 1).
- Hermes never calls `ask_team` / `start_research` (that would be Hermes delegating to the team): those tools are not on its allowlist.
- The team never forwards work to Hermes either: nothing but the inbound command's `engine` value can open a Hermes run.

## HD-2 · Integration surface: Hermes's HTTP API server, `/v1/runs` family. Chosen over ACP, the TUI JSON-RPC gateway and a subprocess.

**Facts.**
- `gateway/platforms/api_server.py` is an aiohttp server, default `127.0.0.1:8642` **[SRC api_server.py:216-217]**, that refuses to
  start without a strong `API_SERVER_KEY` **[SRC api_server.py:4422-4475; gateway/config_env.py:304-312]** and checks it with
  `hmac.compare_digest` **[SRC api_server.py:1578]**.
- It serves `POST /v1/runs` (202 + `run_id`), `GET /v1/runs/{id}`, `GET /v1/runs/{id}/events` (SSE, replay from `Last-Event-ID`),
  `POST /v1/runs/{id}/approval`, `/steer`, `/stop` **[SRC api_server_runs.py:236-240; DOCS developer-guide/programmatic-integration.md]**.
- `POST /v1/runs` accepts `input`, `instructions` (an ephemeral system prompt), `conversation_history`, `session_id`, `model`,
  `provider` **[SRC api_server_runs.py:620-760, 421-460; api_server.py:333-355]** and a durable `Idempotency-Key` header stored in SQLite
  with a body fingerprint (same key + same body replays the same run; same key + different body is a conflict) **[SRC api_server_runs.py:638-700; api_server_run_idempotency.py]**.
- Events carry `tool.started` / `tool.completed` (tool name, duration, error flag, redacted bounded preview), `message.delta`,
  `approval.request`, and terminal `run.completed|run.failed|run.cancelled|run.interrupted` with `completed/partial/interrupted` flags
  that are never contradictory **[SRC api_server_runs.py:91-99, 176-200, 857, 885-986; DOCS programmatic-integration.md "Terminal run status"]**.
- Stop calls a hard interrupt on the agent and reaps the run's background processes **[SRC api_server_runs.py:1253-1278]**.
- Concurrency defaults to 10 runs and is configurable (`gateway.api_server.max_concurrent_runs`) **[SRC api_server.py:1360-1362]**.

**Alternatives.**

| Surface | Transport | Verdict |
|---|---|---|
| **HTTP API `/v1/runs`** | HTTP + SSE, bearer key | **Chosen.** Durable idempotency, explicit stop, explicit terminal status, tool events for observation, language-neutral, the bridge never imports Hermes code. |
| ACP (`hermes acp`) | JSON-RPC over stdio | Rejected. Designed for IDEs: needs a long-lived stdio parent, renders tool output as IDE diff blocks, and its permission bridge maps Hermes's dangerous-command approvals only **[SRC acp_adapter/permissions.py:1-20]**. No idempotency key. |
| TUI gateway JSON-RPC | stdio or WebSocket | Rejected. The richest surface (slash commands, clarify, branching) and therefore the most surface to defend; built for the Ink TUI and desktop **[DOCS programmatic-integration.md]**. |
| Subprocess / `import run_agent.AIAgent` | process | Rejected. The office worker is a Supabase Edge Function in Deno with a 150 s wall clock and 2 s CPU **[REPO docs/agent-runtime-assessment-2026-09-17.md §2; scripts/deploy/worker.ts:1-40]**: it cannot spawn Python. A subprocess on a separate host would be a bespoke protocol with no idempotency. |
| `/v1/chat/completions` or `/v1/responses` | HTTP | Rejected for the engine: synchronous, no run id to stop or replay. Kept only as a health probe option. |

## HD-3 · Topology: an outbound-only BRIDGE beside Hermes pulls work from the office. The office never calls Hermes.

```
 Office (Supabase, unchanged authority)                      Hermes host (operator's machine or a free VM)
 ─────────────────────────────────────                      ───────────────────────────────────────────────
 office.instruction job ──opens──► engine_runs row           hermes-bridge (TypeScript, Node)
   (paused: dependency_wait)        ▲      │                    │ 1 POST engine/claim        (HTTPS, outbound)
                                    │      └──── engine fn ◄────┤ 2 POST localhost:8642/v1/runs
 mcp fn ◄── Hermes MCP client ──────┼───────────────────────────┤ 3 GET  /v1/runs/{id}/events (SSE)
   (engine credential, read tools)  │                           │ 4 POST engine/heartbeat (stop?)
                                    └──── engine fn ◄───────────┤ 5 POST engine/finish
 resume → handler builds output → coherence gates → deliver     Hermes API server (127.0.0.1 only)
```

**Why.**
- The worker cannot hold a connection for minutes (150 s ceiling) and cannot reach a machine behind NAT. A puller needs no inbound
  port, no public Hermes, no tunnel, and works on a home machine or any VM.
- `docs/agent-runtime-assessment-2026-09-17.md` §4 already set the rule for outside compute: **state lives in Postgres, compute is
  ephemeral and swappable, "Stop → a column the runtime polls, not a socket", legibility is a row**. This is that architecture.
- The bridge holds the only network path into Hermes, which stays on `127.0.0.1`.

**Rejected.** The office calling a public Hermes URL (needs an inbound endpoint and exposes the API key's blast radius to the
internet); Supabase Realtime subscriptions (another moving part, no benefit at one run at a time); Hermes's own webhook platform
(designed for chat platforms, would make Hermes the adapter).

## HD-4 · The job waits as a PAUSE, never as a retry, and resumes into the same handler

**Decision.** The `office.instruction` handler, on a Hermes turn, opens one `engine_runs` row and parks the job with
`pauseJob(reason 'dependency_wait', resumable, until now+20 s, expiresAt open+15 min)` **[REPO src/jobs/checkpoint.ts:419-445]**, exactly
as the fan-in synthesis does **[REPO src/handlers/synthesise.ts:170-250]**. Each resume re-enters the handler, which finds the run row
FIRST (before transcription or routing) and either parks again, or builds the final output from the stored result. The engine
gateway's `finish` also calls `app.resume_job` so the answer does not wait for the timer.

**Why.** A paused job's output is still reviewed and the worker handles "paused by its handler" **[REPO src/jobs/worker.ts:1720-1772]**;
waiting by pause uses no attempts; no new job state, no new job kind, no change to the transition table **[REPO src/jobs/states.ts]**.
Retrying would exhaust `max_attempts` within minutes (the reason synthesis pauses).

## HD-5 · One tool surface: the office's own MCP server, with a new `engine` client kind. Hermes's built-in tools are all off.

**Facts.** The office MCP server (`supabase/functions/mcp`) authenticates a hashed per-client token bound to an office, enforces
`read`/`write` scope twice (edge and SQL), records every call, and already routes consequential tools through `app.authorize_effect`
**[REPO supabase/functions/mcp/index.ts:1-40, 404-520; docs/ux-external-assistants.md]**. Hermes's MCP client supports HTTP servers with
`url`, `headers` (with `${VAR}` interpolation), `tools.include`/`exclude`, `connect_timeout`, `trust` **[SRC tools/mcp_tool_config.py:1-3, 471;
tools/mcp_tool_transport.py:117, 605-608; tools/mcp_tool_registration.py:161-240]**. Toolsets are configured per platform
(`platform_toolsets.api_server`), MCP server names pass through as toolsets, and `agent.disabled_toolsets` runs last and overrides everything
**[SRC hermes_cli/tools_config.py:573-640]**. The API server's default toolset is the full core set including terminal, files, web, browser,
memory, skills, code execution and delegation **[SRC toolsets.py:198-202]**, so the default is NOT acceptable.

**Decision.**
- Hermes config: `platform_toolsets: { api_server: [office] }` and `agent.disabled_toolsets` listing every built-in toolset
  (`INTERFACE-CONTRACTS.md` §6 has the exact file). `memory.memory_enabled: false`, `memory.user_profile_enabled: false`,
  `skills.creation_nudge_interval: 0`, `background_review.enabled: false` in M0–M7.
- The office MCP server is configured `trust: full` inside Hermes. Hermes's own MCP trust gate prompts only for `untrusted`
  servers **[SRC tools/mcp_tool_handlers.py:60-90]**; making it prompt would be a second approval system. The office's MCP server is where
  the policy is enforced, server side, where a model cannot reach it.
- Every built-in Hermes approval (`approval.request`) is answered `deny` by the bridge and recorded as a worker error. With
  terminal and code execution disabled none should ever arise **[ASSUMPTION V9]**.

**Rejected.** A new MCP server for Hermes (duplicate surface); giving Hermes its own web/terminal (silent external reach); the
office key or a service key in Hermes (forbidden).

## HD-6 · One run at a time per Hermes host, and the MCP credential is bound to the run the office says is running

**Decision.** `gateway.api_server.max_concurrent_runs: 1` on the Hermes host, and at most one `engine_runs` row per bridge credential in
state `running` (a partial unique index). The MCP server, on every call from an `engine` client, looks up THE running run for that
credential and binds the call to its office, project and job; with no running run, every call is refused.

**Why.** Hermes's MCP configuration is per process and the token in its header cannot change per run without reconnecting
**[SRC tools/mcp_tool_registration.py:429-431: a header change is part of the connection fingerprint]**. Binding by "the run this
credential is executing now" gives per-run scoping without per-run tokens, and one run at a time is what a free host can carry anyway.
A model cannot choose the project: the binding comes from the database, not from tool arguments (the MCP server already overwrites any
`p_office` a model supplies **[REPO docs/ux-external-assistants.md "What an assistant cannot do"]**).

**Cost.** Throughput is one Hermes turn at a time per host. Accepted for beta (G3 sets a daily ceiling as well).

## HD-7 · v1 is READ-ONLY. Writes come later, and only through the existing policy.

**Decision.** Milestones M0–M8 give the `engine` client read tools only: `list_projects`, `search_documents`, `read_document`,
`search_project`, `list_tasks`, `list_staff`, `recent_work`, `check_job`, `inspect_activity` (and `list_events` where offered). The
write refusal is in SQL, not only at the edge (`app.mcp_write_client` refuses an `engine` client outright). M10 adds `create_task` and
`update_task` through `app.authorize_effect`, a blocker on `ask`, and an idempotency key per (run, call).

**Why.** Every question in the brief about bypassing approvals, duplicate actions on retry and silent external contact has the
answer "it cannot, there is no write" until the write path is proved. This also matches the earlier assessment's "gather first, act later".
Fixed decision 6 ("capable of existing categories of work where technically supported and authorised") is met in stages; the stage
boundary is stated to the person, not hidden (the brief tells Hermes what it cannot do, and its answer says so).

## HD-8 · The answer Hermes writes is checked by the SAME gates as a team answer, with grounding the office observed

**Decision.** The final answer is returned as a `HandlerOutput` from `office.instruction`, so `metadataProblems` and the review run
in the worker exactly as for any answer **[REPO src/jobs/worker.ts:1300-1380]**. `grounding` is the instruction, the conversation turns
the office sent, the brief, and the bodies of every MCP result the office itself returned during the run (recorded server side in
`engine_run_calls`, never reported by Hermes). `consulted`/`complete` are derived from which read tools were called. One
`inference_usage` row is written per run under the job's correlation with provider `hermes`, so `howComposed` reports `inference`
and `enforce_deterministic_claim` stays honest **[REPO src/agents/provenance.ts:217-232; src/inference/record.ts:55-75]**.

**Why.** Hermes reports are claims; the office's own records are evidence (ledger principle 3 **[LEDGER docs/activity-ledger/EXTERNAL-AGENT-CONTRACT.md]**).
Grounding from Hermes's own transcript would let a fabricated tool result launder itself, the exact defect `provenance.ts` exists to stop.

## HD-9 · Hermes holds no authoritative memory. The office sends the conversation; Hermes's sessions are disposable.

**Decision.** Each run gets a fresh `session_id` = the engine run id, no `X-Hermes-Session-Key`, memory and user profile disabled, the
conversation the office already threads (`conversationBefore`) passed as `conversation_history`. Hermes's local SQLite still records
the transcript **[SRC hermes_state*.py]**. **M0 amendment (V13, D-4):** `hermes sessions prune` refuses while Hermes runs and skips open
API sessions even offline, so retention is an offline `hermes sessions delete <id>` in a maintenance window, never a live prune.

**Why.** Two memories is where defects breed; `public.lessons` and `public.skills` stay the only durable learning, and the only route
into them is a person's press (HD-10).

## HD-10 · Learning is a proposal a person accepts, through the existing suggestion and skill machinery

**Decision.** A skill Hermes writes (M8, isolated directory) or a technique observed in a run becomes a `public.suggestions` row with
`offer_kind = 'teach_skill'`; accepting it calls `app.decide_suggestion` → `app.teach_skill`, which already refuses addresses
(ADR-0017) and stores append-only, attributed procedures **[REPO migrations/0741…:389-470; migrations/0212…]**. Approved skills are
also exported read-only to Hermes's `skills.external_dirs`, so both engines learn the same reviewed procedure. Full detail:
`LEARNING-AND-SKILL-TRANSFER.md`.

**Rejected.** Importing `~/.hermes/skills` directly (no review), a Hermes-specific skill table (duplicate state), letting Hermes reuse
its own unreviewed skills across runs (automatic adoption, forbidden by fixed decision 2): the isolated create directory is wiped after
each harvest.

## HD-11 · Observation and audit: the office's rows are canonical; the Unified Activity Ledger is the read model when it merges

> **Status 11 October 2026:** the events are wired (1070, 1076) and proved against the ledger branch's real door (`engine-ledger`); the ledger is still unmerged. See `RELEASE-READINESS.md` section 3.

**Decision.** Canonical records are `engine_runs` (lifecycle) and `engine_run_calls` (every MCP call the office served to the run).
When `feature/unified-activity-ledger` is merged, the engine gateway (which IS the "scoped application boundary" that contract asks
for) additionally calls `app.record_external_activity` with `external.research_started`, `external.output_produced`,
`external.usage_recorded`, `external.worker_error` and `external.skill_proposed` **[LEDGER EXTERNAL-AGENT-CONTRACT.md]**. Until then the
call is skipped by a `to_regprocedure` check. No Hermes-specific event table, type or column is added to the ledger.

**Why.** The ledger's own rule: a fact lives in the table that owns it; the ledger reads it or receives a short external claim.
`engine_run_calls` is not a duplicate of anything: nothing else records which office reads an outside engine performed.

## HD-12 · Zero additional cost is enforced, not hoped for

**Decision.** Hermes uses a SEPARATE OpenRouter key whose credit limit is zero, models restricted to `:free` slugs, the auxiliary lane
`auxiliary.free_only: true` **[SRC agent/auxiliary_client.py:1-8, 2274-2281]**, and a per-office daily run ceiling in `system_config`.
The office's certified chain is PAID by budget **[REPO migrations/0396…:1-30]**; Hermes must never draw on that key or that budget.
Hosting is free only under conditions Grant must choose between (`FREE-RUNTIME-FEASIBILITY.md`, decision G1).

## HD-13 · Selection is stored on the inbound command, not in the free-text `context`, and `enqueue_inbound` is not touched

**Decision.** `inbound_commands.engine text not null default 'team' check (engine in ('team','hermes'))`. The handler reads it through
`pinned_config.command_id` **[REPO migrations/0680…:945-975 shows command_id is pinned]**. The 1,000-line `app.enqueue_inbound` is not
modified (this file's own trap list: patching a large function from memory loses behaviour). Adapters translate a person's explicit
choice into this column and decide nothing else (master spec §5).

## HD-14 · Generic names where cheap, Hermes-specific code where honest

`engine_runs.engine` and `inbound_commands.engine` are vocabularies with one non-default value. Code lives in `src/engines/hermes/`.
There is no `ExecutionEngine` interface hierarchy: one engine does not justify an abstraction, and the column means a second engine is a
value and a module, not a migration of the model.

---

## Challenge review (the brief's questions, answered)

| Question | Answer | Where enforced |
|---|---|---|
| Duplicate state? | No. Job, obligation, output, delivery, tasks, skills, lessons stay single-owner. New rows record only what nothing else holds: the outside run's lifecycle and the office-served calls. Hermes's own SQLite is disposable and never read back. | HD-9, HD-11 |
| Could Hermes bypass an approval? | v1 has no write tool and SQL refuses writes for the `engine` kind. In M10 every write goes through `app.authorize_effect`; level 3 can never resolve to `proceed` (CHECK). Hermes's own approval prompts are denied, never relayed as a second approval. | HD-5, HD-7, `SECURITY-AND-PERMISSIONS.md` |
| Overpowered credentials? | Three credentials, each hashed, office-bound and revocable: the bridge credential (engine gateway only), the engine MCP credential (read tools, bound to the running run), the Hermes-only OpenRouter key (credit limit zero). No service key, no office key, no database URL leaves Supabase. | `SECURITY-AND-PERMISSIONS.md` §2 |
| Retries cause duplicate actions? | No action exists in v1. A re-claimed run against a LIVE Hermes re-attaches by `hermes_run_id`; after a Hermes crash the key replays the dead run (M0 D-2), so the next attempt uses a per-attempt key or the run finishes `failed`. M10 keys every write by (run, call). | HD-7, `INTERFACE-CONTRACTS.md` §4 |
| Silent external contact? | Hermes's web, browser, terminal, code, messaging, cron and delegation toolsets are disabled; the only MCP server is the office's; the bridge rejects a run whose events show a non-office tool (containment stop). Model calls go to OpenRouter only. | HD-5, `SECURITY-AND-PERMISSIONS.md` §5 |
| Untrusted skills? | Proposals only; ADR-0017 refuses addresses at insert; tools by foreign key; scripts never transfer; a person's press is the only adoption path; rate-limited. | HD-10 |
| Actually free? | Software and models: yes under HD-12. Hosting: free only on the operator's own machine (verified) or an always-free cloud tier (requires an account; Grant decides, G1). | `FREE-RUNTIME-FEASIBILITY.md` |
| Assumed APIs? | Every Hermes behaviour used is cited to source; thirteen are marked `[ASSUMPTION Vn]` and M0 must observe them before M1 starts. The office MCP server speaking to Hermes's MCP client (V4) is the highest risk. | `IMPLEMENTATION-TASKS.md` M0 |
| Engine switch corrupts provenance? | The engine is fixed per command (never changed mid-turn), the run row names the engine, the output is model-generated with an `inference_usage` row naming provider `hermes`, and grounding comes from office rows. | HD-8, HD-13 |
| Coupled to Team HQ? | No. Selection is a column any adapter can set; Team HQ is one adapter (M6), Telegram another (M9). | HD-13 |
| Can the team reproduce approved Hermes techniques? | Only the procedural part, and only with tools the team holds. A skill naming a tool the agent lacks stays unavailable and takes the existing impediment route. This is stated on every proposal. | `LEARNING-AND-SKILL-TRANSFER.md` §6 |
| Accounts for the ledger branch? | Yes: no parallel ledger, the gateway is the boundary the contract asks for, events are skipped until the door exists. | HD-11 |

Items that remain open are in `ARCHITECTURE-HANDOFF.md` §5 (decisions for Grant) and `IMPLEMENTATION-TASKS.md` M0 (experiments).

## M0 amendments (11 October 2026)

M0 ran against Hermes `d4d2ab7b`; results are in `VALIDATION-RESULTS.md`. HD-1 to HD-14 stand. Six findings refine them, none reverses one:
D-1 the MCP tool prefix is `mcp__office__` (HD-5); D-2 idempotency is per attempt after a crash (HD-7); D-3 the bridge enforces a deadline and a
no-progress limit because Hermes retries a 500 for ever (HD-6); D-4 retention is an offline delete (HD-9); D-5 the free primary is
`nemotron-3-super-120b-a12b:free`, second `laguna-s-2.1:free`, and the allowlist comes from the live catalogue by price, never by the `:free` name
(HD-12); D-6 multiplex profiles read their own `.env` (HD-13). V6 (a zero-credit key) is BLOCKED on Grant and gates M7 only.
