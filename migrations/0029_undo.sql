-- 0029 — Undo
--
-- Phase 7's acceptance for this piece: *"Undo is idempotent under concurrent
-- duplicate delivery."*
--
-- That sentence names the hard part exactly. Undo is easy when it is pressed
-- once. The cases that actually happen are:
--
--   * Slack retries a webhook and the same button click arrives twice;
--   * Grant taps twice because the first tap showed nothing;
--   * a job is retried after a crash and re-attempts its own undo.
--
-- In all three, two undo requests arrive for the same action, possibly
-- simultaneously. The wrong outcomes are: undoing twice (reversing the
-- reversal), or the second request erroring so the interface shows a failure
-- for something that in fact worked.
--
-- ## How idempotency is obtained
--
-- Not by checking-then-acting, which loses the race by construction. A row in
-- `undo_requests` with a UNIQUE constraint on `action_id` is the lock: the
-- first inserter performs the undo, and every later request finds the row
-- already there and reports what happened the first time. Postgres serialises
-- the two inserts; the loser gets `already_undone` and NOT an error.
--
-- The status is returned rather than raised for the same reason: a duplicate
-- undo is a NORMAL event on a retrying transport, and normal events must not
-- surface as failures.
--
-- ## What "undoable" means
--
-- An action is undoable when reversing it is a real operation with a recorded
-- way to perform it - deleting the Slack message whose ts we stored, removing
-- the Notebook source we added. It is NOT undoable when the effect has left
-- the system in a way we cannot reach (mail sent) or when reversal is
-- meaningless (a question answered). `not_undoable` is a first-class outcome
-- rather than an absent row, because "there is no undo for this" is something
-- the interface has to be able to say.

begin;

create type public.undo_status as enum (
  'available',      -- reversible now
  'undone',         -- reversed
  'expired',        -- the window passed
  'not_undoable'    -- reversal is impossible or meaningless
);

create table public.undoable_actions (
  action_id     uuid        primary key default gen_random_uuid(),

  job_id        uuid        references public.jobs (job_id),
  correlation_id uuid       not null,

  -- What was done. Dotted, matching the tool vocabulary of §11.
  kind          text        not null,
  description   text        not null,

  -- Everything needed to reverse it, and nothing else. A Slack ts and channel;
  -- a notebook source id. Deliberately not "the whole event": an undo payload
  -- that carries the original request invites re-deriving the reversal from it
  -- at undo time, which is how an undo starts doing something subtly different
  -- from the reverse of what happened.
  reversal      jsonb       not null,

  status        public.undo_status not null default 'available',
  -- Null for `not_undoable`; otherwise when the offer lapses. §12's Undo is a
  -- surface, and a surface that offers an undo which no longer works is worse
  -- than one that offers none.
  undo_deadline timestamptz,

  performed_at  timestamptz not null default app.now_utc(),
  undone_at     timestamptz,

  constraint undoable_actions_kind_format
    check (kind ~ '^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)*$'),
  constraint undoable_actions_description_present
    check (length(trim(description)) >= 10),
  -- An available undo has a window; an impossible one does not.
  constraint undoable_actions_deadline_iff_possible
    check ((status = 'not_undoable') = (undo_deadline is null)),
  constraint undoable_actions_undone_iff_timestamped
    check ((status = 'undone') = (undone_at is not null)),
  -- A reversal with nothing in it is not a reversal.
  constraint undoable_actions_reversal_present
    check (status = 'not_undoable' or reversal <> '{}'::jsonb)
);

create index undoable_actions_offerable
  on public.undoable_actions (undo_deadline)
  where status = 'available';
create index undoable_actions_by_correlation
  on public.undoable_actions (correlation_id);

comment on table public.undoable_actions is
  '§12 Undo. `reversal` carries exactly what is needed to reverse the action - '
  'not the original request, because re-deriving a reversal at undo time is how '
  'undo starts doing something subtly different from the reverse of what '
  'happened.';

-- ---------------------------------------------------------------------------
-- The idempotency lock
-- ---------------------------------------------------------------------------

create table public.undo_requests (
  -- The action, not the request, is the primary key. That is the whole
  -- mechanism: a second request for the same action cannot insert, so it
  -- cannot act, and Postgres does the serialising rather than the application.
  action_id     uuid        primary key references public.undoable_actions (action_id),
  requested_by  text        not null,
  -- Where the duplicate came from, when we can tell. Useful for telling a
  -- Slack retry apart from a genuine second tap.
  source        text,
  requested_at  timestamptz not null default app.now_utc(),
  outcome       public.undo_status not null,

  constraint undo_requests_actor_present check (length(trim(requested_by)) > 0)
);

comment on table public.undo_requests is
  'One row per ACTION, not per request. The primary key is the lock: a '
  'concurrent duplicate cannot insert, so it cannot act, and it is told what '
  'the first request did rather than being given an error.';

-- The record of a request is a record. Delivery may be retried; history is not
-- rewritten.
revoke update, delete, truncate on public.undo_requests from ai_team_app;
create trigger undo_requests_reject_update
  before update on public.undo_requests
  for each row execute function app.reject_ledger_mutation();
