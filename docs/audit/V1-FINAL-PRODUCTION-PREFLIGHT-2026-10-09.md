# V1 final production preflight and release decision (9 October 2026)

**Recommendation: B, CONDITIONAL GO.** The authorised read-only preflight (P01 to P19) established the migration ledger, capacity, queue, delivery and configuration facts the release depends on, and every one of them matches what the plan assumed. What it could not establish, and was not authorised to, is the **live bytes and version of each deployed service** and the **rollback artifacts**; and the restore rehearsal is **18 days old** against an 8 day threshold. Those are named prerequisites below, not defects. A GO is not an authorisation to deploy: nothing here deployed, migrated, wrote to production, sent a message or contacted a person.

Evidence classes are kept apart throughout: **PRODUCTION READ** (this run, 9 October 2026, the read-only preflight only), **RECORD** (a document of what was deployed, not a reading), **REPLICA** (isolated local databases and a real Chromium), **REAL MODEL** (a real provider, on a replica), **LOCAL** (unit and static checks).

## 1. Exact branch and commits

| | |
|---|---|
| Integration branch | `claude/v1-integration-main-2026-10-09`, pushed, no PR, not merged |
| Candidate under test | `a82eac6a4adb` (gates, sabotage, mutation: clean tree, the gate report records it); the head that carries this report is the last commit on the branch |
| Commits since the integration report (`602735f8`) | 4 code and documentation commits (`e853af9e`, `3f718103`, `a82eac6a`, `6aa99b9d`) before the one carrying this report; **no file under `src/`, `supabase/` or `migrations/` changed** (`git diff 602735f8 HEAD -- src supabase migrations` is empty), so the shipped server code and the eleven migrations are byte-identical to what the integration report described. What changed is the Team HQ page (`web/studio`: My Tasks, the 320px header), the gate and its proofs, and the release tooling |
| Reliability branch | `claude/deep-systems-audit-3cwbtc` at `7d387f04`, untouched |
| Efficiency branch | `claude/efficiency-deep-optimization` at `a8bcff77`, read only |

## 2. Current main

`origin/main` = `b8ea3c0a102cf5e6a5bc205e57bca0e5dcc3cd71`, fetched at the start of this run: **unchanged** since the integration report, so nothing needed reconciling. The integration branch is 87 commits ahead of it (merge base is `b8ea3c0`).

## 3. Production preflight P01 to P19 (PRODUCTION READ)

Run once, through the Management API's **read-only** query endpoint (`/database/query/read-only`, which executes as `supabase_read_only_user`: a write is refused by the database whatever the SQL says), after one reading of the platform health API: **auth, db, rest and storage ACTIVE_HEALTHY at 2026-10-09T12:18:55Z**. No retry. Totals: 1 health request and 22 statements (19 from the file, three of them refused for privilege, and three restatements), about 25 seconds of statement time.

