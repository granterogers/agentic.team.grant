# Effect-door inventory (issue #386) - read-only recon, main e9c632f3 (branch claude/architecture-run-3-identity)

Method: every row was read from the code path (handler body, enqueuers, worker path, migration bodies), not from comments.
Cannot verify from here (no DB): live ACLs (`has_function_privilege('anon', ...)`) and live row contents. Marked UNVERIFIED-LIVE where it matters.

Gate classes: CANONICAL = calls mayAct/authorize_effect and the decision dominates the effect. LEGACY-GATING = blocker/approval only or older may_act. CONTAINMENT-ONLY = only worker.containmentRefusal (REACH registry -> app.job_origin) or app.claim_delivery. RAW = no gate. EXEMPT = reason given.

Chokepoints (verified):
- worker.ts:946 `containmentRefusal(db, job, handler.reach)` runs before `handler.handle` for every kind whose REACH is `external` (unlisted = external). It asks `app.job_origin` (harness/unknown refused; trusted/internal pass). It is a provenance test, not a permission test.
- Only ONE call site of `EXECUTORS[...]` (perform.ts:630) - plan-step authority dominates its effects. Only THREE production callers of mayAct/governOutward (perform.ts:701, calendar-tasks.ts:57, drive.ts:266). No production caller of authorize_effect except through mayAct.
- Every message send goes `DeliveryService.deliver` -> `app.claim_delivery` (delivery.ts:159-183) - exactly-once by dedupe key; except the raw sends listed below.
- Only 4 handlers use step_begin/checkpoints: artifact.report, office.backup, browser.gather, office.pursue (plan steps). Every other external handler is retried by the worker on ANY throw (worker.ts ~1010-1060: `retryable = job.attempt < 4`); no handler catches `AmbiguousWriteError` (grep: only notebook/actions.ts and unused sync-queue.ts).

## A. CANONICAL

| # | door (file:function) | effect | audience | int/ext | class | notes |
|---|---|---|---|---|---|---|
| A1 | src/agents/perform.ts:compile -> mayAct(:701) -> EXECUTORS (db.read, notebook.read, draft.create, task.create, task.extract) | plan-step effects: reads, drafts, tasks | office/grant | internal (local/none) | CANONICAL | Decision precedes `executor.run` in the same closure, fingerprint binds step+why+needs+project+audience+specialist, step_begin checkpoints. No external executor exists today, so the boundary guards nothing outward yet. |
| A2 | src/handlers/calendar-tasks.ts:handle -> governOutward(:57) -> syncTasksToCalendar(:82) | create/patch/DELETE events in Grant's Google Calendar | grant | external | CANONICAL (weak binding) | Gate is by TOOL (`calendar.write`); no fingerprint, no jobAskedFor semantics beyond duty. The plan is computed (`planTasksForCalendar`) but the effect is RE-DERIVED by `syncTasksToCalendar` - approval/standing covers "the tool", not the shown plan. No checkpoint; diff-based so retry is largely idempotent. Enabling the duty = standing authorization (0424). |
| A3 | src/handlers/drive.ts:drive.watch -> mayAct(:266) -> enqueue drive.read_file | ingest other-system files into corpus | office | ext source -> local | CANONICAL | No job/fingerprint passed, so only the (tool,project) refusal path applies. GAP: the blocker raised has no `declineOption` (options: Add / Add from now on / Ignore these) so `answered_option = decline_option` is NULL: "Ignore these" is never remembered as a No (authorize_effect 0611:251). Answer path `on_answer` performs the read_file enqueue; drive.read_file itself has no gate (reads). |

## B. LEGACY-GATING

