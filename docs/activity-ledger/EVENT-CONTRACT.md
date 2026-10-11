# Unified Activity Ledger - event contract

Schema version **1**. This is what `app.activity_read`, `app.activity_chain` and the `activity_feed` / `activity_chain` gateway sections return, and
what `public.activity_events` stores for the native subset. Nullability is explicit: a field not marked "always" may be `null`, and `null` means
"the source does not say", never "none".

## One event

```json
{
  "id": "0b575985-...",             "type": "job.delegated",       "schema_version": 1,
  "at": "2026-10-11T05:48:25.490352+00:00",
  "category": "job",               "severity": "info",            "status": "requested",
  "visibility": "user",
  "actor_kind": "agent",           "actor": "chief-of-staff",      "agent": "research-director",
  "project_id": "…",               "project": "Harvest Lane",
  "job_id": "…",                   "parent_job_id": "…",           "correlation_id": "…",
  "causation_id": "…",
  "source_interface": "telegram",  "tool": null,                  "model": null,
  "summary": "Handed office.instruction to Research Director",
  "metadata": { "kind": "office.instruction", "attempt": 1, "from_state": null, "to_state": "queued" },
  "evidence": { "kind": "job", "id": "…" },
  "provenance": "projected",       "source": "job_state_transitions"
}
```

