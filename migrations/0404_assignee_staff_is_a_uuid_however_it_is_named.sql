/*
  0404 - tasks.assignee_staff is a uuid, whatever its name says (#269).

  0403's pre-flight compared it to a SLUG and the function raised
  "operator does not exist: uuid = text" on its first dry run. The column is
  named staff_slug on proposals and staff_tools, which are text, and
  assignee_staff on tasks, which references staff.staff_id and is a uuid.

  Straight into the trap CLAUDE.md names first among the database ones:
  guessing a column wastes hours, query information_schema. The name was read
  as the type and the two disagree - the same shape as jobs.state not being
  status, one layer over.

  The failure was the cheap direction: it raised rather than matching nothing,
  and a pre-flight that silently matched nothing would have let a cascade
  through. Nothing had been deleted - the dry run never reaches the delete -
  so this corrects the function before it has ever removed a row.
*/

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
    select staff_id, slug, name from public.staff
     where is_fixture and not active and not permanent
     order by slug
  loop
    /*
      The three keys that do not refuse - two CASCADE and one SET NULL - so a
      row they hold has to be excluded BEFORE the delete is attempted rather
      than after, because by the time you could look the cascade has happened.

      proposals.staff_slug and staff_tools.staff_slug are text and match the
      slug. tasks.assignee_staff is a uuid and matches staff_id, which is what
      0403 got wrong.
    */
    v_holder := null;
    if exists (select 1 from public.proposals p where p.staff_slug = v_row.slug) then
      v_holder := 'proposals';
    elsif exists (select 1 from public.staff_tools t where t.staff_slug = v_row.slug) then
      v_holder := 'staff_tools';
    elsif exists (select 1 from public.tasks t where t.assignee_staff = v_row.staff_id) then
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

    -- One at a time in its own block, so one refusal does not abandon the
    -- sweep. 0360: a sweep that stops early looks exactly like one that
    -- finished.
    begin
      delete from public.staff where staff_id = v_row.staff_id;
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
