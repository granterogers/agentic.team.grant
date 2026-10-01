# Multi-user architecture — one account, one private office, many projects

> **Status: research and design. Nothing here is applied.** Baseline `origin/main` = `41de1965`, migrations through
> 0646, researched 1 October 2026. Decision record: ADR-0060. Companion documents are listed at the end.
>
> **Amended after two adversarial reviews (`REVIEWS.md`).** Where this document and the reviews' log differ, this
> document is current. The changes that mattered: a `system` office; credentials guarded *first*; `OPERATOR_ONLY` actions
> and a `kind → principal` mapping; explicit (never parent-derived) office on inserts; no `act_as`/office RLS policies
> in V1; no `voice_sessions`; Sample reset = retire and re-provision; 44 (not 50) carriers.
>
> **Rule for reading this document:** where it says *today*, it was read from the code or queried read-only from
> production on 1 October. Where it says *proposed*, it is a design to be challenged, not a fact.

## 0. The design in nine sentences

1. A new table, `public.offices`, holds one row per human account. Its key, `office_id`, is the only ownership
   primitive. The auth user id (`auth.users.id`) is bound to it once, uniquely, and never by email.
2. A person is identified by their **auth user id**. Email is only how they log in.
3. `office_id` is written, `NOT NULL` and immutable, on the **roots** — the rows a person (or a channel on their
   behalf) creates or addresses by id. Everything else derives ownership through a foreign key.
4. **Composite foreign keys** `(parent_id, office_id)` make a cross-office relationship impossible to store, for every
   writer including the service role. This is the main protection.
5. Every function a user, a channel or an MCP client can reach takes a **required `(p_office, id)`** (no default),
   with the office supplied by trusted code from a verified session or a durable claimed job — never from a request
   body — and checks every id against it. Only functions **no external caller can reach with an arbitrary id** may
   derive the office from a `job_id`/`command_id`.
6. **RLS is a tripwire, not the boundary.** The gateway and the worker connect as `service_role`/`postgres`, which
   bypass it. RLS is turned on for all 129 tables with the same `ai_team_app` policy the other 83 already have, and
   no policy or grant for a public role, ever. Office policies are deferred hardening, because nothing connects as a
   non-bypass role.
7. Retrieval takes `p_office` as a required argument. The office filter is inside the SQL that fetches the rows, so
   another office's text never reaches the prompt.
8. Slack, Telegram and both voice features resolve **channel identity → office** through one table
   (`subject_identities`, extended). Unknown identity has no row and is refused. There is no fallback to Grant.
9. The Sample User is a real second office of kind `sample`. Because containment is derived from the immutable
   office rather than a flag copied from row to row, it survives jobs, children, retries and restarts by
   construction.

**What is deliberately not here:** organizations, memberships, invitations, roles, tenant switching, shared
workspaces, and a many-to-many between people and offices. Section 18 lists what each of those would have cost.

---

## 1. What is true today (the evidence the design rests on)

| Fact | Evidence |
|---|---|
| There is **no ownership concept** anywhere in the schema. 0 tables have `tenant_id`, `account_id`, `org_id` or `user_id`. | catalogue query, 129 tables |
| The only "whose" markers are free-text: `office_members.owner_key` (default `'grant'`), a text `owner` column on 9 layout/preference tables (ADR-0021), and `jobs.requested_by` (`<channel>:<subject>` or `duty:<slug>`). | catalogue + 0580 |
| **All 117 RLS policies are `using (true)`** and name `ai_team_app` (116) or `service_role` (1). None names `anon` or `authenticated`. | `pg_policies` |
| `postgres` and `service_role` have `BYPASSRLS`. `ai_team_app` does not and is `NOLOGIN`. | `pg_roles` |
| The gateway (`hq-api`) holds the **service key** and calls PostgREST with it for everything; the database never sees the caller's identity except an injected `p_by`. | `hq-api/index.ts:43`, `:1676-1688` |
| **0 of 281** public functions are executable by `anon` or `authenticated`; 0 of 129 tables are reachable by a public key. | `check:anon-exposure`, green at baseline |
| The gateway exposes **152 functions**, all `SECURITY DEFINER`; **92 take an id** and **60 take none** (they read "the whole office"). | gateway map × `pg_proc` |
| `public` has 14 views, none `security_invoker`, so they run as their owner. | `pg_class.reloptions` |
| The worker connects directly as `postgres` (`SUPABASE_DB_URL`) and falls back to the Management API. Neither is subject to RLS. | `worker/index.ts:262-264` |
| `src/` contains **502 `execute(` calls in 95 files**; 72 files name `public.` tables in raw SQL (102 references to `jobs`, 30 to `projects`, 24 to `documents`, 20 to `inbound_commands`). | grep |
| **7,243 real jobs have no project** (duties, office-level conversation). Project alone cannot be the owner of a job. | `jobs` characterisation |
| `staff` is 8 global rows (the shared personas). `tool_permissions` is a global catalogue. | catalogue |
| Retrieval is `tsvector` + trigram. **There are no vector columns and no embeddings** in the schema. | `information_schema` |
| `auth.users` holds 2 rows: Grant, and the `verify-operator` test principal. | read-only query |

The single most important sentence in this table: **ownership is currently enforced by one bearer token and the
gateway's code, not by data.** Everything below puts it into the data.

---

## 2. The ownership primitive (decision)

Full comparison and the rejected options are in ADR-0060. The choice:

