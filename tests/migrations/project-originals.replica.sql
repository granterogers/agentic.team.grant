-- Round-trip proof for a document's ORIGINAL file through export and restore (issue #471, migration 1072).
-- Local schema replica only; the whole file rolls back. Run it with:
--   psql -h /tmp/pgs -p 55432 -U postgres -d post -X -v ON_ERROR_STOP=1 -f tests/migrations/project-originals.replica.sql
-- It proves: a file-backed document exports its stored file's MIME type and size, restores with those three columns
-- set together, and keeps the path the route gave it; a document with no file exports a null original and restores as
-- text only; and a package whose stored path sits outside the office's restore area is refused, with nothing written.

begin;

insert into auth.users (id) values ('d1000000-0000-4000-8000-00000000000a');
insert into public.offices (name, kind, auth_user_id)
  values ('d1-originals-office', 'person', 'd1000000-0000-4000-8000-00000000000a');

create temp table d1 as
  select (select office_id from public.offices where name = 'd1-originals-office') as o;

insert into public.projects (slug, name, office_id)
  select 'd1-source-project', 'D1 Source Project', o from d1;
insert into public.project_attachments (project_id, connector, external_ref, display_name, role)
  select project_id, 'upload', 'd1-fixture', 'fixture', 'source' from public.projects where slug = 'd1-source-project';
insert into public.project_briefs (project_id, body, sources_used, source_fingerprints, model, confidence)
  select project_id,
         'A brief long enough to pass the floor, written about the source project for the originals proof.',
         0, '{}', 'fixture', 'inferred'
    from public.projects where slug = 'd1-source-project';

-- A file-backed document: a PNG with a stored path, a MIME type and a size, all three set together (0205).
insert into public.documents (project_id, office_id, title, doc_type, content, content_fingerprint, content_chars,
                              fetched_at, origin, state, storage_path, mime_type, byte_size)
  select p.project_id, d.o, 'Floor plan', 'image', null, null, null, null, 'yours', 'approved',
         'files/d1-source/floor-plan.png', 'image/png', 4096
    from public.projects p, d1 d where p.slug = 'd1-source-project';
-- A text-only document, to prove the original object is null when there is no file.
insert into public.documents (project_id, office_id, title, origin, state, content, content_fingerprint, content_chars, fetched_at)
  select p.project_id, d.o, 'Meeting note', 'yours', 'approved', 'Agreed the venue.',
         encode(sha256(convert_to('Agreed the venue.', 'UTF8')), 'hex'), 18, app.now_utc()
    from public.projects p, d1 d where p.slug = 'd1-source-project';

create temp table d1_pkg as
  select app.project_export((select o from d1), (select project_id from public.projects where slug = 'd1-source-project')) as p
    from d1;

do $$
declare
  v_pkg jsonb;
  v_floor jsonb;
  v_note jsonb;
begin
  select p into v_pkg from d1_pkg;
  select d into v_floor from jsonb_array_elements(v_pkg -> 'documents') d where d ->> 'title' = 'Floor plan';
  select d into v_note from jsonb_array_elements(v_pkg -> 'documents') d where d ->> 'title' = 'Meeting note';
  if v_floor -> 'original' ->> 'mime_type' is distinct from 'image/png'
     or (v_floor -> 'original' ->> 'bytes')::bigint is distinct from 4096 then
    raise exception 'D1 FAILED: the export did not carry the file document''s MIME type and size';
  end if;
  -- The export strips nulls, so a text-only document has no 'original' key at all.
  if v_note -> 'original' is not null then
    raise exception 'D1 FAILED: a text-only document exported an original: %', v_note -> 'original';
  end if;
  raise notice 'D1 PROOF 1: the export carries the file''s MIME type and size, and a text-only document carries none';
end $$;

-- The route replaces the stored path with its own, under the restore area, and passes the package on.
create temp table d1_restore as
  select jsonb_set(
           p,
           '{documents}',
           (select coalesce(jsonb_agg(
                     case when d -> 'original' is null or d -> 'original' = 'null'::jsonb then d
                          else jsonb_set(d, '{original,storage_path}',
                                         to_jsonb('restores/' || (select o from d1)::text || '/d1-key/floor-plan.png'::text))
                     end order by ord), '[]'::jsonb)
              from jsonb_array_elements(p -> 'documents') with ordinality as t(d, ord))
         ) as pkg
    from d1_pkg;

do $$
declare
  v_pkg jsonb;
  v_office uuid;
  v_out jsonb;
  v_doc record;
begin
  select pkg into v_pkg from d1_restore;
  select o into v_office from d1;
  select app.project_restore(v_office, encode(sha256(convert_to('d1-happy', 'UTF8')), 'hex'), v_pkg, 'grant') into v_out;
  if v_out ->> 'ok' is distinct from 'true' then
    raise exception 'D1 FAILED: the restore was refused: %', v_out;
  end if;
  -- The restored project is the one in this office that is not the source.
  select d.storage_path, d.mime_type, d.byte_size, d.content into v_doc
    from public.documents d
   where d.office_id = v_office and d.title = 'Floor plan'
     and d.project_id <> (select project_id from public.projects where slug = 'd1-source-project');
  if v_doc.storage_path is distinct from ('restores/' || v_office::text || '/d1-key/floor-plan.png')
     or v_doc.mime_type is distinct from 'image/png' or v_doc.byte_size is distinct from 4096 then
    raise exception 'D1 FAILED: the restored file document lost its storage path, MIME type or size: %, %, %',
      v_doc.storage_path, v_doc.mime_type, v_doc.byte_size;
  end if;
  if v_doc.content is not null then
    raise exception 'D1 FAILED: a file document restored with text it never had';
  end if;
  raise notice 'D1 PROOF 2: the restored file keeps its storage path, MIME type and size, and the text-only document restores as text';
end $$;

-- A path outside this office's restore area is refused, and the refusal leaves no project behind.
do $$
declare
  v_pkg jsonb;
  v_office uuid;
  v_before int;
  v_refused text := '';
begin
  select pkg into v_pkg from d1_restore;
  select o into v_office from d1;
  -- Point the FILE document, found by title, at another office's area.
  v_pkg := jsonb_set(v_pkg,
    array['documents', (select (ord - 1)::text from jsonb_array_elements(v_pkg -> 'documents') with ordinality as t(d, ord)
                         where d ->> 'title' = 'Floor plan')],
    jsonb_set(
      (select d from jsonb_array_elements(v_pkg -> 'documents') d where d ->> 'title' = 'Floor plan'),
      '{original,storage_path}', to_jsonb('files/someone-elses/plan.png'::text)));
  select count(*) into v_before from public.projects where office_id = v_office;
  begin
    perform app.project_restore(v_office, encode(sha256(convert_to('d1-escape', 'UTF8')), 'hex'), v_pkg, 'grant');
  exception when others then
    v_refused := sqlerrm;
  end;
  if v_refused not like '%outside this office%' then
    raise exception 'D1 FAILED: a path outside the restore area was not refused by name: "%"', v_refused;
  end if;
  if (select count(*) from public.projects where office_id = v_office) <> v_before then
    raise exception 'D1 FAILED: the refused restore left a project behind';
  end if;
  raise notice 'D1 PROOF 3: a stored path outside the office restore area is refused by name, and nothing is written';
end $$;

rollback;
