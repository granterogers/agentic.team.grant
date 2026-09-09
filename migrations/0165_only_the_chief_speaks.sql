-- Only the chief speaks.
--
-- Grant, on being sent the daily capacity report by the Finance Director:
-- *"I wish to include an option in the front to enable/disable messaging from
-- all bots that are not the chief of staff.. for now, I would like this option
-- disabled so for now I only get message from the chief of staff."*
--
-- ## Why `direct_to_grant` was not already enough
--
-- 0136 built the setting that decides who may write to his PRIVATE chat, and it
-- is set to the chief. That worked exactly as designed and did not solve this,
-- because everybody else was routed into the office group — and he is in the
-- office group. Redirecting a message he can still read is not silence.
--
-- So this is a different question with a different answer. `direct_to_grant`
-- decides *which chat*; this decides *whether at all*.
--
-- ## Suppressed, not deleted
--
-- The work still runs and the output is still written to `outputs`, where the
-- dashboard reads it. What stops is the Telegram delivery. A switch that
-- stopped the duties would be a different switch — `duty:<slug>` on the same
-- page already does that, and the page says so, because "I don't want to be
-- told" and "I don't want it done" are very different instructions.
--
-- Default true, because he asked for it now and because a quiet system is the
-- easier thing to loosen. Everything is one dropdown away on the routing page.

begin;

insert into public.system_config (key, value, description)
values (
  'telegram.only_chief_speaks',
  to_jsonb(true),
  'When true, only the Chief of Staff sends Telegram messages. Everyone else '
  'still does the work and still writes their output — the dashboard shows it '
  'all — they just do not send. Distinct from telegram.direct_to_grant, which '
  'decides WHICH CHAT someone lands in: that one routes the rest into the '
  'office group, and Grant is in the office group, so it never made them quiet '
  '(0165).'
)
on conflict (key) do update set value = excluded.value, description = excluded.description;

-- ---------------------------------------------------------------------------
-- The page can read it
-- ---------------------------------------------------------------------------

create or replace function app.hq_routing()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
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
    'office_group', app.hq_office_chat(),
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
    )
  )
$function$;

-- ---------------------------------------------------------------------------
-- And he can change it
-- ---------------------------------------------------------------------------

create or replace function app.hq_routing_set(p_what text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_floor text;
begin
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
    if not exists (select 1 from public.responsibilities where slug = substring(p_what from 6)) then
      return jsonb_build_object('error', format('no duty "%s"', substring(p_what from 6)));
    end if;
    update public.responsibilities
       set enabled = (lower(trim(p_value)) in ('on', 'true', 'yes', '1')),
           updated_at = app.now_utc()
     where slug = substring(p_what from 6);
    return jsonb_build_object('ok', true, p_what, p_value);
  end if;

  return jsonb_build_object('error', format('"%s" is not a routing setting', p_what));
end;
$function$;

commit;
