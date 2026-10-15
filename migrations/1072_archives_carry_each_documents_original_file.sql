begin;

-- Project backups carry each document's ORIGINAL file, not only its extracted text (issue #471, C2 follow-up).
--
-- What changed, and only this:
--   * app.project_export gives each approved document an 'original' object: its stored file's path, MIME type and size,
--     or null for a document with no file. The archive route reads the bytes from storage and replaces the path with an
--     archive entry, so the storage location never reaches a backup file.
--   * app.project_restore writes the three file columns (storage_path, mime_type, byte_size) together, because
--     documents_file_is_complete (0205) is all-or-nothing. It refuses any stored path outside
--     restores/<office>/, so a package cannot point a restored document at another office's files.
--
-- Both functions are the live definitions from pg_get_functiondef, changed in the lines above and nothing else.

CREATE OR REPLACE FUNCTION app.project_export(p_office uuid, p_project_id uuid)
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
               'created_at', d.created_at,
               'original', case when d.storage_path is null then null
                 else jsonb_build_object('mime_type', d.mime_type, 'bytes', d.byte_size, 'storage_path', d.storage_path) end) order by d.created_at), '[]'::jsonb)
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

CREATE OR REPLACE FUNCTION app.project_restore(p_office uuid, p_key text, p_package jsonb, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project   jsonb;
  v_base_name text;
  v_base_slug text;
  v_name      text;
  v_slug      text;
  v_n         int := 0;
  v_pid       uuid;
  v_by        text;
  v_renamed   boolean := false;
  v_alias_note text := '';
  v_existing  jsonb;
  v_report    jsonb;
  v_docs      jsonb;
  v_tasks     jsonb;
  v_contacts  jsonb;
  v_colls     jsonb;
  v_brief     text;
  v_did       uuid;
  v_cid       uuid;
  v_lid       uuid;
  v_colid     uuid;
  v_text      text;
  v_fp        text;
  v_state     text;
  v_doc_req   int;
  v_doc_in    int := 0;
  v_doc_text  int := 0;
  v_doc_nofp  int := 0;
  v_task_req  int;
  v_task_in   int := 0;
  v_task_bad  int := 0;
  v_con_req   int;
  v_con_in    int := 0;
  v_con_bad   int := 0;
  v_col_in    int := 0;
  v_brief_st  text := 'absent';
  v_link_miss int := 0;
  d           jsonb;
  t           jsonb;
  c           jsonb;
  col         jsonb;
  lab         text;
begin
  perform app.require_office(p_office);

  -- ---- validation: nothing is written until every check passes ----
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'the archive has no valid checksum key');
  end if;
  if p_package is null or jsonb_typeof(p_package) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'the archive does not hold a project package');
  end if;
  if (p_package ->> 'format') is distinct from 'ai-team-hq/project-package' then
    return jsonb_build_object('ok', false, 'error', 'the archive is not an Agentic Team project package');
  end if;
  if (p_package ->> 'format_version') is distinct from '1' then
    return jsonb_build_object('ok', false, 'error',
      'this package version is not supported by this office (version 1 is the only one it reads)');
  end if;

  v_project := p_package -> 'project';
  if jsonb_typeof(v_project) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'error', 'the package has no project');
  end if;
  v_base_name := btrim(coalesce(v_project ->> 'name', ''));
  if v_base_name = '' then
    return jsonb_build_object('ok', false, 'error', 'the package has no project name');
  end if;
  if length(v_base_name) > 200 then
    return jsonb_build_object('ok', false, 'error', 'the project name is longer than 200 characters');
  end if;

  foreach lab in array array['documents', 'tasks', 'contacts', 'collections', 'answers', 'team', 'automations', 'sources'] loop
    if p_package ? lab and jsonb_typeof(p_package -> lab) not in ('array') then
      return jsonb_build_object('ok', false, 'error', format('the package field %s is not a list', lab));
    end if;
  end loop;

  v_docs := coalesce(p_package -> 'documents', '[]'::jsonb);
  v_tasks := coalesce(p_package -> 'tasks', '[]'::jsonb);
  v_contacts := coalesce(p_package -> 'contacts', '[]'::jsonb);
  v_colls := coalesce(p_package -> 'collections', '[]'::jsonb);
  v_doc_req := jsonb_array_length(v_docs);
  v_task_req := jsonb_array_length(v_tasks);
  v_con_req := jsonb_array_length(v_contacts);

  if v_doc_req > 2000 then
    return jsonb_build_object('ok', false, 'error', 'the package holds more than 2000 documents, the most one restore takes');
  end if;
  if v_task_req > 5000 then
    return jsonb_build_object('ok', false, 'error', 'the package holds more than 5000 tasks, the most one restore takes');
  end if;
  if v_con_req > 2000 then
    return jsonb_build_object('ok', false, 'error', 'the package holds more than 2000 contacts, the most one restore takes');
  end if;
  if jsonb_array_length(v_colls) > 500 then
    return jsonb_build_object('ok', false, 'error', 'the package holds more than 500 collections, the most one restore takes');
  end if;
  if exists (select 1 from jsonb_array_elements(v_docs) e
              where jsonb_typeof(e) <> 'object' or length(coalesce(e ->> 'text', '')) > 2000000) then
    return jsonb_build_object('ok', false, 'error', 'a document is not an object, or its text is longer than 2,000,000 characters');
  end if;

  v_by := coalesce(nullif(btrim(coalesce(p_by, '')), ''), 'grant');

  -- ---- idempotency: record the key first; a repeat returns what the first call made ----
  insert into public.project_restores (office_id, idempotency_key, restored_by)
  values (p_office, p_key, v_by)
  on conflict (office_id, idempotency_key) do nothing;
  if not found then
    select jsonb_build_object('ok', true, 'already', true, 'project_id', r.project_id,
                              'slug', r.report ->> 'slug', 'report', r.report)
      into v_existing
      from public.project_restores r
     where r.office_id = p_office and r.idempotency_key = p_key;
    return v_existing;
  end if;

  -- ---- naming: never reuse a live project's slug; suffix and say so ----
  v_base_slug := left(trim(both '-' from regexp_replace(lower(v_base_name), '[^a-z0-9]+', '-', 'g')), 60);
  if v_base_slug = '' then v_base_slug := 'project'; end if;
  v_name := v_base_name;
  v_slug := v_base_slug;
  while exists (select 1 from public.projects p where p.slug = v_slug and p.office_id = p_office) loop
    v_n := v_n + 1;
    if v_n > 50 then
      raise exception 'could not find a free slug for the restored project' using errcode = '22023';
    end if;
    v_renamed := true;
    v_name := v_base_name || ' (restored' || case when v_n > 1 then ' ' || v_n else '' end || ')';
    v_slug := left(v_base_slug, 48) || '-restored' || case when v_n > 1 then '-' || v_n else '' end;
  end loop;

  -- ---- the project: the same three writes hq_create_project makes ----
  insert into public.projects (office_id, slug, name, channel_prefix, status, icon)
  values (p_office, v_slug, v_name, left(v_slug, 48), 'active', app.icon_for_name(v_name))
  returning project_id into v_pid;

  insert into public.project_attachments (project_id, connector, external_ref, display_name, role)
  values (v_pid, 'upload', 'archive:' || left(p_key, 16), 'Restored archive', 'source');

  begin
    perform app.add_project_alias(p_office, v_pid, v_base_name, 'name', 1.0);
  exception when others then
    -- A phrase another live project already answers to is refused by the alias writer. The project is still restored;
    -- the report says the name is not a routing alias, so Grant can add one by hand.
    v_alias_note := sqlerrm;
  end;

  perform app.record_channel_authority(p_office, v_pid, v_by, null);

  -- ---- collections (before documents, so membership can be linked) ----
  for col in select e.value from jsonb_array_elements(v_colls) e loop
    if btrim(coalesce(col ->> 'name', '')) = '' then continue; end if;
    insert into public.collections (project_id, name, position)
    values (v_pid, btrim(col ->> 'name'), coalesce((col ->> 'position')::int, 0))
    on conflict (project_id, name) do nothing;
    v_col_in := v_col_in + 1;
  end loop;

  -- ---- documents ----
  for d in select e.value from jsonb_array_elements(v_docs) e loop
    v_text := d ->> 'text';
    v_fp := case when v_text is null then null
                 else encode(sha256(convert_to(v_text, 'UTF8')), 'hex') end;
    v_state := 'approved';
    -- A stored original may only sit under this office's restore area. The route writes it there; this is the second line.
    if nullif(d #>> '{original,storage_path}', '') is not null
       and left(d #>> '{original,storage_path}', length('restores/' || p_office::text || '/')) <> 'restores/' || p_office::text || '/' then
      raise exception 'a stored original is outside this office''s restore area';
    end if;
    insert into public.documents (
      project_id, office_id, title, doc_type, content, content_fingerprint, content_chars,
      fetched_at, origin, connector, state, tags, source_title, produced_by, added_by,
      created_at, updated_at, storage_path, mime_type, byte_size
    ) values (
      v_pid, p_office,
      coalesce(nullif(btrim(d ->> 'title'), ''), 'Untitled'),
      nullif(d ->> 'kind', ''),
      v_text,
      v_fp,
      case when v_text is null then null else length(v_text) end,
      case when v_text is null then null else app.now_utc() end,
      'yours', null, v_state,
      coalesce(array(select jsonb_array_elements_text(coalesce(d -> 'tags', '[]'::jsonb))), '{}'::text[]),
      nullif(d ->> 'came_from', ''),
      nullif(d ->> 'made_by', ''),
      'restore',
      coalesce((d ->> 'created_at')::timestamptz, app.now_utc()),
      app.now_utc(),
      nullif(d #>> '{original,storage_path}', ''),
      case when nullif(d #>> '{original,storage_path}', '') is null then null else d #>> '{original,mime_type}' end,
      case when nullif(d #>> '{original,storage_path}', '') is null then null else (d #>> '{original,bytes}')::bigint end
    ) returning document_id into v_did;
    v_doc_in := v_doc_in + 1;
    if v_text is null then v_doc_nofp := v_doc_nofp + 1; else v_doc_text := v_doc_text + 1; end if;

    for lab in select e.value #>> '{}' from jsonb_array_elements(coalesce(d -> 'in_collections', '[]'::jsonb)) e loop
      select c2.collection_id into v_colid
        from public.collections c2
       where c2.project_id = v_pid and c2.name = lab;
      if v_colid is null then
        v_link_miss := v_link_miss + 1;
      else
        insert into public.document_collections (document_id, collection_id)
        values (v_did, v_colid) on conflict do nothing;
      end if;
    end loop;
  end loop;

  -- ---- tasks ----
  for t in select e.value from jsonb_array_elements(v_tasks) e loop
    if jsonb_typeof(t) <> 'object' or btrim(coalesce(t ->> 'title', '')) = '' then
      v_task_bad := v_task_bad + 1;
      continue;
    end if;
    v_state := case when t ->> 'state' in ('todo', 'doing', 'blocked', 'done', 'cancelled')
                    then t ->> 'state' else 'todo' end;
    insert into public.tasks (
      project_id, office_id, title, detail, state, blocked_on, due_on, is_milestone,
      assigned_to_human, added_by, done_at, created_at, updated_at
    ) values (
      v_pid, p_office, btrim(t ->> 'title'), coalesce(t ->> 'detail', ''), v_state,
      case when v_state = 'blocked'
           then coalesce(nullif(btrim(coalesce(t ->> 'blocked_on', '')), ''), 'restored from an archive: the reason was not kept')
           else coalesce(t ->> 'blocked_on', '') end,
      nullif(t ->> 'due', '')::date,
      coalesce((t ->> 'milestone')::boolean, false),
      coalesce((t ->> 'for_grant')::boolean, false),
      'restore',
      case when v_state = 'done' then app.now_utc() else null end,
      app.now_utc(), app.now_utc()
    );
    v_task_in := v_task_in + 1;
  end loop;

  -- ---- contacts and their labels ----
  for c in select e.value from jsonb_array_elements(v_contacts) e loop
    if jsonb_typeof(c) <> 'object' or btrim(coalesce(c ->> 'name', '')) = '' then
      v_con_bad := v_con_bad + 1;
      continue;
    end if;
    insert into public.contacts (
      project_id, name, kind, role, org, email, phone, website, note, stage, fields
    ) values (
      v_pid, btrim(c ->> 'name'), 'person',
      coalesce(c ->> 'role', ''), coalesce(c ->> 'org', ''), coalesce(c ->> 'email', ''),
      coalesce(c ->> 'phone', ''), coalesce(c ->> 'website', ''), coalesce(c ->> 'notes', ''),
      'active', '[]'::jsonb
    ) returning contact_id into v_cid;
    v_con_in := v_con_in + 1;

    for lab in select e.value #>> '{}' from jsonb_array_elements(coalesce(c -> 'labels', '[]'::jsonb)) e loop
      if btrim(lab) = '' then continue; end if;
      select l.label_id into v_lid
        from public.contact_labels l
       where l.office_id = p_office and l.owner = v_by and l.name = lab;
      if v_lid is null then
        insert into public.contact_labels (office_id, owner, name)
        values (p_office, v_by, lab)
        returning label_id into v_lid;
      end if;
      insert into public.contact_label_links (contact_id, label_id) values (v_cid, v_lid) on conflict do nothing;
    end loop;
  end loop;

  -- ---- the brief: kept only if it meets the table's own floor ----
  v_brief := nullif(btrim(coalesce(v_project ->> 'brief', '')), '');
  if v_brief is null then
    v_brief_st := 'absent';
  elsif length(v_brief) < 50 then
    v_brief_st := 'too short to keep (the table needs 50 characters)';
  else
    insert into public.project_briefs (project_id, body, sources_used, source_fingerprints, model, confidence)
    values (v_pid, v_brief, 0, '{}'::text[], 'restored-from-archive', 'inferred');
    v_brief_st := 'restored';
  end if;

  -- ---- the report: what was asked for, what was written, and what the archive does not carry ----
  v_report := jsonb_build_object(
    'slug', v_slug,
    'name', v_name,
    'renamed', v_renamed,
    'original_name', v_base_name,
    'original_status', coalesce(v_project ->> 'status', ''),
    'alias', case when v_alias_note = '' then 'added' else 'not added: ' || v_alias_note end,
    'counts', jsonb_build_object(
      'documents', jsonb_build_object('requested', v_doc_req, 'restored', v_doc_in,
                                      'with_text', v_doc_text, 'without_text', v_doc_nofp,
                                      'origin_restored_as', 'yours'),
      'tasks', jsonb_build_object('requested', v_task_req, 'restored', v_task_in, 'refused', v_task_bad),
      'contacts', jsonb_build_object('requested', v_con_req, 'restored', v_con_in, 'refused', v_con_bad),
      'collections', jsonb_build_object('requested', jsonb_array_length(v_colls), 'restored', v_col_in),
      'collection_links_missing', v_link_miss,
      'brief', v_brief_st
    ),
    'not_restored', jsonb_build_object(
      'answers', coalesce(jsonb_array_length(case when jsonb_typeof(p_package -> 'answers') = 'array' then p_package -> 'answers' end), 0),
      'team', coalesce(jsonb_array_length(case when jsonb_typeof(p_package -> 'team') = 'array' then p_package -> 'team' end), 0),
      'automations', coalesce(jsonb_array_length(case when jsonb_typeof(p_package -> 'automations') = 'array' then p_package -> 'automations' end), 0),
      'sources', coalesce(jsonb_array_length(case when jsonb_typeof(p_package -> 'sources') = 'array' then p_package -> 'sources' end), 0),
      'task_assignees', (select count(*) from jsonb_array_elements(v_tasks) e where coalesce(e.value ->> 'assigned_to', '') <> '')
    ),
    'restored_at', app.now_utc()
  );

  update public.project_restores
     set project_id = v_pid, report = v_report
   where office_id = p_office and idempotency_key = p_key;

  return jsonb_build_object('ok', true, 'already', false, 'project_id', v_pid, 'slug', v_slug, 'report', v_report);
end
$function$;

commit;
