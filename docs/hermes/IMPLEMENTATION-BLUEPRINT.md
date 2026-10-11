# Hermes integration: implementation blueprint

**Status: architecture complete, implementation not started.** Read `ARCHITECTURE-HANDOFF.md` first if you are picking this up.
Decisions are `ARCHITECTURE-DECISIONS.md` (HD-n); exact shapes are `INTERFACE-CONTRACTS.md` (§n); the ordered work is
`IMPLEMENTATION-TASKS.md` (Mn).

## 1. What is being built, in one paragraph

A person can send one message to **Hermes** instead of the team by choosing it in the composer. The office records the choice on the
inbound command, creates the job as usual, and, instead of routing to a specialist, opens an **engine run** and parks the job. A small
**bridge** running beside Hermes on a separate host pulls the run, starts it on Hermes's local `/v1/runs` API, and reports back. Hermes
can only use the office's own MCP server with read tools, bound to that run's project. When Hermes finishes, the office resumes the job,
turns the answer into an ordinary output, runs every existing gate on it, and delivers it the way it delivers everything. Nothing about
the team's path changes, and Hermes holds no memory, no credential to the database, and no way to act outside the office.

## 2. System diagram

```
                           ┌──────────────────────────── Supabase (the office: sole authority) ─────────────────────────────┐
 Grant ─ Team HQ ─► voice /turn ─► inbound_commands(engine='hermes') ─► app.enqueue_inbound ─► jobs (office.instruction)       │
         Telegram (M9) ─► telegram-webhook ─┘                                                    │                             │
                                                                                                  ▼                             │
                    worker (Edge, Deno) ── runJob ── instructionHandler                                                          │
                       │                       ├─ engineRunFor(job) ──► resumeHermesTurn (later passes)                          │
                       │                       └─ engineOf(cmd)='hermes' ──► openHermesTurn                                      │
                       │                                 ├─ app.engine_available / engine_run_open ──► engine_runs (open)        │
                       │                                 └─ pauseJob(dependency_wait)                                            │
                       │                                                                                                         │
                       │   metadataProblems (coherence gates) · review · commit · notify ◄── final HandlerOutput                 │
                       ▼                                                                                                         │
                  deliveries ─► claim_delivery ─► Telegram / Slack / Team HQ                                                     │
                                                                                                                                 │
      engine fn (new) ◄────── claim / heartbeat / finish ─────────────┐        mcp fn (existing) ◄──── tools/call ─────┐         │
        │  engine_bridges, engine_runs, inference_usage, resume_job   │          │ engine_tool_gate, engine_record_call │         │
        └─────────────────────────────────────────────────────────────┼──────────┴──────────────────────────────────────┼─────────┘
                                                                      │ HTTPS, outbound only                            │
                      ┌────────────────── Hermes host (operator machine or free VM; G1) ─────────────────┐            │
                      │  hermes-bridge (Node, TypeScript)  ──── 127.0.0.1:8642 /v1/runs ───►  Hermes API server ─────┘
                      │     no database access                                               platform_toolsets.api_server=[office]
                      │                                                                       memory/skills/web/terminal OFF
                      └──────────────────────────────────────────────────────────────────────── model: OpenRouter :free only
```

## 3. Execution lifecycle (sequence)

```
Person          Team HQ/voice     Office DB + worker                       engine fn        bridge                Hermes
  │ type, pick Hermes │                │                                         │               │                      │
  │──────────────────►│ POST /turn     │                                         │               │                      │
  │                   │ engine=hermes ►│ inbound_commands, enqueue_inbound → job  │               │                      │
  │                   │                │ worker: handler pass 1                    │               │                      │
  │                   │                │  engine_available ✓ → engine_run_open     │               │                      │
  │                   │                │  pauseJob(dependency_wait, until +20 s)   │               │                      │
  │  "Hermes is working on it" (UI state from job, not a message)                 │               │                      │
  │                   │                │                                 claim ◄──│───────────────│ (poll 15 s)          │
  │                   │                │  engine_run_claim → running, lease 90 s ─►│──── run ─────►│                      │
  │                   │                │                                           │               │ POST /v1/runs ──────►│
  │                   │                │                              heartbeat ◄──│───────────────│ (+hermes_run_id)     │
  │                   │                │◄─────────── tools/call (engine MCP credential) ─────────────────────────────────── │
  │                   │                │  engine_tool_gate → bound to run's project; served; engine_record_call            │
  │                   │                │                                           │               │◄──── SSE events ─────│
  │                   │                │                              heartbeat ◄──│ every 5 s ────│ (stop? no)           │
  │                   │                │                                           │               │◄─ run.completed ─────│
  │                   │                │                                 finish ◄──│───────────────│                      │
  │                   │                │  engine_run_finish: completed, inference_usage, resume_job│                      │
  │                   │                │ worker: handler pass 2 → resumeHermesTurn → hermesOutput   │                      │
  │                   │                │  metadataProblems + review → commit → notify → deliveries  │                      │
  │◄──────────────────│ answer, labelled "Hermes"                                  │               │                      │
```

