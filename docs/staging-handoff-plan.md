# Staging handoff plan - Team HQ UX branch -> integration -> staging

Written 5 October 2026 and kept in step with the integration branch `integration/team-hq-ux-on-p4` as it stood at `39c41fcc` (p4 `ca8845b7` + the frozen UX branch `f91c4c1f`), amended by the staging-binding pass that follows it. Nothing here has been executed. Production is not touched at any step; staging is a SEPARATE
Supabase project, a SEPARATE Vercel preview, and separate Google / Telegram / Slack / Vikunja credentials.

The purpose of staging is to FIND failures local fakes could not. A row moves PARTIAL -> TESTED / VISUALLY VERIFIED
only when the real evidence exists. A failing real-service test is recorded as it happened, diagnosed (code defect
vs environment), fixed if code, retested; the row stays PARTIAL until genuinely proven. No assertion is weakened.

## 0. State (integration done locally; nothing deployed)

| | |
|---|---|
| Integration branch | `integration/team-hq-ux-on-p4`: p4 `ca8845b7` + the frozen UX branch `f91c4c1f` merged `--no-ff` (textually clean) + the integration fixes below. p4 and the UX branch are untouched. |
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
3. The production guard is target-agnostic (it recognises Supabase hosts): `ALLOW_PRODUCTION_CHECKS=1` / `ALLOW_PRODUCTION_WRITES=1` open staging AND production alike. So **a passing preflight is bound to the staging identity it checked**:
   - When the offline checks pass, `staging:preflight` writes `.staging/attestation.json` (git-ignored, mode 0600; override with `STAGING_ATTESTATION_FILE`): the project ref, the gateway, worker, storage and database HOSTS, the site, and the named OAuth client, bot, workspace and Vikunja. Identifiers only; never a token, key or password. It is valid for 8 hours. A FAILED preflight deletes any earlier attestation.
   - In a shell with `TARGET_ENVIRONMENT=staging`, every contact that the production gate governs (Management API SQL, the fetch guard, the Postgres executor, every command entry in `scripts/`, `staging:posture`, `migrate`, `deploy:*`) refuses, flags or no flags, when (a) there is no attestation, (b) it has expired, (c) the environment no longer names the attested identity (the message lists the drifted FIELD names, never values), or (d) the thing actually being contacted is not the attested project or site: a `<ref>.supabase.co` host, a Management API `/projects/<ref>` path, a database host, or a `*.vercel.app` page. (d) is what stops a script that falls back to the production ref when `SUPABASE_PROJECT_REF` is unset.
   - The one command that cannot have an attestation yet, `staging:preflight --live`, is exempt only at its entry; its executor is bound like every other.
   - Proven locally with fake credentials, a fetch spy and a dead proxy, never against production: `tests/staging/binding.test.ts` (20), including a subprocess run of preflight then `staging:posture` with the ref drifted to production and both flags set. Two sabotages (binding disabled; target not passed to the fetch guard) turned it red.
   - Limits, stated plainly: a shell that does not say `TARGET_ENVIRONMENT=staging` is not bound (that is the explicitly authorised production case); `*.vercel.com` API calls are not tied to a project; third-party APIs reached with their own keys (Google, Slack, Telegram, Vikunja) are not hosts the binding knows, so their staging-ness rests on the named identity fields and on separate credentials.

## D. Fresh staging database

Replay `migrations/` 0001..1020 into the empty staging project (`npm run migrate` with both flags and the staging environment). Free tier is 500 MB. Seed two test offices through the product\'s own sign-in path.

## E. Deploy, in this order (derived from the code, not from the earlier report)

0. Every command below runs in the shell the preflight attested (`TARGET_ENVIRONMENT=staging`): it is refused, flags or not, if the environment drifts from the attested identity, the attestation (8 hours) expires, or the target it would contact is not the attested project. Re-run `staging:preflight` after any change to the shell.
1. `npm run staging:posture -- hold` **before any worker exists**. It refuses unless the preflight passes and unless the database has migration 1020 (a hold the database does not honour reads as safe and is not).
2. `npm run staging:preflight -- --live` (needs `ALLOW_PRODUCTION_CHECKS=1`): the duties are held AND honoured. Only then:
3. `deploy:worker` -> `deploy:hq` (`hq-api`; its bundle includes the new Deno `preview.ts`, never compiled by a real deploy, so expect the first failure here) -> `deploy:mcp` -> the web page as a Vercel PREVIEW. Telegram, Slack, voice stay undeployed until a test needs them, and then only with separate test bots.
4. Allow duties one at a time: `npm run staging:posture -- allow calendar-event-sync` and so on. `drive-index` additionally ships switched OFF: `update public.responsibilities set enabled = true where slug = 'drive-index'` for the staging office, then `allow drive-index`.