| Id | Purpose | Result (exact) | ms |
|---|---|---|---|
| P01 | the ledger | **802 applied, highest `1041_a_project_background_picture_is_an_upload_the_office_can_authorise.sql`**: equals the record | 883 |
| P02 | nothing at or above 1042; production's own 1023/1027 | exactly two rows: `1023_the_health_reading_asks_the_cheap_question_first` (checksum `3298fd85`) and `1027_the_pulse_reads_each_table_once` (`8dca3590`); **nothing named 1042 or higher** | 945 |
| P03 | heartbeat and queue | `heartbeat_active` true, **running 0**, oldest running none, **waiting 0** (an idle queue) | 2572 |
| P04 | free tier by `app.free_tier_headroom()` | **REFUSED 42501**: the read-only role cannot execute `app.*` functions. Restated as P04b below | 1251 |
| **P04b** | the same arithmetic from the catalogue | **database 374,803,603 bytes = 71.5% of 500 MB; storage 504,744,035 bytes = 47.0% of 1 GB (5,909 objects)**. Largest tables: `jobs` 108.2 MB, `job_state_transitions` 42.1, `events` 33.8, `inference_usage` 24.9, `document_chunks` 21.1, `deliveries` 19.3, `storage.objects` 12.8, `job_traces` 11.5 | 1571 |
| P05 | deliveries a first redrive would resend (claimed, lease lapsed, last two days) | **zero rows** | 1051 |
| P06 | failed result deliveries the new sweep would turn into Needs-me items | **`would_raise` 0** | 1914 |
| P07 | open questions | `open_blockers` **192**, `recent` (last two days) **0**. This counts `public.blockers` unfiltered by harness traffic; the user-facing figure is the `needs_me` view, which was not read (outside P01 to P19) | 996 |
| P08 | pending reminders and open series | **REFUSED 42501** (`operator_office()`); restated as P08b | 894 |
| **P08b** | the same, by office kind | **pending reminders 0 and open series 0 in every office kind** (person, sample, system, test; non-fixture) | 1111 |
| P09 | offices | person: 3 active, 23 disabled; sample 1; system 1; test 1 (all active) | 890 |
| P10 | connections (state only) | Slack **bot token ok**; Slack config token dead (purpose `maintains`, administration only); Telegram chief bot ok; OpenRouter ok; Notion ok; Supabase management token ok; Vercel deploy token ok; Google: calendar OAuth client ok (checked 2026-10-09 11:23), Gemini, NotebookLM ok, TTS parked; Groq dead. Most `checked_at` are 18 September, so these are older readings, not fresh proofs | 950 |
| P11 | Telegram bots | **exactly one enabled bot: the pager, `chief-of-staff`**; the seven director bots disabled | 871 |
| P12 | model chain | `openai/gpt-oss-120b` (10), `qwen/qwen3.7-flash` (20), `mistralai/mistral-small-3.2-24b-instruct` (30), all `usable`, 0 consecutive failures; free-tier models after them (two `rate_limited`) | 994 |
| P13 | spend ceiling | OpenRouter enabled, `free_only` false, price ceilings 0.20 / 1.00, **`max_cost_per_call_usd` 0.01** | 865 |
| P14 | duties | 16 enabled (including `drive-watch` every 10 min and `notion-sync` every 2 h); **`drive-index`, `calendar-event-sync`, `vault-export`, `vikunja-sync` disabled**; **`capacity-watch` absent** (migration 1045 adds it, as expected) | 936 |
| P15 | standing config | `telegram.only_chief_speaks` true; **`slack.per_office_delivery` already true** (the 6 October worker deploy set it, which corroborates that deploy); `jobs.lease_seconds` 300 | 2010 |
| P16 | test origins (counts only; the first version was `select *`) | mcp 14, slack 35, teamhq 23, telegram 295 registered over time, **0 live** | 877 |
| P17 | what was said in the last hour | one Slack result sent: the window is not perfectly quiet, which is normal | 903 |
| P18 | `app.backup_health()` | **REFUSED 42501**; restated as P18b | 974 |
| **P18b** | backups from the bucket and the rehearsal events | newest backup **2026-10-08 14:52:18Z, 21.5 h old** (threshold 36 h); **21 finished backups** kept; newest **26.6 MB**; **last (and only recent) restore rehearsal 2026-09-21 18:23Z, passed: 18 days old against an 8 day threshold: OVERDUE** | 1076 |
| P19 | cron commands naming a function the migrations remove | **zero rows** | 834 |

Unresolved uncertainty, stated: P10's `checked_at` values (mostly 18 September); whether the 192 open blockers are his (P07 is unfiltered); the platform's own state beyond one health reading.

## 4. Query safety assessment

