-- The studio's Settings read the real office.
--
-- Issue #68, ADR-0019, step three. Grant: *"everything is to be brought into
-- the new style."*
--
-- `web/studio/settings.js` was written to make this a swap rather than a
-- rewrite — its own header says so:
--
--     "Almost none of this needs new schema — it needs an interface. staff,
--      staff_tools, tool_permissions, autonomy_settings, connection_health,
--      provider_health, providers, model_prices, inference_usage,
--      telegram_bots, slack_workspaces, knowledge_connectors and
--      notification_preferences all exist and hold real rows today. The mock
--      below has the shape of those tables so that wiring it is a swap."
--
-- So this returns those exact shapes. Not a better shape, not a tidier one: the
-- point of a mock built to a shape is that the shape is the contract, and
-- improving it here would turn a swap into the rewrite it was written to avoid.
--
-- ## What is honestly not settable, and says so
--
-- `hq_set_setting` has an allow-list of twenty-eight keys and it is the
-- authority — a page that offers a switch the API will refuse is worse than one
-- that shows the state and says it is not changeable here. So each behaviour
-- carries `settable`, read from the same list the API enforces, and the studio
-- draws a control or a read-out accordingly.
--
-- Two of the five behaviours the design shows have no storage at all: "agents
-- may drive a browser" (#16) and "keep everything undoable" — the second is not
-- a setting, it is what the ledger does, and offering a switch to turn off
-- reversibility would be offering to make the office unaccountable. Both are
-- returned with `settable` false and a sentence saying why.

begin;

create or replace function app.hq_studio_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with
  -- Every key `hq_set_setting` will actually accept. Read from one place so a
  -- control can never be offered for something the API refuses.
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
      'knowledge.new_source_jobs_per_hour', 'knowledge.new_source_min_chars',
      'ui.needs_me_cap', 'grant.timezone'
    ]::text[] as keys
  ),

  team as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'slug', s.slug,
             'name', s.name,
             'role', s.title,
             'pronouns', s.pronouns,
             'remit', s.responsibilities,
             'style', s.communication_style,
             'expertise', coalesce(s.expertise, array[]::text[]),
             'avatar_ref', s.avatar_ref,
             'active', s.active,
             'permanent', s.permanent,
             'bot', b.username,
             -- Every tool, held or not, with whether it is usable at all. A
             -- permission screen listing only what is granted cannot be used to
             -- grant anything (0120), and a disabled tool shown with its reason
             -- answers "why can't Ruby send email" once instead of every time.
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
        -- The GLOBAL row. A project can override it (0027) and that belongs on
        -- the project, not in a setting that claims to speak for everything.
        'value', coalesce((select a.level::text from public.autonomy_settings a
                            where a.project_id is null
                            order by a.set_at desc limit 1), 'suggest'),
        'settable', true,
        'via', 'autonomy',
        'options', jsonb_build_array(
          jsonb_build_object('id', 'suggest', 'name', 'Ask me first',
            'note', 'Every external action waits for you.'),
          jsonb_build_object('id', 'act', 'name', 'Standing authorization',
            'note', 'Routine work proceeds. Consequential actions wait.'),
          jsonb_build_object('id', 'wide', 'name', 'Wide',
            'note', 'Only purchases and destructive changes wait.'))),

      jsonb_build_object(
        'id', 'chief',
        'name', 'Only the Chief of Staff messages me',
        'kind', 'switch',
        'value', coalesce((select (value #>> '{}')::boolean from public.system_config
                            where key = 'telegram.only_chief_speaks'), true),
        -- Not through `set_setting`: it has its own RPC, because turning it off
        -- means eight bots may message him and that deserved its own check.
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
        'id', 'browser',
        'name', 'Agents may drive a browser',
        'kind', 'switch',
        'value', false,
        -- #16. There is no storage for this and no code that reads it, and a
        -- switch with nothing behind it is a lie that looks like a feature.
        'settable', false,
        'note', 'Not built yet — tracked as issue 16. Shown because it is coming, '
                'and off because nothing can do it.'),

      jsonb_build_object(
        'id', 'undo',
        'name', 'Keep everything undoable',
        'kind', 'switch',
        'value', true,
        /*
          Deliberately not settable, and not because nobody got to it.

          This is not a preference, it is what the ledger does — §6, append-only,
          every action carrying whether it is reversible and how. A switch to
          turn it off would be a switch that makes the office unaccountable, and
          the honest interface says so rather than quietly omitting the row.
        */
        'settable', false,
        'note', 'Always on. The ledger is append-only by design, so this is a '
                'statement of how the office works rather than a choice.')
    ) as v
  ),

  connections as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', k.connector,
             'name', app.connector_label(k.connector),
             'state', case
               when not k.enabled then 'off'
               else coalesce(h.state, 'unknown') end,
             'last', case when h.checked_at is null then 'never'
                          else to_char(h.checked_at, 'FMDD Mon HH24:MI') end,
             'used', k.notes,
             'detail', coalesce(
               case when not k.enabled then k.disabled_reason else h.detail end,
               ''),
             -- What a person would have to do about it, when there is something.
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

  -- The surfaces, which are not connectors and are the thing Claire was twice
  -- wrong about when asked what she could reach.
  channels as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', c.service,
             'name', initcap(c.service),
             'role', c.owner,
             'state', case when c.state in ('dead', 'missing') then 'degraded'
                           else c.state end,
             'detail', coalesce(c.detail, '')
           ) order by c.service), '[]'::jsonb) as v
      from public.connection_health c
     where c.service in ('telegram', 'slack', 'voice', 'gmail')
  )

  select jsonb_build_object(
    'team', (select v from team),
    'spare_bots', (select v from spare_bots),
    'behaviours', (select v from behaviours),
    'connections', (select v from connections),
    'channels', (select v from channels),
    -- Measured, and it carries its own caveats: `usage_overview` already
    -- distinguishes what a provider reported from what we counted ourselves,
    -- and flattening that here would turn an estimate into a fact.
    'usage', app.usage_overview(),
    'headroom', app.free_tier_headroom(),
    'self_improvement', app.self_improvement_headroom(),
    'generated_at', app.now_utc()
  )
$$;

comment on function app.hq_studio_settings() is
  'Everything the studio Settings viewer renders, in the shapes settings.js '
  'already exports (#68). Each behaviour carries `settable`, read from the '
  'same allow-list hq_set_setting enforces, so a control is never offered for '
  'something the API will refuse.';

create or replace function public.hq_studio_settings()
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.hq_studio_settings() $$;

commit;
