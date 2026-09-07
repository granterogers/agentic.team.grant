-- 0089 — A conversation, not a command line
--
-- Grant, in Telegram, over forty-three seconds:
--
--     11:23:26  no that's not wring
--     11:23:32  there is already a project called ai learning
--     11:23:45  you need to upload the YT video to that
--     11:23:52  let is get trsnscribed
--     11:24:07  then get back to me with summary and include relevant links
--     11:24:09  is that clear?
--
-- Six messages. Six jobs. Six unrelated answers, each one a model doing its
-- best with a sentence that means nothing on its own — *"We're fine with the
-- existing AI Learning project, no meeting needed"*, *"Yes, it's clear"*.
--
-- Every part worked. The webhook received each message, the router classified
-- each one, retrieval ran on each one, and each reply was delivered to the
-- right chat by the right bot. What was missing is that this is how people
-- talk: a correction, then a fact, then an instruction, then a check that you
-- followed. Answering the sixth without the first five is not a bug in any one
-- component; it is the absence of a component.
--
-- ## What this adds
--
-- A conversation is the recent messages from one person in one chat. Not a
-- table — `inbound_commands` already holds every turn with its time, its chat
-- and its subject — but a function that reads them back in order, so that
-- every handler asking "what is going on here" gets the same answer.
--
-- ## Why a window and not a session
--
-- There is no "conversation ended" event in a chat. A session table would need
-- one and would guess, and the guess would be wrong at exactly the moment
-- Grant came back to something an hour later. A window of recent turns is
-- honest about what it knows: these are the things said lately, in order.
--
-- Thirty minutes and twelve turns. Long enough to hold the exchange above with
-- room to spare, short enough that yesterday's subject does not colour today's.

begin;

insert into public.system_config (key, value, description) values
  ('conversation.window_minutes', to_jsonb(30),
   'How far back a handler looks for the turns before this one. A window, not '
   'a session: a chat has no "conversation ended" event, so anything claiming '
   'to know where one stopped would be guessing.'),
  ('conversation.max_turns', to_jsonb(12),
   'How many turns to carry. Enough to hold a real exchange; not so many that '
   'a long prompt buries the message actually being answered.')
on conflict (key) do nothing;

/**
 * The turns before this one, oldest first.
 *
 * Same person, same chat, same channel — `origin_ref` is `chat:message`, so the
 * chat is its first field. A correction typed into Emma's chat must not surface
 * as context in Tom's: they are different conversations with different people,
 * which is the whole point of a bot each.
 *
 * Includes what WE said, not only what Grant said. A reply is a turn — half of
 * the exchange above is the team's answers, and reading only his side would
 * present six questions with no record of the six answers he was reacting to.
 */
create or replace function app.conversation_before(p_command_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
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
             where o.job_id = c.job_id order by o.created_at desc limit 1) as answered
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
    jsonb_agg(jsonb_build_object('said', said, 'answered', answered)
              order by received_at asc),
    '[]'::jsonb)
    from turns
   where coalesce(trim(said), '') <> ''
$$;

comment on function app.conversation_before is
  'The recent turns of one chat with one person, oldest first, with what we '
  'answered. Read by the instruction handler so a correction is understood as '
  'a correction rather than answered as a standalone sentence.';

commit;