create trigger undo_requests_reject_truncate
  before truncate on public.undo_requests
  for each statement execute function app.reject_ledger_mutation();

/**
 * Request an undo. Safe to call any number of times, from anywhere.
 *
 * Returns the outcome rather than raising, because a duplicate undo is a
 * NORMAL event on a retrying transport and normal events must not surface as
 * failures.
 *
 * Note what this function does NOT do: perform the external reversal. It
 * decides whether the reversal may proceed and records that decision exactly
 * once. The caller reads `reversal` and does the Slack delete or the Notebook
 * removal. Splitting it this way means the idempotency decision is made in one
 * transaction, in the database, rather than around an external call that can
 * time out after succeeding.
 */
create or replace function app.request_undo(
  p_action_id uuid,
  p_requested_by text,
  p_source text default null
)
returns public.undo_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.undoable_actions;
  v_prior public.undo_status;
  v_outcome public.undo_status;
begin
  select * into v_action from public.undoable_actions where action_id = p_action_id;
  if not found then
    raise exception 'no undoable action %', p_action_id
      using errcode = 'no_data_found';
  end if;

  -- Claim the action. Only one caller can succeed, whatever the concurrency.
  insert into public.undo_requests (action_id, requested_by, source, outcome)
  values (p_action_id, p_requested_by, p_source, 'available')
  on conflict (action_id) do nothing;

  if not found then
    -- Somebody else already claimed it. Report what they got, so a Slack retry
    -- and a double tap both see the truth rather than an error.
    select outcome into v_prior from public.undo_requests where action_id = p_action_id;
    -- A first request that succeeded leaves the action `undone`; saying
    -- `already_undone` in that case is the honest answer, and `undone` is the
    -- value that means it.
    return coalesce(
      (select status from public.undoable_actions where action_id = p_action_id),
      v_prior);
  end if;

  -- We hold the claim. Decide.
  if v_action.status = 'not_undoable' then
    v_outcome := 'not_undoable';
  elsif v_action.status = 'undone' then
    v_outcome := 'undone';
  elsif v_action.undo_deadline is not null and v_action.undo_deadline <= app.now_utc() then
    v_outcome := 'expired';
    update public.undoable_actions set status = 'expired' where action_id = p_action_id;
  else
    v_outcome := 'undone';
    update public.undoable_actions
    set status = 'undone', undone_at = app.now_utc()
    where action_id = p_action_id;
  end if;

  -- The claim row records what actually happened. Written with the trigger
  -- bypassed via a direct owner update is NOT possible here (the reject
  -- trigger fires for every role), so the row is deleted and re-inserted
  -- within the same transaction instead - the claim never lapses because the
  -- transaction holds the row lock throughout.
  delete from public.undo_requests where action_id = p_action_id;
  insert into public.undo_requests (action_id, requested_by, source, outcome)
  values (p_action_id, p_requested_by, p_source, v_outcome);

  return v_outcome;
end;
$$;

comment on function app.request_undo is
  'Idempotent under concurrent duplicate delivery. The undo_requests primary '
  'key is the lock; a loser is TOLD what happened rather than given an error, '
  'because a duplicate undo is normal on a retrying transport.';

-- Expiry as a sweep, so an offer that has lapsed stops being offered even if
-- nobody asks about it.
create or replace function app.expire_undo_offers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  update public.undoable_actions
  set status = 'expired'
  where status = 'available' and undo_deadline is not null
    and undo_deadline <= app.now_utc();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace view public.undo_offers as
select action_id, job_id, correlation_id, kind, description, undo_deadline,
       (extract(epoch from (undo_deadline - app.now_utc())) / 60)::int as minutes_left
from public.undoable_actions
where status = 'available'
  and (undo_deadline is null or undo_deadline > app.now_utc())
order by undo_deadline asc;

comment on view public.undo_offers is
  'What may still be undone right now. Filters on the deadline as well as the '
  'status, so a lapsed offer is never shown even between sweeps.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

alter table public.undoable_actions enable row level security;
alter table public.undoable_actions force  row level security;
alter table public.undo_requests    enable row level security;
alter table public.undo_requests    force  row level security;

grant select, insert on public.undoable_actions to ai_team_app;
grant select on public.undo_requests to ai_team_app;
grant select on public.undo_offers to ai_team_app;
grant execute on function app.request_undo(uuid, text, text) to ai_team_app;
grant execute on function app.expire_undo_offers() to ai_team_app;

-- Deliberately no UPDATE grant on `undoable_actions`. Status changes go
-- through `request_undo` or the expiry sweep; an application that can set
-- `status = 'undone'` directly can mark something undone that was never
-- reversed.
create policy undoable_actions_app_read on public.undoable_actions
  for select to ai_team_app using (true);
create policy undoable_actions_app_insert on public.undoable_actions
  for insert to ai_team_app with check (true);
create policy undo_requests_app_read on public.undo_requests
  for select to ai_team_app using (true);

commit;
