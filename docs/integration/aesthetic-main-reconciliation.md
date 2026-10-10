# Aesthetic branch + main: reconciliation record

Integration branch: `integration/aesthetic-release-candidate` (started from `origin/main`, never from the aesthetic branch).
Nothing here is merged to `main`, pushed to `main` or deployed. Production was not contacted.

## 1. Pre-integration checkpoint (written before any merge)

| | |
|---|---|
| `origin/main` used | `3caaebfe932c6e220c4d21b5670820b6a7c1d1b0` ("Handoff closeout: V1 deployed, main reconciled ...", 10 Oct 2026) |
| Aesthetic branch | `claude/lucid-mendel-ubvlk4` at `a7eae0e0f97fb5938e87df03b349732a552c377c` (unchanged since it was reported) |
| Merge base | `b8ea3c0a102cf5e6a5bc205e57bca0e5dcc3cd71` |
| Commits only on main | 107 |
| Commits only on the aesthetic branch | 30 |
| Size of each side | main 370 files, +59,931 / -1,318; aesthetic 172 files, +4,831 / -346 |
| Other branches on the remote | none (`origin/main` and the aesthetic branch only) |
| Existing integration branch | none locally or remote (this branch is new) |

### What main did while the aesthetic sprint ran (V1 reliability and release work)

From `git log b8ea3c0..origin/main`: a hardening campaign and a release, mostly outside `web/`.
- Backend / contracts: migrations **1023, 1027, 1042-1053** (task day and repeating reminder, delivery redrive, a replayed Team HQ message is one command, delivery attention item, work delivered only to its own office's destination, lead reply ordering, **1053 closes 14 public views to a public key (#457)**). `migrations/applied.json` is new. Production ledger records 1042-1053 applied on 9-10 October.
- Worker and agents: selective delegation (Telegram, every interface), fallback model policy (#444), bounded resumable Notion sync, delivery redrive, promise gate, capability correction, hostile-document bounds, connector SSRF policy, sign-in exact-origin check (B-04) and flow-bound session adoption (B-05).
- Tooling: maintained gate (`verify:critical` / `verify:extended` / `verify:proofs`, `scripts/gate/`), Biome **pinned to 2.5.11**, `check:deployment-state`, `release:services`, backup prune, capacity scenarios, mutation campaign harness.
- Front end (`web/`), the only part that overlaps this work: `app.js` (+143), `bc/shell.js` (+58), `bc/wire.js` (+40), `bc/compose.css` (+3/-1), `chat.js` (+45/-4), `flow.js` (+169, new), `session.js` (+38/-18), `call.js` (+3/-3). Substance: **My Tasks** lists repeating reminders and has a "Stop repeating" press; a tick or stop re-reads the list in place (#450); **chat dock** keeps focus, draft and place across a redraw and a message sent while history is loading stays on screen (#458); durable Team HQ conversation key and retried turn (`flow.js`, `chat.js`); sign-in/session adoption hardening (`session.js`); the project list is read from the hamburger menu (ADR-0068 had removed the portfolio from the canvas); 320px project nav fix.
- Production state per main's own handoff: **V1 deployed to production on 10 October 2026**, live acceptance recorded, with a rollback-artifact warning.

### What the aesthetic branch did (from `b8ea3c0`)

No migrations, no backend, no SQL, no `src/` change. Changes are confined to `web/studio` (CSS, `app.js`, `bc/*`, `settings-ui.*`), docs, tests and QA tooling:
unified palette tokens and four looks, glass and depth controls, `web/studio/bc/refine.css` (new, linked last), menus, chat colours, maximised module surfaces, one fixed-viewport background material (ADR-0072, amends ADR-0069), canvas-drawn grid, whole-pixel type scale, spacing, compact schedule Day/Week/Month, layout fit-to-window and short-stage fix, accessibility fixes, and the QA laboratory (`surface-lab`, `gallery`, `icon-audit`, `motion-focus`, `type-census`, `aesthetic-qa` 289 checks, `type-scale` and `looks` tests). Also four suite updates (`basecamp-chat`, `basecamp-settings`, `check-tokens`, `canvas-background`).

### Files changed on BOTH sides (the real conflict surface)

| File | Main | Aesthetic |
|---|---|---|
| `web/studio/app.js` | +143 (My Tasks repeating reminders, chat dock continuity, session) | +72 / -16 (Appearance controls, titles, role/aria, `saidBy`) |
| `web/studio/bc/shell.js` | +58 / -2 (hamburger project list, My Tasks wiring) | +4 / -4 (maximised close title, project menu roles) |
| `web/studio/bc/wire.js` | +40 / -1 | +17 / -11 (menu close selector) |
| `web/studio/bc/compose.css` | +3 / -1 | +64 / -66 |
| `scripts/isolated/p3-cases/20-projects.ts` | +1 / -1 | +1 / -1 (a one-line each; compare) |

Not in this list but must be re-run together: `web/studio/chat.js`, `flow.js`, `session.js`, `call.js` changed only on main; `basecamp-chat`, `basecamp-settings`, `check-tokens`, `check-branding` changed on the aesthetic side and may be touched by main's tooling changes (Biome 2.5.11, gate manifest).

### Known failures before integration (from the aesthetic sprint, for comparison later)

`verify:wired` (classic studio, red on the old main too), `basecamp-look` (16/19, production), `check:icons` (production), `tests/sessions/weather-is-not-a-failure` (production), `tests/staging/binding` (passes when the four SUPABASE_* variables are unset).

### Migration and persisted-state notes

- The aesthetic branch adds no migration and changes no stored shape: `studio.appearance` (localStorage) gains the keys `look`, `glass`, `depth` with defaults, and `bg` references are unchanged. Layout rows are not altered.
- Main's migrations are already applied to production (1042-1053). Nothing in this integration runs a migration.

## 2. Strategy

Merge (not cherry-pick): the two sides touch five files in common, and a merge commit keeps both histories traceable and revertible as one unit (`git revert -m 1`). Each conflict is resolved by hand from the three versions, main's function first, then the aesthetic classes and attributes applied to it. Status below is updated as the work proceeds.

## 3. Status log

(updated during the integration)
