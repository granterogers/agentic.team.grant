# The ownership graph at `41de1965`

> Research only. Counts were queried read-only from production on 1 October 2026. The per-table detail (all 129 tables,
> every field the brief asks for) is in `TABLE-REVIEW-399.md`; this document is the **shape** — which things own which —
> and the resource-by-resource inventory the brief lists.

## 1. The graph

```
auth.users (Supabase Auth; 2 rows today)
   │  unique(auth_user_id)                                   ← the ONLY binding; one account, one office
   ▼
offices ─────────────────────────────────────────────────────────────────────────────┐
   │ office_id (immutable on every carrier; composite FKs below)                      │
   │                                                                                  │
   ├── projects ──┬── project_aliases, project_attachments, project_briefs,           │
   │   (office_id)│   project_connector_choices, project_references, project_staff,   │
   │              │   project_switches, collections, contacts, decisions, artifacts,  │
   │              │   relations, preference_proposals, slack_channel_authority        │
   │              └── documents (office_id + (project_id,office_id) FK) ── document_collections
   │                                                                                  │
   ├── inbound_commands (office_id) ── inbound_commands_slack                         │
   │       │ origin_command_id                                                        │
   │       ▼                                                                          │
   ├── jobs (office_id on EVERY job; (project_id,office_id) (parent,office) (root,office) FKs)
   │       ├── job_steps, job_pauses, job_plans, job_branches, job_child_slots,       │
   │       │   job_impediments, job_traces, job_state_transitions, trigger_firings,   │
   │       │   routing_decisions, consultations, skill_uses, inference_usage, ...     │
   │       ├── outputs (office_id + (job_id,office_id))                               │
   │       ├── blockers (office_id + (job_id,office_id)) ── deliveries (office_id)    │
   │       └── undoable_actions (office_id + (job_id,office_id))                      │
   │                                                                                  │
   ├── tasks (office_id; (project_id,office_id) when set)   ── task_links, task_calendar_links
   ├── lessons, skills, preference_instructions, signals, suggestions, tool_requests, proposals
   ├── standing_authorizations, autonomy_settings, staff_tools, responsibilities,
   │   notification_preferences, notification_events, events, feedback, briefings
   ├── mail_messages, calendar_events                         ← one connected mailbox/calendar each
   ├── layout/preference: appearance_settings, workspace_layouts, dashboard_layouts,
   │   plane_layouts, project_seen, document_orders, contact_labels   (REPLACE the text `owner`)
   └── bindings (service-only): subject_identities, telegram_chats, slack_workspaces,
       slack_app_credentials, slack_channel_map, knowledge_connectors, mcp_clients,
       mcp_providers  (and, deferred to before a second real human: office_credentials, office_settings)

NOT owned by any office (system): staff (8 personas), staff_prompts, tool_permissions, autonomy_policy,
   providers, provider_models, provider_health, model_prices, job_kind_needs, output_shapes, connector_capabilities,
   google_services, asset_actions, self_improvement_kinds, icon_defaults, notebook_operation_cost,
   telegram_bots, ci_workflows, ci_runs, build_steps, tts_usage, system_config

HARNESS (declared test state, service-only): test_origins, test_destinations, operator_senders,
   known_escapes, legacy_trusted_commands, eval_*, breadth_dimensions
```

**Reading the graph.** There is one ownership chain — `auth user → office → everything` — and every edge below
`offices` is either a carried `office_id` guarded by a composite foreign key, or a plain foreign key to a carrier. No
table has two routes to two different offices, because the only way into any table is through a carrier whose
`office_id` is immutable.

## 2. Why jobs carry `office_id` instead of deriving from a project

The first design instinct — "a job belongs to its project, so ownership flows project → job" — is false in the data:

| | Rows |
|---|---:|
| jobs | 19,797 |
| jobs with **no** project | 9,620 |
| jobs with no project that are **not** harness | **7,243** |
| of those, `duty:*` | 7,166 |
| real (non-harness) jobs that do have a project | 1,309 |

Duties, office-level conversation and anything that has not been scoped to a project are the **majority** of real
work. A job's owner therefore cannot be a function of its project. It is a function of the **office that created it**
(a message from its channel identity, a duty from `responsibilities.office_id`, a child from its parent), and that is
what `jobs.office_id` records. When a project *is* present the composite FK forces it to be the same office.

## 3. The resource inventory the brief asks for

> Carriers: **44** after the reviews (the 6 tables with a NOT NULL single FK path derive instead; see REVIEWS.md S1).

Class legend: **ACCT** carries `office_id` · **PROJ** derives via `project_id` · **JOB** derives via `job_id` ·
**BIND** credential / channel binding (service-only) · **SYS** system · **TEST** harness · **LEDGER** append-only
evidence.