```sql
create table public.offices (
  office_id    uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete restrict,   -- null only for the system office
  kind         text not null default 'person' check (kind in ('person','sample','test','system')),
  name         text not null,
  state        text not null default 'active' check (state in ('active','disabled')),
  uses_system_integrations boolean not null default false,   -- true ONLY for the primary person office
  timezone     text not null default 'UTC',
  created_at   timestamptz not null default app.now_utc(),
  disabled_at  timestamptz,
  constraint offices_disabled_has_time check ((state = 'disabled') = (disabled_at is not null)),
  constraint offices_system_has_no_login check ((kind = 'system') = (auth_user_id is null))
);
-- kind and auth_user_id are immutable (trigger): a mis-set kind would turn Sample containment on or off for Grant.
-- exactly one 'system' office exists (unique partial index): where system jobs, system events and duties-with-no-owner live.
```

- **One auth account ↔ one office** is the `unique` on `auth_user_id`. A second binding attempt is a unique
  violation. There is no membership table because there is nothing for it to hold.
- **`office_id` is separate from the auth id on purpose.** Roughly 130,000 rows will carry the key. If an auth identity
  is ever recreated (a deleted user, a provider change), the repair is one `update` of `offices.auth_user_id`, not a
  re-key of every table. Keying every table on `auth.users.id` would tie the data's integrity to the identity
  provider's lifecycle.
- **`kind` is the classifier.** `person` is a human. `sample` is the acceptance office. `test` is an ephemeral office
  a suite creates. `system` is the one per-deployment office for work no human owns; **no session can resolve to it**
  and no `p_office` function can read it, so there is no 'job without an office' anywhere. `uses_system_integrations`
  marks the one office allowed to use the deployment's own Google/Notion/Slack/Vikunja credentials (§12). A job's containment is a join to its office, not a flag copied onto the job
  (0303/0304 is the record of what a copied flag costs).
- Product-visible vocabulary is "your office". The words *tenant*, *workspace*, *account* and *organization* do not
  appear in any user-facing string; `office_id` is the column name everywhere.

### Where `office_id` is stored

**Rule:** a table carries `office_id` only if at least one of these is true — otherwise its owner derives through a
foreign key and a second copy would be a second thing that can disagree.

1. It is a **root**: nothing above it to inherit from (`projects`, `inbound_commands`, `mail_messages`, …).
2. A person or a channel **addresses it by id from outside** (`blockers`, `deliveries`, `undoable_actions`,
   `documents`, `tasks`) — the press targets, where an attack looks like "A sends B's id".
3. It is **retrieved into a prompt** (`documents`, `outputs`, `lessons`, `skills`, `mail_messages`, `jobs`'
   conversation) — so the filter must be one indexed predicate on the table that is read.
4. It is a **credential or channel binding** (`slack_workspaces`, `subject_identities`, `telegram_chats`, …).
5. It has **no single NOT NULL path** to a carrier (a nullable `project_id`/`job_id`, or two parents).

Result (`TABLE-REVIEW-399.md`): of 129 tables, **44 carry `office_id`** (4 of them *replace* an existing text `owner`
column, so 40 are new columns; five more text-`owner` tables drop the column and derive through their project) and 85
derive it. **A table may derive only if it has a NOT NULL foreign-key path to a carrier** — measured, not assumed: six
do. `documents.project_id` and `undoable_actions.job_id` are nullable in the schema even though no row is null today, so
they carry the column. Every derived table has a foreign-key path to a carrier; that path is
listed per table.

### How the redundancy cannot disagree

A carried `office_id` beside a parent foreign key would normally be a duplicated fact. It is made structural:

```sql
alter table public.projects add constraint projects_id_office unique (project_id, office_id);
alter table public.jobs     add constraint jobs_id_office     unique (job_id, office_id);

alter table public.jobs add constraint jobs_project_same_office
  foreign key (project_id, office_id) references public.projects (project_id, office_id);
alter table public.jobs add constraint jobs_parent_same_office
  foreign key (parent_job_id, office_id) references public.jobs (job_id, office_id);
alter table public.jobs add constraint jobs_root_same_office
  foreign key (root_job_id, office_id) references public.jobs (job_id, office_id);
```

Postgres' default `MATCH SIMPLE` skips a composite foreign key when any column is null. That is exactly right here:
a job with no project (7,243 of them) is not checked against a project, while its `office_id` is still `NOT NULL`
and still references `offices`. A child whose parent is in another office, or a job pointing at another office's
project, fails with `23503` at insert — from the application, from a handler bug, from a hand-written `UPDATE`, from
the service role.

`office_id` is also made immutable by extending the trigger 0619 already uses for `root_job_id` / `origin_*`
("written once at insert"), so a retry, a resume, a recovery or an `UPDATE` cannot change the owner.

---

## 3. Authentication and account binding

### Today
`signin` (a Supabase magic-link function) issues a session; `hq-api` verifies it with Supabase
(`GET /auth/v1/user`, `hq-api:1442`), then asks `office_member(email)` and receives an `owner_key` and a `kind`. The
machine key `hq.api_token` is `kind = 'service'` with no principal (ADR-0054). `office_members` is keyed on **email**
and `owner_key` is a free string that defaults to `'grant'`.

### Proposed

```
Supabase session (JWT)
  → gateway verifies with Supabase            (unchanged; nothing decodes the JWT locally)
  → auth user id (uuid) from the verified response
  → select office_id, kind, state from offices where auth_user_id = $1
  → exactly one active row      → proceed with p_office = office_id
  → no row / disabled / 2 rows  → 403 no_office, nothing else is called
```

