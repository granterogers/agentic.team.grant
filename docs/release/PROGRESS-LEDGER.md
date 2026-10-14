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
| (next) | 07:45 | C2 backend: migration 1071, ZIP archive, gateway routes, ownership entry, proofs |

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

- Session start 07:33:16 UTC. At this entry: 07:45 UTC (about 12 minutes of continuation work so far).

## Termination

None yet.
