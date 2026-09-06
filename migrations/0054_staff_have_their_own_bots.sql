-- 0054 — the staff get their own Telegram bots
--
-- Until now there was one bot, and `telegram_chats.bot_id` was a column with
-- exactly one value in it — an abstraction that had never been exercised, which
-- is another way of saying an assumption. Grant created five of the seven staff
-- bots on 2026-09-06; this is the registry that turns them from five tokens
-- into five addressable senders.
--
-- ## Why a table rather than a convention
--
-- The tokens live in the vault under `telegram.<slug>.bot_token`, and the
-- tempting shortcut is to derive everything from the slug: no table, no
-- migration, one string template. It fails on the first question anyone
-- actually asks — *is this bot working, and if not, why* — because a
-- convention has nowhere to record an answer. §17 requires each integration to
-- be disableable with a reason, and a naming convention cannot be turned off.
--
-- ## What it deliberately does not do
--
-- It does not make a staff bot the pager. §12 gives Telegram one interrupting
-- voice, and seven bots that can all interrupt is seven ways to be woken up.
-- The Chief of Staff bot stays the pager; a staff bot speaks when its own
-- member has something to say, in the chat that person opened with it.
--
-- Two of seven are missing (quality, comms). Recorded as absent rather than
-- assumed absent: `expected` marks a bot the roster names, so "not created
-- yet" and "not part of the design" stay different states.

begin;

create table public.telegram_bots (
  -- The staff member this bot speaks as, or null for the Chief of Staff bot,
  -- which speaks as the system rather than as a person.
  staff_slug      text        references public.staff (slug),
  bot_id          text        primary key,
  username        text        not null,
  token_ref       app.vault_secret_ref,
  -- The roster names it; whether it exists yet is `token_ref is not null`.
  expected        boolean     not null default true,
  is_pager        boolean     not null default false,
  enabled         boolean     not null default true,
  disabled_reason text,
  created_at      timestamptz not null default app.now_utc(),
  updated_at      timestamptz not null default app.now_utc(),

  constraint telegram_bots_disabled_has_reason
    check (enabled or disabled_reason is not null),
  constraint telegram_bots_username_format
    check (username ~ '^[A-Za-z0-9_]{5,32}$'),
  -- A bot with no token cannot send. Saying it is enabled would be a claim the
  -- system cannot honour, and the pager especially must never be a promise.
  constraint telegram_bots_enabled_needs_a_token
    check (token_ref is not null or not enabled)
);

-- One pager, enforced rather than documented. §12 gives Telegram a single
-- interrupting voice; seven bots that can all interrupt is seven ways to be
-- woken up, and the second one would be added by someone who had not read §12.
create unique index telegram_bots_one_pager
  on public.telegram_bots ((true)) where is_pager;

-- A staff member speaks with one voice.
create unique index telegram_bots_one_per_staff
  on public.telegram_bots (staff_slug) where staff_slug is not null;

create trigger telegram_bots_touch_updated_at
  before update on public.telegram_bots
  for each row execute function app.touch_updated_at();

comment on table public.telegram_bots is
  'Which bot speaks for whom. A table rather than a naming convention because '
  '§17 requires an integration to be disableable WITH A REASON, and a '
  'convention has nowhere to write one down.';
comment on column public.telegram_bots.expected is
  'The roster names this bot. Distinguishes "not created yet" from "not part '
  'of the design", which a missing row cannot.';

-- The five that exist, plus the two the roster names and Grant has not made.
-- The pager is the Chief of Staff bot, already in service.
insert into public.telegram_bots (staff_slug, bot_id, username, token_ref, is_pager)
values
  (null, '8967954396', 'atg_chief_bot',
   (select id from vault.secrets where name = 'telegram.chief.bot_token'), true)
on conflict (bot_id) do nothing;

insert into public.telegram_bots (staff_slug, bot_id, username, token_ref)
values
  ('research-director',    '8842154625', 'atg_research_bot',
   (select id from vault.secrets where name = 'telegram.research-director.bot_token')),
  ('strategy-director',    '8883385300', 'atg_strategy_bot',
   (select id from vault.secrets where name = 'telegram.strategy-director.bot_token')),
  ('growth-director',      '8965090661', 'atg_growth_bot',
   (select id from vault.secrets where name = 'telegram.growth-director.bot_token')),
  ('finance-director',     '8800409793', 'atg_finance_bot',
   (select id from vault.secrets where name = 'telegram.finance-director.bot_token')),
  ('operations-director',  '8301012441', 'atg_operations_bot',
   (select id from vault.secrets where name = 'telegram.operations-director.bot_token'));

-- The two Grant has not made. No token, so `enabled = false` is forced by the
-- constraint rather than remembered.
insert into public.telegram_bots
  (staff_slug, bot_id, username, token_ref, enabled, disabled_reason)
values
  ('quality-director', 'pending:quality-director', 'atg_quality_bot', null, false,
   'not created yet — the roster names it; BotFather is the only way to make one'),
  ('communications-director', 'pending:communications-director', 'atg_comms_bot', null, false,
   'not created yet — the roster names it; BotFather is the only way to make one');

-- The bot for a staff member, or null. Used by the sending path, so it is a
-- function rather than a join every caller has to remember to write.
create or replace function app.telegram_bot_for(p_staff_slug text)
returns table (bot_id text, username text, token text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select b.bot_id, b.username, app.resolve_secret(b.token_ref)
    from public.telegram_bots b
   where b.staff_slug = p_staff_slug
     and b.enabled
     and b.token_ref is not null
$$;

comment on function app.telegram_bot_for is
  'The voice a staff member speaks with, or no row when they have none. No row '
  'is a normal answer - two of seven bots do not exist - and the caller falls '
  'back to the pager rather than failing.';

revoke all on function app.telegram_bot_for(text) from public;
grant execute on function app.telegram_bot_for(text) to ai_team_app;

grant select on public.telegram_bots to ai_team_app;
grant update (enabled, disabled_reason, token_ref) on public.telegram_bots to ai_team_app;
alter table public.telegram_bots enable row level security;
alter table public.telegram_bots force  row level security;
create policy telegram_bots_app_read on public.telegram_bots
  for select to ai_team_app using (true);
create policy telegram_bots_app_update on public.telegram_bots
  for update to ai_team_app using (true) with check (true);

commit;
