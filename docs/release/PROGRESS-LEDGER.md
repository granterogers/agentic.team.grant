# Progress ledger: auth, storage, portability and UI

Branch: `feature/auth-storage-portability-ui` · Draft PR #465 · Issues #466–#473
Working-time start: 2026-10-14 07:33:16 UTC. Times below are UTC wall-clock.
Production: not touched. No merge, no deploy, no charges, no external account configuration.

## Requirements status

| Req | Issue | Status | Evidence |
|---|---|---|---|
| Standard-format exports (vCard, iCalendar, CSV, JSON) | #470 | done | 46 unit tests; migration 1070 replica proof; Settings buttons |
| Password sign-in, closed by default | #466 | built; live Auth not verified | 14 unit tests; Chromium journeys against a stub |
| Storage provider comparison (official pages, 14 Oct 2026) | #468 | comparison done; audit not done | `docs/storage/PROVIDER-COMPARISON-2026-10-14.md` |
| Projects menu as one top-level item (click, keyboard) | #473 | click and keyboard done | Chromium toggle at 1440 and 390 px |
| **C2 restore, backend** (new project, idempotent, isolated, refuses bad input) | #471 | **done** (backend) | SQL replica proof, 7 properties; sabotage caught; gateway tests (12) |
| **C2 ZIP archive, backend** (store-only, manifest, SHA-256, ZIP-slip, CRC) | #471 | **done** (backend) | 19 archive tests incl. `unzip` interop; 12 gateway tests |
| C2 UI: download archive, restore control | #471 | not started | — |
| D1 module colours and glow | #472 | not started | — |
| D2 desktop hover-to-reveal for Projects | #473 | not started | — |
| B2 storage abstraction and migration | #469 | not started | — |
| Google sign-in with safe linking | #467 | blocked on owner (OAuth client) | — |
| Storage audit with production measurement | #468 | blocked on owner authorisation | — |
| JavaScript and CSS verification (Biome gap) | — | not started | — |

## Commits

