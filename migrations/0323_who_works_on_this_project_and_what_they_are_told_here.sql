begin;

/**
 * Who works on this project, and what they are told here.
 *
 * Issue #36, under #25. The first two of Project Settings' six sections —
 * Team / permissions, and Agent configuration — which are one table because
 * they are one fact: a per-project instruction belongs on the row that says
 * the person is on the project.
 *
 * ## Absence means everyone, and that is the whole design
 *
 * A project with no rows here is a project the whole office works on. The
 * table records DEPARTURES from that default, not the roster itself.
 *
 * The alternative — an explicit roster per project — is the shape that breaks
 * on the day it ships: adding the table would take every agent off every one
 * of Grant's four projects until somebody filled it in, and the symptom is
 * work quietly not being done. Same argument as 0177's about a sentinel
 * connector, and 0284's about a NOT NULL column defaulting to the empty
 * string: a default that satisfies the schema and lies about the world is
 * worse than no column.
 *
 * So a row here means "a decision was taken about this person on this
 * project", in either direction. `active = false` is Grant taking someone off;
 * `active = true` is him putting them back, recorded rather than deleted so
 * the decision survives.
 *
 * ## And it takes effect
 *
 * #36 asks for this in as many words: *"Which agents work on this project is
 * configurable AND TAKES EFFECT."* A setting nothing reads is #64 with the
 * sign reversed — Grant told YES about something that does not happen — and
 * this file has the cost of that recorded twice. `app.staff_on_project` is
 * read by the router when it picks a roster (`pickRoster`'s fourth argument),
 * and `app.project_instruction_for` is read when an agent's prompt is built.
 */

create table if not exists public.project_staff (
  project_id  uuid        not null references public.projects (project_id) on delete cascade,
  staff_id    uuid        not null references public.staff (staff_id),
  /*
    On or off this project. See the header: a row is a DECISION, not a
    membership, so `true` is meaningful and is not merely the absence of
    `false`.
  */
  active      boolean     not null default true,
  /**
   * What this person is told when they work here.
   *
   * Per project because that is the whole point: Legacy Coaching wants a
   * different Emma from AI Learning. Applied ON TOP of `staff_prompts`, never
   * instead of it — an agent's identity is global and their brief is local,
   * and a per-project prompt that REPLACED the global one would let a
   * one-line note delete §12.
   */
  instruction text        not null default '',
  decided_by  text        not null default 'grant',
  decided_at  timestamptz not null default app.now_utc(),
  primary key (project_id, staff_id)
);

alter table public.project_staff enable row level security;

comment on table public.project_staff is
  '#36. A DECISION about one staff member on one project — off it, back on it, '
  'or given a local brief. No row means the default, which is that the whole '
  'office works on every project: an explicit roster would have taken all '
  'eight off all four projects the day it shipped. 0323.';

-- ---------------------------------------------------------------------------
-- Reading it
-- ---------------------------------------------------------------------------

/**
 * The slugs of everyone who works on this project.
 *
 * Left join from `staff`, so the default falls out of the query rather than
 * being a branch somebody has to remember: a person with no row is included,
 * a person whose row says false is not.
 *
 * The Chief of Staff is never excluded. She is the one who takes work nobody
 * else can, she narrates the floor, and she is the only person Grant hears
 * from (`telegram.only_chief_speaks`) — a project she is off is a project that
 * cannot report to him. Enforced here rather than in the writer as well,
 * because a rule stated in one place is a rule.
 */
create or replace function app.staff_on_project(p_project_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.slug order by s.slug), array[]::text[])
    from public.staff s
    left join public.project_staff ps
      on ps.staff_id = s.staff_id and ps.project_id = p_project_id
   where s.active
     and (s.slug = 'chief-of-staff' or coalesce(ps.active, true))
$$;

comment on function app.staff_on_project is
  '#36. Who may be convened for this project. A staff member with no row is '
  'included — see the table comment. The Chief of Staff cannot be excluded: '
  'she is the only person Grant hears from. 0323.';

/**
 * The whole team of a project, as the settings page needs it.
 *
 * Everyone, with a flag, rather than only those who are on — because the page
 * is a set of switches and a switch you cannot see is a switch you cannot
 * turn back on.
 */
create or replace function app.project_team(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(t.v order by t.ord, t.name), '[]'::jsonb)
    from (
      select case when s.slug = 'chief-of-staff' then 0 else 1 end as ord,
             s.name,
             jsonb_build_object(
               'slug', s.slug,
               'name', s.name,
               'title', s.title,
               'avatar', s.avatar_ref,
               'on', (s.slug = 'chief-of-staff' or coalesce(ps.active, true)),
               -- Said plainly, because a switch that cannot move needs to
               -- explain itself rather than merely refuse.
               'fixed', s.slug = 'chief-of-staff',
               'why_fixed', case when s.slug = 'chief-of-staff'
                                 then 'She is the only person who messages you.' end,
               'instruction', coalesce(ps.instruction, ''),
               -- Whether a DECISION exists, which is not the same as being on.
               -- The page draws a default differently from a choice.
               'decided', ps.staff_id is not null,
               'decided_by', ps.decided_by,
               'decided_at', ps.decided_at
             ) as v
        from public.staff s
        left join public.project_staff ps
          on ps.staff_id = s.staff_id and ps.project_id = p_project_id
       where s.active
    ) t
