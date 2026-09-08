-- One room for the team, and one voice that reaches Grant directly.
--
-- Grant: *"create an agentic group chat.. only the chief of staff should
-- message me directly"*.
--
-- ## What a Telegram group can and cannot be
--
-- It cannot be a room where the bots talk to each other. Telegram never
-- delivers a bot's message to another bot — that is a platform rule, not a
-- setting — so eight bots in a group can all speak and none can hear. Any
-- design that has them conversing in Telegram is a design that does not work.
--
-- What it CAN be is the room Grant watches. The conversation between staff
-- already happens here, in the router and the job graph; the group is where it
-- becomes visible, one message per finished piece of work, from the person who
-- did it. Grant reads the room and answers in it. That is the useful half.
--
-- ## Why this is a routing rule and not a code change
--
-- `app.telegram_chat_for(subject, bot_id)` is the single place anything asks
-- "where does this bot send". The pager calls it, the reply path calls it,
-- and nothing else decides. Changing the answer here changes every caller at
-- once, and leaves no second copy of the rule to drift.
--
-- ## Why it falls back to the private chat
--
-- Until Grant creates the group there is no room to route to, and a rule that
-- sends to a room that does not exist is a rule that drops messages. So: the
-- group when there is one, the private chat when there is not. The behaviour
-- he asked for arrives the moment the room does, with nothing to deploy.

begin;

-- ---------------------------------------------------------------------------
-- Who may knock on the door
-- ---------------------------------------------------------------------------

insert into public.system_config (key, value, description)
values
  ('telegram.direct_to_grant', to_jsonb('chief-of-staff'::text),
   'The one staff slug whose bot may write to Grant''s private chat. Everyone '
   'else goes to the office group when one exists. The pager bot (staff_slug '
   'null) is always direct — it is the Chief of Staff''s own bot and the '
   'interrupting voice §12 gives Telegram. Set to an empty string to let '
   'everybody message him directly again.')
on conflict (key) do update set value = excluded.value,
                                description = excluded.description;

-- ---------------------------------------------------------------------------
-- The office group, if there is one
-- ---------------------------------------------------------------------------

create or replace function app.telegram_office_chat(p_bot_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- A group this particular bot is in. The chat id is shared across bots but
  -- the row is not: `telegram_chats` is keyed on (bot_id, chat_id) precisely
  -- because a bot that has not been added to the room cannot post to it (0097).
  select chat_id
  from public.telegram_chats
  where bot_id = p_bot_id
    and chat_type in ('group', 'supergroup')
    and deliverable
  order by last_seen_at desc
  limit 1;
$$;

comment on function app.telegram_office_chat(text) is
  'The office group this bot can post to, or null. Null is the ordinary state '
  'until Grant creates the group and adds the bots.';

-- ---------------------------------------------------------------------------
-- Where a bot sends
-- ---------------------------------------------------------------------------

create or replace function app.telegram_chat_for(p_subject text, p_bot_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with who as (
    select b.staff_slug
      from public.telegram_bots b
     where b.bot_id = p_bot_id
  ),
  direct as (
    select coalesce(c.value #>> '{}', '') as slug
      from public.system_config c
     where c.key = 'telegram.direct_to_grant'
  ),
  private_chat as (
    -- Unchanged from 0041. An attributed chat beats an unattributed one; the
    -- newest beats the oldest.
    select chat_id
      from public.telegram_chats
     where chat_type = 'private'
       and deliverable
       and bot_id = p_bot_id
       and (subject = p_subject or subject is null)
     order by (subject is not null) desc, last_seen_at desc
     limit 1
  )
  select coalesce(
    case
      -- No rule set, or this bot is the one allowed through: private chat.
      -- staff_slug null is the pager bot, which is the Chief of Staff's.
      when (select slug from direct) = ''
        or (select staff_slug from who) is null
        or (select staff_slug from who) = (select slug from direct)
      then (select chat_id from private_chat)
      -- Everyone else: the office group, and the private chat only while
      -- there is no office group to send to.
      else coalesce(app.telegram_office_chat(p_bot_id), (select chat_id from private_chat))
    end,
    null
  );
$$;

comment on function app.telegram_chat_for(text, text) is
  'Where this bot sends. The Chief of Staff reaches Grant directly; the rest '
  'go to the office group once one exists, and to the private chat until then.';

grant execute on function app.telegram_chat_for(text, text) to ai_team_app;
grant execute on function app.telegram_office_chat(text) to ai_team_app;

-- ---------------------------------------------------------------------------
-- What the setup page shows
-- ---------------------------------------------------------------------------

create or replace function app.hq_office_chat()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with room as (
    select c.chat_id, max(c.title) as title, count(*)::int as bots_present
      from public.telegram_chats c
      join public.telegram_bots b on b.bot_id = c.bot_id and b.enabled
     where c.chat_type in ('group', 'supergroup')
     group by c.chat_id
     order by count(*) desc
     limit 1
  ),
  expected as (select count(*)::int as n from public.telegram_bots where enabled)
  select jsonb_build_object(
    'exists', (select count(*) from room) > 0,
    'chat_id', (select chat_id from room),
    'title', (select title from room),
    'bots_present', coalesce((select bots_present from room), 0),
    'bots_expected', (select n from expected),
    'missing', coalesce(
      (select jsonb_agg(b.username order by b.username)
         from public.telegram_bots b
        where b.enabled
          and not exists (
            select 1 from public.telegram_chats c
             where c.bot_id = b.bot_id
               and c.chat_id = (select chat_id from room))),
      '[]'::jsonb),
    'direct_to_grant', coalesce(
      (select value #>> '{}' from public.system_config where key = 'telegram.direct_to_grant'), '')
  );
$$;

grant execute on function app.hq_office_chat() to ai_team_app;

create or replace function public.hq_office_chat()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select app.hq_office_chat() $$;

commit;
