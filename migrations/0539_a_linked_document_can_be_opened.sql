-- 0539 — a document that lives somewhere else can say where
--
-- Grant, §25: *"Clicking the document should open the actual
-- Drive/Docs/Sheets/etc. document appropriately, normally in a new tab.
-- Preserve Google Docs identity, Google Sheets identity, Google Slides
-- identity, Drive file identity where known."*
--
-- It could not. `app.studio_document` returns the title, the state, the origin
-- and a signed link to the stored FILE — and a linked document has no stored
-- file, so every field that could point at the real thing was null. The row
-- knew perfectly well: `connector` says Google Drive and `external_ref` is the
-- file id. Neither reached the page.
--
-- WHY NOT A STORED URL. A Drive URL is derivable from the id and the kind —
-- /document/d/<id>/edit, /spreadsheets/d/<id>/edit, /file/d/<id>/view — so
-- storing one would be a second copy of a fact the row already carries, and
-- 0310 is the migration spent removing exactly that. The page derives it, in
-- one place.
--
-- Spliced from the live definition, with a refusal if the anchor is not found:
-- a splice that matches nothing looks exactly like a splice that worked.

do $splice$
declare
  v_def text;
  v_before text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'studio_document';
  if v_def is null then
    raise exception 'app.studio_document is not here';
  end if;
  if position('external_ref' in v_def) > 0 then
    return;
  end if;

  v_before := v_def;
  v_def := replace(
    v_def,
    '''mime_type'', d.mime_type',
    '''mime_type'', d.mime_type,' || chr(10) ||
    '    ''connector'', d.connector,' || chr(10) ||
    '    ''ref'', d.external_ref');

  if v_def = v_before then
    raise exception 'the anchor was not found in app.studio_document';
  end if;
  execute v_def;
end
$splice$;
