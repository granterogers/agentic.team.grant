begin;

/**
 * Restore a project from its package, as a NEW project (Workstream C2, issue #471).
 *
 * The package is the one `app.project_export` writes (format 'ai-team-hq/project-package', version 1). The gateway
 * unpacks it from a ZIP after the archive's checksums are verified, then calls this function with the SHA-256 of the
 * whole archive as the idempotency key.
 *
 * ## Rules this function keeps
 *
 * - Office first. Everything is written into p_office, and the office must be active (app.require_office).
 * - Validation before any write. A refused package returns {ok:false, error} and leaves no trace, including no
 *   idempotency row, so a corrected package can be sent under the same key.
 * - Never overwrites. A slug already held by a live project in this office is not reused: the restore takes a suffixed
 *   name and slug and says so in the report. Nothing that exists is changed.
 * - Idempotent. The key is recorded first, with ON CONFLICT DO NOTHING. A repeat of the same key returns the first
 *   result unchanged and writes nothing. Two concurrent calls with one key cannot both create a project: the second
 *   waits for the first and then reads its result.
 * - One transaction. A failure in the middle rolls the project and every row back, including the key.
 * - Documents keep their text and get a fingerprint computed here (sha256 of the UTF-8 text, the same rule the
 *   documents table enforces). They are restored as origin 'yours' with no connector, because the connection they came
 *   from is not part of the archive. The report says what origin they had.
 * - What the archive does not carry (answers, team roster, automations, sources, task assignees) is counted in the
 *   report as not restored, never silently dropped.
 *
 * Returns {ok, already, project_id, slug, report}.
 */

create table public.project_restores (
  office_id        uuid        not null references public.offices(office_id),
  idempotency_key  text        not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  -- Null only between the key being recorded and the project being written, inside one transaction.
  project_id       uuid,
  restored_by      text        not null check (btrim(restored_by) <> ''),
  report           jsonb       not null default '{}'::jsonb,
  created_at       timestamptz not null default app.now_utc(),
  primary key (office_id, idempotency_key),
  constraint project_restores_project_same_office
    foreign key (project_id, office_id) references public.projects(project_id, office_id)
);

comment on table public.project_restores is
  'One row per archive restored into an office, keyed by the SHA-256 of the archive. A repeat of the same key returns the stored report and writes nothing.';

-- The office a restore was recorded for cannot be changed afterwards (the same guard every office-scoped table has).
create trigger a1_office_write_once before update of office_id on public.project_restores
  for each row execute function app.office_id_is_write_once();

alter table public.project_restores enable row level security;
revoke all on public.project_restores from anon, authenticated;

create or replace function app.project_restore(
  p_office uuid, p_key text, p_package jsonb, p_by text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
    insert into public.documents (
      project_id, office_id, title, doc_type, content, content_fingerprint, content_chars,
      fetched_at, origin, connector, state, tags, source_title, produced_by, added_by,
      created_at, updated_at
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
      app.now_utc()
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

revoke all on function app.project_restore(uuid, text, jsonb, text) from public;

-- The gateway reaches this through the public wrapper with the service key; nothing browser-facing can call it.
create or replace function public.project_restore(p_office uuid, p_key text, p_package jsonb, p_by text)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$ select app.project_restore(p_office, p_key, p_package, p_by) $$;

revoke all on function public.project_restore(uuid, text, jsonb, text) from public;
revoke all on function public.project_restore(uuid, text, jsonb, text) from anon, authenticated;
grant execute on function public.project_restore(uuid, text, jsonb, text) to service_role;

comment on function public.project_restore(uuid, text, jsonb, text) is
  'Restore an archived project package as a new project in one office. Idempotent on the archive checksum. Never overwrites.';

commit;
