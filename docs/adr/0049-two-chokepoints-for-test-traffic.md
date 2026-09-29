# ADR-0049 — Test traffic is stopped at two chokepoints, and both fail closed

**Status:** accepted · **Date:** 29 September 2026 · **Issue:** #378

## Context

Harness work kept reaching real people by paths that each had their own check,
or none at all:

- **Narration** went out with no job attached, and the delivery guard allowed
  a null job. 381 harness narrations were posted to Slack.
- **The transcript echo and the 👎 question** used a bare `fetch`.
- **Handlers that write to Notion and NotebookLM** ran for harness children
  with nothing asking.

Every witness shared the guard's predicate, or started from `job_id`, so none
of this was counted.

## Decision

1. **Every message goes through `app.claim_delivery`.** Its single policy is
   `app.delivery_refusal`:
   - A registered test destination may receive anything.
   - With no job, only a registered operator sender (`public.operator_senders`)
     may send.
   - A job that does not exist is not provenance.
   - Otherwise the job's lineage decides, by `app.harness_job`.

   A unit test refuses a bare-`fetch` send anywhere in `src/`.
2. **Every job that writes outside the office is decided in `runJob`, before
   its handler.** The kind is classified in `src/jobs/containment.ts` as
   external, reads or internal. Harness-lineage work of an external kind is
   cancelled.
   - An unlisted kind is external.
   - An unanswerable question is a refusal.
   - A suite's own kind may declare itself internal; the registry wins for
     every production kind.
   - A unit test forces every handler kind into the registry.
3. **The witness does not share the guard's predicate.** `check:leaks`
   reconciles every sent message against its own reading of provenance and
   reports where it disagrees with `app.harness_job`.

## Consequences

- **Do not add `if (harness) return` inside a handler or a transport.** Add
  the kind to the registry, or send through `DeliveryService`. A scattered
  check is the one that gets forgotten.
- A new job-less sender must register its namespace in
  `public.operator_senders`, or use a test destination. It will otherwise be
  refused, loudly, as `no provenance`.
- **Reads are deliberately not gated.** A harness may read the web.
- Deploy order: the worker before 0601. The old worker sends narration with no
  job, and 0601 refuses it.

## Amendment — #379, 29 September 2026

"Harness" and "trusted" are different questions, and 0601 answered both with
`app.harness_job`, whose default is "real". `app.job_origin` (0603) is the
boundary question: `trusted` (a turn a production adapter produces, by a
positive per-adapter grammar), `internal` (a job an office function creates,
bound to its row), `harness`, `unknown`. Both chokepoints allow only
`app.may_act_outside(job)`. **Do not** answer "is this real?" by asking whether
it is harness, and do not grow a list of test names: extend the grammar in
`app.adapter_key_ok` when an adapter changes its keys, and the legacy snapshot
only with evidence of a retired adapter.

## Amendment — #381, 29 September 2026

A **correctly signed** request to a deployed door is `trusted` by 0603, and
rightly: the adapter really wrote its key. A signature proves the caller holds
the credential, not that it is Grant. So a suite that drives a real door
**declares the conversation first** with `app.register_test_origin` (0605).
The ingress stamp then writes the turn `synthetic` at the moment it arrives,
and every child inherits that, permanently.

- **Do not** mark test traffic after it has been accepted: teardown
  relabelling and name conventions are what failed.
- **Do not** widen a declaration to a real conversation. The database refuses
  it, and that refusal is what keeps a declaration from ever swallowing Grant.
- Every script that names a real door calls `testOrigins(db, …)`, and
  `check:door-origins` fails before anything is sent if one does not.
