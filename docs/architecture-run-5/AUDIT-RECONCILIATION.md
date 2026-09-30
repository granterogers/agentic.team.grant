# Original-audit reconciliation matrix (Run 5, Phase 8 - read-only)

Sources: the #378 containment audit (`docs/testing/378-containment-audit-2026-09-29.md`, findings and residual risk),
the Run 1 findings B1-B7 (`docs/ARCHITECTURE-RUN-1.md`), the Run 2 authority map and its "not established" list, the
Run 3 ingress and effect reviews, and the Run 4 lifecycle debt. Every row is traced `finding -> remediation -> commit or
migration -> test -> production evidence -> remaining debt`, and classified:

**PP** production-proven fixed - **IO** isolated-only fixed - **AD** accepted debt (a decision recorded) -
**SS** superseded - **OP** still open.

This matrix is a reading of the repository and its recorded evidence. It performs no probe. **The original audit is NOT
declared complete**: rows marked OP or AD remain, and the next run is *Final Audit Reconciliation*.

## A. Containment (#378, #379)

| # | Original finding | Remediation | Commit/migration | Test | Production evidence | Class | Debt |
|---|---|---|---|---|---|---|---|
| A1 | Narration to Slack sent 381 of 523 harness jobs; `claim_delivery` failed open on a null job | 0601 `delivery_refusal`; job-less senders registered in `operator_senders` | 0601 | `narration-containment` 11/11 | `check:leaks` exit 0 across Runs 1-4 (known/acknowledged only) | PP | none |
| A2 | Bare `fetch` sends (transcript echo, correction question) bypassed the guard | routed through the delivery layer | 0601 + code | `correction-containment` 5/5 | `check:leaks` | PP | none |
| A3 | Harness lineage reached third-party writes (Notion, NotebookLM, Google...) | `containmentRefusal` at `runJob` from `app.job_origin` | 0603 | `external-containment` 19/19, `containment.test` | Run 1-4 live suites cancel fixtures before the worker runs them | PP | none |
| A4 | Unknown origin read as real traffic | positive origin model, `adapter_key_ok`, `internal_root_ok` | 0603-0605 | `synthetic-origins` 36/36, `legit-origins` 24/24 | Run 3 identity 26/26 live | PP | exact impersonation with the service key is the **stated limit** (AD) |
| A5 | Harness turns visible in the dashboard chat | `conversation_history` asks `harness_job` | 0602 | `chat-containment` 4/4 | `verify:history` on replica; not driven live in Run 5 | IO | none known |
| A6 | Dormant direct sends: telegram-webhook voice refusal and GitHub dispatch (#380) | voice dispatch now asks the CI ledger; refusal send is reachable only by a signed voice update (transcription `api`) | 0626 (Run 5) | `ci-voice-ledger` 8/8, `telegram-voice-dispatch-ledger.test` | see ARCHITECTURE-RUN-5.md Production | see Run 5 | refusal-message send itself stays dormant (AD) |
| A7 | `is_fixture`-only display readers and briefing branches (#380) | filtered where they reach outward; the rest display only | 0597-0604 | `check:leaks` | 0 harness rows reach them | AD | #380 stays open |
| A8 | Reads are ungated (`browser.gather` etc.) | none, by design | - | - | - | AD | stated in the audit |
| A9 | `provision_missing_channels` is time-gated, not lineage-gated | 0419 15-minute rule, 0477 one-attempt-a-day | 0419, 0477 | `verify:identity` | live before this campaign | AD | #380 |
| A10 | `check:callers` red on main (`app.deliverable_to`, `app.release_test_origins`) (#395) | not addressed | - | `npm run check:callers` | still red at Run 5 baseline (fails identically at `513a19bc`) | OP | #395 - a baseline entry with a true reason, or callers |

## B. Semantic boundary (Run 1)

| # | Finding | Remediation | Migration | Test | Production evidence | Class | Debt |
|---|---|---|---|---|---|---|---|
| B1 | Sender authorisation: a stranger could take over `telegram_chat_for('grant')` | admission by `subject_identities` at the door | 0607 | `sender-authorization` 31/31 | run1 live 15/15 | PP | #392 item 2 (shared secret) AD |
| B2 | Approver identity | answer attributes the principal, not `p_by` | 0608 | `approver-identity` 39/39 (+Run 5 fixture update) | run1 live | PP | none |
| B3 | Bare "No." with a waiting question | peeled leading answer | Run 1 code | `open-question` 48/48 | run1 live | PP | none |
| B4 | Fan-in attempt starvation | 0609 refunds only bounded waits | 0609 | `fan-in-waits` 6/6 | identity of function body; not run live | IO | superseded in part by 0625's claim (no refund is trusted) |
| B5 | `governOutward` "Yes, do it" offered for everything | options describe the action | code | `outward-options` 12/12 | function-body identity | IO | none |
| B6 | Drive/channel options promised what the press could not do | 0610 | 0610 | `drive-options`, `channel-options` | function-body identity | IO | none |
| B7 | Swallowed `raiseBlocker` | failure surfaces | code | `blocker-failure` 7/7 | run1 live | PP | none |

## C. Authority (Run 2)

| # | Finding | Remediation | Test | Evidence | Class | Debt |
|---|---|---|---|---|---|---|
| C1 | Policy asked only on some paths | `app.authorize_effect` for migrated paths | `authority` suites | run2 live 53/53 | PP | C6 |
| C2 | Approval matched by a time window and a sentence parse | `action_fingerprint`; answer is a column | `approval-binding` 30/30 | run2 live | PP | none |
| C3 | A No did not last | durable refusal + withdrawal | `refusal-reversal` | run2 live | PP | none |
| C4 | Approver could be forged/unasked | `approval_verdict`: forged/none/unasked | `approval-execution` | run3 live | PP | none |
| C5 | Anon-executable functions (#384) | 0613: the public key reaches no function | `anon-surface` | live: 0 reachable | PP | none |
| C6 | Effect doors not behind the boundary (#386) | Run 3 migrated the plan/notebook/duty doors | `exactly-once`, effects live 12/12 | run3 effects live | PP (migrated) / OP (rest) | #386 |
| C7 | Bearer token attributed as Grant (#385) | principal model: service key is a machine (0614) | `principals` | run3 live | PP | #390 |
| C8 | `suggest` equals `act_with_review` (#387) | unchanged | - | - | OP | #387 (a decision) |
| C9 | Four system duties write outside unprompted (#389) | none (needs Grant) | - | - | OP | see `DECISION-389.md` |
| C10 | Ungated write targets (#393) | none | - | - | OP | criteria recorded on the issue |
| C11 | Gateway authority setters rely on the gateway alone (#390) | not addressed | - | - | OP | #390 |

## D. Identity at the door (Run 3, Run 5)

| # | Finding | Remediation | Test | Evidence | Class | Debt |
|---|---|---|---|---|---|---|
| D1 | Slack sender not admitted (#388) | `sender_admitted` | `slack-sender` | run3 live | PP | issue still open for the team_id half |
| D2 | `staff_for_bot` failure read as "unknown bot"; enqueue failure swallowed into a 200 (message loss) | fail closed, 503 | `sender-authorization` | run3 | PP | none |
| D3 | Forwarded message carries his authority (#392.1, #397) | recorded at Telegram and Slack doors; answers nothing; not "asked for" at `may_act` | `typed-yes`, `forwarded-authority` 8/8 | Run 5 Production | see Run 5 | a forwarded turn is still `trusted` for provenance (it IS his message) - the authority to act unasked is what is withheld |
| D4 | Telegram bar is a shared secret plus a public user id; no replay protection (#392.2) | none (credential-strength) | - | - | AD | rotate on suspicion; per-bot secret |
| D5 | Slack `team_id` unbound (#392.3) | none | - | - | OP | needs a workspace allow-list; fixtures pollute `slack_workspaces` |

## E. Lifecycle (Run 4, Run 5)

| # | Finding | Remediation | Test | Evidence | Class | Debt |
|---|---|---|---|---|---|---|
| E1 | A job forgot where it came from | origin columns written once by trigger | `job-origin` | run4 live 24/24 | PP | legacy jobs keep inference |
| E2 | A stale worker finished a job another held | fence (leased_by, attempt) | `job-lifecycle` 27/27 | run4 live | PP | superseded by the claim (E5) |
| E3 | Retried parent duplicated children | `job_child_slots` | `job-delegation` | run4 live | PP | E6 |
| E4 | Typed yes bound to the job's last message (#394, #396) | a delivery names its question (0623) | `question-binding` 27/27, `typed-yes` | Run 5 Production | see Run 5 | dashboard/voice by tree only (Cross-channel debt) |
| E5 | A refunded attempt number could pass a zombie (#398.3) | `jobs.claim_gen` (0625) | `job-fence` 14/14 | Run 5 Production | see Run 5 | none |
| E6 | `enqueue_child` cannot tell who asks (#398.1-2) | caller args, stale caller refused, deferral keyed on its own claim, dead parent refuses | `job-fence`, architecture test | Run 5 Production | see Run 5 | `agents/perform.ts` step still passes no caller (AD, named in the test) |
| E7 | assertHeld then insert not atomic (#398.4) | same-statement `job_held` on the output insert | `job-fence` | Run 5 Production | see Run 5 | other writes still use the pair |
| E8 | Voice-note dispatch bypassed the CI ledger (#391) | 0626 | `ci-voice-ledger` | Run 5 Production | see Run 5 | none |

## F. Totals

PP rows are proven in production by a recorded live suite or a production probe. IO rows are proven on the replica against
the real functions and are recorded as such. AD rows are decisions recorded with their reason. **OP: A10, C8, C9, C10,
C11, D5** - six rows, each with an issue. Because OP rows exist, and because Run 5's own PP claims for E4-E8 rest on a
production verification recorded in `ARCHITECTURE-RUN-5.md`, **the audit is not declared complete.**
