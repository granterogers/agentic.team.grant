# V1 release: operator checklist (9 October 2026)

**NOT AUTHORISED. NOTHING HERE HAS BEEN RUN IN PRODUCTION.** Reasoning and evidence: `V1-PRODUCTION-RELEASE-PLAN-2026-10-09.md` (section numbers below refer to it).
SQL files: `V1-RELEASE-PREFLIGHT-QUERIES-…sql` (P01 to P19), `V1-RELEASE-MONITORING-QUERIES-…sql` (M01 to M21), `V1-RELEASE-FUNCTION-FINGERPRINTS-…tsv`.
Run each SQL with `ALLOW_PRODUCTION_CHECKS=1 npm run qq -- "<statement>"`. Grant sets `ALLOW_PRODUCTION_CHECKS` and `ALLOW_PRODUCTION_WRITES` per command; the agent never does. Never print a secret.
Marks: **UNKNOWN** = not known until read. **REQUIRES APPROVAL** = needs Grant's yes first (R-numbers are plan section 13).

## 0. Approvals in hand before starting
- [ ] R1 production reads · [ ] R2 heartbeat pause/resume · [ ] R3 migrate (eleven files) · [ ] R4 five deploys · [ ] R5 test destinations named: Telegram (own chat), Team HQ project ______, Slack channel ______ (or "none") · [ ] R6 spend ceiling · [ ] R7 thresholds · [ ] R9 window and who is at the keyboard
- [ ] Nothing else is requested: no backup deletion, no retention, no credential change, no other human contacted.

## 1. Repository (local)
- [ ] `git rev-parse HEAD` contains `8f74449217ca5f3d70ce7166e732355b6f0a6685`; `git status --short` empty
- [ ] `git diff 8f74449 HEAD -- src supabase web migrations` prints nothing
- [ ] `npm run release:services -- --against 9310116`: deploy = worker, hq-api, voice, signin, page; unchanged = mcp, voice-token, telegram-webhook, slack-events, slack-oauth, google-oauth

