# Final audit reconciliation

Source: `docs/testing/original-architecture-audit-bbe9956.md` (the original audit, committed verbatim). Candidate: branch
`claude/great-volta-v77py4`; production baseline at the start of this run was `main` = `311701cc` (migrations through 0626).
Migrations added: **0627-0632**, each with a rollback in `docs/final-audit/`.

## Verdict: AUDIT PARTIAL - 82 FINDINGS REMAIN

Not CLOSED. The original audit has 145 rows here (15 bugs, 24 debt items, 5 architectural defects, 11 missing capabilities,
7 future requirements, 14 verification gaps, 40 invariants, 10 migration slices, 19 issues it spawned). Class counts:

| Class | Rows |
|---|---|
| PRODUCTION-PROVEN FIXED | 20 |
| ISOLATED-PROVEN FIXED | 36 |
| SUPERSEDED | 0 |
| ACCEPTED-DEBT | 7 |
| STILL OPEN | 82 |
| **Total** | **145** |

Three of the rows that say STILL OPEN are not code: decisions (a) learning confirmation, (b) cross-project retrieval,
(c) whether autonomy gates proactive work, and #389 (which of four system duties may write unprompted) are Grant's, and are
presented in `docs/architecture-run-5/DECISION-389.md` without a recommendation being taken as his choice.

### The exact open identifiers
B8, B9, B10, #321, #307, #305, #365, #358, #338, #352, #369, #326, D1, D2, D3, D6, D7, D8, D9, D10, D11, D12, D14, D15, D16, D17, D18, D19, D20, D21, D22, AD1, AD3, AD4, AD5, invariant 2, invariant 3, invariant 4, invariant 6, invariant 7, invariant 14, invariant 15, invariant 17, invariant 19, invariant 20, invariant 21, invariant 22, invariant 23, invariant 27, invariant 28, invariant 29, invariant 34, invariant 36, invariant 37, invariant 40, V5, V7, V11, V13, V14, MC1, MC2, MC3, MC4, MC5, MC7, MC8, MC9, MC10, MC11, FP1, FP2, FP3, FP4, FP5, FP6, FP7, slice 2, slice 3, slice 6, slice 8, slice 9

