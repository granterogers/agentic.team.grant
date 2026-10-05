# Deployment readiness check, 5 October 2026 (main `03177844`)

Written before any production action. Nothing here was applied, deployed or read from production. Verdict at the foot.

## 1. State of main

`main` = `03177844` (the accepted merge `9ce450f5` plus one deployment-safety commit, below). Clean. Contains `claude/multi-user-p4`
(`28569e68`) and `claude/team-hq-ux-overnight`.

One change since the merge: `0897` inserted the `calendar-event-sync` duty ENABLED and `1021` switched it off, and migrations run
one file after another, so there was a window in which the duty was on with no handler deployed. `0897` now inserts it switched off.
Proven by `tests/migrations/audit-1021.test.ts` and by running the insert on the replica (`enabled=f`). After a replay of all 789 files
on this tree: `drive-index` off, `calendar-event-sync` off, no enabled duty of kind `drive.index` or `calendar.sync_events`.
Nothing else enables either: no code or script sets them, and nothing enqueues `calendar.sync_events` except that duty, so with it off
no event reaches Google at all (events stay local and pending until it is enabled).

## 2. Did the merge auto-deploy?

Not provable from here. Evidence it did not: the workflows have no push trigger; the docs say deploys are `npm run deploy:*` and say NOT to
connect Vercel's Git integration; GitHub shows no Vercel commit status and no check run on `9ce450f5`, `03177844`, `41de1965` or the p4
tip (a connected project posts one on every push, preview or production); GitHub's deployments API refuses this integration (403), so it
cannot be read. **Look in the Vercel dashboard:** project settings, Git: is a repository connected? If yes, Production Branch and
"Deployments" for a build created at the merge time (about 13:40 to 14:10 UTC on 5 October) from commit `9ce450f5` or `03177844`. If none
is connected, nothing could have deployed. The live page should still be `dpl_8QwvvES1oRridjeokGzu2MMGdEYm` (the sign-in fix on p4's page).
Even an unwanted page build would not touch the database or the functions; it would be the new page against the old backend, so it would
be rolled back by promoting that deployment.

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
| 6 | 0897 project calendar events | S F R D | two new tables, 21 functions, `tool_permissions.delivered_by` update, duty inserted OFF |
| 7 | 0900 documents are logical items with versions, explicit import | S F R D | **adds a column, two foreign keys, a check and a unique index to `public.documents`** (validated against existing rows); splices |
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
| 23 | 1000 a Google credential is one connection of an office | S I F R D | **the one to watch**: new `integration_connections`, a BACKFILL from existing vault secrets, and **splices of the live Google store/revoke functions**. |
| 24 | 1001 a report's style can be kept by saying so | D | inserts the `style.save` capability and grants it to staff who hold `document.create` |
| 25 | 1010 a new import needs a connected source | F R | splices |
| 26 | 1020 connected Drive documents are indexed in the background | S F R B | new table; duty `drive-index` inserted OFF; **splices `app.due_responsibilities`, which the dispatcher calls every minute** |
| 27 | 1021 the audit closes gaps | F B | nine functions (live splices) and the duty OFF assertion |
| 28 | 1022 two tables carry the office | S | a composite foreign key and two indexes on tables created above (empty in production) |

No migration drops a table, a column or data. The irreversible-looking items are function drops (no callers) and the constraint changes in
0920; none can lose a row.

**Special attention before production application:**
1. **1000 and 1020** touch the Google credential path and the every-minute duty dispatcher. Nine migrations (0896, 0900, 0960, 0981, 0991,
   1000, 1010, 1020, 1021) rebuild a LIVE function from its current definition and assert the text they expect is there. If production's
   definition differs from the replica's they raise and roll back that file. That is the safe failure, but it stops the run.
2. **0920** re-adds a wider constraint on `events` and sets `mcp_clients.kind` NOT NULL: it assumes no row holds a channel outside the new list.
3. **0900** adds constraints to `documents`: a lock and a scan, small in size.
4. **0930 and 1001** change what every agent is told it can do. Until the new worker is deployed nothing performs it (the registry-claims-a-
   capability trap). Keep the gap between "migrations finished" and "worker deployed" short.
5. Size: about 400 KB of SQL in one run, on a host that had unexplained outages after bursts on 2 to 4 October. Serialise, stop at the first timeout.

## 4. Compatibility with the current production database: UNPROVEN, by design

No production read is authorised, so none was made and no flag was set. What stays unproven, each answerable in seconds with one authorised read-only check:
- that `migrations/applied.json` still equals production's `app.schema_migrations` (761 names and checksums), i.e. nothing was applied there since it was written (`npm run migrate -- --dry`, a read, refuses a checksum drift);
- that the nine live-function splices find their anchors against production's definitions (the replica matched production on 25 September, and every migration to `0891` is in it);
- that `events.origin_channel` holds only the allowed words (0920) and every `mcp_clients` row can take a `kind` (0920);
- that the existing `documents` rows satisfy the new constraints, which they should (the column is new);
- that `google_home_office()` and the vault names 1000 backfills from behave in production as they do on the replica;
- platform health on the day (section 7 pre-flight).
A failure of any of these is a failed atomic file, not a damaged database.

## 5. Order and version skew

Order: **migrations, worker, hq-api, mcp, web.** Nothing needs to be atomic with anything else.
- **New database, old code (every prefix of the migration run too):** safe. Every function the migrations drop has no caller in the code that is live (checked by search at `4fafdf38`); constraints are only widened; `mcp_clients.kind` has a default trigger so old inserts work; the new tables are unused; `1021` makes the old Move on a Drive document return an error the page already shows. The two real gaps are the capability claims in section 3 (items 14 and 24: short gap, no data effect) and the dispatcher splice (1020: same signature).
- **New worker, old gateway and page:** safe. New handlers (`web.research`, `style.adopt`, `calendar.sync_events`, `drive.index`) are reached only by new callers or the two duties, which are off.
- **New hq-api, old page:** safe; it adds sections and keeps the old ones.
- **New page before the new hq-api: NOT safe**, it asks for sections that do not exist yet. That is why the page is last.
- **mcp:** after the migrations (it calls `0922`/`0924` functions); independent of the others.
- Page is deployed with `npx tsx scripts/deploy/hq-page-delta.ts` (dry run first, then `--go`), NOT `deploy:hq`, whose page step exceeds Vercel's 10 MB body limit. The delta script ships the whole working tree and prints the previous deployment as the rollback point. Run it from `main` after `npm run config:site` has produced `web/studio/config.js` as the last deploy did.
- `deploy:worker` sets `slack.per_office_delivery = true` after its probe passes (a side effect; it was in p4's queue already).
- `signin` is already at p4's v124 and is not part of this deployment.

## 6. Both duties stay OFF

Proven on the replayed final tree: `drive-index` off, `calendar-event-sync` off, 0 enabled duties of either kind; no window during the run
(0897 inserts it off; 1020 inserts `drive-index` off; 1021 asserts both and aborts the file if either is on). Enabling is a separate,
later `update public.responsibilities set enabled = true where slug = ...`, one at a time, calendar first, `drive-index` last.

## 7. Rollback plan (write down the rollback points FIRST)

Before: note the deployed versions of `worker`, `hq-api`, `mcp` and the live page (`dpl_8QwvvES1oRridjeokGzu2MMGdEYm`); note the latest backup time;
`git` rollback commit for the functions is p4's last deployed commit (`4fafdf38` unless the version check says otherwise). Pre-flight (needs Grant's
authorisation of a production READ): the four health services OK, a trivial `select 1` well under a second, the `cron.job_run_details` canary
for job 1 all succeeded, office fingerprints printed.

| Stage | If it fails | Action |
|---|---|---|
| Migration (a file fails) | that file rolled back whole; earlier files stay applied; the runner stops | Application code is untouched and compatible with any prefix. **Forward-fix** with a new migration (`1023`+); never edit an applied file. Do not hand-reverse. |
| Worker | probe fails, or jobs error after it | redeploy the previous worker (`deploy:worker` from `4fafdf38`). The database stays as migrated. Duties are off so nothing timed depends on it. |
| hq-api | probe fails | redeploy the previous hq-api. The old page is still live and unaffected. |
| MCP | probe fails or a client misbehaves | redeploy the previous `mcp`; kill switch: `update public.mcp_clients set enabled = false` for the client. |
| Web | blank or broken page | Vercel: promote `dpl_8QwvvES1oRridjeokGzu2MMGdEYm` (instant, no database involvement). |
| Whole run | any stage | stop; do not continue past a failed stage. State is always "new database, old or new code", never half-way between incompatible versions. |

Not reversible and not attempted: dropping the new tables or columns, un-applying a migration, restoring `ai_team_app` grants.

## 8. Production guard on main

Active. With the real production credentials in the environment and no flag, `migrate`, `deploy:worker`, `deploy:hq-api`, `deploy:mcp`,
`deploy:signin` and `hq-page-delta` each refused before any request. The guard was sabotaged three ways earlier (9, 3 and 3 tests red) and no
path sets `ALLOW_PRODUCTION_*`. The deploy needs `ALLOW_PRODUCTION_CHECKS=1` and `ALLOW_PRODUCTION_WRITES=1` set by Grant for that command only.

## 9. Production actions that will occur on GO

1. (read) pre-flight and `migrate --dry`; 2. `npm run migrate` (28 files, 0892 to 1022); 3. `deploy:worker` (+ the Slack flag); 4. `deploy:hq-api`;
5. `deploy:mcp` (no new client); 6. `config:site`, `hq-page-delta` dry run, then `--go`. No secret changes, no duty changes, no Google or Drive contact.

## 10. Smoke tests after deployment

Gateway: unauthenticated 401, authenticated 200. Sign in on the live page. Open a project: the workspace draws; move a module, reload, it stays. Add a Post-it,
type, reload, it is there; open the page in a second tab, add one, reload, both are there. Maximise a module, press Back once: you are on the dashboard.
Calendar Month / Week / Day load; create a local event (it must stay local: the duty is off). Documents: filters, a search, preview an uploaded file and a
generated PDF. Palette (Ctrl+K): find a task and a document. Activity opens with the channel chips. Settings opens; the Google card shows its true state.
MCP: `tools/list` with a read-only bearer shows the tools. `select slug, enabled from public.responsibilities where slug in ('drive-index','calendar-event-sync')`
returns two `false`. With CHECKS authorised: `check:office-edges`, `check:ownership`, `check:answerable`, `check:gateway-wrappers`. Then, and only then, the
live-service rows (Google, Drive, Vikunja, ChatGPT/Claude) one at a time, which stay PARTIAL until genuine evidence exists.

## 11. Verdict

**GO on the code and the plan; the production pre-flight is the only open gate** and it needs Grant's authorisation to read. No reason found
that deployment is unsafe. Wait for an explicit instruction.
