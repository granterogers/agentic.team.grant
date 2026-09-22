/*
  0552 — a task he typed himself is still a referent

  0551 grounded a follow-up rename on the conversation: the one task THIS
  conversation made. That is right about the task the OFFICE made, which
  carries the job that made it (0530), and wrong about the one GRANT made.

  A task he types himself — through the dashboard, or through a turn that
  `my_task_add` files without a job — has `job_id` null, so it belongs to no
  conversation and 0551 could never find it. `verify:mytasks` caught it
  within one run: three follow-up checks that had passed for months went red,
  and the office answered *"nothing has gone on your list in this
  conversation"* about a task sitting right there.

  ## The invariant is unchanged, and that is the point

  #313's rule is not "the conversation owns it". It is:

      a follow-up may modify an existing object only where that object is
      canonically grounded as the intended referent, and ambiguity is
      answered by asking rather than by guessing.

  EXACTLY ONE candidate is what grounds it. So the candidate set widens and
  the arithmetic does not: a task with no job, created since this
  conversation began, is a thing he could be pointing at — and if there are
  two of them, or one of each kind, it still asks.

  What stays refused is the thing 0551 was written for: the newest of MANY,
  picked because it was newest. That was proximity, and it renamed a task
  Grant had never mentioned.

  ## Bounded by the conversation's own clock, not by a global one

  The window starts at the first turn of THIS exchange rather than "the last
  half hour", so a task he typed during a different conversation yesterday is
  not a candidate today. A fresh conversation still inherits nothing.
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
    When this exchange began. A task he typed himself is a candidate only if
    it appeared during it — a global clock would let yesterday's task in.
  */
  since as (select coalesce(min(received_at), app.now_utc()) as at from mine),
  candidates as (
    select t.task_id, t.title, t.due_on, t.priority, t.created_at
      from public.tasks t, since s
     where t.assigned_to_human
       and t.state not in ('done', 'cancelled')
       and not app.harness_task(t.is_fixture, t.job_id)
       and (
         -- the office made it, in this conversation
         t.job_id in (select job_id from mine where job_id is not null)
         -- or he made it himself, during this conversation
         or (t.job_id is null and t.created_at >= s.at)
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
  'The ONE task an ungrounded follow-up could mean: one the office made in '
  'this conversation, or one Grant typed himself during it. Several is '
  'reported as ambiguous and never resolved by picking; none is null. '
  'Replaces app.my_task_recent(), which returned the newest personal task '
  'anywhere in the office and so let "call it X" rename something he had '
  'never mentioned. 0551, widened by 0552 for the task he types himself.';

do $drive$
declare
  v_p uuid; v_c1 uuid; v_c2 uuid; v_j uuid; v_got jsonb;
begin
  select project_id into v_p from public.projects
   where status = 'active' and not is_fixture
     and project_id <> app.unnamed_project() order by updated_at desc limit 1;
  if v_p is null then
    raise notice '0552: no real active project to drive against; skipped';
    return;
  end if;

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at)
  values ('teamhq', 'drive0552:1', 'grant', 'Remind me to ring them',
          'teamhq:drive:zero_five_five_two_a', app.now_utc() - interval '1 minute')
  returning command_id into v_c1;
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority)
  values (gen_random_uuid(), v_p, 'drive-0552-job', 'office.instruction', 'teamhq:grant', 10)
  returning job_id into v_j;
  update public.inbound_commands set job_id = v_j where command_id = v_c1;

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key)
  values ('teamhq', 'drive0552:2', 'grant', 'Actually make that Monday',
          'teamhq:drive:zero_five_five_two_b')
  returning command_id into v_c2;

  -- A task with NO job, typed during this exchange: still a referent.
  insert into public.tasks (title, added_by, assigned_to_human)
  values ('One he typed himself', 'grant', true);
  select app.my_task_referent(v_c2) into v_got;
  if v_got is null or v_got ? 'ambiguous' then
    raise exception 'a task he typed himself was not a referent: %', v_got;
  end if;

  -- One of each is still two, and two is still ambiguous.
  insert into public.tasks (title, added_by, assigned_to_human, job_id)
  values ('One the office made', 'the office', true, v_j);
  select app.my_task_referent(v_c2) into v_got;
  if v_got is null or not (v_got ? 'ambiguous') then
    raise exception 'one of each did not read as ambiguous: %', v_got;
  end if;

  raise notice '0552 drive: his own -> referent, one of each -> ambiguous';
  raise exception 'rolling back' using errcode = 'RS001';
exception when sqlstate 'RS001' then
  raise notice '0552 drive rolled back, as intended';
end
$drive$;
