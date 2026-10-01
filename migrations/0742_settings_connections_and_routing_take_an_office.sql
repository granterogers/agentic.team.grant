-- 0742 - settings, connections, routing and the trigger board take an office (multi-user P3, cluster d).
--
-- Two kinds of row meet in these functions and they are scoped differently, on purpose:
--
--   * rows that are a PERSON's (autonomy dial, appearance, the people on a project's tasks, standing yeses, the office
--     chat, mail and calendar counts, event triggers) - `office_id = p_office`, nothing else.
--   * rows that are the DEPLOYMENT's (a duty such as the nightly backup, the Slack app registration, the health of a
--     shared credential) - these belong to the system office, so they are `office_id = any (app.office_scope(p_office))`:
--     visible to an office whose person is a deployment operator (0647) and to nobody else. The gateway already refuses
--     the OPERATOR_ONLY actions to anyone else; this is the same line drawn again where the data is.
--
-- Deployment SETTINGS (public.system_config, the vault, public.telegram_bots) have no owner and are not an office's to
-- scope - they stay as they were. What these functions now guarantee is that the per-office tables they read and write are
-- only ever the caller's (or, for an operator, the deployment's).
--
-- The six functions that change something the whole deployment shares - hq_disconnect, hq_forget_google,
-- hq_set_slack_credentials, hq_set_vikunja, hq_forget_vikunja, hq_routing_set - are on the gateway's OPERATOR_ONLY list and
-- now ask app.operator_refusal(p_office) themselves, so the SQL says no to a person who is not the operator even if the
-- gateway were reached around. Vault entries and system_config are deployment-owned and are not scoped by office.


create function app.hq_office_chat(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
with room as (
    select c.chat_id, max(c.title) as title, count(*)::int as bots_present
      from public.telegram_chats c
      join public.telegram_bots b on b.bot_id = c.bot_id and b.enabled
     where c.office_id = p_office and c.chat_type in ('group', 'supergroup')
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
             where c.office_id = p_office and c.bot_id = b.bot_id
               and c.chat_id = (select chat_id from room))),
      '[]'::jsonb),
    'direct_to_grant', coalesce(
      (select value #>> '{}' from public.system_config where key = 'telegram.direct_to_grant'), '')
  )
  );
end;
$function$;
revoke all on function app.hq_office_chat(uuid) from public, anon, authenticated, service_role;
drop function app.hq_office_chat();

create function app.mail_bodies_held(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select jsonb_build_object(
           'messages', count(*),
           'with_body', count(*) filter (where body is not null),
           'withheld_as_bulk', count(*) filter (where body_withheld = 'bulk'),
           'no_text_part', count(*) filter (where body_withheld = 'no text part'),
           'never_looked', count(*) filter (where body is null and body_withheld is null))
    from public.mail_messages
   where office_id = p_office and vanished_at is null
  );
end;
$function$;
revoke all on function app.mail_bodies_held(uuid) from public, anon, authenticated, service_role;
drop function app.mail_bodies_held();

create function app.hq_slack_setup(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(
    (select jsonb_build_object(
       'app_id', c.slack_app_id,
       'enabled', c.enabled,
       -- Both halves, deliberately. A bot token without a signing secret can
       -- post and cannot verify anything inbound, which reads as connected
       -- and is half a connection (0356 takes them together for this reason).
       'has_bot_token', exists (select 1 from vault.secrets s where s.id = c.bot_token_ref),
       'has_signing_secret', exists (select 1 from vault.secrets s where s.id = c.signing_secret_ref),
       'ready', c.enabled
                and exists (select 1 from vault.secrets s where s.id = c.bot_token_ref)
                and exists (select 1 from vault.secrets s where s.id = c.signing_secret_ref),
       'why_off', c.disabled_reason)
       from public.slack_app_credentials c where c.office_id = any (app.office_scope(p_office)) limit 1),
    jsonb_build_object('ready', false, 'has_bot_token', false,
      'has_signing_secret', false, 'why_off', 'no Slack app is registered here'))
  );
end;
$function$;
revoke all on function app.hq_slack_setup(uuid) from public, anon, authenticated, service_role;
drop function app.hq_slack_setup();

