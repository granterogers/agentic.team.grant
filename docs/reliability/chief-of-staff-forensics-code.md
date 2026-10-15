# Canary Coworking incident — code-level investigation (repository only)

**Scope:** what the repository's code does, read at `claude/chief-of-staff-reliability` after `031c5a29`.
**Not included:** any production record. No production read was made (DEC-009). Every finding below is a hypothesis about the code or a claim that needs production evidence to confirm. Nothing here is a verified cause.
**Classification** uses the consolidated spec §10 scale: Confirmed defect · Supported hypothesis · Unverified possibility · Ruled-out cause.

## Evidence used

| Ref | Where | What it shows |
|---|---|---|
| E1 | `src/handlers/instruction.ts` 2981–3003 | The duplicate-work reply names the running job by its `about` text, cut to 120 characters, and says "is running now, so I have not started it a second time". |
| E2 | `src/agents/already.ts` 121 | A second wording of the same "already on that" reply. |
| E3 | `src/channels/telegram.ts` 223–270 | A Telegram callback's dedupe key is `telegram:callback:<bot>:<callback query id>`. The payload is parsed as `action:payload`, but only a valid uuid is validated, and for non-undo actions the uuid is not carried into the command. The command's `compensates_event_id` is null. |
| E4 | `src/channels/callbacks.ts` ~504–538 | An approve or decline press resolves the blocker through `app.approval_for_delivery(office, delivery)`, the delivery the button is attached to, then calls `app.hq_answer_blocker`. |
| E5 | `src/channels/callbacks.ts` ~584–586 | A code comment says answering is idempotent: `hq_answer_blocker` reports "already", so a retry cannot double the answer. |
| T1 | Transcript, 09:36, 09:53, 10:59 | The same stop message, word for word, three times. |
| T2 | Transcript, 11:11–11:12 | The user reports three clicks on "go ahead". The reply says a job is already running and names it by its first 120 characters. |
| T3 | Transcript, 15:45 | The office says it needs a Gmail search term, a Notion workspace and an assignee. The consolidated spec §18 says none of these should block the whole objective. |

## Findings

### F1 — Duplicate suppression reads the running job's text, not a stable objective identity
- **Status:** Confirmed in code (E1). The transcript matches it (T2: "Canary Coworking Project … inve" is the first 120 characters).
- **Implication:** The guard identifies work by wording. Two requests with different wording for the same objective would not be recognised as the same objective. Requirement COS-033 and COS-108 are affected.
- **Still needed:** the job and objective rows for the incident, to check whether the running job was the right one.

### F2 — The callback dedupe key is per click, so it cannot deduplicate repeated clicks
- **Status:** Confirmed in code (E3). The key uses Telegram's callback query id. Each press has a new id.
- **Consequence:** Three presses produce three distinct commands. Idempotency therefore depends on the answer step being idempotent, not on the ingress layer.
- **Mitigation already present:** E5. The answer is idempotent at the database level, as the comment claims.
- **Still needed:** confirm that `hq_answer_blocker` returns "already" on a repeat press. This is a claim in a comment and must be verified by a test (COS-074, REG-001).

### F3 — The button does not carry an approval identity; the press resolves through the message
- **Status:** Supported hypothesis. The code is clear (E3, E4). Whether it causes a wrong or stale approval to be answered is not established.
- **Mechanism to test:** if the delivery a button is attached to later maps to a different or already-answered blocker, a press could answer the wrong approval, or none, while reporting success. This would produce repeated prompts with no visible consumption.
- **Needed to decide:** the blocker rows for the incident, and the delivery→blocker mapping at the time of each press (COS-144, COS-072, COS-073).

### F4 — The same stop was raised again, rather than the existing approval being reused
- **Status:** Supported hypothesis from T1. Three identical stop messages at 09:36, 09:53 and 10:59 imply either three blockers, or one blocker re-announced. The code path that raises a stop was not traced in this pass.
- **Needed to decide:** the blocker and delivery rows for those three times (COS-092, COS-093, REG-006).

### F5 — The office asked for optional details before starting any work
- **Status:** Confirmed as a user-visible behaviour in T3. The cause (a blocking dependency at objective intake) has not been traced in code.
- **Requirement:** COS-121 and COS-123 (a missing optional detail must not block unrelated steps).

## Ruled out in this pass

- None yet. The "Somebody is already on that" text does not come from a second path: E1 and E2 are the only two sources of that sentence.

## What would settle these

| Question | Source needed | Authorisation |
|---|---|---|
| Did the three clicks reach the webhook, and what did each resolve to? | `inbound_commands` rows with `callback_action`, and `deliveries` for the stop messages | `ALLOW_PRODUCTION_CHECKS=1`, read-only, Grant's named authorisation (DEC-009) |
| Which blocker did each press answer, and what state was it in? | `blockers` and `app.approval_for_delivery` for each press | same |
| Did the job continue after the approval? | `jobs` and `job_state_transitions` for the objective's job tree | same |
| Did the Gmail, Notion or artifact steps run at all? | `outputs`, `documents`, `tool_calls` for the objective | same |

Until that authorisation is given, F1–F5 remain AMBER. They cannot become GREEN, and no fix claiming to cure the incident can be verified against the real records.
