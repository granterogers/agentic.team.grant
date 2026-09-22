/*
  0554 — reference needs an antecedent, and a clock is not one

  ## What 0553 did, and why it undid 0551

  0551 was written because `app.my_task_recent()` returned the newest open
  personal task in the last half hour ANYWHERE in the office, and "call it X"
  renamed it. Proximity standing in for reference. The fix grounded the
  referent on THIS CONVERSATION.

  0552 then let a task Grant typed himself count too, dated from the start of
  the exchange — right, because a task with no job belongs to no conversation
  and could otherwise never be pointed at.

  0553 replaced that bound with a flat two-hour window, and its own header
  says why: three sections of `verify:mytasks` drive the office with a raw
  job insert and no inbound command at all, so there is no conversation for
  a task to have appeared during, and those sections went red. The product
  was widened to fit a fixture. Grant's instruction on exactly this path was
  that the acceptance fixture must not drive the fix.

  ## Driven, on the live function, before this migration

      a task Grant typed himself, 20 minutes ago, in no conversation
      a BRAND NEW conversation on another channel that has created nothing
      -> {"id": "a866c7e4…", "title": "Chase the printers", …}

  An ungrounded "call it something else", first message of a fresh chat on a
  different channel, was handed a task it had never mentioned. That is 0551's
  defect exactly, with a two-hour clock in place of a half-hour one.

  ## "Exactly one" is not the safety property it was taken for

  0553's argument was that EXACTLY ONE protects him. On Grant's real rows it
  does not: of the three hours in which he has ever had a loose personal task
  open, TWO held exactly one — which is the condition under which this fires,
  not the condition under which it is refused. And #259 is the feature that
  makes personal tasks common, so the guard gets weaker as the product is
  used.

  ## The rule

  Reference needs an antecedent. A task with no job is a plausible referent
  only where it appeared DURING this conversation — at or after its first
  turn — because that is the flow 0552 was written for: he adds something
  while they are talking and then says something about it.

  A conversation that had not begun when the task was made cannot be pointing
  at it, whatever the clock says. So:

    - the office made it, in this conversation  -> candidate
    - he made it himself, since this chat began -> candidate
    - anything older than the conversation      -> not a candidate
    - no conversation at all                    -> nothing, never a guess

  `p_within` keeps its job as a BOUND on how far back the conversation's own
  turns are gathered. It is no longer also the grounding, which is what
  0553 made it.

  The arithmetic is untouched: EXACTLY ONE resolves, several ask, none asks.
  What changes is which rows may enter the count.
*/

create or replace function app.my_task_referent(
  p_command_id uuid,
  p_within interval default interval '2 hours'
) returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with conversation as (
    select c.origin_channel,
           split_part(c.origin_ref, ':', 1) as chat,
           coalesce(c.subject, c.actor) as who
      from public.inbound_commands c
     where c.command_id = p_command_id
  ),
  mine as (
    select c.job_id, c.received_at
      from public.inbound_commands c, conversation v
     where c.origin_channel = v.origin_channel
       and split_part(c.origin_ref, ':', 1) = v.chat
       and coalesce(c.subject, c.actor) = v.who
       and c.received_at >= app.now_utc() - p_within
  ),
  /*
    When this exchange began, inside the bound. Null when there is no
    conversation at all, and a null compares false, so a lookup with no
    antecedent offers no loose task rather than the newest one.

    0554. This is 0552's bound restored. 0553 replaced it with the window
    itself, which let a task that predates the whole conversation — even one
    on another channel — be handed over as the referent.
  */
  began as (select min(received_at) as at from mine),
  candidates as (
    select t.task_id, t.title, t.due_on, t.priority, t.created_at
      from public.tasks t, began b
     where t.assigned_to_human
       and t.state not in ('done', 'cancelled')
       and not app.harness_task(t.is_fixture, t.job_id)
       and (
         -- the office made it, in this conversation
         t.job_id in (select job_id from mine where job_id is not null)
         -- or he made it himself, since this conversation began
         or (t.job_id is null and b.at is not null and t.created_at >= b.at)
       )
     order by t.seq desc nulls last, t.created_at desc
  )
  select case
           when (select count(*) from candidates) = 1
             then (select jsonb_build_object(
                     'id', task_id, 'title', title, 'due_on', due_on,
                     'priority', priority, 'created_at', created_at)
                     from candidates)
           when (select count(*) from candidates) > 1
             then jsonb_build_object(
                    'ambiguous', (select count(*) from candidates),
                    'titles', (select jsonb_agg(title) from candidates))
           else null
         end
