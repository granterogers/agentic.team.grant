# Team HQ UX overhaul: release candidate

Candidate: branch `claude/busy-darwin-21mr9n` at `6857c7be` (pushed). It contains all of `origin/main` at `a37188da` (verified
12 October 2026: `git merge-base --is-ancestor origin/main HEAD` succeeds). Production: https://ai-team-hq.vercel.app

## Status: DEPLOYED to production (13 October 2026). Production workspace verification performed (section 6): desktop passes, and
one phone defect was found. Its fix is on the branch and proven locally; it is NOT yet on production, and deploying it needs Grant's
authorisation (section 6, last part).

## 0. Deployment record

- `main` fast-forwarded from `a37188da` to `a5363d94` (`git push origin a5363d94:refs/heads/main`, no force).
- Deployment `dpl_FGxJYkQsYV5543Pr5zLveujwbPSD` created by `scripts/deploy/hq-page-delta.ts --root=web/studio --go`, state READY,
  target production, `meta.gitCommitSha` `a5363d94816ef6978f73289c6358bbbc44f1e15e`, `deployedBy` `deploy:hq-page`.
- Rollback point (the deployment that was live before): `dpl_EwZ7ghJP8uutmxVzyeruQUZvme6C`. Rollback = promote it in Vercel, or redeploy
  the saved copy of the 16 files in `.out/release/live-baseline-a37188da/` with the same script and flags.
- Before the write: the 16 changed files matched `origin/main` `a37188da` on the live site (checked twice). The dry compare named
  only `out/api/notebook*` build outputs as live-only, which the script excludes by rule. `config.js` was generated with
  `npm run config:site` and is byte-identical to the live file; it is gitignored and was not committed.
- After the write: the 16 files served from `ai-team-hq.vercel.app` are byte-identical to the branch at `a5363d94`.
- Flags: `ALLOW_PRODUCTION_CHECKS=1` and `ALLOW_PRODUCTION_WRITES=1` were set for this one deployment and for the read-only checks
  in section 6, on Grant's approval.

## 6. Production verification of the workspace (this session)

Route: the public Sample Office, entered as a visitor. Runs used `ALLOW_PRODUCTION_CHECKS=1` only (`ALLOW_PRODUCTION_WRITES` was not
set). Every run recorded its non-GET requests: the only one is `POST /functions/v1/signin`, the visitor session the Sample creates on
entry. No Sample data was changed. Probes: `scripts/verify/probe-production-workspace.ts [desktop|phone]` (real pointer and keyboard
presses, screenshots in `.out/probe/`), and the read-only `scripts/verify/probe-production-landing.ts`.

**Desktop (1440 x 900), final run: 23 of 23 checks pass.**
- The Sample connects and shows the workspace (12 to 13 s in the runs; see initial load below). Default look is Slate & Silver.
- Global Settings opens from its header control and closes with Back; the workspace answers a Team Chat press afterwards.
- Appearance sheet: a texture previews (15 choices), Cancel reverts the choice, Escape closes it; the workspace is released.
- Canvas: the Tasks module dragged 72 px by its title strip; the zoom control moved the scale from 100% to 115%.
- Modules Tasks, Documents, Schedule and Contacts each opened maximised (98% of the width) and returned to the canvas; the
  workspace answered a Team Chat press after each.
- Calendar: next changes the month, today returns.
- Team Chat: five rapid presses with no pause, and one more, leave it consistent (open/closed alternate; ends where it started).
- Documents: a document record opens (8 documents listed) and closes; the workspace answers afterwards.
- Browser Back closes Global Settings opened by a press. Final state: no sheet fading, workspace released, responsive.
- No page errors, no failed requests.
- Observed, not a failure of the checks: one `400` on `GET /functions/v1/hq-api?section=activity_ledger`. The Activity Ledger is off
  in production by policy, the page's read of that section is caught and the workspace still renders. The server's own message was
  not inspected, so the cause is inferred from the policy, not confirmed.

**Phone (390 x 844): the flow passes, with one defect found.** Final run: 20 of 21 checks pass; the one failure is the request-level
check, caused by transient transfer failures recorded below. Global Settings on a phone opens on a list of panes, and closes with two
presses (the first returns to the list, the second to the workspace). The canvas has no visible zoom control on a phone, so there is
no zoom check there; the canvas is not dragged on a phone either. Documents, modules, calendar, appearance and Settings all pass.

**DEFECT FOUND (phone): a press on the header during the Team Chat dock's close fade can fall through and sign the visitor out.**
- Observed: in one run, the rapid chat presses, pressed on the dock's own close control during its 200 ms fade, landed on the header's
  Sign out button. The page returned to the signed-out landing screen. No sign-out request was seen in the non-GET list, so the
  mechanism of the sign-out is inferred from the landing screen, not from a request.
- Cause: `web/studio/bc/polish.css`, `#dock.leaving { pointer-events: none; }`. The rule is right for the desktop side drawer, where
  the drawer sits beside the workspace and a press should reach the workspace. On a phone the dock covers the whole screen
  (`web/studio/bc/stone.css`, `max-width: 760px`), so the same rule lets a press fall through to the header beneath it.
- Fix (on the branch, not deployed): the rule is now inside `@media (min-width: 761px)`. On a phone the fading dock keeps its
  pointer input and absorbs the press.
