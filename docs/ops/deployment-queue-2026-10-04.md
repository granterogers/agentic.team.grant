# Deployment queue, 4 October 2026 (production frozen)

**Status: NOTHING BELOW IS APPLIED OR DEPLOYED.** Supabase read auth, db, rest and storage UNHEALTHY at two readings on 4 October
(17:28 and 18:20 UTC), after more than two hours of the same earlier in the day. Production interaction is suspended: no
migrations, no deploys, no production suites, no model calls, no queue changes. This file is the authority for what resumes
first; if it disagrees with a chat, this wins. Checkpoint: branch `claude/multi-user-p4`, last pushed commit before this file
`596eb079`.

## Update, 5 October 08:30 UTC: the platform recovered; the queue is HELD, and why

Provider health read all ok and the metrics scrape answered 200 from 07:37 UTC; the guarded database probe completed (28 statements).
**Nothing in this file has been applied or deployed.** Two reasons, both from `supabase-forensics-2026-10-05.md`:

1. Grant's latest instruction says not to deploy unrelated product work while the forensic investigation runs.
2. Steps 6 to 9 below (browser acceptance suites, `gate:safe` parts, the Sample tour) are the same kind of burst that preceded the persistent
   onsets of 2, 3 and 4 October, each followed by 10 to 19 hours of unavailability at zero traffic. Steps 1 to 5 (five small migrations, three function
   deploys, a page delta) are light. **Decision needed:** run steps 1 to 5 now with a scrape before and after each and an abort at the first timeout or
   cron dip, and hold 6 to 9 until the controlled-ramp experiment (report, section 11) has said what burst the host tolerates, or run everything now.

## Update, 5 October 11:50 UTC: ONLY the sign-in fix has been deployed

By Grant's instruction: `signin` function v122 to v124, and a page built from the **live bytes plus the sign-in diff only** (`dpl_41Ts4Gd5PUAcaazN93dxofCvbK6M` to `dpl_8QwvvES1oRridjeokGzu2MMGdEYm`).
Everything else in this file is **still not applied or deployed**. Warning for whoever runs step 5 later: `hq-page-delta.ts` ships the whole working-tree page, which now also differs from live in
`bc/compose.css`, `project-settings.js`, `settings-ui.css`, `settings-ui.js`, `settings.js` and `undo.js` (the queued confirmation-dialog and Slack-card changes); the Slack card needs 0892/0893 and the
`hq-api` change first. Details and rollback points: `supabase-forensics-2026-10-05.md` section 12.8.

## Earlier update, 5 October 11:30 UTC: still HELD; steps 1 to 5 assessed as separable; the sign-in fix was a candidate step

Grant's latest instruction keeps steps 6 to 9 held, asks for a recommendation on steps 1 to 5 before anything runs, and makes the sign-in path a V1 blocker.
**Nothing has been applied or deployed.** The assessment is in `supabase-forensics-2026-10-05.md` section 12.5: steps 1 to 5 are light (catalog-only SQL, three function
uploads, a static page) and can run serially while healthy with the cron canary as the abort signal, **but only with Grant's explicit go**. Candidate step 5b, after review:
`deploy:signin` plus the page delta carrying `web/studio/net.js` (the bounded-request fix; `verify:auth-hang` 14/14, was 5/14). The live abort signal for every step is
`cron.job_run_details` for job 1: all of the last five runs `succeeded` in under 1 s, ten runs in the last ten minutes; stop at any "job startup timeout".

