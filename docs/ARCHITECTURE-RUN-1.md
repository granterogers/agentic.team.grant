# Architecture Run 1 — handoff

## 1. Baseline
Started on `main` = `bbe9956c32851ec2c1ef0eb3f0104acf9e933959`, clean tree, no divergence.
Branch `claude/architecture-run-1-semantic-boundary`. End SHA: see `git log` (last code commit
"fix: a turn that answers a question and asks for something keeps both", followed by docs commits).
Tree clean after final commit.

## 2. B1–B7
| | Status | Evidence |
|---|---|---|
| B1 sender authorisation | CONFIRMED + FIXED (worse than audited: a stranger could take over `telegram_chat_for('grant')`) | `sender-authorization` 8/31 → 31/31; migration 0607; edge webhook |
| B2 approver identity | CONFIRMED + FIXED | `approver-identity` 39/39, three sabotages each red; 0608 |
| B3 bare "No." | CONFIRMED + FIXED | `open-question` 48/48 (6 red on baseline) |
| B4 fan-in attempt starvation | CONFIRMED + FIXED | `fan-in-waits` 6/6; 0609 refunds only bounded waits |
| B5 `governOutward` "Yes, do it" | CONFIRMED + FIXED | `outward-options` 12/12 |
| B6 Drive/channel options | CONFIRMED + FIXED | `drive-options` 4/4, `channel-options` 4/4; 0610 |
| B7 swallowed `raiseBlocker` | CONFIRMED + FIXED | `blocker-failure` 7/7 |

## 3. Semantic architecture before
Raw, cleaned, kept and resolver-paraphrase text all flowed as `string`; each reader picked one.
Permitting readers (plan, link, page, tasks, rules, call-off) sometimes read the paraphrase.
A bare yes/no was decided by `spokenAnswer` on the whole message, so any extra clause lost
either the answer or the clause. See `docs/architecture-run-1/CHARACTERIZATION.md`.

## 4. After
- `Turn` (frozen) built once after the resolver; `HumanWords`/`Paraphrase` brands; `resolved`
  is routing-only. `entitled.*` is the only door to consequence-bearing readers.
- Gate precedence in `gates.ts`: answer > reject > close; a whole-message answer also outranks the call-off gate.
- Mixed turns: leading bare yes/no peeled only when a question waits; remainder continues through the
  cascade (planned/filed/taught); an unactionable remainder is named in the reply.
- Entitlement: a hostile resolver can no longer start a plan, save a link, open a page, file a task,
  store a rule or cancel work. `understand()` reads `turn.kept`.
ADR-0052.

## 5. Files
`src/agents/{turn,entitled,gates}.ts` (new); `src/handlers/instruction.ts` (Turn wiring, entitled
readers, answer peel + leftover, gate order); `src/agents/approval.ts`, `perform.ts`;
`src/handlers/{drive,channels,calendar-tasks}.ts`; `src/inference/{policy,record}.ts`;
`src/channels/{telegram,callbacks}.ts`; `src/office/pass.ts`; `supabase/functions/{telegram-webhook,hq-api}`;
tests and isolated suites listed below; ten wording-lock tests re-pointed at the new wiring
(same property, new expression).

## 6. Migrations (pending — NOT applied to production)
0607 sender refused at the door; 0608 approver principal; 0609 a wait is not an attempt;
0610 an answer may perform what the question promised. Deploy: apply 0607–0610, redeploy
`telegram-webhook` and `hq-api`. Open blockers with the old three-option shape remain as data.

## 7. Tests
- Unit/behavioural (vitest): 234 files / 3,671 tests pass; incl. `turn` (31), `gates` (21, truth table + import barrier).
- `biome ci`, `tsc`, `check:migrations`, `check:secrets`, `check:templates`: clean.
- Isolated DB (OUTSIDE `npm run gate`; `scripts/isolated/run-all.sh`, fresh copy per suite, rc=0):
  recovery matrix, drain, destination-retirement 13, history-shapes 7, test-origins 47, witness-test-origins 10,
  legit-origins 24, synthetic-origins 36, task-content 5, narration 11, external 19, correction 5, chat 4,
  witness-independence 12, approval-execution 15, approval-delivery 9, containment 19, acknowledgement 32,
  acknowledgement-sequence 36, project-provenance 20, paused-incoherent 8, ask-unasked-loop 19,
  sender-authorization 31, approver-identity 39, open-question 48, fan-in-waits 6, outward-options 12,
  drive-options 4, channel-options 4, blocker-failure 7, turn-entitlement 12, mixed-turns 12, overlapping answers PASS.
- Adversarial / sabotage: hostile-resolver suite (baseline 9/12 → 12/12); mixed-turns sabotage
  (remainder note disabled → 11/12, restored → 12/12); B2 gateway/button sabotages; negative controls
  (nothing waiting ⇒ "Yes, do it. Create the task" still a command; qualified yes not an approval).
- Phase 12 messages run with the degraded model, with/without an open blocker: none executed a
  withdrawn or qualified action. No live `verify:*` was run against production.

## 8. Invariants advanced
Only known senders act; approvals are attributed to a named principal; a model paraphrase never
authorises; an answer outranks generic rejection; no clause silently dropped; an option promises only
what the press performs; a wait is not an attempt; a failed blocker write is recorded.

## 9. Remaining problems
- ENGINEERING DEBT: `understand()` still runs after the plan/populate/teach early returns (moving it costs a model call on simple turns).
- BUG (degraded-model fallback only): several clauses in one message can become one mangled task title ("Call Kevin, and what projects do we have?"; "do it. Create the task…").
- BUG: "Save this link…" heuristically stores a standing preference.
- ARCHITECTURAL: task-tick door (`task_answers_blocker`) bypasses `hq_answer_blocker`; no durable "No" (`governOutward` re-asks).
- MISSING CAPABILITY: Slack sender allowlist (deliberately not enforced blind; `subject_identities` ready).
- VERIFICATION GAP: isolated suites are not in `npm run gate`; competent-model mixed-turn behaviour proven only with scripted/degraded models.
- BUG (out of scope): `telegram-webhook` `staff_for_bot` failure returns 200 "ignored".
- Everything else in the audit (staff_may_use unenforced, autonomy dial unread, …) is Run 2.

## 10. Run 2 readiness
YES for the semantic boundary and B1–B7 (all proven by behavioural tests). Conditional on applying 0607–0610 and redeploying the two edge functions.

## 11. Recommended Run 2 start
Unified `authorize_effect` over the entitled readers + `staff_may_use`, folding the task-tick approval door into `hq_answer_blocker`, then bringing the isolated suites into the gate.
