# ADR-0068: A restore never runs against production from code, a backup is only thinned by a person, and the free tier is watched

**Date:** 6 October 2026 · **Status:** accepted · **Audit:** G-1 and G-2 of `docs/audit/DEEP-SYSTEMS-AUDIT-2026-10-06.md` · **Migration:** 1026

## Context

The 6 October audit found that the database had grown from 63 MB to 372 MB in eighteen days against a 500 MB line, that backups are never deleted and share a 1 GB Storage allowance, that
`app.free_tier_headroom()` was only displayed, and that the "restore" the repository could demonstrate loaded every column as text into a scratch schema and said nothing about types, constraints,
triggers, row security or composite foreign keys, nor about the logins, file bytes, schedules and secrets a working system needs.

## Decisions

1. **The typed restore (`src/backup/restore.ts`) refuses every target except a marked local replica, and it has no flag for production.** The check is the first thing it does and is a pure function
   (`judgeTarget`) with a unit test for every refusal, including the lookalike names that must NOT be refused. A production restore is a separate, reviewed change with its own flag and a rehearsal against
   a throwaway Supabase project. A flag added "for convenience" is how a rehearsal tool becomes the thing that overwrote the office. The proofs that exercise the refusal use a throwaway database and never
   `post` or `postgres`: if the guard were broken, the control must not be able to damage anything anyone else uses.
2. **Backups are thinned only by an attended command.** `src/backup/retention.ts` decides, purely, which runs may go (newest 7 plus one a week for 8 weeks; never the newest complete or newest verified run; nothing
   unless one run is verified; only what this system created; nothing younger than 24 hours; at most 30 a pass; manifest removed last). `scripts/backup/prune.ts` is a dry run unless `--go`, behind the
   production-writes gate, and verifies the newest backup by reading it before it plans. The nightly handler REPORTS what the policy would free and never deletes. Grant's rule, *"you should always check before
   making any destructive action with me"*, still holds, and this decision records that thinning is the exception he can invoke, not a schedule.
3. **The ledgers are not compacted.** `events`, `inference_usage`, `job_state_transitions` and twelve other tables are append-only by `reject_ledger_mutation` (UPDATE, DELETE and TRUNCATE). Any archive-then-prune is a
   decision about how long the audit trail is kept, made with an ADR, not a migration. `jobs` is reclaimed by rewrite (bloat), not by deleting rows, and only in a maintenance window.
4. **The free tier is watched by the office, not by whoever remembers to read a figure.** Migration 1026 samples sizes daily (bounded to 180 days), computes warning levels at 70, 85 and 95 percent of a *conservative*
   (decimal) limit with hysteresis, projects days to the limit at the fastest recent rate, raises a chore on the crossing through the path the deployed `office.chores` handler already runs, and gives a duty a
   notice composed in code that speaks on a crossing and at most daily after. The SQL and TypeScript copies of the thresholds are compared by a proof so they cannot drift.
5. **A backup records, inside its manifest, what it cannot restore as rows**: the logins (a whitelist of columns, never a password hash or token), the schedules (credential-shaped text redacted), the secret names (never
   values), the Storage objects' paths, sizes and etags, the sequences and a structure fingerprint. It is data about the recovery, and the restore refuses a target whose structure differs.
6. **The off-project copy is one sealed file, encrypted to a public key whose private half is held off the project.** `sealForOffsite` has no plaintext path. Nothing is uploaded by this change.

## Consequences

* A restore into production remains manual and un-rehearsed, and the documents say so. The RTO for a lost project is hours of attended work, dominated by credentials at third parties, and has no figure at all
  until an off-project copy exists.
* The nightly backup now reads each table in keyset pages and writes the manifest with per-object checksums and per-table content fingerprints; the stored objects keep their shape, so `backup:rehearse` and every
  archive already stored are unaffected. The handler change reaches production only with a worker deploy; migration 1026 reaches it only by being applied.
* The chore path for capacity works with the deployed worker once 1026 is applied; the notice path needs the worker that carries `capacity-watch`.

## Not decided here

How long the audit ledgers are kept in the live database; whether to pay for a larger tier; which free store holds the off-project copy; whether and when a production restore flag is added.
