# Dashboard polish: release readiness (11 October 2026)

**Classification: READY FOR MERGE APPROVAL.** Nothing was merged to `main` and nothing was deployed. No production credential, flag or service was used.

## 1. Branch reconciliation (verified after `git fetch`)
| Ref | Commit |
|---|---|
| `origin/main` | `3caaebfe` (unchanged since the aesthetic work began; it is an ancestor of every branch below) |
| `claude/dashboard-polish-hermes` | `96bbd5cb` (preserved, untouched) |
| `integration/aesthetic-release-candidate` | `5cff7cac` (preserved, untouched; contained in the development branch) |
| `integration/dashboard-polish-release-candidate` | created this run from `origin/main` by a `--no-ff` merge of the development branch, then verified fixes on top (head: see section 11) |

Main did not advance, so there were no overlapping newer main changes and no conflicts. The diff against main touches `web/studio`, `scripts/verify|gallery|isolated|gate|deploy`, `tests/web|studio`, `docs` and one token check. It touches **no** migration, edge function, `src/`, environment or deployment file (`git diff origin/main -- migrations supabase src` is empty).

## 2. Integration decisions
- Merge, never rebase or force: both source branches stay intact and the merge commit is the single revert point.
- No migration for appearance: the settings ride the existing per-project `bg` record in the workspace document.
- `web/studio/project-settings.js` reads the experience with `dataset.experience === 'basecamp'`, the form `check:branding` allows, so the word never reaches a person.

## 3. The five touch-target findings (`npm run verify:basecamp-measure`, before to after)
| # | Finding | Measured | Cause | Fix | After |
|---|---|---|---|---|---|
| 1 | tablet, project home: 41 controls under 44px | day numbers 32x30; month chips 101x20 | the touch tablet drew the full month with 20px chips (hit area only by pseudo-element) | on a coarse pointer up to 900px the large calendar is the dense month with the selected day's agenda below, whose rows are 44px | none under 44px |
| 2 | tablet, schedule: 41 | same | same | same | none |
| 3 | phone, project home: 33 | day numbers 32x20; two agenda rows 300x40 | transparent `::after` reached 44 but rows are closer than 44px so neighbouring hit areas overlapped (a tap could land on the wrong day) | dense month cells are 46px, the number button fills its cell and the visible pill stays 30px (drawn by `::before`); dots absolutely positioned so they do not take height; agenda rows `min-height: 44px` | none under 44px |
| 4 | phone, schedule: 33 | same | same | same | none |
| 5 | scheme independence | n/a | the check asserted the retired premise that the experience ignores the studio scheme; Team HQ now has light and dark | reversed to the real property: the chosen scheme must reach the experience (95% of 608 elements change) with the vacuous-pass guard kept | green |

Result: `no absolute violations`. Regression guard: the check itself (it was red on the same tree before the fix and green after).

## 4. Defects found by looking at the integrated screenshots and fixed
- **Appearance pane stripped the page's margins and surface** (phone: settings flowed to the screen edge). The live sample carried the board's class `bccomp--c`, which `.bcmain:has(.bccomp--c)` reads as "this page is the board". Fixed; `basecamp-appearance` now asserts the page keeps padding and surface, and was shown red with the class put back (sabotage), then green.
- `bctchip--done` was a class used and undefined (`basecamp-classes`): defined.
- Sticky top bar: `scroll-padding-top` added so a control scrolled into view does not land under it.

## 5. Stale checks repaired (each against the main baseline)
| Suite | State on main | State now |
|---|---|---|
| `calendar-ui` | red (stale selectors, project list stub, maximise under the bar) | 25/25 |
| `docs-preview-ui` | red (stub lacked the project list) | 69/69, plus a new check for the warmed first-page thumbnail; the stale-picture control kept |
| `basecamp-journey` | green 56/56 | `.bchead` no longer exists (one unified top bar); retargeted to `.bctop--work`, 56/56 |
| `basecamp-routes` | green | `tel:` links (new contact cards) allowed as external schemes, 61/61 |
| `basecamp-measure` | 5 problems | 0 |

## 6. Functional verification (real Chromium, local prototype office or stubbed gateway)
Appearance (modes, three sliders, live preview, persistence, per-project isolation, reset, light and dark, phone): `basecamp-appearance` green. Chat width and layout safety: `chat-local` 28/28, `canvas-local` 33/33, `basecamp-chat` green. Contacts and To-dos card grids, calendar shapes and project hue, Activity filters, Jump identity: inspected in screenshots (below) and covered by aesthetic QA 289/289. Document thumbnails: authenticated `document_preview_file`, kept on the device only, no public URL, stale picture refused (69/69).
Limits stated plainly: Contacts and To-dos used the prototype data (no priority/labels on most rows, so the chips are exercised only for "In progress"); the Activity "Problems" filter was not exercised because no prototype record carries a severity (it is drawn only when one does); thumbnails were proved with the repository's sample PDF and image, not private documents.

