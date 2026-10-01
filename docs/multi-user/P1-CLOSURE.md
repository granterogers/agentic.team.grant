# Multi-user P0 + P1 — security closure

Branch `claude/multi-user-p0-p1`, cut from the research tip (`origin/main` `41de1965` plus docs-only commits). Migrations
**0647–0652** applied to production, in order, each after the code that makes it safe. No `offices` table, no backfill,
no second real office, no P2 or P3 work. The original audit stays closed.

Everything below was measured on 1 October 2026. Where a number is a count of rows in production it was read-only.

---

## 1. What changed

| Area | Change | Where |
|---|---|---|
| **Voice** (E1, E2) | `voice-token` authenticates before it reads any state, spends any OpenAI call, or says whether voice is configured. `voice` speaks a signed-in person as **their own** `owner_key` — there is no `VOICE_SUBJECT`. One shared verifier for both. | `src/auth/speaker.ts`, `supabase/functions/voice*/index.ts`, `scripts/deploy/lib/bundle.ts` |
| **Operator-only** (E14, E13) | 22 deployment-wide actions (21 + the Google connect start) and the Drive browse need a person who is also a deployment operator, asked of the database by owner key. | `0647`, `hq-api` `OPERATOR_ONLY` |
| **Fixed-name credentials** (E13, B) | One reader, `app.deployment_credential`, serves human-integration secrets to an operator or to work the deployment owns. The old name-only reader is retired. The Google connect flow now needs a one-time state. | `0648`, `0649`, `0651`, `src/credentials/`, `google-oauth` |
| **Storage ordering** (E16) | `hq_upload_target` is asked before any object is written; the path is built from the row it returns. | `0650`, `hq-api` |
| **No ambient Grant** (E18) | `office_members.owner_key` has no default; shape, reserved names and one-person-per-key are constraints. | `0652` |
| **Machine key** | `check:machine-key` pins every place the key can still reach a function that defaults its person. | `scripts/check-machine-key.ts` |
| **Ownership manifest** (P0) | 131 tables, each classified; a derived table proves its owner through a `NOT NULL` foreign key. | `docs/multi-user/ownership-manifest.json`, `src/ownership/`, `npm run check:ownership` |

New gate entries: `check:ownership`, `check:system-secrets`, `check:machine-key`.

---

## 2. P0 measurements

**Baseline.** `origin/main` `41de1965`, migrations through 0646. Production, the replica and the repository agreed on the
catalogue the manifest was built against.

**Ownership manifest.** 131 tables (129 at the research baseline + `deployment_operators` + `google_oauth_states`, both
added by this closure and both `SYSTEM`):

| Class | Tables |
|---|---|
| OFFICE_CARRIER | **52** |
| OFFICE_DERIVED | **45** |
| GLOBAL | 14 |
| SYSTEM | 20 |

The checker (`validate`) refuses: an unclassified table, a manifest entry for a table that does not exist, a derivation
through a column that is **nullable in the schema** (`attnotnull`, never "the rows happen to be non-null"), a derivation
cycle, a derivation whose parent is not owned, a GLOBAL/SYSTEM table without a reason or with a `NOT NULL` link into an
owned table, a carrier that could derive without saying a caller selects its parent, and an owned-to-owned foreign key
nobody acknowledged. Five synthetic defects are injected on every run and each must be caught, counting only problems the
defect *added*.

