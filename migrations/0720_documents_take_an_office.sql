-- 0720 - the document functions take an office and check every row against it (multi-user P3, cluster b-documents).
--
-- Before: approving, discarding, renaming, moving, pinning, superseding and restoring a document; collections and tags;
-- importing an output; recording a file; the artifacts list; the project export; search and the typed edges between
-- things all read and wrote `public.documents`, `public.outputs`, `public.collections`, `public.relations` and the rest
-- for whoever called, and the compatibility bridge guessed which office a new row belonged to. A second person's
-- documents would have been the first person's search results, and `project_export` would have packaged any project
-- whose id it was given. Now each takes `p_office uuid` FIRST, with no default, and every statement carries the office:
-- a document of another office, an output of another office's job, a collection of another office's project and a
-- relation under another office's project are indistinguishable from rows that do not exist.
--
--   * Searches filter by office in the SQL that fetches the rows (app.studio_search), never after.
--   * app.relations_of reads every table it joins through that office's rows, so an edge cannot name a foreign endpoint
--     nor resolve a foreign title; app.link refuses a project or an endpoint that is not the office's.
--   * app.project_export resolves the project once, inside the office, and everything else keys on the answer.
--   * app.send_to_agent writes the command into the caller's office and refuses a second asset from elsewhere.
--   * 'grant' as an actor is gone: app.office_actor(p_office). document_orders are written under that actor; the reader
--     in app.hq_studio_core still says owner = 'grant' and must ask app.office_actor(p_office) when the views cluster
--     converts it (the two agree for Grant's office).
--
-- Two defects in the originals fixed on the way: app.hq_document_restore reported `restored` for a document that was not
-- there (an undo then claimed a success it had not had), and app.relation_endpoint_office (P2) resolved a 'source' only
-- through project_attachments, so the relations guard refused every link from a document to a plain reference.
--
-- app.project_export calls app.project_automations(p_office, project): the projects cluster converts that function in
-- the same release. The old signatures are dropped here; the release procedure pauses the worker so the drop and the
-- deploy land together.


----------------------------------------------------------------------------------------------------------------------
-- the two helpers every relation-writing function here needs
----------------------------------------------------------------------------------------------------------------------
-- Is this (kind, id) a row of THIS office? The relations table has no office column: its endpoints are ids of seven
-- different tables, so the question has to be asked of the table the kind names. An 'agent' is a member of the
-- deployment's shared roster, which no office owns.
create function app.endpoint_in_office(p_office uuid, p_kind text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $f$
  select case
    when p_id is null then false
    when p_kind = 'agent' then exists (select 1 from public.staff s where s.staff_id = p_id)
    else app.relation_endpoint_office(p_kind, p_id) is not distinct from p_office
         and app.relation_endpoint_office(p_kind, p_id) is not null
  end
$f$;

revoke all on function app.endpoint_in_office(uuid, text, uuid) from public, anon, authenticated, service_role;

-- A plain reference is a source too (0316). The relations guard (P2) resolved only attachments, so a document could
-- never be derived from a reference: the one case approve_document's fourth field exists for.

CREATE OR REPLACE FUNCTION app.relation_endpoint_office(p_kind text, p_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case p_kind
    when 'document'   then (select d.office_id from public.documents d where d.document_id = p_id)
    when 'task'       then (select t.office_id from public.tasks t where t.task_id = p_id)
    when 'job'        then (select j.office_id from public.jobs j where j.job_id = p_id)
    when 'contact'    then (select pr.office_id from public.contacts c join public.projects pr on pr.project_id = c.project_id where c.contact_id = p_id)
    when 'collection' then (select pr.office_id from public.collections c join public.projects pr on pr.project_id = c.project_id where c.collection_id = p_id)
    when 'source'     then coalesce(
                            (select pr.office_id from public.project_attachments a join public.projects pr on pr.project_id = a.project_id where a.attachment_id = p_id),
                            (select pr.office_id from public.project_references rf join public.projects pr on pr.project_id = rf.project_id where rf.reference_id = p_id))
  end
$function$;


create function app.link(p_office uuid, p_project uuid, p_from_kind text, p_from_id uuid, p_verb text,
                         p_to_kind text, p_to_id uuid, p_made_by text default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $f$
declare
  v_id uuid;
  v_by text;
begin
  perform app.require_office(p_office);
  v_by := coalesce(nullif(btrim(p_made_by), ''), app.office_actor(p_office));
  -- The project, and both ends, must be this office's. The edge table cannot enforce that for an id that may
  -- point at any of seven tables, so it is enforced here; the relations guard (P2) is the second witness.
  if not exists (select 1 from public.projects pr where pr.project_id = p_project and pr.office_id = p_office) then
    raise exception 'no project with id %', p_project;
  end if;
  if not app.endpoint_in_office(p_office, p_from_kind, p_from_id) then
    raise exception 'no % with id %', p_from_kind, p_from_id;
  end if;
  if not app.endpoint_in_office(p_office, p_to_kind, p_to_id) then
    raise exception 'no % with id %', p_to_kind, p_to_id;
  end if;
  insert into public.relations
    (project_id, from_kind, from_id, verb, to_kind, to_id, made_by)
  values (p_project, p_from_kind, p_from_id, p_verb, p_to_kind, p_to_id, v_by)
  on conflict (from_kind, from_id, verb, to_kind, to_id) do update
    set made_by = excluded.made_by
    where exists (select 1 from public.projects rp
                   where rp.project_id = public.relations.project_id and rp.office_id = p_office)
  returning relation_id into v_id;
  if v_id is null then
    raise exception 'that relation could not be recorded';
  end if;
  return v_id;
end
$f$;

CREATE FUNCTION app.approve_document(p_office uuid, p_document uuid, p_collection text DEFAULT NULL::text, p_tags text[] DEFAULT NULL::text[], p_related_task uuid DEFAULT NULL::uuid, p_related_source uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_title   text;
  v_source  text;
begin
  perform app.require_office(p_office);
  select project_id, title into v_project, v_title
    from public.documents where document_id = p_document and office_id = p_office;
  if v_project is null then
    -- A jsonb answer rather than a raise: this is called from a button, and
    -- "no such document" is something the page can say out loud.
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;
  if p_related_source is not null then
    select coalesce(
             (select a.display_name from public.project_attachments a
               where a.attachment_id = p_related_source and a.project_id = v_project),
             (select r.title from public.project_references r
               where r.reference_id = p_related_source and r.project_id = v_project))
      into v_source;
    if v_source is null then
      return jsonb_build_object('ok', false,
        'error', 'that source does not belong to this project');
    end if;
  end if;
  update public.documents
     set state = 'approved',
         tags = case when p_tags is null then tags else p_tags end
   where document_id = p_document and office_id = p_office;
  if p_collection is not null and length(btrim(p_collection)) > 0 then
    perform app.put_in_collection(p_office, p_document, p_collection);
  end if;
  if p_related_task is not null then
    perform app.link(p_office, v_project, 'document', p_document, 'attached_to', 'task', p_related_task,
                     app.office_actor(p_office));
  end if;
  /*
    The fourth field (#28), and it is checked before it is written.
    A source is an attachment or a reference (#35), and `relations` has no
    foreign key on `to_id` — it cannot, because the id may point at any of
    seven tables. So a bad id would store silently and surface later as a
    dangling edge, which `relations_of` reports honestly and nobody would
    connect back to here.
  */
  if p_related_source is not null then
    perform app.link(p_office, v_project, 'document', p_document, 'derived_from', 'source',
                     p_related_source, app.office_actor(p_office));
  end if;
  return jsonb_build_object(
    'ok', true, 'document', p_document, 'title', v_title,
    'collection', nullif(btrim(coalesce(p_collection, '')), ''),
    'tags', to_jsonb(coalesce(p_tags, '{}')),
    'source', v_source);
end;
$function$;

CREATE FUNCTION app.put_in_collection(p_office uuid, p_document uuid, p_collection_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project uuid;
  v_col uuid;
begin
  perform app.require_office(p_office);
  select project_id into v_project from public.documents where document_id = p_document and office_id = p_office;
  if v_project is null then
    raise exception 'no document with id %', p_document;
  end if;
  -- Created on first use. Grant should never have to make a collection before
  -- he can put something in one — that is the manual step §31A calls a design
  -- failure, in miniature.
  insert into public.collections (project_id, name)
  values (v_project, btrim(p_collection_name))
  on conflict (project_id, name) do update set name = excluded.name
  returning collection_id into v_col;
  insert into public.document_collections (document_id, collection_id)
  values (p_document, v_col)
  on conflict do nothing;
  return v_col;
end $function$;

CREATE FUNCTION app.take_out_of_collection(p_office uuid, p_document uuid, p_collection_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_collection uuid; v_project uuid;
begin
  perform app.require_office(p_office);
  select project_id into v_project from public.documents where document_id = p_document and office_id = p_office;
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;
  select collection_id into v_collection
    from public.collections
   where project_id = v_project and lower(name) = lower(btrim(coalesce(p_collection_name, '')));
  if v_collection is null then
    return jsonb_build_object('ok', false, 'error', 'no such collection in this project');
  end if;
  delete from public.document_collections
   where document_id = p_document and collection_id = v_collection;
  if not found then
    -- Not an error. "It is not in that collection" is the state the caller
    -- wanted, and reporting it as a failure makes an idempotent action
    -- look broken on the second press.
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  return jsonb_build_object('ok', true, 'removed_from', p_collection_name);
end;
$function$;

CREATE FUNCTION app.tag_document(p_office uuid, p_document uuid, p_tag text, p_on boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_tag text := lower(btrim(coalesce(p_tag, ''))); v_tags text[];
begin
  perform app.require_office(p_office);
  if v_tag = '' then
    return jsonb_build_object('ok', false, 'error', 'a tag needs a word');
  end if;
  if not exists (select 1 from public.documents where document_id = p_document and office_id = p_office) then
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;
  update public.documents
     set tags = case
                  when coalesce(p_on, true)
                    -- `array_append` would add a second copy. This is the
                    -- idempotent form: pressing the tag button twice is one tag.
                    then (select array(select distinct unnest(coalesce(tags, '{}') || v_tag) order by 1))
                  else (select array(select unnest(coalesce(tags, '{}')) except select v_tag order by 1))
                end
   where document_id = p_document and office_id = p_office
  returning tags into v_tags;
  return jsonb_build_object('ok', true, 'tags', to_jsonb(coalesce(v_tags, '{}')));
end;
$function$;

CREATE FUNCTION app.rename_document(p_office uuid, p_document uuid, p_title text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_was  text;
  v_new  text := btrim(coalesce(p_title, ''));
  v_undo uuid;
begin
  perform app.require_office(p_office);
  if v_new = '' then
    return jsonb_build_object('ok', false, 'error', 'a document needs a name');
  end if;
  select title into v_was from public.documents where document_id = p_document and office_id = p_office;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;
  if v_was = v_new then
    return jsonb_build_object('ok', true, 'was', v_was, 'now', v_new, 'unchanged', true);
  end if;
  update public.documents set title = v_new, updated_at = app.now_utc()
   where document_id = p_document and office_id = p_office;
  -- The reversal is this same function with the old name, which is what
  -- "exactly invertible" means and why no separate undo path is needed.
  v_undo := app.undo_offer(
    p_office,
    'document.rename',
    format('Renamed %s', left(v_was, 60)),
    jsonb_build_object('action', 'document_rename',
                       'args', jsonb_build_object('p_document', p_document,
                                                  'p_title', v_was)));
  return jsonb_build_object('ok', true, 'was', v_was, 'now', v_new, 'undo', v_undo);
end;
$function$;

CREATE FUNCTION app.discard_document(p_office uuid, p_document uuid, p_why text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_title text; v_was text;
begin
  perform app.require_office(p_office);
  select title, state into v_title, v_was
    from public.documents where document_id = p_document and office_id = p_office;
  if v_title is null then
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;
  if v_was = 'archived' then
    -- Already gone. Reported as ok with nothing changed, because a second
    -- press of Discard is a person making sure, not an error.
    return jsonb_build_object('ok', true, 'title', v_title, 'already', true);
  end if;
  update public.documents set state = 'archived' where document_id = p_document and office_id = p_office;
  return jsonb_build_object('ok', true, 'title', v_title, 'was', v_was,
                            'why', nullif(btrim(coalesce(p_why, '')), ''));
end;
$function$;

CREATE FUNCTION app.decide_output(p_office uuid, p_output uuid, p_verdict text, p_why text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_now text; v_job uuid;
begin
  perform app.require_office(p_office);
  /*
    Only the two a person presses.
    `approved` is deliberately NOT settable here: an output becomes approved by
    being IMPORTED (0317), which is the step that creates the document. Letting
    a button set the status directly would produce an output marked approved
    with nothing in the project — the half-built gate this Issue is about.
  */
  if p_verdict not in ('rejected', 'pending') then
    return jsonb_build_object('ok', false, 'error',
      format('%s is not a decision this can make — import it to approve it', p_verdict));
  end if;
  select oo.reviewer_status::text, oo.job_id into v_now, v_job
    from public.outputs oo
    join public.jobs jo on jo.job_id = oo.job_id and jo.office_id = p_office
   where oo.output_id = p_output;
  if v_now is null then
    return jsonb_build_object('ok', false, 'error', 'no such output');
  end if;
  update public.outputs
     set reviewer_status = p_verdict::reviewer_status,
         reviewed_at = case when p_verdict = 'pending' then null else app.now_utc() end,
         review_notes = nullif(btrim(coalesce(p_why, '')), '')
   where output_id = p_output
     and exists (select 1 from public.jobs jo where jo.job_id = public.outputs.job_id and jo.office_id = p_office);
  return jsonb_build_object('ok', true, 'was', v_now, 'now', p_verdict, 'job', v_job);
end;
$function$;

CREATE FUNCTION app.hq_document_link(p_office uuid, p_project_id uuid, p_connector text, p_external_ref text, p_title text, p_mime text DEFAULT NULL::text, p_source_title text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_conn  text := lower(btrim(coalesce(p_connector, '')));
  v_ref   text := btrim(coalesce(p_external_ref, ''));
  v_mime  text := lower(btrim(coalesce(p_mime, '')));
  v_kind  text;
  v_id    uuid;
  v_new   boolean;
begin
  perform app.require_office(p_office);
  if v_title = '' then
    return jsonb_build_object('error', 'that file has no name to file it under');
  end if;
  if v_ref = '' then
    return jsonb_build_object('error', 'nothing said which file this is');
  end if;
  if v_conn not in ('drive', 'notion', 'notebooklm', 'github', 'mcp', 'upload') then
    return jsonb_build_object('error', format('%L is not a connector this office reads', v_conn));
  end if;
  if not exists (select 1 from public.projects
                  where project_id = p_project_id and office_id = p_office
                    and coalesce(status, '') <> 'archived') then
    return jsonb_build_object('error', 'no such dashboard project');
  end if;
  v_kind := case
    when v_mime = 'application/vnd.google-apps.folder' then 'folder'
    when v_mime = 'application/vnd.google-apps.document' then 'google-doc'
    when v_mime = 'application/vnd.google-apps.spreadsheet' then 'google-sheet'
    when v_mime = 'application/vnd.google-apps.presentation' then 'google-slides'
    when v_mime = 'application/vnd.google-apps.form' then 'google-form'
    when v_mime = 'application/pdf' then 'pdf'
    when v_mime like 'image/%' then 'image'
    when v_mime like 'audio/%' then 'audio'
    when v_mime like 'video/%' then 'video'
    when v_mime like 'text/%' then 'text'
    else 'file'
  end;
  if v_kind = 'folder' then
    return jsonb_build_object('error', 'that is a folder — pick a file inside it');
  end if;
  insert into public.documents
    (office_id, project_id, connector, external_ref, title, source_title,
     origin, state, added_by, doc_type)
  values
    (p_office, p_project_id, v_conn, v_ref, v_title,
     nullif(btrim(coalesce(p_source_title, '')), ''),
     'source', 'approved', app.office_actor(p_office), v_kind)
  -- The narrow index above, and its predicate written out: a conflict target
  -- without the same predicate matches no index and the insert fails, which is
  -- how a sync once stored zero rows for a whole run.
  on conflict (connector, external_ref)
    where external_ref is not null and external_parent_ref is null
    do update set
      title        = excluded.title,
      doc_type     = excluded.doc_type,
      source_title = coalesce(excluded.source_title, public.documents.source_title),
      project_id   = excluded.project_id,
      updated_at   = app.now_utc()
    -- (connector, external_ref) is unique across the deployment because a provider's file id is. A file another
    -- office already holds is not this office's to update: the conflict then returns no row, and it is reported
    -- like any file that could not be filed.
    where public.documents.office_id = p_office
  returning document_id, (xmax = 0) into v_id, v_new;
  if v_id is null then
    return jsonb_build_object('error', 'that file could not be filed here');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'added', v_new,
                            'title', v_title, 'kind', v_kind);
end;
$function$;

CREATE FUNCTION app.hq_document_move(p_office uuid, p_document_id uuid, p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_was_project uuid;
  v_was_name    text;
  v_to_name     text;
  v_title       text;
  v_holds       int;
  v_undo        uuid;
begin
  perform app.require_office(p_office);
  select d.project_id, d.title into v_was_project, v_title
    from public.documents d where d.document_id = p_document_id and d.office_id = p_office;
  if v_title is null then
    return jsonb_build_object('error', 'there is no document with that id');
  end if;
  if v_was_project = p_project_id then
    return jsonb_build_object('moved', false, 'unchanged', true);
  end if;
  select p.name into v_to_name from public.projects p where p.project_id = p_project_id and p.office_id = p_office;
  if v_to_name is null then
    return jsonb_build_object('error', 'there is no project with that id');
  end if;
  select p.name into v_was_name from public.projects p where p.project_id = v_was_project and p.office_id = p_office;
  /*
    What would be orphaned, counted before anything moves.
    A collection belongs to a project, so moving a document out of one leaves a
    membership pointing across a boundary that nothing in the interface can
    draw. Refusing and naming the holder is better than a silent success that
    produces a row only a query can see.
  */
  select count(*) into v_holds
    from public.document_collections dc
    join public.collections c on c.collection_id = dc.collection_id
   where dc.document_id = p_document_id
     and c.project_id is distinct from p_project_id;
  if v_holds > 0 then
    return jsonb_build_object('error',
      format('%s is in %s collection(s) on %s. Take it out of those first, or it '
             || 'would belong to a collection in a project it is not in.',
             left(v_title, 40), v_holds, coalesce(v_was_name, 'the other project')));
  end if;
  update public.documents
     set project_id = p_project_id, updated_at = app.now_utc()
   where document_id = p_document_id and office_id = p_office;
  v_undo := app.undo_offer(
    p_office,
    'document.move',
    format('Moved %s to %s', left(v_title, 40), v_to_name),
    jsonb_build_object('action', 'document_move',
                       'args', jsonb_build_object('p_document_id', p_document_id,
                                                  'p_project_id', v_was_project)));
  return jsonb_build_object('moved', true, 'to', v_to_name,
                            'from', v_was_name, 'undo', v_undo);
end;
$function$;

CREATE FUNCTION app.hq_document_pin(p_office uuid, p_document_id uuid, p_pinned boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_title text;
begin
  perform app.require_office(p_office);
  select d.title into v_title from public.documents d where d.document_id = p_document_id and d.office_id = p_office;
  if v_title is null then
    return jsonb_build_object('error', 'there is no document with that id');
  end if;
  update public.documents
     set pinned = coalesce(p_pinned, false), updated_at = app.now_utc()
   where document_id = p_document_id and office_id = p_office;
  /*
    No undo on a pin, deliberately. It is its own inverse and it is one press
    away — offering a strip to take back a toggle is furniture, and #118's bar
    means something precisely because it does not appear for everything.
  */
  return jsonb_build_object('pinned', coalesce(p_pinned, false), 'title', v_title);
end;
$function$;

CREATE FUNCTION app.hq_document_restore(p_office uuid, p_document_id uuid, p_state text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_state text := coalesce(nullif(btrim(coalesce(p_state, '')), ''), 'approved');
begin
  perform app.require_office(p_office);
  -- Never write a word the column does not have. The default is the one a
  -- document reaches by being approved, which is where a current document
  -- normally sits; anything else must come from the undo payload, which is the
  -- only thing that remembers.
  if v_state not in ('draft', 'review', 'approved', 'archived') then
    v_state := 'approved';
  end if;
  update public.documents
     set state = v_state, superseded_by = null, updated_at = app.now_utc()
   where document_id = p_document_id and office_id = p_office;
  -- It used to say restored for a document that was not there; an undo then claimed a success it had not had.
  if not found then
    return jsonb_build_object('error', 'there is no document with that id');
  end if;
  return jsonb_build_object('restored', true, 'state', v_state);
end;
$function$;

CREATE FUNCTION app.hq_document_supersede(p_office uuid, p_document_id uuid, p_by_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_title text;
  v_by    text;
  v_was   text;
  v_undo  uuid;
begin
  perform app.require_office(p_office);
  if p_document_id = p_by_document_id then
    return jsonb_build_object('error', 'a document cannot supersede itself');
  end if;
  select d.title, d.state into v_title, v_was
    from public.documents d where d.document_id = p_document_id and d.office_id = p_office;
  select d.title into v_by from public.documents d where d.document_id = p_by_document_id and d.office_id = p_office;
  if v_title is null or v_by is null then
    return jsonb_build_object('error', 'one of those documents does not exist');
  end if;
  update public.documents
     set state = 'archived', superseded_by = p_by_document_id, updated_at = app.now_utc()
   where document_id = p_document_id and office_id = p_office;
  v_undo := app.undo_offer(
    p_office,
    'document.supersede',
    format('Marked %s superseded', left(v_title, 50)),
    jsonb_build_object('action', 'document_restore',
                       'args', jsonb_build_object('p_document_id', p_document_id,
                                                  'p_state', coalesce(v_was, 'approved'))));
  return jsonb_build_object('superseded', true, 'by', v_by, 'was', v_was, 'undo', v_undo);
end;
$function$;

CREATE FUNCTION app.hq_document_order_reset(p_office uuid, p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_project uuid;
begin
  perform app.require_office(p_office);
  v_project := app.project_in_office(p_office, p_slug);
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;
  delete from public.document_orders where project_id = v_project and owner = app.office_actor(p_office);
  return jsonb_build_object('ok', true, 'reset', true);
end;
$function$;

CREATE FUNCTION app.hq_document_order_set(p_office uuid, p_slug text, p_ids jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project uuid;
  v_clean jsonb;
begin
  perform app.require_office(p_office);
  v_project := app.project_in_office(p_office, p_slug);
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;
  if p_ids is null or jsonb_typeof(p_ids) <> 'array' or jsonb_array_length(p_ids) = 0 then
    delete from public.document_orders where project_id = v_project and owner = app.office_actor(p_office);
    return jsonb_build_object('ok', true, 'reset', true);
  end if;
  -- Only documents that are really on this project, in the order given, each
  -- once. A list carrying an id from somewhere else would quietly reorder
  -- nothing and look like a save that worked.
  select coalesce(jsonb_agg(to_jsonb(x.id) order by x.ord), '[]'::jsonb) into v_clean
    from (
      select distinct on (e.value #>> '{}') (e.value #>> '{}')::uuid as id, e.ordinality as ord
        from jsonb_array_elements(p_ids) with ordinality as e(value, ordinality)
       where exists (
         select 1 from public.documents d
          where d.document_id = (e.value #>> '{}')::uuid and d.project_id = v_project
            and d.office_id = p_office
       )
       order by e.value #>> '{}', e.ordinality
    ) x;
  if jsonb_array_length(v_clean) = 0 then
    return jsonb_build_object('error', 'none of those documents are on this project');
  end if;
  insert into public.document_orders (owner, project_id, doc_ids, updated_at)
  values (app.office_actor(p_office), v_project, v_clean, app.now_utc())
  on conflict (owner, project_id)
    do update set doc_ids = excluded.doc_ids, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true, 'kept', jsonb_array_length(v_clean));
end;
$function$;

CREATE FUNCTION app.record_file_document(p_office uuid, p_project_id uuid, p_title text, p_storage_path text, p_mime_type text, p_byte_size bigint, p_parent_ref text DEFAULT NULL::text, p_external_ref text DEFAULT NULL::text, p_duration_s integer DEFAULT NULL::integer, p_added_by text DEFAULT 'chief-of-staff'::text, p_job_id uuid DEFAULT NULL::uuid, p_origin text DEFAULT 'made'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  made public.documents%rowtype;
  v_renamed boolean := false;
  v_kept boolean := false;
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.projects where project_id = p_project_id and office_id = p_office) then
    return jsonb_build_object('error', 'no such dashboard project');
  end if;
  if coalesce(p_byte_size, 0) <= 0 then
    return jsonb_build_object('error', 'a file with no bytes is not a file');
  end if;
  if p_parent_ref is not null and coalesce(btrim(p_external_ref), '') = '' then
    return jsonb_build_object('error', 'a parent reference needs the artifact reference too');
  end if;
  if p_origin is null or p_origin not in ('made', 'yours') then
    return jsonb_build_object(
      'error', format('a stored file is either yours or made here, not %L', p_origin));
  end if;
  -- A job that is not this office's cannot be the author of this office's document.
  if p_job_id is not null
     and not exists (select 1 from public.jobs where job_id = p_job_id and office_id = p_office) then
    return jsonb_build_object('error', 'that job does not exist');
  end if;
  select * into made from public.documents
   where project_id = p_project_id and office_id = p_office and storage_path = p_storage_path;
  if found then
    /*
      Already here — and possibly renamed upstream since.
      The comparison is against `source_title`, never against `title`: the
      question is not "does the office call it something else" but "has the
      SOURCE started calling it something else", and those differ exactly when
      Grant has renamed it himself.
    */
    if coalesce(made.source_title, '') is distinct from coalesce(p_title, '') then
      v_renamed := true;
      -- Grant's own rename is anything that no longer matches what the source
      -- last said. His wins; the source's new name is still written down.
      v_kept := coalesce(made.title, '') is distinct from coalesce(made.source_title, '');
      update public.documents
         set source_title = p_title,
             title = case when v_kept then title else p_title end,
             updated_at = app.now_utc()
       where document_id = made.document_id and office_id = p_office;
    end if;
    return jsonb_build_object(
      'document_id', made.document_id, 'already_there', true,
      'renamed_at_source', v_renamed,
      'kept_your_name', v_kept,
      'title', case when v_renamed and not v_kept then p_title else made.title end);
  end if;
  insert into public.documents
    (office_id, project_id, title, source_title, doc_type, connector, external_parent_ref, external_ref,
     storage_path, mime_type, byte_size, duration_s,
     content, content_fingerprint, content_chars,
     fetched_at,
     added_by, produced_by, produced_by_job, origin, state)
  values
    (p_office, p_project_id, p_title,
     case when p_origin = 'yours' then p_title else null end,
     'file', null,  -- a desktop is the absence of a connector (0414)
     p_parent_ref, p_external_ref,
     p_storage_path, p_mime_type, p_byte_size, p_duration_s,
     null, null, null,
     null,
     p_added_by,
     case when p_origin = 'made' then p_added_by else null end,
     p_job_id, p_origin, 'draft')
  returning * into made;
  return jsonb_build_object('document_id', made.document_id, 'already_there', false);
end;
$function$;

CREATE FUNCTION app.import_output(p_office uuid, p_output uuid, p_collection text DEFAULT NULL::text, p_tags text[] DEFAULT NULL::text[], p_related_task uuid DEFAULT NULL::uuid, p_related_source uuid DEFAULT NULL::uuid, p_title text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  o          record;
  v_project  uuid;
  v_author   text;
  v_title    text;
  v_document uuid;
  v_meta     jsonb;
  v_declared jsonb;
  v_tags     text[];
  v_collection text;
begin
  perform app.require_office(p_office);
  select oo.output_id, oo.body, oo.job_id, oo.staff_id, oo.reviewer_status,
         oo.shape, oo.facts
    into o
    from public.outputs oo
    join public.jobs jo on jo.job_id = oo.job_id and jo.office_id = p_office
   where oo.output_id = p_output;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no such output');
  end if;
  if coalesce(btrim(o.body), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'that output has no text to import');
  end if;
  select j.project_id into v_project from public.jobs j where j.job_id = o.job_id and j.office_id = p_office;
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', 'that output is not attached to a project');
  end if;
  select s.slug into v_author from public.staff s where s.staff_id = o.staff_id;
  /*
    What the output said about itself, if anything. Guarded on the shape being
    one the registry knows AND the facts being an object: a shape naming
    something that is not declared cannot be trusted to carry the keys it
    would imply, and 0272's trigger means such a row should not exist anyway.
  */
  v_declared := case
    when o.shape is not null
     and jsonb_typeof(coalesce(o.facts, 'null'::jsonb)) = 'object'
     and exists (select 1 from public.output_shapes s where s.shape = o.shape)
    then o.facts
    else '{}'::jsonb
  end;
  v_title := coalesce(
    nullif(btrim(coalesce(p_title, '')), ''),
    nullif(btrim(coalesce(v_declared ->> 'title', '')), ''),
    nullif(btrim(split_part(o.body, E'\n', 1)), ''),
    'Untitled');
  v_title := left(v_title, 200);
  /*
    Tags the same way. `array_length` rather than `= '{}'`, because the sheet
    sends an empty array when the box is left alone and that means "none
    given", not "none wanted".
  */
  v_tags := case
    when p_tags is not null and coalesce(array_length(p_tags, 1), 0) > 0 then p_tags
    when jsonb_typeof(v_declared -> 'tags') = 'array'
      then (select array_agg(btrim(t)) from jsonb_array_elements_text(v_declared -> 'tags') t
             where btrim(t) <> '')
    else p_tags
  end;
  -- And the collection, in the same order: the sheet, then what the output
  -- suggested about itself, then nothing.
  v_collection := coalesce(
    nullif(btrim(coalesce(p_collection, '')), ''),
    nullif(btrim(coalesce(v_declared ->> 'suggested_collection', '')), ''));
  insert into public.documents
    (office_id, project_id, connector, external_parent_ref, external_ref, title, doc_type, content,
     content_fingerprint, content_chars, fetched_at, origin, state,
     produced_by, produced_by_job)
  values (p_office, v_project, 'upload', null, format('output:%s', p_output), v_title, 'note', o.body,
          encode(extensions.digest(o.body, 'sha256'), 'hex'), length(o.body),
          app.now_utc(), 'made', 'draft',
          coalesce(v_author, ''), o.job_id)
  on conflict (project_id, external_ref) where external_ref like 'output:%'
  do update set title = excluded.title
  returning document_id into v_document;
  /*
    Everything after the document goes through `app.approve_document`, exactly
    as it did before — the collection, the tags and the two relations keep
    their own refusals, and this function keeps having one place where a
    document becomes part of the project.
    The first draft of 0417 rewrote this half from memory and invented
    `a file_in_collection`, `a tag_document taking a uuid and text` and a relate
    with a signature nothing has. It failed on the first real run, which is the
    cheap direction — CLAUDE.md's rule about guessing names, applied to
    functions rather than columns.
  */
  v_meta := app.approve_document(p_office, v_document, v_collection, v_tags, p_related_task,
                                 p_related_source);
  if coalesce((v_meta->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'document', v_document,
                              'error', v_meta->>'error');
  end if;
  update public.outputs
     set reviewer_status = 'approved', reviewed_by = null, reviewed_at = app.now_utc()
   where output_id = p_output
     and exists (select 1 from public.jobs jo where jo.job_id = public.outputs.job_id and jo.office_id = p_office);
  return jsonb_build_object(
    'ok', true, 'document', v_document, 'title', v_title,
    -- Whether the title came from what the output DECLARED rather than from
    -- its first line, so #130's gain is visible rather than inferred.
    'title_from_structure', v_declared ? 'title',
    'collection', v_meta->'collection', 'tags', v_meta->'tags', 'source', v_meta->'source');
end;
$function$;

CREATE FUNCTION app.hq_output(p_office uuid, p_output_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
select jsonb_build_object(
           'id', o.output_id,
           -- WHAT IT IS CALLED, and jobs have no title to take it from.
           -- `understood_as` is what the office understood the request to be,
           -- which is the nearest true thing: an output's name is the question
           -- it answers. Guessing a column called `subject` cost one migration
           -- here, which is the trap this file's neighbours keep recording.
           'title', coalesce(nullif(btrim(j.understood_as), ''), j.kind, 'Untitled'),
           'body', o.body,
           'kind', o.shape,
           'who', coalesce(st.name, st.slug, 'The team'),
           'made', o.created_at,
           'confidence', o.confidence,
           -- `evidence` is an enum and `sources` is already jsonb. Both were
           -- guessed as text and an array on the first pass, which is two more
           -- entries for the list of columns whose type has to be READ.
           'evidence', o.evidence::text,
           'sources', coalesce(o.sources, '[]'::jsonb),
           'reviewed', o.reviewer_status,
           'reviewed_at', o.reviewed_at,
           -- What was asked for, which is the other half of reading an answer.
           'asked', j.understood_as,
           'job_kind', j.kind,
           'project', p.name,
           'project_slug', p.slug,
           -- Whether it has already become a document, so the surface can
           -- offer the one action that is still available rather than both.
           'imported', exists (
             select 1 from public.documents d
              where d.produced_by_job = o.job_id and d.office_id = p_office
           )
         )
    from public.outputs o
    join public.jobs j on j.job_id = o.job_id and j.office_id = p_office
    left join public.staff st on st.staff_id = o.staff_id
    left join public.projects p on p.project_id = j.project_id and p.office_id = p_office
   where o.output_id = p_output_id
  );
end;
$function$;

CREATE FUNCTION app.studio_document(p_office uuid, p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
select case
    when p_document_id is null
      then jsonb_build_object('error', 'no document asked for')
    else coalesce(
      (select jsonb_build_object(
                'id',        d.document_id,
                'title',     d.title,
                'content',   d.content,
                'mime_type', d.mime_type,
    'connector', d.connector,
    'ref', d.external_ref,
                'path',      d.storage_path,
                'bytes',     d.byte_size,
                'seconds',   d.duration_s,
                'state',     d.state,
                'origin',    case d.origin
                               when 'yours' then 'Yours'
                               when 'made'  then coalesce(d.produced_by, 'The team')
                               else app.connector_label(d.connector) end,
                -- A boolean, not the id it mirrors: the reader needs to say
                -- "we wrote this" and does not need to enumerate documents.
                'mirrored',  d.mirrors_document_id is not null,
                'created',   to_char(d.created_at, 'FMDD Mon YYYY')
              )
         from public.documents d
        where d.document_id = p_document_id and d.office_id = p_office),
      jsonb_build_object('error', 'no such document'))
  end
  );
end;
$function$;

CREATE FUNCTION app.awaiting_review(p_office uuid, p_project uuid)
 RETURNS TABLE(document_id uuid, title text, produced_by text, produced_by_job uuid, created_at timestamp with time zone, derived_from text[], state text, kind text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  perform app.require_office(p_office);
  return query
select d.document_id, d.title,
         -- 0284: `produced_by` is NOT NULL defaulting to the empty string, so
         -- coalesce on it is dead code. nullif is what actually fires.
         coalesce(nullif(d.produced_by, ''), 'The team') as produced_by,
         d.produced_by_job, d.created_at,
         coalesce(array_agg(src.title order by src.title)
                    filter (where src.title is not null), '{}') as derived_from,
         d.state,
         case
           when coalesce(d.mime_type, '') like 'audio/%' then 'audio'
           when coalesce(d.mime_type, '') = 'application/pdf'
             or d.title ilike '%.pdf' then 'pdf'
           else 'doc' end as kind
    from public.documents d
    left join public.relations r
           on r.from_kind = 'document' and r.from_id = d.document_id
          and r.verb = 'derived_from' and r.to_kind = 'document'
    left join public.documents src on src.document_id = r.to_id and src.office_id = p_office
   where d.office_id = p_office
     and d.project_id = p_project
     and d.origin = 'made'
     and d.state in ('draft', 'review')
   group by d.document_id, d.title, d.produced_by, d.produced_by_job,
            d.created_at, d.state, d.mime_type
   order by d.created_at desc;
end;
$function$;

CREATE FUNCTION app.hq_artifacts(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(a order by a.created_at desc), '[]'::jsonb)
    from (
      select ar.artifact_id, ar.kind, ar.title, ar.url,
             ar.url is not null as openable,
             -- Whether the office started it, or merely found it in the
             -- notebook and adopted it (#260). Grant's own audio overview is
             -- not the office's work and should not read as it.
             ar.requested_by_job is not null as mine,
             ar.state, ar.detail, ar.created_at, ar.ready_at, p.name as project
        from public.artifacts ar
        join public.projects p on p.project_id = ar.project_id and p.office_id = p_office
       order by ar.created_at desc
       limit 40
    ) a
  );
end;
$function$;

CREATE FUNCTION app.artifacts_in(p_office uuid, p_project uuid, p_kinds text[] DEFAULT NULL::text[], p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(q.v order by q.at desc), '[]'::jsonb)
    from (
      select a.created_at as at,
             jsonb_build_object(
               'id', a.artifact_id,
               'kind', a.kind,
               'title', coalesce(nullif(btrim(coalesce(a.title, '')), ''), '(untitled)'),
               'url', a.url,
               'openable', a.url is not null,
               'state', a.state,
               'detail', a.detail,
               'mine', a.requested_by_job is not null,
               'notebook', a.notebook_ref,
               'at', a.created_at,
               'ready_at', a.ready_at) as v
        from public.artifacts a
        join public.projects pr on pr.project_id = a.project_id and pr.office_id = p_office
       where a.project_id = p_project
         and (p_kinds is null or coalesce(array_length(p_kinds, 1), 0) = 0
              or a.kind = any (p_kinds))
       order by a.created_at desc
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) q
  );
end;
$function$;

CREATE FUNCTION app.project_artifacts(p_office uuid, p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
-- No kinds: a page shows everything, and the filter is the question's
  -- business rather than the page's.
  select app.artifacts_in(p_office, p_project, null, 50)
  );
end;
$function$;

CREATE FUNCTION app.relations_of(p_office uuid, p_kind text, p_id uuid)
 RETURNS TABLE(direction text, verb text, other_kind text, other_id uuid, other_title text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  perform app.require_office(p_office);
  return query
with edges as (
    select 'out'::text as direction, r.verb, r.to_kind as other_kind, r.to_id as other_id
      from public.relations r
      join public.projects rp on rp.project_id = r.project_id and rp.office_id = p_office
     where r.from_kind = p_kind and r.from_id = p_id
    union all
    select 'in'::text, r.verb, r.from_kind, r.from_id
      from public.relations r
      join public.projects rp on rp.project_id = r.project_id and rp.office_id = p_office
     where r.to_kind = p_kind and r.to_id = p_id
    -- Derived edges — the same fact read from both ends, so traversal is
    -- symmetric without anything being written twice (0310), speaking the
    -- stored verb vocabulary so a filter returns both halves (0311).
    union all
    select 'out', 'produced', 'document', d.document_id
      from (select x.* from public.documents x where x.office_id = p_office) d
     where p_kind = 'job' and d.produced_by_job = p_id
    union all
    select 'in', 'produced', 'job', d.produced_by_job
      from (select x.* from public.documents x where x.office_id = p_office) d
     where p_kind = 'document' and d.document_id = p_id and d.produced_by_job is not null
    union all
    select 'out', 'mirrors', 'document', d.mirrors_document_id
      from (select x.* from public.documents x where x.office_id = p_office) d
     where p_kind = 'document' and d.document_id = p_id and d.mirrors_document_id is not null
    union all
    select 'in', 'mirrors', 'document', d.document_id
      from (select x.* from public.documents x where x.office_id = p_office) d
     where p_kind = 'document' and d.mirrors_document_id = p_id
    union all
    select 'out', 'produced', 'document', d.document_id
      from (select x.* from public.documents x where x.office_id = p_office) d
      join public.staff s on s.slug = d.produced_by
     where p_kind = 'agent' and s.staff_id = p_id and coalesce(d.produced_by, '') <> ''
    union all
    select 'in', 'produced', 'agent', s.staff_id
      from (select x.* from public.documents x where x.office_id = p_office) d
      join public.staff s on s.slug = d.produced_by
     where p_kind = 'document' and d.document_id = p_id and coalesce(d.produced_by, '') <> ''
    union all
    select 'out', 'attached_to', 'collection', dc.collection_id
      from (select x.* from public.document_collections x join public.documents xd on xd.document_id = x.document_id and xd.office_id = p_office) dc
     where p_kind = 'document' and dc.document_id = p_id
    union all
    select 'in', 'attached_to', 'document', dc.document_id
      from (select x.* from public.document_collections x join public.documents xd on xd.document_id = x.document_id and xd.office_id = p_office) dc
     where p_kind = 'collection' and dc.collection_id = p_id
    union all
    select 'out', 'about', 'task', c.for_task_id
      from (select x.* from public.collections x join public.projects xp on xp.project_id = x.project_id and xp.office_id = p_office) c
     where p_kind = 'collection' and c.collection_id = p_id and c.for_task_id is not null
    union all
    select 'in', 'about', 'collection', c.collection_id
      from (select x.* from public.collections x join public.projects xp on xp.project_id = x.project_id and xp.office_id = p_office) c
     where p_kind = 'task' and c.for_task_id = p_id
    union all
    select 'out', 'assigned_to', 'agent', t.assignee_staff
      from (select x.* from public.tasks x where x.office_id = p_office) t
     where p_kind = 'task' and t.task_id = p_id and t.assignee_staff is not null
    union all
    select 'in', 'assigned_to', 'task', t.task_id
      from (select x.* from public.tasks x where x.office_id = p_office) t
     where p_kind = 'agent' and t.assignee_staff = p_id
    union all
    select 'out', 'output_of', 'job', t.job_id
      from (select x.* from public.tasks x where x.office_id = p_office) t
     where p_kind = 'task' and t.task_id = p_id and t.job_id is not null
    union all
    select 'in', 'output_of', 'task', t.task_id
      from (select x.* from public.tasks x where x.office_id = p_office) t
     where p_kind = 'job' and t.job_id = p_id
    union all
    select 'out', 'under', 'task', t.parent_task_id
      from (select x.* from public.tasks x where x.office_id = p_office) t
     where p_kind = 'task' and t.task_id = p_id and t.parent_task_id is not null
    union all
    select 'in', 'under', 'task', t.task_id
      from (select x.* from public.tasks x where x.office_id = p_office) t
     where p_kind = 'task' and t.parent_task_id = p_id
  )
  select e.direction, e.verb, e.other_kind, e.other_id,
         -- Resolved here so six callers cannot disagree about how to do it.
         -- A dangling edge yields null rather than dropping the row, so the
         -- graph reports its own damage instead of hiding it.
         coalesce(d.title, t.title, s.name, c.name, j.kind, src.name) as other_title
    from edges e
    left join (select x.* from public.documents x where x.office_id = p_office) d on e.other_kind = 'document'   and d.document_id = e.other_id
    left join (select x.* from public.tasks x where x.office_id = p_office) t on e.other_kind = 'task'       and t.task_id = e.other_id
    left join public.staff       s on e.other_kind = 'agent'      and s.staff_id = e.other_id
    left join (select x.* from public.collections x join public.projects xp on xp.project_id = x.project_id and xp.office_id = p_office) c on e.other_kind = 'collection' and c.collection_id = e.other_id
    left join (select x.* from public.jobs x where x.office_id = p_office) j on e.other_kind = 'job'        and j.job_id = e.other_id
    /*
      A source is two tables (0316). An authenticated attachment has a
      `display_name`; a plain reference (#35) has a `title`. Either can be the
      other end of a `derived_from`, so both are folded into one name here
      rather than making every caller know there are two kinds.
    */
    left join lateral (
      select coalesce(
               (select a.display_name from (select x.* from public.project_attachments x join public.projects xp on xp.project_id = x.project_id and xp.office_id = p_office) a
                 where a.attachment_id = e.other_id),
               (select r.title from (select x.* from public.project_references x join public.projects xp on xp.project_id = x.project_id and xp.office_id = p_office) r
                 where r.reference_id = e.other_id)) as name
    ) src on e.other_kind = 'source'
   order by e.direction, e.verb;
end;
$function$;

CREATE FUNCTION app.studio_search(p_office uuid, p_query text, p_project uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 12, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(kind text, ref uuid, title text, snippet text, place text, rank real, at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  perform app.require_office(p_office);
  return query
with asked as (
    -- `websearch_to_tsquery`, not `to_tsquery`: quoting a phrase or typing
    -- "or" then does what a person expects rather than raising a syntax error
    -- the caller has to report as "no results".
    select websearch_to_tsquery('english', btrim(coalesce(p_query, ''))) as q
  ),
  f as (
    select coalesce(p_filters, '{}'::jsonb) as j
  ),
  want as (
    select
      case when (select j -> 'kinds' from f) is null then null
           else (select array(select jsonb_array_elements_text(j -> 'kinds') from f)) end as kinds,
      nullif(btrim(coalesce((select j ->> 'tag' from f), '')), '')      as tag,
      (select nullif(btrim(coalesce(j ->> 'since', '')), '')::timestamptz from f) as since,
      (select nullif(btrim(coalesce(j ->> 'until', '')), '')::timestamptz from f) as until,
      nullif(btrim(coalesce((select j #>> '{related_to,kind}' from f), '')), '') as rel_kind,
      (select nullif(btrim(coalesce(j #>> '{related_to,id}', '')), '')::uuid from f) as rel_id
  ),
  /*
    Everything the named thing is connected to, from the one definition of
    what "connected" means. Empty when no relation filter was asked for, and
    the predicates below only consult it when `rel_kind` is present - so an
    unrelated search does not pay for a traversal it does not need.
  */
  related as (
    select r.other_kind, r.other_id
      from want w
      cross join lateral app.relations_of(p_office, w.rel_kind, w.rel_id) r
     where w.rel_kind is not null and w.rel_id is not null
  ),
  hits as (
    select 'document'::text as kind,
           d.document_id as ref,
           coalesce(nullif(d.title, ''), '(untitled)') as title,
           ts_headline('english', coalesce(d.content, ''), a.q,
                       'MaxWords=22, MinWords=8, ShortWord=3, MaxFragments=1') as snippet,
           coalesce(p.name, 'No project') as place,
           -- `d.search`: generated, indexed, and WEIGHTED, so a title match
           -- outranks a passing mention instead of tying with it.
           ts_rank(d.search, a.q) as rank,
           d.created_at as at
      from public.documents d
      cross join asked a
      cross join want w
      left join public.projects p on p.project_id = d.project_id and p.office_id = p_office
     where a.q is not null
       and d.office_id = p_office
       and (p_project is null or d.project_id = p_project)
       and d.search @@ a.q
       and (w.kinds is null or 'document' = any(w.kinds))
       and (w.tag is null or w.tag = any(coalesce(d.tags, array[]::text[])))
       and (w.since is null or d.created_at >= w.since)
       and (w.until is null or d.created_at <= w.until)
       and (w.rel_kind is null
            or exists (select 1 from related r
                        where r.other_kind = 'document' and r.other_id = d.document_id))
    union all
    /*
      An output is reached through its JOB, which is what carries the project
      and the person - `outputs` has no `project_id` of its own, which is a
      column name this repository has guessed wrong before.
      Fixtures excluded: harness answers are not things Grant is looking for.
    */
    select 'answer'::text as kind,
           o.job_id as ref,
           coalesce(nullif(s.name, ''), 'The team')
             || ' on ' || coalesce(nullif(j.kind, ''), 'a job') as title,
           ts_headline('english', coalesce(o.body, ''), a.q,
                       'MaxWords=22, MinWords=8, ShortWord=3, MaxFragments=1') as snippet,
           coalesce(p.name, 'No project') as place,
           ts_rank(to_tsvector('english', coalesce(o.body, '')), a.q) as rank,
           o.created_at as at
      from public.outputs o
      cross join asked a
      cross join want w
      join public.jobs j on j.job_id = o.job_id and j.office_id = p_office
      left join public.projects p on p.project_id = j.project_id and p.office_id = p_office
      left join public.staff s on s.staff_id = o.staff_id
     where a.q is not null
       and not j.is_fixture
       and (p_project is null or j.project_id = p_project)
       and to_tsvector('english', coalesce(o.body, '')) @@ a.q
       and (w.kinds is null or 'answer' = any(w.kinds))
       and (w.since is null or o.created_at >= w.since)
       and (w.until is null or o.created_at <= w.until)
       /*
         An answer carries no tags, so a tag filter excludes every answer
         rather than ignoring itself. Asking for "documents tagged pricing"
         and being shown untagged answers would be the filter not applying.
       */
       and (w.tag is null)
       and (w.rel_kind is null
            or exists (select 1 from related r
                        where r.other_kind = 'job' and r.other_id = o.job_id))
  )
  select h.kind, h.ref, h.title, h.snippet, h.place, h.rank, h.at
    from hits h
   order by h.rank desc, h.at desc
   limit greatest(coalesce(p_limit, 12), 1);
end;
$function$;

CREATE FUNCTION app.project_export(p_office uuid, p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pid uuid;
begin
  perform app.require_office(p_office);
  -- The project is resolved ONCE, inside the office. Another office's project and a project that does not
  -- exist both become null here, and every part of the package below is then empty in the same way.
  select p.project_id into v_pid from public.projects p
   where p.project_id = p_project_id and p.office_id = p_office;
  return (
select jsonb_strip_nulls(jsonb_build_object(
    'format', 'ai-team-hq/project-package',
    'format_version', 1,
    'exported_at', app.now_utc(),
    'project', (
      select jsonb_build_object(
               'slug', p.slug, 'name', p.name, 'status', p.status,
               'created_at', p.created_at,
               'brief', (select b.body from public.project_briefs b
                          where b.project_id = p.project_id
                          order by b.generated_at desc limit 1),
               'also_known_as', (select coalesce(jsonb_agg(a.alias order by a.alias), '[]'::jsonb)
                                   from public.project_aliases a
                                  where a.project_id = p.project_id))
        from public.projects p where p.project_id = v_pid),
    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'path', app.export_path(d.title, d.document_id),
               'title', d.title,
               'kind', d.doc_type,
               'text', d.content,
               'came_from', d.connector,
               'external_ref', d.external_ref,
               'tags', d.tags,
               -- Named, not identified. `produced_by` is a person's name and
               -- 0284 made it nullable so that a blank one reads as unknown
               -- rather than as the empty string a coalesce could not catch.
               'made_by', nullif(d.produced_by, ''),
               'origin', d.origin,
               'in_collections', (select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb)
                                    from public.document_collections dc
                                    join public.collections c using (collection_id)
                                   where dc.document_id = d.document_id),
               'created_at', d.created_at) order by d.created_at), '[]'::jsonb)
        from public.documents d
       where d.project_id = v_pid and d.office_id = p_office and d.state = 'approved'),
    'collections', (
      select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'position', c.position)
                                order by c.position, c.name), '[]'::jsonb)
        from public.collections c where c.project_id = v_pid),
    'tasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'title', t.title, 'state', t.state, 'due', t.due_on,
               'detail', nullif(t.detail, ''),
               -- `assigned_to_human` is a BOOLEAN saying whether this is
               -- Grant's rather than the office's; the person, when it is one
               -- of the team, is `assignee_staff`. Named here, never the uuid.
               'for_grant', t.assigned_to_human,
               'assigned_to', ts.name,
               'blocked_on', nullif(t.blocked_on, ''),
               'milestone', t.is_milestone) order by t.created_at), '[]'::jsonb)
        -- Harness tasks excluded, the same rule the whole product reads by:
        -- an export that carries fixtures is an export of the test suite.
        from public.tasks t
       left join public.staff ts on ts.staff_id = t.assignee_staff
       where t.project_id = v_pid and t.office_id = p_office and not t.is_fixture),
    'contacts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', ct.name, 'role', nullif(ct.role, ''),
               'org', nullif(ct.org, ''), 'email', nullif(ct.email, ''),
               'phone', nullif(ct.phone, ''), 'website', nullif(ct.website, ''),
               'notes', nullif(ct.note, ''),
               'labels', (select coalesce(jsonb_agg(l.name order by l.name), '[]'::jsonb)
                            from public.contact_label_links ll
                            join public.contact_labels l using (label_id)
                           where ll.contact_id = ct.contact_id))
               order by ct.name), '[]'::jsonb)
        from public.contacts ct where ct.project_id = v_pid and not ct.is_fixture),
    -- Our own row ids dropped, and only ours. See the header: the uuids that
    -- survive elsewhere in this package are either inside Grant's own document
    -- text or are the external system's reference, and both belong here.
    -- `studio_sources` keeps emitting the id because the Sources section needs
    -- it to remove a row; a reader's shape should not be bent by an unrelated
    -- writer's needs, so the export drops it rather than the function.
    'sources', coalesce(
      (select jsonb_agg(s - 'id')
         from jsonb_array_elements(app.studio_sources(v_pid)) s),
      '[]'::jsonb),
    'team', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', s.name, 'role', s.title,
               'on_this_project', (s.slug = 'chief-of-staff' or coalesce(ps.active, true)),
               'brief_here', nullif(coalesce(ps.instruction, ''), ''))
               order by s.name), '[]'::jsonb)
        from public.staff s
        left join public.project_staff ps
          on ps.staff_id = s.staff_id and ps.project_id = v_pid
       where s.active),
    'automations', app.project_automations(p_office, v_pid),
    'answers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'by', coalesce(st.name, 'The team'),
               'text', o.body,
               'how_sure', o.confidence,
               'on_what', o.evidence,
               'at', o.created_at) order by o.created_at), '[]'::jsonb)
        from public.outputs o
        join public.jobs j on j.job_id = o.job_id
        left join public.staff st on st.staff_id = o.staff_id
       where j.project_id = v_pid and j.office_id = p_office and not j.is_fixture)
  ))
  );
end;
$function$;

CREATE FUNCTION app.send_to_agent(p_office uuid, p_kind text, p_id uuid, p_action text, p_to text DEFAULT NULL::text, p_with uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  a          record;
  v_title    text;
  v_project  uuid;
  v_command  uuid;
  v_said     text;
  v_queued   jsonb;
  v_key      text;
  v_refusal  text;
  v_by       text;
begin
  perform app.require_office(p_office);
  -- Nobody named means the office's own person, never a hard-coded one.
  v_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  v_refusal := app.principal_refusal(v_by);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal);
  end if;
  select * into a from public.asset_actions where action = lower(btrim(coalesce(p_action, '')));
  if not found then
    return jsonb_build_object('ok', false, 'error',
      format('no such action: %s', coalesce(p_action, '(none)')));
  end if;
  /*
    The asset's own name and project, from whichever table it lives in.
    Four branches rather than a lookup table: the id columns and the title
    columns genuinely differ, and a generic resolver would need the same four
    branches with a layer of indirection over them.
  */
  if p_kind = 'document' then
    select d.title, d.project_id into v_title, v_project
      from public.documents d where d.document_id = p_id and d.office_id = p_office;
  elsif p_kind = 'task' then
    select t.title, t.project_id into v_title, v_project
      from public.tasks t where t.task_id = p_id and t.office_id = p_office;
  elsif p_kind = 'contact' then
    select c.name, c.project_id into v_title, v_project
      from public.contacts c
      join public.projects cp on cp.project_id = c.project_id and cp.office_id = p_office
     where c.contact_id = p_id;
  elsif p_kind = 'collection' then
    select c.name, c.project_id into v_title, v_project
      from public.collections c
      join public.projects cp on cp.project_id = c.project_id and cp.office_id = p_office
     where c.collection_id = p_id;
  else
    return jsonb_build_object('ok', false, 'error',
      format('cannot send a %s', coalesce(p_kind, '(nothing)')));
  end if;
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no such %s', p_kind));
  end if;
  -- 0618: who may send WHAT, WHERE: a test principal only in a fixture project.
  v_refusal := app.authority_refusal(v_by, null, v_project);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal);
  end if;
  -- The second thing is the office's too; an id from elsewhere is as absent as one that never was.
  if p_with is not null and not app.endpoint_in_office(p_office, p_kind, p_with) then
    return jsonb_build_object('ok', false, 'error', format('no such %s', p_kind));
  end if;
  if a.needs_two and p_with is null then
    return jsonb_build_object('ok', false, 'error',
      format('%s needs a second thing to compare against', a.label));
  end if;
  v_said := format(a.says, coalesce(nullif(v_title, ''), 'this'));
  if coalesce(btrim(p_note), '') <> '' then
    v_said := v_said || ' ' || btrim(p_note);
  end if;
  v_key := format('asset:%s:%s:%s:%s', p_kind, p_id, a.action,
                  to_char(app.now_utc(), 'YYYYMMDDHH24MISSMS'));
  insert into public.inbound_commands
    (office_id, project_id, origin_channel, origin_ref, actor, instruction, addressed_to, dedupe_key, context)
  values (p_office, v_project, 'teamhq', v_key, v_by, v_said,
          nullif(btrim(coalesce(p_to, '')), ''),
          v_key,
          jsonb_build_object(
            'asset_kind', p_kind,
            'asset_id', p_id,
            'asset_title', v_title,
            'action', a.action,
            'compare_with', p_with,
            'project_id', v_project))
  returning command_id into v_command;
  v_queued := app.enqueue_inbound(v_command);
  if v_queued->>'job_id' is null then
    return jsonb_build_object('ok', false, 'error',
      coalesce(v_queued->>'error', 'the queue refused it'));
  end if;
  insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, made_by)
  values (v_project, p_kind, p_id, 'input_to', 'job', (v_queued->>'job_id')::uuid, 'teamhq')
  on conflict do nothing;
  if p_with is not null then
    insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, made_by)
    values (v_project, p_kind, p_with, 'input_to', 'job', (v_queued->>'job_id')::uuid, 'teamhq')
    on conflict do nothing;
  end if;
  return jsonb_build_object(
    'ok', true, 'job', v_queued->>'job_id', 'action', a.label,
    'about', v_title, 'said', v_said);
end;
$function$;

create function public.awaiting_review(p_office uuid, p_project uuid)
 returns TABLE(document_id uuid, title text, produced_by text, produced_by_job uuid, created_at timestamp with time zone, derived_from text[], state text, kind text)
 language sql stable
 security definer
 set search_path to ''
as $f$ select * from app.awaiting_review(p_office, p_project) $f$;

create function public.decide_output(p_office uuid, p_output uuid, p_verdict text, p_why text default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.decide_output(p_office, p_output, p_verdict, p_why) $f$;

create function public.hq_document_link(p_office uuid, p_project_id uuid, p_connector text, p_external_ref text, p_title text, p_mime text default null, p_source_title text default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_document_link(p_office, p_project_id, p_connector, p_external_ref, p_title, p_mime, p_source_title) $f$;

create function public.hq_document_move(p_office uuid, p_document_id uuid, p_project_id uuid)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_document_move(p_office, p_document_id, p_project_id) $f$;

create function public.hq_document_order_reset(p_office uuid, p_slug text)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$ select app.hq_document_order_reset(p_office, p_slug) $f$;

create function public.hq_document_order_set(p_office uuid, p_slug text, p_ids jsonb)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$ select app.hq_document_order_set(p_office, p_slug, p_ids) $f$;

create function public.hq_document_pin(p_office uuid, p_document_id uuid, p_pinned boolean)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_document_pin(p_office, p_document_id, p_pinned) $f$;

create function public.hq_document_restore(p_office uuid, p_document_id uuid, p_state text default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_document_restore(p_office, p_document_id, p_state) $f$;

create function public.hq_document_supersede(p_office uuid, p_document_id uuid, p_by_document_id uuid)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_document_supersede(p_office, p_document_id, p_by_document_id) $f$;

create function public.hq_output(p_office uuid, p_output_id uuid)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$ select app.hq_output(p_office, p_output_id) $f$;

create function public.import_output(p_office uuid, p_output uuid, p_collection text default null, p_tags text[] default null, p_related_task uuid default null, p_related_source uuid default null, p_title text default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.import_output(p_office, p_output, p_collection, p_tags, p_related_task, p_related_source, p_title) $f$;

create function public.put_in_collection(p_office uuid, p_document uuid, p_collection_name text)
 returns uuid
 language sql
 security definer
 set search_path to ''
as $f$ select app.put_in_collection(p_office, p_document, p_collection_name) $f$;

create function public.record_file_document(p_office uuid, p_project_id uuid, p_title text, p_storage_path text, p_mime_type text, p_byte_size bigint, p_parent_ref text default null, p_external_ref text default null, p_duration_s integer default null, p_added_by text default 'chief-of-staff', p_job_id uuid default null, p_origin text default 'made')
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$ select app.record_file_document(p_office, p_project_id, p_title, p_storage_path, p_mime_type, p_byte_size, p_parent_ref, p_external_ref, p_duration_s, p_added_by, p_job_id, p_origin) $f$;

create function public.rename_document(p_office uuid, p_document uuid, p_title text)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.rename_document(p_office, p_document, p_title) $f$;

create function public.studio_document(p_office uuid, p_document_id uuid)
 returns jsonb
 language sql stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.studio_document(p_office, p_document_id) $f$;

create function public.tag_document(p_office uuid, p_document uuid, p_tag text, p_on boolean default true)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.tag_document(p_office, p_document, p_tag, p_on) $f$;

create function public.take_out_of_collection(p_office uuid, p_document uuid, p_collection_name text)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.take_out_of_collection(p_office, p_document, p_collection_name) $f$;

create function public.relations_of(p_office uuid, p_kind text, p_id uuid)
 returns TABLE(direction text, verb text, other_kind text, other_id uuid, other_title text)
 language sql stable
 security definer
 set search_path to ''
as $f$ select * from app.relations_of(p_office, p_kind, p_id) $f$;

create function public.send_to_agent(p_office uuid, p_kind text, p_id uuid, p_action text, p_to text default null, p_with uuid default null, p_note text default null, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.send_to_agent(p_office, p_kind, p_id, p_action, p_to, p_with, p_note, p_by) $f$;

create function public.hq_artifacts(p_office uuid)
 returns jsonb
 language sql stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_artifacts(p_office) $f$;

create function public.project_artifacts(p_office uuid, p_project uuid)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$ select app.project_artifacts(p_office, p_project) $f$;

create function public.project_export(p_office uuid, p_project_id uuid)
 returns jsonb
 language sql stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.project_export(p_office, p_project_id) $f$;

create function public.studio_search(p_office uuid, p_query text, p_project uuid default null, p_limit integer default 12, p_filters jsonb default '{}')
 returns TABLE(kind text, ref uuid, title text, snippet text, place text, rank real, at timestamp with time zone)
 language sql stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select * from app.studio_search(p_office, p_query, p_project, p_limit, p_filters) $f$;


create function public.approve_document(p_office uuid, p_document uuid, p_collection text default null,
  p_tags text[] default null, p_related_task uuid default null, p_related_source uuid default null,
  p_by text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_project uuid;
  v_refusal text;
begin
  perform app.require_office(p_office);
  -- The document is looked up INSIDE the office: another office's document has no project here, which is exactly
  -- what a document that does not exist has.
  select d.project_id into v_project from public.documents d
   where d.document_id = p_document and d.office_id = p_office;
  v_refusal := app.authority_refusal(p_by, null, v_project);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;
  return app.approve_document(p_office, p_document, p_collection, p_tags, p_related_task, p_related_source);
end
$f$;


create function public.discard_document(p_office uuid, p_document uuid, p_why text default null, p_by text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_project uuid;
  v_refusal text;
begin
  perform app.require_office(p_office);
  select d.project_id into v_project from public.documents d
   where d.document_id = p_document and d.office_id = p_office;
  v_refusal := app.authority_refusal(p_by, null, v_project);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;
  return app.discard_document(p_office, p_document, p_why);
end
$f$;


create function public.link(p_office uuid, p_project uuid, p_from_kind text, p_from_id uuid, p_verb text,
                             p_to_kind text, p_to_id uuid, p_made_by text default null)
 returns uuid
 language sql
 security definer
 set search_path to ''
as $f$ select app.link(p_office, p_project, p_from_kind, p_from_id, p_verb, p_to_kind, p_to_id, p_made_by) $f$;


do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.pronamespace::regnamespace::text as sch from pg_proc p
            where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
              and p.proname in ('approve_document','awaiting_review','decide_output','discard_document','hq_document_link','hq_document_move','hq_document_order_reset','hq_document_order_set','hq_document_pin','hq_document_restore','hq_document_supersede','hq_output','import_output','put_in_collection','record_file_document','rename_document','studio_document','tag_document','take_out_of_collection','relations_of','send_to_agent','hq_artifacts','project_artifacts','project_export','studio_search','link', 'artifacts_in', 'endpoint_in_office')
              and (pg_get_function_arguments(p.oid)) like 'p_office uuid%'
  loop
    if r.sch = 'public' then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    else
      execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    end if;
  end loop;
end $g$;


-- The undo dispatcher: its three document branches now say whose document. Spliced from the live definition.
do $m$
declare v text;
begin
  v := pg_get_functiondef('app.hq_undo(uuid,text)'::regprocedure);
  if position('app.rename_document((v_args ->> ''p_document'')::uuid,' in v) = 0
     or position('app.hq_document_move((v_args ->> ''p_document_id'')::uuid,' in v) = 0
     or position('app.hq_document_restore((v_args ->> ''p_document_id'')::uuid,' in v) = 0 then
    raise exception 'splice anchor missing in app.hq_undo';
  end if;
  v := replace(v, 'app.rename_document((v_args ->> ''p_document'')::uuid,', 'app.rename_document(p_office, (v_args ->> ''p_document'')::uuid,');
  v := replace(v, 'app.hq_document_move((v_args ->> ''p_document_id'')::uuid,', 'app.hq_document_move(p_office, (v_args ->> ''p_document_id'')::uuid,');
  v := replace(v, 'app.hq_document_restore((v_args ->> ''p_document_id'')::uuid,', 'app.hq_document_restore(p_office, (v_args ->> ''p_document_id'')::uuid,');
  if position('app.rename_document(p_office,' in v) = 0 or position('app.hq_document_move(p_office,' in v) = 0
     or position('app.hq_document_restore(p_office,' in v) = 0 then
    raise exception 'splice did not land in app.hq_undo';
  end if;
  execute v;
end $m$;


----------------------------------------------------------------------------------------------------------------------
-- the old signatures go: nothing may touch a document without saying whose
----------------------------------------------------------------------------------------------------------------------
drop function public.approve_document(uuid, text, text[], uuid, uuid, text);
drop function app.approve_document(uuid, text, text[], uuid, uuid);
drop function public.awaiting_review(uuid);
drop function app.awaiting_review(uuid);
drop function public.decide_output(uuid, text, text);
drop function app.decide_output(uuid, text, text);
drop function public.discard_document(uuid, text, text);
drop function app.discard_document(uuid, text);
drop function public.hq_document_link(uuid, text, text, text, text, text);
drop function app.hq_document_link(uuid, text, text, text, text, text);
drop function public.hq_document_move(uuid, uuid);
drop function app.hq_document_move(uuid, uuid);
drop function public.hq_document_order_reset(text);
drop function app.hq_document_order_reset(text);
drop function public.hq_document_order_set(text, jsonb);
drop function app.hq_document_order_set(text, jsonb);
drop function public.hq_document_pin(uuid, boolean);
drop function app.hq_document_pin(uuid, boolean);
drop function public.hq_document_restore(uuid, text);
drop function app.hq_document_restore(uuid, text);
drop function public.hq_document_supersede(uuid, uuid);
drop function app.hq_document_supersede(uuid, uuid);
drop function public.hq_output(uuid);
drop function app.hq_output(uuid);
drop function public.import_output(uuid, text, text[], uuid, uuid, text);
drop function app.import_output(uuid, text, text[], uuid, uuid, text);
drop function public.put_in_collection(uuid, text);
drop function app.put_in_collection(uuid, text);
drop function public.record_file_document(uuid, text, text, text, bigint, text, text, integer, text, uuid, text);
drop function app.record_file_document(uuid, text, text, text, bigint, text, text, integer, text, uuid, text);
drop function public.rename_document(uuid, text);
drop function app.rename_document(uuid, text);
drop function public.studio_document(uuid);
drop function app.studio_document(uuid);
drop function public.tag_document(uuid, text, boolean);
drop function app.tag_document(uuid, text, boolean);
drop function public.take_out_of_collection(uuid, text);
drop function app.take_out_of_collection(uuid, text);
drop function public.relations_of(text, uuid);
drop function app.relations_of(text, uuid);
drop function public.send_to_agent(text, uuid, text, text, uuid, text, text);
drop function app.send_to_agent(text, uuid, text, text, uuid, text, text);
drop function public.hq_artifacts();
drop function app.hq_artifacts();
drop function public.project_artifacts(uuid);
drop function app.project_artifacts(uuid);
drop function public.project_export(uuid);
drop function app.project_export(uuid);
drop function public.studio_search(text, uuid, integer, jsonb);
drop function app.studio_search(text, uuid, integer, jsonb);
drop function public.link(uuid, text, uuid, text, text, uuid, text);
drop function app.link(uuid, text, uuid, text, text, uuid, text);
drop function app.artifacts_in(uuid, text[], integer);
