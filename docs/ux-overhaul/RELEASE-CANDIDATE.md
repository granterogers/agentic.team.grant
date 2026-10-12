# Team HQ UX overhaul: release candidate status

Branch `claude/busy-darwin-21mr9n` at `deb5bf9`. Contains all of `origin/main` at `a37188d` (verified 12 October 2026: `git merge-base --is-ancestor origin/main HEAD` succeeds and no main commit is missing from the branch). Production: https://ai-team-hq.vercel.app

## Status: NOT release-ready

The release is blocked on open milestones, not on authorisation. Milestones M13, M15, M17, M18, M19 and M20 are open in
`docs/ux-overhaul/CHECKLIST.md`, and several others are partial. Section 4 lists each open item precisely.

## 1. What the candidate changes

- Frontend change set: `git diff origin/main HEAD -- web/studio`, 14 files: `app.js`, `appearance.js`, `index.html`, `studio.css`,
  and `bc/` `account.css`, `compose.css`, `layout.js`, `miniatures.js`, `polish.css`, `refine.css`, `shell.js`, `stone.css`,
  `tokens.css`, `wire.js`.
- Also changed: `tests/web/looks.test.ts`, `scripts/verify/probe-*.ts` (21 probes), `docs/ux-overhaul/`.
- Activity Ledger code is NOT changed by this branch. `git diff origin/main HEAD -- web/studio/bc/activity.js web/studio/bc/activity-model.js` is empty.

## 2. Live site versus main (verified 12 October 2026)

A public, unauthenticated GET of each of the 14 files from https://ai-team-hq.vercel.app returned 200 with a byte-identical
md5 to `origin/main`'s file in every case. So live equals `origin/main` for the frontend, and the branch diff is exactly the
change set to deploy. (An earlier draft of this note claimed the live `app.js` predated main's Activity Log code. It does not:
the live `app.js` equals main's and references `activity_ledger` once, as main does.)

## 3. Evidence

- Automated: `npx vitest run tests/web tests/studio tests/gateway tests/auth`: 677 pass in 46 files (recorded in the checklist).
  `check:templates` and `smoke`: recorded as pass.
- Browser: 21 probes in `scripts/verify/`. Each was recorded as exit 0 with zero page errors in its checklist row.
- Accessibility: axe-core, zero violations on the entry screen, overview, chat drawer, Global Settings and appearance sheet, light and dark.
- Review: the read-only review over `555ee9c..HEAD` returned two major findings (Escape history entry; Sources on non-Overview tabs),
  both fixed and re-probed. A second review pass (M18) was not yet complete when this note was written.
- Repository lint (`npm run lint`) is red on files this branch does not change. No finding is in a changed file. Pre-existing on main.

## 4. Open items (from the checklist's milestone list)

- M3 buttons: tertiary and destructive variants, and about 45 non-button gradients in `studio.css` not yet reviewed.
- M6 sliders: phone not probed; signed-in server persistence needs a writer.
- M7 motion: the appearance sheet and project settings close transitions not yet sampled as motion (dialog stability is probed).
- M10 Team Settings: save path needs a signed-in writer; live status line and a read-only usage line not built.
- M11 canvas: zoom levels, touch, overlapping modules and Post-it resize are listed open in the milestone list (the summary table marks
  them done; the milestone list is the stricter record).
- M12 Card Table: four columns only at 1440 px. Phone and a narrowed board are not four columns; horizontal scroll not built.
- M13 hamburger module navigation: open in the milestone list.
- M14 chat: phone capture of the drawer and re-verification of composer and voice after the change.
- M15 documents: thumbnails for images, markdown/text and spreadsheets not verified; signed-in gateway warm-up blocked (credentials).
- M16 calendar: phone measurement not yet taken (desktop verified).
- M17 screenshots per width (1920, 1440, tablet, 390) for each milestone: not complete.
- M18 independent review: second pass open.
- M19 merge to `main`, M20 staged deploy and production verification: not started.

## 5. External blockers (cannot be closed from this environment)

- Signed-in persistence (appearance, project settings, Team Settings save, Apply-with-upload) and the gateway document warm-up
  need a signed-in writer. The Sample Person or a real account needs production flags, which have not been authorised.
- Real sign-in and create-account send email; not exercised.
- No local Supabase stack (no Docker daemon, no local Postgres).

## 6. Deployment, once the open items are closed

1. Merge the branch into `main` after the review passes (fast-forward if main has not moved; re-check `origin/main` first).
2. Dry run: `npx tsx scripts/deploy/hq-page-delta.ts --root=web/studio`. It refuses if the file names differ from the live deployment.
   Requires `ALLOW_PRODUCTION_CHECKS=1` for the read.
3. Deploy: the same command with `--go`. Requires `ALLOW_PRODUCTION_WRITES=1`, set by Grant for this named write only. A Vercel
   token in the environment is not permission.
4. Verify: fetch the 14 files and compare md5 with the branch; run the read-only probes against production.
5. Rollback: keep the pre-deploy live copy (fetched in step 2 as above) and redeploy it with the same script and flags.
