# Version 1 production release report, 9 October 2026

Status is recorded section by section as it happens. Nothing below is claimed unless it is marked DONE with its evidence.

## 1. Release manifest (recorded BEFORE any release write, 20:2x UTC)
* **Branch** `claude/v1-integration-main-2026-10-09`, candidate code commit `b4204cdd` (main `b8ea3c0a` is its ancestor; 104 commits ahead; no merge to main is performed).
* **Production baseline read at 20:06 to 20:20 UTC** (read-only): platform health all four services ACTIVE_HEALTHY; ledger **803 applied, highest 1053** (1053 applied alone at 19:11 UTC, #457); P05 (deliveries a redrive would resend) **zero rows**; P06 zero; database 71.7% and storage 49.5% of the free tier; newest backup 2026-10-09 14:50:22 UTC (5.3 h old, 22 kept, restore proven into a replica); heartbeat active, one job running; Telegram: one enabled bot (the chief's).
* **Live versions equal the reconciled ones:** worker v976, hq-api v899, voice v659, signin v130 (and the six unchanged functions), Vercel production `dpl_6zXtXeMzJVMLgh1S8kr2xy86Eu41`. The live page is **byte-identical to `main`** (273 of 273 files; the only extras are the generated `config.js` and two notebook API stubs), so the candidate page (main plus 8 web files: `app.js`, `chat.js`, `call.js`, `session.js`, `flow.js` (new), `bc/shell.js`, `bc/wire.js`, `bc/compose.css`) overwrites nothing older.
* **Migrations:** exactly 1042 to 1052 (11 files, dry run lists exactly these; 1053 being recorded does not make the runner skip them, it selects by name). 1030 not included, no file exists. They add and redefine functions and backfill reminder and delivery state; none touches `auth` or `storage` writes (1045 only reads `storage.objects` sizes); applied to a copy of the restored real data in 1.2 s, all clean (R1c report).
* **Deploy set (`release:services --against 9310116`):** worker, voice, signin, hq-api, page. Unchanged: mcp, voice-token, telegram-webhook, slack-events, slack-oauth, google-oauth. Order: migrations, worker, hq-api, voice, signin, page.
* **Rollback references:** functions `.out/rollback-r1b-2026-10-09/<slug>.v<n>` (checksums re-verified OK 20:1x UTC; live versions unchanged since capture) restored with `restore-function.ts`; page `dpl_6zXtXeMzJVMLgh1S8kr2xy86Eu41`; database functions `defs-before.sql` on Grant's decision only; migrated schema is not reversed.
* **Not done on purpose (outside the authorisation):** no pre-release backup write, no heartbeat pause, no live message sends, reminders or data mutations; live acceptance items A to C and the live parts of D and E are therefore UNVERIFIED unless noted below.
* **Recovery gate, stated honestly:** database restore is proven on a replica; **logins are not in the existing backup and uploaded file bytes are in no backup, and full disaster recovery, application recovery and provider reconnection are NOT proven.** This release cannot cause that loss (no `auth` or `storage` write in any of the eleven migrations; the function changes do not delete files or users), a failed release is reversed by restoring the captured functions and the previous page (neither needs a database restore), and the first backup after the new worker is the first that records logins. The gap is pre-existing, is carried forward unchanged, and is not claimed resolved.

## 2. Execution record (UTC, 10 October 2026) - DONE
The first attempt at 9 October about 20:2x UTC was refused by the harness's Auto-mode classifier (no write happened). After the session was switched to Accept edits the migration command was submitted on its own and ran without an approval prompt appearing in the session transcript. Each step was one command, never bundled with git.
| Step | Time | Result |
|---|---|---|
| State re-read (HEAD `4ffa9fd2` clean and pushed; ledger 803; P05, P06 clear; health all ACTIVE_HEALTHY) | 01:17 | as expected |
| `npm run migrate` | 01:18 | **11 applied (1042 to 1052), 803 skipped, 814 recorded**; each 0.9 to 1.4 s; 1053 not re-applied, 1030 absent |
| Post-migration checks | 01:18 | ledger lists the eleven (M18); no cross-office delivery (M11 zero rows); containment would refuse no real send of the last 7 days (M21 restated as a count, 0; its original form is refused to the read-only role); **59 of 59 changed functions found with the expected md5**; `check:anon-exposure` ok (14 views closed) |
| Ledger record committed | 01:19 | `047f6f17` (the provenance guard had correctly refused the first worker deploy because `migrations/applied.json` was dirty) |
| `deploy:worker` | 01:20 | v978 at deploy (v980 in the later platform read), liveness ok, unauthenticated kick 401, authenticated kick 200 (2 jobs handled, 1 duty), no delivery created |
| `deploy:hq-api` | 01:20 | v901 at deploy, unauthenticated 401, authenticated 200 |
| `deploy:voice` | 01:20 | voice v662, voice-token v691: unauthenticated 401; a question answered; token mint 200 with the two tools (the script also re-deploys voice-token, same code, in the manifest as unchanged) |
| `deploy:signin` | 01:21 | v134: health 200, a stranger 403, no origin 403, a dud refresh answered `expired` (not a sign-out of anybody), nobody at all ok=false |
| `config:site` (writes a gitignored local file only), `hq-page-delta --go --allow-new=flow.js,studio/flow.js` | 01:21 | 8 files uploaded, `dpl_E1J5U7iX4SDAH9Jo4hW8g9W5DQ2W` READY, serves the new page; rollback point `dpl_6zXtXeMzJVMLgh1S8kr2xy86Eu41` |
| Post-release read | 01:22 | all four platform services ACTIVE_HEALTHY; live page 277 of 277 files identical to the candidate; stale leases 0; duplicate deliveries none; heartbeat 30 of 30 runs succeeded in the last half hour; **zero deliveries created since 01:15**; the 2 non-harness jobs since the release are complete; `check:anon-exposure` ok |
Not measured: model spend since the release (the one-line inference query errored on a guessed column name and was not pursued; the only model-using actions were the voice deploy probe's single question and the two kick jobs).
No rollback was needed or performed. Nothing was merged to main. 1030, the efficiency work, a backup write and the heartbeat pause were not done.

## 3. Acceptance status (essential live workflows)
| | Result |
|---|---|
| E Security and approvals: anonymous views closed | **Verified live** (catalogue, `check:anon-exposure` twice; the 401 on the HEAD was taken at 19:12 on 9 October, not repeated) |
| E Cross-office isolation | **Verified live by query** (M11 zero rows); enforced by 96 attack proofs and the critical gate (68 of 68) on the candidate |
| E No unintended sends | **Verified**: zero deliveries since the release |
| D Team HQ: page serves, files identical to the candidate | **Verified** (page compare). Modules rendering, chat dock, drafts, focus, mobile layout: **proved on the replica and in real Chromium at 1440 and 390 widths before release (extended gate 73 of 73, ten runs); NOT exercised on the live page** |
| A Telegram text and voice note | **UNVERIFIED live** (needs real provider messages; not authorised) |
| B Personal task, complete, recurring reminder and stop | **UNVERIFIED live** (mutates live data; not authorised); replica proofs pass (`series-ui-browser`, reminder series proofs) |
| C Delegation Claire to a specialist and back | **UNVERIFIED live** (spends model calls and creates jobs; not authorised); replica proofs pass |
| F Voice | Token mint verified live (200 with tools); browser dictation and realtime conversation **UNVERIFIED** (no microphone or device here) |

## 4. Outcome: B, V1 DEPLOYED, ACCEPTANCE INCOMPLETE
Exact tests and approvals needed to reach A: Grant's own Telegram chat for one text and one voice note (`[release smoke]`), one personal task created and completed and one recurring reminder created and stopped in a named Team HQ project, one delegation request ("ask Daniel and Emma ...") from Telegram, and a hands-on pass of the Team HQ chat dock on his phone. Checklist section 4 lists them.

## 5. Issues classification
BLOCKER: none found. DEFERRED (V1.1): #444 (fallback models answer routine questions worse), #446 (ledger in the same transaction as the migration), #447 (`verify:wired` red), efficiency worker-retry and hq-api session-sharing, the 1030 reconciled dequeue, removal of the review-project sign-in origin, the pre-existing recovery gaps (logins and file bytes not in a backup until the first backup after this worker, backup in the same project, full disaster recovery unproven), historical-access review of the #457 exposure. INFORMATIONAL: platform version numbers move when secrets are set; the 14 `sequence/collided` notes are recorded cross-branch collisions.
**Known limitations:** Google is revoked (drive-index and calendar-event-sync off); 10 old user-facing Needs me items remain; the first backup that records logins and file listings has not yet run (due at the next 14:50 UTC daily run, or `backup:now` with approval).

