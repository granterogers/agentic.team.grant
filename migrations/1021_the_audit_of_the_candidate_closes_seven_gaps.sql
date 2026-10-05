-- 1021: seven defects the final audit found in the candidate, each driven on a replica before this was written.
--
--   1. A source document moved to another project passed the disconnected-source gate: app.source_connected treats "no
--      attachment names it" as connected, deliberately, for READERS (hiding what cannot be attributed is the expensive
--      direction), so a moved document read as connected and Import, preview and the background indexer would have read a
--      switched-off folder. A document read from a connected source now cannot be moved; import a copy, which can.
--   2. app.hq_document_import made a managed copy from held text when only the Google LOGIN was gone. A disconnected
--      source makes no new managed copy; a copy that already exists is untouched.
--   3. app.hq_document_supersede archived a document in favour of a DRAFT, or of one in another project, so the logical
--      document vanished from the list (a draft must never make the approved document disappear).
--   4. app.mcp_document returned the text of a document whose source is switched off (every retrieval reader asks
--      app.document_in_play; this one did not).
--   5. app.mcp_task_update changed the title and THEN refused the state change, leaving a half-applied update; and let an
--      assistant reopen a task its owner cancelled. Both halves of the update are now one unit, and a cancelled task stays so.
--   6. app.project_search applied the kinds filter AFTER the per-provider limit, so kinds=source could return nothing while
--      matches existed.
--   7. app.mcp_add_document and app.mcp_enqueue checked only that the client was enabled, not that it holds the write
--      scope (the edge enforces it; the database now does too).
-- And the calendar-event-sync duty ships switched OFF, like drive-index: enable it once the worker that handles it is deployed.
--
-- Every function is spliced from its LIVE definition and each edit is asserted to have landed.

CREATE OR REPLACE FUNCTION app.hq_document_move(p_office uuid, p_document_id uuid, p_project_id uuid)
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
  v_origin      text;
begin
  perform app.require_office(p_office);
  select d.project_id, d.title, d.origin into v_was_project, v_title, v_origin
    from public.documents d where d.document_id = p_document_id and d.office_id = p_office;
  if v_title is null then
    return jsonb_build_object('error', 'there is no document with that id');
  end if;
  -- A document read from a connected source belongs to the project whose attachment feeds it. Moving it would carry it
  -- to a project that names no attachment for its folder, which the disconnected-source gate (0896, 1010) cannot see.
  if v_origin = 'source' then
    return jsonb_build_object('error', 'a document read from a connected source belongs to the project that source is attached to, so it cannot be moved; import a copy first');
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

CREATE OR REPLACE FUNCTION app.hq_document_import(p_office uuid, p_document uuid, p_channel text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  o public.documents%rowtype;
  v_copy uuid;
  v_req  uuid;
  v_job  uuid;
  v_state text;
begin
  perform app.require_office(p_office);
  select * into o from public.documents where document_id = p_document and office_id = p_office for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'there is no document with that id');
  end if;
  if o.origin <> 'source' then
    return jsonb_build_object('ok', false, 'error', 'Team HQ already holds that document; there is nothing to import');
  end if;
  if o.state = 'archived' then
    return jsonb_build_object('ok', false, 'error', 'that document is archived');
  end if;
  select c.document_id into v_copy from public.documents c
   where c.office_id = p_office and c.imported_from_document_id = o.document_id;
  if v_copy is not null then
    return jsonb_build_object('ok', true, 'state', 'imported', 'already', true, 'copy_id', v_copy);
  end if;
  v_state := app.document_source_state(p_office, o.document_id);
  if v_state = 'attachment_disabled' then
    return app.source_disconnected(p_office, o.document_id, v_state);
  end if;
  if v_state = 'provider_disconnected' then
    return app.source_disconnected(p_office, o.document_id, v_state);
  end if;
  if app.document_material_held(p_office, o.document_id) then
    v_copy := app.document_import_copy(p_office, o.document_id, p_channel);
    update public.document_import_requests
       set state = 'done', copy_document_id = v_copy, done_at = app.now_utc()
     where office_id = p_office and document_id = o.document_id and state = 'pending';
    return jsonb_build_object('ok', true, 'state', 'imported', 'already', false, 'copy_id', v_copy);
  end if;
  insert into public.document_import_requests (office_id, document_id, requested_by, channel)
  values (p_office, o.document_id, app.office_actor(p_office), nullif(btrim(coalesce(p_channel, '')), ''))
  on conflict (office_id, document_id) do nothing
  returning request_id into v_req;
  if v_req is null then
    select r.request_id into v_req from public.document_import_requests r
     where r.office_id = p_office and r.document_id = o.document_id;
  end if;
  v_job := app.document_import_enqueue_fetch(p_office, o.document_id);
  return jsonb_build_object(
    'ok', true, 'state', 'pending', 'request_id', v_req,
    'needs', case o.connector when 'drive' then 'drive.read_file' else 'source_read' end,
    'fetch_job_id', v_job,
    'note', case when v_job is not null
                 then 'Requested. Team HQ is fetching the file from Drive now; the copy is made when it arrives.'
                 else 'Team HQ does not hold this document''s text or file yet. The import is recorded and completes when the source has been read.' end);
