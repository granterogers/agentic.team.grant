# Unified Activity Ledger - architecture

Status: built on `feature/unified-activity-ledger`, **default off**, verified on the isolated replica only. Not merged, not deployed, no
production contact. Migrations `1060` and `1061`. Read `PROGRESS.md` for what is done and what is not, `EVENT-CONTRACT.md` for the shape of an
event, `SECURITY.md` for the threat model, `EXTERNAL-AGENT-CONTRACT.md` for Hermes and other outside workers, `MIGRATION-PLAN.md` for rollout.

## 1. The decision, in one paragraph

The office already records its own history, in the table that owns each fact. A new table that copied that history would be a second source of
truth that can disagree with the first, and an audit row written beside a state change can be omitted by a path nobody remembered. So the ledger
is **one read model over the tables that already own each fact** (`app.activity_read`), plus **one small append-only table for the activity
that has no other home** (`public.activity_events`). Nothing is copied, nothing is back-filled, nothing is reconstructed to make the feed look
complete.

## 2. Existing-system audit

What the office records today, which table is authoritative, and how the record is made.

| Fact | Authoritative table | How it is written | What the ledger reads from it |
|---|---|---|---|
| A job moved to a new state | `job_state_transitions` | **By trigger, in the same transaction as the state change** (`app.log_job_creation`, `app.enforce_job_transition`): no code path can move a job unrecorded | `job.created`, `job.delegated`, `job.started`, `job.paused`, `job.waiting`, `retry.scheduled`, `job.completed`, `job.failed`, `job.cancelled`, `job.state_changed` |
| A person's message or voice note arrived | `inbound_commands` | By the channel adapter, before routing (button presses carry `callback_action` and are not requests) | `request.received` (never the text; only voice/transcribed flags) |
| Who was asked to handle it | `routing_decisions` | By the router, one row per job | `request.routed` |
| An approval was asked and answered | `blockers` | By the office (ask) and by the person's answer | `approval.requested`, `approval.granted`, `approval.denied`, `approval.expired`, `approval.withdrawn` |
| An action was stopped for want of a permission | `job_impediments` (append-only) | By the gate that refused | `action.blocked`, `job.impeded` |
| A specialist produced an answer, and it was reviewed | `outputs` | By the handler; review by the reviewer | `output.created`, `output.reviewed` (never the body) |
| A message was sent, failed or was withheld | `deliveries` | By the delivery state machine (`claimed` to `sent`, `failed`, `suppressed`; `sent` requires a provider `message_ref`) | `delivery.attempted`, `delivery.succeeded`, `delivery.failed`, `delivery.suppressed` |
| A model was called, and what it cost | `inference_usage` | By the provider router; `provenance` is `authoritative` (provider reported), `calculated` or `estimated` | `inference.completed` with the cost status the row has |
| What the office did, with the means to undo it | `events` (append-only, reversible, compensating) | By `app.append_event` from handlers | the action's own type (`task.created`, `finding.*`, ...) with the reversal |
| A recovery sweep reclaimed work a dead worker held | **nothing** (the transition to `retrying` is recorded; the reclaim is not) | (new) `activity_events` | `system.recovered` |
| A rate limit, a budget threshold, a tool call, an external worker's report | **nothing** | (new) `activity_events` | `integration.rate_limited`, `budget.threshold_reached`, `tool.*`, `external.*` |

### Kinds of record, kept apart

| Kind | Purpose | Where |
|---|---|---|
| Operational state | what is true now and drives the work | `jobs`, `blockers`, `deliveries` rows |
| Historical events | what happened, in order | `job_state_transitions`, `events`, now `activity_events` |
| Audit records | who decided what, with the means to refute | `events` (before/after, reversal), `blockers` (answer, answerer), `job_impediments` |
| User-facing activity | what a person wants to read | the **visibility `user`** subset of the read model |
| Telemetry | how the system performed | `inference_usage`, the diagnostic subset (`visibility = diagnostic`) |
| Debug logs | for an engineer | not in the ledger (worker logs, `job_trace`) |

The ledger shows the first four through one contract and keeps telemetry behind a visibility level. It does not absorb debug logs.

### Gap analysis

