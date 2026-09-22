/*
  0557 — the reader can say WHAT each live piece of work is (#316)

  0555 gave a conversation a handle on its own work: what is still stoppable,
  what finished, what is waiting on him. It says the KIND and WHO, which is
  enough to stop things and not enough to answer the question that exposed the
  defect:

      Grant : how many people are on that?
      office: If you want me to create a task for the three-year renewal cost,
              just confirm and point me at the contract and I'll add the
              appropriate owners.

  Two children existed. The true answer was "two", one query away, and it was
  answered from nothing.

  ## What each kind calls the thing it was asked to do

  Measured rather than assumed — the payload key differs per kind, and a
  reader guessing one name would silently return null for the others:

      office.instruction   instruction    536
      artifact.report      brief          124
      office.pursue        request        103

  So `about` takes the first of those that is present. A kind that carries
  none of them still reports its kind and its person; it simply has no
  sentence, which is honest rather than blank.

  This is a reader only. Nothing here decides anything.
*/

/*
  And the writer records what the obligation WAS, so the reader has something
  to read.

  0556 used `p_request` for the key and did not store it, so a caller had to
  remember to put the same sentence in the payload as well — two places for
  one fact, which is the defect this repository records as a row list built
  twice. The drive below caught it on its first run: `about` came back empty
  over a child that had a perfectly good request behind it.

  It only fills a key that is ABSENT. A caller that passed its own `request`,
  `brief` or `instruction` keeps it.
*/
create or replace function app.enqueue_child_once(
  p_parent uuid,
  p_kind text,
  p_request text,
  p_payload jsonb default '{}'::jsonb,
  p_announce boolean default true,
  p_project uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_parent public.jobs;
  v_key text;
  v_id uuid;
  v_live uuid;
  v_payload jsonb;
begin
  select * into v_parent from public.jobs where job_id = p_parent;
  if not found then
    raise exception 'no job % to hang a child on', p_parent using errcode = '23503';
  end if;

  v_key := app.obligation_key(p_parent, p_kind, p_request);
  v_payload := coalesce(p_payload, '{}'::jsonb);
  if coalesce(btrim(p_request), '') <> ''
     and not (v_payload ? 'request' or v_payload ? 'brief' or v_payload ? 'instruction') then
    v_payload := v_payload || jsonb_build_object('request', p_request);
  end if;

  begin
    insert into public.jobs
      (parent_job_id, correlation_id, project_id, idempotency_key, kind,
       requested_by, priority, pinned_config, announce)
    values (
      p_parent, v_parent.correlation_id,
      coalesce(p_project, v_parent.project_id),
      v_key, p_kind, v_parent.requested_by, v_parent.priority,
      v_payload, p_announce)
    returning job_id into v_id;
    return jsonb_build_object('job_id', v_id, 'created', true);
  exception when unique_violation then
    select job_id into v_live from public.jobs
     where idempotency_key = v_key
       and state not in ('complete', 'cancelled', 'failed')
     limit 1;
    return jsonb_build_object('job_id', v_live, 'created', false);
  end;
end;
$function$;

create or replace function app.conversation_work(
  p_command_id uuid,
  p_within interval default interval '24 hours'
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
  handed_on as (
    select * from descendants where job_id not in (select job_id from turns)
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

comment on function app.conversation_work(uuid, interval) is
  'What this conversation handed on and what has become of it: what is still '
  'stoppable and what each piece is FOR, what finished, and what is waiting '
  'on his answer. "how many people are on that?" was being answered from '
  'nothing over two children the conversation had made itself. 0555, 0557.';

do $drive$
declare
  v_p uuid; v_c uuid; v_parent uuid; v_got jsonb; v_kid jsonb;
begin
  select project_id into v_p from public.projects
   where status = 'active' and not is_fixture
     and project_id <> app.unnamed_project() order by updated_at desc limit 1;
  if v_p is null then raise notice '0557: no real project; skipped'; return; end if;

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key)
  values ('teamhq', 'drive0557:1', 'grant', 'work out the renewal terms',
          'teamhq:drive:zero_five_five_seven_a')
  returning command_id into v_c;
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state)
  values (extensions.gen_random_uuid(), v_p, 'drive-0557-parent', 'office.instruction',
          'teamhq:grant', 10, 'queued')
  returning job_id into v_parent;
  update public.inbound_commands set job_id = v_parent where command_id = v_c;

  perform app.enqueue_child_once(v_parent, 'office.pursue',
    'work out what the renewal terms cost us over three years');

  v_got := app.conversation_work(v_c);
  if jsonb_array_length(v_got -> 'in_flight') <> 1 then
    raise exception '0557: expected one in flight, got %', v_got;
  end if;
  v_kid := (v_got -> 'in_flight') -> 0;
  if coalesce(v_kid ->> 'about', '') not like '%renewal terms%' then
    raise exception '0557: the reader could not say what the work is for: %', v_kid;
  end if;

  raise exception '0557 drive: it says what the work is for — %',
    left(v_kid ->> 'about', 60) using errcode = 'RS001';
exception when sqlstate 'RS001' then
  raise notice '0557 drive rolled back, as intended';
end
$drive$;
