-- 0041 — where to page
--
-- The Telegram bot has had an inbound webhook since Phase 3 and no outbound
-- path at all, so nothing has ever needed to know a chat id. Now something
-- does, and there is nowhere to look it up: a chat id is not a credential, not
-- configuration, and not derivable — it exists only once a human has spoken to
-- the bot.
--
-- That is the interesting property, and it decides the design: **the bot cannot
-- initiate.** Telegram will not let a bot message someone who has never
-- messaged it, so this table cannot be seeded, guessed, or configured. It is
-- populated by the webhook when Grant sends anything, and until he does, the
-- correct behaviour of the pager is to page nobody and say so.
--
-- Deliberately NOT stored as a preference or an environment variable, both of
-- which were considered:
--
--   - a preference is something Grant sets; this is something Telegram tells
--     us, and the two get out of step the moment he opens the bot on a second
--     device;
--   - an environment variable would be a copy of a fact the webhook already
--     receives, and would be wrong silently.

begin;

create table public.telegram_chats (
  chat_id       text        primary key,

  -- 'private' is Grant's own DM with the bot, which is the pager. A group or
  -- channel is a different thing and is recorded rather than assumed away: a
  -- bot added to a group will start receiving updates from it, and the pager
  -- must not start paging a group by accident.
  chat_type     text        not null,

  -- Who this chat belongs to, matching `notification_preferences.subject`.
  -- Null for a chat we have seen but cannot attribute — which is a real state
  -- and not one to fill in with a guess, because guessing wrong pages the
  -- wrong person.
  subject       text,

  -- Which bot the chat is with. One today; §9 reserves the possibility of one
  -- per staff member, and a chat id is only meaningful against the bot that
  -- holds it.
  bot_id        text        not null,

  title         text,
  username      text,

  -- Set when Telegram tells us delivery is impossible: the user blocked the
  -- bot, or it was kicked. Kept rather than deleted, because "he blocked us on
  -- Tuesday" is the answer to "why did the pager stop".
  deliverable   boolean     not null default true,
  undeliverable_reason text,
  undeliverable_at     timestamptz,

  first_seen_at timestamptz not null default app.now_utc(),
  last_seen_at  timestamptz not null default app.now_utc(),

  constraint telegram_chats_type_known
    check (chat_type in ('private', 'group', 'supergroup', 'channel')),
  constraint telegram_chats_id_shaped check (chat_id ~ '^-?[0-9]+$'),
  constraint telegram_chats_undeliverable_iff_reason
    check ((deliverable = false) = (undeliverable_reason is not null)),
  constraint telegram_chats_undeliverable_iff_at
    check ((deliverable = false) = (undeliverable_at is not null))
);

-- The pager's own lookup: the private chat for this subject, on this bot.
create index telegram_chats_pager
  on public.telegram_chats (subject, bot_id)
  where chat_type = 'private' and deliverable;

comment on table public.telegram_chats is
  'Chats the bot can reach. Cannot be seeded or configured: Telegram forbids a '
  'bot messaging anyone who has not messaged it first, so a row here is '
  'evidence that a human spoke to the bot.';

/**
 * Record a chat we have just heard from.
 *
 * Called by the webhook on every update, which is the only moment the
 * information exists. Upsert rather than insert-if-absent so `last_seen_at`
 * stays current and a previously undeliverable chat is restored the moment its
 * owner speaks again — being unblocked produces no event of its own, and the
 * only signal is a message arriving.
 */
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
  select true into v_existed from public.telegram_chats where chat_id = p_chat_id;

  insert into public.telegram_chats
    (chat_id, chat_type, bot_id, subject, title, username)
  values
    (p_chat_id, p_chat_type, p_bot_id, p_subject, p_title, p_username)
  on conflict (chat_id) do update
    set last_seen_at = app.now_utc(),
        chat_type = excluded.chat_type,
        title = coalesce(excluded.title, public.telegram_chats.title),
        username = coalesce(excluded.username, public.telegram_chats.username),
        -- Only ever filled in, never cleared by a later update that happens
        -- not to carry it.
        subject = coalesce(excluded.subject, public.telegram_chats.subject),
        deliverable = true,
        undeliverable_reason = null,
        undeliverable_at = null;

  return case when coalesce(v_existed, false) then 'updated' else 'registered' end;
end;
$$;

/** Record that Telegram says we can no longer reach this chat. */
create or replace function app.mark_telegram_undeliverable(
  p_chat_id text,
  p_reason text
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
   where chat_id = p_chat_id and deliverable;
  return found;
end;
$$;

/**
 * The chat to page for a subject, or null.
 *
 * Null is a normal answer and the whole reason this returns rather than raises:
 * until Grant has messaged the bot there is nowhere to page, and that is a
 * fact to report, not an error to handle.
 *
 * Private chats only. A bot added to a group receives updates from it, and a
 * pager that started paging a group because somebody added the bot to one would
 * be a surprise of the worst kind.
 */
create or replace function app.telegram_chat_for(p_subject text, p_bot_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select chat_id
  from public.telegram_chats
  where chat_type = 'private'
    and deliverable
    and bot_id = p_bot_id
    and (subject = p_subject or subject is null)
  -- An attributed chat beats an unattributed one; the newest beats the oldest.
  order by (subject is not null) desc, last_seen_at desc
  limit 1;
$$;

alter table public.telegram_chats enable row level security;
alter table public.telegram_chats force  row level security;

grant select on public.telegram_chats to ai_team_app;
grant execute on function app.record_telegram_chat(text, text, text, text, text, text) to ai_team_app;
grant execute on function app.mark_telegram_undeliverable(text, text) to ai_team_app;
grant execute on function app.telegram_chat_for(text, text) to ai_team_app;

-- The webhook runs as service_role and is the only writer that matters.
grant execute on function app.record_telegram_chat(text, text, text, text, text, text) to service_role;

create policy telegram_chats_app_read on public.telegram_chats
  for select to ai_team_app using (true);

commit;