| Gap | Resolution |
|---|---|
| No single way to read "what has the team been doing" across these tables | `app.activity_read`, one contract, one cursor, one place that applies the harness and office rules |
| No causal link from a request to its job, from a job to its child, from a question to its answer, from an attempt to its outcome | `causation_id` on every projected event where a source column states the cause (see section 5); nothing inferred |
| `attempted`, `completed` and `confirmed` were not distinguished anywhere a person reads | the `status` vocabulary (section 5) |
| No home for activity that is not a state change | `public.activity_events` |
| `inference_usage` cost provenance was not carried to a reader | `cost_status` in the event metadata, never defaulted |
| `events` rows carry their own vocabulary and no severity, status or visibility | projected as their own type with defaults from `activity_event_types` |
| No bounded read of "everything for this piece of work" | `app.activity_chain` (oldest first, 500 events, says when it is incomplete) |
| No measurement of the ledger's own health | `app.activity_ledger_health` and `public.activity_write_failures` |

Not changed, deliberately: `public.events` and `app.hq_studio_lately` (the existing Activity reader) are untouched and still answer exactly as before.

## 3. Layout

```
authoritative tables (jobs, transitions, inbound_commands, routing, blockers, deliveries, outputs, usage, impediments, events)
        \                                                                       |
         \__ read, never copied __                                              |
                                  \                                             |
public.activity_events  (native, append-only; recovery, thresholds, tools, external)   <-- app.record_activity (strict, same transaction)
                                  \                                                   <-- app.record_activity_safely (worker; never raises)
                                   \                                                  <-- app.record_external_activity (the one outside door)
                                    v
                         app.activity_read  --> public.activity_read ----> hq-api: activity_feed
                         app.activity_chain --> public.activity_chain ---> hq-api: activity_chain
                         app.activity_for_the_page -> public.activity_for_the_page -> hq-api: activity_ledger  (the existing Activity page's row shape)
                         app.activity_ledger_health -> public.activity_ledger_health -> hq-api: activity_health
```

`public.activity_event_types` is the taxonomy as data: category, source (`projected` or `native`), default visibility and severity, and which
native types an external worker may report.

## 4. Delivery and integrity guarantees (what is claimed, and what is not)

| Property | Guarantee | How | Proved by |
|---|---|---|---|
| A job transition cannot happen without its record | **Atomic with the change.** The event is the transition row itself | existing trigger, not new code | not new; relied upon |
| A native event is never written twice | **Effectively-once per (office, idempotency key)** | unique `(office_id, idempotency_key)` and `on conflict do nothing`; a key reused for a different type is refused | `activity-ledger`: same key twice, twelve concurrent writers of one key, twelve of twelve distinct |
| A native event commits or rolls back with the caller | **Atomic** when the strict writer is called inside the caller's transaction | plain insert | `activity-ledger`: rollback leaves nothing |
| The worker is never stopped by the ledger | **Best effort, never fatal** | `record_activity_safely` catches in a subtransaction and counts the failure | `activity-worker`: writer missing, sweep still reclaims |
| A failure to write is not silent | **Counted**, bounded | `public.activity_write_failures`, at most 200 an hour per office; its writer records no event (no recursion) | `activity-ledger` |
| History is not rewritten | **Append-only** | update, delete and truncate refused by the trigger `public.events` uses; a correction is a new row that supersedes | `activity-ledger` |
| An attempt is not read as a success | **Status vocabulary** | `attempted`, `completed`, `confirmed` are distinct; a delivery is `confirmed` only with a provider `message_ref` | `activity-ledger` |
| Nothing from a suite reaches a person's feed | **Canonical predicate** | `jobs.synthetic`, `jobs.is_fixture`, then `app.harness_job` | `activity-ledger` (a control that is shown when real; a job only the canonical predicate recognises) |

**Not claimed.**

- **No exactly-once across an external service.** A delivery can be sent and the process die before the row says so; the delivery state machine's
  own rules (`docs/delivery/DELIVERY-STATE-MACHINE.md`) decide what is retried. The ledger reports the row's state, never a belief.
- **No guarantee a native event is recorded when the worker crashes between the work and the call.** The native events are the ones with no state
  change of their own; for the ones that matter (`system.recovered`) the underlying fact (the transition to `retrying`) is recorded by trigger either way.
