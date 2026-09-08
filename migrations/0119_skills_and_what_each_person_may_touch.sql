-- 0119 — Skills, and what each person is allowed to touch
--
-- Grant: *"I want the staff members' details to be editable on the front page —
-- names, roles, but you know what kind of skills they have? I'd like to give
-- them the ability to interact with other tools. Let's say the marketing guy
-- should be able to go away and use image editing APIs. So, expanding the
-- roles beyond just text, giving them specific skills."*
--
-- Two separate things, and they are separate on purpose.
--
-- ## Skills are description. Tools are permission.
--
-- `staff.expertise` already exists and is a text array that goes into the
-- prompt: it shapes how someone writes and what they think they are for. It
-- grants nothing. Editing it can never make anyone able to do something they
-- could not do before, which is exactly why it is safe to expose as a free
-- text field on a web page.
--
-- A tool grant is the opposite: it is the difference between a person who
-- talks about editing an image and a person who calls an image API. So it is
-- not a text field. It is a row referencing `tool_permissions`, and a tool
-- that does not exist there cannot be granted at all — a foreign key rather
-- than a validation, because a validation is a rule someone can forget to run.
--
-- ## The global table stays the ceiling
--
-- §11 says the tool router enforces permissions centrally and agents must not
-- self-authorize around them. A per-staff grant that could switch on a tool
-- `tool_permissions` has disabled would move the authority from one table to
-- two, and two places that can each say yes is not a permission system.
--
-- So: `app.staff_may_use()` is an AND. Global enabled AND autonomy level AND
-- a grant for this person. `gmail.send` is disabled globally by policy, and no
-- amount of granting on the front page turns it on — the page will show it as
-- unavailable with the reason, which is more useful than hiding it.
--
-- ## Why everyone starts with everything currently enabled
--
-- Today there is no per-staff restriction at all: any agent can reach any
-- enabled tool. Introducing this table with a careful, role-guessed subset
-- would silently REMOVE capability from eight people in the name of adding a
-- feature, and the failures would surface later as work that mysteriously
-- stopped happening. The migration therefore grants each active person every
-- currently-enabled tool — the status quo, written down — and Grant narrows or
-- widens it from the page. A permission system's first job is to not change
-- behaviour on the day it is installed.

begin;

/**
 * Which tools a given person may reach.
 *
 * `tool` is a foreign key, not free text: the set of things that can be
 * granted is the set of things that exist.
 */
create table public.staff_tools (
  staff_slug  text        not null references public.staff(slug) on delete cascade,
  tool        text        not null references public.tool_permissions(tool) on delete cascade,
  granted_at  timestamptz not null default app.now_utc(),
  -- Who widened this, so a capability nobody remembers adding has an author.
  granted_by  text        not null default 'grant',
  note        text,
  primary key (staff_slug, tool)
);

comment on table public.staff_tools is
  'Per-person tool grants. NEVER a way to exceed tool_permissions: '
  'app.staff_may_use() is an AND of this table and the global one, so a tool '
  'disabled by policy stays disabled however it is granted here (§11).';

alter table public.staff_tools enable row level security;
alter table public.staff_tools force  row level security;
grant select on public.staff_tools to ai_team_app;
create policy staff_tools_app_read on public.staff_tools
  for select to ai_team_app using (true);

-- The status quo, written down. See the header: granting less than this today
-- would be a silent capability removal dressed as a new feature.
insert into public.staff_tools (staff_slug, tool, granted_by, note)
select s.slug, t.tool, 'migration-0119',
       'Seeded from the pre-0119 behaviour, where every agent could reach every enabled tool.'
  from public.staff s
  cross join public.tool_permissions t
 where s.active and t.enabled
on conflict (staff_slug, tool) do nothing;

/**
 * May this person call this tool right now?
 *
 * An AND of three things, in one place, because §11's "centrally" means one
 * definition. `app.tool_allowed` already answers the global half; this does
 * not re-implement it, it calls it — two copies of a permission rule is one
 * copy of a permission rule.
 */
create or replace function app.staff_may_use(
  p_slug text,
  p_tool text,
  p_approved boolean default false
)
returns boolean
language sql
stable
as $$
  select app.tool_allowed(p_tool, p_approved)
     and exists (
       select 1 from public.staff_tools st
        where st.staff_slug = p_slug and st.tool = p_tool
     )
$$;

grant execute on function app.staff_may_use(text, text, boolean) to ai_team_app, service_role;

/**
 * Every tool, and for each person whether they hold it and whether it is
 * usable at all.
 *
 * Returns the tools they do NOT hold as well as the ones they do. A permission
 * screen that lists only what is granted cannot be used to grant anything, and
 * a disabled tool shown with its reason answers "why can't Ruby send email"
 * once, on the page, instead of every time it is asked.
 */
create or replace function app.hq_staff_tools(p_slug text)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'tool', t.tool,
           'description', t.description,
           'level', t.level,
           'granted', st.staff_slug is not null,
           'available', t.enabled,
           'unavailable_because', t.disabled_reason
         ) order by t.level, t.tool), '[]'::jsonb)
    from public.tool_permissions t
    left join public.staff_tools st
      on st.tool = t.tool and st.staff_slug = p_slug
$$;

grant execute on function app.hq_staff_tools(text) to ai_team_app, service_role;

/**
 * Grant or revoke one tool for one person.
 *
 * One tool at a time rather than "here is the new set", because a set-shaped
 * call loses a race with a second tab and silently reverts a grant made
 * seconds earlier. A checkbox is one fact; sending one fact is honest about
 * that.
 */
