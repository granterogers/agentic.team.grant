# Hermes: reconciliation with `main` and the Unified Activity Ledger (11 October 2026)

Nothing here was merged, deployed or applied anywhere. Both trials ran in disposable git worktrees outside the repository
(`git worktree add --detach … origin/main`, merged in the worktree only, then deleted). The ledger branch was not modified. Every
compatibility fix found is a commit on `feature/hermes-agent-integration`, where it belongs.

| Tree | Built from | Result |
|---|---|---|
| **A: main + Hermes** | `origin/main` `5fa1fbdc` + this branch | 2 textual conflicts, 1 real incompatibility (fixed on this branch). All gates green. |
| **B: main + ledger + Hermes** | A's base + `origin/feature/unified-activity-ledger` `96a7dec4`, then this branch | the ledger and `main` conflict in 2 files **by themselves**; adding Hermes conflicts in 3 more places, all keep-both; 1 real incompatibility (fixed on this branch). All gates green. |

Distances: this branch is 80 commits behind `main` and 15 ahead of the common ancestor `3caaebfe`; `main`'s migrations end at 1053, the ledger
holds 1060 to 1062, Hermes holds 1070 to 1078. ADRs: `main` ends at 0072, the ledger holds 0073, Hermes holds 0074. No number collides.

## 1. Conflicts and how each was resolved

| # | Where | Between | What | Resolution |
|---|---|---|---|---|
| 1 | `docs/adr/README.md` | main and Hermes | both append index rows after the same line | keep both (0070 to 0072, then 0074) |
| 2 | `web/studio/settings-ui.css` | main and Hermes | main appended a phone rule for segmented rows; Hermes appended the procedure card (`.st-skill*`) at the same end of the file | keep both, blank line between |
| 3 | `docs/adr/README.md` | main and the ledger | rows 0071, 0072 against 0073 | keep all three (this one is **not Hermes's**) |
| 4 | `scripts/verify/serve-studio.ts` | main and the ledger | both added the same `STUDIO_ROOT` switch with different comments | keep main's comment (**not Hermes's**) |
| 5 | `docs/adr/README.md` | tree B, adding Hermes | 0071 to 0073 against 0074 | keep all |
| 6 | `scripts/gate/critical.ts` | tree B, adding Hermes | the ledger left a comment where its proofs would go (they sit in the EXTENDED tier because critical was at its cap of 70); Hermes adds ten proofs | keep both; Hermes's registry test raises the cap to 80 and the combined tier is 78 |
| 7 | `web/studio/settings-ui.css` | tree B | as 2 | keep both |

Files the three branches all touch that **merged without a conflict**, and were checked after the merge: `package.json`, `scripts/gate/extended.ts`,
`scripts/gate/helpers.ts`, `src/jobs/worker.ts` (Hermes changes `dequeue`; the ledger records activity), `supabase/functions/hq-api/index.ts`,
`web/studio/app.js`, `docs/multi-user/ownership-manifest.json`, `docs/testing/production-access.json`.

## 2. Incompatibilities that only running the combined tree could show (both fixed on this branch)

1. **Type scale (tree A).** `main`'s `tests/web/type-scale.test.ts` refuses a half-pixel text size; Hermes's procedure card used `13.5px` in two rules. Whole-pixel sizes now
   (commit "Settings procedure text uses whole-pixel sizes"). `main` has no equivalent on this branch, so only the trial could find it.
2. **`engine-runs` H5 (tree B).** The check listed every table with "activity" or "ledger" in its name and demanded the engine's three; with the ledger present its own
   `activity_events`, `activity_event_types` and `activity_write_failures` matched. It now asserts the property: the engine tables are exactly three, and any other table with those
   words belongs to the ledger (commit "engine-runs H5 holds on a tree that also has the activity ledger"). Hermes created no ledger table; the check says so on either tree.

## 3. Claim gate and fair-share dequeue

`app.dequeue_job` has been rewritten before: `main` carries 1044 (fair share per office) and the unapplied efficiency 1030 rewrites it again. Hermes 1078 splits the body into
`app.dequeue_job_core` (with `p_can_engine`) and leaves `app.dequeue_job` as a five-argument wrapper. Neither the ledger nor `main` redefines it after 1044, so tree A and B hold one
chain. `tests/migrations/dequeue-redefinition.test.ts` fails any later full-body replacement of `dequeue_job` that would remove the gate (and `scripts/isolated/dequeue-reconciled.ts` proves
efficiency 1030 applied to the core is what a reconciled tree looks like). Whoever applies 1030 must apply it to the core: the header of
`docs/audit/deferred-migrations/dequeue_job-efficiency-1030-reconciled-with-1044.sql` says so.

## 4. Results on the combined trees

| Check | A: main + Hermes | B: main + ledger + Hermes |
|---|---|---|
| `tsc --noEmit` | exit 0 | exit 0 |
| `biome ci . --diagnostic-level=error` | exit 0 | exit 0 |
| `check:migrations` | exit 0, 823 migrations (814 recorded applied) | exit 0, 826 migrations |
| `check:proofs` (registry) | sound | sound |
| `npm test` | 7,157 passed, 1 failed on first run (type scale, fixed), then green | **465 files, 7,294 tests passed, 0 failed** |
| `verify:critical` (candidate rebuilt) | **78/78, 4,150 assertions** | 77/78 on first run (`engine-runs` H5, fixed), then **78/78, 4,150 assertions** |
| `verify:extended` | **76/76, 1,833 assertions** | **87/87, 2,176 assertions** (includes the ledger's own proofs and `engine-ledger` against the ledger's real door) |
| `engine-ui-browser`, `engine-skill-card-browser` (real Chromium, candidate clone) | not run on A | both "all checks passed" on B |

The candidate for B was built from `post` plus 1060, 1061, 1062, 1073 to 1078 and carries both chains. These are replica results; nothing was run against production.

## 5. Recommended merge order

1. **Decide the ledger first.** It does not depend on Hermes; merging it into `main` needs conflicts 3 and 4 resolved as above (both trivial) and its own release plan
   (`docs/activity-ledger/RELEASE-READINESS.md`). Until it is merged and its migrations applied, Hermes's ledger calls find no door and are written on the run as a note (never a failure).
2. **Then Hermes**, after merging `main` into this branch (resolve conflicts 1, 2, 5, 6, 7 by keeping both sides) and re-running `npm test`, `verify:critical`, `verify:extended`.
   The migrations apply in file order with no number to change: 1060 to 1062 (ledger), 1070 to 1078 (Hermes). Re-read `app.schema_migrations` before applying anything; other
   workstreams have used 1023 to 1035 and have a pending efficiency change to `dequeue_job` (section 3).
3. If **Hermes goes first** nothing breaks: 1076's ledger calls are guarded by the door's existence, and the ledger arrives later with its own flags off. The only cost is that the
   `engine-ledger` proof (extended tier) cannot run until the ledger is present.
4. In both orders: deploy the worker (it must call the claim gate) **before** any Hermes flag is set, the gateway and MCP function next, the page last (`RELEASE-READINESS.md` section 9).

## 6. Not reconciled, on purpose

Production was not read, so the live ledger migrations table and flag values were not checked; the seven production-read checks stay in `RELEASE-READINESS.md` section 7.
