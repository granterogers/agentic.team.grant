-- 0897 - a visitor can explore a Sample Office without an account, and can change nothing in it.
--
-- Grant, 5 October 2026: a person who is not signed in should be able to explore a Sample Office that behaves like a
-- real one, without email, a link or a password, and without that being able to reach Grant, another person, or
-- anything that costs money.
--
-- What already existed: `offices.kind` has allowed 'sample' since 0654 and every real-office count already includes it.
-- What did not: a way to HOLD a session for it that is not a person. The shape chosen is the one the gateway already
-- has for test members - a member whose kind is not 'person' is read-only by default (0614) - with a third kind,
-- 'guest', that the gateway lets do exactly one thing besides read: ask the team a question through `sample_say`.
--
-- WHAT A GUEST IS
--   * a login (auth.users) whose office_members row says kind = 'guest' and whose office is kind = 'sample';
--   * it is never an operator, never a person, never a harness: `principal_kind` says 'guest' and
--     `authority_refusal` refuses it every decision;
--   * it can read the Sample Office like anybody (the gateway scopes every read to the office);
--   * it can speak, only through `sample_say`, which rate-limits per visitor and per day, tags the turn with an
--     unguessable visitor id, and gives the turn its own chat so one visitor's conversation is never another's context.
--
-- WHAT A VISITOR'S TURN IS (the important choice)
--   `app.harness_job` is the one canonical question "is this work somebody's real work?". A visitor's turn is not any
--   real person's work, so it answers no. That single fact makes every reader that already excludes harness traffic
--   (Recent activity, the conversation, measure, the briefing) exclude visitors, makes `app.job_origin` refuse the turn
--   any outside effect (Slack, Telegram, Google, mail), and keeps visitor chatter out of what the next visitor sees.
--   The visitor's own thread is read by `sample_conversation`, which does not apply that filter and applies the
--   visitor's id instead.
--
-- WHAT IS NOT HERE: no new table (so nothing new for check:ownership), no change to any existing signature.

begin;

-- 1. A third kind of member --------------------------------------------------------------------------------------------
alter table public.office_members drop constraint office_members_kind_known;
alter table public.office_members add constraint office_members_kind_known
  check (kind = any (array['person'::text, 'harness'::text, 'guest'::text]));

-- 2. Who a principal is: a guest is a guest -----------------------------------------------------------------------------
create or replace function app.principal_kind(p_by text)
returns text
language sql
stable security definer
set search_path to ''
as $function$
  select case
    when btrim(coalesce(p_by, '')) = '' then 'unknown'
    when app.harness_label(btrim(p_by))
      or exists (select 1 from public.subject_identities s where s.subject = btrim(p_by) and s.kind = 'harness')
      or exists (select 1 from public.office_members m where m.owner_key = btrim(p_by) and m.kind = 'harness')
      then 'harness'
    when exists (select 1 from public.office_members m where m.owner_key = btrim(p_by) and m.kind = 'guest')
      then 'guest'
    when exists (select 1 from public.subject_identities s where s.subject = btrim(p_by) and s.kind = 'person')
      or exists (select 1 from public.office_members m where m.owner_key = btrim(p_by) and m.kind = 'person')
      then 'person'
    else 'unknown'
  end
$function$;

-- 3. A guest decides nothing ---------------------------------------------------------------------------------------------
create or replace function app.authority_refusal(p_by text, p_job uuid default null, p_project uuid default null)
returns text
language sql
stable security definer
set search_path to ''
as $function$
  select case app.principal_kind(p_by)
    when 'unknown' then
      case when btrim(coalesce(p_by, '')) = ''
        then 'I cannot tell who is answering, so this was not taken as an answer.'
        else 'That answer came from somebody the office does not know, so it was not taken.'
      end
    when 'harness' then
      case when (p_job is not null and app.harness_job(p_job))
                or (p_project is not null and app.fixture_project(p_project))
        then null
        else 'A test principal cannot decide something real, so this was not taken.'
      end
    when 'guest' then
      'This is a sample office, so nothing here can be decided. Create your own office to try it for real.'
    else null
  end
$function$;