| Situation | Behaviour |
|---|---|
| **Signup** | There is **no self-service signup in V1.** An office is created by `app.provision_office(auth_user_id, kind, name)`, a service-role-only function run by the operator. It is idempotent on `auth_user_id`. Self-serve signup is a later, separately-reviewed feature. |
| **Office creation** | `provision_office` creates the `offices` row and seeds the per-office defaults (duty set, autonomy defaults, staff tool grants — §14) from templates, in one transaction. |
| **Email changes** | Nothing happens. The binding is on the auth id. |
| **Account disabled** | `offices.state = 'disabled'`: the gateway refuses, every adapter refuses, `dequeue_job` skips the office's jobs, deliveries are not claimed. Data is untouched. |
| **Unknown auth identity** | No `offices` row → 403. The gateway never creates one. |
| **Account row missing** for an identity that signed in before | Same: 403 `no_office`, plus an audit event naming the auth id. |
| **Duplicate binding attempted** | `unique(auth_user_id)` rejects it. The attempt is an `events` row, not a silent success. |
| **Grant's existing account** | One-time, deterministic binding in migration (§ Grant migration in `MIGRATION-PLAN.md`): his auth id ↔ a new `offices` row `kind='person'`. Every historical row is stamped only after the characterisation queries pass. |
| **Sample User** | A real auth user (an address under a domain the operator controls and that cannot receive customer mail) bound to an `offices` row `kind='sample'`. Same code path as Grant. |
| **Principal kind** | `offices.kind` maps to the gateway's principal kind: `person → person`; `sample`, `test → harness`. A *harness* principal may already run only decisions that carry `by` and are checked by `authority_refusal` ("a test principal decides only test traffic") — exactly what the Sample needs — and cannot reach any `OPERATOR_ONLY` action. |
| **`OPERATOR_ONLY` actions** | `set_setting`, `routing_set`, `bot_assign`, `staff_hire/update/retire`, `set_slack_credentials`, `disconnect`, `forget_google` (system-wide, or they delete the deployment's fixed-name credentials). Refused to every session unless the office has `uses_system_integrations`; always allowed to the machine key. Before a **second real person** exists they either get per-office versions or stay operator-only. Today `person` may do everything (`hq-api:1645`), so this is built first. |
| **The machine key** | Names **no** person and **no default office.** For calls that need an office it must say which (`x-office-id`, audited); a call that needs one and lacks it is refused. It cannot answer approvals (already true, 0614). **`hq.api_token` is rotated before enforcement**, after Grant's devices are on signed-in sessions: browsers have held it since ADR-0043, and with offices it would otherwise be a universal cross-office key. |
| **`verify-operator` (test principal)** | Bound to its own `kind='test'` office. Suites that need to act in a particular office use the machine key with an explicit office. |

`office_members` is retired once every consumer has moved (it is email-keyed, mutable, and its `owner_key` default
`'grant'` is the global fallback this design exists to remove).

### Sessions are cached; that is a bounded risk
The gateway caches a positive resolution for 60 s keyed by token (`hq-api:1362`). The cached value becomes the
`office_id`. Disabling an office therefore takes up to 60 s to bite at the gateway. Accepted and tested
(`ACCEPTANCE-PLAN.md`, test 29b); the cache key includes the token, so one user's entry can never serve another.

---

## 4. Database integrity — cross-office relationships made impossible

Each attack from the brief, and the mechanism that makes it structurally fail:

| Attack | Mechanism |
|---|---|
| A's task → B's project | `tasks(project_id, office_id) → projects(project_id, office_id)` |
| A's conversation → B's project | `inbound_commands(project_id, office_id) → projects`; a conversation is not a table, it is `office_id` + channel scope on the commands |
| A's job → B's project | `jobs_project_same_office` |
| A's child → B's parent | `jobs_parent_same_office`, `jobs_root_same_office` |
| A's question → B's job | `blockers(job_id, office_id) → jobs(job_id, office_id)` |
| A's delivery → B's question | `deliveries(blocker_id, office_id) → blockers(blocker_id, office_id)` |
| A's approval → B's job | the approval *is* a `blockers` row plus `job_plans`/`jobs_config`; the answer path derives the office from the blocker (§10) |
| A's document → B's project | `documents(project_id, office_id) → projects` |
| A's attachment → B's conversation | `project_attachments.project_id` is a plain FK to a project in one office; an attachment has no conversation column. A *file in a chat* is a `documents` row (§11) |
| A's source → B's project | `project_attachments → projects`; `documents.project_id` same-office FK |
| A's integration used by B | `slack_app_credentials`, `office_credentials`, `mcp_providers` carry `office_id`; the function that resolves a secret takes `p_office` and refuses a ref the office does not own (§12) |
| A's standing authorization used by B | `standing_authorizations(project_id, office_id) → projects`; `autonomy_for(p_office, p_project)` reads only the caller's office |

**Secondary edges are in the matrix too** (Review A, F4/F8). A composite key is only as good as the list of edges it
covers. Every foreign key between two tables with different owners-of-record gets one, or is derived through the
carrier: `jobs.origin_command_id`, `inbound_commands.job_id`, `documents.produced_by_job`,
`documents.mirrors_document_id`, `tasks.job_id`, `tasks.parent_task_id`, `branch_groups`, `job_branches`,
`consultations`. `relations(from_kind, from_id, to_kind, to_id)` has **no foreign key** on its ids; it carries
`office_id` and both endpoints are office-checked on write *and* on read, and its error text no longer says which id
does not exist (that was an existence oracle). The catalogue check enumerates every FK edge and fails on any whose two
ends resolve to different offices or to no office.

**The source of an office is never a row the caller named.** Deriving a `documents` row's office from the `project_id`
the caller supplied would make the composite key a tautology: a caller naming another office's project would silently
write into it. The office comes from the verified session, the channel identity, or a *claimed job* (a child takes its
parent's); the named project is then **checked against it** and a mismatch is `23503`.

**Uniqueness that has to stop being global.** These are unique across the whole deployment today and would turn two
offices' colliding names into either a hard error or an existence oracle (B probing whether A holds a name):

| Index | Today | Becomes |
|---|---|---|
| `projects_slug_key` | `(slug)` | `(office_id, slug)` |
| `projects_one_per_notebook` | `(notebook_ref)` | `(office_id, notebook_ref)` |
| `responsibilities_slug_key` | `(slug)` | `(office_id, slug)` |
| `project_aliases` phrase uniqueness (trigger, 0282) | global per active project | per office |
| `documents_one_per_external_ref`, `…_linked_file` | `(connector, external_*)` | `(office_id, connector, external_*)` |
| `deliveries_dedupe_key_key`, `inbound_commands_dedupe` | `(dedupe_key)` | `(office_id, dedupe_key)` |
| `jobs_one_live_per_idempotency_key` | `(idempotency_key)` | `(office_id, idempotency_key)` |
| `standing_live_globally`, `standing_live_per_project` | `(tool,…)`, `(project_id,tool,…)` | both gain `office_id` |
| `briefings_one_per_day` | `(kind, scope_ref, for_date)` | + `office_id` |
| `calendar_events` pk, `mail_messages` pk | `(calendar_id,event_id)`, `(message_id)` | + `office_id` |

A uniqueness check that crosses offices is a probe: *"that name is taken"* tells B that A has it. After the change a
duplicate within one office reports itself; across offices there is nothing to report.

---

## 5. RLS — what it is for here (decided after review)

The brief's central invariant: **A cannot read, mutate, authorize, retrieve or infer B's private state, even knowing
B's identifiers.** Where RLS can and cannot deliver that:

| Path | Role | Does RLS bound it? | What does |
|---|---|---|---|
| Browser → gateway | `service_role` | **No** (bypasses) | office from the verified session; `(p_office, id)` functions; composite FKs |
| Worker → database | `postgres` / Management API | **No** | `JobContext.officeId` from the durable job row; composite FKs |
| Slack / Telegram / voice / MCP edge functions | `service_role` | **No** | channel identity → office, then as above |
| Anyone with the anon key | `anon` | **Yes — already closed** | 0642 + `check:anon-exposure` |

Layers, strongest first: (1) **structural** — composite FKs and immutable `office_id`, true for every writer including
the service role; (2) **functional** — required `(p_office, id)` with no default; (3) **RLS** — a tripwire.

**V1 RLS decision (what #399 gets).** Every one of the 129 tables has RLS on. The 46 that lack it get
`to ai_team_app using (true)` — the same shape as the other 83 — so the eleven verify suites that `set local role
ai_team_app` keep working. **No policy and no grant for `anon` or `authenticated`, ever.**

**What was considered and not built:** office policies (`office_id = app.current_office()`), a transaction-local
setting set by `app.act_as`, and an RLS layer in the isolation suite. They were dropped because (a) nothing connects as
a non-bypass role, so they would protect no live path; (b) any session that can run SQL can `set_config` a custom
setting, so a policy keyed on it is spoofable by exactly the roles it is meant to bound; (c) they cost ~56 policies and
a phase. `TABLE-REVIEW-399.md` records the *future policy shape* per table (`SC`/`SO`) so that if a login role is ever
introduced the design exists — and the carried `office_id` is what such a policy would key on.

## 6. Gateway and functions

### Gateway
Today `by`/`personBy` are injected and any client-supplied value is deleted first (`hq-api:1676-1688`). Proposed: the
same for the office, **and the same discipline for every path that does not go through the generic injection** — the
gateway has hand-built paths that read the Vault, write storage, or call RPCs directly (`drive`, `googleAccess`,
`contact_photo`, `document_upload`, `machine_project_ok`, `voice`, `mcp`), which Review A showed are outside the "152
functions" and outside any signature check.

- The client never supplies `p_office`; the gateway deletes any `p_office` / `office_id` / `owner_key` / `x-office-id`
  from the request and writes the one it resolved.
- **Ownership is checked before any side effect.** `contact_photo` today PUTs to storage at a client-chosen
  `<projectId>/…` path with `x-upsert` and calls the database afterwards; the order reverses, and storage paths are
  `<office_id>/…`.
- A miss and a foreign id return the **same body and the same status** (Review A, F14): the function refuses before a
  foreign key can, so a `23503` never surfaces as a different HTTP status.
- `OPERATOR_ONLY` actions and the `kind → principal` mapping are in §3.

### Functions — two families, not three
| Family | Receives | Rule |
|---|---|---|
| **Caller-reachable** (gateway, MCP, channels) | any id, or nothing | `p_office` first, **required, no default**; `where id = $1 and office_id = p_office`; listing functions filter every `from` by it |
| **Internal-only** (callable only by the worker/SQL with a claimed job) | a `job_id` or `command_id` the caller already holds | may derive the office from that row — **only** if no external caller can reach it with an arbitrary id (Review A, F3: `mcp_job_status(uuid)` reads any job's output, so "derive from the job" is a leak whenever the caller chooses the job) |

The size of the converted set is **derived, not estimated**: a transitive call-graph query from the gateway map, the
inline gateway paths, `supabase/functions/*`, the adapters and the worker's `app.*` calls. Of the gateway's 152
functions, 92 are id-taking and 60 are whole-office listings; `mcp_*` (including `mcp_job_status`, `mcp_search`,
`mcp_enqueue`) and the **12 job-inserting functions** are in the set (see MIGRATION-PLAN M9.1).

`check:office-scoped` (in the gate): for every function in the derived set it fails unless it has a required `p_office`
with no default, or is internal-only with a stated reason, or is on a reasoned system list. A second, small check
(`check:office-catalogue`) asserts the structural facts in one place: every carrier has `NOT NULL office_id` and an
immutability trigger; every FK edge in §4 exists; no unique index on a carrier omits `office_id`. Each has a positive
control (a planted unscoped function; a dropped constraint in a rolled-back transaction). A narrow
`check:office-scope` ratchet covers **inline paths in the edge functions**; it is deliberately not applied to the 502
`execute(` sites in `src/`, where `JobContext`, composite FKs and the suite are the protection.

### Views
The 14 views run as their owner. Each is rewritten as a function with `p_office` or given an `office_id` column and
consumed only by functions that filter on it. `needs_me` has eight consumers (CLAUDE.md); all eight convert.

## 7. Service role, workers, and "elevated access ≠ user authority"

The worker is one process serving every office. That is fine; its **authority is never ambient**.

**Rule:** every database call made on behalf of a job carries the job's office, obtained **from the durable row**:

```ts
// src/jobs/context.ts (proposed)
declare const officeBrand: unique symbol
export type OfficeId = string & { readonly [officeBrand]: true }
export interface JobContext { readonly jobId: string; readonly officeId: OfficeId; /* … */ }
// OfficeId is constructible ONLY from a database row (dequeue / officeOfJob). There is no process-level 'current user'.
```

| Stage | How the office is held |
|---|---|
| **Enqueue** (`enqueue_inbound`) | office comes from the resolved channel identity (§13); written to `inbound_commands.office_id` and `jobs.office_id` in one statement. Never from the payload. |
| **Claim** (`dequeue_job`) | returns `office_id` with the row; joins `offices` and skips disabled ones. A claim scoped by `p_requested_by` stays for suites. |
| **Run** | `JobContext.officeId`; every repository call takes it. Retrieval functions require it in their signature. |
| **Child / grandchild** (`enqueue_child`, `enqueue_child_once`) | `office_id` copied from the parent; **`p_project` is validated against it** (today `coalesce(p_project, parent.project_id)` accepts any project — a present weakness, see THREAT-MODEL E3). The composite FK makes a wrong one fail regardless. |
| **Retry / recover** | same row; `office_id` immutable. `recover_stalled_jobs` is global by design and touches only state. |
| **Pause / resume / defer** | same row. `resume_job(p_job, p_why)` gains the caller's office check where a person triggers it. |
| **Scheduled duty** (`dispatch_due_responsibilities`) | `responsibilities.office_id` → the job it creates. A duty belongs to an office; a *system* job (backup, health, recovery) belongs to the **`system` office** — `office_id` is `NOT NULL` for every job — and cannot read any office's tables because no `p_office` function accepts that office. There are **12** job-creating SQL functions, not five; all stamp the office (MIGRATION-PLAN M9.1), and the scripts that insert jobs directly (`replay.ts`, `office/ask.ts`, `verify/context.ts`) pass one. |
| **Failure / cancel** | state transitions only; the apology owed (`app.owed_a_word`) goes to the originating office's channel. |

**Why an argument and not a Postgres session variable?** The Management API executor is stateless (each call is its
own transaction and a multi-statement call returns the *first* statement's result — CLAUDE.md), a pooled direct
connection shared between jobs would make 'current user' process-global state, and any session can `set_config` a
custom setting. An explicit argument is stateless, greppable, type-checked, and not spoofable by the thing it bounds.

**The residual risk is raw SQL in handlers** (502 `execute(` calls; ~244 raw references to owned tables). Mitigation,
in order of strength: (1) composite FKs make cross-office *writes* fail; (2) `check:office-scope` is a ratchet over
`src/` — a statement that names an owned table must reference `office_id`, a `JobContext`-derived key, or carry a
reasoned exemption, and the baseline may only shrink (same mechanism as `check:callers`); (3) the isolation suite runs
every handler path against two offices with colliding content. (1) and (3) are mechanical; (2) is a review aid, and
the plan says so.

---

## 8. Claire and the specialists

`staff` is 8 shared rows; `staff_prompts` is versioned product text. They are *identities, not state* and stay global
(§ADR-0060). What makes "Claire" yours is everything she reads and writes, and all of it is office-owned: `lessons`,
`skills`, `project_staff`, `staff_tools`, `routing_decisions` (via job), `consultations` (via job), `outputs`.

A chain `A → Claire → specialist → child → result` is a tree of `jobs` rows sharing one `office_id` by composite FK.
It cannot intersect B's chain because no foreign key in it can reach B's rows. `staff_tools` — the per-person tool
grants Grant edits on the Team page — is account state and gets `office_id`; a second user's Claire must not inherit
Grant's grants. `provision_office` seeds the default set.

---

## 9. Many projects per user

`projects.office_id` plus `unique (office_id, slug)`. Account-wide behaviour is intentional and enumerated; everything
else is project-scoped:

| Account-wide on purpose | Project-scoped |
|---|---|
| project list, portfolio tasks (`my_tasks`), calendar, mail, briefings, `lessons` with `project_id is null`, `autonomy_settings` with null project, duties with null project, `staff_tools` | tasks in a project, chat in a project, documents, delegation, approvals, browser sessions, Slack channel, attachments |

The current-project state (`project_switches`, `current_project(scope, chat)`) takes the office, so a chat identifier
chosen by a client cannot collide with another office's scope. A project switch is a row in the *same* office or it
does not insert. Same-office cross-project retrieval is §10.

---

## 10. Retrieval and model context

Filtering happens **in the SQL that fetches rows**, so another office's text is never selected, let alone sent to a
model. There is no vector index to worry about, and none may be added without an `office_id` predicate in the same
query.

| Reader (today) | Today's scope key | Proposed |
|---|---|---|
| `app.search_documents(query, project, limit, match)` | project; **null = every project in the deployment** | `p_office` required; null project = every project **of that office** |
| `retrieve()` (`src/knowledge/retrieval.ts`) | project (substitutes `unnamed_project()` for null) | takes `JobContext`; passes the office |
| `app.sibling_projects`, `app.projects_named_in` (0644) | "every active non-fixture project except the asker" | `p_office` required; siblings are the office's projects. **This is the one seam the settled policy ("same-user cross-project expansion with provenance") needs.** |
| `app.mail_for_project` | project; `mail_messages` has no owner | `mail_messages.office_id`; `p_office` required |
| `app.project_knowledge` | project | project is office-checked |
| `app.conversation_before(command)` | `origin_channel + chat + coalesce(subject, actor)` | adds `office_id = command.office_id` |
| `app.lessons_for(project, staff, kind, limit)` | scope only; `global` reaches every prompt | `lessons.office_id`; `p_office` required |
| `guidanceFor`, `capabilityBrief` | built from the above | consume only office-scoped inputs |
| Notebook / Drive | via `project_attachments` | project is office-checked; credentials per office (§12) |
| Caches | none found in `src/` (module-scope Maps are constants; gateway/voice token caches are keyed by token) | none may be added keyed by project name or alias |

Rules that follow:

- **Provenance is preserved.** Hits already carry `scope` (`this_project`, `other_project`, `account`) and
  `whereFrom`. Multi-user adds an absolute floor under that: the candidate set is the office's.
- **`app.unnamed_project()` is a global singleton** (`select project_id from projects where slug='unnamed'`, 0334) and
  `inbound_commands.project_id` is `NOT NULL` defaulting to it. It becomes `unnamed_project(p_office)`: one reserved
  project per office, created by `provision_office`. Without that, a second office's commands would fail the composite
  key (or, with per-office slugs, the function would return an arbitrary office's row).
- **Identical names do not collide.** Alias lookup (`app.resolve_project_by_name`) and the alias uniqueness trigger
  become per-office, so "Venue" in two offices resolves to two projects, each only for its own office.
- **Never** `retrieve globally → post-filter`. The isolation suite includes a test that fails if any retrieval
  function is callable without an office (ACCEPTANCE-PLAN 30).

---

## 11. Approvals, authority, and the seven settled policies

An approval is a `blockers` row answered through `app.hq_answer_blocker(p_blocker_id, p_answer, p_by)` (0632). Today
it checks that `p_by` is a *known* person and a test principal only decides test traffic (0614). **It does not check
that the answerer owns the blocker** — with one office that was vacuous; with two it is the central gap.

Proposed: `hq_answer_blocker(p_office, p_blocker_id, p_answer, p_by)` locks the row with
`where blocker_id = $1 and office_id = p_office`; a foreign id returns `not_found`. The same shape for: press a
delivery, undo an action, resume a job, answer a plan step, grant or revoke a standing authorization, set autonomy.

Standing authorizations and autonomy: `office_id` on `standing_authorizations` and `autonomy_settings`;
`autonomy_for(p_office, p_project)`. `project_id is null` now means *office-global*, never deployment-global. Both
partial unique indexes gain `office_id`.

**The seven settled policies are preserved unchanged** — the change only narrows where each reads:

| Policy (ADR-0059) | Effect of multi-user |
|---|---|
| Vikunja create/update by connection, delete by exact question | the connection is the office's (§12); the question is the office's blocker |
| Slack project provenance | `slack_channel_map` carries the office; a channel resolves only within it |
| Notion destination-scoped authority | a database yes lives on the office's `standing_authorizations` |
| Slack rotation asks every time | the question goes to the owning office |
| Learning ≠ authority | `lessons.office_id`; `skills` cannot create a standing authorization (unchanged) |
| Project-first retrieval | unchanged; the floor under it is the office |
| Proactive work ≠ unlimited authority | `autonomy_for` per office; `autonomy_policy` (the matrix and its level-3 floor CHECK) stays global |

`autonomy_policy` deliberately **stays one global matrix**. Per-office matrices would let an office edit its own
safety floor; the CHECK `(action_level < 3 or verdict <> 'proceed')` must remain unreachable from user data.

---

## 12. Integrations and credentials

**Rule:** a credential is stored once in the Vault and referenced by `uuid`; fixed Vault *names* survive only for
system secrets. Today the second pattern is the common one and it makes every integration a deployment singleton.

| Integration | Class | Today | Proposed |
|---|---|---|---|
| LLM providers (OpenRouter), model catalogue, CI minutes, OpenAI key for realtime/TTS | **system** | `providers.secret_ref`, fixed names | stays system; per-office *attribution* (not credentials) through the job's office |
| Slack | **account** | `slack_app_credentials` (refs) **plus** fixed names `slack.bot_token` etc. and env `SLACK_SIGNING_SECRET` | row carries `office_id`; code reads only the row's refs; fixed names removed. One Slack app installation per office |
| Telegram | **mixed** | 8 shared bots (`telegram_bots`) + a global webhook secret; chats free-text `subject` | bots stay **system** (infrastructure); the **chat** is the identity: `telegram_chats.office_id`. A bot can serve many offices |
| Google (Gmail, Calendar, Drive) | **account** | fixed names `google.refresh_token` etc.; one mailbox; `mail_messages`/`calendar_events` ownerless | `office_credentials` slot per office; rows carry `office_id`; the OAuth *client* (`google.client_id/secret`) stays system |
| NotebookLM | **account** | fixed `notebook.storage_state` (one browser login state) | `office_credentials`; probes/budgets per office |
| Notion | **account/project** | fixed `notion.integration_token` | `office_credentials`; the database is the project's attachment |
| Vikunja / tasks | **account** | fixed `vikunja.api_token`; URL in `system_config` | `office_credentials`; URL becomes an office setting |
| GitHub / CI | **system** | fixed names | stays system (one repo, one cost ceiling) |
| MCP inbound clients | **account** | `mcp_clients.token_sha256`, no owner | `mcp_clients.office_id`; a token is one office; OAuth codes bind at consent |
| MCP outbound providers | **account** | `mcp_providers.credential_ref` | `office_id` on the row |
| Browser sessions | **project** | `browser_sessions.credential_ref` (best existing model) | office via project |

`office_credentials(office_id, service, slot, secret_ref, state, …)` with `unique (office_id, service, slot)` is the
one new table; `app.office_secret(p_office, service, slot)` is its only reader and refuses a ref whose row is not the
office's. B connecting a provider writes a **new** row under B's office; there is no code path that names A's row, so
B cannot see, use, overwrite or inherit A's credential, and a standing authorization (A's `office_id`) is never
consulted for B.

**The guard that cannot wait (Review A, F1 — verified).** Today `GET ?section=drive` reads the deployment's Google
refresh token by its fixed Vault name and browses Drive for *any* signed-in session or the machine key; the worker reads
the same token. `connection_health` showing Sample as "not connected" is a **display row**, not a control. So one
resolver (`app.system_secret(p_office, name)`) fronts **every** fixed-name secret read — Google, Notion, Vikunja,
NotebookLM, the Slack fixed names, the GitHub read token — and refuses unless the office has
`uses_system_integrations`. Per-office *credential rows* (`office_credentials`) remain deferred to before a second
real human connects a provider; the guard ships in Phase 1, before any second office exists, and has its own attack and
sabotage.

---

## 13. Slack

Today: HMAC verification → `slack_team_ok(team_id)` (0630: the event is from the installed workspace) →
`sender_admitted('slack', user)` via `subject_identities`. A stranger gets 200 and nothing stored. Project comes from
`slack_channel_map`, else the conversation's remembered project, else **the most recently updated active project,
globally** (0341).

Proposed resolution:

```
event → verify signature (unchanged)
      → team_id → slack_workspaces.office_id          (must exist and be active; else drop)
      → slack user → subject_identities(slack, user).office_id
      → the two offices must be EQUAL; else drop + audit (a sender from another office's workspace)
      → inbound_commands.office_id := that office
```

- The "newest active project" fallback becomes "newest active project **of that office**".
- Bot/harness restrictions (`sender_admitted`, forwarded-content rules, `operator_senders`) are unchanged.
- Lifecycle events (`tokens_revoked`, `app_uninstalled`) are today applied by signature alone to the envelope's team
  (THREAT-MODEL E4); they gain the same workspace check.
- **One shared Slack app in V1.** A single `SLACK_SIGNING_SECRET` cannot verify "one app per office"; the app is shared,
  a *workspace* maps to one office, and a second real human installs the same app in their workspace.
- **Onboarding a second user** is operator-driven in V1: install the app to their workspace → a
  `slack_workspaces` row with their `office_id` → a `subject_identities` row for their Slack user. A self-serve
  "connect Slack" flow is a later phase and must call the same two writes under their session.

## 14. Telegram

Today: one global webhook secret; `?bot=` selects a bot; `sender_admitted('telegram', from.id, chat.id)`; the chat's
`subject` is `subject_for('telegram', chat_id)` for private chats. `telegram_chat_for(subject, bot)` picks the newest
deliverable chat where `subject = p_subject OR subject IS NULL` — **a chat with no subject matches any requester.**
The word `grant` is hard-coded in at least seven places (`pager.ts:86`, `vault-export.ts:61`,
`progress.ts:101,329`, `preference-store.ts:45,146`, `telegram-webhook:501`) and the config key is literally
`telegram.direct_to_grant`.

Proposed: `subject_identities(telegram, user_id).office_id` is the only mapping; `telegram_chats.office_id` is null
until bound and a null chat is **never** deliverable; `telegram_chat_for(p_office, p_subject, p_bot)` has no
`or subject is null` branch; each hard-coded `'grant'` is replaced by the requester carried on the job/output;
`telegram.direct_to_grant` and `telegram.only_chief_speaks` become per-office settings (§15). Bots stay shared
infrastructure.

**Only private chats are deliverable** for any office except the primary's existing office group, which the operator
binds explicitly (Review A, F13): a group registers with a null subject, so bind-on-first-sight would let the first
admitted sender claim it, and a group's audience is not an office — another office's member could read replies and press
inline-approval callbacks.

**Connecting Telegram is optional and operator-provisioned in V1.** ADR-0043/0581 removed the pairing ceremony
because it was an *office-token* interaction; an identity link is a different thing but it is also not needed to
reach acceptance. The Sample User does not use Telegram. The self-serve link (a one-time code minted under the
signed-in session, redeemed by the webhook) is specified here so it can be built later without redesign: the code
row carries the `office_id` it was minted for, so the redeeming chat can only bind to that office.

## 15. Configuration that is secretly per-person

`system_config` holds 69 keys. Characterised by name:

- **System, stays:** `agents.*`, `jobs.*`, `delivery.*`, `providers.breaker`, `backup.*`, `ci.*`, `db.*`, `vault.naming`,
  `web.base_url`, `voice.api_*`, `voice.writing_model`, `voice.transcription`, `worker.paused_until`, `google.client_id`,
  `google.redirect_uri`, `google.scopes`, `github.*`, `knowledge.*`, `budget.*` (deployment cost control).
- **Per-person, moves to `office_settings(office_id, key, value)`:** `grant.timezone`, `telegram.direct_to_grant`,
  `telegram.only_chief_speaks`, `telegram.pager_floor`, `slack.subject_user_id`, `calendar.*`, `gmail.enabled`,
  `google.granted_scopes`, `notebook.*`, `notion.*`, `conversation.max_turns`, `conversation.window_minutes`,
  `ui.needs_me_cap`, `routing.unnamed_when_unresolved`, `approval.refusal_days`.
- **Deferred to before a second real human** (Review B, T2). V1 adds only `offices.timezone` and a name. The Sample
  does not use Telegram or Slack, and the tuning knobs (`conversation.*`, `ui.*`, `approval.*`) are not private data. When
  `office_settings` is built it is read through one function with a **system default** (absence = the system value), so
  adding it changes nothing until a key is set. Before then, the values of `calendar.*`, `notion.*` and
  `slack.subject_user_id` must be read once (they were not, in this research) to confirm none holds an id or address.

## 16. Files and attachments — data, not authority

A file is a `documents` row (`office_id`, `project_id`) plus bytes in storage. Ownership is set at upload from the
verified office and the project is validated against it (`document_upload` takes a client-supplied `p_project_id` and
today only checks `is_fixture` for a harness). Extraction, indexing (`search` tsvector), chat context and delegation
all read `documents`/`outputs` through the retrieval functions of §10. Text from a file never becomes an instruction:
that is the settled "files ≠ authority" rule and it is unchanged — `UNTRUSTED_CONNECTORS` fencing still applies, and
a forwarded or attached message cannot bind a project, a rule or an approval. Storage object paths are prefixed
`<office_id>/…`; signed URLs are issued only after the same office check as the row.

## 17. Voice — two separate features

**A. Voice note** (microphone → audio → transcription → chat message → interpretation → job). Today `voice/index.ts`
`/note` authenticates a person JWT or the machine key and **returns only the words**; nothing is stored. The identity
step is the later `say`/`/voice` turn. Defect: every person JWT maps to the single env value
`VOICE_SUBJECT = 'grant'` (`voice/index.ts:54`), ignoring the member's own key. Proposed: the actor is the verified
office's subject; the turn's `inbound_commands.office_id` is the verified office. The Telegram voice note is a
different path (webhook stores `file_id`, the worker transcribes) and takes its office from the chat identity (§14).

**B. Realtime voice** (live conversation). Today `voice-token` mints an OpenAI realtime client secret with **no
authentication** (its own header says so), embeds the **global** `voice_state()` brief and a client-chosen project
slug in the session instructions, and binds no server-side session. The session id used by turns is page-generated
and global. This is a present weakness (THREAT-MODEL E1), independent of multi-user, and it is the single most
important thing to fix *before* a second office exists.

Proposed (simplified after review): `voice-token` requires the session JWT, resolves the office, and builds the session
`instructions` from `voice_state(p_office)` and `voice_lookup(p_office, slug)`; the persona names the office's owner.
**No `voice_sessions` table.** Every `/voice` turn already requires a signed-in person, so the office is taken from the
JWT on each turn and the conversation key is `(office, session)`; the dedupe key is unique per office. A foreign or
guessed session id presented with my JWT lands in *my* office and conversation — the attack that mattered (using
someone else's session) is closed without a table.

The two features share nothing but the transcription provider (system-level).

## 18. What was deliberately not built

| Not built | Why it is unnecessary here |
|---|---|
| Organizations, workspaces, tenant switching | one human = one office; nobody switches |
| Memberships / `user_office` many-to-many | the only relation is `unique(auth_user_id)` on `offices` |
| Roles (owner/admin/member) | one human per office; the *operator* is not a role in the data, they are the service key |
| Invitations | offices are provisioned by the operator in V1 |
| Per-office safety matrix | would let a user edit the level-3 floor |
| Per-office model providers | the LLM key and cost are deployment-level |
| Direct-from-browser PostgREST + `authenticated` policies | the browser uses the gateway; adding it would reopen what 0642 closed |
| A separate database per office | defeats the free tier (500 MB) and adds nothing the composite FKs do not give |

## 19. Related documents

| | |
|---|---|
| `ADR` | `docs/adr/0060-one-account-one-private-office.md` |
| Legacy evidence | `LEGACY-BRANCH-REVIEW.md` |
| Ownership graph | `OWNERSHIP-GRAPH.md` |
| #399 table review | `TABLE-REVIEW-399.md` |
| Threats and existing weaknesses | `THREAT-MODEL.md` |
| Sample office | `SAMPLE-ACCOUNT-DESIGN.md` |
| Isolation tests and sabotage | `ACCEPTANCE-PLAN.md` |
| Migrations and Grant's backfill | `MIGRATION-PLAN.md` |
| Phases | `IMPLEMENTATION-PLAN.md` |
| Adversarial reviews | `REVIEWS.md` |
