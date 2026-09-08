-- 0142 — The Set up page knows about the office group
--
-- 0136 built the routing: the Chief of Staff reaches Grant directly and
-- everyone else goes to the office group, once one exists. It falls back to
-- his private chat until then, so nothing is broken while the group is
-- missing — which is exactly why the missing group would never be noticed.
--
-- Telegram does not let a bot create a group. That is a platform rule, so the
-- one step is Grant's, and a step only a human can take belongs on the page
-- that lists steps only a human can take rather than in a chat message he will
-- scroll past.
--
-- Written the way 0130 was, and for the reason 0130 gives: the definition
-- below is a PROGRAMMATIC copy of 0130's, with one `union all` branch inserted
-- by script. Nine near-identical branches is the shape that hides a typo, and
-- 0128 is what happens when I retype a large function.
--
-- Ordinal 12, after everything that already has one, because it is the newest
-- thing to do rather than the most important.

begin;

create or replace function app.hq_setup_services()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
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
                         where enabled and revoked_at is null)
           then 'ready' else 'action' end,
      'Where the team works. Results arrive in the project channel, presented as the person who produced them, with buttons you can press.',
      coalesce((select count(*)::text || ' channel(s)' from public.slack_channel_map where active), '0'),
      case when exists (select 1 from public.slack_app_credentials
                         where enabled and revoked_at is null)
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
           where d.connector = 'notion' and p.status = 'active')
          then 'action'
        else 'ready'
      end,
      'Pages you share with the integration become part of what the team can read and cite.',
      -- Live projects only. The count was including documents on projects
      -- archived days ago, on a page whose job is to say what is true now.
      coalesce((select count(*)::text || ' page(s) synced'
                  from public.documents d join public.projects p using (project_id)
                 where d.connector = 'notion' and p.status = 'active'), '0'),
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
      coalesce((select count(*)::text || ' event(s) cached' from public.calendar_events), '0'),
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
                  from public.mail_messages where vanished_at is null), '0'),
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
                 where a.connector = 'notebooklm' and a.enabled and p.status = 'active'), '0'),
      case when exists (select 1 from vault.secrets where name = 'notebook.storage_state')
           then null else 'Connect a NotebookLM session' end,
      null

    union all
    select 9, 'backup', 'Backups', 'Backblaze B2',
      case when exists (select 1 from vault.secrets where name = 'backup.s3_bucket')
           then 'ready' else 'action' end,
      'A nightly copy of everything, restored into a scratch database each night to prove it can be.',
      coalesce((select 'bucket configured' from vault.secrets
                 where name = 'backup.s3_bucket' limit 1), 'no bucket'),
      case when exists (select 1 from vault.secrets where name = 'backup.s3_bucket')
           then null else 'Add S3 credentials' end,
      null
    union all
    -- 0142: the office group. A Telegram bot cannot create one, so this row is
    -- the only place the instruction can live where Grant will find it again.
    select 12, 'office_group', 'The team''s group chat', 'Telegram',
      case when (app.hq_office_chat() ->> 'exists')::boolean then 'ready' else 'action' end,
      'One room where the whole team posts, so only the Chief of Staff messages '
      'you directly.',
      case when (app.hq_office_chat() ->> 'exists')::boolean
        then format('%s of %s bots are in %s',
                    app.hq_office_chat() ->> 'bots_present',
                    app.hq_office_chat() ->> 'bots_expected',
                    coalesce(app.hq_office_chat() ->> 'title', 'the group'))
        else 'Telegram will not let a bot create a group, so this one is yours to make: '
             'new group, add all eight bots, call it AI Team HQ. They register themselves.'
      end,
      case when (app.hq_office_chat() ->> 'exists')::boolean then null
        else 'Make the group' end,
      case when (app.hq_office_chat() ->> 'exists')::boolean then null
        else 'https://web.telegram.org/a/' end

  )
  select jsonb_build_object(
    'generated_at', app.now_utc(),
    'ready', (select count(*) from svc where state = 'ready'),
    'needs_you', (select count(*) from svc where state = 'action'),
    'services', (select jsonb_agg(row_to_json(s) order by s.ord) from svc s)
  )
$$;

commit;