-- 4. A visitor's turn is not anybody's real work -------------------------------------------------------------------------
-- Spliced from the LIVE definition: the one new clause is `or c.context ->> 'visitor' is not null`.
create or replace function app.harness_job(p_job_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    (select j.synthetic or j.is_fixture or coalesce(p.is_fixture, false)
              or (j.pinned_config ->> 'origin_namespace') = 'verify'
              or exists (
                   select 1 from public.inbound_commands c
                    where c.command_id = (j.pinned_config ->> 'command_id')::uuid and c.office_id = j.office_id
                      and (app.harness_label(c.dedupe_key)
                           or app.harness_voice_session(c.dedupe_key)
                           -- A sample visitor's question: nobody's real work (0897).
                           or c.context ->> 'visitor' is not null))
              or (j.parent_job_id is not null and app.harness_job(j.parent_job_id))
       from public.jobs j
       left join public.projects p on p.project_id = j.project_id
      where j.job_id = p_job_id),
    false)
$function$;

-- 5. The visitor's own conversation, and nobody else's -------------------------------------------------------------------
-- The ordinary conversation of a Sample Office is empty by construction: every turn in it is a visitor's, and a visitor
-- reads only their own through `sample_conversation`. Without this the page's usual section would show visitor B what
-- visitor A asked.
create or replace function app.conversation_history(p_office uuid, p_project_id uuid, p_limit integer default 50, p_before timestamp with time zone default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
  if exists (select 1 from public.offices o where o.office_id = p_office and o.kind = 'sample') then
    return '[]'::jsonb;
  end if;
  select pj.project_id into v_project from public.projects pj where pj.project_id = p_project_id and pj.office_id = p_office;
  return (
  with bounded as (select greatest(1, least(coalesce(p_limit, 50), 200)) as n),
  said as (
    select
      c.received_at as at,
      jsonb_build_object(
        'message_id',   c.command_id,
        'kind',         'said',
        'at',           c.received_at,
        'from',         app.office_actor(p_office),
        'name',         (select o.name from public.offices o where o.office_id = p_office),
        'body',         coalesce(nullif(btrim(c.transcript), ''), c.instruction),
        'surface',      c.origin_channel,
        'addressed_to', c.addressed_to,
        'spoken',       c.voice_file_id is not null,
        'backfilled',   coalesce((c.context->>'backfilled')::boolean, false)
      ) as v
      from public.inbound_commands c
      left join public.jobs j on j.job_id = c.job_id
     where c.office_id = p_office
       and c.project_id = v_project
       and coalesce(j.is_fixture, false) = false
       and (c.job_id is null or not app.harness_job(c.job_id))
       and (p_before is null or c.received_at < p_before)
     order by c.received_at desc
     limit (select n from bounded)
  ),
  answered as (
    select
      o.created_at as at,
      jsonb_build_object(
        'message_id',    o.output_id,
        'kind',          'answered',
        'at',            o.created_at,
        'from',          coalesce(s.slug, 'the-office'),
        'name',          coalesce(s.name, 'The team'),
        'body',          o.body,
        'confidence',    o.confidence::text,
        'evidence',      o.evidence::text,
        'deterministic', o.deterministic,
        'job',           o.job_id,
        'delivery',      dstate.worst,
        'undelivered',   coalesce(dstate.failed, 0)
      ) as v
      from public.outputs o
      join public.jobs j on j.job_id = o.job_id
      left join public.staff s on s.staff_id = o.staff_id
      left join lateral (
        select
          count(*) filter (where d.state = 'failed') as failed,
          case
            when count(*) filter (where d.state = 'failed') > 0 then 'failed'
            when count(*) filter (where d.state = 'claimed') > 0 then 'sending'
            when count(*) > 0 then 'sent'
            else null
          end as worst
          from public.deliveries d
         where d.job_id = o.job_id and d.office_id = p_office
      ) dstate on true
     where j.office_id = p_office
       and (
             j.project_id = v_project
             or (j.project_id is null and v_project is not null
                 and v_project = (select pu.project_id from public.projects pu
                                   where pu.slug = 'unnamed' and pu.office_id = p_office))
           )
       and not j.is_fixture
       and not app.harness_job(j.job_id)
       and (p_before is null or o.created_at < p_before)
     order by o.created_at desc
     limit (select n from bounded)
  ),
  recent as (
    select at, v
      from (select at, v from said union all select at, v from answered) both_sides
     order by at desc
     limit (select n from bounded)
  )
  select coalesce(jsonb_agg(r.v order by r.at), '[]'::jsonb) from recent r
  );
end
$function$;

-- 6. How much a visitor may ask ------------------------------------------------------------------------------------------
-- Null means "go ahead"; otherwise the sentence to show. The limits are settings so Grant can move them without a
-- migration: sample.turns_per_visitor_hour (default 6), sample.turns_per_visitor_day (15), sample.turns_per_day (250),
-- and at most two of a visitor's questions unanswered at once. Counted from the turns themselves, so there is no counter
-- to get stuck and nothing to reset.
create or replace function app.guest_allow(p_office uuid, p_visitor text)
returns text
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_hour_cap int := coalesce((select value::text::integer from public.system_config where key = 'sample.turns_per_visitor_hour'), 6);
  v_day_cap  int := coalesce((select value::text::integer from public.system_config where key = 'sample.turns_per_visitor_day'), 15);
  v_all_cap  int := coalesce((select value::text::integer from public.system_config where key = 'sample.turns_per_day'), 250);
  v_hour int; v_day int; v_all int; v_live int;
begin
  select count(*) filter (where c.context ->> 'visitor' = p_visitor and c.received_at > now() - interval '1 hour'),
         count(*) filter (where c.context ->> 'visitor' = p_visitor),
         count(*)
    into v_hour, v_day, v_all
    from public.inbound_commands c
   where c.office_id = p_office and c.received_at > now() - interval '24 hours' and c.context ->> 'visitor' is not null;
  if v_all >= v_all_cap then
    return 'The sample team has had a great many visitors today and needs a rest. Please come back tomorrow, or create your own office to carry on now.';
  end if;
  if v_day >= v_day_cap or v_hour >= v_hour_cap then
    return 'You have asked the sample team a lot just now. Give it a little while, or create your own office to keep going.';
  end if;
  select count(*) into v_live
    from public.inbound_commands c
    join public.jobs j on j.job_id = c.job_id
   where c.office_id = p_office and c.context ->> 'visitor' = p_visitor
     and c.received_at > now() - interval '1 hour'
     and j.state not in ('complete', 'failed', 'cancelled');
  if v_live >= 2 then
    return 'Your last question is still being answered. Wait for the reply, then ask again.';
  end if;
  return null;
end
$function$;

-- 7. Saying something in the Sample Office --------------------------------------------------------------------------------
create or replace function app.sample_say(p_office uuid, p_project_id uuid, p_text text, p_visitor text, p_by text)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_said    text := nullif(btrim(coalesce(p_text, '')), '');
  v_by      text := nullif(btrim(coalesce(p_by, '')), '');
  v_visitor text := btrim(coalesce(p_visitor, ''));
  v_limit   text;
  v_msg     text := replace(gen_random_uuid()::text, '-', '');
  v_command uuid;
  v_queued  jsonb;
begin
  perform app.require_office(p_office);
  -- Only a guest, only in a sample office, only as that office's own guest. Anything else is not this function's.
  if not exists (select 1 from public.offices o where o.office_id = p_office and o.kind = 'sample')
     or app.principal_kind(v_by) is distinct from 'guest'
     or app.office_actor(p_office) is distinct from v_by then
    return jsonb_build_object('ok', false, 'error', 'This is only for the sample office.');
  end if;
  if v_visitor !~ '^[a-z0-9]{20,64}$' then
    return jsonb_build_object('ok', false, 'error', 'I could not tell which visitor this is, so nothing was asked.');
  end if;
  if p_project_id is null
     or not exists (select 1 from public.projects where project_id = p_project_id and office_id = p_office and status = 'active') then
    return jsonb_build_object('ok', false, 'error', 'no such project');
  end if;
  if v_said is null then
    return jsonb_build_object('ok', false, 'error', 'there is nothing to say');
  end if;
  if length(v_said) > 600 then
    return jsonb_build_object('ok', false, 'error', 'That is a long question for a sample. Keep it under 600 characters.');
  end if;
  v_limit := app.guest_allow(p_office, v_visitor);
  if v_limit is not null then
    return jsonb_build_object('ok', false, 'error', v_limit, 'limited', true);
  end if;

  -- The chat is the part of origin_ref before the colon (app.conversation_before threads on it), so a visitor's turns
  -- thread only with that visitor's own.
  insert into public.inbound_commands
    (office_id, origin_channel, origin_ref, actor, instruction, dedupe_key, project_id, context)
  values (p_office, 'teamhq', 'guest-' || v_visitor || ':' || v_msg, v_by, v_said,
          'teamhq:message:' || v_msg, p_project_id,
          jsonb_build_object('project_id', p_project_id, 'visitor', v_visitor))
  returning command_id into v_command;

  v_queued := app.enqueue_inbound(v_command);
  return jsonb_build_object('ok', true, 'command', v_command, 'job', v_queued ->> 'job_id', 'project', p_project_id);
end
$function$;

-- 8. Reading only your own thread ------------------------------------------------------------------------------------------
create or replace function app.sample_conversation(p_office uuid, p_project_id uuid, p_visitor text, p_limit integer default 50)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_visitor text := btrim(coalesce(p_visitor, ''));
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.offices o where o.office_id = p_office and o.kind = 'sample')
     or v_visitor !~ '^[a-z0-9]{20,64}$'
     or not exists (select 1 from public.projects pj where pj.project_id = p_project_id and pj.office_id = p_office) then
    return '[]'::jsonb;
  end if;
  return (
    with bounded as (select greatest(1, least(coalesce(p_limit, 50), 100)) as n),
    mine as (
      select c.command_id, c.job_id, c.received_at, c.instruction
        from public.inbound_commands c
       where c.office_id = p_office and c.project_id = p_project_id and c.context ->> 'visitor' = v_visitor
    ),
    said as (
      select m.received_at as at,
             jsonb_build_object('message_id', m.command_id, 'kind', 'said', 'at', m.received_at,
                                'from', app.office_actor(p_office), 'name', 'You', 'body', m.instruction,
                                'surface', 'teamhq') as v
        from mine m
    ),
    answered as (
      select o.created_at as at,
             jsonb_build_object('message_id', o.output_id, 'kind', 'answered', 'at', o.created_at,
                                'from', coalesce(s.slug, 'the-office'), 'name', coalesce(s.name, 'The team'),
                                'body', o.body, 'confidence', o.confidence::text, 'evidence', o.evidence::text,
                                'deterministic', o.deterministic, 'job', o.job_id) as v
        from public.outputs o
        join public.jobs j on j.job_id = o.job_id
        left join public.staff s on s.staff_id = o.staff_id
       where j.office_id = p_office
         and coalesce(j.root_job_id, j.job_id) in (select m.job_id from mine m where m.job_id is not null)
    ),
    recent as (
      select at, v from (select at, v from said union all select at, v from answered) both_sides
       order by at desc limit (select n from bounded)
    )
    select coalesce(jsonb_agg(r.v order by r.at), '[]'::jsonb) from recent r
  );