- Every statement was read before it ran. The static rule (`scripts/release/plain-select.ts`: one `select`, no second statement, none of insert, update, delete, drop, alter, create, truncate, grant, revoke, copy, call, do, `pg_sleep`, `nextval`, `setval`, `set_config`, lock) is a module with a test (`tests/release/plain-select.test.ts`, 15 tests): every statement in the file passes it, none selects a secret, token, vault, message body or transcript, none names a column that only a pending migration adds, and **nine controls (a write, an update hidden behind a semicolon, a delete inside a CTE, DDL, a sleep, a setting change, a sequence advance, a lock, a comment hiding a second statement) are refused**.
- The real guarantee is the **database's**: the read-only endpoint runs as a read-only role, so a statement that slipped the rule could still not write. Its cost was bounded by the 20 s per-statement client timeout (the slowest took 2.6 s) and by being reads of catalogues and small tables; no table scan beyond `storage.objects` (5,909 rows) and `jobs`' recent window.
- Two corrections found by reading before running, both made in the file (history kept): **P05 tested `send_started_at`, a column only migration 1047 adds**, so it would have failed on production before the migration (its condition is true of every pre-migration row, so dropping it returns the same set); **P16 was `select *`**, which would have printed chat identifiers.
- Target: project ref `baujwlzcziasnfhhkchg` (the script default; the operator confirms it against the dashboard), `TARGET_ENVIRONMENT` unset, no staging attestation. The production gate (`ALLOW_PRODUCTION_CHECKS=1` for this one command, set by me on Grant's explicit authorisation in this brief) permitted it; `ALLOW_PRODUCTION_WRITES` was never set.
- Exposure: counts, timestamps and state words only. No secret value or reference, no message text, no personal data beyond bot usernames (public) and office kinds.
- **Not run, and why:** `capture:functions`, `snapshot-defs.ts`, `migrate --dry`, `check:leaks`, `check:chatter` and the M queries (the brief authorises P01 to P19 only and says not to broaden); the Vercel and function-listing metadata reads.

## 5. Actual migration state

Production ledger **802, highest 1041** (PRODUCTION READ, same minute as the capacity reading). The repository holds **813** files: the 802 recorded plus the eleven pending `1042` to `1052` (renumbered from 1023 to 1035). `check:migrations` passes (a recorded 0584 collision between branches is a note, not a fault). Nothing at or above 1042 is applied. The eleven bodies are byte-identical to the integration report's, their SHA-256 prefixes are in the plan (section 4.2, under the numbers they were authored with: 1023, 1024, 1025, 1026, 1027, 1029, 1030, 1032, 1033, 1034, 1035 are now 1042 to 1052 in that order).

## 6. Migration 1030 versus 1044: resolved by deferring 1030 and proving the combination

**What the conflict was.** Efficiency's unapplied `1030` rewrites `app.dequeue_job` to ask the self-improvement ceiling lazily (an InitPlan evaluated only when a queued job is of a self-improvement kind; an empty pass was paying about 2,400 buffers a minute for it). V1 `1044` rewrites the same function to add a per-office fair share (an `ORDER BY` term, never a refusal) with spend counted by office. Applied in either order one undoes the other. It is the only function the two sets share (measured across all nine efficiency and eleven reliability files).

**Decision: 1030 is NOT required for this release and is deferred; nothing can apply it by accident.**
- It lives on an unmerged branch and is not in `migrations/`; the runner reads only `migrations/`. `tests/migrations/dequeue-redefinition.test.ts` (5 tests) fails if any numbered migration from 1044 on replaces `app.dequeue_job` without the fair-share term (a property, not a file name), shows efficiency's 1030 as written is exactly the shape it refuses (control), shows 1044 itself satisfies it (so it is not vacuous), and fails if any of efficiency's unapplied 1024 to 1031 files appears in `migrations/`.
- The **reconciled** definition (1044's body with 1030's single change) is kept as `docs/audit/deferred-migrations/dequeue_job-efficiency-1030-reconciled-with-1044.sql`, outside `migrations/`, with the instruction to take the next free number above 1052 and splice from the then-live definition. Proof: `scripts/isolated/dequeue-reconciled.ts` (REPLICA; in the critical gate, 21 assertions):
  - the reconciled function claims **exactly what 1044 claims in all 49 cases** (budget x queue x kinds x scope, plus retrying, exhausted attempts, delayed, concurrent limit reached, disabled office, and four fairness shapes), 29 claiming a job and 20 claiming nothing;
  - **the conflict is proven**: efficiency's 1030 as written lets office A's burst run before office B's one job (fairness cases 1 and 4) where 1044 and the reconciled function put B first; priority still outranks the share, and a lone office still uses every slot;
  - the ceiling is asked **0 times on an empty or ordinary-only queue (1044: once) and once when a self-improvement job is queued**; spent, a self-improvement job is held and an ordinary job is claimed past it;
  - the lease (about 300 s), the attempt count and the claim generation, and `22023` for a blank worker identity;
  - **one office cannot consume another's budget or work**: B spending past its ceiling parks B's background work and not A's, and the dequeue claims A's job and never B's held one;
  - **two real connections**: the second caller waits on the dequeue lock while the first holds its claim open, then claims the *other* job;
  - **two sabotages, each shown to land and caught**: the fairness term removed (A claimed first) and the ceiling replaced by `true` (the held job claimed).
- Partial application: the eleven are applied one file per request and each is its own transaction; the previously measured behaviour (a second application of 1044, 1045, 1046, 1048 and 1051 fails and must not be re-run; the others are idempotent) is unchanged because the bodies are unchanged, and the plan's catalogue before-probes are the way to tell. Issue #446 (ledger row in the same transaction) remains open.

## 6a. Capacity and headroom (PRODUCTION READ)

Database **71.5%** (374.8 MB of 500 MB; headroom 125 MB) and storage **47.0%** (504.7 MB of 1 GB), both under the proposed 85% stop. The 5 October record was 74%, so the database is **2.5 points lower** (retention duties), not growing toward the line. What the release adds: one small table (`capacity_samples`, empty), six columns and an index on existing tables, two triggers and 34 new functions: well under 1 MB. Temporary rewrites: none (the three `ADD COLUMN`s are metadata-only with constant defaults). Worker recovery and rollback add no data. **Two consequences to expect, both by design:** the first capacity pass (migration 1045 changes `chores_for_credentials`) will tell Grant the database is past 70%, because it is (71.5%); and `capacity-watch` is created enabled. Both are within the plan. Headroom is adequate for the release.

## 7. Backup and rollback readiness

- **A recoverable backup exists**: 21 finished backups, newest 21.5 h old, 26.6 MB. It is **not a verified recovery path**: the last restore rehearsal passed on 21 September (18 days; threshold 8 days), nothing since has been restore-tested, the backup is not off-project (`offsite` false), uploaded file bytes are not in it, and the vault export is disabled so a restore would produce a database without credentials. None of this is new; all of it is in the plan. **The release's own rollback does not depend on a backup restore** (migrations are additive and stay; code is restored from captured bundles; function definitions from a pre-migration snapshot, rehearsed to restore 1,100 definitions byte for byte).
- **Prerequisite:** run `npm run backup:rehearse` (a production read of the newest backup into a local replica) before the migration, or accept the gap in writing. Issue #456.
- **Rollback artifacts do not exist yet** (this is a fresh container; `.out/rollback-release/` is absent). They are produced by the read-only `capture:functions` and `snapshot-defs.ts` immediately before deployment, which this run was not authorised to do. Until they exist, **deployment is blocked**.

## 8. Pending delivery and redrive exposure (PRODUCTION READ)

P05 **zero** deliveries the first redrive would resend; P06 **zero** failed result deliveries the sweep would raise as questions; P08b **zero** pending reminders. The new worker's first pass therefore has nothing old to resend and nothing old to ask about. (P07's 192 open blockers are not new work for the release; the `needs_me` count should be read at the window so the release is not blamed for them.)