create or replace function app.hq_staff_tool_set(
  p_slug text,
  p_tool text,
  p_granted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_enabled boolean;
  v_reason  text;
begin
  if not exists (select 1 from public.staff where slug = p_slug) then
    return jsonb_build_object('error', format('no one called %L', p_slug));
  end if;

  select enabled, disabled_reason into v_enabled, v_reason
    from public.tool_permissions where tool = p_tool;
  if not found then
    return jsonb_build_object('error', format('there is no tool called %L', p_tool));
  end if;

  -- Refused rather than accepted-and-ignored. A checkbox that ticks and then
  -- does nothing is worse than one that refuses and says why: the first one
  -- teaches you the permission is on.
  if p_granted and not v_enabled then
    return jsonb_build_object(
      'error', format('%s is switched off for everyone: %s', p_tool, coalesce(v_reason, 'no reason recorded'))
    );
  end if;

  if p_granted then
    insert into public.staff_tools (staff_slug, tool, granted_by, note)
    values (p_slug, p_tool, 'grant', 'Granted from the team page.')
    on conflict (staff_slug, tool) do nothing;
  else
    delete from public.staff_tools where staff_slug = p_slug and tool = p_tool;
  end if;

  return jsonb_build_object('slug', p_slug, 'tool', p_tool, 'granted', p_granted);
end;
$$;

grant execute on function app.hq_staff_tool_set(text, text, boolean) to ai_team_app, service_role;

-- ---------------------------------------------------------------------------
-- Skills, on the same editor as the name and the remit
-- ---------------------------------------------------------------------------

-- 0090's lesson, applied rather than re-learned: `create or replace` with an
-- extra defaulted parameter creates a SECOND OVERLOAD, and then which one runs
-- depends on how the caller spells the arguments. Both existing signatures are
-- dropped by name before the new one is created.
drop function if exists public.hq_staff_update(text, text, text, text, text);
drop function if exists app.hq_staff_update(text, text, text, text, text);

/**
 * Edit a person: name, title, pronouns, remit, and now skills.
 *
 * `p_skills` is a comma-separated string because that is what a text input
 * gives you, and turning it into an array is this function's job rather than
 * the page's — 0071's rule, that a rule kept in one of two places is kept in
 * neither.
 */
create or replace function app.hq_staff_update(
  p_slug     text,
  p_name     text default null,
  p_title    text default null,
  p_pronouns text default null,
  p_remit    text default null,
  p_skills   text default null,
  p_style    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v jsonb;
  v_skills text[];
begin
  if not exists (select 1 from public.staff where slug = p_slug) then
    return jsonb_build_object('error', format('no one called %L', p_slug));
  end if;

  if p_name is not null and trim(p_name) ~ '\s' then
    return jsonb_build_object(
      'error', 'first names only — "' || trim(p_name) || '" has more than one word'
    );
  end if;
  if p_name is not null and coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('error', 'a name cannot be empty');
  end if;
  if p_pronouns is not null and p_pronouns not in ('she/her', 'he/him', 'they/them') then
    return jsonb_build_object('error', format('%L is not a pronoun set the generator knows', p_pronouns));
  end if;

  if p_skills is not null then
    select array_agg(x) into v_skills
      from (select distinct trim(s) as x
              from unnest(string_to_array(p_skills, ',')) as s
             where trim(s) <> '') q;
    if v_skills is null or array_length(v_skills, 1) = 0 then
      -- Emptying the list is allowed; sending only commas is a typo.
      if trim(p_skills) <> '' then
        return jsonb_build_object('error', 'skills must be a comma-separated list');
      end if;
      v_skills := array[]::text[];
    end if;
    if array_length(v_skills, 1) > 12 then
      -- A prompt listing thirty skills describes nobody. The cap is a writing
      -- constraint, not a storage one.
      return jsonb_build_object('error', 'twelve skills is the most that still describes a person');
    end if;
  end if;

  update public.staff
     set name       = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
         title      = coalesce(nullif(trim(coalesce(p_title, '')), ''), title),
         pronouns   = coalesce(nullif(trim(coalesce(p_pronouns, '')), ''), pronouns),
         responsibilities = coalesce(nullif(trim(coalesce(p_remit, '')), ''), responsibilities),
         communication_style =
           coalesce(nullif(trim(coalesce(p_style, '')), ''), communication_style),
         expertise  = coalesce(v_skills, expertise)
   where slug = p_slug
  returning jsonb_build_object('slug', slug, 'name', name, 'title', title,
                               'pronouns', pronouns, 'skills', expertise) into v;
  return v;
end;
$$;

create or replace function public.hq_staff_update(
  p_slug text, p_name text default null, p_title text default null,
  p_pronouns text default null, p_remit text default null,
  p_skills text default null, p_style text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_staff_update(p_slug, p_name, p_title, p_pronouns, p_remit, p_skills, p_style) $$;

revoke all on function public.hq_staff_update(text, text, text, text, text, text, text) from public;
grant execute on function public.hq_staff_update(text, text, text, text, text, text, text) to service_role;

create or replace function public.hq_staff_tools(p_slug text)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_staff_tools(p_slug) $$;

revoke all on function public.hq_staff_tools(text) from public;
grant execute on function public.hq_staff_tools(text) to service_role;

create or replace function public.hq_staff_tool_set(p_slug text, p_tool text, p_granted boolean)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_staff_tool_set(p_slug, p_tool, p_granted) $$;

revoke all on function public.hq_staff_tool_set(text, text, boolean) from public;
grant execute on function public.hq_staff_tool_set(text, text, boolean) to service_role;

commit;
