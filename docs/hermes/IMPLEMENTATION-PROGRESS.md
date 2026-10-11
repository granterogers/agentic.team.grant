# Hermes implementation progress

The resume point for any session picking this up. Read `ARCHITECTURE-HANDOFF.md` first, then this file, then the milestone in
`IMPLEMENTATION-TASKS.md`. Branch `feature/hermes-agent-integration`; tracking issue #461. Never merge or deploy; never set
`ALLOW_PRODUCTION_*`; all new behaviour defaults to disabled.

## State

| Milestone | State | Evidence |
|---|---|---|
| Architecture | done, commit `c3787c5a` | `docs/hermes/*`, ADR-0073 |
| **M0 validation** | **done: PASS, V6 BLOCKED** | `VALIDATION-RESULTS.md`, `m0-evidence/`, `scripts/hermes-m0/` |
| **M1 schema and SQL functions (replica only)** | **done** | migration `1070_…`, `scripts/isolated/engine-runs.ts` 131/131 with 15 sabotages (in `verify:critical`, 69/69 green, 3,813 assertions), `tests/engines/types.test.ts`, contract deviations D-7 to D-13 in `INTERFACE-CONTRACTS.md` §3.1 |
| **M2 engine gateway and bridge credentials** | **done (undeployed)** | `supabase/functions/engine`, `scripts/isolated/engine-gateway.ts` 33/33 with 6 sabotages (`verify:critical` 70/70, 3,846 assertions), `tests/engines/{gateway-routes,credentials}.test.ts`, `scripts/deploy/engine.ts`, `scripts/ops/engine-bridge-credential.ts` (never run against production); D-14, D-15 in `INTERFACE-CONTRACTS.md` §4 |
| M3 MCP server: the engine client kind | **next** | |
| M4 to M6 | not started | |
| M7 live free run | gated on V6 (Grant's zero-credit key) and on the Activity Ledger branch | |
| M8 to M11 | not started | |

## Open decisions for Grant

| Id | Decision | Recommendation |
|---|---|---|
| G1 | Where Hermes runs | A machine Grant owns (idle laptop or home server). Hermes measured 290 to 336 MB, so 1 GB RAM is the floor |
| G2 | Prompts and retrieved project text go to a free model provider | Accept for non-confidential projects only, or stay on his own hardware model |
| G3 | Daily run cap (`engine.hermes.daily_runs`) | 20 |
| G4 | Create a dedicated OpenRouter key with **credit limit 0** at https://openrouter.ai/settings/keys (V6) | Needed before M7. Never paste it into chat; it goes in the Vault through the established mechanism |

## Rules that bind every milestone

Manual engine choice only; no automatic switching on any failure, retry, cancellation, deploy or rollback. The existing task, approval
and permission systems stay authoritative. No unrestricted database credential for Hermes; no unapproved human contact; no automatic skill
adoption; no paid inference. Reuse the Activity Ledger's external-agent contract if present; never merge, cherry-pick or modify that branch.

## Checks that need Grant's authorisation (not run, by the production guard)

These read the production catalogue and refuse without `ALLOW_PRODUCTION_CHECKS=1`, which is never set without Grant's explicit word:
`check:callers`, `check:consumed`, `check:machine-key`, `check:anon-exposure`, `check:gateway-wrappers`, `check:carrier-writers`.
What stands in for them on the replica: `engine-runs` asserts no grant reaches the new tables and that service_role reaches only the public
wrappers (A2, A3), the carrier-writer predicate was applied to the migration locally (5 inserts, all name `office_id`), and
`check:ownership` and `check:office-edges` run with `--replica`. **Expected, and not a defect:** `check:callers` will list
`app.engine_run_open`, `engine_run_for_job`, `engine_run_grounding`, `engine_available`, `engine_mint_bridge`, `engine_retire_bridge` and the
seven public wrappers until M2 to M4 and M6 give them callers; its baseline may only shrink, so none is added to it. Run all six once with
Grant's authorisation after M6.

## Numbering and collisions to resolve at merge

* Migration **1070** is this work's; the ledger branch holds 1060 to 1062 and `main` ends at 1053. Re-check before applying anywhere.
* ADR number: this branch uses **0073**; the ledger branch also has `0073-one-activity-ledger-…`. Whichever merges second takes the next free number.

## M2 start recipe

1. `bash scripts/isolated/replica.sh` rebuilds the replica (about 40 s). Proofs run on a clone of `post`: `create database x template post`.
2. Build `supabase/functions/engine` (`index.ts`, `routes.ts`) per `INTERFACE-CONTRACTS.md` §4 over the public wrappers listed in §3.1 D-12.
   The gateway authenticates with `public.engine_bridge_for`, derives the office from it, and fills it into every wrapper call itself.
3. Operator mint script `scripts/ops/engine-bridge-credential.ts` (first import `require-production-writes`), `deploy:engine` modelled on
   `deploy:mcp`. Both are written and tested, never run against production.
4. Prove claim, heartbeat and finish through the real function under Deno against the replica, with a fake bridge (reuse `scripts/hermes-m0/mcp-rig.ts`
   for the Deno launcher), registered as ONE `p(...)` line in `scripts/gate/critical.ts`. Each proof needs its sabotage.
5. Run lint, typecheck, `npm test`, `check:migrations`, `check:secrets` (read `$?`), `verify:critical`. Commit with the footer, push, update this file.

## Process notes

Edit files only with Edit or Write. Foreground only, with an explicit timeout. M0 evidence is mock unless marked live; do not cite it as
evidence about SQL or a model's quality.
