-- 0990. An external document does not need to be imported to be useful. UNAPPLIED to production; proved only on a local
--       replica (cand_prev2).
--
-- Intent (Grant): a connected external document can be read, searched, indexed and PREVIEWED ON DEMAND while its source
-- stays connected. IMPORT is a different act: it makes a durable Team HQ copy that survives the source disappearing.
-- 0960 made the Import press fetch the file. This is the other half: a preview that fetches nothing it keeps.
--
--   * public.document_previews  what the office has learned about an external document from reading it on demand: the
--     source's own modified time / checksum / size (so a refetch happens only when the source changed), when derived text
--     was last written, and whether documents.content currently holds text a PREVIEW wrote. No bytes, no path, no URL.
--   * app.document_preview_plan   one read that answers every question the gateway must settle BEFORE it contacts the
--     source: does the document exist in this office and project, is it Team HQ's own or a connector's, is its source
--     connected (0896), does a durable copy exist, what is cached.
--   * app.document_preview_record  persists DERIVED data only: the extracted text goes into documents.content, which the
--     existing document_chunks trigger indexes, so agents can search it; plus the cache row. It refuses a document whose
--     source is disconnected.
--   * app.document_material_held  the one place that says whether an import has the material it needs. Text a preview
--     derived is NOT the file: an Import of such a document still fetches the source (0991 splices the two readers).
--
-- A disconnected source (0896): content of a disconnected source has left active retrieval. The plan returns no text for
-- it and the record function refuses to write, so the gateway neither fetches it nor shows what it cached. That is the
-- safer reading and the one consistent with search and best_chunks.

create table public.document_previews (
  office_id            uuid        not null references public.offices (office_id),
  document_id          uuid        not null,
  kind                 text        not null check (kind in ('text', 'pdf', 'image')),
  source_mime          text,
  source_modified_time timestamptz,
  source_version       text,
  source_size          bigint check (source_size is null or source_size >= 0),
  fetched_at           timestamptz,
  last_checked_at      timestamptz not null default app.now_utc(),
  derived_chars        integer check (derived_chars is null or derived_chars >= 0),
  truncated            boolean     not null default false,
  derived_text         boolean     not null default false,
  primary key (office_id, document_id),
  constraint document_previews_document_same_office
    foreign key (document_id, office_id) references public.documents (document_id, office_id) on delete cascade,
  constraint document_previews_text_has_time check (not derived_text or fetched_at is not null)
);

comment on table public.document_previews is
  'What reading an external document on demand taught the office: the source''s modified time, checksum and size (the stale rule compares these), when derived text was last written, and whether documents.content holds text a preview wrote. Derived data only; never a file, a path or a URL. Written by app.document_preview_record.';
comment on column public.document_previews.derived_text is
  'True when documents.content currently holds text a PREVIEW wrote. Such text is not the file: an Import of the document still fetches the source (app.document_material_held).';

create trigger a1_office_write_once before update of office_id on public.document_previews
  for each row execute function app.office_id_is_write_once();