## 2. Preflight reads (REQUIRES APPROVAL R1) — any STOP voids the plan
- [ ] Dashboard shows project ref `baujwlzcziasnfhhkchg`; `SUPABASE_PROJECT_REF` unset or equal; `TARGET_ENVIRONMENT` unset
- [ ] Platform health API, once: auth, db, rest, storage all healthy. **STOP if not; do not retry into a sick host**
- [ ] P01: 798 applied, highest `1022`. **STOP otherwise**
- [ ] P04 free tier: database under 85% of 500 MB **and** storage under 85% of 1 GB (**PROPOSED**). **STOP if over** (UNKNOWN; last record 74% on 5 Oct, was projected to cross 85% by 8 to 13 Oct)
- [ ] P18 backup: newest under 36 h; rehearsal is overdue (last pass 21 Sep): run `npm run backup:rehearse` or accept in writing. Backup is not off-project and holds no uploaded files
- [ ] P05 = zero rows (else Grant decides per row before the worker, R8) · [ ] P06 count: ______ (Grant has seen it) · [ ] P19 zero rows
- [ ] P03 heartbeat active, no long transaction/lease · [ ] P10 to P15 as the expectations written beside each (Telegram: one enabled bot, the chief's; Slack bot ok; model order gpt-oss, qwen, mistral; `drive-index` and `calendar-event-sync` OFF)
- [ ] OpenRouter balance (dashboard): ______ (UNKNOWN)
- [ ] Rollback artefacts: `npx tsx scripts/forensics/capture-functions.ts .out/rollback-<date> worker hq-api voice signin` and `npx tsx scripts/p3/snapshot-defs.ts .out/rollback-<date>/defs-before.sql`; the 25 changed/removed function md5s equal the TSV `md5_before` column (**STOP if not**); previous Vercel deployment id noted: ______
- [ ] Live-copy check: captured bundles of signin/voice match `9310116` (UNKNOWN until captured)

**GO / NO-GO 1: all rows above ticked, Grant says go for R3 and R4.**

## 3. Deploy (REQUIRES APPROVAL R2, R3, R4) — newest-first rollback applies; stop at any failure
1. [ ] `npx tsx scripts/p3/worker-heartbeat.ts pause` (waits up to 3 min; note jobs left running: ____)
2. [ ] `npm run migrate -- --dry` lists exactly 1023, 1024, 1025, 1026, 1027, 1029, 1030, 1032, 1033, 1034, 1035
3. [ ] `npm run migrate`. If one file fails: it rolled back whole; STOP; forward-fix only. **If a process died mid-run: do NOT re-run** (1025, 1026, 1027, 1030, 1034 cannot be applied twice); check plan 4.1/4.2 before-probes, ask Grant before any hand-recorded ledger row
4. [ ] Commit the rewritten `migrations/applied.json`
5. [ ] M18 lists the eleven · [ ] 64 function md5s match TSV `md5_after` · [ ] **M21 zero rows (STOP if any)** · [ ] P05 re-read, decision made
6. [ ] `npm run deploy:worker` (probe passes; its kick runs a real pass now: expect the first redrive and sweeps)
7. [ ] `npm run deploy:hq-api` · [ ] `npm run deploy:voice` · [ ] `npm run deploy:signin`
8. [ ] `npx tsx scripts/p3/worker-heartbeat.ts resume`
9. [ ] `npm run config:site`, then `npx tsx scripts/deploy/hq-page-delta.ts` (dry; note rollback id), then `npx tsx scripts/deploy/hq-page-delta.ts --go --allow-new=flow.js,studio/flow.js`
10. [ ] M01, M02, M05, M11, M15 clean

**GO / NO-GO 2: any IMMEDIATE STOP below = stop and roll back the last layer (plan 10).**

## 4. Attended smoke test (REQUIRES APPROVAL R5). Prefix every sentence `[release smoke]`. Send only to the named destinations.
- [ ] A Telegram question: one message from Claire, with a source, no child job (90 s)
- [ ] B "Ask Daniel and Emma …": lead acknowledgement, then exactly one synthesis, nothing after, no specialist message (300 s)
- [ ] C reminder in 10 minutes: one confirmation, one reminder at the right office-zone time (15 min); complete it
- [ ] D daily reminder: tick it, series stays open (M20); then stop it, nothing recurring remains
- [ ] E Team HQ follow-up after a reload: same conversation, no duplicate (90 s)
- [ ] F Slack (only if a self-only channel exists): one threaded reply, nowhere else
- [ ] G approval boundary: ask for an outward post (or a new project); a question appears; answer **no**; nothing sent or created (M10, M17)
- [ ] H, I **not induced in production**: replica proofs `dl-delivery-redrive`, `terminal-job-owes-a-word`, `parked-turn-owes-a-word`; R18 real-model trial (about US$0.01)
- [ ] J `npm run gate:safe -- --part=identity` (10 min): no office but TEST changed; M11 zero rows; then `npm run sample:reset`

## 5. IMMEDIATE STOP (no threshold needed)
cross-office exposure (M11 row) · message to a destination not approved · unapproved write or send · duplicate consequential delivery (M05) · approval bypassed · migration failure or partial state · health API not healthy or database read-only · wrong Telegram routing · retry storm (**PROPOSED**: 30 failed or attempt ≥3 jobs in 10 min, or one kind failing 5 times in 10 min).

Observe, don't stop (**PROPOSED**): fallback decisions above 50% in an hour; model spend above US$0.05 an hour; hard stop above US$0.50 for the window; a first-sweep Needs-me item for an old delivery; a capacity notice.

## 6. Roll back (newest first; the database stays migrated)
- Page: Vercel promote the id the script printed (recorded: `dpl_34UgA3XsdS5suXYfs8ehBREu7Z3x`)
- signin / voice / hq-api / worker: `npx tsx scripts/deploy/restore-function.ts .out/rollback-<date>/<slug>.v<n>` (plan), then `--go`. Worker first of all if the worker is the fault. Read M06 first: indeterminate deliveries are never resent
- Database functions: only with Grant's decision, from `defs-before.sql` (plan 10); do not restore `claim_delivery`, `delivery_refusal` or the `deliveries` trigger without a stated reason
- Backup restore: disaster recovery only, never run on production, about half a day
- Irreversible: applied migrations, sent messages, first-sweep effects, ledger rows, smoke-test history

## 7. Close
- [ ] `capacity-watch`, reminders and approvals left in a clean state; `drive-index` and `calendar-event-sync` still OFF
- [ ] Update `docs/ops/deployment-state.json` (versions, page id, 809 applied); `npm run check:deployment-state`; commit and push
- [ ] Record job ids and times of A to J beside the deployment record
- [ ] Next after the test: #444 marker on backup-served answers; Issues #446 (ledger in the same transaction) and #447 (`verify:wired` red)
