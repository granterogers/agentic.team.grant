# Migration plan for PR #465 (14 October 2026)

Nothing here has been applied to production. This is the plan the owner approves before any production write.

## What production has, and what it does not

- `docs/ops/deployment-state.json` records **814 migrations applied**, the highest being `1053_a_public_key_reaches_no_view`.
  That record is dated 9 October 2026 and says it is **not a live reading**. A live reading is the first step below.
- `migrations/applied.json` (the ledger in this repository) holds the same 814 names and their checksums.
- `npm run check:deployment-state` (run this session): **6 committed files are not in the ledger**, listed below.
- `npm run check:migrations` (run this session): 820 migration files, 814 recorded as applied, the one recorded
  sequence collision (0584) both applied and already accepted.

## The six pending migrations, in the only order that works

| # | File | From | Depends on | Why it is in this order |
|---|---|---|---|---|
| 1 | `1060_one_ledger_of_activity_records_what_no_other_table_holds.sql` | main | nothing pending | the activity taxonomy, redactor and writers |
| 2 | `1061_the_activity_read_model_reads_each_table_that_owns_the_state.sql` | main | 1060 | the read model reads the 1060 ledger |
| 3 | `1062_a_held_back_over_budget_agent_is_recorded_in_the_activity_ledger.sql` | main | 1060 (taxonomy) | records into the 1060 ledger |
| 4 | `1070_a_project_can_be_exported_as_contacts_events_and_tasks.sql` | this PR | nothing pending | creates `app.project_records` and its public wrapper |
| 5 | `1071_a_project_can_be_restored_from_its_archive.sql` | this PR | nothing pending | creates the `project_restores` table and `app.project_restore` |
| 6 | `1072_archives_carry_each_documents_original_file.sql` | this PR | **1071** | replaces `app.project_restore` (created by 1071) and `app.project_export` |

The runner orders by file name and applies in that order. 1072 cannot be applied before 1071: it rewrites a function 1071
creates. Migrations 1060 to 1062 are main's and are pending on production too; they are part of the same release.

Migration **1071 was changed this session** (a write-once trigger on `project_restores.office_id`). It was never applied, so
the change is part of the file that will be applied. Once applied, the file is immutable (`check:migrations` enforces it).

## Before the first production write (owner approval needed)

1. Confirm a **live** production reading of `app.schema_migrations`: the name and count of every applied migration. Expect 814
   and the highest `1053`. If the live state differs, stop and reconcile this plan first. A read is allowed only with
   `ALLOW_PRODUCTION_CHECKS=1`, which the owner authorises for that read.
2. Take or confirm a current backup of the production database (the owner's Supabase backup, not a repository artifact).
3. Build the candidate from a clean tree at a pushed commit (ADR-0067 provenance). The migrate run refuses an unpushed or
   dirty tree. The applied set must equal the six files above and no others.
4. Check the replay of all 820 files on an empty replica matches the schema of the live migrated replica (the gate's
   `replay-parity` proof does this, and it is green on this branch).

## The apply step (owner approval, named write)

`npm run migrate` applies every pending file in order from a clean tree. It needs `ALLOW_PRODUCTION_WRITES=1` for the named
write only. Do not use `migrate:one` for this set: it applies one file and skips the ordering check.

Expected result: 820 files, 820 recorded as applied, and `npm run check:deployment-state` reports nothing pending.

## Reversal

None of the six is destructive. 1060 to 1062 add the activity ledger and its writers; 1070 and 1071 add functions and one
table; 1072 replaces two functions. To reverse after a bad release: roll the gateway back to the revision before PR #465
first, so nothing calls the new functions, then drop the new functions and the `project_restores` table in a separate,
reviewed migration. Do not edit an applied file.

## Deploy order after the migration (each one needs its own approval)

1. `hq-api` (the gateway: the set endpoints, the restore check, the object-store helpers). Its file list is
   `scripts/deploy/lib/hq-api-files.ts`, and the closure test enforces it.
2. The page (`web/studio`). It calls the set endpoints. Deployed before the gateway, a set download would fail on the old
   gateway, which does not know `set=`.
3. The worker only if main's worker changes are in the release (1060 to 1062 come with main's worker code).

Each deploy runs its own probe (`npm run deploy:hq`, and the others) and fails when the probe fails.

## What this plan does not do

It does not apply anything, change production settings, merge this branch into main, or deploy. PR #465 stays a draft until
the owner authorises it.
