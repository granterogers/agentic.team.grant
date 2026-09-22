/*
  0558 — a turn must not recognise its OWN work as a duplicate (#316)

  ## What driving the fix found that reading it could not

  Fresh material, `again-accidental`, on v737:

      Grant : work out what the renewal terms cost us over three years…
      office: Somebody is already on that — "work out what the renewal terms
              cost us over three years…" is running now, so I have not
              started it a second time.

  That was the FIRST request. The office refused to do something nobody had
  asked for twice.

  Two causes, both invisible from the source:

  1. The dominant fan-out in this office is not `office.pursue`. It is the
     ROSTER hand-off — `who.alsoConvened` spawns an `office.instruction` child
     per specialist — and it runs BEFORE the duplicate check. So by the time
     `alreadyPursuing` looked, the conversation already held a live job for
     exactly this request: the one this very turn had just created.
  2. `app.conversation_work` returns the descendants of every turn, which is
     right for "what is running" and wrong for "is this already being done" —
     the asker is part of the answer.

  The same run exposed the second half: "how many people are on that?" still
  convened a specialist, because nothing stopped the hand-off for a question
  that canonical state answers outright.

  ## The parameter, not a second function

  `p_except_under` excludes everything descended from one job. Null keeps
  today's behaviour exactly, so the #315 stop path and the head-count reader
  are untouched — only the duplicate check passes it, and only it needs to.
*/

/*
  Dropped by exact signature first. `create or replace` with a changed
  argument list creates a SECOND overload rather than replacing, and
  `conversation_work(uuid)` then matches both — which is what the first run
  of this migration was told, in those words.
*/
drop function if exists app.conversation_work(uuid, interval);

create or replace function app.conversation_work(
  p_command_id uuid,
  p_within interval default interval '24 hours',
  p_except_under uuid default null
) returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with recursive conversation as (
    select c.origin_channel,
           split_part(c.origin_ref, ':', 1) as chat,
           coalesce(c.subject, c.actor) as who
      from public.inbound_commands c
     where c.command_id = p_command_id
  ),
  turns as (
    select c.job_id
      from public.inbound_commands c, conversation v
     where c.origin_channel = v.origin_channel
       and split_part(c.origin_ref, ':', 1) = v.chat
       and coalesce(c.subject, c.actor) = v.who
       and c.received_at >= app.now_utc() - p_within
       and c.job_id is not null
  ),
  descendants as (
    select j.job_id, j.state, j.kind, j.parent_job_id
      from public.jobs j where j.job_id in (select job_id from turns)
    union all
    select k.job_id, k.state, k.kind, k.parent_job_id
      from public.jobs k
      join descendants d on k.parent_job_id = d.job_id
  ),
  /*
    0558. Everything descended from ONE job, so the caller can ask about the
    conversation's work EXCEPT its own turn's.
  */
  mine as (
    select j.job_id from public.jobs j where j.job_id = p_except_under
    union all
    select k.job_id from public.jobs k join mine m on k.parent_job_id = m.job_id
  ),
  handed_on as (
    select * from descendants
     where job_id not in (select job_id from turns)
       and (p_except_under is null or job_id not in (select job_id from mine))
  )
  select jsonb_build_object(
    'in_flight', coalesce((
      select jsonb_agg(jsonb_build_object(
               'job', w.job_id, 'kind', w.kind, 'state', w.state,
               'who', coalesce((select s.name from public.staff s
                                 join public.jobs j2 on j2.job_id = w.job_id
                                where s.slug = j2.recipient_agent), 'someone'),
               /*
                 0557. What it is FOR, in the words it was handed on with.
                 The key differs by kind, so the first one present wins; a
                 kind carrying none of them has no sentence, which is honest.
               */
               'about', left(coalesce(
                 (select j3.pinned_config ->> 'request' from public.jobs j3 where j3.job_id = w.job_id),
                 (select j3.pinned_config ->> 'brief' from public.jobs j3 where j3.job_id = w.job_id),
                 (select j3.pinned_config ->> 'instruction' from public.jobs j3 where j3.job_id = w.job_id),
                 ''), 240))
               order by w.job_id)
        from handed_on w where app.job_is_stoppable(w.state)), '[]'::jsonb),
    'finished', coalesce((
      select count(*)::int from handed_on w where w.state = 'complete'), 0),
    'waiting_on_you', coalesce((
      select count(*)::int from handed_on w
        join public.blockers b on b.job_id = w.job_id
       where b.state = 'open'), 0))
$function$;


comment on function app.conversation_work(uuid, interval, uuid) is
  'What this conversation handed on and what has become of it. '
  'p_except_under excludes everything descended from one job, so a turn '
  'asking "is this already being done" does not find the work it just '
  'started itself. 0555, 0557, 0558.';

do $drive$
declare
  v_p uuid; v_c uuid; v_parent uuid; v_kid uuid; v_all jsonb; v_less jsonb;
begin
  select project_id into v_p from public.projects
   where status = 'active' and not is_fixture
     and project_id <> app.unnamed_project() order by updated_at desc limit 1;
  if v_p is null then raise notice '0558: no real project; skipped'; return; end if;

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key)
  values ('teamhq', 'drive0558:1', 'grant', 'look into the renewals',
          'teamhq:drive:zero_five_five_eight_a')
  returning command_id into v_c;
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state)
  values (extensions.gen_random_uuid(), v_p, 'drive-0558-parent', 'office.instruction',
          'teamhq:grant', 10, 'queued')
  returning job_id into v_parent;
  update public.inbound_commands set job_id = v_parent where command_id = v_c;

  select (app.enqueue_child_once(v_parent, 'office.pursue', 'look into the renewals')
          ->> 'job_id')::uuid into v_kid;

  v_all := app.conversation_work(v_c);
  if jsonb_array_length(v_all -> 'in_flight') <> 1 then
    raise exception '0558: the reader lost the child: %', v_all;
  end if;

  /* And the same question, asked BY that turn, must not see its own work. */
  v_less := app.conversation_work(v_c, interval '24 hours', v_parent);
  if jsonb_array_length(v_less -> 'in_flight') <> 0 then
    raise exception '0558: a turn still sees the work it started itself: %', v_less;
  end if;

  /* A grandchild is excluded too, or a two-deep hand-off self-matches. */
  perform app.enqueue_child_once(v_kid, 'office.instruction', 'look into the renewals');
  v_less := app.conversation_work(v_c, interval '24 hours', v_parent);
  if jsonb_array_length(v_less -> 'in_flight') <> 0 then
    raise exception '0558: a grandchild of this turn was not excluded: %', v_less;
  end if;

  raise exception '0558 drive: sees 1 normally, 0 excluding its own, grandchild too'
    using errcode = 'RS001';
exception when sqlstate 'RS001' then
  raise notice '0558 drive rolled back, as intended';
end
$drive$;