Version skew, read from the code (`src/handlers/drive-read.ts`, migrations 1010 and 1020):

- **New worker, old database (no 1010):** the Import gate FAILS CLOSED. An Import-requested `drive.read_file` job asks `app.document_import_gate`; if that function does not exist, or the query fails for any reason, the file is NOT read, the request records "this deployment is older than its database expects ... Apply the migrations, then try again" (or "could not be checked just now. Try again in a minute"), and the job ends with a refusal. Nothing else in the worker is held back, so there is no start-up deadlock; the next attempt after the migration reads normally. `drive.index` has no duty row until 1020, so it never runs. The style-keep reader says nothing was saved. The preview-mark call before 0990 is guarded because it is bookkeeping, not an authorisation.
- **Old worker, new database (1010 and 1020 applied):** the SQL doors are gated by the database itself (`hq_document_import`, `document_import_enqueue_fetch`, `document_import_fulfil`), so a closed source is refused whichever worker is running. The 1020 `drive-index` duty ships switched OFF and the duty hold is honoured in SQL (`app.due_responsibilities`), so an old worker neither runs a handler it lacks nor starts held duties. The one residual window: an Import fetch job queued BEFORE 1010 and picked up by an OLD worker, which has no handler-side gate. It is narrow (the enqueue itself is gated from 1010) and is why the order is below.
- **Order:** migrations, then `staging:posture hold`, then the worker.

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

Calendar: real data; project / all / Google-combined scopes; create, edit, delete both ways; etags stored; If-Match on update/delete; timezone and all-day events across a DST boundary; clock skew.