| Resource | Class | Owner and path | Notes |
|---|---|---|---|
| Auth identities | — | `auth.users`; bound by `offices.auth_user_id` | Supabase owns who proved an address; `offices` owns who the office works for |
| Projects | ACCT | `projects.office_id` | slug and notebook uniqueness become per office |
| Project settings | PROJ | `project_briefs`, `project_connector_choices`, `project_staff`, `project_references`, `project_attachments` | all FK to `projects` |
| Conversations | ACCT (derived) | not a table: `inbound_commands.office_id` + `(origin_channel, chat, subject)` | `conversation_before` gains `office_id` |
| Messages | ACCT | `inbound_commands` (in), `outputs` + `deliveries` (out) | |
| Jobs / root / child | ACCT | `jobs.office_id`; `root_job_id`, `parent_job_id` composite FKs | |
| Questions | ACCT | `blockers.office_id`; `(job_id, office_id)` | the thing a person presses |
| Deliveries | ACCT | `deliveries.office_id`; `(blocker_id, office_id)` | 632 of 4,028 have no job: see MIGRATION-PLAN |
| Approvals | ACCT | an approval *is* a `blockers` row; plan in `job_plans` | |
| Refusals | ACCT | `standing_authorizations` (+ revoked), `autonomy_settings`; `blockers` state | a durable No is an office's |
| Tasks / subtasks / categories | ACCT | `tasks.office_id`; subtasks and categories are columns/`parent` on `tasks` (no separate tables exist) | 10 of 18 personal tasks have no project |
| Calendars / events | ACCT | `calendar_events.office_id` (the connected calendar) | |
| Documents / files / attachments | ACCT | `documents.office_id`; `project_attachments` via project; bytes in storage under `<office_id>/` | 0 documents lack a project |
| Sources | PROJ | `project_attachments`, `knowledge_connectors` (BIND), `documents.connector` | |
| Retrieval indexes | ACCT | `documents.search` is a generated tsvector column on `documents` | **no vector columns exist** |
| Embeddings | — | **none exist** | any future index must carry `office_id` in the same query |
| Contacts | PROJ | `contacts.project_id` | 0 rows today; `contact_labels` replace text `owner` |
| Activity | ACCT | `events.office_id` | 7,901 of 9,962 have no project |
| Preferences | ACCT | `preference_instructions`, `notification_preferences`, `appearance_settings`, `office_settings` (new) | |
| Learned context | ACCT | `lessons`, `skills`, `decisions` (via project) | enters every prompt |
| Rules | ACCT | `lessons` with an explicit standing marker | learning ≠ authority |
| Autonomy settings | ACCT | `autonomy_settings.office_id` | matrix `autonomy_policy` stays SYS |
| Standing authorizations | ACCT | `standing_authorizations.office_id` | null project = office-global |
| Integrations / provider credentials | BIND | `office_credentials` (new) + the existing ref-based tables | §12 of ARCHITECTURE |
| Slack mappings | BIND/ACCT | `slack_workspaces`, `slack_app_credentials`, `slack_channel_map`, `subject_identities` | |
| Telegram mappings | BIND | `telegram_chats`, `subject_identities`; `telegram_bots` is SYS | |
| Voice sessions (note) | — | stateless transcription; identity at the turn | |
| Realtime voice sessions | — | no table: the office comes from the JWT on every turn; the session id is a grouping key `(office, session)` | |
| NotebookLM | BIND/PROJ | `notebook_*` probes/budgets by office; `artifacts` by project | |
| Drive | BIND/PROJ | `project_attachments` + `drive_watch` | |
| Scheduled work | ACCT / SYS | `responsibilities.office_id` → created jobs; system duties → the `system` office | 17 duties, all with no project; ~6 are system |
| System duties | SYS | `office.backup`, `office.prune_*`, `office.capacity_report`, `office.slack_rotate`, recovery | owned by the `system` office; read no office table |
| Caches | — | gateway `seen` and voice `seenSessions` (token-keyed, 60 s); mail/calendar/sync tables are *stores*, owned | none keyed by project name |
| Claire / specialist state | ACCT | no state on `staff`; state is `lessons`, `skills`, `project_staff`, `staff_tools`, `routing_decisions` (job) | |
| Audit / provenance | LEDGER | `events`, `job_state_transitions`, `job_impediments`, `routing_decisions`, `undoable_actions` | append-only; carried or derived |

## 4. The 43 → 46 tables of issue #399

#399 recorded 43 tables with row security off when 0642 ran; the live catalogue shows **46** today. Whichever way the
three extra arose (tables created after, or not counted), **all 46 are closed to a public key now**
(`check:anon-exposure` green on `41de1965`). Their disposition is in `TABLE-REVIEW-399.md`; in brief:

