# ADR-0056 — A message names the question it asked; forwarded words are not intent; a claim has a number and a child has an author

**Status:** accepted (Architecture Run 5). Migrations 0623-0626.

## Context
Run 4 made a job remember where it came from and stopped a worker finishing what it did not hold. It left three
places where an answer or a piece of work could still be attributed by *inference* where a durable id was available:

1. A typed "yes" bound to "the office's last message from the job that raised the question" (#394, #396). A button
   already answered "the question its message showed" but found that message by `(channel, chat, message id)` alone -
   two bots numbering the same message in one chat collided - and `approval_for_delivery` chose the job's latest
   blocker at or before the message, so two questions on one job could be exchanged.
2. A forwarded message arrived as Grant's words (#392, #397). Only the typed yes read `forwarded`.
3. The fence was `(leased_by, attempt)`, and `resume_job` refunds an attempt number for two bounded waits, so the pair
   could name two claims. `enqueue_child` could not tell who was asking, so a stale worker's call took a slot in the
   live attempt and a deferral that retried took the next slot again (#398).

## Decision
1. **A delivery names the question it asked** (`deliveries.blocker_id`, 0623). It is written once, only for the
   delivery's own job's question, by `app.bind_delivery` (a separate call: `claim_delivery`'s signature is unchanged so
   an old worker is unaffected). A press answers `blocker_id`; nothing is looked up by time or by "latest". A press
   through bot A cannot find bot B's message. A message from before the migration binds only when provable (its job
   had exactly one question then, `delivery.bindings_from`); after the cutoff an unnamed message binds nothing.
2. **A reply binds to the question it points at, or to nothing.** Telegram `reply_to_message` and the Slack thread
   root are recorded with the command. A plain typed reply binds only when it is the ONE open question shown in that
   conversation, the last thing the office sent there, and out of the turn before. Otherwise the question is *named,
   not answered*. The dashboard and voice bind by session and previous turn, exactly-one. There is no cross-channel
   identity and none is invented; "yes means the latest open question anywhere" is deliberately not implemented.
3. **Forwarded words are content, not intent** (0624). A forwarded turn answers nothing, and `app.may_act` no longer
   treats work it starts as "asked for", so it asks. The turn is still answered.
4. **A claim has a number** (`jobs.claim_gen`, 0625): bumped by every claim, never lowered. `(leased_by, claim_gen)`
   names one claim ever. `job_held`/`renew_lease` take it.
5. **A child has an author.** `enqueue_child`/`enqueue_child_once` take the caller (job, worker, claim); a caller
   that no longer holds its job is refused; a deferral is keyed on its own caller and claim; a cancelled or failed
   parent is given no children; the output insert asks `job_held` in the same statement.
6. **The voice-note dispatch asks the CI ledger** (0626).

## Consequences
- Old and new run side by side: every new argument defaults to null and asks the old question when absent; the
  worker reads `claim_gen` back separately and stops asking when the column is missing. Deploy order: migrate, worker,
  hq-api, telegram-webhook (and slack-events only if its code changed - it did for thread and forward context).
- A person who means "the thing you just asked me on my phone" while typing elsewhere gets a question, not an action.
  That is the intended side of the trade.
- 22 handler call sites carry `callerArgs(job)`; one (`agents/perform.ts`, a plan step with no claim in scope) does
  not and is named in an architecture test with its reason. Threading the claim through step signatures is left.
- Exact impersonation with the production credentials remains the stated limit of #379.
