-- A setter for autonomy, and the four levels that actually exist.
--
-- Issue #68, #15. Two things wrong, one inherited and one mine.
--
-- **Inherited:** `web/studio/settings.js` offered three choices — Ask me first,
-- Standing authorization, Wide — and `autonomy_level` is an enum of FOUR:
-- `observe`, `suggest`, `act_with_review`, `act`. There is no `wide`. The mock
-- was written before anybody read the enum, and 0223 copied its options
-- faithfully, which is how a plausible mock becomes a wrong interface.
--
-- **Mine:** there was no setter at all. `autonomy_settings` has been written
-- only by migration 0027 and by `verify:autonomy` since it was created, so the
-- most important control in #15 — *"a system that interrupts on everything is a
-- system you stop reading, and one that interrupts on nothing is one you stop
-- trusting"* — could be read and not changed.
--
-- ## The names are Grant's, the values are the schema's
--
-- `act_with_review` is precise and nobody says it. The page shows what the
-- level MEANS for him and stores what the enum requires, and the mapping lives
-- here rather than in the page so a fifth level cannot appear in one and not
-- the other.
--
-- ## A new row, never an update
--
-- Same shape as every other decision in this database. `set_by` and `reason`
-- are on the table already and were clearly meant to be filled in; an UPDATE
-- would lose the answer to "when did the office start acting on its own".

begin;

create or replace function app.hq_autonomy_set(
  p_level      text,
  p_project_id uuid default null,
  p_by         text default 'grant',
  p_reason     text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $$
declare
  v_was text;
begin
  if p_level not in ('observe', 'suggest', 'act_with_review', 'act') then
    return jsonb_build_object('error',
      format('%L is not an autonomy level. They are: observe, suggest, '
             || 'act_with_review, act.', p_level));
  end if;

  select a.level::text into v_was
    from public.autonomy_settings a
   where a.project_id is not distinct from p_project_id
   order by a.set_at desc limit 1;

  insert into public.autonomy_settings (project_id, level, set_by, reason)
  values (p_project_id, p_level::public.autonomy_level, p_by,
          coalesce(nullif(btrim(p_reason), ''),
                   format('Set from the dashboard on %s.',
                          to_char(app.now_utc(), 'FMDD Mon YYYY'))));

  -- How much the office may do without asking is exactly the kind of change
  -- that must be answerable three months later.
  perform public.append_event(
    extensions.gen_random_uuid(), 'user', p_by, 'settings', 'autonomy.changed',
    true, p_project_id,
    jsonb_build_object('level', v_was),
    jsonb_build_object('level', p_level),
    format('Autonomy %s → %s.', coalesce(v_was, 'unset'), p_level),
    '[]'::jsonb, null, null,
    'app.hq_autonomy_set with the previous level', null);

  return jsonb_build_object('level', p_level, 'was', v_was,
                            'scope', case when p_project_id is null
                                          then 'the whole office'
                                          else 'this project' end);
end;
$$;

comment on function app.hq_autonomy_set(text, uuid, text, text) is
  'Set how much the office does without asking (#15). A new row, never an '
  'update: "when did it start acting on its own" must stay answerable.';

create or replace function public.hq_autonomy_set(
  p_level text, p_project_id uuid default null, p_reason text default null
) returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.hq_autonomy_set(p_level, p_project_id, 'grant', p_reason) $$;

-- ---------------------------------------------------------------------------
-- And the choices the page offers are the ones the enum has
-- ---------------------------------------------------------------------------
create or replace function app.autonomy_choices()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  /*
    Named for what each means to Grant, valued as the enum requires.

    `act_with_review` is precise and nobody says it out loud. The mapping lives
    here rather than in the page so a fifth level cannot appear in one and not
    the other — which is exactly how "wide" came to be offered for a level that
    has never existed.
  */
  select jsonb_build_array(
    jsonb_build_object('id', 'observe', 'name', 'Watch only',
      'note', 'The team reads and reports. It changes nothing anywhere.'),
    jsonb_build_object('id', 'suggest', 'name', 'Ask me first',
      'note', 'Every action outside our own records waits for you.'),
    jsonb_build_object('id', 'act_with_review', 'name', 'Act, then show me',
      'note', 'Routine work proceeds and lands in front of you afterwards.'),
    jsonb_build_object('id', 'act', 'name', 'Act',
      'note', 'Only purchases and destructive changes stop and ask.')
  )
$$;

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
             'used', coalesce(k.notes, ''),
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
