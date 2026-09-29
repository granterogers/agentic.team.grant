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
