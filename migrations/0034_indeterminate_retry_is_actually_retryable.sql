-- 0034 — an indeterminate delivery released for retry must actually be
--        retryable
--
-- Found by `npm run verify:slack` on its first complete run, and it is exactly
-- the class of defect this project keeps meeting: two mechanisms that are each
-- correct, wired together in a way that cannot work.
--
-- 0033's `resolve_slack_indeterminate` establishes that a message provably did
-- not land, and hands the delivery back for another attempt by setting it to
-- `claimed` with a **fresh two-minute lease**. That is the natural thing to
-- write and it is wrong: nobody is holding that lease. The resolver is not
-- going to post the message — it is a reconciler — so the next real caller
-- arrives, finds a live claim, and is told `held`. It waits two minutes for a
-- claimer that does not exist, and the "retry" the resolver reported never
-- happens on the first attempt.
--
-- The check caught it because it asserted the CONSEQUENCE (a later delivery
-- posts the message) rather than the resolver's own return value, which said
-- `retryable` and was believed. A check that stopped at the return value would
-- have passed on a delivery path that stalls for two minutes every time.
--
-- The fix is one line of intent: hand it back with the lease already expired,
-- so the next claim reclaims it immediately through the ordinary path. The
-- attempt counter is deliberately NOT incremented here either — the reclaim
-- does that, and counting it in both places would report two attempts for one.

begin;

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

  -- Provably absent. Release the key for the next caller — with the lease
  -- ALREADY EXPIRED, because this function is not going to post it. `p_lease`
  -- is kept in the signature so callers and grants do not change, and is
  -- deliberately unused: a lease granted to nobody is a two-minute stall.
  update public.slack_deliveries
     set state = 'claimed',
         error_code = null,
         lease_expires_at = app.now_utc() - interval '1 second'
   where delivery_id = p_delivery_id;
  return 'retryable';
end;
$$;

comment on function app.resolve_slack_indeterminate(uuid, text, interval) is
  'The one way out of an indeterminate delivery. Releasing it for retry leaves '
  'the lease expired: the resolver is a reconciler, not a sender, so a lease '
  'held in its name would stall the next real caller.';

commit;
