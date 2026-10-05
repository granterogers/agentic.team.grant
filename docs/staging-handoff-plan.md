# Staging handoff plan - Team HQ UX branch -> integration -> staging

Written 5 October 2026, updated on the integration branch `integration/team-hq-ux-on-p4` (p4 `1c2e0293` + the frozen UX branch `f91c4c1f`). Nothing here has been executed. Production is not touched at any step; staging is a SEPARATE
Supabase project, a SEPARATE Vercel preview, and separate Google / Telegram / Slack / Vikunja credentials.

The purpose of staging is to FIND failures local fakes could not. A row moves PARTIAL -> TESTED / VISUALLY VERIFIED
only when the real evidence exists. A failing real-service test is recorded as it happened, diagnosed (code defect
vs environment), fixed if code, retested; the row stays PARTIAL until genuinely proven. No assertion is weakened.

## 0. State (integration done locally; nothing deployed)

| | |
|---|---|
| Integration branch | `integration/team-hq-ux-on-p4`: p4 `1c2e0293` + the frozen UX branch `f91c4c1f` merged `--no-ff` (textually clean) + the integration fixes below. p4 and the UX branch are untouched. |
| Migrations | p4 ends at 0896. This branch adds, in order: 0897 0900 0920 0921 0922 0923 0924 0925 0930 0940 0950 0960 0970 0980 0981 0990 0991 1000 1001 1010 **1020**. No collisions; no renumbering. `scripts/isolated/replica.sh` replayed the whole history, each migration in its own transaction stopping at the first error, through 1020. |
| Integration fixes (this branch only) | p4 forensics collectors join the production-access guard; CLAUDE.md states the safety contract; DOC-026 background indexing (1020); the Import gate fails closed; staging preflight + held-duties posture; replica proofs no longer import gated commands; the default arrangement no longer overlaps itself on a narrow stage; the grid-era torture suite is rewritten for the freeform model; a stale 16px check is measured on a touch phone. |
| Failures that are p4\'s own | 42 of 68 canonical `run-all.sh` proofs, and the p2 attack/sabotage/plants set, fail identically on p4 alone (`jobs.office_id` NOT NULL against pre-multi-user fixtures, a replica builder that re-applies 0654). The integration branch matches p4 on all 68 after the one fix above. Not caused by, and not fixed on, this branch. |

## A. Integrate

Done on `integration/team-hq-ux-on-p4`. Nothing merges into p4 or main without Grant. A pull request is opened only when asked.

## B. Migrations

Apply in the order above. Hard dependencies: 0991 needs 0900+0960+0990; 1010 needs 0896+0900+0960+0990+0991+1000; 1020 needs 1010; 1001 needs 0970; 0940 needs 0900. Applied migrations are immutable; a defect found in staging is fixed with a NEW migration (1021+). `0584` is the one recorded historical collision.

## C. Staging safety, before anything is created or deployed

1. Grant creates (or confirms) a staging Supabase project; the production ref goes in a local, git-ignored `.staging/production-identifiers.json` with every other production identifier (`{"refs":[],"hosts":[],"identifiers":[]}`: Google client id, bot username, Slack team id, Vikunja host, bucket name).
2. A dedicated shell exports ONLY staging values (`npm run staging:preflight -- --template` lists them). `npm run staging:preflight` must print `STAGING PREFLIGHT PASSED`. It refuses an unset project ref (scripts default to the production ref), a ref typed two ways that disagree, any address that names another project, a Vercel environment that is not `preview`, a production-named identifier anywhere in the environment, and an integration nobody named. NOTE: the sandbox this was written in exports `NEXT_PUBLIC_SUPABASE_URL` naming production and the preflight correctly refused it.
3. The production guard is target-agnostic (it recognises Supabase hosts): `ALLOW_PRODUCTION_CHECKS=1` / `ALLOW_PRODUCTION_WRITES=1` open staging AND production alike. The preflight, not the flags, says which one the shell points at.

## D. Fresh staging database

Replay `migrations/` 0001..1020 into the empty staging project (`npm run migrate` with both flags and the staging environment). Free tier is 500 MB. Seed two test offices through the product\'s own sign-in path.

## E. Deploy, in this order (derived from the code, not from the earlier report)

1. `npm run staging:posture -- hold` **before any worker exists**. It refuses unless the preflight passes and unless the database has migration 1020 (a hold the database does not honour reads as safe and is not).
2. `npm run staging:preflight -- --live` (needs `ALLOW_PRODUCTION_CHECKS=1`): the duties are held AND honoured. Only then:
3. `deploy:worker` -> `deploy:hq` (`hq-api`; its bundle includes the new Deno `preview.ts`, never compiled by a real deploy, so expect the first failure here) -> `deploy:mcp` -> the web page as a Vercel PREVIEW. Telegram, Slack, voice stay undeployed until a test needs them, and then only with separate test bots.
4. Allow duties one at a time: `npm run staging:posture -- allow calendar-event-sync` and so on. `drive-index` additionally ships switched OFF: `update public.responsibilities set enabled = true where slug = 'drive-index'` for the staging office, then `allow drive-index`.

Version skew, read from the code: a NEW worker on an OLD database is safe (the Import gate fails closed; style-keep says nothing was saved; the preview writes are guarded; `drive.index` has no duty until 1020). An OLD worker on a NEW database is safe (1010 gates the SQL doors, the 1020 duty is off and the hold is honoured by SQL, not by the worker). The only window is a fetch job queued before 1010 and run by an old worker, which the SQL gate at enqueue time makes small. **Migrations first, then the worker.**

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