| Target | Tables | |
|---|---:|---|
| **Office-scoped** (RLS on + office policy) | 15 | `appearance_settings`, `browser_actions`, `collections`, `contacts`, `decisions`, `document_collections`, `document_orders`, `event_triggers`, `lessons`, `plane_layouts`, `project_seen`, `relations`, `signals`, `standing_authorizations`, `suggestions` |
| **Service-only** (RLS on, no policy) | 31 | credentials, catalogues, harness registries, job internals, `office_members` |

The five tables that matter most for user data — `jobs`, `projects`, `documents`, `outputs`, `inbound_commands` — are
**not in the 46**. They already have RLS on and a policy of `true`. #399's real finding is that the policies that
exist are vacuous, and what replaces them is `office_id`, not another `ENABLE ROW LEVEL SECURITY`.

## 5. Backfill characterisation (what the Grant migration is allowed to assume)

Read-only, 1 October. These are the numbers `MIGRATION-PLAN.md` is built against.

**Real (non-fixture, non-synthetic) jobs by requester, 8,556 total.** Grant-attributed: `duty:*` 7,166, `hq:` 767
(the office's own), `grant:` 69, `teamhq:grant` 118, `telegram:grant` 155, `voice:grant` 125, `slack:grant` 27.
**Not Grant-attributed and not duty/hq: 28** — `slack:U0ECHOVERIFY` 10, `connector:register` 11, `mcp:probe-w` 4,
`telegram:4242` 2, `upload:newsroom-second-…` 1. Those are harness residue the existing flags missed (the same shape
as `telegram:4242` in CLAUDE.md's gate-3 entry). A rule that stamps every historical job as Grant's would put 28 test
jobs in his office; the plan routes them to a quarantine **test** office instead, and aborts if any row is neither
provably Grant's nor provably harness.

**Pre-0619 provenance.** 16,466 jobs have `origin_kind` null (written before 0619). For those the owner is decided from
`requested_by`, `is_fixture`, `project_id` and the root's inbound command — never from `origin_kind`.

**Channel identity.** `subject_identities` has four rows: Slack→grant, Telegram→grant, voice→grant, and Slack→`verify-echo`
(a harness). `telegram_chats`: 204 rows — 8 private (all `subject = grant`) and **196 groups with `subject` null**, of
which 16 are deliverable. A null-subject group can match *any* requester in `telegram_chat_for` today. `slack_workspaces`:
**55 rows marked installed against 1 `slack_app_credentials` row** — only the workspace matching that row is a real
installation; the rest are harness rows and must not be bound to Grant.

**Ledgers with no job.** `deliveries` 632 / 4,028 have no `job_id`; `events` 1,307 / 9,962 have no `related_job_id`
and 7,901 have no project; `blockers` 462 / 993 have no job (but every blocker has a job or a project — none has
neither). Their owner is derived from the blocker, the correlation or the destination, with the same
provable-or-quarantine rule.

**Text owners.** `appearance_settings`, `workspace_layouts` and `project_seen` hold the single value `grant`. The 17
`responsibilities` all have `project_id` null; **about six are system duties** (trace/shot pruning, nightly backup, capacity
report, Slack rotation, credential chores) that belong to the `system` office and the rest are Grant's — classified by
job kind in the migration, not assumed. The sole `standing_authorizations` row (project null) is Grant's one office-global
grant.

**Harness on real projects.** 59 fixture-flagged projects carry non-fixture jobs (the #45 convention: a suite testing a
fixture filter uses a real subject). These cannot be moved to a test office without breaking the composite FK, so they
**stay in Grant's office with their existing flags**; the new containment applies to the *new* test offices.

**Auth.** `auth.users` has 2 rows (Grant; the `verify-operator` test principal); `office_members` has 2 rows mapping
them. No row anywhere identifies a third human.

## 6. What this graph rules out

- A table with two routes to two offices — **except the polymorphic edges** (`relations`, and the job references in
  `branch_groups`/`consultations`), which have no foreign key on their ids; they are office-checked in the function on
  write and read (Review A, F8). Everywhere else every route ends at a carrier and carriers are immutable.
- A job without an office. `office_id` is `NOT NULL` on every job. System work (backup, trace pruning, Slack rotation,
  recovery) belongs to the single **`system` office**, which no session resolves to and which no `p_office` function
  can read.
- An office-global row that is deployment-global by accident (`project_id is null`). Every null-project row is
  `office_id`-keyed, and the two indexes that used to be global gain the column.
- A second copy of the classification flag. Test containment is `offices.kind`, joined; it is not copied onto jobs
  (0303/0304).
