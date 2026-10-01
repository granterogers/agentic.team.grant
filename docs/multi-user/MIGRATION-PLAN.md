# Migration plan — from one implicit owner to offices

> **Nothing here is applied.** SQL in this document is a **sketch**, written to be reviewed, not run. Per CLAUDE.md every
> change to an existing function must be spliced from its **live** definition (`pg_get_functiondef`), not rewritten
> from memory, and every `drop function` must name the exact signature
> (`pg_get_function_identity_arguments`). Both rules are restated at the points they bite.
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
| M1 | `offices` + `office_of_auth` + `provision_office` + bind Grant and the test principal | additive | ✓ drop | no |
| M2 | add **nullable** `office_id` + indexes to the 50 carriers | additive | ✓ drop column | no |
| M3a | characterise + backfill **roots** (projects, inbound_commands, bindings) | data | ✓ set null | no |
| M3b | backfill **jobs** by tree, then job-owned carriers (outputs, blockers, deliveries, undoable_actions, events, …) | data | ✓ set null | no |
| M3c | backfill account-level carriers (mail, calendar, lessons, skills, tasks, …) and text `owner` tables | data | ✓ | no |
| M4 | **derive-on-insert** triggers + `office_id` immutability + composite unique keys | additive | ✓ drop trigger | no |
| M5 | composite FKs (`NOT VALID`, then `VALIDATE`) + `SET NOT NULL` | constrain | ✓ drop constraint | no |
| M6 | per-office uniqueness (re-scope the global indexes) | constrain | ✓ | no |
| M7 | `app.current_office`, `app.act_as`, helpers; **RLS on for all 46**, office policies on the `SC` tables, `true` policies replaced | security | ✓ restore saved policies | no |
| M8 | new tables: `office_credentials`, `office_settings`, `voice_sessions`, `staff_tool_defaults` | additive | ✓ drop | no |
| M9.n | function conversion waves — **new overloads with `p_office`**, old ones kept | expand | ✓ drop new | worker+gateway after each wave |
| M10 | `may_act_outside` extended with `offices.kind` | security | ✓ restore function | worker |
| — | **GATE: user-isolation suite green, sabotage 19/19, Grant's gate unchanged** | | | |
| M11 | contract: drop old overloads, retire `office_members`, drop text `owner`/`owner_key`, remove legacy-token path | **contract** | **✗ (snapshotted)** | all |
| — | provision the Sample office (data, by script) | data | ✓ purge | no |

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
- **Verification.** the catalogue query from `TABLE-REVIEW-399.md` finds the column on exactly the 50 carriers.

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

### M4 — derive-on-insert, immutability, composite keys

This is the **version-skew bridge**. An old worker, old adapter or old gateway inserts rows without `office_id`
(they do not know it exists). A `NOT NULL` would break them; a `default` would be the forbidden global fallback. So:

- **`before insert` triggers that derive the office from durable facts, and refuse when they cannot.**
  - `jobs`: from `parent_job_id`'s office; else from `project_id`'s; else from `origin_command_id`'s command; else
    **raise** `no_office`. (All production job creation goes through five SQL functions — `enqueue_inbound`,
    `enqueue_child`, `enqueue_child_once`, `dispatch_due_responsibilities`, `enqueue_orphans`; TypeScript never
    `insert`s into `jobs` — so M9 stamps them explicitly and the trigger becomes a verifier.)
  - `inbound_commands`: from `subject_identities(origin_channel, actor)` (when M3a has bound it) else raise unless
    `synthetic` and a test origin is declared (then the test office).
  - `blockers`, `deliveries`, `outputs`, `undoable_actions`: from `job_id`'s office (they all have one or a project).
  - `documents`, `tasks`: from `project_id`'s office; a task with no project requires an explicit office (raise).
- **If the caller *did* supply an `office_id`, the trigger compares it with the derivation and raises on mismatch** —
  "caller-supplied ownership never overrides durable ownership" as code.
- **Immutability.** Extend the 0619 write-once trigger: `office_id` may not change once non-null, on every carrier.
- **Composite unique keys** `(<pk>, office_id)` on every table that will be a composite-FK target
  (`projects`, `jobs`, `blockers`, `documents`, `contacts` …).
- **Rollback.** drop the triggers and unique constraints.
- **Version skew.** old worker + this schema: inserts succeed through derivation; an insert that has nothing to derive
  from fails loudly rather than landing unowned (this is a feature; it is also the reason the invariant of §0.2 is
  needed).

### M5 — composite FKs and `NOT NULL`

- `alter table … add constraint … foreign key (parent, office_id) references parent_table (id, office_id) **not valid**`
  then `validate constraint` in a second statement (validates without a long exclusive lock). `MATCH SIMPLE`
  deliberately skips rows where the parent column is null.
