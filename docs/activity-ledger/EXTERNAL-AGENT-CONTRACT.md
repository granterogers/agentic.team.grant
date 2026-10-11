# External agent contract (Hermes and any other outside worker)

For the branch that investigates Hermes. **Contract only.** Nothing in this change installs, deploys or calls an external worker, gives one database
access, or exposes the door below through any gateway. The ledger does not depend on Hermes.

## Principles

1. **An external worker never touches the database.** It reports to an authenticated, scoped application boundary, which calls the door.
2. **The boundary, not the worker, names the office.** The office is derived from the credential the boundary verified. A worker cannot name another.
3. **An external report is a claim, never evidence of an effect.** It cannot say a person authorised something, and it cannot say an outside service
   confirmed something. The office's own records decide whether the thing happened.
4. **Nothing an external worker says installs anything.** `external.skill_proposed` is a proposal for a person to review; it grants no tool and
   changes no autonomy policy (there is no second approval system; the existing blocker and `mayAct` paths decide).
5. **References, not content.** A result is a reference to an output the office holds (`evidence_ref`), held for review like any other output.

## The door (SQL, server side only)

```sql
app.record_external_activity(
  p_office          uuid,     -- from the verified credential, by the boundary
  p_worker          text,     -- ^[a-z][a-z0-9_-]{1,39}$ ; becomes actor = 'external:<name>'
  p_event_type      text,     -- must be an external_writable type
  p_idempotency_key text,     -- the worker's own stable key; stored as ext:<worker>:<key>
  p_summary         text,     -- one line, redacted, at most 300 characters
  p_status          text default 'recorded',
  p_severity        text default null,
  p_project_id      uuid default null,   -- must belong to p_office (composite key)
  p_job_id          uuid default null,   -- must belong to p_office (composite key)
  p_correlation_id  uuid default null,   -- must be the job's own (taken from the job); with no job, one some job of p_office has
  p_metadata        jsonb default '{}',  -- cleaned by app.activity_clean
  p_evidence_ref    jsonb default null   -- an object; cleaned like metadata, at most 1 KB, and stored with kind = "external" whatever it says
) returns uuid
```

Bounds on what a worker can add (the table is append-only on a 500 MB tier): at most **300 new reports an hour per worker and 1 000 per office** (refused with `54000`; a retry of an already-accepted report is never refused and another worker is
unaffected), the summary and every string value are redacted and cut, and the redactor itself reads only the first 4 000 characters. `external.review_decided` is **not** writable by a worker: a person's decision is recorded by the office.

What it forces, whatever the worker sends: `actor_kind = external`, `actor = external:<worker>`, `provenance = external`, `source_interface = external`,
visibility from the taxonomy (never chosen by the worker). What it refuses: a type that is not `external_writable`; severity `critical`; status
`confirmed` or `authorised`; a worker name that is not a short slug; a project or job of another office; a key reused for a different type; metadata
that is not an object, too deep, too large or has a malformed key; and everything while the ledger is switched off (it returns null). Proved by
`scripts/isolated/activity-ledger.ts` (six refusals, a spoof attempt, a direct insert, a cross-office reference, each beside a positive control).

## Event types

| Type | Default visibility | Use |
|---|---|---|
| `external.research_started` | diagnostic | The worker began a task the office gave it |
| `external.research_completed` | user | The worker finished; the result is an output held for review |
| `external.output_produced` | user | An output exists; `evidence_ref` names it |
| `external.skill_proposed` | user | A proposal, for a person to review; installs nothing |
| `external.evaluation_completed` | diagnostic | An evaluation of an output finished (`metadata`: counts and verdicts, never content) |
| `external.usage_recorded` | diagnostic | Resources a task used (`metadata`: durations, token counts, a cost with its provenance; never a number the worker did not measure) |
| `external.worker_error` | diagnostic | An error, redacted, short |
| `external.review_decided` | user | A person reviewed the output. **Not external-writable**: written by the office's own code on the person's act (no writer exists yet), never through this door |

Sandboxed execution is `external.research_started` and `external.worker_error` with `metadata.sandbox` naming the sandbox; resource usage is
`external.usage_recorded`; a human review decision is `external.review_decided` (recorded by the office, not reported by the worker). No Hermes-specific table, type or column exists or is needed: a new kind of external event is a row in
`public.activity_event_types` with `external_writable = true` and a name beginning `external.`.

## Boundary requirements (for whoever builds it)

- Authenticate the worker (a scoped credential per worker and per office; never the office key, never a browser key); rate-limit per worker.
- Derive the office from the credential. Never accept an office, an actor, a visibility or a provenance from the request body.
- Take the idempotency key from the worker; refuse a request without one.
- Never relay an event whose `p_project_id` or `p_job_id` the worker was not handed for that task.
- Route anything that would act outward through the **existing** approval path (`mayAct`, `blockers`, autonomy policy); this door records, it never decides.
- Redaction is applied again by the door; do not rely on the worker to redact.
- Add the boundary's caller to `docs/testing/callers-baseline.json`'s removal list (the entry for `app.record_external_activity` goes the day it has a caller).

## Reading what an external worker did

Through the same read model: `activity_feed?source=external` or `&type=external.output_produced`; each event carries `provenance: external` and
`actor: external:<name>`, so a page can badge it and a reviewer can filter to it.