- **Ordering is `(occurred_at, id)`.** `occurred_at` is the writer's clock for native events and the source row's own timestamp for projected ones. Two
  events in one microsecond are ordered by id, which is deterministic, not causal. Causality is `causation_id`, not time.
- **Historical coverage is whatever the source tables hold**, which is complete for jobs (trigger-written from the day it existed) and for deliveries,
  approvals and usage as of when each table began; nothing is claimed before that.

## 5. The read model

One function, `app.activity_read`, built from fifteen sources: requests, routing, the job lifecycle, approvals asked, approvals settled, impediments,
outputs produced, outputs reviewed, deliveries (attempted, succeeded, failed, suppressed: four, each with its own time column), model calls, the
action ledger, and the native table. Every source is bound to the office the caller names; the gateway takes it from the verified session.

- **Deterministic ids.** A projected event's id is `md5(source : primary key : type)` as a uuid, so the same row always gives the same id and a
  client can link, deduplicate and name a cause. Native events use their `activity_id`; `public.events` rows use their `event_id`.
- **Causation only where a column says so.** `request.routed` and a root `job.created` point at the `request.received` of the job's
  `origin_command_id`; a `job.delegated` points at its parent job's creation; an `approval.*` decision at its `approval.requested`;
  a `delivery.succeeded` or `delivery.failed` at its `delivery.attempted`; an `output.reviewed` at its `output.created`; a compensating action at
  the action it compensates. Everything else has no cause recorded and says so (`null`).
- **Status** (what is true of the thing): `recorded`, `requested`, `authorised`, `declined`, `attempted`, `completed`, `confirmed`, `failed`,
  `blocked`, `cancelled`, `scheduled`, `expired`.
- **Visibility**: `user` (the ordinary Activity page), `diagnostic` (the person debugging their own office), `operator` (the deployment's operator
  only; anyone else who asks for it is given `diagnostic`, never an error that names the difference).
- **Keyset paging**, never an offset: the cursor is `(at, id)`; a page is bounded at 200; `next` is `null` on the last page.
- **Filters**: project, agent, job (the job and every job under it), correlation, date range, category, minimum severity, status, source interface,
  type, visibility.
- **Chain**: `app.activity_chain(job | correlation)` is the whole story of one piece of work, oldest first, bounded at 500, `complete: false`
  when it is longer.

### Performance (measured, replica, not production)

The first design evaluated every column of every row of every source and the canonical harness predicate for every candidate. At 3 000 jobs, 24 000
transitions and 18 000 model calls a page of fifty took **1.5 to 3.8 s**; the plan showed the cost was neither the filters nor the join but
(a) columns computed for rows that would never be shown, (b) the harness predicate (about 0.2 ms a call) run per source, and (c) a seed artefact
of identical timestamps defeating the early exit. The shipped design reads in three stages:

1. `z<i>`: each source's newest rows by **its own time column and the id it gives its events** (an index range scan; nothing computed for a row not shown);
2. `s<i>`: the contract columns for those rows, then every filter the caller asked for;
3. the canonical harness test, **once per distinct job among only the newest candidates of all sources together**.

A page is trusted only when nothing unread could belong in it: a source that returned a full pool must reach strictly further back, by the full
`(time, id)` key, than the page's last row. Otherwise the pool is widened (x8, to 16 384) and the page rebuilt; past that the answer says
`partial: true`. The initial pool is twice the page, so the ordinary case is one pass.

Same data, same machine, 15 runs each (milliseconds, p50; `scripts/isolated/activity-ledger-perf.ts`):

| Read | 300 jobs (2 403 transitions) | 3 000 jobs (24 003 transitions, 18 000 model calls, 3 000 deliveries, 3 500 native) |
|---|---|---|
| newest 50, ordinary | 63 | **100** |
| newest 50, diagnostic | 85 | 201 |
| one project, diagnostic | 86 | 183 |
| page three by cursor | 84 | 177 |
| one agent | 165 | 465 |
| severity >= error (selective) | 242 | 1 468 |
| one root job's chain | 503 | 929 |
| the existing `hq_studio_lately`, for scale | 88 | 755 |

Ten times the history cost the newest page **1.6 times** as much. The selective filters are the weak spot and are stated as such: a filter whose
matches are rare reads wide pools to find them (it is still exact, or says `partial`). JIT is switched off in the function: the query is wide
enough to cross `jit_above_cost` and the compile took about 650 ms of a 70 ms query.