- `alter table … alter column office_id set not null` last, per table, after a `select count(*) where office_id is
  null = 0` assertion.
- The full FK matrix (every attack in ARCHITECTURE §4) is a table in the migration header and a check
  (`check:office-integrity`) after it.
- **Rollback.** `drop constraint` / `drop not null`.
- **Worker compatibility.** unchanged — M4's triggers already make inserts carry an office.

### M6 — per-office uniqueness

Replace the global indexes listed in ARCHITECTURE §4: `projects_slug_key`, `projects_one_per_notebook`,
`responsibilities_slug_key`, the documents' four, `deliveries_dedupe_key_key`, `inbound_commands_dedupe`,
`jobs_one_live_per_idempotency_key`, `standing_live_*`, `briefings_one_per_day`, calendar/mail keys. Each is created
**before** the old one is dropped (so uniqueness never lapses). The alias-uniqueness **trigger** (0282) and its
pre-check (`app.add_project_alias`, 0293) are changed **together** — this file records the cost of changing one
(0282/0293, fourth instance in 0562): grep for the function that checks the same thing in advance.

The `dedupe_key` indexes need the producing function to include the office in its `on conflict` target; those
functions are in the M9 waves, so **M6 for those three is shipped with M9.1**, not before. (An index that is stricter
than the function that writes to it silently breaks the writer.)

### M7 — `current_office`, `act_as`, and RLS (#399)

- `app.act_as(p_office uuid)`: `perform set_config('app.office_id', p_office::text, true)`; executable by
  `service_role` only.
- `app.current_office()`: `nullif(current_setting('app.office_id', true), '')::uuid`; **null when unset**; a policy
  that consults a null denies.
- Helper `app.office_of_project(uuid)` etc. (stable, indexed PK lookups) for derived-table policies.
- For each table per `TABLE-REVIEW-399.md`: `enable row level security`; **drop the existing `using (true)` policy**
  (saved to `docs/policy/rollback-0647+.sql` first) and create `…_office` for `ai_team_app`; `SO` tables get RLS on and
  no policy. `force row level security` is **not** used: the owner role (`postgres`) must keep working, and forcing it
  would be a different design.
- **No policy for `anon` or `authenticated`, and no grant.** `check:anon-exposure` is re-run and must stay green.
- **Rollback.** disable RLS on the 46; recreate the saved `true` policies.
- **Worker compatibility.** The worker is `postgres`/`service_role` (bypass) → no behaviour change. This is exactly why
  RLS can be enabled early without risk and why it is **not** the boundary.
- **Verification.** a `set role ai_team_app` session with no `act_as` reads **zero** rows from every `SC` table (the
  fail-closed property); with `act_as(Grant)` it reads Grant's.

### M8 — new tables
`office_credentials` (unique `(office_id, service, slot)`, `secret_ref uuid` via `vault_secret_ref` domain),
`office_settings(office_id, key, value)`, `voice_sessions(session_id, office_id, project_id, expires_at)`,
`staff_tool_defaults(staff_slug, tool)` and `office_default_duties` (system catalogue the provisioner copies).
`office_credentials` is *populated* for Grant by moving the fixed-name Vault secrets behind refs — **a separate,
operator-confirmed step** because it touches live credentials; until then the fixed names remain and are read through
`office_secret(p_office, …)`, which falls back to the fixed name **only for the Grant office** and only until M11.

### M9.n — function conversion waves

Waves ordered by blast radius, each shippable alone:

| Wave | Contents | Why this order |
|---|---|---|
| 9.1 | job creators (`enqueue_inbound`, `enqueue_child`, `enqueue_child_once`, `dispatch_due_responsibilities`, `enqueue_orphans`) stamp `office_id`; `enqueue_child` validates `p_project`; **plus** the three `dedupe_key` index re-scopes from M6 | everything downstream inherits |
| 9.2 | approvals & presses: `hq_answer_blocker`, delivery press, undo, resume, standing grant/revoke, autonomy | the central gap (E5) |
| 9.3 | retrieval & context: `search_documents`, `sibling_projects`, `projects_named_in`, `mail_for_project`, `project_knowledge`, `lessons_for`, `conversation_before`, `voice_state`, `voice_lookup` | model context |
| 9.4 | gateway reads (the 60 listing functions) and views | user-visible |
| 9.5 | gateway writes (the 92 id-taking functions not already done) | |
| 9.6 | channel identity (`subject_identities`, `telegram_chat_for`, `sender_admitted`, Slack workspace binding) | |
| 9.7 | credentials (`office_secret`) | needed before a second real human connects a provider, **not** for the Sample |

