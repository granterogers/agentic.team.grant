/*
  0403 - a fixture specialist nobody ever worked through can be removed (#269).

  276 rows in public.staff and 268 of them are retired harness specialists:
  fixture-specialist-*, fixture-dutyowner-*, fixture-promptsubject-*, three per
  run of the suites that convene a temporary person. Grant's Team page is
  correct and always has been - hq_team() filters active, and every one of the
  268 is active = false - so nothing is wrong today.

  What is wrong is the trend. The roster is 97% debris and grows by three rows
  a run, and every reader that forgets the filter shows Grant nonsense. That is
  not hypothetical: impediments_tally, undelivered(), provider_health and the
  Governance page have each been caught reading harness rows as real, and each
  time the fix came after he saw it.

  #269 offered two options. This is the first - let a fixture specialist be
  deletable - because it is the only one that stops the table growing. The
  second (a staff_live view) is cheaper and does nothing about the count.

  WHY A DELETE IS SAFE HERE AND IS NOT SAFE FOR A REAL PERSON

  app.retire_skill is the model this repository uses: withdraw, never remove,
  and assert the subject is no longer LIVE rather than that the row is gone.
  That is right for anybody who has done work, because the work has to keep
  naming who did it. It is precisely why purge:fixtures only ever set
  active = false here, and why a fixture specialist is permanent by
  construction.

  The narrow case this opens is a row that has done NOTHING. 19 foreign keys
  point at public.staff; 16 of them restrict, so a fixture specialist who
  consulted, delivered, produced an output, learned a lesson, held a skill,
  owned a duty, was addressed, was mapped to a Slack discipline, held a bot,
  asked for a tool or hit an impediment CANNOT be deleted - the database
  refuses, and the history keeps its author. Only a row nobody ever worked
  through comes out.

  0360 is the cautionary tale and its lesson is followed rather than
  restated: a sweep must continue past one failure and say how many it could
  not remove and what held them, because a sweep that stops early looks
  exactly like a sweep that finished.

  Three rows cannot be relied on to refuse, so they are checked by hand first:
  proposals and staff_tools CASCADE, and tasks.assignee_staff is SET NULL. A
  fixture specialist with a proposal or a tool grant has done something, and
  cascading that away would be losing history quietly; a task assigned to one
  is Grant's task and must not silently lose its assignee.
*/

-- is_fixture, derived, the same way it is derived everywhere else. GENERATED
-- so it may only reference its own row - which is the whole reason 0355 had to
-- derive the job version in a function instead - and here the slug is enough.
alter table public.staff
  add column if not exists is_fixture boolean
  generated always as (
    slug like 'fixture-%' or slug like 'verify-%' or slug like 'probe-%'
  ) stored;

comment on column public.staff.is_fixture is
  'Derived from the slug. A harness specialist, never a person on the roster.';

create or replace function app.purge_fixture_staff(p_go boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_removed int := 0;
  v_held jsonb := '[]'::jsonb;
  v_holder text;
begin
  for v_row in
    select slug, name from public.staff
     where is_fixture and not active and not permanent
     order by slug
  loop
    /*
      The three keys that do not refuse. Checked before attempting the delete
      rather than after, because a cascade has already happened by the time
      you could look.
    */
    v_holder := null;
    if exists (select 1 from public.proposals p where p.staff_slug = v_row.slug) then
      v_holder := 'proposals';
    elsif exists (select 1 from public.staff_tools t where t.staff_slug = v_row.slug) then
      v_holder := 'staff_tools';
    elsif exists (select 1 from public.tasks t where t.assignee_staff = v_row.slug) then
      v_holder := 'tasks';
    end if;

    if v_holder is not null then
      v_held := v_held || jsonb_build_object('slug', v_row.slug, 'held_by', v_holder);
      continue;
    end if;

    if not p_go then
      v_removed := v_removed + 1;
      continue;
    end if;

    /*
      Attempted one at a time inside its own block, so one refusal does not
      abandon the rest of the sweep. The message names what held the row -
      0360 turned a raised 23503 out of a SECURITY DEFINER function into a
      sentence for exactly this reason.
    */
    begin
      delete from public.staff where slug = v_row.slug;
      v_removed := v_removed + 1;
    exception when foreign_key_violation then
      v_held := v_held || jsonb_build_object(
        'slug', v_row.slug,
        'held_by', coalesce(nullif(split_part(SQLERRM, '"', 4), ''), 'a table that names it')
      );
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'went', p_go,
    'removed', v_removed,
    'could_not_remove', jsonb_array_length(v_held),
    'held', v_held,
    'still_fixture', (select count(*) from public.staff where is_fixture)
  );
end;
$$;

comment on function app.purge_fixture_staff(boolean) is
  'Remove harness specialists nobody ever worked through. Reports what it could not remove and why. #269';

-- PostgREST only exposes public, and every app.* RPC needs a wrapper.
create or replace function public.purge_fixture_staff(p_go boolean default false)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select app.purge_fixture_staff(p_go) $$;

revoke all on function public.purge_fixture_staff(boolean) from public, anon;
