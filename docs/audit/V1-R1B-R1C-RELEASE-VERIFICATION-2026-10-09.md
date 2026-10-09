# V1 release verification: R1b (live reads and rollback capture) and R1c (isolated restore rehearsal), 9 October 2026

**Recommendation: B, CONDITIONAL GO.** Every release blocker the brief names passes on evidence read today. Named operational prerequisites remain (section 12 and 14),
and one **separate, pre-existing production finding needs Grant's decision whatever happens to the release** (#457, section 12, R-1).
This is not approval to deploy, migrate, or to read or write production beyond what the brief listed.

Evidence is marked **READ** (read from production today, read-only), **REPLICA** (driven on an isolated local database restored from the 9 October backup),
**LOCAL** (repository, no production contact) or **NOT DONE**.

## 1. Exact branch and HEAD
Branch `claude/v1-integration-main-2026-10-09`, HEAD at the start of this run `8c3fbf6c9fa9f09ba03bc2074b9d38b95ee1e787` (clean tree, equal to `origin`). This run adds the commit that carries this
report and the verification tools below; its hash is on the branch. Gates in this report ran with the tree dirty by those files, which the gate states.

## 2. Main HEAD
`origin/main` = `b8ea3c0a102cf5e6a5bc205e57bca0e5dcc3cd71` (fetched at the start). `main` is an ancestor of the branch (`git merge-base --is-ancestor`), so the candidate contains everything main contains.

## 3. Authorised production operations performed
All read-only, each run with `ALLOW_PRODUCTION_CHECKS=1` set for that one command only; `ALLOW_PRODUCTION_WRITES` was never set. Target confirmed each time: ref `baujwlzcziasnfhhkchg`, name "Agentic Team Grant",
`ACTIVE_HEALTHY`, region eu-central-1; the health API read auth, db, rest and storage `ACTIVE_HEALTHY` at 15:34, 15:35, 15:37 and 15:56 UTC. The runner that sends SQL uses the Management API's read-only endpoint (role `supabase_read_only_user`) and refuses
anything that is not a single `select` / `with … select` (`scripts/release/plain-select.ts`, 18 tests with refusing controls).

| # | Operation | Tool | Result |
|---|---|---|---|
| 1 | project record, health, function list (GET) | `scripts/release/r1b-inventory.ts` | section 4 |
| 2 | Vercel project list, production deployment, recent production deployments (GET) | same | section 5 |
| 3 | function metadata and bundle body for 11 functions (GET) | `scripts/forensics/capture-functions.ts` | section 7 |
| 4 | Vercel file listing of the live deployment (GET) | `scripts/release/r1b-page-compare.ts` | section 6 |
| 5 | Needs me aggregates, 11 statements (N01 to N05, N12 to N14, N16, N20 to N22; N10, N11, N15, N17 were refused by the database with 42501, see section 8) | `preflight-read.ts --file=…R1B…` | section 8 |
| 6 | re-read of P01, P04b, P05, P06, P08b (ledger, capacity, redrive exposure, reminders) | `preflight-read.ts` | sections 11, 12 |
| 7 | catalogue fingerprints F01 to F18 (structure, functions, policies, grants; no row of any table) | `preflight-read.ts --file=…R1C…` | section 9 |
| 8 | list the `backups` bucket (22 folders), download the newest complete run (304 objects, 26,939,931 bytes) | `r1c-fetch-backup.ts`, `r1c-backup-runs.ts` | section 9 |

Not done, by design: no deployment, migration, function restore, config change, backup deletion or retention, message, or live-provider traffic. **No request was made with the public anon key** (see R-1).

## 4. Deployed function inventory (READ, 9 Oct 2026 about 15:34 UTC)
Live version numbers differ from the recorded ones for six functions. **The version number is not a reliable identity** (the deployment record already says a secrets write re-versions every function without changing code); the bundle checksum and the code fingerprint below are the identity.

