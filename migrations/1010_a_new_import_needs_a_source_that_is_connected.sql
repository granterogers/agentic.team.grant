-- 1010. A NEW import of an external document is refused, by the server, when the source it must come from is
-- disconnected. UNAPPLIED to production. Depends on 0896, 0907 (written as 0900), 0960, 0990, 0991 and 1000.
--
-- Grant, 5 October 2026: the page hides the Import press for a disconnected source, and that is a courtesy, not a
-- boundary. A stale client, a direct RPC, a job somebody enqueued, an agent or an assistant on the MCP door would all
-- have passed it. The refusal belongs where the import is decided, and it is a typed answer, not a sentence:
--
--     { ok: false, error_code: 'SOURCE_DISCONNECTED', reason, connector, error }
--
-- What is refused is a NEW operation that needs the provider. What is not refused:
--   * a document already imported (a durable Team HQ copy): hq_document_import still answers "imported" for it, and
--     disconnecting changes nothing about the copy, which is origin 'made'/'yours' and never tied to a connection (0896);
--   * the history, provenance and metadata of the source: nothing here deletes or hides a row;
--   * an import whose material Team HQ already holds, when only the PROVIDER login is gone: that needs no provider
--     access, so it is not a fetch (a disabled attachment is different: the document has left active retrieval, 0896,
--     and is not imported from at all).
--
-- Two ways a source is unavailable, one function names them (app.document_source_state):
--   'attachment_disabled'  every attachment that feeds the document is disabled (app.source_connected, 0896)
--   'provider_disconnected' Google Drive has no active connection for this office (1000) and no legacy credential
--   'ok'                   anything else, including everything that is not an external document
--
-- The office and the document are NEVER taken from the caller together: the document is looked up inside the office
-- the caller proved (app.require_office), and its own project, connector and parent decide the answer. Another office's
-- connected state cannot stand in for this one's.
--
-- Spliced from the LIVE definitions (pg_get_functiondef), each replacement asserted to have landed.

create or replace function app.document_source_state(p_office uuid, p_document uuid)
returns text
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  d public.documents%rowtype;
begin
  select * into d from public.documents where document_id = p_document and office_id = p_office;
  if not found or d.origin <> 'source' then
    return 'ok';
  end if;
  if not app.source_connected(d.origin, d.project_id, d.connector, d.external_parent_ref) then
    return 'attachment_disabled';
  end if;
  if d.connector = 'drive' then
    if exists (select 1 from app.active_connection(p_office, 'google')) then
      return 'ok';
    end if;
    -- An office that never had a connection row still has the 0800 credential, if it was ever connected at all.
    if not exists (select 1 from public.integration_connections c
                    where c.office_id = p_office and c.provider = 'google')
       and exists (select 1 from vault.secrets s
                    where s.name = app.google_legacy_vault_name(p_office, 'google.refresh_token')) then
      return 'ok';
    end if;
    return 'provider_disconnected';
  end if;
  return 'ok';
end
$f$;

comment on function app.document_source_state(uuid, uuid) is
  'ok | attachment_disabled | provider_disconnected for an external document, read from the document''s own row inside the office given. Anything that is not an external source document is ok: a Team HQ copy never depends on a connection.';

create or replace function app.source_disconnected(p_office uuid, p_document uuid, p_state text)
returns jsonb
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
  select jsonb_build_object(
    'ok', false,
    'error_code', 'SOURCE_DISCONNECTED',
    'reason', p_state,
    'connector', (select d.connector from public.documents d where d.document_id = p_document and d.office_id = p_office),
    'error', case p_state
               when 'provider_disconnected' then 'Reconnect Google Drive to import this file.'
               else 'This source is switched off, so this file cannot be imported. Turn it back on to import it.'
             end)
$f$;

revoke all on function app.document_source_state(uuid, uuid) from public, anon, authenticated;
revoke all on function app.source_disconnected(uuid, uuid, text) from public, anon, authenticated;

