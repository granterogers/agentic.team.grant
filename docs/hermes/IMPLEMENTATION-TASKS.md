# Hermes integration: implementation tasks (ordered backlog)

Each milestone is one or more commits on `feature/hermes-agent-integration`, ends with every listed test green, and is pushed before the
next starts. **No milestone contacts production** unless its row says so, and those steps need Grant's explicit, named authorisation
(`CLAUDE.md`, "Production access is forbidden by default"). Contracts: `INTERFACE-CONTRACTS.md` (§n). Tests: `IMPLEMENTATION-BLUEPRINT.md` §8 (Tn).

Order: **M0 → M1 → M2 → M3 → M4 → M5 → M6**, then M7–M10 independently. M0 is a gate: if V4 or V5 fails and cannot be fixed, stop and report.

---

## M0 · Validation spike (no production, no office code changes)

> **STATUS: DONE 11 October 2026. PASS; V6 BLOCKED on Grant.** See `VALIDATION-RESULTS.md` (matrix, six deviations D-1..D-6) and
> `scripts/hermes-m0/` (the reproducible harness). M4 must honour D-2 and D-3, M5 D-1, M8 D-4 and D-6. M7 needs V6.

**Objective.** Observe every `[ASSUMPTION Vn]` before building on it. Output: `docs/hermes/VALIDATION-RESULTS.md` with one row per V-item
(command run, what was observed, pass/fail, and any change it forces in the contracts).

**Where.** A disposable directory OUTSIDE the repository for Hermes (`$SCRATCH/hermes-host/`), installed from a pinned commit (start with
`d4d2ab7b5d104166e7e22a02cafd12f1fe456a31`, record the one used). Treat it as untrusted code: its own directory, its own virtualenv, run
nothing of Hermes's from inside the repository. If the build sandbox cannot install it, run M0 on the Hermes host Grant chooses (G1) and
report that.

