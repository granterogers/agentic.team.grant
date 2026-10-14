# Feature batch status: auth, storage, portability and UI (14 October 2026)

**Branch:** `feature/auth-storage-portability-ui`. **PR:** #465, draft, not merged, not deployed.
**Issues:** #467 (Google sign-in), #468 (storage audit), #469 (storage abstraction and migration), #470 (standard exports),
#471 (archive and restore), #472 (module appearance), #473 (Projects navigation).

**Overall: PARTIAL.** The batch is not production-ready. Several requirements can only be finished by the owner, and some
are implemented only as tested policy rather than wired into the product. Each gap is listed below.

This record separates what was checked in this session from what was carried over. "Carried over" means it was verified in
an earlier session and not re-checked here.

## Requirement status

| Feature | Implementation | Tests | UI verified | Outstanding |
|---|---|---|---|---|
| Google authentication (#467) | Policy only, flag off: redirect allowlist, signed and expiring state, callback outcomes, linking that never links on email alone (`src/auth/google-policy.ts`) | 26 fixture tests pass | No. No button, no callback endpoint, no Supabase provider | Owner creates the Google OAuth client and configures Supabase Auth (steps below). Then wire the callback and the flagged button, and test them against the real provider |
| Email/password authentication | Present, closed until switched on (commit `159411c`, carried over) | Browser journeys carried over from an earlier session | Carried over only | Re-verify in a browser against live Auth, which is owner-gated |
| Storage comparison and audit (#468) | Comparison from official pages, dated 14 October 2026 (`docs/storage/PROVIDER-COMPARISON-2026-10-14.md`), with a recommendation | Not applicable | Not applicable | Production measurement is blocked on read-only authorisation (below). Database and object growth are therefore not measured |
| Storage abstraction and migration (#469) | Interface with Supabase and in-memory implementations, read included; policy (size, type and magic bytes, SHA-256, link lifetime, read rule); reconciliation; copy-verify-switch migration | 51 storage tests, including an injected hash mismatch, a tampered source, a target conflict, a refusing target, and a re-run that must not delete data | Not applicable | Not wired into the live upload path or the gateway's signed-URL issuance. The read rule is a pure function, not yet enforced by the gateway. No production migration |
| Standard-format exports (#470) | vCard, iCalendar, CSV and JSON serialisers; gateway route; Settings buttons (commits `e908b0d`, `b07be56`) | Serialiser and route tests; replica proof `tests/migrations/project-records.replica.sql` passes today, including cross-office isolation | Carried over. Settings buttons not re-driven in a browser this session | Browser check at 390 × 844 and desktop of the buttons and a downloaded file. Progress and failure messages not re-verified |
| Project ZIP backup and restore (#471) | ZIP with manifest and SHA-256; restore into a new project; idempotency key; office isolation | Archive and gateway tests (31); replica round trip `tests/migrations/project-restore.replica.sql` passes today, seven properties | Carried over (download and restore journey, commit `b944e93`) | The archive holds each document's extracted text and checksum, not the original binary files. #471 asks for the original files, so this is a real gap. Restore progress messages not re-verified in a browser |
| Module colours and appearance (#472) | Identity colour per module on the title, icon and border; neutral body; one identity table (`identity.js`) | `tests/web/module-identity.test.ts` (7); titles measured at 4.68 to 1 light and 9.89 to 1 dark (carried over) | Yes, this session: desktop and 390 × 844 phone, light and dark, inspected (`.out/ux-final/`) | `verify:arrangement` (drag, resize, saved layout) is refused by the production guard, so it has not run. `verify:layouts` fails on `main` already (below) |
| Projects navigation (#473) | One top-level PROJECTS item; desktop hover reveals the list and stays open while the pointer moves into it; keyboard Enter and Space toggle; phone tap toggles | Keyboard and hover checks carried over (`verify-hover.mjs`, commit `69c8a06`) | Yes, this session: desktop hover, phone open, current project highlighted on both, panel scrolls to its last items, rows 48 px | Empty-list and permission states not verified: the prototype always has projects, and a signed-in account with none is not reachable here. Phone default is open, not closed, which the brief's "tap expands" may not intend (decision below) |

## Verification evidence (this session)

- **Full unit suite** on the feature branch after the storage and auth changes: 465 files passed, 7,242 tests passed, 21
  skipped, 0 failed.
- **TypeScript:** 283 errors across the repository, the baseline from before this session. The new files add none.
- **Biome on the new TypeScript:** exit 0. The secrets scan: clean.
- **Replica round trips:** `project-restore.replica.sql` prints all seven properties and passes;
  `project-records.replica.sql` passes its cross-office assertions. Both run in a rollback on the local replica.
- **Failure injection:** the migration's rollback was broken on purpose and the migration tests went red. Restored.
- **UI captures:** `.out/ux-final/` holds desktop and phone captures of the project board in light and dark, the desktop
  hover menu, the phone menu before and after a tap, and the menu with a project open on both. I inspected each one.
  Page errors in the capture harness: 0.
- **Web lint, the "six extra warnings" question:** compared with `main` (now `0152fa09`) using the same scratch config.
  Errors are unchanged. The warnings differ for three reasons, none of them a defect in this feature's code:
  - Six `noFocusedTests` findings in `app.js` and three in `bc/stage.js` flag calls to a function named `fit()`. The rule
    reads it as a focused test. No test is focused.
  - One unused variable, `tray`, in `bc/shell.js`. The feature branch's copy does not call `tray()`; `main`'s copy does.
  - Nine fewer descending-specificity findings in `bc/refine.css`, because `main` changed that file.

  The gap between `main` and this branch is an integration matter. It is not a lint problem to fix here.

## Pre-existing failures, not caused by this batch

- **`verify:layouts` fails on `main`.** It requests `/classic/`, which maps to `web/studio/classic/`. That directory does
  not exist on `main`, so the suite can never open a project. Verified with `git ls-tree origin/main web/studio`.
- **`verify:arrangement` is refused by the production guard.** It reads the production database through the Management API.
  The guard's refusal is correct. The suite needs either an owner authorisation for a read, or a replica route.

## Security

- No existing vulnerability was found in the code this batch touches.
- **Designed in and tested:** no open redirect (allowlisted origins; protocol-relative, backslash and credential forms are
  refused); no login CSRF or replay (signed, expiring state); no account takeover through a shared email address (linking
  requires proof of the account, never a matching address); no cross-office or cross-project read (both must match); no
  unchecked content type (magic bytes must agree with the declared type and extension).
- **Found and fixed during this session:** the migration's rollback could delete a file that an earlier run had written
  correctly, when a re-run met an identical target. It now verifies and leaves such a file alone. Covered by a test.

## Integration with `main` and the parallel work

- **`main` moved** from `65bc7b0` to `0152fa09` during this session. It carries the Team HQ completion release and a
  version bump, and records a production deployment in `docs/ops/deployment-state.json`.
- **Overlapping files,** changed on both sides since the common base: `docs/ops/deployment-state.json`, `web/studio/app.js`,
  `web/studio/bc/miniatures.js`, `web/studio/bc/refine.css` and `web/studio/bc/shell.js`. The deployment record must keep
  `main`'s entries. Resolve the web files by taking `main`'s changes first, then re-applying this branch's changes on top.
- **Do not rebase** a pushed branch. Merge `main` into the feature branch, resolve the five files, then re-run the gates.
- **The UX branches** that the continuity work measured (`claude/team-hq-ux-overnight` and others) overlap these same web
  files. Their owner should sequence them with this batch. This branch does not touch them.

## Proposed integration sequence (for the owner to authorise)

1. Land whichever of the UX work and this batch the owner chooses first. Each is reviewed by its own pass.
2. Merge `main` into the feature branch. Resolve the five overlapping files as above.
3. Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run check:deployment-state`, `npm run check:secrets`, and the
   replica proofs against a fresh replica.
4. Apply migrations 1070 and 1071 to a staging project first, then to production, each with its own approval.
5. Deploy the gateway (`hq-api`) and the page only after the migrations are applied, because the new routes call the new
   functions.
6. Mark PR #465 ready for review, and merge only on the owner's explicit instruction.

## Production prerequisites (none is done)

- **Migrations 1070 and 1071** (`app.project_records`, `app.project_restore` and their public wrappers, and the
  `project_restores` table). Not applied anywhere except the local replica.
- **Gateway:** `hq-api` must be deployed with the export and restore routes. The deploy probes must pass.
- **Page:** `web/studio` must be deployed, from the live bytes of `main` plus this branch's diff, as the CLAUDE.md traps describe.
- **Google sign-in, owner steps (not done, and not attempted):**
  1. In Google Cloud Console, create an OAuth 2.0 client of type Web application.
  2. Add one authorised redirect URI per environment: the Supabase callback for production and the one for preview, each
     `https://<project-ref>.supabase.co/auth/v1/callback`.
  3. In Supabase, open Authentication, then Providers, enable Google, and enter the client ID and secret. Store the secret in
     the Supabase Vault, not in chat or in the repository.
  4. Keep preview and production as separate clients. Leave the feature flag `auth.google_sign_in` off until the owner says
     otherwise.

## Rollback plan

- **Before any deploy:** nothing is deployed, so rollback is reverting commits on the branch with a new commit. The branch is never force-pushed.
- **After migrations 1070 and 1071 are applied:** drop the public wrappers, then `app.project_restore` and
  `app.project_records`, then the `project_restores` table, in that order. Each drop names the exact signature from
  `pg_get_function_identity_arguments`. Dropping a table holding restores would destroy the idempotency record, so check
  for rows first and keep them if any exist.
- **After the gateway or page deploy:** redeploy the previous version recorded in `docs/ops/deployment-state.json`. Do not
  roll back the database for a page fault.
- **Storage:** the copy-verify-switch design keeps the old provider complete. Switching back is setting the pointer to
  `from`. Nothing is deleted from the source.

## Owner actions required

1. **Google sign-in (#467):** the steps above. Nothing here can be done without them.
2. **Storage audit (#468):** authorise read-only production measurement through the existing guard, or accept the estimate
   based on the official pages.
3. **Phone Projects default (#473):** the menu opens with the list shown and a tap collapses it. The brief's wording
   ("tap expands") may mean the list should open closed. Decide which.
4. **Integration sequence and merge:** authorise the sequence above, and the merge, separately.
5. **Production migrations, gateway deploy and page deploy:** each needs its own authorisation.
6. **Replica or production read for `verify:arrangement`:** decide how the drag and layout checks should run without production
   access.

## Remaining work that is independent and not yet done

- Wire the signed-URL issuance through the gateway, with a server-side project-permission check using `canReadObject`.
- Use the migration in a real upload path, behind a flag, against the memory store and the replica.
- Include original document files in the archive, and restore them through the object store.
- Browser checks of the Settings export buttons, the download, and restore progress and failure messages, at 390 × 844 and
  desktop.
- The empty-list and permission states of the Projects menu, once a signed-in fixture account with no projects exists.
