# G3 - audit section 45 (40 invariants), section 37 (V1-V14), section 46 (definition of done)

Method: read the audit sections, Runs 1-5 docs, ADR 0049-0056, `scripts/isolated/run-all.sh`, `scripts/e2e.ts` (the `npm run gate` definition). Ran 20 isolated suites on scratch copies of template `m626` (all dropped; none left). Probed three facts directly on a scratch copy (child inheritance, null-project job insert, ambiguous pause vs `obligation_state`). No production or external contact. `docs/architecture-run-5/AUDIT-RECONCILIATION.md` was not used as evidence.

## Facts that frame everything

1. **`npm run gate` = `tsx scripts/e2e.ts --gate`** (package.json:234) runs the `GATE` array in `scripts/e2e.ts`. It holds about 75 `check:*` / `verify:*` scripts, most of them live against the shared production Supabase. **It contains no isolated-replica suite.** `scripts/isolated/run-all.sh` is manual (needs `sudo scripts/isolated/replica.sh` first). No package.json script or `.github` workflow calls it. Vitest (`npm test`), lint and typecheck are also outside the gate. The Run 1 handoff records this as a verification gap; Runs 2-5 never closed it.
2. Live suites that Runs 1-5 cite as production proof (`run1-live` ... `run5-live`) are **not in the gate** either. Neither are `verify:obligation`, `verify:skills`, `verify:boundary`, `verify:lessons`, `verify:worker`.
3. **The checkout moved under this task.** HEAD is `892b24c2`, not `311701cc`. Two commits add migrations 0627 and 0628; `migrations/0629_*.sql` is untracked (another session). 0628 fences `pause_job` by the claim (Run 5 debt #398). Template `m626` has neither. Four suites (`job-fence`, `fan-in-waits`, `approval-execution`, `blocker-failure`) went red on `m626` because the HEAD worker code calls the 10-argument `pause_job`. I applied 0627 and 0628 to a scratch copy and all four went green (23/23, 6/6, 15/15, 7/7). That was environment skew, not a regression. `job-skew` fails on `m626` by construction (it needs `skew_old`) and I did not count it. Classification below is against production (0626 live) plus HEAD code; 0627/0628 are not counted as production.
4. The committed suites for Runs 1-5 record sabotages that landed (Run 3 `SABOTAGE.md` S0-S13, plus per-run lists in the Run 4/5 docs). **No harness fails a run when a sabotage did not land** (audit section 31; still true). `scripts/mutate.ts` is unrelated (request-text variants).
5. Class meaning used here. PRODUCTION-PROVEN: a recorded live suite or a gate check run against production exercises the real mechanism. ISOLATED-PROVEN: driven behaviourally on a replica or by real-function tests, off production. "Partial" is noted in the row but the class is STILL OPEN.

## Isolated suites I ran on scratch copies of m626

| suite | result |
|---|---|
| mixed-turns | 12/12 |
| turn-entitlement | 12/12 |
| job-lifecycle | 27/27 |
| job-delegation | 11/11 |
| job-origin | 22/22 |
| question-binding | 33/33 |
| exactly-once | 6/6 |
| refusal-reversal | 41/41 |
| authority | 88/88 |
| principals | 70/70 |
| approval-binding | 30/30 |
| witness-independence | 12/12 |
| synthetic-origins | 36/36 |
| sender-authorization | 39/39 |
| project-provenance | 20/20 |
| slack-sender | 17/17 |
| typed-yes | 9/9 |
| forwarded-authority | 8/8 |
| containment | 19/19 |
| approval-delivery | 9/9 |
| open-question | 48/48 |
| paused-incoherent | 8/8 |
| outward-options | 12/12 |
| drive-options | 4/4 |
| channel-options | 4/4 |
| approver-identity | 44/44 |
| job-fence (on m626 + 0627/0628) | 23/23 |
| fan-in-waits (on m626 + 0627/0628) | 6/6 |
| approval-execution (on m626 + 0627/0628) | 15/15 |
| blocker-failure (on m626 + 0627/0628) | 7/7 |

Direct probes (scratch DB):
- `app.enqueue_child` copies `project_id` and `requested_by` from the parent. The child's `pinned_config` came back `{}`, so provenance travels by `root_job_id` and the origin columns, not by config.
- A job row with `project_id` NULL is accepted (`jobs.project_id`, `tasks.project_id`, `documents.project_id`, `blockers.project_id` are all nullable in `information_schema`).
- A job paused with reason `needs_reconciliation` and no blocker: `app.obligation_state(root)` returns `working`, while `app.job_situation(job)` returns `ambiguous_external`. This reproduces V9.

## Section 45 - the 40 invariants

| # | Invariant | Status at HEAD (mechanism) | Behavioural evidence | Meets "Evidence required"? | Class | Smallest remediation if open |
|---|---|---|---|---|---|---|
| 1 | Every human turn enters one semantic boundary | `Turn` built once, `src/handlers/instruction.ts:2439` (`buildTurn`); `entitled.*` is the only door to consequence-bearing readers (ADR-0052). Doors all write `inbound_commands` then `office.instruction`. `understand()` still runs after the plan/populate/teach early returns (Run 1 R1 debt). | `turn-entitlement` 12/12 (a hostile resolver cannot start a plan, link, task, rule or call-off; baseline was 9/12), `mixed-turns` 12/12, vitest `turn`, `gates`. Import barrier in `gates.test.ts` is source text. | Partly. Behavioural for consequence-bearing readers, positive control and baseline-red sabotage recorded. "All five doors reach the same `buildTurn`" is asserted by architecture, not by a test. | ISOLATED-PROVEN FIXED | (Optional) a door-parity check: drive each door's enqueue and assert the same entry handler. |
| 2 | Claire remains human-facing owner | `telegram.only_chief_speaks` honoured in `telegram/message.ts`, `office/pass.ts`, `channels/progress.ts`. Slack and dashboard have no equivalent rule. Specialist-addressed exceptions are not enumerated. | Only `tests/telegram/message.test.ts`. Nothing on Slack or dashboard. | No. | STILL OPEN | Write the persona rule once at the delivery layer; enumerate exceptions; one test per channel. |
| 3 | Every obligation belongs to a project | `project_id` is nullable on `jobs`, `tasks`, `documents`, `blockers`. `app.unnamed_project()` exists but nothing forces it. A null-project job inserts cleanly (probe). | None for a NOT NULL. | No. | STILL OPEN | Backfill to Unnamed, then NOT NULL, or a CHECK. Null-project retrieve must be refused. |
| 4 | Mixed intents survive | `say-what-you-dropped.ts`, clause peel in `gates.ts`/`instruction.ts`. | `mixed-turns` covers yes/no plus ONE remainder (reminder, preference), qualified yes. No plan+preference+question table. Run 1 lists the degraded-model "several clauses become one mangled title" bug as open. | No. | STILL OPEN | A clause table (plan, preference, question, task) asserting each clause is executed or dropped-and-said, through the real handler. |
| 5 | Corrections/cancellations govern the right span | `retraction.ts`, `calloff.ts`, `negation.ts`; vitest `retraction` (11 cases incl. dash, #291), `clauses`, `calloff-composite`. `mixed-turns`: qualified yes approves nothing. | Pure-function tables plus a hostile-resolver suite. The only integrated "withdrawn work not performed" run was a manual degraded-model pass (Run 1 phase 12). | Partly. Span logic is tested; there is no committed integrated suite. | ISOLATED-PROVEN FIXED | Add one replica test that sends a withdrawal through the handler and asserts no task or plan was created. |
| 6 | Cross-interface continuation locates the same context | No cross-channel conversation identity, deliberately (`docs/architecture-run-5/CROSS-CHANNEL.md`, ADR-0056): a plain yes across channels binds nothing. `verify:cross-interface` only checks that one instruction normalises identically. | `question-binding` 33/33 proves the safe side for questions. Nothing asserts same person/project/prior-work across Team HQ, Telegram and Slack. | No. The recorded decision covers question-answering only, and is a run decision, not ratified by Grant. | STILL OPEN | Decide whether per-channel conversation is the intended model (then record it as ACCEPTED-DEBT). Otherwise a scope-continuity suite. |
| 7 | Every root objective has durable ownership | `app.obligation_state` (0562) derives over the job tree. It only counts an OPEN blocker as waiting. | Probe: an ambiguous-effect pause with no blocker reads `working`. `verify:obligation` exists but is not in the gate. | No. Non-resumable pauses and duty roots are not covered. | STILL OPEN | Teach `obligation_state` the pause reasons (`needs_reconciliation`, `credential_required`, `checkpoint_stale`) and cover duty roots; add a replica test. |
| 8 | Human tasks and AI jobs distinct | `tasks` vs `jobs` schema; task tick goes through `hq_answer_blocker` (Run 2). | `verify:tasks`, `verify:mytasks` (both in the gate); `authority` section 6 (tick). | Yes. | PRODUCTION-PROVEN FIXED | none |
| 9 | Child inherits project | `app.enqueue_child`: `coalesce(p_project, parent.project_id)`; probe confirms inheritance and explicit override. | Only incidental coverage (`job-lifecycle` 2d passes an override). No committed test of the inheritance rule itself. | Behaviour true; the regression test is missing. | ISOLATED-PROVEN FIXED | Add a 10-line check to `job-lifecycle`: child project equals parent's; override honoured. |
| 10 | Child inherits user/tenant | `requested_by` copied (probe). There is no tenant concept (no `office_id`). | No committed test of the user half. Tenant half is invariant 40. | No. | STILL OPEN | Add the user-inheritance check; tenant half rides on 40's ADR. |
| 11 | Child inherits security/synthetic | `jobs_inherit_synthetic`, `jobs_synthetic_immutable`, `jobs_stamp_origin`, `jobs_origin_immutable`; `app.job_origin`, `app.may_act_outside` (0603, 0619). | `synthetic-origins` 36/36, `job-origin` 22/22, `containment` 19/19, `external-containment`, all sabotaged; `check:leaks` and `verify:escapes` are in the gate. | Yes. | PRODUCTION-PROVEN FIXED | none |
| 12 | Child inherits provenance | Not by `pinned_config` (child config is `{}`, probe). By `root_job_id` and origin columns (0619), and `app.job_forwarded` walking the tree (0624). | `job-origin` 22/22, `forwarded-authority` 8/8. | Partly. Lineage walk is proven for origin and forwarded. No enumeration of every `pinned_config` consumer. | ISOLATED-PROVEN FIXED | List the `pinned_config` keys read in `src/` and assert each is either lineage-derived or explicitly not inherited. |
| 13 | Specialist identity survives delegation | `recipient_agent` per child, `addressed_to`. | `verify:handoff`, `verify:delegation`, `verify:collaborates` are all in the gate. | Yes. | PRODUCTION-PROVEN FIXED | none |
| 14 | Specialists collaborate without losing root ownership | Root-owned synthesis (`handlers/synthesise.ts`); 0562/0563 obligation. Specialist-initiated delegation does not exist (MC5). | `verify:collaborates` (gate) proves real hand-off, bounded depth. Nothing asserts "no dual answer". | No. "No dual-answer" is unasserted anywhere. | STILL OPEN | One assertion: a fan-out obligation yields exactly one delivered answer to the requester. |
| 15 | Fan-in produces one coherent result | `app.fan_in_over`, `dependency_wait` in `app.resumable_now` (present). | `fan-in-waits` 6/6 (9 wakes against a ceiling of 5, on m626 + 0628). No test of "one delivered answer per obligation". | Half. | STILL OPEN | Same assertion as 14, on the delivered-answer side. |
| 16 | Project retrieval preserves provenance | `app.search_documents`, `citationRef`, mirror step-aside. | `verify:knowledge`, `verify:unified` in the gate. | Yes. | PRODUCTION-PROVEN FIXED | none |
| 17 | Cross-project retrieval preserves provenance and permissions | No reader (MC1). | None. | No. | STILL OPEN | Needs Grant's decision (b) first (open-by-default vs opt-in), then a derived reader and a negative control. |
| 18 | Skills cannot grant authority | `public.skills` has no authority column. `authorize_effect`/`may_act` read `tool_permissions`, `staff_tools` and autonomy only. | `verify:skills` (most-persuasive-skill), `boundary` are live, not in the gate. I confirmed the columns. | Yes (schema plus live suite), but off-gate. | PRODUCTION-PROVEN FIXED | Move `verify:skills` into the gate. |
| 19 | Learning cannot silently create durable preferences | A marked rule is stored on a say-back (`remember()`); forwarded rules are offered, never stored (0624); strangers are refused at the door (0607/0615). No single confirmation policy; no skill-candidate path. | `forwarded-authority` 8/8, `sender-authorization` 39/39. Nothing for the marked path. | No. Audit decision (a) is unmade. | STILL OPEN | Grant decides (a); then one confirmation policy plus tests on the marked and skill paths. |
| 20 | One authoritative tool-permission path | `app.authorize_effect` (0611) is authoritative for plan steps, `governOutward` and `drive.ingest` via `mayAct`, and `mayWrite` for notebook add/push. Other deciders remain: containment-only, per-connector switches, raw sends. `staff_tools` does alter runtime on the migrated paths. | `authority` 88/88 (matrix, `staff_tools` grant/revoke altering the outcome). | No. Correct for the migrated set only. | STILL OPEN | Close the set in 22. |
| 21 | Unsupported capabilities produce truthful outcomes | `outcome.ts` defines `blocked_capability`, but `src/handlers/instruction.ts:5341` still hard-codes `capabilityRefused: false`. The claim gates (`capability-claims.ts`, `check:capabilities`, `verify:capability-claims`) are real. | `verify:capability-claims` and `check:capabilities` in the gate. `blocked_capability` is unreachable in production. | No. | STILL OPEN | Wire `capabilityRefused` from the planner's "granted but nothing performs it" result; add a reaching test. |
| 22 | Consequential actions cross authorization | Migrated: plan steps, calendar duty, `drive.ingest`, `notebook.add_source`/`push_document`, `notebook.generate`/`office.execute_plan` (BOUND). Not migrated: `tasks.sync`, `office.provision/rename_channels`, `office.notion_import`, `office.slack_rotate` (#389, needs Grant, options in `DECISION-389.md`); `hq_attach` from a link, `notion_adopt` and plan `attach` (#393); `google.revoke`; raw sends in `telegram-webhook` and `vault-export`. | `authority`, `approval-binding`, `exactly-once`, `vault-export-door`. Nothing for the unmigrated kinds. | No. | STILL OPEN | Grant decides #389 and #393. Then `mayWrite`/`governOutward` plus `claimExternal` per duty, and a check deriving external kinds from the registry. |
| 23 | Approval binds the exact action | `blockers.action_fingerprint` (0616), `app.approval_verdict`. Covered: plan steps, `notebook.generate`, `execute_plan`. Drive option answers carry `on_answer` but no fingerprint. | `approval-binding` 30/30 (changed-action refused), `approval-execution` 15/15, `question-binding` 33/33. No changed-action test for `drive.ingest`, `governOutward` or the system duties. | No, per mechanism. | STILL OPEN | Fingerprint and a changed-action test for `drive.ingest` and the calendar duty. |
| 24 | Yes executes at most once | `hq_answer_blocker` row lock (0596); claim and step checkpoints. Task tick now goes through the same door. | `approval-race.sh` (base shows 2, post shows 1), `exactly-once` 6/6 (two racing workers, `local` control), `approval-execution` 15/15, `job-lifecycle` 27/27. | Yes for every mechanism inside the boundary. Mechanisms outside it are invariant 22. | ISOLATED-PROVEN FIXED | none beyond 22 |
| 25 | No executes zero times | Decline path and durable refusal (0611). | `refusal-reversal` 41/41, `approval-execution` (NO performs nothing), `open-question` 48/48, `mixed-turns`. | Yes inside the boundary. | ISOLATED-PROVEN FIXED | none beyond 22 |
| 26 | Refusal cannot be replanned around | Durable No keyed to fingerprint or duty `(tool, project)` for `approval.refusal_days`; taking it back is explicit and person-only. | `refusal-reversal` 41/41, `approval-execution` ("does not re-plan into asking again"), `authority`. A different action asks afresh by design. I found no explicit "refused + empty replan" test (V6). | Mostly. | ISOLATED-PROVEN FIXED | Add the refused-and-empty replan case. |
| 27 | Completed checkpoint work not repeated | `runSteps`/`beginStep`/`claimExternal` in `jobs/checkpoint.ts`; used by `perform`, `plan`, `notebook`, `artifact`, `backup`, `vault-export`, `browser-gather`, `pursue`. Handlers that write without a checkpoint: `tasks-sync`, `sync`, `channels`, `notion-sync`, `notion-import`, `slack-rotation`, `google-revoke`, `calendar-tasks`. | `exactly-once` 6/6 and `approval-binding` cover the checkpointed set. A crash between remote upsert and `task_pushed` duplicates the remote task (recorded hazard, `DECISION-389.md`). | No. | STILL OPEN | Checkpoint the remaining external writers, or record the hazard per duty as ACCEPTED-DEBT. |
| 28 | Ambiguous external effects reconciled | An ambiguous effect parks the job (`needs_reconciliation`). Nothing resolves it. No reconcile action exists in `app`, `public` or hq-api. `exactly-once` "reconciles" by a direct SQL UPDATE of `job_steps`. | No per-handler crash-after-effect suite. | No. | STILL OPEN | A gateway action plus function that resolves a `needs_reconciliation` pause (done or not done), attributed to a person, with a crash-after-effect test per external handler. |
| 29 | Every legal nonterminal state has recovery | `recover_stalled_jobs`, `settle_exhausted_jobs`, `requeue_retrying`, `resume_job` (0599, 0620). `waiting_user` and `waiting_external` are still in the enum and nothing writes them. `resumable_now` covers 4 pause reasons; no expiry for other pauses or blockers. | `recovery-matrix` (every stallable state, including one malformed row; run-all reports PASS), `drain-survives-sweep`, `job-lifecycle` 27/27. I did not re-run the matrix (its DB names are outside the `cls3_` prefix). | No. | STILL OPEN | Remove or wire the two dead states; add expiry or escalation for non-resumable pauses and blockers; a per-state test. |
| 30 | One malformed job cannot stop unrelated work | 0599 (sweep no longer raises on `committing`); worker drain wraps the sweep. | `recovery-matrix` (malformed row beside a healthy job), `drain-survives-sweep` (worker half), `verify:worker` (throwing handler goes to `retrying`; unknown kind pauses and leaves the queue). `verify:worker` is live and not in the gate. | Mostly. No single poison-job suite on the deployed worker. | ISOLATED-PROVEN FIXED | One suite: a poison payload, a throwing handler and a healthy job together through `drain`. |
| 31 | Synthetic descendants remain synthetic | Triggers on `jobs`; 0603-0605. | `synthetic-origins` 36/36; `check:leaks`, `verify:escapes` in the gate. | Yes. | PRODUCTION-PROVEN FIXED | none |
| 32 | Synthetic cannot reach real destinations | `app.claim_delivery`, `app.may_act_outside`, `containmentRefusal`, `check:door-origins`. GREEN 29 Sep. | `containment` 19/19, `external-containment`, `destination-retirement`; live `verify:escapes`, `check:leaks` (gate). The `supabase/functions` bare-send scan is missing (V8). | Mostly. | PRODUCTION-PROVEN FIXED | Close V8 (scan `supabase/functions`). |
| 33 | Containment has an independent witness | `scripts/leak-witness.ts`, `known_escapes`; `check:leaks` (gate). | `witness-independence` 12/12 (isolated only, not in the gate). | Partly. The witness runs in the gate; its independence is proven off-gate. | ISOLATED-PROVEN FIXED | Move `witness-independence` into the gate (V3). |
| 34 | Completion claims require canonical evidence | Coherence gates keyed on claims (`quality.ts`, `provenance.ts`, `claimsToHaveRead`/`Sent`, `fabricatedWhen`, `deniesWhatItHolds`); `outcome.ts` contract. Bare assertions are invisible to a claim-keyed gate by design; #302's promise-without-capability case is open. | `verify:attests`, `verify:capability-claims` (gate); many vitest files. | No (heuristic coverage). | STILL OPEN | A state-gated backstop: no completion wording unless `obligation_state` or a delivery row supports it. |
| 35 | Partial completion reported as partial | `app.obligation_state` (`partially_complete`, `waiting_on_user`); `synthesise.ts` "lost branch". | `verify:obligation` (live; not in the gate). | Yes, live. Off-gate. | PRODUCTION-PROVEN FIXED | Put `verify:obligation` in the gate. |
| 36 | Claire can determine the state of an active obligation | `app.obligation_state`, `app.conversation_work`, `app.job_situation` (0620). `job_situation` has no product reader (only scripts call it). | Probe: `obligation_state` reads `working` for an ambiguous pause. | No. | STILL OPEN | Expose `job_situation` through a gateway section and the "what is happening" answer; fix 7. |
| 37 | Proactive work obeys authorization and notification | Say-once (0584/0585) present. Only the calendar duty passes the policy. Four system duties write outside unprompted (#389). | `verify:chatter`/`check:chatter` (gate), `refusal-reversal` (duty stays quiet after a No). | No. | STILL OPEN | Grant decides #389; gate each duty. |
| 38 | Dynamic specialists cannot self-grant authority | No trigger on `staff` or `staff_tools` inserts default grants (checked). `authorize_effect` reads `staff_may_use` at runtime for plan steps and duties. Claire-created specialists (MC5) do not exist. | `authority` (a specialist with no grant is refused; grant and revoke change the outcome), 88/88. | Yes for what exists. | ISOLATED-PROVEN FIXED | Re-test when MC5 is built. |
| 39 | Skill improvement cannot self-grant authority | Skills are append-only, no authority columns; no skill-proposal path exists yet. | `verify:skills` (live, off-gate). | Yes for the schema. | PRODUCTION-PROVEN FIXED | Test the proposal path when built. |
| 40 | Credible tenant/user-isolation path | Sender authorization exists (0607, 0615, Slack `team_id` unbound, #392). No tenant-seam ADR, no `office_id`, about 30 `'grant'` literals in `src/`, no per-person lessons scope. | `sender-authorization` 39/39, `slack-sender` 17/17 cover the door only. | No. | STILL OPEN | Write the seam ADR and a lint for new `'grant'` literals (the audit's slice 9 asks for the ADR only). |

### Count by class (section 45)

| class | count | invariants |
|---|---|---|
| PRODUCTION-PROVEN FIXED | 9 | 8, 11, 13, 16, 18, 31, 32, 35, 39 |
| ISOLATED-PROVEN FIXED | 10 | 1, 5, 9, 12, 24, 25, 26, 30, 33, 38 |
| SUPERSEDED | 0 | |
| ACCEPTED-DEBT | 0 | (6 is partly a recorded run decision; 19, 22, 37 wait on decisions Grant has not made) |
| STILL OPEN | 21 | 2, 3, 4, 6, 7, 10, 14, 15, 17, 19, 20, 21, 22, 23, 27, 28, 29, 34, 36, 37, 40 |

Every PRODUCTION-PROVEN row rests on a live suite I did not re-run. Several of those suites (18, 35, 39) are not in `npm run gate`. No row is proven by the gate plus an isolated suite together.

## Section 37 - verification gaps V1-V14

| # | Gap | Status at HEAD | Evidence | Class | Smallest remediation |
|---|---|---|---|---|---|
| V1 | Gate-order test | Audit sense is handler gate order (`rejectsWithoutSaying` vs an open blocker; early returns vs `spokenAnswer`). `src/agents/gates.ts` (Run 1) gives answer, then reject, then close. The CI-gate order is also pinned by `tests/scripts/gate-order.test.ts` (source-parsing). | `gates.test.ts` truth table (21), `mixed-turns` 12/12, `open-question` 48/48 (6 red on baseline). | ISOLATED-PROVEN FIXED | none |
| V2 | Poison-job queue suite | See invariant 30. | `recovery-matrix`, `drain-survives-sweep`, `verify:worker` (live, off-gate). No single suite, not on the deployed worker. | ISOLATED-PROVEN FIXED (partial) | One poison-job suite through `drain`. |
| V3 | Isolated replicas not in the gate | Confirmed still true: `GATE` has none; `run-all.sh` is manual. | `scripts/e2e.ts`, `package.json`, `.github` searched. | STILL OPEN | A gate entry (e.g. `verify:isolated`) that builds the replica and runs `run-all.sh`; fail the gate on a non-zero exit. |
| V4 | "Permitting reader never sees the paraphrase" seam tests | `Turn` brands, `entitled.*`, `firstOfHis`. | `turn-entitlement` 12/12 (hostile resolver, baseline 9/12), `gates` import barrier, vitest `a-veto-reads-his-words`. | ISOLATED-PROVEN FIXED | none |
| V5 | Behavioural replacements for source-text invariants | About 55 source-text tests remain. The newer `a-running-job-writes-under-its-claim` and `a-child-is-made-under-its-authors-claim` are also source-text. Some behaviour was added (`verify:lastword`, the job-fence suites). No harness fails when a sabotage did not land. | | STILL OPEN | Convert the named ones (one live attempt, a duty says it once, a dead turn speaks, ADR-0018 no agent path calls `approve_tool`); add a sabotage-must-land harness. |
| V6 | Option answers undriven; refused+empty replan; tick vs dashboard race | `drive-options` 4/4, `channel-options` 4/4, `outward-options` 12/12 now exist. The tick is folded into `hq_answer_blocker`, tested in `authority` section 6; the `approval-race` race applies to that single door. No explicit refused+empty replan test; "M2/M3" not located. | | ISOLATED-PROVEN FIXED (residual) | The refused+empty case. |
| V7 | SQL/TS enumeration agreement | States: `verify:transitions` compares the `job_state` enum with the code (in the gate). Channels (`origin_channel` constraint vs `CHANNELS`): no test found. | | STILL OPEN (channels half) | One check reading the constraint and the TS list. |
| V8 | `supabase/functions/**` bare-send scan | `tests/jobs/containment.test.ts` scans `src/` only; `telegram-webhook` has raw `api.telegram.org` fetches. | | STILL OPEN | Extend the scan, with named exceptions and reasons. Note it is still a source-text check; invariant 32 needs a behavioural test. |
| V9 | Non-resumable pause reads `working` | Reproduced at HEAD (probe). | `obligation_state` = `working`, `job_situation` = `ambiguous_external`. | STILL OPEN | See invariant 7. |
| V10 | Stranger-sender refusal | 0607 (Telegram), 0615 (Slack). | `sender-authorization` 39/39, `slack-sender` 17/17, `principals` 70/70; recorded live in `run1-live` and Run 3. | PRODUCTION-PROVEN FIXED | The Slack `team_id` half (#392) is separate and open. |
| V11 | `jobs.project_id` non-null for real work | Nullable; the probe inserts a null-project job. | | STILL OPEN | Invariant 3. |
| V12 | Synthesis wait over 5 wakes | 0609, 0625. | `fan-in-waits` 6/6 (on m626 + 0628); `job-fence` 23/23. | ISOLATED-PROVEN FIXED | none |
| V13 | Planner path through real Telegram/Slack | `edge-emulator.ts` and `telegram-door.ts` can run the real webhook on a replica; nothing drives the planner through them. | | STILL OPEN | A planner turn through `telegram-door` with a scripted model. |
| V14 | Fresh-office migration build (#344) | `replica.sh` replays history 0001-0591 with `ON_ERROR_STOP=0` and `ON_ERROR_ROLLBACK=on`; 28 files fail their data assertions and are tolerated. `npm run migrate` on an empty database is not tested. | | STILL OPEN | Make the zero-state build a check; split data assertions from DDL. |

Count (V): PRODUCTION-PROVEN 1 (V10); ISOLATED-PROVEN 5 (V1, V2, V4, V6, V12); STILL OPEN 8 (V3, V5, V7, V8, V9, V11, V13, V14).

## STILL OPEN invariants, ranked by materiality

**A. Falsify a named security or lifecycle property (highest first).**
1. **22 and 20** - consequential effects without the authorization boundary: four system duties (#389), attach paths (#393), `google.revoke`, raw webhook sends. Containment is a provenance test, not a permission. Two items need Grant's decision (#389, #393).
2. **28** - an ambiguous external effect parks the job and nothing can resolve it.
3. **27** - external writers with no checkpoint. `tasks.sync` can duplicate a remote task after a crash (recorded hazard).
4. **29** - `waiting_user` and `waiting_external` are dead states; non-resumable pauses and blockers have no expiry or escalation.
5. **7, 36 and V9** - `obligation_state` reports `working` for an ambiguous pause (reproduced), so "what is happening" can be wrong.
6. **3 (and V11)** - ownership is not enforced; `project_id` is nullable on the four tables that matter.
7. **37** - proactive duties are unauthorised (same decision as #389).
8. **23** - no changed-action test for `drive.ingest` or the calendar duty.
9. **34 and 21** - truthfulness. Claim gates are lexical; `blocked_capability` is unreachable in production.
10. **19** - durable preference creation has no single confirmation policy; waits on Grant's decision (a).
11. **40 and 10** - tenant seam: no ADR, no `office_id`, about 30 `'grant'` literals. Latent while the office has one person.

**B. Product-capability gaps (no named property falsified).**
4 (mixed-intent table), 6 (cross-channel continuation; partly a recorded run decision), 14 and 15 (a "one delivered answer" assertion is missing; MC5 not built), 17 (cross-project reader; Grant's decision (b)), 2 (persona rule beyond Telegram).

Verification-gap OPENs: V3, V5, V7 (channels), V8, V13, V14. V3 is the most consequential because it is why the isolated proof for many invariants above does not protect `main`.

## Section 46 - definition of architectural done

**Not met.** Section 46 requires all of the following; the state of each:

1. **All 40 invariants green on the integrated system.** 21 of 40 are STILL OPEN (list above). Only 9 have production-side proof; 10 have replica proof.
2. **Each by a behavioural test with a positive control and a sabotage that lands.** Positive controls and recorded sabotages exist for the Run 1-5 suites. There is no committed harness that fails when a sabotage does not land.
3. **Run in a gate that includes the isolated-replica suites.** `npm run gate` includes none. `run-all.sh` is manual. The run-live proofs for Runs 1-5 are off-gate too.
4. **Not a source-text assertion.** About 55 source-text tests remain (V5). V8's scan, `gate-order.test.ts`, `gates.test.ts`'s import barrier and the architecture tests are source-text.
5. **The gate is green on main.** Not at 311701cc: `check:callers` is red (#395). The audit also records `check:tokens` red (#383); I did not re-verify that. 0627 addresses #395 at HEAD, which is not production.
6. **The doc set states the true migration and worker counts.** `CLAUDE.md` still says "409 applied" and certifies `63c5a26`, worker v391, 375 migrations. The repository has 642 SQL files, Run 5 records 639 applied, and the worker is at v868 or later.

**Missing, in smallest-first order:** add the isolated suites to the gate and fix the doc counts; add the three cheap tests (9, 10, 15/14) and the V7/V8 checks; fix `obligation_state` for non-resumable pauses; wire `capabilityRefused`; add a reconcile action and expiry for dead states (28, 29). Invariants 22/20/27/37 need Grant's decisions on #389 and #393. 17 and 19 need his decisions (b) and (a). 3 needs a backfill and a constraint. 40 needs an ADR.
