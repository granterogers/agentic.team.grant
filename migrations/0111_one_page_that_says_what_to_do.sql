-- 0111 — One page that says what to do
--
-- Grant, for the third time on the interface: *"it just isn't really intuitive
-- what you should be doing... just make the whole interface easy to work with,
-- have proper menus, explain what's going on."* And: *"within the front end
-- there should definitely be a help section that explains everything about this
-- project, what it does, how to get it set up."*
--
-- The two earlier passes added explanation to pages that already existed. That
-- was the wrong shape. A dashboard explains what you are LOOKING at; it cannot
-- answer "what should I do", because the answer to that is not on any one page
-- — it is spread across Connections (which is red), Settings (which has four
-- Google steps), and a handoff document in the repository.
--
-- So: one function that knows the state of every service and, for each, the one
-- next action. The page renders it as a checklist. There is nothing clever
-- here and that is the point — the cleverness was the problem.
--
-- ## Why the states are three and not two
--
-- `ready`, `action` and `off` — not connected/not-connected. A thing Grant
-- deliberately switched off must not appear as an outstanding task, or the
-- checklist grows a permanent red item and stops being a checklist. §17 already
-- makes an integration disableable with a reason; this is that reason
-- surfacing.
--
-- ## Why `does` is written down rather than inferred
--
-- Every row says what the service is FOR in one sentence. "Notion: connected"
-- tells someone who already knows what Notion is doing here; the sentence is
-- for the person setting this up for the first time, who is the person this
-- page exists for.

begin;

/**
 * Every third-party service, what it does, and the one thing to do next.
 *
 * Read-only and assembled from live state — a checklist that could go stale is
 * a checklist that eventually lies about what is done.
 */
create or replace function app.hq_setup()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with svc as (
    -- Postgres. Always ready by construction: this function is running.
    select
      1 as ord, 'database' as key, 'Database' as name, 'Supabase Postgres' as vendor,
      'ready' as state,
      'Everything the team knows and everything it has done. The single source of truth.' as does,
      format('%s, %s', (select value #>> '{}' from public.system_config where key = 'db.project_ref'),
                       (select value #>> '{}' from public.system_config where key = 'db.region')) as detail,
      null::text as action, null::text as href

    union all
    -- Inference.
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
    -- Slack.
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
    -- Telegram.
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
    -- Notion.
    select 5, 'notion', 'Your own notes', 'Notion',
      case
        when not exists (select 1 from vault.secrets where name = 'notion.integration_token')
          then 'action'
        when not exists (select 1 from public.documents where connector = 'notion')
          then 'action'
        else 'ready'
      end,
      'Pages you share with the integration become part of what the team can read and cite.',
      coalesce((select count(*)::text || ' page(s) synced'
                  from public.documents where connector = 'notion'), '0'),
      case
        when not exists (select 1 from vault.secrets where name = 'notion.integration_token')
          then 'Add a Notion integration token'
        when not exists (select 1 from public.documents where connector = 'notion')
          then 'Share a page with the integration'
        else null
      end,
      'https://www.notion.so/profile/integrations'

    union all
    -- Google. One row per service, one client behind them all.
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
    -- Notebook.
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
                  from public.project_attachments
                 where connector = 'notebooklm' and enabled), '0'),
      case when exists (select 1 from vault.secrets where name = 'notebook.storage_state')
           then null else 'Connect a NotebookLM session' end,
      null

    union all
    -- Backups.
    select 9, 'backup', 'Backups', 'Backblaze B2',
      case when exists (select 1 from vault.secrets where name = 'backup.s3_bucket')
           then 'ready' else 'action' end,
      'A nightly copy of everything, restored into a scratch database each night to prove it can be.',
      coalesce((select 'bucket configured' from vault.secrets
                 where name = 'backup.s3_bucket' limit 1), 'no bucket'),
      case when exists (select 1 from vault.secrets where name = 'backup.s3_bucket')
           then null else 'Add S3 credentials' end,
      null
  )
  select jsonb_build_object(
    'generated_at', app.now_utc(),
    'ready', (select count(*) from svc where state = 'ready'),
    'needs_you', (select count(*) from svc where state = 'action'),
    'services', (select jsonb_agg(row_to_json(s) order by s.ord) from svc s)
  )
$$;

grant execute on function app.hq_setup() to ai_team_app, service_role;

create or replace function public.hq_setup()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_setup() $$;

revoke all on function public.hq_setup() from public;
grant execute on function public.hq_setup() to service_role;

commit;
