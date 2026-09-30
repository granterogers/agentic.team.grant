# Architecture Run 2 — authority and approval

Branch `claude/architecture-run-2-authority`, from `main` @ `08f0aa12` (Run 1, deployed and verified). Migrations **0611** and **0612**.
Production state is recorded at the END of this document (it changes as the run is deployed); read that section before trusting any other line.

## What Run 2 establishes, and what it does not
The canonical authorization and exact-approval architecture (`app.authorize_effect`, exact-action fingerprints, a durable and reversible No, the to-do tick through the one door) is established and proven for the **migrated paths**: plan steps, the calendar duty (`governOutward`) and `drive.ingest`. **It is not true that every consequential effect is behind `authorize_effect`.** The unmigrated doors are listed below and in issue #386 and stay explicit follow-up work.

## Run 2 status
| Area | Status | Evidence |
|---|---|---|
| Reconnaissance | RECONNAISSANCE COMPLETE | `docs/architecture-run-2/AUTHORITY-MAP.md` (deciders, effects and their gates, traced cases) |
| Characterization | CHARACTERIZATION COMPLETE | `authority-characterization.ts` 18/18: matrix (12 cells), disabled and unknown tools, asked-for, standing; it first pinned the three gaps at commit `2a8447de` (22/22, three KNOWN GAP checks), which 0611 then flipped |
| Authorization boundary | AUTHORIZATION COMPLETE **for the paths that already asked the policy** (plan steps, calendar duty via `governOutward`; `drive.ingest` reaches it through `mayAct`) — PARTIAL overall | `app.authorize_effect`; `authority.ts` 88/88, five sabotages each turn it red |
| Specialist / tool authority | COMPLETE for a step that names a specialist; the office acting as itself is unchanged by design | `staff_may_use` is now a runtime input; the grant cannot lift a switched-off tool |
| Autonomy / standing as inputs | COMPLETE (unchanged inputs inside `may_act`); an OPEN DECISION for Grant is recorded below | matrix, standing, outside-audience floor |
| Approval | APPROVAL COMPLETE for the blocker lifecycle; PARTIAL overall | `action_fingerprint` on the question replaces the ±10 s window and the resolution-sentence parse; the answer is a column; the button path writes it too |
| Task-tick | COMPLETE | tick = `hq_answer_blocker` as a known principal, or the to-do is reopened and the reply says so |
| Durable refusal | REFUSAL COMPLETE | exact fingerprint / duty `(tool, project)`, window `approval.refusal_days`, later answer takes it back, cancelled job is not a refusal, different action asks afresh, a duty stays quiet (announce off, no fault recorded) |
| Exactly-once | EXACTLY-ONCE COMPLETE for the approval lifecycle and for the checkpoint engine; PARTIAL for effects outside the boundary | `exactly-once.ts` 6/6 (parked external step, reconcile, local control, repeat resumes, two racing workers, changed code), `approval-execution` 15/15, `approval-race`; sabotage red |
| Effects not yet behind the boundary | NOT STARTED (deliberately) | `notebook.generate`, `office.execute_plan` (blocker-only); `notebook.add_source`, `notebook.push_document`, `office.notion_import`, `tasks.sync`, `office.provision_channels`, `google.revoke` (containment-only); the raw sends in `telegram-webhook` and `vault-export` |

