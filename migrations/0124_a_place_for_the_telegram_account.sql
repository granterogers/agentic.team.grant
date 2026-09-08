-- 0124 — Bots that can be made without BotFather
--
-- Grant: *"Is it really the only way to do this is manually by a BotFather? Is
-- there no other way to automate this? Because I'd like to be able to
-- dynamically add and remove staff."* Then: *"Yes, I want you to build it
-- properly."*
--
-- The answer written into this very database was wrong. Two rows in
-- `telegram_bots` carry the `disabled_reason`:
--
--   "not created yet — the roster names it; BotFather is the only way to make one"
--
-- It is not. Since layer 224 the MTProto API has `bots.createBot`, which makes
-- a "managed bot" owned by the calling user and controlled by a named manager
-- bot, with no BotFather conversation at all. `bots.checkUsername` reserves the
-- name first, `bots.exportBotToken` returns the Bot API token afterwards, so
-- create → token → webhook is one unattended sequence.
--
--   https://core.telegram.org/method/bots.createBot
--   https://core.telegram.org/api/bots/managed-bots
--
-- Telegram's ceiling is 20 owned bots normally and 40 with Premium
-- (`bots_create_limit_default` / `bots_create_limit_premium`). Eight exist.
--
-- ## What this migration does NOT do
--
-- It does not create a second bots table. One already exists, holds all eight
-- rows, and is read by the roster, the pager and the webhook. A parallel table
-- would have been a second answer to "which bot is Emma's" — the first version
-- of this migration did exactly that and Postgres refused it, correctly,
-- because the name was taken.
--
-- ## The credential to be clear-eyed about
--
-- `bots.createBot` can only be called by a USER, never by a bot. That means a
-- Telegram user session for Grant's own account: not "a token for one bot" but
-- his entire Telegram account. It goes in the vault (§15), is never printed,
-- and `telegram_capacity()` reports only whether one exists.
--
-- That is the price of automating BotFather, and it is recorded here rather
-- than buried, because the alternative — creating spare bots by hand once and
-- assigning them from the front end — needs no such credential and remains
-- entirely available.

begin;

-- How the bot came to exist. The two routes behave differently: a bot made in
-- BotFather cannot be renamed or revoked through `bots.*` the way a managed one
-- can, so "why can I not rename this one" needs an answer that is a fact.
alter table public.telegram_bots
  add column if not exists origin text not null default 'botfather'
    check (origin in ('created', 'botfather'));

comment on column public.telegram_bots.origin is
  'created = made by bots.createBot and manageable through the API; '
  'botfather = made by hand, and only manageable by hand.';

-- A bot with no staff_slug and no pager flag is spare: made and waiting for
-- whoever is hired next. The pager already has a null slug, hence the flag in
-- the predicate rather than a slug test alone.
comment on column public.telegram_bots.staff_slug is
  'Who this bot speaks as. Null with is_pager false means SPARE — created and '
  'unassigned, which is what makes hiring someone instant rather than a trip '
  'to BotFather.';

insert into public.system_config (key, value, description)
values ('telegram.bot_limit', to_jsonb(20),
        'Bots one Telegram account may own: 20 normally, 40 with Premium. '
        'Telegram''s figure, not ours — bots_create_limit_default. Recorded so '
        'the system refuses a creation it cannot make, rather than discovering '
        'the ceiling as a confusing error on the twenty-first.')
on conflict (key) do nothing;

/**
 * Whether bots can be created at all, and how much room is left.
 */
create or replace function app.telegram_capacity()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'has_api_credentials', exists (
      select 1 from vault.decrypted_secrets where name = 'telegram.api_hash'),
    'has_user_session', exists (
      select 1 from vault.decrypted_secrets where name = 'telegram.user_session'),
    'owned', (select count(*)::int from public.telegram_bots where enabled),
    'spare', (select count(*)::int from public.telegram_bots
               where enabled and staff_slug is null and not is_pager),
    'limit', coalesce(
      (select (value #>> '{}')::int from public.system_config
        where key = 'telegram.bot_limit'), 20),
    'unfilled_roles', coalesce((
      select jsonb_agg(jsonb_build_object('staff_slug', b.staff_slug, 'username', b.username)
             order by b.staff_slug)
        from public.telegram_bots b
       where b.disabled_reason is not null), '[]'::jsonb)
  )
$$;

grant execute on function app.telegram_capacity() to ai_team_app, service_role;

/**
 * Record a bot that now exists, and clear the reason it did not.
 *
 * Called AFTER `bots.createBot` succeeds. That order is deliberate: a crash
 * between the two leaves a bot Telegram knows about and we do not, which a
 * reconcile can repair. The reverse leaves a row pointing at nothing, and the
 * system would try to send through it.
 */
create or replace function app.telegram_bot_created(
  p_bot_id     text,
  p_username   text,
  p_token_ref  uuid,
  p_staff_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v jsonb;
begin
  insert into public.telegram_bots
    (bot_id, username, token_ref, staff_slug, expected, is_pager, enabled,
     disabled_reason, origin)
  values (p_bot_id, p_username, p_token_ref, p_staff_slug, true, false, true, null, 'created')
  on conflict (bot_id) do update
    set username        = excluded.username,
        token_ref       = excluded.token_ref,
        staff_slug      = coalesce(excluded.staff_slug, public.telegram_bots.staff_slug),
        enabled         = true,
        -- The whole point: the row said BotFather was the only way, and it
        -- was not. Clearing it is the record of that being settled.
        disabled_reason = null,
        origin          = 'created',
        updated_at      = app.now_utc()
  returning jsonb_build_object('bot_id', bot_id, 'username', username,
                               'staff_slug', staff_slug) into v;
  return v;
end;
$$;

revoke all on function app.telegram_bot_created(text, text, uuid, text) from public;
grant execute on function app.telegram_bot_created(text, text, uuid, text) to service_role;

create or replace function public.telegram_capacity()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.telegram_capacity() $$;

revoke all on function public.telegram_capacity() from public;
grant execute on function public.telegram_capacity() to service_role;

commit;
