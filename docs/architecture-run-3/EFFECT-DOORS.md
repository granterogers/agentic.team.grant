# Effect-door inventory after Run 3 (#386)

The reconnaissance (`EFFECT-DOORS-recon.md`) read every door from its code path, not its comments. This is the
state after Run 3. Classes: **CANONICAL** (a decision that dominates the effect), **BOUND** (an approval is checked
against the exact action by the handler, plus `mayAct`), **CLAIMED** (an effect that cannot be undone is claimed
before it is made and reconciled, not repeated), **CONTAINMENT** (provenance only: `worker.containmentRefusal`,
`app.claim_delivery`), **RAW** (no gate), **EXEMPT** (with a reason).

| Door | Before | After | Where it is proved |
|---|---|---|---|
| plan steps (`perform.ts`) | CANONICAL | CANONICAL (unchanged) | authority, exactly-once |
| calendar duty (`governOutward`) | CANONICAL (weak binding) | unchanged | authority |
| `drive.ingest` | CANONICAL (no job/fingerprint) | unchanged; the No is still not durable for the "Ignore these" option (recorded in #386 notes) | authority |
| `notebook.generate` | blocker only, gate = `approved_by` present | **BOUND + CLAIMED**: `app.approval_verdict`, `mayAct`, a claim before the write, clean refusal retried, ambiguous parked | approval-binding (28) |
| `office.execute_plan` | blocker only, **no check** | **BOUND + CLAIMED** per step (checkpointed; the notebook creation is external) | approval-binding |
| `notebook.add_source` | containment only | **CANONICAL write gate (`mayWrite`) + CLAIMED** | approval-binding |
| `notebook.push_document` | containment only | **CANONICAL write gate + CLAIMED** (MCP-only door; handler proved by code path, not by a suite — the documents fixture needs three CHECK constraints) | reviewed structurally |
| `public.mcp_enqueue` | free payload | strips `approved_by`, `approval`, `approval_next`, `command_id`, `origin_namespace`, `plan_steps` | approval-binding |
| Approve/Decline button | newest open question at press time | **answers the question its message showed** (0617) | approver-identity (44) |
| `office.vault_export` | containment; raw Telegram; "newest chat" | recipient must be his own listed Telegram id; **CLAIMED** before a secret is decrypted; body has no secret | vault-export-door (5) |
| telegram-webhook voice reply | raw, resent on every redelivery | once, only to the sender who was admitted | sender-authorization (39) |
| telegram-webhook `staff_for_bot` / enqueue | failure = 200 (message lost) | failure = 503, the retry finishes the job exactly once | sender-authorization |
| telegram-webhook `repository_dispatch` | RAW (bypasses the CI budget ledger) | **still RAW**, bounded by sender admission — #391 | — |
| `tasks.sync`, `office.provision_channels`, `office.notion_import`, `office.slack_rotate` | containment only | **still containment only**: the boundary would start asking questions Grant has not been asked — **decision needed, #389** | — |
| `google.revoke` | containment; `requested_by 'grant'` hard-coded | still; reachable only through a person-only gateway action — #390 | principals (gateway) |
| `hq_attach` from a pasted link, `notion_adopt`, plan `attach` | RAW | still — #393 | — |
| typed "yes" | one open question in the last turn's tree | still — #394 | — |
| Slack sends, Telegram sends (the delivery layer) | `claim_delivery` (exactly-once by key; containment) | unchanged: audience is the office or Grant; the outside-audience floor is enforced where a *plan step* says `outside` (Run 2) | containment suites |
| `ci.dispatch` | dormant (no enqueuer) | unchanged | check:callers |
| gateway actions | the key decided as Grant | **person-only unless on `SERVICE_MAY`** | principals (61), tests/architecture |