$function$;

comment on function app.my_task_referent(uuid, interval) is
  'The ONE task this conversation could be pointing at, or a count when there '
  'are several, or null when there are none. A task with no job counts only '
  'where it appeared since this conversation began: 0553 counted any loose '
  'task inside the window, which handed a fresh chat on another channel a '
  'task Grant typed twenty minutes earlier. 0554.';

/*
  Driven, all four directions, inside a rollback. The interesting halves are
  the two REFUSALS, because those are what 0553 had lost.
*/
do $drive$
declare
  v_c uuid; v_other uuid; v_p uuid; v_j uuid; v_got jsonb; v_say text := '';
begin
  select project_id into v_p from public.projects
   where status = 'active' and not is_fixture
     and project_id <> app.unnamed_project() order by updated_at desc limit 1;

  /* A task he typed himself, before any of this. */
  insert into public.tasks (title, added_by, assigned_to_human, created_at)
  values ('Chase the printers', 'grant', true, app.now_utc() - interval '20 minutes');

  /*
    A conversation that has not begun when that task was made. NOT a
    `verify:` actor: `app.harness_task` correctly excludes one, and this
    function exists to find a task a REAL conversation could mean. Safe
    because the whole block ends in a rollback (#210: wrap the call).
  */
  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at)
  values ('telegram', 'drive0554:1', 'grant', 'Call it something else',
          'telegram:drive:zero_five_five_four_a', app.now_utc() - interval '2 minutes')
  returning command_id into v_c;

  select app.my_task_referent(v_c) into v_got;
  if v_got is not null then
    raise exception '0554: a task older than the conversation was offered: %', v_got;
  end if;
  v_say := v_say || 'older-than-the-chat -> null; ';

  /* He types one DURING the conversation: that one he could be pointing at. */
  insert into public.tasks (title, added_by, assigned_to_human, created_at)
  values ('Book the venue', 'grant', true, app.now_utc() - interval '1 minute')
  returning task_id into v_other;
  select app.my_task_referent(v_c) into v_got;
  if v_got is null or v_got ? 'ambiguous' then
    raise exception '0554: a task made during the chat did not resolve: %', v_got;
  end if;
  v_say := v_say || 'during-the-chat -> ' || (v_got ->> 'title') || '; ';

  /* Two of them, and it must ask rather than pick. */
  insert into public.tasks (title, added_by, assigned_to_human)
  values ('Draft the note', 'grant', true);
  select app.my_task_referent(v_c) into v_got;
  if v_got is null or not (v_got ? 'ambiguous') then
    raise exception '0554: two candidates did not read as ambiguous: %', v_got;
  end if;
  v_say := v_say || 'two -> ambiguous; ';

  /* A conversation that does not exist at all offers nothing. */
  if app.my_task_referent(extensions.gen_random_uuid()) is not null then
    raise exception '0554: a command that does not exist offered a referent';
  end if;
  v_say := v_say || 'no-conversation -> null; ';

  /* And the office own work in this conversation is still found. */
  if v_p is not null then
    insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                             requested_by, priority)
    values (extensions.gen_random_uuid(), v_p, 'drive-0554-job', 'office.instruction',
            'teamhq:grant', 10)
    returning job_id into v_j;
    update public.inbound_commands set job_id = v_j where command_id = v_c;
    delete from public.tasks where title in ('Book the venue', 'Draft the note');
    insert into public.tasks (title, added_by, assigned_to_human, job_id)
    values ('The one this conversation made', 'the office', true, v_j);
    select app.my_task_referent(v_c) into v_got;
    if v_got is null or v_got ? 'ambiguous' then
      raise exception '0554: the conversation own task did not resolve: %', v_got;
    end if;
    v_say := v_say || 'made-here -> ' || (v_got ->> 'title') || '; ';
  end if;

  raise exception '0554 drive: %', v_say using errcode = 'RS001';
exception when sqlstate 'RS001' then
  raise notice '0554 drive rolled back, as intended';
end
$drive$;
