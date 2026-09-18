/*
  The office could not tell Grant what it cannot do.

  #49's loop is: an agent hits something it cannot do, `job_impediments`
  records it, `app.raise_proposals` turns the recurring ones into proposals,
  and **Claire sends the batch once** so he hears about it rather than having
  to go and look. 0295 built the sending half — `app.proposals_to_send` ranks
  the undelivered ones for the single voice he hears, `app.proposals_sent`
  marks a batch so the next pass does not repeat it.

  **Neither has ever had a production caller.** `check:callers` has held both
  in its baseline since it existed, and the consequence is the one #272 asks
  about by name: *is the absence exposing a real unreachable feature?* It is.
  The office raises proposals correctly and then says nothing, so the only way
  Grant learns the office is stuck is by opening the Governance page and
  noticing.

  That is the same class as the Slack rotation defect found this morning: a
  mechanism that exists, is correct, and never speaks.

  ## Why this needs a migration and not just a caller

  The naive caller marks the batch sent and announces it. If the delivery then
  fails — Telegram down, no notifier configured, the coherence gate refusing
  the output — the proposals are `delivered_at` forever and **the next pass
  will never offer them again.** A silent, permanent loss of exactly the
  message that says the office is stuck. Marking something delivered before
  the delivery is confirmed is the defect, not the caller.

  So `delivered_at` gains the job that claimed it, and a sweep un-marks any
  proposal whose announcing job is finished and produced no successful
  delivery. The claim becomes recoverable rather than final, and the
  asymmetry is the safe one: the sweep can only ever put a proposal BACK in
  front of Grant, never hide one.
*/

alter table public.proposals
  add column if not exists delivered_by_job uuid references public.jobs(job_id);

comment on column public.proposals.delivered_by_job is
  'Which job claimed to have told Grant about this proposal. Kept so the claim '
  'can be CHECKED against public.deliveries rather than trusted: a proposal '
  'marked sent by a job that never delivered is put back (app.proposals_undeliver).';

-- ---------------------------------------------------------------------------
-- Marking a batch sent now records WHO said so.
--
-- A new argument rather than a new function: `create or replace` does not
-- replace a function whose argument list changed, it creates a second
-- overload and every call becomes ambiguous. CLAUDE.md records that trap, so
-- the old signature is dropped by exact signature first.
-- ---------------------------------------------------------------------------

drop function if exists public.proposals_sent(uuid[]);
drop function if exists app.proposals_sent(uuid[]);

create function app.proposals_sent(p_ids uuid[], p_job uuid default null)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.proposals
     set delivered_at = app.now_utc(),
         delivered_by_job = p_job
   where proposal_id = any(p_ids)
     and delivered_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

comment on function app.proposals_sent(uuid[], uuid) is
  '#49/#272. Marks a batch told-to-Grant. The job is recorded because the '
  'claim is checkable: app.proposals_undeliver puts back anything whose job '
  'never actually delivered.';

create function public.proposals_sent(p_ids uuid[], p_job uuid default null)
returns int language sql volatile security definer set search_path = ''
as $$ select app.proposals_sent(p_ids, p_job) $$;

grant execute on function app.proposals_sent(uuid[], uuid) to ai_team_app;
grant execute on function public.proposals_sent(uuid[], uuid) to ai_team_app;

-- ---------------------------------------------------------------------------
-- And the sweep that makes the claim honest.
-- ---------------------------------------------------------------------------

create or replace function app.proposals_undeliver()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  /*
    Only a FINISHED job is judged.

    A job still running, retrying or waiting has not failed to deliver — it
    has not finished trying. Sweeping those would put a proposal back in front
    of Grant while the message announcing it is still in flight, which is the
    duplicate half of the defect this function exists to prevent.

    A job with NO delivery row at all counts as not delivered, and that is
    deliberate: `notify` writes the row, so its absence means nothing was
    sent. 0304's asymmetry decides the direction — this can only ever restore
    a proposal, never hide one, so being wrong costs a repeated message rather
    than a lost one.
  */
  update public.proposals p
     set delivered_at = null,
         delivered_by_job = null
   where p.delivered_at is not null
     and p.state = 'open'
     and p.delivered_by_job is not null
     and exists (
       select 1 from public.jobs j
        where j.job_id = p.delivered_by_job
          and j.state in ('complete', 'failed', 'cancelled')
     )
     and not exists (
       select 1 from public.deliveries d
        where d.job_id = p.delivered_by_job
          and d.state = 'sent'
     );
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

