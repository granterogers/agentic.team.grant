# Restoring the office: what a backup holds, what a recovery needs, and what is and is not proven

6 October 2026. Written for G-2 of `docs/audit/DEEP-SYSTEMS-AUDIT-2026-10-06.md`. **No production contact was made.** Every claim is marked
REPLICA-PROVEN (driven on the isolated replica with controls, by a script in this repository), DESIGN-ONLY (specified here, not run), UNVERIFIED (a
vendor or platform fact that could not be checked offline) or UNPROVEN (needs a production read; parked).

## The honest summary

* **After this work the DATA half of a restore is proven and the SYSTEM half is not.** A backup taken by the repository's own handler can be restored,
  with the real column types, constraints, triggers, row security, composite foreign keys, generated columns and sequences, into a database built
  from the migrations, and checked row by row (`src/backup/restore.ts`, `scripts/isolated/backup-restore-typed.ts`). That is REPLICA-PROVEN, 55 checks.
* **Restoring into a real Supabase project is NOT automated and is deliberately not possible from this code.** `restoreArchive` refuses anything that is not a
  marked local replica, and there is no flag for production in this change (the instruction was explicit). The path to production is a procedure
  below that uses the proven replica as the staging area. It has never been run.
* **A restore of `public` and `app` does not by itself give back a working system.** Logins (`auth.users`), uploaded file bytes, the `cron` schedule, every secret value, the edge
  functions' own secrets, the Telegram and Slack registrations and the Auth service's configuration are not rows in `public` or `app`. This change records the part of that
  which can be recorded as data (names, ids, paths, schedules) inside every backup, and specifies the rest as an ordered checklist with the evidence that proves each step.
* **The backup still lives in the project it protects.** If the project is lost, so is the backup. The off-project design below is the answer; only its pure
  half (packaging, encryption interface, verification) is built, and nothing has been uploaded anywhere.
* **Realistic RTO if the whole project is lost and everything goes to plan: half a day of attended work, dominated by re-entering credentials at third parties.** The data
  load itself is minutes. See the table at the end. **RPO is about a day by design, 48 hours observed once, and for uploaded files it is "never backed up".**

## What a backup contains, and what a working system needs