| V | Experiment | Pass |
|---|---|---|
| V1 | Start the API server with `docs/hermes/host/config.yaml` (§6) and a stub MCP server named `office`; `GET /v1/toolsets` | only the `office` tools are enabled; record the exact JSON shape for the bridge preflight |
| V2 | `POST /v1/runs` with `input`, `instructions`, `conversation_history`, `session_id`, `Idempotency-Key`; repeat with the same key and body; repeat with the same key and a different body | 202 with `run_id`; replay returns the same `run_id`; different body → conflict; record the exact accepted-response keys |
| V3 | `POST /v1/runs/{id}/stop` during a model call and during an MCP tool call | terminal `run.cancelled` within 30 s in both cases |
| V4 | Hermes's MCP client against a local copy of `supabase/functions/mcp` (run with Deno against the replica, `scripts/isolated/replica.sh`) | `initialize`, `tools/list`, `tools/call` all succeed. If not, record exactly what the client sends (session header, GET stream, protocol version) and the minimal server change; that change becomes part of M3 |
| V5 | Choose a `:free` model with ≥64K context and tool calling (query OpenRouter's model list); run 10 representative read questions through the stub | ≥ 8/10 complete; record calls per run, wall time, and daily-quota consumption |
| V6 | Create a second key on the office's OpenRouter account with credit limit 0; ask Hermes for a paid model with it | the provider refuses; nothing is billed |
| V7 | Measure resident memory of Hermes (idle and during a run) and the bridge (a 50-line Node stub) | record figures; decides whether a 1 GB VM (G1 option B) is viable |
| V8 | With `auxiliary.free_only: true` and `background_review.enabled: false`, run V5's 10 questions and read Hermes's usage records | zero non-`:free` model ids |
| V9 | Check that no `approval.request` event occurs across V5; then scripted: enable `terminal` briefly, ask for `ls`, confirm the event shape, answer `deny` | event shape recorded; deny accepted |
| V10 | (for M8b) `skills.create_dir` to an empty directory with the `skills` toolset enabled in a second profile; ask for something worth a skill | a `SKILL.md` appears only in that directory |
| V11 | (for M8b) multiplexed profiles: `/p/hermes-learn/v1/runs` reaches the second profile | toolsets differ per profile |
| V12 | The tool name Hermes reports in `tool.started` for an MCP tool | record the exact prefix (`BridgeConfig.officeToolPrefix`) |
| V13 | How to prune Hermes sessions older than N days (CLI or config) | a documented command for the runbook |

**Acceptance.** V1–V9 and V12–V13 recorded; V4 and V5 pass (or the minimal fix is specified). Contracts updated where an observation
differs. **Risk:** high (this is where the design meets reality). **Rollback:** nothing to roll back.

---

## M1 · Schema and SQL functions (replica only)

**Objective.** Migration 1070 exactly as `INTERFACE-CONTRACTS.md` §2–§3, with public wrappers and grants, proved on the replica.
**Files.** `migrations/1070_…sql`; `src/engines/hermes/types.ts`, `timing.ts`; `scripts/isolated/engine-runs.ts` (registered in
`scripts/gate/critical.ts` as ONE `p(...)` line); `docs/multi-user/ownership-manifest.json`; `docs/testing/callers-baseline.json`;
`tests/engines/types.test.ts` (shape validators); router test for T11.
**Dependencies.** M0 (V2 decides the stored request shape).
**Tests.** T1–T6, T8, T11 on the replica, each with its sabotage. `check:migrations`, `check:ownership`, `check:office-edges`,
`check:carrier-writers`, `check:anon-exposure`, `check:secrets`, `verify:critical`.
**Acceptance.** All green; every sabotage turns its proof red.
**Risk.** Medium (office-model conventions are strict). **Rollback.** Not applied to production in this milestone.
**Notes.** Read `public.providers` and `mcp_clients_kind_known` from the replica before writing; splice, do not retype. Named arguments
everywhere. No backticks inside comments inside template literals.

## M2 · Engine gateway and bridge credentials

**Objective.** `supabase/functions/engine` (§4) and the operator mint/retire command.
**Files.** `supabase/functions/engine/index.ts`, `routes.ts`; `scripts/deploy/engine.ts`; `scripts/ops/engine-bridge-credential.ts`
(first import `require-production-writes`); `package.json` scripts `deploy:engine`, `engine:bridge-credential`;
`tests/engines/gateway-routes.test.ts`.
**Contract.** §4 exactly, including 401/403/409/413/429/503 and the 64 KB cap.
**Dependencies.** M1.
**Tests.** Route validation unit tests (each error by name); a replica proof that runs the function under Deno against the replica and
drives claim → heartbeat → finish (T3, T4, T7) with a fake bridge; T22 (no token in output).
**Acceptance.** Green, plus `tests/safety` (gate imports) and `check:pressable`/`check:callers` classifications.
**Risk.** Medium. **Rollback.** Undeployed.

## M3 · MCP server: the engine client kind

**Objective.** §9 in `supabase/functions/mcp`.
**Files.** `supabase/functions/mcp/index.ts`, `tools.ts` (`ENGINE_READ_TOOLS`, domain map, `ToolMap` stub for M8); a migration only if
M0/V4 forced a protocol change (then it is code, not schema); `tests/mcp/engine-client.test.ts`.
**Dependencies.** M1, M0 (V4).
**Tests.** T8, T9, T10; and the existing MCP tests unchanged for `chatgpt`/`claude` clients (prove no regression for them).
**Acceptance.** Green; `tools/list` for an engine client equals `ENGINE_READ_TOOLS`.
**Risk.** Medium-high: this function serves Grant's ChatGPT and Claude connectors. **Rollback.** Restore the captured previous bundle.

## M4 · The handler seam

**Objective.** `INTERFACE-CONTRACTS.md` §8 end to end, on the replica, with a fake bridge and a scripted Hermes.
**Files.** `src/engines/hermes/turn.ts`, `brief.ts`, `result.ts`; `src/handlers/instruction.ts` (the two calls, export
`conversationBefore`); `scripts/isolated/engine-turn.ts` (registered); `scripts/ops/engine-drain.ts` + `engine:drain` (production-write
gated; used only for rollback); `tests/engines/{turn,brief,result}.test.ts`.
**Dependencies.** M1–M3.
**Tests.** T12–T15, T20; the end-to-end proof: command with `engine='hermes'` → job paused → fake bridge claims, serves two MCP reads
through the real `mcp` function on the replica, finishes → job resumes → output passes `metadataProblems` with grounding from
`engine_run_calls` → delivery row to a test destination. Plus: unavailable → the honest sentence and NO `routing_decisions` row (T13);
Stop while paused → cancelled (T7); expiry → the expired sentence.
**Acceptance.** Green; `verify:critical` and `gate:safe --part=static` unchanged for the team path; `npm run lint`, `typecheck`, `test`.
**Risk.** High (the busiest file in the repository). Keep the diff to the two calls and one export; everything else in the new module.
**Rollback.** Code only; see the blueprint's D4 ordering.

## M5 · The bridge and the host kit

**Objective.** `scripts/hermes-bridge/` per §5, and the host files.
**Files.** `scripts/hermes-bridge/{main,bridge,hermes-client,gateway-client,sse}.ts`; `package.json` `hermes:bridge`;
`docs/hermes/host/{config.yaml,.env.example,RUNBOOK.md}`; `tests/engines/bridge.test.ts` with a fake Hermes HTTP server and a fake gateway.
**Contract.** §5 exactly; the bridge imports only `src/engines/hermes/types.ts` and `timing.ts` from the repository; no database client,
no Supabase key; refuses a non-loopback Hermes URL and a non-https gateway URL.
**Dependencies.** M2, M0 (V1, V2, V12).
**Tests.** T16–T19; preflight refusal; SSE reconnect with Last-Event-ID; heartbeat-driven stop; deadline; 503 back-off; idle back-off
15 → 60 s; restart re-attach by `hermes_run_id`.
**Real-Hermes acceptance** (local, replica office): the blueprint §8 pass mark (≥ 8/10, zero containment events, zero non-free calls).
**Risk.** Medium. **Rollback.** Stop the process.

## M6 · Team HQ selection and status (and the adapter)

**Objective.** Blueprint §5 and contracts §10.
**Files.** `supabase/functions/voice/index.ts` (one field); `supabase/functions/hq-api/index.ts` (`engine_status`,
`engine_retire_bridge`); `web/studio/bc/shell.js`, `bc/wire.js`, `chat.js`, the stylesheet (phone overrides at the END of the file);
`tests/gateway/*` classification; `deploy:voice` preflight (the worker must contain the engine seam).
**Dependencies.** M4 deployed to the replica.
**Tests.** T21 at **UX QA Level 1B** (`docs/spec/ux-qa-v2-2026-09-15.md`): desktop and phone, keyboard, disabled-with-reason state, waiting +
Stop, Hermes label, failure sentence; `verify:wired` (the selector's data attributes are looked up), `check:templates`, `smoke`,
screenshots attached to a build step with their URLs in the report. Run as the **Sample Person**, never as Grant.
**Acceptance.** Both the FUNCTIONAL and the VISUAL COHERENCE pass; the selector matches the composer's existing controls (44px targets,
inputs ≥ 16px).
**Risk.** Medium. **Rollback.** Promote the previous Vercel deployment; restore the `voice` and `hq-api` bundles.

### Production rollout (after M6, each step separately authorised by Grant)

D1 → D6 in `IMPLEMENTATION-BLUEPRINT.md` §11. First switch-on is the **Sample office**, then Grant's. The beta rule in `CLAUDE.md` applies from
then on: real use is the source of findings, classified in his five words before anything is changed.

---

## M7 · Activity ledger events (after `feature/unified-activity-ledger` merges)

**Objective.** HD-11: the `to_regprocedure`-guarded calls in `engine_run_open`, first claim, finish and proposal; remove the entry from
`docs/testing/callers-baseline.json` that the ledger's contract names. **Tests.** Replica proof that each external event appears once per run
(idempotency), with `provenance = external`, `actor = external:hermes`, and nothing when the door is absent. **Risk.** Low.

## M8 · Reviewed skill transfer

**M8a (source B, observed technique):** `src/engines/hermes/skills.ts` (`convertSkill`, `ToolMap`), the proposal step in the daily
suggestion round, migration **1071** (`decide_suggestion` passes `p_tools`; `engine_runs.profile`), Governance card rendering, `GET
/engine/skills`, the bridge's read-only export to `skills.external_dirs`, `measure` lines. Tests: every rule in
`LEARNING-AND-SKILL-TRANSFER.md` §4 with a negative control; accept → `public.skills` + `skill_tools` rows; dismiss → suppressed; daily cap.
**M8b (source A, Hermes-authored):** the `hermes-learn` profile, `POST /engine/proposal`, harvesting and wiping (V10, V11). Only with
`engine.hermes.learning_offices`. **Risk.** Medium (untrusted text into a review surface).

## M9 · Telegram and Slack selection

`/hermes ` and `hermes:` prefixes translated in the adapters; replica proofs that the prefix sets the column and is removed from the
instruction, and that anything else leaves `team`. **Risk.** Low.

## M10 · Authorised writes through policy

`create_task`, `update_task` for the engine kind: `engine_tool_gate` → `app.authorize_effect`; `proceed` → idempotent write keyed
`engine:<run_id>:<args_sha256>`; `ask` → blocker with `on_answer` (passes `check:answerable`); `refuse` → refused. `acted`/`tasksChanged`
counted from rows. Tests: approval cannot be bypassed (level-3 CHECK), a retried call writes once, an `ask` produces exactly one question, a
declined question writes nothing. **Risk.** High; needs Grant's go-ahead as a separate decision.

## M11 · (Deferred, needs a decision) Web-capable profile

A second Hermes profile with a free web search backend, chosen by the office at open only when `authorize_effect('web.read')` says
`proceed`. Requires verifying which Hermes web backend is free and what it contacts. Not planned.
