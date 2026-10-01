# Final policy implementation

Baseline: `main` = `4053433f` (original architecture audit technically closed; migrations through 0639 live).
This document records, for each of Grant's seven decisions, what the code did BEFORE this change (traced from the
code and from production state, not from the older decision papers), what he decided, what changed, the risk, and
the proof. The decisions are final and are not reopened here.

## The one mechanism everything below goes through

`app.authorize_effect` -> `app.may_act` (`src/agents/approval.ts` `mayAct`, `src/handlers/approval-gate.ts`).

* A tool has a **level** (`tool_permissions.level`): 0 read, 1 internal write, 2 outward write, 3 consequential.
* The dial (`autonomy_settings`) and `autonomy_policy` turn (dial, level) into proceed / ask / refuse. Level 3 can
  never be `proceed` (a CHECK), and a level-3 tool cannot hold a standing authorization (a trigger).
* A **person asking** (`jobs.requested_by` not `duty:*`, trusted origin, not forwarded) turns ask into proceed below
  level 3. A duty is never "asking".
* A **standing authorization** (`standing_authorizations`, tool + optional project) turns ask into proceed.
  It is granted only by a person's press (`grant_standing(p_by)`).
* An **exact approval** (`blockers.action_fingerprint`, answered yes on the asking job) turns ask into proceed for
  exactly that fingerprint, including level 3. A recorded **No** stands for `approval.refusal_days`.
* `blockers.on_answer` starts a child job of the asking job when a named option is answered (`app.hq_answer_blocker`).

Before this change the four duties in #389 (`tasks.sync`, `office.provision_channels`/`rename_channels`,
`office.notion_import`, `office.slack_rotate`) were **not behind this mechanism at all**. They were held only by
containment (`runJob` refuses harness or unknown-origin work), which tests where work came from, not whether anyone
permitted it (audit AD3, ten ungated external kinds named in
`tests/architecture/every-external-kind-is-gated-or-named.test.ts`).

---

## Decision 1 - Vikunja: create/update automatic, delete needs approval

