-- A file Grant drops is HIS again (#126, restoring 0414 through 0459).
--
-- 0414 is called `a_file_grant_dropped_is_his_not_ours` and says, in its own
-- words:
--
--     `connector` stays null. `connector_matches_origin` only requires a
--     connector when the origin is 'source', and a dropped file came from no
--     connector — it came from a desktop, which is the absence of one.
--
-- 0459 rebuilt `app.record_file_document` to add `source_title`, so that a
-- file renamed in Drive is found by its new name. Nothing in that change
-- concerns provenance — and the rewritten insert hardcodes
--
--     'file', 'upload',
--
-- as the connector for EVERY row it writes.
--
-- ## Which is undone by a trigger nobody in that chain knew about
--
-- `documents_origin_follows_connector` says, correctly:
--
--     a row with a connector is a source either way
--
-- So the connector being present rewrites `origin` to 'source' after the
-- insert. The edge function passes `p_origin: 'yours'` explicitly, with a
-- comment citing 0414 by number, and has been silently overridden ever since.
-- CLAUDE.md records this shape in three words: *"A trigger you do not know
-- about silently undoes your write."*
--
-- The cost is exactly what 0414 was written to prevent, and 0169 states the
-- stake: `origin` distinguishes material the office was GIVEN from material it
-- MADE, and confusing the two lets an agent cite its own output as a source. A
-- file Grant dragged off his desktop announced itself as having come from a
-- connector.
--
-- ## Found by a suite that was already red
--
-- `verify:upload` has asserted `origin === 'yours'` since #126 and has been
-- failing on it. It is not in the gate, so nobody knew — the same way
-- `verify:capability` was red for a week. The check was right the whole time.
--
-- ## Scope
--
-- Forward only, and nothing to backfill: `select count(*) from
-- public.documents where connector = 'upload'` is **0**. Every upload so far
-- has been a fixture that its own suite tore down, so no row of Grant's is
-- mislabelled today. This stops the first real one being.
--
-- `null` for both permitted origins, exactly as 0414 had it, because the guard
-- above the insert already refuses anything but 'made' and 'yours'. A
-- NotebookLM artifact arguably wants `connector = 'notebooklm'` rather than
-- either — that is a separate question about a caller this migration does not
-- touch, and 'upload' is false for it in a way `null` is not.
--
-- ## Spliced from the LIVE definition
--
-- CLAUDE.md, three times now, and 0459 is the instance that caused this one:
-- a function you are only patching must be built from `pg_get_functiondef`,
-- not retyped. This replaces eight characters and leaves `source_title`, the
-- rename reconciliation, the guard and the parent-reference check identical.

do $$
declare
  v_def text;
  v_old text := $old$'file', 'upload',$old$;
  v_new text := $new$'file', null,  -- a desktop is the absence of a connector (0414)$new$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'record_file_document';

  if v_def is null then
    raise exception 'app.record_file_document is not there to patch';
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'the hardcoded upload connector is not in the live definition';
  end if;

  -- pg_get_functiondef emits no trailing semicolon. Recorded three times.
  execute replace(v_def, v_old, v_new) || ';';
end $$;

-- Drive it, because a migration that applies cleanly is not a function that
-- works — the rule this repository states and the one 0459 needed. Rolled back
-- by a deliberate exception so no document and no storage row survives.
do $$
declare
  v_proj uuid;
  v_res jsonb;
  v_origin text;
  v_connector text;
begin
  insert into public.projects (name, slug, status)
  values ('fixture upload origin probe', 'fixture-upload-origin-probe', 'active')
  returning project_id into v_proj;

  v_res := app.record_file_document(
    p_project_id => v_proj,
    p_title => 'dropped.txt',
    p_storage_path => v_proj::text || '/upload/probe.txt',
    p_mime_type => 'text/plain',
    p_byte_size => 12,
    p_added_by => 'grant',
    p_origin => 'yours');

  if v_res ? 'error' then
    raise exception 'recording refused: %', v_res->>'error';
  end if;

  select origin, connector into v_origin, v_connector
    from public.documents where project_id = v_proj;

  if v_origin <> 'yours' or v_connector is not null then
    raise exception 'a dropped file recorded as origin=% connector=%, wanted yours/null',
      v_origin, coalesce(v_connector, 'null');
  end if;

  raise exception 'probe done, undoing';
exception
  when others then
    if sqlerrm <> 'probe done, undoing' then
      raise;
    end if;
    raise notice 'a dropped file records as origin=yours with no connector';
end $$;
