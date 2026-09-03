# Phase 1 evidence — nightly backup with a tested restore

**Date:** 2026-09-03 · **Workflow:** `.github/workflows/backup.yml`
**Run:** [33748320309](https://github.com/granterogers/agentic.team.grant/actions/runs/33748320309) — both jobs green

§16: *"A backup feature is incomplete until restoration is tested."* The
rehearsal therefore runs on the same schedule as the dump, so the tested
restore is continuous evidence rather than a belief with a date on it.

## Dump

```
pg_dump (PostgreSQL) 17.11
aiteamhq-20260903T110113Z.sql.gz   34K
sha256 recorded alongside; size floor of 2048 bytes enforced
uploaded: <bucket>/2026/09/<name>/{*.sql.gz, *.sha256, manifest.json, roles.sql}
prune: 0 objects older than 30 days
```

## Restore into a fresh PostgreSQL 17

The target is a `postgres:17` service container — the *empty* database §16 asks
for. `public` is dropped first, because PostgreSQL 15+ dumps `CREATE SCHEMA
public` explicitly and a rehearsal that merges into pre-existing objects is not
rehearsing a disaster recovery. It also means the row counts below can only have
come from the dump.

| check | outcome | |
| migrations restored | 7 rows, expected 7 | ✅ |
| events restored | 8 rows, expected 8 | ✅ |
| jobs restored | 91 rows, expected 91 | ✅ |
| job_transitions restored | 416 rows, expected 416 | ✅ |
| projects restored | 3 rows, expected 3 | ✅ |
| system_config restored | 3 rows, expected 3 | ✅ |
| allowed_transitions restored | 46 rows, expected 46 | ✅ |
| migration history restored to the same point | 0007_slack_app_credentials.sql, expected 0007_slack_app_credentials.sql | ✅ |
| job_state enum restored with all fourteen values in order | 14 values | ✅ |
| the restored ledger still refuses UPDATE | refused: 42501: events is append-only: UPDATE on public.events is never permitted (master spec §6) | ✅ |
| the restored ledger still refuses DELETE | refused: 42501: events is append-only: DELETE on public.events is never permitted (master spec §6) | ✅ |
| the restored ledger still refuses TRUNCATE | refused: 42501: events is append-only: TRUNCATE on public.events is never permitted (master spec §6 | ✅ |
| the restored transition history is still append-only | refused: 42501: events is append-only: UPDATE on public.events is never permitted (master spec §6) | ✅ |
| the restored job engine still refuses an illegal transition | refused: 23514: illegal job transition cancelled -> committing for job 0464a349-5263-49e9-b7eb-1696 | ✅ |
| row-level security still enabled and FORCED on all six tables | 6 of 6 tables | ✅ |
| no credential-shaped string anywhere in the restored ledger (§15) | 0 matches | ✅ |
16/16 restore checks passed

## The check that matters most

Row counts prove the data came back. They do **not** prove the backup is
trustworthy. A restore that returns every row but loses the append-only triggers
is a silent catastrophe: nothing fails, and the ledger is quietly mutable from
then on.

So the restored database is re-probed with the same forbidden operations as the
original, and must refuse all of them — `UPDATE`, `DELETE` and `TRUNCATE` on
`events`, rewriting transition history, and an illegal job transition — plus RLS
enabled and forced on all six tables and the enum's fourteen values in order.
The dump keeps privileges and owners deliberately; `--no-privileges` would have
quietly discarded the thing under test.

## Four failures on the way, and what each taught

| Failure | Cause | Fix |
|---|---|---|
| `password authentication failed` | the supplied password had **never** been validated — every earlier attempt died at the network layer first | reset it via the Management API; "the variable is set" is not "the credential works" |
| same error after the reset | pooler propagation lag, not configuration | a matrix diagnostic proved `postgres.<ref>`@5432 authenticates; four shapes in one run instead of one per run |
| `server version mismatch: 17.6 vs 16.15` | `ubuntu-latest` ships client 16 and installing 17 does not repoint `/usr/bin/pg_dump` | call `/usr/lib/postgresql/17/bin/pg_dump` explicitly, and fail if absent |
| `role "supabase_admin" does not exist`, one role per run | I hand-wrote four roles; the source has **fifteen** | generate the list from the source and ship it with the dump |

> The last one is the real lesson: three consecutive runs were lost to guessing
> one variable at a time. **Derive the answer from the system rather than
> proposing candidates to it.**

## A message that lied, caught by reading the output

The passing run reported, for a blocked write to `job_state_transitions`:

```
events is append-only: UPDATE on public.events is never permitted
```

The trigger fired and the write was refused, so the guarantee was never in
doubt — but the shared trigger function hard-coded `public.events`, and named
the wrong table. The test passed because it only asserted the message contained
"append-only", which it did.

Migration `0008` uses `tg_table_schema` and `tg_table_name`, and every assertion
now requires the **table name**, so this cannot regress:

```
public.job_state_transitions is append-only: UPDATE is never permitted
public.events is append-only: UPDATE is never permitted
```

An error naming the wrong table sends someone reading a 3am log into the wrong
file. Worth a migration.