## 9. Deployed service inventory

No SQL can name a function's bytes, and the function listing and capture were outside the authorisation, so **every live version below is a RECORD, not a reading**. What the reads do corroborate: the ledger (1040/1041 present) agrees with the 9 October release record; `slack.per_office_delivery` true agrees with the 6 October worker deploy; duties ran on 9 October, so a worker is running.

| Service | Recorded live version (source) | Observed this run | Candidate | Bundle differs? vs `9310116` / vs `main` | Deploy? | Order | Rollback artifact |
|---|---|---|---|---|---|---|---|
| worker | v975, 6 Oct, from `9310116` (deployment record; later releases say they did not redeploy it) | UNKNOWN (P15 corroborates the 6 Oct deploy only) | this branch | yes (44 changed, 20 added) / yes (same) | **yes** | 5 | **not yet captured** |
| hq-api | v899, 9 Oct (`deploy-442-445.md`) | UNKNOWN | this branch | yes / `index.ts` and `src/text/file-text.ts` only | **yes** | 6 | not yet captured (v897 was captured by the 9 Oct release into a gitignored folder that no longer exists here) |
| voice | v658 | UNKNOWN | this branch | yes (`index.ts`, new `conversation-key.ts`) / same | **yes** | 7 | not yet captured |
| signin | v129 | UNKNOWN | this branch | yes (`index.ts`, new `redirect-target.ts`) / same | **yes** | 8 | not yet captured |
| Team HQ page | `dpl_6zXtXeMzJVMLgh1S8kr2xy86Eu41` (9 Oct) | UNKNOWN | this branch | yes (23 changed, 27 added) / 7 files changed (`app.js`, `bc/compose.css`, `bc/shell.js`, `bc/wire.js`, `call.js`, `chat.js`, `session.js`) and `flow.js` added | **yes** | 9 | previous Vercel deployments (ids in the record are partly truncated: read them at the window) |
| voice-token v687, mcp v664, telegram-webhook, slack-events, slack-oauth, google-oauth | recorded, unchanged since 6 Oct or earlier | UNKNOWN | unchanged | **no** against `9310116` and `main` | no | | n/a |

