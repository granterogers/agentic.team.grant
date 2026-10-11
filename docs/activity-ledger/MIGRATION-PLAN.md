# Unified Activity Ledger - migration and rollout plan

Nothing here has been executed against production, and nothing may be until a person with the production flags decides. Everything below was
rehearsed on the isolated replica (`scripts/isolated/replica.sh`): the whole history 0001 to 1061 replays, and the two new files apply to a clone of
the replica with `ON_ERROR_STOP`.

## Numbers

`main` and every other branch end at or below **1053**, applied to production. This work uses **1060** and **1061**, leaving 1054 to 1059 for
others. Re-read `app.schema_migrations` and `git ls-remote` for a newer 1054+ before applying (this repository has been caught renumbering twice).

## What each file does

| File | Adds | Changes in existing objects |
|---|---|---|
| `1060_one_ledger_of_activity_records_what_no_other_table_holds.sql` | `system_config` row `activity.ledger_enabled = false`; tables `activity_event_types` (41 rows), `activity_events`, `activity_write_failures`; functions `activity_ledger_on`, `activity_redact`, `activity_clean`, `record_activity`, `record_activity_safely`, `record_external_activity`, `activity_visibility_not_below_taxonomy` | none |
| `1061_the_activity_read_model_reads_each_table_that_owns_the_state.sql` | helper functions, `activity_read`, `activity_chain`, `activity_for_the_page`, `activity_ledger_health`, four public wrappers, **11 indexes** | none (indexes on existing tables are additive) |

Both are additive and idempotent (`create ... if not exists`, `create or replace`, `on conflict do nothing`). No existing function, table, column,
constraint, trigger or policy is altered or dropped. No data is read, written or deleted outside the new tables and one new config row.

## Order and compatibility (rolling deploy)

| Step | Safe because |
|---|---|
| 1. Apply 1060, 1061 with the switch **off** | Nothing reads or writes the new objects; the 11 indexes are the only effect on existing tables (see below) |
| 2. Deploy the worker (it calls `app.record_activity_safely` from the recovery sweep) | Off, the call returns null and writes nothing. If the worker is deployed **before** the migration, the call fails inside a `.catch` and the sweep is unaffected (`activity-worker`: writer missing, sweep still reclaims) |
| 3. Deploy `hq-api` (four new sections, a shape check and a `requireOne` option) | Old pages never ask for the sections; the new page asks `activity_ledger` after `lately` and uses it only when enabled and non-empty. If `hq-api` is deployed before the migration the sections answer an error and the page keeps its list |
| 4. Deploy the page | The hook is inert while the sections answer `enabled: false` |
| 5. Switch on: `update system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'` (a production write, with Grant's approval) | Reversible by the same statement the other way |

An **old worker on the new schema** is true by construction (nothing it calls changed). A **new worker on the old schema** is proved by the missing-writer
case. A full matrix on real deployed versions was not run (the repository's mixed-version rehearsal method, `docs/audit/V1-FINAL-RELEASE-GATE-2026-10-08.md`,
builds four replicas; that was not repeated here and should be if the release is large).

## The indexes

`create index if not exists` (not `concurrently`: the runner applies a file as one transaction) on `inbound_commands`, `deliveries` (three), `blockers`,
`inference_usage`, `events`, `job_state_transitions`, `outputs` (two) and `job_impediments`. Each holds a write lock on its table while it builds. The replica's tables are
nearly empty (the largest test volume is 24 000 transitions), so the build time there says nothing about production's, **which has not been measured.** Options if that matters:
apply the migration in a quiet window (the repository's own practice), or split the indexes into a third file applied with `CREATE INDEX CONCURRENTLY` by hand.

## Verification before the switch

On the replica: `npm run verify:critical` (70 proofs, including `activity-ledger` and `activity-gateway`), `npx tsx scripts/gate/run.ts --tier extended --only
activity-worker,activity-redaction`, `bash scripts/isolated/activity-ledger-sabotage.sh` (about fifteen minutes, 17 sabotages), and
`npx tsx scripts/isolated/activity-ledger-perf.ts <db> 3000` for the timings. With production access a reviewer grants: `check:callers`,
`check:consumed`, `check:gateway-wrappers`, `check:anon-exposure`, `check:machine-key`, `check:office-callers`, `check:carrier-writers` (this work could
not run them; see `ARCHITECTURE.md` section 9).

## After the switch

1. `activity_health` for the office: `write_failures_1h` should be 0; `retry_backlog` is the number of jobs in `retrying` now.
2. Read `activity_feed` for a real project and compare three events to the source rows by `evidence`.
3. Watch `activity_feed` latency on the real host (replica figures are a different machine: 434 MiB hosts page-in cold reads at ten to a hundred times the warm cost, CLAUDE.md).

## Rollback

- **Switch off** (one statement). The sections answer `enabled: false`, the writers return null, the page keeps its own list. Nothing needs redeploying.
- **Do not drop `activity_events` as a rollback.** It may hold the only record of a recovery or an external report. If the whole feature must go, leave the
  tables, drop only the gateway sections in the next `hq-api` deploy, and keep the data.
- The indexes may be dropped independently if they prove costly; the read model works without them (slower).
- Forward recovery: both files are idempotent and may be applied again.

## Backfill

None, by design (`ARCHITECTURE.md` section 7): the read model reads the authoritative tables, so history is visible on switch-on with original timestamps and
nothing is created to represent it. There is no job to run, resume or undo.

## What would change the plan

A native writer in the router for `integration.rate_limited` and in the budget code for `budget.threshold_reached` (both proposed, in the taxonomy,
neither written); a retention decision for `activity_write_failures`; the external boundary for Hermes (`EXTERNAL-AGENT-CONTRACT.md`); a materialised
read model if the selective-filter latency in `ARCHITECTURE.md` section 5 matters on the real host.