| Field | Type | Null | Meaning |
|---|---|---|---|
| `id` | uuid | never | Stable. Projected: `md5(source:pk:type)`. Native: `activity_id`. Action ledger: `event_id`. Same row, same id, every read. |
| `type` | text | never | `family.name`, lower snake case, in `public.activity_event_types` (or an action ledger type, which that table does not list) |
| `schema_version` | int | never | `1`. Raised only by an incompatible change; additive fields do not raise it |
| `at` | timestamptz | never | When it happened: the writer's clock (native) or the source row's own timestamp (projected). A delivery failure has no `failed_at` column and uses `updated_at`; say so when you read it |
| `category` | text | never | `request`, `job`, `approval`, `output`, `delivery`, `tool`, `reliability`, `usage`, `integration`, `external`, plus the action ledger's `task`, `document`, `calendar`, `sync`, `research`, `other` |
| `severity` | text | never | `debug`, `info`, `notice`, `warning`, `error`, `critical` |
| `status` | text | never | `recorded`, `requested`, `authorised`, `declined`, `attempted`, `completed`, `confirmed`, `failed`, `blocked`, `cancelled`, `scheduled`, `expired` |
| `visibility` | text | never | `user`, `diagnostic`, `operator` (see below) |
| `actor_kind` | text | never | `user`, `agent`, `system`, `external` |
| `actor` | text | never | `you` for the office's own person; a staff slug; `office`; `worker`; `external:<name>` |
| `agent` | text | yes | The staff slug the event is about, when the source says |
| `project_id`, `project` | uuid, text | yes | The dashboard project, when there is one; `project` is its name |
| `job_id`, `parent_job_id`, `correlation_id` | uuid | yes | The work this belongs to. `job_id` filters include the job's descendants |
| `causation_id` | uuid | yes | The id of the event that caused this one, **only where a source column states it** (see ARCHITECTURE.md section 5) |
| `source_interface` | text | yes | `teamhq`, `chatgpt`, `claude`, `mcp`, `telegram`, `slack`, `voice`, `worker`, `system`, `external` |
| `tool`, `model` | text | yes | The tool or model used, when the source says |
| `summary` | text | never | One line for a person. At most 300 characters, **never message text, document text or a destination id**, credential-shaped text redacted |
| `metadata` | object | never | Event-specific, typed by `type`; at most 4 KB, 4 levels, 40 keys at a level; credential-named and content-named keys are replaced by a marker |
| `evidence` | object | never | `{kind, id}`: a reference to the authorised record (`job`, `inbound_command`, `blocker`, `output`, `delivery`, `inference_usage`, `event`, `impediment`, `routing_decision`, `activity_event`). Open it through the existing authorised reader |
| `provenance` | text | never | `projected` (read from the table that owns it), `native` (written to `public.activity_events`), `external` (an external worker's report) |
| `source` | text | never | The table it came from |

`metadata.superseded_by` appears on a native event that a later `activity.corrected` replaced; the original is kept.

## Status: the lifecycle that must not be blurred

`requested` (asked) to `authorised` (a person said yes) to `attempted` (started) to `completed` (finished) to `confirmed` (an external service said so).

- A delivery is `attempted` when the send began, `confirmed` when the provider returned a message reference (the table refuses `sent` without one),
  `failed` when it did not, `cancelled` when it was deliberately withheld.
- A model call is `completed` or `failed`; cost is in the metadata with its provenance (`provider_reported`, `authoritative`, `calculated`,
  `estimated`). A cost is never invented: a row with no provider figure says `estimated` or `calculated` with the number the office computed.
- A yes or a no is never inferred. `approval.granted` is claimed only for a question that is positively an approval (it names what answering performs or grants) answered with an option other than
  the decline its writer named; `approval.denied` only for that named decline; any other answer is `approval.answered` with the option as text (`metadata.answer`), because several writers name no decline.
  A question the office closed itself is `approval.withdrawn`; one nobody answered is `approval.expired`; a settled question with no answerer is "Closed", not a yes.
- A delivery is `confirmed` only when the provider returned a message reference. One a person marked as arrived (`message_ref` beginning `confirmed-by-person:`) is `completed` with
  `provider_confirmed: false` and `confirmed_by_person: true`. An `indeterminate:*` failure says it could not be confirmed (`indeterminate: true`), not that it failed to send.
- The time of a settled `delivery.failed` or `delivery.suppressed` is the row's last change (`updated_at`), the only column that records when; a consumer needing the first time reads the delivery.
- Actor: a job a person stopped is theirs (`actor_kind: user`, `you`); a worker's bookkeeping (queued, parked, waiting, retry, an internal step) is `system`/`office`; a hand-off is the parent's agent
  and only a job whose origin is a child is `job.delegated` (an approval's or a duty's job is `job.created`). A failure reason (`metadata.reason`) is returned only to a diagnostic reader.

### Human review provenance (phase 3)

The ledger distinguishes six states and never infers a positive from ambiguous data:

| State | Where it comes from | What the event says |
|---|---|---|
| requested / pending | `blockers` open, `outputs.reviewer_status = pending` | `approval.requested` (`requested`); an output with no review has no `output.reviewed` row |
| answered by a person | `blockers.answered_by` is recorded | `approval.granted`/`denied`/`answered`, `actor_kind: user`, `you`; yes/no only by the rules above |
| closed by the office | a settled question with no answerer | `approval.answered` "Closed" or `approval.withdrawn`; never a yes |
| declined | the writer's named decline option, or `reviewer_status = rejected` | `approval.denied` / `output.reviewed` `declined` |
| expired / withdrawn | state `expired`, `cancelled` | `approval.expired`, `approval.withdrawn` |
| claimed by an external worker | a report through the external door | `external.*`, `actor_kind: external`; **never** a person's decision |

`output.reviewed` is derived from `outputs.reviewer_status`, which is written by four different things: the worker's quality gate (a staff reviewer is recorded in `reviewed_by`), supersession (the
system), a person pressing Import (`reviewed_by` is null) and a person pressing Decline (`reviewed_by` is null). Because a null `reviewed_by` cannot tell a person from the system, the event is
attributed to `system`/`office` and its summary says "(reviewer not recorded)", with `metadata.reviewer_recorded = false`; with a recorded staff reviewer it is `agent` and that slug,
`reviewer_recorded = true`. **It is never attributed to a person.** The hq actions that a person presses (`app.decide_output`, import) take no office or actor argument, so there is no verified
identity to record in the same transaction; instrumenting them would be a claim the database cannot back, so no native `external.review_decided` or person-attributed `output.reviewed` writer exists.
The day a person-verified decision path exists (a gateway action that passes the verified person), it should call `app.record_activity` (strict, in the same transaction) with `actor_kind: user`; until then
`external.review_decided` has no writer and the external door refuses it. Proved by `activity-ledger` (review provenance checks, sabotage S33) and `activity-external-attack` (a worker cannot record a review).

