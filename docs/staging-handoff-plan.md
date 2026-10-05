# Staging handoff plan - Team HQ UX branch -> integration -> staging

Written 5 October 2026 against `claude/team-hq-ux-overnight` (feature phase FROZEN) and `claude/multi-user-p4`
at `1c2e0293`. Nothing here has been executed. Production is not touched at any step; staging is a SEPARATE
Supabase project, a SEPARATE Vercel preview, and separate Google / Telegram / Slack / Vikunja credentials.

The purpose of staging is to FIND failures local fakes could not. A row moves PARTIAL -> TESTED / VISUALLY VERIFIED
only when the real evidence exists. A failing real-service test is recorded as it happened, diagnosed (code defect
vs environment), fixed if code, retested; the row stays PARTIAL until genuinely proven. No assertion is weakened.

## 0. State of the two branches (read-only analysis, done)

| | |
|---|---|
| p4 HEAD | `1c2e0293` (4 commits past the merge base `5e3eafa6`, all Supabase forensics: docs, `scripts/forensics/*`, tests, 9 `forensics:*` npm scripts) |
| p4 migrations | end at **0896**; p4 added **none** since the base |
| UX branch migrations | 20 new files, 0897 .. 1010, all unapplied, none of them numbered on any other remote branch |
| Number collisions | **none** (no remote branch carries a migration >= 0897 that this branch lacks; `check:migrations` passes on a trial merge) |
| Textual merge | **clean** (trial merge in a throwaway worktree, then deleted; overlaps `docs/HANDOFF.md` and `package.json` auto-merge) |
| Semantic conflict | **one**: p4's forensics scripts talk to the Supabase Management API with the access token and carry no production-access gate, so `tests/safety/production-gate-coverage.test.ts` fails 2 tests after the merge (`forensics:capture|logs|usage|metrics|temp-logging` and `scripts/forensics/{common,customer-metrics,host-capture,logs-capture,temp-files-logging,usage-capture}.ts`). tsc passes. |

## A. Integrate (merge, not rebase; the branch has 77 commits that others may have fetched)

1. `git checkout -b integration/team-hq-ux-on-p4 origin/claude/multi-user-p4`
2. `git merge --no-ff origin/claude/team-hq-ux-overnight` (expected: no conflicts).
3. Close the one semantic conflict ON THE INTEGRATION BRANCH (never on p4): first import of each of the five collectors
   (`host-capture`, `logs-capture`, `usage-capture`, `customer-metrics`, `temp-files-logging`) is
   `../../src/safety/require-production-checks.ts`; `common.ts` imports `../../src/safety/arm.ts`; classify the nine
   `forensics:*` commands in `docs/testing/production-access.json` and `docs/production-access-guard.md` (read-only).
4. Gate on the integration branch: `tsc`, `biome ci`, `check:templates`, `check:migrations`, full vitest (only
   `weather-is-not-a-failure` may fail), the isolated proofs on a rebuilt replica, the Playwright suites in the closure report.
5. Push the integration branch. Nothing merges into p4 or main without Grant.

## B. Migrations

No renumbering is needed. Order (all 20, ascending): 0897 0900 0920 0921 0922 0923 0924 0925 0930 0940 0950 0960 0970
0980 0981 0990 0991 1000 1001 1010. Hard dependencies: 0991 needs 0900+0960+0990; 1010 needs 0896+0900+0960+0990+0991+1000;
1001 needs 0970; 0940 needs 0900. Applied migrations are immutable: if staging exposes a defect in one, fix it with
a NEW migration (1011+). Re-run `check:migrations` after the merge; `0584` is the one recorded historical collision.

## C. Fresh staging database

1. Grant creates (or confirms) a staging Supabase project. Record its ref; record the production ref as a BLOCKLIST value.
2. Preflight before anything else (shell variables name the staging ref only; assert `SUPABASE_PROJECT_REF != production`).
   NOTE the guard is target-agnostic: `ALLOW_PRODUCTION_CHECKS=1` opens ANY `*.supabase.co` host, staging included,
   so the only protection against pointing at production is the environment you export. Use a dedicated shell.
3. Bootstrap by replaying `migrations/` 0001..1010 into the empty project with `ALLOW_PRODUCTION_CHECKS=1
   ALLOW_PRODUCTION_WRITES=1 npm run migrate`. Free tier is 500 MB: watch size (p4's forensics work is about
   degradation under load).
4. Seed one real office + one second test office (for G/P) through the product's own sign-in path, not SQL.

## D. Apply in dependency order -> E. Deploy in dependency order

Migrations first (all of D), then: worker (`deploy:worker`) -> `hq-api` (`deploy:hq`; its bundle includes the new Deno
`preview.ts` and has NEVER been compiled by a deploy, so expect the first failure here) -> `mcp` -> web as a Vercel
PREVIEW deployment pointed at staging (never the production alias). `google-oauth` is unchanged in code. Telegram,
Slack, voice stay undeployed unless a test needs them, and then only with separate test bots (see Risks).
Each deploy probes itself and fails when the probe fails; stop at the first failure.

## F. Staging-safe gateway and security checks

`check:gateway-wrappers`, `check:callers`, `check:consumed`, `check:anon-exposure`, `check:icons`, `check:capabilities`,
`check:answerable`, `check:ownership` (non-replica), `check:leaks`, `check:pressable`, `verify:wrappers`, `verify:hq`.
Expect real findings: wrappers for `document_preview*`, `integration_connections` grants, new tables' RLS.

