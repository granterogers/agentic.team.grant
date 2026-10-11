# Unified Activity Ledger - migration and rollout plan

Nothing here has been executed against production, and nothing may be until a person with the production flags decides. Everything below was
rehearsed on the isolated replica (`scripts/isolated/replica.sh`): the whole history 0001 to 1062 replays, the three new files apply to a clone of
the replica with `ON_ERROR_STOP`, and the failure modes (an interrupted migration, an interrupted index build, the wrong kind of connection) are rehearsed by
`bash scripts/isolated/activity-migration-rehearsal.sh` (17 checks). `RELEASE-READINESS.md` holds the verdicts and the evidence; this file is the procedure.

**Four stages, deliberately separate, each with its own approval:** (A) schema, (B) index preparation, (C) application deployment, (D) activation. Each is
reversible or harmless on its own, and each is checked before the next starts. Merging the branch is none of them.

## Numbers and compatibility with `main`

`main` (checked at `5fa1fbdc`, 11 October 2026) and every other branch end at or below **1053**, which is applied to production
(`docs/ops/deployment-state.json`). This work uses **1060, 1061 and 1062**, leaving 1054 to 1059 for others. The ADR is **0073** (main holds 0071 and 0072). The files are
unapplied, so they may still be edited until they are applied; after that they are immutable (`check:migrations` enforces it, against you too).

Before applying, every time: `git fetch origin main && git ls-tree --name-only origin/main migrations/ | tail -3`, `npm run check:migrations`, and a read of
`app.schema_migrations` (`npm run q -- "select name from app.schema_migrations order by name desc limit 5"`, which needs `ALLOW_PRODUCTION_CHECKS=1` set by a person). If another branch has
taken 1060 to 1062 (this repository has been caught renumbering twice), give the PENDING file a free number; never rename an applied one. The runner refuses an unapplied duplicate sequence.

## What each file does

| File | Adds | Changes in existing objects |
|---|---|---|
| `1060_one_ledger_of_activity_records_what_no_other_table_holds.sql` | `system_config` row `activity.ledger_enabled = false`; tables `activity_event_types` (42 rows, with a durability class), `activity_events`, `activity_write_failures`; functions `activity_ledger_on`, `activity_redact` (the strict redactor), `activity_clean`, `activity_external_metadata`, `record_activity`, `record_activity_safely`, `record_external_activity`, `activity_visibility_not_below_taxonomy` | none |
| `1061_the_activity_read_model_reads_each_table_that_owns_the_state.sql` | helper functions, `activity_read`, `activity_chain`, `activity_for_the_page`, `activity_ledger_health`, `activity_index_gaps`, four public wrappers | **none: no index is created here** (see stage B) |
| `1062_a_held_back_over_budget_agent_is_recorded_in_the_activity_ledger.sql` | nothing new | `app.defer_over_budget()` gains one best-effort `perform` (spliced from the live definition); its behaviour is unchanged with the switch off (proved) |

1060 and 1061 are additive and idempotent. 1062 replaces one function body. No existing table, column, constraint, trigger or policy is altered or dropped.
No data is read, written or deleted outside the new tables and one new config row. Re-applying any of them does not reset a switch somebody turned on and does not lose a row
(rehearsed). The migration runner sends a file as one request, which Postgres runs as one transaction: a file that fails part-way leaves **none** of its objects behind (rehearsed with a failure
appended to the end of 1061).

## Stage A - schema (a production write)

Prerequisites: a clean tree on a pushed commit (`src/safety/provenance.ts`; no bypass), `npm run check:migrations` green, no one else migrating, the Supabase health reading healthy
(`GET /v1/projects/<ref>/health`; never apply into a sick host), a person who has decided and set `ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1` for this one operation.

```bash
# from the pushed feature branch or the merge commit; each file is its own request. migrate:one is used because this branch may be behind production's ledger.
ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npm run migrate:one -- migrations/1060_one_ledger_of_activity_records_what_no_other_table_holds.sql
ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npm run migrate:one -- migrations/1061_the_activity_read_model_reads_each_table_that_owns_the_state.sql
ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npm run migrate:one -- migrations/1062_a_held_back_over_budget_agent_is_recorded_in_the_activity_ledger.sql
```

Expected: each prints its name as applied; `app.schema_migrations` gains three rows; `select value from public.system_config where key = 'activity.ledger_enabled'` is `false`;
`select count(*) from public.activity_event_types` is 42; `select count(*) from public.activity_events` is 0; `select app.activity_ledger_on()` is `false`.
Then `npm run check:deployment-state` after updating `docs/ops/deployment-state.json` in the same commit as the deploy record.