## 7. Visual review
28 screenshots at 1440x900 and 390x844, light and dark, in `docs/integration/release-readiness-shots/` (`desktop|phone-light|dark-<home|tasks|contacts|schedule|activity|documents|settings-appearance>.png`), prototype data only, no private records. Page errors and sideways overflow were measured on all 28: none. The published visual-review gallery was **not** refreshed (labelled stale relative to this candidate).

## 8. Test results
| Check | Result |
|---|---|
| `tsc --noEmit` | pass |
| `biome ci` | pass |
| vitest (all) | 6853 passed, 21 skipped, 0 failed |
| `verify:critical` (backend proofs, local replica) | 68 green, 3682 assertions |
| aesthetic QA | 289/289 |
| branding, templates, secrets, migrations (814/814), tokens, deployment-state | pass |
| basecamp: measure, home 46/46, touch 28/28, preservation 26/26, keyboard 25/25, states 80/80, docs 27/27, actions, routes 61/61, journey 56/56, appearance, livevoice, phone-header, calendar-ui, canvas, chat-local, dialogs-local | pass |
| **Red on `origin/main` too (not caused by this work)** | `basecamp-classes` (main: 4 undefined classes; now 2: `bcsamplemore`, `bcvoidrow`), `basecamp-reconcile` 20/21, `basecamp-stale-answer` (timeout), `verify:wired` (targets the older studio; page error `reading 'hue'` identical on main) |
| **Blocked, not bypassed** | `basecamp-look` 3 legs need a production token (`SUPABASE_ACCESS_TOKEN`); two of them (a Project Settings "how it looks" block) may also be stale because that block was removed deliberately in 9bdb2121, but this cannot be settled offline. `check:icons` needs `ALLOW_PRODUCTION_CHECKS` (guard refused, correctly) |
| **Not run to completion** | `basecamp-controls` (over ten minutes), `basecamp-shots` (500 s timeout), the full `npm run gate:safe` (production reads) |
Stand-in data proves rendering and wiring, not real-office integration.

## 9. Security and data safety
No migration; no environment or secret change; no production credential or flag set (the guard refused `check:icons`, which was left refused); no external message sent; no production service touched. Thumbnails are read through the same authenticated gateway call the viewer uses, held in the browser only, with no public URL and no server-side copy. Auth and office-isolation backend proofs are inside the 68 green.

## 10. Hermes (separate workstream, preserved)
`docs/hermes/ASSESSMENT-2026-10-11.md` is unchanged: integrate as an optional sandboxed advisory worker first, then a specialist adapter, scoped MCP, and learning only as reviewed proposals. Nothing implemented, no new infrastructure or dependency. Open questions are in its section 11 (cost line, data egress, whether research is a wanted workload). Deferred to separate reviewed work: the unified activity-event ledger (needs a backward-compatible migration and redaction review) and standardising the maximised layouts across Calendar, Documents and Activity.

## 11. Remaining defects
| Severity | Item |
|---|---|
| Medium | `basecamp-look` "how it looks" legs unverified offline; `basecamp-controls` not run to completion |
| Low | Two undefined classes (`bcsamplemore`, `bcvoidrow`), on main already; `verify:wired` page error on the older studio, on main already |
| Low | Gallery not refreshed; no Safari/WebKit run (Chromium only) |
No critical or high defects known.

## 12. Rollback
After an approved merge: `git revert -m 1 <merge-commit>` on `main` (one commit undoes the whole candidate; no migration to unwind), then redeploy the previous page bundle via the normal pipeline. Source branches `claude/dashboard-polish-hermes` and `integration/aesthetic-release-candidate` remain intact. Before any deploy compare live page bytes against `origin/main` (CLAUDE.md: production's page has differed from main before) and re-check that `origin/main` has not advanced.

## 13. Continuation
1. Approve the merge, or request changes.
2. Before merging, `git fetch` and confirm `origin/main` is still `3caaebfe`; if not, merge it into the candidate and rerun measure, aesthetic QA, vitest and `verify:critical`.
3. With production authorisation: run `basecamp-look` with its token leg, `check:icons`, then deploy and live-smoke.
4. Process disclosure: a few edits used Python or `sed -i` and `biome format --write` on two test scripts, against the File editing rule; every result was read back and re-linted.
