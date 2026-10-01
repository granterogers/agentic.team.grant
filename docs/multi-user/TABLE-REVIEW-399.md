# Table-by-table review of the 129 `public` tables (issue #399)

> Generated from the live catalogue on 1 October 2026 (read-only) and the classification in this file. Counts are exact `count(*)`.
> Baseline `41de1965`, migrations through 0646. Nothing here has been applied.

## How to read it

- **Class.** ACCOUNT = carries `office_id` itself; PROJECT / JOB = ownership derives through `project_id` / `job_id` and gets no new column; INTEGRATION = a credential or channel binding (service-only); SYSTEM = product state owned by no human; HARNESS = declared test state; LEDGER = append-only evidence that derives its owner.
- **Target RLS.** `SC` = RLS on, one policy for the server role `ai_team_app`: `office_id = app.current_office()` (or the derived equivalent); **no policy and no grant for `anon` or `authenticated` — ever.** `SO` = RLS on, **no policy for any non-bypass role** (service-only).
- **SELECT | INSERT | UPDATE | DELETE** for an `SC` table: *own office* means the row's office equals the caller's; *checked* means `with check` plus the composite foreign key; *office immutable* means a trigger refuses any change to `office_id`. `SO` tables have no rule for a user because no user path reaches them: a user reads them only through a projection that filters by office.
- **Service access.** The worker and gateway connect as `postgres` / `service_role`, which bypass RLS. RLS is therefore a backstop for them, not their boundary. Their boundary is the composite foreign key, the immutable `office_id`, and the required `p_office` argument (ARCHITECTURE section 7).
- **Harness.** Test traffic keeps its existing flags (`is_fixture`, `synthetic`, `harness_job`); new test offices are `offices.kind <> person`. Harness registries are `SO`.

**Totals.** 129 tables: ACCOUNT 40, SYSTEM 23, PROJECT 22, INTEGRATION 17, JOB 15, HARNESS 9, LEDGER 3. 50 carry `office_id`; the other 79 derive it. Target: 56 office-scoped, 73 service-only. **All 46 tables with RLS off today get RLS on; none is made reachable by a public key.**

## The answer to #399 in one paragraph

Enabling RLS on the 46 tables is necessary and not sufficient, and a user-scoped policy for `authenticated` on any of them would be a mistake: the browser never speaks to PostgREST, no public function is executable by `anon` or `authenticated` (0 of 280), and 0642 plus `check:anon-exposure` hold that line. So the decision is per table. 31 of the 46 are service-only and become RLS-on with no policy (a no-op for access, a tripwire for a future grant). 15 of the 46 hold a person's private state, so they carry or derive an office and get the office policy. The tables that matter most are not among the 46: `jobs`, `projects`, `documents`, `outputs` and `inbound_commands` already have RLS on and a policy of `true`. That policy is the real gap, and it is closed by `office_id`, not by turning RLS on.

## The 129 tables