| Function | Live version | Recorded | Last updated (platform) | Bundle sha256 (first 16) | Code is |
|---|---|---|---|---|---|
| worker | **v976** | v975 | 6 Oct 19:08:43 | 941f7e73080a41e5 | `9310116` |
| hq-api | v899 | v899 | 9 Oct 02:30:53 | 917568135c0346a5 | `b8ea3c0` (main, Team HQ release) |
| voice | **v659** | v658 | 5 Oct 13:42:24 | e14bd2633aff40c2 | `9310116` |
| signin | **v130** | v129 | 5 Oct 13:42:16 | 990c66daf0555efd | `9310116` |
| voice-token | **v688** | v687 | 5 Oct 13:42:26 | 562c56dd3d2968d6 | `9310116` |
| mcp | **v665** | v664 | 6 Oct 19:11:34 | e562b3b69c4661fd | `9310116` |
| telegram-webhook | **v699** | v698 | 4 Oct 13:03:34 | 60690c13bf59229b | `9310116` |
| slack-events | **v677** | v676 | 2 Oct 00:38:08 | 116bb3486e550531 | `9310116` |
| google-oauth | **v647** | v646 | 2 Oct 00:28:36 | 16e6559bacadbb83 | `9310116` |
| hq-api-basecamp | v112 | not recorded | 2 Oct 00:28:40 | 3bb5ee3280779812 | legacy gateway, not in this release |
| voice-basecamp | v108 | not recorded | 2 Oct 00:37:41 | f98623f5fbcca260 | legacy, not in this release |

All 11 have `verify_jwt=false` and status ACTIVE. (`slack-oauth` is not deployed; it does not appear in the platform list.) The plan's rule "if any live version is not the recorded one the plan is void" **fired on the numbers**. I judged it on the content instead, because the numbers moved by exactly one on every function except hq-api (the pattern of a secrets write), and because the checks below read the code: the plan's real concern (is something live that the plan does not know about) is answered by section 6.
**Action:** record the new numbers and bundle checksums (done in `docs/ops/deployment-state.json`), and replace the plan's version rule with the checksum rule: at the window, re-read the list and compare each bundle sha256 with section 7.

**How the code fingerprint was made, and what it does not prove.** The platform stores TRANSPILED bundles, so a byte comparison with Git cannot succeed. Each captured source file and the baseline TypeScript (transpiled with `typescript`) were parsed and printed by one printer with comments removed, then compared as multisets of identifiers and literals. Result: google-oauth, mcp, signin, slack-events, telegram-webhook, voice, voice-token and hq-api: **every file identical at word level (0 differences)**; worker: 194 of 203 files identical and 31 words differ in 9 files, all of them the emitted `this.x = x` of class fields (`this`, `kind`, `name`, …), so no code difference. Discrimination was shown: against `9310116~15` the worker gap rises from 3.8k to 17.8k tokens and the signin gap from 35 to 465; against `efficiency-deep-optimization`, `efficiency-stabilisation`, `team-hq-ux-overnight` and `deep-systems-audit` heads no branch matches better than the recorded commit. This is strong evidence of content, **not** a byte proof; the sha256 of the stored bundles is the byte identity.

## 5. Vercel deployment identity (READ)
Project `ai-team-hq`; production deployment **`dpl_6zXtXeMzJVMLgh1S8kr2xy86Eu41`**, READY, created 2026-10-09T03:14:40Z, aliases `ai-team-hq.vercel.app` and `ai-team-hq-agentic-team-grant.vercel.app`. The deployment records no commit SHA (a CLI upload, not a Git deploy). Its content was identified by digest instead (section 6): **273 of 273 files are byte-identical (SHA-1) to `main` `b8ea3c0`'s `web/studio` tree**, plus the generated `config.js` and two build outputs.
Recent production deployments, newest first: `dpl_6zXt…Eu41` (9 Oct 03:14, live), `dpl_7LfbcqcLfNoBraCsso8c1j7cmzbG` (9 Oct 02:45), `dpl_DhcRvsh293eCYmswgvTm9uG1Bsuy` (9 Oct 02:32), `dpl_Dj7erfTXZYqDJhEgxQ9eTBzsnc8H` (7 Oct 18:49, the efficiency page), `dpl_BaQDvaKi1PMQhnXCYCaBKrbd42Cx` (6 Oct), `dpl_34UgA3XsdS5suXYfs8ehBREu7Z3x`, `dpl_E4uGawb9DT9WtyMvTK4h4YqU6SBq`, `dpl_2VgoidAKu95AcMjLieCocWr6bWxv`. The two truncated ids in the earlier records are now full (`…7Lfbc…`, `…DhcRv…`).
**Rollback target for the candidate page: `dpl_6zXtXeMzJVMLgh1S8kr2xy86Eu41`** (the page being replaced, known good, byte-equal to main). Procedure (not executed): note the id the deploy script prints, then promote that deployment in Vercel (Deployments, the deployment, Promote to Production), or redeploy it. `dpl_Dj7er…` is the older fallback and lacks the Team HQ overhaul.

