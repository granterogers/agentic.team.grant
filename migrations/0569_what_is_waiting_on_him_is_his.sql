-- The headline number of Grant's morning briefing was 94% test traffic.
--
--     54 items are waiting on you; the oldest has sat 13 days.
--     50 more sit on the dashboard.
--
-- public.needs_me returned 67 open blockers this morning and 63 of them were
-- raised by a suite: verify:pursues, and a dozen session runs. He has four.
--
-- The view had no harness filter at all, and it has EIGHT consumers --
-- morning_briefing_facts, hq_studio_core, hq_studio_settings, studio_requests,
-- studio_waiting, voice_answer, needs_me_cap and the studio page itself. So
-- every surface that tells him what is waiting on him has been counting the
-- harness: the dashboard, the briefing and the voice answer alike.
--
-- Fixed in the VIEW rather than in the briefing, because the thing that failed
-- is a class and not an instance. app.harness_job is the canonical predicate
-- the three readers 0355 corrected already ask; this is the fourth.
--
-- A blocker with NO job is kept. That is the safe direction: the witness can
-- only ever EXCLUDE, so treating "I know nothing about this" as real cannot
-- hide a genuine request from him -- 0304's asymmetry, which this repository
-- has now paid for in both directions.
--
-- A suite that needs to see its own blockers reads public.blockers, which is
-- unchanged. That is #45's rule: a suite testing something that filters
-- fixtures cannot be named the way the filter matches, so it goes to the
-- table rather than the view.

create or replace view public.needs_me as
  select b.blocker_id,
         b.project_id,
         b.job_id,
         b.requested_action,
         b.why_needed,
         b.real_deadline,
         b.approval_options,
         b.originating_agent,
         b.work_can_continue,
         b.consequences_of_delay,
         b.created_at,
         b.real_deadline is not null and b.real_deadline <= app.now_utc() as overdue
    from public.blockers b
   where b.state = 'open'::blocker_state
     and not coalesce(app.harness_job(b.job_id), false)
   order by (b.real_deadline is not null and b.real_deadline <= app.now_utc()) desc,
            b.work_can_continue, b.real_deadline, b.created_at;

comment on view public.needs_me is
  'Open blockers that are Grant''s to answer. Excludes harness traffic (0569): '
  'it had none, and the morning briefing told him 54 things were waiting when '
  'four were. A blocker with no job is kept, because the filter may only ever '
  'exclude and must never hide a genuine request.';

-- Drive it, because a migration that applies cleanly is not a view that works.
do $drive$
declare
  v_harness int;
  v_total   int;
begin
  select count(*) into v_harness
    from public.needs_me n where coalesce(app.harness_job(n.job_id), false);
  if v_harness > 0 then
    raise exception 'needs_me still shows % harness blocker(s)', v_harness;
  end if;
  select count(*) into v_total from public.needs_me;
  raise notice 'needs_me now shows % blocker(s) that are his', v_total;
end
$drive$;