## Decisions made by Grant during this run
- **Internal office work proceeds at the default dial (0612).** `autonomy_policy` `suggest × level 1` `ask → proceed`, and `drive.ingest` `level 1 → 2` (it brings in material from somebody else's system; its question is deliberate). Data, not a branch. Every level-2/3 cell, the outside-audience floor and the switched-off level-1 tools are unchanged. Consequence: `suggest` and `act_with_review` now resolve identically (issue #387).
- **A remembered No can be taken back, explicitly (0611).** `app.withdraw_refusal`, the Governance card *Let it ask again* and the gateway action `withdraw_refusal`. Never approves; attributed; gateway-only (the function refuses any call that did not arrive through PostgREST with the service key). See ADR-0053.

## Independent reviews (three passes, `/code-review`)
1. First draft: 8 findings, 6 fixed (the worst: a remembered No would have failed the calendar duty on an empty body).
2. Candidate with both decisions: 15 findings. Fixed: the identity-bearing wrappers were executable by `anon` (Supabase's default ACL; 0607/0608 had revoked only from PUBLIC); a No recorded for this step was overridden by 0612's proceed; the button door could overwrite a racing answer; the specialist's grant was skipped for the duty; the pre-existing suites that relied on a level-1 step asking were red (approval-execution, blocker-failure, verify:pursues); harness Nos could bind real duties; refused ticks of blocked to-dos; the fallbacks that made the deploy order look forgiving; honest dates; named arguments.
3. After those fixes: 14 findings. Fixed: the in-flight fingerprint no longer matched the new shape (legacy fingerprint accepted); the four authority setters (`hq_autonomy_set`, `hq_staff_tool_set`, `approve_document`, `discard_document`) and every `p_by` function closed to `anon`; the Approve/Decline buttons now answer through `hq_answer_blocker` (they used to queue a `notebook.generate` for any question and stored the wrong option); reversal is gateway-only by a claims check (the earlier "ai_team_app cannot execute it" claim was false — the worker connects as a database owner); a to-do pulled done from an external board is reconciled without a permanent impediment per sync; no undo is offered for a tick that answered a question; the floor starts at level 1 and an unrecognised audience word means outside; one `app.refusal_days()`; the pause text no longer tells Grant to raise a dial that cannot lift the floor.
Recorded, deliberately not fixed here: `suggest ≡ act_with_review` (#387), capabilities no specialist holds (#387), the other ~250 anon-executable functions (#384), the bearer token attributed as `grant` (#385), the unmigrated effect doors (#386), Slack allowlist / `staff_for_bot` (#388).

## Invariants now enforced (each has a test that goes red when the mechanism is removed)
A named specialist may only do what its grant allows (plan steps and the duty) · an outside audience never proceeds without an approval on file · an answer approves exactly the step, what it is for, what it depends on, who acts and who it reaches · a No recorded for a step beats the dial, a standing row and any matrix cell · a No is remembered for a window, does not spread to a different action, and is heard only by the same kind of traffic (harness or real) · taking a No back never approves, is attributed, and is reachable only through the gateway · a to-do tick answers as a named principal or not at all and its reply matches the stored task · the buttons answer through the one door · the identity-bearing wrappers and authority setters are not executable by `anon` · an external step interrupted mid-write is parked, not repeated · a finished step is never re-run.

## Deploy order (strict, one direction)
Migration **0611** → deploy `worker` and `hq-api` → migration **0612**. The new code has no fallback to the old policy (it would re-ask forever and a loose catch also swallows failures inside the boundary): a worker ahead of 0611 fails loudly and retries; the old worker keeps working after 0611. 0612 comes last so the old worker never sees a level-1 step proceed after a No it cannot read. Both migrations are safe on an idle office; production had no live jobs when applied.

## Production state — code committed / merged / deployed / migrations applied / verified live
Run 1: committed, merged, deployed, applied, verified live (`verify:run1-live` 14/14 against production, re-run after Run 2).

Run 2 (integrated 30 September 2026, in the strict order):
- **Migrations applied to production:** 0611, then 0612 (625 recorded). Nothing else.
- **Runtime deployed:** `worker` v855 and `hq-api` v790. `telegram-webhook` (v606) and every other function were NOT touched.
- **Page:** Vercel deployment `dpl_B4dsLwpGdCHqqXA1ehxombNj7NxW`, made with `npm run deploy:hq-page` (`scripts/deploy/hq-page-delta.ts`): the same file set as `deploy:hq`, sent as digests with only missing files uploaded, because `deploy:hq`'s inline body exceeds Vercel's 10 MB limit. It refuses unless the file NAMES equal the live deployment's; they did (the only extras live were Vercel's own `out/` build outputs). Served `app.js`, `settings.js`, `studio.css` and `index.html` are byte-identical (sha1) to the repository; the page loads with no page errors. **Rollback point:** `dpl_CojPMBWNXjWfQ3ogNAmXx6ZyAB9e`.
- **Verified live:** `verify:run2-live` 50/50 (authorization, exact approval, durable No, reversal, task tick, exactly-once from production-safe evidence, containment), all fixtures declared before the door was knocked on, all torn down; `check:leaks` exit 0; ordinary use of Claire (the four real projects listed) unaffected.
- **Compatibility window:** between 0611 and the worker deploy, the OLD worker keeps working (it never calls the new function); a worker ahead of 0611 would fail loudly and retry. 0612 was applied only after both deploys, so no old worker ever saw a level-1 step proceed after a No it could not read.
- **Merged:** `main` fast-forwarded from `f8ab9c5a` to the tip of this branch after production verification passed.

## Not established (carried forward, each an Issue)
#384 the other ~250 anon-executable functions · #385 the bearer token is attributed as `grant`, so possession can confer Grant's approval identity · #386 the unmigrated effect doors · #387 `suggest` equals `act_with_review`; capabilities no specialist holds · #388 Slack sender allowlist and `staff_for_bot` answering 200 "ignored".
