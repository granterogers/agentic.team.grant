-- 0991. Text that a preview derived is not the file, so an Import of such a document still fetches the source.
-- UNAPPLIED to production. Depends on 0907 (written as 0900), 0960 and 0990.
--
-- Before this, hq_document_import and document_import_fulfil asked "does the document have content or a stored file?". Once
-- 0990 lets a preview write extracted text into documents.content, a PDF that had only been PREVIEWED would answer yes and
-- the Import would copy its text and no file, a durable copy with the document missing. Both readers now ask
-- app.document_material_held, which counts text only when a real read (not a preview) brought it in. The drive read path
-- tells the database it has read the file (app.document_preview_mark_read) before it completes the request.
-- Spliced from the LIVE definitions; each splice is asserted to have landed.

do $s$
declare
  v_def text := pg_get_functiondef('app.hq_document_import(uuid, uuid, text)'::regprocedure);
  v_old text := '  if o.content is not null or o.storage_path is not null then';
  v_new text := '  if app.document_material_held(p_office, o.document_id) then';
begin
  if position(v_old in v_def) = 0 then raise exception '0991 splice anchor missing: hq_document_import'; end if;
  v_def := replace(v_def, v_old, v_new);
  if position('document_material_held' in v_def) = 0 then raise exception '0991 hq_document_import splice did not land'; end if;
  execute v_def;
end
$s$;

do $s$
declare
  v_def text := pg_get_functiondef('app.document_import_fulfil(uuid, uuid)'::regprocedure);
  v_old text := '  if o.content is null and o.storage_path is null then';
  v_new text := '  if not app.document_material_held(p_office, p_document) then';
begin
  if position(v_old in v_def) = 0 then raise exception '0991 splice anchor missing: document_import_fulfil'; end if;
  v_def := replace(v_def, v_old, v_new);
  if position('document_material_held' in v_def) = 0 then raise exception '0991 document_import_fulfil splice did not land'; end if;
  execute v_def;
end
$s$;
