# Architecture Run 4 - durable job provenance, lifecycle recovery, restart and replay

Status: **PASS with recorded debt** - promoted to production and verified (see Production).

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


## Crash and restart, boundary by boundary
| Boundary | What happens now | Proved |
|---|---|---|
| right after claim / during reasoning | lease lapses, sweep -> retrying -> queued, next attempt; the dead attempt is fenced from finishing | isolated (job-lifecycle D1), recovery-matrix |
| handler slower than its lease | heartbeat renews it; a holder that parked its own job is still the holder | isolated (review A F1) |
| before/after creating a child | the retry finds the child it made (parent, kind, payload minus per-attempt ids, project, slot); a failed/cancelled child or one whose later sibling failed is not reused | isolated; production (run4-live) |
| before an external effect / ambiguous effect / effect done, completion not written | unchanged from Runs 2-3: `claimExternal` and `beginStep` park or skip | isolated (exactly-once, approval-binding) |
| waiting for approval | job paused with its blocker; answering grants a further attempt (never reuses a number) and closes the pause | isolated; production |
| answer lands while parking | `pause_job` releases it | isolated; production |
| immediately after approval; duplicate or stale answer | same job, same origin; a repeat is `already`; a repeat of an old answer does not release a job now waiting on a newer question | isolated; production |
| cancelled from outside while running | the worker abandons: no error, no output | isolated |
| during deployment | new worker on old schema: fence in `moveTo` still works, heartbeat and `job_held` switch themselves off; old worker on new schema: unfenced as before | isolated (job-skew) |
| attempts exhausted | `settle_exhausted_jobs` fails it with a sentence; it is told to whoever asked | isolated |
| retried after review rejected / dead attempt left an unreviewed output | 0621: the retry can commit | isolated |

## Concurrency
Claim: `dequeue_job` (advisory lock, `FOR UPDATE SKIP LOCKED`) - two workers racing get one job (isolated). The
fence is the pair (leased_by, attempt). Effects: the Run 2/3 claims. The one place a stale worker can still act is
between `assertHeld` and the output insert (milliseconds, not a lease's minutes) and in `enqueue_child`, which has no
worker identity.

## Tests
Isolated (43 suites, run-all.sh): new `job-origin` 22, `job-lifecycle` 27, `job-skew` 4, `job-delegation` 11,
`typed-yes` 9. Vitest 3706 (new: telegram-forwarded 7, typed-yes-wiring 2, a-running-job-writes-under-its-claim 5).
Production live: run4-live 24, plus run1 15, run2 53, run3 26, run3-effects 12, upload 17.

## Sabotage (each landed, printed proof, turned the named check red, restored)
S1 fence removed from `moveTo`; S2 output guard removed; S3 stored origin ignored (4 red); S4 child dedupe removed;
S5/S17 attempt refunded instead of granted (3 red); S6 `pause_job` ignores an answered question; S7 settle does
nothing; S8 supersede removed; S9 gate never clears a rejection; S10 typed yes without the delivery condition (4
red); S11 forwarded not refused; S12 handler no longer calls the function; S13 heartbeat answers "a row renewed";
S14 handoff id in the child identity; S15 a deferral returned as done; S16 project out of the identity (found
vacuous first - the counter hid it; the test was rewritten to a retry and then went red); S18 stamp trusts the
channel prefix; S19 root supplied by the caller; S20 any delivery purpose counts; S21 not the last word; and the
architecture test `a-running-job-writes-under-its-claim` (one fenced write made bare -> red).

## Independent review (two reviewers, told the guarantees were false; findings reproduced first)
Lifecycle: **F1 reproduced** - the heartbeat marked a handler-paused job lost and dropped its output: fixed
(`renew_lease` answers `job_held`); **F3 reproduced** - an attempt refund let a zombie of the same attempt number
pass: fixed (an answer grants a further attempt, never a refund; also bounds F4's approval loop at 25);
**2a/2b/2c reproduced** - a handoff's per-attempt output id, a refunded re-run, and a completed deferral returned as
done: fixed (identity minus `from_output`; unique attempt numbers; a slot whose later sibling failed is not reused);
2d project in the identity: fixed. **F5** a person-resumed job at its ceiling is failed after five minutes: correct
and told in words, recorded. **2e / F6** `enqueue_child` unfenced and assert-then-insert not atomic: recorded.
Provenance: **B1 reproduced** - a typed yes bound to any later `sent` delivery of the job: narrowed (result or
blocker purpose and the last thing sent to the chat); exact binding needs the blocker id on the delivery, recorded.
**B2 reproduced** - the stamp trusted the channel prefix, not the subject or "no job yet": fixed. **B3 reproduced** -
`root_job_id` caller-supplied: fixed. B4 (forwarded flag covers only the typed yes; Slack has no forward detection;
voice and dashboard skip the delivery rule) and B5 (a frozen root and its legacy children can disagree, failing
closed): recorded. Things attacked and not broken: the backfill on production (changes no root's answer), the
immutability trigger, trigger ordering and harness precedence, the forwarded flag's provenance, hq-api's upload
gate.

## Production
Migrations 0619, 0620, 0621, 0622 applied in that order (635 recorded). Worker v865 -> **v868**; hq-api v798 ->
**v803** (test member may drop a file into a TEST project; page not redeployed); telegram-webhook redeployed.
Backfill on production: 2,196 inbound roots stamped (105 trusted) and every job has a root; 16,466 jobs are legacy.
Deploy order was migrate, worker, hq-api, telegram-webhook; the reverse for 0622 would fail loudly (the typed-yes
query calls a function that would not exist).

## Legacy jobs
`origin_kind` null. Read exactly as before. Nothing upgraded. A job made after 0619 under a legacy parent records the
answer the office gave at that moment (only ever trusted, harness or unknown). Unknown provenance may not act
outside (verified live over the whole table).

## Rollback
`docs/architecture-run-4/rollback-0621.sql`, then `-0620`, then `-0619` (each verified on the replica), then redeploy
the previous worker (v865), hq-api (v798 source = commit 6a579291) and telegram-webhook. 0621's enum value
`superseded` stays (an enum value cannot be removed; nothing reads it once the worker is rolled back).

## Remaining debt (concrete)
1. A delivery carries no blocker id, so a typed yes binds to "the office's last message from the job that raised
   the question", not to the message's content.
2. Voice and the dashboard chat have no delivery record and keep the old tree binding; Slack has no
   forward/shared-message detection; Telegram `external_reply` and `quote` are not treated as forwards.
3. A forwarded turn is still `trusted` and spawns trusted children; only the typed yes reads `forwarded` (#392).
4. `enqueue_child` cannot tell who is asking, so a CHILD that retries and defers again takes a new slot (those
   deferrals carry their own claims); it is not fenced against a stale caller.
5. `resume_job` still refunds an attempt number for `dependency_wait` and `scheduled_wait` (0609), so the fence's
   paused clause is ambiguous across those two wakes.
6. #389 (a decision), #391 (a budget-integrity gap), #393 (write-capable attach gate) untouched by design.
