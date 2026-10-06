# Deployment readiness, refreshed 6 October 2026 (reconciliation of Team HQ with the Public Sample Office)

Written and refreshed before any production action. **Nothing was applied, deployed, enabled or read from production during the reconciliation
that produced this version**, no `ALLOW_PRODUCTION_*` flag was set, and no external service (Google, Drive, Slack, Telegram, Vikunja,
ChatGPT, Claude) was contacted. Everything marked "verified" below was verified on a local replica or in a local browser.
Verdict at the foot. The first version of this document (5 October, main `03177844`) assumed things that are no longer true; the table
below says which, so nobody works from the old text.

## 0. What this document used to say, and what is true now

| The 5 October version said | True on 6 October |
|---|---|
| Production has 761 migrations (`applied.json`), 28 unapplied | **Production has 770 applied**: the 761 plus the Public Sample Office's `0897` to `0905`. The 28 below are still unapplied. `migrations/applied.json` still stops at `0891` because only `npm run migrate` writes it, and it was not edited by hand. |
| Team HQ's calendar and documents migrations are `0897` and `0900` | They are **`0906_project_calendar_events`** and **`0907_documents_are_logical_items_with_versions_and_an_explicit_import`**. The Sample applied its own `0897` and `0900` first; the runner refuses an unapplied duplicate number, so the two unapplied Team HQ files took free numbers. Contents unchanged apart from comments and one error message. |
| The Sample Office is live in production, in no repository | **The Sample Office is merged into `main`** (PR #431, `8c2e4209`). Its migrations `0897` to `0905` are in Git. `0897` and `0898` were applied from a working tree that was never committed; their exact source is in Git now (section 2). |
| Migration 1000 backfills every Google credential as `active` | **Corrected, still unapplied** (section 4): a credential is active only when the database proves it works. |
| A deploy ships whatever the working tree holds | **A deploy or migration run refuses a dirty tree or an unpushed commit** (section 7). |
| Team HQ is on a branch | **The Team HQ implementation is already in `main`** (merge `9ce450f5`). The reconciliation branch `integration/team-hq-ux-v2` adds corrections, not features. |

## 1. State of the code

`main` = `8c2e4209` (PR #431 merged: Multi-User V1, the Public Sample Office, Team HQ's UX integration, the numbering resolution). The
reconciliation branch `integration/team-hq-ux-v2` is `8c2e4209` plus a small set of commits: the VIS decision, migration 1000, the
provenance guard, the stale-number sweep, the combined browser harness and this document. It is **not merged** and nothing is deployed.

`HQ-VIS-001` and `HQ-VIS-003` (does it feel luxurious and unmistakably Team HQ) are **post-deployment user acceptance**: they need Grant
to use the interactive interface, are not merge or deployment blockers (Grant, 5 October), and are NOT marked TESTED or accepted.

## 2. Migration history: production and Git agree on every file Git can be asked about

- 798 files in `migrations/`, no duplicate number that is not an already-applied recorded collision (`0583`, `0584`, and the older ones),
  no gap over a lost file. `npm run check:migrations` passes.
- Production's 770 = the 761 in `applied.json` + `0897` to `0905`. All nine have their exact source in Git.
- The ledger checksums of `0897` (`8d8d8a26…`) and `0898` (`f51ef820…`) were read from production on 5 October (a read-only investigation) and
  equal the SHA-256 of the files now in Git, character for character. That reading was not repeated in this pass (no production read was
  authorised), so `0899` to `0905` have **not** been compared with production's recorded checksums. Compare them before the first
  `npm run migrate`: a mismatch is refused by the runner as `checksum/modified`, which is the safe outcome, not a damaged database.
- A simulation of the runner's own integrity check against the 761 recorded checksums plus the two read on 5 October returned **no blocking
  finding**, and 28 files pending: the list below. (The simulation lacked `0899` to `0905`, which it therefore listed as pending too.)
- The two proofs that matter most are unit tests now: `tests/migrations/runner.test.ts` reproduces the Sample's shape (applied migrations with no
  file, a reconstruction by hand, the exact bytes, an unapplied file reusing an applied number, the same file under a free number).

## 3. The 28 unapplied migrations, in order

All are single atomic requests; the runner stops at the first failure and records each success. "S" schema, "D" data/backfill, "R" RLS or
grants, "F" function/RPC, "I" integration, "B" duty/background, "!" potentially destructive or irreversible.

| # | Migration | Class | Notes |
|---|---|---|---|
| 1 | 0892 slack callback reads the app's public settings | F R | two functions, three grants |
| 2 | 0893 a person's own workspace counts as an installation | F | apply with or before the worker |
| 3 | 0894 a whitespace-only passage is not content | F D | re-indexes any document whose chunks are only whitespace (none expected) |
| 4 | 0895 `ai_team_app` reaches no public function | R | revokes 37 grants from a NOLOGIN role nothing connects as. Reversible by grant. |
| 5 | 0896 disconnected content leaves active retrieval | F R | **splices** three live functions (anchors asserted) |
| 6 | **0906** project calendar events (written as 0897) | S F R D | two new tables, 21 functions, `tool_permissions.delivered_by` update, duty inserted OFF |
| 7 | **0907** documents are logical items with versions, explicit import (written as 0900) | S F R D | **adds a column, two foreign keys, a check and a unique index to `public.documents`** (validated against existing rows); splices |
| 8 | 0920 an activity row says which door | S F ! | `events` constraint dropped and re-added WIDER (validates every existing row); `mcp_clients.kind` added, backfilled, SET NOT NULL. Drops a trigger. |
| 9 | 0921 one search across a project's stores | F | drops `project_search` (old signature; no caller in the live code) |
| 10 | 0922 external assistant tools | F | |
| 11 | 0923 a project can have a house style | S F R | new table |
| 12 | 0924 assistant calendar tools call the real calendar | F | drops seven functions (no caller in the live code) |
| 13 | 0925 a deleted event is not a search result | F | |
| 14 | 0930 a page the office read says where it came from | S F R D | **enables `web.search` in `tool_permissions`**, i.e. every agent's prompt starts saying it can search the web. Backed only by the new worker's `web.research`. |
| 15 | 0940 a made report keeps how it was made | S F R | new table |
| 16 | 0950 a lost create is adopted | F | |
| 17 | 0960 an import press fetches the file | S F R | splices, three DO blocks |
| 18 | 0970 a report's style can be kept as the project's | F ! | drops the old 7-argument `document_provenance_record` (no caller in the live code) |
| 19 | 0980 a calendar conflict is resolved and written down | F R | |
| 20 | 0981 a Vikunja outage is shown in Settings | S F R | splices; enables/disables `tasks.sync` only inside connect/disconnect functions a person calls |
| 21 | 0990 an external document is previewed on demand | S F R | new table |
| 22 | 0991 an import still fetches when only a preview derived the text | F | splices |
| 23 | **1000** a Google credential is one connection of an office | S I F R D | **corrected 6 Oct** (section 4): a new `integration_connections` table, a health-aware BACKFILL, a trigger on `connection_health`, and **splices of the live Google store/revoke functions** |
| 24 | 1001 a report's style can be kept by saying so | D | inserts the `style.save` capability and grants it to staff who hold `document.create` |
| 25 | 1010 a new import needs a connected source | F R | splices |
| 26 | 1020 connected Drive documents are indexed in the background | S F R B | new table; duty `drive-index` inserted OFF; **splices `app.due_responsibilities`, which the dispatcher calls every minute** |
| 27 | 1021 the audit closes gaps | F B | nine functions (live splices) and the duty OFF assertion |
| 28 | 1022 two tables carry the office | S | a composite foreign key and two indexes on tables created above (empty in production) |

No migration drops a table, a column or data. The irreversible-looking items are function drops (no callers) and the constraint changes in 0920;
none can lose a row. **Verified on a replica**: the whole chain replays from an empty database in order (`0897` to `0905`, then `0906`, `0907`, `0920` ...
`1022`), 798 files, with the 33 listed tolerated errors in the pre-`0592` history only.

**Special attention before production application:**
1. **1000 and 1020** touch the Google credential path and the every-minute duty dispatcher. Nine migrations (0896, 0907, 0960, 0981, 0991,
   1000, 1010, 1020, 1021) rebuild a LIVE function from its current definition and assert the text they expect is there. If production's
   definition differs from the replica's they raise and roll back that file. That is the safe failure, but it stops the run.
   (On 5 October all 29 pre-existing splice targets were read from production and were identical to the baseline replica; that is not
   re-proved here and the Sample's `0897` to `0905` changed other functions since, none of them a splice target of these nine.)
2. **0920** re-adds a wider constraint on `events` and sets `mcp_clients.kind` NOT NULL: it assumes no row holds a channel outside the new list.
3. **0907** adds constraints to `documents`: a lock and a scan, small in size.
4. **0930 and 1001** change what every agent is told it can do. Until the new worker is deployed nothing performs it (the registry-claims-a-
   capability trap). Keep the gap between "migrations finished" and "worker deployed" short.
5. Size: about 400 KB of SQL in one run, on a host that had unexplained outages after bursts on 2 to 4 October. Serialise, stop at the first timeout.

## 4. Migration 1000, as corrected

The draft marked every office holding a Google secret as an `active` connection. A secret in the vault says a token was stored once, not that Google
still honours it; Grant's own token was revoked on 15 September, and recording that as healthy would have made the one-active rule refuse the
reconnect. The migration is unapplied, so it was corrected in place. It reads only durable database state (the office's own `google_calendar` /
`oauth_client` health row), never a secret value and never Google.

| Durable state | Recorded as |
|---|---|
| health `ok`, checked within 24 hours | `active` (proved by a recent token exchange) |
| health `ok`, older than that | `unverified` |
| health `dead`, detail names `invalid_grant` | `revoked` (with `revoked_at`) |
| health `dead`, any other reason | `dead` |
| `missing`, `unknown`, `parked`, `attested`, or no row at all | `unverified` (fails closed) |

Only `active` resolves; the credential itself is still read through the legacy name exactly as before. A trigger on `connection_health` then moves a
connection with its credential's recorded health (ok promotes `unverified`/`dead`, never `revoked`, never a second active; dead demotes `active`), so
nothing waits for a person to press anything and the health writer can never be failed by it. A person's own Connect still records `active`.
Proof: `scripts/isolated/google-connection-backfill.ts` (the matrix above, duplicate prevention, office isolation, no secret in any row or in the
migration, the trigger, the reconnect; 21 of its checks go red when the old behaviour is put back) and `tests/migrations/migration-1000-backfill.test.ts`.
**It is not applied and must not be applied by anything in this change.**

## 5. Order and version skew

Order: **migrations, worker, hq-api, mcp, web.** Nothing needs to be atomic with anything else.
- **New database, old code (every prefix of the migration run too):** safe. Every function the migrations drop has no caller in the code that is live; constraints are only widened; `mcp_clients.kind` has a default trigger so old inserts work; the new tables are unused; `1021` makes the old Move on a Drive document return an error the page already shows. The real gaps are the capability claims in section 3 (items 14 and 24: short gap, no data effect) and the dispatcher splice (1020: same signature). A database newer than the running Google code is the item to watch: with 1000 applied, `unverified` connections stay unresolved until the credential is next used, and the legacy name still serves the credential meanwhile.
- **New worker, old gateway and page:** safe. New handlers (`web.research`, `style.adopt`, `calendar.sync_events`, `drive.index`) are reached only by new callers or the two duties, which are off.
- **New hq-api, old page:** safe; it adds sections and keeps the old ones.
- **New page before the new hq-api: NOT safe**, it asks for sections that do not exist yet. That is why the page is last.
- **mcp:** after the migrations (it calls `0922`/`0924` functions); independent of the others.
- **What deploying `main` now ships, honestly.** Production's Sample functions and page were built from LIVE BYTES plus the Sample's own diff, never from a working tree, so
  production's `hq-api`, `signin`, `voice`, `mcp` and page do not contain `main`'s other work. Deploying `main` is therefore one decision that ships (a) Team HQ's
  implementation, and (b) the p4 work the Sample deploys deliberately held back (the Slack self-service gateway sections `slack_link_*`, the polish files). The Sample's own
  behaviour is in `main` (merged and re-proved, section 8), so deploying from `main` does not remove it; what it adds must be accepted as a whole. Re-stage nothing by hand.
- Page is deployed with `npx tsx scripts/deploy/hq-page-delta.ts` (dry run first, then `--go`), NOT `deploy:hq`, whose page step exceeds Vercel's 10 MB body limit. It ships the working tree
  (or `--root=` a staged tree), prints the previous deployment as the rollback point, and now stamps `meta.gitCommitSha` on the deployment. Run it from a clean, pushed `main` after `npm run config:site`.
- `deploy:worker` sets `slack.per_office_delivery = true` after its probe passes (a side effect; it was in p4's queue already).

## 6. Both duties stay OFF

Proven on the replayed final tree: `drive-index` off, `calendar-event-sync` off, 0 enabled duties of either kind; no window during the run
(0906 inserts `calendar-event-sync` off; 1020 inserts `drive-index` off; 1021 asserts both and aborts the file if either is on). Enabling is a
separate, later `update public.responsibilities set enabled = true where slug = ...`, one at a time, calendar first, `drive-index` last.
Production's own duties are not changed by any of this; its `mail-refresh` and other duties are as they were.

## 7. The production provenance guard (new)

A migration run or a deploy now refuses a source it cannot attribute to a pushed commit. `src/safety/require-production-writes.ts` (already the first import of every
deploy and migrate script) asks `src/safety/provenance.ts` once, from the command being run: refused when this is not a git checkout, when the tree is dirty where it ships
(untracked included; `docs/`, `tests/` and `.out/` do not ship), or when HEAD is on no remote-tracking branch. `scripts/deploy/hq-function-staged.ts`, which had no
production gate at all, now opens with it. The migration-history checks (`checksum/missing`, `checksum/modified`, a duplicate or lost number) were already enforced by the
runner and have no switch. The one bypass is `ALLOW_UNPROVENANCED_DEPLOY="<a reason of at least 20 characters>"`: a sentence, not a flag; it waives only the source checks; it is
printed in full and appended to `.out/provenance-bypass.log`. **It was not used.** The Vercel deployment carries the commit; an edge function bundle has no metadata slot that
could be proved without deploying, so a function is attributable through the pushed commit the guard insists on (stated, not claimed). Tests: `tests/safety/provenance.test.ts`.

## 8. What was verified in the reconciliation, and what was not

Verified locally (a replica built from the migrations alone, a real Chromium, no production, no network beyond the machine):
- `npm run typecheck`, `lint` (exit 0), `check:migrations` (798 files), `check:secrets`, `check:templates`, `check:branding`, `check:pressable`, `smoke`.
- `npm run test`: every test file passes except the one that already fails on `main` (`tests/sessions/weather-is-not-a-failure.test.ts`, which loads production-bound code).
- A fresh replay of all 798 migrations, and a catalogue fingerprint of it against a fresh replay of `main`: the only differences are migration 1000's own (the wider `state` check, the new
  trigger function and trigger) and the checksums of the unapplied files whose comments were corrected.
- Sample proofs: `sample-office` 47/47, `sample-gateway` 33/33 (the real gateway: a guest is refused every action but `sample_say`), `sample-showcase-readers` 35/35, `empty-command-id` 13/13, `sample-dates` 11/11.
- Isolation and security: `office-ownership` 96/96, `anon-surface` 27/27, `principals` 83/83, `service-decides-nothing` 4/4, `sender-authorization` 39/39, `slack-sender` 23/23, `google-office-binding` 19/19,
  `check:office-edges --replica` and `check:ownership --replica` clean with every control firing, and all 181 functions the gateway names exist in `public`.
- Team HQ proofs on the replica: project calendar, calendar conflict, documents, drive index, previews, import (fetch and source gate), style keep, artifacts, the seven `ux-be` SQL proofs.
- **Browser, combined**: `scripts/isolated/combined-browser.ts`, 415 checks, a person and a sample visitor through the real gateway code at 1440, 1280, 1024, 900, 768, 390x844 and also 320, 360, 430,
  with reduced motion at both ends: no page or console error, no overflow, the project's name kept, 44px controls, the Sample banner and Leave, guests refused with the sentence and nothing written.
  Proven able to fail three ways. Objective regression only: it judges nothing about how it looks.

Where a proof fails it was run on `main` as well. The 42 of 63 older isolated proofs that fail here (`jobs.office_id` is NOT NULL and their fixtures predate it), the one `office-ownership-sabotage` control,
and `weather-is-not-a-failure` fail **identically** on `main`; they are not caused by this branch (per-proof result lines compared).

**Not verified, because it needs a production read (refused by the guard, as designed) or a live service:** `check:callers`, `check:consumed`, `check:capabilities`, `check:answerable`, `check:machine-key`,
`check:carrier-writers`, `check:anon-exposure`, `check:gateway-wrappers` against production (an equivalent was run on the replica), `check:icons`, `gate:safe`, platform health, that production's recorded
checksums for `0899` to `0905` equal the files in Git, that the nine live-function splices find their anchors in production today, and everything about Google, Drive, Vikunja, Slack, Telegram, ChatGPT and
Claude. Those rows stay PARTIAL until genuine evidence exists. The signed-in, real-deployment browser walkthroughs were not repeated.

## 9. Both rollbacks and the rollback points

Write the rollback points down FIRST, from a fresh read at the time (two documents name different current page deployments: `docs/multi-user/PUBLIC-SAMPLE.md` says `dpl_2VgoidAKu95AcMjLieCocWr6bWxv`,
`docs/HANDOFF.md` says `dpl_34UgA3XsdS5suXYfs8ehBREu7Z3x`; **read the live one**). Note the deployed versions of `worker`, `hq-api`, `signin`, `mcp`, `voice` and `voice-token`, and the latest backup time.

| Stage | If it fails | Action |
|---|---|---|
| Migration (a file fails) | that file rolled back whole; earlier files stay applied; the runner stops | Application code is untouched and compatible with any prefix. **Forward-fix** with a new migration (`1023`+); never edit an applied file. Do not hand-reverse. |
| Worker | probe fails, or jobs error after it | redeploy the previous worker. The database stays as migrated. Duties are off so nothing timed depends on it. |
| hq-api | probe fails | redeploy the previous hq-api (the recovered live source is the base; the Sample's `sample_say` and guest policy are in `main`, so a rollback to older Git would drop them: roll back to the previous DEPLOYED version, not to an older commit). |
| MCP | probe fails or a client misbehaves | redeploy the previous `mcp`; kill switch: `update public.mcp_clients set enabled = false` for the client. |
| Web | blank or broken page | Vercel: promote the previous deployment (instant, no database involvement). |
| Whole run | any stage | stop; do not continue past a failed stage. |

Not reversible and not attempted: dropping the new tables or columns, un-applying a migration, restoring `ai_team_app` grants.

## 10. Production actions that will occur on GO (none has occurred)

1. (read) pre-flight: platform health, the ledger against Git (including `0899` to `0905`), `migrate --dry`. 2. `npm run migrate` (28 files, 0892 to 1022).
3. `deploy:worker` (+ the Slack flag). 4. `deploy:hq-api`. 5. `deploy:mcp`. 6. `config:site`, `hq-page-delta` dry run, then `--go`. Each from a clean, pushed `main`. No secret changes, no duty changes,
no Google or Drive contact. Each needs `ALLOW_PRODUCTION_CHECKS=1` and `ALLOW_PRODUCTION_WRITES=1` set by Grant for that command only.

## 11. Smoke tests after deployment

Gateway: unauthenticated 401, authenticated 200. Sign in on the live page. Open a project: the workspace draws; move a module, reload, it stays. Add a Post-it, type, reload; in a second tab add one, reload,
both are there. Maximise a module, press Back once: the dashboard. Calendar Month / Week / Day load; create a local event (it stays local: the duty is off). Documents: filters, a search, preview an uploaded
file and a generated PDF. Palette (Ctrl+K): find a task and a document. Activity opens. Settings opens; the Google card shows its true state (with 1000 applied: a revoked token reads as not connected, and
Connect reconnects it). **The Sample, signed out:** the entry screen offers Explore; entering shows the banner and Leave sample; adding a to-do is refused with the sentence and writes nothing. MCP: `tools/list` shows
the tools. `select slug, enabled from public.responsibilities where slug in ('drive-index','calendar-event-sync')` returns two `false`. With CHECKS authorised: `check:office-edges`, `check:ownership`, `check:answerable`,
`check:gateway-wrappers`. Then, and only then, the live-service rows one at a time, which stay PARTIAL until genuine evidence exists.

## 12. Verdict

**GO on the code, the migration history and the plan, subject to the production pre-flight in section 10, which is the only open gate and needs Grant's authorisation to read.** No reason was found that
deployment is unsafe, and the reasons it was NO-GO on 5 October (a production ledger two files ahead of Git, uncommitted live Sample code that a deploy from `main` would have overwritten, migration 1000 recording a
revoked credential as healthy) are each closed in Git. Wait for an explicit instruction; nothing has been deployed.
