# Restore runbook

For anyone picking this up cold, including a fresh Claude session with no memory of earlier work. Read this, then
`CLAUDE.md`, then `docs/ops/deployment-state.json`, before touching production.

## 0. Ground rules

- Production is read-only unless a person has turned it on. Reads need `ALLOW_PRODUCTION_CHECKS=1`. Anything that writes
  needs `ALLOW_PRODUCTION_WRITES=1` as well. Never set either flag to make a check pass. Set them only for the operation
  the owner has named, and never reuse one approval for the next operation.
- Deleting a backup needs three things: the `--attended` flag, both production flags, and the owner's approval of the
  exact list the dry run prints. A dry run is not approval.
- Secrets live in the Supabase Vault. Never paste a token, key or password into chat, a file or a commit. Names only.
- A deploy or migration needs a clean tree and a pushed commit. The scripts check this and refuse otherwise.

## 1. What exists, and what has been proven

There are three restore paths. They are not equal.

| Path | What it restores | Proven | How |
|---|---|---|---|
| **A. One project from its archive (ZIP)** | One project as a NEW project, never over an existing one | Round trip on a local replica, 10 of 10 checks (`scripts/isolated/project-roundtrip.ts`, 15 Oct 2026). Not yet on a real project. | Team HQ, project menu, Restore from archive (the gateway calls `app.project_restore`). |
| **B. Rehearsal of the newest nightly backup** | Rows of every table, loaded into a scratch schema, then dropped | 8 of 8 checks, 15 Oct 2026: 362,468 rows, 131 tables, every count matched. | `npm run backup:rehearse` (below). |
| **C. Typed restore into a built database** | Rows back into the real tables, with real column types, constraints, triggers and foreign keys, on a database built from the repository's migrations | **Replica-proven, 16 October 2026:** `ISOLATED_POST=post bash scripts/isolated/backup-restore-typed.sh`, 59 of 59 checks, 0 failures. Restores 121,015 rows into 167 tables in about 6 seconds. Includes controls that must turn it red. | `src/backup/restore.ts`, section 4. |
| **D. Full disaster recovery into a new Supabase project** | Path C, run against a new hosted project, plus Storage files | **Not done.** Path C has only run against a local replica. A hosted project, and Storage files, are unverified. | Section 4. |

What path B does NOT prove: the schema. It loads every column as text into a scratch schema. It shows the data
survives a round trip. It does not show that the rows fit the real column types, which path C would need to show.

What none of the three proves: restoring the files in Storage (documents and uploads). The rehearsal covers the database
tables only. Storage restore is unverified.

## 2. Check the backups (read only)

    ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npm run backup:prune

Without `--attended` this is a dry run. It reads and verifies every backup and prints a plan: which to keep and which to
remove, and which are unknown (incomplete). It deletes nothing. The two production flags are needed only because the
script imports the write gate, which refuses even a dry run without them.

It takes most of the ten-minute foreground limit. The verifier runs four backups at a time; if it times out, nothing has
changed.

## 3. Rehearse a restore (writes one scratch schema, then drops it)

    ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 REHEARSE_BATCH_BYTES=3000000 npm run backup:rehearse

- The script creates `restore_rehearsal`, loads the newest backup into it, compares counts, and drops the schema. It
  never touches an archive. Each run is recorded as a `backup.rehearsed` event in production.
- `REHEARSE_BATCH_BYTES=3000000` is the value that completed (7 to 8 minutes, 8 of 8). The default (400000) is slower
  but also valid. Above about 3 MB the API refuses some batches; the script halves any refused batch and retries, so a
  refusal is no longer a failure.
- If it times out, check that `restore_rehearsal` is gone before re-running:

      ALLOW_PRODUCTION_CHECKS=1 npm run q -- "select count(*) from information_schema.schemata where schema_name = 'restore_rehearsal'"

  If it's there, the rehearsal left it behind. It holds copies only. Dropping it is the only cleanup the rehearsal needs.

## 4. Full disaster recovery into a fresh Supabase project (not yet done)

This is the path to use if the production database is lost. Work on a NEW project, never on the live one.

What is already proven: the typed restore (`src/backup/restore.ts`) rebuilds the database from the repository's migrations
and loads the archived rows into the real tables. Replica proof, 16 October 2026: 59 of 59 checks, including
121,015 rows in 167 tables and controls that must turn it red. Reproduce it with:

    ISOLATED_POST=post bash scripts/isolated/backup-restore-typed.sh

What is NOT proven: running the same restore against a hosted Supabase project, and restoring Storage files.

1. Create a new Supabase project. Note its reference. Keep its credentials in the Vault, not in the repository. Creating
   it is an owner decision.
2. Build the schema from the repository against the new project, with the production flags NOT set (a new project is not
   production). The migration ledger must end at the highest number in `migrations/`.
3. Run the typed restore against it. It refuses any target that is not a marked local replica, so this step needs the
   refusal relaxed for the new project. That is a deliberate change with its own review, not a flag to set in passing
   (see the note at the top of `src/backup/restore.ts`).
4. Run `verify:restore` against the restored database. It re-runs the append-only enforcement probes, which must fail on
   the restored database exactly as they do on the original.
5. Restore Storage files separately, from the Storage bucket's objects. Not yet tested. The replica proof used a storage
   emulator, so it says nothing about real Storage.

## 5. Retention

The owner's policy (docs/ops/backup-retention-policy.md) keeps the newest seven days and the newest backup from each of the
previous eight ISO weeks. The planner is `src/backup/retention.ts`; the command is `backup:prune` (section 2). A deletion
is `npm run backup:prune -- --attended` with both production flags, after the owner approves the exact list the dry run
printed. Deleted backups cannot be recovered.

## 6. If you are a fresh session

1. Read CLAUDE.md, then this file, then `docs/ops/deployment-state.json`.
2. Run section 2 (dry run). Compare what it reports with the last recorded run in the morning report
   (`docs/release/MORNING-REPORT-2026-10-15.md`).
3. Run section 3 if the last rehearsal is more than a week old.
4. Do not delete anything. Do not set a production flag except for the operation the owner has named in this session.
5. Record what you ran, the counts, and any failure, in a file in `docs/ops/`.
