# Migration plan — from one implicit owner to offices

> **Nothing here is applied.** SQL in this document is a **sketch**, written to be reviewed, not run. Per CLAUDE.md every
> change to an existing function must be spliced from its **live** definition (`pg_get_functiondef`), not rewritten
> from memory, and every `drop function` must name the exact signature
> (`pg_get_function_identity_arguments`). Both rules are restated at the points they bite.
>
> **Amended after the adversarial reviews (`REVIEWS.md`).** Changes: a `system` office; `uses_system_integrations` guard first;
> explicit office on insert (no parent-derivation); 12 job-inserting functions; no `act_as`/office RLS policies; no
> `voice_sessions`, `staff_tool_defaults`, `office_default_duties` or `office_settings` tables in V1; overloads only on
> the worker's hot path; Sample reset by retirement.
>
> Baseline: production at migration **0646**, `origin/main` `41de1965`. The next number is **0647**; check
> `docs/adr/0047-migration-numbering-across-concurrent-branches.md` and `npm run check:migrations` first.

## 0. Governing rules

1. **Expand → backfill → constrain → contract.** Everything before the last step is additive and reversible. The only
   irreversible step is the contract, and it is gated.
2. **No second office exists in production until the contract step is done and verified.** This single invariant is
   what makes version skew safe: during every intermediate state there is exactly one real office (Grant's) plus one
   test office, so an old component that "does not know about offices" can only ever act in Grant's.
3. **Unknown ownership is never defaulted to Grant.** A row is stamped only by a rule that *proves* it. A row that
   matches no rule **aborts the migration** (the whole transaction rolls back). The only residual class — provably
   harness-only — goes to the test office. There is no `default <grant>` anywhere.
4. **Characterise before every backfill, inside the migration**, as `do $m$ … raise exception` assertions
   (the style 0642 uses), so the migration refuses on data that no longer matches what this plan was written against.
5. **One migration, one transaction, one concern.** A failure must leave nothing half-applied (the lesson of 0417 and
   the "migration whose drive block raises takes the DDL with it" entry — assertions run in a subtransaction that is
   re-raised only on the marker).
6. **Every migration ships its rollback file** next to it (`docs/policy/rollback-0642.sql` is the model) and a
   `verify:` check, and is applied with `npm run migrate` after `check:migrations`.
7. **Deploy the handler after a migration that changes behaviour it depends on** (the "a migration is not a deploy"
   entry). Order is always: migrate → deploy worker → deploy gateway/adapters → verify.

## 1. Sequence at a glance

| # | Migration (working names) | Class | Reversible | Needs deploy |
|--:|---|---|:-:|---|
| M0 | **Phase 1 hotfixes (no schema):** `voice-token` requires a session; `voice` stops using `VOICE_SUBJECT`; **`OPERATOR_ONLY` actions**; **fixed-name secret guard** is added in M1b; drop `office_members.owner_key` default `'grant'` | code + 1 tiny migration | ✓ | hq-api, voice, voice-token |
| M1 | `offices` (incl. `system`, `uses_system_integrations`, immutability triggers) + `office_of_auth` + `provision_office` + bind Grant, the test principal, create the `system` office | additive | ✓ drop | no |
| M1b | `app.system_secret(p_office, name)` — every fixed-name secret read goes through it | security | ✓ | worker, hq-api |
| M2 | add **nullable** `office_id` + indexes to the **44** carriers | additive | ✓ drop column | no |
| M3 | per table group, **one transaction each**: characterise → backfill → immutability → composite keys → composite FKs (`NOT VALID` then `VALIDATE`) → `SET NOT NULL`. Groups: roots & bindings · jobs (by tree) · job-owned · account-level | data + constrain | ✓ until M3 completes | no |
| M4 | per-office uniqueness (the global indexes) — `dedupe_key`/idempotency ones ship with M5.1 | constrain | ✓ | with M5.1 |
| M5.n | function conversion waves (below) | expand | ✓ | worker+gateway per wave |
| M6 | RLS on for the 46 (uniform `ai_team_app` policy); **no office policies, no `act_as`** | security | ✓ | no |
| M7 | `may_act_outside` + `offices.kind`; delivery destination-office check | security | ✓ | worker |
| — | **GATE: isolation suite green, mutation families red, Grant's gate unchanged, `hq.api_token` rotated** | | | |
| M8 | contract: drop the short list of old overloads, `office_members`, the nine text `owner` columns, `unnamed_project()`, the legacy-office bridge | **contract** | **✗ (snapshotted)** | all |
| — | provision the Sample office (data, by script) | data | ✓ retire | no |
| M9 *(before a 2nd real human only)* | `office_credentials`, `office_settings`, per-office versions of OPERATOR actions | additive | ✓ | |

## 2. Per-migration specifications

### M1 — `offices`, and Grant's binding

- **Purpose.** Create the ownership primitive and bind the two existing auth users. Nothing reads it yet.
- **Characterisation (asserted inside).** `auth.users` has exactly the rows expected; `office_members` has exactly one
  row with `owner_key='grant'` and at most one with `owner_key='verify-operator'`; each maps to exactly one
  `auth.users.id` by `lower(email)`; no auth user is mapped by two members.
- **Schema.** `public.offices` as ARCHITECTURE §2; `app.office_of_auth(p_auth uuid)` (stable, definer, returns
  `office_id, kind, state` or no row); `app.provision_office(p_auth uuid, p_kind text, p_name text)` (service role
  only, idempotent on `auth_user_id`, seeds defaults from M8 once those exist); `revoke all … from public, anon,
  authenticated`.
- **Backfill.** Derived, never typed: `insert into offices … select u.id, 'person', 'Grant' from office_members m join
  auth.users u on lower(u.email)=m.email where m.owner_key='grant'`; the same for `verify-operator` with `kind='test'`
  and name *"harness principal and quarantine"*. **No email literal appears in the file** (0580 records `check:secrets`
  refusing one).
- **RLS.** `enable row level security`, no policy (service-only).
- **Immutability and the system office.** A trigger refuses any change to `kind` and `auth_user_id` (a mis-set `kind`
  would turn Sample containment on or off for Grant). A unique partial index allows exactly one `system` office, which has
  no auth user and which no session can resolve to. `provision_office` on an existing auth id returns the existing office
  and refuses a different kind. `uses_system_integrations` is set true for Grant's office only.
- **Rollback.** `drop table public.offices cascade` — safe: nothing references it yet.
- **Worker compatibility.** Irrelevant; unread.
- **Verification.** `select count(*) = 2`; the unique constraint rejects a second binding of the same auth id (driven,
  inside a rolled-back block).

```sql
-- SKETCH (not applied)
create table public.offices (
  office_id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  kind text not null default 'person' check (kind in ('person','sample','test')),
  name text not null check (btrim(name) <> ''),
  state text not null default 'active' check (state in ('active','disabled')),
  created_at timestamptz not null default app.now_utc(),
  disabled_at timestamptz,
  constraint offices_disabled_has_time check ((state='disabled') = (disabled_at is not null))
);
alter table public.offices enable row level security;
revoke all on table public.offices from anon, authenticated;
```

### M2 — add nullable `office_id`

- **Purpose.** Create the column everywhere it will live, so backfill and constraints can be separate steps.
- **Schema.** For each of the 41 *new* carriers (the 9 that replace a text `owner` get theirs in M3c):
  `alter table … add column office_id uuid references public.offices(office_id)`, then `create index … on … (office_id)`
  (and `(office_id, project_id)` on the hot ones). All on small tables except `jobs` (19,797), `inbound_commands`
  (2,771), `outputs` (13,957), `events` (9,962), `deliveries` (4,028): all trivially small for a rewrite-free
  `ADD COLUMN` with no default.
- **Backfill/constraints.** none (nullable).
- **Rollback.** `alter table … drop column office_id` (a generated list; the rollback file is generated by the same
  query that generated the migration).
- **Worker compatibility.** Old workers ignore the column. ✓
- **Verification.** the catalogue query from `TABLE-REVIEW-399.md` finds the column on exactly the 44 carriers.

### M3a/b/c — the Grant backfill (the dangerous one)

Full rules in §3. Mechanics common to all:

- Run in **dependency order**: roots → jobs → job-owned → account-level.
- Each `update … set office_id = …` is followed in the same migration by `raise exception` unless the count of rows
  still null in that table equals the number the characterisation said would be residual (zero for everything except
  deliberately-unbound channel rows).
- **Append-only tables.** Six carriers refuse UPDATE by trigger: `events`, `autonomy_settings`, `feedback`, `lessons`,
  `skills`, `preference_instructions` (`briefings` protects its body only). The backfill sets `office_id` **once from
  null**, inside the migration transaction, with only the `*_reject_update` trigger suspended (`alter table … disable
  trigger <name>` … `enable trigger`), and the migration ends by asserting `tgenabled = 'O'` for every trigger it
  touched. This is the "honest recovery" CLAUDE.md records for a ledger edit, made explicit, bounded and asserted. The
  alternative — teaching each trigger an exception for `office_id` null→value — is rejected: it would leave a permanent
  hole in six evidence tables to save one transaction.
- `jobs` is touched by `jobs_enforce_transition`, `jobs_log_creation` and eleven more triggers; the backfill updates
  only `office_id`, and the M4 immutability trigger is installed **after** it.
- **Rollback.** `update … set office_id = null` (the immutability trigger does not exist until M4; M4's rollback drops
  it before any M3 rollback is run).
- **Worker compatibility.** unaffected; the column is written by nobody else yet.

### M3 mechanics — explicit office, immutability, composite keys (was "derive-on-insert")

**Review A (F4) showed the original design was wrong here.** Deriving a row's office from the parent *the caller named*
turns the composite key into a tautology: a caller naming another office's project would silently write into it
instead of failing with `23503`. The corrected rule: **an office's source is the verified session, the channel
identity, or a claimed job — never a row the caller named.**

- **Roots and commands take the office explicitly.** The dashboard passes the office from the verified session
  (`say_in_project`, `enqueue_inbound`); channels pass the office resolved from `subject_identities`. No trigger derives
  an `inbound_commands` office from `subject_identities` (Review A, F6: 1,711 of 2,771 commands are `teamhq`, which have
  no identity row, so that trigger would have broken the main chat path). Slack's workspace-office = sender-office
  check lives in `enqueue_inbound`, after `inbound_commands_slack` exists.
- **Children derive from the parent job** (a claimed, durable row) and `enqueue_child` additionally validates
  `p_project` against it.
- **Documents, tasks, blockers, deliveries** take an explicit `p_office`; the project/job they name is then **checked**
  against it by the composite FK.
- **The version-skew bridge.** Old workers/adapters insert without an office. During the Grant-only period only,
  `app.legacy_office()` returns the sole `person` office **iff no `sample` or second `person` office is active**, and
  NULL (so the insert raises) the moment one is. It is explicit, self-extinguishing, and deleted at M8; it exists so an
  old component keeps working for minutes between migrate and deploy, and it **is why no second real office may exist
  before the contract** (§0.2). It is not a default on any column.
- **Immutability** extends the 0619 write-once trigger to `office_id` on every carrier.
- **Composite unique keys and FKs** include the secondary edges (ARCHITECTURE §4): `origin_command_id`,
  `inbound_commands.job_id`, `documents.produced_by_job`, `mirrors_document_id`, `tasks.job_id`, `tasks.parent_task_id`,
  `branch_groups`, `job_branches`, `consultations`; `relations` carries `office_id` and is function-checked.
- **M3 and the immutability/FK steps for one table group are one transaction** (Review A, F16: a gap between backfill and
  triggers lets null rows in and the later assertion aborts).

### M3 (constrain step) — composite FKs and `NOT NULL`

- `alter table … add constraint … foreign key (parent, office_id) references parent_table (id, office_id) **not valid**`
  then `validate constraint` in a second statement (validates without a long exclusive lock). `MATCH SIMPLE`
  deliberately skips rows where the parent column is null.
- `alter table … alter column office_id set not null` last, per table, after a `select count(*) where office_id is
  null = 0` assertion.
- The full FK matrix (every attack in ARCHITECTURE §4) is a table in the migration header and a check
  (`check:office-integrity`) after it.
- **Rollback.** `drop constraint` / `drop not null`.
- **Worker compatibility.** unchanged — M4's triggers already make inserts carry an office.

### M4 — per-office uniqueness

Replace the global indexes listed in ARCHITECTURE §4: `projects_slug_key`, `projects_one_per_notebook`,
`responsibilities_slug_key`, the documents' four, `deliveries_dedupe_key_key`, `inbound_commands_dedupe`,
`jobs_one_live_per_idempotency_key`, `standing_live_*`, `briefings_one_per_day`, calendar/mail keys. Each is created
**before** the old one is dropped (so uniqueness never lapses). The alias-uniqueness **trigger** (0282) and its
pre-check (`app.add_project_alias`, 0293) are changed **together** — this file records the cost of changing one
(0282/0293, fourth instance in 0562): grep for the function that checks the same thing in advance.

The `dedupe_key` indexes need the producing function to include the office in its `on conflict` target; those
functions are in the M5 waves, so **M4 for those three is shipped with M5.1**, not before. (An index that is stricter
than the function that writes to it silently breaks the writer.)

### M6 — RLS for #399 (decided after review)

- For each of the 46 tables without RLS: `enable row level security` and create the **same policy the other 83 already
  have** — `to ai_team_app using (true) with check (true)` — so the eleven verify suites that `set local role
  ai_team_app` keep working. No policy and no grant for `anon`/`authenticated`; `check:anon-exposure` re-run, green.
- **Not built:** `app.act_as`, `app.current_office()`, the 56 office policies, the `exists` helpers (see ARCHITECTURE §5:
  nothing connects as a non-bypass role; a custom setting is spoofable). The per-table *future* policy shape is recorded
  in `TABLE-REVIEW-399.md`.
- `force row level security` is not used; the owner role must keep working.
- **Rollback.** disable RLS on the 46 (generated list). **Worker compatibility.** none: bypassed. **Verification.** every
  table has RLS on; `check:anon-exposure` green; the suites that use `ai_team_app` pass unchanged.

### New tables — only what V1 acceptance needs

Review B cut four: `voice_sessions` (the JWT supplies the office on every turn), `staff_tool_defaults` and
`office_default_duties` (constants inside `provision_office`, used only for Sample/test offices), and `office_settings`
(`offices.timezone` and a name suffice until a second real human). **Deferred to before a second real human:**
`office_credentials` (unique `(office_id, service, slot)`, `secret_ref` via the `vault_secret_ref` domain) and
`office_settings`. Until then fixed-name Vault secrets remain, read **only** through `app.system_secret(p_office, name)`
(M1b), which refuses any office without `uses_system_integrations`. Moving Grant's own secrets behind refs is a separate,
operator-confirmed step (it touches live credentials).

### M5.n — function conversion waves

The converted set is **derived in P0** (transitive call graph from the gateway map, the **inline gateway paths**,
`supabase/functions/*`, the adapters, the worker). It includes `mcp_*` and the 12 job inserters. Waves, each shippable alone:

| Wave | Contents |
|---|---|
| 5.1 | the **12 job-inserting functions** stamp the office: `answer_generation_approval`, `dispatch_due_responsibilities`, `enqueue_child`, `enqueue_child_once`, `enqueue_inbound`, `fire_triggers_for`, `google_revoke_begin`, `hq_rename_project`, `mcp_enqueue`, `notice_new_document`, `provision_missing_channels`, `register_mcp_provider` (+ the three `dedupe_key`/idempotency index re-scopes; + the scripts that insert jobs directly); `enqueue_child` validates `p_project`; `unnamed_project(p_office)` |
| 5.2 | approvals & presses: `hq_answer_blocker`, delivery press, undo, resume, standing grant/revoke, autonomy — **refuse before revealing** (the principal check already runs before the row is locked; the office check joins it) |
| 5.3 | retrieval & context: `search_documents`, `sibling_projects`, `projects_named_in`, `mail_for_project`, `project_knowledge`, `lessons_for`, `conversation_before`, `voice_state`, `voice_lookup` |
| 5.4 | **MCP**: `mcp_projects`, `mcp_search`, `mcp_job_status(p_office, p_job)`, `mcp_enqueue`, `read_document`, …; `mcp_clients.office_id`; tokens/consent name the office explicitly |
| 5.5 | gateway reads (60 listings) + the **inline paths** + views; storage ownership-before-write |
| 5.6 | gateway writes (the remaining id-taking functions), `OPERATOR_ONLY` completion |
| 5.7 | channel identity: `subject_identities`, `telegram_chat_for`, `sender_admitted`, Slack workspace binding, shared-app model |

**Overloads (Review B, T3 — modified).** `create or replace function` with a changed argument list *creates a second
overload* (CLAUDE.md). Old overloads are kept **only** for functions the worker or gateway calls in a loop (waves 5.1,
5.2 and `dequeue_job`), so a minutes-long migrate→deploy gap does not strand jobs; everything else migrates and
deploys in lockstep with the old body saved in the rollback file. The 7-day no-call evidence and `track_functions` apply
only to that short list (and, if the managed database refuses the setting, a one-line `events` write in each).

### M7 — containment
`app.may_act_outside(p_job_id)` becomes `job_origin(p_job_id) in ('trusted','internal') and office.kind='person'`,
spliced from the live 0603 definition. One edit changes both external boundaries (the delivery guard and the worker's
write gate). Also (Review A, F10): `claim_delivery` checks that the **destination's office** (`telegram_chats`,
`slack_workspaces`/`slack_channel_map`) equals the delivery's office, in the same function. Control: a sample-office job
whose origin is `trusted` is refused; a delivery to another office's chat is refused.

