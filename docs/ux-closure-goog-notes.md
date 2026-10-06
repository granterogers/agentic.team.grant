# UX closure: Google multi-account future-proofing (HQ-GOOG-003) and conversational style saving (HQ-STYLE-018)

Branch `claude/ux-closure-goog`. Migrations **1000** and **1001** are written and UNAPPLIED (proved on the replica
`cand_goog2` only). Nothing here touched production.

## Task A - a Google credential is one connection of an office

### The model

office (tenant) -> integration connection(s) -> provider (`google`) -> provider account identity (`account_ref`) -> scopes.

V1 still allows **one active Google account per office** and builds **no multi-account UI**. What changed is that the
limit is now a constraint on rows instead of an accident of there being one vault name.

### What changed (migration `1000_a_google_credential_is_one_connection_of_an_office.sql`)

- `public.integration_connections` (office_id, provider, account_ref, state active|unverified|dead|revoked, scopes[], secret_name,
  created_at, revoked_at). `secret_name` is the NAME of the vault secret, never the secret. RLS on, every API role
  revoked, `office_id` write-once (`a1_office_write_once`), unique (office, provider, account_ref).
- The V1 rule: partial unique index `integration_connections_one_active_per_provider` on (office, provider) where
  state = 'active', plus trigger `b1_one_active_connection` that refuses in words ("an office has at most one active
  google connection in this version: revoke the current one before connecting another account"). The same account
  re-inserted is not a "second" one (it resolves to an update through the unique key).
- The resolver: `app.active_connection(office, provider)` and `app.active_connection_secret(office, provider)`.
- `app.google_vault_name(office, base)` now asks the resolver for the live refresh token and falls back to the 0800 name
  rule (kept as `app.google_legacy_vault_name`) when the office has no connection row. The parked (revoking) name is
  unchanged. Every existing reader reaches the credential through that function (`app.deployment_credential`,
  `credentialSql`, `googleAccess`, store, revoke), so **no TypeScript changed and every call site works untouched**.
- The three writers record the connection (spliced from their live definitions, each splice asserted): 
  `hq_store_google_refresh` upserts it active (a reconnect reactivates its own row), `google_revoke_begin` and
  `google_revoke_finish` mark it revoked.
- Backfill: one connection per office whose legacy-named Google secret exists in the vault (scopes carried over from
  `google.granted_scopes` for the home office). Inserts nothing on a database with no Google credential. The secret is not
  renamed or copied. **Corrected 6 Oct 2026, before the migration was applied:** the first draft marked every one `active`,
  which would have recorded a revoked token as healthy. The state now comes only from the office's own durable
  `connection_health` row (never Google, never the vault value): a fresh `ok` is `active`; `dead` naming `invalid_grant` is
  `revoked`; any other `dead` is `dead`; a stale `ok`, `missing`, `unknown`, `parked`, `attested` or no row is `unverified`.
  Only `active` resolves. A trigger then moves the connection with the credential's recorded health (ok promotes
  unverified/dead, never revoked and never a second active; dead demotes active). The table states are therefore
  `active | unverified | dead | revoked`. Proof: `scripts/isolated/google-connection-backfill.ts` and
  `tests/migrations/migration-1000-backfill.test.ts`.
- Ownership manifest: `integration_connections` is `OFFICE_CARRIER`. `scripts/check-ownership.ts --replica` reports only
  the three tables other branches added (`calendar_event_projects`, `project_events`, `style_profiles`), none of them mine.

### Proof: `scripts/isolated/google-connections.ts` (rolled back, 37 checks)

Backfill preserves the credential and is idempotent and empty-safe; the existing call returns the same credential
before and after; a second ACTIVE connection is refused with the rule's own words, and with the trigger removed the
index still refuses; revoke then a new account works and the old row is kept as history; reconnect through the real
store function reactivates the same row; sign-out revokes the connection; another office neither sees nor resolves it;
the table is closed to anon/authenticated/service_role. **Sabotage:** dropping the trigger and the index turns "a second
ACTIVE connection is refused" red.

### Next step for real multi-account (not built)

1. Read the account's identity at consent (add `openid email` or call userinfo) and store it as `account_ref` instead of
   `'primary'`.
2. An OAuth account chooser and a Connections-page list of accounts per office.
3. Per-service account selection (which account Calendar reads, which Mail reads): a `connection_id` on the readers or a
   service->connection map, with the resolver taking it.
