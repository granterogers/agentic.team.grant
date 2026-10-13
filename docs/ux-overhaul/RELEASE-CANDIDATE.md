# Team HQ UX overhaul: release candidate

Candidate: branch `claude/busy-darwin-21mr9n` at `6857c7be` (pushed). It contains all of `origin/main` at `a37188da` (verified
12 October 2026: `git merge-base --is-ancestor origin/main HEAD` succeeds). Production: https://ai-team-hq.vercel.app

## Status: DEPLOYED to production. The phone Team Chat correction is merged into `main` (`d75b651a`) and deployed (deployment
`dpl_8Guk3knuaHbz7aWaU3WR7EWcXby2`, section 0, "Phone correction release"). Production verified on a 390 x 844 phone and at 1440 x 900,
with the limits listed in section 6.

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

### Phone correction release (merged and deployed)

- Pre-release: the working tree was clean; `claude/busy-darwin-21mr9n` at `d75b651a` was pushed; `origin/main` was `a5363d94`, an
  ancestor of it, so the merge was a fast-forward. Commits added to `main`: `775f7aee` (the earlier release record, documentation and
  probes only) and `d75b651a` (the correction). The web tree differs from `a5363d94` only in `web/studio/bc/polish.css`.
- Checks on `d75b651a`: `npx vitest run tests/web tests/studio` 498 of 498; `check:templates`, `check:branding`,
  `check:deployment-state` and `check:secrets` clean. Before the write, the live `polish.css` and `config.js` were byte-identical to
  `origin/main` and to the generated file.
- Merge: `main` fast-forwarded from `a5363d94` to `d75b651a` (`git push origin d75b651a:refs/heads/main`, no force).
- Dry compare (`scripts/deploy/hq-page-delta.ts --root=web/studio`): 291 files; no name missing locally; names only live were
  `out/api/notebook` and `out/api/notebook-act`, excluded by rule. Rollback point printed: `dpl_FGxJYkQsYV5543Pr5zLveujwbPSD`.
- Deploy (`hq-page-delta.ts --go`, with `ALLOW_PRODUCTION_CHECKS=1` and `ALLOW_PRODUCTION_WRITES=1` for this one frontend deployment):
  uploaded one file (`polish.css`); deployment `dpl_8Guk3knuaHbz7aWaU3WR7EWcXby2`, build READY, the page serves the new bytes.
- Production file verification: all 142 tracked files under `web/studio` at `d75b651a` were fetched from
  `https://ai-team-hq.vercel.app` and compared by md5: 142 matched, 0 mismatched. `config.js` matches the generated file.
- Database: no migration, function, setting or schema touched. The three committed Activity Ledger migrations are still not applied,
  as `check:deployment-state` records; this release does not run them.
- Rollback: `dpl_FGxJYkQsYV5543Pr5zLveujwbPSD` (the Team HQ page of `a5363d94`). Promote it in Vercel, or redeploy the saved copy.

**Mobile regression, 390 x 844, real touch input, production Sample Office (`scripts/verify/probe-production-mobile-chat.ts`):**
- Three full runs, 11 of 11 checks each. Each run: enter the Sample Office (visitor session); open Team Chat; close it normally; then
  ten cycles of reopen, rapid close, and a touch tap at the header's Sign out position during the 200 ms closing fade, with no wait for
  the fade to finish. Every cycle read the hit point during the fade: the dock was leaving and the point was inside the dock. Thirty of
  thirty cycles across the runs passed, and Sign out was never reached.
- The visitor session stayed active through the cycles, with no stale overlay, no lost inertness and no lingering blur. Team Chat then
  opened, showed its composer and closed normally. A module (Tasks) opened maximised and returned to the canvas, and the final press on
  the Team Chat toggle answered. No page errors. The only non-GET request in each run was the Sample's own sign-in.
- Positive control: `scripts/verify/probe-dock-fade.ts` (local) fails on the phone before the correction (a press on the header falls
  through to its menu button) and passes after it (4 of 4). The desktop control still passes both before and after.

**Desktop regression, 1440 x 900, production (`scripts/verify/probe-production-workspace.ts desktop`):** 23 of 23 on the clean run
after the deployment. This covers Global Settings open and close with Back; the appearance sheet (preview, Cancel, Escape); the canvas
drag and zoom; the Tasks, Documents, Schedule and Contacts modules maximised and returned; calendar next and today; Team Chat with five
rapid presses and one more; document records; browser Back; no page errors. The Team Chat drawer still behaves as a side drawer.

