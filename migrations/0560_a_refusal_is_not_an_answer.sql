/*
  0560 — a job that finished saying it could not is not an answer (#316 case 9)

  ## What v743 produced, correctly by the letter of 0559

      Grant : work out what the renewal terms cost us over three years…
      Grant : work out what the renewal terms cost us over three years…
      office: You asked me that a moment ago and it came back — here is what
              Grace found:

              I have not done this. I understood what you want and could not
              carry it out — say it again in a sentence and I will.

  The child was `complete`; its content was a refusal. So the office relayed
  "here is what she found" over a finding that does not exist, AND suppressed
  the retry — the one thing that could still have got him an answer. He is
  told his repeat was unnecessary at the exact moment it was necessary.

  #316's ninth case says it plainly: previous work failed, explain or retry
  appropriately. Retrying is appropriate, and suppression is the opposite.

  ## The canonical signal, not the wording

  `public.job_impediments` is where a handler records `app.cannot`, so a
  finished job that hit trouble says so in a table rather than in prose.
  Reading the BODY for "I have not done this" would be a wording lock, which
  this repository records six times, and the coherence gate's own refusals
  are phrased half a dozen ways.

  Dropped by exact signature first — `create or replace` with a changed
  argument list makes a second overload.
*/

drop function if exists app.conversation_work(uuid, interval, uuid, interval);

create or replace function app.conversation_work(
  p_command_id uuid,
  p_within interval default interval '24 hours',
  p_except_under uuid default null,
  p_done_within interval default interval '30 minutes'
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
    'waiting_on_you', coalesce((
      select count(*)::int from handed_on w
        join public.blockers b on b.job_id = w.job_id
       where b.state = 'open'), 0))
$function$;




comment on function app.conversation_work(uuid, interval, uuid, interval) is
  'What this conversation handed on and what has become of it: what is still '
  'running, what finished RECENTLY with what it produced and whether it hit '
  'trouble, and what is waiting on his answer. 0555-0560.';

do $drive$
declare
  v_p uuid; v_c uuid; v_parent uuid; v_kid uuid; v_got jsonb;
begin
  select project_id into v_p from public.projects
   where status = 'active' and not is_fixture
     and project_id <> app.unnamed_project() order by updated_at desc limit 1;
  if v_p is null then raise notice '0560: no real project; skipped'; return; end if;

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key)
  values ('teamhq', 'drive0560:1', 'grant', 'price the competitors',
          'teamhq:drive:zero_five_six_zero_a')
  returning command_id into v_c;
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state)
  values (extensions.gen_random_uuid(), v_p, 'drive-0560-parent', 'office.instruction',
          'teamhq:grant', 10, 'queued')
  returning job_id into v_parent;
  update public.inbound_commands set job_id = v_parent where command_id = v_c;

  select (app.enqueue_child_once(v_parent, 'office.pursue', 'price the competitors')
          ->> 'job_id')::uuid into v_kid;
  update public.jobs set state = 'running' where job_id = v_kid;
  update public.jobs set state = 'output_created' where job_id = v_kid;
  insert into public.outputs (job_id, body, deterministic, evidence, confidence)
  values (v_kid, 'I have not done this.', true, 'verified', 'high');
  update public.jobs set state = 'quality_review' where job_id = v_kid;
  update public.jobs set state = 'committing' where job_id = v_kid;
  update public.jobs set state = 'committed' where job_id = v_kid;
  update public.jobs set state = 'notifying' where job_id = v_kid;
  update public.jobs set state = 'complete', finished_at = app.now_utc() where job_id = v_kid;

  /* Clean, so far: it delivered something and nothing says otherwise. */
  v_got := app.conversation_work(v_c);
  if coalesce((((v_got -> 'recently_done') -> 0) ->> 'hit_trouble')::boolean, true) then
    raise exception '0560: a clean job was reported as troubled: %', v_got;
  end if;

  perform app.cannot(v_kid, 'not_capable', 'price the competitors', 'finance-director',
                     'no pricing data', 'price the competitors');
  v_got := app.conversation_work(v_c);
  if not coalesce((((v_got -> 'recently_done') -> 0) ->> 'hit_trouble')::boolean, false) then
    raise exception '0560: a job that recorded an impediment reads as clean: %', v_got;
  end if;

  raise exception '0560 drive: clean reads clean, and an impediment reads as trouble'
    using errcode = 'RS001';
exception when sqlstate 'RS001' then
  raise notice '0560 drive rolled back, as intended';
end
$drive$;