-- hq_document_import: after "already imported" (a copy is never refused) and around the two ways to proceed.
do $s$
declare
  v_def text := pg_get_functiondef('app.hq_document_import(uuid, uuid, text)'::regprocedure);
  v_a_old text := '  if app.document_material_held(p_office, o.document_id) then';
  v_a_new text := '  v_state := app.document_source_state(p_office, o.document_id);' || chr(10) ||
                  '  if v_state = ''attachment_disabled'' then' || chr(10) ||
                  '    return app.source_disconnected(p_office, o.document_id, v_state);' || chr(10) ||
                  '  end if;' || chr(10) ||
                  '  if app.document_material_held(p_office, o.document_id) then';
  v_b_old text := '  insert into public.document_import_requests (office_id, document_id, requested_by, channel)';
  v_b_new text := '  if v_state = ''provider_disconnected'' then' || chr(10) ||
                  '    return app.source_disconnected(p_office, o.document_id, v_state);' || chr(10) ||
                  '  end if;' || chr(10) ||
                  '  insert into public.document_import_requests (office_id, document_id, requested_by, channel)';
  v_d_old text := '  v_job  uuid;' || chr(10) || 'begin';
  v_d_new text := '  v_job  uuid;' || chr(10) || '  v_state text;' || chr(10) || 'begin';
begin
  if position(v_a_old in v_def) = 0 then raise exception '1010 splice anchor missing: hq_document_import (material)'; end if;
  if position(v_b_old in v_def) = 0 then raise exception '1010 splice anchor missing: hq_document_import (request)'; end if;
  if position(v_d_old in v_def) = 0 then raise exception '1010 splice anchor missing: hq_document_import (declare)'; end if;
  v_def := replace(replace(replace(v_def, v_a_old, v_a_new), v_b_old, v_b_new), v_d_old, v_d_new);
  if position('document_source_state' in v_def) = 0 or position('provider_disconnected' in v_def) = 0
     or position('v_state text' in v_def) = 0 then
    raise exception '1010 hq_document_import splice did not land';
  end if;
  execute v_def;
end
$s$;

-- document_import_enqueue_fetch: whoever calls it (the import, a retry, a job), no fetch is queued for a closed source.
do $s$
declare
  v_def text := pg_get_functiondef('app.document_import_enqueue_fetch(uuid, uuid)'::regprocedure);
  v_old text := '  -- The request must exist: a fetch is only ever the answer to a recorded press.';
  v_new text := '  -- A closed source is not fetched from, whoever asks (1010). The request says why, so the page can.' || chr(10) ||
                '  if app.document_source_state(p_office, p_document) <> ''ok'' then' || chr(10) ||
                '    update public.document_import_requests' || chr(10) ||
                '       set last_error = (app.source_disconnected(p_office, p_document, app.document_source_state(p_office, p_document)) ->> ''error''),' || chr(10) ||
                '           last_attempt_at = app.now_utc()' || chr(10) ||
                '     where office_id = p_office and document_id = p_document and state = ''pending'';' || chr(10) ||
                '    return null;' || chr(10) ||
                '  end if;' || chr(10) ||
                v_old;
begin
  if position(v_old in v_def) = 0 then raise exception '1010 splice anchor missing: document_import_enqueue_fetch'; end if;
  v_def := replace(v_def, v_old, v_new);
  if position('document_source_state' in v_def) = 0 then raise exception '1010 enqueue_fetch splice did not land'; end if;
  execute v_def;
end
$s$;

-- document_import_fulfil: a copy is not made from a source that was switched off while the file was on its way.
do $s$
declare
  v_def text := pg_get_functiondef('app.document_import_fulfil(uuid, uuid)'::regprocedure);
  v_old text := '  if not app.document_material_held(p_office, p_document) then';
  v_new text := '  if app.document_source_state(p_office, p_document) = ''attachment_disabled'' then' || chr(10) ||
                '    return app.source_disconnected(p_office, p_document, ''attachment_disabled'') || jsonb_build_object(''fulfilled'', false);' || chr(10) ||
                '  end if;' || chr(10) ||
                v_old;
begin
  if position(v_old in v_def) = 0 then raise exception '1010 splice anchor missing: document_import_fulfil'; end if;
  v_def := replace(v_def, v_old, v_new);
  if position('document_source_state' in v_def) = 0 then raise exception '1010 fulfil splice did not land'; end if;
  execute v_def;
end
$s$;

-- The handler asks before it spends a Drive request. The state is read by one narrow function so the worker never
-- reimplements it; the answer is the same typed jsonb.
create or replace function app.document_import_gate(p_office uuid, p_document uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  v_state text := app.document_source_state(p_office, p_document);
begin
  if v_state = 'ok' then
    return jsonb_build_object('ok', true);
  end if;
  return app.source_disconnected(p_office, p_document, v_state);
end
$f$;
revoke all on function app.document_import_gate(uuid, uuid) from public, anon, authenticated;