alter table public.document_previews enable row level security;
revoke all on table public.document_previews from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- The plan.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.document_preview_plan(p_office uuid, p_document uuid, p_project_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  d      public.documents%rowtype;
  v_slug text;
  v_conn boolean;
  c      public.document_previews%rowtype;
begin
  perform app.require_office(p_office);
  select * into d from public.documents where document_id = p_document and office_id = p_office;
  if found and d.project_id is not null then
    select p.slug into v_slug from public.projects p where p.project_id = d.project_id and p.office_id = p_office;
  end if;
  -- One answer for a missing document, another office's document and another project's document: no probing aid.
  if not found or (p_project_slug is not null and v_slug is distinct from p_project_slug) then
    return jsonb_build_object('ok', false, 'error', 'There is no document with that id in this project.');
  end if;
  v_conn := app.source_connected(d.origin, d.project_id, d.connector, d.external_parent_ref);
  select * into c from public.document_previews where office_id = p_office and document_id = d.document_id;
  return jsonb_build_object(
    'ok', true,
    'mode', case when d.origin = 'source' then 'external' else 'held' end,
    'connected', v_conn,
    'imported', exists (select 1 from public.documents k
                         where k.office_id = p_office and k.imported_from_document_id = d.document_id),
    'document', jsonb_build_object(
      'id', d.document_id, 'title', coalesce(d.title, ''), 'connector', d.connector, 'origin', d.origin,
      'state', d.state, 'external_ref', d.external_ref, 'mime_type', d.mime_type,
      'has_file', d.storage_path is not null, 'project_slug', v_slug),
    'cache', case when c.document_id is null then null else jsonb_build_object(
      'kind', c.kind, 'source_mime', c.source_mime, 'source_modified_time', c.source_modified_time,
      'source_version', c.source_version, 'fetched_at', c.fetched_at, 'last_checked_at', c.last_checked_at,
      'derived_chars', c.derived_chars, 'truncated', c.truncated, 'derived_text', c.derived_text) end,
    -- Held text of a disconnected source is not handed out (0896).
    'text', case when d.origin = 'source' and v_conn then left(d.content, 400000) else null end);
end
$f$;

comment on function app.document_preview_plan(uuid, uuid, text) is
  'Everything the gateway must settle before it contacts a source for a preview: existence in this office and project (one answer for every kind of miss), held or external, source connected (0896), a durable copy, the cache row. Returns held text only for a connected source.';

-- ---------------------------------------------------------------------------------------------------------------------
-- The record. Derived data only.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.document_preview_record(
  p_office uuid, p_document uuid, p_meta jsonb, p_kind text, p_text text default null, p_truncated boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  d       public.documents%rowtype;
  v_text  text := nullif(btrim(coalesce(left(p_text, 400000), '')), '');
  v_fp    text;
  v_mod   timestamptz;
  v_wrote boolean := false;
begin
  perform app.require_office(p_office);
  if p_kind not in ('text', 'pdf', 'image') then
    return jsonb_build_object('ok', false, 'error', 'unknown preview kind');
  end if;
  select * into d from public.documents where document_id = p_document and office_id = p_office for update;
  if not found or d.origin <> 'source' or d.connector is distinct from 'drive' then
    return jsonb_build_object('ok', false, 'error', 'only an external Drive document has a preview cache');
  end if;
  if d.state = 'archived' then
    return jsonb_build_object('ok', false, 'error', 'that document is archived');
  end if;
  if not app.source_connected(d.origin, d.project_id, d.connector, d.external_parent_ref) then
    return jsonb_build_object('ok', false, 'error', 'source_disconnected');
  end if;
  begin
    v_mod := nullif(p_meta ->> 'modifiedTime', '')::timestamptz;
  exception when others then
    v_mod := null;
  end;
  if v_text is not null then
    v_fp := encode(extensions.digest(v_text, 'sha256'), 'hex');
    if v_fp is distinct from d.content_fingerprint then
      update public.documents
         set content = v_text, content_fingerprint = v_fp, content_chars = length(v_text),
             fetched_at = app.now_utc(), remote_updated_at = coalesce(v_mod, remote_updated_at)
       where document_id = d.document_id and office_id = p_office;
      v_wrote := true;
    end if;
  end if;
  -- The source's own modified time is a fact about the document whatever its kind; a tile keys its thumbnail on it.
  if v_mod is not null and v_mod is distinct from d.remote_updated_at then
    update public.documents set remote_updated_at = v_mod where document_id = d.document_id and office_id = p_office;
  end if;
  insert into public.document_previews as c
    (office_id, document_id, kind, source_mime, source_modified_time, source_version, source_size,
     fetched_at, last_checked_at, derived_chars, truncated, derived_text)
  values (p_office, d.document_id, p_kind, nullif(p_meta ->> 'mime', ''), v_mod, nullif(p_meta ->> 'version', ''),
          nullif(p_meta ->> 'size', '')::bigint,
          case when v_wrote then app.now_utc() else null end, app.now_utc(),
          case when v_text is null then null else length(v_text) end, coalesce(p_truncated, false) and v_text is not null,
          v_wrote)
  on conflict (office_id, document_id) do update
     set kind = excluded.kind, source_mime = excluded.source_mime,
         source_modified_time = excluded.source_modified_time, source_version = excluded.source_version,
         source_size = excluded.source_size, last_checked_at = app.now_utc(),
         fetched_at = case when v_wrote then app.now_utc() else c.fetched_at end,
         derived_chars = case when v_text is not null then length(v_text) else c.derived_chars end,
         truncated = case when v_text is not null then coalesce(p_truncated, false) else c.truncated end,
         derived_text = case when v_wrote then true else c.derived_text end;
  return jsonb_build_object('ok', true, 'wrote_text', v_wrote, 'indexed', v_wrote);
end
$f$;

comment on function app.document_preview_record(uuid, uuid, jsonb, text, text, boolean) is
  'Persists what an on-demand read of an external Drive document taught the office: derived text into documents.content (the chunk trigger indexes it) and the source''s own version markers. Takes no bytes. Refuses a disconnected source and anything that is not an external Drive document.';

-- A real read (drive.read_file) replaces preview-derived text with the read's own: the material is held.
create or replace function app.document_preview_mark_read(p_office uuid, p_document uuid)
returns void
language sql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
  update public.document_previews set derived_text = false where office_id = p_office and document_id = p_document
$f$;

create or replace function app.document_material_held(p_office uuid, p_document uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
  select d.storage_path is not null
      or (d.content is not null
          and not coalesce((select p.derived_text from public.document_previews p
                             where p.office_id = d.office_id and p.document_id = d.document_id), false))
    from public.documents d where d.document_id = p_document and d.office_id = p_office
$f$;

comment on function app.document_material_held(uuid, uuid) is
  'Does Team HQ hold the material an Import copies: the file, or text a real read brought in? Text that only a preview derived is not the file, so an Import of it still fetches the source.';

revoke all on function
  app.document_preview_plan(uuid, uuid, text), app.document_preview_record(uuid, uuid, jsonb, text, text, boolean),
  app.document_preview_mark_read(uuid, uuid), app.document_material_held(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Doors: the gateway (service_role) reaches these through public wrappers and writes the verified office in p_office.
create function public.hq_document_preview_plan(p_office uuid, p_document_id uuid, p_project_slug text default null)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.document_preview_plan(p_office, p_document_id, p_project_slug) $f$;

create function public.hq_document_preview_record(
  p_office uuid, p_document_id uuid, p_meta jsonb, p_kind text, p_text text default null, p_truncated boolean default false)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.document_preview_record(p_office, p_document_id, p_meta, p_kind, p_text, p_truncated) $f$;

revoke all on function
  public.hq_document_preview_plan(uuid, uuid, text), public.hq_document_preview_record(uuid, uuid, jsonb, text, text, boolean)
  from public, anon, authenticated;
grant execute on function
  public.hq_document_preview_plan(uuid, uuid, text), public.hq_document_preview_record(uuid, uuid, jsonb, text, text, boolean)
  to service_role;
