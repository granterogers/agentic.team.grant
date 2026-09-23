-- A suite that names itself anywhere but the first segment was real traffic.
--
-- 0574 taught app.harness_job to read the inbound command's dedupe key, and
-- wrote its own test for it: split_part(c.dedupe_key, ':', 1) = 'verify'. That
-- reads the FIRST segment only. A voice turn's key is composed
-- <channel>:turn:<who>, so a suite driving the live voice webhook produces
--
--   voice:turn:verify-basecamp-live-1790194091534.muejc9vk
--
-- and the label sits in the third segment, where 0574 cannot see it.
--
-- WHAT IT COST. 14 jobs, 8 September to 23 September, requested_by voice:grant,
-- every one reading as Grant's own voice note to every witness the office has.
-- They were ANSWERED and DELIVERED: 14 messages sent to telegram 1386648496,
-- his real chat, and 14 to real Slack channels. app.claim_delivery refuses a
-- harness job any destination outside public.test_destinations and could not
-- refuse these, because it asks app.harness_job and app.harness_job said no.
-- check:leaks reported "new escapes since containment fix: 0" for the same
-- reason: the guard and its witness share one predicate, so they agreed with
-- each other and were both wrong.
--
-- WHY THE OTHER SIGNALS MISS IT. jobs.is_fixture is GENERATED from
-- requested_by, which app.enqueue_inbound composes as <origin_channel>:<subject>
-- -- the SUBJECT is "grant", so it is voice:grant. jobs.synthetic is false
-- because the traffic genuinely came through the production door: a suite
-- calling the real voice webhook IS a production request, and the deny-by-
-- default stamp is right to say so. The label in the dedupe key is the only
-- thing that distinguishes it, which is why reading that key properly matters.
--
-- THE FIX IS TO STOP HAVING TWO VOCABULARIES. app.harness_label already exists
-- and already anchors on both ends -- ^verify- and :verify- -- for exactly this
-- reason, and 0574 wrote a second, narrower test beside it instead of calling
-- it. One predicate, one place, the way 0473 did it for the proposal round.
--
-- THE DIRECTION THAT WOULD BE EXPENSIVE. app.harness_job EXCLUDES rows from the
-- readers Grant looks at, so a predicate that is too GENEROUS hides his real
-- work -- the opposite of 0304's asymmetry and the costly direction here. That
-- is why the separator anchor matters and why the drive block below asserts a
-- real call sid, a real Telegram key and a deploy probe are all left alone.

do $$
declare
  v_def  text;
  v_next text;
  v_old  constant text :=
    'and split_part(c.dedupe_key, '':'', 1) = ''verify'')';
  v_new  constant text :=
    'and app.harness_label(c.dedupe_key))';
begin
  select pg_get_functiondef('app.harness_job'::regproc) into v_def;

  if position(v_old in v_def) = 0 then
    raise exception 'the dedupe-key clause 0574 wrote is not in app.harness_job';
  end if;

  v_next := replace(v_def, v_old, v_new);

  if v_next = v_def then
    raise exception 'the replacement changed nothing';
  end if;

  execute v_next;
end $$;

-- Drive it, in both directions. A widening that only proves it caught more is
-- half a proof: the half that matters is that it caught nothing of his.
do $$
declare
  v_caught  integer;
  v_missed  integer;
begin
  select count(*) filter (where app.harness_job(j.job_id)),
         count(*) filter (where not app.harness_job(j.job_id))
    into v_caught, v_missed
    from public.jobs j
    join public.inbound_commands c
      on c.command_id = (j.pinned_config ->> 'command_id')::uuid
   where app.harness_label(c.dedupe_key);

  if v_missed > 0 then
    raise exception
      'still % labelled harness job(s) reading as real traffic', v_missed;
  end if;

  if v_caught = 0 then
    raise exception 'the check matched nothing, so it proves nothing';
  end if;

  -- THE CONTROL. A separator-anchored label must not claim a real request.
  if app.harness_label('voice:turn:CA1234567890abcdef')
     or app.harness_label('telegram:1386648496:4711')
     or app.harness_label('slack:C0C276SFM7D:1790000000.1') then
    raise exception 'the predicate claims a real request as harness';
  end if;
end $$;
