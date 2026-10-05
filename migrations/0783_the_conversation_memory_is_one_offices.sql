-- 0783 - the conversation memory a model is shown is THIS office's conversation (multi-user P3, cluster h-jobs).
--
-- A conversation was found by (origin channel, the first segment of origin_ref - the chat or thread -, the speaker). Those
-- three are chosen by the SENDER's door, not by the office: two offices whose people talk to the same bot account, or
-- whose Slack threads happen to carry the same reference, shared one conversation, and the memory built for A's next
-- prompt held B's words, B's answers and B's colleagues' replies. Every reader below now starts from the command it was
-- handed - INSIDE the office the worker asked for (p_office is the claimed job's, `app.job_office`) - and finds the rest
-- of the conversation only among that office's commands, jobs, deliveries and questions.
--
--   conversation_before, conversation_extent, recall_conversation, recent_exchange
--   conversation_work, another_pair_of_eyes, stop_conversation_work
--   my_task_referent, open_questions_for_reply
--
-- A command of another office and a command that does not exist read the same: an empty conversation. Nothing about
-- the other office is shown, and the writers (stop_conversation_work) cancel only this office's jobs.
--
-- The language-sql readers became plpgsql so that `app.require_office` runs FIRST: a null or unknown office is refused
-- even when the command it was asked about does not exist (a filter on the office would never be evaluated then).
--
-- Also in recent_exchange: the speaker of the human turns was the literal 'grant'. It is the office's person now
-- (`app.office_actor`), which is 'grant' for Grant's office and the person's own name for anyone else's.

create function app.conversation_work(p_office uuid, p_command_id uuid, p_within interval DEFAULT '24:00:00'::interval, p_except_under uuid DEFAULT NULL::uuid, p_done_within interval DEFAULT '00:30:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
  with recursive conversation as (
    select c.origin_channel,
           split_part(c.origin_ref, ':', 1) as chat,
           coalesce(c.subject, c.actor) as who
      from public.inbound_commands c
     where c.command_id = p_command_id and c.office_id = p_office
  ),
  turns as (
    select c.job_id
      from public.inbound_commands c, conversation v
     where c.office_id = p_office
       and c.origin_channel = v.origin_channel
       and split_part(c.origin_ref, ':', 1) = v.chat
       and coalesce(c.subject, c.actor) = v.who
       and c.received_at >= app.now_utc() - p_within
       and c.job_id is not null
  ),
  descendants as (
    select j.job_id, j.state, j.kind, j.parent_job_id
      from public.jobs j where j.job_id in (select job_id from turns) and j.office_id = p_office
    union all
    select k.job_id, k.state, k.kind, k.parent_job_id
      from public.jobs k
      join descendants d on k.parent_job_id = d.job_id and k.office_id = p_office
  ),
  /*
    0558. Everything descended from ONE job, so the caller can ask about the
    conversation's work EXCEPT its own turn's.
  */
  mine as (
    select j.job_id from public.jobs j where j.job_id = p_except_under and j.office_id = p_office
    union all
    select k.job_id from public.jobs k join mine m on k.parent_job_id = m.job_id and k.office_id = p_office
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
       where c.office_id = p_office
         and c.origin_channel = v.origin_channel
         and split_part(c.origin_ref, ':', 1) = v.chat
         and coalesce(c.subject, c.actor) = v.who
         and c.job_id is not null
         and c.received_at >= app.now_utc() - p_within
         and (exists (select 1 from public.jobs k where k.parent_job_id = c.job_id)
              or exists (select 1 from public.job_pauses pz where pz.job_id = c.job_id and pz.resumed_at is null and pz.resumable = false))
       order by c.received_at desc
       limit 1),
    'waiting_on_you', coalesce((
      select count(*)::int from handed_on w
        join public.blockers b on b.job_id = w.job_id
       where b.state = 'open'), 0)
      + coalesce((
      select count(*)::int from turns t2
        join public.job_pauses p2 on p2.job_id = t2.job_id
        join public.jobs j2 on j2.job_id = t2.job_id
       where p2.resumed_at is null and p2.resumable = false and j2.state = 'paused'), 0))
  );
