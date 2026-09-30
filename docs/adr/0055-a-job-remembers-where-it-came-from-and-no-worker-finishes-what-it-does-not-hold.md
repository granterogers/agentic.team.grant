# ADR-0055 — A job remembers where it came from; a worker finishes only what it holds; a retry is the same work

**Status:** accepted (Architecture Run 4). Migrations 0619–0622.

## Context
Runs 1–3 said what an action may do, who may authorize it, and which credential is which person. Each answer
was only as good as the job it was asked about: *where did this work come from, what happened to it, and can the
office recover it correctly after an interruption?* Reconnaissance for Run 4 read the runtime, not the design,
and found the answer was reconstructed at every read from incomplete rows:

- **Origin was inferred.** `app.job_origin` walked to the root and asked whether its `pinned_config` mentioned a
  `command_id` and whether that command still existed. A duty root whose config carried a real command's id read
  as `trusted` (D1). The command row is deleted by suite teardown, so 68 real roots had already fallen from
  trusted to unknown with `requested_by` still saying `telegram:grant` (D2). The cause of a job survived only as an
  idempotency-key prefix, and `child-<kind>-<uuid>` carried none (D5).
- **A worker could finish a job it no longer held.** The lease was 300 seconds, nothing renewed it, and the
  worker's writes never asked who held the job. A handler slower than its lease was swept, re-queued and claimed by
  a second worker; the first, waking later, completed the job over it (every edge it took was legal).
- **Four jobs could not move.** A `retrying` or `queued` job at its attempt ceiling; an answered approval on a job
  with no attempts left; a job parked for a question that was answered while it was being parked; and a retried
  parent that made its child a second time.
- **A retry could not commit.** The review gate counted every pending or rejected output of the job, so a job
  sent back for another attempt was stopped by the attempt that sent it back: 138 jobs have a rejected output and
  all 138 are `failed`.

## Decision
1. **Origin is recorded once, at creation, by one trigger, and never changed.** `root_job_id`, `origin_kind`
   (inbound | child | obligation | approved | duty | trigger | mcp | system), `origin_class`
   (trusted | harness | unknown), `origin_command_id`, `origin_channel`. An inbound turn is what
   `app.enqueue_inbound` makes - its key, its principal prefix, an existing command - and nothing else is
   `inbound`. A pinned `command_id` in a config is not evidence of anything. A child copies its tree's origin; there
   is nowhere to state a higher one. Harness stays a live, add-only signal read first.
2. **A job from before 0619 keeps its old answer and gains nothing.** `origin_kind` null is the legacy marker;
   `app.job_origin` runs the pre-0619 logic for it, unchanged. The backfill stamps only a root whose key,
   command and principal prove it was an inbound turn - the case the old function already answered - so a later
   delete cannot move it. A child made under a legacy parent freezes what the office said at that moment.
3. **The pair (leased_by, attempt) is the fence.** `dequeue` stamps it on the `Job`; every state write and the
   output insert ask whether it still holds; a heartbeat renews the lease while a handler works. A worker that
   finds it does not throws `StaleWorkerError` and `runJob` returns `abandoned`: no more writes. A job paused by its
   own handler is still held by that attempt. The claim travels on the job object, not in module state, so two
   workers in one process each hold their own.
4. **A wait is not an attempt** (0609's rule, extended to approvals); **no attempts left is a failure with a
   sentence** (`settle_exhausted_jobs`); **an answer that arrives during parking releases the job**
   (`pause_job`).
5. **A child is keyed on what it is** (parent, kind, payload) **and which one the parent's attempt has asked for**
   (`job_child_slots`), so a retried parent finds the child it made. A failed or cancelled child is not reused.
6. **A retry may commit.** A dead attempt's unreviewed output is marked `superseded`; a rejection blocks the
   commit only while nothing approved has come after it.
7. **A typed yes answers a question he was shown** (a `sent` delivery, to this chat, bound by
   `app.approval_for_delivery`), and **a forwarded message is never an answer** (#394, #392 first item).
8. `app.job_situation` names what is happening (working, waiting_for_grant, retrying, ambiguous_external,
   stalled, stuck, failed, complete...) and `mcp_job_status` carries it beside the machine's `state`.

## Consequences
- **System duties are distinguishable from Grant's work, and no principal is invented for them.** `origin_kind`
  says `duty`, `trigger` or `system`. Whether such an action should be *asked*, or covered by a standing
  authorization, is #389 and is Grant's decision; this makes it answerable, not answered.
- Version skew is fail-safe in both directions (see docs/ARCHITECTURE-RUN-4.md): new worker on the old schema
  runs unfenced for the parts that need new functions and fenced for the part that does not; old worker on the new
  schema writes unfenced, exactly as before.
- **Not closed, recorded:** a *child* that retries and defers again takes a new slot each time (the parent cannot
  tell who is asking); a stale worker's *external effect* is stopped by the Run 2/3 claims, not by the fence; the
  race between the assertion and the output insert is milliseconds, not the minutes a lease lasts.