## G. Tenant isolation, end to end (before any real Google data goes in)

Two real test offices, two browser contexts, deployed gateway: each cannot list, read, preview, import, restore,
approve or search the other's projects, documents, calendar, styles, connections, Activity. Includes `document_import`
with the other office's document id and with a forged office. Evidence: network log + screenshots. Closes QA-015 only if all hold.

## H. Connect a real test Google account

Separate Google OAuth client (staging redirect URI), a throwaway Google account with Calendar + Drive. Grant performs
the consent. Check migration 1000 live: one `integration_connections` row, `active`, scopes recorded; disconnect marks it `revoked`.

## I. Google behaviours (CAL-009..019, DOC-027..031, DOC-054)

Calendar: real data; project / all / Google-combined scopes; create, edit, delete both ways; etags stored; If-Match on
update/delete; provoke a 412 by editing in Google between read and write and confirm "later writer wins, nothing
overwritten unseen"; timezone and all-day events across a DST boundary; clock skew. Drive: browse a test folder; on-demand
read of a Doc, Sheet, Slide, text, Word, PDF, image; first-page PDF and image thumbnails; quota/403 bodies; a 25 MB PDF
through the edge function (memory/time limits); CORS for the binary section from the real page origin; Import; stale
refetch after a source edit. Disconnected-source refusal: switch the folder off and revoke Google, press Import (UI,
direct RPC, MCP) and expect `SOURCE_DISCONNECTED`; the imported copy must survive; reconnect must restore import.

## J. Vikunja (VIC-003, VIC-007)

Grant supplies a test Vikunja + token. Create / edit / pull / delete / title collision / outage / token refusal against it;
confirm the Settings Services chip and the Reconnect chore with a real outage (stop the server).

## K. External ChatGPT / Claude (EXT-003..013)

Grant adds the staging MCP URL + bearer as a connector in ChatGPT and in Claude. Call each tool for real:
`search_project, list_tasks, create/update_task, list/create/update_event, inspect_activity, ask_team, start_research,
generate_artifact`; confirm `delete_event` is absent; confirm a refused import via MCP returns the typed error.

## L. gateway -> SQL -> search -> palette (SEARCH-004, 007..009)

Type in the palette against the deployed gateway; results from tasks, documents, passages, saved pages, sources,
research, chat; per-project and all-project; second office sees none of it.

## M. Activity provenance (ACT-010, 011)

One action from each door - Team HQ, ChatGPT, Claude, Telegram, Slack - and confirm the chip on the Activity row.
Needs separate test bots and a test workspace (see Risks).

## N. Web research in the deployed runtime (WEB-002, 004, 007)

Run a research job on the deployed worker; expect the honest "slow down" if the search service challenges the address;
read a page, follow one hop, refuse a private address, safe-download allow-list, Storage write path.

## O. PDF / logo against real storage (PDF-015)

Make a report with a pale logo, a wide logo, a thin logo and a long title; the logo is fetched via signed link from the
staging bucket; open the PDFs and look.

## P. Tenant isolation through the browser (QA-015)

Repeat G through the UI with two signed-in browsers, including deep links and stale tabs.

## Q. Final visual QA on the integrated staging build

1440, 1280, 768, 390x844 and reduced motion: home, calendar views, documents (every preview state, rollback, imported,
thumbnails), Activity, palette, Settings > Services, maximise/restore, spatial transitions. Grant judges VIS-001/003.

## R. Ledger

Update the 331-row ledger only with evidence from the steps above: PARTIAL -> TESTED / VISUALLY VERIFIED row by row,
each citing the run. Rows that staging disproves stay PARTIAL with the exact failure recorded.

## Needs Grant

Staging Supabase project and keys (in its vault); Vercel preview environment variables; a separate Google OAuth client +
a test Google account and the consent click; a test Vikunja server + token; ChatGPT and Claude connector setup (paid
plans may be needed); separate Telegram test bot(s) and a Slack test workspace; a decision on DOC-026 (agents reading Drive
in the background); the visual judgement; approval to merge anything into p4 or main; whether `CLAUDE.md` should
mention `ALLOW_PRODUCTION_CHECKS` (left untouched).

## What could make staging unsafe

1. The guard flags are target-agnostic: with production credentials exported, `ALLOW_PRODUCTION_CHECKS=1` WILL reach production. Use a dedicated shell with staging values only.
2. Reusing the production Google OAuth client, Telegram bots or Slack app would change production OAuth or message Grant's real chat. Use separate ones and register test destinations first (#381).
3. Migration 1000's backfill reads the vault; on staging it must only see staging secrets.
4. Duties fire on a timer: a deployed staging worker with real credentials runs real Drive/Calendar sync and could message or write. Keep announce channels pointed at test destinations.
5. Supabase free-tier limits and the p4 forensics findings about idle cost: do not load-test the staging project beyond need.
6. `hq-api` has never compiled the Deno preview code in a real deploy; `hq_document_import` is now server-gated, but a worker older than 1010 fails open on a missing gate function by design: deploy migrations before the worker.
7. Calendar delete tests must use a throwaway calendar.
8. Do not run `purge:*` or `sample:*` against staging without reading the target first.