## 6. Candidate versus live
`npm run release:services -- --against b8ea3c0` (the code that is actually live for hq-api and the page) and `--against 9310116` (the code live for everything else):

| Service | Live code | Candidate change | Deploy needed | Schema dependency | Overwrite risk |
|---|---|---|---|---|---|
| worker | `9310116` | 44 files changed, 20 added | **yes** | needs 1042 to 1052 first (new functions, columns, the 1044 queue) | none: live equals the baseline |
| hq-api | `b8ea3c0` | `index.ts` +5 lines (action `reminder_series_stop`, needs 1051) and `src/text/file-text.ts` (reader work) | **yes** | 1051 | none: candidate contains main; every Team HQ feature live is in the candidate |
| voice | `9310116` | `index.ts` and `src/auth/conversation-key.ts` | yes | 1048 | none |
| signin | `9310116` | `index.ts`, `src/auth/redirect-target.ts` | yes | none | none |
| page | `b8ea3c0` tree, byte-identical | 7 files changed (`app.js`, `bc/compose.css`, `bc/shell.js`, `bc/wire.js`, `call.js`, `chat.js`, `session.js`) and `flow.js` added | yes | hq-api with 1051 first | none |
| voice-token, mcp, telegram-webhook, slack-events, google-oauth | `9310116` | none | **no** | none | none |
| hq-api-basecamp, voice-basecamp | legacy | none, not in this release | no | the legacy gateway names 7 functions the migrations change (below) | n/a |

**No live service contains code that is not in the candidate**, so the "unreconciled live change" blocker does not fire. Team HQ features are all in live hq-api (`b8ea3c0`) and in the candidate (superset): infinite canvas and revision-aware layout saves (1040), background uploads (1041), Team Chat and dictation (page), office isolation, public Sample behaviour, efficiency migrations 1023 and 1027. The candidate's diff for hq-api over main is the five lines and the file reader; the page diff over main is the reminder series UI and the 320px header fix.
Legacy note (low risk, not a blocker): `hq-api-basecamp` (live since 2 Oct, used only by the old `agentic-team-hq-basecamp` Vercel project) references `say_in_project`, `my_tasks`, `my_task_set`, `my_tasks_counts`, `conversation_history`, `hq_answer_blocker`, `hq_task_state`. Only `say_in_project` changes signature (the new 7-argument form takes a defaulted last argument, so a call with the old named arguments still resolves). Not driven.

## 7. Rollback artifact inventory and checksums
Captured with `scripts/forensics/capture-functions.ts` (read-only) into `.out/rollback-r1b-2026-10-09/` (gitignored, **not committed**; `drwx` in this sandbox only). Per function: the raw ESZIP2 bundle, the extracted source tree, `RESTORE.json` (entrypoint, verify_jwt, per-file sha256, bundle sha256, npm redirects), all credential-scanned (none found). Directory integrity: `SHA256SUMS` over 250 files, `sha256sum -c` all OK; `SHA256SUMS` itself `2db1cc6656ed0606867a328f29ec12b5ff3db6663d6e2d8d63430e6aa72b8259`.

