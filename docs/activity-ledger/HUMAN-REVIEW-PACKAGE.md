# Unified Activity Ledger - human security review package

11 October 2026, release candidate `release/activity-ledger-v1`. **No human has reviewed this. Three model-assisted adversarial reviews (phase 3 on the backend, phase 7, phase 8) found and helped fix real defects; none of them is a human review and none satisfies the requirement.**
Human review of the SQL and the redactor is **mandatory before any production migration**. Do not record a sign-off here unless a named person wrote it.

Review record (to be completed by a person, never by an agent):

| Reviewer | Date | Scope read | Verdict | Findings filed |
|---|---|---|---|---|
| _(unsigned)_ | | | | |

## 1. Exact files and hashes (sha256, working tree at the commit named in the approval request)

| File | sha256 |
|---|---|
| `migrations/1060_one_ledger_of_activity_records_what_no_other_table_holds.sql` | `6a680002590130cd771acd29042a59a407bdfad0a4885d10019823ba4f6ecf28` |
| `migrations/1061_the_activity_read_model_reads_each_table_that_owns_the_state.sql` | `8b535909ae8b036c96c23b2b56242086b3047b6bb72baa245d002865b6eca9e4` |
| `migrations/1062_a_held_back_over_budget_agent_is_recorded_in_the_activity_ledger.sql` | `07c26ad8eb700e0fc79f8504ea60faccd90db0a97a3d59bb66b66ab90fd40534` |

Recompute with `sha256sum migrations/106[012]_*.sql` on the commit under review; if a hash differs, the review is of something else. The three files are **unapplied**, so the edits made after review rounds are legitimate; once applied they are immutable (`check:migrations`).
The TypeScript and gateway sources the review also needs: `src/text/secrets.ts` (the redactor's twin), `src/activity/record.ts` and `src/activity/switch.ts`, `supabase/functions/hq-api/index.ts` (the four `activity_*` sections and the time-bound handling only). Hash them with `sha256sum` at the same commit. At the capacity-audit commit `supabase/functions/hq-api/index.ts` is `7e2a7688aa087434da33b47b9fc6dcf8e3fac902a746274b5fde7e192d3a0c41` (it now also maps a platform `57014` cancellation of an Activity read to the same controlled 504). Migration 1061 gained three read-only health keys (`native_diagnostic_24h`, `diagnostic_cap_per_day`, and `native_table_bytes` for the deployment's own office only); see `STORAGE-CAPACITY-DECISION.md` section 8.

## 2. The SQL to read, in this order

**1060** (additive; creates `public.activity_event_types` (42 rows), `public.activity_events` (append-only), `public.activity_write_failures`, the setting `activity.ledger_enabled = false`):
`app.activity_ledger_on`, `app.activity_ledger_covers` (the one fail-closed decision), `app.activity_redact` (the strict redactor), `app.activity_clean`, `app.activity_external_metadata`, `app.record_activity` (strict writer),
`app.record_activity_safely` (best-effort writer, **includes the diagnostic volume cap**), `app.record_external_activity` (the outside-worker door), the append-only and office-write-once triggers, and the grants/revokes at the end of the file (including `revoke ... from service_role` on the three tables).
**1061** (read side; no index is created, see the migration plan): `app.activity_read` (dynamic SQL; **the time budget and the pushed-down filters are new in phase 8**), `app.activity_chain`, `app.activity_for_the_page`, `app.activity_ledger_health`, `app.activity_index_gaps`, the helper functions, four `public.*` wrappers and their grants.
**1062** (one best-effort `perform` spliced into `app.defer_over_budget`).

## 3. Privilege model (as catalogued on the replica; production's ACLs must be read, see the baseline)

| Object | Who may execute or touch it |
|---|---|
| every `app.*` writer and reader above | the owner role only (EXECUTE revoked from public, anon, authenticated, service_role); `service_role` has no USAGE on schema `app` |
| `public.activity_read`, `activity_chain`, `activity_for_the_page`, `activity_ledger_health` | `service_role` only (the gateway); anon, authenticated, public: none |
| the three tables | owner only. `revoke all ... from anon, authenticated` and `from service_role` (stock Supabase default privileges can otherwise grant `service_role` DML on a new table: **a person must read the production ACLs to confirm**) |
| definer functions | `search_path` pinned to `pg_catalog` (and `public`, or empty); every object reference qualified |
| the settings | `public.system_config`: SELECT only for non-owner roles; writes are the operator's (`npm run activity:switch` for the switches) |

## 4. The redactor (`app.activity_redact` in 1060 and `redactStrict` in `src/text/secrets.ts`)