**Never overwrite an unknown newer deployment:** the deploy scripts compute their bundle from the repository and replace the function, so a deploy over a version that is not the recorded one would silently drop whatever it held. That is why the function inventory is a stop-the-line prerequisite (section 14).

## 10. Disposition of Issues #450 to #455

| # | Disposition | Evidence |
|---|---|---|
| **450** My Tasks showed only Today, so a ticked series could not be stopped | **FIXED on the branch.** Every open repeating reminder is also listed under **Repeating reminders** with its next time ("next Fri, 16 Oct, 13:54 · every 7 days") and the same press-again **Stop repeating**, from the same gateway section (no second task system). A tick or a stop now re-reads the list **in place** instead of blanking it: the first version blanked the list and the gate's `series-ui-browser` caught a second tick landing on a row being replaced (72/73, then fixed and green twice) | REPLICA + real Chromium + real gateway, desktop and phone: 50 assertions, including stop from the section when not due, the database cancelling exactly that series, **stopping it again is a no-op that says it had ended**, **another office cannot stop it**, no duplicate row for a series already on Today, no page error, 44px to touch; a sabotage (the gateway refusing the stop) turns the database checks red. PNGs inspected |
| **451** migration collision | **RESOLVED by deferral and proof** (section 6) | `dequeue-reconciled` 21/21 in the critical gate; 5 unit tests |
| **452** held-document denial | **CLASSIFIED: EXPECTED STOCHASTIC VARIANCE, no deterministic cause found, no fix.** Instrumented the real-model harness to record what the answering model was shown: **the contract's own text was in the prompt on 42 of 42 turns** (two runs, R16, primary `openai/gpt-oss-120b` with the fallbacks used when it was refused), and **0 of 42 denied it**; earlier the same day 2 of about 13 did, with the same retrieval. So retrieval, prompt assembly, authorisation and capability information were correct each time it was measured; the earlier denials were the model reading the evidence and saying "no record". Pooled rate about 2 of 55 (4%), too thin to build a retry on | REAL MODEL, replica, 81 calls, US$0.0106 in all. `scripts/isolated/real-model-acceptance.ts` now prints `contractInPrompt` for every denial and asserts the prompt held the contract (a DETERMINISTIC line) |
| **453** project name 54px at 320px | **FIXED, root cause found.** The ≤360px rule that hides the project mark to give the name room targeted `.bcjump--in .bcjumpmark`, a class the hamburger redesign (ADR-0068) renamed to `.bchere`: the rule matched nothing, so the mark kept its 26px. One selector. The name is **80px** at 320 (was 54), desktop untouched (the rule is ≤360px only). The 320px leg that found it was not in any gate; the gate now runs `--only=320,390` | REPLICA + real Chromium, person and Sample visitor; `verify:phone-header` all passed at 320/360/390/430 including a 110-character name; PNG inspected |
| **454** stale gate candidate | **FIXED.** The candidate stamp covered `post`'s build time and the pending migrations but not what `post` *holds*; a proof run directly against `post` committed offices into it and the cached candidate was reused as current. The stamp now includes counts of logins, offices and functions in `post`, **demonstrated**: pollute `post` → the candidate rebuilds; restore → it rebuilds once, then reuses. Every gate report now carries `source`: the commit, the branch, and either `tree clean` or **`tree DIRTY (digest …: this run did NOT test the commit alone)`**; a digest covers tracked changes and untracked files | REPLICA; `tests/gate/source-identity.test.ts` (4: clean has no digest, a content change moves it, an untracked file counts, reverting makes it clean) |
| **455** red checks on main | **CLASSIFIED, none release-blocking, none changed** (below) | the five commands run on this branch with output read |

