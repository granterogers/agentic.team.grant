-- A comment may not name a function that does not exist (#130, and verify:schema).
--
-- 0417's comment recorded the mistake it was fixing, by name:
--
--     The first draft of 0417 rewrote this half from memory and invented
--     app.file_in_collection, app.tag_document(uuid, text) and app.relate ...
--
-- `verify:schema` reads every function BODY looking for an identifier that
-- does not resolve, and a comment is part of the body as far as
-- `pg_get_functiondef` is concerned. So the lesson about inventing three
-- function names became two findings naming those three functions, in the
-- check whose whole job is to catch exactly that.
--
-- A false positive in a check that exists to find dangling references is
-- expensive in the usual way: it is a finding nobody can act on, in a report
-- somebody has to read past. The lesson is worth keeping and the `app.` prefix
-- is not — the names are the point, the qualification is what the grep sees.
--
-- Nothing else about the function changes. Patched from the live definition so
-- there is no second transcription to get wrong, with the comment replaced in
-- place.

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'import_output'
   limit 1;

  if v_def is null then
    raise exception 'app.import_output is missing';
  end if;
  if position('app.file_in_collection' in v_def) = 0 then
    raise exception 'the comment has already gone — check what changed before re-running this';
  end if;

  v_def := replace(v_def, 'app.file_in_collection', 'a file_in_collection');
  v_def := replace(v_def, 'app.tag_document(uuid, text)', 'a tag_document taking a uuid and text');
  v_def := replace(v_def, 'and `app.relate`', 'and a relate');

  execute v_def;
end $$;
