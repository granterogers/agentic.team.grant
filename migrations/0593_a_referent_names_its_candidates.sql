/*
  0593 - the conversation's own tasks, named, and visible to its own turns.

  Behavioural remediation, 24 September 2026, ledger R3 and R5.

  R3. "Mark the Hartley one done" had no door: the conversation could rename
  and re-date a task and could not complete or cancel one, so the model said it
  had and the row stayed todo. The door (src/agents/mine.ts taskStateChange)
  needs to choose a task BY NAME among the ones this conversation made, and
  the referent only returned titles when there were several - no ids, so a
  name that picks exactly one of them could not be acted on. `candidates` now
  carries id and title in both branches.

  It also needs the conversation's PROJECT tasks: "bin the minibus one" names
  a task the office filed on a project, which is not assigned_to_human and so
  was never a referent. `p_any_task` widens the candidate set for that caller
  only; the rename path keeps its personal-only reading by default.

  R5. A harness turn could never find a task a harness turn had made, because
  the candidates excluded every harness task whoever was asking - so every
  test of "actually make that Monday" through the real path answered "nothing
  has gone on your list in this conversation" about the task it had just
  created, and the path could not be measured at all. A harness turn now sees
  its own world, the rule 0355 and the project spine already follow; for a
  real turn app.harness_job is false and the filter is byte-identical.

  The argument list changes, so the old function is dropped by its exact
  signature first (CLAUDE.md: create or replace with a new argument list makes
  a second overload).
*/

drop function if exists app.my_task_referent(uuid, interval);

create function app.my_task_referent(
  p_command_id uuid,
  p_within interval default '02:00:00'::interval,
  p_any_task boolean default false
)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with conversation as (
    select c.origin_channel,
           split_part(c.origin_ref, ':', 1) as chat,
           coalesce(c.subject, c.actor) as who,
           coalesce(c.job_id is not null and app.harness_job(c.job_id), false) as harness
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
    antecedent offers no loose task rather than the newest one (0554).
  */
  began as (select min(received_at) as at from mine),
  candidates as (
    select t.task_id, t.title, t.due_on, t.priority, t.created_at, t.seq
      from public.tasks t, began b, conversation v
     where (t.assigned_to_human or p_any_task)
       and t.state not in ('done', 'cancelled')
       and (v.harness or not app.harness_task(t.is_fixture, t.job_id))
       and (
         -- the office made it, in this conversation
         t.job_id in (select job_id from mine where job_id is not null)
         -- or he made it himself, since this conversation began
         or (t.job_id is null and b.at is not null and t.created_at >= b.at)
       )
  ),
  listed as (
    select coalesce(jsonb_agg(jsonb_build_object('id', task_id, 'title', title)
                              order by seq desc nulls last, created_at desc), '[]'::jsonb) as all_of
      from candidates
  )
  select case
           when (select count(*) from candidates) = 1
             then (select jsonb_build_object(
                     'id', task_id, 'title', title, 'due_on', due_on,
                     'priority', priority, 'created_at', created_at,
                     'candidates', (select all_of from listed))
                     from candidates)
           when (select count(*) from candidates) > 1
             then jsonb_build_object(
                    'ambiguous', (select count(*) from candidates),
                    'titles', (select jsonb_agg(title order by seq desc nulls last, created_at desc) from candidates),
                    'candidates', (select all_of from listed))
           else null
         end
$function$;

comment on function app.my_task_referent(uuid, interval, boolean) is
  'The task(s) THIS conversation made or he made since it began. One is a referent, several are ambiguous and are listed with ids so a name can pick one. A harness turn sees harness tasks; a real turn never does (0593).';