Timings: claim latency ≤ 15 s idle (60 s after 10 idle minutes); heartbeat 5 s; lease 90 s; office-side resume backstop every 20 s;
default deadline 15 minutes. All are constants in one module (`src/engines/hermes/timing.ts`) shared by the bridge and the handler, and
the SQL bounds (`lease`, `deadline_s`) are the authority.

## 4. File map

### New

| Path | Purpose | Milestone |
|---|---|---|
| `migrations/1070_an_outside_engine_answers_one_turn_and_the_office_keeps_everything_else.sql` | §2 schema, §3 functions, public wrappers, grants | M1 |
| `src/engines/hermes/types.ts` | §7 types (shared) | M1 |
| `src/engines/hermes/timing.ts` | the timing constants | M1 |
| `src/engines/hermes/turn.ts` | `engineRunFor`, `engineOf`, `openHermesTurn`, `resumeHermesTurn` | M4 |
| `src/engines/hermes/brief.ts` | `hermesBrief` | M4 |
| `src/engines/hermes/result.ts` | `hermesOutput` | M4 |
| `supabase/functions/engine/index.ts` | engine gateway (§4) | M2 |
| `supabase/functions/engine/routes.ts` | pure request validation and routing (unit-testable, the `mcp/tools.ts` pattern) | M2 |
| `scripts/deploy/engine.ts` + `deploy:engine` | deploy with probe and gates | M2 |
| `scripts/ops/engine-bridge-credential.ts` + `engine:bridge-credential` | operator mint/retire (production-write gated) | M2 |
| `scripts/hermes-bridge/main.ts`, `bridge.ts`, `hermes-client.ts`, `gateway-client.ts`, `sse.ts` + `hermes:bridge` | the bridge | M5 |
| `docs/hermes/host/config.yaml`, `.env.example`, `RUNBOOK.md` | host setup | M5 |
| `scripts/isolated/engine-runs.ts` | replica proof of §3 (registered in `scripts/gate/critical.ts`) | M1 |
| `scripts/isolated/engine-turn.ts` | replica end-to-end with a fake bridge and a scripted Hermes | M4 |
| `tests/engines/*.test.ts` | unit tests listed in §8 | M1–M6 |
| `docs/adr/0072-hermes-is-a-manually-chosen-engine-for-one-turn.md` | the ADR | this commit |

### Changed (each change is small; nothing else in these files moves)

| Path | Change | Milestone |
|---|---|---|
| `src/handlers/instruction.ts` | two calls (`INTERFACE-CONTRACTS.md` §8.1); export `conversationBefore` (now private, ~2142) for the brief | M4 |
| `supabase/functions/mcp/index.ts`, `tools.ts` | engine-kind gate, binding, recording, `ENGINE_READ_TOOLS`, domain map (§9) | M3 |
| `supabase/functions/voice/index.ts` | copy `body.engine` into the row (§10) | M6 |
| `supabase/functions/hq-api/index.ts` | `engine_status` section, `engine_retire_bridge` action | M6 |
| `web/studio/bc/shell.js`, `bc/wire.js`, `chat.js`, CSS | the selector, label, waiting state | M6 |
| `docs/multi-user/ownership-manifest.json`, `docs/testing/callers-baseline.json` | new tables and callers | M1 |
| `scripts/gate/critical.ts` | register the replica proofs | M1, M4 |
| `src/providers/router.ts` | only if M1 finds it does not already filter `enabled` (test either way) | M1 |

### Read, not changed (the contracts depend on them; re-read before building)

`src/jobs/worker.ts` (Job, HandlerOutput, paused-by-handler branch 1720-1772, gates 1300-1380) · `src/jobs/checkpoint.ts` (pauseJob,
stopRequested) · `src/agents/provenance.ts` (Context, established, howComposed) · `src/inference/record.ts` · `src/handlers/synthesise.ts`
(the dependency_wait precedent) · `supabase/functions/mcp/index.ts` · `migrations/0741…` (decide_suggestion, request_stop) ·
`migrations/0212…` (skills) · `docs/ux-external-assistants.md` · `docs/agent-runtime-assessment-2026-09-17.md`.

## 5. Manual selection workflow (what the person sees)

1. Settings › Connections (M6) shows **Hermes**: off / on for this office, the host's last check-in, today's runs of the ceiling, and
   *Disconnect* (retire bridge). Switching it on is the operator's act in v1 (`system_config`), shown read-only to others.
2. In a project chat the composer has **Team · Hermes**. Team is selected by default on every new project. When Hermes is unavailable the
   Hermes option is disabled and says why ("Hermes's host hasn't checked in for 7 minutes").
