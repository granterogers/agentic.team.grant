> ## 2026-10-08/09 - TEAM HQ INFINITE-CANVAS OVERHAUL (#439, branch `claude/confident-cori-ql21nl`, NOT merged, NOT deployed to production; isolated preview live)
>
> Hamburger menu instead of Home/Jump To, an infinite pan/zoom canvas with a dotted grid, per-project arrangement saved per person, Post-it plus, a
> compact resizable chat dock, live dictation, light stone theme (dark by choice), simplified Document Style and Project Settings, a content-led default
> layout. ADR-0068; ledger, evidence and next actions in `docs/ux/team-hq-overhaul-log-2026-10-08.md`. Real defects fixed on the way: notes lost between
> two devices, an endless render loop at a restored non-100% zoom, the tablet dock, text selected while panning. Not verified (needs a person and a
> device): dictation with a real microphone in Chrome and Safari (`docs/ux/dictation-manual-test-2026-10-08.md`), touch pinch, and the live public Sample.
> New suites: `verify:canvas`, `verify:canvas-extremes`, `verify:chat-dock`, `verify:sample-look`, `verify:canvas-devices` (two real browsers),
> `verify:canvas-session`, `verify:dictation-fallback`, `tests/studio/canvas-sync.test.ts` (53 adversarial two/three-device cases), `scripts/isolated/layout-isolation.ts`.
> Third session: notes from two devices now merge without loss; the race that remains is #442 (strict compare-and-swap, a backend change, OPEN, not part of this branch). **An isolated preview
> exists: https://team-hq-ux-review.vercel.app** (Vercel project `team-hq-ux-review` only, built from the branch plus the generated public `config.js`; the deployed commit is printed by `deploy:ux-review` and recorded in the log).
> **Production code, database, RLS and policy are unchanged.** One production CONFIGURATION change was made on Grant's explicit instruction (9 October): the origin `https://team-hq-ux-review.vercel.app` was added to the `signin`
> function's allow-list (`npm run deploy:signin-origin`, one secret, rollback: `-- --rollback`, details and 7/7 probes in the log's fourth session). `voice-token` was not changed. **A person can now open the Sample from the preview**
> ("Explore the Sample Office") and use the redesigned workspace; the real-gateway suite is `npm run verify:preview-sample` (38/38 on its last run, every gateway write aborted and counted: zero), the stand-in suite is
> `npm run verify:preview-app` (41 passed, 0 failed, 3 n/a). `verify:preview-live` (signed-out page only) is not workspace evidence (the earlier "24/24" was a weaker rewritten set; reconciled in the log).
> **Canvas Background Library (#445, ADR-0069, `docs/ux/canvas-backgrounds.md`):** pick a material per project inside How this project looks (8 supplied textures imported, plain colours, upload your own picture), preview before Apply,
> stored as a small reference in the workspace document. A custom picture is kept in the browser only (no per-person image store exists on the gateway; backend dependency recorded on #445). `npm run verify:canvas-background` (65 passed, 0 failed, 2 n/a).
> Not merged to main, not deployed to production. Still open: #442; real-device dictation and touch; custom pictures on other devices (backend). The verbatim original specification is `docs/spec/team-hq-ux-overhaul-2026-10-08-verbatim.md`.
>
> ## 2026-10-06 (later) - TEAM HQ RECONCILED WITH THE SAMPLE (branch `integration/team-hq-ux-v2`, from `8c2e4209`, NOT merged, NOTHING deployed)
>
> The Team HQ UX work was already in `main`; the audit found the old UX branch held one documentation commit and nothing else, so this branch is a
> fresh one carrying that and the corrections. **Migration 1000 is fixed before it was ever applied**: a Google credential is `active` only when the
> database proves it works (fresh `ok` health), `revoked` when Google said `invalid_grant`, `dead` when refused otherwise, `unverified` when nothing
> proves it (ADR-0067); a trigger keeps it in step with the credential's recorded health. **A deploy or migration run now refuses a dirty tree or an
> unpushed commit** (`src/safety/provenance.ts`; one bypass, a logged sentence, not used). Every stale reference to Team HQ's `0897`/`0900` is
> corrected to `0906`/`0907` (nothing executable depended on the old numbers). `scripts/isolated/combined-browser.ts` is the first browser run of the
> merged product: a person and a Sample visitor through the real gateway code, 9 viewports, reduced motion, 415 checks. `verify:phone-header` had been
> red on `main` for two reasons that were the suite's, not the product's, and was corrected. `HQ-VIS-001` and `-003` remain post-deployment user
> acceptance. State of play, what was and was not verified, and the order to deploy: `docs/ops/deployment-readiness-2026-10-05.md`.
>
> ## 2026-10-06 - PUBLIC SAMPLE OFFICE INTEGRATED WITH CURRENT MAIN (branch `claude/multi-user-p4`)
>
> Multi-User V1 itself was already in `main` (`28569e68`). This merge brings the four Sample commits (`0d98186a`, `1869d7ec`,
> `cccb5950`, `cf0c61f6`) together with `main`'s Team HQ UX integration (`b82c2779`). **Nothing was deployed and no migration was
> applied by the merge.** Production still runs the p4 lineage plus the Sample (migrations through `0905`; 770 applied); `main`'s
> 28 UX migrations remain unapplied and are a separate decision (`docs/ops/deployment-readiness-2026-10-05.md`). Migration
> numbers `0897` and `0900` had been taken twice: the Sample's are applied (never renamed), so `main`'s two unapplied files are
> now `0906_project_calendar_events` and `0907_documents_…` (the runner refuses an unapplied duplicate number; replay proof and
> reasoning in `docs/multi-user/PUBLIC-SAMPLE.md`, "Migration numbering collision"). Sample scripts that touch production follow
> the production-access guard (`docs/production-access-guard.md`). The two histories' entries below are kept in order of date.
>
> ## 2026-10-05 (later) - SAMPLE SHOWCASE LAYER (branch `claude/multi-user-p4`) - COMPLETE (verdict 6 Oct)
>
> The Sample now shows the TEAM, not only a project list: real delegation (Claire to Grace to Daniel), real agent-made work (a
> status report, a caption, a costs report), a tool request waiting for a decision (Settings, Requests), two recorded decisions,
> a Monday automation, a date-keeping daily job. Migrations **0899 to 0905** (0900 also fixes a latent `''::uuid` defect that
> broke hand-off delegation for everybody; #428 was a database cast, not a worker defect). Page `dpl_34UgA3XsdS5suXYfs8ehBREu7Z3x`
> (My Tasks project name, #426 failed-read, Settings notice; rollback chain in PUBLIC-SAMPLE.md). Nothing held was deployed.
> **Superseded 6 October 2026:** the integrated `main` (`9310116c`) was deployed and accepted: worker v975, hq-api v896, mcp v664, page
> `dpl_BaQDvaKi1PMQhnXCYCaBKrbd42Cx` (previous `dpl_34Ug…`), ledger 798, drive-index and calendar-event-sync OFF, Google revoked.
> Final state, gaps (#436, #437, MCP `tools/list` unverified) and acceptance status: `docs/ops/deployment-readiness-2026-10-05.md` section 13.
> Account, limits and the capability matrix: `docs/multi-user/PUBLIC-SAMPLE.md`. **Paused:** Supabase recovered after a dashboard restart
> (6 Oct 12:29Z) and the final walkthroughs passed on the final build: desktop 73/73, phone 73/73, plus contact Save/Remove and
> Automations refusals. 0902's first scheduled run failed with a platform startup timeout; watch the 7 Oct 03:23Z run. Open: #425 (the team's identity and its
> own Activity), #424 (dates: solved for tasks by 0902; close once the daily job has been seen to run).
>
> ## 2026-10-05 - PUBLIC SAMPLE OFFICE LIVE (branch `claude/multi-user-p4`)
>
> A logged-out visitor can Explore a read-only Sample Office (a made-up café) with no email, link or password, and still chat
> with the team under caps (6/hour, 15/day per visitor, 250/day overall), with no voice and no outside reach. Migrations 0897,
> 0898; `hq-api` v891; `signin` v126; page `dpl_3yZSXFhyNXjbhee7V86sUfA8Yui3` (original `dpl_8QwvvES1oRridjeokGzu2MMGdEYm`).
> Held Slack/polish work was NOT deployed. Production acceptance passed on desktop and phone, including one real chat turn and a
> real-person sign-in/sign-out round trip. Operating it: `npm run sample:public`, `sample:public-ui`, `sample:public-transition`.
> Full account and rollback points: `docs/multi-user/PUBLIC-SAMPLE.md`. Follow-ups: #424 (dates age), #425 (sample-aware worker
> identity, held), #426 (failed read shows prototype names).
>
> ## 2026-10-05 - PRODUCTION-ACCESS GUARD (branch `claude/ux-closure-guard`)
>
> A previous autonomous run touched production (read-only catalogue queries) only because credentials were in its environment.
> Production access is now **off by default**: `ALLOW_PRODUCTION_CHECKS=1` for any contact, plus `ALLOW_PRODUCTION_WRITES=1` for
> deploys, migrations, purges, senders and production-heavy suites. One definition (`src/safety/production-gate.ts`), enforced at
> `ManagementApiExecutor`, `PgExecutor`, a global `fetch` guard, entry modules and `db-query.sh`; inert in Deno (the worker) and for
> the local replica. Inventory, switches, residuals: `docs/production-access-guard.md`; manifest `docs/testing/production-access.json`;
> tests `tests/safety/`. Every command that touches production now needs the flag on its own command line, including the ones in
> "Asking the office about itself" in `CLAUDE.md` (`npm run q`, `check:*`, `measure`, ...), which that file does not yet say.
>
> ## 2026-10-04 (later) - TELEGRAM SELF-SERVICE, DELIVERY OFFICE, TALK, GATE (branch `claude/multi-user-p4`)
>
> Migrations through **0886**. hq-api **v884**, telegram-webhook **v689**, page `dpl_41Ts4Gd5PUAcaazN93dxofCvbK6M` (rollback
> `dpl_DPj4Nmnu5J3xy7afcNsUNccnCd3f`). **#410 Telegram** (ADR-0064): a person connects their own Telegram from Settings >
> Messaging by a single-use ten-minute link; the webhook binds the SENDER to the TOKEN's office; refusals and the operator's
> office are covered; proofs `verify:channel-link`, `sample:channel-link`, `scripts/isolated/telegram-link.ts` (real webhook).
> NOT proven: a real iPhone tap on a real link (MANUAL). **Slack not attempted.** **delivery_office (0883/0884):** missing
> provenance is the system office, never the operator; an operator sender may not address another office's chat or channel
> (`verify:delivery-office`). **verify:talk** now drives Team HQ with SIMULATED audio (voice note and Talk to Team real-audio
> acceptance remain MANUAL). **#414:** `verify:history` and `verify:connectors` converted (test office + Sample rollbacks);
> `gate:safe` has three parts. **Temp files:** the producer is NOT identified; `log_temp_files` was reported not settable by our role (CORRECTED: never tried; the docs and API spec say it is configurable, see `docs/ops/supabase-forensics-2026-10-04.md`)
> (`docs/ops/supabase-efficiency-2026-10-04.md`). Old `npm run gate` still PARTIAL.
>
> ## 2026-10-04 - P4 CONTINUATION (branch `claude/multi-user-p4`): incidents, project context, learning, labels, safe gate
>
> Migrations through **0882** (752 files). Worker **v959**, page `dpl_DPj4Nmnu5J3xy7afcNsUNccnCd3f` (rollback
> `dpl_5PTmaiPmmrJjxWfteNsUoPXQce8K`). **#413** an unresolved problem is told once per office/service/problem
> (`public.incidents`, `app.incident_seen`, resolution reports whether he was told); live on Telegram and Slack for two failing
> duties. **#416** the loaded project is the project (ADR-0063); Telegram/Slack/voice resolve a single named project (0880).
> **#417** teaching recogniser fixed and proved live. **#418** the office's own actor reads `you` (0881). **#414** `npm run
> gate:safe` (serial, no model calls, fingerprints 25 offices before and after; last run 10/10, all diffs empty) -
> `docs/testing/gate-reach.md`; the old `npm run gate` is NOT converted (PARTIAL). **#408** closed, **#412** narrowed.
> 0882 corrects the browser Settings card. P0: `docs/ops/supabase-efficiency-2026-10-04.md` (measured / inferred / unknown;
> the temp-spill source is NOT attributed, memory starvation NOT proven). Still MANUAL: VOICE NOTE real-mic and TALK TO TEAM
> real-audio acceptance. `verify:talk` is stale (drives `/classic/`).
>
> ## 2026-10-02 - MULTI-USER P4: SECOND-USER ACCEPTANCE (branch `claude/multi-user-p4`; HARD STOP: nobody invited)
>
> A controlled second PERSON now exists in production (office `205669cc-…`, login on the reserved `.invalid` domain, password
> in the Vault as `p4.second_person.password`): provisioned by `app.provision_person_office` (0863), retired by
> `app.retire_person_office`, both operator-only (`npm run office:second-person`). Real session, real gateway, real worker,
> real model path: first login empty; same-name objects isolated; foreign id = nonexistent id for 11 reads and 15 writes;
> Claire and her children stay in the office (49 model calls, 0 deliveries); retrieval canaries both directions with positive
> controls; two browsers, both switch directions, four storage kinds; voice, MCP; 47 attack checks; five sabotages red then
> green; Grant's own account 42/42 afterwards; harness contamination in his office unchanged (1827/3251/10/0/1014).
> **One defect found and fixed**: `google`, `build`, `ci_lately`, `ci_budget`, `bots` took no office so no office check covered
> them; they are now the operator's (`hq-api` v852). **Open, filed, Grant's to decide before a real person tries it**: the
> agents address the second person as "Grant"; there is no sign-out control; Telegram, Slack, Google and MCP are not
> configured for a second person. Canonical: `docs/multi-user/P4-SECOND-USER-ACCEPTANCE.md`. `app.sole_person_office()` is
> now NULL by design; operator tools name `app.operator_office()`.
>
> ## 2026-10-01 - MULTI-USER P2: THE OWNERSHIP FOUNDATION (branch `claude/multi-user-p2`; P3 NOT started)
>
> Migrations **0653-0666** applied (13 waves, each verified before the next). Every private row now has an office: a
> `public.offices` row per person / sample / test / system, `office_id NOT NULL` and write-once on the 52 carriers, 56
> composite `(parent, office)` keys, guard triggers on all 45 derived tables, an endpoint guard on `relations`, per-office
> private names, and row security on the 46 tables that lacked it. Production holds **one person office (Grant), one test
> office and one system office; no second real person was created.** The history was assigned by evidence in five tiers
> (63,803 rows: 29,928 person / 24,248 test / 9,627 system / 0 unresolved); 8,484 unattributable rows are in the system
> office, and 5,821 harness rows are in Grant's office because the database links them to his projects - flagged, not
> hidden. New gate entry `check:office-edges`. Found live and fixed: the guards ran as the writer, so the Telegram webhook
> answered 503 for 7 min 47 s (0664). **Not done, on purpose:** the 878 functions, the 47 ambient-Grant defaults, the
> bridge removal, the machine-key rotation (device evidence), MCP consent. Canonical: `docs/multi-user/P2-OWNERSHIP.md`,
> ADR-0061; P1 is closed in `docs/multi-user/P1-FINAL-CLOSURE.md`. Next: P3, in the order P2-OWNERSHIP.md section 13 gives.

> ## 2026-10-01 - MULTI-USER P0 + P1 SECURITY CLOSURE (branch `claude/multi-user-p0-p1`; P2 NOT started)
>
> Migrations **0647-0652** applied; `voice` v595, `voice-token` v625, `hq-api` v830, `google-oauth` v591, `worker` v899 and
> the studio page deployed, each probed live. Fixed: the unauthenticated voice mint and the ambient voice subject; 22
> deployment-wide actions and the Drive browse now need a deployment **operator** (`deployment_operators`, 0647); one
> resolver for fixed-name credentials (`app.deployment_credential`, 0648; raw readers retired, 0649); the Google connect
> flow needs a one-time state (it used to store any account's code); storage is written only after the database target is
> authorized (0650); no member is Grant by default (0652). New gate entries: `check:ownership`, `check:system-secrets`,
> `check:machine-key`. **Not done, and why:** the machine key is not rotated (device evidence needed), 22 unused
> write-scoped MCP tokens are not revoked (yours to confirm), MCP consent is still the machine key. Canonical:
> `docs/multi-user/P1-CLOSURE.md`. Next: review the P2 gate verdict there before the ownership migration begins.

> ## 2026-10-01 - MULTI-USER RESEARCH COMPLETE (design only; nothing applied)
>
> The research the policy closure named as next has been done on `claude/multi-user-research`, against `41de1965`
> (migrations through 0646). **Production was read, not changed**: no migration, deploy, RLS change or user was created.
> Read `docs/multi-user/` - start with `ARCHITECTURE.md`, then `REVIEWS.md` (two adversarial reviews and what changed) and
> `IMPLEMENTATION-PLAN.md`; the decision is ADR-0060 (proposed). Issue #399 is resolved architecturally in
> `TABLE-REVIEW-399.md` (all 129 tables). **There is no historical multi-user branch in this repository** - see
> `LEGACY-BRANCH-REVIEW.md`. The original audit stays closed. **Three present-day weaknesses were found and are NOT fixed**
> (change freeze): `voice-token` has no authentication (E1, HIGH); any signed-in session or the machine key can browse
> Grant's Google Drive (E13); a `person` session may run system-wide actions (E14). They are Phase 1 of the plan and do not
> depend on the rest. Issues: #400 (voice), #401 (Drive/operator actions), #402 (implementation tracker), #399 (commented).

> ## 2026-10-01 - FINAL POLICY CLOSURE: ORIGINAL ARCHITECTURE AUDIT: CLOSED
>
> Grant's seven final policy decisions are implemented (migrations 0640-0646), reviewed adversarially (eight defects
> fixed), and verified in production (worker v891, telegram-webhook v639, hq-api v822). #389's four duties now ask
> through the one authorization: Vikunja create/update by the board connection and delete by an exact question; a
> project he made provisions its own Slack channel and anything unprompted asks; a Notion database he connects carries
> a yes for that database only; Slack rotation asks every time. One rotation question is open on his dashboard because
> the stored pair expired on 10 September. A public-key exposure of 43 tables was found and closed (0642). Canonical:
> `docs/policy/FINAL-POLICY-IMPLEMENTATION.md`, ADR-0059. The Vercel page was not redeployed (no `VERCEL_TOKEN` in the
> build session). The next phase is multi-user architecture research; it has not begun.

> ## 2026-09-30 - Architecture Run 5 (question binding, forwarded content, fenced children) - PRODUCTION
> Migrations 0623-0626 applied; worker, telegram-webhook and slack-events deployed; run5-live 20/20 and Runs 1-4 live green;
> `check:leaks` exit 0. A delivery now names the question it asked; a reply binds to that question or to nothing; forwarded words are
> not intent; a claim has a number and a child has an author. Read `docs/ARCHITECTURE-RUN-5.md`, `docs/architecture-run-5/`
> (CROSS-CHANNEL, AUDIT-RECONCILIATION, DECISION-389) and ADR-0056. Next: Final Audit Reconciliation.

# Handover

> **Read `CLAUDE.md` first.** It is the standing brief — Grant's own
> instructions, the hard constraints, the traps this repository has already
> fallen into, and how to run and verify everything. This document is only the
> current state.
>
> **Actionable work lives in
> [Issues](https://github.com/granterogers/agentic.team.grant/issues)**, under
> milestones M0 → v1.0. Not here, not in commit messages, not in chat.
>
> ## 2026-09-30 — Architecture Run 4 (durable origin, lifecycle) is deployed and verified on `main`
>
> Migrations 0619-0622 are applied; `worker` v868, `hq-api` v803 and `telegram-webhook` are deployed. A job now
> records where it came from (root, why it exists, trust class, command, channel) once, at creation; a worker
> finishes only a job it still holds (fence + heartbeat); a retried parent finds its child; an answer grants a
> further attempt; a retry can commit; a typed yes answers a question he was shown and a forwarded message never
> answers. Run 3's debts #389/#391/#393 are untouched by design; #392 and #394 are partly closed - the residual
> is exact in `docs/ARCHITECTURE-RUN-4.md` (Remaining debt). Decision: ADR-0055. Live: `npm run verify:run4-live`
> (24/24), and Run 1-3 live suites green. **Traps learned:** a suite that fabricates a `sent` delivery row must
> delete it in teardown or `check:leaks` reads it as harness traffic reaching a destination; an attempt number is
> never handed out twice (the fence and child slots are keyed on it).
>
> ## 2026-09-30 — Architecture Run 1 is deployed and verified on `main`
>
> Migrations 0607–0610 are applied; `worker`, `hq-api` and `telegram-webhook`
> are redeployed (worker v852, hq-api v787, telegram-webhook v605). The
> semantic boundary (one immutable `Turn`, `HumanWords` vs `Paraphrase`,
> `entitled.*`, explicit early-gate precedence) is ADR-0052; B1–B7 are fixed and
> were re-proved live through the deployed doors (`npm run verify:run1-live`,
> 14/14, all traffic declared test traffic). Record, rollback point and the
> residual register: `docs/ARCHITECTURE-RUN-1.md`. **The worker also needed the
> redeploy** (it imports the changed handlers); the first handoff omitted it.
> The Vercel page step of `deploy:hq` fails on a 10 MB request-size limit; Run 2
> shipped the page with `deploy:hq-page` instead.
>
> ## 2026-09-30 — Architecture Run 2 (authority) is deployed and verified on `main`
>
> Migrations 0611 and 0612 are applied; `worker` v855 and `hq-api` v790 are
> deployed (`telegram-webhook` untouched). **What it completes:** the canonical
> authorization and exact-approval architecture (`app.authorize_effect`,
> exact-action fingerprints, a durable and reversible No, the to-do tick through
> the one door) is established and production-proven for the MIGRATED paths
> (plan steps, the calendar duty, `drive.ingest`). Migration of the remaining
> effect doors to that boundary is explicit follow-up work (#386); it is NOT
> true that every effect is behind `authorize_effect`. Grant's decision: at
> `suggest`, internal level-1 writes proceed (0612, data). Refusals can be taken
> back from Governance (*Let it ask again*). Debt, each an Issue: #384 anon
> sweep, **#385 the bearer token is attributed as `grant`, so possession can
> confer Grant's approval identity**, #386, #387, #388. Page deployed with
> `npm run deploy:hq-page` (digest delta; `deploy:hq`'s page step still exceeds
> 10 MB); rollback point `dpl_CojPMBWNXjWfQ3ogNAmXx6ZyAB9e`. Live proof:
> `npm run verify:run2-live` 50/50. Record: `docs/ARCHITECTURE-RUN-2.md`, ADR-0053.
>
> ## 2026-09-29 — #378 containment audit, on `claude/378-containment` (NOT deployed)
>
> Harness work reached people by paths that bypassed the guard. The first was
> Slack narration with no job (381 of 523 narrations). Also: a bare-`fetch`
> transcript echo and 👎 question, harness children writing to Notion and
> NotebookLM, and harness turns in his Chat.
>
> Fixed at two chokepoints, both fail-closed: `app.delivery_refusal` inside
> `claim_delivery` (0601), and a job-boundary gate in `runJob`
> (`src/jobs/containment.ts`); see ADR-0049. `check:leaks` now reconciles
> every sent message against provenance independently of `app.harness_job`.
>
> #379 (same branch): unknown origin is no longer real traffic. `app.job_origin`
> (0603) decides both boundaries from a positive model of what each adapter and
> office function creates; 0604 keeps harness task content out of his calendar
> and briefing. Worker first, then 0601–0604.
>
> Full matrix, proofs, history and deploy order:
> `docs/testing/378-containment-audit-2026-09-29.md`. **Deploy the worker
> before 0601.**
>
> **Team HQ is the product at every address (#382, ADR-0051), 29 September.** `/` is Team HQ's portfolio, and a project is `/p/<slug>`. Old `/basecamp/…` and `/studio/…` links redirect. The older studio is kept, unlinked, at `/classic`. No visible "Basecamp" anywhere (`check:branding`, in the gate). Journey proof: `verify:team-hq-journey`, desktop and phone. Live on `dpl_CojPMBWNXjWfQ3ogNAmXx6ZyAB9e` (main `77fc323c`); record `docs/integration/team-hq-cutover-2026-09-29.md`.
>
> **Branch audit, 29 September: `main` is canonical.** Every non-fresh-install
> branch is contained in `main`. The one missing document, the three-branch
> reconnaissance plan, was copied in. The branches are listed for deletion in
> `docs/integration/branch-audit-2026-09-29.md`; the session proxy refused the
> deletions, so they are still there. The fresh-install lineage (four branches)
> is untouched.
>
> **#381 containment: DEPLOYED and ACCEPTED 29 September; main is at the accepted implementation.** Worker v848, migrations to 0606. Fixture Slack channels invite nobody; test destinations are retired, never deleted (0606). Record: `docs/testing/381-production-acceptance-2026-09-29.md`.
>
> **(Earlier) #381, RC2 on `claude/381-rc2`.** A deployment of the above
> stopped at pre-flight: suites posting correctly signed updates to the live
> doors were `trusted` by 0603. `verify:latency` had posted as Grant from his
> own chat. 0605 adds `public.test_origins`. A suite declares its fixture
> conversation first (`testOrigins(db, …)`), the door writes it synthetic, and
> the database refuses to declare anything real. `check:door-origins` guards
> the repository side. Deploy order: worker, then 0601 → 0605. Everything is in
> `docs/testing/381-live-door-containment-2026-09-29.md`.

> ## State as of 2026-09-24 — MERGE-READINESS, and two defects it found
>
> **Nothing is merged.** `docs/integration/merge-plan-2026-09-24.md` is the
> exact plan, written from a candidate that was built, deployed and driven:
> `claude/human-simulation-harness` (which already contains `main` and
> `claude/production-reliability`), then `claude/fresh-install-onboarding`,
> then this branch. Five conflicts, of which one — the gateway — ends
> mid-function and must be read rather than concatenated.
>
> **ADR-0048: the dashboard resolves its own office.** Six modules under
> `web/studio` each fell back to one project's gateway, so a dashboard
> somebody else deployed pointed at an office that was not theirs and was
> refused with a 401 and no explanation. `web/studio/backend.js` resolves it
> once and returns the empty string when nothing has named one;
> `npm run config:site` writes `web/studio/config.js`, which is gitignored, so
> a clone has no default to be wrong about; `npm run check:backend-ref` is the
> regression, in the gate, and proves it can fail.
>
> **A throttle signed people out.** The gateway verified a session with a
> boolean, so a 429 from Supabase Auth was indistinguishable from "this
> session is not valid" — and the page clears a session the office refused, so
> an upstream hiccup signed somebody out. Three verdicts now: 401 for a
> refusal, **503** for could-not-check. Found by running the acceptance pass,
> not by reading.
>
> **And an office with no projects could not draw at all** — `PROJECTS[0]` is
> undefined on every office's first morning, and the whole screen rendered as
> "This screen did not draw" for a signed-in person whose only mistake was
> being new.
>
> | | |
> |---|---|
> | Unit tests | **3,125 passing** (194 files) · migrations **608** in the candidate |
> | Zero-state | **608/608** from a database dropped immediately beforehand |
> | Deployed for the pass | `hq-api-integration` v6 and a preview with its own hostname. Production and the stable Basecamp alias were probed afterwards and are untouched. |
>
> ## State as of 2026-09-21 — GOAL PLANNING, and the end of the architecture phase
>
> **The architecture phase is finished.** The office can now take an ordinary
> sentence, plan a route through its real capabilities, carry it out durably,
> notice when the goal was not met, try one other route, and say honestly what
> it did and did not do. Nothing here needs another architectural campaign
> before Grant uses it; what remains is listed as ordinary Issues.
>
> | | |
> |---|---|
> | Tests | **2,213 passing** (140 files) · migrations **529** |
> | Deployed | `worker` v647 · `hq-api` · studio |
> | New | `src/agents/goal.ts` (constrained planner) · `src/agents/perform.ts` (executors + compiler) · `src/agents/satisfied.ts` (goal assessment) · `src/handlers/pursue.ts` (`office.pursue`) |
> | New suites | `verify:pursues` 46/46 · `verify:composes` 18/18 (`--deployed`) · `verify:chief` 10/10 · `verify:plan-stability` (reports, does not gate) |
>
> **What the planner is.** `planFor` is *constrained*: it is shown only the
> capabilities the registry says exist AND are performable, and a capability
> that is declared but not built is rendered `NOT YET BUILT — the office can
> only refuse it`, so the model reaches for `unreachable` rather than inventing
> `web.search` or `notebook.write`. The held-out set went **7/23 → 14/23** and
> multi-step plans **0 → 7**, with **zero invented capabilities**.
>
> **Bounded re-planning (`office.pursue`).** `GOAL → PLAN → ACT → OBSERVE → IS
> THE GOAL MET? → one other route → VERIFY → REPORT`, bounded at **3 rounds**
> and **120 s**, with a fingerprint of `goal + unmet` so the same plan is never
> tried twice. A round re-plans because of a NEW OBSERVATION; an identical plan
> or a fallback plan ends the loop. **Re-planning never expands
> authorization** — every re-planned step goes through the same `mayAct`
> check at execution time, so a permission revoked after planning stops the
> step, and a refusal or an unbuilt capability is `final()` and is never
> re-planned around however much else succeeded.
>
> **Goal completion is not step completion.** `src/agents/satisfied.ts` returns
> one of seven verdicts — `satisfied`, `partially_satisfied`, `blocked`,
> `awaiting_grant`, `impossible_here`, `temporarily_unavailable`, `failed` —
> deterministically, from canonical effects. `satisfied` requires a **receipt**
> when the plan contained an acting step; a pure-read plan is satisfied by
> having read. The assessor never authorizes anything.
>
> **The three worth remembering.**
>
> 1. **The planner was being handed a paraphrase.** `understand`'s cleaned text
>    dropped the purpose clause of a 148-character message (91–148 chars out).
>    Paired against the verbatim sentence: 7/8 cleaned, **8/8 verbatim**. The
>    planner gets Grant's own words now.
> 2. **`assess` used unprefixed step names**, so from round 2 onward it read
>    "nothing ran" — a *successful* second round would have been reported to
>    Grant as a FAILURE. `byStepId` is shared by the compiler and the assessor,
>    because two spellings of a name is exactly what went wrong.
> 3. **A migration that TIGHTENS a contract must ship with or after the code
>    that satisfies it.** 0529 made `verdict` a required fact key and was
>    applied before the worker was deployed; one harness job failed in the gap.
>
> **Honest about variance.** `npm run verify:plan-stability` reports; it does
> not gate. Two passes gave 1/15 and 4/15 crossings — **the measurement is
> itself too noisy to quote as a reliability figure**, and it is recorded that
> way rather than rounded into a percentage.
>
> ## State as of 2026-09-18 — GRANT HUMAN BETA, the first session
>
> **The first session driven entirely by Grant using the product.** Two reports
> from him, four defects, two of them live for days and both invisible to every
> gate here. Full write-up:
> `docs/testing/handover-2026-09-18-beta.md`.
>
> | | |
> |---|---|
> | Tests | **1,716 passing** · migrations **488** |
> | Fixed | **0486** the OAuth pages have never rendered · **0487** Telegram was never disconnected and the dashboard said it was · **0488** the same guard for Slack · **0489** the branch that speaks up was the branch the gate silenced |
> | Deployed | `google-oauth` v377 · `hq-api` v586 · studio · `worker` |
>
> **The three worth remembering.** Supabase will not serve HTML from the shared
> functions domain — it rewrites `text/html` to `text/plain` with `nosniff` —
> so every page the OAuth function ever produced arrived as raw markup, and no
> suite here opens a page served by an edge function. A disconnect whose
> `delete` matched nothing still marked the dashboard `missing` and returned
> `ok: true`, so a live, working credential read as gone for four days. And the
> Slack rotation handler claimed `deterministic_retrieval` on the one branch
> that calls a model, so **the branch that exists to speak up was the branch
> the coherence gate silenced** — ten failures, nobody told, the token expired.
>
> Corrections to the entry below: Google is reconnected, and the Telegram chief
> bot token was never missing.
>
> ## State as of 2026-09-17 (late) — the twelve-hour capability run
>
> Started from `68b7958`. Grant's three reserved product decisions are made and
> recorded (#257 archive-and-hide, #258 signed links, #261 no paid compute);
> **do not ask them again.**
>
> | | |
> |---|---|
> | Tests | **1,683 passing** · migrations **471** · gate **30 suites** |
> | Closed | **#133** (`npm run replay` + `verify:judge`, both controls proved) · **#257** (one index, two connectors, `verify:unified` 10/10) |
> | Advanced | #258 (signed-link delivery + `verify:artifact` 12/12; one live Slack round trip left) · #172 (`mail_awaiting`) · #41 (cancellation closed, `verify:stop` 13/13) · #276 (two of 27, `verify:review` 17/17) |
> | New checks | **`check:pressable`** — a gateway action with no control is #72 one layer up; it found 27, now 25 |
> | New suites | `verify:judge` · `verify:unified` · `verify:artifact` · `verify:stop` · `verify:review` |
> | ADR | **0040** — an upstream deletion archives and hides; nothing is destroyed and restoration is a path |
>
> **The three worth remembering.** A judge that scores twice and subtracts
> cannot see a sabotaged run — it compares now, asked both ways. A replay could
> deliver to Grant through the children it spawned, and two migrations were
> needed because the worker writes the announce decision back. And
> `app.awaiting_review` had never returned a row in its life: it filtered a
> state nothing writes, in front of two buttons nobody had.
>
> ## State as of 2026-09-17 — the twelve-hour backlog campaign
>
> Grant: *"please continue until all open issues are closed .. to my count
> there are around 71 left"*, and *"remove these issues — #113/#114/#136/#137/
> #138 as closed .. we can come back to this kind of things"*.
>
> **71 open at the start. 21 at the end.** Fifty closed: half by building the
> thing, half by verifying it was already built and saying so with evidence.
>
> | | |
> |---|---|
> | Tests | **1,526 passing across 81 files** · migrations **420** |
> | Built | #272 (part) the office asks and Grant answers · #28 Preview · #121 slash and j/k · #14 Recent activity · #21 the build diary's retention · #178 the Notion teardown · #252 unanimity over a coin · #244 the insisting dequeue · #253 due dates and assignees · #126 drop a file · #242 the set-aside gate · #187 a channel per project · #130 structure before prose · #13 the OpenAPI document |
> | Verified and closed | #35 #29 #25 #12 #75 #223 #224 #171 #237 #176 #169 #170 #174 #175 #188 #229 #271 |
> | Closed at his instruction | the five proposal menus #113 #114 #136 #137 #138, plus #23 #40, and their children #139–#146 and #159–#168 |
> | New suites | `verify:lately` 8/8 · `verify:upload` 10/10 · `slack:add-scope` |
> | New checks | `verify:controls` now fails on a control a mouse can press and Tab cannot reach · `verify:hq` reads the OpenAPI document back · `verify:slack` asserts every project has a channel · `verify:import` proves structure beats prose |
> | New ADR | **0034** — the build diary's bucket stays public, and the four things that make that acceptable. **If the repository is ever made public, that ADR is void.** |
>
> ### After the campaign: #272, and the half of ADR-0018 that was never built
>
> `check:callers` had put `public.hq_approve_tool`, `public.hq_decline_tool`
> and `public.hq_revoke_tool` in its baseline. They are not three stray
> wrappers — they are the human half of ADR-0018, and **an agent could ask
> Grant for a capability and Grant had nowhere to answer.** All fourteen
> settled requests on record were settled by a script.
>
> Migration **0420** adds `requests` to `app.hq_governance`; `hq-api` gains
> `approve_tool`, `decline_tool` and `revoke_tool`; the Governance page gains
> *What it is asking for*, between *What it wants* and *What it noticed*.
> `app.expire_temporary_staff` and `app.expire_undo_offers` are wired into the
> worker's boot sweep beside `mcp_expire_codes`. **Baseline 40 → 33.**
>
> Four defects came out of DRIVING it, none of them visible from reading:
> `decline_tool` refuses a decline with no reason; the page rendered "0 open"
> over a populated database because `settings.js` did not carry the new key;
> the capability brief prepended to every answer had grown to 5,183 characters
> against its 4,000 ceiling, 2,027 of them registry essays; and the tool chip
> vanished on a settled card.
>
> ### What tonight found that nobody was looking for
>
> - **Grant's Recent activity page was forty identical rows.** 285 of one day's
>   372 events were the noticing pass. Everything else the office did was below
>   a fold nobody reaches (#14).
> - **Nine document cards shared one name** — the audit read a page
>   illustration's inline stylesheet as the control's label, de-duplicated them
>   into one, and had never pressed eight of the nine (#121).
> - **`office.rename_channels` has had no handler since 0073.** Eleven jobs,
>   all cancelled. Renaming a project has never renamed its channel (#187).
> - **The Slack app-configuration token died on 10 September** and its
>   single-use refresh token with it, so the app's scopes and events cannot be
>   changed from here at all (#270).
> - **123 jobs in a week are real by `jobs.is_fixture` and harness by
>   `app.harness_job`**, and the day's counts on his dashboard were reading the
>   flag (#14).
> - **`npm run space` reported 0px of phone furniture** — a perfect score from
>   a measure that had matched nothing since #25 turned the Overview into a map
>   (#188).
>
> ### What is left, and why
>
> **Twenty-one issues.** Four need Grant's hands and cannot be closed from
> here: **#18** and **#213** (rotate two credentials), **#270** (re-issue the
> Slack configuration token, then two clicks to reinstall), and the human half
> of the browser work. The rest are either large new capability asks he filed
> on 15–16 September (**#257–#265**) or substantial single features
> (**#128** handoff, **#129** cross-project memory, **#133** replay, **#41**
> the deep systems test, **#172** Gmail, **#15** approval policy, **#16**/
> **#135** browser agents, **#272** the caller baseline).
>
> **#16, #135 and #261 share one blocker that is Grant's to decide**: a browser
> session needs a long-lived container, and nothing in a £0/month architecture
> of edge functions and Postgres can host one. That is a cost decision, not an
> engineering one.

> ## State as of 2026-09-16 — the issue-closing stint
>
> Grant, after the eight-hour run closed: *"continue for another 4 hours..
> closing all open issues that you can"*. **Twenty-two closed, two filed.**
>
> | | |
> |---|---|
> | Tests | **1,478 passing across 78 files** · migrations **409** |
> | Closed | #180 #267 #246 #247 #248 #249 #254 #255 #256 #96 #36 #186 #269 #45 #251 #250 #245 #236 #10 #221 (and #121 advanced) |
> | Filed | **#270** (the `channels:join` scope, one action only Grant can take) · **#271** (a project's picture is a thumbnail, not a cover) |
> | **#221** | **451 project marks from lucide**, ISC, selected by domain and generated by `scripts/build-icons.ts` so the selection is data Grant can change. Searchable, browsable by sixteen categories, auto-assigned on create from a name match, and one tab stop with arrow keys inside it |
> | **#269** | the roster went from **276 rows to 8** — 268 were retired harness specialists and the table grew by three a run. 16 of 19 foreign keys restrict, so only a specialist who did nothing comes out |
> | **#236** | `verify:drains` proves it fires, and **0406 gave the office a word for `waiting`** — failed, stalled, in_flight and finished are all about a job that STARTED |
> | **#10** | **ADR-0032**: a PDF cover is a view, not an artefact. None of the three candidate places was right, because storing one was the wrong question |
> | New checks | `npm run check:icons` (in the gate) · `verify:keyboard` 24 → **28** · `verify:drains` 4 → **8** · `npm run space` walks the home board |
> | Three visual defects | all found by **opening the PNG**: chips that never rendered, a 13.3px search input that would zoom iOS Safari, and 33×23 touch targets against a 44px floor |
> | One pre-existing bug | `let ageTimer` below the hoisted function using it — the studio printed *"could not draw this screen"* at every boot and recovered on the next draw, so nothing had ever seen it |
>
> ## State as of 2026-09-16 — the second eight-hour run
>
> `docs/AUTONOMOUS-RUN.md` carries the live table of what this run has
> delivered and what it has not reached. **Read that before this section**, and
> read this one for what changed about the PRODUCT rather than about the run.
>
> | | |
> |---|---|
> | Tests | **1,462 passing across 75 files** · migrations **400** |
> | New suites | `verify:rules` 26/26 · `verify:routing-quality` 13/13 · `verify:extract` 11/11 |
> | Restored | `verify:arrangement` 22/22 — it had been failing since #25 landed, so ADR-0021's guarantee was unverified for a morning |
> | **#25** | the project dashboard is a living map — a derived graph, a pannable plane, persisted placement and a side panel. The item Grant named first when he lifted the hold on it |
> | **#147** | a correction becomes a standing rule on **one press**, and never without one. `readCorrection` is deterministic — no model call decides what a correction is, because the expensive direction is offering to make a rule out of an ordinary instruction. **ADR-0030**; `npm run verify:rules` 24/24 |
> | **#124** | density is a control, and **appearance moved to the office** (0400). ADR-0021: a preference about how the work is shown is not the browser's. All four values, not just the new one |
> | **#37** | search can ask the graph — one `related_to` filter that asks `app.relations_of`, so by agent, by contact, by source and by collection are one mechanism |
> | **#130** (part) | the office can pull the tasks out of a document and create them, with one undo for the batch. `tasks_extracted` had been a declared shape with no rows since 0272 |
> | **#131** | the plan Grant approved is the import performed — the stored plan is executed rather than a second model call |
> | **#127** | a model is chosen on what it has actually done, per kind of work. Quality may only DEMOTE, so no demotion can cause a paid call |
> | **#123** | an empty section says so, and the check that says so can now fail |
> | what #147 cost to get right | four latent defects in the press path, every one of them invisible from reading the migration and every one found by DRIVING it: a state word the table forbids, a jsonb assigned to a uuid, a scope the offer accepted and the enum does not have, and three targets stored where the constraint permits one |
>
> ## State as of 2026-09-13
>
> | | |
> |---|---|
> | Tests | **1,007 passing across 61 files** · `verify:ui` **60/60** · `verify:design` 21/21 · `verify:slack` **70/70** · `verify:settings` **37/37** · `verify:layouts` **68 states, 0 findings** · `verify:wired` **64 controls across 21 screens, none dead** · `verify:controls` **289 desktop / 307 phone / 100 team, 0 findings** |
> | The conversation | `npm run verify:conversation-all` — **218 checks in 4m19s**: history 50, echo 13, equivalence 16, transport 19, chat 37, dictation 38, channels 22, access 23 |
> | End-to-end sweep | **570 checks, 431 controls pressed** — `docs/testing/e2e-2026-09-11.md` (#41) |
> | Identity | `verify:identity` **29/29** — project name resolution works, aliases seeded (0179) |
> | Restore | `backup:rehearse` **9/9**; a fresh archive at 0180, 24,822 rows, 71 tables |
> | Free tier | measured, not guessed: **48 MB of 500 MB** database, **41 MB of 1 GB** storage (`public.free_tier_headroom()`) |
> | The conversation's growth | **25.8 messages a day** across four surfaces at ~495 bytes each — about **fifty years** of room at that rate (`public.conversation_growth()`, on the Usage page). ADR-0026 |
> | Office health | 0 real failures in 24h of 121 jobs (`app.office_health`) |
> | Migrations | **353 applied** |
> | Trunk | `main` exists and carries everything — **but the repository default is still `claude/new-session-o2oklu`** (#7, one click, needs Grant) |
> | Current milestone | **M0 — visual prototype.** Not started; assessment and GitHub scaffolding done |
>
> **Waiting on Grant:** the default-branch click (#7) and rotating a leaked
> GitHub PAT (#18). Neither blocks development.
>
> ## VERDICT: GREEN — 2026-09-15. The backend campaign is over.
>
> | | |
> |---|---|
> | **Candidate** | commit `63c5a26`, worker **v391**, **375** migrations |
> | **Model** | `openai/gpt-oss-120b`, with two paid fallbacks and the free tier behind them |
> | **Verdict** | `docs/testing/backend-acceptance-verdict-2026-09-15.md` |
> | **Next phase** | **Grant human beta.** Real usage is now the primary source of findings. |
>
> Four final examinations, each committed unrun against its own freeze, none
> recycled. Three found real systemic defects; the fourth found none and scored
> **17/18**, its one failure an expectation the session itself wrote. Gate
> **19/20**, the single red being #252, a filed stochastic check that fails on
> the pre-#249 baseline too.
>
> **What GREEN does not claim**, all recorded in the verdict and the ledger:
> #242 is open as a caveat rather than a bar; four advertised mutations are
> recognised and argument-extracted but never canonically executed by a suite,
> because executing them would break the standing test rules; a task's due date
> is representable and unextracted (#253); #250 and #252 are harness items.
>
> **Every genuine failure found in beta becomes a permanent regression.** That
> is the whole mechanism now — no further autonomous testing campaign.
>
> ## The office runs on a paid model as of 2026-09-15 (ADR-0029)
>
> Grant funded the OpenRouter account and asked the office off the free tier.
>
> | | |
> |---|---|
> | Model | **`openai/gpt-oss-120b`**, $0.037 / $0.170 per million tokens |
> | Fallbacks | `qwen/qwen3.7-flash` (20), `mistralai/mistral-small-3.2-24b-instruct` (30), free models (100) |
> | Cost | **$0.0082 a day** at the busiest measured real day — about **$0.25/month**. $10 on the account is ~1,200 days |
> | Guards | none removed. §11's four layers now compare against `providers.max_price_prompt`, `max_price_completion` and `max_cost_per_call_usd`, all defaulting to **0** |
> | Verified | one real router request: gpt-oss-120b, $0.00010472, correct on a two-part instruction · one full office turn, 5 calls, $0.000573 · `verify:router` **14/14** |
> | Back to free | `update public.providers set free_only = true, max_price_prompt = 0, max_price_completion = 0, max_cost_per_call_usd = 0 where provider = 'openrouter'` |
>
> **Which model is tried first is now a decision, not alphabetical order** —
> `provider_models.priority`, 0373. That ORDER BY lived in three places and
> changing one of them sent the first real paid request to three free models.
>
> ## Campaign Three — candidate frozen, and now historical
>
> **State: ORANGE, procedurally.** No known backend or intelligence defect
> stands between Grant and daily use. GREEN is withheld only because the final
> unseen corpus has not run.
>
> | | |
> |---|---|
> | **Candidate build** | commit `6de6dfc`, worker **v364**, **372** migrations — `docs/testing/candidate-green-build.md`. **Preserved as the tag `candidate-green-free-v364`; no longer what the office runs** (see above) |
> | **Freeze check** | `git diff 6de6dfc HEAD -- src/ supabase/ migrations/` must be empty |
> | **Final corpus** | `scripts/sessions/hostile.ts`, 18 turns, committed unrun at `4743021` |
> | **Blocked by** | #239 — the day's free model quota; every job fails at the breaker |
>
> The provenance work took two passes and the second is the one to read. There
> are **three** values, not two:
>
> | | needs | example |
> |---|---|---|
> | supported POSITIVE fact | the source read, and the answer in it | "the review is Thursday" |
> | supported ABSENCE | the source read, and nothing in it | "there are no meetings Thursday" |
> | NOT CHECKED | nothing at all | "I have no record of one" |
>
> Collapsing the last two was wrong in both directions at once — *"the diary is
> empty"* passed while the office had never opened it, and *"there is nothing
> in our documents"* was forbidden after a search that ran and found nothing.
> A third permission fell out of the fix: a search is not a census, so a COUNT
> needs a complete source while an absence needs only a consulted one.
>
> New since: `verify:recovers` (17/17, in the gate, needs no model) for the six
> properties that matter to whoever is waiting — no fabricated success, no
> duplicate action, no lost mutation, no stranded work, truthful status,
> coherent state.
>
> **Open and deliberate:** #242 (the constraint acknowledgement is a coin flip
> — the last invariant with only a prompt behind it, and its fix needs live
> validation that was not available before the freeze) and the "suppose" gap (a
> figure Grant floats is his words, so only the prompt separates a supposition
> from a price). Both are probed by the hostile corpus.
>
> ## Campaign Three — the first revocation, kept for the record
>
> **Read this before the numbers below.** A GREEN verdict was posted on #231
> and then **withdrawn the same day**. What had been logged as "an invented
> calendar" turned out, on a proper re-read, to be a systemic provenance defect
> (#243): the office could not distinguish something that had APPEARED in a
> conversation from something it had reason to believe was true. Its own honest
> *"I have nothing on Priya"* became, four turns later, evidence that Priya
> existed.
>
> The architecture is fixed — `src/agents/provenance.ts`, 51 adversarial
> regressions — but under this campaign's standard a fix is not a verdict. A
> completely new corpus, unseen and uninfluential, must be committed BEFORE
> running and run against a frozen implementation. That corpus is
> `scripts/sessions/unseen.ts`, fourteen turns, committed unrun at `0848ddd`,
> which is also the freeze. **It has not been run**, because the day's free
> model quota is gone (#239).
>
> So the verdict is ORANGE on procedure rather than on product, and the
> practical advice is unchanged: beginning human use and UX testing is
> reasonable. Full reasoning in
> `docs/testing/backend-acceptance-verdict-2026-09-15.md`.
>
> **The three things the fix changed**, each independently broken before:
>
> 1. the office's own prose counted as provenance, so a fabrication laundered
>    every repetition of itself;
> 2. a claim about what the records CONTAIN was unrefusable — now checked per
>    SOURCE, so retrieving a document licenses a claim about documents and says
>    nothing about the diary or the inbox;
> 3. the handler had no canonical state at all, so *"what projects do we have
>    open?"* could only be answered from memory. It now gets the live list.
>
> **Two gaps deliberately left, and probed by the unseen corpus:** a figure
> Grant floats in a *"suppose"* is his words and therefore grounded by
> construction, so only the prompt separates a supposition from a price; and
> the record check switches off for a domain that WAS consulted, so one
> retrieved document licenses a total a handful of matches cannot support.
>
> ## Campaign Three — the evidence, 15 September
>
> **Not finished. This is the state mid-campaign, written so it survives a
> compaction.** The tracking issue is #231; the standard it is being measured
> against is `docs/spec/backend-acceptance-2026-09-14.md`.
>
> | | |
> |---|---|
> | Unit tests | **1,190 passing** |
> | Migrations | **372 applied** |
> | Agent x Capability matrix | **96/96 applicable cells proven**, negative control clean (`npm run matrix`) |
> | Coverage dimensions | **37/37 have at least one case** (`npm run breadth`) — `monetisation` was the last empty one |
> | Sessions | **250/250 expectations across 59 turns** on the development corpus |
> | Held-out behavioural corpus | 18 turns in `scripts/sessions/holdout.ts`, committed BEFORE being run. baits 6/6 (3/6 on first contact, under a wording lock), monetisation 3/3, roster 7/9 on first contact |
> | Routing, held out | `verify:routing-heldout` **21/28**, 11/11 checks, unchanged across the campaign's routing changes |
>
> **Product defects found and fixed.** Every one of these reached Grant, or
> would have:
>
> - The office **replaced five facts he had just stated** with figures from an
>   unrelated document. The prompt said "prefer" the documents and ranked
>   nothing above them.
> - Asked about a meeting that never happened it **invented two calendar
>   entries with clock times**, absorbing three earlier honest "I have nothing
>   on that" answers as evidence those things existed. Every coherence gate
>   keys on a claim; this claimed nothing. `fabricatedWhen` now checks times and
>   dates against what the office was actually given.
> - **Teaching it a preference failed silently** — stored correctly, then the
>   confirmation claimed a determinism exemption the record could not support.
>   Fixed at one site by #237 and left at four others.
> - *"That is not what I meant at all"* **replayed the instruction being
>   rejected**, because resolving a contentless message against the thread
>   reconstructs the last one.
> - A **delegation's own content was being read as the message's mood**, which
>   made the reading contested, which capped the roster at one person.
> - The **subject is a property of the clause**, not the message — one answered
>   clause was silencing the semantic reader on every other clause.
> - The **ceiling list was deciding who answers** rather than gating who may be
>   reached, so the announcement copy went to growth and the compliance audit
>   went to research.
> - **Claire was recorded as a convened specialist** on every question that
>   convened nobody, in the column `npm run measure` counts from.
> - A **job that ran out of attempts told Grant nothing** — now an impediment,
>   at all three gates that could swallow an answer.
>
> **Open risks, stated rather than closed:**
>
> - **#239 — one inference provider on a free daily quota.** It ran out
>   mid-campaign; eighteen jobs failed in thirty minutes. `app.office_health()`
>   now reports `cannot_think` (0372) so the outage is visible, but a second
>   provider is a paid dependency and therefore Grant's decision.
> - **#240** — the studio does not yet draw `cannot_think`.
> - **#242** — saying which constraint was set aside is a coin flip: the same
>   build does it on one run and not the next. Every invariant with a
>   MECHANISM behind it held on every run; this one has only a prompt.
> - **#241** — `provider_health` is 40 rows of probe debris and 6 real ones.
>
> `npm run gate` cannot be read while the provider is out or the Supabase
> Management API is throttling: a run during both reported 4/18 in 139 seconds,
> which is fourteen suites failing fast rather than failing. Re-run it clean
> before believing any number from it.
>
> **Sixteen of the nineteen gate checks were run individually after the
> provenance fix and all pass** — schema, wrappers, transitions, attests 11/11,
> knows, reach 9/9, delegation, handoff, cross-interface, identity, tasks,
> history 50/50, transport, security, dryrun, drains. Plus `verify:failures`
> 16/16 and `verify:chaos` 29/29. Only `verify:routing-breadth` and
> `verify:collaborates` need a model and could not run.
>
> **Failure recovery has six distinct modes, each with a passing suite:** a
> provider outage (breaker, `cannot_think`, impediment), a coherence-gate
> refusal (impediment plus retry with the refusal in hand), an output insert
> refusal (impediment), a stalled job (`recover_stalled_jobs` to `retrying`,
> attempts still counting), a delivery failure (bounded retry, Try again,
> `app.undelivered`), and integration isolation (one down, the others working).
> The terminal-failure impediment added today is not theoretical: it **fired
> four times during the real quota outage**.
>
> ## Phase 7 — Communications, finished overnight 13–14 September

**#191's eight children are all closed.** One conversation, every surface.

| | |
|---|---|
| **#196** dictation | A microphone beside Send. Browser transcription (free); the button says *before* you press it that Chrome sends the audio to Google. One dictation is one message (0089's precedent). No addressing by voice — §5 forbids an adapter deciding. The microphone release is **asserted**, not assumed: `verify:dictation`, 38 checks, counts microphones opened against closed. |
| **#205 / #200** arrivals and accessibility | "Emma replied" pinned inside the thread, plus one polite live region — deliberately not `role="log"`, which would announce the "Asking the office" placeholder as an answer. Every message carries author, time, addressee and surface as visually-hidden text. `verify:access` grew to 23 checks: every visible control has a name, one `main` landmark, heading order. |
| **#204** retention | Measured rather than guessed, which is the point. **Nothing needs deleting and most of it could not be** — a job is permanent, so an answer is. The real unboundedness was in the READER: a `coalesce` around a column made `jobs_project_state_idx` unusable and every conversation load read every job in the table. 116ms → 32ms. **ADR-0026.** |
| **#202** transport failures | Bounded retry (five attempts, 30s doubling to fifteen minutes, in `system_config`), a **Try again** in the thread, and `app.undelivered` with a sentence a person can act on. Nothing ever claims a revoke or a delivery it cannot prove. |
| **#198** connection controls | Five honest states per surface — never / quiet / carrying / degraded / **unchecked**. Slack and Telegram can now be disconnected, and the answer names what was **not** revoked as clearly as what stopped. |
| **#197** mobile | The keyboard case, which is where this screen actually failed: composer 208px of 336, thread 51px, newest message hidden. Now 156/168, nav out of the way, thread follows. |
| **#201** proving it | `verify:equivalence` — the same sentence through four surfaces, asserted as **agreement between them** rather than against an expected value. |

**The two problems it appeared to surface were the harness, not the office —
corrected the next morning by 0351.** "Telegram is degraded, 21 undelivered"
was `scripts/poc/gate-3.ts` impersonating Grant as Telegram user 4242 (the
`gate-%` fixture branch never fires, because `enqueue_inbound` puts the channel
prefix in front) plus eight orphaned fault injections that both readers counted
as real because `coalesce(is_fixture, false) = false` over a LEFT join treats
an unattributable row as a genuine one. **Telegram reads `carrying`; there are
zero real failed deliveries.** `verify:transport` now asserts the whole reading
carries no harness traffic, not merely that its own rows are hidden.

**Grant's decision on 13 September, recorded as #70:** Telegram is one bot, the
chief of staff. The other seven are to be retired; individuals are reached in
Slack and in the studio. **Done** — 0352 disables the seven with a stated
reason, points the pager at `chief-of-staff`, and derives `hq_team`'s Telegram
username from the registry rather than a column.

**Also filed:** #207 — a project screen has one heading, so heading navigation
reaches nothing. Found by the new check, filed rather than asserted because the
fix is a design change.

> ## What changed on 2026-09-14 (night)
>
> **Disconnecting Google now revokes the grant AT Google (#109, migration
> 0354).** 0350 did the forget half honestly and could not do more, because
> Postgres makes no HTTP calls. A `google.revoke` job finishes it: 200 means
> revoked, 400 `invalid_token` also means revoked (already dead is still dead),
> anything else is reported as NOT revoked with Google's own words and the
> Connections panel says to do it by hand.
>
> The Issue asked for the local copy to be deleted before the revoke is
> enqueued. That ordering cannot exist — the endpoint takes the token as its
> argument — so the token is **parked** under a name nothing reads.
> `app.vault_secret` gates every read and `googleAccess` asks for
> `google.refresh_token`, which is gone the moment Disconnect is pressed.
>
> ### 🔴 Slack is disconnected and needs Grant — Issue #210
>
> **`verify:disconnect` really disconnected Slack**, deleting the bot token and
> signing secret. The suite called `app.hq_disconnect` outside a transaction
> for six services that were all refusals when the loop was written; 0350 made
> Slack and Telegram real, and the loop kept asserting the old refusal.
>
> Worse than losing Slack: the dangling vault references made
> `app.resolve_secret` raise, so **the worker returned http 500 and no duty
> ran** until the refs were nulled. Slack now degrades alone.
>
> Telegram survived by accident — 0350 deletes `telegram.chief_bot_token` and
> the stored name is `telegram.chief.bot_token`, so that branch has never
> matched a row and reports success anyway. Filed in #210 as a follow-up.
>
> **Grant must reinstall the Slack app** — full steps in #210.
>
> Every `hq_disconnect` call in the suite is wrapped now, refusal or not.
> `verify:disconnect` 30/30, 1,017 tests, worker deployed and draining.

> ## What changed on 2026-09-14 (evening)
>
> **The three Behaviour toggles were never broken (#111).** Including *"Only
> the Chief of Staff messages me"*, the switch behind
> `telegram.only_chief_speaks`. The audit was pressing the settings sheet's own
> **Close** button — it sits in `.chead`, so the collector gathers it first —
> and every control gathered after it still resolved with no box, which
> Playwright reports as `element is not visible`.
>
> Third instance of one shape: `shutDock` (#103) for the dock, `openRail`
> (#183) for the rail, and now `reopenSheet` for the sheet. *A sweep that
> presses every control will press the one that hides the others.*
>
> A second half was missed by #190: it scoped the COLLECTOR to whatever is in
> front and left the LOCATOR searching the whole document by label, so "Team"
> matched the rail's *Call the team* button behind the sheet on six routes.
>
> | | before | after #190 | now |
> |---|---|---|---|
> | settings, desktop | 12 pressed / 93 unpressable | 12 / 3 | **92 / 0** |
> | settings, phone | 12 / 75 | 12 / 3 | **92 / 0** |
>
> **0 findings on every leg**, and the other routes are unchanged: desktop
> studio 289/1, team 101/0 and 97/0, phone project 292/3, phone portfolio 13/1.
>
> No product change was needed. Two false findings were caught before reaching
> Grant: the toggles measure 58x52 in a real touch context (not the 50x29 a
> bare viewport reports), and the report's *"6 inert (12 of those are known
> stubs)"* was printing the allow-list's size rather than the run's.

> ## What changed on 2026-09-14 (later)
>
> **A message that is a list arrives as a list (#209, ADR-0028).** Grant:
> *"if our paragraph should be separated by bullet points, enumerated bullet
> points. So a numbered list, just to keep things easy to read and easy to
> refer to."* The word that matters is **should** — prose stays the default and
> #186 is narrowed, not reversed. Numbered rather than dashes, because
> *"easy to refer to"* means replying "do 2 and 4".
>
> Three system prompts carried the literal instruction `no bullet points` and
> now agree with each other. `src/projects/brief.ts` keeps its ban on purpose:
> a project brief is a document, not a message.
>
> **The larger find: #186's paragraph structure had never rendered on the
> dashboard.** `<p>${esc(m.text)}</p>` puts a whole body in one tag and HTML
> collapses whitespace, so the model was producing paragraphs, Telegram and
> Slack were showing them, and the studio ran every reply together into one
> block for as long as the studio has existed. Three green suites over it.
>
> An all-numbered block is now a real `<ol>` — line breaks alone were tried
> first and the phone capture refuted them, because at 390px the continuation
> of item 1 wrapped into the column item 2 began in.
>
> `verify:chat` **45/45**, up from 37, and the control was run: three of the
> four new checks go red on **both** device legs with the old rendering back.
> Two earlier versions of the fourth check were discarded for passing on the
> phone while the defect was live.

> ## What changed on 2026-09-14
>
> **An agent may not say it looked when it did not (#185, ADR-0027).** The P0.
> Claire told Grant at 03:45 that she had pulled the project records and that
> the database read showed five active projects; none of the five existed, and
> the output row said `evidence: inferred` — the office knew nothing had been
> read and rendered that knowledge as grey caption text underneath the claim.
>
> Two gates now, and they are not the same check. `metadataProblems` refuses
> the combination when the output is CREATED, which is the better place — the
> job fails while somebody can still act on it. `refuseToSend` refuses it again
> inside `combinedNotifier`, because `resumeNotifications` rebuilds an output
> from its stored row and sends it **without passing through creation at all**.
>
> The sending gate is deliberately narrower: it refuses the two things that are
> lies to the reader, and not the judgement pairings, because a guard that
> silences a usable answer at the last moment gets switched off. A refusal
> writes a `job_impediments` row through `app.cannot` rather than dropping the
> output silently — an output that vanishes between `committed` and a channel
> is indistinguishable from a job that had nothing to say.
>
> `evidence: verified` now also needs citations that are ADDRESSES. The first
> implementation was a whitelist of schemes and it refused `db:projects`; a
> whitelist fails whenever the office grows a source it did not have, and it
> fails by refusing to speak. It checks the shape now.
>
> `npm run verify:attests` — **10/10**, with the 03:45 message in it verbatim,
> and two CONTROLs at the end: the identical sentence IS sent when the read
> actually happened. A gate that refused everything would pass the first eight
> checks and look exactly like the rule working.
>
> **`verify:worker` had three unscoped dequeues left after #184.** Reached only
> when the office happens to have work queued, and today it did: the
> concurrency pair claimed a real `drive.watch` job, `runJob` threw
> `NoHandlerError`, and the suite died four sections early with a duty's work
> leased to a fixture worker. *A scope that covers most of a file is not a
> scope.* Now **28/28** on a clean queue.
>
> **The Telegram message stopped introducing itself (#208).** Grant, on a
> screenshot: *"I don't need to see the contact's name and the message. I
> already have it... just see conversation rather than unnamed."* The sender
> line and the trailing project footer are gone, `Unnamed` reads as
> *Conversation*, and the provenance line only appears when it attests
> something — which keeps #185's protection rather than deleting it.
>
> **Telegram is one bot (#70).** Seven staff bots disabled with a stated
> reason; the pager is Claire's.

> ## What changed on 2026-09-13
>
> **Slack stopped sounding like a database (#186).** Grant sent three
> screenshots of his own workspace: *"how much space is being taken up... It's
> really not intuitive or acting like it's a human... you'd really need to work
> on it looking a lot better, making it obvious what things are related."* Four
> defects, all found by reading his real traffic rather than the source:
>
> - a routine read wore a finding's clothes — *"Looked at 1 Drive folder.
>   Nothing new."* carried a confidence caption and a row of feedback buttons,
>   270 times in ten days. A deterministic output now carries neither, and the
>   rule is about honesty rather than space: a message says how much to trust it
>   exactly when there is something to decide;
> - nothing was related to anything — thirty-one real questions in
>   `#ai_team_hq_test` with not one reply attached. An answer now threads under
>   the message that asked, and is broadcast so threading does not take it off
>   the channel;
> - harness traffic was on the floor channel (*"Filed under zz test slack
>   80106050"*);
> - and the floor said *"the a question is about evidence"*, because the
>   vocabulary substitution was translating four §6 class names that are already
>   English words.
>
> **Project Settings exists (#36, ADR-0023).** The last unbuilt child of #25,
> four panes at `Settings` in every project's rail:
>
> - **Team** — who works here, and what each is told here. Absence means
>   everyone; the table records departures from that default, and the Chief of
>   Staff cannot be taken off. It takes effect in `pickRoster`.
> - **Automations** — a standing instruction, addressed to one of the team, on a
>   schedule, created and paused and removed entirely in the UI. No new table:
>   `responsibilities` is the automation table and had never had a writer.
> - **Labels** — the contact labels, editable in the same place as in Contacts.
> - **Project** — export the whole project as §13's neutral package, and archive
>   it reversibly.
>
> Migrations 0323–0328. Everything is reachable over HTTP and
> `verify:settings` drives that chain including the browser layer.
>
> **Phase 7 has started: #192 is built (0334–0337, ADR-0025).**
> `app.conversation_history(project_id, limit, before)` returns one project's
> conversation, both sides, in order, whatever surface each message arrived on,
> at `hq-api?section=conversation&id=<project>`. `verify:history` drives the
> whole chain including HTTP, 24/24.
>
> **There is no conversations table**, and that is the decision to argue with
> rather than discover. `public.relations` is six migrations back in CLAUDE.md's
> trap list — the edge table that never held a row while six columns held the
> same facts — so the history is DERIVED from `inbound_commands` and `outputs`.
> The one fact no column expressed was `inbound_commands.project_id`: 57 of 251
> commands have no job at all, so a fifth of everything Grant has said could not
> be attributed anywhere. ADR-0025 names the signal that would make a
> conversations table earn its place: a requirement for more than one thread per
> project, not a feeling that the model looks thin.
>
> Adding one fact took three migrations and two of them were defects caught by
> the suite. 0336: `enqueue_inbound` resolves the job's project separately, so
> one exchange could split across two conversations. 0337: it then had to READ
> the column, which 0335 and 0336 had left write-only — 0298's `web.search` with
> the sign flipped, and the studio sending from a project page would have been
> misfiled from the day it shipped. Found by printing where the job actually
> landed; the earlier check asserted only that command and job AGREED and passed
> while both pointed at the wrong project. **Agreement is not correctness.**
>
> 0334 also creates the reserved **Unnamed** project (ADR-0024) and the
> protection it needed: `projects.reserved_reason`, and `project_delete` refuses
> a row carrying one. It is not `is_fixture` and is deliberately not named
> anything beginning `untitled`, because `check:leaks` sweeps
> `untitled-notebook-%`.
>
> **Also found, and corrected in the plan:** most of #195 already exists.
> `inbound_commands.dedupe_key` is NOT NULL, UNIQUE and shaped
> `<surface>:<kind>:<id>`; `deliveries.dedupe_key` is unique too and
> `deliveries.message_ref` already holds the external id of everything the
> office has sent. What is genuinely left there is loop prevention, not identity
> or dedup.
>
> **Phase 7 — the rest is planned, not started (#191).** Grant's
> 13 September brief said GitHub is the durable memory and nothing important
> may live only in a conversation. The brief is stored verbatim at
> `docs/spec/github-persistence-brief-2026-09-13.md` and its twenty-six
> requirement topics are now eleven Issues under **#191**, with a Prompt
> Persistence Audit mapping every topic to its home.
>
> The inspection pass found more substrate than the topic list implies —
> `inbound_commands` (0011) has every message he has ever sent, `slack_channel_map`
> (0014) holds project-to-channel in Postgres rather than a channel topic, 0198
> already reads both sides back for recall, and 0102 puts voice through the same
> canonical layer. **The gap that decides everything else: there is no
> `conversations` table and no `messages` table.** His side is in
> `inbound_commands`, the office's in `outputs`/`deliveries`, and nothing joins
> them into one ordered history. #192 is that model, and #195 (message identity,
> deduplication, loop prevention) has to be right before any second surface is
> connected — otherwise the office echoes itself.
>
> **Three decisions answered on the day, in ADR-0024.** Only the Chief of Staff
> posts unprompted in a project's Slack channel, but Grant may address any
> individual and gets that person's reply — a stored preference, not a
> constant, because *"for now"* is load-bearing in how he said it. A Telegram
> message naming no project lands in a reserved catch-all dashboard project
> rather than a nullable `project_id`. And Slack sync is convergent: two
> windows onto one history, never a mirror.
>
> Two of those have traps written into the ADR because they will otherwise be
> got wrong. Applying the Slack voice rule uniformly suppresses the reply Grant
> asked for **and looks exactly like the rule working**. And the catch-all
> project will be swept — `check:leaks` already matches `untitled-notebook-%`,
> so despite his phrasing it must not be named anything beginning `untitled`,
> and there is no protection column on `projects` today.
>
> Two things worth knowing before picking this up. First, **the brief contains
> the topic list and not the specification behind it** — no acceptance criteria,
> no wireframes. Each Issue states what it inferred and where a different
> reading would build differently; several would go materially wrong on a
> plausible alternative. Second, accessibility (#200) is a genuine hole: ninety-four
> open Issues and not one about it, beyond the contrast and type-size checks in
> `verify:layouts`.
>
> **The space-usage critique pass, and a tool that answers its question
> (#85).** The Issue asks for measurement rather than squinting, and it was
> right to: three of four findings read off the capture were **wrong** — the
> rail is 880 of 900px used, the #108 fade is on at `opacity: 1` on every
> clipped panel, and the phone's "clipped" title has 20px of clearance at
> `scrollTop: 0` (it is the capture's own scroll). Two survived.
>
> A panel header was **53px of a 300px panel for a 16px label**, because 28px
> of it was the resize controls — which are `opacity: 0` until hover. #67's
> trap in a second place. Absolutely positioned now: **53px → 33px**, 120px of
> content back on one Overview screen, and Documents and Lately stopped
> clipping at all.
>
> On a 390×844 phone the first pixel of project content was **703px down —
> 83% of the first screen furniture**, and 51px of that was a sentence telling
> you to drag panels on a viewport where `.panel { position: static }` and the
> drag is deliberately switched off. Hidden there: **703px → 632px**.
>
> `npm run space` is the new tool. It reports only — no thresholds — and prints
> each panel's header share, whether the fade is actually on per panel, how
> much of each container is empty, and how far down the first content pixel is
> with everything above it named. `probe` answers "how big is this box";
> `space` answers "which of forty boxes is spending the room".
>
> Still open and deliberately not touched: the phone is 75% furniture on its
> first screen, `.projhead` being 135px of it. That is a compositional fix (a
> collapsing head, or the crew and toggle moving into the sticky bar), not a
> padding edit, and shrinking the parts individually is the densification the
> Issue warns against.
>
> **Two suites no longer need the whole queue to themselves (#184, ADR in
> 0329–30).** `verify:slack` and `verify:worker` both refused to start while
> any job was live anywhere, because dequeue is global — so in a full pass
> whichever ran second failed on the first one's debris, as "22/26" rather than
> as "the queue was dirty". `dequeue_job` gained `p_requested_by`, which
> narrows both the claim and the capacity question to one scope. Both
> directions now pass back to back with no purge between them.
>
> **The control audit had been blind to half the product, and the recorded
> explanation was the wrong one (#183).** 91 of 182 desktop controls
> unpressable, the same thirteen every route, the entire left rail — while the
> phone leg skipped two. The cause is one press: the sweep presses the chevron
> that collapses the sidebar, the studio REMEMBERS that in `localStorage`, and
> every rail control after it is behind `main`. The buttons still resolve,
> because a collapsed rail clips them rather than removing them, which is why
> it read as an actionability mystery. Found by keeping the actionability log
> that `catch {}` had been discarding — two reasonable fixes tried before that
> (force-clicking, a taller viewport) changed nothing and were reverted.
> **13 unpressable → 0** on the first route measured.
>
> **Three audits were looking somewhere other than where Grant looks.**
> `verify:layouts` ran without a token, so it had never measured a single
> writer control — given one it found sixteen touch targets under 44px and a
> 13px input, all years old. `verify:wired` read a hardcoded list of nineteen
> filenames, so the twentieth module was uncovered by construction; it walks the
> directory now. And `verify:controls` wrote its report to a path built from its
> own route filter, so a run filtered by a route containing a slash lost
> everything it found.
>
> **One frontend, and it is the designed one.** `ai-team-hq.vercel.app` serves
> `web/studio`; `web/hq/index.html` is deleted (ADR-0019, #68). Every write
> action, all six operational sections and the voice call moved across, and the
> suites moved with them — `verify:ui` walks nineteen studio screens at three
> sizes, and `verify:design` fails if a second frontend ever reappears.
>
> **The office now learns, notices and can be taught.** `app.notice()` finds
> what nobody asked about — an unowned deadline, a quiet project, a source that
> gave nothing, a limitation that recurred — and a dismissal buys a fortnight of
> silence per dismissal rather than lowering a score. It feeds the morning
> briefing's recommendations, which arrive daily at 07:00 Athens. And skills are
> data: Grant can tell the office a procedure in a Telegram message and it goes
> in front of the relevant work from the next job on, visible and retirable on
> each person's card. **A skill may name a tool and may never name an address**
> (ADR-0017) — that one rule is what makes a procedure safe to let an agent
> write, and `app.staff_may_use()` reads neither skills nor lessons, asserted
> behaviourally and structurally.
>
> **Overnight, 11–12 September.** Twenty-seven of the thirty UX-review items
> are closed, plus #11 and #24 which turned out to be blockers. Google Calendar
> sync is built and **switched off** — turn it on at Settings → Behaviour →
> *"Put dated tasks in my Google Calendar"*. Everything else is live.
>
> The last five of that night: **#103** the dock — a fixed column that keeps a
> conversation with the team open while you move around, reaching `/voice/turn`
> like the call does · **#81** dashboard arrangements now live in Supabase
> rather than `localStorage`, which is **ADR-0021** and the rule for everything
> customisable after it · **#90** Disconnect works for Notion and NotebookLM as
> well as Google, refuses honestly where there is no safe disconnect, and says
> where to revoke at the provider because Postgres cannot · **#108** dashboard
> panels stopped clipping their own content mid-word · **#107** a contact shows
> the labels its role already names, so no chip reads zero beside somebody who
> plainly belongs in it.
>
> Two things to know before reading further:
>
> - **`calendar.sync_tasks` is false on purpose.** It works end to end,
>   verified with one controlled round trip against the real diary. A task that
>   becomes done has its event **deleted** without asking — only ever events
>   carrying our own task id (ADR-0020). That is the one decision worth your
>   eye before you flip it.
> - **`public.tasks` had zero rows and no way to make one**, which is why #11
>   got built ahead of the calendar. A calendar sync over an empty task table
>   would have been #72 exactly.
>
> **Grant's UX review of the studio is filed as #75 and half-built.** Thirty
> items, persisted verbatim at `docs/spec/ux-review-2026-09-11.md` and filed as
> #76–#105. Fourteen are closed: the navigation is his shape now (picker top
> left, sections in the sidebar, Lately and Settings at the bottom, no status
> strip, no Desk, the rail collapses to nothing), the covers are 64px marks
> rather than slabs, light and dark is a real three-state setting, and the
> connect buttons connect.
>
> Two of them were worse than described. **#102 was not "off does not work"**:
> closing the call sheet threw away the only reference to a live microphone,
> so nothing could ever stop it and reopening started a second. **#87 could
> not have been fixed as written**: there was no dark-mode setting to fix —
> every palette's dark tokens lived only inside `prefers-color-scheme`.
>
> **Six new checks, each written because something passed while broken.**
> `check:templates` parses every `web/**/*.js` as a module and refuses a
> backtick in an HTML comment. `verify:wired` fails on a control no source
> file looks up. `verify:talk` now counts live audio tracks across every
> stream the stub handed out, including ones the page has forgotten.
> `verify:layouts` fails when a box hides content and gives the eye neither a
> real scrollbar gutter nor a marker — the third clipping-class defect a green
> suite had missed. `verify:arrangement` asserts what LEAVES the page, because
> a layout saved only to `localStorage` drags, snaps, survives a reload and
> captures perfectly, and is wrong only on the second device. And
> `verify:disconnect` checks a destructive action **without being
> destructive**: every SQL assertion runs inside `begin … rollback`, the page's
> own payload is read back inside the transaction, and it then re-asserts that
> the real credentials are still there.
>
> **Each of the three new suites was proved by putting its bug back.**
> `verify:layouts` reported 2192px of Documents hidden with nothing to say so;
> `verify:arrangement` went to 1/6; and `verify:disconnect` needs no such
> demonstration because it deletes a real credential and rolls it back on
> every run.
>
> **The backlog is current as of 11 September.** Every issue verified complete
> was closed with the evidence in a comment rather than a tick — #9, #48, #52,
> #53, #55, #56, #57, #58, #59, #61, #62, #66, #68. **#50 stays open on
> purpose**: six of its seven boxes are ticked and the last one — a real
> capability acquired end to end without a coding session — needs the office to
> ask for a tool it does not have and be granted it. Five findings from that
> day's work that were in nobody's Issue are now filed: Claire is the only
> agent with no bot of her own and the only one permitted to speak to Grant
> (#70) · modules are in the canonical IA with no table behind them (#71) ·
> *build the mechanism, forget the mouth*, five instances in one session, which
> wants a check rather than another note (#72) · the backtick-in-a-template
> -literal trap fired five times in a day despite being documented (#73) ·
> `verify:controls` audits the studio without a token, so it cannot see a
> single write control (#74).
>
> **Recently landed:** the frontend build prompt persisted to
> `docs/spec/` · integration assessment · GitHub as the operational record
> (19 labels, 5 milestones, templates, 14 Issues) · the Notion document
> duplication fixed at the root (#8) · phone notifications (`npm run notify`) ·
> the build diary (`npm run step`, visible at *What Claude is building*).

# Start here

**For the next session, human or otherwise.** This replaces every earlier
handoff; the dated ones remain as history and you do not need them.

**Branch:** `claude/phase-7-communications-kh8ow8` — everything committed and
pushed. **Written:** 2026-09-05, revised 2026-09-09.

**Starting a new session or a new environment?** Read
[`new-environment.md`](new-environment.md) first — it is four commands and the
two variables an environment needs, so the first thousand tokens go into work
rather than rediscovery.

---

## 4 October 2026 (run 2, last stretch) - production frozen, local and replica work only

**Read `docs/ops/deployment-queue-2026-10-04.md` first: it is the authority for what is waiting and the order to do it in.**
Nothing from this stretch is applied or deployed. Supabase read UNHEALTHY at 17:28 and 18:20 UTC; production interaction is
suspended (no migrations, deploys, production suites or model calls) until Grant asks or there is concrete evidence of recovery.
Written and NOT applied: migrations 0892, 0893, 0894.

Done here, each with a red-then-green control: the PDF reader undoes chained text filters (four real ReportLab files were
called scans; `verify:file-text-corpus`); a DOCX from a real producer over 50,000 characters (`verify:file-text-docx`); an
explicitly named secondary project read at its end of document with a same-name foreign-office control (`chunks.ts`);
whitespace-only passages (0894); the envelope retry ceiling as a pure tested decision and a larger golden corpus (#412);
Slack adversarial edges 26/26 on the replica; the phone header keeps more of the name at 320px and its regression adds a long
name and the portfolio; a double-tap on a dialog's Confirm no longer reaches the control underneath (`verify:dialogs`);
`check:tokens` stops crying wolf and joins `gate:safe`; `check:secrets` is green again (it had been red on made-up Slack
fixtures). Full unit suite: 297 files, 4,462 tests.

**A decision for Grant, not changed:** detaching a source keeps its documents and so their passages (ADR-0013). If it should
withdraw them from answers, that reverses the ADR.

Still manual: voice note and Talk to Team on a real iPhone, the Telegram pairing tap, a real Slack install (after the Slack app
settings in the queue file), `npm run backup:rehearse`, and a Supabase support request for `log_temp_files = 10240` for 24 hours.

---

## 4 October 2026 (run 2, later) - Slack self-service built (receiving half), phone header, native dialogs gone, platform down

**State at the end of this stretch:** branch `claude/multi-user-p4`; migrations applied through **0891** (761); **0892 is
committed and NOT applied** (and 0893 likewise); the **Supabase platform has been UNHEALTHY for over two hours** (see
`docs/ops/supabase-efficiency-2026-10-04.md`, run 2 addendum), so nothing below marked "not deployed" could be.

* **#414:** `verify:run3-live`, `verify:drains`, `verify:dryrun`, `verify:proposes` are `sample` class in `gate:safe --part=ops`
  (8/8, Grant and every other office unchanged); `verify:drains` and `verify:backups` had been RED unnoticed (injected jobs with
  no office; a stale-rehearsal premise) and are repaired. A real finding: the last passing restore rehearsal is 21 September.
* **Slack self-service (ADR-0065):** the ownership level is DECIDED (a workspace belongs to one office; the installer is its
  first admitted sender) and the **receiving half is built**: migrations 0891-0892, `src/slack/oauth.ts` and the `slack-oauth`
  edge function, the gateway actions `slack_link_begin` / `slack_link_disconnect` and section `slack_link`, the Settings card.
  The **sending half is built too** (`src/slack/installs.ts`, wired into `pass.ts`): a connected workspace is answered with its
  OWN token, an office with no install by nothing, never the operator's token. Proofs: `verify:slack-link` (DB, 25/25,
  production, rolled back), `scripts/isolated/slack-oauth.ts` (the REAL callback against the replica with a Slack transport
  double, 22/22, sabotage red then green), **`scripts/isolated/slack-send.ts` (the REAL door and the REAL Slack channel against the
  replica, 18/18: both people admitted as their own offices, crossed identities refused, each answer carries its own token,
  sabotage red then green, and a control showing the defect below)**, `tests/slack/oauth.test.ts` (15) and
  `tests/slack/installs.test.ts` (9, sabotage red then green), `verify:slack-card` (the card in every state and both presses,
  local, red then green). **A defect the end-to-end proof found:** events from a connected personal workspace would have been
  ignored (the door only knew the deployment's credentials row); migration **0893** fixes it and makes "can receive" ask the
  door's own predicate. `deploy:worker` sets `slack.per_office_delivery` only after its probe passes, so the card says answers
  appear in Team HQ until the worker that answers in Slack is live.
  **EXTERNAL, only Grant can do:** open the Slack app to other workspaces (Manage Distribution), add the redirect URL
  `https://<ref>.supabase.co/functions/v1/slack-oauth`, and set `system_config` `slack.client_id` (public). Until then the card
  says "Not available yet" and offers no button. **A real install has never been run: REAL SLACK INSTALL - MANUAL ACCEPTANCE
  REQUIRED.**
* **P5:** `sure()` is async and every destructive control (12 sites) asks in the page's own dialog, 44px on touch; both native
  alerts are `noticeDialog`; the unused `window.prompt` helper is removed. `verify:dialogs` (local, 29 checks) and
  `tests/web/no-native-dialogs.test.ts`. The phone header now keeps the project's name (Attention and Sign out are 44px icons
  under 480px): `verify:phone-header` (local; the name was 0px at 320 and 28px at 360 before, 52 and 92 after). Live
  `sample:confirm-ux` passed 20/20 before the outage; the header fix is **not deployed** to the page.
* **To do when the platform recovers:** see the ordered list in the ops note. Deploy the page last.

## 4 October 2026 (run 2) - answer envelope on for the Sample, documents read in passages (#412, #419)

* **#412:** `answerEnvelope` is wired into the answering call for offices listed in `system_config` `answers.envelope_offices`
  (0887; the Sample only). Fallback models measured (`docs/testing/answer-envelope-canary.md`): qwen 10/12 (the misses were the
  reasoning budget), mistral 11/12 (one unclosed tag, failed over). A turn stops after 4 recorded envelope misses. PROVEN FOR
  SAMPLE; widening is one edit of that row and needs evidence on the fallback models in real, long prompts first.
* **#419:** `public.document_chunks` (0888-0890) holds ordered, overlapping passages of `documents.content`, written by a trigger on
  `documents` through `app.index_document_chunks`; retrieval shows the best two passages per document with "part N of M" in the
  header, and falls back to the head when none was cut. `src/text/file-text.ts` reads text, Markdown, HTML, DOCX and text PDFs at
  upload and says "not searchable" plus why for a scan. Proofs: `scripts/isolated/chunks.ts` (a fact at the END of a 134,000
  character document, foreign office and project canaries, re-index, archive, delete, sabotage controls), `sample:documents`
  (the DEPLOYED gateway). `npm run deploy:hq-api` deploys the gateway alone and uploads `file-text.ts` beside it.
* Drive files that arrive as bytes (PDF, Word) are read through `fileText` before they are recorded (`handlers/drive-read.ts`,
  unit-tested with a red-on-sabotage control; NOT yet driven against a real Drive file).
* Not done: OCR (an image-only PDF stays unsearchable by design), a retention sweep of stale passages beyond the one
  generation kept, NotebookLM sources that arrive as bytes.

## 3 October 2026 (closure) - office-owned tool requests, guard at the executor, Reconnect Google

`approve_tool`, `decline_tool`, `revoke_tool` are office-owned (no longer operator-only); `staff_tool_set` and everything
deployment-wide stay operator-only. Proof: `npm run verify:sample-tool-requests` (24/24, cross-office negatives) and
`tests/gateway/office-owned-tool-requests.test.ts`. The production-heavy guard is enforced in `ManagementApiExecutor.execute`
(`src/db/suite-guard.ts`); `npm run suite --production`, the gate and e2e state intent. Settings: the health row no longer says
"Everything that is connected is working" when nothing is; Direct upload says it is always available; an expired Google reads
"Reconnect Google" with a plain explanation (`npm run verify:google-reconnect`, local). `verify:ui` (54/54, reads the Sample's office,
class smoke) and `verify:keyboard` (32/32) were stale tests and are repaired. hq-api v861, page deployment `dpl_HAPFk8DoTrBKtrRTgQnL6TsbsB7k`
(rollback `dpl_4rCCYcZaE455QaiHopaVxc1iADeY`). The Open-for-Grant items in the entry below are closed.

## 3 October 2026 (later) - Sample Person, Settings deployed, #404/#405 closed, #407 fixed

The Sample Person (the P4 second person, Jordan Reyes / Brightside Café) is the authenticated test environment: `docs/multi-user/SAMPLE-PERSON.md`.
`npm run sample:seed|reset|status`, `npm run verify:sample-settings -- --grant` (55/55), `npm run sample:shots -- <label>`.
Settings page deployed (rollback `dpl_2PMxKBBcbv6UMZ4fU1YUnstbNs9z`), hq-api v858 (`viewer.operator`), worker v931 (#407). #404 and #405
closed. Which suites may run where: `docs/testing/SUITE-CLASSES.md`, `npm run suite`. Supabase: `docs/multi-user/SUPABASE-DEGRADATION-2026-10.md`
(no upgrade; read the dashboard CPU/IO for the incident windows first). Open for Grant: whether a person may answer their own office's tool requests;
`verify:ui` is broken since P3 (calls `app.hq_studio_settings()` with no office); `verify:keyboard` has five unrelated failures. Record: P4 acceptance §22.

## 3 October 2026 - Global Settings redesigned (page only, not deployed)

New information architecture (4 groups, 9 sections), its own design layer (`web/studio/settings-ui.css`, `settings-ui.js`,
`settings-copy.js`), real Accent colour control, in-page confirm dialogs, shell made `inert` behind the page. Audit and
reasoning: `docs/ux/global-settings-audit-2026-10-03.md`. Checks: `npx tsx scripts/p5/settings-shots.ts <label>` (captures at
four widths) and `npx tsx scripts/p5/settings-qa.ts` (sizes, contrast, names, Basecamp, accent persistence, keyboard) - both
local, neither touches the office. `verify:wired`, `smoke`, lint, typecheck, `npm test`, check:templates/branding/secrets
green. Still pointing at the old DOM: `verify:studio`, `layouts`, `controls`, `keyboard`, `system`. No policy, RPC or
authorisation changed. Not deployed; nothing run against production.

---

## 30 September 2026 - final audit reconciliation

Verdict **AUDIT PARTIAL - 82 findings remain** (`docs/final-audit/FINAL-RECONCILIATION.md`, ADR-0057). Migrations 0627-0632
applied; worker, slack-events deployed; final-audit-live 35/35 and every historical live suite green; `check:leaks` and
`check:callers` exit 0. Open: the listed rows, residual review items A4/A5/A7/B2, and Grant's decisions (a)(b)(c) and #389.

## Read these four, in this order

1. **[`known-problems.md`](known-problems.md)** — everything currently wrong.
   Start here, not with the code.
2. **[`adr/0013`](adr/0013-the-project-is-the-source-of-truth.md)** — the
   decision that settles the knowledge layer. The project is the source of
   truth; NotebookLM, Notion and uploads are connectors to it. Read it before
   touching `documents`, and do not revive the NotebookLM sync.
3. **[`../AI_TEAM_HQ_MASTER_SPEC.md`](../AI_TEAM_HQ_MASTER_SPEC.md)** — canonical,
   supersedes everything.
4. **[`defects-fixed.md`](defects-fixed.md)** — every defect found and closed,
   and the one shape of mistake that keeps arriving in a new costume.
   [`test-evidence/`](test-evidence/) has the long-form accounts. The seven
   habits at the end of [`new-environment.md`](new-environment.md) are the
   distillation; read those even if you skip the list.

Then run `npm run inventory` before trusting any credential.

---

## Where it stands

**Revised 2026-09-09.**

| Phase | |
|---|---|
| 0–6 | ✅ complete |
| 7 · communications | ✅ complete. All eight bots exist, answer, wear their own face, and write in a voice a person would use |
| 8 · Team HQ | ✅ deployed and redesigned — grouped menus, plain English, and a real voice call on the Talk page |
| 9 · Google ecosystem | ✅ Calendar, Gmail, Drive and YouTube connected per-service; calendar and mail have readers and refresh hourly |
| · knowledge layer | ✅ ADR-0013 built. Notebook reads AND writes now run over HTTPS with no subprocess (0138, 0140); Notion has a duty as of 0146 |
| 10 · hardening | ✅ §18 covered including case 7; both §22 scenarios harnessed and passing; backup taken nightly and restore rehearsed |
| · the office acting | ✅ an instruction becomes work, is said back before it runs, and every generation is gated on Grant |
| · MCP | ✅ read and write, with OAuth for ChatGPT's developer mode |
| · recurring duties | ✅ seven live: capacity report, calendar, mail, discovery, Notion, Slack token rotation, nightly backup. One left disabled — `vault-export`, which needs Grant |

304 migrations · 976 unit tests · ~67 live suites, all green.

**The Governance page shipped with harness debris on it, and it is fixed
(0303-0304).** An hour after #54 went live, a status sweep found Ruby's card
reading *"probe-need-j4je9xrc — the office has no such tool — 8x"*: five rows of
`verify:proposes` debris on the surface built to make the office legible, which
is the exact trap `jobs.is_fixture` exists to prevent. `app.office_health()` was
separately reporting fourteen stalled research jobs from the same crashed run.

The cause is worth keeping: `job_impediments.is_fixture` is a copy taken from
the job by trigger at insert, and §6 then refuses UPDATE — so once the job's
attribution was corrected, the copy stayed wrong for ever. The tally now asks
the job as well, whose `is_fixture` is generated and always current. The first
attempt used `coalesce` (job first, copy as fallback) and put two rows BACK on
the page, because their copy said fixture and their job said real; the rule is
that **either witness may exclude and neither may include**, so it is `or`
(0304). Nothing was deleted — all 105 impediment rows are still on the ledger,
41 of them visible through `p_include_fixtures`, and none counted as work.
`verify:governs` is 24 checks now: one asserts no name on the page matches a
probe pattern, and one asserts the two-witness rule directly.

**Grant can see what the office learned, and change it (#54, migration 0302).**
The last child of #46, and the one that makes the rest of that epic safe rather
than unnerving: with #48 landing, behaviour changes for reasons that live in a
table, and a table nobody surfaced removes his ability to tell a system that is
getting better from one that is drifting. A **Governance** tab now sits beside
Behaviour in the settings sheet — a sibling rather than part of it, because
Behaviour is eight switches and this is four lists, and folding them together
makes both harder to use. It answers four questions from one call,
`app.hq_governance`:

- **what it learned** — every live lesson as a quotation, with its scope, the
  project or person it applies to, who learned it, and the job it came from.
  `app.retract_lesson` writes a RETRACTION row that supersedes it: `lessons` is
  append-only, so nothing is deleted, the reason is recorded next to it, and
  "why did it change" stays answerable. Retracting twice is a no-op; retracting
  a retraction is refused by name.
- **what it wants** — open proposals first, then anything settled in the last
  thirty days, each approvable or declinable in place with the argument and the
  cost on it. **The decline is the durable half**: `proposals_one_per_need`
  means the same need cannot be raised again while the row stands, which is
  what stops a boundary becoming a nag. Reopening is allowed and is always a
  person's decision.
- **what it noticed** — suggestions with their outcome and their dismissal
  count, because a thing offered four times and dismissed four times is the
  office failing to take a hint. `suggestions.because` is JSONB — the numbers
  the noticing pass counted, not a sentence — so it renders as counted facts.
- **what each of them can do** — remit, tool count, and the list of walls hit
  in ninety days from `app.impediments_tally`. #54 calls that last list the
  most useful thing on the page and it is right.

`verify:governs` is 22 checks, and it tears itself down through the feature
under test: the lesson it writes is retracted, which is the only removal an
append-only ledger allows, and the assertion that the payload no longer carries
it is the same assertion that proves the teardown worked.

**Three audits were pointed somewhere new and found five things.** #54's
acceptance says it must pass `verify:ui`, `verify:layouts` and
`verify:controls` — and `verify:layouts` had never opened the settings sheet at
all, which is the "a verification that looks somewhere other than where the
user looks" trap in its purest form. Extending it to `settings/governance`
(52 states now, from 38) immediately found: `--ink-3` failing WCAG AA at 12px
on five palettes; the settings sheet hiding 2,857px on a phone behind an
overlay scrollbar with no affordance at all — #108's defect, still live, on
every settings tab; and a false red of its own, because the studio scales the
shell to 0.994 behind an open sheet and a 44px button therefore measures 43.74.
The first two are fixed, the third is fixed in the audit. `verify:ui` now feeds
the governance pane real rows at all three sizes, and `verify:wired` walks
seventeen screens rather than sixteen. `verify:hq`'s tool control was also
repaired: it asserted that `web.search` could be revoked and re-granted, and
0298 had switched `web.search` off — a control that must fail on a change that
was correct.

**Every connector says what it can do, and what we never ask it for (#51,
migrations 0300-0301).** `knowledge_connectors.notes` was prose written for a
person; an agent cannot ask prose whether it can recover an audio overview.
`public.connector_capabilities` is one row per verb — 24 across six connectors —
with `reach` (`api` / `unofficial` / `browser_only` / `none`), what it costs,
what in the office uses it, and `verified_by` saying whether that is known from
a probe, a suite, or merely declared. The negatives are in it deliberately, as
#51 asks: Notion has no teamspace on any version, Drive is read-only by scope,
GitHub write is disabled at risk 3. `app.unused_capabilities()` is the gap as a
QUERY rather than an opinion — today it returns exactly one honest row, that the
office can create a note in a notebook and never does — and `capability_index`
carries it as `could` so it reaches the prompt. Only the gap, not the whole
sheet: 24 verbs on every prompt would cost more than they are worth.
`verify:sheets` (14 checks) proves the NotebookLM rows claiming a probe are
backed by the actual probe output, and that a verb moves in and out of the gap
when the office stops and starts using it.

**The office gained a capability without a coding session (#50, migrations
0298-0299).** The epic's own acceptance box, done rather than simulated: Emma
authored *"Research a topic with the reach we already have"* through
`app.teach_skill` — no migration, no deploy, no handler — and it comes back from
`app.skills_for` on her next job with `missing: []`, because it was written
against reach she actually holds. Found on the way: **`tool_permissions` listed
`web.search`, level 0, ENABLED, and nothing implements it** — so every agent's
sheet told it that it could search the web. That is #64 with the sign reversed,
and reversed is worse: being told no about something possible costs a feature
request, being told yes about something impossible costs the work, silently.
0298 adds `delivered_by`, fills it for all fifteen real tools, disables
`web.search` with the reason (disabled and NOT deleted — a listed gap can become
a proposal, a deleted one cannot), and adds a constraint so an enabled tool must
name what performs it. `npm run verify:acquire` (11 checks) proves the whole
chain including the half that makes it safe: authoring a skill that names
`web.search` and `spend.money` changes nothing about what the agent holds, and
`staff_may_use` still refuses.

**The office says what it understood, and asks for what it needs (#47, #49,
migrations 0295-0297).** `jobs.understood_as` is the agent's own one-sentence
reading, written BEFORE acting and write-once — a wrong reading is invisible
until it is written down, because an output built on a misreading looks like a
perfectly good output. `public.proposals` is #49's core object: a ROW, not a
message, because a message cannot be declined, only ignored and sent again on
Thursday. One row per (agent, kind, need) FOR EVER — the unique index IS the
durable decline — with a remedy, an argument carrying the count, and a state.
`app.raise_proposals` reads `impediments_tally`, so noticing costs a SQL query
rather than a model call per job, which #49 requires; a declined proposal is not
reopened, not re-counted and not re-delivered. Claire batches through
`app.proposals_to_send` and stamps `delivered_at`, so nobody else speaks and
nothing sends twice. `npm run verify:proposes` (19 checks) drives four identical
failures, asserts ONE proposal with a count of four, declines it, drives four
more and asserts silence. 0297 exists because the suite could not tear itself
down: `job_impediments` is append-only by §6, so the subjects had to become
fixtures — permanent but excluded from every real tally — and `raise_proposals`
gained the `p_include_fixtures` parameter its own tally already had. Five
proposals raised from older harness debris were **declined**, not deleted: the
ledger is append-only and declining is the mechanism for permanent silence.

**An agent knows what it can do (#64, `verify:knows`).** Claire told Grant *"I
cannot add interactive Telegram buttons; I only generate plain text"* — false
when she said it, and he went and asked for a feature he already had. The two
mechanisms (`capabilityBrief` in the prompt, `contradictsReality` as the net
under it) were already built; the proof was not, and the third box was open.
The suite asserts his exact sentence is caught, six other wordings of the same
claim, and — the half that decides whether the guard survives — six TRUE
sentences it must not fire on, because a net that catches honest answers gets
loosened and the bug comes back. `notebook_capability` reported three read
capabilities while `act.py` creates notebooks and generates audio, so the probe
now also reports what the adapter OFFERS, checked by asking the client whether
the method exists rather than by creating a notebook on every run — named
`offers_*` so a reader can tell which half was exercised and which was only
found, and deliberately unable to promote the probe's state.

**Delegation leaves a trace (#65, migration 0294).** Re-measured against the
Issue's own numbers: jobs addressed had moved from 0/499 to 9/856 and four of
those went to a specialist, so the CHOOSING was real — but `consultations` was
still 0 and outputs with no author had gone from 140 to 1,060. The reason for
the first: the hand-written INSERT passed a `text[]` and a slug where two UUIDs
belong, so it raised on **every** hand-off, and the call site ended
`.catch(() => undefined)`. A swallowed error on a write nobody reads back is
indistinguishable from a feature that was never built. It goes through
`app.record_consultation` now, which takes slugs and does the resolution once,
refuses consulting yourself (which would make the rate look healthy) and a name
nobody answers to; a refusal is recorded as an impediment rather than
discarded. `app.judge_consultation` fills `changed_outcome` from the review the
output already gets, and records in `outcome_note` what it inferred it from, so
weak evidence is not later mistaken for strong. An output with no author now
takes the job's `recipient_agent` by trigger rather than by editing 28 handlers
— history is deliberately NOT backfilled, because nothing recorded who wrote
those and a name Grant would read as fact is worse than the gap.
`app.delegation_health` answers the Issue in the numbers it was filed with, and
`npm run verify:handoff` reports the rate rather than asserting a threshold.

**Claire has a conversation, and says back everything she was asked (#63, #60,
`verify:conversation`).** Both mechanisms were built in an earlier session and
neither had a proof, which is why both Issues stayed open after the code landed
— this repository's own #72 pattern with the halves swapped. The suite is the
last box on each: a two-message exchange where the second is understood in terms
of the first, and Grant's 11 September voice note replayed verbatim with all six
clauses accounted for. Nothing needed fixing in the office; two of the suite's
own checks did — one asserted `create_project` where the planner correctly emits
`project` (the handler decides its fate later), and one was written so it could
not fail.

**Project switching works, and three bugs were hiding behind one red check
(#177, migrations 0291-0293).** `verify:agents` was 50/53 on "project
switching", and the issue was right to insist on diagnosing before fixing: it
was **both** of its candidates plus a third nobody was looking for. The suite's
subjects were `fixture-` named and `app.current_project` deliberately refuses a
fixture (0164), so every check read `resolved=null` against code that partly
worked — #45's trap again. Behind that: 0164 had added the fixture guard by
retyping the function from memory and dropped 0026's `order by switched_at desc
… limit 1`, so **clearing a project context did nothing** (an inner join drops
the switch-to-NULL that un-scoping is, and the previous project persisted for
ever), "the latest wins" was whatever the planner returned first, and the guard
fell back to an older switch instead of declining. 0292 then let
`app.project_delete` sweep the switch log, without which a project that had ever
been the subject of a conversation was undeletable — and said so with the raw
constraint name 0282 exists to avoid. 0293 is the same shape one table over:
0282 loosened the alias uniqueness to ACTIVE projects to release 561 phrases,
and `app.add_project_alias` — the only writer anybody calls — still pre-checked
against all of them, so the release was unreachable from the day it shipped.
`verify:agents` is 56/56 and `verify:identity` 30/30.

**What is waiting on Grant is where the work is (#151, migrations
0289-0290).** The landing page has shown "2 things waiting on you" since 0240;
inside a project — where he could actually deal with it — it showed nothing,
because `hq_studio` reduced `needs_me` to one item for the banner and threw the
rest away. Now `app.studio_waiting` per project, in the header, above the
sections, collapsed to a line until pressed and absent entirely when nothing is
waiting. The third bullet had no mechanism at all: `answer_generation_approval`
did one kind and every other blocker could only be discussed, so
`app.hq_answer_blocker` is the general answer — refusing anything the blocker
did not offer, delegating to the generation path where that is what it is, and
releasing the job it was holding. 0290 is the bug `verify:waiting` found on its
first run: `waiting_user -> queued` is not a legal transition, and the legal
road is `paused` then `queued`, which is also the honest one — both hops land in
`job_state_transitions`. `npm run verify:waiting` is 21 checks and writes three
captures; opening one of them found the second bug, that an overdue item was
indistinguishable from a calm one on a bar with two rows.

**A time on the page stays true while the page is open (#153, migration
0288).** Every "3 days ago" was computed in SQL when the payload was built —
harmless when a page lived for a minute, and quietly wrong now that #117's
watcher keeps the studio open all afternoon. The projections carry the instant
beside the rendered string (`at`, `lastAt`, `askedAt`, `deliveredAt`), the words
are made in `web/studio/when.js`, and `pulse.js` re-makes them on the tick it
already runs — no second timer, and `retime()` sits ahead of the `running` guard
because a slow fetch holds it across exactly the minutes when the times go
stale. The rendered string stays as the fallback, which is what made this safe
to roll through the projections one at a time. `tests/studio/when.test.ts` pins
every boundary; `npm run verify:times` proves the wiring by leaving a real
browser open, moving its clock two hours, and reading the same element again —
with a control that the clock alone changes nothing, and a check that stopping
the watcher stops the times, so a second timer could not hide.

**Modules are real, and are not a new table (#71, migrations 0286-0287).** The
Issue asked for `public.modules`. The canonical IA it cites does not contain the
word; the frontend prompt uses it for the dashboard's PANELS, which #81 built.
The section the studio actually renders is a third thing — numbered, named parts
of the work with a state and counts — and **every piece of that already existed**:
`tasks.is_milestone`, `tasks.priority`, `tasks.parent_task_id`, `collections`.
So a module is a milestone task that gathers documents, the one missing join is
`collections.for_task_id`, and `app.studio_modules` derives the rest at read time
so a count cannot drift from what it counts. `hq_task_add` learned `p_milestone`
(0287, dropping both halves by exact signature first — the public wrapper is the
one that silently drops a new parameter), so making a module is one call rather
than add-then-promote. `npm run verify:modules` is 16 checks against a subject
built with decoys: a fixture child, a grandchild, and a collection that is
nobody's shelf, each of which a plausible join would count.

**Contact labels and custom fields are the office's, not the browser's (#110,
migration 0285).** The last thing in the studio on the wrong side of ADR-0021 —
a label Grant invented on the laptop was not there on the phone, and one cleared
browser lost the lot. `contact_labels`, `contact_label_links` and
`contacts.fields`, keyed on `contact_id` and never on the name (which was wrong
the first time two people share one). #107's derived labels survive with both
their rules intact: `contacts.labels_set` is what tells "no labels" from "never
touched", because an absent link row says both and without it a label he removes
comes straight back. Both writes replace the whole value rather than applying a
delta, which is 0250's shape for `p_panels` and gives #118's undo an exact
inverse — `hq_undo` learned all three reversals in the same migration, since
recording an inverse it cannot perform turns Undo into a button that consumes
the offer and does nothing. `verify:arrangement` grew seven checks, the last of
which is the one that matters: after every write, `localStorage` is still empty.

**The corpus holds material and nothing else (#19, #20, migrations
0283-0284).** `duty:notion-sync` stored two things that were never source
material. The three databases the office WRITES into — Projects, Tasks and Docs
— were ingested as documents, each one a bulleted index of its own rows that
matched a search for any row title and re-synced whenever anything was renamed;
a Notion object whose id is in `project_attachments.external_ref` is now the
attachment, not a document in it. And the six module pages
`office.notion_import` authored were read straight back and counted as material
Grant supplied. #20 asked whether `documents` needed an origin column — it
already has one, `yours | source | made`, and the bug was that 0178 DERIVED it
from the connector, which stopped being the definition the moment the office
began writing into a connector and reading its own work back. `origin` is
provenance, `connector` is location, and `notion-import` now states the
provenance in the same pass that creates the page. `npm run verify:corpus`
drives the sync against a stub Notion that presents both shapes, and proves
each invariant by first planting the broken row. 0284 is the bug that found:
`documents.produced_by` was NOT NULL defaulting to `''`, so the `coalesce` in
every reader was dead and a made document rendered with a blank origin line.

**Since 2026-09-11 the studio can take things back (#118, migrations
0263-0266).** Every write with an EXACT inverse records it at the moment it
still knows the previous value — a rename, a task edit, a state change, an icon
or hue, an arrangement, a detached source — and a strip offers to reverse it.
Everything else offers nothing and says why: a replaced project photo, a
disconnected service (the credential is deleted from the Vault), a new project
(the confirmation is the safeguard). `npm run verify:inverse` proves the
exactness per action against the live database, and carries a control that
records a deliberately WRONG inverse and requires the same comparison to catch
it.

**A write-capable job now says what it would do before it does it (#131,
migrations 0267-0269).** `Handler.plan()` is computed by the same code path that
performs the work — `syncTasksToCalendar` was split at exactly that seam — and
the worker records it against the job before the handler runs, at one
chokepoint. `app.request_approval` appends it to the blocker, so an approval
shows the list rather than the category. `npm run verify:dryrun` runs the
planner with a `fetch` that throws on any outward write, then runs the handler
with one that counts, and fails a handler that does more than it planned. Not
yet covered: `office.notion_import`, whose plan depends on a model call and so
needs the STORED plan to be the thing executed.

**A queued job is no longer invisible (#112, migrations 0270-0271).** Nine
hourly jobs sat queued for eight hours with a green dashboard, because
`office_health()` counted complete, failed and in-flight and a job nobody has
taken is none of those. `verify:worker` now holds the kinds enabled duties
enqueue against the kinds the real registry declares — `buildPass` exposes them
— and fails before a deploy rather than eight hours after.
`app.jobs_stuck_queued()` measures a stall against the period of the duty that
made the job, `office_health()` reports it, and the studio shows an orange strip
naming the kind and the age.

**An output can declare its shape (#130, migrations 0272-0273).**
`public.output_shapes` holds the contract as rows — one authority, because the
validator has to run where the row is written and every consumer is SQL — and a
trigger refuses a declared shape whose facts do not match, naming the key and
what it should have been. `body` stays: prose is what Grant reads. The duties
that report "nothing changed" now say so in a field. Still prose-only:
`research_summary`, `tasks_extracted` and `draft_document`, which need their
handlers taught to ask the model for structure.

**The office knows what it can do, per person (#148, migrations 0277-0279).**
`app.capability_index(staff)` is generated on every call from
`tool_permissions`, `staff_tools`, `knowledge_connectors`, `connection_health`
and `tool_requests`, and answers four different questions — can / must ask /
nobody may / already refused. It replaces `verbsNow()`, a hand-written list in
TypeScript that covered three of twenty-one tools; the verbs are a column now,
so the office can correct one without a deploy. It also fixed a duplicate that
had been in **every capability brief the office had ever sent**: Slack and
Telegram each have two `connection_health` rows and the surfaces branch never
deduped.

**Tasks exist across the whole portfolio (#173, migrations 0280-0281).**
`tasks.project_id` is nullable, so a task can belong to no dashboard project;
`app.hq_portfolio_tasks()` aggregates every open one with overdue, waiting,
stale, unowned and suggested computed on read in Grant's timezone; and the
studio has a Tasks screen whose first row answers *"what should I be doing
next"* rather than only listing. Ticking one there is the same row the project
view ticks, so undo works for free.

**The office recognises a failure it has seen before (#132, migrations
0274-0276).** `failure_signatures` counts a repeat instead of logging it again,
and `app.notice()` raises one that has happened three or more times in a
fortnight — *"this has failed the same way eleven times"* is a recommendation.
Deliberately not a circuit breaker: recognising a repeat and refusing to try
again are different features, and the second silently stops work Grant expects.

The table is **provably free of payload** because it has nowhere to put one —
no text column an error message could be written into, only a dotted kind, one
of nine class words, and an id. `verify:failures` attacks that rather than
asserting it, and found a real hole on the first run: a Slack-token-shaped
string satisfied the original subject pattern completely. 0276 narrowed it to a
UUID or a short lowercase handle AND held it against the credential shapes.

**There is no cron and no GitHub Actions.** Grant switched Actions off on
2026-09-08 — *"for any process"* — and everything scheduled moved to
`pg_cron` poking a Supabase Edge Function every minute, which then fires
whatever duties are due. Three capabilities silently stopped when Actions went
(the worker, the notebook reads, the backup) and each was found separately;
if something looks like it has not run since 2026-09-08, that is the first
thing to suspect.

**What Phase 10 has cost so far, which is the argument for doing it:** seven
real defects, none of which any existing suite could see. The router made one
attempt at one model. §31's exit criterion could not hold as written. A job
that crashed after committing produced a second output. No output had ever
been attributed to anybody. The event ledger had never recorded a real action.
§22's own sentence was classified as a request for work. And the Set up page
showed a green light for a backup that had stopped happening. Every one was
found by running the thing end to end, not by reading the code.

---

## What happened today, in one paragraph

Grant reinstalled Slack with `channels:join` and set the interactivity URL, so
the office is complete. Photorealistic avatars were generated, hosted and are
live. Team HQ was built and deployed. Then Google disabled the account four
vendors sign in with, which turned the day into an audit: NotebookLM is gone,
the Gemini key was already dead of the same cause, Groq turned out to be dead
too, and the backup rehearsal turned out to have failed every night since it was
written without telling anyone. All of that is fixed or recorded; none of it is
still bleeding.

---

## The rule the codebase is built on

From `src/jobs/worker.ts`: **it takes no shortcut that the database would have
allowed.** A worker knows what it is doing — it wrote the output, so why re-read
`reviewer_status`? Every such shortcut turns an enforced invariant into an
honour-system one, and the enforcement stays green because nothing exercises it.

And the defect this project keeps meeting, in eleven costumes so far: **a check
whose result does not depend on the thing under test.** When you write one, ask
what it would do if the feature were deleted. If it would still pass, it is not
a check — add a CONTROL that proves it discriminates.

Two siblings, each learned the hard way:

- a test that changes real configuration must restore it;
- **a failing check that notifies nobody is indistinguishable from a passing
  one.**

---

## What exists, by surface

**Slack — the office.** Results reach the thread that asked, presented as the
staff member who produced them, exactly once. Six §12 buttons, received and
acted on. The bot recovers itself from being removed from a channel.
`verify:slack`, 56 checks.

**Telegram — the pager.** One bot, registered to Grant. Pages at `important`
and above, silent below urgent. An interrupted send can never be reconciled — a
bot cannot read its own sent messages back — so it parks forever rather than
risk sending twice. `verify:telegram`, 28 checks.

**Team HQ — <https://ai-team-hq.vercel.app>.** Read-only, five views, four
sparklines, per-device layout memory. The token is in the vault as
`hq.api_token`; `npm run hq:token` sends it to Grant's phone. **Never print it**
— the deploy script did once, which is why it now cannot. `verify:hq`, 24 checks.

**Delivery is channel-agnostic.** `public.deliveries` and `app.claim_delivery`
serve both surfaces. Adding a third means adding a `Transport`, not a third
table.

**Voice notes.** Everything up to the API call. Without a credential every note
degrades to text and says `no_credential`, which is the acceptance criterion
working.

---

## Waiting on Grant

**Revised 2026-09-09.** Do not add to this list in chat. It lives here, in
[`known-problems.md`](known-problems.md) and on the Set up page, and the reason
is that surfacing needs one per turn is exactly what went wrong that week.

1. **Make the Telegram office group.** Telegram does not let a bot create one,
   so this step cannot be automated. New group → add all eight bots
   (`@agenticteamgrantbot` and the seven `@atg_*_bot`) → call it AI Team HQ.
   They register themselves on being added (`my_chat_member`, 0136), and the
   routing already exists: the Chief of Staff reaches Grant directly, everyone
   else moves into the room the moment it exists. It also appears on the Set up
   page as of 0142.
2. **Make a Notion Teamspace for each project, and share a database from it.**
   Answered on 2026-09-09 and now prompted rather than remembered. Notion's
   public API exposes no teamspace at all — no endpoint, no field, and a
   database inside one reports its parent as the workspace — so this genuinely
   cannot be automated and never will be until Notion adds it. Every project
   without a Notion attachment now reads `wanted` on the Projects page with the
   steps attached: make the teamspace, put a database in it, share that
   database with the Agentic integration, attach it to the project. After that
   the team can write into it unaided.

   `notion.project_slug` is gone (0161). It could only ever name one project,
   and it was named for something it did not hold — Grant: *"Configuration and
   database fields must use terminology that reflects what they actually
   reference."* The mapping is per project now, in `project_attachments`.
3. **Decide whether `vault-export` runs weekly.** It is the last duty still
   disabled. Enabling it means a copy of every credential arriving on Telegram
   every week — which is the only thing that would survive losing the Supabase
   project, and also a weekly credential broadcast. His call, and it needs
   `openssl` replaced with Web Crypto first so it can run in the worker.
4. **Add the MCP server to Claude,** if it is still wanted. The token is on
   your phone. Settings → Connectors → Add custom connector, paste the URL and
   the `Authorization: Bearer …` header.
5. **Rotate the Notion token when convenient.** It was pasted into a chat
   transcript on 2026-09-06, which is durable and searchable. Hygiene rather
   than an incident.
6. **A read-only GitHub token, if "look at my Rest Timer repo" should work.**
   `github.dispatch_token` is in the vault, authenticates as `granterogers`,
   and is scoped to THIS repository with contents:write — it was made for
   `repository_dispatch` (0126). It is what the read client uses, and it cannot
   see any other repository whatever it is allowed to do here. A fine-grained
   token with Contents/Metadata/Issues read-only across the repos he picks
   would close §8. Steps are in the 2026-09-09 audit.
7. **A CoachAccountable API key, if the team should update coaching records.**
   Researched rather than assumed: CoachAccountable has had a full REST API
   since 2015, with `Client.update`, `Action.add`, `Metric.addData`,
   `Session.add` and webhooks. Profile icon → Settings → System → API Access
   gives an API ID and a private key. That is strictly better than the
   login-and-scrape he asked for — no password stored, revocable, structured,
   and it does not break when they change their HTML.

**Notion is no longer a read-only integration.** As of 2026-09-09 the client
speaks API `2026-03-11` and can create pages, append and update blocks, set
properties and relations, upload and attach files (audio becomes an audio block,
not a download link), read a database schema before writing to it, and archive
reversibly. `notionCapabilities()` answers "do we have a token / what can I do /
is this read-only" without asking anybody. The full matrix, the three things
Notion genuinely cannot do, and the two breaking changes the version bump
brought are in [`notion-capability-matrix.md`](notion-capability-matrix.md).

**Settled, recorded so they are not re-asked:** Backblaze is safe (its own
password, no Google SSO); Google Cloud TTS is parked; the ownership of the
OpenRouter, OpenAI and Groq accounts is parked; voice is required (Grant,
2026-09-07) and is built; GitHub Actions is off for every process.

**No longer waiting:** all eight Telegram bots exist, are configured, answer,
and wear their own face. Notion pages are shared. The Google OAuth client
exists and all four services are connected.

---

## What arrived on 2026-09-07, and what it left open

The office can now act rather than only answer. In order of how likely you are
to trip over them:

- **Every notebook generation is gated on Grant's approval** (0083–0086). The
  gate is in `notebook.generate`, not in the office, because an MCP client and a
  scheduled retry can both start one. Approval creates a NEW job carrying
  `approved_by`; nothing resumes.
- **`jobs.not_before` and `jobs.announce`** (0074) exist and are load-bearing.
  A job can be delayed, and a job can decide its own output is not worth a
  message. Both are read by the worker and the notifier.
- **The notebook meter** (0078). Google's compute allowance cannot be queried —
  there is no API — so `notebook_spend` counts ours and a refusal lowers the
  ceiling permanently. Never present those numbers as Google's.
- **Voice notes** transcribe locally with faster-whisper. The audio never
  leaves the runner, deliberately; do not "improve" this by sending it to a
  provider.
- **`#the-floor`** narrates routing decisions in plain English, rendered clause
  by clause from the row. Do not let a model write it: an unconfident reading
  smoothed into a confident one is exactly what the channel exists to show.

Left open, and honestly: NotebookLM **slide decks fail** every time on this
account (four attempts, all `failed` from Google, with audio and mind maps
working). The boilerplate stripper removes 61% of a Wikipedia extraction but the
remainder still carries theme toggles and table-of-contents chrome — better, not
solved.

---

## §22 completion, measured rather than felt

**Revised 2026-09-09.** Both scenarios now have live harnesses, and the tables
below are what those harnesses report rather than a reading of the code. Run
them: `npm run verify:scenario-a` and `npm run verify:cross-interface`.

### A — source to conversation · `verify:scenario-a`, 20/20

| clause | |
|---|---|
| Grant adds a source from his phone | ✅ paste a link to any bot |
| detected within the sync interval | ✅ `discovery-sync`, hourly, since 0138 — reads run over HTTPS now, so the Edge worker can do them |
| Research analyses it | ✅ |
| justified specialists consulted | ✅ the cap, the justification and the refusal to convene are all enforced |
| Quality/Risk reviews | ✅ |
| findings written back | ✅ as a document; NOT into the notebook — ADR-0013 retired that |
| operational metadata in Postgres | ✅ |
| Slack project channel, correct staff identity | ✅ — and it was NOT, until 2026-09-09. 736 of 736 outputs had a null `staff_id`; a name was resolved for display and never persisted |
| Telegram notified where policy warrants | ✅ |
| react / respond / Undo | ✅ six buttons, all acted on; `undo_offers` idempotent |
| **Talk to Team — a live voice conversation** | ✅ Realtime over WebRTC, barge-in, live transcript, and an `ask_the_team` tool that reaches the office |
| Chief explains from real state, "bring Finance in" | ✅ — and §22's literal sentence was being delegated instead of answered until 0139 |
| work continues autonomously | ✅ |
| all actions versioned | ✅ — and the ledger had never recorded a single action by the working system until 2026-09-09. 75 events, all of them fixtures |
| usage in-app and in the daily capacity report | ✅ |

### B — cross-interface delegation · `verify:cross-interface`, 10/10

| clause | |
|---|---|
| the instruction through Slack | ✅ |
| identifies the project, creates a persistent initiative | ✅ — and asks first, after it created two projects nobody wanted |
| delegates to justified specialists | ✅ |
| routes conclusions through Quality/Risk | ✅ |
| works asynchronously, preserves state | ✅ |
| returns progress to the right Slack thread | ✅ |
| places rich artifacts in the notebook | 🟡 audio overviews and mind maps yes; slide decks fail every time |
| notifies Telegram only per policy | ✅ |
| **the same instruction through Voice** | ✅ asserted as an equality on the stored row, modulo the channel-native fields |
| generated code in an isolated workspace or branch | ❌ not built, and nothing generates code yet |

### What is actually left

Voice was the answer to the tension this section used to describe — Grant
settled it with three words, *"Voice is required"*, and it is built. What
remains is smaller and none of it is a scenario clause:

- **the code workspace** (§22 B's last line), which nothing needs yet because
  nothing generates code
- **slide decks**, which fail upstream at Google
- **`vault-export`**, the last duty still seeded disabled: it needs `openssl`
  replaced with Web Crypto to run in the worker, and switching it on means a
  copy of every credential arriving on Telegram weekly, which is Grant's call
- **a security review as a distinct pass** — `verify:security` covers RLS,
  vault isolation and role separation, but nobody has sat down and tried to
  break it on purpose

---

## What I would do next

**Finish Phase 10.** Provider failover, §31's cross-interface equality and
failure injection are done; `verify:chaos` covers seven of §18's twenty named
cases. The remaining thirteen are the obvious next block of work, and they need
nobody — §18 names them explicitly, so there is nothing to decide.

After that, **§22's scenario A end to end**: a source arriving, being analysed,
reviewed, delivered to the right Slack thread with the right face on it, and
reacted to. Every piece exists and is checked in isolation; nothing has run the
whole arc in one go.

**Phase 9 is unblocked but unscheduled.** ADR-0013 re-based it: Calendar, Gmail
and Drive were always going to read Grant's own data on his own account with his
consent, which is the supported path and carries no policy exposure. It needs an
OAuth client in a project he owns, and it needs someone to decide it is worth
the time before the hardening is finished.

**Do not revive the NotebookLM sync.** Not caution — ADR-0013 decided it. There
is no public API, so an unattended client must impersonate a browser session,
which is exactly what the ban named. Pasting a source in by hand still works and
produces a document like any other.

---

## Pre-human backend acceptance — 14 September 2026

Grant supplied a **Pre-Human Backend Acceptance & Full-System Stress Test**
specification (`docs/spec/backend-acceptance-2026-09-14.md`, verbatim) and a
**Master UX QA Governance Prompt** (`docs/spec/ux-qa-governance-2026-09-14.md`,
verbatim). Backend readiness comes first — the acceptance document ends
*"BACKEND READINESS FIRST. HUMAN TESTING SECOND."*

The programme is #224. **Verdict: 🟠 ORANGE — begin human testing, with five
named limits.** Full report: `docs/testing/backend-readiness-2026-09-14.md`.

### What was run

All **74 backend suites**: 72 passed on the sweep, 0 timed out, **0 could not be
run**, and both failures were real and are fixed. Plus 1,017 unit tests, the
behavioural evaluator, and the coverage matrix. Roughly 95 minutes of wall clock
at **£0** — free-tier models only.

### What is new

| | |
|---|---|
| `npm run gate` | the **fast readiness gate**, 15 curated checks in 384s. It did not exist: `verify:all` is `verify` + `audit:credentials` + `verify:db`, and `verify:db` is a 47-command chain ending in two destructive sweeps |
| `npm run coverage` | the Phase 1 **capability coverage matrix**, generated from the repository. 30 domains: 17 full, 11 partial, **2 with no suite at all** |

### The two real defects, both fixed

- **0361 — "the latest switch wins" was decided by a coin flip.** `switched_at`
  is the transaction timestamp and `switch_id` was a random uuid, so two
  switches in one transaction ordered arbitrarily. In production that points a
  chat at the project from two switches ago. A monotonic identity column now
  breaks the tie, with a ten-round regression check.
- **0360 — `app.project_delete` could not remove a project that had ever had a
  Slack channel**, and crashed the sweep rather than refusing. 11 debris
  projects have since been swept out of Grant's views; zero remain.

Four smaller ones: `e2e.ts` always exited 0; its report filename had a stale
date baked in; `check:leaks --sweep` aborted on first failure; and a
token-shape security check matched its own help text.

### The five reasons it is ORANGE, in the order they would bite

1. **Recurring duties have never been tested** (#225) — the only thing that acts
   without Grant asking.
2. **Gmail, Drive and Calendar have never touched a real Google** — blocked on a
   Phase 9 OAuth client (ADR-0013).
3. **The behavioural corpus is 7 cases** (#171). The judge agrees with Grant
   7/7, so the instrument is sound; it has almost nothing to measure.
4. **`verify:chaos` covers 7 of §18's 20 cases** (#228).
5. **`verify:agents` was flaky for three days and nothing measures flake**
   (#226).

**NotebookLM has no suite either** (#227) — and the deliverable there is a
capability probe recording limitations as data, never a revival of the sync,
which ADR-0013 refused.

### Not done, deliberately

The **18 frontend suites** were not run in this pass. They belong to the UX QA
standard, not to a backend acceptance programme, and the coverage matrix names
them rather than leaving them out. The UX remediation epic (#223, children
#214–#222) has not been started.

### Second pass, same day — Grant said "solve part 1"

Four of the five ORANGE reasons closed, and the fifth measured and bounded.

| | |
|---|---|
| `verify:duties` | **21/21** — the domain that had nothing (#225) |
| `verify:notebook` | **18/18** — the other one (#227). **All 30 domains now have a suite** |
| `verify:chaos` | 21 → **29** (#228) |
| `verify:identity` | 30 → **39** — the project create/rename/archive arc |
| eval corpus | 7 → **20 cases**, ten good and ten poor (#171) |
| flake tracking | per-run history keyed by commit (#226) |
| free-tier headroom | now asserted — database 50 MB of 500, storage 102 MB of 1,024 |
| the gate | **15/15 in 395s** |
| the sweep | **92 of 94, 0 failed, 0 could not run** |

**Two more real defects, both fixed:**

- **0365 — `hq_rename_project` never checked for a name clash.** `hq_create_project`
  refuses a name a live project already holds; rename did not check at all, so two
  active projects could answer to one name. Reachable from Project Settings.
- **Renaming a project makes it permanently undeletable** — the rename enqueues a
  job and a job can never be removed. Not a bug; a property, and the reason the new
  arc runs inside a rollback.

**The finding worth remembering:** the evaluator's judge was grading *compliance*,
not trustworthiness. Its rubric asked *"did it do what was asked?"*, which rewards a
confident fabrication and penalises an honest refusal — the exact inversion of the
office's first invariant. Seven historical cases could never show it; twenty with
paired controls showed it immediately. Corrected in `JUDGE_VERSION` 2026-09-14.1.

**And a limit on the instrument:** agreement moves **±2 cases between runs** of an
unchanged corpus even with the model pinned and `temperature: 0` — measured, not
assumed. `npm run eval` prints that margin now. #229 has the options.

Still 🟠 ORANGE, for three narrower reasons: Google is unproven against a real
Google and jointly blocked; the judge has a ±2 margin; and duties are tested to
dispatch rather than through the handler.

---

## Backend intelligence breadth — the programme after the acceptance pass

Grant, 14 September, after the routing fix landed. Specification stored verbatim
at `docs/spec/backend-intelligence-breadth-2026-09-14.md`.

> The backend plumbing has extensive deterministic coverage, but **intelligence
> breadth is NOT yet proven.**

**The epic is #231.** If you are picking this project up, read that Issue and the
spec file before touching the router.

### What was measured, and it is the point

Production, not a suite. All 505 routing decisions ever recorded:

| roster | times |
|---|---|
| Emma | 269 |
| Claire | 146 |
| nobody | 70 |
| Tom | 20 |

**Oliver, Daniel, Ruby, Marcus and Grace had never been selected once.**
`delegation_depth` was **0 across all 505**. Consultations: 19 against ~267 real
instructions.

`verify:delegation` and `verify:handoff` both passed throughout. They prove the
mechanism works WHEN DRIVEN. They prove nothing about whether real traffic uses
it — and that distinction is the spine of the whole programme.

### Fixed

`ROSTER_CEILINGS.question` was `[]`, evaluated before subject-matter routing, and
`question` is 237 of 505 — so the commonest thing Grant does could not reach a
specialist. Opened to all seven with `TOPIC_ONLY` making them earn it. Deployed.

**4 distinct people now, up from 2. Daniel and Ruby routed to for the first time
in the system's history.** `verify:roster` 5/7 → 7/7.

### Not fixed, and deliberately not fixed by adding three phrases

Marcus, Grace and Tom still missed on their own targeted asks. Grant:

> Do NOT solve this merely by adding the three exact failed phrases. The
> requirement is **semantic breadth**. If the current architecture fundamentally
> cannot generalise beyond keywords, identify that as an **architectural
> limitation**.

His own example settles the likely answer: *"Run the numbers if we sell it
cheaper"* is plainly a finance question and matches no word in any expertise list.

### The Issues that carry it

| | |
|---|---|
| **#231** | the epic — evidence, all eleven workstreams, 14 acceptance criteria |
| **#232** | routing breadth, confusion matrix, negative controls, overlapping domains (A–D) |
| **#233** | real multi-agent collaboration — `delegation_depth > 0` proven in canonical state (E) |
| **#234** | agent action/capability coverage, six levels from "in code" to "observed" (F) |
| **#235** | intelligence breadth coverage model, tiers 1/2/3, mutation testing (G–H) |
| **#236** | prove `verify:drains` goes RED — a guard nobody has seen fail (J) |
| **#176** | production utilisation telemetry (I) — extended by comment, its P3 now questionable |
| **#65** | closed, criteria unmet in production — carried forward by #233 |

### Also landed in this pass

- **`verify:drains`**, in the fast gate. The worker was absent ~15 hours on
  13 September while pg_cron logged **1,440 successful heartbeats**; eleven of
  Grant's messages waited. `office_health` has no word for "waiting" and still
  does not — that gap is #236.
- **`verify:google-live`** 12/12, and a correction: Gmail, Drive and Calendar were
  **never** blocked on an OAuth client. The credential has worked since
  8 September. The readiness report said otherwise and was wrong. The Drive API
  had genuinely never been enabled — one click, now fixed.
- **`npm run q`**, a plain query helper, after three attempts to read a fifteen-row
  answer failed on the shape of the `db-query.sh` wrapper rather than the query.

### Standing rule from this programme (workstream K)

Every genuine defect becomes a permanent regression **property**, never a test of
the phrase that exposed it. Banked so far: questions structurally unable to reach
specialists · ambiguous questions taking `ceiling[0]` · expertise/fallback
vocabulary drift · a specialist available but never naturally selected · a
mechanism existing but never naturally invoked · a heartbeat green while the queue
is static · health checks blind to never-started work · **vacuous tests passing
because they matched zero rows** · harness traffic mistaken for production failure.

---

## The backend intelligence campaign — 14 September 2026

Grant asked, directly: *"Are we sure that the sub-agents are being used?"* and
*"are we getting prompt responses when we ask messages to the team?"* The
answers were no and mostly. This is what was measured, what was wrong, and what
now holds.

### Where it started

`npm run measure` (new, #231) reads what the office ACTUALLY did, real traffic
only, and appends every snapshot to `.out/measurements.jsonl`. The baseline:

| | |
|---|---|
| agents ever chosen | **3 of 8** — communications, finance, growth, operations and quality had never been selected once |
| max delegation depth | **0**, across every real job in the system's history |
| consultations | 13 real, every one Claire choosing who answers |
| median instruction | 53s, p95 45,656s — a 15-hour worker outage, invisible behind 1,440 successful heartbeats |

### #232 — the routing understood words, not meaning

`npm run verify:routing-breadth` — 91 realistic asks, 10–15 per specialist,
ten linguistic forms, through the exact calls `handlers/instruction.ts` makes.
**31% overall**, and 0% for every phrasing that names a subject without using
its noun: vague, colloquial, command, speech. Grant's own examples missed.

Three defects, all #230's shape:

1. `app.who_knows_about` is a trigram match on `staff.expertise`. New
   `src/agents/subject.ts` reads the request for MEANING — one cheap model
   call, only when the literal matcher found nothing, prompt built from
   `public.staff` so the vocabulary stays Grant's.
2. `classifyIntent` returned `thought` both for a deliberate remark and for
   anything it did not understand, and `thought` convenes nobody. New
   `Classification.recognised` separates them.
3. Five `ROSTER_CEILINGS` predated half the roster — `direct_command` could not
   reach the communications director, so *"draft the announcement"* went to
   research.

**31% → 78%.** Communications 18% → 91%, operations 25% → 92%. Claire fallbacks
44 → 2. The ten Claire-only negative controls still hold at zero.

### #233 — a second specialist now actually does the work

`app.enqueue_child` and the depth cap had existed for months with no caller.
`pickRoster` returned up to five names and the handler used one;
`recordDecision`'s `delegationDepth` argument had never been passed by anybody.

Each additional specialist now gets a child job, `announce = false`, addressed
directly so the chain terminates at one by construction.
`npm run verify:collaborates` — 10/10, on the deployed worker: finance answers,
communications gets real work, `delegation_depth` 1, a consultation between two
specialists, zero grandchildren, and a control proving the cap still refuses.

### #234 — `npm run levels`

Every tool placed on Grant's six levels, generated, with harness traffic
excluded. Eleven at L6. **Four granted to all eight agents and never
exercised**, including `task.create` — nothing in this office has ever created
a task. Plus a new check that every job kind named in `delivered_by` has a
handler: zero unimplemented claims.

### #235 — `npm run breadth`

The coverage model first, as instructed. **27 of 37 dimensions have cases; ten
have none**, and four of those ten are how Grant actually behaves —
corrections, changed intent, contradictory instructions, cross-project work.
Filed as #237. Dimensions live in `public.breadth_dimensions` (0366), editable
by him. Tiers defined; tier 3 specified and deliberately not run.
`npm run mutate` generates semantic variants and prints them — adoption is a
commit, because a corpus graded by the thing under test measures nothing.

### #236 — the queue check can go red

`verify:drains` now manufactures a real backdated queued job in a rolled-back
transaction and asserts the same query sees it.

### What is still true and uncomfortable

- **Five agents remain "never chosen" in REAL traffic**, because no real
  traffic has arrived since the fix. The office can now reach them, proved
  through the canonical path. Whether it does is a question only Grant's next
  few days can answer, and `npm run measure -- --compare` is how to ask it.
- 18 of 91 routing cases still miss, mostly genuine ownership overlaps
  (strategy vs growth on "enterprise or SMB"). That is a `staff.expertise`
  question and his to settle, not a routing defect.
- `public.tasks` is empty and `github.read` has never been called.

---

## Campaign two — can Grant live with it? — 15 September 2026

Campaign one asked whether the mechanisms work. This one asked whether the
office survives the way Grant actually talks: corrections, a changed mind, two
projects in one conversation, references to something three turns back.

**The answer is that it does now, and it did not at the start of the night.**
Nine sessions, 34 turns, every one injected through `inbound_commands` and
answered by the deployed worker. `npm run session -- --list`.

### Eight product defects, all found by USING the office

| | what Grant would have seen |
|---|---|
| **no path to a task** | *"Yes, do it. Create the task."* → *"Sure, I'll create it. I need a few details first: 1. Title 2. Due date 3. Owner 4. Parent task"* → and `public.tasks` stayed empty. `task.create` was granted to all eight agents with nothing routing to it |
| **a fabricated read failed into silence** | the coherence gate refused two of four turns in one conversation and he received **nothing** — no answer, no explanation |
| **"I've posted a Slack message to the team"** | `deliveries`: zero. He would have waited for replies from people who were never asked |
| **"not that, this instead" did nothing** | the imperative in a second sentence was invisible to the classifier, so a whole SHAPE of correction convened nobody |
| **"the onboarding not the pricing"** | went to the finance director — the one specialist the sentence excluded |
| **eight clauses filed as a procedure** | a global skill called *"Shoulding decide"*, none of the eight answered, and nonsense in the office's memory |
| **a scaffolding-only reply** | *"Ask me again and I will retry"* — the office passing its own problem back to him |
| **an invented intake form** | the model filled in what `tool_permissions` did not say, including a parent task that is not a parameter |

### What holds

- **No cross-project contamination.** A → implicit switch → B → a write → back
  to A: every turn filed correctly, and every task in the right project.
- **Action versus discussion.** A thought, a question and an explicit hold all
  write nothing; only the command writes. 6/6.
- **Adversarial.** A document that does not exist is not summarised, a disabled
  capability is not pretended, a false premise about its own history is not
  accepted. 3/3.
- **Routing generalises rather than memorises.** Development 79%, **held out
  75%** on thirty formulations written afterwards — inside the noise for the
  sample size, so no overfitting.

**133/139 expectations across 34 turns.** The six that remain are the
contradictions session, where the office answers honestly about what it lacks
rather than engaging with the conflict, and one voice-note turn that reaches
the Chief of Staff rather than the operations director — better than the
excluded specialist it used to reach, not yet right.

### Still uncomfortable

- `conversation.max_turns` is **12** and `conversation.window_minutes` is
  **30**. A working session longer than twelve turns cannot see its own
  beginning, and one spanning more than half an hour loses everything older —
  and Grant talks to this office across a day, not inside half an hour. Not
  changed tonight: it is a cost/latency decision, not a defect.
- 41 fixture session projects accumulated before the harness stopped
  multiplying them. All carry a job, so none can ever be deleted (ADR-0022).
  Invisible to Grant — they are fixtures — and permanent, like the other 22.
- `github.read` has still never been called and `public.tasks` is empty again
  after teardown.

---

## 17 September 2026 — the capability campaign

Seven Issues advanced in one autonomous run, on branch
`claude/phase-7-communications-kh8ow8`. Every one is still OPEN with its
remaining boxes named in a comment on the Issue itself; none was closed,
because none had every acceptance criterion satisfied.

| Issue | What the office can now do that it could not | Migrations |
|---|---|---|
| **#260** | list what a notebook has MADE, including what Grant made himself, without fabricating a link for a type NotebookLM gives no link for | 0429–0431 |
| **#172** | answer from the correspondence, with a message belonging to a project by DERIVATION (a contact, or an alias in the subject — never the excerpt) and mail joining the coverage it reports honestly | 0432–0434 |
| **#258** | turn a request into a real, validated, stored PDF and send it back on Telegram | 0435 |
| **#263** | stop in the middle of a job and carry on, without repeating an external write or guessing through a stale checkpoint | 0436 |
| **#262** | work several specialists at once and write one answer that cannot credit somebody who did not contribute | 0437 |
| **#264** | start governed work from something happening, with a storm rule for each failure that actually happens | 0438–0439 |
| **#265** | register an outside MCP provider, discover what it offers, and grant nothing by doing so | 0440–0441 |

**Two ADRs**: 0037 (mail belongs to a project by derivation, not by a link
table) and 0038 (the office writes PDFs itself, because jobs run in Deno).

**One assessment**: `docs/agent-runtime-assessment-2026-09-17.md` answers
#16 / #135 / #261 without labelling them "needs budget". Three decisions are
Grant's and none blocks the £0 work.

### Live product defects found by using it, not by reading it

- **69 of Grant's 90 Telegram messages could not be replied to in-thread.**
  `BOT_FOR_INBOUND` matched an unaddressed command against a bot with a null
  `staff_slug`, and no bot row has ever had one. The pager answered them, so
  nothing looked broken — until a FILE needed to reach him.
- **`app.discard_document` has never discarded anything.** It wrote a state the
  CHECK forbids and raised 23514 every time.
- **Google's refresh token is dead** (`invalid_grant`). Gmail and Calendar have
  been returning nothing for two days while the hourly duty succeeded. Grant
  has been paged; reconnecting needs a browser.
- **`dependency_wait` was not resumable**, so the first live fan-in sat paused
  for eighteen minutes with the answer never written.

### 2 October 2026 — post-P4 closure is BLOCKED by a platform incident

#404 (each person is addressed by their own name) and #405 (Sign out) are built and pushed (`4a305933`, `b88ef55a`) but
NOT live-proven and the Issues stay open. From about 12:23 UTC the Supabase project was degraded (project health API:
auth, rest, realtime, storage unhealthy; trivial cached queries thousands of times slower with our worker idle). Worker
v925 is deployed but unproven; the voice function and the new page are not deployed. **The worker heartbeat is PAUSED**:
`npx tsx scripts/p3/worker-heartbeat.ts resume` once `select count(*) from public.jobs` returns in under a second.
Details and the exact resume sequence: `docs/multi-user/P4-SECOND-USER-ACCEPTANCE.md` §21.

*Update, later the same day:* the platform recovered at 16:06 UTC; worker v925 was proven, the page
(`dpl_2PMxKBBcbv6UMZ4fU1YUnstbNs9z`) and voice (v623/v652) were deployed, and #405 passed 38/38 on production. It degraded
again from about 16:50 under worker plus test load, so the heartbeat is PAUSED again. Still owed: the #404 second-person
prompt inspection, the production send-reload-compare Chat proof, and the production stale-request run. #407 (Google duties
`no_office`) is a separate pre-existing defect.

### What a fresh session should read

`CLAUDE.md`, then `docs/AUTONOMOUS-RUN.md`, whose progress table has a row per
Issue with what is done, what remains and what the evidence was.