4. Delete `b1_one_active_connection` and the partial index; add the new per-account vault names to
   `app.credential_class`. `connection_health` (keyed office, service, credential) and `system_config`
   (`google.granted_scopes`) are still per office/deployment, which 0800 already lists as the other blockers.

## Task B - saying "use this report's style for this project"

### Design: one door, a new way to reach it

There is **no second style-saving implementation**. The worker's only caller of `app.style_adopt_from_document` is
`src/style/adopt.ts`. The viewer button reaches it through the gateway (channel `teamhq`); the conversation reaches it
from there with the channel the message came in on.

- `src/agents/style-keep.ts`: `styleKeepRequest(HumanWords)` (the recogniser) and `chooseStyleSource` (which report).
  Reached only through `entitled.keepStyle` (so a forwarded message is silent via `noneEntitled`, and the model's
  paraphrase does not compile as an argument). It needs a keep/use verb, a style word and a SOURCE the person points at
  (this/that/a named report), and for "use/make/set" the project or the future as well. Negation, change, comparison,
  "new style" and questions are refused.
- `src/handlers/style-keep.ts`: resolves the report, calls the shared function without confirmation, composes the reply
  in code. `instruction.ts` calls it before the teaching reader (so "use it for future reports in this project" is not
  stored as a permanent rule) and never on a branch.
- Reference resolution (`app.style_source_candidates`, migration **1001**): made PDF heads of the project, those
  produced in this conversation first (same channel, chat, person, last day, and every job those turns started). One in
  the thread -> used. Several -> ASKED, listing them. None in the thread: the only report the project has, else ASKED.
  A name ("the pricing report's style") narrows; several matches are asked, none is said. A report with no recorded
  style (made before 0970) gets the function's own honest sentence and nothing changes.
- Replacing an existing style: the function refuses without `p_confirm`; the conversation relays that as a question
  (`raiseBlocker`, options "Yes, replace the project style" / "No, keep the current style", reply bound with
  `asksBlocker`). Only the YES starts the `style.adopt` job (`blockers.on_answer`), which calls the same function with
  `confirm: true`. Silence or no replaces nothing.
- Registry: `tool_permissions.style.save`, level 1, enabled, `delivered_by` names `style.adopt`
  (`src/handlers/style-adopt.ts`) and the conversation's call of `app.style_adopt_from_document`; granted to everyone
  who holds `db.read` (0565's pattern). It carries NO verbs on purpose: the capability brief is 3960 characters before
  this row and 3987 after, against the 4000 `verify:capability` asserts (one verb line cost 89 and crossed it).
- `style.adopt` is registered in `src/office/pass.ts` and contained as `internal` in `src/jobs/containment.ts`.

### Proof

`tests/agents/style-keep.test.ts` (49: positives, 23 negative controls, hint, onlyThat, chooser),
`tests/handlers/style-keep.test.ts` (call recording), `tests/style/adopt-is-one-door.test.ts` (one caller, no other
`style_profiles` writer, wired expressions), forwarded-silence tests extended.
`scripts/isolated/style-keep.ts` (rolled back) drives the real `office.instruction` handler and the real `style.adopt`
handler with a recording executor: this-report, existing style asks and keeps it on silence and on no, YES performs it
through the job, ambiguous asks, no-snapshot is honest, no reports, three negative sentences, forwarded, registry.
Sabotages that turned it red: confirming on the first call; choosing silently among several.

### Not done / limits

- A spoken "yes" binds to the question only where the existing rule lets it (the message that asked it is identifiable,
  as on Telegram or Slack by replying); on the dashboard chat the buttons answer it. That is the existing
  `open_questions_for_reply` behaviour and was not changed; the proof asserts it never replaces without a real answer.
- "Use this style for project X" naming a different project is not parsed: the style is saved for the project the
  conversation is in.
- `npm run check:capabilities` needs production; reasoned from source instead: the conversation enqueues no new kind
  through `app.enqueue_child` (the YES path uses `blockers.on_answer`), and the new kind is named by an enabled row anyway.
- Migrations 1000/1001 are unapplied; apply them before deploying the worker. A worker deployed before 1001 does not fail the
  turn: the reader's error is caught and the reply says nothing was saved (unit-tested).