3. Sending with Hermes selected shows the message, then "Hermes is working on it" with **Stop**.
4. The answer appears labelled **Hermes**, with the same provenance line as any answer. If Hermes could not finish, the thread says so in
   one plain sentence and nothing else happens: no team answer appears unless the person sends again with Team selected.
5. Telegram (M9): `/hermes what changed on the venue budget?`.

## 6. Scoped tool access

- **Hermes built-ins:** none. Enforced in Hermes config (§6) and checked by the bridge preflight against `/v1/toolsets` before every claim
  session, and by the containment check on every `tool.started` event (§5.2). Two layers, one in each process.
- **Office tools:** the v1 read allowlist (§9), served by the existing MCP function, each call gated by `app.engine_tool_gate` (SQL),
  bound to the running run's project and job, and recorded. `tools/list` shows only the allowlist.
- **Writes:** refused in SQL for the `engine` kind until M10.
- **Delegation:** `ask_team`, `start_research`, `generate_artifact`, `notebook_*` are not on the list (no automatic delegation, HD-1).

## 7. Task, output, approval and observation integration

| Concern | Integration | Why it holds |
|---|---|---|
| Task system authoritative | Hermes reads tasks via `list_tasks`; v1 cannot change them; M10 writes through `mcp_task_add`/`mcp_task_update` with policy | one writer, attributed `added_by = mcp:<client>` |
| Output | the final answer is a `HandlerOutput` of the `office.instruction` job | the §10 commit gate, review and delivery are unchanged |
| Approvals authoritative | no write in v1; M10: `app.authorize_effect`, blocker on `ask`, level 3 never `proceed` | no Hermes-side approval is ever relayed as consent |
| Provenance | `inference_usage(provider='hermes')`; grounding from `engine_run_calls`; the run row names the engine | §8.5, HD-8 |
| Observation | `engine_runs` + `engine_run_calls` (canonical); ledger events when merged | HD-11 |
| Stop | existing Stop on the job; heartbeat carries it to Hermes | §11 |

## 8. Tests and negative controls

Every check below must be shown able to FAIL (sabotage, confirm red, restore, confirm green) before it is trusted, per this repository's
rule; the sabotage for each is named. "Replica" means `scripts/isolated/*` on a fresh clone (no production).

| # | Check | Positive control | Negative control / sabotage |
|---|---|---|---|
| T1 | `engine_run_open` is idempotent per job | second open returns `opened=false`, one row | drop the unique index → two rows → red |
| T2 | Open refuses when Hermes is off, no bridge seen, or ceiling reached | each condition alone refuses with its own `because` | remove one condition from `engine_available` → its case goes green wrongly → red |
| T3 | Claim takes only paused, not-stop-requested jobs of the claimer's office | claim returns the run | a run of office B is never returned to office A's bridge (sabotage: drop the office filter) |
| T4 | Fencing: heartbeat/finish with a stale `claim_gen` or another bridge are refused | correct claim succeeds | sabotage the fence → the stale finish lands → red |
| T5 | Lease lapse → reopen ≤ 3 → `failed('bridge_lost')` | four lapses observed | change 3 to 4 → red |
| T6 | Finish writes exactly one `inference_usage` row (provider `hermes`) and resumes the job | `howComposed` = `inference` on resume | remove the insert → the gate's deterministic-claim check catches the output → red |
| T7 | Stop on the paused job → heartbeat `stop=true` | stop reaches the bridge | heartbeat ignoring job state → red |
| T8 | `engine_tool_gate`: allowlist, running-run binding, office | read tool allowed during a run | write tool, tool with no running run, client of another office: each refused with its own reason |
| T9 | MCP edge overrides `project` with the run's project | a call naming another project reads the run's project | remove the override → red |
| T10 | `mcp_write_client` refuses `engine` kind | — | remove the refusal → a write succeeds → red |
| T11 | `router.ts` never selects provider `hermes` | normal selection unchanged | enable the row in the fixture → the test must still pass because the router filters, or fail if it does not |
| T12 | Handler: `engineOf` defaults to team on every non-`'hermes'` value | `'hermes'` opens a run | `'Hermes'`, `null`, missing command → team path |
| T13 | Handler: no fallback | unavailable → the honest sentence, no routing decision written, no team job | sabotage: call the team path after unavailable → `routing_decisions` row appears → red |
| T14 | Final output passes gates with grounding from `engine_run_calls` | an answer citing a figure that the served `read_document` returned passes | the same figure with the call row deleted is refused by `fabricatedWhen`/`assertsRecordsUnseen` (proves grounding is the office's, not Hermes's) |
| T15 | Consequence gate: a Hermes answer saying "I've added a task" is refused | — | `acted: 0` removed → red |
| T16 | Bridge containment: a non-office `tool.started` stops the run | office tool continues | scripted Hermes emits `terminal` → stop + `failed('containment: terminal')` |
| T17 | Bridge denies `approval.request` | denial posted, run continues | scripted approval with `choice` other than deny → red |
| T18 | Bridge preflight refuses to claim with a non-office toolset enabled | clean toolsets → claims | scripted `/v1/toolsets` with `web` → no claim |
| T19 | Idempotent re-claim: same body bytes, same Idempotency-Key | scripted Hermes sees identical key + body | mutate key order → fingerprint differs → red |
| T20 | Team path unchanged | `verify:critical`, `verify:routing-heldout` unchanged | — |
| T21 | UI: selector, disabled reason, label, Stop | Level 1B UX QA (desktop + phone, keyboard) | selector with Hermes off renders enabled → red |
| T22 | Credentials: no token in any log, response or row | `check:secrets`; grep of proof output | sabotage: echo the bridge token in an error → the proof's own grep fails |