end;
$function$;
revoke all on function app.conversation_work(uuid, uuid, interval, uuid, interval) from public, anon, authenticated, service_role;
drop function app.conversation_work(uuid, interval, uuid, interval);

create function app.conversation_before(p_office uuid, p_command_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
  with self as (
    select origin_channel, split_part(origin_ref, ':', 1) as chat,
           coalesce(subject, actor) as who, received_at
      from public.inbound_commands
     where command_id = p_command_id and office_id = p_office
  ),
  turns as (
    select c.received_at,
           coalesce(c.transcript, c.instruction) as said,
           -- The answer that went out for that turn, when there was one. Read
           -- from `outputs` through the job, because that is the text actually
           -- delivered rather than a second copy of it.
           (select left(o.body, 700) from public.outputs o
             where o.job_id = c.job_id order by o.created_at desc limit 1) as answered,
           /*
             And what the specialists this turn convened came back with.

             Attributed and separate, never folded into `answered`: a
             colleague's output is the office's own prose, and merging the two
             would let a figure invented downstream read as something the
             office had established. Bounded at two, because twelve turns of
             unbounded specialist output would crowd out the material the
             current turn is about.
           */
           (select jsonb_agg(x.line)
              from (select left(o2.body, 400) as line
                      from public.jobs k
                      join public.outputs o2 on o2.job_id = k.job_id
                     where k.parent_job_id = c.job_id
                       and coalesce(trim(o2.body), '') <> ''
                     order by o2.created_at desc
                     limit 2) x) as colleagues,
           /*
             AND WHAT IS STILL IN FLIGHT FROM THAT TURN (0550).

             `colleagues` is what came BACK. This is what has not: a child
             still running, or paused with an open blocker waiting on Grant.

             Live on v727: turn 0 fanned out, its child PAUSED, and three
             turns later "so what is actually being worked on now?" was
             answered "I don't have a current task list in the records I can
             see." The office does not know what it is doing, because nothing
             ever told it — the question is about the office and it was
             answered from document retrieval.
           */
           (select count(*) from public.jobs k2
             where k2.parent_job_id = c.job_id
               and k2.state not in ('complete', 'failed', 'cancelled')) as still_going,
           (select count(*) from public.blockers b
             join public.jobs k3 on k3.job_id = b.job_id
            where k3.parent_job_id = c.job_id and b.state = 'open') as waiting_on_you
      from public.inbound_commands c, self
     where c.office_id = p_office
       and c.origin_channel = self.origin_channel
       and split_part(c.origin_ref, ':', 1) = self.chat
       and coalesce(c.subject, c.actor) = self.who
       and c.callback_action is null
       and c.command_id <> p_command_id
       and c.received_at < self.received_at
       and c.received_at > self.received_at - make_interval(
             mins => coalesce(
               (select value::text::integer from public.system_config
                 where key = 'conversation.window_minutes'), 30))
     order by c.received_at desc
     limit coalesce(
       (select value::text::integer from public.system_config
         where key = 'conversation.max_turns'), 12)
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('said', said, 'answered', answered,
                                 'colleagues', coalesce(colleagues, '[]'::jsonb),
                                 'stillGoing', still_going,
                                 'waitingOnYou', waiting_on_you)
              order by received_at asc),
    '[]'::jsonb)
    from turns
   where coalesce(trim(said), '') <> ''
  );
end;
$function$;
revoke all on function app.conversation_before(uuid, uuid) from public, anon, authenticated, service_role;
drop function app.conversation_before(uuid);

