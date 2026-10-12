# Team HQ UX overhaul: release candidate

Candidate: branch `claude/busy-darwin-21mr9n` at `6857c7be` (pushed). It contains all of `origin/main` at `a37188da` (verified
12 October 2026: `git merge-base --is-ancestor origin/main HEAD` succeeds). Production: https://ai-team-hq.vercel.app

## Status: READY FOR RELEASE, pending the production authorisation in section 5

Implementation and available QA are complete for the scope recorded in `docs/ux-overhaul/CHECKLIST.md`. Known limits remain
and are listed there. The release itself has not been performed: it needs the production flags, which have not been set.

## 1. Change set

`git diff origin/main HEAD -- web/studio`: 16 files.
`app.js`, `appearance.js`, `index.html`, `studio.css`, and under `bc/`: `account.css`, `activity.css`, `bc.css`, `compose.css`,
`layout.js`, `miniatures.js`, `polish.css`, `refine.css`, `shell.js`, `stone.css`, `tokens.css`, `wire.js`.

- Activity Log JavaScript is unchanged: `git diff origin/main HEAD -- web/studio/bc/activity.js web/studio/bc/activity-model.js`
  is empty. `bc/activity.css` changed only in colour tokens (its banner keeps main's warm accent through `--bc-activity-accent`; the
  waiting and warning marks use the darkened warning token `--bc-state`).
- Test and verification files: `scripts/verify/probe-*.ts` (exit-races, history-sequences, journeys, chrome-audit, modules,
  matrix, activity-state, viewer-close and others).

## 2. Live baseline (public static reads, 12 October 2026)

Each of the 16 changed files was read from https://ai-team-hq.vercel.app with an unauthenticated GET. For every file the live
md5 equals the md5 of the same file at `origin/main`. So the staged change is exactly the branch diff applied to the live page,
and no unrelated live work would be overwritten.

## 3. Evidence at `6857c7be`

- Unit: `npx vitest run tests/web tests/studio`: 498 pass in 32 files.
- Lint: `npx biome ci` on every changed probe: clean. The repository-wide `npm run lint` was red before this branch, in files
  this branch does not change; no finding is in a changed file.
- Browser, real pointer and keyboard, desktop unless stated:
  - `probe-exit-races`: 8 checks (viewer and Settings reopened by a press while fading, each press recorded as arriving during the
    fade; double Back; rapid cycles; reduced motion focus). Repeated 5 times, all pass.
  - `probe-history-sequences`: 7 sequences x 3 rounds, 21 checks, all pass (Back then reopen, double Back, Escape then reopen,
    rapid open/close/open, reload with a settings entry, Forward after closing, closing one modal and opening another).
  - `probe-journeys`: 8 journeys x 2 rounds, 16 runs, all pass, each followed by a global health check (no page errors, no stale
    overlay, inertness and blur agree with what is open, history agrees with Settings).
  - `probe-modules`: 7 maximised modules, desktop and phone; each fills the screen, returns to the project and restores focus.
  - `probe-matrix`: 32 captures (1920, 1440, tablet, phone; light and dark), zero horizontal overflow, zero page errors.
  - `probe-chrome-audit`: measured computed styles in Light and Dark; no warm gradient on standard chrome; a positive control is
    detected in both schemes.
  - `probe-activity-state`: the Activity accent and warning colours in both modes, contrast at least 4.5:1.
  - `probe-axe`: zero violations on ten surfaces, light and dark. `probe-review`, `probe-viewer-close`, `probe-history`,
    `probe-close-motion`, `probe-motion`, `probe-dialog-stable`, `probe-entry`, `probe-team`, `probe-project`, `probe-keyboard`,
    `probe-calendar`, `probe-backdrop`, `probe-drag`, `probe-canvas`, `probe-pdf-thumb`: exit 0 with no page error.
- Independent review: two read-only reviews. The first (on `a623fa8e`) found one major defect, closing Settings under reduced motion
  left focus on the body. Fixed in `6857c7be` and covered by the reduced-motion check, which fails on the previous commit. The
  same review's minor items were fixed (pane kept on reopen; the click swallow now expires).

## 4. Known limits (recorded in the checklist, not hidden)

- Authenticated checks (Team Settings save, persisted appearance on an account, background upload, gateway document thumbnails,
  agent configuration) need a signed-in writer. This environment has none and no local backend.
- Document tiles show a typed label until a person opens the file in the viewer, because the seeded documents have no bytes here.
- On a phone the maximised Card Table stacks its stages rather than showing four columns (a deliberate decision).
- The viewer restores focus at the start of its fade, and its blur is removed at the start too; this is deliberate.
- The dangling settings-history case from the second review was not reached by any user action and is unverified.

## 5. Release steps and the authorisation required

Not performed. Each step is identified so the authorised run is mechanical.

1. Merge: fast-forward `main` to `6857c7be` (or merge), after confirming `origin/main` is still `a37188da`. This is a write to the
   shared default branch and needs Grant's go-ahead.
2. Dry compare against production: `npx tsx scripts/deploy/hq-page-delta.ts --root=web/studio`. It refuses when the file names
   differ from the live deployment. It needs `ALLOW_PRODUCTION_CHECKS=1` and `VERCEL_TOKEN`.
3. Deploy: the same command with `--go`. It needs `ALLOW_PRODUCTION_WRITES=1` for this named write only. It prints the previous
   deployment id, which is the rollback point. `VERCEL_TOKEN` in the environment is not permission to deploy.
4. Verify: fetch the 16 files and compare md5 with `6857c7be`; run `probe-exit-races` and `probe-journeys` against the production
   origin with `ALLOW_PRODUCTION_CHECKS=1` only if Grant authorises that read.
5. Rollback: before step 3, keep a copy of the 16 live files (fetched as in section 2). Redeploy that copy through the same script
   with the same two flags, or promote the printed previous deployment in the Vercel dashboard.

**Single remaining authorisation:** Grant's explicit go-ahead for steps 1 and 3, with `ALLOW_PRODUCTION_CHECKS=1` and
`ALLOW_PRODUCTION_WRITES=1` set for those named operations only.
