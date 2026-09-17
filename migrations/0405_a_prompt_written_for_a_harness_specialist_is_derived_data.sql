/*
  0405 - a prompt written FOR a harness specialist is derived data (#269).

  0403/0404's sweep took 213 of the 276 staff rows and was refused on 55, and
  every single one of the 55 was held by the same table: staff_prompts.

  That is worth reading before widening anything. The 16 restricting foreign
  keys are the safety of this whole sweep, and the right instinct on seeing a
  refusal is that the row did something. Here it did not. staff_prompts is the
  prompt the office GENERATED FOR a specialist at the moment it convened them -
  it is written before the specialist has done anything at all, and for these
  55 nothing followed, because every other key refused nothing.

  So it belongs with the briefs and cached sources purge-fixtures already
  deletes first: derived data with no value once the fixture is gone. The
  distinction that matters is the one the restricting keys draw and this does
  not blur - an output, a consultation, a delivery, a lesson, a skill, a duty,
  an impediment or a tool request is WORK, names its author for ever, and
  still refuses.

  Narrow on purpose: only prompts belonging to a row is_fixture already says is
  harness. A real director's prompt history is versioned and is the record of
  how their instructions changed; deleting one would be losing exactly the
  thing 0177 and 0303 warn about.
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
    -- The three keys that do not refuse - two CASCADE and one SET NULL - so a
    -- row they hold is excluded BEFORE the delete is attempted, because by the
    -- time you could look the cascade has happened. assignee_staff is a uuid
    -- however its name reads (0404).
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

    begin
      -- The prompt written for this specialist, which is derived data and the
      -- only thing that held the last 55. Scoped to this row, inside the same
      -- attempt, so a specialist that some OTHER table still names keeps its
      -- prompt along with everything else.
      delete from public.staff_prompts where staff_id = v_row.staff_id;
      delete from public.staff where staff_id = v_row.staff_id;
      v_removed := v_removed + 1;
    exception when foreign_key_violation then
      /*
        The prompt delete is rolled back with the staff delete by this block,
        so a specialist that something else names keeps both. That is what
        makes deleting the prompt first safe rather than a widening: it is
        undone unless the whole removal succeeds.
      */
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
