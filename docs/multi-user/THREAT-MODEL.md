# Threat model — multi-user (and the weaknesses found while building it)

> Research only. Baseline `41de1965`. **Part A is separate on purpose:** it lists weaknesses that exist in production
> today, independent of multi-user, discovered while researching. They were **not fixed** (change freeze) and are not
> folded into the design. Part B is the threat model of the proposed design.

---

# Part A — Existing weaknesses (present in production today)

Severity here is for the system *as it is now*: one real owner, one test principal. "Latent" means harmless with one
office and decisive with two; those are addressed by the design and are listed so nobody mistakes them for new.

| ID | Weakness | Evidence | Severity today | Multi-user |
|---|---|---|---|---|
| **E1** | **`voice-token` has no authentication** and builds its session from global state | its own header: *"this endpoint takes no authentication; origin is the only thing standing"* (`voice-token/index.ts:68`). It calls `voice_state()` (the whole office's state of play) and `voice_lookup(slug)` with the service key and embeds both in the session `instructions` (`:255-300`); the project slug is client-supplied and only character-stripped. CORS defaults to `*` (`:75`), which only constrains browsers. | **HIGH** — unauthenticated confidentiality exposure plus cost abuse | made worse: with two offices the brief is whichever is "global" |
| **E2** | `voice` maps **every** signed-in person to the single env `VOICE_SUBJECT` (`'grant'`) | `voice/index.ts:54`, `:134`. `hq-api` uses the member's own `owner_key`; `voice` ignores it. | LOW (only one person member exists) | **latent HIGH**: a second member's spoken instruction is attributed to Grant |
| **E3** | `app.enqueue_child` accepts any `p_project` | `coalesce(p_project, v_parent.project_id)` (0625:273); no check against the parent | LOW (needs a compromised or injected handler) | **latent HIGH** across offices; the composite FK closes it structurally |
| **E4** | Slack `tokens_revoked` / `app_uninstalled` PATCH `slack_workspaces` by the envelope's `team_id` before any workspace/sender check | `slack-events/index.ts:317-333`. The envelope is signature-verified and Slack fills `team_id`, so a team can only affect its own row. | LOW / informational | gains the workspace check for consistency |
| **E5** | `hq_answer_blocker` and `resume_job` authenticate by id and role, not by ownership | 0632; `principal_refusal` asks only "is `p_by` a known person" | none (one owner) | **latent CRITICAL** — the central gap; closed by `p_office` + composite FKs |
| **E6** | `app.search_documents(…, p_project => null)` searches **every project in the deployment**, and the **MCP server exposes exactly that** to any MCP client | 0464; TypeScript substitutes `unnamed_project()` so *agents* are safe (`retrieval.ts:138`); but `supabase/functions/mcp/index.ts:76-97` defines the `search_documents` tool as *"Full-text search across every document the team holds"* and maps an absent `project` to `p_project: null` | none (one owner, and it is the documented behaviour) | **latent CRITICAL**: an MCP token must resolve to one office, and `mcp_search`, `mcp_projects`, `read_document` and the other `mcp_*` functions join the conversion set (`mcp_clients.office_id` is a carrier) |
| **E7** | `standing_authorizations.project_id is null` is **deployment-global** | `standing_live_globally` unique index (0421) | none (one grant, Grant's) | latent: B would inherit A's global yes |
| **E8** | The gateway trusts caller-supplied `p_project_id`, `p_job_id`, `p_blocker_id`, `p_request_id` for any signed-in member | `hq-api` (UUID-shape check only) | none (one owner) | latent CRITICAL |
| **E9** | Telegram uses **one** webhook secret for all bots; `?bot=` selects the bot | `telegram-webhook:96` | LOW | acceptable if bots are shared infrastructure (design keeps them so) |
| **E10** | Secrets also live in **function environment variables** (not only the Vault): `OPENAI_API_KEY`, `SLACK_SIGNING_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `HQ_API_TOKEN`, `WORKER_KICK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `HQ_MANAGEMENT_TOKEN` | integration inventory | informational (CLAUDE.md "Secrets" says Vault; env is the platform's mechanism for edge functions) | system secrets stay; per-office ones move to `office_credentials` |
| **E11** | `system_config` is `using (true)` and holds plaintext identifying values (`github.repository`, `db.project_ref`, `google.client_id`) | inventory | informational | per-person keys move to `office_settings` |
| **E12** | A `telegram_chats` row with `subject` null matches **any** requester in `telegram_chat_for` | 0136:80-129; 196 of 204 chats have a null subject | LOW (messages go to chats the bot is in) | latent HIGH: wrong-recipient delivery |
| — | *Closed already:* anonymous access to 43 tables (0642) and 249 public functions (0613) | `check:anon-exposure` green | n/a | n/a |

**Disclosure.** E1 is the only one rated HIGH today. It has not been fixed and not been reported outside this
repository. Because the freeze forbids deploying functions, the remediation (require the session JWT; bind a
server-side session; scope `voice_state`) is Phase 3 of `IMPLEMENTATION-PLAN.md` — but it **should not wait for the
rest of multi-user**: it is a two-file change that is independent of `offices`. Recommended: raise it to the owner now
as a separate hotfix decision.

**Not verified this session** (stated rather than assumed): whether `signin` carries its own identity logic beyond
what the agent inventory reported; live Vault and `system_config` *values* (only key names were read); whether E1 is reachable from
the public internet (function URLs are normally public on Supabase; the project reference is also the default in
`scripts/`, so treat it as discoverable).

---

# Part B — Threat model of the proposed design

## B1. Assets
Private content (messages, documents, mail, calendar, contacts), **authority** (standing authorizations, autonomy,
approvals, tool grants), **credentials**, **the ability to act** (send, post, write, spend), **the model's context**,
and **classification** (the fact that something is test traffic).

## B2. Adversaries
| | Capability | In scope |
|---|---|---|
| **A1** | Authenticated user A, curious or malicious; knows B's ids and names | yes — the primary adversary |
| **A2** | Unauthenticated internet caller | yes |
| **A3** | A model-driven actor: a handler, a prompt-injected specialist, a document that tries to instruct | yes |
| **A4** | A harness or operator mistake (a suite writing as Grant; a migration stamping the wrong office) | yes — the repository's own history says this is the commonest |
| **A5** | A holder of the service key or the database password | **out of scope** (it is the root of trust); the design bounds the *blast radius* of a bug in a service-role caller, not a malicious one |
| **A6** | The operator (Grant) | trusted |

## B3. Trust boundaries
Browser ↔ gateway · channel ↔ edge function · edge function/gateway/worker ↔ database · worker ↔ model provider ·
office ↔ office (the new one). Only the last is new; every earlier boundary is unchanged.

## B4. How each requirement is defeated (the 30 attacks live in `ACCEPTANCE-PLAN.md`)

| Threat | Prevented by | Layer |
|---|---|---|
| A reads/updates/deletes B's project, task, document by id | id lookups are `where id = $1 and office_id = p_office`; `p_office` comes from the verified session, written over any client value | function |
| A creates work under B's parent/project | composite FKs on `jobs`, `blockers`, `deliveries`, `documents`, `tasks` | **structural** |
| A answers/approves/presses B's question, delivery, undo | the blocker/delivery/action is looked up by office; foreign id = `not_found` | function + structural |
| A uses B's standing authorization or integration | `office_id` on both; `autonomy_for` and `office_secret` take `p_office` | function |
| Retry/child/resume changes the owner | `office_id` immutable (trigger); children inherit and are FK-checked | structural |
| B's text reaches A's prompt | every retrieval function requires `p_office` and filters in SQL | function |
| Slack/Telegram/voice resolves the wrong office | one table `subject_identities`; unknown = no row = drop; workspace office must equal sender office | function + data |
| Sample reaches Grant | `offices.kind` joined at the effect door (`may_act_outside`); not a copied flag | **structural** |
| Unauthenticated caller reaches private data | every route either verifies a JWT/machine key or is a webhook with a signature; `voice-token` fixed (E1) | boundary |

## B5. New risks the design itself introduces (and what holds them)

| # | Risk | Why it matters | Mitigation | Residual |
|---|---|---|---|---|
| N1 | **A function converted to `p_office` but with one `where` forgotten** | `SECURITY DEFINER` bypasses RLS, so a missing filter leaks silently | `check:office-scoped` (signature), the A/B suite (behaviour), required param with **no default** so call sites fail loudly | a function that takes `p_office`, receives it, and ignores it. Only the A/B suite finds this → every converted function needs an attack. Residual **M** |
| N2 | **Raw SQL in handlers** (502 `execute(` in 95 files) | the worker is `postgres`; nothing but the SQL's own `where` limits it | composite FKs stop cross-office *writes*; `check:office-scope` ratchet; suite runs every handler against two offices | cross-office *reads* in raw SQL are caught only by review + suite. Residual **M** |
| N3 | **Backfill stamps a row with the wrong office** | irreversible in an append-only ledger | characterise → rule → assert zero unclassified → abort on any (MIGRATION-PLAN); quarantine office for harness residue | a rule that is wrong but internally consistent. Residual **L** (one real owner has ever existed) |
| N4 | **A sanctioned exception to an append-only ledger** (backfill; `purge_sample_office`) | any hole in a ledger trigger is a way to alter evidence | exception keyed on a transaction-local setting that only the named function sets, **and** only for `offices.kind='sample'`; the control test tries it against Grant's office and must fail | a bug in the exception predicate. Residual **L–M** |
| N5 | **Legacy bearer token (browsers that still hold `hq.token`)** | the machine key names no person; if it is mapped to Grant "for compatibility" that is a global fallback | no default mapping. Grant's devices use signed-in sessions (ADR-0043 already supports them) *before* enforcement; the key requires an explicit office; the page stops reading `hq.token` | a forgotten device is signed out, not mis-attributed. Residual **L** |
| N6 | **Session cache lag** | a disabled office keeps working ≤60 s | accepted; tested; cache keyed by token and storing the office | **L** |
| N7 | **Aggregate endpoints leak activity** (inference channel) | `office_health()`, `usage_overview`, `hq_cost_per_outcome`, `hq_series` compute over the whole deployment | each is on the 60-function whole-office list and becomes `p_office`-scoped; counts must be per office | a new aggregate added without scope → covered by `check:office-scoped` |
| N8 | **Existence oracles** (a name taken, an id that exists) | B learns A has "Venue" | uniqueness is per office; a miss and a foreign row return the same `not_found`; error text names nothing | timing differences. Residual **L** |
| N9 | **Views run as owner** | a view with no office column exposes everything | 14 views rewritten as functions or given `office_id` and filtered by consumers (`needs_me` has 8 consumers) | **L** after the check |
| N10 | **Storage bucket** (`files`) paths | signed URLs outlive a revoked office | prefix `<office_id>/`; URL issued only after the office check; short expiry | a URL already issued. **L** |
| N11 | **Cross-office model-context via shared prompts** | system prompts, `capabilityBrief`, `staff_prompts` are global | they contain no office data by construction; `capabilityBrief` is built from the *office's* connection state | a future prompt that interpolates a global table. covered by the retrieval test |
| N12 | **Realtime voice session fixation** | a stolen session id | server-minted, bound to the office, short TTL, checked on every turn | **L** |
| N13 | **Backup and logs hold every office's data** | operator-visible | out of V1 scope; restore-one-office is a documented later need | accepted |
| N14 | **Harness driving production doors** | the repository's most repeated incident (seven instances in CLAUDE.md) | Sample/test offices are `kind <> 'person'`: `may_act_outside` is false **structurally**; the isolation suite declares its origins before knocking (`test_origins`, 0605) | **L** |
| N15 | **`office_id` becomes a high-cardinality filter that the planner ignores** | slow queries, then a developer removes the filter "to make it work" | composite indexes `(office_id, …)` on the 12 hot carriers; `EXPLAIN` in the plan's exit criteria | **L** |

## B6. Information-flow rules (the checkable restatement)
1. No `select` that returns rows to a user, a channel or a model is unfiltered by office.
2. No `insert` takes an office from the request.
3. No identifier from outside is dereferenced without an office predicate.
4. No credential is dereferenced without the office that owns its row.
5. No effect (message, post, write, spend) is performed for a job whose office is `kind <> 'person'`.
6. No cache is keyed by anything but a token, a job, or an `(office, …)` tuple.