Bounded to 4 000 characters (the tail is dropped, never returned), NFKC-normalised, then an explicit list of invisible and format characters is removed (soft hyphen, zero-width and joiners, bidi controls, variation selectors, tag characters, Arabic format characters and others),
then: the office's credential families (Slack, OpenAI, Supabase, Notion, Google, GitHub, Telegram, JWT, AWS, Stripe, SendGrid, npm, Hugging Face, GitLab, Twilio, Slack webhooks), URL credentials, `Bearer`/`Basic`/`Token` values, a credential-named assignment **with an identifier prefix** (`DB_PASSWORD=`, `GITHUB_TOKEN=`, `adminPassword=`), PEM blocks, and a long mixed-case or digit-bearing run. SQL and TypeScript are held byte-identical by `activity-redaction` (79 cases) and each family is shown by a control.
**Known limitations (pinned by the proof, not hidden):** a short secret in prose; a credential name written in look-alike letters; a percent-encoded secret; a base64 secret that is short; an invisible character not in the explicit list.

## 5. Findings: all rounds, with status

| Round | Finding | Status |
|---|---|---|
| 7 F1 | strict writer accepted `p_provenance => 'external'` from a caller | fixed (marker set only by the external door); proof and sabotage S51 |
| 7 F2 | `statement_timeout` inside `activity_read` bounds nothing | **fixed in phase 8**: root cause reproduced; cooperative budget (PT504), gateway 504, page error state; hard bound is a production decision (see `READ-TIME-BOUND.md`) |
| 7 F3 | cross-office read cost | **not reproduced** (reviewer withdrew it); a real own-office cost found and fixed (interface filter pushed into every source); guard `activity-scaling` |
| 7 F4, F5 | redactor missed prefixed credential names and some invisible characters | fixed in both twins |
| 7 F6 to F9 | delivery error text visibility; non-boolean `reversible`; external `declined`/`expired`; `service_role` table privileges | fixed; proofs and sabotages S52, S53 |
| 7 F10 | caller-asserted worker name; deployment-wide advisory lock; replay with a different payload returns the first row | **accepted and open** (the external boundary is a separate piece of work); length caps fixed |
| 8 L1 | a replay at the diagnostic cap was counted as a loss | fixed (replays exempt) |
| 8 L2 | the cap is soft under concurrent writers (count then insert, not serialised) | **accepted**: a storage bound, off by about the number of concurrent writers |
| 8 L3 | a gateway abort may not cancel the database work; one pass is not interruptible | **accepted and documented**; the hard bound needs the production decision above |
| 8 Info | the gateway deadline (12 s) vs a budget settable to 60 s | fixed (budget clamped to 11 s) |

## 6. Questions that need human judgement

1. Is a **cooperative** read bound plus a gateway deadline acceptable, or must the hard bound (role-level `statement_timeout` or a PostgREST pre-request hook) be applied before the canary? (Needs the baseline reading of the real role timeouts.)
2. Are the redactor's documented limitations acceptable for text the office writes into an append-only table?
3. Should the ledger tables also carry row-level security policies, in addition to owner-only functions and revoked table grants?
4. Is the caller-asserted external worker name acceptable until an authenticated boundary exists (nothing exposes the door to a network today)?
5. Is the diagnostic cap's default (500 a day an office) the right starting value, and what horizon does Grant want for diagnostic events (see `STORAGE-AND-RETENTION.md`)?
6. Should `tool.call_requested` still be recorded (it roughly doubles tool-call volume)?

## 7. Evidence the reviewer can re-run (replica only)

`npx tsx scripts/gate/run.ts --tier critical` and `--tier extended --rebuild`; `bash scripts/isolated/activity-ledger-sabotage.sh` (56 sabotages, in batches of ten or eleven); `npx tsx scripts/isolated/activity-redaction.ts post`; `npx tsx scripts/isolated/activity-external-attack.ts post` (run on a clone, never on `post`);
`bash scripts/isolated/activity-migration-rehearsal.sh`; `npx tsx scripts/isolated/activity-scaling.ts <clone>`.

## 8. Phase 9 reconciliation (12 October 2026): exactly what a person must read

**No human review has taken place, and none is claimed.** Nothing was sent to any reviewer. The files below are the whole inspection surface; everything else in the pull request is tests, harnesses, documentation and the Team HQ page.

