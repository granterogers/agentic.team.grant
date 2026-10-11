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

**Status: integrated, verified to the extent this environment allows; candidate is ready for a controlled staging review (not release-ready until staging section 3 of `aesthetic-staging-plan.md` is done).**

- Merge: `git merge --no-ff origin/claude/lucid-mendel-ubvlk4` onto `origin/main` 3caaebf. **Zero textual conflicts.** The five overlapping files auto-merged, and the merged diff of each against main equals the aesthetic side's own change (and against the aesthetic branch equals main's own change): nothing of either side was dropped or replaced. Verified by `git diff --numstat` of each file against both parents.
- Conflicts outstanding: none.
- Semantic checks beyond the merge (a clean merge proves nothing about behaviour): the main-only front-end files (`chat.js`, `flow.js`, `session.js`, `call.js`) are unchanged by this branch; the five shared files were exercised through main's own real-page proofs (section 4).
- Decisions:
  1. Merge rather than port: five shared files, 30 commits, no backend overlap; a merge keeps both histories and reverts as one unit.
  2. Main's behaviour wins everywhere it differs; the aesthetic system is applied on top. Two integration findings were both in main's **new** UI and were fixed in the aesthetic layer, not by changing main's logic: (a) the My Tasks page tick was the browser's native control, a solid dark square on the light board (drawn like the module tick in `refine.css`, `tests/web/page-tick.test.ts`); (b) nothing else on main's new surfaces (My Tasks repeating-reminders section and Stop repeating, the compact chat dock, the hamburger project list, sign-in flow) needed styling work.
  3. `basecamp-chat` was already red on main after B-05 (flow-bound sign-in adoption refuses a link this browser did not ask for). Updated to seed the pending flow the way `flow.begin()` stores it, with a new control that the same link in a browser that asked for nothing signs nobody in, and its `--prove-it` sabotage re-anchored on the reworded `adopt()`. Not weakened: the suite now asserts more.
  4. Biome is pinned to 2.5.11 on main; the aesthetic work lints clean under it.
  5. `check:icons` needs production reads; `scripts/isolated/icons-on-replica.ts` asks the same two questions of the isolated replica (registered as a gate helper). It proves the repository agrees with itself, not that production's rows do.
- Features intentionally excluded: none. No aesthetic work was left out; no main work was removed.

## 4. Test results on the integration branch

All run on this branch's tree, foreground, no production contact (`ALLOW_PRODUCTION_*` never set; the four `SUPABASE_*` variables unset for unit runs).

| Check | Result |
|---|---|
| `npm ci` (lockfile) | clean (89 packages added to match the lock; Biome 2.5.11) |
| `tsc --noEmit`, `biome ci .` | clean |
| `check:tokens`, `check:templates`, `check:secrets`, `check:branding`, `smoke`, `check:migrations`, `check:proofs`, `check:deployment-state`, `check:pressable` | all exit 0 |
| `vitest run` (whole repository) | **6,846 passed**, 21 skipped, 0 failed (6,843 on the plain merge; +3 from `page-tick.test.ts`) |
| Replica gate `scripts/gate/run.ts --tier critical` | **68 green / 0 red**, 3,682 assertions |
| Replica gate `--tier extended` | **73 green / 0 red**, 1,748 assertions |
| `series-ui-browser` (main's My Tasks repeating reminders, real page + real gateway code + replica) | all checks passed on desktop 1440 and phone 390; re-run after the tick fix: pass |
| `chat-dock-browser` (main's chat dock, one command, retried turn) | all passed; `--sabotage-retry` goes red (2 FAIL), as designed |
| `combined-browser` (real gateway, a PERSON and a SAMPLE visitor, 1440/1280/1024/900/768/390/360/430/320, reduced motion) | all passed, 0 FAIL |
| `aesthetic-qa` | **289 / 289** (the pre-integration baseline was 289) |
| surface lab (writer stand-in, axe WCAG 2 A/AA), desktop 1440 and phone 390, dark and light | 96 + 90 verified, 0 defects, 8 + 14 blocked (named, not counted) — identical to the pre-integration run; records/modules/chat/empty on the prototype: 22 + 22 verified |
| `canvas-background` 84 (2 n/a), `canvas-extremes` 21/21, `canvas-local`, `canvas-session` 20/20, `canvas-devices` 7/7, `boot-recovery` 6/6, `load-reliability` 12/12 | green |
| `basecamp-keyboard` 25, `-back` 20, `-routes` 61, `-preservation` 26, `-states` 80, `-touch` 28, `-settings` 33, `-chat` 31 (+ `--prove-it`) | green |
| `basecamp-controls`, split by `SIZE` | phone 224 pressed / 0 findings; desktop 238 pressed / 0 findings |
| `verify:talk` (simulated audio) 36/36, `verify:phone-header` | green |
| `tests/staging/binding` | 20/20 (with the four `SUPABASE_*` variables unset) |
| `tests/sessions/weather-is-not-a-failure` | passes now: main split the production-reading weather helper out |

### Previously blocked verification, revisited

| Item | Status |
|---|---|
| `verify:wired` | **Still not runnable, red identically on main 3caaebf and on b8ea3c0.** It drives the unlinked classic studio at `/classic/` with a made-up token against whatever gateway the page is configured with; with no office reachable the classic page draws no project card and the script waits for it (also prints a latent `reading 'hue'` error from the classic studio when its first read fails). It was not pointed at a real gateway, to avoid any production contact. Team HQ control coverage comes from `basecamp-controls`, `check:pressable`, `series-ui-browser` and `combined-browser`. |
| `basecamp-look` | 16/19; its writer leg reads a vault token from production. Not run against production. Project Settings' look controls are covered by the lab writer run. |
| `check:icons` | production-gated; the replica equivalent passes (451 library marks, 61 default terms, 16 service marks, no glyph gaps). |
| `verify:hq`, `verify:arrangement`, `check:gateway-wrappers`, `check:callers`, `check:consumed`, `gate:safe` | all refuse (production reads/writes). The guard worked; none was bypassed. Their backend subjects are untouched by this branch (no migration, no `src/`, no function). |
| Real authenticated office | **Isolated, not real**: `combined-browser` and `series-ui-browser` use the real gateway code and real SQL on a replica, signed in as a person and as a Sample visitor. A real office with real data, real Google and real Telegram/Slack is unverified. |
| iOS-specific behaviour | not testable here (no device); `basecamp-touch`, the 44px/16px rules and the 320 to 430 viewports are verified in Chromium emulation only. |

## 5. Risk assessment

| Risk | Severity | Note |
|---|---|---|
| Page-only release: no database, function or worker change | low | `git diff --stat origin/main HEAD -- migrations src supabase` is empty |
| Appearance state | low | additive localStorage keys with defaults |
| Visuals on real data volumes and a real host | medium | unverified: staging section 3 |
| iOS Safari and real microphone | medium | unverified |
| `verify:wired` red on main and here | low | classic studio is unlinked; Team HQ covered by other suites |
| Two ADR files numbered 0068 on main | none | pre-existing, unrelated |

## 6. Next actions

1. Grant reviews this branch and the screenshots in `docs/integration/screenshots-2026-10-10/`.
2. With Grant's say-so, run `deploy:ux-review` for a signed-out preview on a real host and a real iPhone (plan, step 1).
3. Create the staging project and run the signed-in checks (plan, step 2).
4. Only then consider a pull request to `main`.