## Visibility

| Level | Who | What |
|---|---|---|
| `user` | the office's own people, on the Activity page | the headline of the work: requests, delegations, completions and failures, approvals, outputs, outcomes of deliveries, recoveries a person should know, external results held for review |
| `diagnostic` | the person debugging their own office | routing, internal job steps, retries, delivery attempts, model calls and cost, tool calls |
| `operator` | the deployment's operator only | the deployment's own mechanics (recovery sweeps). Anyone else asking for it is given `diagnostic` |

A native event may never be written at a lower level than its type's default (a trigger refuses it), so a diagnostic type cannot be dressed as ordinary activity.

## Taxonomy (`public.activity_event_types`)

Projected (read from the table that owns the fact):

| Type | Category | Default visibility | From |
|---|---|---|---|
| `request.received` | request | user | `inbound_commands` |
| `request.routed` | request | diagnostic | `routing_decisions` |
| `job.created`, `job.started`, `job.paused`, `job.waiting`, `job.state_changed`, `job.impeded`, `retry.scheduled` | job / reliability | diagnostic | `job_state_transitions`, `job_impediments` |
| `job.delegated`, `job.completed`, `job.failed`, `job.cancelled` | job | user | `job_state_transitions` |
| `action.blocked` | approval | user | `job_impediments` (kind `needs_permission`) |
| `approval.requested`, `.granted`, `.denied`, `.expired`, `.withdrawn`, `.answered` | approval | user | `blockers` |
| `integration.rate_limited` | integration | diagnostic | `job_pauses` (reason `rate_limited`; evidence kind `job_pause`) |
| `output.created`, `output.reviewed` | output | user | `outputs` |
| `delivery.succeeded`, `delivery.failed` | delivery | user | `deliveries` |
| `delivery.attempted`, `delivery.suppressed` | delivery | diagnostic | `deliveries` |
| `inference.completed` | usage | diagnostic | `inference_usage` |
| any `public.events` action type | (action ledger) | user | `events` |

