-- 0040 — the delivery functions, channel-agnostic
--
-- The same five entry points 0032–0037 arrived at for Slack, against the
-- generalised table. Nothing about their behaviour changes, and the comments
-- that explain WHY each is shaped as it is are kept with them rather than left
-- behind in a dropped function — the reasoning is the part that stops the next
-- version quietly losing a property.
--
-- Recapping the four corrections those migrations made, because all four are
-- easy to reintroduce:
--
--   0033  a delivery whose outcome is unknown needs a way out of `failed`, and
--         it must require evidence that somebody actually looked.
--   0034  releasing one for retry leaves the lease ALREADY EXPIRED. A reconciler
--         is not a sender; a lease held in its name stalls the next real caller
--         for two minutes.
--   0035  the reclaim branch must qualify `delivery_id` — it is the function's
--         own OUT parameter, and the bare name raises 42702 on the one path
--         that runs only after a crash.
--   0037  a delivery is about a JOB. Resolving "which work" through the
--         correlation attributes feedback to whichever job finished last.
--
-- The Slack-specific table and functions are dropped at the end. Keeping them
-- as a compatibility layer was considered and rejected: an unused second path
-- to the same rows is how the two get out of step, and there is exactly one
-- caller of any of this.

begin;

/**
 * Claim the right to send a message, or find out why you may not.
 *
 * Returns, never raises: a duplicate delivery is a NORMAL event on a retrying
 * transport, and normal events must not arrive as errors.
 *
 *   claimed      - it is yours; send it, then call `record_delivery_sent`
 *   reclaimed    - the previous claimer's lease expired; yours now, attempt+1
 *   already_sent - sent already; `message_ref` says which message
 *   held         - someone else's live claim; do nothing
 *   suppressed   - deliberately not to be sent
 *   failed       - a previous attempt ended; a new attempt needs a new key
 *
 * There is deliberately no `force`. A caller that can override a live claim can
 * send twice, and every caller believes its own case is the exception.
 */