$$;

/**
 * The local brief for one person on one project, or the empty string.
 *
 * Separate from `project_team` because the prompt builder wants one string and
 * should not have to walk a JSON array to find it.
 */
create or replace function app.project_instruction_for(p_project_id uuid, p_staff_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select ps.instruction
       from public.project_staff ps
       join public.staff s on s.staff_id = ps.staff_id
      where ps.project_id = p_project_id and s.slug = p_staff_slug),
    '')
$$;

-- ---------------------------------------------------------------------------
-- Changing it
-- ---------------------------------------------------------------------------

/**
 * Take someone off a project, or put them back.
 *
 * Takes slugs, for the reason `add_project_reference` does: the caller has
 * them, and a caller that has to look an id up is a caller that can look up
 * the wrong one.
 *
 * Refuses to remove the Chief of Staff, and says why. A refusal with a reason
 * is a sentence the page can show; a silent no-op is a switch that springs
 * back with no explanation.
 */
create or replace function app.set_project_staff(
  p_slug text, p_staff_slug text, p_on boolean, p_by text default 'grant')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_staff   uuid;
  v_name    text;
begin
  select project_id into v_project
    from public.projects where slug = p_slug and status <> 'archived';
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no active project called %s', p_slug));
  end if;

  select staff_id, name into v_staff, v_name
    from public.staff where slug = p_staff_slug and active;
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', format('nobody here is called %s', p_staff_slug));
  end if;

  if p_staff_slug = 'chief-of-staff' and not p_on then
    return jsonb_build_object(
      'ok', false, 'refused', true,
      'error', 'The Chief of Staff is on every project — she is the only person who messages you.');
  end if;

  insert into public.project_staff (project_id, staff_id, active, decided_by)
  values (v_project, v_staff, p_on, p_by)
  on conflict (project_id, staff_id)
  do update set active = excluded.active,
                decided_by = excluded.decided_by,
                decided_at = app.now_utc();

  return jsonb_build_object('ok', true, 'staff', p_staff_slug, 'name', v_name, 'on', p_on);
end;
$$;

/**
 * Give someone a brief for this project, or clear it.
 *
 * An empty string clears it and the row stays: the row records that a decision
 * was taken here, and deleting it on an empty brief would also silently put
 * back an agent Grant had taken off.
 */
create or replace function app.set_project_instruction(
  p_slug text, p_staff_slug text, p_instruction text, p_by text default 'grant')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_staff   uuid;
  v_text    text := btrim(coalesce(p_instruction, ''));
begin
  select project_id into v_project
    from public.projects where slug = p_slug and status <> 'archived';
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no active project called %s', p_slug));
  end if;

  select staff_id into v_staff from public.staff where slug = p_staff_slug and active;
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', format('nobody here is called %s', p_staff_slug));
  end if;

  -- A brief long enough to be a brief. Two words is a note to self, and it
  -- would be pasted into a prompt where it can only confuse.
  if v_text <> '' and length(v_text) < 12 then
    return jsonb_build_object(
      'ok', false,
      'error', 'A brief needs to be a sentence — that is going into what they are told.');
  end if;

  insert into public.project_staff (project_id, staff_id, instruction, decided_by)
  values (v_project, v_staff, v_text, p_by)
  on conflict (project_id, staff_id)
  do update set instruction = excluded.instruction,
                decided_by = excluded.decided_by,
                decided_at = app.now_utc();

  return jsonb_build_object('ok', true, 'staff', p_staff_slug,
                            'cleared', v_text = '', 'instruction', v_text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers. PostgREST exposes only `public`.
-- ---------------------------------------------------------------------------

create or replace function public.staff_on_project(p_project_id uuid)
returns text[] language sql stable security definer set search_path = public, pg_catalog
as $$ select app.staff_on_project(p_project_id) $$;

create or replace function public.project_team(p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.project_team(p_project_id) $$;

create or replace function public.project_instruction_for(p_project_id uuid, p_staff_slug text)
returns text language sql stable security definer set search_path = public, pg_catalog
as $$ select app.project_instruction_for(p_project_id, p_staff_slug) $$;

create or replace function public.set_project_staff(
  p_slug text, p_staff_slug text, p_on boolean, p_by text default 'grant')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.set_project_staff(p_slug, p_staff_slug, p_on, p_by) $$;

create or replace function public.set_project_instruction(
  p_slug text, p_staff_slug text, p_instruction text, p_by text default 'grant')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.set_project_instruction(p_slug, p_staff_slug, p_instruction, p_by) $$;

grant execute on function app.staff_on_project(uuid) to ai_team_app;
grant execute on function public.staff_on_project(uuid) to ai_team_app;
grant execute on function app.project_team(uuid) to ai_team_app;
grant execute on function public.project_team(uuid) to ai_team_app;
grant execute on function app.project_instruction_for(uuid, text) to ai_team_app;
grant execute on function public.project_instruction_for(uuid, text) to ai_team_app;
grant execute on function app.set_project_staff(text, text, boolean, text) to ai_team_app;
grant execute on function public.set_project_staff(text, text, boolean, text) to ai_team_app;
grant execute on function app.set_project_instruction(text, text, text, text) to ai_team_app;
grant execute on function public.set_project_instruction(text, text, text, text) to ai_team_app;

commit;
