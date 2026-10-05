-- 0683 - Telegram: a verified sender belongs to exactly one office, and nothing is stored or sent outside it
-- (multi-user P3, wave 7).
--
-- Before: the webhook learned WHO sent a message (subject_identities) and recorded a chat and a command, and the office
-- each belonged to was left to the compatibility bridge. Outbound, `telegram_chat_for` chose "the newest private chat that
-- is this subject's OR UNATTRIBUTED" - so a chat nobody had claimed was a place anybody's messages could be sent.
--
-- Now:
--   * `office_for_sender(channel, actor)` is the one answer, read from subject_identities (a verified list);
--   * `sender_admitted` returns the office with the subject, and a declared test conversation is the TEST office's;
--   * `record_telegram_chat` writes the chat's office explicitly. A private chat is its sender's. A group is accepted only
--     from an operator's office (the office group is Grant's; a reviewed group binding for anybody else is a later,
--     separate decision), and a chat already bound to one office is never moved to another;
--   * `telegram_chat_for(office, subject, bot)` looks inside the office only and no longer falls back to an unattributed chat.

create function app.office_for_sender(p_channel text, p_actor text)
returns uuid
language sql
stable
security definer
set search_path to ''
as $f$
  select i.office_id
    from public.subject_identities i
    join public.offices o on o.office_id = i.office_id and o.state = 'active'
   where i.origin_channel = p_channel and i.actor = p_actor
$f$;
revoke all on function app.office_for_sender(text, text) from public, anon, authenticated, service_role;

create or replace function public.sender_admitted(p_channel text, p_actor text, p_conversation text default null)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $f$
  select jsonb_build_object(
    'subject', app.subject_for(p_channel, p_actor),
    'declared_test',
      app.declared_test_origin(p_channel, coalesce(p_conversation, p_actor)) is not null,
    -- A declared test conversation is the test office's whoever the sender is; otherwise the sender's own office.
    'office_id', case
      when app.declared_test_origin(p_channel, coalesce(p_conversation, p_actor)) is not null then app.test_office()
      else app.office_for_sender(p_channel, p_actor)
    end)
$f$;

-- The operator's office: the one deployment-level notices (backups, vault exports, deploy checks) are sent to.
create function app.operator_office()
returns uuid
language sql
stable
security definer
set search_path to ''
as $f$
  select o from app.operator_offices() o order by o limit 1
$f$;
revoke all on function app.operator_office() from public, anon, authenticated, service_role;

create function app.telegram_office_chat(p_office uuid, p_bot_id text)
returns text
language sql
stable
security definer
set search_path to ''
as $f$
  select chat_id
    from public.telegram_chats
   where office_id = p_office
     and bot_id = p_bot_id
     and chat_type in ('group', 'supergroup')
     and deliverable
   order by last_seen_at desc
   limit 1
$f$;
revoke all on function app.telegram_office_chat(uuid, text) from public, anon, authenticated, service_role;