| Function | Version | Deployed (platform) | Bundle bytes | Bundle sha256 (full) | Source files | npm re-resolved on restore |
|---|---|---|---|---|---|---|
| worker | 976 | 2026-10-06T19:08:43Z | 6,883,210 | `941f7e73080a41e5…` see `MANIFEST.json` | 203 | `npm:postgres@3.4.5` |
| hq-api | 899 | 2026-10-09T02:30:53Z | 578,573 | `917568135c0346a5…` | 5 | none |
| voice | 659 | 2026-10-05T13:42:24Z | 72,283 | `e14bd2633aff40c2…` | 2 | none |
| signin | 130 | 2026-10-05T13:42:16Z | 44,005 | `990c66daf0555efd…` | 1 | none |
| voice-token | 688 | 2026-10-05T13:42:26Z | 64,977 | `562c56dd3d2968d6…` | 2 | none |
| mcp / telegram-webhook / slack-events / google-oauth | 665 / 699 / 677 / 647 | 6 Oct / 4 Oct / 2 Oct / 2 Oct | 135,431 / 104,005 / 95,966 / 32,066 | `e562b3b6…`, `60690c13…`, `116bb348…`, `16e6559b…` | 3 / 2 / 4 / 1 | none |
| hq-api-basecamp / voice-basecamp | 112 / 108 | 2 Oct | 296,074 / 71,413 | `3bb5ee32…`, `f98623f5…` | 1 / 2 | none |

Full 64-character digests are in `MANIFEST.json` and `SHA256SUMS` in that folder and in section 4's first-16 form; the bundle was produced by the platform, so these digests are what a re-capture at the window must reproduce.
**Restoration command (NOT executed):** `ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/deploy/restore-function.ts .out/rollback-r1b-2026-10-09/<slug>.v<n> --go` from a clean pushed checkout (it needs `ALLOW_PRODUCTION_WRITES` and provenance). `buildRestorePlan` was run for all 11 offline (it re-hashes and builds the request, sends nothing): all 11 build. Restoring creates a **new version number with the same code**, not the old bytes. Restoration needs `SUPABASE_ACCESS_TOKEN`; it touches no secret and no setting. Function secrets are not in the bundle and are not captured (names only in `docs/ops/restore-procedure.md`); the worker restore re-resolves `npm:postgres@3.4.5` from the registry.
**Limitation, stated:** the folder lives in this session's sandbox, which is reclaimed. The bundles are re-capturable only until the first function deploy. The attended window must re-run `capture-functions` on the operator's machine first and confirm the digests above, then keep that folder outside the repository.
**Database function rollback artifact:** `.out/rollback-r1b-2026-10-09/defs-before.sql` (1,100 definitions plus their grants, sha256 `2ca6c01fc67444bda35030a28505f8c5e296a9b0315fe329697ba0e5dce8e89f`), produced from the restored replica, which section 9 shows has the same md5 for every one of production's 1,100 functions (F11). All 25 changed or removed functions' "before" digests in `V1-RELEASE-FUNCTION-FINGERPRINTS-2026-10-09.tsv` equal the live production digests today (0 mismatches), so the checklist's "STOP if not" passes. Proven procedure (REPLICA, section 9): drop the two new 7-argument `say_in_project` overloads, apply `defs-before.sql` twice; the second pass has 0 errors and all 1,100 definitions are identical to production's afterwards (37 new functions stay, unused by old code). One pass alone leaves 5 errors and 2 functions not restored.

## 8. Needs me classification (READ, aggregates only; no text, person or identifier printed)
The `needs_me` view and `app.harness_job` are not executable by the read-only role (42501), so `app.harness_job` was **restated inline** from its live source (N03, N04), including the parent chain, and applied to the unfiltered table.

