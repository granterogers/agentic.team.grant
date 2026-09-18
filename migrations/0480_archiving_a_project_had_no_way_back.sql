/*
  0480 — archiving a project had no way back.

  `app.unarchive_project` has existed and been bound at the gateway as
  `project_unarchive` since the project work, and nothing in `web/` named it
  (#276): a dashboard project Grant archived by mistake could only be brought
  back from SQL. `app.archive_project` is a control he has on the Project
  Settings page, so the one-way door is one he can walk through.

  ## Two paths, because there are two mistakes

  1. **Just now.** Archiving records an undoable action, so the undo strip
     #118 already draws offers to put it back. This is the common case and it
     needs no list, no search and no judgement about what belongs on one.
  2. **A while ago.** `app.recoverable_projects()` is the list, and the
     predicate is the interesting part.

  ## What belongs on a recovery list

  926 projects in this database are archived and **not one of them holds a
  single document, task or contact.** They are the debris pile CLAUDE.md
  records again and again: a suite creates a project, the teardown cannot
  delete it because it gathered a job, and archiving is what teardown does
  instead. So "every archived project" is a list of 926 test subjects, and
  showing Grant that is the harness-traffic-as-failure defect on the surface
  built to help him recover from a mistake.

  Filtering by NAME is the answer that does not work, and this file has three
  migrations saying so: `app.harness_label` catches `fixture-`, `verify-`,
  `probe-`, `gate-` and `ledger-proof-`, and the pile is full of
  `identity-proof-`, `unified-proof-`, `artifact-proof-`, `newsroom-` and
  `settings-proof-`, because #45 sends any suite testing a feature that
  FILTERS fixtures to use a name that is not one. The next suite picks a sixth
  word nobody listed.

  The structural property is the one the measurement above found: **a project
  worth recovering is one that HELD something.** A document, a task or a
  contact. It is derived rather than named, it cannot go stale, and it is true
  of every project Grant would miss and of none of the 926 — so the list is
  empty today, correctly, and the first row it ever shows will be a real one.

  A harness name is still excluded on top of it, because a suite that writes a
  document into its own fixture project would otherwise arrive.
*/

-- ---------------------------------------------------------------------------
-- The reader
-- ---------------------------------------------------------------------------

create or replace function app.recoverable_projects(p_limit integer default 12)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', x.slug,
           'name', x.name,
           'purpose', x.purpose,
           'archived_at', x.updated_at,
           'held', x.held
         ) order by x.updated_at desc), '[]'::jsonb)
    from (
      select p.slug, p.name, p.purpose, p.updated_at,
             (select count(*) from public.documents d where d.project_id = p.project_id)
             + (select count(*) from public.tasks t where t.project_id = p.project_id)
             + (select count(*) from public.contacts c where c.project_id = p.project_id)
               as held
        from public.projects p
       where p.status = 'archived'
         and not p.is_fixture
         and not app.harness_label(p.slug)
       order by p.updated_at desc
    ) x
   where x.held > 0
   limit greatest(coalesce(p_limit, 12), 1)
$function$;

create or replace function public.recoverable_projects(p_limit integer default 12)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$ select app.recoverable_projects(p_limit) $function$;

