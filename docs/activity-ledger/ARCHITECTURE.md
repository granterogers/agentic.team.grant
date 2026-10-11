# Unified Activity Ledger - architecture

Status: built on `feature/unified-activity-ledger`, **default off**, verified on the isolated replica only. Not merged, not deployed, no
production contact. Migrations `1060`, `1061` and `1062`. Read `RELEASE-READINESS.md` for the verdicts and the evidence, `PROGRESS.md` for what is done and
what is not, `EVENT-CONTRACT.md` for the shape of an event, `SECURITY.md` for the threat model, `EXTERNAL-AGENT-CONTRACT.md` for Hermes and other outside
workers, `MIGRATION-PLAN.md` for rollout.

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
| An approval was asked and answered | `blockers` | By the office (ask) and by the person's answer | `approval.requested`, `approval.granted`, `approval.denied`, `approval.expired`, `approval.withdrawn`, `approval.answered`. A yes is claimed only for a question that is positively an approval (it names what answering performs or grants) answered with an option other than the decline its writer named; a no only for that named decline; any other answer is `approval.answered`, with the option as text, because several writers name no decline and the record cannot say which it was |
| An action was stopped for want of a permission | `job_impediments` (append-only) | By the gate that refused | `action.blocked`, `job.impeded` |
| A specialist produced an answer, and it was reviewed | `outputs` | By the handler; review by the reviewer | `output.created`, `output.reviewed` (never the body) |
| A message was sent, failed or was withheld | `deliveries` | By the delivery state machine (`claimed` to `sent`, `failed`, `suppressed`; `sent` requires a provider `message_ref`) | `delivery.attempted`, `delivery.succeeded`, `delivery.failed`, `delivery.suppressed` |
| A model was called, and what it cost | `inference_usage` | By the provider router; `provenance` is `authoritative` (provider reported), `calculated` or `estimated` | `inference.completed` with the cost status the row has |
| What the office did, with the means to undo it | `events` (append-only, reversible, compensating) | By `app.append_event` from handlers | the action's own type (`task.created`, `finding.*`, ...) with the reversal |
| A recovery sweep reclaimed work a dead worker held | **nothing** (the transition to `retrying` is recorded; the reclaim is not) | (new) `activity_events` | `system.recovered` |
| Work was parked to wait out a rate limit | `job_pauses` (reason `rate_limited`) | by `app.pause_job` | `integration.rate_limited`, **projected**: the office already records the throttle it waited out |
| A spending limit held background work back | **nothing** (`defer_over_budget` moves `not_before` and writes a reason; no state changes, so no transition) | (new) `activity_events`, written by 1062 inside `defer_over_budget` | `budget.threshold_reached`, once per office, agent and day |
| A plan step ran a tool | **nothing** | (new) `activity_events`, written by the plan executor after the autonomy policy said proceed | `tool.call_requested`, `tool.call_completed`, `tool.call_failed` (diagnostic; the capability, step and outcome, never an input or an output) |
| An external worker's report | **nothing** | (new) `activity_events`, through the one door | `external.*` |

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

### Audit durability (what is lost when a write fails)

`public.activity_event_types.durability` classes every type, and each class has a stated consequence that `scripts/isolated/activity-ledger-durability.ts` proves by
breaking the path on purpose (the ledger table renamed out from under the writer, then its failure counter too, inside a transaction that is rolled back):

| Class | Types | Written how | When the write fails |
|---|---|---|---|
| `derived` | every projected type (job, request, approval, output, delivery, usage, `integration.rate_limited`, the action ledger) | **not written**: read from the table that owns the fact | nothing to lose: the owning table is the record |
| `critical` | `activity.corrected` (a correction supersedes an earlier record, so losing it leaves the wrong record standing) | the **strict** writer, in the transaction of the change it records | the change fails with it; the best-effort writer **refuses** the type, counts the refusal and `critical_via_best_effort_24h` shows it |
| `operational` | `system.recovered`, `budget.threshold_reached`, `external.*` | best effort (`record_activity_safely`), or the external door (which raises to its caller) | returns null, never raises, leaves the caller's work, is counted (200 an hour per office) |
| `diagnostic` | `tool.call_*` | best effort | the same, and nothing depends on it |

