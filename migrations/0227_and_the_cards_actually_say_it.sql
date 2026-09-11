-- The Connections cards say what a connector is for.
--
-- Issue #68, and the other half of 0226 — that migration added
-- `app.connector_purpose()` and nothing called it yet, which is the shape this
-- session has already caught three times today: build the mechanism, forget the
-- mouth. Written as its own migration rather than folded in, because a function
-- and its caller landing separately is exactly how the first one gets forgotten.

begin;

create or replace function app.hq_studio_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with
  settable as (
    select array[
      'db.project_ref', 'db.region',
      'backup.s3_bucket', 'backup.s3_endpoint', 'backup.s3_region',
      'google.client_id', 'google.redirect_uri', 'google.scopes',
      'calendar.enabled', 'calendar.calendar_id',
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
             'tools', app.hq_staff_tools(s.slug),
             'procedures', app.hq_staff_procedures(s.slug)
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
                            where a.project_id is null
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
        'note', 'Everyone else still works and still writes output. They just do not send.'),

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
         where ch.service = k.health_service
         order by case ch.state
                    when 'dead' then 0 when 'missing' then 1
                    when 'unknown' then 2 when 'ok' then 3 else 4 end
         limit 1
      ) h on true
  ),

  channels as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', c.key, 'name', c.name, 'role', c.role,
             'state', case
               when h.state is null then 'unchecked'
               when h.state in ('dead', 'missing') then 'degraded'
               when h.state = 'attested' then 'ok'
               else h.state end,
             'detail', coalesce(h.detail, c.fallback)
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
         where ch.service = c.service
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
    'channels', (select v from channels),
    'usage', app.usage_overview(),
    'headroom', app.free_tier_headroom(),
    'self_improvement', app.self_improvement_headroom(),
    'generated_at', app.now_utc()
  )
$$;

commit;