create or replace function app.claim_delivery(
  p_channel text,
  p_dedupe_key text,
  p_account_ref text,
  p_target_ref text,
  p_purpose text,
  p_thread_ref text default null,
  p_staff_id uuid default null,
  p_correlation_id uuid default null,
  p_job_id uuid default null,
  p_lease interval default interval '2 minutes'
)
returns table (delivery_id uuid, outcome text, message_ref text, attempt integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.deliveries;
begin
  -- The insert IS the lock. Concurrent duplicates cannot both succeed here.
  insert into public.deliveries
    (channel, dedupe_key, account_ref, target_ref, thread_ref, staff_id,
     correlation_id, job_id, purpose, lease_expires_at)
  values
    (p_channel, p_dedupe_key, p_account_ref, p_target_ref, p_thread_ref,
     p_staff_id, p_correlation_id, p_job_id, p_purpose, app.now_utc() + p_lease)
  on conflict (dedupe_key) do nothing
  returning * into v_row;

  if found then
    return query select v_row.delivery_id, 'claimed'::text, null::text, v_row.attempt;
    return;
  end if;

  select * into v_row from public.deliveries d
    where d.dedupe_key = p_dedupe_key
    for update;

  if v_row.state = 'sent' then
    return query select v_row.delivery_id, 'already_sent'::text, v_row.message_ref, v_row.attempt;
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

  -- The reclaim. Fully qualified, because the bare column name is this
  -- function's own OUT parameter (0035).
  update public.deliveries
     set attempt = public.deliveries.attempt + 1,
         lease_expires_at = app.now_utc() + p_lease
   where public.deliveries.delivery_id = v_row.delivery_id
  returning * into v_row;

  return query select v_row.delivery_id, 'reclaimed'::text, null::text, v_row.attempt;
end;
$$;

/** Record a successful send. Idempotent: recording twice is not an error. */
create or replace function app.record_delivery_sent(
  p_delivery_id uuid,
  p_message_ref text,
  p_link text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.deliveries;
begin
  select * into v_row from public.deliveries
    where delivery_id = p_delivery_id for update;
  if not found then
    raise exception 'no delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_row.state = 'sent' then
    -- A retry of the RECORDING step, not of the send. Keeping the first
    -- message_ref keeps the one that exists.
    return 'already_sent';
  end if;

  if v_row.state = 'failed' then
    -- Use app.resolve_indeterminate_delivery, which asks whether you looked.
    return 'failed';
  end if;

  if v_row.state = 'suppressed' then
    -- The suppression lost the race. The message EXISTS and must be deleted,
    -- not forgotten, so the reference is recorded even though the state stays
    -- suppressed — that reference is the only handle on it.
    update public.deliveries
       set message_ref = p_message_ref, link = p_link
     where delivery_id = p_delivery_id;
    return 'suppressed_too_late';
  end if;

  update public.deliveries
     set state = 'sent', message_ref = p_message_ref, link = p_link,
         sent_at = app.now_utc()
   where delivery_id = p_delivery_id;

  return 'sent';
end;
$$;

/**
 * Record an attempt that did not send.
 *
 * `p_retryable` decides whether the key stays usable. A rate limit is retryable
 * and releases the lease immediately; a revoked token is not, and parking the
 * row stops a loop that cannot succeed from consuming attempts forever.
 */
create or replace function app.record_delivery_failure(
  p_delivery_id uuid,
  p_error_code text,
  p_retryable boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.deliveries;
begin
  select * into v_row from public.deliveries
    where delivery_id = p_delivery_id for update;
  if not found then
    raise exception 'no delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_row.state = 'sent' then
    -- Two attempts disagree about reality. The sent record wins: it has a
    -- message reference, which is evidence; the failure has only a code.
    return 'already_sent';
  end if;

  if p_retryable then
    update public.deliveries
       set lease_expires_at = app.now_utc(), error_code = p_error_code
     where delivery_id = p_delivery_id and state = 'claimed';
    return 'retryable';
  end if;

  update public.deliveries
     set state = 'failed', error_code = p_error_code
   where delivery_id = p_delivery_id and state = 'claimed';
  return 'failed';
end;
$$;

/**
 * Stop a message being sent, or report that it is too late.
 *
 * Keyed on the dedupe key rather than the delivery id, because the caller
 * suppressing a message is frequently not the one that claimed it and may be
 * arriving BEFORE the claim exists. An unknown key therefore leaves a
 * tombstone, and the later claim finds `suppressed` and never sends.
 */
create or replace function app.suppress_delivery(
  p_dedupe_key text,
  p_reason text,
  p_channel text default null,
  p_account_ref text default null,
  p_target_ref text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.deliveries;
begin
  select * into v_row from public.deliveries
    where dedupe_key = p_dedupe_key for update;

  if not found then
    if p_channel is null or p_account_ref is null or p_target_ref is null then
      -- A tombstone must satisfy the table's own constraints, so the caller has
      -- to say where the message would have gone. Refusing beats inventing a
      -- target that no audit will ever match.
      return 'unknown_key';
    end if;
    insert into public.deliveries
      (channel, dedupe_key, account_ref, target_ref, purpose, state,
       suppressed_reason, lease_expires_at)
    values
      (p_channel, p_dedupe_key, p_account_ref, p_target_ref, 'notice',
       'suppressed', p_reason, app.now_utc())
    on conflict (dedupe_key) do nothing;
    return 'tombstoned';
  end if;

  if v_row.state = 'sent' then return 'too_late'; end if;
  if v_row.state = 'suppressed' then return 'already_suppressed'; end if;

  update public.deliveries
     set state = 'suppressed', suppressed_reason = p_reason
   where delivery_id = v_row.delivery_id;
  return 'suppressed';
end;
$$;

/**
 * Record what reconciliation found for a delivery whose outcome is unknown.
 *
 * `p_message_ref` non-null means it landed. Null means the channel was read and
 * the message is provably not there, so the key is released for a fresh
 * attempt — with the lease ALREADY EXPIRED, because this function is a
 * reconciler and is not going to send anything (0034).
 *
 * Note what is NOT possible: resolving the uncertainty by assertion. Only a
 * delivery parked by an indeterminate failure can move, and it moves only on
 * evidence.
 */
create or replace function app.resolve_indeterminate_delivery(
  p_delivery_id uuid,
  p_message_ref text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.deliveries;
begin
  select * into v_row from public.deliveries
    where delivery_id = p_delivery_id for update;
  if not found then
    raise exception 'no delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_row.state = 'sent' then return 'already_sent'; end if;

  if v_row.state <> 'failed' or coalesce(v_row.error_code, '') not like 'indeterminate:%' then
    -- Not an exception: a sweep meets rows that resolved themselves between the
    -- read and the write, and that is normal.
    return 'not_indeterminate';
  end if;

  if p_message_ref is not null then
    update public.deliveries
       set state = 'sent', message_ref = p_message_ref, sent_at = app.now_utc()
     where delivery_id = p_delivery_id;
    return 'sent';
  end if;

  update public.deliveries
     set state = 'claimed', error_code = null,
         lease_expires_at = app.now_utc() - interval '1 second'
   where delivery_id = p_delivery_id;
  return 'retryable';
end;
$$;

create or replace view public.delivery_health as
select
  channel,
  state::text                                        as state,
  count(*)::int                                      as deliveries,
  sum(case when attempt > 1 then 1 else 0 end)::int  as needed_more_than_one_attempt,
  max(attempt)::int                                  as worst_attempt,
  count(*) filter (
    where state = 'claimed' and lease_expires_at < app.now_utc()
  )::int                                             as leases_expired
from public.deliveries
group by channel, state;

comment on view public.delivery_health is
  'Counts, not a claim about health. `leases_expired` above zero means claims '
  'are outliving their claimers - deliveries nobody is currently carrying.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

alter table public.deliveries enable row level security;
alter table public.deliveries force  row level security;

-- Read only. Every state change goes through a function: an application that
-- can UPDATE this table can set `state = 'sent'` for a message that was never
-- sent, and the whole point of the table is that it is evidence about the
-- outside world.
grant select on public.deliveries to ai_team_app;
grant select on public.delivery_health to ai_team_app;
grant execute on function app.claim_delivery(
  text, text, text, text, text, text, uuid, uuid, uuid, interval) to ai_team_app;
grant execute on function app.record_delivery_sent(uuid, text, text) to ai_team_app;
grant execute on function app.record_delivery_failure(uuid, text, boolean) to ai_team_app;
grant execute on function app.suppress_delivery(text, text, text, text, text) to ai_team_app;
grant execute on function app.resolve_indeterminate_delivery(uuid, text) to ai_team_app;

create policy deliveries_app_read on public.deliveries
  for select to ai_team_app using (true);

-- ---------------------------------------------------------------------------
-- The Slack-specific originals, retired
-- ---------------------------------------------------------------------------

drop view if exists public.slack_delivery_health;
drop function if exists app.claim_slack_delivery(
  text, text, text, text, text, uuid, uuid, interval, uuid);
drop function if exists app.record_slack_sent(uuid, text, text);
drop function if exists app.record_slack_failure(uuid, text, boolean);
drop function if exists app.suppress_slack_delivery(text, text, text, text);
drop function if exists app.resolve_slack_indeterminate(uuid, text, interval);
drop table if exists public.slack_deliveries;

commit;
