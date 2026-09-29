-- 0603 - Unknown origin is not real traffic (#379).
--
-- 0601 made every outbound message name its job and asked app.harness_job of
-- that job. app.harness_job answers ONE question - "do we know this is test
-- traffic?" - and anything it does not recognise comes back "real". So a turn
-- that went in through a production door with a key no production adapter can
-- produce was treated as Grant's own: `telegram:artifact_demo:02jzde`, written
-- on 17 September by an uncommitted authoring-session script, delivered six
-- Slack posts and a Telegram reply to him, and 277 more commands of suite
-- shapes (`telegram:message:escapes-...-real`, `telegram:ctx:...`,
-- `teamhq:branch_turn:...`, `voice:message:...`) still read as real today.
--
-- Two questions, two functions:
--
--   app.harness_job(job)   KNOWN harness. Unchanged; every reader that hides
--                          test traffic from Grant keeps using it.
--   app.job_origin(job)    WHERE THIS WORK CAME FROM, positively:
--                            'harness'   exactly when app.harness_job says so;
--                            'trusted'   its root is a turn whose key is one a
--                                        production adapter produces, on that
--                                        adapter's channel, for a bot the
--                                        office has;
--                            'internal'  its root is a job the office itself
--                                        creates, bound to the row that made it
--                                        (a responsibility, an event trigger,
--                                        an MCP client, a document ...);
--                            'unknown'   anything else - including a job that
--                                        does not exist.
--
-- The two boundaries that let work touch the outside world ask ONE function,
-- app.may_act_outside(job): app.delivery_refusal (every message) and the
-- worker's external-write gate (src/jobs/containment.ts). Unknown fails
-- closed at both.
--
-- The grammar is POSITIVE. It says what each adapter writes, from the code
-- that writes it, and names no test suite:
--
--   Telegram  src/channels/telegram.ts   telegram:message:<bot>:<chat>:<msg>
--                                        telegram:callback:<bot>:<query id>
--             <bot> must be a bot in public.telegram_bots.
--   Slack     src/slack/events.ts        slack:message:<channel>:<ts>
--             src/slack/interactions.ts  slack:reaction|action:<channel>:<ts>:<user>:<verb>
--             app.record_slack_history   slack:message:<channel>:<ts>
--             ids in Slack's own alphabet; <ts> is Slack's seconds.micros.
--   Voice     supabase/functions/voice   voice:turn:<session>.<turn>, where the
--                                        session is the one chat.js and call.js
--                                        mint: s + up to ten base-36 characters.
--   Dashboard app.say_in_project         teamhq:message:<32 hex, server-minted>
--             app.send_to_agent          asset:<kind>:<uuid>:<action>:<17-digit clock>
--
-- The four-part Telegram key the adapter wrote before commit 72dd4040
-- (7 September) is still Grant's own history. It is admitted by a SNAPSHOT of
-- the rows that exist when this migration runs, never by shape: the adapter
-- cannot produce it any more, and received_at is supplied by the caller, so a
-- time bound on it could be forged by back-dating.

create table if not exists public.legacy_trusted_commands (
  command_id uuid primary key references public.inbound_commands (command_id),
  why text not null,
  recorded_at timestamptz not null default app.now_utc()
);

comment on table public.legacy_trusted_commands is
  'Turns written by a retired version of a production adapter (#379), frozen '
  'when 0603 ran. app.command_origin trusts these by id; no new row can ever '
  'qualify by shape. Insert only with evidence of the retired adapter.';

insert into public.legacy_trusted_commands (command_id, why)
select c.command_id, 'telegram adapter before 72dd4040: telegram:message:<chat>:<msg>'
  from public.inbound_commands c
 where c.origin_channel = 'telegram'
   and c.dedupe_key ~ '^telegram:message:-?[0-9]+:[0-9]+$'
   and c.received_at < '2026-09-07 15:00:00+00'
   and not c.synthetic
on conflict (command_id) do nothing;

/*
  Is this key one the named channel's production adapter produces?
  STABLE, not IMMUTABLE: a Telegram key must name a bot the office has.
*/
create or replace function app.adapter_key_ok(p_channel text, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $f$
  select coalesce(case p_channel
    when 'telegram' then
      (p_key ~ '^telegram:message:[0-9]+:-?[0-9]+:[0-9]+$'
         or p_key ~ '^telegram:callback:[0-9]+:[0-9]+$')
      and exists (select 1 from public.telegram_bots b where b.bot_id = split_part(p_key, ':', 3))
    when 'slack' then
      p_key ~ '^slack:message:[CDG][A-Z0-9]{6,}:[0-9]{10}\.[0-9]{6}$'
      or p_key ~ '^slack:(reaction|action):[CDG][A-Z0-9]{6,}:[0-9]{10}\.[0-9]{6}:[UW][A-Z0-9]{6,}:[a-z_]+$'
    when 'voice' then
      p_key ~ '^voice:turn:s[a-z0-9]{1,10}\.[a-z0-9]+$'
    when 'teamhq' then
      p_key ~ '^teamhq:message:[0-9a-f]{32}$'
      or p_key ~ '^asset:[a-z_]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z_]+:[0-9]{17}$'
    else false
  end, false)
$f$;

comment on function app.adapter_key_ok(text, text) is
  'Whether a dedupe key is one the channel''s production adapter produces '
  '(#379). Positive: it describes the adapters, not the tests.';

/* Where one inbound turn came from: harness, trusted or unknown. */
create or replace function app.command_origin(p_command_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $f$
  select coalesce((
    select case
      when c.synthetic
        or app.harness_label(c.dedupe_key)
        or app.harness_voice_session(c.dedupe_key) then 'harness'
      when exists (select 1 from public.legacy_trusted_commands l where l.command_id = c.command_id)
        then 'trusted'
      when app.adapter_key_ok(c.origin_channel::text, c.dedupe_key) then 'trusted'
      else 'unknown'
    end
    from public.inbound_commands c where c.command_id = p_command_id), 'unknown')
$f$;

/*
  Where a document came from. A document starts work of its own (a new source
  is read, 0107), so the work is only as trusted as the document.

  The writers that add documents, and what each records in added_by:
    the office's connector syncs and imports      null
    the dashboard's upload (hq-api)               'grant'
    the instruction handler's own filing          'the office'
    an artifact the office made (store.ts)        the specialist's slug, and the
                                                  job that made it in produced_by_job
    app.mcp_add_document                          the MCP client id
  A document made by a job is exactly as trusted as that job. Anything else in
  added_by -- 'verify:scenario-a', 'probe-w' -- is a writer that is not one of
  these, and is unknown.
*/
create or replace function app.document_origin(p_document_id uuid)
returns text
language plpgsql   -- plpgsql so it may name app.job_origin, which is created below
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
  A root job with no turn behind it is the office's own work only when the
  thing that creates it exists: the creators are the database functions that
  insert into public.jobs, and each writes a requested_by that names its row.
*/
create or replace function app.internal_root_ok(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $f$
  select coalesce((
    select
      -- app.dispatch_due_responsibilities
      exists (select 1 from public.responsibilities r
               where j.requested_by = 'duty:' || r.slug and r.job_kind = j.kind)
      -- app.fire_triggers_for
      or exists (select 1 from public.event_triggers t
                  where j.requested_by = 'trigger:' || t.name and t.job_kind = j.kind)
      -- app.provision_missing_channels, app.hq_rename_project
      or (j.requested_by = 'hq' and j.kind in ('office.provision_channels', 'office.rename_channels'))
      -- app.google_revoke_begin (the dashboard's Disconnect Google)
      or (j.requested_by = 'grant' and j.kind = 'google.revoke')
      -- app.register_mcp_provider
      or (j.requested_by = 'connector:register' and j.kind = 'mcp.discover')
      -- app.mcp_enqueue: a client the office issued a credential to
      or exists (select 1 from public.mcp_clients m
                  where j.requested_by = 'mcp:' || m.client_id and m.enabled and 'write' = any (m.scopes))
      -- app.notice_new_document: the document it names, by the name it wrote
      or (j.kind = 'knowledge.read_source' and exists (
            select 1 from public.documents d
             where d.document_id::text = j.pinned_config ->> 'document_id'
               and j.requested_by = d.connector || ':' || coalesce(d.external_ref, 'source')
               and app.document_origin(d.document_id) in ('trusted', 'internal')))
    from public.jobs j where j.job_id = p_job_id), false)
$f$;

create or replace function app.job_origin(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $f$
  with recursive up as (
    select j.job_id, j.parent_job_id, j.pinned_config, 0 as depth
      from public.jobs j where j.job_id = p_job_id
    union all
    select p.job_id, p.parent_job_id, p.pinned_config, up.depth + 1
      from up join public.jobs p on p.job_id = up.parent_job_id
     where up.depth < 64
  ),
  root as (select * from up where parent_job_id is null order by depth desc limit 1)
  select case
    when not exists (select 1 from up) then 'unknown'
    when app.harness_job(p_job_id) then 'harness'
    when not exists (select 1 from root) then 'unknown'      -- a chain that never ends
    when (select pinned_config ? 'command_id' from root) then
      app.command_origin((select (pinned_config ->> 'command_id')::uuid from root))
    when app.internal_root_ok((select job_id from root)) then 'internal'
    else 'unknown'
  end
$f$;

comment on function app.job_origin(uuid) is
  'Where this work came from (#379): harness | trusted | internal | unknown. '
  'Decided at the ROOT of the lineage; harness anywhere in it wins, because '
  'app.harness_job already walks the chain. Unknown is never trusted.';

create or replace function app.may_act_outside(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $f$
  select app.job_origin(p_job_id) in ('trusted', 'internal')
$f$;

comment on function app.may_act_outside(uuid) is
  'The one question both external boundaries ask (#379): the delivery guard '
  '(app.delivery_refusal) and the worker''s external-write gate.';

-- 0601's policy, with the lineage question answered by job_origin. Everything
-- before the last branch is 0601's, unchanged.
create or replace function app.delivery_refusal(
  p_job_id uuid, p_dedupe_key text, p_channel text, p_target_ref text)
returns text
language sql
stable
security definer
set search_path = ''
as $f$
  select case
    when exists (select 1 from public.test_destinations t
                  where t.channel = p_channel and t.target_ref = p_target_ref) then null
    when p_job_id is null then
      case when exists (select 1 from public.operator_senders s
                         where s.namespace = split_part(coalesce(p_dedupe_key, ''), ':', 1))
           then null
           else 'no provenance: a delivery must name its job or a registered operator sender'
      end
    when not exists (select 1 from public.jobs j where j.job_id = p_job_id) then
      'no provenance: the job this delivery names does not exist'
    else
      case app.job_origin(p_job_id)
        when 'harness' then 'harness traffic may not reach a production destination'
        when 'unknown' then 'unknown origin: no production door or office process made this work'
        else null
      end
  end
$f$;

create or replace function app.deliverable_to(p_job_id uuid, p_channel text, p_target_ref text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $f$
  select case
    when exists (select 1 from public.test_destinations t
                  where t.channel = p_channel and t.target_ref = p_target_ref) then true
    when p_job_id is null then false
    else app.may_act_outside(p_job_id)
  end
$f$;