| Table | Rows | Purpose | Class | Carries office_id | Target RLS | Ownership path | RLS now | Public-role grants now | SELECT / INSERT / UPDATE / DELETE | Write mode | Risk | Migration note |
|---|---:|---|---|:-:|:-:|---|---|:-:|---|---|:-:|---|
| `appearance_settings` | 1 | How the studio looks, per person (#124, ADR-0021). One jsonb rather than a column each: th | ACCOUNT | Y | SC | office_id (replaces text owner) | OFF | none | own office / own office (checked) / own office, office immutable / own office | mutable | L | text owner defaults to grant; PK (owner) becomes (office_id) |
| `artifacts` | 12 | What NotebookLM produced for a project, and the link to open it. Grant: "see if you can pu | PROJECT | N | SC | project_id -> projects.office_id | ON/1 | yes | via parent chain / via parent chain (checked) / via parent chain, office immutable / via parent chain | mutable | M |  |
| `asset_actions` | 6 | #27. The named things an agent can be asked to do to an asset — Review, Summarise, Researc | SYSTEM | N | SO | none (product catalogue) | ON/0 | yes | none / none / none / none | operator | L | RLS on, zero policies today |
| `autonomy_policy` | 16 | What the office may do at each autonomy level, per action class (#15). The action class is | SYSTEM | N | SO | none (matrix with level-3 floor CHECK) | OFF | none | none / none / none / none | operator | M | per-office override DEFERRED; floor must stay global |
| `autonomy_settings` | 1 | Append-only. The current level is the latest row for a scope; the history is what makes "w | ACCOUNT | Y | SC | office_id; project_id nullable = office-global | ON/1 | yes | own office / own office (checked) / never / never | append-only | H | null project must mean office-global, never deployment-global |
| `blockers` | 993 | §12 "Needs Me". Every field the spec names is a column, and the ones that are not genuinel | ACCOUNT | Y | SC | office_id; composite FK (job_id,office_id) and (project_id,office_id) | ON/3 | yes | own office / own office (checked) / state column only / never | insert + state transition | H | the thing a user PRESSES by id; answer path must check office |
| `branch_groups` | 128 | One question split into concurrent specialist branches (#262). A branch is an ordinary job | JOB | N | SO | synthesis_job_id -> jobs.office_id | OFF | none | none / none / none / none | insert + state | L |  |
| `breadth_dimensions` | 37 | The coverage dimensions of #235. Grant may add rows; nothing in code enumerates them. | HARNESS | N | SO | none | OFF | none | none / none / none / none | operator | L | coverage vocabulary |
| `briefings` | 21 | §12 morning/evening briefings. `(kind, scope_ref, for_date)` is unique so a duty re-attemp | ACCOUNT | Y | SC | office_id (no project) | ON/3 | yes | own office / own office (checked) / own office, office immutable / own office | mutable (per day) | M | unique (kind,scope_ref,for_date) must gain office_id |
| `browser_actions` | 10 | Append-only. Every page the office opened, what it did there, how long it took and what it | PROJECT | N | SC | project_id; job_id -> office | OFF | none | via parent chain / via parent chain (checked) / never / never | append-only | M | page content may be private |
| `browser_sessions` | 0 | A session that stays valid, not a browser that stays open. The cookie jar lives in the Vau | INTEGRATION | N | SO | project_id -> office; credential_ref -> vault | OFF | none | none / none / none / none | mutable | H | holds a vault ref to a cookie jar; service-only |
| `build_steps` | 145 | What the build session is doing, as it does it, so Grant can open the page and see rather  | SYSTEM | N | SO | none (build-session log) | OFF | none | none / none / none / none | append | L | describes the developer session, not an office |
| `calendar_events` | 17 | Grant's own calendar, cached so the team can answer questions about it in the two seconds  | ACCOUNT | Y | SC | office_id (replaces the single connected calendar) | ON/1 | yes | own office / own office (checked) / own office, office immutable / own office | sync-replaced | H | pk (calendar_id,event_id) must gain office_id |
| `ci_runs` | 27 | Every dispatch, what it reserved, and what it actually cost. The reservation is what makes | SYSTEM | N | SO | job_id attribution only | OFF | none | none / none / none / none | append | L | CI minutes are one deployment cost ceiling |
| `ci_workflows` | 2 | Which workflows the office may run on demand, and what each is expected to cost. A workflo | SYSTEM | N | SO | none | OFF | none | none / none / none / none | operator | L |  |
| `collections` | 1 |  | PROJECT | N | SC | project_id | OFF | none | via parent chain / via parent chain (checked) / via parent chain, office immutable / via parent chain | mutable | L |  |
| `connection_health` | 17 | What each connected service was doing when the prober last looked. Written by `npm run inv | ACCOUNT | Y | SC | office_id (replaces text owner) | ON/1 | yes | own office / own office (checked) / own office, office immutable / own office | upsert | M | one row per service per office; system providers stay in provider_health |
| `connector_capabilities` | 28 | #51. One row per thing a connector can be asked for. `reach` says whether the office can g | SYSTEM | N | SO | none (catalogue) | ON/0 | yes | none / none / none / none | operator | L |  |
| `consultations` | 2,801 | §9 consultation economics. `changed_outcome` is the field that earns the table: without it | JOB | N | SO | job_id | ON/3 | yes | none / none / none / none | append | L | read through outputs/projections |
| `contact_label_links` | 0 |  | PROJECT | N | SC | contact_id -> contacts.project_id | ON/0 | yes | via parent chain / via parent chain (checked) / via parent chain, office immutable / via parent chain | mutable | L | 0 rows |
| `contact_labels` | 5 |  | ACCOUNT | Y | SC | office_id (replaces text owner) | ON/0 | yes | own office / own office (checked) / own office, office immutable / own office | mutable | L |  |
| `contacts` | 0 | People, companies, collaborators and suppliers attached to a dashboard project (#24, canon | PROJECT | N | SC | project_id | OFF | none | via parent chain / via parent chain (checked) / via parent chain, office immutable / via parent chain | mutable | M | 0 rows; PII; #172 strong tier |
| `dashboard_layouts` | 2 |  | ACCOUNT | Y | SC | office_id (replaces text owner); project_id optional | ON/0 | yes | own office / own office (checked) / own office, office immutable / own office | mutable | L |  |
| `decisions` | 324 | What the office CONCLUDED, and what that ruled out (#129). Distinct from documents (materi | PROJECT | N | SC | project_id; from_job | OFF | none | via parent chain / via parent chain (checked) / never / never | append-only | M |  |
| `deliveries` | 4,027 | One row per outbound message on any channel, claimed before the send and completed after i | ACCOUNT | Y | SC | office_id; composite FK (job_id,office_id) | ON/1 | yes | own office / own office (checked) / state column only / never | insert + state | H | dedupe_key unique is global: becomes (office_id,dedupe_key) |
| `document_collections` | 0 |  | PROJECT | N | SC | collection_id -> project | OFF | none | via parent chain / via parent chain (checked) / via parent chain, office immutable / via parent chain | mutable | L |  |
| `document_orders` | 0 | The order one person put one project's documents in. A list of ids: anything absent is new | ACCOUNT | Y | SC | office_id (replaces text owner); project_id | OFF | none | own office / own office (checked) / own office, office immutable / own office | mutable | L |  |
| `documents` | 118 | Every document the system holds, whatever fed it in (ADR-0013). Postgres is the store; a c | ACCOUNT | Y | SC | office_id; composite FK (project_id,office_id) | ON/3 | yes | own office / own office (checked) / own office, office immutable / own office | mutable (state machine) | H | retrieval-critical: carries office_id so search cannot cross; 4 global unique indexes must be re-scoped |
| `drive_watch` | 1 | Where each attached Drive folder's change feed has got to. Separate from project_attachmen | INTEGRATION | N | SO | attachment_id -> project -> office | OFF | none | none / none / none / none | mutable | M |  |
| `duty_said` | 5 | The last thing each scheduled duty actually said, so it can say it again when it CHANGES r | ACCOUNT | Y | SO | office_id (project nullable) | OFF | none | none / none / none / none | mutable | L | per-duty memory for say_once; must not dedupe across offices |
| `eval_cases` | 20 |  | HARNESS | N | SO | none | ON/0 | yes | none / none / none / none | operator | L | RLS on, zero policies |
| `eval_runs` | 15 |  | HARNESS | N | SO | none | ON/0 | yes | none / none / none / none | append | L |  |
| `eval_scores` | 171 |  | HARNESS | N | SO | none | ON/0 | yes | none / none / none / none | append | L |  |
| `event_triggers` | 0 | WHEN x happens FROM s IF c THEN make job j FOR project p, subject to dedupe, debounce, coo | ACCOUNT | Y | SC | office_id; project nullable | OFF | none | own office / own office (checked) / own office, office immutable / own office | mutable | M | 0 rows |
| `events` | 9,958 | Append-only event ledger (§6). Never updated, never deleted — enforced by REVOKE, a row tr | ACCOUNT | Y | SC | office_id; project nullable | ON/2 | yes | own office / own office (checked) / never / never | append-only | M | feeds Recent activity; a reader without an office filter is the leak |
| `failure_signatures` | 0 | #132. A repeated failure is one row with a count rather than eleven rows. There is deliber | JOB | N | SO | last_job_id -> job | ON/1 | yes | none / none / none / none | upsert | M | 0 rows; repeated-failure reader must filter by office |
| `feedback` | 7 | What Grant thought of something. `origin_channel` matters: a reaction is a weak signal and | ACCOUNT | Y | SC | office_id | ON/2 | yes | own office / own office (checked) / never / never | append | L | 7 rows; no reader (check:consumed baseline) |
| `google_services` | 4 | One row per Google service that can be connected with a single button. Scopes live here ra | SYSTEM | N | SO | none (catalogue of connectable services) | ON/1 | yes | none / none / none / none | operator | L |  |
| `icon_defaults` | 61 | Name term to icon key, for choosing a new project a mark that fits. Grant edits this. #221 | SYSTEM | N | SO | none | OFF | none | none / none / none / none | operator | L | product default; per-office edit DEFERRED |
| `inbound_commands` | 2,771 | The canonical command envelope as received (§5). Has no column a channel adapter could use | ACCOUNT | Y | SC | office_id stamped by the adapter-resolved identity | ON/3 | yes | own office / own office (checked) / state column only / never | insert (synthetic frozen) | H | dedupe_key unique is global: becomes (office_id,dedupe_key) |
| `inbound_commands_slack` | 142 | What only Slack means, kept out of the channel-agnostic envelope. resolved_project_id is s | LEDGER | N | SO | command_id -> inbound_commands | ON/2 | yes | none / none / none / none | insert | L |  |
| `inference_usage` | 15,245 | Local accounting for every inference attempt (§11). Failures are rows too: a 429 is usage  | JOB | N | SO | job_id | ON/2 | yes | none / none / none / none | append | L | system-wide spend; per-office metering via job join |
| `job_branches` | 185 | A specialist branch of a fan-out (#262). `required` false by default: the answer should no | JOB | N | SO | job_id | OFF | none | none / none / none / none | insert + state | L |  |
| `job_child_slots` | 392 |  | JOB | N | SO | job_id | ON/0 | none | none / none / none / none | insert | L | RLS on, zero policies |
| `job_impediments` | 1,978 | What a job could not do, typed so it can be counted. jobs.state_reason is prose and jobs.w | JOB | N | SO | job_id; project_id | OFF | none | none / none / none / none | append-only | M | is_fixture frozen copy (0303/0304) |
| `job_kind_needs` | 8 | Job kinds that cannot run on every runtime. A kind absent from this table runs anywhere, w | SYSTEM | N | SO | none | ON/1 | yes | none / none / none / none | operator | L |  |
| `job_pauses` | 320 | Why a job stopped part way and what would let it continue (#263). One open row per paused  | JOB | N | SO | job_id | OFF | none | none / none / none / none | insert + resolve | M |  |
| `job_plans` | 451 | #131. What a job would change outside the office, recorded before it acts, so an approval  | JOB | N | SO | job_id | ON/1 | yes | none / none / none / none | insert | M | shown on approval cards through a projection |
| `job_state_transitions` | 128,783 | Every state change, appended. Separate from `events`: this is how a job moved, not what th | LEDGER | N | SO | job_id | ON/2 | yes | none / none / none / none | append-only | L | 128,783 rows; no user path reads it directly |
| `job_steps` | 4,182 | What a job has already done, so a resume continues rather than repeats (#263). Two writes  | JOB | N | SO | job_id | OFF | none | none / none / none / none | append | L |  |
| `job_traces` | 33,293 |  | JOB | N | SO | job_id | ON/0 | yes | none / none / none / none | append | L | RLS on, zero policies; 33,293 rows |
| `jobs` | 19,797 | Durable job state. Every transition is a committed write, so recovery is "read state, cont | ACCOUNT | Y | SC | office_id on EVERY job; composite FKs to parent, root, project | ON/3 | yes | own office / own office (checked) / own office, office immutable / own office | state machine | H | 7,243 real jobs have no project, so the project alone cannot be the owner |
| `knowledge_connectors` | 7 | Where a document came from, and whether that route is currently open (§17). ADR-0013: the  | INTEGRATION | Y | SC | office_id | ON/2 | yes | own office / own office (checked) / own office, office immutable / own office | mutable | M | where documents come from; per-office route state |
| `known_escapes` | 38 | Harness deliveries that reached a real destination, investigated and kept as evidence. Ack | HARNESS | N | SO | delivery_id | OFF | none | none / none / none / none | evidence, never deleted | L | acknowledged evidence; must not be deleted |
| `legacy_trusted_commands` | 35 | Turns written by a retired version of a production adapter (#379), frozen when 0603 ran. a | HARNESS | N | SO | command_id | OFF | none | none / none / none / none | frozen | L | frozen at 0603 |
| `lessons` | 658 | Operating knowledge the office keeps about itself, scoped and append-only. Advisory text o | ACCOUNT | Y | SC | office_id; project nullable | OFF | none | own office / own office (checked) / never / never | append-only | H | enters every prompt of the office: scope the lookup, not just the table |
| `mail_messages` | 310 | Recent mail, cached so the team can answer questions about it quickly and can go on answer | ACCOUNT | Y | SC | office_id (cache of the connected mailbox) | ON/1 | yes | own office / own office (checked) / own office, office immutable / own office | sync-replaced | H | pk message_id must gain office_id |
| `mcp_auth_codes` | 0 | One-time authorization codes, by hash. Single-use is enforced by the redemption UPDATE rat | INTEGRATION | Y | SO | office_id fixed at consent time | OFF | none | none / none / none / none | single-use | H | hashed codes |
| `mcp_calls` | 0 | §11: every inference attempt is measured. A general-purpose model reading this corpus thro | JOB | N | SO | client_id -> mcp_clients.office_id | ON/1 | yes | none / none / none / none | append | L |  |
| `mcp_clients` | 22 | One row per MCP client (ADR-0014). Separate tokens because withdrawing ChatGPT must not lo | INTEGRATION | Y | SO | office_id | ON/1 | yes | none / none / none / none | mutable | H | one token = one office; token_sha256 only |
| `mcp_discovered_tools` | 0 | What a provider says it can do (#265). NOTHING here is reachable by any agent: discovery i | INTEGRATION | N | SO | provider_id -> mcp_providers.office_id | OFF | none | none / none / none / none | mutable | M |  |
| `mcp_oauth_clients` | 20 | Clients that registered themselves under RFC 7591. Public clients using PKCE - there is no | INTEGRATION | N | SO | none until consent binds a code to an office | OFF | none | none / none / none / none | dynamic registration | M | RFC 7591 registration is unauthenticated by design; binds at the code |
| `mcp_providers` | 0 | An outside MCP endpoint the office may ASK what it offers (#265). The office is also an MC | INTEGRATION | Y | SO | office_id; credential_ref -> vault | OFF | none | none / none / none / none | mutable | H | 0 rows today |
| `model_prices` | 6 | Published prices per million tokens, used ONLY to produce the modelled cost column. Never  | SYSTEM | N | SO | none | ON/1 | yes | none / none / none / none | operator | L |  |
| `notebook_budgets` | 879 | §11: derive budgets from the DETECTED tier, never hard-code quota. probe_id is NOT NULL be | INTEGRATION | N | SO | probe_id -> notebook_capability_probes.office_id | ON/2 | yes | none / none / none / none | append | L |  |
| `notebook_capability_probes` | 22 |  | INTEGRATION | Y | SO | office_id (tier of THAT Google account) | ON/2 | yes | none / none / none / none | append | M |  |
| `notebook_chat_usage` | 0 | That a chat happened and how big it was - never the question or the answer. §6 forbids sto | PROJECT | N | SO | project_id | ON/2 | yes | none / none / none / none | append | L |  |
| `notebook_exclusions` | 0 | Notebooks that must not become projects. Without it, "ignore that one" has nowhere to live | INTEGRATION | Y | SC | office_id | ON/3 | yes | own office / own office (checked) / own office, office immutable / own office | mutable | L | 0 rows |
| `notebook_operation_cost` | 13 | Estimated compute cost per operation, in units of our own invention. Google publishes no f | SYSTEM | N | SO | none (our own estimate table) | OFF | none | none / none / none / none | operator | L |  |
| `notebook_refusals` | 0 | Google saying no, and what we had spent when it did. This is the only real measurement of  | INTEGRATION | N | SO | none today; office_id when per-account tier is real | OFF | none | none / none / none / none | append | L | 0 rows |
| `notebook_spend` | 8 | Every notebook operation we performed and what we estimate it cost. Our own ledger, never  | PROJECT | N | SO | project_id; job_id | OFF | none | none / none / none / none | append | L |  |
| `notebook_sync_queue` | 36 |  | PROJECT | N | SO | project_id; job_id | ON/3 | yes | none / none / none / none | queue | M |  |
| `notification_events` | 2,308 | One row per notification, with what happened to it. `delivered` with a null resolved_at -  | ACCOUNT | Y | SC | office_id (project nullable) | ON/3 | yes | own office / own office (checked) / state column only / never | insert + resolve | M |  |
| `notification_preferences` | 3 |  | ACCOUNT | Y | SC | office_id (project nullable) | ON/3 | yes | own office / own office (checked) / own office, office immutable / own office | mutable | L |  |
| `office_members` | 2 | The people whose authenticated session the office will answer. Not a copy of auth.users: t | INTEGRATION | N | SO | email -> owner_key text | OFF | none | none / none / none / none | mutable | H | RETIRED by offices; email-keyed, mutable identity |
| `operator_senders` | 5 | The dedupe-key namespaces (the part before the first colon) of senders that legitimately d | HARNESS | N | SO | none | OFF | none | none / none / none / none | operator | M | dedupe-key namespaces of legitimate senders |
| `output_shapes` | 7 | #130. What an output of a given shape must carry. Rows rather than TypeScript types, becau | SYSTEM | N | SO | none | ON/1 | yes | none / none / none / none | operator | L |  |
| `outputs` | 13,957 | §10. The metadata block is NOT NULL because an output that cannot say how confident it is, | ACCOUNT | Y | SC | office_id; composite FK (job_id,office_id) | ON/3 | yes | own office / own office (checked) / state column only / never | insert (immutable) | H | answers enter later prompts via conversation_before: retrieval-critical |
| `plane_layouts` | 1 | Where Grant dragged each card on a project's map, and how far he zoomed (#25, 0380). Keyed | ACCOUNT | Y | SC | office_id (replaces text owner); project_id | OFF | none | own office / own office (checked) / own office, office immutable / own office | mutable | L |  |
| `preference_instructions` | 24 | What Grant said, and what it was taken to mean. Kept so that "why was I not told about thi | ACCOUNT | Y | SC | office_id; command_id | ON/2 | yes | own office / own office (checked) / never / never | append | M | what he said and what it was taken to mean |
| `preference_proposals` | 0 | Inert. A proposal changes nothing; accepting one writes a preference_instructions row, and | PROJECT | N | SC | project_id; instruction | ON/2 | yes | via parent chain / via parent chain (checked) / via parent chain, office immutable / via parent chain | mutable | L | 0 rows |
| `project_aliases` | 2,497 | Every way Grant refers to a project. Many aliases, one project — enforced globally, becaus | PROJECT | N | SC | project_id | ON/1 | yes | via parent chain / via parent chain (checked) / via parent chain, office immutable / via parent chain | mutable | H | uniqueness of a phrase is GLOBAL today: must become per office |
| `project_attachments` | 670 | Where a project's work really lives (ADR-0014). A project is an attachment point, not a co | PROJECT | N | SC | project_id | ON/1 | yes | via parent chain / via parent chain (checked) / via parent chain, office immutable / via parent chain | mutable | M | external_ref uniqueness must not span offices |
| `project_briefs` | 1 | Briefs are append-only history, not a current-value column on projects: "what did we think | PROJECT | N | SC | project_id | ON/2 | yes | via parent chain / via parent chain (checked) / never / never | append-only | M |  |
| `project_connector_choices` | 115 | What Grant has decided about a connector a project does not have: `declined` (leave it alo | PROJECT | N | SC | project_id | ON/1 | yes | via parent chain / via parent chain (checked) / via parent chain, office immutable / via parent chain | mutable | L |  |
| `project_references` | 1 | #35. Something a dashboard project POINTS AT that we cannot log into — a website, an API,  | PROJECT | N | SC | project_id | ON/0 | yes | via parent chain / via parent chain (checked) / via parent chain, office immutable / via parent chain | mutable | L | RLS on, zero policies |
| `project_seen` | 3 | When Grant last opened each dashboard project, per person (#122, 0381). In the office rath | ACCOUNT | Y | SC | office_id (replaces text owner); project_id | OFF | none | own office / own office (checked) / own office, office immutable / own office | mutable | L |  |
| `project_staff` | 1 | #36. A DECISION about one staff member on one project — off it, back on it, or given a loc | PROJECT | N | SC | project_id | ON/0 | yes | via parent chain / via parent chain (checked) / via parent chain, office immutable / via parent chain | mutable | L | RLS on, zero policies |
| `project_switches` | 278 | Append-only log of project context changes. The current context is the latest row; the his | PROJECT | N | SC | project_id (scope key must include office) | ON/2 | yes | via parent chain / via parent chain (checked) / never / never | append-only | M | current_project(scope,chat) must take the office |
| `projects` | 1,794 | Authoritative project registry. Postgres owns this, never Notebook (§7) — a Notebook outag | ACCOUNT | Y | SC | office_id | ON/3 | yes | own office / own office (checked) / own office, office immutable / own office | mutable | H | slug unique globally; notebook_ref unique globally |
| `proposals` | 23 | #49. An agent's standing request for something it needs to do its job. A ROW and not a mes | ACCOUNT | Y | SC | office_id | ON/0 | yes | own office / own office (checked) / own office, office immutable / own office | mutable | M | RLS on, zero policies; Governance "what it wants" |
| `provider_health` | 1 | Circuit-breaker state per provider (§6). In the database so a restart does not forget an o | SYSTEM | N | SO | none (LLM circuit breaker) | ON/1 | yes | none / none / none / none | upsert | L | one model provider for the deployment |
| `provider_models` | 25 | The measured model allow-list (ADR-0009). `usable` requires a recorded successful probe —  | SYSTEM | N | SO | none | ON/1 | yes | none / none / none / none | operator | L |  |
| `providers` | 3 | Provider registry (§8). api_status distinguishes documented public APIs from undocumented  | SYSTEM | N | SO | secret_ref (system key) | ON/1 | yes | none / none / none / none | operator | M | LLM provider key stays a system secret |
| `relations` | 1 |  | PROJECT | N | SC | project_id | OFF | none | via parent chain / via parent chain (checked) / via parent chain, office immutable / via parent chain | mutable | L | derived edges are views; stored edges only |
| `responsibilities` | 17 | §17 recurring duties. Owned by a staff role rather than free-floating, so "who is responsi | ACCOUNT | Y | SC | office_id; project nullable | ON/2 | yes | own office / own office (checked) / own office, office immutable / own office | mutable | H | slug unique globally; provisioning seeds a set per office |
| `routing_decisions` | 4,813 | One row per routing decision (§9). The duplicate search is NOT NULL and non-empty by const | JOB | N | SO | linked job | ON/2 | yes | none / none / none / none | insert | L |  |
| `self_improvement_kinds` | 4 | Job kinds that count against the self-improvement token budget (#53). Governed at dequeue, | SYSTEM | N | SO | none | ON/1 | yes | none / none / none / none | operator | L |  |
| `signals` | 363 | What the office NOTICED: something that happened, normalised and deduplicated (#264). Deli | ACCOUNT | Y | SC | office_id; project nullable | OFF | none | own office / own office (checked) / never / never | append | M |  |
| `skill_tools` | 94 | The tools a skill says its steps need. A STATEMENT OF INTENT, never a grant: app.staff_may | SYSTEM | N | SO | skill_id -> skills.office_id | ON/1 | yes | none / none / none / none | mutable | L | statement of intent, never a grant |
| `skill_uses` | 3,994 | Which jobs were shown which skill, so a skill can be judged by outcomes rather than by how | JOB | N | SO | job_id | ON/1 | yes | none / none / none / none | append | L |  |
| `skills` | 188 | Named, reusable procedures the office can author for itself (#50). A skill may name a tool | ACCOUNT | Y | SC | office_id; project nullable | ON/1 | yes | own office / own office (checked) / never / never | append-only | H | procedures he taught; reach prompts |
| `slack_app_credentials` | 1 | One row per Slack app (§15). Holds secret REFERENCES only — every credential column is a u | INTEGRATION | Y | SO | office_id; every secret column is a vault ref | ON/3 | yes | none / none / none / none | mutable | H | one Slack app per office; fixed vault names must go |
| `slack_channel_authority` | 0 | Why a project's normal Slack channel may be made without asking: a person made the project | PROJECT | N | SC | project_id | ON/0 | none | via parent chain / via parent chain (checked) / state column only / never | insert | L | RLS on, zero policies; 0 rows |
| `slack_channel_map` | 251 | The channel<->project mapping Gate 4 requires. Deliberately here and not in a channel topi | ACCOUNT | Y | SC | office_id (project nullable: lobby/discipline channels) | ON/3 | yes | own office / own office (checked) / own office, office immutable / own office | mutable | M | channel_id is globally unique at Slack |
| `slack_workspaces` | 55 |  | INTEGRATION | Y | SO | office_id (team -> office binding) | ON/3 | yes | none / none / none / none | mutable | H | 0630 binds events to the installed workspace; this binds the workspace to an office |
| `staff` | 8 | §9: staff are identities, not processes. Deliberately no provider or model column - the id | SYSTEM | N | SO | none (the eight shared personas) | ON/1 | yes | none / none / none / none | operator | M | identities, not state; what they learn lives in office rows |
| `staff_prompts` | 10 | §21: core prompts are versioned, and a version is an immutable row rather than an integer  | SYSTEM | N | SO | none | ON/1 | yes | none / none / none / none | append (versioned) | L |  |
| `staff_tools` | 143 | Per-person tool grants. NEVER a way to exceed tool_permissions: app.staff_may_use() is an  | ACCOUNT | Y | SC | office_id; (staff_slug,tool) | ON/1 | yes | own office / own office (checked) / own office, office immutable / own office | mutable | H | per-person tool grants are Grant's authority: must not be shared |
| `standing_authorizations` | 1 | Do not ask again, as a row (#15). Turns ask into proceed for one tool. Never turns refuse  | ACCOUNT | Y | SC | office_id; composite FK (project_id,office_id) | OFF | none | own office / own office (checked) / state column only / never | insert + revoke | H | project NULL means office-global; two partial unique indexes gain office_id |
| `subject_identities` | 4 | Which channel-native actor is which person (§31). One row per identity, not one per person | INTEGRATION | Y | SO | office_id; (origin_channel,actor) | ON/1 | yes | none / none / none / none | mutable | H | the channel -> person -> office map; unknown = no row = refuse |
| `suggestions` | 6 | What the office noticed without being asked (#52). Identity is (kind, project, subject) ra | ACCOUNT | Y | SC | office_id; project nullable | OFF | none | own office / own office (checked) / own office, office immutable / own office | mutable | M |  |
| `sync_runs` | 986 | One row per sync cycle, kept rather than overwritten. A sync that quietly stopped finding  | ACCOUNT | Y | SO | office_id | ON/3 | yes | none / none / none / none | append | L |  |
| `system_config` | 69 | Office settings. conversation.max_turns is the token cost of a turn; conversation.window_m | SYSTEM | N | SO | none for system keys; ~16 keys are per-person (see ARCHITECTURE) | ON/1 | yes | none / none / none / none | operator | M | split per-office keys into office_settings |
| `task_calendar_links` | 0 | One row per task the office has written into Google Calendar (ADR-0020). The event_id here | PROJECT | N | SO | task_id | OFF | none | none / none / none / none | mutable | L |  |
| `task_links` | 0 | Canonical task to external provider identity (#259). Sync status lives here and never on p | PROJECT | N | SO | task_id | OFF | none | none / none / none / none | mutable | L |  |
| `task_tombstones` | 2 | A personal task that was deleted while an external provider knew about it (#259). Written  | ACCOUNT | Y | SO | office_id | OFF | none | none / none / none / none | append | L | 2 rows |
| `tasks` | 18 |  | ACCOUNT | Y | SC | office_id; composite FK (project_id,office_id) | ON/1 | yes | own office / own office (checked) / own office, office immutable / own office | mutable | H | personal tasks may have no project |
| `telegram_bots` | 8 | Which bot speaks for whom. A table rather than a naming convention because §17 requires an | SYSTEM | N | SO | none (shared bots per staff persona) | ON/2 | yes | none / none / none / none | operator | M | a bot is infrastructure; the CHAT is the identity |
| `telegram_chats` | 204 | Chats the bot can reach. Cannot be seeded or configured: Telegram forbids a bot messaging  | INTEGRATION | Y | SO | office_id nullable = unbound | ON/1 | yes | none / none / none / none | upsert | H | subject text today; null-subject chats match anyone |
| `test_destinations` | 1 | Destinations a harness may deliver to. Everything else is production. Anchor C, 0523. | HARNESS | N | SO | none | OFF | none | none / none / none / none | retired never deleted | M |  |
| `test_origins` | 218 | Conversations a verification run declared as test traffic BEFORE driving a production door | HARNESS | N | SO | none | OFF | none | none / none / none / none | declared before use | M |  |
| `tool_permissions` | 29 | §11: the tool router enforces these and agents must not self-authorize around them, which  | SYSTEM | N | SO | none (capability catalogue + product safety floor) | ON/1 | yes | none / none / none / none | operator | M | stays global: it is what the product CAN do |
| `tool_requests` | 14 | What the office has asked to be able to reach, and what Grant said (#53). An approval name | ACCOUNT | Y | SC | office_id; from_job | ON/1 | yes | own office / own office (checked) / state column only / never | insert + decide | M |  |
| `trigger_firings` | 0 | What each trigger did about each event, INCLUDING what it declined and why (#264). A trigg | JOB | N | SO | job_id | OFF | none | none / none / none / none | append | L | 0 rows |
| `tts_usage` | 0 | Characters sent to a TTS provider, counted by us because no live counter exists to read. W | SYSTEM | N | SO | correlation_id | ON/1 | yes | none / none / none / none | append | L | 0 rows; system metering |
| `undo_requests` | 3 | One row per ACTION, not per request. The primary key is the lock: a concurrent duplicate c | LEDGER | N | SO | action_id | ON/1 | yes | none / none / none / none | insert | L |  |
| `undoable_actions` | 546 | §12 Undo. `reversal` carries exactly what is needed to reverse the action - not the origin | ACCOUNT | Y | SC | office_id; composite FK (job_id,office_id) | ON/2 | yes | own office / own office (checked) / state column only / never | insert + press | H | a press target addressed by id |
| `workspace_layouts` | 1 |  | ACCOUNT | Y | SC | office_id (replaces text owner) | ON/0 | yes | own office / own office (checked) / own office, office immutable / own office | mutable | L | RLS on, zero policies |

## The 46 tables with row security off today

These are the tables #399 is about. The list is the live catalogue, not the issue text (which counted 43 when 0642 ran).

| Table | Rows | Target class | Target RLS | Why |
|---|---:|---|:-:|---|
| `appearance_settings` | 1 | ACCOUNT | SC | text owner defaults to grant; PK (owner) becomes (office_id) |
| `autonomy_policy` | 16 | SYSTEM | SO | per-office override DEFERRED; floor must stay global |
| `branch_groups` | 128 | JOB | SO | synthesis_job_id -> jobs.office_id |
| `breadth_dimensions` | 37 | HARNESS | SO | coverage vocabulary |
| `browser_actions` | 10 | PROJECT | SC | page content may be private |
| `browser_sessions` | 0 | INTEGRATION | SO | holds a vault ref to a cookie jar; service-only |
| `build_steps` | 145 | SYSTEM | SO | describes the developer session, not an office |
| `ci_runs` | 27 | SYSTEM | SO | CI minutes are one deployment cost ceiling |
| `ci_workflows` | 2 | SYSTEM | SO | none |
| `collections` | 1 | PROJECT | SC | project_id |
| `contacts` | 0 | PROJECT | SC | 0 rows; PII; #172 strong tier |
| `decisions` | 324 | PROJECT | SC | project_id; from_job |
| `document_collections` | 0 | PROJECT | SC | collection_id -> project |
| `document_orders` | 0 | ACCOUNT | SC | office_id (replaces text owner); project_id |
| `drive_watch` | 1 | INTEGRATION | SO | attachment_id -> project -> office |
| `duty_said` | 5 | ACCOUNT | SO | per-duty memory for say_once; must not dedupe across offices |
| `event_triggers` | 0 | ACCOUNT | SC | 0 rows |
| `icon_defaults` | 61 | SYSTEM | SO | product default; per-office edit DEFERRED |
| `job_branches` | 185 | JOB | SO | job_id |
| `job_impediments` | 1,978 | JOB | SO | is_fixture frozen copy (0303/0304) |
| `job_pauses` | 320 | JOB | SO | job_id |
| `job_steps` | 4,182 | JOB | SO | job_id |
| `known_escapes` | 38 | HARNESS | SO | acknowledged evidence; must not be deleted |
| `legacy_trusted_commands` | 35 | HARNESS | SO | frozen at 0603 |
| `lessons` | 658 | ACCOUNT | SC | enters every prompt of the office: scope the lookup, not just the table |
| `mcp_auth_codes` | 0 | INTEGRATION | SO | hashed codes |
| `mcp_discovered_tools` | 0 | INTEGRATION | SO | provider_id -> mcp_providers.office_id |
| `mcp_oauth_clients` | 20 | INTEGRATION | SO | RFC 7591 registration is unauthenticated by design; binds at the code |
| `mcp_providers` | 0 | INTEGRATION | SO | 0 rows today |
| `notebook_operation_cost` | 13 | SYSTEM | SO | none (our own estimate table) |
| `notebook_refusals` | 0 | INTEGRATION | SO | 0 rows |
| `notebook_spend` | 8 | PROJECT | SO | project_id; job_id |
| `office_members` | 2 | INTEGRATION | SO | RETIRED by offices; email-keyed, mutable identity |
| `operator_senders` | 5 | HARNESS | SO | dedupe-key namespaces of legitimate senders |
| `plane_layouts` | 1 | ACCOUNT | SC | office_id (replaces text owner); project_id |
| `project_seen` | 3 | ACCOUNT | SC | office_id (replaces text owner); project_id |
| `relations` | 1 | PROJECT | SC | derived edges are views; stored edges only |
| `signals` | 363 | ACCOUNT | SC | office_id; project nullable |
| `standing_authorizations` | 1 | ACCOUNT | SC | project NULL means office-global; two partial unique indexes gain office_id |
| `suggestions` | 6 | ACCOUNT | SC | office_id; project nullable |
| `task_calendar_links` | 0 | PROJECT | SO | task_id |
| `task_links` | 0 | PROJECT | SO | task_id |
| `task_tombstones` | 2 | ACCOUNT | SO | 2 rows |
| `test_destinations` | 1 | HARNESS | SO | none |
| `test_origins` | 218 | HARNESS | SO | none |
| `trigger_firings` | 0 | JOB | SO | 0 rows |

## The 15 tables with RLS on and no policy

They deny everything to every non-bypass role today. The target keeps them denied for `SO` and gives the office policy to `SC`.

| Table | Target | Class |
|---|:-:|---|
| `asset_actions` | SO | SYSTEM |
| `connector_capabilities` | SO | SYSTEM |
| `contact_label_links` | SC | PROJECT |
| `contact_labels` | SC | ACCOUNT |
| `dashboard_layouts` | SC | ACCOUNT |
| `eval_cases` | SO | HARNESS |
| `eval_runs` | SO | HARNESS |
| `eval_scores` | SO | HARNESS |
| `job_child_slots` | SO | JOB |
| `job_traces` | SO | JOB |
| `project_references` | SC | PROJECT |
| `project_staff` | SC | PROJECT |
| `proposals` | SC | ACCOUNT |
| `slack_channel_authority` | SC | PROJECT |
| `workspace_layouts` | SC | ACCOUNT |
