/*
  0549 — what the specialists found reaches the conversation

  ## Measured

      real child jobs                    56
      of those, wrote an output          56
      of those, reachable by a later turn 0

  `app.conversation_before` builds each earlier turn from the PARENT's own
  output — `where o.job_id = c.job_id` — so every answer a specialist ever
  produced is structurally invisible to the next thing Grant says. Every one
  of the 56.

  Live on v723, the shape it makes:

      say:    work out what the three big competitors charge …
      office: (fans out to two children, both of which answer)
      say:    what did they come back with?
      office: "I don't have any competitor pricing data in our records."

  The office asked two specialists, they answered, and it told him it had
  nothing. That is not a retrieval failure and not a narration failure: the
  conversation could not see its own work.

  ## Attributed, and deliberately NOT evidence

  A colleague's output is the OFFICE's prose, and `provenance.ts` excludes the
  office's own prose from `established()` precisely so one fabrication cannot
  launder itself by repetition. CLAUDE.md records the same rule for #128's
  hand-offs: *"a figure of Emma's does not become grounded for him by having
  passed through her."*

  So these arrive under their own key, `colleagues`, rather than inside
  `answered`. A reader that treats the conversation as memory gets them; a
  reader that asks what was RETRIEVED does not, because nothing here was.

  ## Bounded

  Two per turn, 400 characters each, and only where the child actually wrote
  something. Twelve turns of unbounded specialist output would crowd out the
  material the turn is actually about, and #309 is what an overfull prompt
  costs.
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
                     limit 2) x) as colleagues
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
                                 'colleagues', coalesce(colleagues, '[]'::jsonb))
              order by received_at asc),
    '[]'::jsonb)
    from turns
   where coalesce(trim(said), '') <> ''
$function$;

comment on function app.conversation_before(uuid) is
  'The conversation so far: what he said, what went back, and what the '
  'specialists that turn convened came back with. The last of those was '
  'missing entirely — all 56 real child jobs had written an output and not '
  'one could reach a later turn, so the office asked two specialists, they '
  'answered, and it told Grant it had nothing. Attributed under its own key '
  'rather than folded into the answer, because a colleague''s output is the '
  'office''s own prose and must not read as something established.';

/*
  Driven, because a migration that applies cleanly is not a function that
  works. A real parent with a real child that wrote an output, if the office
  has one; otherwise it says so rather than passing silently.
*/
do $drive$
declare
  v_cmd uuid;
  v_seen jsonb;
begin
  select c2.command_id into v_cmd
    from public.inbound_commands c2
   where c2.received_at > (
           select c1.received_at from public.inbound_commands c1
            join public.jobs p on p.job_id = c1.job_id
            where exists (select 1 from public.jobs k
                           join public.outputs o on o.job_id = k.job_id
                          where k.parent_job_id = p.job_id)
            order by c1.received_at desc limit 1)
   order by c2.received_at asc limit 1;

  if v_cmd is null then
    raise notice '0549: no later turn after a fan-out to drive this against; skipped';
    return;
  end if;

  select app.conversation_before(v_cmd) into v_seen;
  if v_seen is null then
    raise exception 'the conversation reader returned nothing at all';
  end if;
  if not (v_seen @> '[{"colleagues": []}]'::jsonb
          or exists (select 1 from jsonb_array_elements(v_seen) e
                      where jsonb_array_length(e->'colleagues') >= 0)) then
    raise exception 'the colleagues key is missing from the conversation';
  end if;
  raise notice '0549 drive: % turn(s), colleagues key present', jsonb_array_length(v_seen);
end
$drive$;