create function app.conversation_extent(p_office uuid, p_command_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
  with self as (
    select origin_channel, split_part(origin_ref, ':', 1) as chat,
           coalesce(subject, actor) as who, received_at
      from public.inbound_commands
     where command_id = p_command_id and office_id = p_office
  ),
  mine as (
    select c.received_at
      from public.inbound_commands c, self
     where c.office_id = p_office
       and c.origin_channel = self.origin_channel
       and split_part(c.origin_ref, ':', 1) = self.chat
       and coalesce(c.subject, c.actor) = self.who
       and c.callback_action is null
       and c.received_at <= self.received_at
  )
  select jsonb_build_object(
    'turns_total', (select count(*)::int from mine),
    'oldest_minutes_ago',
      coalesce((select round(extract(epoch from (app.now_utc() - min(received_at))) / 60)::int
                  from mine), 0),
    'window_turns', coalesce(
      (select value::text::integer from public.system_config
        where key = 'conversation.max_turns'), 12),
    'window_minutes', coalesce(
      (select value::text::integer from public.system_config
        where key = 'conversation.window_minutes'), 30)
  )
  );
end;
$function$;
revoke all on function app.conversation_extent(uuid, uuid) from public, anon, authenticated, service_role;
drop function app.conversation_extent(uuid);

create function app.recall_conversation(p_office uuid, p_command_id uuid, p_query text, p_limit integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
  with self as (
    select origin_channel, split_part(origin_ref, ':', 1) as chat,
           coalesce(subject, actor) as who, received_at
      from public.inbound_commands
     where command_id = p_command_id and office_id = p_office
  ),
  /*
    The edge of the working window.

    Everything at or after this is ALREADY in the prompt, so returning it would
    spend tokens repeating what the model can see. Recall is for what the window
    cannot reach -- which is the only reason this function exists.
  */
  edge as (
    select self.received_at - make_interval(mins => coalesce(
             (select value::text::integer from public.system_config
               where key = 'conversation.window_minutes'), 30)) as older_than
      from self
  ),
  older as (
    select c.received_at,
           coalesce(c.transcript, c.instruction) as said,
           (select left(o.body, 600) from public.outputs o
             where o.job_id = c.job_id order by o.created_at desc limit 1) as answered
      from public.inbound_commands c, self, edge
     where c.office_id = p_office
       and c.origin_channel = self.origin_channel
       and split_part(c.origin_ref, ':', 1) = self.chat
       and coalesce(c.subject, c.actor) = self.who
       and c.callback_action is null
       and c.command_id <> p_command_id
       and c.received_at < edge.older_than
  ),
  matched as (
    select o.received_at, o.said, o.answered,
           ts_rank(
             to_tsvector('english', coalesce(o.said, '') || ' ' || coalesce(o.answered, '')),
             plainto_tsquery('english', coalesce(nullif(btrim(p_query), ''), 'x'))
           ) as rank
      from older o
     where to_tsvector('english', coalesce(o.said, '') || ' ' || coalesce(o.answered, ''))
           @@ plainto_tsquery('english', coalesce(nullif(btrim(p_query), ''), 'x'))
     order by rank desc, o.received_at desc
     limit greatest(coalesce(p_limit, 3), 1)
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'at', received_at,
      'minutes_ago', round(extract(epoch from (app.now_utc() - received_at)) / 60)::int,
      'said', said,
      'answered', answered
    ) order by received_at asc),
    '[]'::jsonb)
    from matched
  );
end;
$function$;
revoke all on function app.recall_conversation(uuid, uuid, text, integer) from public, anon, authenticated, service_role;
drop function app.recall_conversation(uuid, text, integer);

