# ADR-0053 — Authorization is asked once, an ask is bound to the exact action, and a No is remembered

**Status:** accepted as a candidate (Architecture Run 2). Migration 0611 is written and proven in isolation; it is not applied to production.

## Context
The Run 2 map (`docs/architecture-run-2/AUTHORITY-MAP.md`) found six independent deciders of "may this effect happen?" and six of "has it been approved?". Three of them were wrong in ways that reached Grant: a specialist's grant (`staff_may_use`) was never consulted at runtime; a No to a duty's question was forgotten and asked again; and ticking the to-do that stands for a question answered it as nobody, with the first option, without running what answering promised.

## Decision
1. `app.authorize_effect(project, tool, asked_job, staff, audience, fingerprint, job)` is the one decision boundary for a consequential effect. It calls `app.may_act` unchanged (matrix, dial, standing rows, "a person asked") and layers what `may_act` cannot know: the named specialist's grant, an outside-audience floor, the exact approval or refusal already on file, and a refusal window (`system_config` `approval.refusal_days`, 30). `mayAct()` is the only TypeScript door.
2. An ask is bound to the exact action: `blockers.action_fingerprint` is the same sha256 `job_pauses.binds_to` holds. `answerFor`'s +-10 second window and resolution-sentence parse are retired.
3. The answer is a column (`answered_option`, `answered_by`); `resolution` stays for people and nothing parses it.
4. A No is durable and specific: `decline_option` names it, the exact fingerprint (or a duty's tool + project when no fingerprint exists) is refused for the window, a later answer takes it back, a cancelled job is not a refusal, and a different action asks afresh. A duty that is refused says nothing and records no fault.
5. The to-do tick is an answer through `app.hq_answer_blocker`, as a principal the door recorded (`tasks.completed_by`), or the task is reopened and the question stays open.
6. Containment (`may_act_outside`, `claim_delivery`) stays an independent witness and is not folded in.

## Consequences
- A step that names a specialist who lacks the grant performs nothing. A step naming nobody is the office acting as itself (enforcing it against the Chief of Staff would refuse `task.extract` and `drive.ingest`, which no staff member holds today; granting them is Grant's decision).
- Effects still outside the boundary, by design of this run: `notebook.generate` and `office.execute_plan` (blocker-only), `notebook.add_source`, `notebook.push_document`, `office.notion_import`, `tasks.sync`, `office.provision_channels`, `google.revoke` (containment-only). Each needs its own plan or dry run to be governed honestly; that is the next boundary.
- Deploy order is forgiving both ways. A worker that ships BEFORE 0611 falls back to `app.may_act` (undefined-function error only) and writes questions without the new columns (undefined-column error only); the migration backfills questions in flight (open, or answered on a job that has not finished) so a resumed step still finds its answer. A migration that lands before the new code is safe: `may_act` and every old signature still exist, and a tick from the old gateway (no `p_by`) is reopened, not answered as nobody. Apply 0611, then deploy `worker` and `hq-api` together.
- A No is sticky across jobs and a Yes is per-job, on purpose: a refusal fails toward doing less. The cost is that there is no explicit way to take a No back inside the window except a standing yes, raising the dial, or waiting; an `unsay` path is the first item of the next approval work (ENGINEERING DEBT).
- The bearer token is attributed as `grant` (0608's design: one machine credential, one owner). An agent or script holding it can answer approvals as Grant. That is the token model, not this boundary; making the credential a person-bound session is a security follow-up (ARCHITECTURAL).

## What would reverse this
A second `may_act` caller in the handlers that bypasses `mayAct`; a parse of `resolution` to learn an answer; the tick resolving a blocker without `hq_answer_blocker`; `authorize_effect` gaining a path to `proceed` for an outside audience without an approval on file.
