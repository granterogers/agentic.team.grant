# Unified Activity Ledger - migration and rollout plan

Nothing here has been executed against production, and nothing may be until a person with the production flags decides. Everything below was
rehearsed on the isolated replica (`scripts/isolated/replica.sh`): the whole history 0001 to 1062 replays, and the three new files apply to a clone of
the replica with `ON_ERROR_STOP`. `RELEASE-READINESS.md` holds the verdicts and the evidence; this file is the procedure.

## Numbers

`main` and every other branch end at or below **1053**, applied to production. This work uses **1060, 1061 and 1062**, leaving 1054 to 1059 for
others. Re-read `app.schema_migrations` and `git ls-remote` for a newer 1054+ before applying (this repository has been caught renumbering twice).
The ADR is **0073** (main holds 0071 and 0072). The files are unapplied, so they may still be edited until they are applied; after that they are immutable.

## What each file does

| File | Adds | Changes in existing objects |
|---|---|---|
| `1060_one_ledger_of_activity_records_what_no_other_table_holds.sql` | `system_config` row `activity.ledger_enabled = false`; tables `activity_event_types` (42 rows, with a durability class), `activity_events`, `activity_write_failures`; functions `activity_ledger_on`, `activity_redact`, `activity_clean`, `record_activity`, `record_activity_safely`, `record_external_activity`, `activity_visibility_not_below_taxonomy` | none |
| `1061_the_activity_read_model_reads_each_table_that_owns_the_state.sql` | helper functions, `activity_read`, `activity_chain`, `activity_for_the_page`, `activity_ledger_health`, `activity_index_gaps`, four public wrappers | **none: no index is created here** (see below) |
| `1062_a_held_back_over_budget_agent_is_recorded_in_the_activity_ledger.sql` | nothing new | `app.defer_over_budget()` gains one best-effort `perform` (spliced from the live definition); its behaviour is unchanged with the switch off (proved) |

1060 and 1061 are additive and idempotent. 1062 replaces one function body. No existing table, column, constraint, trigger or policy is altered or dropped.
No data is read, written or deleted outside the new tables and one new config row.

## Order and compatibility (rolling deploy)