| # | door | effect | audience | int/ext | class | notes |
|---|---|---|---|---|---|---|
| B1 | notebook.ts:304 `notebook.generate` | starts NotebookLM generation (spends quota; artifact appears in Grant's account) | grant | external | LEGACY-GATING | Gate = `payload.approved_by` PRESENCE (notebook.ts:325). Written by `app.answer_generation_approval` (0611:458) copying the asking job's pinned_config. Any writer of pinned_config can set it: `public.mcp_enqueue(p_payload jsonb)` passes an arbitrary payload (0068:129-160); quota-deferral child copies pinned_config incl. approved_by (notebook.ts:377-390, by design). Retry: `actions.generate` -> record -> insert artifacts -> enqueue collect; a throw after generate (or AmbiguousWriteError timeout) => worker retry => second generation. No step_begin. |
| B2 | plan.ts:67 `office.execute_plan` | `actions.createNotebook` (NotebookLM), hq_create_project, hq_attach, enqueue add_source / generate / ask | grant | external | LEGACY-GATING | Approval = blocker "Go ahead" from `app.request_approval` (0269); `approval_next` + `plan_steps` live in the ASKING job's pinned_config and are copied at ANSWER time (0611:441-460) - the approval is bound to job id, not to a hash of plan_steps. Children: `notebook.add_source` is enqueued with NO further gate; `generate` asks again. Retry: createNotebook is not idempotent; failure between createNotebook and hq_create_project (plan.ts:126-131) or any ambiguous timeout => second notebook. |

## C. CONTAINMENT-ONLY (external kinds, gate = origin test only)

| # | door | effect | audience | class | enqueuers / principal | retry / duplicate hazard |
|---|---|---|---|---|---|---|
| C1 | notebook.ts:503 `notebook.add_source` | adds a URL as a source in the project's notebook | grant/office | CONTAINMENT-ONLY | instruction.ts:1721 `enqueueSource` (any link in a message, announce=false, no question), plan.ts:169, quota-deferral. Principal = whoever sent the message (Slack sender allowlist is #388) or a model-resolved instruction. | `addUrl` not idempotent; throw after addUrl (`record` failing) or AmbiguousWriteError => duplicate source (the exact case api/notebook-act.py's header says must not be retried). |
| C2 | notebook.ts:580 `notebook.push_document` | copies a document's full content into the notebook | grant | CONTAINMENT-ONLY | ONLY `app.mcp_enqueue` (0068) from an MCP client (`requested_by mcp:<client>`); trusted by `internal_root_ok` (0603:190) if client enabled + write scope. | same as C1 (addText). |
| C3 | notion-import.ts:279 `office.notion_import` | creates Notion pages (Projects/Docs/Tasks) + relations | grant | CONTAINMENT-ONLY | instruction.ts:3184 from a recogniser (`entitled.populate`), no question. A plan is RECORDED (`recordPlan`, `app.job_plan`) and `handle` carries the stored plan out, but nothing asks for approval. | createPageIfAbsent => idempotent (good). Model curriculum stored, not re-asked. |
| C4 | notion-adopt.ts:47 `office.notion_adopt` | attaches Notion DBs to project (`project_attachments`), which is what later authorises writes | grant | CONTAINMENT-ONLY | instruction.ts:3172 ("wire this to Notion") | local insert; retry safe. Note the sibling `hq_attach` from any pasted link (instruction.ts:1656) is RAW (below). |
| C5 | tasks-sync.ts:64 `tasks.sync` -> src/tasks/sync.ts | create/update/DELETE tasks on Vikunja board; ALSO inbound: provider "done" pulls task_pulled which can fire the to-do tick that answers a blocker | grant | CONTAINMENT-ONLY | duty (enabled flag) | push `provider.upsert` then `app.task_pushed` (sync.ts:117-127): crash between => duplicate remote task; delete is idempotent (404 ok). |
| C6 | channels.ts `office.provision_channels` / `office.rename_channels` | Slack conversations.create (public), invite Grant, rename; irreversible (Slack cannot delete) | office/grant | CONTAINMENT-ONLY | `app.provision_missing_channels` (0477; requested_by 'hq'), `app.hq_rename_project`; trusted by internal_root_ok (0603:188) | ensureChannel is name-idempotent; name_conflict raises blocker once. |
| C7 | google-revoke.ts:156 `google.revoke` | revokes Grant's Google grant at Google (irreversible) | grant | CONTAINMENT-ONLY | `app.google_revoke_begin` <- `app.hq_forget_google` <- gateway `forget_google`/`disconnect`; job `requested_by` hard-coded 'grant' (0354:105) - #385 identity debt | idempotent (invalid_token treated as revoked); parked token deleted in finish. Safe. |
| C8 | vault-export.ts:39 `office.vault_export` | decrypts ALL vault secrets, seals, sends file + passphrase to Telegram | grant (chat = `app.telegram_chat_for('grant', pager)`) | CONTAINMENT-ONLY | duty; also `.github/workflows/vault-export.yml` (operator, workflow_dispatch) | Sends are raw (`sendSealedVault`, src/backup/vault-export.ts:195,212) - no claim_delivery, no dedupe. Throw after the file but before the passphrase => retry builds a NEW file+passphrase and sends the whole vault again. Recipient chat is "newest deliverable chat recorded under subject grant" (CLAUDE.md trap). |
| C9 | slack-rotation.ts:60 `office.slack_rotate` | `tooling.tokens.rotate` at Slack (invalidates old pair), writes vault | office | CONTAINMENT-ONLY | duty | pre-rotation copy is stored first (rotation.ts:186); failure after rotate before store loses the pair. |
| C10 | ci-dispatch.ts:24 `ci.dispatch` | GitHub repository_dispatch `run-<workflow>` | office | CONTAINMENT-ONLY + budget ceiling (`app.ci_reserve`) | NO enqueuer anywhere in src/migrations (deliberately dormant, check-reachable baseline). `pinned_config.workflow` is free text into event_type. | reservation released on failure; 204 = success. |
| C11 | Delivery layer: DeliveryService.deliver (channels/delivery.ts) via reply.ts, notify.ts, progress.ts, callbacks.ts, lastword.ts, narrate.ts, slack/notifier.ts, telegram/pager.ts; worker post-run delivery; child jobs with announce=true; apology (`owed_a_word`); `retry_job_deliveries` | Slack/Telegram/pager messages | grant + office; Slack replies go to whoever posted (#388) | CONTAINMENT-ONLY | `claim_delivery` -> `delivery_refusal` -> `job_origin`; exactly-once by dedupe key; `say_once` dedupes announcements | No authority test at all: messages are not tools in `tool_permissions` matrix (`slack.post` exists only for reporting). Retract paths (`deleteMessage`, `chat.delete`) same layer. |

## D. RAW (no gate)

| # | door | effect | audience | notes |
|---|---|---|---|---|
| D1 | supabase/functions/telegram-webhook/index.ts:440 | GitHub `repository_dispatch` event `voice-note` using vault token (`github_dispatch` RPC) | outside (GitHub Actions minutes) | Bypasses `dispatchWorkflow`/`app.ci_reserve` ledger entirely; fires on every voice note. Starts `.github/workflows/worker.yml` = a SECOND worker fleet on repo checkout. |
| D2 | telegram-webhook:405 | `sendMessage` voice-refusal to the sending chat | whoever messaged (admitted sender) | Outside delivery layer: no claim, no dedupe, no containment (sender is admitted by `sender_admitted` before, index.ts:165). Telegram retry of the webhook resends it. |
| D3 | telegram-webhook:323 | `answerCallbackQuery` toast | presser | idempotent, harmless. Arguably EXEMPT. |
| D4 | vault-export sends (C8) | see C8 | | raw at the transport level. |
| D5 | instruction.ts:1656 `hq_attach` from any link in a message; plan.ts:154 attach step | attaches Notion/NotebookLM as project sources = creates future read and write targets | office | No gate at all; sender is whoever the door admitted. Feeds C3/C1. |
| D6 | supabase/functions/mcp -> `public.mcp_enqueue` / `mcp_add_document` | enqueue notebook.generate/push_document/ask; write documents | grant (notebook) | Client auth is in the edge function (token -> scopes). The DB function itself checks NOTHING about the client id (0068:129-160) and takes a free p_payload. `revoke ... from public` only (0068:216); UNVERIFIED-LIVE whether `anon` can execute (ADR-0053: 272/275 definer functions in public were anon-executable). If so: forged approved_by / approval_next / plan_steps (see B1, B2). |
| D7 | `public.retry_job_deliveries(uuid)` | re-queues failed deliveries of a job | grant | 0347:74 EXPLICITLY `grant execute ... to anon, authenticated, service_role`; no principal. Only resends messages that already failed (bounded), but it is an anon-callable effect door. |
| D8 | Chat "yes/no" typed answer (instruction.ts:4803-4900) and Telegram/Slack button approve/decline (callbacks.ts:455-500) | answer a blocker => performs on_answer / approval_next / standing grant | grant | Goes through `hq_answer_blocker` with `app.command_principal` (good). BINDING GAP: the button resolves `app.open_approval_for_job(row.job_id)` at PRESS time (callbacks.ts:480), not the blocker the message showed - a stale button can answer a newer question on the same job. Typed yes binds to "the one open question in the last turn's job tree" (12h). Neither uses action_fingerprint. |

## E. EXEMPT (reason)

| door | reason |
|---|---|
| browser.gather, drive.read_file, drive.watch (listing), google.read_mail/read_calendar, notebook.ask/collect/collect_artifact/list_artifacts, knowledge.read_source, mcp.discover (only tools/list; src/mcp/client.ts has no tools/call), office.sync, office.notion_sync (labelled external in REACH but read-only; over-contained), hq-api `drive` browse | reads; no third-party state change (browser.gather may use a stored signed-in session: GETs only, checkpointed) |
| office.backup (own Supabase storage, upsert, checkpointed), artifact.report (own store + delivery, checkpointed), hq-api storage put/sign | writes only to own project storage; idempotent keys |
| ProviderRouter (OpenRouter), voice transcription (`voice/index.ts`, `src/voice/inbound.ts`), voice-token (OpenAI realtime client secret) | inference/voice providers; content egress is the product's function; no per-content authority |
| office.instruction, office.pursue, office.synthesise, office.propose, office.chores, tasks.remind, briefing.morning, office.capacity_report, prune jobs | local DB writes + delivery layer; pursue's outward effects all go through A1 |
| hq-api gateway actions (`ACTIONS`: disconnect/forget_google, revoke_connector, staff_retire, detach, set_setting, grant_standing, task_add ...) | initiated by the signed-in person through the bearer door; the door is the authorization. CAVEAT #385: bearer token is attributed as 'grant'. `disconnect` deletes vault secrets (local, irreversible). |
| api/notebook-act.py (Vercel) | the effector behind NotebookActions (14 actions incl. delete_source/delete_artifact); hmac bearer `notebook.reader_secret`; not a decision point; production callers of delete_* are scripts only |
| scripts/ and .github/workflows (vault-export.yml, slack-rotation.yml, backup.yml, worker.yml, sync.yml; all workflow_dispatch/repository_dispatch) | operator-run, not office code. worker.yml is a live second worker fleet (see skew). |
| src/notebook/sync-queue.ts enqueue/attempt/reconcile | no production caller (dormant) |
| Event triggers / duties (`event_triggers.job_kind`, `responsibilities.job_kind`) | not effects, but LATENT DOOR: internal_root_ok (0603:177-189) treats ANY job_kind from a duty/trigger row as `internal`, so a future row naming an external kind is contained-through. Automations Grant creates are restricted to office.instruction (0324). |

## Dominance findings (does any path skip the gate?)
1. Plan steps (A1): none. Single executor call site; resume path re-asks via `action_answer` then step_begin.
2. notebook.generate (B1): the gate is a payload key, so every enqueuer that can write pinned_config bypasses it. Known safe writers: hq_answer_blocker child, deferral child. Unsafe if anon can call `public.mcp_enqueue`. The MCP edge builders only send {kind, instructions}.
3. Approval start kinds are whitelisted (`request_approval` list) but `approval_next` is READ from the asking job's pinned_config at answer time (0611:441) - a forged pinned_config on a job that then raises a generation approval would start `office.execute_plan` with forged `plan_steps`.
4. Retry path: worker retries any throw <4 attempts. External non-checkpointed writers duplicate on partial failure: notebook.add_source/generate/push_document, execute_plan(create_notebook), tasks.sync push, vault_export, and Ambiguous timeouts (violates spec s7) - verified no catch.
5. Child announce=true: outputs deliver through claim_delivery only (containment). OK, but delivery is not authority-gated.
6. Reverse door: tasks.sync pull can tick a to-do that answers a blocker as a named principal (Run 2 tick) - external board = approval channel; principal is recorded on the task, not proven at the board.

## Version-skew hazards for migrating a door
- Two worker fleets: Supabase edge `worker` (deployed by deploy:worker) and GitHub Actions runner via `repository_dispatch: voice-note` (worker.yml runs repo checkout). They can run different code against one queue.
- authorize_effect has NO fallback (approval.ts:151-170): a worker ahead of 0611 fails loudly; containment falls back to harness_job on 42883. Migrate a door: migration first, worker second.
- Blockers raised by an old worker have NULL `action_fingerprint`/`decline_option` (generation approvals, plan approvals, drive): a new gate must accept the legacy shape for one release (perform.ts uses `legacyFingerprint`) or in-flight questions become unanswerable.
- `approval_next` default coalesces to 'notebook.generate' when missing (0611:441): pre-existing behaviour that an old-shape question keeps working; removing it strands in-flight approvals.
- Function overloads: authorize_effect 8 args; drop by exact signature when extending.

## Proposed fingerprints and principals for the non-CANONICAL doors
| door | fingerprint to bind | principal | duplicate risk / needed idempotency |
|---|---|---|---|
| notebook.generate | sha256{tool:'notebook.generate', project, notebook_ref, kind, instructions} | answering principal (command_principal / gateway); MCP client id when asked from MCP | needs step_begin around `generate` + artifacts row with idempotency key; treat AmbiguousWriteError as park |
| office.execute_plan | sha256 of canonical plan_steps + project + create_project names | answering principal | per-step checkpoint (createNotebook effect external) |
| notebook.add_source | {project, notebook_ref, normalised url} | message sender principal (enqueueSource) or MCP client | checkpoint; ambiguous => park not retry |
| notebook.push_document | {project, notebook_ref, document_id, content_fingerprint} | MCP client id | same |
| office.notion_import | {project, projectsDb/docsDb/tasksDb ids, stored plan hash} | requester from origin command | already idempotent |
| tasks.sync | duty (tool,project) with provider name; per-direction (push/delete/pull) | duty owner (Grant) | needs remote-id-before-write pattern |
| office.provision_channels/rename | {project, desired channel name} | 'hq' system (duty) / Grant for rename | idempotent |
| google.revoke | {refresh-token hash ref, 'revoke'} | gateway principal (fix hard-coded 'grant', #385) | idempotent |
| vault-export | {duty slug, recipient chat id, secret-count} | duty owner | must checkpoint between file and passphrase; recipient must be pinned, not "newest chat" |
| telegram-webhook raw sends / dispatch | route through delivery layer (D2) and dispatchWorkflow/ci_reserve (D1) | n/a | Telegram webhook retry resends D2 |
