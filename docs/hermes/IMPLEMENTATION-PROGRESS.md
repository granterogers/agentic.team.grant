# Hermes implementation progress

The resume point for any session picking this up. Read `ARCHITECTURE-HANDOFF.md` first, then this file, then the milestone in
`IMPLEMENTATION-TASKS.md`. Branch `feature/hermes-agent-integration`; tracking issue #461. Never merge or deploy; never set
`ALLOW_PRODUCTION_*`; all new behaviour defaults to disabled.

## State

| Milestone | State | Evidence |
|---|---|---|
| Architecture | done, commit `c3787c5a` | `docs/hermes/*`, ADR-0073 |
| **M0 validation** | **done: PASS, V6 BLOCKED** | `VALIDATION-RESULTS.md`, `m0-evidence/`, `scripts/hermes-m0/` |
| M1 schema and SQL functions (replica only) | **next** | |
| M2 to M6 | not started | |
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

## M1 start recipe

1. `bash scripts/isolated/replica.sh` (about 36 s) rebuilds the replica. Read `app.schema_migrations` for free numbers; the plan is `1070`
   (tables `engine_bridges`, `engine_runs` with `attempt`, `engine_run_calls`; functions `app.engine_*`; widen `mcp_clients_kind_known` to
   `engine`; a disabled `hermes` row in `public.providers`; settings `engine.hermes.offices`, `.daily_runs`, `.deadline_s`, `.no_progress_s`)
   and `1071` (`decide_suggestion` `p_tools`, `engine_runs.profile`). Re-check the numbers: other branches use 1023 to 1035.
2. Write `src/engines/hermes/types.ts` and `timing.ts` from `INTERFACE-CONTRACTS.md`, honouring D-1 to D-6.
3. Prove it in `scripts/isolated/engine-runs.ts`, registered as ONE `p(...)` line in `scripts/gate/critical.ts`. Every proof needs its sabotage.
4. Run: `check:migrations`, `check:ownership`, `check:office-edges`, `check:carrier-writers`, `check:anon-exposure`, `check:secrets`
   (read `$?`), lint, typecheck, `npm test`, `npm run verify:critical`.
5. Commit with the attribution footer, push the feature branch, update this file, then M2.

## Process notes

Edit files only with Edit or Write. Foreground only, with an explicit timeout. M0 evidence is mock unless marked live; do not cite it as
evidence about SQL or a model's quality.
