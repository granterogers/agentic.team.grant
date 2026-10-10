# Autonomous run, 11 October 2026: progress log

Branch `claude/dashboard-polish-hermes`, started from `integration/aesthetic-release-candidate` at `5cff7cac` (the aesthetic release candidate is NOT yet on `main`; `main` is `3caaebf`,
so a merge to `main` carries that whole candidate plus this run's work). Baseline before any change: aesthetic QA 289/289, `verify:critical` 68/68, `tests/web` 143/143.

Each entry: what was done, how it was verified, the commit. Newest last.

## 2.1 and 2.2: project appearance (done, tested)

- Stored on the project's background record (`layout.js` `cleanBg`, fields `dots`, `tex`, `mod`, `modMode`), so it is kept, merged and synced exactly like the background choice. No migration, no new store.
- `bc/appearance-pane.js`: Project Settings, Appearance: module colour mode (entire card / title and border), minimised module opacity (default 80%), grid dot opacity, texture strength; live sample board; saves on release; reset.
- Texture is two blended page layers (soft-light up to the default 40%, then an overlay layer), so 0% is plain and 100% is clearly pronounced. Module faces moved to `::before` so opacity does not fade the text.
- Verified: `scripts/verify/basecamp-appearance.ts` (defaults, preview, persistence across reload, per-project isolation, reset, both schemes, phone 44px/no overflow), aesthetic QA 289/289 (its contrast measure now sees a module's face layer; at 80% opacity two hue-coloured text rules were pulled slightly darker).
