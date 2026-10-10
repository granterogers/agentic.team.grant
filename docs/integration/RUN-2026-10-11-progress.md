# Autonomous run, 11 October 2026: progress log

Branch `claude/dashboard-polish-hermes`, started from `integration/aesthetic-release-candidate` at `5cff7cac` (the aesthetic release candidate is NOT yet on `main`; `main` is `3caaebf`,
so a merge to `main` carries that whole candidate plus this run's work). Baseline before any change: aesthetic QA 289/289, `verify:critical` 68/68, `tests/web` 143/143.

Each entry: what was done, how it was verified, the commit. Newest last.

## 2.1 and 2.2: project appearance (done, tested)

- Stored on the project's background record (`layout.js` `cleanBg`, fields `dots`, `tex`, `mod`, `modMode`), so it is kept, merged and synced exactly like the background choice. No migration, no new store.
- `bc/appearance-pane.js`: Project Settings, Appearance: module colour mode (entire card / title and border), minimised module opacity (default 80%), grid dot opacity, texture strength; live sample board; saves on release; reset.
- Texture is two blended page layers (soft-light up to the default 40%, then an overlay layer), so 0% is plain and 100% is clearly pronounced. Module faces moved to `::before` so opacity does not fade the text.
- Verified: `scripts/verify/basecamp-appearance.ts` (defaults, preview, persistence across reload, per-project isolation, reset, both schemes, phone 44px/no overflow), aesthetic QA 289/289 (its contrast measure now sees a module's face layer; at 80% opacity two hue-coloured text rules were pulled slightly darker).

## 2.3 Chat width, 2.4 Jump identity, 2.5 Contacts cards, 2.9 To-do cards
- 2.3: chat page spans the card (max 1280px, message panels, 118ch text). Commit "Chat page spans the card".
- 2.4: `bc/identity.js` is the single table of marks and hues; Jump rows and module titles read it.
- 2.5: maximised Contacts is a responsive card grid; only recorded fields are drawn (email, phone, website, social, last contact, next step, labels, other projects with the same email or name).
- 2.9: maximised To-dos is a responsive card grid (scoped by `.bcrecordhead ~ .bctasklist`); tick, open, date and edit unchanged; chips for urgent/high priority, in progress, done and labels, drawn only when the record carries them. Subtask progress, dependencies and per-task activity are NOT drawn: the task payload carries none of them today.
- Verified: biome ci clean, tests/web 143/143, aesthetic QA 289/289.

## 2.6 Calendar, 2.7 Activity, 2.8 Thumbnails, Phase 3 Hermes
- 2.6: calendar chips carry source by SHAPE (circle Team HQ, diamond Google, tick to-do), project by an edge hue, all-day by weight; colour is never the only cue.
- 2.7: the project Activity tool already had source-type filters (people, team, integrations, sync, documents, tasks, calendar). Added a time-range filter and a Problems filter, each offered only when records carry the data (an instant; a severity). NOT done: a new unified structured event ledger (agent runs, DB operations, retries, errors) with severity and project ids. That needs a backward-compatible migration and a redaction review; it is recorded as outstanding, not claimed.
- 2.8: real first-page thumbnails already existed for files Team HQ holds and, after opening, for external ones (kept on the device, keyed to the source's modified time). Now an unopened PDF or picture tile makes its own first page through the same authenticated `document_preview_file` call (one at a time, at most 16 per session, silent on failure, no public URL, nothing stored server side). `scripts/verify/docs-preview-ui.ts` was RED before this run (its stub no longer served the `studio` section); repaired, extended and green at 69/69 with the stale-picture control kept.
- Phase 3: `docs/hermes/ASSESSMENT-2026-10-11.md` (options A to D, boundaries, data flow, plan, roadmap, cost). No PoC built, deliberately, with reasons in section 10.
