# V1 integration release candidate (9 October 2026)

**Outcome: B. Technically ready, but production-state verification is required before any release.**
Nothing was deployed, applied, read from production, merged to `main`, or sent to anyone in this run. Every number below is from this checkout,
the isolated replicas, or a bounded real-model trial on a replica; the evidence class is named beside each.

## 1. Branches and commits

| | |
|---|---|
| Integration branch (pushed) | `claude/v1-integration-main-2026-10-09`, 87 commits ahead of `main` (head is the commit that carries this report; the last code commit before it is `43936369`) |
| Baseline | `origin/main` = `b8ea3c0a102cf5e6a5bc205e57bca0e5dcc3cd71` (merge base is `b8ea3c0`; it is the baseline, not rewritten) |
| Reliability branch | `origin/claude/deep-systems-audit-3cwbtc` = `7d387f04d02310c8c5d30683785de18a1956c20d` (not modified; not reset) |
| Efficiency branch | `origin/claude/efficiency-deep-optimization` = `a8bcff775b75bab159638b56e235d3fe1fbbfc0d` (read only; two applied migrations copied from it) |
| Previous release plan | `V1-PRODUCTION-RELEASE-PLAN-2026-10-09.md` (now marked superseded in part; its numbers 798/1022/1023 to 1035 were the earlier state) |

## 2. What changed on `main` since the reliability branch forked

Main moved by the Team HQ UX release: infinite canvas, hamburger navigation (ADR-0068), floating panels and Post-its, per-person per-project layout
with revision-aware saves (CAS), background library and uploads, compact chat dock, live dictation, a separate voice conversation, Document Style and
Project Settings simplifications, the public Sample, and the efficiency workstream's two applied migrations (1023, 1027) and page. Production's ledger
is 802 (highest 1041) per the deployment record; hq-api v899 and a new page deployment. This is a RECORD (`isLiveProductionReading: false`), not a reading.

## 3. Reliability reconciliation (change matrix)

