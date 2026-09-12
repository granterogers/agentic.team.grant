-- 0290 — an answered job takes the legal road back
--
-- Found by `verify:waiting` on its first run, against 0289. Answering a blocker
-- tried to put its job straight back on the queue:
--
--   ERROR:  illegal job transition waiting_user -> queued for job a72ec1e9…
--   HINT:   Allowed from waiting_user: running, paused, cancelled, failed
--
-- `app.job_transitions_allowed` does not have that edge, and it is right not
-- to. The whole answer is in the hint: from `waiting_user` a job may start
-- running, be parked, or end. It may not silently reappear at the back of the
-- queue as though it had never been asked, because `queued` is the state a job
-- is in before anyone has looked at it, and this one has a history.
--
-- ## The legal road, which is also the honest one
--
--   waiting_user  →  paused  →  queued
--
-- Two transitions, both logged — `job_state_transitions` is written by the
-- trigger, so there is no path that moves a job without recording it (§6). The
-- ledger then reads as what actually happened: the wait ended, and then the job
-- went back in the queue. A single hop would have said neither.
--
-- `paused` and not `running`: nothing is running it. A job marked running with
-- no worker holding it is the kind of lie that makes `office_health` useless,
-- and `jobs_stuck_queued` (0270) would never see it because it is not queued.
--
-- ## Why the failure was clean
--
-- The raise happened inside `hq_answer_blocker`, so the blocker's own resolve
-- rolled back with it. The answer was refused whole rather than half-applied,
-- which is the one property that made this a red check rather than a resolved
-- blocker with a job parked behind it for ever.
--
-- Patched from `pg_get_functiondef`; only the job update changes.

begin;

create or replace function app.hq_answer_blocker(p_blocker_id uuid, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  b        public.blockers;
  v_answer text := btrim(coalesce(p_answer, ''));
  v_next   text;
  v_was    text;
begin
  select * into b from public.blockers where blocker_id = p_blocker_id;
  if not found then
    return jsonb_build_object('error', 'there is nothing here to answer');
  end if;
  if b.state <> 'open' then
    -- Not an error. Answering something already answered is what two open tabs
    -- produces, and the honest reply is what it was answered with.
    return jsonb_build_object('ok', false, 'already', true,
      'state', b.state::text, 'resolution', b.resolution);
  end if;
  if v_answer = '' then
    return jsonb_build_object('error', 'say what the answer is');
  end if;

  if array_length(b.approval_options, 1) is not null
     and not (v_answer = any (b.approval_options)) then
    return jsonb_build_object('error', format(
      'that is not one of the answers this asks for: %s',
      array_to_string(b.approval_options, ', ')));
  end if;

  /*
    A generation approval is answered by the function that already knows what
    approving one MEANS — it queues the follow-on job. Resolving the row here
    instead would mark it answered and queue nothing.
  */
  select pinned_config ->> 'approval_next' into v_next
    from public.jobs where job_id = b.job_id;
  if v_next is not null then
    return app.answer_generation_approval(
      p_blocker_id,
      -- The affirmative half of whatever this blocker offered. Matched against
      -- the words agents actually use rather than assuming the first option is
      -- the yes, which is true today and is not a rule anybody wrote down.
      lower(v_answer) in ('yes', 'approve', 'approved', 'go ahead', 'ok', 'do it'),
      'grant'
    ) || jsonb_build_object('ok', true, 'answer', v_answer);
  end if;

  update public.blockers
     set state = 'resolved',
         resolved_at = app.now_utc(),
         resolution = format('%s — answered by grant', v_answer)
   where blocker_id = p_blocker_id;

  /*
    And the job is let go, by the road the state machine allows.

    A resolved blocker whose job is still parked in `waiting_user` is a job
    nothing will ever pick up — the interface would say answered and nothing
    would run. But `waiting_user -> queued` is not an edge, and 0290's header
    says why it should not be: `queued` means nobody has looked at this yet.

    So: park it, then queue it. Both transitions are written to
    `job_state_transitions` by the trigger, and the ledger reads as what
    happened — the wait ended, then the job went back in the queue.
  */
  select state::text into v_was from public.jobs where job_id = b.job_id;
  if v_was in ('waiting_user', 'waiting_external') then
    update public.jobs
       set state = 'paused',
           state_reason = format('answered: %s', v_answer),
           updated_at = app.now_utc()
     where job_id = b.job_id;
    v_was := 'paused';
  end if;
  if v_was = 'paused' then
    update public.jobs
       set state = 'queued',
           state_reason = format('answered: %s', v_answer),
           updated_at = app.now_utc()
     where job_id = b.job_id;
  end if;

  return jsonb_build_object('ok', true, 'answer', v_answer, 'blocker', p_blocker_id);
end;
$$;

commit;
