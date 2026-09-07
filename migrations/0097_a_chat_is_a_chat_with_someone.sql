-- 0097 — A chat id is only a chat id next to the bot that holds it
--
-- Grant: *"I've done the bot start."* He had. A `/start` from him reached
-- @atg_research_bot at 12:53 and was filed correctly. And afterwards
-- `telegram_chats` still held exactly one row — the pager's — so
-- `npm run team:hello` went on reporting "you have not opened it" for all seven
-- directors, and none of them could message him.
--
-- ## Why one row
--
-- 0041 made `chat_id` the primary key, on the reading that a chat id identifies
-- a chat. In a private chat Telegram uses the USER's id as the chat id, and it
-- is the same number in every private chat that user has — with every bot. So
-- Grant's conversation with Ines and his conversation with the pager are both
-- chat 1386648496, and the upsert's `on conflict (chat_id)` treated the second
-- as a restatement of the first: it refreshed `last_seen_at` and left `bot_id`
-- pointing at whichever bot he happened to open first.
--
-- Seven Start presses, seven successful registrations, one row. Nothing failed
-- and nothing was logged, which is why it survived: the webhook reported
-- `registration: ok` every time, truthfully.
--
-- ## The key is the pair
--
-- A private chat is identified by the user AND the bot. That is what the table
-- now says. It is also what `telegram_chat_for` has always assumed — it filters
-- on `bot_id`, which is exactly the query that returns nothing when the row for
-- that bot was overwritten by another.
--
-- `mark_telegram_undeliverable` changes with it. Being blocked by Grant on one
-- bot says nothing about the other seven, and under the old key it would have
-- marked the wrong row anyway.

begin;

alter table public.telegram_chats drop constraint telegram_chats_pkey;
alter table public.telegram_chats add primary key (bot_id, chat_id);

comment on column public.telegram_chats.chat_id is
  'Telegram chat id. NOT unique on its own: in a private chat this is the '
  'user id, which is identical across every bot that user has opened. The key '
  'is (bot_id, chat_id).';

create or replace function app.record_telegram_chat(
  p_chat_id text,
  p_chat_type text,
  p_bot_id text,
  p_subject text default null,
  p_title text default null,
  p_username text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existed boolean;
begin
  select true into v_existed from public.telegram_chats
   where chat_id = p_chat_id and bot_id = p_bot_id;

  insert into public.telegram_chats
    (chat_id, chat_type, bot_id, subject, title, username)
  values
    (p_chat_id, p_chat_type, p_bot_id, p_subject, p_title, p_username)
  on conflict (bot_id, chat_id) do update
    set last_seen_at = app.now_utc(),
        chat_type = excluded.chat_type,
        title = coalesce(excluded.title, public.telegram_chats.title),
        username = coalesce(excluded.username, public.telegram_chats.username),
        subject = coalesce(excluded.subject, public.telegram_chats.subject),
        deliverable = true,
        undeliverable_reason = null,
        undeliverable_at = null;

  return case when coalesce(v_existed, false) then 'updated' else 'registered' end;
end;
$$;

-- The 2-argument version is dropped rather than left beside a 3-argument one.
-- `create or replace` with an added defaulted parameter makes a second
-- overload, not a replacement (0090), and the second overload here would be
-- the one that marks every bot's chat at once.
drop function if exists app.mark_telegram_undeliverable(text, text);

/**
 * Telegram says we can no longer reach this chat, on this bot.
 *
 * Scoped to the bot: Grant blocking one director says nothing about the other
 * seven, and silencing all of them because one was blocked is the kind of
 * failure nobody reports because it looks like quiet.
 */
create or replace function app.mark_telegram_undeliverable(
  p_chat_id text,
  p_reason text,
  p_bot_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.telegram_chats
     set deliverable = false,
         undeliverable_reason = p_reason,
         undeliverable_at = app.now_utc()
   where chat_id = p_chat_id
     and deliverable
     and (p_bot_id is null or bot_id = p_bot_id);
  return found;
end;
$$;

grant execute on function app.mark_telegram_undeliverable(text, text, text) to ai_team_app;
grant execute on function app.mark_telegram_undeliverable(text, text, text) to service_role;

commit;