end
$function$;

-- 9. Whom the page may sign in as a visitor --------------------------------------------------------------------------------
-- The one address a visitor session is minted for: the active Sample Office's login, and only while it is sealed (its
-- member is a guest). While it is open for seeding (a person), nobody can enter.
create or replace function app.sample_login()
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    (select jsonb_build_object('ok', true, 'email', lower(u.email), 'office_id', o.office_id)
       from public.offices o
       join auth.users u on u.id = o.auth_user_id
       join public.office_members m on lower(m.email) = lower(u.email)
      where o.kind = 'sample' and o.state = 'active' and m.kind = 'guest'
      order by o.created_at
      limit 1),
    jsonb_build_object('ok', false))
$function$;

-- 10. Making one, and sealing it -------------------------------------------------------------------------------------------
-- Operator tooling (the Management API, as postgres); no browser role can reach either. The office starts OPEN (its
-- member is a person) so the seed can write through the gateway as that person; sealing flips the member to a guest and
-- narrows what its team may do to reading.
create or replace function app.provision_sample_office(p_name text, p_email text, p_owner_key text)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_auth uuid;
  v_office uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_key text := nullif(btrim(coalesce(p_owner_key, '')), '');
begin
  if btrim(coalesce(p_name, '')) = '' or v_email = '' or v_key is null then
    raise exception 'provision_sample_office: a name, an email and an owner key are all needed';
  end if;
  if exists (select 1 from public.offices where kind = 'sample' and state = 'active') then
    raise exception 'provision_sample_office: there is already an active sample office';
  end if;
  select u.id into v_auth from auth.users u where lower(u.email) = v_email;
  if v_auth is null then
    raise exception 'provision_sample_office: there is no login for that email (create the auth user first)';
  end if;
  if exists (select 1 from public.offices o where o.auth_user_id = v_auth)
     or exists (select 1 from public.office_members m where lower(m.email) = v_email or m.owner_key = v_key) then
    raise exception 'provision_sample_office: that login or owner key already belongs to an office';
  end if;
  insert into public.office_members (email, owner_key, kind, note)
  values (v_email, v_key, 'person', 'the public sample office (open for seeding)');
  insert into public.offices (kind, name, auth_user_id) values ('sample', btrim(p_name), v_auth)
  returning office_id into v_office;
  -- Reading is all the Sample Office's team may do, now and after sealing.
  insert into public.staff_tools (office_id, staff_slug, tool, granted_by, note)
  select v_office, s.slug, 'db.read', 'provision_sample_office', 'the sample office reads and never writes'
    from public.staff s
   where s.active and s.permanent and not s.is_fixture
     and exists (select 1 from public.tool_permissions tp where tp.tool = 'db.read' and tp.enabled)
  on conflict do nothing;
  perform app.unnamed_project(v_office);
  return jsonb_build_object('ok', true, 'office_id', v_office, 'auth_user_id', v_auth, 'owner_key', v_key);