**Acceptance criterion for a 412 (If-Match failure): it must NEVER silently overwrite a newer remote edit, and an unconditional retry is a failure of the test.** Provoke it by editing the event in Google between our read and our write. Pass requires ALL of:
- the stale-etag request is answered 412 and the same request is never re-sent with that etag, or with `If-Match` removed;
- the event is read back (fetch/reconcile) and the Google `updated` time is compared with the local row;
- Google's edit is NEWER: Google's content is kept, the local edit is not sent, and the loss is surfaced (the row's `sync_error` begins `conflict:` and a `google_sync` Activity event names the winner);
- the local edit is LATER: it is re-sent once with the fresh etag and the override is surfaced the same way; a second 412 leaves it pending for the next pass (no loop);
- a delete after a Google edit restores the event instead of deleting it;
- nothing in the above is quiet: every non-trivial outcome is visible on the page or in Activity.

Known edges to probe, because the current rule is "later writer wins" with `localAt >= remoteAt` (`src/handlers/calendar-events.ts`): an exact timestamp tie, or a Google event with no usable `updated` time, resolves to the LOCAL edit and re-sends once with the fresh etag (surfaced, but it does overwrite). Real Google always returns `updated`, so the second should be unreachable, and clock skew between Google and the database can flip the comparison. If staging shows either edge is reachable, record it as a defect (the safe behaviour there is to surface the conflict and send nothing), fix it, retest, and leave CAL-013/016/017/018 PARTIAL until it is proven.

Drive: browse a test folder; on-demand
read of a Doc, Sheet, Slide, text, Word, PDF, image; first-page PDF and image thumbnails; quota/403 bodies; a 25 MB PDF
through the edge function (memory/time limits); CORS for the binary section from the real page origin; Import; stale
refetch after a source edit. Disconnected-source refusal: switch the folder off and revoke Google, press Import (UI,
direct RPC, MCP) and expect `SOURCE_DISCONNECTED`; the imported copy must survive; reconnect must restore import.

## J. Vikunja (VIC-003, VIC-007)

Grant supplies a test Vikunja + token. Create / edit / pull / delete / title collision / outage / token refusal against it;
confirm the Settings Services chip and the Reconnect chore with a real outage (stop the server).

## K. External ChatGPT / Claude (EXT-003..013)

Grant adds the staging MCP URL + bearer as a connector in ChatGPT and in Claude. Call each tool for real: `search_project, list_tasks, create/update_task, list/create/update_event, inspect_activity, ask_team, start_research, generate_artifact`; confirm `delete_event` is absent.

**Negative authorization cases (each must refuse, and each refusal is evidence that nothing was done: check the database afterwards, not just the reply):**

1. **Invalid bearer.** No `Authorization` header, a malformed one, a revoked token and a token for another office each get HTTP 401 `unauthorized` with the RFC 9728 pointer; no tool runs and no row is written. A bearer for the STAGING office presented to the PRODUCTION address (never done: the address is not contacted) is covered by the binding in section C.
2. **Cross-office IDs.** With office A's token, call every tool that takes an id (document, task, event, project slug, job) with office B's ids. The answer must be the SAME as for an id that does not exist ("no document with that id"): no probing aid, no field of B's row in the reply or in the error, nothing created, no job for B.
3. **Forged office identity.** Put an `office_id`, `p_office`, `office` or `office_slug` argument in a tool call, and a forged `x-office`/`x-forwarded-*` header. The office comes only from the verified bearer; the argument is rejected or ignored, and the result is still A's scope. A model-authored prompt that names an office is not an identity.
4. **Unavailable or non-exposed RPC.** A tool name that does not exist answers JSON-RPC `-32601 no such tool`; a method outside `tools/list`/`tools/call` answers `-32601 unsupported`. A direct PostgREST call with the anon/authenticated key to an `app.*` function, to a `public.*` function that is not a gateway wrapper, or to a table with row security off, is refused (`check:anon-exposure`, `check:gateway-wrappers`). A section that exists in the gateway map but has no `public` wrapper is the 502 class to find BEFORE a person does.
5. **Disconnected-source access.** Switch the Drive folder off and revoke Google, then ask via MCP for a Drive document, its preview and an import: each returns the typed refusal (`SOURCE_DISCONNECTED` for import; `source_disconnected` for preview, with no text from the disconnected source handed out), no Drive request is made, and an already-imported copy stays readable. Reconnect and repeat: it works.
6. **An operation that requires human approval.** With the office (machine) key, attempt each of: approve or decline a document, grant or revoke a tool, a standing authorization, answering a blocker, a consequential outbound action (post to a channel, send mail, create a channel), and a destructive delete. Each is refused with `person_required` / `operator_required` (HTTP 403) or raises an approval question and waits; none is performed. The approval stays pending in the queue, and answering it as a signed-in PERSON is the only way it proceeds. The read-only client scope also refuses writes (`needs the write scope`).

## L. gateway -> SQL -> search -> palette (SEARCH-004, 007..009)

Type in the palette against the deployed gateway; results from tasks, documents, passages, saved pages, sources,
research, chat; per-project and all-project; second office sees none of it.

## M. Activity provenance (ACT-010, 011)

One action from each door - Team HQ, ChatGPT, Claude, Telegram, Slack - and confirm the chip on the Activity row.
Needs separate test bots and a test workspace (see Risks).

## N. Web research and the browser, in the deployed runtime (WEB-002, 004, 007)

Run a research job on the deployed worker; expect the honest "slow down" if the search service challenges the address; read a page, follow one hop, refuse a private address, safe-download allow-list, Storage write path.

**One explicit proof that autonomy stops where consequence starts**, in a single conversation on a project, with a registered TEST destination (#381) so that a defect cannot reach a real chat:
1. Ask the team to research a public question and read two pages. Expected: the research and the reads run WITHOUT any approval question (`blockers` gains no row for them), the job completes, sources are recorded, and the only egress is the allowed reads (worker egress log shows search and page GETs only).
2. In the same conversation ask it to take a consequential outbound action on the result (post it to a channel, or email it). Expected: the action does NOT happen; an approval question is raised with real options (a `blockers` row, `state` open, `on_answer` or `approval_next` set), `deliveries` for it is zero, and the egress log shows no POST to Slack, Telegram or Google Mail.
3. Answer NO as a signed-in person: still nothing sent, the question is closed. (Answer YES in a second run: exactly one delivery, to the test destination.)
4. Re-run (2) with the dial at Observe and at Act: the level-3 floor still asks (`autonomy_policy` can never resolve a level-3 action to proceed).
Pass is all four. Failing any of them is a code defect, not an environment issue.

## O. PDF / logo against real storage (PDF-015)

Make a report with a pale logo, a wide logo, a thin logo and a long title; the logo is fetched via signed link from the
staging bucket; open the PDFs and look.

## P. Tenant isolation through the browser (QA-015)

Repeat G through the UI with two signed-in browsers, including deep links and stale tabs.

## Q. Final visual QA on the integrated staging build

1440, 1280, 768, 390x844 and reduced motion: home, calendar views, documents (every preview state, rollback, imported,
thumbnails), Activity, palette, Settings > Services, maximise/restore, spatial transitions. Grant judges VIS-001/003.

## R. Ledger

Update the 335-row ledger as of `39c41fcc` (TESTED 201, VISUALLY VERIFIED 77, ALREADY SATISFIED 17, PARTIALLY SATISFIED 39, DEFERRED 1; HQ-STAGE-003 added by the binding pass makes it 336 with TESTED 202) only with evidence from the steps above: PARTIAL -> TESTED / VISUALLY VERIFIED row by row,
each citing the run. Rows that staging disproves stay PARTIAL with the exact failure recorded.

## Needs Grant

Staging Supabase project and keys (in its vault); a local, git-ignored `.staging/production-identifiers.json`; Vercel preview environment variables; a separate Google OAuth client + a test Google account and the consent click; a test Vikunja server + token; ChatGPT and Claude connector setup (paid plans may be needed); separate Telegram test bot(s) and a Slack test workspace (or `unused`); switching the `drive-index` duty on in the staging office when staging is ready for it; the visual judgement (VIS-001, VIS-003); approval to merge anything into p4 or main.

## What could make staging unsafe

1. The guard flags are target-agnostic: with production credentials exported, `ALLOW_PRODUCTION_CHECKS=1` WILL reach production in a shell that does not say it is staging. In a shell with `TARGET_ENVIRONMENT=staging` the staging binding (section C) additionally refuses any target that is not the attested project, flags or not. Use a dedicated shell with staging values only, and re-run the preflight after any change to it.
2. Reusing the production Google OAuth client, Telegram bots or Slack app would change production OAuth or message Grant's real chat. Use separate ones and register test destinations first (#381).
3. Migration 1000's backfill reads the vault; on staging it must only see staging secrets.
4. Duties fire on a timer: a deployed staging worker with real credentials runs real Drive/Calendar sync and could message or write. Keep announce channels pointed at test destinations.
5. Supabase free-tier limits and the p4 forensics findings about idle cost: do not load-test the staging project beyond need.
6. `hq-api` has never compiled the Deno preview code in a real deploy, so expect the first failure there. (The Import gate is not a deploy-order hazard any more: see the version-skew paragraph in section E. Migrations first is still the order, because the SQL doors and the 1020 hold live in the database.)
7. Calendar delete tests must use a throwaway calendar.
8. Do not run `purge:*` or `sample:*` against staging without reading the target first.

## S. First staging attempt: what was found offline, and what is still needed (5 October 2026)

The environment that ran this attempt held only production credentials, so NO remote staging operation was performed and
production was not contacted. Everything below was found and fixed without a staging project.

| Finding | Fix (on this branch) |
|---|---|
| `npm run migrate` in a staging shell would have rewritten `migrations/applied.json`, the PRODUCTION ledger | With `TARGET_ENVIRONMENT=staging` it writes `.staging/applied.json` instead |
| A fresh project cannot take the history one atomic request per file: 29 files before 0592 end in a self-check needing production rows, and the 0584 collision is only recorded in the production ledger | `npm run staging:replay` (src/migrations/fresh.ts): pre-0592 files on `docs/testing/fresh-replay-tolerances.json` are replayed a statement at a time tolerating ONLY the listed messages; 0592 onward is atomic. Proven locally: 787 files, schema identical (pg_dump -s) to the psql-built replica |
| `hq-api` failed `deno check` (Uint8Array as BodyInit) | Cast at the two Response sites; `deno check` passes |
| `worker` has 6 type errors under `deno check` | Pre-existing on p4, recorded, not changed |

p4 has advanced to `39e2f247`; it was NOT merged.

### Needs Grant before staging validation can continue
1. Create the staging Supabase project; add staging-scoped `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` and the `STAGING_*` set (`npm run staging:preflight -- --template`) through the cloud environment settings, never in chat; start a NEW session.
2. A dedicated Vercel project/token for staging previews (the existing token is production's).
3. A separate Google OAuth client and test account, and the consent click.
4. A test Vikunja server and token; Telegram test bot and Slack test workspace/app (or mark them unused).
5. ChatGPT and Claude connector configuration against the staging MCP endpoint.
6. Visual judgement of VIS-001 and VIS-003; approval for any merge into p4.
