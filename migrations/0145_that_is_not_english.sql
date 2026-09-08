-- 0145 — "00:17:00 ago" is not English
--
-- 0144 fixed what the Backups row on the Set up page MEANT and left it saying
-- "last taken 00:17:00 ago", which is a Postgres interval cast to text.
--
-- Grant, about this page, more than once: *"put everything in plain English.
-- There's far too much weird nomenclature."* An interval rendered by the
-- database is exactly that — correct, and written for the database rather than
-- for the person reading it.
--
-- `app.ago` is separate rather than inlined because every future row that
-- wants to say when something last happened will want the same sentence, and
-- the alternative is nine near-identical case expressions that drift.

begin;

/**
 * How long ago, said the way a person says it.
 *
 * Deliberately coarse. "3 hours ago" is what someone wants to know; "3 hours
 * 14 minutes ago" is the same fact with a precision nobody asked for, and it
 * makes a page of them harder to scan rather than easier.
 */
create or replace function app.ago(p_at timestamptz)
returns text
language sql
stable
as $$
  select case
    when p_at is null then 'never'
    when app.now_utc() - p_at < interval '90 seconds' then 'just now'
    when app.now_utc() - p_at < interval '90 minutes' then
      format('%s minutes ago', round(extract(epoch from app.now_utc() - p_at) / 60))
    when app.now_utc() - p_at < interval '36 hours' then
      format('%s hours ago', round(extract(epoch from app.now_utc() - p_at) / 3600))
    else
      format('%s days ago', round(extract(epoch from app.now_utc() - p_at) / 86400))
  end
$$;

comment on function app.ago(timestamptz) is
  'How long ago, in plain English and deliberately coarse. One sentence for '
  'every page that needs it, rather than a case expression per row.';

grant execute on function app.ago(timestamptz) to ai_team_app;

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
    select 9, 'backup', 'Backups', 'Supabase Storage',
      -- The DUTY and its last run, not a credential sitting in the vault.
      -- The row this replaces checked for a Backblaze bucket key that has
      -- nothing to do with any backup this system takes, and read "ready"
      -- because the key was still there long after the thing that used it
      -- stopped existing.
      case
        when not exists (select 1 from public.responsibilities
                          where slug = 'nightly-backup' and enabled) then 'off'
        when (select last_run_at from public.responsibilities where slug = 'nightly-backup')
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
         from public.responsibilities r where r.slug = 'nightly-backup'),
        'no backup duty'),
      case
        when (select last_run_at from public.responsibilities where slug = 'nightly-backup')
             > app.now_utc() - interval '48 hours' then null
        else 'Take one now'
      end,
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
