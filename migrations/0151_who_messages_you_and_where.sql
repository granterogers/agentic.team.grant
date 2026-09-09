-- Who messages you, and where.
--
-- Grant: *"we should include routing options in the front end."*
--
-- Everything that decides where a message lands is already in the database and
-- none of it is reachable from the page: `telegram.direct_to_grant` (0136)
-- decides who may write to his private chat, `responsibilities.enabled`
-- decides which duties exist at all, and the pager floor decides how loud
-- something has to be before a phone buzzes.
--
-- All three were mine to change and his to live with, which is backwards. He
-- has spent two days telling me the team talks too much; the fix for that is
-- partly better judgement in the code and partly a dial he can turn without
-- asking.
--
-- ## The pager floor, which did not exist as a setting
--
-- It was an argument passed at the call site, fixed at `important` and then
-- at `routine`. A number that decides how often his phone goes off belongs
-- where he can see it.
--
-- ## Why duties are in the same place
--
-- Because "who messages me" and "what runs at all" are the same question from
-- where he sits. A duty that finds nothing is silent, so the only reason to
-- switch one off is that he does not want the thing done — and that is a
-- decision, not a preference, so the page shows what each one does.

begin;

insert into public.system_config (key, value, description)
values
  ('telegram.pager_floor', to_jsonb('important'::text),
   'How loud something must be before it reaches Telegram rather than just '
   'Slack. One of trivial, routine, important, urgent, blocker. §12 gives '
   'Telegram one interrupting voice; this is where the bar is set.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- What the page reads
-- ---------------------------------------------------------------------------

create or replace function app.hq_routing()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'direct_to_grant', coalesce(
      (select value #>> '{}' from public.system_config
        where key = 'telegram.direct_to_grant'), ''),
    'pager_floor', coalesce(
      (select value #>> '{}' from public.system_config
        where key = 'telegram.pager_floor'), 'important'),
    'office_group', app.hq_office_chat(),
    -- Everyone who could be the one voice, so the page offers a list rather
    -- than a text box. A slug typed by hand is a slug typed wrong.
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('slug', s.slug, 'name', s.name, 'title', s.title)
                       order by s.name)
        from public.staff s where s.active), '[]'::jsonb),
    'duties', coalesce((
      select jsonb_agg(jsonb_build_object(
               'slug', r.slug,
               'what', r.description,
               'every_minutes', r.period_minutes,
               'enabled', r.enabled,
               'owner', s.name,
               'last_run', app.ago(r.last_run_at))
             order by r.slug)
        from public.responsibilities r
        left join public.staff s on s.staff_id = r.staff_id), '[]'::jsonb)
  );
$$;

grant execute on function app.hq_routing() to ai_team_app;

create or replace function public.hq_routing()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_routing() $$;

-- ---------------------------------------------------------------------------
-- What the page may change
-- ---------------------------------------------------------------------------
--
-- An allow-list, and a narrow one. The same reasoning as `hq_set_setting`:
-- the page is not the only possible caller, so the guard lives in the
-- function rather than in the caller.

create or replace function app.hq_routing_set(p_what text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_floor text;
begin
  if p_what = 'direct_to_grant' then
    -- Empty means everybody, which is the pre-0136 behaviour and a legitimate
    -- choice. Anything else must be a real, active person.
    if p_value <> '' and not exists (
      select 1 from public.staff where slug = p_value and active
    ) then
      return jsonb_build_object('error', format('no active staff member "%s"', p_value));
    end if;
    update public.system_config set value = to_jsonb(p_value)
     where key = 'telegram.direct_to_grant';
    return jsonb_build_object('ok', true, 'direct_to_grant', p_value);

  elsif p_what = 'pager_floor' then
    v_floor := lower(trim(p_value));
    if v_floor not in ('trivial', 'routine', 'important', 'urgent', 'blocker') then
      return jsonb_build_object('error', format('"%s" is not a severity', p_value));
    end if;
    update public.system_config set value = to_jsonb(v_floor)
     where key = 'telegram.pager_floor';
    return jsonb_build_object('ok', true, 'pager_floor', v_floor);

  elsif p_what like 'duty:%' then
    -- `duty:<slug>` with 'on' or 'off'. Switching one off stops the work, not
    -- just the message, which is why the page says what each duty does.
    if not exists (select 1 from public.responsibilities where slug = substring(p_what from 6)) then
      return jsonb_build_object('error', format('no duty "%s"', substring(p_what from 6)));
    end if;
    update public.responsibilities
       set enabled = (lower(trim(p_value)) in ('on', 'true', 'yes'))
     where slug = substring(p_what from 6);
    return jsonb_build_object('ok', true, 'duty', substring(p_what from 6), 'enabled', p_value);
  end if;

  return jsonb_build_object('error', format('"%s" is not something this can change', p_what));
end
$$;

grant execute on function app.hq_routing_set(text, text) to ai_team_app;

create or replace function public.hq_routing_set(p_what text, p_value text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_routing_set(p_what, p_value) $$;

revoke all on function public.hq_routing_set(text, text) from public;
grant execute on function public.hq_routing_set(text, text) to service_role;

do $$
begin
  if (app.hq_routing() ->> 'direct_to_grant') is null then
    raise exception 'hq_routing did not answer';
  end if;
  if (app.hq_routing_set('pager_floor', 'nonsense') ->> 'error') is null then
    raise exception 'hq_routing_set accepted a severity that does not exist';
  end if;
end
$$;

commit;