Failure handling: a file that errors leaves nothing of itself (one transaction) and the ledger records nothing for it; read the error (a `42501` is a privilege, a `42P07` is a name that exists: query `information_schema`
before editing), fix the file **while it is unapplied**, and run it again. If 1060 applied and 1061 failed, 1060 stays and is harmless (nothing reads it). If the platform is unhealthy mid-run, stop and wait; do not retry into it.
A `checksum/modified` or `checksum/missing` from the runner means the history does not match the repository: stop, do not hand-write a ledger row.

## Stage B - index preparation (a production write, after A, before D)

Eleven access paths on `inbound_commands`, `deliveries` (three), `blockers`, `inference_usage`, `events`, `job_state_transitions`, `outputs` (two) and `job_impediments`. They were first in
1061 as plain `CREATE INDEX`; a plain build holds a write lock on its table for the whole build and the runner applies a file as one batch, in which `CONCURRENTLY` cannot run. Measured on the
replica (2 000 000 rows, 523 MB, one writer inserting every 20 ms): **plain build 2.1 s, the writer's slowest insert 2 061 ms; concurrent build 1.8 s, slowest insert 88 ms.** The stall equals the
build time and the build time grows with the table, on a host with about 434 MiB of memory where cold reads cost ten to a hundred times the warm ones. Production's table sizes have **not** been measured.

```bash
# measure first (read-only, a person sets ALLOW_PRODUCTION_CHECKS=1):
npm run q -- "select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) from pg_stat_user_tables where relname in ('inbound_commands','deliveries','blockers','inference_usage','events','job_state_transitions','outputs','job_impediments') order by 3 desc"
# build (a person sets both flags): a DIRECT database session is required
SUPABASE_DB_URL=<direct session url, from the project settings, never printed> ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npm run activity:indexes
# or, with no direct connection, print the eleven statements and run them one at a time in the SQL editor:
npm run activity:indexes -- --print
```

Connection requirements: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block (`25001`), so the connection must be a direct session (or the SQL editor, one statement per run). Every statement
the script sends is its own request. **Whether the Management API accepts it was not verified and must not be assumed**; `scripts/isolated/activity-migration-rehearsal.ts` proves that a connection that wraps statements in a transaction is
refused with the transaction-block error and that the builder reports a `failed:` outcome per index (never a silent success) and leaves nothing invalid. If the script reports `failed: 25001`, change the connection; do not edit the script.
The script imports the production-writes gate (it writes), so even `--status` needs both flags; the read-only equivalent is the `activity_health` reading (below), which needs neither a write flag nor the script.

Expected: one line per index ending `built`; the final `app.activity_index_gaps()` is `{}`; on a second run every index reports `already-built` and none is dropped and rebuilt (catalogue identity unchanged, rehearsed).
Production hosts under memory pressure: run in a quiet window, one table at a time if needed (the statements are independent), watch the platform health reading between them.

Interrupted build: a killed or cancelled build leaves an **invalid** index (rehearsed by cancelling a real concurrent build while an old snapshot was held). `activity_ledger_health.indexes_missing` names it,
a rerun of `npm run activity:indexes` drops that one (`DROP INDEX CONCURRENTLY`) and rebuilds it, builds anything missing, and never touches a valid index. By hand:
`select indexrelid::regclass from pg_index where not indisvalid;` then `drop index concurrently if exists public.<name>;` then the printed statement.
`lock_timeout` (3 s default) applies when the session is direct; a build that cannot get its lock reports `failed: 55P03`, leaves nothing invalid and is retried (3 attempts); a persistent one means a long transaction holds the table, so find it (`pg_stat_activity`) rather than raising the timeout.

Rollback of an index: `drop index concurrently if exists public.<name>` (they are additive; nothing depends on them). The read model is correct without them and only slower; activation requires `indexes_missing` empty.

## Stage C - application deployment (a production write, after A and B)

| Step | Safe because |
|---|---|
| 1. `npm run deploy:worker` (the recovery sweep and each plan-step tool call call `app.record_activity_safely`) | Off, the calls return null and write nothing. A worker deployed **before** stage A fails the call inside a `.catch` and neither the sweep nor a step is affected (`activity-worker`, `activity-native-writers`) |
| 2. `npm run deploy:hq-api` (four new sections, a shape check and a `requireOne` option) | Old pages never ask for the sections; the new page asks `activity_ledger` alongside `lately` and uses it only when enabled and drawable. If `hq-api` is deployed before stage A the sections answer an error and the page keeps its list |
| 3. `npm run deploy:hq-page` (or `deploy:page`, whichever the deployment record uses for the studio) | The hook is inert while the sections answer `enabled: false`, and it never waits for the ledger to draw |

