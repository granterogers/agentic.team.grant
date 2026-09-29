-- 0605 - A test that uses a real door says so before it knocks (#381).
--
-- 0603 decides where work came from POSITIVELY: a turn is trusted when its
-- key is one a production adapter writes. That is exactly right, and it has
-- one consequence 0603 could not answer: a verification suite that posts a
-- correctly signed update to the DEPLOYED Telegram or Slack webhook gets a
-- key the adapter really did write. The signature proves the caller holds
-- the credential. It does not prove the request is Grant.
--
-- Measured, read-only, before this migration:
--   verify:latency   posted AS Grant in his own Telegram chat and in the
--                    ai-team-hq-test Slack lobby: 20 roots, 29 messages to
--                    1386648496, -5444104624, C0BVD21Q9S5 and C0C276SFM7D,
--                    9-21 September, every one still read as his today.
--   gate-3 / verify:telegram "hello" from fake chats: 21 messages to his
--                    Telegram and C0BVD21Q9S5, classified harness only
--                    because teardown rewrote the attribution AFTERWARDS.
--
-- Inferring intent after an authenticated request has been accepted is the
-- thing that cannot work, so this does not try. A suite that drives a real
-- door DECLARES the conversation it is about to use, before it posts, and
-- the ingress stamp that already decides `synthetic` (0541) honours the
-- declaration at the moment the row is written:
--
--   public.test_origins        one row per (channel, conversation) a run
--                              declares: a Telegram chat, a Slack channel,
--                              a voice session, a dashboard project, an MCP
--                              client. Run-scoped (run_token), expiring, and
--                              append-only: releasing it records a time and
--                              deletes nothing, so the witness can always
--                              read what was declared.
--   app.register_test_origin   the only writer. It REFUSES a conversation
--                              that has ever carried real traffic: Grant's
--                              chats, a Slack channel mapped to a real
--                              project, a project or client with real work.
--                              So a registration can never be wide enough
--                              to swallow him - it cannot name his chat.
--   app.stamp_synthetic_inbound  unchanged for non-production ingress; for
--                              production ingress, a row whose conversation
--                              is declared is written `synthetic`.
--   app.job_inherits_synthetic  and an MCP root job from a declared client.
--
-- `synthetic` was already immutable (0541) and inherited by every child at
-- insert (0542), and app.harness_job and app.job_origin already read it. So
-- the classification is decided ONCE, at the door, and is permanent: a
-- retry, a child, a worker restart or the registration's own expiry cannot
-- turn the work back into Grant's.
--
-- A declaration is STICKY for its conversation. Expiry and release end the
-- run's window; they do not make the conversation real again, because the
-- registration proved it was never real, and a late or duplicated webhook
-- for a test chat is still a test. A conversation that has had real traffic
-- could never have been declared, so stickiness cannot hide Grant's own.

create table if not exists public.test_origins (
  origin_id     uuid primary key default gen_random_uuid(),
  channel       text not null check (channel in ('telegram', 'slack', 'voice', 'teamhq', 'mcp')),
  conversation  text not null check (conversation ~ '^-?[A-Za-z0-9_.-]{1,80}$'),
  run_token     text not null check (run_token ~ '^[a-z0-9]{8,32}$'),
  registered_by text not null check (registered_by ~ '^[a-z0-9:_.-]{3,80}$'),
  registered_at timestamptz not null default app.now_utc(),
  expires_at    timestamptz not null,
  released_at   timestamptz,
  unique (channel, conversation, run_token),
  check (expires_at > registered_at and expires_at <= registered_at + interval '24 hours'),
  check (released_at is null or released_at >= registered_at)
);

create index if not exists test_origins_conversation on public.test_origins (channel, conversation);

comment on table public.test_origins is
  'Conversations a verification run declared as test traffic BEFORE driving a '
  'production door (#381). Written only by app.register_test_origin; '
  'append-only; sticky for the conversation. Read by the ingress stamp and, '
  'independently, by the check:leaks witness.';

revoke all on public.test_origins from public, anon, authenticated;

create or replace function app.test_origins_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f$
begin
  if tg_op = 'DELETE' then
    raise exception 'test_origins is append-only: a declaration is evidence (#381)';
  end if;
  if new.origin_id is distinct from old.origin_id
     or new.channel is distinct from old.channel
     or new.conversation is distinct from old.conversation
     or new.run_token is distinct from old.run_token
     or new.registered_by is distinct from old.registered_by
     or new.registered_at is distinct from old.registered_at
     or new.expires_at is distinct from old.expires_at
     or old.released_at is not null then
    raise exception 'test_origins: only an unreleased declaration may be released (#381)';
  end if;
  return new;
end
$f$;

drop trigger if exists test_origins_append_only on public.test_origins;
create trigger test_origins_append_only
  before update or delete on public.test_origins
  for each row execute function app.test_origins_append_only();

/*
  The conversation a turn belongs to, from the fields the adapter writes.

    telegram  the chat: origin_ref is <chat>:<message> for a message AND for a
              button press (src/channels/telegram.ts), so one rule covers both
    slack     the channel: the third field of every slack:message|reaction|
              action key (src/slack/events.ts, interactions.ts)
    voice     the session: voice:turn:<session>.<turn>
    teamhq    the project the dashboard turn is said in (app.say_in_project)
*/
create or replace function app.origin_conversation(
  p_channel text, p_origin_ref text, p_key text, p_project uuid)
returns text
language sql
immutable
set search_path = ''
as $f$
  select case p_channel
    when 'telegram' then nullif(split_part(coalesce(p_origin_ref, ''), ':', 1), '')
    when 'slack' then
      case when coalesce(p_key, '') ~ '^slack:(message|reaction|action):'
           then nullif(split_part(p_key, ':', 3), '') end
    when 'voice' then
      case when coalesce(p_key, '') like 'voice:turn:%'
           then nullif(split_part(split_part(p_key, ':', 3), '.', 1), '') end
    when 'teamhq' then p_project::text
    else null
  end
$f$;

/* Is this conversation declared? Any declaration, in any state: sticky. */
create or replace function app.declared_test_origin(p_channel text, p_conversation text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $f$
  select t.origin_id from public.test_origins t
   where t.channel = p_channel and t.conversation = p_conversation
   order by t.registered_at limit 1
$f$;

/*
  The one writer. What makes a declaration narrow is what it REFUSES: any
  conversation with evidence of real use. Each rule reads a table the
  production adapters write, so a real conversation is known before a test
  could claim it.
*/
create or replace function app.register_test_origin(
  p_channel text, p_conversation text, p_run_token text, p_registered_by text,
  p_ttl interval default interval '2 hours')
returns uuid
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_real text;
  v_id uuid;
begin
  if p_channel is null or p_channel not in ('telegram', 'slack', 'voice', 'teamhq', 'mcp') then
    raise exception 'register_test_origin: % is not a door', coalesce(p_channel, 'null');
  end if;
  if coalesce(p_run_token, '') !~ '^[a-z0-9]{8,32}$' then
    raise exception 'register_test_origin: a run token is 8-32 lower-case letters and digits';
  end if;
  if p_ttl is null or p_ttl <= interval '0' or p_ttl > interval '24 hours' then
    raise exception 'register_test_origin: a declaration lasts between a moment and a day';
  end if;

  -- Real traffic, from the rows the adapters themselves write.
  v_real := case
    when exists (select 1 from public.inbound_commands c
                  where c.origin_channel::text = p_channel and not c.synthetic
                    and app.origin_conversation(c.origin_channel::text, c.origin_ref, c.dedupe_key, c.project_id)
                        = p_conversation)
      then 'it has carried a real turn'
    when p_channel = 'telegram' and exists (
           select 1 from public.telegram_chats t where t.chat_id = p_conversation)
      then 'it is a Telegram chat the office already knows'
    when p_channel = 'slack' and exists (
           select 1 from public.slack_channel_map m
             left join public.projects p on p.project_id = m.project_id
            where m.channel_id = p_conversation and not coalesce(p.is_fixture, false))
      then 'it is the Slack channel of a real project, or of none'
    when p_channel = 'teamhq' and not exists (
           select 1 from public.projects p where p.project_id::text = p_conversation)
      then 'there is no such project'
    when p_channel = 'teamhq' and exists (
           select 1 from public.jobs j where j.project_id::text = p_conversation and not j.synthetic)
      then 'the project has real work'
    when p_channel = 'mcp' and not exists (
           select 1 from public.mcp_clients m where m.client_id = p_conversation)
      then 'there is no such MCP client'
    when p_channel = 'mcp' and exists (
           select 1 from public.jobs j where j.requested_by = 'mcp:' || p_conversation and not j.synthetic)
      then 'the MCP client has real work'
    else null
  end;
  if v_real is not null then
    raise exception 'register_test_origin: refused % %: %', p_channel, p_conversation, v_real;
  end if;

  insert into public.test_origins (channel, conversation, run_token, registered_by, expires_at)
  values (p_channel, p_conversation, p_run_token, p_registered_by, app.now_utc() + p_ttl)
  on conflict (channel, conversation, run_token) do nothing
  returning origin_id into v_id;
  if v_id is null then
    select t.origin_id into v_id from public.test_origins t
     where t.channel = p_channel and t.conversation = p_conversation and t.run_token = p_run_token;
  end if;
  return v_id;
end
$f$;

comment on function app.register_test_origin(text, text, text, text, interval) is
  'Declare a conversation as test traffic before driving a production door '
  '(#381). Refuses any conversation with evidence of real use.';

/* The end of a run's window. Deletes nothing and un-declares nothing. */
create or replace function app.release_test_origins(p_run_token text)
returns integer
language sql
security definer
set search_path = ''
as $f$
  with r as (
    update public.test_origins set released_at = app.now_utc()
     where run_token = p_run_token and released_at is null
    returning 1)
  select count(*)::int from r
$f$;

revoke execute on function app.register_test_origin(text, text, text, text, interval) from public;
revoke execute on function app.release_test_origins(text) from public;
revoke execute on function app.declared_test_origin(text, text) from public;

-- The stamp, with the declaration honoured at the door.
create or replace function app.stamp_synthetic_inbound()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Deny by default: anything that did not come through a production door is
  -- synthetic, whatever it calls itself.
  if not app.from_production_ingress() then
    new.synthetic := true;
  -- A production door, and a conversation a run declared first (#381).
  elsif app.declared_test_origin(
          new.origin_channel::text,
          app.origin_conversation(new.origin_channel::text, new.origin_ref, new.dedupe_key, new.project_id))
        is not null then
    new.synthetic := true;
  end if;
  return new;
end;
$function$;

-- The MCP door writes a job, not a turn: a declared client's root job is
-- synthetic from its first row. Everything else is 0541/0542, unchanged.
create or replace function app.job_inherits_synthetic()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_command uuid;
  v_mark boolean;
begin
  -- An explicit true is never softened. A caller that already knows this is
  -- synthetic outranks anything derived.
  if new.synthetic then
    return new;
  end if;

  if new.parent_job_id is not null then
    select j.synthetic into v_mark from public.jobs j where j.job_id = new.parent_job_id;
    if coalesce(v_mark, false) then
      new.synthetic := true;
    end if;
    return new;
  end if;

  -- #381: a root job an MCP client asked for, where the client was declared.
  if coalesce(new.requested_by, '') like 'mcp:%'
     and app.declared_test_origin('mcp', substring(new.requested_by from 5)) is not null then
    new.synthetic := true;
    return new;
  end if;

  -- app.enqueue_inbound composes this key. The uuid cast is guarded because
  -- the column is free text and a malformed key must not raise inside an
  -- insert -- a guard that breaks the write it protects is worse than no
  -- guard.
  if new.idempotency_key like 'inbound-%' then
    begin
      v_command := substring(new.idempotency_key from 9)::uuid;
    exception when others then
      return new;
    end;
    select c.synthetic into v_mark
      from public.inbound_commands c where c.command_id = v_command;
    if coalesce(v_mark, false) then
      new.synthetic := true;
    end if;
  end if;

  return new;
end;
$function$;

/*
  A document a declared MCP client added is harness, so the work its arrival
  starts (knowledge.read_source) is not the office's own. 0603's definition
  otherwise unchanged.
*/
create or replace function app.document_origin(p_document_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare
  d public.documents;
begin
  select * into d from public.documents where document_id = p_document_id;
  if not found then return 'unknown'; end if;
  if d.produced_by_job is not null then return app.job_origin(d.produced_by_job); end if;
  if d.added_by is not null and app.declared_test_origin('mcp', d.added_by) is not null then
    return 'harness';
  end if;
  if d.added_by is null or d.added_by in ('grant', 'the office') then return 'internal'; end if;
  if exists (select 1 from public.staff s where s.slug = d.added_by) then return 'internal'; end if;
  if exists (select 1 from public.mcp_clients m
              where m.client_id = d.added_by and m.enabled and 'write' = any (m.scopes)) then
    return 'internal';
  end if;
  return 'unknown';
end
$f$;

/*
  The webhook records every chat it hears from, before it has decided anything
  (a chat is proof of reach), under the configured subject - and
  app.telegram_chat_for sends Grant's private messages to the NEWEST deliverable
  private chat attributed to him. So a declared fixture chat, recorded as his,
  would for as long as its row existed be where the pager sends him things. A
  declared chat is recorded, and recorded as not deliverable: it can never be
  chosen as somewhere to reach him. Everything else is unchanged.
*/
create or replace function app.record_telegram_chat(
  p_chat_id text, p_chat_type text, p_bot_id text, p_subject text default null,
  p_title text default null, p_username text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existed boolean;
  v_test boolean := app.declared_test_origin('telegram', p_chat_id) is not null;
begin
  select true into v_existed from public.telegram_chats
   where chat_id = p_chat_id and bot_id = p_bot_id;

  insert into public.telegram_chats
    (chat_id, chat_type, bot_id, subject, title, username,
     deliverable, undeliverable_reason, undeliverable_at)
  values
    (p_chat_id, p_chat_type, p_bot_id, p_subject, p_title, p_username,
     not v_test,
     case when v_test then 'a declared test origin (#381)' end,
     case when v_test then app.now_utc() end)
  on conflict (bot_id, chat_id) do update
    set last_seen_at = app.now_utc(),
        chat_type = excluded.chat_type,
        title = coalesce(excluded.title, public.telegram_chats.title),
        username = coalesce(excluded.username, public.telegram_chats.username),
        subject = coalesce(excluded.subject, public.telegram_chats.subject),
        deliverable = excluded.deliverable,
        undeliverable_reason = excluded.undeliverable_reason,
        undeliverable_at = excluded.undeliverable_at;

  return case when coalesce(v_existed, false) then 'updated' else 'registered' end;
end;
$function$;

/*
  Proved here, inside a subtransaction that always rolls back, so the
  migration's own fixtures never persist and a real failure still raises.
*/
do $proof$
declare
  v_tok text := 'm0605' || substr(md5(random()::text), 1, 8);
  v_fixture text := '-7' || lpad((floor(random() * 1e14))::bigint::text, 15, '0');
  v_real text;
  v_ok boolean;
begin
  begin
    perform app.register_test_origin('telegram', v_fixture, v_tok, 'migration:0605');
    if app.declared_test_origin('telegram', v_fixture) is null then
      raise exception '0605 proof: a declaration was not found';
    end if;
    select t.chat_id into v_real from public.telegram_chats t limit 1;
    if v_real is not null then
      begin
        perform app.register_test_origin('telegram', v_real, v_tok, 'migration:0605');
        raise exception '0605 proof: a real chat was declared';
      exception when others then
        if sqlerrm not like '%refused telegram%' then raise; end if;
      end;
    end if;
    v_ok := app.origin_conversation('slack', 'C0ABCDEFG:1.2', 'slack:message:C0ABCDEFG:1790000000.000100', null) = 'C0ABCDEFG'
        and app.origin_conversation('telegram', '-100123:9', 'telegram:callback:1:2', null) = '-100123'
        and app.origin_conversation('voice', 'sabc/x', 'voice:turn:sabc.1', null) = 'sabc';
    if not v_ok then raise exception '0605 proof: origin_conversation'; end if;
    raise exception 'rollback-0605-proof';
  exception when others then
    if sqlerrm <> 'rollback-0605-proof' then raise; end if;
  end;
end
$proof$;