Capture around the deployment now uses: `npm run forensics:metrics` (one raw scrape, rates against the previous one), `npm run forensics:logs`,
`npm run forensics:usage`, `npm run forensics:capture -- --db` (its guard now accepts the endpoint's HTTP 201), `npm run forensics:preserve`.

## What is waiting

| Item | State | Why it matters |
|---|---|---|
| Migration `0892` (`app.slack_install_client`, `public.slack_link_client`) | written, replica-proved, NOT applied | The Settings card and `slack-oauth` read the client id and scopes through it. |
| Migration `0893` (a person's own workspace counts as an installation) | written, replica-proved (`slack-send.ts` 18/18), NOT applied | Without it a person's connected workspace is IGNORED by `slack-events` while the page says connected. Apply with, or before, the worker. |
| Migration `0894` (a passage of only whitespace is not content) | written, replica-proved (`chunks.ts`: red before, green after), NOT applied | `app.chunk_text` and `app.index_document_chunks` used `btrim`, which strips spaces only. Re-indexes any affected document (none expected). Apply with 0892/0893; no service depends on it. |
| Migration `0895` (`ai_team_app` reaches no public function) | written, replica-proved (`anon-surface.ts` 27/27), NOT applied | A revoke of 37 legacy grants (a Google-secret writer, a setting writer, roster, MCP registration, project delete, enqueue) from a NOLOGIN, passwordless role nothing connects as. Independent of every other item; safe to apply with them. |
| Migration `0896` (a disconnected source leaves active retrieval, ADR-0066) | written, replica-proved (`detach-retrieval.ts` 24/24 incl. sabotage), NOT applied | Grant's decision of 4 October. Splices `search_documents`, `best_chunks` and `project_knowledge` from their live definitions. Apply BEFORE the page and worker below: the new Disconnect sentence and the worker's brief both assume it. Reversible by re-attaching (nothing deleted). |
| `hq-api` | changed after its last deploy (`slack_link*` sections and actions, `oauth.ts` symlink) | `deploy:hq-api` uploads `file-text.ts` and `oauth.ts` beside `index.ts`. |
| `slack-oauth` (new function) | never deployed | `npm run deploy:slack-oauth`. Needs `slack.client_id` set before it can do anything. |
| `worker` | changed after its last deploy (install-aware Slack channel `src/slack/installs.ts`, envelope miss ceiling, Drive-bytes text path) | `deploy:worker` sets `slack.per_office_delivery` only after its probe passes. Read the deployed version first: if the Drive text path or the ceiling already shipped, the delta is the Slack channel only. |
| Page (`web/studio`) | changed (in-page confirmation for every destructive control, phone header icons, Slack card, `noticeDialog`) | `npx tsx scripts/deploy/hq-page-delta.ts` (dry run), then `--go`. |
| `slack-events`, `telegram` webhook | NO change in this window | 0893 is database-side. Do not redeploy them. |

Applied already (production): through `0891` (761 migrations). `0888` chunks, `0889`, `0890`, `0891` Slack installs are live.

## Order after recovery, serialised, stop on any degradation

1. **Judge recovery on function, not one green endpoint.** `GET /v1/projects/<ref>/health?services=auth&services=db&services=rest&services=storage` is necessary, not sufficient. Also require a trivial `select 1` through the Management API in well under a second, a sign-in token endpoint answer, and connection count sane against the 57-slot limit. One reading at a checkpoint; no polling.
2. `npm run incident:snapshot` (once). Note `temp_bytes`.
3. `npm run check:migrations` then `npm run migrate` (applies 0892, 0893, 0894, 0895, 0896 and any later pending file only; refuses on any checksum drift, which is correct).
4. `npm run deploy:hq-api`, probe, then `npm run deploy:slack-oauth`, probe (expect "no client id yet" until step 8, which is the honest state), then `npm run deploy:worker`, probe. One at a time; stop if any probe is not clean.
5. Page: `hq-page-delta.ts` dry run, read the file list, `--go`.
6. Smallest relevant verification, in this order: `npm run verify:slack-link` (production, rolled back), `npm run sample:confirm-ux`, `npm run sample:documents`, `npm run verify:phone-header` against the live page at 320/360/390/430.
7. `npm run gate:safe -- --part=static`, then `--part=production`, `--part=identity`, `--part=ops`, serially, each to a file with an explicit timeout; read the exit code, not the tail.
8. Fingerprints: the gate prints Grant and the 24 other offices before and after; any movement outside the TEST office is a stop.
9. Then the Sample acceptance (`sample:tour`, `sample:use`, `sample:reset`).

## Grant: Slack configuration (nothing here can be done by code)

1. Slack app settings, **Manage Distribution**: activate public distribution.
2. **OAuth & Permissions**, Redirect URLs: add `https://<project-ref>.supabase.co/functions/v1/slack-oauth` (the ref is in the Supabase dashboard URL).
3. Put the app's **client id** (public) in `system_config` key `slack.client_id`. The client secret is already in the vault as `slack.client_secret`; do not paste it anywhere.
4. Bot scopes are the defaults in `src/slack/oauth.ts` (`DEFAULT_SLACK_BOT_SCOPES`); override with `slack.bot_scopes` only if Slack refuses one.
5. **MANUAL REAL SLACK INSTALL ACCEPTANCE REQUIRED:** as the Sample person, Settings, Messaging, Connect Slack, approve in a workspace you administer, return to Team HQ, say hello in a DM to the bot, see the answer come back in Slack from THAT workspace's bot; disconnect, say hello again, see nothing answer. Check the Grant fingerprint did not move.

## Supabase temp files (owner action)

**Corrected 4 October (late):** the earlier line here said the role and the Management API cannot set `log_temp_files` and that support must.
That was never tried. The current Supabase docs list it as "CLI + SQL, no restart" and the API spec accepts it (`docs/ops/supabase-forensics-2026-10-04.md`
section 1). It is still a configuration change, so it needs Grant's approval, and the value should be **`0`** (log every file; the average temp
file is 5.5 MB, so 10 MB would miss most). Prepared: `npm run forensics:temp-logging` (dry run by default; `--apply` needs
`GRANT_APPROVED_DB_CONFIG=log_temp_files` and a healthy platform). Do not raise `work_mem`, resize compute or disk, change connection limits or
disable duties without evidence. Status of the producer: UNKNOWN (about 1 GB of 384 GB is attributable to tracked statements: MEASURED; the
remainder: UNKNOWN).

## Forensic capture around the deployment (read-only; protocol in `supabase-forensics-2026-10-04.md` section 5)

* **Now, a person, before about 15:00 UTC on 5 October:** screenshot the dashboard's Observability, Database charts (memory with swap, CPU, disk IOPS,
  Disk IO % consumed, connections) for the last 24 hours. They are the only per-minute history and expire.
* **Each check while unhealthy:** `npm run forensics:capture -- --control-plane --gap=0`; on the first check also `-- --logs`. No database statement.
* **At recovery, before step 3 below:** `forensics:capture -- --control-plane --gap=60` then `-- --db` (refuses by itself unless the host answers fast).
  Record `temp_bytes`, the per-table sizes and the active-office count it prints.

## Still MANUAL, never to be claimed from automation

- VOICE NOTE: MANUAL REAL-MIC IPHONE ACCEPTANCE REQUIRED.
- TALK TO TEAM: MANUAL REAL-AUDIO IPHONE ACCEPTANCE REQUIRED.
- REAL TELEGRAM PAIRING TAP ON IPHONE: MANUAL ACCEPTANCE REQUIRED.
- REAL SLACK INSTALL: MANUAL ACCEPTANCE REQUIRED (after the configuration above).
- `npm run backup:rehearse`: last passing restore rehearsal is 21 September.
