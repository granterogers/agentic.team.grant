# Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | every push and PR | lint · typecheck · test · migration check · secret scan |

## Why CI matters more here than usual

Two jobs in this repository can only ever run in GitHub Actions, because a
Claude Code cloud session cannot open a Postgres connection — all non-443 TCP
egress is blocked and the direct database host is IPv6-only
([ADR-0007](../../docs/adr/0007-ddl-over-management-api.md)):

- the nightly `pg_dump` to offsite storage, and
- the **restore rehearsal**, which restores that dump into a scratch database
  and asserts the ledger and job state survived.

`pg_dump` and `psql` have no HTTPS mode, so Actions is not a convenience here —
it is the only place those can execute. CI is infrastructure in this project,
not just a quality gate.

## Secrets these workflows need

Actions secrets are a separate store from the build environment's variables, by
design (master spec §15) — a build session cannot read them, and Claude cannot
set them: the session proxy refuses the Actions API outright.

| Secret | Used by |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | migrations, and the restore rehearsal's scratch database |
| `SUPABASE_DB_URL` | `pg_dump` — needs the **Session pooler** URI, not the IPv6-only direct one |
| `BACKUP_S3_ENDPOINT` · `BACKUP_S3_REGION` · `BACKUP_S3_BUCKET` | dump upload and restore download |
| `BACKUP_S3_ACCESS_KEY_ID` · `BACKUP_S3_SECRET_ACCESS_KEY` | ditto |

`ci.yml` itself needs **none** of these, and is given none. The secret-scan job
in particular must stay credential-free: it compares tracked files against its
own environment, so giving it secrets is the one way to make it leak them.