**#455 in detail** (all red identically on unmodified `main`):

| Check | Class | Why |
|---|---|---|
| `check:branding` | stale expectation (tooling) | one internal identifier, `surface: 'basecamp'`, a gateway argument at `web/studio/app.js:14306` that no person sees; the check wants the exact token added to its `INTERNAL` list with a reason |
| `check:tokens` | tooling false positives | `--cols` is defined inline by `style="--cols:…"` (`bc/calendar.js:486`) and `--bc-shade-ink` is defined at `stone.css:365` and `:380` on the same element that uses it; the checker reads definitions only at root level |
| `check:door-origins` | latent harness defect, production-read dependent | `scripts/p3/inventory.ts` and `scripts/p4/mcp.ts` drive a real door without declaring a test origin; neither runs in any gate, both need production or an MCP endpoint |
| `check:office-raw-sql` | ratchet drift | 73 unscoped against a baseline of 68; the three named sites (`drive-index.ts:87`, `style-adopt.ts:25`, `web-research.ts:117`) read `pinned_config` from `public.jobs` **keyed by the id of the job the worker already holds**, so single-office by construction; five earlier sites were converted. The ratchet wants each classified |
| `check:voice-sessions` | latent harness defect | a p3 case (`s-${run}`) and the Sample showcase script send voice session labels that do not read as harness; the first runs on a replica, the second against the public Sample's guest office |

`check:office-conversion` and `check:gateway-wrappers` need a production read and were not run.

## 11. Tests run on the final candidate

| Check | SHA / state | Result | Class |
|---|---|---|---|
| `tsc --noEmit` | `6aa99b9d` | 0 errors | LOCAL |
| `npm run lint` (`biome ci .`) | `6aa99b9d` | exit 0 | LOCAL |
| unit (`vitest run`) | `6aa99b9d` | **428 files passed, 1 skipped; 6,726 tests passed, 21 skipped, 0 failed** | LOCAL |
| `check:migrations`, `check:secrets`, `check:templates`, `check:deployment-state`, `check:reachable`, `check:suite-offices`, `npm run smoke` | `6aa99b9d` | all exit 0 | LOCAL |
| `verify:critical` | `a82eac6a`, tree clean (report names it) | **67/67 green, 3,664 assertions, 92 s** (the 67th is `dequeue-reconciled`) | REPLICA |
| `verify:extended` | `a82eac6a`, clean, run twice | **73/73 green, 1,727 assertions**, 101 s and 105 s. At `3f718103` it was **72/73**: `series-ui-browser` red on a race this run introduced (above), fixed in `a82eac6a` | REPLICA + Chromium |
| `verify:gate-sabotage` | `a82eac6a`, clean candidate | **16 of 16 sabotages landed (the live definition, constraint or index read back) and were caught**; the restored candidate is 67/67 with no proof red that was not red at baseline | REPLICA |
| mutation campaign | `a82eac6a` | **74 of 74 anchors land exactly once** (a sabotage that did not land proves nothing, so this is checked first); **M3, M15, M27, M41, M42, M44: 6 of 6 caught**, baseline green. `src/` and `supabase/` are unchanged since the 16 of 16 recorded in the integration report | LOCAL |
| `verify:phone-header` | `6aa99b9d` | all passed, 320/360/390/430 and 1440 | REPLICA + Chromium |
| `combined-browser --only=320,390` | in the extended gate | green (person and Sample visitor; guest writes refused with the sentence) | REPLICA + Chromium |
| `series-ui-browser`, `chat-dock-browser` | in the extended gate | green | REPLICA + Chromium |
| real-model R16 and R17 | replica | R16 0 denials in 42 turns, the contract in the prompt every time; R17 follow-up resolved | REAL MODEL |

