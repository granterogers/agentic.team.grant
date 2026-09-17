-- Conversational memory: a day-wide window, and retrieval for everything older.
--
-- Issue #238. The office threaded turns by (channel, chat, subject) and bounded
-- them by TWO values:
--
--   conversation.max_turns       12
--   conversation.window_minutes  30
--
-- so a session longer than twelve turns could not see its own beginning, and
-- one spanning more than half an hour lost everything older REGARDLESS of turn
-- count. Grant talks to this office across a day. Ask at 09:00, refer back at
-- 09:45, and the reference resolved against nothing.
--
-- ## The two limits are not the same kind of limit
--
-- This is the whole of the fix and it took measuring to see. `max_turns` is the
-- TOKEN cost: twelve turns go into the prompt and each one is paid for.
-- `window_minutes` is not a cost at all -- it only decides WHICH twelve.
--
-- So the thirty minutes was pure loss. Widening it to a day changes nothing
-- about what the prompt costs or how long a turn takes, and makes a morning
-- decision reachable in the afternoon. The turn count stays at twelve, because
-- that is the half that is actually expensive.
--
-- Raising both to enormous values is what #238 explicitly rules out, and it
-- would be the wrong shape anyway: the answer to "more than twelve turns ago"
-- is retrieval, not a bigger prompt.
--
-- ## Retrieval, reusing what exists
--
-- `app.recall_conversation` searches the SAME chat's older turns -- the ones
-- outside the working window -- and returns the few that match. The rows were
-- always durable; `inbound_commands` and `outputs` keep every word. What was
-- missing was any way to reach them, which made this a retrieval gap rather
-- than a memory system that needed building.
--
-- Deliberately NOT a new store. `project_briefs` and `project_references` both
-- exist and both hold zero rows; adding a third empty summary layer is how a
-- repository ends up with two memories that disagree (0310's argument, and
-- 0303/0304's about which copy rots).
--
-- ## Scoped to one conversation, like everything else here
--
-- Same predicate as `app.conversation_before`: channel, chat, subject. A thread
-- that leaks is worse than no thread -- work filed against the wrong project
-- because a sentence resolved against somebody else's conversation is a mistake
-- nobody can see afterwards, which is why `verify:history` asserts isolation
-- adversarially.

update public.system_config
   set value = to_jsonb(1440)
 where key = 'conversation.window_minutes';

comment on table public.system_config is
  'Office settings. conversation.max_turns is the token cost of a turn; '
  'conversation.window_minutes only decides WHICH turns and costs nothing (0371).';

create or replace function app.recall_conversation(
  p_command_id uuid,
  p_query      text,
  p_limit      integer default 3
) returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  with self as (
    select origin_channel, split_part(origin_ref, ':', 1) as chat,
           coalesce(subject, actor) as who, received_at
      from public.inbound_commands where command_id = p_command_id
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
     where c.origin_channel = self.origin_channel
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
$fn$;

comment on function app.recall_conversation(uuid, text, integer) is
  'Older turns of THIS chat that match a query - what the working window cannot '
  'reach. Scoped to (channel, chat, subject) like app.conversation_before (#238).';

create or replace function public.recall_conversation(
  p_command_id uuid,
  p_query      text,
  p_limit      integer default 3
) returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$ select app.recall_conversation(p_command_id, p_query, p_limit) $fn$;

grant execute on function public.recall_conversation(uuid, text, integer) to service_role;

/*
  How far back this chat actually goes.

  The honest-boundary half of #238. The office said nothing when it truncated,
  so a reference outside the window got an answer built on a gap with no signal
  that a gap existed. This is what the prompt states plainly.
*/
create or replace function app.conversation_extent(p_command_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  with self as (
    select origin_channel, split_part(origin_ref, ':', 1) as chat,
           coalesce(subject, actor) as who, received_at
      from public.inbound_commands where command_id = p_command_id
  ),
  mine as (
    select c.received_at
      from public.inbound_commands c, self
     where c.origin_channel = self.origin_channel
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
$fn$;

create or replace function public.conversation_extent(p_command_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$ select app.conversation_extent(p_command_id) $fn$;

grant execute on function public.conversation_extent(uuid) to service_role;
