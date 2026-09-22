/*
  0555 — a conversation can SEE and STOP the work it started (#315)

  ## What happened, in fresh material, on v733

      Grant : have someone pull together everything we know about the two
              suppliers and what switching would involve
      office: …in 2 steps. I will come back with what each one actually found.
              -> 2 children

      Grant : stop that, I do not need it any more
      office: To drop the supplier-switch brief I'll need you to tell me which
              project you want removed…
              -> 0 children stopped

      Grant : is anyone still working on the suppliers thing?
      office: No one's on it right now. I have no task or document queued for
              the two-supplier brief, and there's no record of anyone having
              started work on it.

  Canonical state at that moment: two children, one `paused` and still in
  flight, one `complete` with an output. The office told him nobody had
  started.

  ## Three layers, and only the third is the one worth fixing

  1. Nothing in a conversation can reach a stop. `app.request_stop` exists and
     is reachable only from the dashboard, by job uuid.
  2. `app.cancel_group` cancels a fan-out and **has no caller at all** outside
     one trigger, and that trigger fires on `branch_groups` only. The commonest
     fan-out in this office is `office.pursue` plan steps hanging off
     `parent_job_id`, which has `groups = 0` and therefore no cascade.
  3. The parent was already `complete` when he said stop. `complete` is
     terminal, so "cancel the job that answered me" is not expressible — the
     office answers, finishes, and leaves work running behind it.

  So the handle cannot be a job. It has to be THE CONVERSATION, which is the
  same grounding `app.my_task_referent` uses for #313: a follow-up may act on
  something only where that something is canonically grounded as what he
  meant. Here the grounding is inherited rather than guessed — these are the
  descendants of turns in this chat.

  ## Two functions, because seeing and stopping are different questions

  `conversation_work` answers "is anyone still working on this", which the
  office was answering from nothing. `stop_conversation_work` acts, and
  reports what it stopped AND what it could not — a child that has already
  finished cannot be un-done by cancelling it, and saying "stopped" over a
  completed one would be the claim-with-no-row this repository keeps paying
  for. Taking back what a finished child DID is `app.hq_undo`'s question and
  is deliberately not answered here.

  The stoppable states are `cancel_group`'s list, which is
  `app.job_transitions_allowed` read back: everything that can legally reach
  `cancelled`. Named once (`app.job_is_stoppable`) rather than written out in
  a third place — two lists of the same states compared by eye is how
  `CANCELS` came to differ from the simulator's copy.
*/

create or replace function app.job_is_stoppable(p_state job_state)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  /*
    Derived from the transition table rather than restated. A state gains or
    loses the ability to be cancelled in ONE place, and this follows it.
  */
  select exists (
    select 1 from app.job_transitions_allowed
     where from_state = p_state and to_state = 'cancelled')
$function$;

comment on function app.job_is_stoppable(job_state) is
  'Whether a job in this state can legally be cancelled, read off '
  'app.job_transitions_allowed rather than restated as a third list. 0555.';

