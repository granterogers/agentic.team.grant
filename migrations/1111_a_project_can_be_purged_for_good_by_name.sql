-- 1111 — a project can be purged for good, by typing its name (21 November 2026)
--
-- ADR-0077 replaces "a project is archived, not deleted" (ADR-0022) for the one case its owner asks for: the project is
-- removed with everything that is STORED HERE for it (documents, tasks, contacts, jobs and their outputs, decisions, the
-- activity rows that refer to it). Files that live in Google, Notion, Slack and the like are not touched: only what is
-- held in this database and in this office's storage is removed.
--
-- Three things make this a deliberate exception rather than a plain delete:
--   1. The activity ledger is append-only and refers to projects (migration 1105 records each project's creation). The
--      purge therefore switches the append-only triggers of the tables it removes from OFF for this one transaction, and
--      switches them back ON before it commits. Nothing else is switched.
--   2. The caller must type the project's exact name. A reserved project (the catch-all) cannot be purged.
--   3. One purge entry is written to the activity ledger with no project link, naming the project and the counts, so the
--      record that it happened survives.
--
-- The purge is one transaction. If any row is still held when it is finished, it raises and nothing is removed. Storage
-- files are not in the database: the gateway removes the paths returned here AFTER this commits (a failed file removal is
-- reported, and the paths can be removed again; the rows are already gone).

-- The WHERE clause that selects one table's rows belonging to a project, or null if the table has no link to a project.
-- A row belongs to the project if it carries the project's id, or if a single-column foreign key points at a row that
-- does (for example a task's job, or an output's job).
create or replace function app.project_purge_where(p_rel oid, p_project uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_parts text[] := '{}';
  v_fk record;
begin
  if exists (select 1 from pg_attribute a
              where a.attrelid = p_rel and a.attname = 'project_id' and a.attnum > 0 and not a.attisdropped) then
    v_parts := v_parts || format('project_id = %L', p_project);
  end if;
  for v_fk in
    select a.attname as col, c.confrelid as parent, rf.attname as refcol
      from pg_constraint c
      join pg_attribute a  on a.attrelid  = c.conrelid  and a.attnum  = c.conkey[1]
      join pg_attribute rf on rf.attrelid = c.confrelid and rf.attnum = c.confkey[1]
     where c.conrelid = p_rel
       and c.contype = 'f'
       and array_length(c.conkey, 1) = 1
       and exists (select 1 from pg_attribute pa
                    where pa.attrelid = c.confrelid and pa.attname = 'project_id' and pa.attnum > 0 and not pa.attisdropped)
  loop
    v_parts := v_parts || format('%I in (select %I from %s where project_id = %L)',
                                 v_fk.col, v_fk.refcol, v_fk.parent::regclass, p_project);
  end loop;
  if array_length(v_parts, 1) is null then return null; end if;
  return array_to_string(v_parts, ' or ');
end;
$$;

revoke all on function app.project_purge_where(oid, uuid) from public, anon, authenticated;

-- What a purge would remove, by table, and the storage paths it would leave behind. Changes nothing.
create or replace function app.hq_project_purge_plan(p_office uuid, p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v_name text;
  v_reserved text;
  v_t record;
  v_where text;
  v_n bigint;
  v_counts jsonb := '{}';
  v_total bigint := 0;
  v_files bigint;
begin
  perform app.require_office(p_office);
  select project_id, name, reserved_reason into v_id, v_name, v_reserved
    from public.projects where slug = p_slug and office_id = p_office;
  if v_id is null then
    return jsonb_build_object('error', format('no project %L in this office', p_slug));
  end if;
  if v_reserved is not null then
    return jsonb_build_object('error', format('%s is reserved and cannot be deleted.', p_slug));
  end if;
  for v_t in
    select c.oid as rel, c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  loop
    v_where := app.project_purge_where(v_t.rel, v_id);
    if v_where is null then continue; end if;
    execute format('select count(*) from public.%I where %s', v_t.name, v_where) into v_n;
    if v_n > 0 then
      v_counts := v_counts || jsonb_build_object(v_t.name, v_n);
      v_total := v_total + v_n;
    end if;
  end loop;
  select count(*) into v_files from public.documents where project_id = v_id and storage_path is not null;
  return jsonb_build_object(
    'project', v_name,
    'rows', v_total,
    'counts', v_counts,
    'stored_files', v_files
  );
end;
$$;

-- The purge itself. Returns the storage paths the gateway must remove, and the counts that were removed.
create or replace function app.hq_project_purge(p_office uuid, p_slug text, p_typed text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v_name text;
  v_reserved text;
  v_t record;
  v_where text;
  v_n bigint;
  v_pass int := 0;
  v_progress bigint;
  v_counts jsonb := '{}';
  v_paths text[];
  v_left bigint;
  v_total bigint := 0;
begin
  perform app.require_office(p_office);
  select project_id, name, reserved_reason into v_id, v_name, v_reserved
    from public.projects where slug = p_slug and office_id = p_office;
  if v_id is null then
    return jsonb_build_object('error', format('no project %L in this office', p_slug));
  end if;
  if v_reserved is not null then
    return jsonb_build_object('error', format('%s is reserved and cannot be deleted.', p_slug));
  end if;
  if btrim(coalesce(p_typed, '')) <> btrim(v_name) then
    return jsonb_build_object('error', format('The name typed does not match. Type exactly: %s', v_name));
  end if;

  -- The stored files, read before any row goes: the gateway removes them after this commits.
  select coalesce(array_agg(d.storage_path), '{}') into v_paths
    from public.documents d where d.project_id = v_id and d.storage_path is not null;

  -- What is held, counted BEFORE anything goes. Some rows leave by a cascade from the project's own foreign keys, and a
  -- count of deletes alone would miss them; the record and the reply say what was held, which is what was removed.
  for v_t in
    select c.oid as rel, c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  loop
    v_where := app.project_purge_where(v_t.rel, v_id);
    if v_where is null then continue; end if;
    execute format('select count(*) from public.%I where %s', v_t.name, v_where) into v_n;
    if v_n > 0 then
      v_counts := v_counts || jsonb_build_object(v_t.name, v_n);
    end if;
  end loop;

  -- Switch the user triggers (the append-only guards among them) off for the tables this purge removes from.
  for v_t in
    select c.oid as rel, c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    if app.project_purge_where(v_t.rel, v_id) is not null then
      execute format('alter table public.%I disable trigger user', v_t.name);
    end if;
  end loop;

  -- Remove, in passes: a row a foreign key still holds waits for a later pass, when the row it depends on has gone.
  loop
    v_progress := 0;
    v_pass := v_pass + 1;
    for v_t in
      select c.oid as rel, c.relname as name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by c.relname
    loop
      v_where := app.project_purge_where(v_t.rel, v_id);
      if v_where is null then continue; end if;
      begin
        execute format('delete from public.%I where %s', v_t.name, v_where);
        get diagnostics v_n = row_count;
        v_progress := v_progress + v_n;
      exception when foreign_key_violation then
        null; -- still held by a row in another table: a later pass
      end;
    end loop;
    exit when v_progress = 0 or v_pass >= 25;
  end loop;

  -- Anything still held is a reason to stop, not to guess: raise, and the whole purge rolls back.
  for v_t in
    select c.oid as rel, c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    v_where := app.project_purge_where(v_t.rel, v_id);
    if v_where is null then continue; end if;
    execute format('select count(*) from public.%I where %s', v_t.name, v_where) into v_left;
    if v_left > 0 then
      raise exception 'purge stopped: % row(s) in % still refer to %, and nothing was removed', v_left, v_t.name, v_name
        using errcode = 'P0001';
    end if;
  end loop;

  -- The project row itself. A foreign key still holding it raises here, and the whole purge rolls back.
  delete from public.projects where project_id = v_id;
  v_counts := v_counts || jsonb_build_object('projects', 1);

  -- Switch the triggers back on before anything else in this transaction.
  for v_t in
    select c.oid as rel, c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    if app.project_purge_where(v_t.rel, v_id) is not null then
      execute format('alter table public.%I enable trigger user', v_t.name);
    end if;
  end loop;

  for v_n in select (value)::bigint from jsonb_each_text(v_counts) loop
    v_total := v_total + v_n;
  end loop;

  -- One record that the purge happened, with no project link (the project no longer exists).
  insert into public.events
    (office_id, correlation_id, project_id, actor_kind, actor, trigger, action_type, reversible,
     rationale_summary, before_state, after_state)
  values
    (p_office, gen_random_uuid(), null, 'user', 'Team HQ', 'studio', 'project.purged', false,
     left(format('Purged the project "%s" for good: %s records removed. Files stored elsewhere (Google, Notion and the like) were not touched.', v_name, v_total), 200),
     jsonb_build_object('project', v_name, 'counts', v_counts),
     '{}'::jsonb);

  return jsonb_build_object(
    'ok', true,
    'project_id', v_id,
    'purged', v_name,
    'records', v_total,
    'counts', v_counts,
    'passes', v_pass,
    'stored_files', to_jsonb(v_paths)
  );
end;
$$;

revoke all on function app.hq_project_purge_plan(uuid, text) from public, anon, authenticated;
revoke all on function app.hq_project_purge(uuid, text, text) from public, anon, authenticated;
grant execute on function app.hq_project_purge_plan(uuid, text) to service_role;
grant execute on function app.hq_project_purge(uuid, text, text) to service_role;

-- The public wrappers the gateway calls. Callable by the service role alone: the gateway fills p_office from a verified
-- login, and nothing else may name an office (src/ownership/enforcement.ts).
create or replace function public.hq_project_purge_plan(p_office uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$ select app.hq_project_purge_plan(p_office, p_slug) $$;

create or replace function public.hq_project_purge(p_office uuid, p_slug text, p_typed text)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$ select app.hq_project_purge(p_office, p_slug, p_typed) $$;

revoke all on function public.hq_project_purge_plan(uuid, text) from public, anon, authenticated;
revoke all on function public.hq_project_purge(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_project_purge_plan(uuid, text) to service_role;
grant execute on function public.hq_project_purge(uuid, text, text) to service_role;
