/*
  0553 — the window, not the first turn

  0552 let a task Grant typed himself be a referent, dated from the start of
  the exchange. That excludes the commonest real flow there is — he adds
  something on the dashboard and THEN messages the office about it — and it
  made the property untestable wherever a job carries no inbound command at
  all, which is how `verify:mytasks` drives three of its follow-up sections.

  The window is a BOUND. The safety property is EXACTLY ONE: two loose tasks
  inside it, or one of each kind, and the office still asks which. #313's
  invariant is untouched, because what it forbids is choosing among several —
  not looking further back.

  What remains refused is what 0551 was written for: the newest of many,
  picked because it was newest.
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
  /*
    0553. The window, not the first turn.

    0552 dated a task he typed himself from the start of the exchange, which
    excludes the commonest real flow there is: he adds something on the
    dashboard and THEN messages the office about it. It also made the
    property untestable wherever a job carries no command at all.

    The window is a bound, not the safety property. What protects him is
    EXACTLY ONE: two loose tasks in two hours, or one of each kind, and the
    office still asks. That is the whole of #313's invariant, and widening
    a bound does not touch it.
  */
  since as (select app.now_utc() - p_within as at),
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