There is no event type about the ledger failing to write, and the counter's own writer records no event, so a failing ledger cannot write about itself (no loop). What is
deliberately **not** claimed: an operational event is not guaranteed to exist after a crash between the work and the call; for those the underlying fact is recorded elsewhere
(the transition to `retrying`, the job's `state_reason`, the job_pauses row).

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

Same data, same machine, 15 runs each (milliseconds, p50; `scripts/isolated/activity-ledger-perf.ts`). **Before** is the three-stage design above with filters applied
after each source's newest rows; **after** pushes the selective filters into each source's own query (below):

| Read | 300 jobs, before | 300 jobs, after | 3 000 jobs, before | 3 000 jobs, after |
|---|---|---|---|---|
| newest 50, ordinary | 63 | 107 | 100 | 108 |
| newest 50, diagnostic | 85 | 107 | 201 | 194 |
| one project, diagnostic | 86 | 107 | 183 | 201 |
| page three by cursor | 84 | 90 | 177 | 272 |
| one agent | 165 | **68** | 465 | **108** |
| severity >= error (selective) | 242 | **69** | 1 468 | **92** |
| one root job's chain (up to 500 events, three pages) | 503 | 456 | 929 | 911 |
| the existing `hq_studio_lately`, for scale | 88 | 87 | 755 | 810 |

The "after" column is the final code (sixteen sources, including the throttle projection). The rows that did not change (newest page, project, cursor) vary by tens of milliseconds between runs
on a shared laptop (the same read measured 177 to 272 ms across four runs of the cursor case); the 300-job newest-page reads went from 63-86 ms to 107 ms between the first and the last measurement,
which is not attributed (a shared machine and one more source are both candidates and neither was isolated), so read the unchanged rows as "no change worth a claim" and the 300-job rise as unexplained. The two selective reads that were the stated weak spot are 2.5 and 16 times faster at 24 000 transitions. Ten times the history cost
the newest page **1.0 to 1.6 times** as much. JIT is switched off in the function: the query is wide enough to cross `jit_above_cost`
and the compile took about 650 ms of a 70 ms query.

**Pushdown.** A job, a correlation, a project, a severity, a category, a type or an agent names a small set of rows however busy the office is, so each is applied inside each source's own
query rather than to its newest N rows. The jobs under a job at any depth (`jset`) and the jobs of a correlation (`cset`) are computed once; each source's possible event types are known with the
state of the owning row that produces them, so a source that cannot emit an allowed type is not read and one that can is asked only for rows in the right state; an agent is a column, or one indexed
lookup, in every source. Every predicate is **wider** than the outer filter, never narrower, so none can drop a row the filter would keep. That is what is proved, not the plan:
`scripts/isolated/activity-ledger-equivalence.ts` compares 45 filters, alone and combined, by id and in order, with the same filter applied to the whole history, over data holding every job,
delivery and approval ending; it goes red when one predicate is made too narrow. A filter the read model cannot push (status, source interface) still works by widening the pool and says
`partial: true` past 16 384 rows. Before this, a job or project older than the newest 16 384 transitions came back `partial`, and `activity_chain` reported `complete: true` over a lifecycle with its
first events missing; the chain now reports `partial` and is bounded exactly (it drops the **oldest** events when it truncates, and says so).

**The visibility floor reaches the native pool (phase 4).** A person's newest page reads user-visible events only. The native source's pool was the newest rows of every visibility, so when
thousands of diagnostic events (tool calls, by far the commonest native event) were the newest rows, the pool held none a person could see, the validity check widened it again and again, and the
read went from 110 ms (3 500 native events) to **1.9 s** (5 550) and, past the widening ceiling, would have returned `partial`. The visibility ceiling is now a literal predicate on that source's pool
(`a0.visibility = 'user'`, or `in ('user','diagnostic')`), served by a partial index on user-visible events (`activity_events_user_time_idx`, in 1060 because the table is born there): 123 ms at 5 550.
It is the same test the outer stage applies, applied earlier, so it is never narrower than the filter it precedes; `activity-ledger-review` floods the newest rows with 17 000 diagnostic events and requires the
older user-visible one and a non-partial page (sabotage S45; S11 removes both defences, because removing one is hidden by the other).

Writes (same run, one round trip each): strict **1.0 ms**, safe **1.1 ms**, with the switch off **0.2 ms**. Twenty concurrent connections, fifty rounds each, every round
a distinct key plus a key all twenty repeat: no error, no lost event, shared keys written once, about 4 300 calls a second. A native event with its indexes
is about **660 bytes**. The ledger adds **no trigger** to `jobs`, `job_state_transitions`, `deliveries`, `inbound_commands`, `blockers`, `outputs`
or `inference_usage`, so none of their critical paths costs anything it did not.

Additive indexes (11) give each source a newest-first, per-office path; none changes a result. They are **not** in a migration: a plain build holds a write lock for its whole duration
(measured: the writer's slowest insert 2 061 ms plain against 88 ms concurrent, on a 2 000 000 row table), so `npm run activity:indexes` builds them with `CREATE INDEX CONCURRENTLY`, idempotently
and resumably, and `activity_ledger_health.indexes_missing` says which are absent (`MIGRATION-PLAN.md`).

## 6. Team HQ

**Phase 4 correction.** Until phase 4 the ledger hook fed only the classic studio (`/classic`, unlinked): Team HQ's Activity screen (`allActivity` in `web/studio/bc/shell.js`) draws each project's own `activity` list
and never read the ledger, so activating the ledger would have changed nothing a person sees. This was found by drawing genuine ledger rows through the real gateway in a real browser
(`scripts/isolated/activity-ui-browser.sh`, 126 checks at 1440, 390 and 320 px). Team HQ now asks `ctx.ledgerActivity()`, which is null unless the ledger answered enabled with a drawable row, and then uses those rows **instead of** the per-project lists (merging
two accounts of one event is how it appears twice); null leaves exactly the old behaviour. A ledger summary is already a sentence ("You said yes: ...", "Sent to Telegram"), unlike the older feed's bare verbs, so the
actor is named only where the sentence does not carry it (`ledgerLine`): a specialist by the crew's name, an outside worker as "Name (external worker)", and a person's own acts and the office's bookkeeping not at all. Without
this a person's yes would read "Claire You said yes" and an outside worker would be shown under the first crew member. The adapter also drops the worker marker from the sentence (the name says it) and words a job as "a request"
rather than its internal kind. The Activity rows get their own title rule (`.bcitem--log`): the shared `.bcitemtitle` touch rule is a 44 px hit area around a one-line title and made a wrapped title overprint its meta line on a phone; no other list is touched.
Not changed: a project's own Activity tab still reads the project's list (the ledger can filter by project, wiring it is a design task).

Below is the original adapter description (still true of the row shape). The existing Activity page is untouched visually apart from the above. `app.activity_for_the_page` returns the ledger in the shape `app.hq_studio_lately.office[]` already
has (id, who, kind, verb, what, project, when, at, via, category, reversible, undo_with) plus severity, status, evidence and provenance, which the
current renderer ignores. `who` is the raw actor slug, exactly as `hq_studio_lately` sends it, because the page looks a face up by slug and a display name matches nobody (it would
render every agent row as the first crew member); the display name is `who_name`. `needLately` in `web/studio/app.js` starts the ledger read **alongside** the existing one, draws from the
existing answer the moment it arrives (a slow or hanging ledger cannot delay the first render), and replaces only the list of rows, and only when the ledger answers `enabled` with at
least one **drawable** row (a unique string id and a parseable instant; `ledgerRows`, which never throws) **and the page still holds the copy it drew**, so an answer that arrives after a
refresh cannot overwrite a newer one. Off, absent, empty, malformed or failing, the page's own list stands, so switching the ledger on can never empty it (`tests/web/activity-ledger-wiring.test.ts`:
the extracted source run through each of those states, and each wiring property with a mutant that must fail).

Known differences while the ledger is on, none a regression of the page: the ledger's rows are not folded (the existing list folds a burst into one line with a count, so there is no `times`),
and the counters above the list (`jobs_done` and the like) still come from `hq_studio_lately`, so a person can see a count and a list drawn from two sources. A richer page (filters, a chain view,
severity badges, links to the evidence record) is a design task and is not attempted here.

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
| Native event writers | **Implemented**: `system.recovered` (the recovery sweep), `tool.call_*` (the plan executor, after the policy says proceed), `budget.threshold_reached` (`defer_over_budget`, 1062) |
| `integration.rate_limited` | **Implemented as a projection** of `job_pauses` (reason `rate_limited`); no second write |
| `activity.corrected`, `external.review_decided` | **Not wired, on purpose**: a correction is an operator act through the strict writer (a critical type), and a worker may not assert that a person decided something. Named in `tests/activity/taxonomy.test.ts`, so adding a caller is a decision. Rate limits of services other than the model providers (Slack, Notion, GitHub, Telegram) are handled in each client and recorded nowhere; recording them needs one shared seam in those clients, a larger change than this one |
| External worker door (`app.record_external_activity`) | **Implemented in SQL**, proved, **not exposed** through any gateway: the authenticated boundary that will call it is not built |
| Richer Activity UI | **Proposed** |
| A materialised read model | **Not needed**; revisit only on measured need |
| Retention policy | **Stated** in `SECURITY.md`; nothing deletes |
| Per-office activation | **Implemented** (phase 4): `app.activity_ledger_covers(office)` = the master switch AND an optional allowlist `activity.ledger_offices` (no row = every office, an array = those listed, anything else = none); the master stays the kill switch and the allowlist can only narrow it; proof `activity-office-scope` (26) |
| Rolling-deploy matrix | **Run on local replicas** (phase 4), not on deployed versions: the four worker/schema cells, the page/gateway cells and the new worker over a schema without the ledger (`RELEASE-READINESS.md`, "Mixed-version matrix"). The production matrix has not been run |

## 9. The production-catalogue checks

`check:callers`, `check:consumed`, `check:gateway-wrappers`, `check:anon-exposure`, `check:machine-key`, `check:office-callers` and `check:carrier-writers` read a database catalogue and, run
without a flag, refuse to contact production without `ALLOW_PRODUCTION_CHECKS=1`, which this work was not given and did not set. Each now has a `--replica` mode (`scripts/lib/catalogue-db.ts`):
it reads the same catalogue from the local replica built from this repository's migrations, refuses any database that does not carry the replica's marker table, prints that it is **not**
production verification, and leaves the production mode exactly as it was (still gated; `tests/safety` pins it). What each asks, what it reads and what it established is in
`RELEASE-READINESS.md`, section 4.