Each deploy probes itself and fails when the probe fails (CLAUDE.md). Before any deploy compare the live bytes of the files that could differ with `origin/main` and with the other branches that deploy
(`curl` and `md5sum`, `scripts/forensics/capture-functions.ts`); carry another workstream's diff in, never overwrite it. Deploy one function at a time and one long command per call. Rolling compatibility: an **old
worker on the new schema** is true by construction (nothing it calls changed, apart from `defer_over_budget`, which only the database calls); a **new worker on the old schema** is proved by the missing-writer cases. A full
four-replica matrix on real deployed versions was not run (the repository's mixed-version method, `docs/audit/V1-FINAL-RELEASE-GATE-2026-10-08.md`); it is a recommended step before a large release and is a deployment prerequisite.

## Stage D - activation (a production write, with Grant's approval, after A to C are verified)

`activity.ledger_enabled` is **deployment-wide**: it switches the ledger on for every office at once, the Sample and every future person included. Per-office rollout is not built; it would be a
documented future architectural change (a per-office row consulted by `activity_ledger_on(office)`), not a flag toggle. Take that into account when choosing the moment.

```sql
update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled';   -- via the repository's audited config path, a production write
```

Preconditions: stage A to C verified; `activity_health` clean (below); the activation checklist in `RELEASE-READINESS.md` signed by a person; the Supabase health reading healthy.
After the switch: (1) `activity_health` for the office: `write_failures_1h` is 0, `indexes_missing` is empty, `critical_via_best_effort_24h` is 0; `retry_backlog` is the number of jobs in `retrying` now.
(2) Read `activity_feed` for a real project and compare three events to the source rows by `evidence`. (3) Watch `activity_feed` latency on the real host (replica figures are a different machine).
(4) Open the Activity page signed in, desktop and phone. If any is wrong, switch off.

## Verification before each stage

On the replica: `npm run verify:critical` (70 proofs, including `activity-ledger` and `activity-gateway`); `npx tsx scripts/gate/run.ts --tier extended --only
activity-ledger-review,activity-ledger-equivalence,activity-indexes,activity-ledger-durability,activity-native-writers,activity-worker,activity-redaction,activity-external-attack`;
`bash scripts/isolated/activity-ledger-sabotage.sh` (38 sabotages, in batches of a few so each call fits ten minutes); `bash scripts/isolated/activity-migration-rehearsal.sh`;
`npx tsx scripts/isolated/activity-ledger-perf.ts <db> 3000` for the timings. The seven production-catalogue checks run against the replica with `--replica` (`scripts/lib/catalogue-db.ts`) and are listed with
their status in `RELEASE-READINESS.md`; with production access a reviewer grants, run them again without the flag.

## Rollback (any stage)

- **Switch off** (one statement). The sections answer `enabled: false`, the writers return null, the page keeps its own list. Nothing needs redeploying. This is the first response to anything surprising.
- **Do not drop `activity_events` as a rollback.** It may hold the only record of a recovery, a limit that was reached or an external report, and its history is append-only by design. If the whole feature must go, leave the
  tables, drop only the gateway sections in the next `hq-api` deploy, and keep the data. Rollback never deletes audit events.
- 1062: `create or replace app.defer_over_budget()` with the same body less the `perform` (the file's header says so). Events already written are history and stay.
- The indexes may be dropped independently if they prove costly (stage B).
- Forward recovery: all three files are idempotent and may be applied again.
- Rolling the worker back needs no schema change: it is the only caller of the TypeScript writers, which are best effort.
- The platform's own state is not part of this plan: if health goes UNHEALTHY during any stage, stop, read the health API, wait; the repository's incident notes record what retrying into a sick host costs.

## Backfill

None, by design (`ARCHITECTURE.md` section 7): the read model reads the authoritative tables, so history is visible on switch-on with original timestamps and
nothing is created to represent it. There is no job to run, resume or undo.

## What would change the plan

A retention decision for `activity_write_failures`; the external boundary for Hermes (`EXTERNAL-AGENT-CONTRACT.md`); a materialised read model if the selective-filter latency in
`ARCHITECTURE.md` section 5 matters on the real host; measured production table sizes, which decide whether the index build wants a quiet window as well as `CONCURRENTLY`; a per-office activation switch.