| Item | Status |
|---|---|
| Eleven reliability migrations | **Adapted**: renumbered 1042 to 1052 (bodies unchanged); production already holds a different 1023 and 1027 |
| Efficiency 1023 and 1027 | **Already present** in production; copied verbatim into the repo with verified checksums and added to the ledger file |
| Efficiency 1024 to 1026, 1028 to 1031 | **Not integrated** (unapplied, deferred by their owners). 1030 conflicts in content with our 1044 on `app.dequeue_job` (Issue #451) |
| Selective Telegram delegation (chief routes, a specialist addressed stays direct) | **Safe to port, ported**; bot-receive, specialist-addressed, chief-delegates and transport identity kept distinct (`src/agents/addressing.ts`) |
| Recurring reminders (complete one occurrence, series stays; stop is separate) | **Ported**, plus a **new** Team HQ "Stop repeating" control (the control existed only in the classic studio); limit in #450 |
| Failed or uncertain delivery: one durable Needs-me item, no auto-resend, no cross-channel | **Ported** (1049, 1047, 1050); redrive reads its output through its own job's office (new office scoping this run) |
| Per-office budget and queue (1044), terminal-failure word (1043), message-name idempotency (1048), lead-reply ordering (1052), free-tier watch (1045), office-clock task days (1046) | **Ported** |
| External-assistant thread isolation (1042) | **Ported** |
| Capability-correction wording | **Adapted** to a property-tested function (`capabilityCorrection`) |
| Notion | **Mechanism established from code only; cause unproven**; bounded, resumable fix in place; no production read made; not claimed fixed |
| Backups: 7 verified dailies plus newest verified of the previous 8 ISO weeks | **Policy and pure planner ported; deletion is dry-run only** and needs the attended flag, both production flags and Grant's approval of the exact list |
| Team HQ chat dock vs reliability conversation work | **Reconciled and proved** (a replayed message is one command; a lost response is retried under one name; a second visit is the same conversation) |

## 4. Migration matrix

| Number | Name (short) | State |
|---|---|---|
| 1023, 1027 | efficiency (health read; pulse) | applied in production (record) and in repo |
| 1040, 1041 | Team HQ (backgrounds etc.) | applied in production (record) and in repo |
| 1042 to 1052 | the eleven reliability files (authored 1023 to 1035) | **committed, NOT applied** |

Replay, forward and rollback were rehearsed on replicas shaped like production (schema through 1041, then the eleven): the function-level rollback
(`scripts/release/make-function-rollback.mjs`, from a snapshot of the schema before) restored 1,100 definitions byte for byte (0 differ, 0 missing)
and left 34 additive functions. Tables, columns and triggers added by the migrations are intentionally left in a rollback (additive). A committed file is
not an applied one: `check:migrations` and `check:deployment-state` hold the repo against the ledger file, and the live ledger is read only by P01/P02.
Takeaway: never assume a higher number is free; the runner orders by filename and refuses an unapplied duplicate sequence.

## 5. Production service-version reconciliation

Per the deployment record (not live): worker v975 (6 Oct, from `9310116`), hq-api v899 (9 Oct), mcp v664, page `dpl_6zXtXeMzJVMLgh1S8kr2xy86Eu41`.
Not redeployed since 6 October: signin v129, voice v658, voice-token v687; the telegram, slack and google functions' live versions are UNKNOWN.
Which services the candidate changes against the deployed code (`npm run release:services -- --against <ref>`):

| Service | vs `9310116` (worker baseline) | vs `main` `b8ea3c0` |
|---|---|---|
| worker | DEPLOY (44 changed, 20 added) | DEPLOY |
| voice | DEPLOY | DEPLOY |
| signin | DEPLOY | DEPLOY |
| hq-api | DEPLOY | DEPLOY (`index.ts`, `src/text/file-text.ts`; the background library is already in main) |
| page | DEPLOY | DEPLOY (`app.js`, `bc/shell.js`, `bc/wire.js`, `call.js`, `chat.js`, `session.js`, `flow.js` added) |
| voice-token, mcp, telegram-webhook, slack-events, slack-oauth, google-oauth | unchanged | unchanged |

UNKNOWN until read: the live bundle of each service (a service the record calls "not redeployed" may hold older code than its stated commit; only
`capture:functions` settles that, a production read), the live `SIGNIN_ALLOWED_ORIGIN` (the signin deploy script sets a list that includes
`https://team-hq-ux-review.vercel.app`; whether production wants that origin is Grant's decision), and the truncated page rollback ids in the record.
Guard against an older artifact overwriting a newer service: `release:services` computes the set from the code, and `src/safety/provenance.ts`
requires a clean tree and a pushed commit for any deploy; deploy only from this branch's pushed head after it is the agreed release commit.

## 6. Integrated versus excluded

Integrated: section 3, plus the Team HQ gate additions (`layout-isolation`, `layout-cas`, `background-storage`, `chat-dock-browser`, `series-ui-browser`),
the renumbering, the corrected plan, the preflight and monitoring SQL (P01 expects 802/1041; M18 expects exactly 1042 to 1052), the rollback generator.
Excluded: efficiency 1024 to 1026, 1028 to 1031; any Notion write path; any backup deletion; any deploy or production read.

## 7. Team HQ preservation evidence (LOCAL replica, real Chromium unless noted)

The page diff against `main` is additive only (`app.js`, `bc/shell.js`, `bc/wire.js`, `call.js`, `chat.js`, `session.js`, new `flow.js`). The main suites
were re-run against the integrated candidate and returned exactly main's recorded counts: layout isolation 13, layout concurrency (CAS) 17, background
storage 40, the combined browser, chat dock 10, series UI 28; the Sample zero-write and office isolation proofs are in the critical gate. A stale
assertion in `combined-browser` (read the body, not the ADR-0068 menu) was corrected to read the menu. Simulated devices are not physical devices
(emulated 320, 360, 390 and 430 px widths and touch); nothing here is a physical-device claim. Known: the project name is 54px at 320px (#453, identical on `main`).

## 8. Notion and Telegram decisions and measured outcomes

Notion: the failing duty's mechanism is understood from the code and the handler's own history, the cause in production is unproven (no read allowed);
the integrated fix is bounded and resumable, so a stuck run cannot repeat forever; it is not claimed to fix production. Telegram: the chief routes, a
specialist addressed directly is answered by that specialist, the reply goes through the bot that received it, transport identity is unchanged; proved
on replica journeys (`v1-acceptance-a/b`). The enabled-bot fact (only the pager) is from a 7 October read and is re-checked by P11.

## 9. Real-model acceptance (REAL MODEL, replica, isolated, bounded)

198 calls, about US$0.0216 (free-tier chain, primary `openai/gpt-oss-120b`). The deterministic properties held. Observed misses, recorded not hidden: the
primary denied a held document in 1 of 6 (R16) and once in R17 (about 2 of 13 this day, 0 of about 25 on 8 October; Issue #452, classified EXPECTED
STOCHASTIC VARIANCE with a mitigation proposed but not built) and one off-target fallback answer in R18 (known, #444). Scripted, replica, real-model and
production evidence are kept separate: no production model call was made.

## 10. Test results (commands, counts, limits)

| Gate | Result | Class |
|---|---|---|
| `npx tsc --noEmit` | 0 errors | local |
| `npm run lint` (`biome ci .`) | exit 0 | local |
| `npm test` (vitest) | 425 files, 6,702 tests passed | local |
| `npm run verify:critical -- --rebuild` | 66/66 proofs, 3,643 assertions | replica |
| `npm run verify:extended` | 73/73, 1,671 assertions | replica + browser |
| `npm run verify:gate-sabotage` | 16/16 sabotages caught (each shown to land) | replica |
| mutation campaign subset | 16/16 caught | local worktree |
| `check:migrations`, `check:secrets`, `check:templates`, `check:deployment-state`, `check:reachable`, `check:suite-offices`, `check:voice-sessions`, `check:door-origins` additions | green for what this branch changed | local |
Limitations: not run (production read needed) `check:office-conversion`, `check:gateway-wrappers`; red on unmodified `main` and left alone (#455): `check:branding`, `check:tokens`, `check:door-origins` (two scripts), `check:office-raw-sql` (74 vs baseline 68; three handler call sites), `check:voice-sessions` (two proofs). `combined-browser` at 320px has 2 reds identical on main. `verify:mytasks`, `gate:safe` and the Sample's production suites were not run (production). A sabotage that did not apply is not counted.

## 11. Remaining defects, ranked

1. **Unknown live production state** (the whole of outcome B): ledger, versions and origins are records until read.
2. Efficiency 1024 to 1031 will collide if resumed; 1030 would undo 1044 (#451).
3. Primary model occasionally denies a held document (#452).
4. My Tasks shows only Today, so a ticked series has no stop button until due (#450).
5. Pre-existing reds on main (#455); project name width at 320px (#453).
6. Gate candidate cache goes stale after a replica rebuild (#454).
7. Notion production cause unproven; Google revoked since 15 September (known).

## 12. Deployment order and rollback (NOT AUTHORISED; for the release decision)

Do not use the 9 October plan's order. Candidate order, to be confirmed by P01/P02 first: (1) authorised preflight reads (`V1-RELEASE-PREFLIGHT-QUERIES`), stop on
any mismatch; (2) capture rollback bundles and a function snapshot; (3) migrate 1042 to 1052; (4) M21 (would the new containment refuse a real recent delivery?); (5) deploy
worker, then hq-api, then voice and signin, then the page; (6) monitoring M queries. Rollback: functions by
`make-function-rollback.mjs` from the pre-migration snapshot; services from the captured bundles; page by the previous Vercel deployment. Migrations are
additive; data written is left.

## 13. Human-only verification

Grant to confirm: the target project and environment; the authorised reads and write window; the test destinations; the spend ceiling; whether production's
`SIGNIN_ALLOWED_ORIGIN` includes the review origin; a real Telegram and Slack message and a phone on real hardware; the backup list in the dashboard.

## 14. Recommendation

**B.** The candidate is coherent, passes every local, replica and browser gate this run could execute, and preserves the main baseline. It must not be released until
the preflight reads confirm the recorded production state (802 / 1041, service versions, no pending claimed deliveries) and Grant decides the questions in section 13.
Another engineering run is not required to reach B; a short authorised verification run is. **Approval needed from Grant:** production reads (preflight), then the
migrate and deploy window, separately; a merge to `main` is a separate release decision.

## Disclosed process slips

One Python heredoc edited `CLAUDE.md` during the conflict resolution; one `sed -i … /dev/null` and one `cat > /dev/null <<EOF` had no effect; Python heredocs wrote
scratch SQL under `/tmp` (not repository files); a foreground fetch was moved to the background by the harness. All repository edits otherwise went through Edit or Write.

---
Issues filed this run: #450 (My Tasks Today-only), #451 (efficiency migration collision), #452 (held-document denial), #453 (320px name), #454 (stale gate candidate), #455 (reds on main).
