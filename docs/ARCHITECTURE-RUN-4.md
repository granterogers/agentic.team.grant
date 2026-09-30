# Architecture Run 4 - durable job provenance, lifecycle recovery, restart and replay

Status: **in progress** (this file is rewritten with the final result at the end of the run).

Branch `claude/architecture-run-4-lifecycle`, from `main` 6a579291 (the Run 3 production baseline).
Migrations 0619-0622. Decision record: ADR-0055.

## The question
If work exists in the system, where did it come from, what happened to it, and can the office recover it correctly
after interruption? Target: trusted principal -> durable origin -> authorized job -> durable lifecycle ->
resumable execution -> exactly-once effect. Run 3 built the first arrow; Run 2 the last. Run 4 is the middle.

## Reconnaissance (from runtime code and production, before any design)
### Job creators
Every product path into `public.jobs` is an SQL function; none is a raw insert. What each recorded before 0619:

| Creator | Principal | Channel / command | Parent / root | Gap |
|---|---|---|---|---|
| `enqueue_inbound` (Telegram text, voice, Slack, dashboard, upload) | `<channel>:<subject>` | `pinned_config.command_id` (a JSON key, not a column) | root only | link lost when the command row is deleted (68 real roots) |
| `enqueue_child` (~30 sites) | copies parent's | none | `parent_job_id` only; no root column | cause opaque (`child-<kind>-<random>`) |
| `enqueue_child_once` (obligation) | copies | none | same | key hashes the request text |
| `answer_generation_approval` | the ASKING job's requester | none | asking job | approver only in `pinned_config.approved_by` |
| `dispatch_due_responsibilities` | `duty:<slug>` | none | root | config copied verbatim, may carry `command_id` (D1) |
| `fire_triggers_for` | `trigger:<name>` | none | root | payload spread into config (D1) |
| `mcp_enqueue` | `mcp:<client>` | none | root | strips origin and approval keys (0616) |
| `notice_new_document`, `google_revoke_begin`, `hq_rename_project`, `provision_missing_channels`, `register_mcp_provider` | a document name / hardcoded `grant` / `hq` / `connector:register` | none | root | principal asserted, not authenticated (only ever trusted via `internal_root_ok`, fail-closed today) |
| retry / resume / recovery | none: the same row, updated in place | n/a | n/a | `pinned_config` writes merge, nothing lost |

### Lifecycle, as the code does it
`dequeue_job` takes an advisory lock and `FOR UPDATE SKIP LOCKED`, leases for 300 s (`jobs.lease_seconds`) and adds
one to `attempt`; nothing renewed the lease; the worker's writes were `update jobs ... where job_id = X`.
`recover_stalled_jobs` sweeps expired leases in running/output_created/quality_review/committing/committed/
notifying; `requeue_retrying` moves `retrying` to `queued` when `attempt < max_attempts`; `waiting_user` and
`waiting_external` exist and nothing writes them (approvals use `paused` plus a `blockers` row).

| State | Moved by | Leaves by | If the process dies |
|---|---|---|---|
| queued | enqueue*, requeue_retrying, resume_job, let_job_go | dequeue (`attempt < max_attempts`, `not_before` passed) | safe; **stuck if attempts exhausted (D3)** |
| running | dequeue | worker moves; else sweep after lease | lease lapses (300 s), retrying, queued; **the dead attempt is not fenced (D1)** |
| output_created / quality_review | worker | worker; else sweep | as running; an unreviewed output stays behind (D7) |
| committing | worker | committed / retrying / failed | sweep fails or retries it (0599) |
| committed / notifying | worker | complete; else `claim_pending_notification` after lease | delivery re-driven, deduped per job |
| retrying | worker, sweep | requeue_retrying | **stuck if attempts exhausted (D3)** |
| paused | pause_job, `runSteps` | resume_job / let_job_go / resume_paused | durable |
| complete / cancelled / failed | terminal | none | n/a |

### Defects reproduced on the replica before any fix
D1 stale worker completes a job another holds; D2 an answered question on a job with no attempts left is a dead
letter; D3 `retrying`/`queued` at the ceiling is stuck for ever; D4 a retried parent makes its child again; D5 an
answer that lands while a job is being parked is lost; D6 a stale worker's output is accepted; D7 a retry cannot
commit (found by the fence test; production: 138 jobs with a rejected output, 138 failed, 0 complete). Origin:
D1' a `command_id` in a duty's config reads as trusted; D2' the command row is the only evidence of channel and
it is deleted; D5' cause is unrecorded. None had yet corrupted a real job: production held no non-terminal real
job when they were found.

## What was built
See ADR-0055 for the decision. Migrations: 0619 durable origin; 0620 fence, exhausted sweep, answered/parked,
duplicate-child slots, `job_situation`; 0621 a retry can commit; 0622 typed yes bound to the question he was
shown, forwarded messages never an answer. Worker: `src/jobs/fence.ts`, fenced `moveTo`, heartbeat, guarded output
insert, supersede, settle sweep. Telegram adapter: `context.forwarded`. Gateway: a test member may drop a file
into a TEST project. Phase 0: eleven collateral verification suites moved off "office key = human".

(Sections for tests, sabotage, independent review, deployment, live verification, rollback and remaining debt are
added below as each is completed.)
