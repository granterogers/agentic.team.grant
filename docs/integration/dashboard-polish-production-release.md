# Dashboard polish: production release record (11 October 2026)

**Status: LIVE.** Page only. Source: `main` at `f2044df6f7ec28759fa1c51b2f7f8a6d3c5590a8` (PR #459).

| | |
|---|---|
| New production deployment | `dpl_3otBfKtZsGatfqgu1SgeJjVPb7Ld` (READY, serves the new page) |
| Previous production deployment (rollback target) | `dpl_E1J5U7iX4SDAH9Jo4hW8g9W5DQ2W` (READY, production, built from `047f6f17`) |
| Project and URL | Vercel project `ai-team-hq`; https://ai-team-hq.vercel.app and https://ai-team-hq-agentic-team-grant.vercel.app |
| Method | `ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/deploy/hq-page-delta.ts --allow-new=<the 8 new names> --go`, from a clean pushed `main` checkout (provenance check passed); the flags were set for that command and the dry run only |
| Not touched | Supabase functions, migrations, backend services, voice, auth, environment variables, secrets, settings, other branches |

## Preflight
- The dry run refused the first time, correctly: names only here were the four files this release adds (`bc/appearance-pane.js`, `bc/identity.js`, `bc/polish.css`, `bc/refine.css`, each at the root and under `studio/`); names only live were the generated `config.js` (root and `studio/`, gitignored, not a credential) and Vercel's function outputs.
- **Byte comparison of the live page with the release tree:** 227 of 275 comparable files identical; the 48 that differed (24 files at two paths each) were each **byte-identical to the same file at `3caaebfe`** (the previous main), so the live page equalled previous main plus `config.js`, and nothing existed only in production. `npm run config:site` regenerates a `config.js` whose SHA-1 (`4b6d29c9...`) equals the live file's, so it was included unchanged.
- After the dry run with `--allow-new` naming exactly those eight names, only Vercel's function outputs differed.
- Rollback readiness: the previous deployment is READY and retained, is the project's production deployment before this release, and the script printed it as the rollback point. Restoring the page involves no function deploy. Mechanism: promote that deployment in Vercel (the method used for every earlier page rollback in `docs/ux/deploy-442-445.md`). A promotion was not rehearsed against production, because doing so would itself change what is live.

## After the deploy
- The live page is **byte-identical to the release tree: 285 of 285 files**, none differing and none live-only.
- Live smoke, signed in to the public **Sample Office** as a guest through the real production gateway and signin function (read-only; no message sent, no task or setting changed), real Chromium at 1440x900 and 390x844, Light and Dark, 100 checks, all passed: the entry screen, the guest session opening the Sample, project board, To-dos (cards with priority, in-progress, done and label chips on real Sample data), Contacts, Schedule, Activity, Documents, Project Settings and the Appearance pane (three sliders), the chat control present, no horizontal overflow on any page, no page or console error, no failed or 4xx/5xx request, requests only to the page host and Supabase.
- Sandbox artefact, not a product defect: about one response in a thousand arrives at the build sandbox's browser as a 502 or `text/plain` with **no `x-vercel-id`, no `server` header and a 23-byte body** (the documented proxy behaviour). Server-side, 263 of 264 requests for the page's scripts and styles returned the right type with `x-vercel-id`, and the one failure was a TLS EOF in the tunnel. A page that drew half-loaded was reloaded once by the harness (none needed in the final run).
- `check:icons` against production (read-only, `ALLOW_PRODUCTION_CHECKS=1` only): passed (451 marks, 61 terms, 39 defaults, 7 live connectors, 0 without a glyph).

## Classification of production checks
| Check | Result |
|---|---|
| Byte comparison live against source | passed (285 of 285) |
| Public page and guest-session Sample smoke (desktop and phone, Light and Dark) | passed |
| `check:icons` against production | passed |
| Real person sign-in (Grant or the Sample Person) | **not run**: it needs a real credential, which this release did not use; the guest Sample session exercises the same gateway and page code, not the sign-in form |
| Chat message to the team, any write | **not run** (not authorised: would send a message or change data) |
| `basecamp-look` production leg | **not run** (it writes a project look to a real project and reverts it) |
| `gate:safe` | not run |

## Rollback
Promote `dpl_E1J5U7iX4SDAH9Jo4hW8g9W5DQ2W` in the `ai-team-hq` Vercel project (then confirm the alias serves it and rerun the byte comparison against `3caaebfe`). No data, function or migration is involved. For the code, `git revert -m 1 f2044df6` through a reviewed PR; main itself was not changed by the deploy.

## Closeout
Re-read on the closeout date from the Vercel API (read-only): the `ai-team-hq` production deployment is still `dpl_3otBfKtZsGatfqgu1SgeJjVPb7Ld` (READY, both aliases, source commit `f2044df6`), the previous deployment `dpl_E1J5U7iX4SDAH9Jo4hW8g9W5DQ2W` is still READY, and the site answers 200. The byte comparison, the 100 Sample smoke checks and the production icon check above are the historical results of the release run and were not repeated for the closeout. The release is complete for the Dashboard Polish scope only; the accepted limitations below are carried forward, not resolved.

## Remaining limitations (accepted, with follow-up)
No authenticated personal-account smoke test was part of the deployment report; production write-path tests were deliberately excluded.
No real iOS Safari or physical-device run; the Problems filter and Google source shapes appear only when records carry severity or Google is connected; Jump is keyboard-only (ADR-0068).
