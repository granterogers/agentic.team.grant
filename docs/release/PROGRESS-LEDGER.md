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