**Overload mechanics.** `create or replace function` with a changed argument list *creates a second overload*
(CLAUDE.md). That is used deliberately: the new `p_office`-first function is added; the old one is kept and is
**unreachable to anything that does not call it by its old name**. PostgREST resolves by the supplied argument names,
and the new function's `p_office` is required with no default, so an old call can never match it. Old overloads are
dropped in M11 by exact signature. Each wave: migrate → deploy worker/gateway/adapters → verify → next wave.

### M10 — containment
`app.may_act_outside(p_job_id)` becomes `job_origin(p_job_id) in ('trusted','internal') and office.kind='person'`,
spliced from the live 0603 definition. One edit changes both external boundaries (the delivery guard and the worker's
write gate). Control: a sample-office job whose origin is `trusted` is refused.

### M11 — contract (the only irreversible step)
Preconditions (all must hold; checked by a script, not by the author): user-isolation suite green; 19/19 sabotages red;
`npm run gate` unchanged; seven days with no call to any old overload (counted from `pg_stat_user_functions` after `track_functions = 'all'` is
set at M9.1 — **if the managed database refuses that setting, M9.1 instead wraps each old overload in a one-line
`events` write so the evidence still exists; this is checked in P0, not assumed**); Grant's devices all on signed-in sessions.
Then: drop old overloads; `office_members` → snapshot to a table `office_members_retired` then drop; drop the nine text
`owner` columns after copying to `office_id`; remove the legacy-token office path (§4); drop `VOICE_SUBJECT` and
`telegram.direct_to_grant`. **Snapshot first:** `pg_dump` of the affected tables to the existing backup bucket.

## 3. The Grant backfill — exact rules

**Inputs.** Two offices: **G** (Grant, `person`) and **Q** (`test`, bound to the `verify-operator` auth user; it is both
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
   `duty:*`, `hq:*`, `grant:*`, `teamhq:grant`, `telegram:grant`, `voice:grant`, `slack:grant`.
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
→ else the actor/namespace rules above; system events with neither and a `system` actor are **not** assigned to any
office (the `events` carrier allows a documented `system` class — see open decision D3).

### 3.4 Account-level
`mail_messages`, `calendar_events`, `briefings`, `lessons`, `skills`, `tasks`, `decisions` (via project),
`standing_authorizations` (the 1 global row), `autonomy_settings`, `responsibilities` (17, all no-project),
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

Browsers Grant already uses hold `hq.token`, which the page still *reads* (ADR-0043). After M9.5 the machine key must
name an office. A global default would be a Grant fallback, so:

1. **Before enforcement**, Grant's devices are confirmed on signed-in sessions (the sign-in path has existed since 24
   September). The page stops reading `hq.token`.
2. The machine key requires `x-office-id`; suites, scripts and MCP pass it explicitly. There is **no** default.
3. If a stale browser still sends the token without an office it gets `403 office_required` and signs in again — a
   nuisance, never a mis-attribution.

## 5. Version-skew matrix

Components: **DB** (S0 today · S1 after M1–M4 · S2 after M5–M7 · S3 after M9 · S4 after M11) · **Worker** (W0/W1) ·
**Gateway** (G0/G1) · **Adapters** Slack/Telegram/voice (E0/E1) · **Web** (U0/U1).

| Combination | Verdict | Why |
|---|---|---|
| W0 + S1/S2 | ✓ | derive-on-insert supplies `office_id`; reads ignore it |
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
| **Any combination with a second real office** | ✗ **forbidden until M11 is verified** | invariant §0.2 |

## 6. Rollback strategy and drill

| Stage | Rollback | Data loss |
|---|---|---|
| M1–M2 | drop table / columns | none |
| M3 | `set office_id = null` | none |
| M4–M6 | drop triggers/constraints/indexes, recreate the global indexes **first** | none |
| M7 | disable RLS; restore saved `true` policies | none |
| M8 | drop tables | none |
| M9.n | drop the new overloads (old ones still serve) | none |
| M10 | restore the saved `may_act_outside` | none |
| **M11** | restore from the pre-contract `pg_dump` of `office_members` and the nine `owner` columns, recreate overloads from the saved definitions | **writes made after M11 to those columns** |

**Drill.** On the isolated replica, before M11: apply M1–M10, run the suite, then roll back M10→M1 in reverse and
assert the catalogue equals the pre-migration baseline (a schema diff, as `replica.sh`'s fidelity measure does).
Rolling back is only credible if it has been done.

## 7. Open decisions that affect migrations

| | Decision | Recommended default |
|---|---|---|
| D1 | Grant's harness traffic: leave in G (flags) or move into Q going forward | **leave; new suites use test offices** (a forced move breaks 49 suites' assumptions) |
| D2 | `verify-operator` and quarantine share Q | yes |
| D3 | `events` rows with no office derivable (system events) | a nullable `office_id` with a check that `actor = 'system'` is required, **not** G |
| D4 | Fixed-name Vault secrets → `office_credentials` for Grant | separate operator-confirmed step (touches live credentials) |