Native (written to `public.activity_events`), with their durability class (`ARCHITECTURE.md`, "Audit durability"): `system.recovered` (operator, operational), `budget.threshold_reached` (user, operational,
written by `defer_over_budget`), `tool.call_requested`, `tool.call_completed`, `tool.call_failed` (diagnostic; the names are deliberately not `tool.requested`, which is a type of the action ledger),
`activity.corrected` (user, **critical**: strict writer only), `external.review_decided` (user; not worker-writable: a person's decision).

External (`external_writable`): `external.research_started`, `external.research_completed`, `external.output_produced`, `external.skill_proposed`,
`external.evaluation_completed`, `external.usage_recorded`, `external.worker_error`. See `EXTERNAL-AGENT-CONTRACT.md`. A worker's evidence reference is cleaned, bounded to 1 KB and always `kind: external`;
the correlation is taken from its job; at most 300 new reports an hour per worker and 1 000 per office.

The candidate names in the brief that the office already represents differently are **not duplicated**: `request.transcribed` is `metadata.transcribed`
on `request.received`; `job.timed_out` and `retry.executed` are the `retry.scheduled` and the next `job.started`; `tool.call_requested` and
`tool.call_completed` for a **consequential** action are the action ledger's own type (the action ledger is the audit record with a reversal); `approval.*` is the existing
approval vocabulary; `delivery.*` is the existing state machine; `system.recovered`, `budget.threshold_reached` and `integration.rate_limited` are native because nothing records them.

## Reading

```
GET  hq-api?section=activity_feed&visibility=diagnostic&project=<uuid>&agent=<slug>&job=<uuid>&correlation=<uuid>
        &since=<iso>&until=<iso>&category=<word>&severity=<min>&status=<word>&source=<word>&type=<type>
        &limit=<1..200>&before_at=<iso>&before_id=<uuid>
  ->  { enabled, visibility, events: [...], next: {at, id} | null, partial: bool, generated_at }
GET  hq-api?section=activity_chain&job=<uuid> | &correlation=<uuid>      (needs one of them)
  ->  { enabled, correlation_id, complete: bool, partial: bool, truncated: 'oldest' | null, events: [...] }
                                                                          oldest first, at most 500; when cut at the bound it is the OLDEST events that are missing
GET  hq-api?section=activity_ledger                                      the Team HQ row shape (`who` is the raw slug, `who_name` the display name)
GET  hq-api?section=activity_health                                      includes indexes_missing (empty when the staged index build has completed)
```

Word lists and shapes are checked at the gateway and refused by name with a 400. A cursor's instant is passed on **as written** (it has microseconds).
With the switch off every section answers `{ enabled: false }` and nothing else.

### The Team HQ row (`activity_ledger`, phase 4)

`app.activity_for_the_page` returns one row per user-visible event: `id`, `who` (the raw actor), `who_name` (what a person reads: "You", a specialist's role name, or "Name (external worker)"), `kind` (the actor kind),
`summary` (the whole sentence), `verb` and `what` (the sentence split at its first space, kept for the older renderer), `project`, `when`, `at`, `via`, `category`, `severity`, `status`, `evidence`, `provenance`.
Wording rules a consumer may rely on: a person's own act reads as a sentence starting "You" and an outside worker's report never does (it is named by `who_name`, and its stored `[external:<name>]` marker is not repeated in `summary`);
a job is "a request" (`office.instruction`) or its dotted kind in words; an approval is "You said yes/no" only on the evidence rules above, otherwise "Answered"; a delivery is "Sent to <channel>" only when the provider confirmed it, "Marked as delivered by you"
when a person said so, "Could not send" when it failed; a review with no recorded reviewer says "(reviewer not recorded)". Diagnostic events (tool calls, usage, worker errors, recoveries) are not in this answer; they are in `activity_feed?visibility=diagnostic`.
A page must place the actor before the sentence only when `kind` is `agent` or `external` (`ledgerLine` in `web/studio/app.js`).

### Per-office activation

The ledger **fails closed**. `activity.ledger_enabled` is the master switch (only JSON `true` is on) and always wins. With it on, `activity.ledger_offices` decides who is covered: a JSON array of office UUID strings = those offices only; exactly `{"version":1,"mode":"all"}` = every office; **absent, JSON `null`, `[]` or anything else (a bare string, another version or mode, an extra key, a number, malformed data) = no office**. Every writer (native, safe, external), every reader, the gateway sections and Team HQ ask the one decision, `app.activity_ledger_covers(office)`;
the zero-argument `app.activity_ledger_on()` is the master alone. The list can never turn the ledger on by itself, and nothing is cached. The health reading (`activity_health`) reports `master_on`, `scope` (`none`, `allowlist`, `all_offices` or `invalid`) and `enabled` for the office. The operator procedure is stage D of `MIGRATION-PLAN.md`.

## Versioning

- Additive changes (a new type, a new metadata key, a new field) do not change `schema_version`. A consumer ignores what it does not know.
- A new **type** is a row in `public.activity_event_types` (data, not code). A native type also needs a writer; the test
  `tests/activity/taxonomy.test.ts` names the types that have none yet, so adding either side alone fails.
- A type is never repurposed. A retired type stays in the table.
- An incompatible change (a field's meaning, a status removed) raises `schema_version` and the gateway serves both for a release.