| Step | Safe because |
|---|---|
| 1. Apply 1060, 1061, 1062 with the switch **off** (`npm run migrate:one -- <file>` each, per the repository's rule for a branch behind the ledger) | Nothing reads or writes the new objects. 1062 changes a function whose new line writes nothing while the switch is off |
| 2. Build the access paths: `npm run activity:indexes` (see below) | Concurrent, resumable, takes no lock that blocks a write |
| 3. Deploy the worker (it calls `app.record_activity_safely` from the recovery sweep and around each plan-step tool call) | Off, the calls return null and write nothing. If the worker is deployed **before** the migration the call fails inside a `.catch` and neither the sweep nor a step is affected (`activity-worker`, `activity-native-writers`) |
| 4. Deploy `hq-api` (four new sections, a shape check and a `requireOne` option) | Old pages never ask for the sections; the new page asks `activity_ledger` alongside `lately` and uses it only when enabled and drawable. If `hq-api` is deployed before the migration the sections answer an error and the page keeps its list |
| 5. Deploy the page | The hook is inert while the sections answer `enabled: false`, and it never waits for the ledger to draw |
| 6. Switch on (the activation checklist in `RELEASE-READINESS.md`), a production write with Grant's approval | Reversible by the same statement the other way |

An **old worker on the new schema** is true by construction (nothing it calls changed, apart from `defer_over_budget`, which only the database calls). A **new worker on the old
schema** is proved by the missing-writer cases. A full four-replica matrix on real deployed versions was not run (the repository's mixed-version method,
`docs/audit/V1-FINAL-RELEASE-GATE-2026-10-08.md`); it is a recommended step before a large release and is listed as a deployment prerequisite.

## The indexes (staged, not in a migration)

Eleven access paths on `inbound_commands`, `deliveries` (three), `blockers`, `inference_usage`, `events`, `job_state_transitions`, `outputs` (two) and
`job_impediments`. They were first in 1061 as plain `CREATE INDEX`; a plain build holds a write lock on its table for the whole build and the migration runner applies a
file as one batch, in which `CONCURRENTLY` cannot run. Measured on the replica (2 000 000 rows, 523 MB, one writer inserting every 20 ms): **plain build 2.1 s, the writer's
slowest insert 2 061 ms; concurrent build 1.8 s, slowest insert 88 ms.** The stall equals the build time and the build time grows with the table, on a host with about 434 MiB
of memory where cold reads cost ten to a hundred times the warm ones. Production's table sizes have **not** been measured.

So they are built by a separate step, `npm run activity:indexes` (`src/activity/indexes.ts`, `scripts/ops/activity-indexes.ts`):

- one `CREATE INDEX CONCURRENTLY IF NOT EXISTS` per statement, each as its own request;
- idempotent and resumable: an interrupted run leaves at worst an **invalid** index, which the next run drops (`DROP INDEX CONCURRENTLY`) and builds again; it never drops a valid one;
- `--status` reads which are missing or invalid; `--print` prints the eleven statements to run by hand in the SQL editor, one at a time;
- production-writes gated like every deploy (`ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1`, set by a person for this one operation);
- connection: `SUPABASE_DB_URL` (a direct session, preferred) or the Management API token. **Whether the Management API accepts `CREATE INDEX CONCURRENTLY` has not been verified**;
  if it answers 25001 ("cannot run inside a transaction block"), use the direct connection or `--print` and the SQL editor;
- `app.activity_ledger_health` reports `indexes_missing`; activation requires it to be empty. The read model is correct without them and only slower.

Rollback of an index: `drop index concurrently if exists public.<name>` (they are additive; nothing depends on them).

## Verification before the switch

On the replica: `npm run verify:critical` (70 proofs, including `activity-ledger` and `activity-gateway`); `npx tsx scripts/gate/run.ts --tier extended --only
activity-ledger-review,activity-ledger-equivalence,activity-indexes,activity-ledger-durability,activity-native-writers,activity-worker,activity-redaction`;
`bash scripts/isolated/activity-ledger-sabotage.sh` (26 sabotages, about two minutes in three batches); `npx tsx scripts/isolated/activity-ledger-perf.ts <db> 3000` for the timings.
The seven production-catalogue checks run against the replica with `--replica` (`scripts/lib/catalogue-db.ts`) and are listed with their status in `RELEASE-READINESS.md`; with
production access a reviewer grants, run them again without the flag.

## After the switch

1. `activity_health` for the office: `write_failures_1h` is 0, `indexes_missing` is empty, `critical_via_best_effort_24h` is 0; `retry_backlog` is the number of jobs in `retrying` now.
2. Read `activity_feed` for a real project and compare three events to the source rows by `evidence`.
3. Watch `activity_feed` latency on the real host (replica figures are a different machine).

## Rollback

- **Switch off** (one statement). The sections answer `enabled: false`, the writers return null, the page keeps its own list. Nothing needs redeploying.
- **Do not drop `activity_events` as a rollback.** It may hold the only record of a recovery, a limit that was reached or an external report. If the whole feature must go, leave the
  tables, drop only the gateway sections in the next `hq-api` deploy, and keep the data.
- 1062: `create or replace app.defer_over_budget()` with the same body less the `perform` (the file's header says so). Events already written are history and stay.
- The indexes may be dropped independently if they prove costly (above).
- Forward recovery: all three files are idempotent and may be applied again.
- Rolling the worker back needs no schema change: it is the only caller of the TypeScript writers, which are best effort.

## Backfill

None, by design (`ARCHITECTURE.md` section 7): the read model reads the authoritative tables, so history is visible on switch-on with original timestamps and
nothing is created to represent it. There is no job to run, resume or undo.

## What would change the plan

A retention decision for `activity_write_failures`; the external boundary for Hermes (`EXTERNAL-AGENT-CONTRACT.md`); a materialised read model if the selective-filter latency in
`ARCHITECTURE.md` section 5 matters on the real host; measured production table sizes, which decide whether the index build wants a quiet window as well as `CONCURRENTLY`.
