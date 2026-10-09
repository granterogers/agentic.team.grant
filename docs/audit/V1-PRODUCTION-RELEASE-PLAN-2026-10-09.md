# Version 1 production release plan (9 October 2026)

**Status: PREPARED, NOT AUTHORISED, NOTHING EXECUTED.** Every statement here is from files in this repository or from the isolated replicas. No production read, write, deploy or message was made in this phase.
Where production state would have to be read, the exact read is written and marked NEEDS AUTHORISED READ; where it cannot be known, the word is UNKNOWN. The operator's one-page version is
`V1-RELEASE-OPERATOR-CHECKLIST-2026-10-09.md`; this document is the reasoning behind it.

Companion files (all in `docs/audit/`, all executed against the migrated replica and parsing there):
`V1-RELEASE-PREFLIGHT-QUERIES-2026-10-09.sql` (19 reads), `V1-RELEASE-MONITORING-QUERIES-2026-10-09.sql` (22 reads), `V1-RELEASE-FUNCTION-FINGERPRINTS-2026-10-09.tsv` (64 function fingerprints, before and after).

## 1. Executive release recommendation

**B: ready for an attended production preflight, with deployment still separately gated.** The release package is complete and locally verified. It is not yet a package Grant can be asked to approve for
deployment (that would be C) because the preflight reads decide four things nobody in this repository can know today, and any one of them can stop the release:

1. **The free tier may already be at or past its limit.** The last recorded database size is 371.8 MB on 5 October (about 74 percent of a conservative 500 MB), growing 9 to 26 MB a day; the repository's own projection
   put 85 percent between 8 and 13 October and 100 percent between 10 and 19 October. Storage may reach its 1 GB first and nothing recorded says which. **Today is 9 October.** A database at its limit goes read-only
   (UNVERIFIED), which would stop a migration sequence between files and stop every duty. This is the first thing the preflight reads (P04), and the proposed rule is: over 85 percent of either, do not start.
2. **The new worker's first pass can resend or announce old things.** Migration 1029 introduces `send_started_at`; every delivery written before it has that column null, so a delivery that was claimed, whose lease lapsed
   and whose send was interrupted under the OLD worker looks "never started" to the new redrive and is sent again if it is under two days old and its job completed (`settle_lapsed_deliveries` step 5,
   `deliveries_to_redrive`). Migration 1032's first sweep raises up to 50 Needs-me items for failed result deliveries of the last two days, each quoting up to 500 characters of the undelivered answer. Both are bounded and
   both are by design, but how many rows there are is UNKNOWN (P05, P06). Any redrive-due row is a decision for Grant before the worker is deployed.