- Proof: `scripts/verify/probe-dock-fade.ts` (local, real presses, the hit point read during the fade). Before the fix: phone FAILED
  (a press on the header fell through to the header's menu button), desktop control passed. After the fix: 4 of 4 pass, and the desktop
  control still passes, so the desktop behaviour is unchanged. Re-run after formatting: 4 of 4.
- Regression checks run after the fix (local): `probe-exit-races` 8 of 8, `probe-history-sequences` 21 of 21, `probe-close-motion`
  and `probe-viewer-close` pass, unit tests `tests/web tests/studio` 498 of 498, biome clean on the two new probes, `check:secrets` clean.
- Not yet verified on the fixed production build: the phone rapid-press sequence itself. It is not run on a phone in the probe, because
  on the current production build it ends the Sample session. Run it after the deploy.

**Transient transfer failures, classed as ENVIRONMENT.** Across the browser runs, some static files and some gateway sections came
back as `502` or as `text/plain` (`appearance.js`, `refine.css`, `docs.css`, `settings.css`, `docorder.js`, a texture, and `hq-api`
sections `studio_settings` and `governance`). The same URLs requested directly from the sandbox returned `200` with a Vercel
`x-vercel-id` (static files), and the gateway sections returned `401` without credentials (healthy). The pattern matches the sandbox
proxy's known transfer fault. A failed load shows the product's own "could not finish loading" screen with a Reload button; that
screen appeared on the phone once. A later desktop run that hit a `502` on `docorder.js` did not reach the workspace in 90 seconds;
the following run passed. The browser-path cause is not established.

**Initial load (the 13-second question).** Sample entry to a usable workspace: 10 to 24 s across runs (desktop 11 to 13 s; the slower
phone runs 22 to 24 s). An earlier trace of the Sample: sign-in about 1.3 s, the `hq-api` read about 3.9 s, settled at about 10.6 s.
So the Sample's slowness is its sign-in and its data read, not a stuck page. A cold landing draws in 2.3 to 3.1 s in four repeated runs;
the single 13-second landing was taken straight after the deployment, when the edge caches were cold. That is the likely cause, not a
proven one. Assets are served with `cache-control: public, max-age=0, must-revalidate` and 85 JS/CSS files (2,842,709 bytes raw, about
931,000 bytes brotli on the wire), so each visit revalidates every module; changing that header is production configuration, which was
not authorised, so it is recorded as a candidate, not changed.

**NOT verified on production (authenticated functionality).** These need a signed-in account, which none of these runs used:
Team Settings save; appearance saved to an account and restored on reload; background picture upload; gateway document thumbnails;
agent configuration. The Sample is a visitor's read-only office, so these were not tested there either.

**NOT verified on production (phone):** the rapid Team Chat sequence (defect above, fix not yet deployed); a visible zoom control (none is
drawn on a phone).

**Other environment notes.** `npm run typecheck` fails on this branch in every `scripts/verify/probe-*.ts` file (the node typecheck has no
DOM types for them), including the earlier committed probes, so it was already red before the two probes added here. The two new probes
follow the same convention as the rest of that family.

**What Grant must authorise to deploy the phone fix.** It is one changed file (`web/studio/bc/polish.css`), so the deployment is the same
named write as before, for this file only:
1. Merge: fast-forward `main` to the commit that carries the fix (`origin/main` must still be `a5363d94` before the merge).
2. Dry compare: `npx tsx scripts/deploy/hq-page-delta.ts --root=web/studio` with `ALLOW_PRODUCTION_CHECKS=1`.
3. Deploy: the same command with `--go`, and `ALLOW_PRODUCTION_WRITES=1` for this named write only. It prints the previous deployment id,
   which is the rollback point. The live `polish.css` must first be compared with `origin/main` (`md5`) to confirm nothing else changed.
4. Verify: fetch `polish.css` and compare md5 with the branch; run `probe-production-workspace.ts phone` and the desktop run again.
Rollback: promote the printed previous deployment in the Vercel dashboard, or redeploy the saved file.

## 1. Change set

`git diff origin/main HEAD -- web/studio`: 16 files at `6857c7be`, plus the fix in `web/studio/bc/polish.css` in the commit that
carries this section.
`app.js`, `appearance.js`, `index.html`, `studio.css`, and under `bc/`: `account.css`, `activity.css`, `bc.css`, `compose.css`,
`layout.js`, `miniatures.js`, `polish.css`, `refine.css`, `shell.js`, `stone.css`, `tokens.css`, `wire.js`.

- Activity Log JavaScript is unchanged: `git diff origin/main HEAD -- web/studio/bc/activity.js web/studio/bc/activity-model.js`
  is empty. `bc/activity.css` changed only in colour tokens (its banner keeps main's warm accent through `--bc-activity-accent`; the
  waiting and warning marks use the darkened warning token `--bc-state`).
- Test and verification files: `scripts/verify/probe-*.ts` (exit-races, history-sequences, journeys, chrome-audit, modules,
  matrix, activity-state, viewer-close, dock-fade, production-workspace and others).

## 2. Live baseline (public static reads, 12 October 2026)

Each of the 16 changed files was read from https://ai-team-hq.vercel.app with an unauthenticated GET. For every file the live
md5 equals the md5 of the same file at `origin/main`. So the staged change is exactly the branch diff applied to the live page,
and no unrelated live work would be overwritten.

## 3. Evidence at `6857c7be` (before this session)

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
- The phone Team Chat close fade (section 6) is fixed on the branch and not yet on production.

## 5. Release steps and the authorisation required

Steps 1 to 5 were performed for the release at `a5363d94` (section 0). The phone fix in section 6 needs its own authorised run, using
the steps listed at the end of section 6.