revoke all on function public.recoverable_projects(integer) from public;
grant execute on function public.recoverable_projects(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Archiving offers the way back
-- ---------------------------------------------------------------------------

create or replace function app.archive_project(p_slug text, p_by text default 'grant')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_project uuid; v_name text; v_stopped int; v_undo uuid;
begin
  select project_id, name into v_project, v_name
    from public.projects where slug = p_slug;
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no project called %s', p_slug));
  end if;

  update public.projects set status = 'archived' where project_id = v_project;

  update public.responsibilities
     set enabled = false, updated_at = app.now_utc()
   where project_id = v_project and enabled;
  get diagnostics v_stopped = row_count;

  /*
    The way back, offered at the moment it still knows what it changed.

    Ten minutes rather than the default two: archiving a project is not a
    typo in a title, and the realisation that it was the wrong one tends to
    arrive after looking for it somewhere else. `undo_offer` returns null while
    a reversal is being performed, so an undo of an undo is not a feature and
    nothing here has to know that.

    It does NOT restore the automations this call stopped. `unarchive_project`
    is explicit that they stay off and says which ones, because a duty that
    starts running again without being asked is a worse surprise than one that
    does not.
  */
  v_undo := app.undo_offer(
    'project_archive',
    format('archived %s', v_name),
    jsonb_build_object('action', 'unarchive_project',
                       'args', jsonb_build_object('p_slug', p_slug)),
    10);

  return jsonb_build_object(
    'ok', true, 'archived', p_slug, 'name', v_name, 'automations_stopped', v_stopped,
    'reversible', true, 'undo', v_undo);
end;
$function$;

-- ---------------------------------------------------------------------------
-- And `hq_undo` learns the verb, in the same migration that starts offering it
-- ---------------------------------------------------------------------------

/*
  Spliced from the LIVE definition rather than transcribed: the function is
  long, CLAUDE.md records what rewriting one from memory costs (`pause_job`
  lost four behaviours in one go), and `pg_get_functiondef` emits no trailing
  semicolon — twice paid for, so the concatenation supplies one.
*/
do $splice$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'hq_undo';
  if v_def is null then
    raise exception '0480: app.hq_undo is not there to splice';
  end if;
  if position('unarchive_project' in v_def) > 0 then
    raise notice '0480: hq_undo already knows the verb';
    return;
  end if;
  if position('when ''reattach'' then' in v_def) = 0 then
    raise exception '0480: the splice point moved — hq_undo has been rewritten';
  end if;
  v_def := replace(v_def,
    'when ''reattach'' then',
    'when ''unarchive_project'' then' || chr(10) ||
    '      v_did := app.unarchive_project(v_args ->> ''p_slug'');' || chr(10) ||
    '    when ''reattach'' then');
  execute v_def || ';';
end $splice$;

-- ---------------------------------------------------------------------------
-- Drive all three. A migration that applies cleanly is not a function that
-- works, and 0390 shipped four defects in one feature by not doing this.
-- ---------------------------------------------------------------------------

do $drive$
declare
  /*
    NOT a fixture name. The reader deliberately excludes harness-labelled
    slugs, so driving it with one asserts against the filter rather than
    against the feature — #45's rule, and the first run of this drive failed
    on exactly that. The row is created and removed inside this block.
  */
  v_slug text := 'recovery-drive-' || substr(md5(random()::text), 1, 8);
  v_project uuid;
  v_archived jsonb;
  v_undone jsonb;
  v_list jsonb;
  v_status text;
begin
  insert into public.projects (slug, name, purpose, status)
  values (v_slug, 'Recovery drive', 'Rolled back inside 0480', 'active')
  returning project_id into v_project;

  insert into public.tasks (project_id, title, state)
  values (v_project, 'Something it held', 'todo');

  v_archived := app.archive_project(v_slug);
  if coalesce(v_archived ->> 'ok', 'false') <> 'true' then
    raise exception '0480: archiving refused — %', v_archived;
  end if;
  if v_archived ->> 'undo' is null then
    raise exception '0480: archiving offered no way back';
  end if;

  -- The list finds a project that held something, whatever it is called.
  v_list := app.recoverable_projects(200);
  if not exists (select 1 from jsonb_array_elements(v_list) e
                  where e ->> 'slug' = v_slug) then
    raise exception '0480: a project that held a task is not on the recovery list';
  end if;

  -- And the offer can actually be spent.
  v_undone := app.hq_undo((v_archived ->> 'undo'));
  if coalesce(v_undone ->> 'ok', 'false') <> 'true' then
    raise exception '0480: the undo could not be performed — %', v_undone;
  end if;
  select status into v_status from public.projects where slug = v_slug;
  if v_status <> 'active' then
    raise exception '0480: undone, and the project is still %', v_status;
  end if;

  -- CONTROL: once it is active again it is not on a list of things to recover.
  v_list := app.recoverable_projects(200);
  if exists (select 1 from jsonb_array_elements(v_list) e where e ->> 'slug' = v_slug) then
    raise exception '0480: an active project is offered for recovery';
  end if;

  raise notice '0480: archive, list and undo all drove clean';

  -- The request first: spending the offer writes an `undo_requests` row that
  -- references it, and the first run of this drive learned that by violating
  -- the foreign key.
  delete from public.undo_requests where action_id = (v_archived ->> 'undo')::uuid;
  delete from public.undoable_actions where action_id = (v_archived ->> 'undo')::uuid;
  delete from public.tasks where project_id = v_project;
  delete from public.project_switches where project_id = v_project;
  delete from public.events where project_id = v_project;
  delete from public.projects where project_id = v_project;
end $drive$;
