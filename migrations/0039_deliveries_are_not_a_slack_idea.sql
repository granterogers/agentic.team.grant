-- 0039 — exactly-once delivery is a property of DELIVERY, not of Slack
--
-- 0032 built the claim/lease mechanism inside `slack_deliveries`, because Slack
-- was the only surface that could send anything. Telegram is now getting an
-- outbound path, and `sendMessage` has exactly the same problem
-- `chat.postMessage` has: it cannot be rolled back, and a lost response is
-- indistinguishable from a failure.
--
-- So there are two options and only one of them is defensible. A
-- `telegram_deliveries` table would be quick and would be a second
-- implementation of one invariant — and this repository has now been bitten
-- several times by exactly that shape (0013's own comment says a filter applied
-- in one of two call paths *"would drift"*, and it was right). The invariant is
-- "a message is posted at most once, and we can always say whether it was".
-- That is a property of delivery, not of Slack.
--
-- This migration therefore generalises the table rather than copying it. The
-- Slack-specific vocabulary goes with it:
--
--   team_id     -> account_ref   (a Slack team, a Telegram bot)
--   channel_id  -> target_ref    (a channel, a chat)
--   thread_ts   -> thread_ref    (a parent ts, a reply-to message id)
--   message_ts  -> message_ref   (a ts, a message_id)
--   permalink   -> link
--
-- `channel` joins them, and the shape constraint that used to demand a Slack
-- channel id now applies only when the channel is Slack — losing that check
-- entirely would be a real regression, since it is what catches a chat id
-- passed where a channel id belongs.
--
-- One consequence is worth stating rather than discovering: the callback
-- processor resolves "which work is this press about" by looking up the message
-- it is attached to. With one table that lookup is the same query for both
-- channels, which is the practical reason this is worth doing today rather
-- than when it becomes painful.

begin;

create table public.deliveries (
  delivery_id       uuid        primary key default gen_random_uuid(),

  channel           text        not null,

  -- The idempotency key. Derived from what makes this message THIS message
  -- (job id + purpose, usually), never from a timestamp or a random value.
  dedupe_key        text        not null unique,

  -- Which workspace/bot it goes through, and where in it.
  account_ref       text        not null,
  target_ref        text        not null,
  thread_ref        text,

  staff_id          uuid        references public.staff (staff_id),
  correlation_id    uuid,
  job_id            uuid        references public.jobs (job_id),
  purpose           text        not null,

  state             public.slack_delivery_state not null default 'claimed',
  attempt           integer     not null default 1,
  lease_expires_at  timestamptz not null,

  message_ref       text,
  link              text,

  error_code        text,
  suppressed_reason text,

  created_at        timestamptz not null default app.now_utc(),
  updated_at        timestamptz not null default app.now_utc(),
  sent_at           timestamptz,

  constraint deliveries_channel_known
    check (channel in ('slack', 'telegram', 'voice', 'teamhq')),
  constraint deliveries_purpose_known
    check (purpose in ('result', 'progress', 'blocker', 'ack', 'briefing', 'notice')),
  -- Applied per channel, so it still catches a chat id passed where a channel
  -- id belongs. A Telegram chat id is a signed integer; a Slack channel id is
  -- not, and confusing them is exactly the mistake worth catching at the
  -- boundary.
  constraint deliveries_target_shaped
    check (
      case channel
        when 'slack' then target_ref ~ '^[CDG][A-Z0-9]{6,}$'
        when 'telegram' then target_ref ~ '^-?[0-9]+$'
        else length(target_ref) > 0
      end
    ),
  constraint deliveries_attempt_positive check (attempt >= 1),
  constraint deliveries_sent_has_ref
    check (state <> 'sent' or message_ref is not null),
  constraint deliveries_ref_only_when_posted
    check (message_ref is null or state in ('sent', 'suppressed')),
  constraint deliveries_sent_at_iff_sent
    check ((state = 'sent') = (sent_at is not null)),
  constraint deliveries_failed_has_error
    check (state <> 'failed' or error_code is not null),
  constraint deliveries_suppressed_iff_reason
    check ((state = 'suppressed') = (suppressed_reason is not null))
);

create index deliveries_claimed_leases
  on public.deliveries (lease_expires_at) where state = 'claimed';
create index deliveries_by_correlation
  on public.deliveries (correlation_id) where correlation_id is not null;
create index deliveries_by_job
  on public.deliveries (job_id) where job_id is not null;
-- The callback lookup: "which message is this press attached to".
create index deliveries_by_message
  on public.deliveries (channel, target_ref, message_ref) where message_ref is not null;

create trigger deliveries_touch_updated_at
  before update on public.deliveries
  for each row execute function app.touch_updated_at();

comment on table public.deliveries is
  'One row per outbound message on any channel, claimed before the send and '
  'completed after it. Generalised from slack_deliveries in 0039: the '
  'invariant is a property of delivery, not of Slack.';

-- Carry across whatever is in flight. Verification runs clean up after
-- themselves so this is usually empty, and it is written to be correct anyway:
-- silently dropping an in-flight claim would allow exactly the double post the
-- table exists to prevent.
insert into public.deliveries
  (delivery_id, channel, dedupe_key, account_ref, target_ref, thread_ref,
   staff_id, correlation_id, job_id, purpose, state, attempt, lease_expires_at,
   message_ref, link, error_code, suppressed_reason, created_at, updated_at, sent_at)
select
  delivery_id, 'slack', dedupe_key, team_id, channel_id, thread_ts,
  staff_id, correlation_id, job_id, purpose, state, attempt, lease_expires_at,
  message_ts, permalink, error_code, suppressed_reason, created_at, updated_at, sent_at
from public.slack_deliveries;

commit;
