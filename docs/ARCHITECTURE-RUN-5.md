# Architecture Run 5 - cross-channel integrity, question binding, residual boundary closure

Status: see **Production** (filled in at the end of the run). Baseline `main` = `513a19bc`. Migrations **0623-0626**.

## The question
When Grant responds through Telegram, Slack, HQ or voice, can the system prove exactly which message, question and action
he is answering, keep that across channels, and stop a stale, forwarded, duplicate or ambiguous message acquiring
authority? Target chain: trusted sender -> durable conversation -> exact delivered question -> exact response -> exact
approval/action -> durable job. No heuristic where a durable id exists.

## What was found (reconnaissance, before any change)
- A delivery carried no blocker id. `app.approval_for_delivery` chose "the job's latest question at or before the message";
  the callback lookup matched `(channel, chat, message id)` with no bot, so two bots numbering one message collided; a
  typed yes bound to the job's last message. (#394, #396)
- `context.forwarded` (Run 4) was read only by the typed yes. Nothing else knew. (#392, #397)
- The fence was `(leased_by, attempt)`; `resume_job` refunds an attempt number for two bounded waits. `enqueue_child`
  could not tell who asked. (#398)
- The voice-note dispatch bypassed the CI ledger (#391).

## What was built
| Migration | Change |
|---|---|
| 0623 | `deliveries.blocker_id` (write-once; own job's question that existed before the message); `app.bind_delivery`; `app.command_account`; `approval_for_delivery` by name (legacy: provable only, `delivery.bindings_from`); `open_questions_for_reply` returns `bindable` (points-at, one shown, last sent, previous turn; dashboard/voice exactly-one; forwarded and synthetic guards); forwarded flag add-only |
| 0624 | `app.job_forwarded`; `app.may_act` no longer treats a forwarded turn's work as asked-for |
| 0625 | `jobs.claim_gen` (no backfill; next claim = greatest(claim_gen, attempt)+1); `job_held`/`renew_lease` 4th arg; `enqueue_child`, `enqueue_child_once`, `fan_in_over` take the caller; stale caller refused (40001), cancelled parent refused (55000), incomplete caller refused |
| 0626 | `voice-note` in `ci_workflows`; service-role-only `public.ci_reserve`/`ci_release`; an open voice-note reservation is reused |
TS: delivery names the question (`blockerId` through DeliveryService, pager, Slack office/notifier, worker `asksBlocker`);
callbacks join per bot and refuse a synthetic press on real work; Telegram/Slack record reply target and forward; the
typed-yes handler names unbindable questions instead of guessing; `callerArgs(job)` at 23 call sites; fenced output insert;
worker catch block writes nothing for a zombie; claim read-back retries and fails closed; the pass survives a failing press
step; forwarded teaching is offered (never stored) and a forwarded personal task is not filed.
Answering semantics and the cross-channel model: `docs/architecture-run-5/CROSS-CHANNEL.md`. Decision: ADR-0056.

## Tests
Vitest 3716. Isolated (each on a fresh replica of production + migrations): `question-binding` 33, `forwarded-authority` 8,
`job-fence` 18, `ci-voice-ledger` 9; every earlier suite still green (`run-all.sh`, 48 pass-lines). Live: `run5-live` 20/20.

## Sabotage (each landed - printed - turned the named check red - restored)
Delivery->blocker binding ignored (8 red); latest-question fallback / plain reply always bindable (2 red); forwarded
trusted (red); cross-job binding allowed (2 red); awaiting question binds a pointed reply, where and bindable together (red;
one alone stayed green and was extended); synthetic guard removed (red); created-after rule removed (red); forwarded flag
trigger dropped (red); claim not bumped (4 red); job_held ignores the claim (3 red); caller not checked (red); deferral scope
dropped (red); dead parent accepted (red); slots keyed on attempt again (red); TS fence without claim / callerArgs empty (5 red);
a handler call site without callerArgs (architecture test red); voice dispatch without the reservation (unit test red).

## Independent review (two reviewers, told the guarantees were false; findings reproduced first)
Review A (binding): 2 HIGH - a pointed reply could answer the office's *awaiting* question; forwarded authority held only at
`may_act` (teaching and task branches unguarded). MEDIUM: forwarded flag erasable by a Slack upsert; new code on the old
schema killed the worker pass; synthetic typed yes had no guard; a message could name a later question. LOW: null-job bind.
Review B (fence/ledger): 1 HIGH - the 0625 backfill would rewrite `updated_at` on every job (briefing/Recent activity would
report the whole history as finished). MEDIUM: zombie writes in the handler catch; `pause_job`/`fan_in_over` unfenced;
TOCTOU on parent state and a failed parent with a deferring child; claim read-back silently disabling the fence; voice
reservations never settled. All fixed except: `pause_job still takes no claim (debt, #398), `agents/perform.ts`
passes no caller (named), Slack thread flatness and narrow Slack forward detection (documented), the rollback of 0625 clearing
live jobs' slot rows. Reviewers left the fence and ledger cores standing.

## Version skew
Every new argument defaults to null and asks the old question when absent. Old worker on the new schema: 3-arg `job_held`,
6-arg `enqueue_child`, `claim_delivery` unchanged (a separate `bind_delivery`). New worker on the old schema: the claim
read-back treats only a missing column as old, `job_forwarded` failures read false, a failing press step no longer kills the pass
(`job-lifecycle` run against a schema without 0625: 27/27; `job-delegation` 11/11). Rollback SQL for each migration is tested on a
replica; **revert the code first** - code built for 0623 reads `app.command_account`.

## Not established
Dashboard/voice answers bind by session and previous turn only (no delivery record). `pause_job` takes no claim. Exact
impersonation with production credentials (#379). #389, #393 need Grant; #392 items 2-3 and #395 open. See
`docs/architecture-run-5/AUDIT-RECONCILIATION.md`.

## Production (30 September 2026)
- `npm run migrate` applied **0623, 0624, 0625, 0626** (639 recorded); the canonical command was permitted.
- Deployed in order: `worker` (liveness ok, authenticated kick 200), `telegram-webhook` (pending 0, no last error),
  `slack-events` (signed handshake 200, unsigned 401, button press ignored as unrecognised). `hq-api` was NOT redeployed: none of
  its code changed (it reaches these paths only through database functions).
- Live, through the deployed doors, all declared test traffic: **run5-live 20/20** (stable over four consecutive runs; two earlier
  runs of an intermediate version failed one check, and the cause was the check, not the product: the deployed worker had already
  answered exactly A from the reply turn before the check looked, which is the feature working - the check now accepts either
  and still requires B untouched), run1 15/15, run2 53/53, run3 identity 26/26, run3 effects 12/12, run4 24/24, upload 17/17.
  The Run 1 and Run 4 live suites were updated first (their fixtures modelled a delivery with no name and a cancelled turn job).
- Teardown: personal-task debris removed, `purge:fixtures --go`, fixture blockers resolved, fabricated delivery rows deleted;
  `check:leaks` exit 0 (harness sent 0, unprovenanced 0, known/acknowledged only, 0 new). `check:consumed`, `pressable`,
  `answerable`, `gateway-wrappers` green; `check:callers` red exactly as at the baseline (#395).
- Real-traffic smoke (a signal, not proof) in the three hours after deploy, real jobs only: 0 failed, 0 stuck, 0 duplicate children,
  0 handler impediments, 16 claims numbered, 0 running unnumbered, 0 blocker messages without a name. Traffic was light: no real
  question was raised in the window, so the by-name binding has been proven live on declared test traffic only.

## Rollback
Code first (worker, telegram-webhook, slack-events to the prior versions), then `docs/architecture-run-5/rollback-0626.sql`,
`-0625`, `-0624`, `-0623` in that order; each was applied on a replica and its functions and columns compared. The rollback of
0625 clears the slot rows of live jobs so the old attempt-keyed function cannot read claim numbers as counts.

## Remaining debt (each an Issue)
`pause_job` takes no claim (a zombie can park a live job) - #398; `agents/perform.ts` step passes no caller - #398; dashboard and voice
bind by session and previous turn, not by a named message - #397; Slack `team_id` unbound and the shared Telegram secret - #392; write-capable
attach ungated - #393; four system duties - #389 (Grant's decision); `check:callers` red - #395. Next run: **Final Audit Reconciliation**.
