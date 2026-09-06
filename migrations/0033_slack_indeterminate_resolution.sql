-- 0033 — resolving a Slack post whose outcome is unknown
--
-- 0032 left a real gap, and it is worth naming rather than quietly patching.
--
-- A `chat.postMessage` that fails with a network error after Slack processed it
-- is indistinguishable, from our side, from one that never arrived. The client
-- refuses to retry it (`src/slack/api.ts`) and the office parks the delivery as
-- `failed`, which is exactly right for safety: `failed` is terminal, so nothing
-- will ever post that key again, so there can be no duplicate.
--
-- But safety was the only thing 0032 provided. Once `reconcile` has read the
-- channel and ANSWERED the question, there was nowhere to put the answer:
--
--   - the message did land → the row says `failed` and carries no `message_ts`,
--     so an undo cannot find the message it must delete, and the delivery looks
--     lost when it is not;
--   - the message did not land → the row says `failed` forever, and a delivery
--     that provably never happened can never be attempted again.
--
-- Both are the same defect: a state machine with a state it cannot leave. This
-- migration adds the one transition out, and requires evidence to take it — the
-- caller must have actually looked.
--
-- Note what is NOT added: a way to move to `sent` without a `message_ts`, or to
-- retry without having checked. Either would let a caller resolve the
-- uncertainty by assertion, which is the thing the uncertainty exists to
-- prevent.

begin;

/**
 * Record what reconciliation found.
 *
 * `p_message_ts` non-null means the post landed and here is its id.
 * `p_message_ts` null means the channel was read and the message is provably
 * not there, so the key is released for a fresh attempt.
 *
 * Only applies to a delivery parked by an indeterminate failure. A delivery
 * that failed with `channel_not_found` is not uncertain — it is wrong — and
 * reviving it would turn a diagnosis into a retry loop.
 */
create or replace function app.resolve_slack_indeterminate(
  p_delivery_id uuid,
  p_message_ts text,
  p_lease interval default interval '2 minutes'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.slack_deliveries;
begin
  select * into v_row from public.slack_deliveries
    where delivery_id = p_delivery_id for update;
  if not found then
    raise exception 'no slack delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_row.state = 'sent' then
    return 'already_sent';
  end if;

  if v_row.state <> 'failed' or coalesce(v_row.error_code, '') not like 'indeterminate:%' then
    -- Deliberately not an exception. A reconciler sweeping a list of
    -- deliveries will meet rows that resolved themselves between the read and
    -- the write, and that is normal.
    return 'not_indeterminate';
  end if;

  if p_message_ts is not null then
    update public.slack_deliveries
       set state = 'sent',
           message_ts = p_message_ts,
           sent_at = app.now_utc()
     where delivery_id = p_delivery_id;
    return 'sent';
  end if;

  -- Provably absent. Release the key, count the attempt.
  update public.slack_deliveries
     set state = 'claimed',
         error_code = null,
         attempt = attempt + 1,
         lease_expires_at = app.now_utc() + p_lease
   where delivery_id = p_delivery_id;
  return 'retryable';
end;
$$;

comment on function app.resolve_slack_indeterminate(uuid, text, interval) is
  'The one way out of an indeterminate delivery, and it requires evidence: a '
  'message_ts that was actually found, or a null that means the channel was '
  'actually read.';

/**
 * 0032''s `record_slack_sent` would have quietly revived a `failed` row into
 * `sent`. It could not be reached that way — `claim_slack_delivery` never hands
 * out a failed row — but "unreachable" is a property of today''s callers, not
 * of the function, and this table is evidence about the outside world. So the
 * function now refuses instead of relying on nobody calling it wrongly.
 */
create or replace function app.record_slack_sent(
  p_delivery_id uuid,
  p_message_ts text,
  p_permalink text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.slack_deliveries;
begin
  select * into v_row from public.slack_deliveries
    where delivery_id = p_delivery_id for update;
  if not found then
    raise exception 'no slack delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_row.state = 'sent' then
    return 'already_sent';
  end if;

  if v_row.state = 'failed' then
    -- Use app.resolve_slack_indeterminate, which asks whether you looked.
    return 'failed';
  end if;

  if v_row.state = 'suppressed' then
    update public.slack_deliveries
       set message_ts = p_message_ts, permalink = p_permalink
     where delivery_id = p_delivery_id;
    return 'suppressed_too_late';
  end if;

  update public.slack_deliveries
     set state = 'sent',
         message_ts = p_message_ts,
         permalink = p_permalink,
         sent_at = app.now_utc()
   where delivery_id = p_delivery_id;

  return 'sent';
end;
$$;

grant execute on function app.resolve_slack_indeterminate(uuid, text, interval) to ai_team_app;

commit;
