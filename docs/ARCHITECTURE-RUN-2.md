# Architecture Run 2 — authority and approval (CANDIDATE, not merged, not deployed)

Branch `claude/architecture-run-2-authority`, from `main` @ `08f0aa12` (Run 1, deployed and verified). Migration **0611** is written and proven in
isolation; **it is not applied to production and the branch is not merged**, because `main` is what production runs and this code needs 0611.

## Run 1 production status: PASS
main `f8ab9c5a` (docs on top of `08f0aa12`); migrations 0607–0610 applied; worker v852, hq-api v787, telegram-webhook v605; `verify:run1-live` 14/14
through the deployed doors; `check:leaks` exit 0. Full record: `docs/ARCHITECTURE-RUN-1.md`.

## Run 2 status
| Area | Status | Evidence |
|---|---|---|
| Reconnaissance | RECONNAISSANCE COMPLETE | `docs/architecture-run-2/AUTHORITY-MAP.md` (deciders, effects and their gates, traced cases) |
| Characterization | CHARACTERIZATION COMPLETE | `authority-characterization.ts` 18/18: matrix (12 cells), disabled and unknown tools, asked-for, standing; it first pinned the three gaps at commit `2a8447de` (22/22, three KNOWN GAP checks), which 0611 then flipped |
| Authorization boundary | AUTHORIZATION COMPLETE **for the paths that already asked the policy** (plan steps, calendar duty via `governOutward`; `drive.ingest` reaches it through `mayAct`) — PARTIAL overall | `app.authorize_effect`; `authority.ts` 36/36, five sabotages each turn it red |
| Specialist / tool authority | COMPLETE for a step that names a specialist; the office acting as itself is unchanged by design | `staff_may_use` is now a runtime input; the grant cannot lift a switched-off tool |
| Autonomy / standing as inputs | COMPLETE (unchanged inputs inside `may_act`); an OPEN DECISION for Grant is recorded below | matrix, standing, outside-audience floor |
| Approval | APPROVAL COMPLETE for the blocker lifecycle; PARTIAL overall | `action_fingerprint` on the question replaces the ±10 s window and the resolution-sentence parse; the answer is a column; the button path writes it too |
| Task-tick | COMPLETE | tick = `hq_answer_blocker` as a known principal, or the to-do is reopened and the reply says so |
| Durable refusal | REFUSAL COMPLETE | exact fingerprint / duty `(tool, project)`, window `approval.refusal_days`, later answer takes it back, cancelled job is not a refusal, different action asks afresh, a duty stays quiet (announce off, no fault recorded) |
| Exactly-once | EXACTLY-ONCE COMPLETE for the approval lifecycle and for the checkpoint engine; PARTIAL for effects outside the boundary | `exactly-once.ts` 6/6 (parked external step, reconcile, local control, repeat resumes, two racing workers, changed code), `approval-execution` 15/15, `approval-race`; sabotage red |
| Effects not yet behind the boundary | NOT STARTED (deliberately) | `notebook.generate`, `office.execute_plan` (blocker-only); `notebook.add_source`, `notebook.push_document`, `office.notion_import`, `tasks.sync`, `office.provision_channels`, `google.revoke` (containment-only); the raw sends in `telegram-webhook` and `vault-export` |

## Commits (Run 2)
`2a8447de` map + design + characterization · `c073cea4` the boundary, fingerprints, durable No, tick (0611) · `a03519da` backfill + ADR-0053 ·
`e06f8788` fixes for an independent code review's findings · `7348eb7a` exactly-once suite · `acd7342c` merge of main's HANDOFF.

## Migrations
Applied to production: 0607–0610 (Run 1). Written this run, candidate-only: **0611** (columns `blockers.action_fingerprint/decline_option/answered_option/answered_by`,
`tasks.completed_by`, config `approval.refusal_days`, `app.action_answer`, `app.authorize_effect`, spliced `hq_answer_blocker`, `answer_generation_approval`, `hq_task_state`, `task_answers_blocker`, a backfill of questions in flight).

## Tests
vitest 235 files / 3,668; biome, tsc, `check:migrations/secrets/templates/consumed/pressable/gateway-wrappers/answerable/door-origins/undo/capabilities` clean (`check:callers` fails identically on `main`: `app.deliverable_to`, `app.release_test_origins`).
Isolated `run-all.sh`: every earlier suite plus `authority-characterization` 18, `authority` 36, `exactly-once` 6 — all green with 0611 applied (rc=0). Not run: any live suite (0611 is not in production).

## Independent review
`/code-review high` found eight defects in the first draft; six were fixed and pinned (quiet remembered No — it would have failed the calendar duty on an empty body;
honest reply for a refused tick; button-path answers; backfill of live questions; forgiving deploy order in both directions; cached empty principal). Two are recorded, not fixed:
the bearer token is attributed as `grant` (0608's model: an agent holding it answers as Grant — ARCHITECTURAL, security follow-up) and a No is sticky across jobs while a Yes is per-job
(deliberate, fails toward doing less; there is no explicit "unsay" — ENGINEERING DEBT).

## Invariants now genuinely enforced (each has a red-on-sabotage test)
A named specialist may only do what its grant allows · an outside audience never proceeds without an approval on file · an answer approves exactly the action it was asked about ·
a No is remembered for a window and does not spread to a different action · a to-do tick answers as a named principal or not at all · the reply of a task change matches the stored task ·
an external step interrupted mid-write is parked, not repeated · a finished step is never re-run.

## Remaining work (the next boundary)
1. Bring the containment-only and blocker-only effects behind `authorize_effect`, one handler at a time, each needing its own plan or dry run (see map). Start with `notebook.generate` (a third "approved?" test lives in `notebook.ts:325`).
2. An explicit `unsay`/reopen path for a durable No.
3. **OPEN DECISION FOR GRANT (not made here):** at the default `suggest` dial a level-1 internal write (a task, a draft) still asks, because that cell of `autonomy_policy` says so ("even for a draft"). The product rule says internal work proceeds; the matrix is his data. Recommended: set `suggest × 1` to `proceed` for internally-delivered tools, or leave it; either is a data edit, not code.
4. Person-bound credentials so the machine token cannot answer as Grant.
5. Slack sender allowlist (R6) and `staff_for_bot` 200-ignored (R9), unchanged from Run 1.
6. Bring the critical isolated suites into the canonical gate (R7).

## Production deployment of Run 2 (when Grant decides)
Apply 0611, then deploy `worker` and `hq-api` together (both orders are safe: fallbacks for a missing function/column and a backfill for questions in flight), then re-run `verify:run1-live` plus a new live check of a remembered No and a to-do tick through the deployed gateway. **None of that has been done.**

## Production state — code committed / merged / deployed / migrations applied / verified live
Run 1: committed, merged, deployed, applied, verified live. Run 2: committed and pushed on its branch; NOT merged; NOT deployed; 0611 NOT applied; NOT verified live.