* **Before.** `tasks.sync` (`src/handlers/tasks-sync.ts` -> `src/tasks/sync.ts` `syncOnce`) pushed deletions, pushed
  upserts and pulled, with no authorization question for any of them. The duty ships disabled and `hq_set_vikunja`
  (a person's connect press, gateway `vikunja_connect`) switches it on. Production: Vikunja is not configured,
  `tasks.sync` is disabled, two completed runs on 20 Sept. Delete reaches the remote from two places: the push
  loop (a task Grant deleted here, from `app.tasks_to_push`) and the pull loop (`task_pulled` answers
  `deleted: true` for a remote task whose local copy is tombstoned). The recorded crash hazard: a crash between
  `provider.upsert` (remote PUT) and `app.task_pushed` leaves the task with no `external_id`, so the next round PUTs
  again and the remote holds two.
* **Desired.** Create and update proceed within normal authorized synchronization; delete needs explicit approval;
  authority for create/update never implies delete; exact approval, durable refusal, fingerprints, provenance and
  retry safety preserved.
* **Authorization path.** Two registry tools: `task.board.write` (level 2, destination-scoped) for create and update,
  and `task.board.delete` (level 3) for delete. A level-3 tool cannot be made standing, so "create/update authority
  implies delete" is structurally impossible, not a convention.
* **Existing tests.** `verify:vikunja` (real server), `tests/tasks/*`.
* **Required change.** Gate inside `syncOnce` through an injected authorizer (create/update: standing from the
  connection; delete: per-task exact approval raised as a question whose yes starts a child `tasks.sync` run);
  idempotency marker for create so a crash between PUT and `task_pushed` adopts instead of duplicating.
* **Risk.** A held delete leaves a tombstone pending; it must not resurrect the task and must not re-ask every
  fifteen minutes. Proof: dedupe on the open question, a No is remembered.

## Decision 2 - Slack project channels

* **Before.** `app.provision_missing_channels` (a sweep, `requested_by 'hq'`) enqueues `office.provision_channels`
  for any active, attached, non-fixture project older than 15 minutes with no channel, once a day;
  `app.hq_rename_project` enqueues `office.rename_channels`. `channelsHandler` then creates or renames the Slack
  channel with no authorization question (Slack cannot delete a channel). `hq_create_project` and
  `hq_rename_project` take no principal, so nothing records that Grant, rather than a duty, caused the project.
  Production: no provisioning since 17 Sept.
* **Desired.** An explicit project creation by Grant authorizes the normal channel provisioning for that project; a
  redundant "Create this project's normal Slack channel?" must not follow; unprompted creation/rename still asks;
  provenance durable and unforgeable; no broad standing Slack-channel permission.
* **Authorization path.** New registry tool `slack.channel` (level 2). Provenance is a row in a new table,
  `slack_channel_authority`, written ONLY by `app.hq_create_project` / `app.hq_rename_project` when their (new)
  `p_by` names a person the office admitted, or by `app.record_channel_authority` for a plan job that a person's own
  turn started (decided from the job's origin in the database, never from a payload). The handler reads the row,
  consumes it once, and otherwise asks through an exact approval.
* **Risk.** A machine or duty manufacturing the row; a retry creating twice. Proof: the row has no client-writable
  surface, a consumed row cannot authorize again, `ensureChannel` is already idempotent.

## Decision 3 - Notion import

* **Before.** `office.notion_import` (`src/handlers/notion-import.ts`) writes pages into the project's attached
  `role = home` Notion databases with no authorization question. `office.notion_adopt` inserts the attachments (it
  reads the workspace; the one production adopt was a `telegram:grant` job on 9 Sept). `office.notion_sync` only
  READS Notion into documents; it is not a Notion write and needs no gate.
* **Desired.** A deliberately connected database carries standing import/update authority, bound to that
  destination; another destination cannot inherit it; contents of the database are data, not authority.
* **Authorization path.** `notion.write` becomes a destination-scoped tool: `standing_authorizations.scope_ref` is
  required for it (a trigger refuses a tool-wide standing row) and `may_act` matches the destination the handler is
  writing to. The standing row is minted by the act of connecting, only when a person did it, by
  `app.record_destination_authority`.
* **Risk.** Destination substitution; a system adopt manufacturing authority. Proof: scope is the database id; the
  mint refuses a job that is not a person's own turn; an unscoped or wrong-scope write asks.

## Decision 4 - Slack token rotation

* **Before.** `office.slack_rotate` (every four hours, enabled in production) rotates the config token whenever
  fewer than 3600 s remain, with no question. `rotateAndPersist` already stores the current pair first and writes
  only the failure on failure.
* **Desired.** Every rotation needs Grant's explicit approval, never standing.
* **Authorization path.** Registry tool `slack.rotate`, level 3 (cannot be standing). The question is exact: its
  fingerprint contains the expiry of the pair being replaced, so an approval cannot be reused for the next rotation.
  The yes starts a child `office.slack_rotate` that checks the approval in the database before it spends the
  single-use refresh token. The question is raised earlier than the old one-hour margin so a person has time to
  answer; an unanswered question lets the pair expire, which is the policy's stated cost.
* **Risk.** Lock-out if never answered (the existing human-regenerate path and the failure announcement remain).

## Decision 5 - Learning

* **Before.** `remember()` (`src/agents/remember.ts`) stores a standing rule or a procedure from Grant's marked
  words immediately, with a say-back and no press (audit B9). `guidanceFor` already labels an admitted person's
  rule an order and every other lesson a belief. Authority-bearing tables (standing, tools, autonomy, automation,
  routing) are written only by gateway actions that carry a verified person (`by`), and no authorization function
  reads `lessons` or `skills`.
* **Desired.** Ordinary preferences learned automatically; anything that would become a durable rule that grants
  permission, automates, contacts people or causes external effects needs explicit confirmation; memory is not
  authority.
* **Boundary.** At the point a message would become a stored standing rule or procedure. Presentation preferences
  Grant states (length, format, links, due dates) are stored as today. A teaching that the office cannot positively
  recognise as presentation, any teaching about acting without asking, and every procedure are NOT stored; they are
  raised as a confirmation (a `suggestions` row whose press is `decide_suggestion`, the existing only-on-a-press
  path) and said back as "not yet a rule". Unknown is not benign (the 0304 asymmetry). The independent, structural
  guarantee is unchanged and now tested: authorization never reads learned text.

## Decision 6 - Cross-project retrieval

* **Before.** `retrieve()` (`src/knowledge/retrieval.ts`) is scoped to one project, with null meaning the Unnamed
  project (invariant 17). Nothing can read another project's documents on purpose.
* **Desired.** Project-first; the same user's other projects may be searched automatically when the task needs them;
  provenance says which project (or account-level) a source came from; never indiscriminate; cross-user always
  denied in future.
* **Change.** `retrieveAcrossOffice`: search the current project first; expand only when the question names another
  of the office's projects or the current project has nothing; expansion is per project, over an explicit list
  returned by one function (`app.sibling_projects`) so a future user boundary has exactly one place to live; every
  hit carries its project and a scope (`this_project`, `other_project`, `account`), and the prompt block names it.

## Decision 7 - Proactive autonomy

* **Before.** The matrix already says: reads proceed at every dial, internal writes proceed at `suggest` and above,
  outward writes ask at `suggest` and `act_with_review`, level 3 always asks, an outside audience always asks, and a
  duty is never "asking". The dial copy (0633) did not describe the three tiers.
* **Change.** None to the engine (no second dial). The tiers are pinned by a behavioural suite over real duty jobs,
  and the dial copy states them. New tools above are registered at the level that makes them follow the tiers.

## Verification plan

Isolated replica suites (new `policy-*.ts`), each with a sabotage that must turn it red; Vitest for the pure parts;
the complete canonical regression; adversarial review; deploy; a live policy section.

## Independent adversarial review (1 October 2026) and what was done about it

A fresh agent with no part in the build tried to break each boundary on replica copies. Eight defects were confirmed;
each is fixed and has a regression.

| # | Finding | Disposition |
|---|---|---|
| 1 | D5 was a denylist: "handle refunds yourselves", "keep my accountant informed", "when a client writes, tell Priya" were stored | Inverted: a teaching is stored on its own only when POSITIVELY recognised as presentation (a dimension or a plain presentation word) or as addressed to Grant; anything else is offered. Contact-a-named-person, outward acts and triggers (including "when a client writes", "at 9am") are named signals. 15 attack shapes pinned. |
| 2 | D5 false positives on his own presentation rules ("paste the image URLs into the reply") | Same rewrite; "reply"/"message"/"email" are no longer effects without a third party. 10 presentation shapes pinned as stored. |
| 3 | D2 at dial Act an unprompted sweep made the channel, and the body said "because you said yes" | `slack.channel` is level 3: asks at every dial setting, no standing yes can exist. The sentence now follows the real reason. |
| 4 | D2 a broad standing `slack.channel` could be granted | Level 3 refuses it structurally (trigger); tested tool-wide and per project. |
| 5 | D3 detaching a Notion database left its standing yes live | Trigger on `project_attachments` withdraws it on delete or disable, from any route; re-enabling does not bring it back. |
| 6 | D3 `office.notion_adopt` minted authority for a database it picked by title; the backfill minted for every home database | Adopt mints nothing; the backfill is removed. Pressing Connect on a database, as a person, is the yes. |
| 7 | Rollback notes claimed the code falls back | Corrected; each rollback states it is safe only with the matching worker rollback. `retrieveAcrossOffice` and the channel handler now degrade (own project / ask) when the schema is rolled back. |
| 8 | D6 one shared common word pulled another project's document | With nothing of its own and nobody named, a sibling is searched for a document holding every significant word. |

Plausible concerns also taken: the delete-question budget no longer strands an approval already given (the check runs,
only raising a new question stops); an unknown rotation expiry no longer yields one fingerprint for every future
rotation; the expiry write after a successful rotation is retried; `scripts/slack/rotate.ts` refuses without
`--approved-by-grant`; a project-creation reason lapses after three days. Left as bounded: harness jobs on a real
project can read that office's other real projects (same user; the single `app.sibling_projects` boundary is where a
future user filter goes), and the channel for `#the_team` is not a project channel.

Sabotage of the review fixes (each landed, each went red): `slack.channel` back to level 2 (3 checks red), the withdraw
trigger dropped (1 red), the authority lapse removed (1 red).