### M8 — contract (the only irreversible step)
Preconditions (all must hold; checked by a script, not by the author): user-isolation suite green; every mutation family red;
`npm run gate` unchanged; seven days with no call to any old overload (counted from `pg_stat_user_functions` after `track_functions = 'all'` is
set at M5.1 — **if the managed database refuses that setting, M5.1 instead wraps each old overload in a one-line
`events` write so the evidence still exists; this is checked in P0, not assumed**); Grant's devices all on signed-in sessions.
Then: drop the short list of old overloads and `unnamed_project()`; delete the `legacy_office()` bridge; `office_members` → snapshot to a table `office_members_retired` then drop; drop the nine text
`owner` columns after copying to `office_id`; remove the legacy-token office path (§4); drop `VOICE_SUBJECT` and
`telegram.direct_to_grant`. **Snapshot first:** `pg_dump` of the affected tables to the existing backup bucket.

## 3. The Grant backfill — exact rules

**Inputs.** Three offices — **G** (Grant), **Q** (test) and **SYS** (the `system` office, created in M1; it receives system duties and system-actor events only) — of which the two that matter for stamping are: **G** (Grant, `person`) and **Q** (`test`, bound to the `verify-operator` auth user; it is both
the test principal's home and the quarantine for provably-harness residue). A row's office is the first rule that fires;
if none fires the migration aborts.

### 3.1 Roots
| Table | Rule |
|---|---|
| `projects` (1,794: 406 real, 1,388 fixture) | **all → G.** Fixture projects stay in G because fixture jobs sit on real projects (#45; 59 fixture projects carry non-fixture jobs) and the composite FK requires one office per tree. Their `is_fixture` flag is unchanged. |
| `inbound_commands` (2,771) | the command's **job** decides (a command and its job share an office); a command with no job: `subject = 'grant'` → G; `synthetic` or declared test origin → Q; **else abort** |
| `subject_identities` (4) | `(slack|telegram|voice, grant)` → G; `(slack, verify-echo)` → Q |
| `telegram_chats` (204) | private & `subject='grant'` (8) → G; groups (196): → G **only if** deliverable **and** a non-fixture, `sent` delivery targeted it; **otherwise `office_id` stays NULL = unbound, never deliverable** |
| `slack_app_credentials` (1) → G; `slack_workspaces` (55) | the row whose `team_id` equals `slack_app_credentials.team_id` → G; the other 54 → NULL (unbound) |
| `slack_channel_map` (251) | via `project_id`; the 3 with no project: via their workspace's office, else NULL |
| `knowledge_connectors` (7), `mcp_clients` (22), `mcp_providers` (0) | G (the only office that has connected anything) — asserted by `created_at < M1` |

### 3.2 Jobs (19,797) — by tree
Pre-0619 jobs have `origin_kind` null (16,466), so origin is **not** the basis. The basis is, in order:
1. **Tree walk.** Work from each root (`parent_job_id is null`); a descendant takes its root's office.
2. A root → **G** if its tree references any project (every project is G's), **or** `requested_by` is one of
   `hq:*`, `grant:*`, `teamhq:grant`, `telegram:grant`, `voice:grant`, `slack:grant`, **or** it is a `duty:<slug>` whose
   `job_kind` is on the **person-duty list** below.
   **Duties are classified by kind, not assumed** (measured 1 October; jobs per duty in brackets). *Person duties → G:*
   `drive.watch` (2,716), `tasks.remind` (1,064), `google.read_calendar` (553), `google.read_mail` (541), `office.sync`
   (534), `google.write_calendar_tasks` (463), `office.notion_sync` (269), `briefing.morning` (21), `office.propose` (14),
   `tasks.sync`, `office.vault_export`. *System duties → the `system` office:* `office.prune_job_traces` (454),
   `office.prune_build_shots` (16), `office.backup` (23), `office.capacity_report` (25), `office.slack_rotate` (137 — the
   shared Slack app), `office.chores` (309 — credential chores; confirm in P0 whether any touches a person's data).
   A duty whose kind is on neither list **aborts the migration**. The same list drives `responsibilities.office_id`
   (17 rows) and tells `provision_office` which duties a new office receives (person duties only; provider-dependent
   ones — `google.*`, `office.notion_sync`, `tasks.sync` — are created when that provider is connected).
3. A root with **no** project in its tree and a harness attribution (`is_fixture` or `synthetic`, or `requested_by` in
   `verify:*`, `phase-1-verification:*`, `gate-*`, `telegram:4242`, `slack:U0ECHOVERIFY`, `connector:register`,
   `mcp:*`, `upload:newsroom-second-*`) → **Q**. (These are the 28 real-flagged jobs the characterisation found plus the
   no-project fixture roots.)
4. **Anything else aborts.** The expected residue is zero; a non-zero count prints the `requested_by` histogram so the
   operator decides, instead of the migration guessing.

Assertion before `set not null`: for every job, `office_id` equals its parent's and its project's (the composite FKs
then *enforce* it from M5 on).

### 3.3 Job-owned carriers
`outputs`, `undoable_actions`, `blockers`, `job_*`: from `job_id`. `blockers` with no job (462) use `project_id` (every
blocker has one or the other — verified: 0 have neither). `deliveries` (4,028; 632 without a job): `blocker_id` →
`correlation_id` to a job → destination: a Telegram/Slack target equal to a G-bound chat → G; a registered
`test_destinations`/`operator_senders` namespace → Q; **else abort**. `events` (9,962): `related_job_id` → `project_id`
→ else the actor/namespace rules above; system events with neither and a `system` actor go to the **`system` office** (never Grant's, never null).

### 3.4 Account-level
`mail_messages`, `calendar_events`, `briefings`, `lessons`, `skills`, `tasks`, `decisions` (via project),
`standing_authorizations` (the 1 global row), `autonomy_settings`, `responsibilities` (17, all no-project: the person duties above → G, the system duties → the `system` office),
`staff_tools`, `notification_*`, `feedback`, `preference_instructions`, `tool_requests`, `proposals`, `signals`,
`suggestions`, `sync_runs`, `task_tombstones` → **G**, asserted by the single-owner history: `auth.users` had 0 rows
until 24 September, `office_members` has one person. Fixture lessons (511 of 658) are G's and keep `is_fixture`.
The nine text-`owner` tables map `owner = 'grant'` → G (all three populated ones hold only that value) and `'verify-operator'`
→ Q; any other value aborts.

### 3.5 What the migration refuses to do
- Re-home a row after the fact. `office_id` is immutable; a mistaken stamp is repaired only by `app.rehome_row`, a
  service-only function that logs an `events` row and is exercised in the plan's rollback drill.
- Touch `known_escapes`, `legacy_trusted_commands`, `test_*` (harness evidence).

### 3.6 Post-conditions (asserted)
`count(*) filter (where office_id is null)` is 0 on every `NOT NULL` carrier; the unbound channel rows are exactly the
expected set; per-table row counts are unchanged; per-office counts match the characterisation; no trigger is left
disabled; `check:office-integrity` passes; **the existing gate is green.**

## 4. The legacy bearer token (N5)

Browsers Grant already uses hold `hq.token`, which the page still *reads* (ADR-0043). After M5.5 the machine key must
name an office. A global default would be a Grant fallback, so:

1. **Before enforcement**, Grant's devices are confirmed on signed-in sessions (the sign-in path has existed since 24
   September). The page stops reading `hq.token`.
2. The machine key requires `x-office-id`; suites, scripts and MCP pass it explicitly. There is **no** default.
3. If a stale browser still sends the token without an office it gets `403 office_required` and signs in again — a
   nuisance, never a mis-attribution.

## 5. Version-skew matrix

Components: **DB** (S0 today · S1 after M1–M2 · S2 after M3–M4, M6 · S3 after M5 and M7 · S4 after M8) · **Worker** (W0/W1) ·
**Gateway** (G0/G1) · **Adapters** Slack/Telegram/voice (E0/E1) · **Web** (U0/U1).

| Combination | Verdict | Why |
|---|---|---|
| W0 + S1/S2 | ✓ | the Grant-only `legacy_office()` bridge supplies `office_id` (and returns NULL — so the insert raises — the moment a `sample` or second `person` office is active); reads ignore it |
| W0 + S3 | ✓ | old overloads still exist |
| W0 + S4 | ✗ **forbidden** | contract drops the overloads W0 calls — gated by the 7-day no-call evidence |
| W1 + S0 | ✗ **forbidden** | W1 needs `office_id` on the job row; deploy order is always migrate first |
| W1 + S1 (backfill incomplete) | fails closed | `JobContext` construction throws on a null `office_id`; nothing is mis-attributed |
| G0 + S2/S3 | ✓ | old signatures retained; only Grant's office exists |
| G1 + S3 | ✓ | new overloads |
| G1 + S1 | ✗ | `p_office` functions do not exist yet → 404 → fails closed |
| E0 (old webhook) + S2 | ✓ | `inbound_commands` derivation falls back to `subject_identities`; Grant-only period |
| W0 and W1 running together (rolling deploy) | ✓ | both read the same rows; `claim_gen` fences stale holders (0620) |
| U0 (page) + G1 | ✓ | the page never supplies an office |
| **Any combination with a second real office** | ✗ **forbidden until M8 is verified** | invariant §0.2 |

## 6. Rollback strategy and drill

| Stage | Rollback | Data loss |
|---|---|---|
| M1–M2 | drop table / columns | none |
| M3 | `set office_id = null` | none |
| M4–M6 | drop triggers/constraints/indexes, recreate the global indexes **first** | none |
| M6 | disable RLS on the 46 (generated) | none |
| M5.n | drop the new overloads (old ones still serve the short list); restore saved bodies for the rest | none |
| M7 | restore the saved `may_act_outside` | none |
| **M8** | restore from the pre-contract `pg_dump` of `office_members` and the nine `owner` columns, recreate overloads from the saved definitions | **writes made after M8 to those columns** |

**Drill.** On the isolated replica, before M8: apply M1–M7, run the suite, then roll back M7→M1 in reverse and
assert the catalogue equals the pre-migration baseline (a schema diff, as `replica.sh`'s fidelity measure does).
Rolling back is only credible if it has been done.

## 7. Open decisions that affect migrations

| | Decision | Recommended default |
|---|---|---|
| D1 | Grant's harness traffic: leave in G (flags) or move into Q going forward | **leave; new suites use test offices** (a forced move breaks 49 suites' assumptions) |
| D2 | `verify-operator` and quarantine share Q | yes |
| D3 | `events` rows with no office derivable (system events) | **resolved:** the `system` office (`NOT NULL` everywhere; Review A, F7) |
| D4 | Fixed-name Vault secrets → `office_credentials` for Grant | separate operator-confirmed step (touches live credentials) |