end
$function$;

create or replace function app.sample_office_open(p_office uuid, p_open boolean)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_n int;
begin
  if not exists (select 1 from public.offices o where o.office_id = p_office and o.kind = 'sample') then
    raise exception 'sample_office_open: that is not a sample office';
  end if;
  update public.office_members m
     set kind = case when p_open then 'person' else 'guest' end
   where lower(m.email) = (select lower(u.email) from public.offices o join auth.users u on u.id = o.auth_user_id
                            where o.office_id = p_office);
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'sample_office_open: expected one member, changed %', v_n;
  end if;
  return jsonb_build_object('ok', true, 'office_id', p_office, 'open', p_open);
end
$function$;

-- 11. The doors ---------------------------------------------------------------------------------------------------------------
create or replace function public.sample_say(p_office uuid, p_project_id uuid, p_text text, p_visitor text, p_by text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.sample_say(p_office, p_project_id, p_text, p_visitor, p_by) $f$;

create or replace function public.sample_conversation(p_office uuid, p_project_id uuid, p_visitor text, p_limit integer default 50)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.sample_conversation(p_office, p_project_id, p_visitor, p_limit) $f$;

create or replace function public.sample_login()
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.sample_login() $f$;

revoke all on function app.guest_allow(uuid, text), app.sample_say(uuid, uuid, text, text, text),
  app.sample_conversation(uuid, uuid, text, integer), app.sample_login(),
  app.provision_sample_office(text, text, text), app.sample_office_open(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.sample_say(uuid, uuid, text, text, text),
  public.sample_conversation(uuid, uuid, text, integer), public.sample_login()
  from public, anon, authenticated;
grant execute on function public.sample_say(uuid, uuid, text, text, text),
  public.sample_conversation(uuid, uuid, text, integer), public.sample_login() to service_role;

-- A rollback note: the functions above are additive. Rolling back is dropping them, restoring the previous definitions of
-- principal_kind, authority_refusal, harness_job and conversation_history, and narrowing the member kind constraint after
-- deleting any guest member. The gateway and signin function must be rolled back FIRST (they call these).

commit;
