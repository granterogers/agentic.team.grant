# ADR-0007 — Migrations run over the Supabase Management API, and backups run in GitHub Actions

**Status:** Proposed — needs a Supabase personal access token before it can be
accepted · **Date:** 2026-09-03

**Amends** the master spec's implicit assumption that a Claude Code cloud session
can reach Postgres directly, and `docs/implementation-plan.md` Phase 1's
"nightly `pg_dump` → R2, plus a tested restore".

## Context

The master spec is cloud-first (§2.2): every Claude Code session runs in a cloud
environment, with no local development machine. Phase 1 then requires DDL —
schema, `REVOKE UPDATE, DELETE ON events`, RLS policies — and a nightly
`pg_dump`. Both were assumed to be run by the build session over `psql`.
`docs/credential-status.md` and `HUMAN_ONLY_PREREQUISITES.md` accordingly asked
Grant for a connection string, preferring the Session pooler because Direct is
IPv6-only and the container needs IPv4.

Grant supplied one. Measurement on 2026-09-03 shows the request was for the
wrong thing — and that the right thing would not have worked either.

Two independent facts, evidence in
[`docs/test-evidence/2026-09-03-credential-verification.md`](../test-evidence/2026-09-03-credential-verification.md):

1. The string supplied is the **Direct connection**, which has AAAA records
   only, and this container does not support the IPv6 address family at all
   (`OSError 97`). Fixable by Grant in two minutes.
2. **Non-443 TCP egress is blocked.** Port 443 to the Session pooler host
   connects; ports 5432 and 6543 to that same host time out. The session's
   egress proxy documents `raw-TCP databases` as *not supported — report, do not
   work around*.

Fact 2 subsumes fact 1. **No Postgres connection string of any kind can work
from a Claude Code cloud session.** The prerequisite we have been asking Grant
for since 2026-09-02 was never going to unblock Phase 1, and a third round of
"try a different connection string" would have burned another session
discovering the same thing.

The constraint is on the **build** environment, not the product. Vercel
functions have ordinary egress and will use the pooler normally at runtime, as
`docs/architecture.md` specifies. Nothing about the deployed system changes.

## Decision

Split the two concerns that `psql` was carrying, and give each one a transport
that exists.

**1. DDL and migrations — Supabase Management API over HTTPS.**

`POST https://api.supabase.com/v1/projects/{ref}/database/query` executes
arbitrary SQL, including DDL, `REVOKE` and `CREATE POLICY`. Verified reachable
through the proxy: it returns `401 Unauthorized`, not a timeout — the transport
is fine and only the credential is missing. It requires a Supabase **personal
access token** (`sbp_…`), which is option 2 of the two unblocking routes
`docs/credential-status.md` has listed from the start. That option is now the
only one, and it is a genuine §14 human-only action: Supabase issues personal
access tokens only through an authenticated dashboard session.

Migrations stay **versioned SQL files under `migrations/`** exactly as the spec
requires. Only the executor changes: a thin `scripts/migrate.ts` that applies
pending files in order against a `schema_migrations` ledger, through whichever
executor is available. The runner is an interface with two implementations —
Management API (build sessions) and direct `pg` (anywhere with normal egress) —
so the same migration files run unchanged in CI, from a laptop, or from a future
environment without this restriction. **The migration files are the artifact;
the transport is a detail.**

**2. `pg_dump` and the restore test — a scheduled GitHub Actions workflow.**

`pg_dump` speaks the wire protocol and has no HTTPS mode, so no build session
can ever produce a backup. GitHub Actions runners have unrestricted egress,
`pg_dump` is present on `ubuntu-latest`, the schedule is a first-class `cron:`
trigger, and the credentials live in **GitHub Actions secrets** — which §15
already designates as a store the build session cannot read. Private-repo
Actions minutes are free at a volume a nightly dump cannot approach.

This is better than the original plan rather than a concession to it. The spec
demands a *tested* restore (§16: "a backup feature is incomplete until
restoration is tested"), and a restore rehearsal that runs on a schedule in CI —
dump, restore into a scratch database, assert the ledger and job state came back
— is continuous evidence. A restore performed once by hand is a belief with a
date on it.

## Consequences

- **Phase 1 is blocked on one human action:** a Supabase personal access token.
  It is not blocked on a better connection string. `SUPABASE_DB_URL` should be
  kept regardless — the deployed runtime needs a pooler URI, and it belongs in
  Vercel's environment, not this one.
- CI stops being only a quality gate and becomes **the only place backups and
  restores can run**. Phase 0's "CI before schema" ordering matters more than it
  did: the backup workflow is infrastructure, not a check.
- The migration runner needs two implementations rather than one. Small cost,
  and it removes a single point of failure: if Supabase changes the Management
  API, the `pg` runner still applies the same files.
- Management API SQL execution is authenticated as a **project-level** token
  with broad authority. It goes in the environment's **API credentials** store,
  never plain environment variables, and never into the ledger (§15).
- A wire-protocol connection remains necessary for anything `pg_dump`-shaped.
  Any future build step needing one must run in Actions, not in a session.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Ask Grant for the Session pooler string | **Measured: still blocked.** Ports 5432 and 6543 both time out. This is the option the previous two sessions were converging on, and it is wrong. |
| Tunnel Postgres over the HTTPS proxy | The proxy documentation names raw-TCP databases as unsupported and says report rather than work around. Circumventing an egress policy is not a build step. |
| Create an `exec_sql` RPC and drive DDL through PostgREST | Confirmed absent (`PGRST202`) and **it cannot bootstrap itself** — creating the function is the DDL we lack a path for. It would also leave a permanent arbitrary-SQL RPC reachable with the service-role key, which is a standing privilege-escalation surface. |
| Supabase CLI (`supabase db push`) | Wraps the same wire protocol. Same wall. |
| Grant runs migrations by hand | Violates §14: *never ask Grant to type commands Claude can execute*. Claude can execute these — over HTTPS. |
| Move off Supabase to an HTTP-native Postgres | Reopens a settled decision to route around an environment constraint that does not affect the product. Postgres over HTTP also loses `LISTEN/NOTIFY` and session-scoped `SELECT … FOR UPDATE SKIP LOCKED` semantics the job engine is built on. |

## What would reverse this

An egress policy permitting 5432/6543 from build sessions, or a session
environment with IPv6 and direct database access. Then the `pg` runner — which
this decision requires us to write anyway — becomes the primary path and the
Management API implementation is deleted. Nothing else changes, because the
migration files never depended on either.

## Lesson recorded

**Verify the transport before requesting the credential.** Two sessions asked
Grant for a database connection string without once testing whether *any* TCP
connection to port 5432 could leave the container — a five-second check. The
prerequisite document even reasoned carefully about IPv4 versus IPv6 and Session
versus Transaction pooler, which made the request look well-researched while the
load-bearing assumption underneath it went untested.

This is the same failure mode as ADR-0001, where hosting was specified for a
browser that is never launched: **careful reasoning on top of an unverified
premise produces a confident, wrong answer.** Cheapest available test first.