| # | File | sha256 at the Phase 9 commit | Lines | Why a person must read it |
|---|---|---|---|---|
| 1 | `migrations/1060_one_ledger_of_activity_records_what_no_other_table_holds.sql` | `6a680002590130cd771acd29042a59a407bdfad0a4885d10019823ba4f6ecf28` | see `wc -l` | the redactor, the writers, the external door, the append-only triggers, the grants and revokes, the diagnostic cap |
| 2 | `migrations/1061_the_activity_read_model_reads_each_table_that_owns_the_state.sql` | `8b535909ae8b036c96c23b2b56242086b3047b6bb72baa245d002865b6eca9e4` | 1,073 | the read model's dynamic SQL, office isolation, the time budget, the page wrappers, the health keys added in the capacity audit |
| 3 | `migrations/1062_a_held_back_over_budget_agent_is_recorded_in_the_activity_ledger.sql` | `07c26ad8eb700e0fc79f8504ea60faccd90db0a97a3d59bb66b66ab90fd40534` | 67 | the one best-effort `perform` spliced into a live function |
| 4 | `src/text/secrets.ts` | `5b37e02263682d1b0e9e63ba304e62e705b07b692ea2d3b9d36a1b41dfd68413` | 270 | the TypeScript twin of the redactor (`redactStrict`); parity with the SQL is proved, not assumed |
| 5 | `src/activity/record.ts` | `602347b2c79626a37d3039cadbe984c46e7eb542be359797fd02b47d88d076f5` | 132 | the worker's best-effort recording call (must never raise) |
| 6 | `src/activity/switch.ts` | `8cfa618a044550944b44ab931bbd21b64d93ff75cac3b444ad07120449871636` | 294 | the operator's activation tool: the plan, the kill switch, the per-office list |
| 7 | `supabase/functions/hq-api/index.ts` | `7e2a7688aa087434da33b47b9fc6dcf8e3fac902a746274b5fde7e192d3a0c41` | the four `activity_*` sections and the timeout mapping only | the gateway's deadline, 504 mapping (including a platform 57014) and error bodies |

Also worth a glance, not a security surface: `src/activity/indexes.ts` (the concurrent index builder: drops an invalid index it finds, builds one at a time) and `src/activity/switch-cli.ts`.

### Checklist (tick each against the file, not against this document)

| Area | Where | Ask |
|---|---|---|
| `SECURITY DEFINER` | 1060, 1061, 1062 (every `create function`) | Is each definer function needed, and does each do only its one job? None may take a caller-supplied office without checking it |
| `search_path` | each function's `set search_path` clause | Pinned to `pg_catalog` (and `public` or empty) with every object qualified; none left to the caller |
| Privilege grants | the revokes and grants at the end of 1060 and 1061 | `app.*` executable by the owner only; the four `public.activity_*` wrappers `service_role` only; the three tables owner-only. **Production facts (Q22, Q23, 12 Oct): `service_role` has no USAGE on schema `app`; `authenticated` and `anon` neither; a new `public` table by `postgres` grants `service_role` full DML by default, so the `revoke all ... from service_role` is load-bearing and must be confirmed against the final table ACLs after step 1** |
| Office isolation | the `office_id` predicates in `activity_read`, `activity_chain`, `activity_for_the_page` | Every source filters to the caller's office before anything is returned; a deployment-wide read is operator-only (`native_table_bytes` is null for a person's office) |
| Append-only integrity | the update, delete and truncate triggers and the office write-once trigger in 1060 | A ledger row cannot change or leave; a replayed key adds nothing |
| External-worker authority | `app.record_external_activity`, the provenance marker, the caps | An outside worker can only write `external` rows of the listed types, never approve or decline, never name an office it does not hold; caps of 300 an hour a worker and 1,000 an hour and 4,000 a day an office. Known and open: the worker name is caller-asserted (F10) |
| Credential redaction | `app.activity_redact` and `redactStrict` | 4,000 character bound, NFKC and invisible characters removed, the credential families covered; the documented limitations in section 4 are accepted or not |
| Approval provenance | the approval source in `activity_read` | An approval is shown as decided by a person only when the approval row says so; an agent's action is never shown as the person's |
| Delivery provenance | the delivery source and the error-text handling | A delivery is attributed to the job's office and channel; error text is withheld from a person who may not see it |
| Read timeouts | the budget in `activity_read` (PT504), the gateway deadline | The cooperative budget, the gateway abort and the 504 mapping behave as `READ-TIME-BOUND.md` says; **the role-level bound is a separate decision (A6)**. Live role settings are in `PRODUCTION-BASELINE-2026-10-12.md` section 7 |
| Rate limits and caps | `record_activity_safely`, the external door | The diagnostic cap is 500 a day an office (soft under concurrency, F8 L2); replays are exempt |
| Idempotency | the `(office_id, idempotency_key)` unique index and `on conflict do nothing` | The same key twice is one row; a different payload under the same key returns the first (accepted, F10) |

The review record at the top of this file stays **unsigned** until a named person writes into it.
