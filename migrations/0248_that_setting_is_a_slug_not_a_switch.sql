-- telegram.direct_to_grant is a STAFF SLUG, not a switch (#93).
--
-- 0247 reported it as a boolean and the function threw at runtime on the value
-- "chief-of-staff" -- so the whole Settings payload failed, not just that
-- field. The migration applied fine; it was every later call that broke, which
-- is the worst shape of mistake to make in a function this central.
--
-- What makes it worth a note rather than a quiet fix: the confusion I fell
-- into is the exact one the setting's own description warns about, and the one
-- CLAUDE.md warns about. `only_chief_speaks` decides WHO SENDS AT ALL.
-- `direct_to_grant` decides WHICH CHAT they land in, and holds the slug of the
-- one person whose bot may use his private chat. I read "direct to Grant" as
-- on/off, which is what everyone does.
--
-- So both are reported here, side by side, each saying what it governs in
-- capitals. If the pair is misread this reliably, the fix is not to be more
-- careful, it is to put them next to each other and say it.
--
-- Its current value is 'chief-of-staff', which is also worth seeing beside
-- #70: there is no telegram_bots row for that slug.

CREATE OR REPLACE FUNCTION app.hq_studio_settings()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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

               `who` lists the bots. It is also where #70 becomes visible: the
               chief of staff has no row in telegram_bots while
               staff.telegram_username says she has one, so the two disagree
               and neither half is wrong on its own.
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
               when 'telegram' then 'Open Telegram and message the bot named in "Who" below. It answers as Claire. A thumbs up or down on any reply teaches the office something.'
               when 'slack' then 'The office posts to one channel per dashboard project, plus a queue channel. Reacting with a thumbs up or down is read as feedback.'
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
$function$
;
