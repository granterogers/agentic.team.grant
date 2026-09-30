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

---

# Production integration record (2026-09-29) — IN PROGRESS, blocked before migration

## Correction to section 6
The Run 1 handoff said only `telegram-webhook` and `hq-api` needed redeploying. **That was incomplete.**
Walking each edge function's import graph against `git diff bbe9956c..HEAD` shows the **`worker`**
also imports thirteen changed files (`src/handlers/instruction.ts`, `src/agents/{turn,entitled,gates,perform,approval}.ts`,
`src/handlers/{drive,channels,calendar-tasks}.ts`, `src/inference/{policy,record}.ts`, `src/office/pass.ts`,
`src/channels/callbacks.ts`). The worker MUST be redeployed. `slack-events`, `voice`, `voice-token`, `mcp`,
`signin`, `google-oauth` import none. Also: `hq-api` and `telegram-webhook` both call functions whose
signatures 0608 changes, so migration and all three deploys must be done back-to-back (no traffic: production
had zero live jobs when checked).

## Verified before touching production
- main unmoved: `origin/main` = `bbe9956c`; Run 1 branch fast-forwards it (0 behind, 11 ahead).
- Production migration position: 619 applied, head = 0606; `migrate --dry` would apply exactly 0607–0610.
- Grant's identities exist in `subject_identities` (telegram 1386648496, slack U0BUNF6AALC, voice grant), so 0607 cannot lock him out.
- Candidate gate: biome, tsc, vitest 234/3,671, check:migrations/secrets/templates clean; the isolated replica was
  rebuilt from the repository and `run-all.sh` passes every suite (rc=0).
- Barrier sabotage: importing `readPlan` directly into `instruction.ts` turns `gates.test.ts` red.
- One integration finding, test-only: `correction-containment` failed 3/5 on the faithful replica because the chief
  already owns the only bot row (fixture's `on conflict do nothing` did nothing). Fixture now uses the existing row.

## Rollback point
- Repository: `bbe9956c` (main); deploy scripts deploy the working tree, so rollback = check out `bbe9956c`, re-run deploy scripts.
- Database: `docs/architecture-run-1/rollback-0606.sql` holds the production definition of every function 0607–0610
  replace or drop (captured read-only at migration 0606).
- Runtime before: worker v848, hq-api v781, telegram-webhook v601 (Supabase function versions).

## Residuals confirmed read-only
- R9: `telegram-webhook` still returns 200 `ignored` when `staff_for_bot` yields no row (including an error body).
- R6: Slack actor is the Slack user id, resolved to a subject by `subject_for`; Grant's Slack id is mapped. A safe
  allowlist = refuse non-synthetic production-door Slack commands whose subject is null, mirroring 0607, after
  excluding bot/app messages; not enabled here.

## Production integration performed (2026-09-30, approved by Grant)
| Step | Result |
|---|---|
| `npm run migrate` | applied 0607, 0608, 0609, 0610 (1.0-1.1 s each); 623 recorded; `applied.json` committed |
| `npm run deploy:worker` | worker ACTIVE, liveness ok, unauthenticated kick 401, authenticated kick 200 |
| `npm run deploy:hq` | hq-api ACTIVE (unauthenticated 401, authenticated 200). **The Vercel page step failed** (`Request body too large. Limit: 10mb`); the page is unchanged from `bbe9956c`, so the page already live is byte-for-byte what main serves. This is a pre-existing deploy-size limit, not a Run 1 effect, and is carried forward as VERIFICATION/DEPLOY DEBT. |
| `npm run deploy:telegram` | telegram-webhook ACTIVE, liveness ok, `setWebhook` ok, 0 pending, no last error |
Deployed versions after the operation: worker v852, hq-api v785, telegram-webhook v605 (before: v848 / v781 / v601).
Migration position check afterwards: head 0610. Prod function definitions for all 16 functions 0607-0610 touch are
md5-identical to the candidate database the isolated suites ran against.

## Production verification (`scripts/verify/run1-live.ts`, 14/14)
Every conversation is declared test traffic before it knocks (synthetic at the door); the question a turn answers is a
fixture blocker on a job cancelled in the statement that creates it, so the deployed worker never runs it.
LIVE VERIFIED, through the deployed doors:
- 0607: a stranger in a private chat, a stranger naming Grant's chat id, and an update with no sender are all HTTP 200 `ignored: unrecognised sender` and change nothing (chats, commands, jobs, lessons, blockers, Grant's delivery chats unchanged); Grant's id resolves to Grant; Grant's id in a declared test chat is admitted as Grant and stamped synthetic.
- Bare "No." with a waiting question: blocker resolved "No, leave it - answered by grant"; the reply is "Taken as a no", not "what did I get wrong".
- Mixed turn "Yes - and remind me tomorrow.": blocker resolved "Yes, do it"; the reply names the remainder ("You also said ... I have not acted on that part").
- A qualified yes ("Do that, but dont send it.") approves nothing.
- Negative control, nothing waiting: "Yes, do it. Create the task to book the hall." stays an ordinary command (task filed, no "Taken as a yes").
- 0608: unauthenticated answer 401 and the question stays open; authenticated answer is recorded "answered by grant" whatever `p_by` the client sent; an absent principal at the database is refused and does not become "grant".
- Containment: `npm run check:leaks` exit 0 after teardown (55 sent messages traced, harness sent 0, declared-test sent 0, witness and predicate disagree on 0). Debris from the run (five personal to-dos, two blockers, one fixture task) was removed through `my_task_delete`, `answer_blocker` and `purge:fixtures --go`.
- Ordinary Claire use: a real dashboard question in `ai-team-hq-test` ("which projects do we have open?") completed and returned the four open projects; no failed or retrying jobs since deploy. Its wording ("I have not done this yet, and nothing has been changed" in front of a correct list) is pre-existing: the same phrase appears in outputs from 22-28 September, before Run 1.
PRODUCTION-EQUIVALENT VERIFIED (not run live): 0609 (a wait is not an attempt; provider outage still counts) and 0610 (an answer performs what the question promised; unsupported options not offered) - by function-body identity with the candidate database plus the isolated suites `fan-in-waits`, `drive-options`, `channel-options`, `outward-options`. Hostile-resolver entitlement (`turn-entitlement` 12/12): NOT SAFE TO VERIFY LIVE (it needs a sabotaged shared resolver); the deployed code is the tested code.
Not exercised live: a competent model on the standing-preference remainder case ("Yes, do it. Also from now on ...") because it would store a real standing rule attributed to Grant; covered by `mixed-turns`.

## Run 1 still-open residuals (carried unchanged)
R1 understand() placement (ENGINEERING DEBT); R2 degraded-model multi-clause task title, seen again live ("do it. Create the task to book the hall") (BUG); R3 "Save this link..." stored as a standing preference (BUG, semantic classification); R4 task-tick approval door (ARCHITECTURAL, Run 2); R5 a declined action is re-asked (ARCHITECTURAL, Run 2); R6 Slack sender allowlist (MISSING CAPABILITY, do not enable blindly); R7 isolated suites outside `npm run gate` (VERIFICATION GAP); R8 competent-model mixed-turn evidence (VERIFICATION GAP); R9 telegram-webhook returns 200 "ignored" when `staff_for_bot` returns no row (BUG, confirmed still true).
The `correction-containment` change is a FIXTURE-ONLY integration correction (test file); no production behaviour changed for it.

## STATUS: RUN 1 PRODUCTION GATE PASSED (earlier 'blocked' note superseded by Grant's approval)