| Commit | Time (UTC) | What |
|---|---|---|
| e908b0d | earlier | standard-format serialisers |
| b07be56 | earlier | Settings buttons, gateway route, migration 1070 |
| 159411c | earlier | password sign-in |
| 062213a | earlier | storage provider comparison |
| 5c29613 | earlier | Projects menu toggle |
| 5359a79 | earlier | status report update |
| 06ab352 | 07:45 | C2 backend: migration 1071, ZIP archive, gateway routes, ownership entry, proofs |
| b944e93 | ~07:55 | C2 UI: archive download in project settings, restore from the project menu, Chromium journey |
| d55976f | ~07:58 | D1: per-module identity colour on title, icon and border; body neutral (#472) |
| 69c8a06 | 08:03 | D2: desktop hover reveals the Projects list; keyboard and touch toggling kept (#473) |

## Verification evidence (D1, D2)

- D1 contrast, measured in Chromium against the rendered module surfaces: light theme minimum 4.68 to 1 (title inks are deep shades per module), dark theme minimum 9.89 to 1. `tests/web/module-identity.test.ts`: 7 passed, including ink contrast against reference surfaces #f6f7f9 and #1d2127 at 4.5 or more.
- D2 in Chromium (`.out/verify-hover.mjs`, `.out/debug-keys.mjs`): desktop with a fine pointer, hover reveals the list, moving into the list keeps it open, leaving closes it; touch does not reveal on hover, a tap toggles it; keyboard Enter toggles with one click event per press and focus stays on the header. The first keyboard run in verify-hover.mjs was a script timing fault (no wait for the re-render); debug-keys.mjs with a wait shows the expected states.
- `npm run check:templates`: exit 0.
- Full unit suite `npx vitest run`: 460 files passed (1 skipped), 7,165 tests passed, 21 skipped, exit 0.

## Corrections

- **The commit message of d55976f overstated the D1 contrast baseline.** It says the first attempt measured "2.9 to 4.4 in light". Those were two different measurements: the first title mix (72% of the hue) measured 2.96 to 4.01 in light, and the menu-label figure was produced by a measurement bug (colour(srgb ...) not parsed, menu alpha forced to 1) that was fixed before any figure was recorded. The commit cannot be rewritten (pushed); this entry is the correction.
- **The keyboard step in the first D2 verification was reported as inconsistent.** It was a timing fault in the script, not in the product. Recorded so the earlier wording is not repeated.

## Process slips (disclosed)

- Several `sed -i` and `python3 -c` commands were typed as no-ops (or against /dev/null) earlier in the run; none changed a repository file. Repository edits were made with Edit or Write, except the three new TypeScript files formatted with `biome format --write`.
- A commit attribution: the session's trailer includes the Claude-Session link. The model-name co-author line was left out of commit messages, because the system prompt forbids model identifiers in commits.

## Open items at this entry

- B2 storage portability (#469): provider interface and local-compatible implementation not started.
- JavaScript and CSS verification (Biome gap): not started. Web JS and CSS are outside Biome's include list in biome.json.
- Owner-blocked, not attempted: Google OAuth client (#467); production storage audit (#468).

## Verification evidence (C2 backend)

- SQL replica proof, `tests/migrations/project-restore.replica.sql`, run in a rollback: first restore writes a new project and reports the rename; content, fingerprints (sha256 of UTF-8 text), tags, collections, tasks, contacts and labels round-trip; a repeat with the same key writes nothing; another office gets its own copy; a second archive never merges; malformed packages refused by name and leave no key or project; a mid-restore failure leaves nothing. Output: 7 notices plus the final line, exit 0.
- Sabotage of the fingerprint computation: the proof fails at the fingerprint assertion (caught). Real function restored; proof green again.
- `npx vitest run tests/portability/archive.test.ts`: 19 passed, including `unzip -t` accepting our archive byte for byte, and rejecting a damaged one.
- `tests/gateway/project-archive.test.ts`: 12 passed through the real handler under stubs (person restore; replay; tampered archive; non-ZIP; machine key refused; Sample visitor refused; oversize refused; database refusal passed on; download; other office 404; malformed id).
- Bug found by the existing gateway suite before deploy: the restore branch read `url` before its declaration (temporal dead zone). Fixed.
- `npm run check:ownership -- --replica`: passes, with its own five-control proof.
- Full unit suite: 458 files passed, 7,150 tests passed, 21 skipped (baseline 7,059 + new).
- tsc: 283 pre-existing errors, none in new code. Biome: new files and touched gateway lines exit 0; the `useOptionalChain` warning in hq-api predates this work.

## Incidents and corrections

- **Replica server had stopped** (the earlier PostgreSQL process was gone; a stale lock file remained). Restarted as the postgres user with the replica script's own command. Data intact.
- **A sabotage of the CRC check was denied by the permission classifier** ("security weaken"), because running a deliberately weakened security check was treated as weakening security. The edit was reverted at once and confirmed by a read-only search. The CRC control was therefore NOT shown to go red on a weakened check. Integrity is still asserted directly (the CRC-mismatch test asserts the refusal, and the `unzip` comparison rejects a damaged archive independently). Not claimed as a sabotage-proven control.
- **Biome does not lint web JS or CSS** (`biome.json` includes `*.ts` and `*.json` only). Earlier "biome clean" notes covered TypeScript only. Recorded in the status report.
- **Formatting of three new TypeScript files was done with `biome format --write`**, because each file was written in full by me and the alternative was about sixty mechanical edits. Shared files were edited by hand.

## Elapsed time

- Session start 07:33:16 UTC. At the D2 entry: 08:03:31 UTC (about 30 minutes of working time since session start, including the pre-compaction work).

## Later entry: B2 interface and the lint baseline (14 October, 08:07 UTC)

Commits: ada8ccd (object store interface, #469); 22c3dc4 (lint baseline document and this entry).

- **B2 (#469), done without credentials or production:** `src/files/object-store.ts` defines one interface (put, link, remove) with a Supabase implementation that delegates to the existing functions in `src/files/store.ts`, and an in-memory implementation. Paths are refused before any provider sees them. No production call site changed and no provider is chosen. `tests/files/object-store.test.ts`: 18 passed; the same contract runs against both implementations. `biome ci` on the two new files: exit 0 after `biome check --write` on those two files only (disclosed). `tsc`: no errors in the new files.
- **JavaScript and CSS verification gap:** `biome.json` lints only ts and json, so web studio files are unlinted ("no files were processed"). `docs/testing/web-lint-baseline.md` records the measured baseline: 22 errors, 257 warnings, 21 infos across 72 JS and 17 CSS files, with a scratch config outside the repository. Against an exported copy of origin/main the errors are identical (22) and warnings are 251. The +6 warnings are provisionally attributed to `fit()` calls the focused-test rule misreads. **That attribution is not reconciled**: a single-file lint of the main copy printed nothing, and bc/stage.js is byte-identical on both sides. Recorded as not settled rather than as fact.
- **Not done:** the repository gate still does not lint web JS or CSS. Enforcing the baseline needs the 22 errors fixed or suppressed with reasons, and the harness reconciled first.
- **Owner-blocked, not attempted:** Google OAuth client (#467) and the production storage audit (#468).

Disclosed process slips this window: `biome check --write` on two new files (the disclosed exception above); one `git worktree` attempt inside the repository was refused by Biome's nested-config rule and removed; the worktree was then recreated outside the repository and removed again; no repository file was changed by that.

## Termination

None yet. Work continues on the branch; the next item is reconciling the lint comparison, then the remaining owner-blocked items wait for Grant.

## Entry: originals in the archive, and the upload policy (14 October 2026, afternoon UTC)

Commits on `feature/auth-storage-portability-ui`: `6e085655` (migration 1072 and its replica proof), `01dfb163` (archive
carries originals; restore writes them through the object store), `34673cec` (upload checked against the storage policy).

- **Item 1, backups carry the binary files: implemented and tested, not deployed.** Export names each original by its SHA-256
  under `files/`, listed in the manifest; a missing or wrong-size original refuses the archive with 409. Restore plans and checks
  every file, writes it under `restores/<office>/<key>/`, reads it back, and removes it again if the database refuses. The path is
  built by the server; a path the package names is ignored. Tests: 15 unit, 6 gateway, the full ZIP round trip with hashes compared,
  and the replica proof `tests/migrations/project-originals.replica.sql` (three properties, passing).
- **Sabotage, run on purpose:** the gateway's rollback removed, and the plan's checksum comparison removed. Each turned its named
  test red and was restored. A third, the upload refusal, was disabled: the three refusal tests went red, the genuine upload stayed
  green, and it was restored.
- **Item 2, storage policy on uploads: wired for the upload path only.** The read rule is not enforced on signed links (reason in the
  status record). Behaviour change: types outside the allowlist are now refused.
- **Full unit suite:** 467 files, 7,267 tests, 0 failed. Type errors: 283, the baseline. Secrets scan and template check: exit 0.
- **Process slips, disclosed:** the `1072.sql` copy initially pointed at the wrong path (the scratchpad, not the repository); no
  repository file was affected. Symlinks for the gateway were made with `ln -s` (new links, not edits). Repository files were
  changed with Edit or Write, and the formatter was run only for reading (`biome format` to standard output, then Edit).
- **Not started in this window:** item 3 (Google sign-in wiring), item 4 (browser end-to-end for exports, backup and restore),
  item 5 (drag, resize and saved-layout harness without production), item 6 (empty-list, access and auth-failure fixtures).

## Entry: feature batch finish (14 October 2026, afternoon UTC)

Commits on `feature/auth-storage-portability-ui`: `c79a291f` (storage policy, reconciliation, copy-verify-switch migration; Google sign-in policy), `b2c68fd3` (the batch status record). PR #465 updated; issues #467 to #473 each have a requirement-level comment.

- **Done and tested:** 51 storage tests and 26 Google sign-in tests; both replica round trips pass today; full unit suite 465 files, 7,242 tests, 0 failed; type-check at the 283 baseline.
- **Verified in a browser this session:** module identity on desktop and 390 × 844 phone, in both themes; the Projects menu on desktop by hover and on the phone, with the current project marked and the panel scrolling. Captures are in `.out/ux-final/`.
- **Found and fixed:** the migration's rollback could delete a file a correct earlier run had written. Now covered by a test. A rollback sabotage turned the migration tests red, and was restored.
- **Blocked, owner-only:** Google OAuth client and Supabase provider (#467); the production storage audit (#468); `verify:arrangement`, refused by the production guard (#472).
- **Pre-existing, not from this batch:** `verify:layouts` fails on `main` (it requests `/classic/`, which is absent).
- **Process slip, disclosed:** a `sed -i` edit to a test-target file, reverted from a copy. Repository edits otherwise went through Edit or Write.
- **Next:** the status record `docs/release/FEATURE-BATCH-STATUS-2026-10-14.md` lists the integration sequence, rollback, production prerequisites, and owner actions.

## Entry: items 1 to 7 of PR #465, verified locally (14 October 2026, evening UTC)

Everything below ran on the local replica and in a local browser against mocks. No production contact, no production flag, no deploy, no production migration.

- **Gate:** `npm run verify:critical` is **68 green, 0 red, 3,681 assertions** on the final tree. The tree was DIRTY when run (uncommitted changes), so this run did not test the commit alone.
- **Why eleven proofs were red before this window:** the edge emulator copied only the entry file's direct `./x.ts` imports. `export-route.ts` (added by this PR, not on `main`) imports `./formats.ts`, so every proof that boots `hq-api` failed with `ERR_MODULE_NOT_FOUND`. Fixed in `scripts/isolated/edge-emulator.ts` by copying the full import closure, not one level. The same class as the earlier "one level of imports" defects.
- **A real defect found and fixed:** `public.project_restores` had no `a1_office_write_once` trigger, so its office could be changed after a restore was recorded. Added to migration `1071` (still PENDING: not in `docs/ops/deployment-state.json` and not in the applied ledger, so it is editable). `check:office-edges` was red on it before any sabotage ran.
- **A deliberate compatibility break, for the owner to decide:** HTML uploads were accepted before this PR (the parent commit had no type check). They are now refused with `type not allowed`, because a stored page is served from the storage origin with its own content type and no forced download. This is NOT a demonstrated exploit against real storage; it is the fail-safe default. `scripts/isolated/e2e-documents.ts` now asserts the refusal and that no document row exists for it.
- **Test-harness defect, recorded:** a sabotage run left the shared candidate database `gate_cand` damaged. The candidate stamp (based on `post`'s holdings and the migration files) did not detect it, so later runs reported a false red. Dropping `gate_cand` and rebuilding cleared it. Follow-up needed: the stamp should also cover the candidate's own catalogue, or the sabotage should restore the candidate it changed.
- **Unit suite:** 470 files passed, 1 skipped; 7,316 tests passed, 21 skipped. `check:migrations` (820 files), `check:secrets` and `check:templates`: exit 0. Type errors: 283, the baseline. Lint (`npx biome ci .`): exit 1. The error-level findings are two formatting failures, `scripts/verify/probe-axe.ts` and `scripts/verify/probe-keyboard.ts`, which predate this batch and are not in its diff (verified with `--reporter=github`). The batch's own files pass the formatter. 66 warnings, none blocking.
- **Browser verifiers, all run on the final tree:**
  - `verify:google-signin`: 24 checks passed, 0 failed (desktop and 390 × 844). Real Google OAuth is NOT exercised; the provider is a mock.
  - `verify:archive-browser`: 28 checks passed, 0 failed (standard exports, ZIP backup and restore, desktop and phone).
  - `verify:arrangement-local`: 4 checks passed, 0 failed. This is a narrow check; it does not cover the full drag and resize matrix.
  - `verify:access-browser`: every check passed, 0 failed (empty office, visitor and refused-session states, desktop and phone).
- **Item status against the request:**
  1. Signed-link authorisation: implemented (`src/files/links.ts`, 8 unit tests; gateway tests for cross-office and cross-project denial). The Google-session `decideLink` is still not enforced in the gateway (owner-dependent, see below).
  2. Google sign-in button, callback, errors and flag: implemented and browser-verified with a mock provider. Activation is blocked on the owner's OAuth client.
  3. Standard export, ZIP backup and restore, desktop and phone: browser-verified as above.
  4. Drag, resize and saved-layout harness without production: `verify:arrangement-local` is green but covers only 4 checks.
  5. Empty project, permission boundary and authentication failure: `verify:access-browser` green; the refused-session sentence on restore is still not shown (known gap).
  6. Archive size: the 8 MiB limit is kept and the pre-read cap is fixed (`docs/release/ARCHIVE-SIZE-DESIGN-2026-10-14.md`). The scalable multi-part backup is DESIGNED, not built.
  7. Upload allowlist: widened to every format the product accepted before this list (CSV under every declared type, TSV, JSON, Markdown, legacy Word, Excel and PowerPoint, OpenDocument text, RTF), with HTML, XHTML, SVG, JavaScript and Windows executables refused by reason. The HTML refusal is the one break described above.
- **Open:** the Google-session read rule is not enforced in the gateway (needs owner Supabase configuration); the refused-session sentence is not shown; `verify:wired` and `verify:layouts` still target the obsolete `/classic/` route; the multi-part archive is not built.
- **Process slips, disclosed:** one `verify:*` chain was started as a single foreground call and ran past the ten-minute ceiling; it was moved to the background, finished (exit 0), and was read from its output file rather than re-run. One `sed -i` was used in an earlier window on a UI file and reverted from a backup (already recorded above). Repository edits in this window went through Edit or Write; the formatter was used for reading only.

## Entry: PR #465, remaining items (14 October 2026, late)

Branch `feature/auth-storage-portability-ui`, commits `04a2efcb` (merge of main) and the commit that follows it. Nothing merged to main, nothing deployed, no production write.

- **Integration with main (item 1).** Main was merged into the branch. Two text conflicts: `web/studio/bc/wire.js` (both imports kept) and `web/studio/index.html` (main's `identity.css` is the only identity stylesheet). The merge also brought a duplicate of the module identity (this branch's #472 colour variables and menu icon, which main already does through `grid.hueFor` and `identity.css`). Removed in favour of main's (`bc/identity.js` taken from main, `module-identity.css` and its test deleted). `docs/ops/deployment-state.json` matches main exactly. No migration number collides: main ends at 1062, this branch adds 1070 to 1072.
- **Signed links (item 2).** Every gateway path that signs a link was read. The document, contact-photo and screenshot reads check office and project before signing; the background picture goes through `uploadTarget`. Tests now cover all three paths in both directions, plus no session (401) and the machine key (no office, nothing signed): 9 of 9. Failure injection: the photo guard removed turns its cross-office test red; the screenshot guard removed turns its cross-office test red; both restored. **Product rule, stated plainly:** the product has no per-person project membership, so a person may read every project of their own office. The policy test that refuses a project the person is not on is a unit test of `canReadObject`; in the gateway the project list is every project of the office.
- **Restore authentication message (item 3).** The 401 on a restore signs the browser out, which redrew the project menu and hid the sentence. The refusal is now said in a strip above the shell (`[data-bc-restore-refused]`), which survives the sign-out and is not covered by the menu. The menu is not opened for this refusal (opening it laid it over the strip). `verify:access-browser` A3c asserts the words, the box and that nothing covers the strip, at both sizes. Failure injection (the refusal not recorded): A3 and A3c go red at both sizes. The verifier first crashed on that sabotage (it asked an absent element for its box and ended the run); fixed, so the same failure now reports as a red check.
- **Layout harness (item 4).** `verify:arrangement-local` now runs desktop and phone: A (both), B drag, C resize, D second device, E reload, F a refused save is not drawn as saved (with the browser's own copy kept), G1 to G4 on the phone (gutter, no sideways scroll, no resize handle offered, reload). Control `ARRANGEMENT_CONTROL=local-only` turns B, C and D red. E and F are regression checks; they were not shown to fail under that control. **A defect the phone run found:** on a 390 px screen the stacked board ran edge to edge (modules at x = 0, 390 px wide, no gutter). Fixed with a 16 px inline padding on the phone stage (`bc/compose.css`, in the phone block). `verify:layouts` pointed at `/classic/` and drove the retired studio; it now runs the Team HQ suites, and `scripts/verify/layouts.ts` is marked retired. `verify:wired` was already current against `/` and is green.
- **Backups beyond 8 MiB (item 5).** A project larger than one archive is a set of parts. Design and limits are in `docs/release/ARCHIVE-SIZE-DESIGN-2026-10-14.md`: one part at most 8 MB; 5.5 MiB of files per part; 32 parts; 176 MiB a set; 2 MiB of package; each refusal named. Built: `src/portability/parts.ts` (planning, the index, part build and check), `src/portability/set-store.ts` (prepare, restore a part with a marker written before each write, commit, abandon), gateway routes in `supabase/functions/hq-api/index.ts`, page download and set restore. Tests: 17 + 13 + 12, plus S1 to S4 in the browser at both sizes. Failure injection: the missing-part check disabled (commit tests red); the marker cleanup on a refused commit removed (gateway rollback red); the stale-marker guard and the cleanup removed together (the set-level regression red). **A defect the work found and fixed:** a refused commit left its markers, so a resent part was answered as already received over files that were gone. Two guards now prevent it.
- **Upload types (item 6).** Unchanged this window. HTML, XHTML, SVG, JavaScript and Windows executables stay refused by reason; the e2e documents proof now asserts the HTML refusal and that no row is written for it (the one format the product took before this list that is now refused: a deliberate, owner-visible break).
- **Migrations (item 7).** `docs/release/MIGRATION-PLAN-PR465-2026-10-14.md`. Six files are not in the applied ledger: 1060, 1061, 1062 (main), 1070, 1071, 1072 (this PR). Their order is fixed by dependency (1072 replaces functions 1071 creates). Nothing applied.
- **Checks run on the final tree.** Critical gate 68 of 68, 3,681 assertions, 0 failed (tree dirty). Unit suite 473 files, 7,384 tests passed, 21 skipped. `check:migrations`, `check:secrets`, `check:templates`, `check:deployment-state`: exit 0. Typecheck: 102 errors in total; none in a file this branch changed (checked file by file). `npx biome ci .`: exit 1 from three pre-existing formatting failures in files outside this branch (`scripts/sample/settings-live.ts`, `scripts/verify/probe-axe.ts`, `scripts/verify/probe-keyboard.ts`: identical to main). Browser verifiers, all on the final tree: access 22 of 22, archive 36 of 36, arrangement 11 of 11, Google sign-in 24 of 24, `verify:wired` clean, `verify:layouts` (the replacement) 33 of 33.
- **Not run, and why.** The production-reading checks (`check:callers`, `check:gateway-wrappers`, `check:machine-key`, `check:anon-exposure`, `check:carrier-writers`, `check:capabilities`, `check:leaks`, and `check:office-edges` without `--replica`) were refused by the production guard, as they must be without `ALLOW_PRODUCTION_CHECKS`. `check:office-edges --replica` passes. `check:pressable` passes.
- **Known gaps, recorded.** Storage left by a set export (`exports/`) and by an abandoned restore (`restores/`) is not swept. A single original over 5.5 MiB cannot be carried in a set. The Google-session read rule is not enforced in the gateway (owner configuration).
- **Process slips, disclosed.** The `sed -i` was not used this window. Four browser verifiers were chained in one foreground call and passed the ten-minute limit; the harness moved the call to the background, and its result was read from the output file, not re-run. Formatting was done with the formatter's output written to scratch and applied with Edit or Write.
