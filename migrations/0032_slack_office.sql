-- 0032 — the Slack office: outbound delivery, staff presentation, channel life
--
-- Gate 4 proved the inbound half: a signed event arrives, normalizes into the
-- canonical envelope, and lands in Postgres. Nothing yet goes the other way.
-- §12 calls Slack *the office*, and an office you can only shout into is not
-- one.
--
-- Everything here exists because posting to Slack is the first thing this
-- system does that it CANNOT take back by rolling a transaction over. A
-- `chat.postMessage` that succeeds and then loses its HTTP response has already
-- happened; retrying posts twice. So the shape of this migration is dictated by
-- one requirement in §6 — *"process idempotently ... Slack events"* — extended
-- to the direction Gate 4 did not cover:
--
--   claim in Postgres  →  post to Slack  →  record the result
--
-- with the claim carrying a lease, because a claimer that dies between the
-- first and second step must not silently swallow the message forever.
--
-- The lease is reclaimed BY THE CLAIM FUNCTION ITSELF rather than by a separate
-- sweep. That is deliberate and it is the lesson of `recover_stalled_jobs`
-- (0006), which moved a stalled job to `retrying` while `dequeue_job` only ever
-- read `queued`: two halves of one mechanism, each correct, with nothing
-- joining them, and no caller outside a test for either. A recovery path whose
-- only caller is a test is not a recovery path. Here there is one entry point
-- and it cannot be called without exercising the recovery.

begin;

-- ---------------------------------------------------------------------------
-- Staff presentation
-- ---------------------------------------------------------------------------

-- 0018 left `avatar_ref` null with the comment "not yet drawn". They are drawn
-- now (`assets/avatars/`, `npm run avatars`), so the reference is filled in.
--
-- It is a REPOSITORY PATH, not a URL, and that is not a placeholder awaiting a
-- URL. Slack's `icon_url` needs a publicly reachable image and nothing is
-- hosted yet; writing a guessed CDN URL here would put a broken image in the
-- database and call it configuration. A path is a true statement about where
-- the artwork is. `src/slack/identity.ts` turns it into a URL when a public
-- base is configured and degrades to a deterministic emoji when it is not —
-- and says which of the two it did, so a silently iconless team is visible.
update public.staff
   set avatar_ref = 'assets/avatars/png/' || slug || '.png'
 where permanent and avatar_ref is null;

comment on column public.staff.avatar_ref is
  'Repository path to the drawn avatar, not a URL. The presentation layer '
  'resolves it against a configured public base and degrades to an emoji when '
  'there is none, rather than storing a URL that may not resolve.';

-- ---------------------------------------------------------------------------
-- Channel life: what Slack does to a channel behind our back
-- ---------------------------------------------------------------------------

-- Two states that 0014 could not distinguish, and Phase 7's failure injection
-- names both separately: *bot removed from channel* and *channel renamed*.
--
-- Being removed from a channel is NOT the channel being archived. The mapping
-- stays true — this channel is still that project's channel — but delivery into
-- it will fail with `not_in_channel` until the bot rejoins. Folding it into
-- `active` would lose the difference between "we are locked out of the right
-- place" and "the right place is gone".
alter table public.slack_channel_map
  add column if not exists bot_present boolean not null default true,
  add column if not exists bot_left_at timestamptz,
  -- Renames are common and we learn of them late. Recording when the cached
  -- label was last corrected makes a stale label measurable instead of
  -- suspected.
  add column if not exists name_observed_at timestamptz not null default app.now_utc();

alter table public.slack_channel_map
  add constraint slack_channel_map_bot_present_iff_not_left
    check ((bot_present = false) = (bot_left_at is not null));