**Composite-FK spike** (`scripts/isolated/ownership-composite-fk.ts`, on a throwaway clone, as `service_role` and as a
non-superuser `BYPASSRLS` stand-in for the worker's role): **39/39**. Projectless jobs (7,243 real ones) pass under
`MATCH SIMPLE`; cross-office links are refused on every difficult edge, by constraint name; a table that *derives* from a
caller-named parent accepts the attack silently while the same table *carrying* the owner refuses it; a polymorphic edge is
closed only by a trigger; `VALIDATE` refuses a backfill with a planted inconsistency; `office_id` is write-once; neither
role can disable FK enforcement with `session_replication_role`. Two sabotages (drop `jobs_parent_same_office`; drop
`documents_project_same_office`) turn the named attacks red.

> **A mistake of mine, recorded.** I ran this spike once against the shared replica `post` instead of a clone. It adds
> columns; nine tables were left changed. The replica was rebuilt from migrations, and the spike now **refuses any
> database not named `fk_spike*`**.

**Legacy overload / default inventory** (production catalogue, `app` + `public`):

| Measure | Value |
|---|---|
| functions | 878 |
| names with more than one signature | **1** (`app.say_once`, the deliberate 0589 arity) |
| `public` functions with a `DEFAULT` parameter | 137 |
| `public` wrappers with an `app` implementation of the same name | 266 |
| distinct functions the gateway calls | 153 — of which **75 with defaults** and **144 with an `app` implementation** |
| functions with a parameter defaulting to `'grant'` or `'chief-of-staff'` | **47** |

The 47 are the ambient-Grant surface. Two are reachable by the machine key (§6). The ownership phase replaces each with a
required office parameter.

**Job creators.** Twelve functions insert into `public.jobs`: `answer_generation_approval`,
`dispatch_due_responsibilities`, `enqueue_child`, `enqueue_child_once`, `enqueue_inbound`, `fire_triggers_for`,
`google_revoke_begin`, `hq_rename_project`, `mcp_enqueue`, `notice_new_document`, `provision_missing_channels`,
`register_mcp_provider`. The list is derived from `pg_proc.prosrc`, so a thirteenth appears in the next measurement.

**Fixture dependencies.** 236 verify suites in `scripts/verify`; 112 name `fixture-`/`verify-` subjects; 8 call
`hq_create_project`; 39 read state of the one real office (`app.current_project`, `Legacy Coaching`). That 39 is the set
that needs a test *office* in the ownership phase, not a fixture project. Method: grep, not execution — a lower bound.

**Credential inventory.** The vault holds 36 secrets. Classes (`app.credential_class`): *human_integration* 12 names
(Google ×3, Notion, Vikunja, GitHub read ×2, NotebookLM ×3, Telegram user session + api id/hash); *channel* (Slack ×5,
Telegram bot tokens and webhook secret — reached through delivery containment, not this reader); *infra* (the LLM and voice
keys, service role, DB password, backups, Cloudflare, `hq.api_token`, worker kick, GitHub dispatch). **Every vault name has
a class** (`check:system-secrets` fails on one that does not).

---

## 3. Research assumptions: what survived, what was corrected

| Research claim | Measured | Verdict | Consequence |
|---|---|---|---|
| 44 tables carry `office_id`, 85 derive (TABLE-REVIEW-399) | **52 carry, 45 derive** (+ 14 GLOBAL, 20 SYSTEM) | **modified** | Tables the draft called "derived via `project_id`" have a *nullable* `project_id` (no null rows today, but the schema permits one): they carry. A derivation is proved by `attnotnull`, never by the rows. |
| "Duplication of the voice session check is unavoidable" (an edge function is one file) | `deploy:worker` has bundled its import graph for months | **rejected** | `voice` and `voice-token` ship their graph; `voice-token` had *no* check while `voice` had a private copy. |
| E1 `voice-token` unauthenticated | confirmed live (a 200 with a metered OpenAI session) | **accepted** | fixed, §4.1 |
| E2 `voice` speaks as env `VOICE_SUBJECT` | confirmed | **accepted** | removed |
| E13 Drive open to any session and the machine key | confirmed; also a *second* path: the public `vault_secret` wrapper let any service-key holder read a Google secret by name | **accepted, widened** | resolver, §4.2 |
| E14 a `person` may run every action | confirmed; and a *harness* member reached 5 of the 21 operator actions at the gateway (the ones carrying `by`) | **accepted, widened** | operator set, §4.3 |
| E16 storage written before the target is checked | confirmed; also a **test member could overwrite a real contact's photo object** | **accepted, widened** | §4.4 |
| E18 `owner_key` defaults to `'grant'` | confirmed — and with 0647 an email-only insert would have produced an **operator** | **accepted, widened** | 0652 |
| "OAuth consent is authenticated by the machine key" (E15) | confirmed: the consent password *is* `hq.api_token` | **accepted** | §4.5, not changed |
| *new:* `google-oauth /callback` is safe because Google's code is single-use | **false** — no `state`; any code from any Google account replaced the stored refresh token | **new finding** | fixed, §4.2 |
| *new:* the machine key cannot act as Grant | `appearance_set` reaches `hq_appearance_set(p_owner default 'grant')` | **new finding** | pinned, §6 |
| `verify:wrappers` is green | `approve_document`'s wrapper takes `p_by`, the `app` function does not | **pre-existing, not mine** | recorded, §9 |

---

## 4. Findings and results

### 4.1 Voice — fixed, deployed, verified live

*Required property:* no unauthenticated caller can obtain a realtime voice capability or impersonate the current human
through environment or default identity.

* `src/auth/speaker.ts` resolves a bearer to `service` (the machine key, constant-time), `person`, or `harness`. It does
  not decode a JWT itself: Supabase is asked whether it issued the session, then `office_members`. A person speaks as
  **their own** `owner_key`; **none → refused** (no default). Only positive answers are cached, for 60 s.
* `voice-token` answers 401 (with CORS headers, so the page can read it) before any state read, OpenAI call, or "voice is
  not configured". Its preflight allows `authorization`.
* The studio client (`web/studio/call.js`) sends its session on the mint and treats 401 as "sign in". The standalone
  `web/voice` page reuses the studio's stored session and says so plainly when there is none.
* `deploy:voice` bundles the import graph (`scripts/deploy/lib/bundle.ts`, shared with the worker) and its probes are
  **inverted**: an unauthenticated mint must be 401, a machine-key mint must be 200 with both tools.

*Tests.* `tests/auth/speaker.test.ts` (14): unauthenticated refused and costs no network call; wrong key; no key
configured; person acts as own key; empty/blank owner key refused; unknown session; non-person kinds are harness;
refusals never cached; and a **behavioural** test that loads the real `voice-token` handler under a stubbed `Deno` and
asserts a stranger gets 401 with CORS, **zero fetches**, while the machine key still mints (200, reaches OpenAI).
`tests/deploy/bundle.test.ts` pins that both functions ship `src/auth/speaker.ts`.

*Sabotage.* Removing the gate → the behavioural test goes red. (The first version of this test asserted the *wording* of
the source and **stayed green** under that sabotage; it was replaced — the sabotage is what found it.) Re-adding
`VOICE_SUBJECT` → red.

*Live.* `voice` v595, `voice-token` v625. Deploy self-probe: unauthenticated mint **401**; machine-key mint **200**
`tools=["look_up","ask_the_team"]`; preflight allows the page origin. The standalone studio page was redeployed (delta,
rollback point recorded) because the old client mints with no credential and would otherwise have been broken by the fix.

### 4.2 Fixed-name credentials — fixed, deployed, verified

*One resolver.* `app.deployment_credential(name, operator, job, system)`:

1. the name must be a **human_integration** (infra, channel and unclassified names are refused — in the *same words*, so
   there is no existence oracle);
2. the caller must be a verified **operator** (the gateway's session), or a **job** that passes
   `app.job_may_use_deployment_integration` — origin `internal` (the deployment's own duties), or `trusted` **and** the
   *root* job's requester is an operator (a child cannot launder a second person's turn);
3. or `system`, the worker acting for the deployment with no job in hand — an argument that exists only in `app`, which
   PostgREST does not expose. The edge-function door (`public.deployment_credential`) has no such argument.

*Worker.* `src/credentials/deployment.ts` carries the running job in an `AsyncLocalStorage` scope set at the one place
handlers are invoked (`withJobScope`). It is ambient, not a parameter, because most handlers are built once around a
database handle and ignore the one `handle()` is given. Readers moved to `readCredential` / `credentialSql`: Google,
Notion (adopt, sync, import, capabilities), Vikunja, GitHub read token, NotebookLM (3 adapters), Telegram user session.
Production check: after `worker v896` a real `drive.watch` duty completed under the scope.

*Gateway.* The Drive browse is operator-only and reads Google as that operator.

*Google connect.* `/callback` used to exchange **any** code and overwrite the stored refresh token. `hq_google_connect_start`
(operator-only) mints a one-time state; `/start` refuses without a live one; `/callback` **consumes it before exchanging
anything** and reads the client secret as the operator the state was minted for. The page presses a button that asks the
office first (`data-google-connect`, delegated). Verified in a real browser: pressing it asks `google_connect_start` and
opens `…/google-oauth/start?state=…`.

*Retired.* `app.vault_secret` refuses everything (0649); `public.vault_secret` is dropped. 0649 was applied **after** the
gateway, google-oauth and worker were deployed.

*Tests.* `scripts/isolated/p1-credentials.ts` **33/33** (real handlers, real replica): operator served; no caller / second
person / harness / blank operator refused; infra, unknown and unclassified refused identically; system works and is not on
the PostgREST door; the `service_role`/`anon`/`authenticated` privileges; the retired readers are gone; a duty is served,
Grant's own trusted turn is served, a **second person's trusted turn is refused**, so is its child, a harness job, an
unknown job; under `withJobScope` the same reads succeed/throw and two concurrent jobs do not read each other's identity;
the **real `google-oauth` function** refuses a callback with no state / a forged state / a replayed state — *each for that
reason*, asserted on the sentence, because the first draft of these negatives was passing only because "no client id"
refused first — and the legitimate flow reaches Google's token endpoint. The stored refresh token is unchanged throughout.
`tests/credentials/direct-reads.test.ts` (14) and `npm run check:system-secrets` (in the gate): no direct vault read of a
human-integration name, no use of the retired reader, no run-time-built name outside the vault export, every vault name has
a class; comments are stripped before scanning (a comment is not a call) and it carries six controls.

*Sabotages (each red, restored, green).* resolver stops asking *who*: **22/33**, 11 red; `/callback` stops checking the
state: **30/33** — the no-state callback goes on to Google's token endpoint, which is the pre-fix behaviour; a direct
`google.refresh_token` read injected into a handler: `check:system-secrets` red with file and line. `check:system-secrets`
also caught a real gap on its first live run (`github.token`, a legacy name with no class → 0651).

*Not done, on purpose.* Per-office Google (a second office with its own token) is the ownership phase's decision; the
resolver is where `uses_system_integrations` will plug in. The vault export is allow-listed (a disabled duty no
conversation can start). Slack and Telegram tokens are reached through `app.resolve_secret(ref)` behind delivery
containment (`claim_delivery` / `may_act_outside`), not through this reader.

### 4.3 Operator-only — fixed, deployed, verified

*Distinction.* `public.deployment_operators(owner_key)` (seeded from the person members that existed when 0647 ran — one
human; no address written) and `public.deployment_operator(owner_key)`, which also requires the key to belong to a current
**person** member: a row planted for a harness member does not make a test principal an operator. Operator authority is
**not** office ownership — it says who may change what is *shared*.

*Set.* `set_setting`, `set_google_secret`, `set_google_credentials`, `set_slack_credentials`, `forget_google`,
`disconnect`, `vikunja_connect`, `vikunja_forget`, `register_connector`, `revoke_connector`, `offer_connector_tool`,
`routing_set`, `bot_assign`, `staff_hire`, `staff_update`, `staff_retire`, `staff_tool_set`, `approve_tool`,
`decline_tool`, `revoke_tool`, `drive_link`, `google_connect_start` + the Drive browse. Per-office actions (autonomy,
standing yeses, lessons, automations, a project's own staff and sources) stay with any person.
`tests/gateway/operator-only.test.ts` makes the classification a **property**: every action whose name or function *looks*
deployment-wide must be in the set or carry a written reason it is not, so a new `set_*_credentials` fails until somebody
decides.

*Tests.* `scripts/isolated/p1-operator.ts` **25/25** with the real handler: a second signed-in person, a harness member,
the machine key and a stranger are each refused all 22 (403 `operator_required`, 403 `person_required`, 401); Grant
reaches all 22 (**his admin path is preserved**); the second person still reaches a per-office action; a harness member
planted in `deployment_operators` is still refused; the Drive browse is refused to all four and not to the operator;
adding a person to the table passes the gate "and only then"; and the 0652 constraints (§4.6). Revocation latency is the
60 s positive cache — documented, not hidden.

*Sabotages.* Enforcement disabled → second person **0/21** refused, harness 16/21 (five reached the database function) →
15/18. Operator function without the person join → red. Source test: replacing the consumed answer with `true` → red.

*Live.* hq-api v830 (after v827). A machine-key call to `set_setting` → 403 `person_required`; to the Drive browse → 403;
anonymous → 401. Grant is an operator in production (`deployment_operator('grant')` true, `'verify-operator'` false).

### 4.4 Storage ordering — fixed, deployed, verified

Order is now **authenticate → authorize the database target → write the object**. `hq_upload_target(kind, project,
contact, by)` returns the canonical project read from the row, or the **same** refusal for a missing, mismatched or
off-limits target, and holds a test member to "test traffic only". The gateway builds the path from what it returned.

*Before the fix* (reproduced by sabotage): a contact named under another project, a nonexistent contact and a nonexistent
project each **wrote an object**; a *test member wrote the photo path of a real contact*; an upload to a project that does
not exist stored 8 MB under a prefix nothing owns.

*Tests.* `scripts/isolated/p1-storage-order.ts` **18/18**; the edge emulator now **records** storage writes, so "zero
writes" is a count. Refusals: mismatch / missing contact / missing project / test member on a real contact / stranger /
machine key on a mismatched target — each zero writes, identical bodies. Positive controls: own contact, own upload, the
machine key on a valid target, a test member on a test project — each reaches storage at the canonical path. Sabotage
(`uploadTarget` returns the request's own project): **10/18**. Live: a machine-key `contact_photo` for a nonexistent
contact → 404 `no such contact`, nothing written.

*Equivalents searched.* The worker's `putFile` callers (`collect`, `drive-read`, `browser-gather`, `artifacts/store`) take
the project from the job's own row or its pinned config, not from a request. One of them (`collect`) prefers
`pinned_config.project_id`; that is set by system enqueuers today and is a **P2 item** (derive from the job).

### 4.5 MCP — documented, not changed (needs Grant)

* **Consent is the machine key.** `/authorize` accepts `hq_password == HQ_API_TOKEN`. Anyone holding the key can approve a
  **write-scoped** client; such a client's jobs are `mcp:<client_id>`, which `internal_root_ok` classes *internal* — and
  internal work may use the deployment's integrations. That is a path from "the machine key" to "acts as the operator".
  With one human it is the operator by construction; with a second office it is a hole.
* **22 enabled, write-scoped MCP clients exist, with 0 calls ever and no `last_seen_at`** — 2 real (Claude Desktop,
  ChatGPT, created 6 September) and **20 "Flow probe"** clients left by probes between 7 and 14 September. Each is a
  standing bearer token that does not expire. **I did not revoke them** (destructive; yours to confirm) — see §10.
* `mcp_job_status(p_job_id)` returns any job's output to any client (latent until a second office).
* **Design for the ownership phase:** consent authenticated by a signed-in operator session, not a password; a client binds
  to one office at issue; its jobs carry that office; `mcp:` stops being auto-internal.

### 4.6 No ambient Grant — fixed

`office_members.owner_key` defaulted to `'grant'`. An email-only insert produced `{person, grant}`: it spoke as Grant, and
since 0647 was an operator. 0652: no default; key shape `^[a-z][a-z0-9_-]{1,40}$` (a colon would add a field to
`requested_by`); a person may not take a reserved name or a harness prefix; one person per key. Replica: the email-only
insert is refused; with the default restored the insert is *still* refused, by the unique index — two layers. Both
`office_members` writers in the repository already name their key.

### 4.7 Machine key — contained as far as P1 can, **not rotated**

What the key is and where it lives:

| Holder | How |
|---|---|
| Vault `hq.api_token` | the source; `deploy:hq` reuses it, `--rotate-token` replaces it |
| Function secrets `HQ_API_TOKEN` | `hq-api`, `voice`, `voice-token`, `signin`, `mcp` (project-wide, set by the deploy scripts) |
| Repository scripts | read it from the vault (`verify:*`, `deploy:*`) |
| **Browsers** | legacy `localStorage` `hq.token`; the page presents a session first, the key second |

Contained: it names nobody (#385) and decides nothing; it is refused all 22 operator actions and the Drive browse; it is
not a voice/MCP *person*; and `check:machine-key` (gate) pins the only two places it reaches a function that defaults its
person — `appearance_set` (writes the single deployment-wide appearance row) and the fixture-only `project_archive`. A new
reach fails until it is pinned with a reason; a stale pin fails too. Its GET reach is unchanged: it can still **read** every
dashboard section (including data a future second office would own); the ownership phase makes the key name an office
explicitly and removes the implicit Grant.

**Rotation: not performed, and not claimed.** What blocks a safe rotation is a fact I cannot measure from the server: which
of Grant's devices still present the key rather than a signed-in session. Safe sequence:

1. confirm each device is on a signed-in session (ADR-0043) — this is the part only Grant can establish;
2. change the page to stop reading `hq.token` (a small change, not made here because it would sign out any device that has
   not migrated);
3. `npm run deploy:hq -- --rotate-token`, then redeploy the dependants so they pick the new secret up
   (`deploy:voice`, `deploy:signin`, `deploy:mcp`) — each reads it from the vault, so none needs editing;
4. re-run `verify:hq`, `verify:run3-live`, `verify:talk`.
Step 1 is Grant's; the rest is mechanical. MCP's consent password changes with the key — that is the argument for giving
MCP consent its own credential before rotating (§4.5).

---

## 5. Tests and sabotages — exact results

| Check | Result |
|---|---|
| `npx vitest run` | **261 files, 3,932 tests**, all passing |
| `scripts/isolated/p1-credentials.ts` | **33/33** |
| `scripts/isolated/p1-operator.ts` | **25/25** |
| `scripts/isolated/p1-storage-order.ts` | **18/18** |
| `scripts/isolated/ownership-composite-fk.ts` (clone) | **39/39** |
| `scripts/isolated/principals.ts` | **83/83** (one assertion updated to accept the stricter refusal) |
| `approver-identity`, `refusal-reversal`, `service-decides-nothing`, `legit-origins`, `project-provenance` | 44/44, 41/41, 4/4, 24/24, 20/20 |
| `npm run check:ownership` / `check:system-secrets` / `check:machine-key` / `check:anon-exposure` / `check:gateway-wrappers` / `check:migrations` / `check:templates` / `check:secrets` | all green against production |
| `verify:hq` | 48/48 |
| `verify:run3-live` | 26/26 (25/26 before its wording-locked assertion was widened) |
| `verify:wired` | 79 controls, 21 screens, no dead control |
| `verify:wrappers` | 42/43 — **pre-existing** (§9) |

| Sabotage | Landed (printed) | Red | Restored |
|---|---|---|---|
| voice-token gate disabled | yes | behavioural test | green |
| `VOICE_SUBJECT` re-added | yes | unit test | green |
| operator enforcement disabled | yes | 15/18 (0/21 for the second person) | green |
| `deployment_operator` without person join | yes | 17/18 | green |
| resolver stops asking who | yes | 22/33 | green |
| `/callback` stops checking state | yes | 30/33 (Google endpoint reached) | green |
| storage target check bypassed | yes | 10/18 | green |
| direct Google secret read injected | yes (grep -c) | `check:system-secrets` | green |
| `owner_key` default restored | yes | 24/25 (+ unique index second layer) | green |
| composite key dropped (×2) | yes | named attack red | green |

---

## 6. Production changes performed (all verified)

* Migrations **0647, 0648, 0649, 0650, 0651, 0652** applied via `npm run migrate`; 0649 only after the three consumers of
  the old reader were redeployed. Production now records 665 migrations.
* `voice` v595, `voice-token` v625, `hq-api` v830, `google-oauth` v591, `worker` v899.
* Studio page: two delta deploys (`dpl_7BgB8pY8ZHqBhWsycky3Mz8ns9z1`, `dpl_8dwyECYKJcHKwpP1bJeeWZ6EvVR5`); rollback points
  were printed by each run (`dpl_AALn7UrcFoMq3yJhZUBnNYCMe5ny` before the first).
* **Not done:** no secret rotated, no MCP client revoked, no row deleted, no message sent to a person, no second office.

## 7. Rollback

Each migration carries its rollback in its footer. In every case **redeploy the previous function version first** — a
gateway that asks a function that is gone refuses every operator action. 0649 is the one that removes a door the old code
used: roll back worker, hq-api and google-oauth together if it must go.

## 8. Final gate

Unit/static: `biome ci` 0 errors, `tsc --noEmit` clean, `vitest` 261 files / 3,932 tests green, `check:migrations` (665
recorded), `check:secrets`, `check:templates`, `check:ownership`, `check:system-secrets`, `check:machine-key`,
`check:anon-exposure`, `check:gateway-wrappers`, `check:callers`, `check:consumed`, `check:pressable`,
`check:capabilities`, `check:icons`, `check:branding`, `check:door-origins`, `check:voice-sessions`, `check:tokens`,
`check:backend-ref`, `check:one-brain`, `check:reachable`, `check:standing`, `check:chatter`, `check:undo`,
`check:believes`, `check:answerable` — all green. UI (it changed): `verify:wired`, `verify:ui` **54/54**, `verify:talk`
**40/40**, `verify:google-connect` (new) green with its sabotage red.

**The 73-entry readiness gate (`npm run gate`) cannot finish inside one ten-minute call**, so its 46 `verify:*` suites were
run in sequence with the same commands. Result: **35 green, 2 green only on a rerun, 9 not green — and every one of those 11 is accounted for**:

| Suite | Result on this branch | Evidence it is not this work |
|---|---|---|
| `review` | red (waits for `.bcmodhead h2 a`) | **identical at `origin/main` `41de1965`** |
| `mytasks` | 85/89 (repeating-task section) | **identical at `origin/main`** |
| `attests` | 9/11 (containment of a suite's own job kind) | **identical at `origin/main`** |
| `another-go` | 9/10 | **identical at `origin/main`** |
| `recovers` | 13/19 (same containment cause) | **identical at `origin/main`** |
| `backups` | red (an open backup chore in production) | **identical at `origin/main`** |
| `run4-live` | 23/24 (a typed yes finds 0 candidates) | **identical at `origin/main`** |
| `wrappers` | 42/43 (`approve_document` takes `p_by`) | production DB state; no migration of mine touches it |
| `isolated` | 2 of ~60 proofs red (version-skew, 0596 race) | they need the OLD schema; this sandbox's replica `post` already holds 0613+ — environmental |
| `history` | **57/58 first run, 58/58 on rerun** (and on base) | one HTTP-visibility check, **cause not established** |
| `lastword` | failed first run, **10/10 on rerun** (and on base) | the live worker took the suite's job ("the command carried no instruction") — the recorded race |

Two suites went red once and green on the immediate rerun on this branch. That is the signature CLAUDE.md warns about for
a suite run once; the `history` one I could not explain, and I am not claiming it is unrelated beyond "it passed 58/58 on
rerun and on the base commit".

**Debris from my own runs.** Suites that fail identically on the base commit do not tear down after themselves:
`check:leaks` is **red** because **10 tasks made by harness jobs on 1 October between 10:41 and 10:49** are on Grant's
personal task list ("Send the renewal note to the venue" ×2, "Run 2 live proof plan mupeuxxq" ×8). I tried to delete them
and the permission layer refused; I did not look for another route. They are listed so Grant can decide:
`bdc6ae67…`, `71076bc8…`, `192e9e3e…`, `77f36098…`, `06550607…`, `bb442f6c…`, `6853c1f6…`, `317addd8…`, `9fd5c55c…`,
`5069f7d8…`. No real record is affected; the leak check, correctly, says so.

**Production since the worker deploy:** 36 duty jobs, **0 failed** — Google mail, calendar, Drive, Notion sync and
reminders all completed under the job-scoped credential reads.

## 9. Unresolved, stated plainly

1. **MCP consent = machine key**, and 22 standing write-scoped tokens with no use (§4.5).
2. **Machine-key rotation** waits on device evidence (§4.7).
3. **The machine key can still read every dashboard section**, and `appearance_set` writes the one global row.
4. **Operator revocation takes up to 60 s** (positive cache).
5. **`drive_link` and the Drive browse are operator-only *transitionally***: they use the deployment's one Google token; a
   second office with its own Google needs its own resolver arm.
6. **Worker `collect` trusts `pinned_config.project_id`** (system-set today).
7. **`verify:wrappers` fails 42/43 on production, unrelated to this work**: `public.approve_document` takes `p_by` and the
   `app` function does not. It predates the branch; it is a different instance of "two halves right alone".
8. **Fixture dependence.** 39 verify suites read the one real office's state; they need a test office in P2.
9. `uses_system_integrations` is still a design, not a column. Until it exists, "trusted job + operator requester" is the
   guard, and it keys on the subject the adapter wrote into `requested_by`.

## 10. For Grant to decide (nothing here was done on his behalf)

* **Revoke the 20 "Flow probe" MCP clients** (and, if the connectors are unused, Claude Desktop and ChatGPT): one SQL
  statement, reversible only by re-consenting. `npm run mcp:revoke` exists.
* **Give MCP consent its own password** before rotating the machine key.
* **Confirm which devices are on signed-in sessions**, then rotate (§4.7).

---

## 11. P2 READINESS VERDICT

**YES — with two conditions that are decisions for Grant, not engineering gaps.** Not started; this stops at the gate.

| Condition | Evidence |
|---|---|
| P1 fixes implemented and tested | §4: voice, operator-only, credential resolver + Google state, storage ordering, no ambient Grant, machine-key pinning; every one has a sabotage that went red |
| No production regression | §6, §8: 36/36 duties since the deploy, `verify:hq` 48/48, `run3-live` 26/26, `final-audit-live` 48/48, `talk` 40/40, `ui` 54/54; 9 suites not green, each shown identical on the base commit or environmental; 2 flaky and green on rerun (§8) |
| Manifest covers every table | 131/131; `check:ownership` is in the gate and fails on an unclassified table (control: five synthetic defects each caught) |
| GLOBAL / SYSTEM justified | each has a reason of at least 24 characters, enforced; 34 reasons for Grant to read at the gate |
| Derived paths structurally `NOT NULL` | asserted by `attnotnull`, not by rows; 45 derived tables, each through exactly one proved path |
| Composite-FK spike under a bypass-RLS role | 39/39 as `service_role` and as a non-superuser `BYPASSRLS` worker stand-in; two sabotages red; the `session_replication_role` escape refused for both |
| Job creators fully enumerated | 12, derived from `pg_proc.prosrc` |
| Overload / caller inventory | 878 functions, 1 overloaded name, 137 with defaults, 47 with an ambient person, 153 gateway-reachable; **941 caller→callee pairs** in `docs/multi-user/function-call-graph.tsv` (regenerate: `scripts/audit/function-call-graph.ts`); the `hq_undo` constraint is recorded: reversals replay `{action, args}` by name, so a converted function changes its stored arguments too |
| Fixture dependencies measured | 236 suites; 39 read the one real office's state and will need a test **office** |
| Machine-key transition understood | §4.7: holders, containment, the safe sequence, and what only Grant can establish |
| No unresolved finding invalidates the ownership primitive | §9: none changes the shape of `offices`, the composite keys, or the write-once `office_id`. The operator distinction and the credential resolver are *independent* of ownership, so they survive if multi-user is abandoned |

**The two conditions.**

1. **Decide the MCP posture before a second office exists** (§4.5, §10): consent authenticated by an operator session, not a
   password that is the machine key; clients bound to an office. This is a P3 *design* input and not a P2 blocker — P2 adds
   no office to MCP — but nothing should provision a second office while a password-consented, write-scoped,
   non-expiring client class exists.
2. **Run the 73-entry gate in one sitting somewhere without the ten-minute call ceiling**, and clear the 10 debris tasks, so
   the "no regression" line above is one number rather than the table in §8.

**Recommended next phase:** P2 as written in `IMPLEMENTATION-PLAN.md` (offices, backfill, constraints, RLS), after Grant
has read the 34 GLOBAL/SYSTEM reasons in the manifest and answered the two items above.