| | Count |
|---|---|
| open blockers, unfiltered (matches the preflight's 192) | **192** (906 resolved, 131 withdrawn) |
| harness or synthetic by the restated predicate | **173** (127 in person offices, 46 in the test office) |
| not harness | **19** |
| of those, in the TEST office (nobody's): `office.provision_channels` questions of 2 Oct | 9 |
| of those, in person offices: **the user-facing candidates** | **10** (5 in the oldest office, 4 in the second, 1 in a third) |

The 10: 5 `office.provision_channels` (2 to 6 Oct), 4 raised by Claire on 9 to 11 Sep (answering resumes nothing; their jobs are complete), 1 `office.slack_rotate` (1 Oct). All 19: work can continue, **none overdue, none offers a standing yes, none was ever put to him** (`asked_at` null, 0 ask attempts), the job behind every one is `complete`, none is younger than 2 days (4 are under 7). Resolved-but-still-counted: **0** (no resolved blocker has a paused job). Which of the ten are Grant's own versus the second person's or the Sample's is not separable without naming offices; the oldest office holds 5. Urgent: none.
**Would the new worker change them?** No. The blocker-asking sweep only considers open questions of PAUSED jobs younger than 2 days; none qualifies. The new redrive and failed-delivery question (1047, 1049) act on deliveries: P05 (deliveries a first redrive would resend) = **0 rows**, P06 (failed results the sweep would raise) = **0**, P08b pending reminders and open series = **0** in every office kind (all re-read today, 15:37 UTC). Remaining uncertainty: the restated predicate equals the live function's text, not its result (the view cannot be read); the 173 may include a few of his if the predicate is too generous, which 0304's asymmetry says is the cost direction, and the 19 cannot be split by owner. Unexpected-notification risk at deploy: **low** (nothing is eligible to send).

## 9. Backup restore procedure and evidence (R1c) (REPLICA)
**Backup.** Identifier `run-bd4c51d0-caf1-4e74-9939-9241ea4cd845`, manifest stored 2026-10-09T14:50:22.584Z (`exported_at` …14:50:22.471Z), format `folder/1`, 304 objects, 26,939,931 bytes, 151 tables, 333,542 rows, latest migration recorded `1041_…` (802 migrations listed), source project ref `baujwlzcziasnfhhkchg`. The bucket holds 22 complete runs, one a day since 18 September (12:27 to 16:25 UTC), 9.9 MB growing to 26.9 MB. Every object matched its sidecar checksum.
**Destination.** A local PostgreSQL 16 cluster started for this run, `listen_addresses = ''` (Unix socket only, `/tmp/pgs`, no network listener), databases built from this repository's migrations through exactly the production ledger (files `0599` to `1041`; the repository's file set equals the 802 in `migrations/applied.json`, checked), named `r1c_base` and `r1c_dst`. `pg_net` and `pg_cron` are stubs: `net.http_post` writes to a local table, `cron.schedule` writes a row, nothing schedules or sends; there is no worker, edge function, provider credential or Telegram, Slack, mail, Google or Notion client in that database. The restore script refuses to run with `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_DB_URL` set (they were unset), and `restoreArchive` itself refuses any target that is not a marked local socket replica or is a template. No restored job, trigger or reminder executed.
**Procedure and times (UTC, 9 Oct).** fetch 15:45; `r1c_base` built and `r1c_dst` created about 15:47; restore attempts at 15:48:17, 15:50:51, 15:51:57, 15:53:25 (all four **failed** on one finding, below) and **15:54:27, completed in 21 s, OK**: 14 steps, 0 errors. Steps that passed: target is a marked local replica; archive verified (151 tables, 333,542 rows, every object matching its sidecar); load order (22 cyclic keys handled separately); 43 tables emptied; rows loaded typed in foreign-key order; 22 cyclic keys re-added; 241 triggers put back; sequences set (5 of 6); counts per table equal the manifest (151 tables, 333,542 rows); no sequence below its column; **the restore changed no structure**; two smoke readers ran.
**The finding, and the local fix.** The restore failed on `public.lessons.lessons_supersedes_same_office`, which migration 0658 leaves **NOT VALID on purpose** over one recorded cross-office row (named in `public.office_edge_exceptions`); a clean replica holds it valid because the row is not there. The restore tool validated every key it re-added, so a restore of the real backup could never have succeeded. Fix in `src/backup/restore.ts` (not deployed anywhere; no bundle imports it): a key the target already held NOT VALID is put back as found; a validation failure is accepted only if every violating row is recorded in `office_edge_exceptions` and the key has no other fault (`recordedException`); anything else still fails. 7 unit tests including refusing controls (`tests/backup/restore-recorded-exception.test.ts`), sabotaged in both directions (always-accept turned 3 refusal tests red, always-refuse turned the acceptance test red, each restored), and the existing typed-restore proof is still green (76 of 76 through the gate, 59 standalone).
**Integrity and consistency (production catalogue versus restored replica, catalogue only).**

| Check | Production | Restored | Result |
|---|---|---|---|
| tables / columns (F01, F12) | 151 / 1,526 | 152 / 1,527 | identical per table; the one extra is the replica's own marker table |
| functions (F02, F11) | 1,100 | 1,100 | aggregate md5 and **every per-function md5 identical** |
| row security and policies (F03) | 149 tables on, 68 forced, 168 policies | same | identical, policy text hash identical |
| function EXECUTE grants (F05) | 1,469 | 1,469 | identical |
| triggers (F06), indexes (F07), views (F10) | 241 / 429 / 14 | same | identical hashes |
| constraints (F08) | 937, 1 NOT VALID | 937, 1 NOT VALID | identical, including the exception key |
| migration ledger (F13) | 802, highest 1041 | 802, highest 1041 | identical names hash |
| extensions (F09) | pg_cron, pg_net, pg_stat_statements, pg_trgm, pgcrypto, supabase_vault, uuid-ossp | stubs and pg_trgm, pgcrypto, uuid-ossp | platform extensions are not restored by a data backup |
| table privileges (F04, F15) | 4,161 | 1,206 | **differ, expected**: production carries the platform's default grants to `anon`, `authenticated`, `service_role`; the replica has the grants the migrations make (`ai_team_app` identical, 80/41/23/7) |

Row counts per table equal the manifest (the restore step). Content integrity is **object checksums only**: this backup's manifest has no content fingerprints, no object checksums and no structure fingerprint (warnings printed), because the deployed worker takes the older format.
**Does the restored database support the rollback and recovery strategy? (REPLICA, copy of the restored data)** (a) Roll-forward: the 11 migrations 1042 to 1052 applied to a copy of the restored data in **1.2 s total, all 11 clean**, and afterwards all 59 changed or added functions have the md5 the fingerprint file expects, the 5 removed are gone, total 1,134. (b) Function rollback: section 7, 1,100 of 1,100 identical after the proven procedure. (c) The database itself stays migrated on a rollback, as the plan says.
**What is and is not proven.**
* **Successful database restore (data, schema consistency, function and policy equality): PROVEN here**, on this one backup.
* **Application recovery: NOT proven.** No function was redeployed from the restored state, no worker ran against it.
* **Provider reconnection: NOT proven and not attempted.** 9 credentials are not in the backup by design (Slack, Telegram, hq token, NotebookLM, Google, model providers, DB password); each is re-entered at its provider.
* **Full disaster recovery: NOT proven.** The restore went into a replica built from Git, not into a new Supabase project; the Auth admin API's acceptance of a caller-chosen id, the `postgres` role's rights on a real new project, and the production-shaped load time stay UNVERIFIED.

## 10. Recovery limitations (quantified)
* **Logins are not in this backup.** The manifest has no `aux` section, so `auth.users` is not recorded. The rehearsal had to create **28 placeholder logins** (ids named by the backup's own offices and members). In a real loss, people cannot sign in until re-created; the candidate worker's backup handler records logins, schedules, secret names and storage listings, so **the first backup after the deploy is the first one that could recover them**.
* **Uploaded file bytes are not in any backup** (path, size and etag only in the newer format; nothing in this one). Storage is 6,213 objects, 531.7 MB (49.5%).
* **The backup is in the project it protects** (offsite false): losing the project loses it.
* **Gap:** a restore from this backup would have lost, in the 67 minutes between the backup and the read, about 28 events, 170 job transitions, 18 jobs, 19 outputs, 1 document (estimates from table statistics: `inbound_commands` reads +1,330, an estimate that is probably stale and is not relied on). RPO is the interval since the daily 14:50 UTC run, **up to about 24 hours**.
* Cron schedules, vault secret values, function secrets, webhook registrations and Auth settings are recreated by hand (`docs/ops/restore-procedure.md`).
* Restoring over a project already running is not what was tested; nothing here authorises it.

## 11. Migration compatibility status
Ledger **802 applied, highest 1041, nothing at 1042 or above** (re-read 15:37 UTC; equals `migrations/applied.json`; `check:migrations` passes: 813 files, 802 recorded). The pending set is exactly 1042 to 1052, in filename order, each its own transaction; applying them to a copy of real restored data worked (section 9). `check:deployment-state` passes. **Efficiency 1030 stays deferred**: no `1030_*` file in `migrations/`, the reconciled function sits in `docs/audit/deferred-migrations/`, the registered proof `dequeue-reconciled` passes 21 of 21 and the migration-redefinition tests pass (35 files, 375 tests in `tests/migrations tests/gate tests/deploy tests/release tests/backup`). Dependencies for ordering: hq-api needs 1051, voice needs 1048, the worker needs all eleven, the page needs hq-api; the new worker against the old schema is the hazard, so migrations come first.

## 12. Remaining release risks
Blockers named in the brief, one by one:

| Blocker | Status |
|---|---|
| exact deployed versions known | PASS (section 4; numbers differ from the record, identity is now bundle checksums) |
| candidate reconciled against live | PASS (section 6) |
| no newer live changes would be overwritten | PASS (word-level fingerprints and byte-identical page) |
| rollback artifacts captured and integrity-checked | PASS **with a condition**: sandbox-only, re-capture at the window (P-2) |
| Vercel rollback target identified | PASS (`dpl_6zXt…Eu41`) |
| isolated restore successful | PASS (database restore only; limits in section 10) |
| capacity acceptable on recent evidence | PASS: database 375,721,107 bytes **71.7%** (was 71.5%), storage **49.5%** (was 47.0% earlier today; reason unknown, growth about 25 MB in hours, to be watched), both under the proposed 85% |
| blockers classified | PASS (section 8) |
| no unexpected delivery or redrive exposure | PASS (P05, P06, P08b zero) |
| migrations 1042 to 1052 sequence still valid | PASS |
| efficiency 1030 explicitly deferred | PASS |
| migration and deployment order unambiguous | PASS (section 13) |

Risks, in order of weight:
* **R-1 (pre-existing, not the release): all 14 `public` views are readable by `anon` and `authenticated`, owned by `postgres`, with no `security_invoker`** (#457). On the restored replica, with that grant, 12 of the 14 return rows to `anon` (`decisions_live` 450, `lessons_live` 85, `credential_health` 5, …); `needs_me` and `model_record` are refused only because `anon` has no EXECUTE on `app.harness_job`. `check:anon-exposure` covers functions and tables with no row security, not views. **Whether production's REST endpoint serves them to the public anon key is NOT verified**: it needs one bounded, count-only request with the anon key, which I did not make (outside the authorised reads). If it does, business content is readable by anyone holding the public key. Smallest fix: a migration revoking those views from `anon` and `authenticated` (and `security_invoker`), after confirming nothing uses them with those roles (the gateway uses `service_role`). It does not depend on the release and should not wait for it.
* R-2: the production backup is the old format (no logins, no fingerprints). Mitigation: take a fresh backup after the worker deploy (an approved write) or accept 24 hours of RPO for the window.
* R-3: the weakest part of the evidence is the code fingerprint (section 4): word-level, not byte-level.
* R-4: storage grew 2.5 points since the preflight reading earlier today; reason unknown.
* R-5: 10 user-facing Needs me items exist and are older than the release; they will still be there after it.
* R-6: Google is revoked, `drive-index` and `calendar-event-sync` are off (record); not re-read.
* R-7 (signin origin, below): `SIGNIN_ALLOWED_ORIGIN` live value is a secret and was not read.
**Signin preview origin.** `https://team-hq-ux-review.vercel.app` is retained in the proposed list (`scripts/deploy/lib/signin-origins.ts`, three exact HTTPS origins, no wildcard; `deploy:signin` re-sets this list, so deploying the candidate keeps it). Verified locally: the live signin bundle matches the baseline source and compares the request origin against the list with `includes` on a comma-split exact string (no pattern, no suffix, no wildcard); redirect targets go through `safeRedirectTarget`, which compares parsed origins; a table of attacks (`evil.` subdomain, `.evil.com` suffix, `@evil.com`, `http:`, other port, sibling name) all fall back to the preview origin's root; `normaliseAllowedOrigin` accepts all three and refuses anything that is not a clean https origin. The live secret's value was not read (secrets are not readable), so "the live list equals this list" is assumed from the 9 October record. **Future cleanup:** remove the entry from `SIGNIN_PAGE_ORIGINS` and run `deploy:signin-origin` when the review project `team-hq-ux-review` is retired (Issue to follow; no change made).

## 13. Proposed deployment and rollback sequence (proposal, requires the approvals in section 14)
0. Beforehand (read-only): re-run `capture-functions` and `r1b-inventory` on the operator's machine; every bundle sha256 must equal section 7; if any differs, stop. Re-read P01 (802 / 1041), P04b, P05, P06, the health API, and the new Needs me count (section 8 shows the expected 19 not-harness).
1. Take a fresh backup (approved write), verify it, note its id. 2. `worker-heartbeat pause`. 3. `npm run migrate -- --dry` must list exactly 1042 to 1052, then `npm run migrate`; commit `migrations/applied.json`; check the function md5s against the fingerprint file and M21. 4. `deploy:worker`, `deploy:hq-api`, `deploy:voice`, `deploy:signin`, each with its probe. 5. `worker-heartbeat resume`. 6. `config:site`, then `hq-page-delta` dry and `--go --allow-new=flow.js,studio/flow.js`. 7. Attended smoke test (checklist section 4) to the named destinations only. 8. Update `docs/ops/deployment-state.json`.
Rollback, newest first, as in the operator checklist section 6: page by promoting `dpl_6zXt…Eu41`; functions by `restore-function` from the re-captured folder (worker first if it is the fault); database functions only on Grant's decision by the proven procedure of section 7; the migrated schema and sent messages are irreversible.

## 14. Approvals still required
Nothing in this report is executed approval. Needed from Grant: (1) the decision on **#457** (authorise a count-only anon-key probe, and the revoke migration) before or independent of the window; (2) the deployment window and who is at the keyboard; (3) production migrations 1042 to 1052; (4) the five function and page deploys; (5) a pre-deploy backup write and the heartbeat pause and resume; (6) named smoke-test destinations (his own Telegram chat, a Team HQ project, a Slack channel or none) and permission for those sends; (7) a model spend ceiling (US$0.05 an hour to watch, US$0.50 to stop are the proposals); (8) abort thresholds (checklist section 5) and rollback authority; (9) acceptance of the weaker code-fingerprint evidence or a byte comparison by a re-capture on his machine; (10) whether to remove the preview origin now or at retirement.

## Verification of tools and tests run for this report
`npx tsc --noEmit` clean; `npx biome ci .` exit 0 (64 warnings, 38 infos, as before); `vitest` on `tests/migrations tests/gate tests/deploy tests/release tests/backup`: 35 files, 375 tests passing; `check:migrations`, `check:deployment-state`, `check:secrets` pass (exit read); `gate --tier critical --only dequeue-reconciled,backup-restore-typed`: 2 green, 97 assertions (source reported as dirty). New local tools: `scripts/release/r1b-inventory.ts`, `r1b-page-compare.ts`, `r1c-fetch-backup.ts`, `r1c-restore.ts`, `r1c-catalogue.ts`, `r1c-backup-runs.ts`; `preflight-read.ts` gained `--file` (only `docs/audit/*.sql`) and `--full`; `plain-select` accepts a read-only `with … select`. Statement files: `V1-R1B-NEEDS-ME-QUERIES-2026-10-09.sql`, `V1-R1C-CATALOGUE-FINGERPRINTS-2026-10-09.sql`.

## Disclosures
Process: one empty `cat >> file <<EOF` against `docs/audit/V1-R1B-NEEDS-ME-QUERIES-2026-10-09.sql` (appended nothing, file unchanged; the rule says Edit); several scratch scripts and one `git stash` / `pop` (restored, 13 paths intact) outside the editing rule's intent; a repository-wide `grep -r` that ran past the shell timeout and was moved to the background (finished, output unused). **Data:** while sampling the backup's file format I printed the first 150 characters of one object, which contained one office id and one login id (two internal UUIDs, no name or address); nothing else personal was printed. The restored databases (`r1c_*`) and the downloaded backup copy (`.out/r1c-backup`) hold personal data; they are local, private (0700), never committed, and are removed at the end of this run. Production backups were not touched.
