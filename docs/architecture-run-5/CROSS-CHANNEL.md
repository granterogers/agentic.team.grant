# Cross-channel conversation continuity - what a reply answers (Run 5, Phase 7)

This is the model the code implements (0623, `app.open_questions_for_reply`, `app.approval_for_delivery`). It is
written down because the tempting simplification - "yes means the most recent open question anywhere" - is
**deliberately not implemented**, and a future change should not reintroduce it by accident.

## Vocabulary

| Term | Meaning | Where it lives |
|---|---|---|
| Conversation | a channel's own unit: a Telegram chat, a Slack channel (thread), a dashboard session, a voice session | `split_part(inbound_commands.origin_ref, ':', 1)` per channel |
| Turn | one inbound command and the job it started | `inbound_commands.job_id` |
| Question | a blocker | `public.blockers` |
| Shown | a `sent` delivery that NAMES the blocker it asked | `deliveries.blocker_id` (0623, written once, own job only) |
| Points at | the message a reply is attached to | `inbound_commands.context.reply_to_message_id` (Telegram) or `context.thread_ts` (Slack) |

There is **no cross-channel conversation identity**. One person, one office and one project can have a Telegram chat,
a Slack channel and a dashboard session open at once; each is its own conversation and none is merged with another.
That is a decision, not an omission: a merged identity would need one durable id that every adapter can prove, and
the only such id today is the blocker itself - which is what every answer is now bound to.

## What a reply may answer

1. **A button press** answers the question its message asked (`approval_for_delivery` -> `blocker_id`). Nothing else.
   A press through bot A cannot find bot B's message that happens to carry the same numeric id.
2. **A reply that points at a message** (Telegram reply, Slack thread) answers the question THAT message asked, or
   nothing. Bindable only if exactly one of the questions asked in that Slack thread is still open (a thread is flat).
3. **A plain typed reply on Telegram or Slack** answers a question only if ALL of: it was shown in this conversation
   in the last 12 hours; it is the ONE open shown question; it is the last thing the office sent to that chat; and it
   came out of the turn before this one. Otherwise the question is **named, not answered**: the office says which
   questions are waiting and that it cannot tell which message is being answered.
4. **A reply on the dashboard or a voice session** (no message identity) answers a question only when the turn before,
   in that same session, left exactly one open. Two are named, never guessed.
5. **A forwarded message** answers nothing (0622) and is not "asked for" at `app.may_act` (0624): forwarded text is
   somebody else's words under his name. The turn is still answered; the work it starts asks before acting.
6. **A synthetic (declared test) press** may answer only a harness job.

## Cross-channel consequences (each has a check in `scripts/isolated/question-binding.ts`)

| Case | Result |
|---|---|
| Question raised on Telegram, answered on the dashboard (or the reverse) by a plain yes | not answered; the channel that did not show it does not bind it |
| Same question shown on Telegram and Slack, pressed on both | performed once; the second press reads "already answered" |
| Question shown only on Slack, plain yes on Telegram | not answered |
| Two questions in two projects, both shown in one chat | a bare yes binds to neither; both are named |
| Question shown 13 hours ago | binds to nothing |
| Voice session, one question raised by the spoken turn | binds (voice is no weaker than text) |
| Voice/dashboard turn with two open | named, not guessed |
| Legacy delivery from before 0623 (no name) | binds only when provable: its job had exactly one question then (`delivery.bindings_from`); after that date an unnamed delivery binds nothing |

## What is NOT claimed

- A person who genuinely means "the thing you just asked me about on my phone" while typing in a different channel
  gets a question, not an action. That is the safe side of the trade and it is the one the brief asked for.
- The dashboard and voice bind by session and by the turn before; they cannot prove the office's last spoken sentence
  named the question (no delivery record exists for those surfaces). Their guarantee is "exactly one open in the
  previous turn", which is weaker than Telegram/Slack's "the message named it" and is recorded as debt (below).
- Exact impersonation with the production credentials remains the stated limit of #379.

## Debt

1. Dashboard/voice questions carry no delivery record; a `dashboard_shown` write at render time would give them the
   same by-name binding. Not built: it needs the page to report what it drew.
2. A read surface ("which questions await, which channel showed them") is not built. The Governance page shows open
   questions; it does not show where each was shown.
