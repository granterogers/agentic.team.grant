-- 0266 — a fixture project has no channels to rename
--
-- `app.hq_rename_project` enqueues an `office.rename_channels` job on every
-- rename, because the Slack channels have to follow the name and renaming a
-- channel is an API call that SQL cannot make. That is right for a real
-- dashboard project.
--
-- It is wrong for a fixture. A fixture project has no Slack channels, so the
-- job has nothing to do, and it is queued as REAL work: `jobs.is_fixture` is
-- generated from `requested_by` and `kind`, and this one is requested by 'hq'
-- with an ordinary kind. So every rename in a verification run puts a genuine
-- job in front of the worker and a genuine row in Grant's activity feed, for a
-- project he cannot see.
--
-- Found by `verify:inverse`, and found the way these things usually are — not
-- by anything failing loudly, but by the suite's own teardown hitting
-- `jobs_project_id_fkey` and being unable to remove its subject. Jobs cannot be
-- deleted either: `job_state_transitions` is append-only by §6 and has a
-- foreign key to `jobs`, so a job can only ever be cancelled. A suite that
-- leaves cancelled real jobs behind on every run is a suite that pollutes the
-- thing it is measuring.
--
-- One condition. Everything else in the function is unchanged, reproduced from
-- `pg_get_functiondef` rather than from memory.

begin;

create or replace function app.hq_rename_project(p_slug text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_prefix text;
  v_id uuid;
  v_was text;
  v_fixture boolean;
  v_undo uuid;
begin
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('error', 'a project needs a name');
  end if;
  select project_id, name, is_fixture into v_id, v_was, v_fixture
    from public.projects where slug = p_slug;
  if v_id is null then
    return jsonb_build_object('error', format('no project %L', p_slug));
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

commit;
