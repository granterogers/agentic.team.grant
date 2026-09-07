-- 0069 — fingerprint without reaching for an extension
--
-- 0068 used `digest(content, 'sha256')` and failed with `function digest(text,
-- unknown) does not exist`. pgcrypto IS installed here, but Supabase puts
-- extensions in the `extensions` schema and the function's `search_path` is
-- `public, pg_catalog` — deliberately, because a SECURITY DEFINER function with
-- a loose search_path is a privilege-escalation shape.
--
-- Widening the search_path to reach pgcrypto would trade a security property
-- for a hash. `sha256(bytea)` has been built into Postgres since 11, needs no
-- extension and is in `pg_catalog`, which the path already has.
--
-- The hex must match what `src/knowledge/retrieval.ts` and the sync produce —
-- they use SHA-256 of the UTF-8 bytes — so `convert_to(…, 'UTF8')` rather than
-- casting, which would use the server encoding and silently differ for any
-- non-ASCII document.

begin;

create or replace function app.mcp_add_document(
  p_client_id text,
  p_project   text,
  p_title     text,
  p_content   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_id uuid;
  v_fingerprint text;
  v_existing uuid;
begin
  select project_id into v_project
    from public.projects where slug = p_project and status = 'active';
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
   where project_id = v_project and content_fingerprint = v_fingerprint;
  if v_existing is not null then
    return jsonb_build_object(
      'document_id', v_existing, 'title', p_title, 'duplicate', true,
      'note', 'identical content already in this project; nothing was added'
    );
  end if;

  insert into public.documents
    (project_id, connector, external_parent_ref, external_ref, title, doc_type,
     content, content_fingerprint, content_chars, fetched_at, added_by)
  values (v_project, 'mcp', null, null, p_title, 'note',
          p_content, v_fingerprint, length(p_content), app.now_utc(), p_client_id)
  returning document_id into v_id;

  return jsonb_build_object(
    'document_id', v_id, 'title', p_title, 'chars', length(p_content), 'duplicate', false
  );
end;
$$;

commit;