create function app.telegram_chat_for(p_office uuid, p_subject text, p_bot_id text)
returns text
language sql
stable
security definer
set search_path to ''
as $f$
  with who as (
    select b.staff_slug from public.telegram_bots b where b.bot_id = p_bot_id
  ),
  direct as (
    select coalesce(c.value #>> '{}', '') as slug from public.system_config c where c.key = 'telegram.direct_to_grant'
  ),
  private_chat as (
    -- Inside the office, and attributed to the subject. There is no "or unattributed": a chat nobody has claimed is not
    -- somewhere this office's messages may go.
    select chat_id
      from public.telegram_chats
     where office_id = p_office
       and chat_type = 'private'
       and deliverable
       and bot_id = p_bot_id
       and subject = p_subject
     order by last_seen_at desc
     limit 1
  )
  select coalesce(
    case
      when (select slug from direct) = ''
        or (select staff_slug from who) is null
        or (select staff_slug from who) = (select slug from direct)
      then (select chat_id from private_chat)
      else coalesce(app.telegram_office_chat(p_office, p_bot_id), (select chat_id from private_chat))
    end,
    null
  )
$f$;
revoke all on function app.telegram_chat_for(uuid, text, text) from public, anon, authenticated, service_role;

-- What deployment-level scripts ask: where does the operator get a notice?
create function app.operator_chat(p_bot_id text)
returns text
language sql
stable
security definer
set search_path to ''
as $f$
  select app.telegram_chat_for(app.operator_office(), app.office_actor(app.operator_office()), p_bot_id)
$f$;
revoke all on function app.operator_chat(text) from public, anon, authenticated, service_role;

-- record_telegram_chat: the chat's office is explicit; the sender is how a group is judged.
create function app.record_telegram_chat(
  p_chat_id text, p_chat_type text, p_bot_id text, p_subject text default null, p_title text default null,
  p_username text default null, p_sender text default null)
returns text
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_existed boolean;
  v_test boolean := app.declared_test_origin('telegram', p_chat_id) is not null;
  v_office uuid;
  v_bound uuid;
  v_subject text := case
    when p_chat_type = 'private' then app.subject_for('telegram', p_chat_id)
    else null
  end;
begin
  -- Whose chat this is. A declared test origin is the test office's. A private chat is its own sender's. A group is the
  -- office group only for an operator's office; anyone else's group is not recorded at all.
  if v_test then
    v_office := app.test_office();
  elsif p_chat_type = 'private' then
    v_office := app.office_for_sender('telegram', p_chat_id);
  else
    v_office := app.office_for_sender('telegram', coalesce(p_sender, ''));
    if v_office is not null and not exists (select 1 from app.operator_offices() x where x = v_office) then
      v_office := null;
    end if;
  end if;
  if v_office is null then
    return 'ignored';
  end if;

  select office_id, true into v_bound, v_existed from public.telegram_chats
   where chat_id = p_chat_id and bot_id = p_bot_id;
  -- A chat belongs to the office it was first recorded in. It is never moved.
  if v_bound is not null and v_bound <> v_office then
    return 'ignored';
  end if;

  insert into public.telegram_chats
    (office_id, chat_id, chat_type, bot_id, subject, title, username,
     deliverable, undeliverable_reason, undeliverable_at)
  values
    (v_office, p_chat_id, p_chat_type, p_bot_id, v_subject, p_title, p_username,
     not v_test,
     case when v_test then 'a declared test origin (#381)' end,
     case when v_test then app.now_utc() end)
  on conflict (bot_id, chat_id) do update
    set last_seen_at = app.now_utc(),
        chat_type = excluded.chat_type,
        title = coalesce(excluded.title, public.telegram_chats.title),
        username = coalesce(excluded.username, public.telegram_chats.username),
        subject = excluded.subject,
        deliverable = excluded.deliverable,
        undeliverable_reason = excluded.undeliverable_reason,
        undeliverable_at = excluded.undeliverable_at
    where public.telegram_chats.office_id = excluded.office_id;

  return case when coalesce(v_existed, false) then 'updated' else 'registered' end;
end
$f$;
revoke all on function app.record_telegram_chat(text, text, text, text, text, text, text) from public, anon, authenticated, service_role;

create function public.record_telegram_chat(
  p_chat_id text, p_chat_type text, p_bot_id text, p_subject text default null, p_title text default null,
  p_username text default null, p_sender text default null)
returns text
language sql
security definer
set search_path to ''
as $f$ select app.record_telegram_chat(p_chat_id, p_chat_type, p_bot_id, p_subject, p_title, p_username, p_sender) $f$;
revoke all on function public.record_telegram_chat(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_telegram_chat(text, text, text, text, text, text, text) to service_role;

drop function public.record_telegram_chat(text, text, text, text, text, text);
drop function app.record_telegram_chat(text, text, text, text, text, text);
drop function app.telegram_chat_for(text, text);
drop function app.telegram_office_chat(text);
