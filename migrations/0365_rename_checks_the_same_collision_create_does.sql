-- 0365 — hq_rename_project would let two live projects answer to one name.
--
-- Found by the project arc added to verify:identity for #224.
--
--   app.hq_create_project refuses a name a live project already holds.
--   app.hq_rename_project did not check at all.
--
-- The same collision, one door apart, and only one door was locked. Anyone
-- could reach the unlocked one from Project Settings, and the result is two
-- active projects with the same name and Grant routed to whichever the
-- resolver happened to rank first.
--
-- CLAUDE.md records the neighbouring shape twice and this is the third: 0282
-- loosened a constraint and left app.add_project_alias pre-checking the old
-- one, so both halves were correct alone and only their disagreement was
-- wrong. Here nothing was loosened - the check was simply never written on the
-- second writer. Grep for the OTHER function that writes the same thing.
--
-- Scoped to LIVE projects, matching 0282's reasoning exactly: an archived
-- project has released its name, and refusing a rename because a retired probe
-- once held the phrase is the bug 0282 spent a migration undoing. And a project
-- may of course be renamed to what it is already called - that is a no-op, not
-- a collision.
--
-- Case-insensitive and whitespace-insensitive, because "Coaching Course" and
-- "coaching course" are one name to a person and two rows to a database, and it
-- is the person being routed.

create or replace function app.hq_rename_project(p_slug text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_prefix text;
  v_id uuid;
  v_was text;
  v_fixture boolean;
  v_undo uuid;
  v_taken text;
begin
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('error', 'a project needs a name');
  end if;
  select project_id, name, is_fixture into v_id, v_was, v_fixture
    from public.projects where slug = p_slug;
  if v_id is null then
    return jsonb_build_object('error', format('no project %L', p_slug));
  end if;

  /*
    0365. The check hq_create_project has always had, on the writer that never
    did. Excludes this project so renaming to its own name stays a no-op, and
    excludes archived projects so a retired probe cannot hold a name hostage.
  */
  select p.slug into v_taken
    from public.projects p
   where p.project_id <> v_id
     and p.status <> 'archived'
     and lower(trim(p.name)) = lower(trim(p_name))
   limit 1;
  if v_taken is not null then
    return jsonb_build_object('error', format(
      '%L already belongs to the project %L, and two projects answering to one name '
      || 'is how work lands in the wrong place. Rename or archive that one first.',
      trim(p_name), v_taken));
  end if;

  v_prefix := left(trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')), 48);
  update public.projects
     set name = trim(p_name), channel_prefix = nullif(v_prefix, '')
   where project_id = v_id;

  -- The Slack channels follow, but not from here: renaming a channel is a
  -- Slack API call and this is SQL. The page reports that the rename is
  -- pending and the worker carries it out, rather than the page claiming a
  -- rename it cannot perform.
  --
  -- A fixture project has no channels, so there is nothing for the worker to
  -- do and the job would be real work queued against a project nobody can see.
  if not coalesce(v_fixture, false) then
    insert into public.jobs
      (correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
    values (gen_random_uuid(), v_id, format('rename-%s-%s', v_id, gen_random_uuid()),
            'office.rename_channels', 'hq', 300,
            jsonb_build_object('prefix', v_prefix));
  end if;

  -- The slug does not change on a rename, so the inverse addresses the same
  -- project. Undoing also enqueues a second rename job, which is right: the
  -- channels followed the name out and have to follow it back.
  if trim(p_name) is distinct from v_was then
    v_undo := app.undo_offer(
      'project.rename',
      format('Renamed to %s', trim(p_name)),
      jsonb_build_object('action', 'rename_project',
                         'args', jsonb_build_object('p_slug', p_slug, 'p_name', v_was)));
  end if;

  return jsonb_build_object(
    'slug', p_slug, 'name', trim(p_name), 'channel_prefix', v_prefix,
    'undo', v_undo,
    'note', case when coalesce(v_fixture, false)
                 then 'a fixture project has no channels to rename'
                 else 'channels will be renamed by the worker on its next pass' end
  );
end;
$function$;
