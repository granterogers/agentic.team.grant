# Migrations

Versioned SQL, applied in order. **Naming is enforced by CI:**
`NNNN_snake_case_name.sql`, four digits, starting at `0001`, no gaps, no
duplicates.

## Two rules that are not negotiable

**An applied migration is immutable.** `applied.json` records the SHA-256 of
every migration the runner has applied. Editing or deleting one of those files
fails CI (`checksum/modified`, `checksum/missing`). To change something, add a
new migration.

**Some statements are rejected outright.** CI refuses any migration that
re-grants `UPDATE`/`DELETE` on `events`, drops or truncates it, disables row
level security, or grants a superuser role. These are the guarantees the
specification requires the *database* to enforce rather than convention, so a
migration that undoes one is a bug regardless of intent. See
`src/migrations/check.ts` for the exact rules and `tests/migrations/check.test.ts`
for what each one does and does not catch.

## How they are applied

Not with `psql`. This environment cannot reach Postgres — all non-443 TCP egress
is blocked and the direct host is IPv6-only. Migrations run over the Supabase
Management API instead:

```bash
scripts/db-query.sh --file migrations/0001_whatever.sql
```

See [ADR-0007](../docs/adr/0007-ddl-over-management-api.md). The same files are
applied by a `pg`-based runner anywhere egress is unrestricted, so nothing here
depends on the transport.
