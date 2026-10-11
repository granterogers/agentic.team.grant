# Hermes integration: architecture handoff

**For a fresh implementation session with no conversation history. Read this whole file before touching anything.**

Branch: `feature/hermes-agent-integration` (from `main` `3caaebf`). Written 11 October 2026 at the end of the architecture phase.
Nothing has been implemented, deployed, installed or connected. This package is documentation only.

## 1. What you are building

A person can choose **Hermes** (Nous Research's open-source agent, MIT) instead of **the team** for one message. The office keeps the job,
the gates, the output, the delivery, the tasks and the approvals. Hermes, on a separate host, only writes the draft answer, using only the
office's own MCP server with read tools, bound to that turn's project. A small bridge beside Hermes pulls work from the office; the office
never calls Hermes. Approved techniques flow back to the team (and to Hermes) only through a person's press on the Governance page.

## 2. Reading order

1. `CLAUDE.md` (repository root): the standing brief. It is long; you MUST at least read "Grant's standing instructions", "File editing",
   "Hard constraints", "Production access is forbidden by default", "Before you push", and skim the traps list for the names this work touches
   (instruction.ts, MCP, migrations, office model, backticks in comments, named arguments, `howComposed` ordering, `pauseJob`).
2. This file.
3. `ARCHITECTURE-DECISIONS.md`: HD-1 to HD-14, the evidence labels, and the challenge review. **These are decided.** Do not reopen them
   without new evidence from M0 or from real use; if you must, write why in that file, in the same commit.
4. `INTERFACE-CONTRACTS.md`: the exact names and shapes you will build.
5. `IMPLEMENTATION-BLUEPRINT.md`: diagrams, lifecycle, file map, tests T1–T22, deployment and rollback order.
6. `IMPLEMENTATION-TASKS.md`: the ordered milestones M0–M11. **Start at M0.**
7. `SECURITY-AND-PERMISSIONS.md`, `LEARNING-AND-SKILL-TRANSFER.md`, `FREE-RUNTIME-FEASIBILITY.md` as each milestone needs them.
8. Context only: `docs/agent-runtime-assessment-2026-09-17.md` (why compute lives outside), `docs/ux-external-assistants.md` (the MCP
   server you are extending), and on `origin/feature/unified-activity-ledger`: `docs/activity-ledger/EXTERNAL-AGENT-CONTRACT.md`. The earlier
   `docs/hermes/ASSESSMENT-2026-10-11.md` on `origin/claude/dashboard-polish-hermes` is superseded where it disagrees.

## 3. The decisions in one screen

| | Decided |
|---|---|
| Selection | Manual, per message, stored on `inbound_commands.engine` (`team` default, `hermes`). No fallback either way. |
| Hermes surface | Its HTTP API server, `/v1/runs` + SSE events + stop, on `127.0.0.1` only. Not ACP, not the TUI gateway, not a subprocess. |
| Topology | Outbound-only bridge (Node/TS) beside Hermes; new edge function `engine` (claim / heartbeat / finish). |
| Job lifecycle | The `office.instruction` job pauses with `dependency_wait` and resumes into the same handler; one `engine_runs` row per job. |
| Tools | Only the office MCP server, new `engine` client kind, **read tools only**, bound to the running run's project, every call recorded. All Hermes built-ins off. |
| Gates | The answer is an ordinary `HandlerOutput`; all coherence gates run; grounding comes from office-recorded MCP results. |
| Memory | Hermes holds none; the office sends the conversation. |
| Learning | Proposals → `public.suggestions` (`teach_skill`) → a person's press → `public.skills`; approved skills exported read-only to Hermes. |
| Cost | `:free` models only, a zero-credit second key on the existing OpenRouter account, auxiliary lane free-only, daily run ceiling. |
| Hosting | Grant's own machine for beta (the only verified £0, no-account option); always-free cloud only if he chooses (G1). |
| Ledger | Office tables are canonical; `app.record_external_activity` events once the ledger branch merges. |

## 4. Assumptions you must test before building (M0)

Thirteen items, `V1`–`V13`, each with its experiment and pass mark in `IMPLEMENTATION-TASKS.md` M0. The two that can stop the project:

- **V4**: Hermes's MCP client may not speak to the office's minimal MCP server (protocol `2024-11-05`, POST-only, no session id). Find out
  first. If a server change is needed it must keep Claude and ChatGPT working.
- **V5**: there must be a `:free` model with ≥ 64K context and dependable tool calling that completes typical read questions inside the
  free daily quota.

## 5. Decisions only Grant can make (ask once, with this table; do not block M0–M5 on them)

| # | Decision | Default if he has not answered | Blocks |
|---|---|---|---|
| **G1** | Where the Hermes host runs: (A) a machine he owns, outbound only, Hermes available only while it is on; (B) Google Cloud always-free e2-micro or (C) Oracle always-free ARM, both requiring a card-backed account and "free within limits" | A | the real-Hermes acceptance in M5 and every production step |
| **G2** | May project content (the turn's project only) be sent to free OpenRouter model providers, whose logging terms differ from the paid chain's? | No production switch-on until he says yes | D6 (switch-on) |
| **G3** | Daily Hermes runs per office | 20 | nothing (it is a setting) |
| G4 (later) | M10 writes through policy; M11 web access | not planned | M10, M11 |

Everything else is routine and already decided; make the call yourself and state it, as `CLAUDE.md` asks.

## 6. Rules that bind this work (from `CLAUDE.md`, restated because they are the ones most likely to be broken)

- **Production is off limits** without Grant's explicit, named authorisation per operation. Never set `ALLOW_PRODUCTION_CHECKS` or
  `ALLOW_PRODUCTION_WRITES` yourself. M0–M6 need no production access at all: use `scripts/isolated/` replicas.
- **Edit files only with the Edit and Write tools.** No `sed -i`, `awk`, `perl -i`, redirects or heredocs into repository files, and no
  in-place formatters; format by printing and writing (the `CLAUDE.md` method).
- **Everything in the foreground.** Give long commands an explicit timeout up to ten minutes; split anything longer.
- **Secrets never printed**, never committed; `npm run check:secrets` before every push and READ ITS EXIT CODE (`$?`, not `| tail`).
- **Before you push:** the list in `CLAUDE.md` ("Before you push") for what you touched, at minimum `lint`, `typecheck`, `test`,
  `check:migrations`, `check:secrets`, `check:templates`; `verify:critical` when SQL changed; UI checks at Level 1B when UI changed.
- **Every check must be shown able to fail** (sabotage → red → restore → green), and every found-nothing check needs a positive control.
- **Requests become GitHub Issues.** Work you find and do not do becomes an Issue, not a TODO. The tracking Issue for this work is linked from
  the commit that created this package.
- **Migrations:** 1070 and 1071 are reserved for this work. Confirm they are still free across all branches before use. Never `npm run migrate`
  from a branch behind production; apply one file with `migrate:one` only when authorised.
- **Do not touch other branches.** Do not merge, rebase onto, or push to anything but `feature/hermes-agent-integration`. Do not deploy.
- **Hermes source is untrusted code.** Install it outside the repository in its own directory; never run its scripts from inside the repository.

## 7. Where things stand

| Item | State |
|---|---|
| Architecture package (this directory) | complete, committed |
| ADR | `docs/adr/0072-hermes-is-a-manually-chosen-engine-for-one-turn.md` |
| M0 validation | **not started; start here** |
| M1–M11 | not started |
| Production | untouched |
| Activity ledger branch | unmerged; M7 waits for it |

## 8. Your first hour (exact steps)

1. `git fetch origin feature/hermes-agent-integration && git checkout feature/hermes-agent-integration`; confirm the head contains
   `docs/hermes/ARCHITECTURE-HANDOFF.md`.
2. Read §2 items 1–6.
3. Create `docs/hermes/VALIDATION-RESULTS.md` with the V1–V13 table, all rows "not run".
4. Install Hermes at the pinned commit in a scratch directory outside the repository (`git clone https://github.com/NousResearch/hermes-agent`,
   checkout `d4d2ab7b…` or record the newer commit you used and why). If the sandbox cannot install it, record that and plan M0 on the host G1
   chooses.
5. Run V4 first (the office MCP function on the replica + Hermes's MCP client). Then V1, V2, V3, V12. Record each result as you go.
6. Commit the results with any contract changes they force, push, and report in red / orange / green with the evidence.

## 9. Definition of done for each milestone

Implemented → tested (its T-numbers, each with its sabotage) → verified (the acceptance in its row) → checked for regressions (the team
path's suites unchanged) → documented (contracts updated if anything moved, the Issue updated) → pushed. Code written is not done.

## 10. Kick-off prompt for the implementation session

> Repository `granterogers/agentic.team.grant`, branch `feature/hermes-agent-integration`. Read `CLAUDE.md`, then
> `docs/hermes/ARCHITECTURE-HANDOFF.md` and the files it lists, in its order. The architecture is decided; implement it milestone by
> milestone starting with M0 (validation, no production) per `docs/hermes/IMPLEMENTATION-TASKS.md`. Do not reopen decisions HD-1 to HD-14
> without evidence. Do not contact production, deploy, or merge. Stop and report after each milestone with the tests run and their results.