**Limits.** The commits after `a82eac6a` change only `scripts/release`, `tests/release`, the series proof's `--shots` flag and documents; the gates were not repeated after them, the unit suite, lint, typecheck and static checks were. The Sample zero-write and office-isolation proofs are in the critical gate. Simulated devices are not physical devices. Not run: `gate:safe` and the Sample's production suites (production), `verify:wired` (a stale harness, red on the deployed commit, issue #447), `verify:talk`.

## 12. Outstanding unknowns (none established by this run)

1. Each live service's version and bytes (section 9) and the live page deployment id.
2. The live `SIGNIN_ALLOWED_ORIGIN`: the signin deploy script sets a list that includes `https://team-hq-ux-review.vercel.app`; whether production should carry that origin is **Grant's decision**.
3. Whether the 192 open blockers (P07) are real questions of his or harness debris.
4. OpenRouter balance (a dashboard); the platform's behaviour under the migration's brief `ACCESS EXCLUSIVE` locks (never measured at production size; the three `ADD COLUMN`s are metadata-only).
5. Whether Google is currently usable (the OAuth client reads ok; the token was recorded revoked on 15 September).
6. Notion: the production cause of the earlier exhausted runs is unproven; the bounded, resumable sync is replica-proved only.

## 13. Exact deployment sequence (NOT AUTHORISED; supersedes the 9 October plan's numbers and order)

0. **Approvals** (section 16). 1. **Function inventory and rollback capture, read-only:** list the deployed functions and versions; `npx tsx scripts/forensics/capture-functions.ts .out/rollback-<date> worker hq-api voice signin`; `npx tsx scripts/p3/snapshot-defs.ts .out/rollback-<date>/defs-before.sql`; read the production Vercel deployment id. **Stop if any live version is not the recorded one** (worker v975, hq-api v899, voice v658, signin v129): the plan is void until the difference is understood. 2. `npm run backup:rehearse` (or a written acceptance). 3. Repeat P01, P02, P05, P06 and the health reading immediately before: 802 / 1041, nothing at 1042 or above, zero, zero, healthy. 4. `worker-heartbeat.ts pause` (R2). 5. `npm run migrate -- --dry` must list exactly the eleven `1042` to `1052` names, then `npm run migrate` (R3); commit the rewritten `migrations/applied.json`. **Do not use `migrate` from any branch that is behind the ledger; `migrate:one` is for a single known file.** 6. M18 (the eleven names), the function fingerprints against the TSV `md5_after`, **M21 must return zero rows**, P05 again. 7. `deploy:worker`, `deploy:hq-api`, `deploy:voice`, `deploy:signin` (R4), each probing itself. 8. `worker-heartbeat.ts resume`. 9. `config:site` then `hq-page-delta.ts` (dry) then `--go --allow-new=flow.js,studio/flow.js`. 10. M01, M02, M05, M11, M15; the attended smoke test only to destinations Grant names (R5); record the deployment in `deployment-state.json` and `migrations/applied.json`.

## 14. Rollback and abort triggers

**Immediate stop** (the plan's section 9, unchanged): any cross-office exposure (M11 returns a row); a message to a destination not on the approved list; an unapproved write or send; a duplicate consequential delivery (M05); approval enforcement failing; a failed or partially applied migration; the health API reading anything but healthy, or the database read-only; materially wrong Telegram routing; a retry storm (proposed: 30 jobs failed or on attempt 3 or higher in ten minutes). **New, from this run:** any live service version that is not the recorded one at step 1; P01 not 802 / 1041; database at or above 85% or storage at or above 85% at step 3; P05 or P06 no longer zero (a decision per row before the worker moves). **Rollback**, newest first, the database stays migrated: the page by promoting the previous Vercel deployment; `restore-function.ts` from the captured bundles for signin, voice, hq-api, then the worker; database functions only on Grant's decision, from `defs-before.sql` (rehearsed: 1,100 definitions byte for byte), never restoring `claim_delivery`, `delivery_refusal` or the `deliveries` trigger without a stated reason. **Irreversible:** an applied migration, any message sent, the first sweeps' effects, ledger rows, smoke-test history.

## 15. Explicit approvals required for the next step

Each is separate; none is implied by this report. **R1b** one more production READ: the function listing and `capture:functions` for the four slugs, `snapshot-defs.ts`, the production Vercel deployment id, and `needs_me`'s count (all read-only; none was in P01 to P19). **R1c** `npm run backup:rehearse`. Then, only after those: **R2** pause and resume the heartbeat; **R3** apply the eleven migrations; **R4** deploy the four functions and the page; **R5** the smoke-test destinations (Telegram: Grant's own chat; Team HQ project and Slack channel named); **R6** spend ceiling (proposed US$0.05 an hour observed, US$0.50 hard stop); **R7** thresholds (85% capacity, the retry-storm number); **R9** the window and who is at the keyboard; and the **SIGNIN_ALLOWED_ORIGIN** decision. A merge to `main` is a separate release decision.

## 16. Recommendation

**B, CONDITIONAL GO.** Reasons: the preflight confirmed every fact it could (ledger 802 / 1041 with nothing pending applied, 71.5% database and 47.0% storage with 125 MB of headroom, an idle queue, zero deliveries a first redrive would resend, zero failed deliveries the sweep would raise, zero pending reminders, one enabled Telegram bot bound to the chief, the model chain and spend ceiling as expected, the two duties that must stay off off); the integrated candidate passes every gate that can run without production on a clean tree, with all 16 gate sabotages and 6 mutations caught and shown to land; and the three defects the integration report left open that were demonstrable are fixed (#450, #453, #454), one resolved by deferral with proof (#451), one classified with evidence (#452) and one classified as not blocking (#455). **Not A** because the live bytes of the services I would replace are unknown and the rollback bundles do not exist yet, and a deploy over an unknown version could silently drop it. **Not D** because the facts the preflight was meant to establish were established. **Exact next action:** Grant approves **R1b** (a read-only function listing and capture, the Vercel deployment id and the `needs_me` count) and **R1c** (the restore rehearsal), and decides the `SIGNIN_ALLOWED_ORIGIN` question; I then report whether the live versions are the recorded ones, and only if they are does the sequence in section 13 become something to ask R2 to R9 for.

## Process disclosures

All repository edits went through the Edit and Write tools, and the formatter's hunks were applied by hand. A heredoc wrote three scratch scripts under the session's scratchpad directory (a stale-candidate demonstration, an anchor check and a list of mutation ids; not repository files, not committed). One earlier turn in the integration run used a Python heredoc on `CLAUDE.md`, disclosed in that report. Production contact this run: the single health reading and the 22 read-only statements above; no write, no deploy, no message, no credential change, no backup touched.

Issues: #450 to #455 (comments added with this run's disposition; none closed, because the fixes are on the integration branch and not on `main`), **#456** (the overdue restore rehearsal).