| Needed to run | In the backup before this change | In the backup now | How it comes back |
|---|---|---|---|
| Rows of `public` and `app` (162 tables on the replica) | yes (untyped JSON, one object per table) | yes, **Postgres's own JSON text**, keyset-paged, with a per-object checksum and a per-table content fingerprint recorded in the manifest | `restoreArchive` (REPLICA-PROVEN) |
| Table structure, constraints, triggers, policies, indexes | no (the file says: apply the migrations from git) | a **structure fingerprint** (counts and a hash of every column) so a target built from different migrations is refused | `npm run migrate` against the new project; the restore compares the result with the fingerprint |
| Identity and serial sequences | no | last values of every sequence in `public` and `app` | `restoreArchive` sets each to the larger of the recorded value and the column maximum (REPLICA-PROVEN) |
| **Logins, `auth.users`** (every login; `office_members` and `offices.auth_user_id` reference it) | **no** | **id, email, phone, confirmation time, created/last sign-in, user and app metadata. Never a password hash or a token** (a whitelist in `src/backup/aux.ts`, with a test that fails if the whitelist ever holds a secret column) | Auth admin API with the ORIGINAL id (`authUserPayloads`, payload builder REPLICA-PROVEN; the API call is DESIGN-ONLY) |
| **Storage object bytes** (uploads, generated PDFs) | **no** | path, bucket, size, type and Storage's own etag of every object outside the `backups` bucket (20,000 row cap, flagged if hit) | **NOT recoverable from the backup.** Bytes come back only from an off-project copy that carries them (design below) |
| **`cron.job`** | **no** | jobname, schedule, active flag and the command with any credential-shaped text redacted | `cronRestoreSql` (SQL generation REPLICA-PROVEN; execution against real `pg_cron` DESIGN-ONLY: the replica's `cron` is a stub without `cron.schedule`) |
| **Vault secrets** | no, correctly | the **names and descriptions only**, never a value | re-enter each value at its provider; `vault-export` (disabled, never run) is Grant's decision |
| Edge function code | in git | n/a | `npm run deploy:*` from a clean, pushed commit |
| Edge function secrets | no | n/a: **names** are in the code (list below) | re-set each from its provider |
| Telegram webhooks, Slack event URLs | no | n/a | `npm run telegram:webhooks`, `deploy:slack` and the Slack app's own settings |
| Auth configuration (redirect allow-list, site URL, SMTP, templates) | no, and **not in the repository either** (audit B-04) | n/a | by hand in the dashboard; capturing it read-only through the Management API is DESIGN-ONLY |
| Environment-bound `system_config` rows | yes, with the OLD project's identity in them | same | `db.project_ref`, `web.base_url`, `notebook.*_url`, `voice.api_base_url` must be rewritten for a new project: **a restore that skips this points the heartbeat at a dead project** |

The function-secret names the code reads (from a grep of `Deno.env.get('...')` in `supabase/functions` and `src`, single-quoted calls only):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `HQ_API_TOKEN`, `HQ_PROJECT_REF`, `HQ_MANAGEMENT_TOKEN`, `HQ_SITE_URL`,
`WORKER_KICK_SECRET`, `WORKER_URL`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_ID`, `SLACK_SIGNING_SECRET`, `SLACK_CLIENT_SECRET`, `SLACK_BOT_USER_ID`,
`OPENAI_API_KEY`, `VOICE_NAME`, `VOICE_MODEL`, `VOICE_ALLOWED_ORIGIN`, `SIGNIN_ALLOWED_ORIGIN`. The first four are supplied by the platform to a function.

## Three disasters, and which of them a backup covers

| Disaster | What is lost | Does the in-project backup help? |
|---|---|---|
| **A. Logical damage in a live project** (a bad migration, a deleted table, a bug that wrote nonsense) | rows | **Yes.** This is the only case the current backup was ever able to cover |
| **B. The project is lost or unrecoverable** (platform fault, deletion, the storage limit blocking writes until it is read-only) | everything in it, including `backups` | **No.** The backup is in the same project. Only an off-project copy helps |
| **C. The Supabase account is lost** | the project and the means to make another | **No**, and the off-project copy needs a new account to restore into |

## The procedure, in order

Steps 1 to 4 have a script or code. The evidence column is what proves the step, not what says it happened.

| # | Step | Kind | Evidence that proves it |
|---|---|---|---|
| 0 | **Stop the writer.** Pause the worker heartbeat (`cron.unschedule`) so nothing enqueues work against a half-restored database | manual | `net._http_response` shows no new worker kicks |
| 1 | **Pick the archive and verify it before anything else.** `verifyArchive` (pure): every object named by the manifest exists with the checksum the manifest recorded, counts add up. For the folder in the bucket, `StorageFolderSource.observed()` reads and hashes every object (type-checked, **not exercised against a real bucket**). For an off-project copy, `openOffsite` decrypts, unpacks and verifies against its own manifest (REPLICA-PROVEN with real `age`) | automated | `verifyArchive.ok`; for a bundle, `openOffsite().verdict.ok` |
| 2 | **Provision the target**: a NEW Supabase project (scenarios B and C) or a local replica (scenario A and every rehearsal). Apply the migrations from git up to `manifest.latest_migration` | manual then automated | the structure fingerprint of the target equals `manifest.aux.structure` (`restoreArchive` checks it and refuses otherwise) |
| 3 | **Re-create the logins with their original ids** before any row that references them. `authUserPayloads(manifest)` builds the Auth admin API bodies (`POST /auth/v1/admin/users` with `id`, `email`, `email_confirm`, `user_metadata`, `app_metadata`). Whether the admin API accepts a caller-chosen `id` is **UNVERIFIED**; the fallback is to insert `auth.users` and `auth.identities` rows by SQL as the `postgres` role, **also UNVERIFIED** (an `email` identity row may be required for a magic link to find the user) | assisted | every `offices.auth_user_id` and `office_members.auth_user_id` resolves in `auth.users` (the load stops at the first foreign key that does not) |
| 4 | **Load the rows.** `restoreArchive(db, source, { onNonEmpty: 'truncate', prepareLogins })` on the replica: refuses an unmarked target, orders tables by the real foreign-key graph, sets aside only the foreign keys on a cycle, disables user triggers and puts each back in its own prior state, inserts through `jsonb_populate_recordset(null::the_table, ...)`, sets sequences, then compares every table's count and content fingerprint with the manifest, checks every constraint is validated, checks the structure is unchanged and calls the product's own readers | automated (replica only) | the report: `ok`, with 17 steps and per-table fingerprints (REPLICA-PROVEN) |
| 5 | **Rewrite environment-bound config** for the new project (`db.project_ref`, `web.base_url`, `notebook.reader_url`, `notebook.writer_url`, `voice.api_base_url`) | manual | `select key, value from public.system_config where key in (...)` |
| 6 | **Re-create the cron jobs**: `cronRestoreSql(manifest)` generates the `cron.schedule` calls, with a paused job kept paused | assisted | `cron.job` lists them; **the heartbeat is the one that matters**; within two minutes `net._http_response` shows 200s from the worker (the runbook's section 2 is the check; note `app.kick_worker()` returns null silently when its secret is missing and the cron log says "succeeded" either way) |
| 7 | **Re-enter every vault secret** by name from `manifest.aux.vault_names` | manual | `app.resolve_secret` returns for each name; `npm run audit:credentials` reports WORKING, not "present" |
| 8 | **Redeploy the functions** from a clean, pushed commit and set their secrets (names above) | manual | each `deploy:*` probe passes |
| 9 | **Re-register webhooks** (`npm run telegram:webhooks`, Slack URLs) | manual | a message to each bot reaches the new project |
| 10 | **Re-apply the Auth configuration** by hand (redirect allow-list, site URL, SMTP) | manual | a magic link lands on the page and signs a person in |
| 11 | **Re-upload Storage objects** from an off-project copy that carries them, at the same bucket and path; verify each download against its recorded size and etag | manual | `documents.storage_path` rows resolve; sizes match `manifest.aux.storage_objects` |
| 12 | **Restart the heartbeat** and watch `app.office_health()` and `app.backup_health()` for an hour | manual | health reads clean; a fresh backup finishes; `npm run backup:rehearse` records a pass |

### Restoring into a real project: what is deliberately missing

`restoreArchive` will not run against a production database and this change adds **no** flag that lets it. The honest state of step 4 for scenarios B and C:

1. Build a local replica from the migrations (`bash scripts/isolated/replica.sh`), mark it, and run `restoreArchive` into it. That proves the archive restores.
2. Move the proven data to the new project. The same algorithm (disable user triggers per table, load in foreign-key order, drop and re-add only the cyclic foreign keys) needs only table-owner rights, which the `postgres`
   role has on its own tables. **UNVERIFIED on a real Supabase project:** that role cannot `SET session_replication_role = replica` without superuser, and `pg_restore --disable-triggers` needs one, so the
   algorithm above, driven through SQL, is the route that does not.
3. Writing that production variant is a separate, reviewed change with its own production flag and its own rehearsal against a throwaway Supabase project. It is not started.

Until then **the realistic production path for scenario B is a manual transfer from a proven replica**, and its elapsed time has never been measured.

## Auth-user recovery, and why it fails in the same place the backup does

`auth.users` is the one table without which no row in `public` has an owner: `offices.auth_user_id` and `office_members.auth_user_id` reference it with `ON DELETE RESTRICT`. The restore loads
`offices` through a live foreign key into `auth.users`, so **logins must exist first** (step 3), and the replica proof shows the load stopping at the first row that needs a missing login.

What is exported: only the columns in `AUTH_COLUMN_WHITELIST` that exist on the table (`id`, `email`, `phone`, `email_confirmed_at`, `created_at`, `last_sign_in_at`, `raw_user_meta_data`,
`raw_app_meta_data`, `is_anonymous`, `banned_until`). A test builds the query against a table that has `encrypted_password`, `confirmation_token` and `recovery_token`, and asserts none appears; a
replica check plants a canary hash and asserts it is nowhere in the manifest.

What that costs: a restored person has **no password**. The product signs in by magic link, so each person is sent a link after step 10. The shared Sample login (a password) must be set again from its function
secret. Both are manual and neither is recorded here as done.

**The same-failure-domain problem.** The login export is a field of the manifest, and the manifest is in the `backups` bucket of the same project. In scenario B the logins are lost with the project. The sealed
off-project bundle includes the manifest (a bundle without one is refused), so it carries the logins too, and emails are personal data, which is why it is encrypted. A backup that holds logins and is not encrypted
off the project would be a worse problem than the one it solves.

## Storage objects: what is recorded and what is not

Recorded in the manifest: bucket, path, size, type and etag for every object outside `backups`. That tells a recovery **what is missing** (the `documents` rows that name a path that no longer resolves) and lets it verify
a re-uploaded file. It cannot supply the bytes. Storage's etag is MD5-like for single-part uploads (**UNVERIFIED**), not a SHA-256.

To make bytes recoverable the off-project bundle must carry them. Specification, not implemented (it needs the Storage API and therefore a network call): entries named `storage/<bucket>/<path>` inside the bundle
(`packBundle` already takes arbitrary named entries and the header carries a SHA-256 of each), a size budget (the `files` bucket's size is **UNPROVEN**), and a restore that uploads each back and compares its
download hash with the header's. Anything over budget is listed in the bundle header as skipped, not silently dropped.

## cron and configuration

The `cron_jobs` section records jobname, schedule, active and a redacted command (a token-shaped string in a command is replaced; the schedule survives; both are replica checks). The commands in this
repository are `select app.kick_worker()`, `select app.page_backup_failure()` and `select app.sample_refresh_dates()`: none carries a secret by design, and the redaction is the safety net for the one that someday does.
`app.kick_worker()` reads `worker.kick_secret` from the vault and `db.project_ref` from `system_config`, so **a restored heartbeat on a new project needs both set before it does anything** and, being silent when they
are not, looks healthy while it does nothing.

## The off-project copy (design, with the pure half built)

**Why.** `src/handlers/backup.ts` says it: the copy lives in the project it protects. Scenarios B and C lose both.

**Shape.** One file per run: `packBundle` puts every table object, its checksum file, the manifest (and, when specified above, the Storage bytes) into a single container with a header that records
the offset, length and SHA-256 of every entry and the SHA-256 of the manifest. `unpackBundle` refuses a flipped byte, a truncated file, trailing bytes, a duplicated or unsafe name (`..`, absolute, backslash) and a
header that does not account for the payload. `verifyBundle` then checks the contents against the bundle's own manifest with `verifyArchive`. All REPLICA/unit-proven.

**Encryption, with no plaintext path.** `sealForOffsite(entries, meta, encryptor)` cannot be called without an `Encryptor`. `AgeEncryptor` takes an age **public** recipient and refuses a string that looks like a private key.
The identity that opens the bundle (`AgeDecryptor(identityFile)`) is a file held off-project by a person, never in the repository, never in the vault, never on the machine that seals. A GnuPG pair
(`GpgEncryptor` to a public key in the keyring) has the same shape. A unit test runs real `age`: the ciphertext contains none of the plaintext, a second identity cannot open it, and a flipped ciphertext byte is refused.

**Where it could go (all UNVERIFIED offline; confirm the figures on each provider's page before relying on them).** The constraint is about GBP 0 a month and a store Grant owns:

| Candidate | Free allowance as understood | Notes |
|---|---|---|
| Cloudflare R2 | 10 GB-month storage, 1 million Class A and 10 million Class B operations a month, no egress fee | already named in `docs/ops/RUNBOOK.md` section 7 (10 GB, GBP 0); S3-compatible, so `aws s3 cp` or `rclone` uploads one object |
| Backblaze B2 | 10 GB storage free | S3-compatible; egress is metered above a small free quantity |
| A disk or laptop Grant keeps | his own | `scp` a weekly sealed file; zero accounts; manual |
| A private git repository's release assets | per-file limit near 2 GB, repository soft limits | works and is not a storage product; weakest for retention |

**Cadence and size.** A weekly sealed bundle is enough to close scenarios B and C at a recovery point of about a week plus the nightly in-project copy for A. One run is 12.5 MB on 21 September and
perhaps 26 to 56 MB now (`capacity-scenarios-2026-10-06.md`); twelve weekly copies fit in any of the free allowances above. What is **not** built: the upload, its credential, the schedule, and a
restore drill from the off-project copy. Each needs Grant, an account and an approval.

**Key custody.** Generate the age identity on a machine Grant controls, store the identity file in a password manager and a printed copy, give the sealing side only the public recipient. If the identity is lost the
bundles are unreadable, which is the property wanted and also the failure to rehearse: restore from a bundle with the stored identity once a quarter.

## RTO and RPO, stated honestly

| | Value | Basis |
|---|---|---|
| RPO, by design | about 24 hours | a daily duty (`nightly-backup`) |
| RPO, observed | **48 hours once** (17 September missing); the 2 to 5 October outages stopped the worker for 10 to 19 hours at a time, so the last finished backup in production is **UNPROVEN** (`app.backup_health()`) | `docs/ops/evidence/backup-restore-rpo-rto.md`; `supabase-forensics-2026-10-05.md` |
| RPO, uploaded files | **unbounded** | no backup holds Storage bytes |
| RPO, logins | the last backup; anyone who signed up since is lost unless re-invited | `aux.auth_users` is as old as the run |
| Data load, typed, replica | 8 seconds for 162 tables and 121,233 rows on a local socket | REPLICA-PROVEN (`backup-restore-typed.ts`) |
| Data load, production-shaped | the earlier text rehearsal took 9 min 46 s for 153,259 rows through the Management API; a typed load through the same channel will be slower per row and is **UNPROVEN**; through a direct connection it should be minutes | `backup-restore-rpo-rto.md` |
| Everything else | project provisioning, applying 800+ migrations over HTTPS, recreating logins, **re-entering 36 vault secrets by hand across Telegram, Slack, Google, OpenRouter and Supabase**, redeploying six functions, re-registering webhooks, re-applying Auth configuration | the dominant term, and gated on third parties; `backup-restore-rpo-rto.md` correction 1 |
| **Realistic RTO, scenario A (logical damage, project alive)** | **1 to 3 hours**: build a replica, prove the archive, extract and apply the damaged rows by hand | INFERRED; the extraction step is manual |
| **Realistic RTO, scenario B (project lost), with an off-project copy and Grant present** | **4 to 8 hours of attended work** | INFERRED from the table above; **never rehearsed** |
| RTO, scenario B without an off-project copy | **no figure applies**: there is nothing to restore from | the backup is in the lost project |

## What changed in the repository (files)

`src/backup/paged.ts` (keyset paging, streaming gzip, fingerprint), `rows.ts` (exact row splitter), `manifest.ts` (`verifyArchive`, `verifyRestored`), `aux.ts` (what the manifest records beyond rows),
`restore.ts` (the typed restore, the target guard, `recoveryChecklist`, `authUserPayloads`, `cronRestoreSql`), `sources.ts`, `retention.ts` and `runs.ts` (the backup retention policy),
`offsite.ts` (bundle, age and gpg interfaces); `portable.ts` and `handlers/backup.ts` use them; `scripts/backup/prune.ts`; and the proofs `scripts/isolated/backup-restore-typed.{ts,sh}`,
`restore-probe-schema.sql`, `storage-emulator.ts`, `dump-memory-probe.ts`. Tests: `tests/backup/*.test.ts` (106 with the capacity tests).

## Running the rehearsal yourself

```bash
bash scripts/isolated/backup-restore-typed.sh      # builds brt_base, brt_src, brt_dst from `post`, seeds, dumps, restores, verifies; about two minutes
```

It refuses to touch anything but a marked local socket and uses only copies named `brt_*`. It never opens a network connection (the Storage endpoints the backup code calls are an in-memory emulator that
records and refuses every other URL).

## Parked: needs production evidence

* `app.backup_health()` and the retained runs: when did the last backup finish, and how many runs and bytes are there.
* A real restore through the Management API: its elapsed time for the current size.
* Whether the Auth admin API accepts a caller-supplied `id`, and whether `auth.identities` rows are needed for a magic link.
* Whether the `postgres` role of a new Supabase project can load the data without superuser (the algorithm needs only table ownership; unconfirmed).
* The edge isolate's memory ceiling, to know how large a table the paged dump can hold compressed (the ceiling in `paged.ts` is 256 MB; the tested bound is a 53 MB table in a 96 MB heap).
* `cron.job` as it really is, `auth.users`' real column list, and the size of the `files` bucket.
* Everything about the off-project store: account, credential, quota, a quarterly restore drill.