Writes (same run, one round trip each): strict **1.0 ms**, safe **1.1 ms**, with the switch off **0.2 ms**. Twenty concurrent connections, fifty rounds each, every round
a distinct key plus a key all twenty repeat: no error, no lost event, shared keys written once, about 4 300 calls a second. A native event with its indexes
is about **660 bytes**. The ledger adds **no trigger** to `jobs`, `job_state_transitions`, `deliveries`, `inbound_commands`, `blockers`, `outputs`
or `inference_usage`, so none of their critical paths costs anything it did not.

Additive indexes (11) give each source a newest-first, per-office path; none changes a result. They are non-concurrent `create index` statements
inside the migration, so on a large table they hold a write lock while they build (see `MIGRATION-PLAN.md`).

## 6. Team HQ

The existing Activity page is untouched visually. `app.activity_for_the_page` returns the ledger in the shape `app.hq_studio_lately.office[]` already
has (id, who, kind, verb, what, project, when, at, via, category, reversible, undo_with) plus severity, status, evidence and provenance, which the
current renderer ignores. `needLately` in `web/studio/app.js` asks for it **after** the existing read and replaces the list of rows **only when the
ledger answers `enabled` with at least one row**; off, absent, empty or failing, the page's own list stands, so switching the ledger on can never empty it
(`tests/web/activity-ledger-wiring.test.ts`, each property with a mutant that must fail). Deferred: a richer page (filters, a chain view, severity
badges, links to the evidence record). That is a design task and is not attempted here.

## 7. Historical data

There is nothing to back-fill, by design: the read model reads the authoritative tables, so history that exists is visible the moment the switch is
on, with its original timestamps, and nothing was created to represent it. A native event has no history before the day it was first written.
A materialised or reconstructed history is not needed to answer any question in the brief, and writing one would create exactly the second source
of truth this design avoids. The one case that would want it (a faster read at much larger volumes) is a performance question for later, measured.

## 8. Implemented, partial, proposed

| Item | State |
|---|---|
| Taxonomy as data, native table, redactor, strict/safe/external writers, default-off switch | **Implemented** (1060) |
| Unified read model, chain, page adapter, health, indexes, public wrappers | **Implemented** (1061) |
| Gateway sections `activity_feed`, `activity_chain`, `activity_ledger`, `activity_health`; page hook | **Implemented**, off until the switch is on |
| Native event writer in the worker | **Partial**: `system.recovered` only |
| Native `tool.*`, `integration.rate_limited`, `budget.threshold_reached`, `activity.corrected` | **Proposed**: in the taxonomy and writable by SQL; no caller yet (named in `tests/activity/taxonomy.test.ts`, so adding one is a decision) |
| External worker door (`app.record_external_activity`) | **Implemented in SQL**, proved, **not exposed** through any gateway: the authenticated boundary that will call it is not built |
| Richer Activity UI | **Proposed** |
| A materialised read model | **Not needed**; revisit only on measured need |
| Retention policy | **Stated** in `SECURITY.md`; nothing deletes |
| Rolling-deploy matrix on real versions | **Not run**: the new-worker-on-old-schema case is proved (writer missing); old-worker-on-new-schema is true by construction (additive) |

## 9. Checks this change could not run

`check:callers`, `check:consumed`, `check:gateway-wrappers`, `check:anon-exposure`, `check:machine-key`, `check:office-callers` and
`check:carrier-writers` read the production catalogue and refuse to run without `ALLOW_PRODUCTION_CHECKS=1`, which this work was not given and did
not set. What was done instead, so a reviewer can run them: `check:ownership` and `check:office-edges` (replica mode) pass with the three new
tables classified; `check:proofs`, `check:migrations`, `check:secrets`, `check:templates`, `check:deployment-state` pass; and for the others the
reasoning is stated: every public function takes `p_office` first and is executable by `service_role` alone (asserted by `activity-ledger` and by
`tests/gateway/activity-sections.test.ts`); no browser role holds any privilege on the new tables or functions (asserted); every insert names its
office; `app.record_external_activity` has no caller by design and is baselined in `docs/testing/callers-baseline.json` with a reason; no new table is
written and never read (`activity_write_failures` is read by the health reading). A reviewer with the flag should run all seven before merging.