/*
  Every job this conversation is responsible for: the turns themselves and
  everything descended from them. Recursive, because a plan step can hand on
  again and #312 is about the office knowing its own lifecycle.
*/
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
  /*
    A turn is not "work someone is doing" — it is the conversation itself. Only
    what was HANDED ON counts, or every question he asks would report itself as
    in flight.
  */
  handed_on as (
    select * from descendants where job_id not in (select job_id from turns)
  )
  select jsonb_build_object(
    'in_flight', coalesce((
      select jsonb_agg(jsonb_build_object(
               'job', w.job_id, 'kind', w.kind, 'state', w.state,
               'who', coalesce((select s.name from public.staff s
                                 join public.jobs j2 on j2.job_id = w.job_id
                                where s.slug = j2.recipient_agent), 'someone'))
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
  'stoppable, what finished, and what is waiting on his answer. The office '
  'was answering "is anyone still working on this" from retrieval and said '
  'nobody had started, over two children it had made itself. 0555.';

/*
  And the act. Separate function, because a reader that mutates is a reader
  nobody can call twice.
*/
create or replace function app.stop_conversation_work(
  p_command_id uuid,
  p_why text default 'you asked me to stop',
  p_within interval default interval '24 hours'
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_before jsonb;
  v_stopped integer := 0;
  v_refused integer := 0;
  v_job uuid;
  v_names text[] := '{}';
begin
  v_before := app.conversation_work(p_command_id, p_within);

  for v_job in
    select (x ->> 'job')::uuid from jsonb_array_elements(v_before -> 'in_flight') x
  loop
    begin
      update public.jobs
         set state = 'cancelled',
             finished_at = app.now_utc(),
             state_reason = left(p_why, 500)
       where job_id = v_job;
      v_stopped := v_stopped + 1;
      v_names := v_names || coalesce(
        (select kind::text from public.jobs where job_id = v_job), 'something');
    exception when others then
      /*
        A job that refused is mid-commit and will finish. Counted and
        reported rather than swallowed: a stop that silently did less than it
        said is the claim-with-no-row defect, and the whole point here is
        that the office was claiming to have stopped things it had not.
      */
      v_refused := v_refused + 1;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'stopped', v_stopped,
    'could_not', v_refused,
    'already_finished', coalesce((v_before ->> 'finished')::int, 0),
    'kinds', to_jsonb(v_names));
end;
$function$;

comment on function app.stop_conversation_work(uuid, text, interval) is
  'Stop what this conversation handed on, and say what was stopped, what '
  'refused, and what had already finished — because a finished child cannot '
  'be un-done by cancelling it, and taking back what it DID is hq_undo''s '
  'question. 0555.';

/*
  Driven, both directions, inside a rollback. The interesting halves are that
  it stops a PAUSED child (the exact state the live reproduction left behind)
  and that it does not touch another conversation's work.
*/
do $drive$
declare
  v_p uuid; v_c uuid; v_other uuid; v_parent uuid; v_kid uuid; v_done uuid;
  v_far uuid; v_got jsonb; v_say text := '';
begin
  select project_id into v_p from public.projects
   where status = 'active' and not is_fixture
     and project_id <> app.unnamed_project() order by updated_at desc limit 1;
  if v_p is null then
    raise notice '0555: no real active project; drive skipped';
    return;
  end if;

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key)
  values ('teamhq', 'drive0555:1', 'grant', 'have someone look into the suppliers',
          'teamhq:drive:zero_five_five_five_a')
  returning command_id into v_c;
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state)
  values (extensions.gen_random_uuid(), v_p, 'drive-0555-parent', 'office.instruction',
          'teamhq:grant', 10, 'queued')
  returning job_id into v_parent;
  update public.inbound_commands set job_id = v_parent where command_id = v_c;

  /* One child PAUSED — the state the live reproduction actually left. */
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state, parent_job_id)
  values (extensions.gen_random_uuid(), v_p, 'drive-0555-kid', 'office.pursue',
          'teamhq:grant', 10, 'queued', v_parent)
  returning job_id into v_kid;
  update public.jobs set state = 'paused' where job_id = v_kid;

  /* And one already COMPLETE, which a stop must NOT claim to have stopped. */
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state, parent_job_id)
  values (extensions.gen_random_uuid(), v_p, 'drive-0555-done', 'office.instruction',
          'teamhq:grant', 10, 'queued', v_parent)
  returning job_id into v_done;
  update public.jobs set state = 'running' where job_id = v_done;
  update public.jobs set state = 'output_created' where job_id = v_done;
  update public.jobs set state = 'quality_review' where job_id = v_done;
  update public.jobs set state = 'committing' where job_id = v_done;
  update public.jobs set state = 'committed' where job_id = v_done;
  update public.jobs set state = 'notifying' where job_id = v_done;
  update public.jobs set state = 'complete', finished_at = app.now_utc()
   where job_id = v_done;

  /* A DIFFERENT conversation with live work of its own, which must survive. */
  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key)
  values ('telegram', 'drive0555other:1', 'grant', 'something else entirely',
          'telegram:drive:zero_five_five_five_b')
  returning command_id into v_other;
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state)
  values (extensions.gen_random_uuid(), v_p, 'drive-0555-far', 'office.instruction',
          'teamhq:grant', 10, 'queued')
  returning job_id into v_far;
  update public.inbound_commands set job_id = v_far where command_id = v_other;

  v_got := app.conversation_work(v_c);
  if jsonb_array_length(v_got -> 'in_flight') <> 1 then
    raise exception '0555: expected one in-flight child, got %', v_got;
  end if;
  if (v_got ->> 'finished')::int <> 1 then
    raise exception '0555: the finished child was not counted: %', v_got;
  end if;
  v_say := v_say || 'sees 1 in flight and 1 finished; ';

  v_got := app.stop_conversation_work(v_c, 'you asked me to stop');
  if (v_got ->> 'stopped')::int <> 1 then
    raise exception '0555: the paused child was not stopped: %', v_got;
  end if;
  if (v_got ->> 'already_finished')::int <> 1 then
    raise exception '0555: it did not say what it could not take back: %', v_got;
  end if;
  v_say := v_say || 'stopped the paused one; ';

  if (select state from public.jobs where job_id = v_kid) <> 'cancelled' then
    raise exception '0555: canonical state says the child is still live';
  end if;
  if (select state from public.jobs where job_id = v_done) <> 'complete' then
    raise exception '0555: it cancelled a job that had already finished';
  end if;
  if (select state from public.jobs where job_id = v_far) <> 'queued' then
    raise exception '0555: it reached into another conversation';
  end if;
  v_say := v_say || 'left the finished one and the other chat alone; ';

  /* Asked again, there is nothing left to stop and it says so honestly. */
  v_got := app.stop_conversation_work(v_c);
  if (v_got ->> 'stopped')::int <> 0 then
    raise exception '0555: a second stop claimed to stop something: %', v_got;
  end if;
  v_say := v_say || 'a second stop stops nothing; ';

  /* And a conversation that does not exist acts on nothing at all. */
  v_got := app.stop_conversation_work(extensions.gen_random_uuid());
  if (v_got ->> 'stopped')::int <> 0 then
    raise exception '0555: an unknown conversation stopped something: %', v_got;
  end if;
  v_say := v_say || 'no conversation stops nothing';

  raise exception '0555 drive: %', v_say using errcode = 'RS001';
exception when sqlstate 'RS001' then
  raise notice '0555 drive rolled back, as intended';
end
$drive$;