The six rows Run 5 called open: A10 (#395, `check:callers`) **closed, exit 0**; D5 (#392.3 Slack workspace) **closed and
production-proven**; C10 (#393, file content is data) **tested in production by final-audit-live** (a stored file full of
instructions creates nothing); C11 (#390), C8 (#387) and C9 (#389) **remain open** - the last needs Grant.

## What this run closed
- 0627: one definition of "may this reach a destination" (`delivery_refusal` uses `deliverable_to`) - `check:callers` exits 0.
- 0628 + `src/jobs/checkpoint.ts`: a worker that lost its claim cannot park the job (#398); `pauseJob` falls back only on a
  missing fenced arity (42883), never on a stale-claim refusal.
- 0629: "a person asked" requires a trusted or harness origin (B11, including MCP); a job's parent is written once (B14);
  `project_delete` clears `autonomy_settings` (#343).
- 0630 + `slack-events`: an event or press from a workspace other than the installed one is acknowledged and stored nowhere
  (#392.3); the routing row is written before `enqueue_inbound` (B13).
- 0631: a parked obligation with no question waits on a person (V9); approve/decline lock the request (D23).
- 0632: an answer to a question whose job was called off is recorded and starts nothing (found by the second review).
- A forwarded turn is given `noneEntitled`, the silent twin of the consequence-bearing readers (class fix, not one writer).
- Every child-making and parking call in the handlers passes the claim; the architecture test's unfenced baseline is empty.
- The edge functions are scanned for direct sends (V8); `verify:isolated` and the live suites are in `npm run gate` (V3).

## Evidence
- Isolated: `scripts/isolated/run-all.sh` exit 0 (every suite on a fresh replica copy; new: audit-closure 26, job-fence 23,
  slack-sender 23, question-binding 37, forwarded-authority 8, ci-voice-ledger 9).
- Unit: Vitest 248 files / 3737 tests (before the last two additions, then 3 more); `tsc`, `biome ci`, `check:migrations`,
  `check:secrets`, `check:templates`, `check:pressable`, `check:consumed`, `check:gateway-wrappers`, `check:capabilities`,
  `check:undo`, `check:voice-sessions`: all exit 0. `check:callers` exit 0 (13 known, all baselined). `check:leaks` exit 0
  (new escapes 0; 121 sent messages traced, harness sent 0, unprovenanced 0).
- Sabotage: each newly closed guarantee was broken on purpose and went red (B11 incl. MCP, B14 trigger, slack_team_ok,
  D23 with two real connections, called-off in both functions that carry it, forwarded wiring, pauseJob fallback, pause and
  child claim fences, Slack routing order). Two first attempts stayed green through a second guard and were redone on both
  halves - recorded, not counted.
- Production (after 0627-0632, worker, slack-events deployed): `verify:final-audit-live` 35/35 (its first run failed once, on
  a probe that used the Supabase service JWT where the office bearer was meant - a harness defect, fixed and re-run);
  run1 15/15, run2 53/53, run3 26/26, run3-effects 12/12, run4 24/24, run5 20/20, upload 17/17.
- Real traffic, read-only, window 3 hours ending 18:10 UTC 30 Sep (the deploy sat 23 minutes before the end of it): 54 real
  jobs, 50 complete, 4 cancelled, 0 failed, 0 stuck over 30 minutes, 0 duplicate children under one parent.

## Deployments (Supabase function version before -> after)
| Function | Before | After |
|---|---|---|
| worker | 875 | 877 |
| slack-events | 604 | 606 |
| telegram-webhook | 626 (not redeployed; changed only in Run 5) | 627 |
| hq-api | 808 (not redeployed; unchanged) | 809 |

The platform's version counter moves on a secrets change as well as a deploy: after `deploy:worker` the listing read worker
876, telegram-webhook 627... then after `deploy:slack` 877/627/606/809, with telegram-webhook and hq-api never redeployed from
here. Observed directly: slack-events 604 before its deploy. Worker's "before" (875) is inferred as one below the first
listing after its deploy, because the listing endpoint was unreachable from the sandbox before it. The earlier-recorded
874/807/625/603 were each one lower than the values read in this run.

## Review findings and their disposition
Two independent rounds were run with the prompt "assume the team is incorrectly claiming the original audit is closed".
Fixed: the forwarded-turn class (A3), the claim on `pause_job` and on the extract child (A1/A2), the called-off question
(B1, migration 0632), the GATE entry naming no script, the Slack routing order, the office-key probe. Recorded and **not**
fixed, each as residual debt and none claimed closed: `verify:approval` still builds one fixture by hand (A7); the
Telegram voice path still dispatches for a declared test origin (B2); final-audit-live's strength findings (A4/A5) were
addressed only for the office-key probe - the rest of its checks are as written.

## Known debt disposition
#398 closed. #397 (dashboard/voice binding): covered by question-binding cases (intervening turn, 13 hour stale), no live
channel for voice - open for voice only. #392: Slack team_id closed; Telegram shared secret is possession, not identity -
the live suite proves an unknown sender with the right secret stores nothing; the secret's rotation is Grant's. #393: closed
as behaviour (data is not authority). #389: **not decided** - options in DECISION-389.md. #395: closed.

## The matrix
Columns: Finding | Original problem | Class | Evidence | Debt / residual. One row per original finding; none merged.

### B

| Finding | Original problem | Class | Evidence | Debt / residual |
|---|---|---|---|---|
| B | No sender authorization below the door; any Telegram private chat attributed to 'grant' | PRODUCTION-PROVEN FIXED | I ran `sender-authorization` 39/39 (recorded 8/31 red at baseline, 31/31 after) and `slack-sender` 17/17. Live: `scripts/verify/run1-live.ts` checks "0607 a stranger in a private chat is ignored and changes nothing", "up | Telegram bar is still shared webhook secret + public user id, no replay protection (#392.2 AD); Slack `team_id` unbound (#392.3 OPEN) |
| B | Approver identity: `options.subject ?? 'grant'`; `hq_answer_blocker` takes no identity; `p_by='grant'` | PRODUCTION-PROVEN FIXED | I ran `approver-identity` 44/44 (3 sabotages recorded red). Live run1-live "0608 unauthenticated answer refused", "office key cannot answer naming itself grant", "signed-in answer recorded as verified principal"; run2-li | bearer token is a service principal, gateway authority setters rely on gateway alone (#390 OPEN) |
| B | bare "No." claimed by `rejectsWithoutSaying` | PRODUCTION-PROVEN FIXED | I ran `open-question` 48/48 (6 red at baseline per Run 1 doc; the "nah with NOTHING waiting" negative control passes). Live run1-live: bare "No." resolves blocker, reply "Taken as a no" | none found |
| B | fan-in synthesis attempt starvation | ISOLATED-PROVEN FIXED | I ran `fan-in-waits` 6/6 (includes "provider outage is not refunded"). Not driven live (Run 1: function-body identity only) | `resume_job` still refunds for the two bounded waits, fence paused clause ambiguous there (#398.5) |
| B | `governOutward` "Yes, do it" performs nothing (`approval.ts:291`) | ISOLATED-PROVEN FIXED | I ran `outward-options` 12/12 (decline -> next run does not go ahead). Not live | none known |
| B | `channels.ts:159`/`drive.ts:346` options 2/3 promise things nothing performs | ISOLATED-PROVEN FIXED | I ran `drive-options` 4/4, `channel-options` 4/4; `check:answerable` exists as the structural guard (#366, per CLAUDE.md) | not driven live |
| B | `perform.ts:841` swallowed `raiseBlocker` failure | ISOLATED-PROVEN FIXED | I ran `blocker-failure` 7/7. (The Run 5 reconciliation table says "run1 live" for this row; I found no matching check in run1-live.ts, so I do not credit it as PP) | none known |
| B | `blocked_capability` unreachable (`instruction.ts:5244`) | STILL OPEN | `git show bbe9956c:...` line 5244 vs now 5341 identical; grep shows one producer. Unit tests only exercise the classifier with a supplied flag | A genuinely unsupported capability falls to `blocked_needs_user` (honest but less precise). Design comment at outcome.ts:252 argues the fallback is deliberate, but no ADR/decision records leaving the producer unwired |
| B | skills stored without a press (`remember.ts:381`) | STILL OPEN | file not in `git diff --stat`; audit itself says "Decision needed from Grant (not an engineering call)"; no ADR/DECISION doc found deciding it | still write-then-say-back, same as marked lessons |
| B | `guidanceFor` `stated` = "not a staff slug" | STILL OPEN | The audit's exploit (stranger's "always" stored as Grant's) needed B1; B1 is fixed so the stranger path is closed (PP). The derivation itself is still a proxy: any non-staff author, e.g. a future `duty:`/system writer, w | smallest fix: select `learned_by` against the admitted-subject set (`subject_identities`) instead of "not staff" |
| B | `may_act` "a person asked" true for `trigger:`/`mcp:`/`hq` requesters | PRODUCTION-PROVEN FIXED | 0629: may_act asked-for requires origin trusted/harness. audit-closure (trigger:/mcp:/hq/duty: ask; own words and harness proceed), sabotage red; live: final-audit-live. Production: final-audit-live 35/35 (asked-for verd | |
| B | TS `attempt < 4` vs SQL `max_attempts` | ACCEPTED-DEBT | The retry cap of 4 for a model call is a recorded decision (ADR-0057); the job ceiling is max_attempts (0620 settle_exhausted_jobs). | constants remain: `instruction.ts:6393` `job.attempt < 4`, `outcome.ts maxAttempts: 4`, worker.ts:478 `>= 4` - a job with max_attempts > 4 is still capped at 4 by design |
| B | Slack door calls `enqueue_inbound` before writing `inbound_commands_slack` | ISOLATED-PROVEN FIXED | slack-events writes the routing row before enqueue_inbound; vitest order test, sabotage (swap) red. | |
| B | unbounded `harness_job` recursion (cycle), three unaligned depth limits | PRODUCTION-PROVEN FIXED | 0629: a job's parent is written once; audit-closure, sabotage (trigger dropped) red; live: final-audit-live. Production: final-audit-live (re-parent refused on the live database). | |
| B | task-tick door race/bypass | PRODUCTION-PROVEN FIXED | I ran `refusal-reversal` 41/41 ("to-do tick does not call it - trigger body scanned", "ticking a to-do does not reopen a No") and `approval-execution` 15/15; `authority.ts` section 6 (88/88 recorded) and `approval-race.s | none found |

### D

| Finding | Original problem | Class | Evidence | Debt / residual |
|---|---|---|---|---|
| D | three "his words" variants, 74 raw reads | STILL OPEN | `turn-entitlement` 12/12 (hostile resolver; baseline 9/12 per Run 1), vitest turn (31), gates (21), `@ts-expect-error` brand test; Run1-live 14/14 | the bare name `instruction` is still read ~126 times and `firstOf`/`firstOfHis` helpers remain (3314, 3392); typing only binds the ten readers in `entitled.ts` (import barrier), not every reader |
| D | four clause segmenters | STILL OPEN | none; no commit touches it | maintenance, but it is the reason invariant 4 (mixed intents) is still only proven for the answer+request shape |
| D | 4,502-line single closure, ~16 writers, `isBranch` 21 sites | STILL OPEN | none (no decision); entitlement + gate precedence contain the risk, not the size | maintenance, not material to an invariant |
| D | `understand` fast path, `kind` mostly `other` | ACCEPTED-DEBT | ADR-0052 "Moving understand earlier was deliberately NOT done (model call on simple turns); recorded as engineering debt"; Run 1 residual R1 | `understand` still runs after the plan/populate/teach early returns |
| D | permitting readers read the paraphrase (`linkRequest`, `pageRequest`, `readPlan`) | PRODUCTION-PROVEN FIXED | 0630 + slack-events: events and presses from an unrecognised workspace are refused; live: final-audit-live (wrong workspace, no team, right workspace unknown user). | |
| D | lifecycle copies (`states.ts`, ~18 SQL lists) | STILL OPEN | `tests/jobs/states.test.ts` pins TS to spec; no check that the SQL lists agree | maintenance; risk is a state added in one place |
| D | `enqueue_child` non-idempotent on retry; `pinned_config` not inherited | STILL OPEN | Caller fence closed (0625/0628, #398; every child-making and parking call passes the claim; arch test baseline empty). Retry-idempotence of enqueue_child is via enqueue_child_once where used. pinned_config inheritance un | `agents/perform.ts:538` step passes no caller (named in arch test); `pinned_config` routing keys (`command_id`, `addressed_to`) still need a lineage walk |
| D | "who was asked" in five places | STILL OPEN | none | maintenance |
| D | `waiting_user`/`waiting_external` dead states | STILL OPEN | Run 4 doc confirms "nothing writes them"; no test | touches invariant 29 (per-state recovery; remove/wire dead states); approvals still have no expiry path (no writer of `expired`) |
| D | `staff_prompts` decorative | STILL OPEN | `pg_proc` scan on m626 | maintenance |
| D | lessons/skills reach only the answering prompt | STILL OPEN | grep | synthesis/report/notebook prompts do not see standing rules |
| D | only-chief-speaks at several seams | STILL OPEN | grep | maintenance; behaviour unchanged |
| D | ADR-0023 default gives new specialists every project | ACCEPTED-DEBT | ADR-0023 is the decision; tool authority is now runtime-checked (`authorize_effect` requires the named specialist to hold the tool: `authority` 88/88) so the default grants project reach, not tool authority | dynamic-specialist routing by project default untested (invariant 38 router half) |
| D | `skill_effect` unread; perf per model only | STILL OPEN | grep + `pg_proc` scan | maintenance |
| D | dead `src/projects/context.ts` | STILL OPEN | grep | dead code |
| D | duplicated enumerations (job state, channel/origin) no agreement check | STILL OPEN | `containment-wiring.test` runs real keys through `ADAPTER_SHAPE`; `legit-origins` 24 through SQL; no single agreement test | partial cross-checks only |
| D | three harness predicates + 6 name signals | STILL OPEN | `synthetic-origins` 36/36, `job-origin` 22/22, `witness-independence` 12/12 | fail-closed, so a miss costs a refusal, not a leak; 0627 (#395) is landing on top |
| D | `verify:*` run on production and leave debris | STILL OPEN | `tests/scripts/door-origins.test`, run1..5-live teardown assertions | the other ~220 legacy suites unchanged; Run 4 Phase 0 moved eleven; it is a process hazard, not a runtime invariant |
| D | three "plan" vocabularies | STILL OPEN | none | maintenance |
| D | `step_begin` stale check compares only `schema_version` | STILL OPEN | `exactly-once` 6/6; my sabotage (code check removed) -> 5/6 red | - |
| D | `voice` vs `teamhq` channel word | STILL OPEN | none | cosmetic/two words for one surface; `adapter_key_ok` depends on it |
| D | `inference/policy.ts decide()` has no caller | STILL OPEN | grep | dead code |
| D | `approve_tool/decline_tool` unlocked | ISOLATED-PROVEN FIXED | 0631: approve_tool/decline_tool lock the request; audit-closure races two real connections with a widened window; sabotage red. | |
| D | unledgered sends (vault export, webhook refusal) | ACCEPTED-DEBT | The edge functions are now scanned (V8, containment.test); the single direct send is the dormant voice-refusal reply, named with its reason (ADR-0057). | both paths dormant (`voice.transcription='api'`, export disabled) per #378 audit; invariant 32/33 "supabase/functions scan" not done |

### AD

| Finding | Original problem | Class | Evidence | Debt / residual |
|---|---|---|---|---|
| AD | no entitlement-typed record of what Grant said; no precedence for turn gates | STILL OPEN | `turn-entitlement` 12/12, `mixed-turns` 12/12 (with negative controls), `open-question` 48/48 (B3), vitest turn/gates incl. import barrier; run1-live 14/14 through deployed doors (bare No, yes+remind, qualified yes, noth | Invariant 4 not evidenced: no plan+preference+question case (audit example) - `readPlan` still early-returns on the whole message (instruction.ts:3025); mixed-turns covers answer+request with a degraded model only; compe |
| AD | conversation identity = channel identity | ACCEPTED-DEBT | `question-binding` 33/33 (cross-channel plain yes answers nothing; both shown -> once), run5-live 20/20 recorded | The phrase is narrowed, the architecture is not changed: the decision protects approvals, not context continuity. If Grant wants invariant 6 it is unbuilt [invariants: 6 (cross-interface continuation), 2 partly; invarian |
| AD | no single authority path for effects; dial and `staff_may_use` not enforced at execution | STILL OPEN | `authority` 88/88 (five sabotages red per Run 2), `approval-binding` 30/30, `exactly-once`, run2-live 53/53, run3-effects-live 12/12 (recorded) | Not behind it: Notion write/sync, Slack and Telegram sends, browser gather, tasks, PDF, the four system duties (#389, awaits Grant), attach-from-link (#393), `google.revoke`/gateway setters (#390); `suggest == act_with_r |
| AD | approval has several lifecycles; binding exact action only in one | STILL OPEN | `approval-binding` 30/30, `approval-execution` 15/15, `refusal-reversal` 41/41, `typed-yes` 9/9, `question-binding` 33/33, `approver-identity` 44/44, `job-fence` 18/18, `approval-race.sh` (recorded); function-level PP vi | No expiry path exists (nothing writes `expired`; answerable days later); tool approvals (M5), standing rows (M6), document/suggestion review (M7) are still separate mechanisms without fingerprints; dashboard/voice typed- |
| AD | trust/origin of non-inbound roots from a mutable free-text grammar; harness by six name signals | STILL OPEN | `job-origin` 22/22, `synthetic-origins` 36/36, `witness-independence` 12/12 (breaks the guard on purpose), run4-live 24/24 (2,196 roots stamped), `check:leaks` exit 0 recorded | Escape class is closed by fail-closed positive origin, not by removing name-based classification; a free-text `requested_by` can still match `internal_root_ok`; exact impersonation with the service key is the stated limi |

### MC

| Finding | Original problem | Class | Evidence | Debt / residual |
|---|---|---|---|---|
| MC | cross-project retrieval with provenance/permissions; derived ContextPack | STILL OPEN | `pg_proc` query; grep for ContextPack finds only AUTONOMOUS-RUN / audit text. Slice 9 (below) not started. | Product capability, not an architectural defect. It depends on Grant's decision 47(b), which is pending. |
| MC | MCP `tools/call` executor | STILL OPEN | callTool" src` returns nothing. Offered tools are disabled by default. | STILL OPEN |
| MC | planner executors for external writes (#285 breadth) | STILL OPEN | source read, line 165-486. | Product capability, not an architectural defect. Run 3 bound `notebook.*` and `execute_plan` through handlers, not through planner executors. |
| MC | agent-initiated lesson/skill candidate flow; skill proposal; `skill_effect` consumer | STILL OPEN | grep and `pg_proc` query. | Product capability. The `remember()` skill-store-without-a-press item is a BUG listed elsewhere in the audit (section 20), not in this group. Learning-confirmation policy 47(a) is pending. |
| MC | specialist-initiated delegation; Claire-created specialists (proposal press) | STILL OPEN | grep and `pg_proc` query. | Product capability. The audit's slice 8 prerequisites (roster ceilings as data, new-specialist project default off) are not done. `ROSTER_CEILINGS` is still TypeScript at `router.ts:345`. |
| MC | cross-channel conversation/scope | ACCEPTED-DEBT | `docs/architecture-run-5/CROSS-CHANNEL.md` ("a decision, not an omission"); ADR-0056 §2; isolated `question-binding` 33/33, `run5-live` 20/20. | The decision is recorded, but its text covers what a reply may answer. It does not explicitly address cross-channel conversation history (`conversation_before`), which the audit's AD2 also named. The ADR says "none is in |
| MC | expiry/escalation/reconcile for non-resumable pauses and blockers | STILL OPEN | `pg_proc`, `obligation_state` body (no paused/non-resumable branch), `resumable_now` body. | ARCHITECTURAL (lifecycle). A non-terminal state with no exit or escalation falsifies the audit's invariants 34-36. Listed in section D. |
| MC | editable autonomy matrix UI/action | STILL OPEN | grep. | Product capability. ADR-0035's "Grant can change a cell" remains documentation drift. |
| MC | spend reporting (#284); feedback consumption (#353) | STILL OPEN | source and script read. | Product capability. The baseline entry records a reason; no decision to leave it unbuilt. |
| MC | general temporal slot in turns | STILL OPEN | `src/agents/turn.ts` has no temporal field; the audit's section 10 claim still holds. | Product capability. |
| MC | per-agent-per-project experience record | STILL OPEN | no table (`information_schema` query for 'experience' returns nothing; `public.lessons` is scoped global/project/staff). | Product capability. |

### FP

| Finding | Original problem | Class | Evidence | Debt / residual |
|---|---|---|---|---|
| FP | tenant/user seam; per-user lessons, vault, config, RLS | STILL OPEN | No `tenant_id`/`office_id` column anywhere (grep and `information_schema`). `lesson_scope` = global/project/staff, no user. `'grant'` literals remain. No lint against new literals. | `office_members` and `subject_identities` exist for sign-in and sender admission only. |
| FP | per-user approval authority; sender allowlists per adapter | STILL OPEN | Sender allowlists are done for single-user: Telegram 0607 (sender-authorization 31/31, run1-live 14/14), Slack 0615 (slack-sender). Approver is a named principal (0608, 0614). Per-user authority: nothing. | The allowlist half was pulled forward as a security fix (audit B1), not as a product feature. |
| FP | stored/derived obligation summary with owner and result-delivered | STILL OPEN | `app.obligation_state` and `obligation_tree` (0562) exist from before the baseline. No `obligation_summary(root)` API for Claire. | The non-resumable pause gap (MC7) sits under this. |
| FP | per-person board arrangement (#341) | STILL OPEN | `dashboard_layouts(owner, project_id, surface, panels)` exists (ADR-0021). Nothing multi-person beyond the `owner` column. | |
| FP | Gmail intelligence (#172) | STILL OPEN | Mail derivation and `mail_awaiting` exist (ADR-0037/38). The #172 feature set is not scheduled. | |
| FP | shared-project membership/visibility | STILL OPEN | `project_staff` only, with ADR-0023 "absence means everyone". No people membership. | |
| FP | per-user Claire configuration | STILL OPEN | `staff`, `staff_prompts`, `tool_permissions` are global. | |

### V

| Finding | Original problem | Class | Evidence | Debt / residual |
|---|---|---|---|---|
| V | Gate-order test | ISOLATED-PROVEN FIXED | `gates.test.ts` truth table (21), `mixed-turns` 12/12, `open-question` 48/48 (6 red on baseline). | none |
| V | Poison-job queue suite | ISOLATED-PROVEN FIXED | `recovery-matrix`, `drain-survives-sweep`, `verify:worker` (live, off-gate). No single suite, not on the deployed worker. | One poison-job suite through `drain`. |
| V | Isolated replicas not in the gate | ISOLATED-PROVEN FIXED | `npm run gate` now contains verify:isolated (scripts/isolated/run-all.sh) and the live acceptance suites; it fails loudly without the replica. | |
| V | "Permitting reader never sees the paraphrase" seam tests | ISOLATED-PROVEN FIXED | `turn-entitlement` 12/12 (hostile resolver, baseline 9/12), `gates` import barrier, vitest `a-veto-reads-his-words`. | none |
| V | Behavioural replacements for source-text invariants | STILL OPEN | | Convert the named ones (one live attempt, a duty says it once, a dead turn speaks, ADR-0018 no agent path calls `approve_tool`); add a sabotage-must-land harness. |
| V | Option answers undriven; refused+empty replan; tick vs dashboard race | ISOLATED-PROVEN FIXED | | The refused+empty case. |
| V | SQL/TS enumeration agreement | STILL OPEN | | One check reading the constraint and the TS list. |
| V | `supabase/functions/**` bare-send scan | ISOLATED-PROVEN FIXED | tests/jobs/containment.test.ts scans supabase/functions; a planted send and a removed exception both turn it red. | |
| V | Non-resumable pause reads `working` | ISOLATED-PROVEN FIXED | 0631: obligation_state reads waiting_on_user for a non-resumable pause with no question; audit-closure; sabotage red. | |
| V | Stranger-sender refusal | PRODUCTION-PROVEN FIXED | `sender-authorization` 39/39, `slack-sender` 17/17, `principals` 70/70; recorded live in `run1-live` and Run 3. | The Slack `team_id` half (#392) is separate and open. |
| V | `jobs.project_id` non-null for real work | STILL OPEN | | Invariant 3. |
| V | Synthesis wait over 5 wakes | ISOLATED-PROVEN FIXED | `fan-in-waits` 6/6 (on m626 + 0628); `job-fence` 23/23. | none |
| V | Planner path through real Telegram/Slack | STILL OPEN | | A planner turn through `telegram-door` with a scripted model. |
| V | Fresh-office migration build (#344) | STILL OPEN | | Make the zero-state build a check; split data assertions from DDL. |

### INV

| Finding | Original problem | Class | Evidence | Debt / residual |
|---|---|---|---|---|
| INV1 | Every human turn enters one semantic boundary | ISOLATED-PROVEN FIXED | `turn-entitlement` 12/12 (a hostile resolver cannot start a plan, link, task, rule or call-off; baseline was 9/12), `mixed-turns` 12/12, vitest `turn`, `gates`. Import barrier in `gates.test.ts` is source text. | (Optional) a door-parity check: drive each door's enqueue and assert the same entry handler. |
| INV2 | Claire remains human-facing owner | STILL OPEN | Only `tests/telegram/message.test.ts`. Nothing on Slack or dashboard. | Write the persona rule once at the delivery layer; enumerate exceptions; one test per channel. |
| INV3 | Every obligation belongs to a project | STILL OPEN | None for a NOT NULL. | Backfill to Unnamed, then NOT NULL, or a CHECK. Null-project retrieve must be refused. |
| INV4 | Mixed intents survive | STILL OPEN | `mixed-turns` covers yes/no plus ONE remainder (reminder, preference), qualified yes. No plan+preference+question table. Run 1 lists the degraded-model "several clauses become one mangled title" bug as open. | A clause table (plan, preference, question, task) asserting each clause is executed or dropped-and-said, through the real handler. |
| INV5 | Corrections/cancellations govern the right span | ISOLATED-PROVEN FIXED | Pure-function tables plus a hostile-resolver suite. The only integrated "withdrawn work not performed" run was a manual degraded-model pass (Run 1 phase 12). | Add one replica test that sends a withdrawal through the handler and asserts no task or plan was created. |
| INV6 | Cross-interface continuation locates the same context | STILL OPEN | `question-binding` 33/33 proves the safe side for questions. Nothing asserts same person/project/prior-work across Team HQ, Telegram and Slack. | Decide whether per-channel conversation is the intended model (then record it as ACCEPTED-DEBT). Otherwise a scope-continuity suite. |
| INV7 | Every root objective has durable ownership | STILL OPEN | Probe: an ambiguous-effect pause with no blocker reads `working`. `verify:obligation` exists but is not in the gate. | Teach `obligation_state` the pause reasons (`needs_reconciliation`, `credential_required`, `checkpoint_stale`) and cover duty roots; add a replica test. |
| INV8 | Human tasks and AI jobs distinct | PRODUCTION-PROVEN FIXED | `verify:tasks`, `verify:mytasks` (both in the gate); `authority` section 6 (tick). | none |
| INV9 | Child inherits project | ISOLATED-PROVEN FIXED | audit-closure: child inherits project; an explicit project is honoured; sabotage (coalesce removed) red. | |
| INV10 | Child inherits user/tenant | ISOLATED-PROVEN FIXED | audit-closure: a child inherits the user of its parent (the user half); the tenant half is invariant 40 and stays open under it. | |
| INV11 | Child inherits security/synthetic | PRODUCTION-PROVEN FIXED | `synthetic-origins` 36/36, `job-origin` 22/22, `containment` 19/19, `external-containment`, all sabotaged; `check:leaks` and `verify:escapes` are in the gate. | none |
| INV12 | Child inherits provenance | ISOLATED-PROVEN FIXED | `job-origin` 22/22, `forwarded-authority` 8/8. | List the `pinned_config` keys read in `src/` and assert each is either lineage-derived or explicitly not inherited. |
| INV13 | Specialist identity survives delegation | PRODUCTION-PROVEN FIXED | `verify:handoff`, `verify:delegation`, `verify:collaborates` are all in the gate. | none |
| INV14 | Specialists collaborate without losing root ownership | STILL OPEN | `verify:collaborates` (gate) proves real hand-off, bounded depth. Nothing asserts "no dual answer". | One assertion: a fan-out obligation yields exactly one delivered answer to the requester. |
| INV15 | Fan-in produces one coherent result | STILL OPEN | `fan-in-waits` 6/6 (9 wakes against a ceiling of 5, on m626 + 0628). No test of "one delivered answer per obligation". | Same assertion as 14, on the delivered-answer side. |
| INV16 | Project retrieval preserves provenance | PRODUCTION-PROVEN FIXED | `verify:knowledge`, `verify:unified` in the gate. | none |
| INV17 | Cross-project retrieval preserves provenance and permissions | STILL OPEN | None. | Needs Grant's decision (b) first (open-by-default vs opt-in), then a derived reader and a negative control. |
| INV18 | Skills cannot grant authority | PRODUCTION-PROVEN FIXED | `verify:skills` (most-persuasive-skill), `boundary` are live, not in the gate. I confirmed the columns. | Move `verify:skills` into the gate. |
| INV19 | Learning cannot silently create durable preferences | STILL OPEN | `forwarded-authority` 8/8, `sender-authorization` 39/39. Nothing for the marked path. | Grant decides (a); then one confirmation policy plus tests on the marked and skill paths. |
| INV20 | One authoritative tool-permission path | STILL OPEN | `authority` 88/88 (matrix, `staff_tools` grant/revoke altering the outcome). | Close the set in 22. |
| INV21 | Unsupported capabilities produce truthful outcomes | STILL OPEN | `verify:capability-claims` and `check:capabilities` in the gate. `blocked_capability` is unreachable in production. | Wire `capabilityRefused` from the planner's "granted but nothing performs it" result; add a reaching test. |
| INV22 | Consequential actions cross authorization | STILL OPEN | `authority`, `approval-binding`, `exactly-once`, `vault-export-door`. Nothing for the unmigrated kinds. | Grant decides #389 and #393. Then `mayWrite`/`governOutward` plus `claimExternal` per duty, and a check deriving external kinds from the registry. |
| INV23 | Approval binds the exact action | STILL OPEN | `approval-binding` 30/30 (changed-action refused), `approval-execution` 15/15, `question-binding` 33/33. No changed-action test for `drive.ingest`, `governOutward` or the system duties. | Fingerprint and a changed-action test for `drive.ingest` and the calendar duty. |
| INV24 | Yes executes at most once | ISOLATED-PROVEN FIXED | `approval-race.sh` (base shows 2, post shows 1), `exactly-once` 6/6 (two racing workers, `local` control), `approval-execution` 15/15, `job-lifecycle` 27/27. | none beyond 22 |
| INV25 | No executes zero times | ISOLATED-PROVEN FIXED | `refusal-reversal` 41/41, `approval-execution` (NO performs nothing), `open-question` 48/48, `mixed-turns`. | none beyond 22 |
| INV26 | Refusal cannot be replanned around | ISOLATED-PROVEN FIXED | `refusal-reversal` 41/41, `approval-execution` ("does not re-plan into asking again"), `authority`. A different action asks afresh by design. I found no explicit "refused + empty replan" test (V6). | Add the refused-and-empty replan case. |
| INV27 | Completed checkpoint work not repeated | STILL OPEN | `exactly-once` 6/6 and `approval-binding` cover the checkpointed set. A crash between remote upsert and `task_pushed` duplicates the remote task (recorded hazard, `DECISION-389.md`). | Checkpoint the remaining external writers, or record the hazard per duty as ACCEPTED-DEBT. |
| INV28 | Ambiguous external effects reconciled | STILL OPEN | No per-handler crash-after-effect suite. | A gateway action plus function that resolves a `needs_reconciliation` pause (done or not done), attributed to a person, with a crash-after-effect test per external handler. |
| INV29 | Every legal nonterminal state has recovery | STILL OPEN | `recovery-matrix` (every stallable state, including one malformed row; run-all reports PASS), `drain-survives-sweep`, `job-lifecycle` 27/27. I did not re-run the matrix (its DB names are outside the `cls3_` prefix). | Remove or wire the two dead states; add expiry or escalation for non-resumable pauses and blockers; a per-state test. |
| INV30 | One malformed job cannot stop unrelated work | ISOLATED-PROVEN FIXED | `recovery-matrix` (malformed row beside a healthy job), `drain-survives-sweep` (worker half), `verify:worker` (throwing handler goes to `retrying`; unknown kind pauses and leaves the queue). `verify:worker` is live and n | One suite: a poison payload, a throwing handler and a healthy job together through `drain`. |
| INV31 | Synthetic descendants remain synthetic | PRODUCTION-PROVEN FIXED | `synthetic-origins` 36/36; `check:leaks`, `verify:escapes` in the gate. | none |
| INV32 | Synthetic cannot reach real destinations | PRODUCTION-PROVEN FIXED | `containment` 19/19, `external-containment`, `destination-retirement`; live `verify:escapes`, `check:leaks` (gate). The `supabase/functions` bare-send scan is missing (V8). | Close V8 (scan `supabase/functions`). |
| INV33 | Containment has an independent witness | ISOLATED-PROVEN FIXED | `witness-independence` 12/12 (isolated only, not in the gate). | Move `witness-independence` into the gate (V3). |
| INV34 | Completion claims require canonical evidence | STILL OPEN | `verify:attests`, `verify:capability-claims` (gate); many vitest files. | A state-gated backstop: no completion wording unless `obligation_state` or a delivery row supports it. |
| INV35 | Partial completion reported as partial | PRODUCTION-PROVEN FIXED | `verify:obligation` (live; not in the gate). | Put `verify:obligation` in the gate. |
| INV36 | Claire can determine the state of an active obligation | STILL OPEN | Probe: `obligation_state` reads `working` for an ambiguous pause. | Expose `job_situation` through a gateway section and the "what is happening" answer; fix 7. |
| INV37 | Proactive work obeys authorization and notification | STILL OPEN | `verify:chatter`/`check:chatter` (gate), `refusal-reversal` (duty stays quiet after a No). | Grant decides #389; gate each duty. |
| INV38 | Dynamic specialists cannot self-grant authority | ISOLATED-PROVEN FIXED | `authority` (a specialist with no grant is refused; grant and revoke change the outcome), 88/88. | Re-test when MC5 is built. |
| INV39 | Skill improvement cannot self-grant authority | PRODUCTION-PROVEN FIXED | `verify:skills` (live, off-gate). | Test the proposal path when built. |
| INV40 | Credible tenant/user-isolation path | STILL OPEN | `sender-authorization` 39/39, `slack-sender` 17/17 cover the door only. | Write the seam ADR and a lint for new `'grant'` literals (the audit's slice 9 asks for the ADR only). |

### SLICE

| Finding | Original problem | Class | Evidence | Debt / residual |
|---|---|---|---|---|
| SLICE0 Triage B1-B7 | sender allowlist, approver identity, bare "No.", fan-in attempts, "Yes, do it", Drive/channel options, swallowed `raiseBlocker` | PRODUCTION-PROVEN FIXED | Run 1 table: sender-authorization 31, approver-identity 39, open-question 48, fan-in-waits 6, outward-options 12, drive-options 4, channel-options 4, blocker-failure 7; `verify:run1-live` 14/14 on production (ARCHITECTUR | done. Residuals R9 (`staff_for_bot` 200 "ignored") was later fixed to 503 in Run 3 (EFFECT-DOORS table). |
| SLICE1 Turn value | `buildTurn`; `said`/`kept` the only permitting inputs; `resolved` routing-only | ISOLATED-PROVEN FIXED | `turn-entitlement` 12/12 (baseline 9/12), vitest `turn` 31, `gates` barrier test; hostile-resolver control not live-safe (ARCHITECTURE-RUN-1 section 11) | done. The audit's exit "raw reads <= handful" is not literally met; the barrier is the import block on `entitled`, which is what the audit asked for. |
| SLICE2 Gate precedence + mixed turns | one ordered gate table; `readPlan` output one of the clauses; `understand` moved above early returns | STILL OPEN | `gates` 21, `mixed-turns` 12/12, `open-question` 48/48. ADR-0052: moving `understand` "deliberately NOT done", recorded as debt. Run 1 residuals R1 (understand placement), R2 (degraded multi-clause title), R3 ("Save this | partly. The understand-placement sub-item is a recorded decision (ADR-0052), i.e. ACCEPTED-DEBT for that part only. Plan + preference + question mixed turn not solved. |
| SLICE3 Authority path | `app.authorize_effect`; `staff_may_use` at runtime; contacting a human = ask; `may_act` from job origin | STILL OPEN | `authority` 88/88 (**re-run by me on m626 = 88/88**), `authority-characterization` 18, `refusal-reversal`, `run2-live` 50/50, re-run 53/53 on production. Five sabotages red | partly: PRODUCTION-PROVEN for plan steps, calendar duty and `drive.ingest` only. Not behind the boundary (EFFECT-DOORS.md and ARCHITECTURE-RUN-2): `tasks.sync`, `office.provision_channels`/`rename_channels`, `office.noti |
| SLICE4 One approval API | fingerprint-bound blocker for all mechanisms; `raise_approval`/`answer_approval`; task tick delegates; durable No | PRODUCTION-PROVEN FIXED | `approval-execution` 15, `approval-binding` 30/30, `approver-identity`, `refusal-reversal`, `question-binding` 33; `run2-live` 53/53 + `run3` + `run5-live` 20/20 on production | done for the blocker lifecycle; partly for all mechanisms. Residuals: "Ignore these" No on `drive.ingest` not durable (EFFECT-DOORS); dashboard/voice bind by session and previous turn only (#397); isolated approval suite |
| SLICE5 Stored origin | `jobs.origin` once, inherited, immutable; `harness_job` a read of it, legacy signals retired after parity | PRODUCTION-PROVEN FIXED | `job-origin` 22/22 (**re-run by me on m626 = 22/22**), sabotages S3, S18, S19; `run4-live` 24/24 on production; witness-independence 12 | partly. Trust/origin source = done (AD5's core: stored once, immutable, not from a free-text grammar). Harness classification is not converted to a read of the stored column, and the legacy name-based signals are not ret |
| SLICE6 Lifecycle single source + recovery | SQL generates TS `states.ts`; `assertTransition` wired or deleted; no `attempt<4`; expiry/escalation for non-resumable pauses and blockers; `obligation_state` r | STILL OPEN | `job-lifecycle` 27, `job-skew` 4, `job-delegation` 11, `recovery-matrix`, `run4-live` 24/24 on production; poison-job suite: none | partly. Recovery of stranded jobs = PRODUCTION-PROVEN. Expiry/escalation/reconcile is not started. |
| SLICE7 Conversation across channels | `app.conversation_of` derived from person + recency + global scope; `voice_answer` through a job | ACCEPTED-DEBT | ADR-0056; CROSS-CHANNEL.md; `question-binding` 33 | not started, by recorded decision. The audit required "ADR required"; the ADR that exists rejects the derivation. |
| SLICE8 Staff, skills, learning | roster ceilings as data; new-specialist project default off; hire proposal press; skill proposal + `skill_effect` consumer; one learning-confirmation policy; st | STILL OPEN | Runs 1-5 touch none of `router.ts`, `guidance.ts`, `remember.ts`. `guidanceFor` still used only by `worker.ts`, `guidance.ts`, `quality.ts`, `instruction.ts` | not started. Needs Grant's decision 47(a). |
| SLICE9 Cross-project reader + tenant seam ADR | derived cross-project reader; `outputs.sources` carry project; NOT NULL `project_id` on work tables; tenant-seam ADR; lint for new `'grant'` literals | STILL OPEN | `information_schema` query; ADR directory listing | not started. The seam ADR is cheap; the rest depends on 47(b). |

### ISSUE

| Finding | Original problem | Class | Evidence | Debt / residual |
|---|---|---|---|---|
| ISSUE #339 | scan-and-create-tasks read as record-one-task | ISOLATED-PROVEN FIXED | `extractionRequest` (src/agents/extract.ts:153) returns the request for "Scan the entirety of the Legacy Coaching Project and create appropriate tasks", with and without the dictated false start; I probed: `personalTaskR | I did not run `verify:extract` (live end-to-end that children actually start); issue left open in GitHub |
| ISSUE #340 | hq-api pulse 502, no public wrapper | ISOLATED-PROVEN FIXED | check:gateway-wrappers is now in the gate. | |
| ISSUE #336 | citation says "null" | ISOLATED-PROVEN FIXED | `citationRef` single formatter; `tests/knowledge/a-citation-names-where-it-came-from.test.ts` 8/8 passed (I ran it); three sabotages recorded in the issue; live drive recorded in issue (14 citations, 0 null) | live evidence is a recorded manual drive, not a verify suite |
| ISSUE #359 | "Read this for me" filed not read | ISOLATED-PROVEN FIXED | `pageRequest` short branch checks `READ_IT` first; `page-request.test.ts` 24/24 passed (I ran it); revert sabotage recorded 3 red | pre-existing `<link> check this out later` -> asked, left alone on purpose |
| ISSUE #321 | taskTitle uses requestBody (verb lost) | STILL OPEN | I probed `taskTitle`: framed requests keep the verb ("add a task to chase the caterers" -> "chase the caterers"); bare "chase the caterers" -> "the caterers", "review the onboarding copy" -> "the onboarding copy" (the is | the narrow retraction fix exists; the issue's general defect stands (negative result on generalising is recorded in CLAUDE.md) |
| ISSUE #307 | every real task title malformed | STILL OPEN | probes: purpose clause ("so I do not forget to ring Kevin") -> "ring Kevin about the quote"; comma preamble -> "chase the letter of support"; retraction kept correctly; "jot down that I need to..." via `personalTaskReque | date still in title and verb particle/noun-only titles remain; `a-task-title-is-what-to-do.test.ts` 29/29 passes but asserts current output |
| ISSUE #303 | "Jot down that get back to Priya" | ISOLATED-PROVEN FIXED | `personalTaskRequest("jot down that I need to get back to Priya about the venue")` -> "Get back to Priya about the venue" (probe) | I found no dedicated test named for the jot-down shape; the negative control ("write down the numbers from the call") not verified by me |
| ISSUE #305 | withdrawal reads as work asked for | STILL OPEN | probe: `asksForWork("forget the proofreading, it is being done elsewhere")` = true (still); "cancel that" = false; "cancel the venue booking" = true (correct) | whole-message withdrawal with a bare-stem verb still earns "I have not done this"; real frequency 1 in 160 |
| ISSUE #306 | "told a task existed when none did" | ISOLATED-PROVEN FIXED | `a-negation-stops-its-own-clause.test.ts` 26/26 passed (I ran it); `SAYS_I`, clause-scoped negation, `misrepresents` asks both readers; sabotages recorded | four ordinary completion phrasings caught by neither reader is asserted as a known gap |
| ISSUE #361 | "You have no open projects" slipped gate | ISOLATED-PROVEN FIXED | `it-may-not-deny-what-it-holds.test.ts` 17/17 passed (I ran it), incl. controls; revert sabotage recorded 1 red | verb-based phrasings not covered |
| ISSUE #362 | "Your diary is empty" slipped gate | ISOLATED-PROVEN FIXED | `provenance.test.ts` 71/71 passed (I ran it) | the issue itself records two still-missed phrasings ("I see no emails from Sergio", "I found no meetings") - not fixed, verb vocabulary |
| ISSUE #365 | cancelled-without-his-asking owes a word | STILL OPEN | `app.owed_a_word` still gates `j.state = 'failed'` only (live def line 16); no sweeper exists | cause of the unexplained cancel never identified; needs a sweeper for `cancelled` with null `stop_requested_by`, no delivery, real origin |
| ISSUE #358 | `undoable_actions.job_id` never populated | STILL OPEN | `app.undo_offer(p_kind,p_description,p_reversal,p_minutes)` still takes no job | record job id in the offer; or document the reversal payload as the carrier |
| ISSUE #343 | verify:autonomy leaves `autonomy_settings` rows | ISOLATED-PROVEN FIXED | 0629: project_delete clears autonomy_settings; audit-closure. | |
| ISSUE #338 | vault-export wrong-passphrase flake | STILL OPEN | test unchanged, still asserts `.rejects.toThrow()` (artefact, not property). Passed in my isolated run of the file (7/7) | intermittent only under full-suite load; I did not run the full suite |
| ISSUE #352 | backup:rehearse never reaches restore | STILL OPEN | `scripts/backup/rehearse-restore.ts` has no phases/args (grep); still in `verify:db` chain | harness defect |
| ISSUE #383 | check:tokens red on `--bcfade` | ISOLATED-PROVEN FIXED | check:tokens: --bcfade is a local scroll-fade variable, baselined with its reason; check exits 0. | |
| ISSUE #369 | pg_proc scan through a JOIN in 0573 | STILL OPEN | no check was added (check-migrations.ts has no pronamespace guard; migration unchanged; fresh-install precondition `before-0573.sql` is the workaround per the issue) | add the suggested check to check:migrations |
| ISSUE #326 | check:migrations passes on applied-but-missing | STILL OPEN | I ran `check-migrations.ts`: passes (641 files, 639 recorded), it reads only files and `applied.json`, never the database, so it still cannot see migrations applied by another branch; ADR-0047 addresses numbering only | reuse migrate's integrity pass in the check |

## Decisions the audit left to Grant (§47)
| Decision | Status |
|---|---|
| (a) Learning-confirmation policy (B9) | undecided; options on the issue |
| (b) Cross-project retrieval default (invariant 40 / slice 9) | undecided |
| (c) Whether the autonomy dial gates starting proactive work (#389 is the concrete form) | undecided; DECISION-389.md |

## Section 46, definition of done
Not met: the open rows above include invariants with no behavioural evidence and the three decisions.