end
$function$;

CREATE OR REPLACE FUNCTION app.hq_document_supersede(p_office uuid, p_document_id uuid, p_by_document_id uuid)
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
  if exists (
    with recursive up(id, path) as (
      select p_by_document_id, array[p_by_document_id]
      union all
      select d.superseded_by, up.path || d.superseded_by
        from up join public.documents d on d.document_id = up.id and d.office_id = p_office
       where d.superseded_by is not null and not d.superseded_by = any (up.path))
    select 1 from up where up.id = p_document_id) then
    return jsonb_build_object('error', 'that would make the two documents each the replacement of the other');
  end if;
  select d.title, d.state into v_title, v_was
    from public.documents d where d.document_id = p_document_id and d.office_id = p_office;
  select d.title into v_by from public.documents d where d.document_id = p_by_document_id and d.office_id = p_office;
  if v_title is null or v_by is null then
    return jsonb_build_object('error', 'one of those documents does not exist');
  end if;
  if not exists (select 1 from public.documents a, public.documents b
                  where a.document_id = p_document_id and b.document_id = p_by_document_id
                    and a.office_id = p_office and b.office_id = p_office
                    and b.state = 'approved' and b.project_id is not distinct from a.project_id) then
    return jsonb_build_object('error', 'the replacement must be an approved document in the same project; a draft never makes the approved one disappear');
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

