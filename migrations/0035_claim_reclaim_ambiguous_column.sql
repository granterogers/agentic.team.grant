-- 0035 — `claim_slack_delivery` could not actually reclaim anything
--
-- The function is declared `returns table (delivery_id uuid, ...)`, which makes
-- `delivery_id` a PL/pgSQL variable for the whole body. The reclaim branch then
-- writes `where delivery_id = v_row.delivery_id`, and Postgres refuses it at
-- runtime with 42702, *"column reference delivery_id is ambiguous"*.
--
-- Every other branch returns before reaching that statement, so the function
-- worked perfectly for the fresh claim, the duplicate, the already-sent and the
-- suppressed cases — four of the five paths — and threw an exception on the
-- fifth. The fifth is crash recovery: the path taken when a claimer died and
-- its lease expired. It is the one path that only runs when something has
-- already gone wrong.
--
-- Two things follow, and the second is the reason for this comment:
--
-- 1. It is not enough for a recovery path to exist. 0032's own header argues
--    that a recovery path with no caller is not a recovery path; this is the
--    next form of the same defect — a recovery path with a caller and a syntax
--    error, indistinguishable from working until the day it is needed.
-- 2. It was found by the live suite exercising the reclaim deliberately, not by
--    a crash. A lease expiry in production would have surfaced it as a 500 in
--    the middle of an outage, which is the worst possible moment to learn that
--    the recovery code has never run.
--
-- The fix is to qualify the column. The table alias is spelled out rather than
-- renaming the OUT parameters, because the parameter names are the function's
-- documented result columns and callers select them by name.

begin;

create or replace function app.claim_slack_delivery(
  p_dedupe_key text,
  p_team_id text,
  p_channel_id text,
  p_purpose text,
  p_thread_ts text default null,
  p_staff_id uuid default null,
  p_correlation_id uuid default null,
  p_lease interval default interval '2 minutes'
)
returns table (delivery_id uuid, outcome text, message_ts text, attempt integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.slack_deliveries;
begin
  insert into public.slack_deliveries
    (dedupe_key, team_id, channel_id, thread_ts, staff_id, correlation_id,
     purpose, lease_expires_at)
  values
    (p_dedupe_key, p_team_id, p_channel_id, p_thread_ts, p_staff_id,
     p_correlation_id, p_purpose, app.now_utc() + p_lease)
  on conflict (dedupe_key) do nothing
  returning * into v_row;

  if found then
    return query select v_row.delivery_id, 'claimed'::text, null::text, v_row.attempt;
    return;
  end if;

  select * into v_row from public.slack_deliveries d
    where d.dedupe_key = p_dedupe_key
    for update;

  if v_row.state = 'sent' then
    return query select v_row.delivery_id, 'already_sent'::text, v_row.message_ts, v_row.attempt;
    return;
  elsif v_row.state = 'suppressed' then
    return query select v_row.delivery_id, 'suppressed'::text, null::text, v_row.attempt;
    return;
  elsif v_row.state = 'failed' then
    return query select v_row.delivery_id, 'failed'::text, null::text, v_row.attempt;
    return;
  end if;

  if v_row.lease_expires_at > app.now_utc() then
    return query select v_row.delivery_id, 'held'::text, null::text, v_row.attempt;
    return;
  end if;

  -- The reclaim. `public.slack_deliveries.delivery_id` in full, because the
  -- bare name is the function's own OUT parameter here.
  update public.slack_deliveries
     set attempt = public.slack_deliveries.attempt + 1,
         lease_expires_at = app.now_utc() + p_lease
   where public.slack_deliveries.delivery_id = v_row.delivery_id
  returning * into v_row;

  return query select v_row.delivery_id, 'reclaimed'::text, null::text, v_row.attempt;
end;
$$;

commit;