create function app.hq_setup_services(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
with svc as (
    select
      1 as ord, 'database' as key, 'Database' as name, 'Supabase Postgres' as vendor,
      'ready' as state,
      'Everything the team knows and everything it has done. The single source of truth.' as does,
      format('%s, %s', (select value #>> '{}' from public.system_config where key = 'db.project_ref'),
                       (select value #>> '{}' from public.system_config where key = 'db.region')) as detail,
      null::text as action, null::text as href

    union all
    select 2, 'inference', 'The team''s thinking', 'OpenRouter',
      case when exists (select 1 from public.providers p
                         where p.provider = 'openrouter' and p.secret_ref is not null)
           then 'ready' else 'action' end,
      'The models the team writes with. Free ones are used first; a paid one only when nothing free can do the job.',
      coalesce((select count(*)::text || ' usable model(s)' from public.usable_models), 'none'),
      case when exists (select 1 from public.providers p
                         where p.provider = 'openrouter' and p.secret_ref is not null)
           then null else 'Add an OpenRouter key' end,
      'https://openrouter.ai/settings/keys'

    union all
    select 3, 'slack', 'The office', 'Slack',
      case when exists (select 1 from public.slack_app_credentials
                         where office_id = any (app.office_scope(p_office)) and enabled and revoked_at is null)
           then 'ready' else 'action' end,
      'Where the team works. Results arrive in the project channel, presented as the person who produced them, with buttons you can press.',
      coalesce((select count(*)::text || ' channel(s)' from public.slack_channel_map cm
                  join public.slack_workspaces sw on sw.team_id = cm.team_id and sw.office_id = any (app.office_scope(p_office))
                 where cm.active), '0'),
      case when exists (select 1 from public.slack_app_credentials
                         where office_id = any (app.office_scope(p_office)) and enabled and revoked_at is null)
           then null else 'Install the Slack app' end,
      'https://api.slack.com/apps'

    union all
    select 4, 'telegram', 'The pager', 'Telegram',
      case when (select count(*) from public.telegram_bots where enabled and token_ref is not null) >= 1
           then 'ready' else 'action' end,
      'Eight bots, one per person, in your pocket. Send a voice note or a link and it becomes work.',
      (select count(*)::text || ' of ' || count(*) filter (where expected)::text || ' bot(s) ready'
         from public.telegram_bots where expected),
      case when (select count(*) from public.telegram_bots where enabled and token_ref is not null) >= 1
           then null else 'Create bots with BotFather' end,
      'https://t.me/BotFather'

    union all
    select 5, 'notion', 'Your own notes', 'Notion',
      case
        when not exists (select 1 from vault.secrets where name = 'notion.integration_token')
          then 'action'
        when not exists (
          select 1 from public.documents d join public.projects p using (project_id)
           where d.office_id = p_office and d.connector = 'notion' and p.status = 'active')
          then 'action'
        else 'ready'
      end,
      'Pages you share with the integration become part of what the team can read and cite.',
      -- Live projects only. The count was including documents on projects
      -- archived days ago, on a page whose job is to say what is true now.
      coalesce((select count(*)::text || ' page(s) synced'
                  from public.documents d join public.projects p using (project_id)
                 where d.office_id = p_office and d.connector = 'notion' and p.status = 'active'), '0'),
      case
        when not exists (select 1 from vault.secrets where name = 'notion.integration_token')
          then 'Add a Notion integration token'
        else 'Share a page with the integration'
      end,
      'https://www.notion.so/profile/integrations'

    union all
    select 6, 'google', 'Google account', 'Google',
      case
        when coalesce((select value #>> '{}' from public.system_config
                        where key = 'google.client_id'), '') = ''
          then 'action'
        when not exists (select 1 from vault.secrets where name = 'google.refresh_token')
          then 'action'
        else 'ready'
      end,
      'Signing in once lets the team read your calendar, and later your mail and files. Nothing is read until you switch that service on.',
      case
        when exists (select 1 from vault.secrets where name = 'google.refresh_token')
          then 'signed in'
        else 'not signed in'
      end,
      case
        when coalesce((select value #>> '{}' from public.system_config
                        where key = 'google.client_id'), '') = ''
          then 'Set up Google sign-in (once)'
        when not exists (select 1 from vault.secrets where name = 'google.refresh_token')
          then 'Sign in with Google'
        else null
      end,
      null

    union all
    select 7, 'calendar', 'Calendar', 'Google',
      case
        when not exists (select 1 from vault.secrets where name = 'google.refresh_token') then 'off'
        when coalesce((select value::text::boolean from public.system_config
                        where key = 'calendar.enabled'), false) then 'ready'
        else 'off'
      end,
      'Your diary, so the team can answer what you have on without asking you.',
      coalesce((select count(*)::text || ' event(s) cached' from public.calendar_events where office_id = p_office), '0'),
      null, null

    union all
    -- Mail. Same three states as the calendar, and for the same reason: §17
    -- separates "connected" from "switched on", so a service Grant turned off
    -- must read as off rather than as an outstanding task.
    select 7, 'gmail', 'Mail', 'Gmail',
      case
        when not exists (select 1 from vault.secrets where name = 'google.refresh_token') then 'off'
        when coalesce((select value::text::boolean from public.system_config
                        where key = 'gmail.enabled'), false) then 'ready'
        else 'off'
      end,
      'Your inbox, so the team can answer who has been in touch and about what. '
      'Headers and a preview only — never the body of a message, never attachments.',
      coalesce((select count(*)::text || ' message(s) cached'
                  from public.mail_messages where office_id = p_office and vanished_at is null), '0'),
      null, null

    union all
    select 8, 'notebook', 'Notebooks', 'Google NotebookLM',
      case
        when not exists (select 1 from vault.secrets where name = 'notebook.storage_state')
          then 'action'
        when coalesce((select value::text::boolean from public.system_config
                        where key = 'notebook.enabled'), false) then 'ready'
        else 'off'
      end,
      'Audio overviews, mind maps and briefings, made from the sources in a project. Every generation asks you first.',
      coalesce((select count(*)::text || ' notebook(s) attached'
                  from public.project_attachments a join public.projects p using (project_id)
                 where p.office_id = p_office and a.connector = 'notebooklm' and a.enabled and p.status = 'active'), '0'),
      case when exists (select 1 from vault.secrets where name = 'notebook.storage_state')
           then null else 'Connect a NotebookLM session' end,
      null

    union all
    select 9, 'backup', 'Backups', 'Supabase Storage',
      -- The DUTY and its last run, not a credential sitting in the vault.
      -- The row this replaces checked for a Backblaze bucket key that has
      -- nothing to do with any backup this system takes, and read "ready"
      -- because the key was still there long after the thing that used it
      -- stopped existing.
      case
        when not exists (select 1 from public.responsibilities
                          where office_id = any (app.office_scope(p_office)) and slug = 'nightly-backup' and enabled) then 'off'
        when (select last_run_at from public.responsibilities where office_id = any (app.office_scope(p_office)) and slug = 'nightly-backup')
             > app.now_utc() - interval '48 hours' then 'ready'
        else 'action'
      end,
      'A copy of everything every night, and a restore rehearsed from it. Holds no '
      'credentials, and lives in this same Supabase project — so it survives losing '
      'the code or a laptop, and not losing the project.',
      coalesce(
        (select case
           when r.last_run_at is null then 'enabled, not run yet'
           else format('last taken %s', app.ago(r.last_run_at))
         end
         from public.responsibilities r where r.office_id = any (app.office_scope(p_office)) and r.slug = 'nightly-backup'),
        'no backup duty'),
      case
        when (select last_run_at from public.responsibilities where office_id = any (app.office_scope(p_office)) and slug = 'nightly-backup')
             > app.now_utc() - interval '48 hours' then null
        else 'Take one now'
      end,
      null

    union all
    -- 0142: the office group. A Telegram bot cannot create one, so this row is
    -- the only place the instruction can live where Grant will find it again.
    select 12, 'office_group', 'The team''s group chat', 'Telegram',
      case when (app.hq_office_chat(p_office) ->> 'exists')::boolean then 'ready' else 'action' end,
      'One room where the whole team posts, so only the Chief of Staff messages '
      'you directly.',
      case when (app.hq_office_chat(p_office) ->> 'exists')::boolean
        then format('%s of %s bots are in %s',
                    app.hq_office_chat(p_office) ->> 'bots_present',
                    app.hq_office_chat(p_office) ->> 'bots_expected',
                    coalesce(app.hq_office_chat(p_office) ->> 'title', 'the group'))
        else 'Telegram will not let a bot create a group, so this one is yours to make: '
             'new group, add all eight bots, call it AI Team HQ. They register themselves.'
      end,
      case when (app.hq_office_chat(p_office) ->> 'exists')::boolean then null
        else 'Make the group' end,
      case when (app.hq_office_chat(p_office) ->> 'exists')::boolean then null
        else 'https://web.telegram.org/a/' end

  )
  select jsonb_build_object(
    'generated_at', app.now_utc(),
    'ready', (select count(*) from svc where state = 'ready'),
    'needs_you', (select count(*) from svc where state = 'action'),
    'services', (select jsonb_agg(row_to_json(s) order by s.ord) from svc s)
  )
  );
end;
$function$;
revoke all on function app.hq_setup_services(uuid) from public, anon, authenticated, service_role;
drop function app.hq_setup_services();

create function app.google_revoke_begin(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_token text;
  v_job   uuid;
  v_old   uuid;
begin
  perform app.require_office(p_office);
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'google.refresh_token';

  if v_token is null or btrim(v_token) = '' then
    return jsonb_build_object('parked', false, 'job_id', null);
  end if;

  -- Overwrite rather than accumulate: a second Disconnect before the first
  -- revoke has run must not leave two live tokens parked.
  select id into v_old from vault.secrets where name = 'google.revoking_refresh_token';
  if v_old is null then
    perform vault.create_secret(v_token, 'google.revoking_refresh_token',
      'A Google refresh token awaiting revocation at Google (#109). Deleted by '
      || 'app.google_revoke_finish whether the revoke succeeds or fails.');
  else
    perform vault.update_secret(v_old, v_token, 'google.revoking_refresh_token');
  end if;

  -- The office's copy goes NOW. `app.vault_secret` refuses any name outside
  -- its list and `googleAccess` asks for this one, so from this statement on
  -- nothing in the office can use the credential.
  delete from vault.secrets where name = 'google.refresh_token';

  insert into public.jobs
    (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority)
  values (p_office, gen_random_uuid(), null,
          format('google-revoke-%s', gen_random_uuid()),
          'google.revoke', app.office_actor(p_office), 400)
  returning job_id into v_job;

  return jsonb_build_object('parked', true, 'job_id', v_job);
end;
$function$;
revoke all on function app.google_revoke_begin(uuid) from public, anon, authenticated, service_role;
drop function app.google_revoke_begin();

create function app.task_provider_forget(p_office uuid, p_provider text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_links int;
  v_tasks int;
begin
  perform app.require_office(p_office);
  select count(*)::int into v_links
    from public.task_links l join public.tasks t on t.task_id = l.task_id and t.office_id = p_office
   where l.provider = p_provider;
  delete from public.task_links l using public.tasks t
   where t.task_id = l.task_id and t.office_id = p_office and l.provider = p_provider;
  update public.task_tombstones
     set links = coalesce((select jsonb_agg(e) from jsonb_array_elements(links) e
                            where e ->> 'provider' <> p_provider), '[]'::jsonb)
   where office_id = p_office;
  update public.task_tombstones set cleared_at = app.now_utc()
   where office_id = p_office and cleared_at is null and links = '[]'::jsonb;
  select count(*)::int into v_tasks from public.tasks where office_id = p_office and assigned_to_human;
  return jsonb_build_object('ok', true, 'links_removed', v_links, 'tasks_kept', v_tasks);
end
$function$;
revoke all on function app.task_provider_forget(uuid, text) from public, anon, authenticated, service_role;
drop function app.task_provider_forget(text);

create function app.hq_routing(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select jsonb_build_object(
    'direct_to_grant',
      coalesce((select value #>> '{}' from public.system_config
                 where key = 'telegram.direct_to_grant'), ''),
    'only_chief_speaks',
      coalesce((select (value #>> '{}')::boolean from public.system_config
                 where key = 'telegram.only_chief_speaks'), false),
    'pager_floor',
      coalesce((select value #>> '{}' from public.system_config
                 where key = 'telegram.pager_floor'), 'routine'),
    'office_group', app.hq_office_chat(p_office),
    'people', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'slug', s.slug, 'name', s.name, 'title', s.title,
               'bot', (select b.username from public.telegram_bots b
                        where b.staff_slug = s.slug limit 1))
             order by s.name), '[]'::jsonb)
        from public.staff s where s.active
    ),
    'duties', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'slug', r.slug, 'description', r.description,
               'enabled', r.enabled, 'every_minutes', r.period_minutes,
               'last_run_at', r.last_run_at)
             order by r.slug), '[]'::jsonb)
        from public.responsibilities r
       where r.office_id = any (app.office_scope(p_office))
    )
  )
  );
