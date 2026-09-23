/*
  0564 — the conversation can say what became of the obligation (#312)

  0562 modelled the distinction between "this job stopped executing" and "what
  Grant asked for has been done". `check:callers` named it unread within
  minutes, which is the right answer: a model nothing consults is the
  dial-with-no-reader defect this repository records against
  `autonomy_settings`, `public.relations` and `public.contacts`.

  So `conversation_work` — the reader #315, #316 and #317 already share —
  carries it. The turn it reports on is the most recent one that handed
  anything on, which is what an ordinary "what is the state of that?" means.

  Dropped by exact signature first: a fourth defaulted parameter would make a
  second overload, which 0558 was told in those words.
*/

drop function if exists app.conversation_work(uuid, interval, uuid, interval);

CREATE OR REPLACE FUNCTION app.conversation_work(p_command_id uuid, p_within interval DEFAULT '24:00:00'::interval, p_except_under uuid DEFAULT NULL::uuid, p_done_within interval DEFAULT '00:30:00'::interval)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    /*
      0559. Work that has FINISHED recently, with what it produced.

      `in_flight` is stoppable work only, so a request repeated after its
      first attempt finished had nothing to match against and duplicated —
      observed on v741, and it is the real-traffic shape: Grant's two
      identical PDF requests were 190 seconds apart and the first had
      finished. #316's own case list calls this one out: previous work
      completed means answer from the results, not start it again.

      Bounded by `p_done_within` rather than the whole conversation window,
      because "you asked me this an hour ago" and "you asked me this a minute
      ago" deserve different answers, and only the second is somebody
      repeating themselves because nothing arrived.
    */
    'recently_done', coalesce((
      select jsonb_agg(jsonb_build_object(
               'job', w.job_id, 'kind', w.kind,
               'who', coalesce((select s.name from public.staff s
                                 join public.jobs j2 on j2.job_id = w.job_id
                                where s.slug = j2.recipient_agent), 'someone'),
               'about', left(coalesce(
                 (select j3.pinned_config ->> 'request' from public.jobs j3 where j3.job_id = w.job_id),
                 (select j3.pinned_config ->> 'brief' from public.jobs j3 where j3.job_id = w.job_id),
                 (select j3.pinned_config ->> 'instruction' from public.jobs j3 where j3.job_id = w.job_id),
                 ''), 240),
               /*
                 0560. Did it actually deliver, or record that it could not?
                 A job whose content is "I have not done this" is COMPLETE and
                 is not an answer, and suppressing a retry against it tells
                 Grant his repeat was unnecessary when it was the only thing
                 that could still get him an answer.
               */
               'hit_trouble', exists (
                 select 1 from public.job_impediments i where i.job_id = w.job_id),
               'answer', left(coalesce(
                 (select o.body from public.outputs o where o.job_id = w.job_id
                   order by o.created_at desc limit 1), ''), 700))
               order by w.job_id)
        from handed_on w
        join public.jobs jf on jf.job_id = w.job_id
       where w.state = 'complete'
         and jf.finished_at >= app.now_utc() - p_done_within), '[]'::jsonb),
    /*
      0564. What has become of what he actually asked for, by name.

      `jobs.state` says one job stopped executing; this says whether the
      OBLIGATION is still working, waiting on him, partly done or fulfilled.
      Without a reader the model was dead weight — the dial-with-no-reader
      defect CLAUDE.md records, and `check:callers` said so within minutes of
      it being written.

      The most recent turn of this conversation that handed anything on: the
      one an ordinary "what is the state of that?" is about.
    */
    'obligation', (
      select app.obligation_state(c.job_id)::text
        from public.inbound_commands c, conversation v
       where c.origin_channel = v.origin_channel
         and split_part(c.origin_ref, ':', 1) = v.chat
         and coalesce(c.subject, c.actor) = v.who
         and c.job_id is not null
         and c.received_at >= app.now_utc() - p_within
         and exists (select 1 from public.jobs k where k.parent_job_id = c.job_id)
       order by c.received_at desc
       limit 1),
    'waiting_on_you', coalesce((
      select count(*)::int from handed_on w
        join public.blockers b on b.job_id = w.job_id
       where b.state = 'open'), 0))
$function$;

comment on function app.conversation_work(uuid, interval, uuid, interval) is
  'What this conversation handed on and what has become of it, including the '
  'OBLIGATION state of its most recent delegating turn — as opposed to '
  'jobs.state, which says only that one job stopped executing. 0555-0564.';

do $drive$
declare
  v_p uuid; v_c uuid; v_parent uuid; v_kid uuid; v_got jsonb;
begin
  select project_id into v_p from public.projects
   where status = 'active' and not is_fixture
     and project_id <> app.unnamed_project() order by updated_at desc limit 1;
  if v_p is null then raise notice '0564: no real project; skipped'; return; end if;

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key)
  values ('teamhq', 'drive0564:1', 'grant', 'look into the venue',
          'teamhq:drive:zero_five_six_four_a')
  returning command_id into v_c;
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state)
  values (extensions.gen_random_uuid(), v_p, 'drive-0564-parent', 'office.instruction',
          'teamhq:grant', 10, 'queued')
  returning job_id into v_parent;
  update public.inbound_commands set job_id = v_parent where command_id = v_c;

  /* No children yet: this turn has delegated nothing, so there is no obligation to report. */
  v_got := app.conversation_work(v_c);
  if v_got ->> 'obligation' is not null then
    raise exception '0564: a turn that delegated nothing reported an obligation: %', v_got;
  end if;

  select (app.enqueue_child_once(v_parent, 'office.pursue', 'look into the venue')
          ->> 'job_id')::uuid into v_kid;
  v_got := app.conversation_work(v_c);
  if (v_got ->> 'obligation') <> 'working' then
    raise exception '0564: a live child did not read as working: %', v_got ->> 'obligation';
  end if;

  update public.jobs set state = 'running' where job_id = v_kid;
  update public.jobs set state = 'output_created' where job_id = v_kid;
  update public.jobs set state = 'quality_review' where job_id = v_kid;
  update public.jobs set state = 'committing' where job_id = v_kid;
  update public.jobs set state = 'committed' where job_id = v_kid;
  update public.jobs set state = 'notifying' where job_id = v_kid;
  update public.jobs set state = 'complete', finished_at = app.now_utc() where job_id = v_kid;
  update public.jobs set state = 'running' where job_id = v_parent;
  update public.jobs set state = 'output_created' where job_id = v_parent;
  update public.jobs set state = 'quality_review' where job_id = v_parent;
  update public.jobs set state = 'committing' where job_id = v_parent;
  update public.jobs set state = 'committed' where job_id = v_parent;
  update public.jobs set state = 'notifying' where job_id = v_parent;
  update public.jobs set state = 'complete', finished_at = app.now_utc() where job_id = v_parent;
  v_got := app.conversation_work(v_c);
  if (v_got ->> 'obligation') <> 'fulfilled' then
    raise exception '0564: everything complete did not read as fulfilled: %',
      v_got ->> 'obligation';
  end if;

  raise exception '0564 drive: nothing delegated -> null, live -> working, all done -> fulfilled'
    using errcode = 'RS001';
exception when sqlstate 'RS001' then
  raise notice '0564 drive rolled back, as intended';
end
$drive$;