comment on function app.proposals_undeliver() is
  'Puts back any open proposal whose announcing job finished without a sent '
  'delivery. Marking something delivered before the delivery is confirmed is '
  'how the one message saying the office is stuck gets lost for ever.';

create or replace function public.proposals_undeliver()
returns int language sql volatile security definer set search_path = ''
as $$ select app.proposals_undeliver() $$;

grant execute on function app.proposals_undeliver() to ai_team_app;
grant execute on function public.proposals_undeliver() to ai_team_app;

-- ---------------------------------------------------------------------------
-- Sweep the fixture proposals that are on Grant's Governance page right now.
--
-- Both open rows are `verify:proposes` debris about speaking fluent Welsh.
-- `app.harness_label` is the shared predicate 0473 introduced so this is not
-- a fourth private list of name shapes.
-- ---------------------------------------------------------------------------

delete from public.proposals where app.harness_label(needed);

-- ---------------------------------------------------------------------------
-- Drive it. A migration that applies cleanly is not a function that works.
-- ---------------------------------------------------------------------------

do $drive$
declare
  v_id   uuid;
  v_job  uuid;
  v_n    int;
  v_sent jsonb;
begin
  -- A proposal nobody has been told about, and a job that will claim it.
  insert into public.proposals (staff_slug, kind, needed, title, remedy, argument, times_seen)
  values ('chief-of-staff', 'not_capable', 'drive-proposal-0489',
          'drive 0489', 'drive 0489', 'drive 0489', 3)
  returning proposal_id into v_id;

  select jsonb_array_length(app.proposals_to_send(50)) into v_n;
  if v_n < 1 then
    raise exception '0489: an undelivered proposal did not come back from proposals_to_send';
  end if;

  select job_id into v_job from public.jobs order by created_at desc limit 1;
  if app.proposals_sent(array[v_id], v_job) <> 1 then
    raise exception '0489: marking it sent did not affect exactly one row';
  end if;

  v_sent := app.proposals_to_send(50);
  if v_sent::text like ('%' || v_id::text || '%') then
    raise exception '0489: a proposal marked sent is still being offered for sending';
  end if;

  -- And now the half that matters: that job did not deliver, so it comes back.
  if app.proposals_undeliver() < 1 then
    raise exception '0489: a proposal claimed by a job that never delivered was not put back';
  end if;
  if (select delivered_at from public.proposals where proposal_id = v_id) is not null then
    raise exception '0489: it is still marked delivered';
  end if;

  -- The control: with a real sent delivery on the job, the sweep leaves it alone.
  perform app.proposals_sent(array[v_id], v_job);
  -- `dedupe_key` is NOT NULL and shaped `^[a-z]+:[a-z_]+:[A-Za-z0-9:_.-]+$` —
  -- no hyphen in the middle segment, which the first draft got wrong.
  /*
    Every NOT NULL column and every CHECK, read from the catalogue in one go
    rather than discovered one failure at a time — four runs of this drive
    went that way before the query was run, which CLAUDE.md warns about by
    name. `deliveries` wants: a `dedupe_key` shaped
    `^[a-z]+:[a-z_]+:[A-Za-z0-9:_.-]+$` (no hyphen in the middle segment), a
    `purpose` from a list of six, a `message_ref` iff sent, a `sent_at` iff
    sent, and for Telegram a numeric `target_ref`.
  */
  insert into public.deliveries
    (job_id, channel, state, purpose, sent_at, dedupe_key, account_ref, target_ref,
     lease_expires_at, message_ref)
  values (v_job, 'telegram', 'sent', 'notice', app.now_utc(),
          'drive:proposal_send:0489.' || replace(v_job::text, '-', ''),
          'drive', '4242', app.now_utc(), 'drive-0489');
  if app.proposals_undeliver() <> 0 then
    raise exception '0489: the sweep took back a proposal that WAS delivered';
  end if;

  raise exception using errcode = 'ZZ000', message = '0489 drive: rolling back';
exception
  when others then
    if sqlerrm <> '0489 drive: rolling back' then raise; end if;
end
$drive$;