create function app.recent_exchange(p_office uuid, p_command_id uuid, p_minutes integer DEFAULT 90, p_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
  with self as (
    select * from public.inbound_commands
     where command_id = p_command_id and office_id = p_office
  ),
  -- What he said. Excludes button presses: a callback is an answer to a
  -- question, already recorded against it, and reading "useful" back as a
  -- conversational turn is noise.
  said as (
    select c.received_at as at,
           app.office_actor(p_office)::text  as who,
           coalesce(c.transcript, c.instruction) as text
      from public.inbound_commands c, self
     where c.office_id = p_office
       and c.command_id <> self.command_id
       and c.origin_channel = self.origin_channel
       and split_part(c.origin_ref, ':', 1) = split_part(self.origin_ref, ':', 1)
       and coalesce(c.addressed_to, '') = coalesce(self.addressed_to, '')
       and coalesce(c.subject, c.actor) = coalesce(self.subject, self.actor)
       and c.callback_action is null
       and c.received_at < self.received_at
       and c.received_at >= self.received_at
             - make_interval(mins => greatest(coalesce(p_minutes, 90), 1))
       and coalesce(btrim(coalesce(c.transcript, c.instruction)), '') <> ''
  ),
  /*
    What went back to him.

    Joined through the job that answered each command rather than through the
    delivery, because a delivery row says a message was sent and not what was
    in it. `outputs.body` is the text, and it has no project_id — it joins
    through `jobs`, which is a trap already recorded in CLAUDE.md.
  */
  replied as (
    select o.created_at as at,
           coalesce(st.slug, 'the office') as who,
           o.body as text
      from self
      join public.inbound_commands c
        on c.office_id = p_office
       and c.origin_channel = self.origin_channel
       and split_part(c.origin_ref, ':', 1) = split_part(self.origin_ref, ':', 1)
       and coalesce(c.addressed_to, '') = coalesce(self.addressed_to, '')
      join public.jobs j
        on j.pinned_config ->> 'command_id' = c.command_id::text
       and j.office_id = p_office
      join public.outputs o
        on o.job_id = j.job_id
      left join public.staff st on st.staff_id = o.staff_id
     where o.created_at < self.received_at
       and o.created_at >= self.received_at
             - make_interval(mins => greatest(coalesce(p_minutes, 90), 1))
       and coalesce(btrim(o.body), '') <> ''
  ),
  turns as (
    select * from said
    union all
    select * from replied
  )
  select coalesce(jsonb_agg(t order by t.at), '[]'::jsonb)
    from (
      select at, who,
             -- Capped per turn. A 4,000-character answer three turns ago is
             -- not what "make it longer" refers to, and carrying it whole is
             -- how a context window becomes the cost of the feature.
             left(text, 600) as text
        from turns
       order by at desc
       limit greatest(coalesce(p_limit, 12), 1)
    ) t
  );
end;
$function$;
revoke all on function app.recent_exchange(uuid, uuid, integer, integer) from public, anon, authenticated, service_role;
drop function app.recent_exchange(uuid, integer, integer);