3. **What each deployed service is actually running is not proven.** The record says `signin`, `voice`, `voice-token`, `telegram-webhook`, `slack-events` and `google-oauth` were "not redeployed" on 6 October (their version numbers advanced
   because setting the worker's secrets re-versions every function) and "verified by re-capture". This plan computes what to deploy against commit `9310116`; if a live service holds code older than that commit, the diff is larger than
   shown. Only `npm run capture:functions` (a production read) settles it.
4. **The backup is not an off-project copy and the restore has never been run on production.** `app.backup_health()` states `offsite: false`; the last passing restore rehearsal on record is 21 September; a backup does not contain
   uploaded file bytes or any secret value. So "restore from backup" is disaster recovery of last resort, not a release rollback (section 10), and a verified backup newer than the start of the window is a precondition.

Everything else is established: the sequence, the compatibility in all four version combinations, a rollback that was rehearsed for the database functions and for the old code, and the service list. Details follow.

## 2. Exact commit and branch

| | |
|---|---|
| Branch | `claude/deep-systems-audit-3cwbtc` (pushed) |
| Code under test | `8f74449217ca5f3d70ce7166e732355b6f0a6685`: tree clean, contained in `origin/claude/deep-systems-audit-3cwbtc`. The commit that carries this plan changes only `docs/`, `tests/deploy/`, `scripts/release/` and `package.json`'s `release:services` line; **no file that ships (`src/`, `supabase/`, `web/`, `migrations/`) differs from 8f74449**. Re-check on the day: `git diff 8f74449 HEAD -- src supabase web migrations api scripts/notebook vercel.json requirements.txt` must print nothing. |
| Deployed baseline of record | `9310116c41748268b43e5d8dc02a6feb195b78f1` (6 October 2026; `docs/ops/deployment-state.json`): worker v975, hq-api v896, mcp v664, page `dpl_BaQDvaKi1PMQhnXCYCaBKrbd42Cx`, ledger 798 (highest `1022`). A record, not a live reading (`isLiveProductionReading: false`). |
| Production project | the scripts default to ref `baujwlzcziasnfhhkchg` (a constant in every deploy script, public). Whether that is the project the operator means is an OPERATOR CHECK in the dashboard; `SUPABASE_PROJECT_REF` should be unset or equal to it, and `TARGET_ENVIRONMENT` unset (not `staging`). |
| Commits since the baseline | 79; migrations 11 pending of 809 files (798 recorded + 11); `check:migrations` passes |

Release artifact identity is the commit: the bytes each service uploads are a pure function of it (the deploy scripts walk the import graph or a fixed file list; `npm run release:services -- --against 9310116` prints which services differ and
`tests/deploy/bundle-manifest.test.ts` pins the lists to the scripts that send them). The deploy scripts also refuse a dirty tree or an unpushed commit (`src/safety/provenance.ts`).

## 3. Production preflight checklist

Legend: **LOCAL** = established in this repository; **NEEDS AUTHORISED READ** = the read is written (P = `V1-RELEASE-PREFLIGHT-QUERIES`, M = monitoring file, C = a command); **BLOCKED** = cannot be known without it; **OPERATOR** = a check the person at the keyboard makes without printing anything. Nothing here is a pass until the read has been made and the answer matches the stated expectation.

| # | Item | How | Expected / stop rule | Status |
|---|---|---|---|---|
| 1 | Repository commit and artifact identity | `git rev-parse HEAD`, `git status --short`, `git diff 8f74449 HEAD -- src supabase web migrations` | HEAD contains 8f74449; status empty; diff empty | LOCAL, repeat on the day |
| 2 | Correct Supabase project | dashboard shows ref `baujwlzcziasnfhhkchg`; `echo ${SUPABASE_PROJECT_REF:-unset}` (a ref is not a secret) | equal or unset | OPERATOR |
| 3 | Correct deployment environment | `echo ${TARGET_ENVIRONMENT:-unset}`; no `.staging/` directory | unset | OPERATOR |
| 4 | Migration history | P01, P02; then `npm run migrate -- --dry` (needs both flags: every deploy script imports the write gate, even for a dry run) | 798 applied, highest `1022`, nothing named `>= 1023`; dry run lists exactly the eleven names in section 4. Anything else: STOP, the plan is void | NEEDS AUTHORISED READ |
| 5 | Schema and function compatibility | C: `snapshot-defs.ts` on production, then compare `md5(pg_get_functiondef(oid))` of the 25 functions in the fingerprint file's `changed` and `removed` rows with its `md5_before` column | all 25 equal. Different = the live schema is not the one the compatibility matrix (section 5 of the final gate report) was built on: STOP | NEEDS AUTHORISED READ (matrix itself is LOCAL) |
| 6 | Production database health | the platform health API once (`GET /v1/projects/<ref>/health?services=auth&services=db&services=rest&services=storage`); M15 | all four healthy; the pg_cron heartbeat ran every minute for 30 minutes. One reading, never polled into a sick host (3 to 6 October) | NEEDS AUTHORISED READ |
| 7 | Storage capacity | P04 | database under 85 percent of 500,000,000 bytes and storage under 85 percent of 1,000,000,000 (**proposed thresholds, for Grant's approval**). Over = STOP | NEEDS AUTHORISED READ; **likely near the line (section 1)** |
| 8 | Available backups | P18 (`app.backup_health()`); the dashboard's own backup list | newest backup inside 36 hours and verified. The rehearsal is overdue by the office's own threshold (192 h; last pass 21 September): run `npm run backup:rehearse` or accept the gap in writing | NEEDS AUTHORISED READ |
| 9 | Rollback readiness | C: `capture:functions` for `worker hq-api voice signin` into `.out/rollback-<date>/`; `snapshot-defs.ts <file>`; Vercel previous deployment id | `MANIFEST.json` present for each; the definitions file written; the page rollback point read again (the recorded one is `dpl_34UgA3XsdS5suXYfs8ehBREu7Z3x`) | NEEDS AUTHORISED READ |
| 10 | Edge-function deployment readiness | bundles are closed and match their scripts (tests, LOCAL: 101 deploy and safety tests); `[ -n "$SUPABASE_ACCESS_TOKEN" ]` and `[ -n "$VERCEL_TOKEN" ]` | both non-empty (never printed) | LOCAL + OPERATOR |
| 11 | Environment-variable presence | no new variable or config key is introduced by the code (`git diff 9310116 HEAD -- src supabase` contains no new `Deno.env.get`, `process.env` or `system_config` read: checked). The existing function secrets are `HQ_API_TOKEN`, `SUPABASE_*`, `SIGNIN_ALLOWED_ORIGIN`, `WORKER_URL`, `WORKER_KICK_SECRET`, `HQ_MANAGEMENT_TOKEN`, `HQ_PROJECT_REF` | the Management API's secrets list (names only) shows them | NEEDS AUTHORISED READ |
| 12 | Provider configuration | P10, P12, P13 | model order gpt-oss-120b, qwen3.7-flash, mistral-small-3.2; a paid-call ceiling is set; OpenRouter account balance is UNKNOWN (dashboard, OPERATOR) | NEEDS AUTHORISED READ |
| 13 | Telegram bot routing | P11 | exactly one enabled bot, the pager, `chief-of-staff` (7 September decision) | NEEDS AUTHORISED READ |
| 14 | Slack configuration | P10, P16; the Slack app's own settings | bot token `ok`; the configuration token is known dead since 18 September and only administers the app. `slack.per_office_delivery` is set by the worker deploy, not before | NEEDS AUTHORISED READ |
| 15 | Team HQ configuration | `npm run config:site` writes the gitignored `web/studio/config.js`; the page script compares file names with the live page | names differ only by `flow.js`/`studio/flow.js` (section 7) | LOCAL + the script's own dry run |
| 16 | Worker scheduling | P03, P14, M15 | heartbeat active; the duties `drive-index` and `calendar-event-sync` OFF | NEEDS AUTHORISED READ |
| 17 | Job queues and leases | P03, M02 | no stale lease; running jobs few; no job older than its duty's period waiting | NEEDS AUTHORISED READ |
| 18 | Existing pending deliveries | P05, P06, M06 | P05 zero rows (else a decision per row, section 4.3); P06 a count Grant has seen | NEEDS AUTHORISED READ |
| 19 | Existing reminders and recurring series | P08 | pending counts noted so a change is attributable | NEEDS AUTHORISED READ |
| 20 | Multi-office isolation | P09 for the offices that exist; the isolation test (section 7, J) | the Sample office and the TEST office exist and are active | NEEDS AUTHORISED READ |
| 21 | Existing approval requests | P07 | open questions counted so they are not blamed on the release | NEEDS AUTHORISED READ |
| 22 | Observability and error reporting | the M queries, the platform health API, `npm run incident:snapshot` | the queries answer; there is no external error tracker in this repository (UNKNOWN whether one exists elsewhere) | NEEDS AUTHORISED READ |
| 23 | Scheduled commands that call a removed function | P19 | zero rows | NEEDS AUTHORISED READ |
| 24 | Production gate switches | `ALLOW_PRODUCTION_CHECKS` and `ALLOW_PRODUCTION_WRITES` are set by Grant, per command, and never by the agent | n/a | OPERATOR |

## 4. Migration-by-migration plan

### 4.1 What the runner does, and what that means

`npm run migrate` (`scripts/migrate.ts`, `src/migrations/runner.ts`): refuses on any integrity finding (a checksum that differs from the ledger, an unapplied duplicate number, a missing file), applies the pending files **in filename order, one
file per request**, then records each in `app.schema_migrations` with its SHA-256 and duration **in a separate request**, and finally rewrites `migrations/applied.json` from the database's own ledger (commit that file afterwards). A file that
fails inside is rolled back whole (one request is one transaction; 1025, 1027 and 1034 also carry their own `begin`/`commit`) and the runner stops with the earlier files applied. There is no lock timeout, no per-file confirmation and no dry
run that does not need both production flags. 1028 and 1031 do not exist and were never used; the pending set is derived (every file not in the ledger), so it cannot go stale.

**A crash between a file's request and its ledger insert leaves a file applied and unrecorded.** The next run would apply it again. Measured on the replica (each file applied twice, the second time immediately after the first): **1025, 1026, 1027, 1030 and 1034
FAIL on a second application** (`function ... already exists`, and 1026's splice guard `app.chores_for_credentials has changed since 1026 was written`); 1023, 1024, 1029, 1032, 1033 and 1035 are idempotent. So after a crash the operator must establish by the catalogue probe in the table whether the file's
effect is present and, if it is, record the ledger row by hand (a production write needing Grant's approval, with the SHA-256 in the table); never re-run it. Issue #446 (filed with this plan) asks for the ledger row to be written in the same transaction as the file.

### 4.2 The eleven files, in order

SHA-256 prefix and line count are for checking that the right bytes are applied (`sha256sum migrations/<file>`; the runner records the full hash). "Before" probes prove the file is not already applied independently of the ledger; "after" is the fingerprint in the TSV.

| # | File (`migrations/`) | SHA-256 (16) | Depends on | Affects | Changes existing data? | Locks | Transactional | Reversible? | Compatible with the DEPLOYED services? | Before-probe (expect true) | After-check |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1023 | `1023_a_turn_from_an_external_assistant_answers_nothing_the_owner_was_asked.sql` | 7890868b87a9ed6a | 1022 | rewrites `app.open_questions_for_reply` | no | none (function replace) | yes | the function, from the snapshot | yes, both ways (a database function) | md5 of the function starts `9693f15000` | `5d8ee9831a` |
| 1024 | `1024_every_terminal_failure_of_a_turn_owes_the_person_a_word_however_the_job_died.sql` | bf0d18a8372154bb | 1023 | adds `claim_last_word`, `settle_last_word`, `jobs_owing_a_word`; ends with a rolled-back-by-nothing `do` check that writes nothing | no | none | yes | additive: leave | yes: the old worker never calls them | `to_regprocedure('app.claim_last_word(uuid)') is null` | three rows in the TSV |
| 1025 | `1025_a_budget_counts_the_office_that_spent_it_and_a_queue_serves_every_office.sql` | 74133152cb40decf | 1024 | **drops** `over_budget(text)` and `spent_today(text)`, creates the `(uuid, text)` versions, `budget_defers_kind`; rewrites `defer_over_budget` and **`dequeue_job` (the hot path every worker claim goes through)** | no | none on tables; `dequeue_job` is replaced under live callers (they keep the old text until commit) | yes, explicit `begin`/`commit` | the five signatures and the rewrites, from the snapshot (section 10) | yes: no deployed caller of the dropped signatures exists (old source searched; P19 checks the cron commands) | `to_regprocedure('app.spent_today(uuid,text)') is null` | TSV |
| 1026 | `1026_the_free_tier_is_watched_on_the_way_to_its_limit.sql` | b855a78d12fb149e | 1025 | new table `public.capacity_samples` (row security on) and index; eight `capacity_*` functions; **splices** `chores_for_credentials` and `free_tier_headroom` from their live definitions (stops with a named error if the live definition is not the one it was written against); **inserts one duty row, `capacity-watch` (enabled, every 360 minutes, system office)** | adds one `responsibilities` row | none on existing tables | yes | disable the duty (`update ... set enabled = false`); the rest is additive | **behaviour starts at the migration, before the worker**: `chores_for_credentials` (an existing duty) now runs the capacity pass, which records a sample and, at 70, 85 and 95 percent, raises a chore/notice. If the database is already past 70 percent the first pass says so to Grant (intended). The new job kind `office.capacity_watch` has no handler until the worker deploys; the old worker leaves it queued | `to_regclass('public.capacity_samples') is null` | table exists; `capacity-watch` row present |
| 1027 | `1027_a_task_day_and_a_repeating_reminder_follow_the_office_clock.sql` | 4b23dc8ff1b80d2b | 1026 | new `office_timezone`; rewrites `studio_tasks`, `my_tasks`, `my_tasks_counts`, `reminders_due`, `tasks_repeat_on_done`, `my_task_set`, `reminders_sent`; new `reminder_finish`, `reminders_announced`, `reminders_settle`; **`alter table public.tasks add column remind_job_id, remind_sends integer not null default 0`** | no (a constant default is metadata-only on Postgres 11 and later; the server version is UNKNOWN but every supported one qualifies) | `ACCESS EXCLUSIVE` on `tasks` for the instant of the alter, queued behind any open transaction touching it | yes, explicit | additive columns stay; the functions come back from the snapshot | yes: task days and reminder times follow the office clock (Europe/Athens for Grant) from the migration, whatever worker runs | `to_regprocedure('app.office_timezone(uuid)') is null` | TSV; the two columns exist |
| 1029 | `1029_a_finished_answer_is_redriven_until_it_is_sent_or_visibly_given_up.sql` | b6d6dbfbb40875bb | 1027 | **`alter table public.deliveries add column send_started_at`**; rewrites **`claim_delivery`** (every send), `retry_delivery`, `resolve_indeterminate_delivery`, `undelivered`; **drops and recreates `record_delivery_failure`** with a defaulted extra parameter; new `begin_delivery_send`, `settle_lapsed_deliveries`, `deliveries_to_redrive`, `job_delivery_state`, `reopen_duty_voice`, `delivery_note` | no | `ACCESS EXCLUSIVE` on `deliveries` (about 19 MB on 5 October) for the instant of the alter | yes | additive column stays; functions from the snapshot; **do not revert `claim_delivery` after a send has begun under the new worker** (section 10) | yes: the old worker's four-argument `record_delivery_failure` resolves to the new overload (measured). **Must precede the new worker** | `information_schema.columns` has no `deliveries.send_started_at` | TSV; column exists |
| 1030 | `1030_a_replayed_team_hq_message_is_one_command.sql` | 37ccb556343e5e09 | 1029 | drops and recreates `app.say_in_project` and `public.say_in_project` with a defaulted `p_message_id` | no | none | yes | from the snapshot (drop the new overload first, then recreate the old, app before public: rehearsed) | yes: the old six-argument call works against the new function (measured in a rolled-back call); the shipped hq-api and page do not send the new parameter | `to_regprocedure('app.say_in_project(uuid,uuid,text,text,text[],text,text)') is null` | TSV |
| 1032 | `1032_a_failed_or_uncertain_delivery_of_an_answer_puts_one_question_on_the_persons_list.sql` | be54ec41d539560e | 1030 | new `delivery_words`, `raise_delivery_attention`, `settle_delivery_attention`, `raise_missing_delivery_attention`, `deliveries_attention_trigger`, `answer_delivery_attention`; **partial unique index on `public.blockers`**; **trigger `deliveries_attention` on `public.deliveries`** (after insert or update of state/error_code, when the new state is failed, sent or suppressed); rewrites **`hq_answer_blocker`** (the door his answers pass through), `conversation_history`, `settle_lapsed_deliveries`, `undelivered` | no at apply time. **At the first sweep**: up to 50 Needs-me items for failed result deliveries of the last two days (P06) | index build holds a write lock on `blockers` (small) for its duration; `create trigger` briefly takes a lock on `deliveries` | yes | drop the trigger and index by a forward migration if ever needed (not attempted) | yes: all in the database; the old worker never reads them. Answering a `delivery.decide` question goes through `hq_answer_blocker`, which the old hq-api also calls | `to_regprocedure('app.delivery_words(text)') is null` | TSV; `\d public.deliveries` shows the trigger |
| 1033 | `1033_work_is_delivered_only_to_a_destination_its_own_office_holds.sql` | fddc61185946980f | 1032 | new `destination_held_by_another_office`; rewrites `delivery_refusal` (the containment decision `claim_delivery` asks) | no | none | yes | restore the old `delivery_refusal` **only with Grant's decision: it re-opens cross-office delivery** | yes; it stays in force under the old worker. **Run M21 after applying**: it asks whether any real delivery sent in the last week would now be refused | `to_regprocedure('app.destination_held_by_another_office(uuid,text,text)') is null` | TSV; M21 returns zero rows |
| 1034 | `1034_completing_a_repeating_reminder_completes_that_time_only.sql` | d758056fe87f9c20 | 1033 | **`alter table public.tasks add column last_fired_for, last_completed_for, last_completed_at`**; new `reminder_next_at`, `tasks_series_survives_completion`, **BEFORE UPDATE trigger `tasks_a_series_survives_completion`**, `reminder_series`, `reminder_series_stop` (app and public); drops and recreates `reminder_finish`; rewrites `tasks_repeat_on_done`, `reminders_settle`, `reminders_sent`, `reminders_due`, `hq_task_state`, `my_tasks` | no | `ACCESS EXCLUSIVE` on `tasks` for the alter; `create trigger` lock on `tasks` | yes, explicit | additive columns and the trigger stay; functions from the snapshot | yes for old code (a database decision at the `tasks.state` write: ticking a repeating reminder completes that time only, under any worker). The new hq-api action `reminder_series_stop` needs `public.reminder_series_stop` | `tasks.last_fired_for` absent | TSV; the trigger exists |
| 1035 | `1035_a_lead_reply_is_not_sent_after_the_answer_that_supersedes_it.sql` | d7e58312bb2983eb | 1034 | new `result_superseded`; **splices `claim_delivery`** (a delivery whose answer a later one supersedes is suppressed) | no | none | yes | restore `claim_delivery` only per section 10 | yes: same signature; harmless without the lead-reply gate in the new worker | `to_regprocedure('app.result_superseded(uuid,uuid,text,text)') is null` | TSV |

### 4.3 What cannot be established safely without more evidence

* **Duration and lock waits at production size.** The replica applied all eleven in about 0.05 s each on an EMPTY database; that proves the SQL, not the time. The recorded sizes (5 October, from `docs/ops/evidence/2026-10-05/capture-2026-10-05.jsonl`) are `jobs` 108 MB (not touched by any DDL here), `deliveries` 19 MB, `blockers`, `tasks` and `responsibilities` small enough not to appear among the ten largest. The three `ADD COLUMN` statements and two `CREATE TRIGGER` statements take their lock briefly once they have it; **what is UNKNOWN is how long each waits to get it**, behind a transaction that is already open on `tasks` or `deliveries`. On 3 to 6 October the host showed multi-minute stalls under load, and a single `defer_over_budget` call took 100 s in one of them. Mitigation, all proposals: apply with the worker heartbeat paused (section 5) so the worker holds nothing open; read P03 first for a long-running transaction; if a file waits more than 60 seconds, stop and let the request fail rather than queue other work behind it.
* **First-sweep effects** (P05, P06, and the first capacity reading), above.
* **The runtime of `settle_lapsed_deliveries` over `deliveries`** (a 200-row bounded loop with `for update skip locked`): bounded by construction, not measured.
* **Whether production's definitions are the replica's.** The replica was rebuilt from the repository's migrations; at 25 September it matched production on 806 function bodies. The fingerprint reads in preflight item 5 replace that assumption with a comparison.

## 5. Deployment sequence

The brief's ordering is preserved and verified: **1) migrations, 2) worker, 3) hq-api, 4) voice, 5) signin, 6) Team HQ page.** The dependency that matters, 1029 before the new worker, is enforced by the order and demonstrated by the mixed-version cells (B: the new worker on the old schema degrades; D: it works).

**What is deployed, computed (`npm run release:services -- --against 9310116`, local, no production contact):**

| Service | Verdict | Why |
|---|---|---|
| `worker` | **DEPLOY** | 225 files: 43 changed, 20 added (delegation on every interface, #440/#441, outcome wording, the bounded Notion sync, #443's failure path, #444's fallback policy, the redrive, the lead-reply gate, the planner guard) |
| `hq-api` | **DEPLOY** | `index.ts` (new action `reminder_series_stop`) and `src/text/file-text.ts` (a larger text and PDF reader) |
| `voice` | **DEPLOY** | `index.ts` plus the new `src/auth/conversation-key.ts` (the conversation is the person's durable thread; a message the page names keeps one turn id) |
| `signin` | **DEPLOY** | `index.ts` plus the new `src/auth/redirect-target.ts` (exact-origin redirect check). **The 8 October report did not list it.** |
| Team HQ page | **DEPLOY** | `web/studio/app.js`, `call.js`, `chat.js`, `session.js` changed and **`flow.js` added** (the sign-in flow binding) |
| `mcp`, `voice-token`, `telegram-webhook`, `slack-events`, `slack-oauth`, `google-oauth` | **unchanged: do not deploy** | byte-identical to `9310116`'s bundles. Telegram and Slack routing therefore need no function deployment: the delegation decision lives in the worker. UNKNOWN whether live copies match `9310116` (item 3 of section 1) |

**The order, with the exact commands** (each production command needs `ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1` set by Grant for that command only, a clean pushed tree, `SUPABASE_ACCESS_TOKEN`, and for the page `VERCEL_TOKEN`):

0. **Preflight** (section 3), including the captures: `npx tsx scripts/forensics/capture-functions.ts .out/rollback-2026-10-xx worker hq-api voice signin` and `npx tsx scripts/p3/snapshot-defs.ts .out/rollback-2026-10-xx/defs-before.sql`.
1. **Pause the heartbeat** (optional, recommended, a production write to `cron.job`): `npx tsx scripts/p3/worker-heartbeat.ts pause`. Waits up to three minutes for running jobs to finish and prints how many are left. This is the repository's own mechanism "for a signature-changing release"; 1025, 1029 and 1030 change signatures. The mixed-version cells show the old worker coping without it, so it is a belt, bought with a few minutes of messages queuing (inbound is still recorded and answered after resume).
2. **Migrate**: `npm run migrate -- --dry`, compare with section 4.2, then `npm run migrate`. After it: commit the rewritten `migrations/applied.json`.
3. **Post-migration checks, before any service moves:** M18 (eleven names), fingerprints of the 64 functions against the TSV `md5_after`, **M21 (zero rows)**, P05 again (the rows that the new worker would redrive).
4. **Decide P05/P06 with Grant** (any redrive-due row: leave it to be resent, or have a person mark it, a separate production write).
5. **Worker**: `npm run deploy:worker`. It resolves and validates the bundle before any write, re-sets the function's own secrets (`HQ_MANAGEMENT_TOKEN`, `HQ_PROJECT_REF`, `WORKER_KICK_SECRET`; the kick secret from the vault), deploys, probes (unauthenticated 401, authenticated kick), and then writes `slack.per_office_delivery = true`. **The authenticated kick runs a real worker pass immediately**, whatever the heartbeat state, so it performs the first redrive and the first sweeps. Setting the secrets re-versions every function without changing code (as on 6 October).
6. **hq-api**: `npm run deploy:hq-api` (probe: 401 without a token, 200 with).
7. **voice**: `npm run deploy:voice` (this deploys `voice-token` too; its bundle is unchanged, so it uploads the same content).
8. **signin**: `npm run deploy:signin`.
9. **Resume the heartbeat**: `npx tsx scripts/p3/worker-heartbeat.ts resume`.
10. **Team HQ page**: `npm run config:site`, then `npx tsx scripts/deploy/hq-page-delta.ts` (dry: it compares file names with the live page and prints the rollback point), then `npx tsx scripts/deploy/hq-page-delta.ts --go --allow-new=flow.js,studio/flow.js`. The script refuses a file set that differs from the live one, so `--allow-new` must carry exactly those two names (a file is counted at the root and under `studio/`); computed from `git diff --name-status 9310116 HEAD -- web api scripts/notebook requirements.txt vercel.json`: one file added, four modified. `deploy:hq` (which also redeploys hq-api and fails its page step on Vercel's 10 MB limit) is not used.
11. **Record**: update `docs/ops/deployment-state.json` (new versions, page id, ledger 809 applied), run `npm run check:deployment-state`, commit and push.

**Service impact (estimates, no production measurement):** during steps 1 to 9, jobs are not claimed (minutes; `hq-api` reads and the page keep working; Telegram, Slack and Team HQ messages are recorded and answered after resume). The worker function is replaced in seconds. The page swap is atomic at Vercel. **Anyone holding an emailed sign-in link requested before step 10 loses it:** the page now only adopts a link this browser asked for, so an older link, and a link opened in a different browser or app from the one that requested it, is refused with a sentence and the person asks again (`web/studio/flow.js`, B-05). Expected downtime: UNKNOWN; propose a 90-minute attended window.

## 6. Provider configuration requirements

No new secret, key, scope or setting is introduced (checked by diff). What must already be true:

* **Model provider**: the OpenRouter key in the vault, an account with balance (UNKNOWN: dashboard), `providers.max_cost_per_call_usd` and the two price ceilings set (P13), the chain `openai/gpt-oss-120b`, `qwen/qwen3.7-flash`, `mistralai/mistral-small-3.2-24b-instruct` (P12). Measured cost per smoke-sized turn: primary about US$0.0001 to 0.0006, a fallback-served team turn up to about US$0.001 (R18 runs: 710 real calls, about US$0.068 in total). Busiest real day on record: US$0.0082 (ADR-0029).
* **Telegram**: one enabled bot, the pager, bound to `chief-of-staff` (P11); webhook already registered (unchanged function).
* **Slack**: bot token `ok` (P10). The configuration token is dead since 18 September (administration only). A personal-workspace install has never run live (`REAL SLACK INSTALL - MANUAL ACCEPTANCE REQUIRED`); not part of this release.
* **Google**: revoked since 15 September; Gmail and Calendar duties report that once a day. Not touched. `drive-index` and `calendar-event-sync` stay OFF.
* **Notion**: the sync is bounded and resumable (local proof); the first real run under the new worker is part of the monitoring (the Notion duty's duration, deferred count, no `running` stall). Cause of the 11 earlier exhausted runs: UNPROVEN.
* **Vercel**: `VERCEL_TOKEN` with access to project `ai-team-hq`; the previous production deployment is read by the script as the rollback point.

## 7. Attended smoke test script

**Not executed and not authorised by this document.** Each step that sends a message needs Grant's explicit approval of the destination named in it. Tag every sentence you send with the prefix `[release smoke]` so the rows are findable afterwards and are not mistaken for real traffic in `npm run measure` (they are real traffic: `app.harness_job` cannot exclude them, and should not).

Approved identities and destinations (REQUIRES APPROVAL, none assumed): **T** = Grant's own Telegram chat with the chief bot (no other human receives anything); **H** = Grant's own Team HQ session, and a project he names (UNKNOWN: name); **S** = a Slack channel Grant names that contains only himself (UNKNOWN; if none, F and the Slack half of G are skipped, not replaced); **X** = the Sample Person's office and the TEST office (existing, safe by design: `docs/multi-user/SAMPLE-PERSON.md`). Nothing is sent to a person other than Grant. A Telegram chat that has blocked the bot, or a destination another person holds, is never used.

Maximum wait for any step is stated; a miss is a failure, not a retry. Between steps read M01, M02, M05, M10 (one line each).

| Step | Precondition | Operator action | Expected visible result | Expected database / audit evidence | Max wait | Pass | Fail | Cleanup |
|---|---|---|---|---|---|---|---|---|
| **A** Routine Telegram | deployment complete; heartbeat active | on **T** send `[release smoke] What is the cancellation fee in the venue contract?` (or any question a project document answers; name the project) | one message from Claire alone, answering from the document with its source | one `office.instruction` job, tree of one (no child), no routing-model call; one `deliveries` row, `sent`; M10 shows one telegram `result` | 90 s | one correct message | none, two, a hand-off line, a specialist's name as the speaker, or a claim with no source | none (history is permanent) |
| **B** Explicit delegation | A passed | on **T** send `[release smoke] Ask Daniel and Emma to compare the cost risk and the contract risk of the venue, briefly.` | a lead acknowledgement, then exactly one synthesis, nothing after it; the specialists send nothing themselves | job tree: lead + 2 children + one synthesis; M14 for the correlation: lead reply sent before the synthesis; no delivery from a child | 300 s | the order and the count | a specialist's own message, a duplicate, a synthesis before the acknowledgement, anything after the synthesis, a "have not done this yet" over a grounded finding | none |
| **C** Reminder | A passed | on **T** send `[release smoke] Remind me in 10 minutes to check the smoke test.` | a confirmation naming the time and the zone; ten minutes later exactly one reminder | one `tasks` row (`remind_at` in the office zone), one `reminders.send` delivery, `remind_sends = 1`; M13 empty afterwards | 15 min | one reminder at the right time, in the office's zone | none, two, or a UTC-shifted time | the task is done by completing it (rows are never deleted) |
| **D** Recurring reminder, then stop | C passed | on **T** send `[release smoke] Remind me every day at <time 10 minutes ahead> to check the smoke test.`; when it fires, tick it done (Team HQ or reply); then send `[release smoke] Stop the daily smoke test reminder.` (or press **Stop repeating**) | after the tick the series is still open (next occurrence listed); after the stop, no next occurrence | M20 before and after: `state` open after the tick with `last_completed_for` set; after the stop `cancelled` and no new `remind_at`; no second firing | the next occurrence's time is NOT waited for: assert the next `remind_at` instead | the series survives the tick and ends on the stop | the tick cancels the series, or the stop does not | the stop IS the cleanup; confirm with M20 that nothing recurring remains |
| **E** Team HQ continuation | H | send a question in the project, reload the page, ask `[release smoke] and what about the deposit?` | the follow-up is understood against the first turn; one answer each; the first message is not repeated | one command per message; the second turn's `origin_ref` first segment equals the first's (the durable conversation head); no duplicate command | 90 s | same conversation, no duplicate | answered as a new conversation, a duplicate instruction, the wrong project | none |
| **F** Slack | S approved | post `[release smoke] hello` to **S** in the channel the office listens to | one threaded reply in that channel | one `slack` delivery to that channel and no other; M10 | 90 s | one reply, in the thread | a reply elsewhere, two replies | none |
| **G** Approval boundary | A passed | on **T** send `[release smoke] Post "release smoke" to the Slack test channel.` (needs S) or, without S, `[release smoke] Create a new project called zz release smoke.` | an approval question (or a request for confirmation) appears and nothing is sent or created until answered; answer **no** | a `blockers` row (M17) or a conversational confirmation; **no** Slack `result` delivery to S, no new project | 120 s | nothing outward after the no; the ask is visible | any post or project created without a yes | answer no; confirm M10 shows nothing outward |
| **H** Failure visibility | none in production | **not induced in production** (a harness delivery is suppressed by containment, and breaking a real destination is not authorised). Re-run at the release commit on the replica: `npm run verify:critical -- --only dl-delivery-redrive,terminal-job-owes-a-word,parked-turn-owes-a-word` | the proofs pass (18, 18 and the redrive suite) | local | n/a | proofs green. In production the surface is watched passively: M06, M09, M17 | a failed result delivery with no Needs-me item | none |
| **I** Fallback | none in production | **not induced in production** (it would disable the primary for everyone). Re-run on the replica with real models: `npx tsx scripts/isolated/real-model-acceptance.ts <db> --only=R18 --cases=C1,C2 --trials=4` (about US$0.01) | admitted answers or the limitation; nothing outward | local | n/a | as the final gate report; M07 watched in production | a fallback-served write, send or approval | none |
| **J** Office isolation | X approved | `npm run gate:safe -- --part=identity` (fingerprints 25 offices before and after, runs as the Sample and TEST offices); then M11 and M11b | no office but the TEST office changed; no cross-office delivery | M11 zero rows; every other office's fingerprint unchanged | 10 min per part | zero crossings | any difference | `npm run sample:reset` |

## 8. Expected results and evidence

For every step the evidence is read, not asserted: the job tree and traces for the correlation (`job_traces`: `decision`, and `degradation` entries `fallback_answer_admitted` / `fallback_answer_refused`), the `deliveries` rows (M10, M14), the `outputs` row for what was said, and the Needs-me list (M17).
Record the job ids, the delivery ids and the time of each step in a note beside the deployment record; nothing else is needed to reconstruct the run. A step passes only on its stated rows, never on the screen alone.

## 9. Monitoring and abort conditions

Monitoring is the M queries (read-only, each one statement, `ALLOW_PRODUCTION_CHECKS=1 npm run qq -- "<statement>"`), the platform health API (once at the start, once at the end, never polled), and `npm run check:leaks` and `npm run check:chatter` before and after (`check:leaks` reports known, preserved evidence by design: expect "known" counts and **zero new**).
Coverage: worker crashes (M15, M02, M01), failed jobs (M03), stale leases (M02), retry exhaustion (M03), duplicate deliveries (M05), delivery ambiguity (M06), provider timeouts and fallback frequency (M07, M08), cost (M08), Telegram and Slack failures (M09), incorrect routing (M10, M14), unapproved actions (M10, M17), cross-office failures (M11), database errors (the health API, M15), storage growth (M12), missing reminders (M13), unordered team responses (M14).

**IMMEDIATE STOP** (stop the sequence, do not continue, roll the layer just deployed back per section 10; these need no threshold because the rule is absolute):
1. any cross-office data exposure or delivery (M11 returns a row, or content from another office appears);
2. any message to a destination that is not on the approved list (M10 shows a channel or target not named in section 7);
3. any unapproved write or send, or any outward action by a backup-served turn;
4. a duplicate consequential delivery (M05 returns a row);
5. approval enforcement failing (an action performed after a "no", or without a yes);
6. a migration file failing, or a partially applied state (section 10);
7. the platform health API reading anything but healthy for auth, db, rest or storage, or the database going read-only;
8. materially wrong Telegram routing (an answer in the wrong chat, or from a bot that is not the chief's);
9. a worker retry storm: **proposed** as 30 or more jobs failed or on attempt 3 or higher inside ten minutes, or one job kind failing five times in ten minutes (evidence for the scale: about 22,600 live jobs over six weeks, under one a minute on average; a threshold is a proposal and needs Grant's approval).

**Observations, not stops** (record, continue, review after): fallback decisions above half of an hour's decisions (**proposed**); model spend above US$0.05 in an hour (**proposed**; the busiest real day was US$0.0082) and a hard stop above US$0.50 for the whole window (**proposed**); a single provider timeout answered by the chain; a first-sweep Needs-me item for an old delivery (P06 predicted it); a capacity notice from the first sample; a delivery marked indeterminate (never resent: it becomes a question for Grant).

## 10. Rollback procedures

**Principle: roll back in the order the layers were deployed, newest first, and never roll the database back to the old schema while new services run.** Old code was proved against the migrated schema (cell C); new code is not fully compatible with the old schema (cell B degrades). So the database stays migrated, and what is rolled back is code and, if Grant decides, selected function definitions.

| Layer | Procedure | Proved how | Limits |
|---|---|---|---|
| **Team HQ page** | Vercel: promote the previous deployment (printed by the page script as "rollback: promote <id>"; recorded `dpl_BaQDvaKi1PMQhnXCYCaBKrbd42Cx` is the current one, `dpl_34UgA3XsdS5suXYfs8ehBREu7Z3x` before it) | recorded in earlier deployments; not rehearsed here | none; no database involvement. The old page against the new voice works (a page that sends no message id gets a fresh turn each POST) |
| **signin, voice, hq-api** | `npx tsx scripts/deploy/restore-function.ts .out/rollback-<date>/<slug>.v<n>` (plan only) then `--go`: redeploys the CAPTURED bundle as a new version number | the plan builder is unit-tested; `capture:functions` and a live restore were not run (they need production) | the capture must be taken BEFORE the function is replaced. A restore touches no secret. Rolling `voice` back returns conversation heads to per-visit: history stays (it is derived from the rows) but a turn's context window no longer reaches the earlier visit's turns |
| **worker** | `restore-function.ts .out/rollback-<date>/worker.v975 --go`; **before any database change**. The database stays as migrated | cell C: the old worker on the migrated schema runs, every red it shows is also red on the deployed schema (none new); 45 of 63 proofs green | the old worker loses the redrive, the ambiguity fence, the lead-reply gate and the office-clock reminders; it does not crash. `office.capacity_watch` jobs stay queued (no handler). **Do not roll back after a send has begun under the new worker without reading M06:** deliveries marked `indeterminate` are never resent by either worker and sit as questions for Grant |
| **Database functions** | only if Grant decides. Generate the restoring SQL from the pre-release snapshot: the rehearsed procedure drops the five replacement overloads, recreates the five removed signatures (`app.*` before `public.*`), restores the twenty rewritten definitions, in one transaction. Applying the generated script to a migrated replica returned **all 1,097 deployed-schema function definitions byte-equal (md5) to the deployed schema, 0 differing, 0 missing**, leaving 34 additive functions | local rehearsal (`mkrollback.mjs`, scratch) | a restore of `claim_delivery`, `delivery_refusal` or the `deliveries_attention` trigger **removes protections** (cross-office refusal, the stale-reply suppression): not recommended without a stated reason. The old code on the restored state shows no red the deployed schema does not show (22 of 63 red against 23) |
| **A data migration** | none of the eleven rewrites existing rows at apply time (checked: every `update`/`delete` is inside a function body); the one seed is the `capacity-watch` duty row, reversible by `update public.responsibilities set enabled = false where slug = 'capacity-watch'` | read | the new columns, table, index and two triggers are additive and are left in place; dropping them is a forward migration, not attempted |
| **Partially applied migrations** | (a) a file fails: it is rolled back whole, earlier files stay, the runner stops: forward-fix with a new migration number; never edit an applied file. (b) a file applied but unrecorded (a crash between two requests): see section 4.1: establish by the before-probe whether it is present; 1025, 1026, 1027, 1030, 1034 cannot be re-run; record the ledger row by hand with Grant's approval | (b) measured | the old worker plus a prefix of the migrations is a valid state (every prefix is compatible with the deployed code: the old code ran on the whole set) |
| **Pending jobs** | nothing deletes or rewrites a job. Leases lapse and `recover_stalled_jobs` moves them to `retrying` with their attempts counted (proved: W4, W6) | local | an attempt lost to a crash is not given back |
| **Reminders** | the rows persist; the new columns are harmless to old code; the series trigger is a database decision and stays | C | a reminder that would have fired under the new office-clock rule fires by the old rule if the worker is old: times can shift by the zone offset |
| **Delivery deduplication** | the database's `dedupe_key` and the fence stay; the new `send_started_at` mark is respected by the database functions even under the old worker | C, `dl-delivery-redrive` | the old worker never sets the mark, so an interrupted send under it is as ambiguous as today |
| **In-flight approvals and conversations** | blockers are rows; answering goes through `app.hq_answer_blocker` (database), which both hq-apis call; conversations are derived from rows | local | a `delivery.decide` question raised by the new code remains open after a rollback and is answerable |
| **Backup restoration (last resort)** | `docs/ops/restore-procedure.md`. It is **not automated for production, has never been run against production, and cannot be run from this code** (`restoreArchive` refuses anything but a marked local replica). It restores `public` and `app` rows only: not logins, uploaded file bytes (never backed up), `cron`, secrets, function secrets, or Auth settings. Estimated half a day attended; data load minutes | the data half on a replica (55 checks) | loses everything after the backup; the backup lives in the project it protects (`offsite: false`). Not a release rollback |

**Irreversible, stated plainly:** an applied migration (there are no down files and none is attempted); any message already sent (Telegram and Slack cannot be unsent); the effects of the first sweeps (Needs-me items raised, a redriven delivery sent, a capacity notice); the recorded ledger rows; the worker's re-set function secrets (reversible only by setting them again) and `slack.per_office_delivery` (reversible by an update); the permanence of every smoke-test job and message in history.

**Rehearsal of the one thing that could be rehearsed:** the database-function restoration and the old-code-on-restored-state run were performed on replicas (above). The edge restore, the page promotion and the backup restore need production and were not.

## 11. Cleanup procedures

* Smoke-test artefacts are rows that cannot be deleted (a job is permanent, and so is every message). The cleanup is to leave nothing live: **complete** the one-off reminder (C), **stop** the recurring one (D) and confirm with M20 that nothing recurring remains, **answer no** to the approval (G), create no project, and do not leave a Needs-me item open that the test raised.
* The `[release smoke]` prefix is the record of which rows are the test's.
* `npm run sample:reset` restores the Sample office after J. `gate:safe` fingerprints show whether any real office moved.
* Re-enable nothing: `drive-index` and `calendar-event-sync` stay OFF; backup retention stays recorded and disabled (`docs/ops/backup-retention-policy.md`; no `backup:prune` is run).
* After the page deploy, commit `migrations/applied.json` and the updated `docs/ops/deployment-state.json`; run `npm run check:deployment-state` and `check:migrations`.
* The captured rollback directory (`.out/rollback-<date>/`) is gitignored and holds no secret; keep it until the release is accepted.

## 12. Remaining risks

1. **Capacity** (section 1, item 1): the database may be at or beyond the line this week. Highest consequence, cheapest to read.
2. **First-pass side effects** (P05, P06, the first capacity reading, the first Notion run under the new worker): bounded, by design, and unmeasured.
3. **Unknown lock waits** and the platform's history of stalls under load (3 to 6 October). Four episodes; cause not established; the preflight reads exist to avoid adding load to a sick host.
4. **Live services of unknown provenance** (the "not redeployed" set).
5. **Sign-in change for people**: older emailed links and cross-browser links are refused. Intended; a user-visible change worth saying before it happens.
6. **#444 fallback-model prose**: a backup model can still write a worse sentence that passes the admission checks; it cannot cause an unapproved action. A backup-served answer that passes carries no visible marker for the reader (only the trace): recorded on #444 as the first thing to do after the smoke test.
7. **No production rehearsal** of the edge restore, the page promotion or the backup restore; the backup is not off-project; uploads are never backed up.
8. **Real providers** (Telegram, Slack, Gmail, Notion, voice) have only met doubles in the new code; the smoke test is how that is learned.
9. **`npm run verify:wired` is red on the deployed commit and on this one for the same reason** (a page error `Cannot read properties of undefined (reading 'hue')` and a prototype project that is not found): a stale harness, not a regression; it is not in any gate. The changed page files were checked by the local suites that run (`smoke`, `verify:phone-header` 430/430 and the rest, `verify:dialogs` all passed), by 7 unit files for the sign-in flow, and by `check:templates`; no browser run of the signed-in page against a replica exists since 9310116. Issue #447.
10. Known and accepted from the 6 October record: #436 (Mark done button until reload), MCP `tools/list` unverified, #437.

## 13. Explicit approvals required

None of these is implied by "continue", "finish V1" or "get it ready". Each is separate; approval of one is not approval of the next.

| ID | Approval | What it covers | What it does NOT cover |
|---|---|---|---|
| **R1** | Production READS | exactly: P01 to P19, the health API once, `capture:functions` (four slugs), `snapshot-defs.ts`, `npm run migrate -- --dry`, `check:leaks`, `check:chatter`, and the M queries during the window | any write |
| **R2** | A production WRITE: pause and resume the worker heartbeat | `worker-heartbeat.ts pause` / `resume` | the migration |
| **R3** | A production WRITE: apply the eleven migrations | `npm run migrate`, the 1023 to 1035 list in section 4.2, from commit 8f74449 or its docs-only child | a re-run, a hand-recorded ledger row (separate) |
| **R4** | Production WRITES: deploy | `deploy:worker`, `deploy:hq-api`, `deploy:voice`, `deploy:signin`, the page script with `--allow-new=flow.js,studio/flow.js` | `mcp`, `telegram-webhook`, `slack-events`, `slack-oauth`, `google-oauth` |
| **R5** | Live test messages | the destinations named in section 7 (T, H, S, X) and nothing else | any other person, chat or channel |
| **R6** | Spend ceiling | proposed: US$0.05 an hour observed, US$0.50 for the window as a hard stop | paid infrastructure (none is created) |
| **R7** | The thresholds in section 9 and the capacity rule (85 percent of 500 MB or 1 GB) | proposals above | n/a |
| **R8** | The P05 and P06 decisions | what to do with each redrive-due row and whether to accept the predicted Needs-me items | n/a |
| **R9** | The window | a start, a 90-minute attended slot, and who is at the keyboard | n/a |
| **R10** | Recording the deployment | committing `migrations/applied.json` and `docs/ops/deployment-state.json` | a merge to main (not requested) |
| not requested | backup deletion, retention execution, any credential change, any other-human contact | | |

### The approval packet (what Grant is shown before saying yes to R3 and R4)

* **Exact production project:** the ref the scripts use, `baujwlzcziasnfhhkchg`, confirmed by the operator in the dashboard (UNKNOWN until then).
* **Exact commit:** `8f74449217ca5f3d70ce7166e732355b6f0a6685` (or its docs-only child; verify the empty diff).
* **Exact migrations:** the eleven in section 4.2, in that order, SHA-256 as listed.
* **Exact services:** worker, hq-api, voice (with voice-token's unchanged bundle), signin, and the page; not mcp, telegram-webhook, slack-events, slack-oauth, google-oauth.
* **Expected service impact:** jobs paused for minutes if R2 is approved; sign-in links issued before the page deploy are refused afterwards; downtime UNKNOWN, a 90-minute window proposed.
* **Known irreversible changes:** section 10.
* **Backup and rollback readiness:** UNKNOWN until P18, the captures and the snapshot are read. Known: the rehearsal is overdue, the backup is not off-project, uploads are not backed up; function-level rollback was rehearsed locally.
* **Estimated provider cost:** under US$0.05 for the smoke test on the primary model (measured US$0.0001 to 0.001 a turn); US$0.50 is the proposed hard stop.
* **Proposed smoke-test destinations:** section 7; Grant names H and S.
* **Monitoring and abort criteria:** section 9.
* **Remaining unproven risks:** section 12.

**Recommendation: B.** Make the production reads (R1) and report; then ask for R3 and R4 with the packet above completed from what the reads returned.
