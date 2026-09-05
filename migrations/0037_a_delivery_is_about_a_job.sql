-- 0037 — a delivery is about a JOB, not merely about a correlation
--
-- Found by the live suite, and it is a mis-attribution rather than a crash,
-- which makes it the more dangerous kind.
--
-- 0032 recorded `correlation_id` on a delivery, and the callback processor used
-- it to answer "which output is this 👍 about?" — correlation → jobs → the most
-- recent output. That is right exactly while one correlation has one job, and a
-- correlation is *designed* to span several: it is what ties an instruction to
-- every job it spawned, and a follow-up job is the normal case, not an edge one.
--
-- The verification run created two jobs under one correlation and pressed 👍 on
-- the FIRST one's result. The feedback was recorded against the second job's
-- output — a real signal, attached to the wrong work, silently. Nothing errored,
-- and the only symptom was a count in a neighbouring check being zero.
--
-- So the message records the job it reports on. `correlation_id` stays: it is
-- the right key for "everything about this conversation", and it is what the
-- undo offers are grouped by. The two answer different questions and the defect
-- was using one of them for both.
--
-- Nullable, because plenty of messages are about no job at all — a briefing, a
-- system notice, an acknowledgement.

begin;

alter table public.slack_deliveries
  add column if not exists job_id uuid references public.jobs (job_id);

create index if not exists slack_deliveries_by_job
  on public.slack_deliveries (job_id) where job_id is not null;

comment on column public.slack_deliveries.job_id is
  'The job this message reports on, when it reports on one. Distinct from '
  'correlation_id, which spans every job an instruction spawned - using the '
  'correlation to attribute feedback lands it on whichever job finished last.';

-- The claim function gains the parameter. A new signature rather than a
-- default-only change, because the old one stays callable: a briefing has no
-- job and should not have to pass null explicitly to say so.
create or replace function app.claim_slack_delivery(
  p_dedupe_key text,
  p_team_id text,
  p_channel_id text,
  p_purpose text,
  p_thread_ts text default null,
  p_staff_id uuid default null,
  p_correlation_id uuid default null,
  p_lease interval default interval '2 minutes',
  p_job_id uuid default null
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
     purpose, lease_expires_at, job_id)
  values
    (p_dedupe_key, p_team_id, p_channel_id, p_thread_ts, p_staff_id,
     p_correlation_id, p_purpose, app.now_utc() + p_lease, p_job_id)
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

  update public.slack_deliveries
     set attempt = public.slack_deliveries.attempt + 1,
         lease_expires_at = app.now_utc() + p_lease
   where public.slack_deliveries.delivery_id = v_row.delivery_id
  returning * into v_row;

  return query select v_row.delivery_id, 'reclaimed'::text, null::text, v_row.attempt;
end;
$$;

-- The eight-argument form is now ambiguous with the nine-argument one when
-- called positionally with defaults, so the old signature is dropped rather
-- than left to resolve unpredictably.
drop function if exists app.claim_slack_delivery(text, text, text, text, text, uuid, uuid, interval);

grant execute on function app.claim_slack_delivery(
  text, text, text, text, text, uuid, uuid, interval, uuid
) to ai_team_app;

commit;
