/*
  0550 — the office knows what it is still doing

  0549 gave a later turn what the specialists came BACK with. This gives it
  what has not come back.

  Live on v727, three turns apart in one conversation:

      say:    get someone to pull together what we know about the funding timeline
      office: "… in 2 steps … I will come back with what each one actually found."
      (the child job PAUSES, with an open blocker)
      say:    so what is actually being worked on now?
      office: "I don't have a current task list in the records I can see."

  The question is about the OFFICE and it was answered from document
  retrieval, because nothing in the conversation could say what was in
  flight. A child paused on a blocker is the worst case of it: he is waiting
  for the office, the office is waiting for him, and the conversation reports
  neither.

  Two counts per earlier turn — what is still going, and what is waiting on
  him. Counts rather than prose, because the prose is the model's job and the
  fact is the database's.
*/

CREATE OR REPLACE FUNCTION app.conversation_before(p_command_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with self as (
    select origin_channel, split_part(origin_ref, ':', 1) as chat,
           coalesce(subject, actor) as who, received_at
      from public.inbound_commands where command_id = p_command_id
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
     where c.origin_channel = self.origin_channel
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
$function$;