**Browser failures seen during this release, and how each was classified.**
- Every classification below rests on the failing response itself. Vercel stamps `x-vercel-id` on every response it sends, so a
  Vercel-hosted static file that returns an error with no `x-vercel-id` did not come from Vercel. Direct requests that succeed are
  recorded as well, but they are not the basis for the classification.
  - `502 GET /bc/dockdictate.js` with no `x-vercel-id` and `text/plain`: not a Vercel response. Classed as the sandbox proxy's transfer
    fault (environment).
  - `502 GET /bc/dockgrip.js` on one phone landing load, and `502 GET /textures/bg/warm-microcement.thumb.webp` on one desktop run: the
    headers were not captured on those runs, so the origin is NOT confirmed. Neither reproduced in the later runs, which captured headers.
  - `ERR_ABORTED` on static files (`skins.css`, `polish.css`, `account.css`, `settings.css`) and on `hq-api`: the request was cut off
    before any response, so there is no header to read. Classed as the same transfer fault, by evidence of the cut-off, not by any
    direct request.
  - `400 GET /functions/v1/hq-api?section=activity_ledger`: a Supabase response, which carries no Vercel header by design. The Activity
    Ledger is off in production by policy, so the 400 is expected; the page catches the read and renders.
- A run where the landing page never drew the Sample button, and the product's own "could not finish loading" screen appeared
  (`Part of the page did not arrive`): that screen is the application handling a missing file, and it appeared only on the runs where
  the transfer fault occurred. The three full mobile runs and the clean desktop run completed without it.

**Initial load.** The Sample takes about 10 to 24 s from entry to a usable workspace across runs (sign-in, then the data read; see
section 6 above). This was not changed.

**Not verified on production (authenticated functionality, not tested):** Team Settings save; appearance saved to a signed-in
account; background picture upload; gateway document thumbnails; agent configuration. The Sample is a read-only visitor office, and
no signed-in account was used.

**Limits (phone):** no visible zoom control is drawn on a phone, so the zoom is not tested there; the phone canvas is not dragged.

**Rollback:** `dpl_FGxJYkQsYV5543Pr5zLveujwbPSD`.

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
- Fix (merged and deployed, see the phone correction release above): the rule is now inside `@media (min-width: 761px)`. On a phone the fading dock keeps its
  pointer input and absorbs the press.
- Proof: `scripts/verify/probe-dock-fade.ts` (local, real presses, the hit point read during the fade). Before the fix: phone FAILED
  (a press on the header fell through to the header's menu button), desktop control passed. After the fix: 4 of 4 pass, and the desktop
  control still passes, so the desktop behaviour is unchanged. Re-run after formatting: 4 of 4.
- Regression checks run after the fix (local): `probe-exit-races` 8 of 8, `probe-history-sequences` 21 of 21, `probe-close-motion`
  and `probe-viewer-close` pass, unit tests `tests/web tests/studio` 498 of 498, biome clean on the two new probes, `check:secrets` clean.
- Verified on the fixed production build: the phone rapid-press sequence (see the phone correction release above).

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

**NOT verified on production (phone):** a visible zoom control (none is drawn on a phone).

**Other environment notes.** `npm run typecheck` fails on this branch in every `scripts/verify/probe-*.ts` file (the node typecheck has no
DOM types for them), including the earlier committed probes, so it was already red before the two probes added here. The two new probes
follow the same convention as the rest of that family.

**Deploy steps for the phone fix (performed; kept for the record).** It is one changed file (`web/studio/bc/polish.css`), so the deployment is the same
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
- The phone Team Chat close fade is fixed and deployed (see the phone correction release in section 0).

## 5. Release steps and the authorisation required

Steps 1 to 5 were performed for the release at `a5363d94` (section 0). The phone correction went through the same steps and is recorded
in section 0 under "Phone correction release".

### Version 0.1.0 on the home screen (deployed)

- `main` fast-forwarded to `0ee3abda` (`git push origin 0ee3abda:refs/heads/main`, no force). The change: `package.json` version
  (0.1.0) written into `config.js` by `scripts/config-site.ts`, shown in the home board's top-right corner (`web/studio/bc/shell.js`,
  `refine.css`). Rules in `docs/VERSIONING.md`.
- Deployment `dpl_4RsRF3zzWjBfXebaobprehVkJDv3` (READY, production, `gitCommitSha` `0ee3abda`); three files uploaded, 142 of 142
  tracked studio files and `config.js` byte-identical to `0ee3abda` afterwards.
- Live check (Sample visitor, read-only apart from the Sample's own sign-in): `v0.1.0` at 12px, top right of the home board, title not
  clipped, on desktop and phone. Mobile Team Chat regression re-run on this build: 11 of 11.
- Rollback: `dpl_8Guk3knuaHbz7aWaU3WR7EWcXby2` (the phone correction, `d75b651a`).
