/*
  0551 — a rename needs a REFERENT, not merely a recent row

  ## What the acceptance suite caught, and what reproducing it showed

  `verify:mytasks`, #259's own control, on v729:

      CONTROL: it does NOT rename the task he made twenty minutes ago
        "Review the onboarding copy for the task labeled kvkg66m5"
        WAS "Chase the printers kvkg66m5"

  One reply renamed an unrelated personal task. Reproduced as a clean
  two-turn interaction the path behaves correctly, so the destructive
  outcome needs a second condition — and the condition is not rare.

  ## The two conditions, and why the second one is the defect

  "Call it X" has two readings, and #259 built the disambiguation: if the
  office asked "what should I call it?" last turn, this is the ANSWER;
  otherwise it is a rename. `namedLater` decides, by looking up the previous
  output in this thread.

  When that lookup does not find a title question — a thread with other
  turns in it, a rewording, a turn that failed — `titleReply` correctly
  declines, and the rename path runs. That path then asks
  `app.my_task_recent()` for **the newest open personal task in the last half
  hour**, anywhere in the office, and renames it.

  That is PROXIMITY, not reference. The task Grant meant and the task that
  happens to be newest are the same row only by luck, and when they are not,
  an ungrounded follow-up silently rewrites something he never mentioned.
  The function's own caller even carries the comment *"#259: never claim a
  task was changed unless canonical state proves it"* — and the only thing
  proved was that SOMETHING recent exists.

  ## The invariant

  A follow-up mutation may modify an existing object only where that object
  is canonically grounded as the intended referent. Ambiguity, or the absence
  of grounding, is answered by ASKING — never by guessing destructively.

  So the candidate must come from THIS CONVERSATION: a task whose job shares
  the thread the follow-up arrived on. And there must be exactly ONE of them.

    - one candidate  -> that is the referent, and the rename proceeds
    - several        -> ambiguous, so the caller asks which
    - none           -> nothing to point at, so the caller asks

  A fresh conversation therefore inherits no referent at all, which is the
  boundary a clock can never express: half an hour after Grant renames
  something in one chat, an unrelated "call it X" in another chat used to
  reach it.

  ## Deliberately NOT a widening of `my_task_recent`

  That function has one other role — it is what the office uses to say what
  it just did — and narrowing it would change both. This is a second reader
  with a different question, and the old one keeps its own.
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
  /* Every job this conversation has produced, inside the window. */
  mine as (
    select c.job_id
      from public.inbound_commands c, conversation v
     where c.origin_channel = v.origin_channel
       and split_part(c.origin_ref, ':', 1) = v.chat
       and coalesce(c.subject, c.actor) = v.who
       and c.received_at >= app.now_utc() - p_within
       and c.job_id is not null
  ),
  candidates as (
    select t.task_id, t.title, t.due_on, t.priority, t.created_at
      from public.tasks t
     where t.assigned_to_human
       and t.state not in ('done', 'cancelled')
       and not app.harness_task(t.is_fixture, t.job_id)
       and t.job_id in (select job_id from mine)
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
  'The ONE task this conversation created that an ungrounded follow-up could '
  'mean, or a count when there are several, or null when there are none. '
  'Replaces asking app.my_task_recent(), which returned the newest personal '
  'task anywhere in the office and so let "call it X" rename something Grant '
  'had never mentioned — proximity standing in for reference. 0551.';

/*
  Driven, both directions, inside a rollback. A migration that applies
  cleanly is not a function that works, and the interesting half of this one
  is what it REFUSES.
*/
do $drive$
declare
  v_p uuid; v_c1 uuid; v_c2 uuid; v_j uuid; v_got jsonb;
begin
  select project_id into v_p from public.projects
   where status = 'active' and not is_fixture
     and project_id <> app.unnamed_project() order by updated_at desc limit 1;
  if v_p is null then
    raise notice '0551: no real active project to drive against; skipped';
    return;
  end if;

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at)
  values ('teamhq', 'drive0551:1', 'grant', 'Add a task',
          'teamhq:drive:zero_five_five_one_a', app.now_utc() - interval '1 minute')
  returning command_id into v_c1;
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority)
  /*
    NOT a `verify:` requester, because `app.harness_task` correctly excludes
    one and this function's whole job is to find a task a REAL conversation
    made — #45's rule: a suite testing something that filters harness traffic
    cannot name its subject the way the filter matches. Safe because the
    whole block ends in a rollback.
  */
  values (gen_random_uuid(), v_p, 'drive-0551-job', 'office.instruction',
          'teamhq:grant', 10)
  returning job_id into v_j;
  update public.inbound_commands set job_id = v_j where command_id = v_c1;

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key)
  values ('teamhq', 'drive0551:2', 'grant', 'Call it something else',
          'teamhq:drive:zero_five_five_one_b')
  returning command_id into v_c2;

  -- Nothing created yet: there is no referent, and that must be null.
  if app.my_task_referent(v_c2) is not null then
    raise exception 'a conversation that created nothing offered a referent';
  end if;

  -- One task from this conversation: that is the referent.
  insert into public.tasks (title, added_by, assigned_to_human, job_id)
  values ('The one this conversation made', 'the office', true, v_j);
  select app.my_task_referent(v_c2) into v_got;
  if v_got is null or v_got ? 'ambiguous' then
    raise exception 'one candidate did not resolve to a referent: %', v_got;
  end if;

  -- Two: ambiguous, and it must say so rather than pick.
  insert into public.tasks (title, added_by, assigned_to_human, job_id)
  values ('A second one from the same conversation', 'the office', true, v_j);
  select app.my_task_referent(v_c2) into v_got;
  if v_got is null or not (v_got ? 'ambiguous') then
    raise exception 'two candidates did not read as ambiguous: %', v_got;
  end if;

  raise notice '0551 drive: none -> null, one -> referent, two -> ambiguous';
  raise exception 'rolling back' using errcode = 'RS001';
exception when sqlstate 'RS001' then
  raise notice '0551 drive rolled back, as intended';
end
$drive$;
