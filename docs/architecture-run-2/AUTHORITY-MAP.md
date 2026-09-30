# Run 2 — the authority and approval map, as it is on `main` @ 08f0aa12 (production 0610)

Read-only reconnaissance. Every row was read from source or from the candidate/production database; a sweep by
agent was checked against the primary files for the rows that carry a decision (approval.ts, containment.ts,
perform.ts, the SQL bodies of `app.may_act`, `app.hq_answer_blocker`, `app.task_answers_blocker`).

## The independent deciders of "may this effect happen?"
| # | Decider | Reads | Consulted by |
|---|---|---|---|
| 1 | `app.may_act` (0423) via `mayAct` / `governOutward` | `tool_permissions.enabled/level`, `autonomy_for`, `autonomy_policy` (16 cells + level-3 CHECK), `standing_authorizations`, `jobs.requested_by` ("asked for") | **3 callers only**: `perform.ts:721` (plan steps), `calendar-tasks.ts:57`, `drive.ts:265` |
| 2 | `app.staff_may_use` / `tool_allowed` (0119, 0018) | `tool_permissions` AND `staff_tools` | **no runtime caller**: reporting (0213) and `app.request_tool`'s "already held?" (0215) only |
| 3 | `containmentRefusal` / `app.may_act_outside` / `job_origin` / `claim_delivery` | job lineage, origin, test declarations | worker before every external kind; every delivery. A harness-vs-real test, **not** a permission or approval test |
| 4 | per-connector switches | `knowledge_connectors.enabled`, `vikunja_settings`, `slack_app_credentials.enabled`, `ci_reserve`, notebook allowance meter | one handler each |
| 5 | goal validator (`goal.ts`) | model-declared `audience`, `DELIVERS_TO_PEOPLE` | plan composition only; `audience` is a model claim |
| 6 | duty `responsibilities.enabled` | "on = authorised" | calendar, tasks.sync |

## The independent deciders of "has this been approved?"
| # | Decider | How it binds the answer to the action |
|---|---|---|
| 1 | `blockers` + `app.hq_answer_blocker` (0608/0596/0610) | by blocker id; performs `standing_tool`, `on_answer`, `approval_next` |
| 2 | `answerFor` / `approvalStillBinds` (perform.ts, checkpoint.ts) | plan step: sha256 of {step, capability, project, why, needs} stored on `job_pauses.binds_to`; the blocker is found by **a ±10-second window** around the pause and the answer by **`resolution` text prefix** |
| 3 | `app.task_answers_blocker` (trigger on `tasks.state='done'`) | by `tasks.satisfies_blocker`; answers with the blocker's FIRST option; **no principal, no standing grant, no `on_answer`, no `approval_next`** |
| 4 | `notebook.ts:325` `payload.approved_by` | presence of a string in a job payload |
| 5 | `app.answer_generation_approval` / `request_approval` | fixed kinds `notebook.generate`, `office.execute_plan`; queues the follow-on job |
| 6 | `app.approve_tool` / `decline_tool` / standing wrappers | tool requests; principal-checked since 0608 |

## Effects and the gates in front of them
Messages: (3) only. Plan steps (`task.create`, `task.extract`, reads): (1)+(6-blocker)+step checkpoint. Calendar duty: (1)+(1)+(6). `drive.ingest`: (1)+blocker+`on_answer`.
`notebook.generate`: blocker only, **no `mayAct`, no `tool_permissions`**. `office.execute_plan`: blocker only. `notebook.add_source`, `notebook.push_document`
(also reachable from the MCP door), `office.notion_import`, `tasks.sync`, `office.provision_channels`, `google.revoke`: **containment only**.
Personal task from chat (`instruction.ts` `my_task_add`): no gate (user-asked, local). `office.vault_export`, the voice refusal notice and
`answerCallbackQuery` in `telegram-webhook`: raw sends outside the delivery layer.

## The traced cases
| case | today |
|---|---|
| internal read / write | level 0/1 in `may_act`; at `suggest` (every real project) a level-1 write **asks** unless a person asked; nothing else gates internal cognition |
| external reversible / consequential | level 2/3 cells; level 3 can never `proceed` (CHECK), but every enabled tool is level ≤ 2, so no level-3 path is live |
| contact another human | no tool contacts anyone but Grant; `gmail.send` is disabled; a plan step with `audience: outside` is refused at composition by a model-declared field |
| standing-authorised | upgrades `ask`→`proceed`, never `refuse`; refuses on level 3 |
| one-off approved | plan steps only (`governOutward`'s one-off was removed in B5) |
| declined | plan step: `declined` outcome, `final()`; **duty/`governOutward`: asked again next run** (characterised: `authority-characterization.ts`) |
| duplicate answer | `FOR UPDATE` in `hq_answer_blocker` (0596) — proved by `approval-race` |
| restart after approval | step checkpoints (`step_begin`: skip / park / stale) — proved by `approval-execution` |
| task-tick | resolves the blocker as nobody with the FIRST option (characterised) |
| synthetic external action | refused by containment before the handler (worker.ts:946) |
| specialist with / without a grant | **no difference**: the grant is never asked (characterised) |

## Writers of `tasks.state` that can fire the tick
`app.hq_task_state` (dashboard/chat "done"), `app.my_task_set`, `app.task_pulled` (an **external** task board pulling a done state), `app.tasks_repeat_on_done`,
and `app.blocker_closes_its_task` (the reverse direction). Only the first carries any door principal.