end;
$function$;
revoke all on function app.hq_routing(uuid) from public, anon, authenticated, service_role;
create function public.hq_routing(p_office uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_routing(p_office) $f$;
revoke all on function public.hq_routing(uuid) from public, anon, authenticated;
grant execute on function public.hq_routing(uuid) to service_role;
-- the legacy forms: no caller names them any more.
drop function public.hq_routing();
drop function app.hq_routing();

create function app.hq_routing_set(p_office uuid, p_what text, p_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_floor text;
begin
  perform app.require_office(p_office);
  if app.operator_refusal(p_office) is not null then
    return jsonb_build_object('error', app.operator_refusal(p_office));
  end if;
  if p_what = 'direct_to_grant' then
    if p_value <> '' and not exists (
      select 1 from public.staff where slug = p_value and active
    ) then
      return jsonb_build_object('error', format('no active staff member "%s"', p_value));
    end if;
    update public.system_config set value = to_jsonb(p_value)
     where key = 'telegram.direct_to_grant';
    return jsonb_build_object('ok', true, 'direct_to_grant', p_value);

  elsif p_what = 'only_chief_speaks' then
    -- The work is unaffected either way. This is about who sends.
    update public.system_config
       set value = to_jsonb(lower(trim(p_value)) in ('true', 'on', 'yes', '1'))
     where key = 'telegram.only_chief_speaks';
    return jsonb_build_object(
      'ok', true,
      'only_chief_speaks', lower(trim(p_value)) in ('true', 'on', 'yes', '1')
    );

  elsif p_what = 'pager_floor' then
    v_floor := lower(trim(p_value));
    if v_floor not in ('trivial', 'routine', 'important', 'urgent', 'blocker') then
      return jsonb_build_object('error', format('"%s" is not a severity', p_value));
    end if;
    update public.system_config set value = to_jsonb(v_floor)
     where key = 'telegram.pager_floor';
    return jsonb_build_object('ok', true, 'pager_floor', v_floor);

  elsif p_what like 'duty:%' then
    if not exists (select 1 from public.responsibilities where office_id = any (app.office_scope(p_office)) and slug = substring(p_what from 6)) then
      return jsonb_build_object('error', format('no duty "%s"', substring(p_what from 6)));
    end if;
    update public.responsibilities
       set enabled = (lower(trim(p_value)) in ('on', 'true', 'yes', '1')),
           updated_at = app.now_utc()
     where office_id = any (app.office_scope(p_office)) and slug = substring(p_what from 6);
    return jsonb_build_object('ok', true, p_what, p_value);
  end if;

  return jsonb_build_object('error', format('"%s" is not a routing setting', p_what));
end;
$function$;
revoke all on function app.hq_routing_set(uuid, text, text) from public, anon, authenticated, service_role;
create function public.hq_routing_set(p_office uuid, p_what text, p_value text)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_routing_set(p_office, p_what, p_value) $f$;
revoke all on function public.hq_routing_set(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_routing_set(uuid, text, text) to service_role;
-- the legacy forms: no caller names them any more.
drop function public.hq_routing_set(text, text);
drop function app.hq_routing_set(text, text);

create function app.hq_set_vikunja(p_office uuid, p_base_url text, p_project_id integer, p_api_token text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url  text := regexp_replace(coalesce(p_base_url, ''), '[\s​-‏﻿]', '', 'g');
  v_tok  text := regexp_replace(coalesce(p_api_token, ''), '[\s​-‏﻿]', '', 'g');
  v_said jsonb;
  v_auth jsonb;
begin
  perform app.require_office(p_office);
  if app.operator_refusal(p_office) is not null then
    return jsonb_build_object('error', app.operator_refusal(p_office));
  end if;
  if btrim(coalesce(p_by, '')) <> '' and app.principal_kind(p_by) <> 'person' then
    return jsonb_build_object('error', 'only a person connects a task board');
  end if;
  if v_url = '' or v_tok = '' then
    return jsonb_build_object('error',
      'Vikunja needs its address and an API token. Settings - API tokens, in Vikunja.');
  end if;
  if v_url ~* '^(tk_|xox[abposr]-|ghp_|github_pat_|sk-|AKIA|glpat-)' then
    return jsonb_build_object('error',
      'that looks like a credential rather than an address - the token goes in the other box');
  end if;
  if v_url !~* '^https?://' then
    return jsonb_build_object('error',
      'the address needs to start http:// or https:// - for example https://tasks.example.com');
  end if;
  if v_tok !~* '^tk_' then
    return jsonb_build_object('error',
      'that does not look like a Vikunja API token - they start tk_');
  end if;
  if coalesce(p_project_id, 0) < 1 then
    return jsonb_build_object('error',
      'which Vikunja project should the office keep in step? Its id is in the URL when you open it.');
  end if;

  v_url := regexp_replace(v_url, '/+$', '');

  /*
    THE ANSWER IS READ, not discarded. `perform` threw away a refusal and let
    this function report success about nothing at all.
  */
  v_said := app.hq_set_setting('vikunja.base_url', v_url);
  if v_said ? 'error' then return v_said; end if;
  v_said := app.hq_set_setting('vikunja.project_id', p_project_id::text);
  if v_said ? 'error' then return v_said; end if;
  perform app.store_secret('vikunja.api_token', v_tok,
    'The Vikunja API token the task sync uses. #259 Phase 2.');

  /* AND READ BACK, because two writes that both said ok can still leave the
     office unable to answer "am I connected". */
  if (app.vikunja_settings() ->> 'configured')::boolean is not true then
    return jsonb_build_object('error',
      'the address and token were accepted but the office cannot read them back');
  end if;

  update public.responsibilities set enabled = true where office_id = any (app.office_scope(p_office)) and job_kind = 'tasks.sync';
  -- The connection IS the yes: create and update on THIS board may proceed without asking; delete never can.
  v_auth := case when btrim(coalesce(p_by, '')) = '' then null
    else app.record_destination_authority(p_office, 'task.board.write', null,
           format('vikunja:%s#%s', v_url, p_project_id), p_by, null, 'the task board you connected', true) end;

  return jsonb_build_object('ok', true, 'url', v_url, 'project', p_project_id,
    'authorised', coalesce((v_auth ->> 'ok')::boolean, false),
    'note', 'the office will keep your tasks in step from now on');
end;
$function$;
revoke all on function app.hq_set_vikunja(uuid, text, integer, text, text) from public, anon, authenticated, service_role;
create function public.hq_set_vikunja(p_office uuid, p_base_url text, p_project_id integer, p_api_token text, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$ select app.hq_set_vikunja(p_office, p_base_url, p_project_id, p_api_token, p_by) $f$;
revoke all on function public.hq_set_vikunja(uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.hq_set_vikunja(uuid, text, integer, text, text) to service_role;
-- the legacy forms: no caller names them any more.
drop function public.hq_set_vikunja(text, integer, text, text);
drop function app.hq_set_vikunja(text, integer, text, text);

create function app.hq_forget_vikunja(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kept    int;
  v_links   int;
  v_secrets int;
begin
  perform app.require_office(p_office);
  if app.operator_refusal(p_office) is not null then
    return jsonb_build_object('error', app.operator_refusal(p_office));
  end if;
  select count(*)::int into v_kept from public.tasks
   where office_id = p_office and assigned_to_human and not coalesce(is_fixture, false);
  select count(*)::int into v_links
    from public.task_links l join public.tasks t on t.task_id = l.task_id and t.office_id = p_office
   where l.provider = 'vikunja';

  perform app.task_provider_forget(p_office, 'vikunja');
  delete from public.system_config where key in ('vikunja.base_url', 'vikunja.project_id');

  select count(*)::int into v_secrets from vault.secrets where name = 'vikunja.api_token';
  /* The Vault is a TABLE for removal. There is no `delete_secret`. */
  delete from vault.secrets where name = 'vikunja.api_token';

  update public.responsibilities set enabled = false where office_id = any (app.office_scope(p_office)) and job_kind = 'tasks.sync';
  update public.standing_authorizations
     set revoked_at = app.now_utc(), revoked_reason = 'the task board was disconnected'
   where office_id = p_office and tool = 'task.board.write' and revoked_at is null;

  return jsonb_build_object('ok', true,
    'tasks_kept', v_kept, 'links_removed', v_links, 'credential_removed', v_secrets > 0,
    'note', 'every task is still here - Vikunja was a projection, never the list');
end;
$function$;
revoke all on function app.hq_forget_vikunja(uuid) from public, anon, authenticated, service_role;
create function public.hq_forget_vikunja(p_office uuid)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$ select app.hq_forget_vikunja(p_office) $f$;
revoke all on function public.hq_forget_vikunja(uuid) from public, anon, authenticated;
grant execute on function public.hq_forget_vikunja(uuid) to service_role;
-- the legacy forms: no caller names them any more.
drop function public.hq_forget_vikunja();
drop function app.hq_forget_vikunja();

create function app.hq_forget_google(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_started jsonb;
begin
  perform app.require_office(p_office);
  if app.operator_refusal(p_office) is not null then
    return jsonb_build_object('error', app.operator_refusal(p_office));
  end if;
  -- Parks the token and enqueues the revoke. Returns parked=false when there
  -- was nothing stored, which is not an error: signing out twice is allowed.
  v_started := app.google_revoke_begin(p_office);

  delete from public.system_config where key = 'google.granted_scopes';

  -- Everything that reads Google goes off with it. Leaving `calendar.enabled`
  -- true would mean an hourly duty failing forever against a credential that
  -- was deliberately removed, and a red light he caused and cannot explain.
  update public.system_config set value = to_jsonb(false) where key = 'calendar.enabled';

  update public.connection_health
     set state = 'missing',
         detail = case when (v_started->>'parked')::boolean
           then 'signed out at your request; revoking at Google'
           else 'signed out at your request' end,
         action = 'Sign in with Google on the Set up page',
         checked_at = app.now_utc()
   where office_id = any (app.office_scope(p_office)) and service = 'google_calendar';

  return jsonb_build_object('ok', true, 'revoking', coalesce((v_started->>'parked')::boolean, false),
                            'job_id', v_started->>'job_id');
end;
$function$;
revoke all on function app.hq_forget_google(uuid) from public, anon, authenticated, service_role;
create function public.hq_forget_google(p_office uuid)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_forget_google(p_office) $f$;
revoke all on function public.hq_forget_google(uuid) from public, anon, authenticated;
grant execute on function public.hq_forget_google(uuid) to service_role;
-- the legacy forms: no caller names them any more.
drop function public.hq_forget_google();
drop function app.hq_forget_google();

create function app.hq_disconnect(p_office uuid, p_service text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_key     text := lower(btrim(coalesce(p_service, '')));
  v_gone    int  := 0;
  v_had     boolean;
begin
  perform app.require_office(p_office);
  if app.operator_refusal(p_office) is not null then
    return jsonb_build_object('error', app.operator_refusal(p_office));
  end if;
  -- The Google family is one consent behind three services, so any of them
  -- disconnects the account. 0112 already does the work correctly; calling it
  -- rather than repeating it means there is one description of what signing
  -- out of Google means.
  if v_key in ('google', 'drive', 'calendar', 'gmail') then
    select exists (select 1 from vault.secrets where name = 'google.refresh_token')
      into v_had;
    if not v_had then
      return jsonb_build_object('ok', true, 'service', 'Google', 'removed', 0,
        'note', 'Google was already signed out here -- nothing to remove.',
        'revoke_at', 'https://myaccount.google.com/permissions');
    end if;
    perform app.hq_forget_google(p_office);
    return jsonb_build_object('ok', true, 'service', 'Google', 'removed', 1,
      'note', 'Signed out. Calendar reading is off and the refresh token is deleted. '
              || 'The client id and secret stay -- they are the registration, not the consent, '
              || 'so signing in again does not need the console step.',
      'revoke_at', 'https://myaccount.google.com/permissions');
  end if;

  if v_key = 'notion' then
    delete from vault.secrets where name = 'notion.integration_token';
    get diagnostics v_gone = row_count;
    if v_gone = 0 then
      return jsonb_build_object('ok', true, 'service', 'Notion', 'removed', 0,
        'note', 'There was no Notion token here to remove.',
        'revoke_at', 'https://www.notion.so/profile/integrations');
    end if;
    update public.connection_health
       set state = 'missing',
           detail = 'disconnected at your request',
           action = 'Add a Notion integration token in Setting up',
           checked_at = app.now_utc()
     where office_id = any (app.office_scope(p_office)) and service = 'Notion';
    return jsonb_build_object('ok', true, 'service', 'Notion', 'removed', v_gone,
      'note', 'Disconnected. The office can no longer read Notion. '
              || 'Pages it already imported stay -- ADR-0013: a route may be closed and the corpus is kept.',
      'revoke_at', 'https://www.notion.so/profile/integrations');
  end if;

  if v_key in ('notebooklm', 'notebook') then
    delete from vault.secrets where name = 'notebook.storage_state';
    get diagnostics v_gone = row_count;
    -- Off as well as gone: a duty running hourly against a credential that was
    -- deliberately removed is a red light he caused and cannot explain.
    update public.system_config set value = to_jsonb(false) where key = 'notebook.enabled';
    return jsonb_build_object('ok', true, 'service', 'NotebookLM', 'removed', v_gone,
      'note', case when v_gone = 0
                then 'There was no NotebookLM session here to remove; generation is switched off.'
                else 'Disconnected and generation switched off. Notebooks already attached to a '
                     || 'dashboard project stay attached, and what they produced stays.' end,
      'revoke_at', 'https://notebooklm.google.com');
  end if;

  /*
    Slack (#198, #109).

    Everything of ours goes: the bot token and the short-lived config tokens.
    The office stops posting and stops reading within one worker pass, which is
    real and immediate and is the part a database can do.

    What it CANNOT do is revoke the token at Slack or uninstall the app, both
    of which need an outbound call or a person. So neither is claimed. The
    answer names `auth.revoke` because a future #109 needs the endpoint, and
    names the uninstall page because that is the step only Grant can take.
  */
  if v_key = 'slack' then
    delete from vault.secrets
     where name in ('slack.bot_token', 'slack.config_access_token',
                    'slack.config_refresh_token', 'slack.app_token',
                    'slack.signing_secret');
    get diagnostics v_gone = row_count;

    if v_gone = 0 then
      return jsonb_build_object(
        'ok', false, 'service', 'Slack', 'removed', 0,
        'error', 'Nothing was removed, so nothing was disconnected. There are no '
                 || 'Slack credentials in the vault to take away. The dashboard is '
                 || 'left alone deliberately: saying a credential is missing when it '
                 || 'is not is worse than failing to remove it.');
    end if;

    update public.connection_health
       set state = 'missing',
           detail = 'disconnected at your request',
           action = 'Reconnect in Setting up, or uninstall the app at Slack to finish it',
           checked_at = app.now_utc()
     where office_id = any (app.office_scope(p_office)) and service = 'Slack';

    return jsonb_build_object(
      'ok', true, 'service', 'Slack', 'removed', v_gone,
      'stopped', 'The office can no longer read or post in Slack. Every message '
                 || 'already there stays, and so does everything the office recorded from it '
                 || '-- losing a channel loses a surface, not the conversation.',
      /*
        Said plainly, because #109 is a real defect and shipping a Disconnect
        that implied otherwise would inherit it. This is the honest partial:
        it names what did not happen as clearly as what did.
      */
      'not_revoked', 'The token was deleted here, NOT revoked at Slack, and the app is '
                     || 'still installed in the workspace. Nothing can use the token now -- '
                     || 'it is gone -- but Slack has not been told to invalidate it.',
      'to_finish', jsonb_build_array(
        'Open https://api.slack.com/apps and choose Agentic Team Grant.',
        'Go to Settings, then Install App, and press Revoke All OAuth Tokens.',
        'To remove it from the workspace entirely: Settings, then Basic Information, '
          || 'then Delete App at the bottom.'
      ),
      'revoke_at', 'https://api.slack.com/apps',
      'note', 'Reconnecting means installing the app again and pasting a new bot token '
              || 'in Setting up. The channels the office made stay where they are.'
    );
  end if;

  /*
    Telegram (#198, #70).

    Grant, 13 September: "we don't need a different bot for each role. In fact,
    we only need the chief of staff." So this deletes the chief's token, which
    is the one that reaches him, and reports the staff bots separately rather
    than silently taking eight things away with one press.

    No API can revoke a Telegram bot token. Only BotFather's /revoke can, in a
    chat window, by a person. That is not a gap waiting for #109 to close --
    there is nothing to automate -- so the steps are given in full.
  */
  if v_key = 'telegram' then
    delete from vault.secrets s
     where s.id in (select b.token_ref from public.telegram_bots b
                     where b.staff_slug = 'chief-of-staff' and b.token_ref is not null)
        or s.name in ('telegram.bot_token', 'telegram.chief_bot_token',
                      'telegram.chief.bot_token');
    get diagnostics v_gone = row_count;

    if v_gone = 0 then
      return jsonb_build_object(
        'ok', false, 'service', 'Telegram', 'removed', 0,
        'error', 'Nothing was removed, so nothing was disconnected. There is no chief '
                 || 'bot token in the vault to take away. The dashboard is left alone '
                 || 'deliberately: saying a credential is missing when it is not is '
                 || 'worse than failing to remove it.');
    end if;

    update public.telegram_bots
       set enabled = false,
           token_ref = null,
           disabled_reason = 'disconnected at your request'
     where staff_slug = 'chief-of-staff';

    -- Off as well as gone, for 0112's reason: a duty polling a credential that
    -- was deliberately removed is a red light he caused and cannot explain.
    update public.system_config
       set value = to_jsonb(false)
     where key = 'telegram.enabled';

    update public.connection_health
       set state = 'missing',
           detail = 'disconnected at your request',
           action = 'Reconnect in Setting up with a bot token from BotFather',
           checked_at = app.now_utc()
     where office_id = any (app.office_scope(p_office)) and service = 'Telegram' and credential like '%chief%';

    return jsonb_build_object(
      'ok', true, 'service', 'Telegram', 'removed', v_gone,
      'stopped', 'The office can no longer send or receive on Telegram. Everything '
                 || 'already said there is kept and still in the conversation.',
      'not_revoked', 'Telegram has no API that revokes a bot token -- only BotFather can, '
                     || 'and only a person can ask it. The token is deleted here, so nothing '
                     || 'of ours can use it, but it is still a valid token until you revoke it.',
      'to_finish', jsonb_build_array(
        'Open Telegram and message @BotFather.',
        'Send /revoke and choose @agenticteamgrantbot.',
        'BotFather replies with a new token, which invalidates the old one. '
          || 'Paste the new one into Setting up if you want the office back on Telegram.'
      ),
      'revoke_at', 'https://t.me/BotFather',
      'note', 'The staff bots are separate and were NOT touched -- they are handed back '
              || 'one at a time in Settings, Channels. Issue #70 records the decision to '
              || 'retire them: Telegram is one bot, the chief of staff, and individual '
              || 'people are reached in Slack and here.'
    );
  end if;

  -- Everything else: refused, with the reason. A Disconnect that did nothing
  -- is the failure this issue describes, and so is one that turns the office
  -- off without saying that is what it does.
  return jsonb_build_object('error', case v_key
    when 'openrouter' then
      'OpenRouter is how the team thinks -- removing the key stops every agent. '
      || 'Change or remove it in Settings, Models, where the consequence is on the page.'
    when 'github' then
      'GitHub holds the office''s own code and its two tokens do different jobs. '
      || 'Disconnecting it from here would be one button for two decisions.'
    when 'supabase' then
      'Supabase IS the office -- this function is running inside it.'
    when 'mcp' then
      'The MCP server has no stored credential to remove. Revoke a client''s token '
      || 'on the MCP screen instead.'
    else format('There is no disconnect for %s.', coalesce(nullif(v_key, ''), 'that'))
  end);
end;
$function$;
revoke all on function app.hq_disconnect(uuid, text) from public, anon, authenticated, service_role;

create function app.hq_disconnect_recording(p_office uuid, p_service text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_result jsonb;
begin
  perform app.require_office(p_office);
  v_result := app.hq_disconnect(p_office, p_service);
  -- A refusal changed nothing, so there is nothing to say about undo.
  if v_result ? 'error' then return v_result; end if;

  perform app.undo_none(
    p_office, 'service.disconnect',
    format('Disconnected %s — the credential was deleted and cannot be put back from here',
           coalesce(v_result ->> 'service', p_service)));

  return v_result || jsonb_build_object('undo', null);
end;
$function$;
revoke all on function app.hq_disconnect_recording(uuid, text) from public, anon, authenticated, service_role;
create function public.hq_disconnect(p_office uuid, p_service text)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_disconnect_recording(p_office, p_service) $f$;
revoke all on function public.hq_disconnect(uuid, text) from public, anon, authenticated;
grant execute on function public.hq_disconnect(uuid, text) to service_role;
drop function public.hq_disconnect(text);
drop function app.hq_disconnect_recording(text);
drop function app.hq_disconnect(text);

create function app.hq_set_slack_credentials(p_office uuid, p_bot_token text, p_signing_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_a    text;
  v_b    text;
  v_bot  text;
  v_sig  text;
  v_ref_bot uuid;
  v_ref_sig uuid;
  v_app  text;
  v_seen text;
begin
  perform app.require_office(p_office);
  if app.operator_refusal(p_office) is not null then
    return jsonb_build_object('error', app.operator_refusal(p_office));
  end if;
  /*
    Everything that is not part of the credential, removed.

    A value copied out of a browser can carry a trailing newline, a
    non-breaking space, or a zero-width character from the surrounding markup.
    None of them are visible in a password field and all of them break a
    prefix match.
  */
  v_a := regexp_replace(coalesce(p_bot_token, ''), '[\s ​-‏﻿]', '', 'g');
  v_b := regexp_replace(coalesce(p_signing_secret, ''), '[\s ​-‏﻿]', '', 'g');

  if v_a = '' or v_b = '' then
    return jsonb_build_object('error',
      'both the bot token and the signing secret are needed - reinstalling gives you both');
  end if;

  -- Sorted by shape. Whichever box they arrived in.
  if v_a ~* '^xoxb-' then
    v_bot := v_a; v_sig := v_b;
  elsif v_b ~* '^xoxb-' then
    v_bot := v_b; v_sig := v_a;
  else
    /*
      Neither is a bot token. Name the CLASS, never the characters.

      Slack's prefixes are public; what follows them is the credential. This
      says which known kind of thing it recognised so the mistake is
      actionable, and nothing more.
    */
    v_seen := case
      when v_a ~* '^xapp-' or v_b ~* '^xapp-' then 'an app-level token (xapp-)'
      when v_a ~* '^xoxe' or v_b ~* '^xoxe' then 'a configuration token (xoxe-)'
      when v_a ~* '^xoxp-' or v_b ~* '^xoxp-' then 'a user token (xoxp-)'
      when v_a ~ '^[0-9a-f]{32}$' and v_b ~ '^[0-9a-f]{32}$' then 'two signing secrets'
      else 'neither of them' end;
    return jsonb_build_object('error',
      'no bot token among those - ' || v_seen || '. The one you want starts xoxb- and is on '
      || 'the Install App page, under Bot User OAuth Token.');
  end if;

  if v_sig !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('error',
      'the other value is not a signing secret - it is 32 characters of 0-9 and a-f, on '
      || 'Basic Information under App Credentials.');
  end if;

  select slack_app_id into v_app from public.slack_app_credentials where office_id = any (app.office_scope(p_office)) limit 1;
  if v_app is null then
    return jsonb_build_object('error', 'there is no Slack app row to attach these to');
  end if;

  perform app.store_secret('slack.bot_token', v_bot,
    'Bot user OAuth token for the AI Team HQ app, entered on the web front end.');
  perform app.store_secret('slack.signing_secret', v_sig,
    'Slack request signing secret, entered on the web front end.');

  select id into v_ref_bot from vault.secrets where name = 'slack.bot_token';
  select id into v_ref_sig from vault.secrets where name = 'slack.signing_secret';

  update public.slack_app_credentials
     set bot_token_ref = v_ref_bot,
         signing_secret_ref = v_ref_sig,
         enabled = true,
         disabled_reason = null,
         revoked_at = null,
         installed_at = app.now_utc(),
         updated_at = app.now_utc()
   where slack_app_id = v_app;

  update public.connection_health
     set state = 'ok',
         detail = 'reconnected from the web front end',
         action = 'Setting up -> Slack on the web front end',
         checked_at = app.now_utc()
   where office_id = any (app.office_scope(p_office)) and service = 'Slack';

  return jsonb_build_object('stored', true, 'app', v_app);
end;
$function$;
revoke all on function app.hq_set_slack_credentials(uuid, text, text) from public, anon, authenticated, service_role;
create function public.hq_set_slack_credentials(p_office uuid, p_bot_token text, p_signing_secret text)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_set_slack_credentials(p_office, p_bot_token, p_signing_secret) $f$;
revoke all on function public.hq_set_slack_credentials(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_set_slack_credentials(uuid, text, text) to service_role;
-- the legacy forms: no caller names them any more.
drop function public.hq_set_slack_credentials(text, text);
drop function app.hq_set_slack_credentials(text, text);

create function app.hq_connections(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(
    jsonb_build_object(
      'checked_at', (select max(checked_at) from public.connection_health where office_id = any (app.office_scope(p_office))),
      -- What of Grant's correspondence the office is holding the words
      -- of, right now (#172, ADR-0038). Beside the credential that makes
      -- it possible, because that is where he would go to stop it.
      'mail_bodies', app.mail_bodies_held(p_office),
      'rows', (
        select jsonb_agg(
                 jsonb_build_object(
                   'service', c.service,
                   'credential', c.credential,
                   'state', c.state,
                   'detail', c.detail,
                   'owner', c.owner,
                   'action', c.action,
                   'checked_at', c.checked_at,
                   'age_minutes', round(extract(epoch from (app.now_utc() - c.checked_at)) / 60)
                 )
                 order by
                   case c.state
                     when 'dead' then 0 when 'missing' then 1 when 'unknown' then 2
                     when 'ok' then 3 when 'attested' then 4 else 5
                   end,
                   c.service
               )
          from public.connection_health c
         where c.office_id = any (app.office_scope(p_office))
      )
    ),
    '{}'::jsonb
  )
  );
end;
$function$;
revoke all on function app.hq_connections(uuid) from public, anon, authenticated, service_role;
create function public.hq_connections(p_office uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_connections(p_office) $f$;
revoke all on function public.hq_connections(uuid) from public, anon, authenticated;
grant execute on function public.hq_connections(uuid) to service_role;
-- the legacy forms: no caller names them any more.
drop function public.hq_connections();
drop function app.hq_connections();

create function app.hq_settings(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select jsonb_build_object(
    'live', jsonb_build_object(
      'database', current_database(),
      'server', 'PostgreSQL ' || split_part(current_setting('server_version'), ' ', 1),
      'size', pg_size_pretty(pg_database_size(current_database())),
      'tables', (select count(*)::int from information_schema.tables
                  where table_schema = 'public' and table_type = 'BASE TABLE')
    ),
    'settings', coalesce((
      select jsonb_object_agg(c.key, jsonb_build_object(
               'value', c.value, 'description', c.description))
        from public.system_config c
       where c.key in (select e ->> 'key' from jsonb_array_elements(app.hq_editable_settings()) e)
    ), '{}'::jsonb),
    -- The shape the page renders: key, group and sentence together, so it does
    -- not have to hold its own copy of any of the three.
    'editable', app.hq_editable_settings(),
    'notebook', app.notebook_allowance(),
    'google', app.hq_google()
  )
  );
end;
$function$;
revoke all on function app.hq_settings(uuid) from public, anon, authenticated, service_role;
create function public.hq_settings(p_office uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_settings(p_office) $f$;
revoke all on function public.hq_settings(uuid) from public, anon, authenticated;
grant execute on function public.hq_settings(uuid) to service_role;
-- the legacy forms: no caller names them any more.
drop function public.hq_settings();
drop function app.hq_settings();

create function app.hq_setup(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select app.hq_setup_services(p_office) || jsonb_build_object(
    'google', app.hq_google(),
    -- #210. Shaped like `google` above, for the same reason: the page needs to
    -- know whether to offer a form, and matching a DISPLAY NAME is how the
    -- first attempt failed -- Slack is listed as "The office" in `services`,
    -- so a condition on the name "Slack" could never fire.
    'slack', app.hq_slack_setup(p_office),
    -- Only the keys this page switches. The generic settings form on the
    -- Advanced page is where the rest belong, and a setup screen that shipped
    -- every configuration value would be the Advanced page with a different
    -- name.
    'settings', jsonb_build_object(
      'calendar.enabled', coalesce(
        (select value::text::boolean from public.system_config where key = 'calendar.enabled'),
        false),
      'notebook.enabled', coalesce(
        (select value::text::boolean from public.system_config where key = 'notebook.enabled'),
        false)
    )
  )
  );
end;
$function$;
revoke all on function app.hq_setup(uuid) from public, anon, authenticated, service_role;
create function public.hq_setup(p_office uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_setup(p_office) $f$;
revoke all on function public.hq_setup(uuid) from public, anon, authenticated;
grant execute on function public.hq_setup(uuid) to service_role;
-- the legacy forms: no caller names them any more.
drop function public.hq_setup();
drop function app.hq_setup();

create function app.hq_studio_settings(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
with
  settable as (
    select array[
      'db.project_ref', 'db.region',
      'backup.s3_bucket', 'backup.s3_endpoint', 'backup.s3_region',
      'google.client_id', 'google.redirect_uri', 'google.scopes',
      'calendar.enabled', 'calendar.calendar_id', 'calendar.sync_tasks',
      'notebook.enabled', 'knowledge.read_new_sources',
      'notebook.window_units', 'notebook.week_units', 'notebook.sync_interval_minutes',
      'agents.max_simultaneous_jobs', 'agents.max_delegation_depth',
      'agents.max_specialists_per_job', 'agents.max_live_specialists',
      'agents.max_investigations_per_project_per_day',
      'conversation.window_minutes', 'conversation.max_turns',
      'ui.needs_me_cap', 'grant.timezone'
    ]::text[] as keys
  ),

  team as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'slug', s.slug, 'name', s.name, 'role', s.title,
             'pronouns', s.pronouns, 'remit', s.responsibilities,
             'style', s.communication_style,
             'expertise', coalesce(s.expertise, array[]::text[]),
             'avatar_ref', s.avatar_ref, 'active', s.active,
             'permanent', s.permanent, 'bot', b.username,
             'tools', app.hq_staff_tools(p_office, s.slug),
             'procedures', app.hq_staff_procedures(p_office, s.slug)
           ) order by case s.slug when 'chief-of-staff' then 0 else 1 end, s.name),
           '[]'::jsonb) as v
      from public.staff s
      left join public.telegram_bots b
        on b.staff_slug = s.slug and b.enabled and not b.is_pager
     where s.slug not like 'fixture-%'
  ),

  spare_bots as (
    select coalesce(jsonb_agg(jsonb_build_object('username', b.username)
                              order by b.username), '[]'::jsonb) as v
      from public.telegram_bots b
     where b.enabled and not b.is_pager and b.staff_slug is null
  ),

  behaviours as (
    select jsonb_build_array(
      jsonb_build_object(
        'id', 'autonomy',
        'name', 'How much the team does without asking',
        'kind', 'choice',
        'value', coalesce((select a.level::text from public.autonomy_settings a
                            where a.office_id = p_office and a.project_id is null
                            order by a.set_at desc limit 1), 'suggest'),
        'settable', true,
        'via', 'autonomy',
        'options', app.autonomy_choices()),

      jsonb_build_object(
        'id', 'chief',
        'name', 'Only the Chief of Staff messages me',
        'kind', 'switch',
        'value', coalesce((select (value #>> '{}')::boolean from public.system_config
                            where key = 'telegram.only_chief_speaks'), true),
        'settable', true,
        'via', 'routing:only_chief_speaks',
        'note', 'On Telegram, everyone else still works and still writes output; they just do not send. Slack shows each colleague under their own name.'),

      jsonb_build_object(
        'id', 'read_new_sources',
        'name', 'Read new sources as they appear',
        'kind', 'switch',
        'value', coalesce((select (value #>> '{}')::boolean from public.system_config
                            where key = 'knowledge.read_new_sources'), false),
        'settable', (select 'knowledge.read_new_sources' = any(keys) from settable),
        'via', 'setting:knowledge.read_new_sources',
        'note', 'A document that lands in a connected folder gets read without being asked.'),

      jsonb_build_object(
        'id', 'notebook',
        'name', 'Use NotebookLM',
        'kind', 'switch',
        'value', coalesce((select (value #>> '{}')::boolean from public.system_config
                            where key = 'notebook.enabled'), false),
        'settable', (select 'notebook.enabled' = any(keys) from settable),
        'via', 'setting:notebook.enabled',
        'note', 'Reading and writing notebooks, and the audio overviews.'),

      -- Tasks into the diary (#94, ADR-0020). Off until he turns it on:
      -- writing into a real calendar is not something to begin because a
      -- feature shipped. The duty is already scheduled and already checks this
      -- switch before calling Google once, so turning it on here starts it
      -- working within the hour with nothing else to do.
      jsonb_build_object(
        'id', 'calendar_tasks',
        'name', 'Put dated tasks in my Google Calendar',
        'kind', 'switch',
        'value', coalesce((select (value #>> '{}')::boolean from public.system_config
                            where key = 'calendar.sync_tasks'), false),
        'settable', (select 'calendar.sync_tasks' = any(keys) from settable),
        'via', 'setting:calendar.sync_tasks',
        'note', 'One way only. A task with a due date becomes an all-day event and '
                'comes away when it is done. The diary never changes a task, and '
                'nothing that the office did not create is ever touched.'),

      jsonb_build_object(
        'id', 'browser', 'name', 'Agents may drive a browser',
        'kind', 'switch', 'value', false, 'settable', false,
        'note', 'Not built yet — tracked as issue 16. Shown because it is coming, '
                'and off because nothing can do it.'),

      jsonb_build_object(
        'id', 'undo', 'name', 'Keep everything undoable',
        'kind', 'switch', 'value', true, 'settable', false,
        'note', 'Always on. The ledger is append-only by design, so this is a '
                'statement of how the office works rather than a choice.')
    ) as v
  ),

  connections as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', k.connector,
             'name', coalesce(nullif(k.name, ''), app.connector_label(k.connector)),
             'state', case
               when not k.enabled then 'off'
               when k.health_service is null then 'unchecked'
               else coalesce(h.state, 'unchecked') end,
             'last', case when h.checked_at is null then ''
                          else to_char(h.checked_at, 'FMDD Mon HH24:MI') end,
             -- What it is FOR, in one line. `notes` is engineering reasoning
             -- and belongs to the engineer; see 0226.
             'used', coalesce(nullif(app.connector_purpose(k.connector), ''),
                              left(coalesce(k.notes, ''), 90)),
             'detail', coalesce(
               case when not k.enabled then k.disabled_reason else h.detail end, ''),
             'action', h.action
           ) order by k.name), '[]'::jsonb) as v
      from public.knowledge_connectors k
      left join lateral (
        select ch.state, ch.detail, ch.checked_at, ch.action
          from public.connection_health ch
         where ch.office_id = any (app.office_scope(p_office)) and ch.service = k.health_service
         order by case ch.state
                    when 'dead' then 0 when 'missing' then 1
                    when 'unknown' then 2 when 'ok' then 3 else 4 end
         limit 1
      ) h on true
     -- A harness connector is not one of Grant's (0505). Filtered by the
     -- CLASS rather than by a run's names: the next crashed suite picks a
     -- prefix nobody listed, and five of these sat on his Connections page
     -- for two days because nothing was looking.
     where k.connector not like 'fixture\_%'
  ),

  channels as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', c.key, 'name', c.name, 'role', c.role,
             'state', case
               when h.state is null then 'unchecked'
               when h.state in ('dead', 'missing') then 'degraded'
               when h.state = 'attested' then 'ok'
               else h.state end,
             'detail', coalesce(h.detail, c.fallback),
             /*
               What this channel actually is, and what governs it (#93).

               The cards were read-only: a name, a role and a state, with
               nothing to press. Grant asked for each entry to open something
               that works, and for Telegram the two things that matter are
               settings nobody could see -- `telegram.only_chief_speaks`, which
               is the single most consequential switch in the office, and
               `telegram.direct_to_grant`, which is a DIFFERENT setting that is
               routinely confused with it.

               `who` lists the bots, and since #70 that list is the decision
               made visible: one enabled bot, the chief of staff's, and seven
               shown with `on: false` beside whose they were. Grant, 13
               September: "we don't need a different bot for each role. In
               fact, we only need the chief of staff."

               This comment used to say the opposite — that #70 was VISIBLE
               here as a live defect, the chief having no row while
               staff.telegram_username claimed she had one. 0352 settled it:
               the pager is hers, the mirror is no longer read, and the two
               tables agree. Left as a correction rather than deleted, because
               a comment describing a fixed defect as current is the same
               failure as a comment claiming a property nothing checks.
             */
             'who', case c.key when 'telegram' then (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'username', b.username,
                          'whose', coalesce(s.name, case when b.is_pager then 'The pager' else 'Nobody' end),
                          'pager', b.is_pager,
                          'on', b.enabled
                        ) order by b.is_pager desc, s.name nulls last), '[]'::jsonb)
                   from public.telegram_bots b
                   left join public.staff s on s.slug = b.staff_slug)
               else '[]'::jsonb end,
             'settings', case c.key
               when 'telegram' then jsonb_build_array(
                 jsonb_build_object(
                   'key', 'telegram.direct_to_grant',
                   'name', 'Whose bot may use your private chat',
                   'kind', 'text',
                   'value', coalesce((select value #>> '{}' from public.system_config
                                       where key = 'telegram.direct_to_grant'), ''),
                   'note', 'A staff slug, or empty to let everyone message you directly. This decides WHICH CHAT someone lands in. It is NOT the same as "Only the Chief of Staff messages me" on the Behaviour tab, which decides WHO SENDS AT ALL.'),
                 jsonb_build_object(
                   'key', 'telegram.only_chief_speaks',
                   'name', 'Only the Chief of Staff messages me',
                   'kind', 'switch',
                   'value', coalesce((select (value #>> '{}')::boolean from public.system_config
                                       where key = 'telegram.only_chief_speaks'), false),
                   'note', 'Changed on the Behaviour tab. Shown here because these two are read together, and separating them is how they get confused.'))
               else '[]'::jsonb end,
             -- Explicit, with the real handles in it. Section 25 and his
             -- standing instruction: full instructions every time, never
             -- "you know the one".
             'steps', case c.key
               when 'telegram' then 'Open Telegram and message the bot named in "Who" below. It answers as Claire. A thumbs down on any reply asks what you would have preferred and takes your answer as an instruction. A thumbs up is recorded only.'
               when 'slack' then 'The office posts to one channel per dashboard project, plus a queue channel. A thumbs up or down here is recorded but not yet acted on. To correct an answer, reply in the channel and it is taken as an instruction.'
               when 'voice' then 'Press "Call the team" in the sidebar. The browser asks for the microphone once. Talk over her whenever you like.'
               when 'mail' then 'Read only. The office can search and draft, and cannot send: section 11 keeps sending off by policy whatever the permission allows.'
               else '' end
           ) order by c.sort), '[]'::jsonb) as v
      from (values
        ('telegram', 'Telegram', 'Claire, and the pager', 'Telegram', 1,
         'Decisions buzz. Everything else is silent.'),
        ('slack', 'Slack', 'The office floor', 'Slack', 2,
         'One channel per project, plus the queue.'),
        ('voice', 'Voice', 'Calling the team', 'OpenAI', 3,
         'Claire, with the whole office behind her.'),
        ('mail', 'Email', 'Inbound only', 'Google', 4,
         'Read, not sent. Sending needs your say-so.')
      ) as c(key, name, role, service, sort, fallback)
      left join lateral (
        select ch.state, ch.detail from public.connection_health ch
         where ch.office_id = any (app.office_scope(p_office)) and ch.service = c.service
         order by case ch.state
                    when 'dead' then 0 when 'missing' then 1
                    when 'unknown' then 2 when 'ok' then 3 else 4 end
         limit 1
      ) h on true
  )

  select jsonb_build_object(
    'team', (select v from team),
    'spare_bots', (select v from spare_bots),
    'behaviours', (select v from behaviours),
    'connections', (select v from connections),
    -- What of Grant's correspondence the office is holding the WORDS of
    -- (#172, ADR-0038). Beside the credential that makes it possible,
    -- because the Connections pane is where he would go to stop it. An
    -- authorisation with nothing showing what it produced is a setting
    -- with no reader, which is #15's defect on the most personal corpus
    -- the office holds.
    'mail_bodies', app.mail_bodies_held(p_office),
    'channels', (select v from channels),
    'usage', app.usage_overview(p_office),
    'headroom', app.free_tier_headroom(),
    'self_improvement', app.self_improvement_headroom(),
    'generated_at', app.now_utc()
  )
  );
end;
$function$;
revoke all on function app.hq_studio_settings(uuid) from public, anon, authenticated, service_role;
create function public.hq_studio_settings(p_office uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_studio_settings(p_office) $f$;
revoke all on function public.hq_studio_settings(uuid) from public, anon, authenticated;
grant execute on function public.hq_studio_settings(uuid) to service_role;
-- the legacy forms: no caller names them any more.
drop function public.hq_studio_settings();
drop function app.hq_studio_settings();

create function app.hq_appearance_set(p_office uuid, p_settings jsonb, p_owner text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_owner text := app.office_actor(p_office);
begin
  perform app.require_office(p_office);
  -- Whose appearance this is is the office's person, never a name the caller supplies. A caller that names somebody else
  -- is told so rather than quietly writing to the office's own.
  if nullif(btrim(coalesce(p_owner, '')), '') is not null and btrim(p_owner) <> v_owner then
    return jsonb_build_object('error', 'that is not your appearance to set');
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    return jsonb_build_object('error', 'appearance must be an object');
  end if;
  /*
    Checked here as well as by the constraint, so the answer is a sentence the
    page can show rather than a 23514 the adapter turns into "upstream failed".
    An uploaded texture is the only value that can approach this.
  */
  if length(p_settings::text) > 98304 then
    return jsonb_build_object('error',
      'that is too large to keep - an uploaded texture should be resized first');
  end if;

  insert into public.appearance_settings (office_id, owner, settings, updated_at)
  values (p_office, v_owner, p_settings, app.now_utc())
  on conflict (owner) do update
    set settings = excluded.settings, updated_at = excluded.updated_at
    where public.appearance_settings.office_id = p_office;

  return jsonb_build_object('saved', true, 'settings', p_settings);
end;
$function$;
revoke all on function app.hq_appearance_set(uuid, jsonb, text) from public, anon, authenticated, service_role;
create function public.hq_appearance_set(p_office uuid, p_settings jsonb, p_owner text default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_appearance_set(p_office, p_settings, p_owner) $f$;
revoke all on function public.hq_appearance_set(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.hq_appearance_set(uuid, jsonb, text) to service_role;
-- the legacy forms: no caller names them any more.
drop function public.hq_appearance_set(jsonb, text);
drop function app.hq_appearance_set(jsonb, text);

create function app.trigger_health(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(v order by name), '[]'::jsonb)
    from (
      select t.name,
             jsonb_build_object(
               'name', t.name, 'source', t.source, 'event_type', t.event_type,
               'enabled', t.enabled, 'job_kind', t.job_kind,
               'project', (select name from public.projects p where p.project_id = t.project_id and p.office_id = p_office),
               'fired', (select count(*) from public.trigger_firings f
                          where f.trigger_id = t.trigger_id and f.decision = 'fired'),
               'declined', (select count(*) from public.trigger_firings f
                             where f.trigger_id = t.trigger_id and f.decision <> 'fired'),
               'last_fired', (select max(at) from public.trigger_firings f
                               where f.trigger_id = t.trigger_id and f.decision = 'fired'),
               'last_declined', (select jsonb_build_object('at', f.at, 'why', f.why)
                                   from public.trigger_firings f
                                  where f.trigger_id = t.trigger_id and f.decision <> 'fired'
                                  order by f.at desc limit 1),
               'seen_this_hour', (select count(*) from public.trigger_firings f
                                   where f.trigger_id = t.trigger_id
                                     and f.at > app.now_utc() - interval '1 hour')) as v
        from public.event_triggers t
       where t.office_id = p_office
    ) q
  );
end;
$function$;
revoke all on function app.trigger_health(uuid) from public, anon, authenticated, service_role;
create function public.trigger_health(p_office uuid)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.trigger_health(p_office) $f$;
revoke all on function public.trigger_health(uuid) from public, anon, authenticated;
grant execute on function public.trigger_health(uuid) to service_role;
-- the legacy forms: no caller names them any more.
drop function public.trigger_health();
drop function app.trigger_health();

-- The helpers 0740 replaced have lost their last caller (hq_governance, hq_team, hq_studio_settings and hq_routing now ask
-- with an office), and their public wrappers were reachable by nothing.
drop function public.hq_staff_tools(text);
drop function public.hq_office_chat();
drop function app.hq_staff_tools(text);
drop function app.hq_staff_procedures(text);
drop function app.hq_stranded_work();
drop function app.active_refusals(integer);
-- The approval follow-on that hq_answer_blocker calls took a blocker by its id alone; the office-explicit form is in 0740.
drop function app.answer_generation_approval(uuid, boolean, text);