-- Record a rename. The id is the identity (0014), so this only ever corrects a
-- cached label — it can never move a mapping.
create or replace function app.record_slack_channel_rename(
  p_channel_id text,
  p_new_name text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  select channel_name into v_old
    from public.slack_channel_map where channel_id = p_channel_id;
  if not found then
    return false;
  end if;

  update public.slack_channel_map
     set channel_name = p_new_name,
         name_observed_at = app.now_utc()
   where channel_id = p_channel_id;

  return v_old is distinct from p_new_name;
end;
$$;

comment on function app.record_slack_channel_rename(text, text) is
  'Corrects the cached label for a channel. Returns true when the name actually '
  'changed. Cannot move a mapping: the id is the identity.';

-- Record that the bot is no longer in a channel, or is again.
create or replace function app.record_slack_membership(
  p_channel_id text,
  p_present boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before boolean;
begin
  select bot_present into v_before
    from public.slack_channel_map where channel_id = p_channel_id;
  if not found then
    return false;
  end if;

  update public.slack_channel_map
     set bot_present = p_present,
         bot_left_at = case when p_present then null else app.now_utc() end
   where channel_id = p_channel_id;

  return v_before is distinct from p_present;
end;
$$;

-- ---------------------------------------------------------------------------
-- Outbound delivery
-- ---------------------------------------------------------------------------

create type public.slack_delivery_state as enum (
  -- Claimed by exactly one caller, which now owes Slack a call or a lease
  -- expiry. Nothing else may post this message while the lease holds.
  'claimed',
  'sent',
  -- The attempt failed in a way that is over: the message will not be posted
  -- under this dedupe key without a deliberate new attempt.
  'failed',
  -- Deliberately not sent. Undo arriving before the post completes lands here,
  -- which is the out-of-order case Phase 7 names: the reversal of a message
  -- that has not been posted yet is to never post it.
  'suppressed'
);

create table public.slack_deliveries (
  delivery_id       uuid        primary key default gen_random_uuid(),

  -- The idempotency key, and the whole mechanism. Derived by the caller from
  -- what makes this message THIS message (job id + purpose, usually), never
  -- from a timestamp or a random value — a dedupe key that differs between two
  -- attempts at the same message deduplicates nothing.
  dedupe_key        text        not null unique,

  team_id           text        not null references public.slack_workspaces (team_id),
  channel_id        text        not null,
  -- Set when the message belongs in a thread. §12 and Gate 4 both single
  -- threads out: a result that lands in the channel instead of under the
  -- question it answers is in the right room and the wrong conversation.
  thread_ts         text,

  -- Who it is presented as. Null is legitimate — a system notice is from the
  -- app, not from a staff member, and inventing an author for it would be a
  -- small lie of exactly the kind §12 spends its length on.
  staff_id          uuid        references public.staff (staff_id),
  correlation_id    uuid,
  purpose           text        not null,

  state             public.slack_delivery_state not null default 'claimed',
  attempt           integer     not null default 1,
  -- While this is in the future and the state is `claimed`, somebody else owns
  -- the post. Once it passes, the claim is reclaimable — the claimer is
  -- presumed dead, which is the only assumption available and the reason the
  -- post must be safe to have never happened.
  lease_expires_at  timestamptz not null,

  -- Slack's own identifier for the posted message. It is what a thread reply,
  -- a reaction and an undo all address, so a `sent` row without one would be a
  -- delivery we cannot refer to.
  message_ts        text,
  permalink         text,

  error_code        text,
  suppressed_reason text,

  created_at        timestamptz not null default app.now_utc(),
  updated_at        timestamptz not null default app.now_utc(),
  sent_at           timestamptz,

  constraint slack_deliveries_purpose_known
    check (purpose in ('result', 'progress', 'blocker', 'ack', 'briefing', 'notice')),
  constraint slack_deliveries_channel_shaped
    check (channel_id ~ '^[CDG][A-Z0-9]{6,}$'),
  constraint slack_deliveries_attempt_positive check (attempt >= 1),
  -- A sent delivery has a message to point at. These are implications rather
  -- than equivalences, and the asymmetry is load-bearing: a SUPPRESSED row may
  -- also carry a message_ts, because `record_slack_sent` writes one when the
  -- suppression lost the race. Requiring `message_ts is null` unless sent would
  -- force that case to either lie about the state or drop the only handle on a
  -- message that has to be deleted.
  constraint slack_deliveries_sent_has_ts
    check (state <> 'sent' or message_ts is not null),
  constraint slack_deliveries_ts_only_when_posted
    check (message_ts is null or state in ('sent', 'suppressed')),
  constraint slack_deliveries_sent_at_iff_sent
    check ((state = 'sent') = (sent_at is not null)),
  -- One direction only: a retryable failure records its code and stays
  -- `claimed`, so an error_code is not proof of a terminal state.
  constraint slack_deliveries_failed_has_error
    check (state <> 'failed' or error_code is not null),
  constraint slack_deliveries_suppressed_iff_reason
    check ((state = 'suppressed') = (suppressed_reason is not null))
);

create index slack_deliveries_claimed_leases
  on public.slack_deliveries (lease_expires_at)
  where state = 'claimed';
create index slack_deliveries_by_correlation
  on public.slack_deliveries (correlation_id)
  where correlation_id is not null;
create index slack_deliveries_by_channel
  on public.slack_deliveries (channel_id, created_at desc);

create trigger slack_deliveries_touch_updated_at
  before update on public.slack_deliveries
  for each row execute function app.touch_updated_at();

comment on table public.slack_deliveries is
  'One row per outbound Slack message, claimed before the post and completed '
  'after it. Exists because chat.postMessage cannot be rolled back and a lost '
  'response is indistinguishable from a failure.';

-- ---------------------------------------------------------------------------
-- The one entry point
-- ---------------------------------------------------------------------------

/**
 * Claim the right to post a message, or find out why you may not.
 *
 * Returns, never raises, for the same reason `request_undo` does: a duplicate
 * delivery is a NORMAL event on a retrying transport, and normal events must
 * not arrive as errors.
 *
 * Outcomes:
 *   claimed      - it is yours; post it, then call `record_slack_sent`
 *   reclaimed    - it was someone's, their lease expired; yours now, attempt+1
 *   already_sent - posted already; `message_ts` says which message
 *   held         - someone else's live claim; do nothing, it is in hand
 *   suppressed   - deliberately not to be sent
 *   failed       - a previous attempt ended; a new attempt needs a new key
 *
 * Note there is no `force`. A caller that can override a live claim can post
 * twice, and every caller believes its own case is the exception.
 */
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
  -- The insert IS the lock. Concurrent duplicates cannot both succeed here,
  -- whatever they believe about each other.
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

  -- Somebody got there first. Take the row under a lock so two reclaimers
  -- cannot both decide the lease has expired.
  select * into v_row from public.slack_deliveries
    where dedupe_key = p_dedupe_key
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

  -- state = 'claimed'
  if v_row.lease_expires_at > app.now_utc() then
    return query select v_row.delivery_id, 'held'::text, null::text, v_row.attempt;
    return;
  end if;

  -- The lease expired. The previous claimer is presumed dead; take it over and
  -- count the attempt, because a delivery on its fourth attempt is a fact
  -- somebody should be able to see.
  update public.slack_deliveries
     set attempt = attempt + 1,
         lease_expires_at = app.now_utc() + p_lease
   where delivery_id = v_row.delivery_id
  returning * into v_row;

  return query select v_row.delivery_id, 'reclaimed'::text, null::text, v_row.attempt;
end;
$$;

/** Record a successful post. Idempotent: recording twice is not an error. */
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
    -- A retry of the RECORDING step, not of the post. Saying "already" rather
    -- than overwriting keeps the first message_ts, which is the one that
    -- exists in Slack.
    return 'already_sent';
  end if;

  if v_row.state = 'suppressed' then
    -- The out-of-order case, and the honest answer is neither "sent" nor an
    -- error: the post DID happen, and the suppression arrived too late to stop
    -- it. The caller must now delete the message rather than believe it was
    -- never posted. Recording the ts is what makes that possible.
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

comment on function app.record_slack_sent(uuid, text, text) is
  'Completes a claim. `suppressed_too_late` is the honest outcome when undo '
  'arrived after the post succeeded: the message exists and must be deleted, '
  'not forgotten.';

/**
 * Record an attempt that did not post.
 *
 * `p_retryable` decides whether the key stays usable. A rate limit is
 * retryable and releases the lease immediately so the retry does not wait it
 * out; a revoked token is not, and parking the row as `failed` stops a loop
 * that cannot succeed from consuming attempts forever.
 */
create or replace function app.record_slack_failure(
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
  v_row public.slack_deliveries;
begin
  select * into v_row from public.slack_deliveries
    where delivery_id = p_delivery_id for update;
  if not found then
    raise exception 'no slack delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_row.state = 'sent' then
    -- Reporting a failure for something already recorded as sent means two
    -- attempts disagree about reality. The sent record wins: it has a
    -- message_ts, which is evidence, and the failure has only a code.
    return 'already_sent';
  end if;

  if p_retryable then
    update public.slack_deliveries
       set lease_expires_at = app.now_utc(),
           error_code = p_error_code
     where delivery_id = p_delivery_id and state = 'claimed';
    return 'retryable';
  end if;

  update public.slack_deliveries
     set state = 'failed', error_code = p_error_code
   where delivery_id = p_delivery_id and state = 'claimed';
  return 'failed';
end;
$$;

/**
 * Stop a message being posted, or report that it is too late.
 *
 * Keyed on the dedupe key rather than the delivery id, because the caller
 * suppressing a message is frequently not the caller that claimed it and may
 * be arriving BEFORE the claim exists at all. Suppressing an unknown key
 * therefore inserts a tombstone: the later claim then finds `suppressed` and
 * never posts. Without that, an undo that outran the post would do nothing.
 */
create or replace function app.suppress_slack_delivery(
  p_dedupe_key text,
  p_reason text,
  p_team_id text default null,
  p_channel_id text default null
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
    where dedupe_key = p_dedupe_key for update;

  if not found then
    if p_team_id is null or p_channel_id is null then
      -- A tombstone still has to satisfy the table's own constraints, so the
      -- caller must say where the message would have gone. Refusing here is
      -- better than inventing a channel id that no rename or audit will ever
      -- match.
      return 'unknown_key';
    end if;
    insert into public.slack_deliveries
      (dedupe_key, team_id, channel_id, purpose, state, suppressed_reason,
       lease_expires_at)
    values
      (p_dedupe_key, p_team_id, p_channel_id, 'notice', 'suppressed', p_reason,
       app.now_utc())
    on conflict (dedupe_key) do nothing;
    return 'tombstoned';
  end if;

  if v_row.state = 'sent' then
    return 'too_late';
  end if;
  if v_row.state = 'suppressed' then
    return 'already_suppressed';
  end if;

  update public.slack_deliveries
     set state = 'suppressed',
         suppressed_reason = p_reason
   where delivery_id = v_row.delivery_id;
  return 'suppressed';
end;
$$;

-- ---------------------------------------------------------------------------
-- What a human should be able to see about all this
-- ---------------------------------------------------------------------------

create or replace view public.slack_delivery_health as
select
  state::text                                        as state,
  count(*)::int                                      as deliveries,
  sum(case when attempt > 1 then 1 else 0 end)::int  as needed_more_than_one_attempt,
  max(attempt)::int                                  as worst_attempt,
  count(*) filter (
    where state = 'claimed' and lease_expires_at < app.now_utc()
  )::int                                             as leases_expired
from public.slack_deliveries
group by state;

comment on view public.slack_delivery_health is
  'Counts, not a claim about health. `leases_expired` above zero means claims '
  'are outliving their claimers - deliveries nobody is currently carrying.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

alter table public.slack_deliveries enable row level security;
alter table public.slack_deliveries force  row level security;

-- Read only. Every state change goes through a function, because an
-- application that can UPDATE this table directly can set `state = 'sent'` for
-- a message that was never posted - and the whole point of the table is that
-- it is evidence about the outside world.
grant select on public.slack_deliveries to ai_team_app;
grant select on public.slack_delivery_health to ai_team_app;

grant execute on function app.claim_slack_delivery(text, text, text, text, text, uuid, uuid, interval) to ai_team_app;
grant execute on function app.record_slack_sent(uuid, text, text) to ai_team_app;
grant execute on function app.record_slack_failure(uuid, text, boolean) to ai_team_app;
grant execute on function app.suppress_slack_delivery(text, text, text, text) to ai_team_app;
grant execute on function app.record_slack_channel_rename(text, text) to ai_team_app;
grant execute on function app.record_slack_membership(text, boolean) to ai_team_app;

create policy slack_deliveries_app_read on public.slack_deliveries
  for select to ai_team_app using (true);

commit;
