# Dashboard polish: production deployment handoff (11 October 2026)

**Status: MERGED to `main`; NOT DEPLOYED.** This document prepares the deployment. It does not authorise it, and nothing in it has been executed.

## 1. References
| | |
|---|---|
| `main` after the merge | `f2044df6f7ec28759fa1c51b2f7f8a6d3c5590a8` |
| Merge commit | the same commit (a GitHub merge commit, PR #459, parents `3caaebfe` and `2b227f41`) |
| Release candidate head | `2b227f41718679c0e6de184b6de7cd08a68a2f55` |
| Previous `main` | `3caaebfe932c6e220c4d21b5670820b6a7c1d1b0` |
| Pull request | https://github.com/granterogers/agentic.team.grant/pull/459 |
| Gallery (visual reference) | https://hq-visual-review-k7x2m9.vercel.app (page code as of `422ba454`) |
The merged tree is byte-identical to the candidate's (`git diff 2b227f41 f2044df6` is empty).

## 2. What changed, and what did not
- Changed: `web/studio` (28 files), tests and verification scripts, documents and screenshots, one npm script (`deploy:gallery`), one `.gitignore` line.
- **Not changed** (`git diff 3caaebfe f2044df6 -- migrations supabase src`): migrations, edge functions, worker and gateway source, dependencies, environment variables, workflows, deployment configuration.
- Therefore a release of this work is **a page deployment only**. No function deploy and no migration is needed or wanted.
- `git diff 047f6f17 f2044df6 -- supabase src migrations` is empty: the V1 release commit that production's functions were deployed from (worker v980, hq-api v903, `docs/ops/deployment-state.json`) is in `main` and the backend code in `main` equals it. The only difference between that commit and `main` in the page is exactly the 28 `web/studio` files of this release.

## 3. Verification at the merged commit
All run locally on the merged tree, no production flag or credential: `tsc` and `biome ci` pass; vitest 6853 passed, 21 skipped; `verify:critical` 68/68 (3682 assertions); branding, templates, secrets, migrations (814/814), tokens, deployment-state and proof-registry checks pass; aesthetic QA 289/289; `basecamp-measure` (no absolute violations), home, touch, appearance, preservation, keyboard, routes, classes, reconcile, stale-answer, journey, calendar-ui, canvas-local, chat-local, dialogs-local, phone-header-local and docs-preview-ui all exit 0; populated-state suite 208/208. The repository has no push-triggered CI, so there are no GitHub check results for the merge; the results above are the verification.

## 4. Known limitations
- Chromium emulation only: **no real iOS Safari or device run**.
- The Activity "Problems" filter appears only when records carry a severity (the office stores none today); Google source shapes appear only with Google events. Both are correct when absent.
- Jump has no touch entry point (Cmd or Ctrl plus K only, ADR-0068).
- `verify:wired` is red on an obsolete premise (classic studio); `basecamp-look`'s production leg and production `check:icons` have not been run.

## 5. Prerequisites before deploying
1. Explicit authorisation to deploy, naming the page. Production flags are set only for that command (`docs/production-access-guard.md`).
2. Re-fetch `origin/main`; if it is not `f2044df6` (or a descendant containing it), review the new commits first.
3. A clean tree at a pushed commit (the provenance rule, ADR-0067).
4. **Compare live bytes first (the historical trap).** The page production serves has differed from `main` before (the efficiency workstream's page was live when a main-based page was about to replace it). `docs/ops/deployment-state.json` records the last live reading (9 October: deployment `dpl_6zXtX...`, 273 of 273 files identical to an earlier main tree) and a later page deployment `dpl_E1J5U7iX4SDAH9Jo4hW8g9W5DQ2W` from the V1 release whose source tree is not stated. **Do not assume the live page equals `047f6f17` or `main`.** Run the read-only comparison, which changes nothing: `ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/deploy/hq-page-delta.ts` (without `--go`), and additionally hash the live files and compare with `git show 3caaebfe:web/studio/<file>` for the files this release touches. If the live page contains anything that is in neither `3caaebfe` nor this release, carry that diff into the deployed tree; never overwrite it.
5. Take the rollback point (section 7) before deploying.

## 6. Deployment method (when authorised)
`npm run deploy:hq-page` (`scripts/deploy/hq-page-delta.ts`): digest upload of only changed files, refuses when the file NAMES differ from live, prints the previous deployment. It touches no function, secret, environment variable or setting. `npm run deploy:hq` is not suitable (its page step exceeds Vercel's 10 MB limit).

## 7. Rollback
- **Page:** promote the previous deployment recorded at deploy time (`docs/ops/deployment-state.json` lists `page.deployment: dpl_E1J5U7iX4SDAH9Jo4hW8g9W5DQ2W`, previous `dpl_6zXtXeMzJVMLgh1S8kr2xy86Eu41`; confirm which one is live at the moment of deploy).
- **Code:** `git revert -m 1 f2044df6` on `main` through a reviewed PR; there is no migration to unwind.
- The visual gallery is a separate static project; roll it back by redeploying commit `c84de051`'s gallery folder if ever needed.

## 8. Live smoke tests after a deployment
Signed in as the Sample Person (`docs/multi-user/SAMPLE-PERSON.md`), never as Grant: project board loads with the consolidated top bar; Settings, Project Settings, Appearance (change module opacity, reload, it persists, another project is unaffected); To-dos and Contacts cards; Schedule month on a phone-width window (44px day cells); Activity filters; Documents thumbnails for an uploaded PDF and picture (no 403s in the network log); chat opens and the board layout is unchanged; no page error in the console; response headers carry `x-vercel-id`. Record the deployed deployment id and the byte comparison in `docs/ops/deployment-state.json` in the same commit as the deploy record.

## 9. Release-specific warnings
- Page only. If anything asks for a migration or a function deploy, stop: it is not part of this release.
- The Hermes assessment (`docs/hermes/`) and the unified activity ledger are separate workstreams and are not in `main`.
- Another workstream's migrations may already be applied in production (`highestAppliedAtRecord: 1053`); this release adds none.
