-- A person connects their own Telegram, from Team HQ, without an operator (#410).
--
-- The deployment has one Telegram bot (the chief of staff). Who a Telegram user IS lives in public.subject_identities
-- (origin_channel, actor) -> office, and the webhook already refuses every sender that table does not name. So a second
-- person had no way in: the only writer of that table was an operator command.
--
-- The smallest safe way to let a person write their own row is a challenge they can only get by being signed in:
--
--   1. Team HQ (a verified session, so the OFFICE comes from the session and from nothing the caller sends) asks
--      app.link_begin. It stores the SHA-256 of a random token and returns the token once. One live challenge per
--      office and channel, ten minutes, at most five a hour.
--   2. The person opens https://t.me/<bot>?start=link_<token>, a button, not a code to type, and taps Start.
--   3. The webhook receives "/start link_<token>" from that Telegram user in a PRIVATE chat and calls
--      app.link_redeem. The office comes from the token's row; the actor comes from the verified sender. Single use:
--      the row is locked, checked and marked used in one step.
--
-- What it refuses, all with the same word so a probe learns nothing: an unknown, used, expired or revoked token; a
-- conversation that is not the sender's own private chat (a group cannot redeem). What it refuses by name: a Telegram
-- user already bound to ANOTHER office (a person is one office, and a token for office A cannot take a person out of
-- office B), the operator's office (its channels are the operator's to set), and an office that already has a Telegram.
--
-- Disconnecting removes the identity and makes that person's chats undeliverable at once, so nothing more is sent.
--
-- Telegram only. Slack is a workspace INSTALL (an OAuth consent by a Slack admin into the deployment's one Slack app),
-- which is a different mechanism and is not attempted here.

begin;

create table public.channel_link_challenges (
  challenge_id  uuid primary key default gen_random_uuid(),
  office_id     uuid not null references public.offices (office_id),
  channel       text not null check (channel in ('telegram')),
  token_sha256  text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default app.now_utc(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by_actor text,
  revoked_at    timestamptz,
  constraint channel_link_used_has_an_actor check ((used_at is null) = (used_by_actor is null)),
  constraint channel_link_expires_after_creation check (expires_at > created_at)
);

create index channel_link_challenges_office_idx
  on public.channel_link_challenges (office_id, channel, created_at desc);

comment on table public.channel_link_challenges is
  'A person''s request to connect their own messaging identity (#410). Holds the SHA-256 of a one-time token, never the '
  'token. Rows are kept (used, revoked or expired) as the record of what was asked; they are not a secret once spent.';

create trigger a1_office_write_once
  before update of office_id on public.channel_link_challenges
  for each row execute function app.office_id_is_write_once();

alter table public.channel_link_challenges enable row level security;
revoke all on table public.channel_link_challenges from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
create function app.link_begin(p_office uuid, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_token text;
  v_expires timestamptz;
begin
  perform app.require_office(p_office);
  if p_channel is distinct from 'telegram' then
    return jsonb_build_object('ok', false, 'error', 'unsupported', 'message', 'Only Telegram can be connected from here.');
  end if;
  if p_office = app.operator_office() then
    return jsonb_build_object('ok', false, 'error', 'operator', 'message', 'This office''s channels are set up by the person who runs the deployment.');
  end if;
  if exists (select 1 from public.subject_identities i
              where i.office_id = p_office and i.origin_channel = p_channel and i.kind = 'person') then
    return jsonb_build_object('ok', false, 'error', 'already_linked', 'message', 'Telegram is already connected. Disconnect it first to connect a different account.');
  end if;
  if (select count(*) from public.channel_link_challenges c
       where c.office_id = p_office and c.channel = p_channel and c.created_at > app.now_utc() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many', 'message', 'Too many attempts in the last hour. Try again later.');
  end if;

  -- One live challenge per office and channel: asking again replaces the earlier one.
  update public.channel_link_challenges c
     set revoked_at = app.now_utc()
   where c.office_id = p_office and c.channel = p_channel
     and c.used_at is null and c.revoked_at is null and c.expires_at > app.now_utc();

  v_token := encode(extensions.gen_random_bytes(18), 'hex');
  v_expires := app.now_utc() + interval '10 minutes';
  insert into public.channel_link_challenges (office_id, channel, token_sha256, expires_at)
  values (p_office, p_channel, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), v_expires);

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'expires_at', v_expires,
    'bot', (select b.username from public.telegram_bots b where b.is_pager and b.enabled limit 1));
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
create function app.link_redeem(p_channel text, p_token text, p_actor text, p_conversation text, p_bot_id text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_row public.channel_link_challenges;
  v_hash text;
  v_existing uuid;
  v_subject text;
begin
  -- Telegram: a private chat has the same id as the user. A group, or a mismatch, is not the person asking.
  if p_channel is distinct from 'telegram'
     or p_actor is null or p_actor !~ '^[0-9]{1,20}$'
     or p_conversation is distinct from p_actor
     or p_token is null or p_token !~ '^[0-9a-f]{36}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'utf8')), 'hex');

  select * into v_row from public.channel_link_challenges c where c.token_sha256 = v_hash for update;
  if not found or v_row.used_at is not null or v_row.revoked_at is not null or v_row.expires_at <= app.now_utc()
     or v_row.channel <> p_channel
     or not exists (select 1 from public.offices o where o.office_id = v_row.office_id and o.state = 'active') then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if v_row.office_id = app.operator_office() then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select i.office_id into v_existing from public.subject_identities i
   where i.origin_channel = p_channel and i.actor = p_actor;
  if v_existing is not null and v_existing <> v_row.office_id then
    -- A Telegram user is one person in one office. Nothing is changed and the token stays unspent.
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  if v_existing is null and exists (select 1 from public.subject_identities i
                                     where i.office_id = v_row.office_id and i.origin_channel = p_channel and i.kind = 'person') then
    return jsonb_build_object('ok', false, 'error', 'office_already_linked');
  end if;

  if v_existing is null then
    v_subject := app.office_actor(v_row.office_id);
    insert into public.subject_identities (office_id, subject, origin_channel, actor, note, kind)
    values (v_row.office_id, v_subject, p_channel, p_actor, 'connected by the person from Team HQ', 'person');
  end if;
  update public.channel_link_challenges c
     set used_at = app.now_utc(), used_by_actor = p_actor
   where c.challenge_id = v_row.challenge_id;

  return jsonb_build_object(
    'ok', true,
    -- The chief bot's token, for the one confirmation message back to the person who just asked (as voice_refusal does).
    'token', (select app.resolve_secret(t.token_ref) from public.telegram_bots t
               where t.bot_id = p_bot_id and t.enabled and t.is_pager and t.token_ref is not null));
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
create function app.link_status(p_office uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $f$
declare
  v_linked timestamptz;
  v_waiting timestamptz;
begin
  perform app.require_office(p_office);
  select min(i.created_at) into v_linked from public.subject_identities i
   where i.office_id = p_office and i.origin_channel = 'telegram' and i.kind = 'person';
  select max(c.expires_at) into v_waiting from public.channel_link_challenges c
   where c.office_id = p_office and c.channel = 'telegram'
     and c.used_at is null and c.revoked_at is null and c.expires_at > app.now_utc();
  return jsonb_build_object('telegram', jsonb_build_object(
    'state', case when v_linked is not null then 'connected' when v_waiting is not null then 'waiting' else 'none' end,
    'connected_at', v_linked,
    'waiting_until', case when v_linked is null then v_waiting end,
    'can_connect', p_office <> app.operator_office() and v_linked is null,
    'managed_by_operator', p_office = app.operator_office(),
    'bot', (select b.username from public.telegram_bots b where b.is_pager and b.enabled limit 1)));
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
create function app.link_disconnect(p_office uuid, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_removed integer;
  v_subject text;
begin
  perform app.require_office(p_office);
  if p_channel is distinct from 'telegram' then
    return jsonb_build_object('ok', false, 'error', 'unsupported');
  end if;
  if p_office = app.operator_office() then
    return jsonb_build_object('ok', false, 'error', 'operator', 'message', 'This office''s channels are managed by the person who runs the deployment.');
  end if;
  v_subject := app.office_actor(p_office);

  delete from public.subject_identities i
   where i.office_id = p_office and i.origin_channel = p_channel and i.kind = 'person';
  get diagnostics v_removed = row_count;

  -- Nothing more is paged to a chat of theirs: undeliverable is how the pager already knows not to.
  update public.telegram_chats t
     set deliverable = false, undeliverable_reason = 'disconnected by the person', undeliverable_at = app.now_utc()
   where t.office_id = p_office and t.subject = v_subject;
  update public.channel_link_challenges c
     set revoked_at = app.now_utc()
   where c.office_id = p_office and c.channel = p_channel and c.used_at is null and c.revoked_at is null;

  return jsonb_build_object('ok', true, 'removed', v_removed);
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The doors PostgREST can reach. The gateway passes the verified office; the webhook (service role) redeems.
create function public.channel_link_begin(p_office uuid, p_channel text) returns jsonb
language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.link_begin(p_office, p_channel) $f$;

create function public.channel_link_status(p_office uuid) returns jsonb
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.link_status(p_office) $f$;

create function public.channel_link_disconnect(p_office uuid, p_channel text) returns jsonb
language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.link_disconnect(p_office, p_channel) $f$;

create function public.channel_link_redeem(p_channel text, p_token text, p_actor text, p_conversation text, p_bot_id text default null) returns jsonb
language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.link_redeem(p_channel, p_token, p_actor, p_conversation, p_bot_id) $f$;

revoke all on function app.link_begin(uuid, text), app.link_redeem(text, text, text, text, text),
  app.link_status(uuid), app.link_disconnect(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.channel_link_begin(uuid, text), public.channel_link_status(uuid),
  public.channel_link_disconnect(uuid, text), public.channel_link_redeem(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.channel_link_begin(uuid, text), public.channel_link_status(uuid),
  public.channel_link_disconnect(uuid, text), public.channel_link_redeem(text, text, text, text, text) to service_role;

commit;