Real-Hermes acceptance (M5, local, no production): the bridge against a real Hermes on a host, pointed at a **replica** office
(`scripts/isolated/` replica plus a locally served copy of the `mcp` and `engine` functions), 10 read questions; record per run: claim
latency, Hermes duration, calls, model, tokens, outcome. Pass mark: ≥ 8/10 complete within the deadline, zero containment events, zero
non-free model calls (V5, V8).

## 9. Infrastructure and cost (summary; detail in `FREE-RUNTIME-FEASIBILITY.md`)

- Office side: one more edge function and three small tables; invocations ≈ 1 claim per 15–60 s per bridge plus 12 heartbeats a minute
  during a run. Within the free tier's 500,000 invocations a month at one bridge (≤ 180,000 idle at the 15 s floor).
- Hermes host: one Python process + one Node process. Free only on hardware Grant already has, or an always-free cloud VM (G1).
- Models: `:free` OpenRouter slugs on a zero-credit, Hermes-only key; shared daily free quota with anything else on that account (V5).

## 10. Migration strategy

One additive migration (1070) applied alone with `npm run migrate:one` from a pushed commit (provenance rule). It adds a column with a
default, three tables, functions and wrappers; it changes no existing function except widening one CHECK (`mcp_clients_kind_known`) and
inserting one disabled `providers` row. Nothing reads the new column until the worker that knows it is deployed, and the column's default is
today's behaviour, so the migration is safe to apply before or after the worker (`docs/audit/V1-FINAL-RELEASE-GATE-2026-10-08.md` lesson: a
defaulted addition keeps old callers working). M3's MCP change and M4's handler change are code, not schema.

**The one ordering hazard:** a worker that predates M4 would read a command with `engine = 'hermes'` as an ordinary instruction and answer
it with the team, which is a silent engine switch. Nothing writes `'hermes'` until the `voice` adapter change (D5) is deployed, so the
order D1 → D4 → D5 prevents it. Add a replica check to M6: deploying the adapter is refused by `deploy:voice` (a one-line preflight) unless
the live worker bundle contains the string `engineRunFor`, read through `scripts/forensics/capture-functions.ts`.

## 11. Deployment and rollback

| Step | Deploys | Gate before | Rollback |
|---|---|---|---|
| D1 | migration 1070 | replica proofs green; Grant's named authorisation for the write | leave it: unused tables and a defaulted column change no behaviour; `engine.hermes.offices` absent = off |
| D2 | `engine` function | `deploy:engine` probe | delete the function; bridges get 404 and stop |
| D3 | `mcp` function | `verify:mcp`-class checks for Claude/ChatGPT clients unchanged | `scripts/deploy/restore-function.ts` to the captured previous bundle |
| D4 | worker | `gate:safe`, `verify:critical` | **Order matters.** First switch Hermes off (D6 reversed) and stop every job that has a non-terminal engine run (`app.request_stop` on each; the list is one query on `engine_runs`). Only then restore the previous worker bundle. Restoring first would let the old worker resume a parked Hermes job as an ordinary instruction and answer it with the team: the silent engine switch HD-1 forbids. `npm run engine:drain` (M4) does the first half and prints what it stopped. |
| D5 | `voice`, `hq-api`, page | Level 1B UX QA | restore bundles / promote the previous Vercel deployment |
| D6 | switch on | add the office id to `engine.hermes.offices` (the Sample office first, then Grant's) | remove the id: the selector disables, open runs expire honestly |

**The off switch is the rollback.** Removing the office from `engine.hermes.offices` stops new runs immediately; `heartbeat` tells a live
run to stop; nothing else depends on Hermes. Deploy order D1 → D6; each step is safe alone. No step runs without Grant's explicit
authorisation for that production write (`CLAUDE.md` production access rules), and none of it is part of this architecture phase.