create function app.my_task_referent(p_office uuid, p_command_id uuid, p_within interval DEFAULT '02:00:00'::interval, p_any_task boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
  with conversation as (
    select c.origin_channel,
           split_part(c.origin_ref, ':', 1) as chat,
           coalesce(c.subject, c.actor) as who,
           coalesce(c.job_id is not null and app.harness_job(c.job_id), false) as harness
      from public.inbound_commands c
     where c.command_id = p_command_id and c.office_id = p_office
  ),
  mine as (
    select c.job_id, c.received_at
      from public.inbound_commands c, conversation v
     where c.office_id = p_office
       and c.origin_channel = v.origin_channel
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
     where t.office_id = p_office
       and (t.assigned_to_human or p_any_task)
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
  );
end;
$function$;
revoke all on function app.my_task_referent(uuid, uuid, interval, boolean) from public, anon, authenticated, service_role;
drop function app.my_task_referent(uuid, interval, boolean);

create function app.open_questions_for_reply(p_office uuid, p_command uuid)
 RETURNS TABLE(id text, what text, options text[], bindable boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return query
  with recursive me as (
    select c.origin_channel::text as ch, split_part(c.origin_ref, ':', 1) as chat,
           coalesce(c.subject, c.actor) as who, c.command_id,
           coalesce(c.context ->> 'forwarded', 'false') = 'true' as forwarded,
           nullif(coalesce(c.context ->> 'reply_to_message_id', c.context ->> 'thread_ts'), '') as points_at,
           app.command_account(c.command_id) as account,
           coalesce(c.synthetic, false) as synthetic
      from public.inbound_commands c
     where c.command_id = p_command and c.office_id = p_office
  ), ours as (
    select c.job_id from public.inbound_commands c, me
     where c.office_id = p_office
       and c.origin_channel::text = me.ch
       and split_part(c.origin_ref, ':', 1) = me.chat
       and coalesce(c.subject, c.actor) = me.who
       and c.command_id <> me.command_id
       and c.job_id is not null
       and c.received_at >= app.now_utc() - interval '12 hours'
     order by c.received_at desc
     limit 1
  ), tree as (
    select job_id from ours
    union
    select j.job_id from public.jobs j join tree t on j.parent_job_id = t.job_id and j.office_id = p_office
  ), shown as (
    -- What he was SHOWN in this conversation, by the question each message named.
    select d.blocker_id, d.sent_at, d.delivery_id
      from public.deliveries d, me
     where d.office_id = p_office
       and d.blocker_id is not null and d.state = 'sent'
       and d.channel = me.ch and d.target_ref = me.chat
       and (me.account is null or d.account_ref = me.account)
       and d.sent_at >= app.now_utc() - interval '12 hours'
  ), last_sent as (
    select d.blocker_id from public.deliveries d, me
     where d.office_id = p_office
       and d.state = 'sent' and d.channel = me.ch and d.target_ref = me.chat
       and (me.account is null or d.account_ref = me.account)
     order by d.sent_at desc, d.delivery_id desc limit 1
  ), replied as (
    -- The message(s) his reply points at. A Telegram message id is unique per bot, so it names one delivery. A Slack
    -- thread is flat: a reply names the thread's ROOT, so every question posted in that thread is a candidate, and
    -- the reply binds only when exactly one of them is still open.
    select distinct d.blocker_id from public.deliveries d, me
     where d.office_id = p_office
       and me.points_at is not null and d.state = 'sent' and d.blocker_id is not null
       and d.channel = me.ch and d.target_ref = me.chat
       and (me.account is null or d.account_ref = me.account)
       and (d.message_ref = me.points_at or (me.ch = 'slack' and d.thread_ref = me.points_at))
  ), replied_open as (
    select count(*) as n from replied r
      join public.blockers b on b.blocker_id = r.blocker_id and b.state = 'open' and b.office_id = p_office
  ), awaiting as (
    select nullif(j.pinned_config ->> 'awaiting_answer', '')::uuid as blocker_id
      from public.jobs j where j.job_id = (select job_id from ours) and j.office_id = p_office
  ), open_shown as (
    select count(distinct s.blocker_id) as n from shown s
      join public.blockers b on b.blocker_id = s.blocker_id and b.state = 'open' and b.office_id = p_office
  )
  select b.blocker_id::text, b.requested_action, coalesce(b.approval_options, array[]::text[]),
         coalesce(case
           -- the one question the office's last reply said it was waiting on - unless this reply POINTS somewhere
           when (select points_at from me) is null and b.blocker_id = (select blocker_id from awaiting) then true   -- the turn before pinned exactly this one (#374)
           when (select points_at from me) is not null then (select n from replied_open) = 1   -- exactly the one it points at
           when (select ch from me) in ('telegram', 'slack') then
             (select n from open_shown) = 1 and b.blocker_id = (select blocker_id from last_sent)
             and b.job_id in (select job_id from tree)   -- and it came out of the turn before this one (0622)
           -- the dashboard chat and voice: a conversation is the unit, and the turn before is inside it. Exactly one
           -- open question in that turn's tree is what the office just said it was waiting on; two are named, not guessed.
           else (select count(*) from public.blockers x
                  where x.office_id = p_office and x.state = 'open' and x.job_id in (select job_id from tree)) = 1
         end, false)
    from public.blockers b
   where b.office_id = p_office
     and b.state = 'open'
     and not coalesce((select forwarded from me), false)
     and (
       -- a reply that points at a message answers the question THAT message asked, or nothing at all
       (select points_at from me) is not null and b.blocker_id in (select blocker_id from replied)
       or (
         (select points_at from me) is null
         and (
           (select ch from me) in ('telegram', 'slack') and b.blocker_id in (select blocker_id from shown)
           -- channels with no message identity: the questions of the turn before (bindable only when exactly one is open)
           or (select ch from me) not in ('telegram', 'slack') and b.job_id in (select job_id from tree)
         )
       )
       -- or the one question the office's previous reply said it was still waiting on (#374)
       or ((select points_at from me) is null and b.blocker_id = (select blocker_id from awaiting))
     )
     -- a command a harness declared may answer only harness work (the press path says the same)
     and (not (select synthetic from me) or app.harness_job(b.job_id))
   order by b.created_at desc limit 5
  ;
end;
$function$;
revoke all on function app.open_questions_for_reply(uuid, uuid) from public, anon, authenticated, service_role;
drop function app.open_questions_for_reply(uuid);

create function app.another_pair_of_eyes(p_office uuid, p_command_id uuid, p_except_under uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_work jsonb;
  v_item jsonb;
  v_about text;
  v_taken text[];
  v_slug text;
begin
  v_work := app.conversation_work(p_office, p_command_id, interval '24 hours', p_except_under);

  /*
    Running first, then just-finished. A second opinion on work still in
    flight is the commoner ask, and one on work that just came back is the
    other half of #316's list.
  */
  v_item := coalesce((v_work -> 'in_flight') -> -1, (v_work -> 'recently_done') -> -1);
  if v_item is null then
    return jsonb_build_object('ok', false, 'why', 'nothing to look at again');
  end if;
  v_about := coalesce(v_item ->> 'about', '');
  if btrim(v_about) = '' then
    return jsonb_build_object('ok', false, 'why', 'nothing to look at again');
  end if;

  /* Everybody already carrying this obligation, so a second opinion is one. */
  select coalesce(array_agg(distinct x.who), '{}')
    into v_taken
    from (
      select j.recipient_agent as who
        from jsonb_array_elements(coalesce(v_work -> 'in_flight', '[]'::jsonb)) e
        join public.jobs j on j.job_id = (e ->> 'job')::uuid and j.office_id = p_office
       where j.recipient_agent is not null
      union
      select j.recipient_agent
        from jsonb_array_elements(coalesce(v_work -> 'recently_done', '[]'::jsonb)) e
        join public.jobs j on j.job_id = (e ->> 'job')::uuid and j.office_id = p_office
       where j.recipient_agent is not null
    ) x;

  /*
    Somebody with a reason to have an opinion, then anybody at all. An empty
    answer is the defect this migration exists to remove, so the fallback is
    deliberate rather than tidy.
  */
  select k.slug into v_slug
    from app.who_knows_about(v_about, 8) k
   where not (k.slug = any(v_taken))
   limit 1;

  if v_slug is null then
    -- (This said `s.retired_at is null`. `public.staff` has no such column - a withdrawn specialist is `active = false` -
    -- so the fallback raised 42703 the first time nobody outside the taken list knew the subject. Found by driving it.)
    select s.slug into v_slug from public.staff s
     where s.active
       and not (s.slug = any(v_taken))
     order by s.slug
     limit 1;
  end if;

  if v_slug is null then
    return jsonb_build_object('ok', false, 'why', 'everybody is already on it');
  end if;

  return jsonb_build_object('ok', true, 'slug', v_slug, 'about', v_about,
                            'already_on_it', to_jsonb(v_taken));
end;
$function$;
revoke all on function app.another_pair_of_eyes(uuid, uuid, uuid) from public, anon, authenticated, service_role;
drop function app.another_pair_of_eyes(uuid, uuid);

create function app.stop_conversation_work(p_office uuid, p_command_id uuid, p_why text DEFAULT 'you asked me to stop'::text, p_within interval DEFAULT '24:00:00'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_before jsonb;
  v_stopped integer := 0;
  v_refused integer := 0;
  v_job uuid;
  v_names text[] := '{}';
begin
  perform app.require_office(p_office);
  v_before := app.conversation_work(p_office, p_command_id, p_within);

  for v_job in
    select (x ->> 'job')::uuid from jsonb_array_elements(v_before -> 'in_flight') x
  loop
    begin
      update public.jobs
         set state = 'cancelled',
             finished_at = app.now_utc(),
             state_reason = left(p_why, 500)
       where job_id = v_job and office_id = p_office;
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
revoke all on function app.stop_conversation_work(uuid, uuid, text, interval) from public, anon, authenticated, service_role;
drop function app.stop_conversation_work(uuid, text, interval);