CREATE OR REPLACE FUNCTION app.mcp_document(p_office uuid, p_document_id uuid, p_max_chars integer DEFAULT 20000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  if exists (select 1 from public.documents d
              where d.document_id = p_document_id and d.office_id = p_office
                and not app.document_in_play(d.state, d.origin, d.project_id, d.connector, d.external_parent_ref)) then
    return jsonb_build_object('error', 'that document is archived, or its source is disconnected, so its text is not available');
  end if;
  return coalesce(
    (select jsonb_build_object(
              'document_id', d.document_id,
              'title', d.title,
              'connector', d.connector,
              'project', (select p.slug from public.projects p where p.project_id = d.project_id and p.office_id = p_office),
              'chars', d.content_chars,
              'truncated', d.content_chars > greatest(1000, least(coalesce(p_max_chars, 20000), 60000)),
              'fetched_at', d.fetched_at,
              'content', left(coalesce(d.content, ''),
                              greatest(1000, least(coalesce(p_max_chars, 20000), 60000)))
            )
       from public.documents d where d.document_id = p_document_id and d.office_id = p_office),
    jsonb_build_object('error', 'no such document'));
end
$function$;

CREATE OR REPLACE FUNCTION app.mcp_task_update(p_office uuid, p_client_id text, p_task_id text, p_state text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_detail text DEFAULT NULL::text, p_due_on date DEFAULT NULL::date, p_blocked_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_via text; v_id uuid; v_project uuid; v_title text; v_state text; v jsonb; v_changed text[] := '{}';
begin
  v_via := app.mcp_write_client(p_office, p_client_id);
  if v_via is null then return jsonb_build_object('error', 'no such client, or it is read-only'); end if;
  begin v_id := p_task_id::uuid; exception when others then return jsonb_build_object('error', 'that is not a task id'); end;
  select t.project_id, t.title, t.state into v_project, v_title, v_state
    from public.tasks t join public.projects p on p.project_id = t.project_id and p.office_id = p_office and not p.is_fixture
   where t.task_id = v_id and t.office_id = p_office;
  if v_project is null then return jsonb_build_object('error', 'no task with that id'); end if;
  -- Taking work back is not an assistant's to do: no cancelling, no deleting.
  if p_state is not null and p_state not in ('todo', 'doing', 'blocked', 'done') then
    return jsonb_build_object('error', 'an assistant may set a task to todo, doing, blocked or done; it cannot cancel or delete one');
  end if;
  if p_state is null and p_title is null and p_detail is null and p_due_on is null then
    return jsonb_build_object('error', 'nothing to change');
  end if;
  if v_state = 'cancelled' then
    return jsonb_build_object('error', 'that task was cancelled by its owner; an assistant cannot reopen or change it');
  end if;
  perform set_config('app.via', v_via, true);
  /*
    One unit: a refusal part way through (a state change without a reason, after the title was already changed) must
    leave nothing changed. The two helpers REPORT refusal in their result, so it is raised here, inside a subtransaction
    that rolls the first half back, and turned into the same answer.
  */
  begin
    if p_title is not null or p_detail is not null or p_due_on is not null then
      v := app.hq_task_update(p_office, p_task_id, p_title, p_detail, p_due_on);
      if v ? 'error' then raise exception '%', v ->> 'error' using errcode = 'P0001'; end if;
      v_changed := array_append(v_changed, 'details');
    end if;
    if p_state is not null then
      -- p_by stays null: the office's principal list does not know an MCP client, and the door is recorded below.
      v := app.hq_task_state(p_office, p_task_id, p_state, p_blocked_reason, null);
      if v ? 'error' then raise exception '%', v ->> 'error' using errcode = 'P0001'; end if;
      v_changed := array_append(v_changed, 'state: ' || p_state);
    end if;
  exception when sqlstate 'P0001' then
    return jsonb_build_object('error', sqlerrm);
  end;
  perform app.append_event(p_office, gen_random_uuid(), 'user', app.office_actor(p_office), 'mcp', 'task.updated', false,
                           v_project, null, null, left(format('changed %s (%s)', left(v_title, 80), array_to_string(v_changed, ', ')), 1000));
  return jsonb_build_object('ok', true, 'id', v_id, 'changed', to_jsonb(v_changed));
end
$function$;

CREATE OR REPLACE FUNCTION app.project_search(p_office uuid, p_query text, p_project uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20, p_kinds text DEFAULT NULL::text)
 RETURNS TABLE(kind text, id text, title text, snippet text, project_slug text, url_hint text, score real, at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_q tsquery;
  v_kinds text[];
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_inner integer;
begin
  perform app.require_office(p_office);
  v_q := websearch_to_tsquery('english', btrim(coalesce(p_query, '')));
  -- a query with no lexemes ("the and of") is NULL here and matches nothing: the answer is "nothing", not an error
  if v_q is null or v_q::text = '' then return; end if;
  -- a project of another office is a project that does not exist
  if p_project is not null
     and not exists (select 1 from public.projects where project_id = p_project and office_id = p_office) then
    return;
  end if;
  v_kinds := case when nullif(btrim(coalesce(p_kinds, '')), '') is null then null
                  else string_to_array(lower(regexp_replace(p_kinds, '\s+', '', 'g')), ',') end;

  -- A kinds filter is applied after the providers answer, so each is asked for the most it may give; otherwise a
  -- kind that ranks below ten documents is dropped before it is looked at.
  v_inner := case when v_kinds is null then v_limit else 50 end;
  return query
  select h.kind, h.id, h.title, h.snippet, h.project_slug, h.url_hint, h.score, h.at
    from (
      select * from app.psearch_documents(p_office, p_project, v_q, v_inner)
      union all select * from app.psearch_tasks(p_office, p_project, v_q, v_inner)
      union all select * from app.psearch_chat(p_office, p_project, v_q, v_inner)
      union all select * from app.psearch_research(p_office, p_project, v_q, v_inner)
      union all select * from app.psearch_postits(p_office, p_project, v_q, v_inner)
      union all select * from app.psearch_events(p_office, p_project, v_q, v_inner)
    ) h
   where v_kinds is null or h.kind = any(v_kinds)
   order by h.score desc, h.at desc
   limit v_limit;
end
$function$;

CREATE OR REPLACE FUNCTION app.mcp_add_document(p_office uuid, p_client_id text, p_project text, p_title text, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_id uuid;
  v_fingerprint text;
  v_existing uuid;
begin
  perform app.require_office(p_office);
  if app.mcp_write_client(p_office, p_client_id) is null then
    return jsonb_build_object('error', 'no such client, or it is read-only');
  end if;
  select project_id into v_project
    from public.projects where office_id = p_office and slug = p_project and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active project with slug %L', p_project));
  end if;
  if coalesce(trim(p_content), '') = '' then
    return jsonb_build_object('error', 'content is empty; refusing to store an empty document');
  end if;
  if coalesce(trim(p_title), '') = '' then
    return jsonb_build_object('error', 'title is required');
  end if;

  v_fingerprint := encode(sha256(convert_to(p_content, 'UTF8')), 'hex');

  select document_id into v_existing
    from public.documents
   where office_id = p_office and project_id = v_project and content_fingerprint = v_fingerprint;
  if v_existing is not null then
    return jsonb_build_object(
      'document_id', v_existing, 'title', p_title, 'duplicate', true,
      'note', 'identical content already in this project; nothing was added'
    );
  end if;

  insert into public.documents
    (office_id, project_id, connector, external_parent_ref, external_ref, title, doc_type,
     content, content_fingerprint, content_chars, fetched_at, added_by)
  values (p_office, v_project, 'mcp', null, null, p_title, 'note',
          p_content, v_fingerprint, length(p_content), app.now_utc(), p_client_id)
  returning document_id into v_id;

  return jsonb_build_object(
    'document_id', v_id, 'title', p_title, 'chars', length(p_content), 'duplicate', false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app.mcp_enqueue(p_office uuid, p_client_id text, p_project text, p_kind text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_job uuid;
begin
  perform app.require_office(p_office);
  -- The client is the OFFICE'S: a client of another office is not one this office can enqueue as.
  if not exists (select 1 from public.mcp_clients k where k.client_id = p_client_id and k.office_id = p_office and k.enabled) then
    return jsonb_build_object('error', 'no such client');
  end if;
  -- Asking the notebook a question reads; everything else a client may enqueue writes, so it needs the write scope.
  if p_kind <> 'notebook.ask' and app.mcp_write_client(p_office, p_client_id) is null then
    return jsonb_build_object('error', 'no such client, or it is read-only');
  end if;
  -- The list is fixed for the same reason the tool list is: a client naming a
  -- job kind is a client choosing what the worker does.
  if p_kind not in ('notebook.generate', 'notebook.push_document', 'notebook.ask') then
    return jsonb_build_object('error', format('%L is not a kind a client may enqueue', p_kind));
  end if;

  select project_id into v_project
    from public.projects where office_id = p_office and slug = p_project and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active project with slug %L', p_project));
  end if;

  insert into public.jobs
    (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
  values (p_office, gen_random_uuid(), v_project,
          format('mcp-%s-%s', p_client_id, gen_random_uuid()),
          p_kind, format('mcp:%s', p_client_id), 200,
          -- 0616: what says a job was approved, or where it came from, is never a client's to send.
          coalesce(p_payload, '{}'::jsonb) - 'approved_by' - 'approval' - 'approval_next'
            - 'command_id' - 'origin_namespace' - 'plan_steps')
  returning job_id into v_job;

  return jsonb_build_object(
    'job_id', v_job, 'kind', p_kind, 'state', 'queued',
    'note', 'the worker picks this up; call check_job with the id'
  );
end;
$function$;


update public.responsibilities set enabled = false
 where slug = 'calendar-event-sync' and enabled;

-- A late self-check: the three that matter, each by the property and not by the name.
do $check$
declare v_on integer;
begin
  select count(*) into v_on from public.responsibilities where slug in ('drive-index', 'calendar-event-sync') and enabled;
  if v_on <> 0 then raise exception '1021: a background duty that must ship switched off is on (%)', v_on; end if;
  if pg_get_functiondef('app.mcp_document(uuid,uuid,integer)'::regprocedure) not like '%document_in_play%' then
    raise exception '1021: mcp_document does not ask document_in_play';
  end if;
end
$check$;
