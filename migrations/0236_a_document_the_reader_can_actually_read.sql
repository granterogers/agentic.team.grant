-- Opening a document shows the document (#95, #96).
--
-- Grant, 11 September: *"Show complete documents: Opening a project document
-- should display its full contents."*
--
-- The diagnosis in the issue listed three possible causes -- the API
-- truncating, the reader truncating, or the column being short. It was none of
-- them. `openDoc` in web/studio/app.js draws `pageSvg(doc.title, doc.kind)`,
-- which is a GENERATED ILLUSTRATION OF A PAGE. The document's text was never
-- rendered anywhere, at any length. There was nothing to truncate.
--
-- And the payload has no text in it to render. `app.studio_documents` builds a
-- row per document with title, kind, origin, size and state, and deliberately
-- no content -- correctly, because it returns up to 24 of them and a project
-- with forty long documents would be a slow first paint on a phone.
--
-- So this is the second call: one document, in full, fetched when it is opened.
-- The same shape `hq_studio_lately` uses and for the same reason -- most visits
-- never open one, and forty ledger rows is not worth the initial payload.
--
-- ## What it returns beyond the text
--
-- `mime_type` and `storage_path`, because #96 wants PDFs in a viewer with an
-- "Open in new tab" that opens the actual file. The reader cannot know which
-- treatment a document needs without them, and a second round trip to find out
-- would be this bug again one level down.
--
-- `mirrors_document_id` is surfaced as a boolean rather than an id. A document
-- the office wrote into a connector and then read back is not new material
-- (0169), and the reader should be able to say so without being able to
-- enumerate other documents by id.
--
-- ## Why the id is checked here rather than trusted
--
-- This is the first read that takes a caller-supplied argument -- every other
-- section has fixed args baked into the edge function. A null or absent id
-- returns an error object rather than the first row of the table, because
-- `where document_id = null` matching nothing is the friendly failure and
-- `limit 1` with no predicate is the unfriendly one.

create or replace function app.studio_document(p_document_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_document_id is null
      then jsonb_build_object('error', 'no document asked for')
    else coalesce(
      (select jsonb_build_object(
                'id',        d.document_id,
                'title',     d.title,
                'content',   d.content,
                'mime_type', d.mime_type,
                'path',      d.storage_path,
                'bytes',     d.byte_size,
                'seconds',   d.duration_s,
                'state',     d.state,
                'origin',    case d.origin
                               when 'yours' then 'Yours'
                               when 'made'  then coalesce(d.produced_by, 'The team')
                               else app.connector_label(d.connector) end,
                -- A boolean, not the id it mirrors: the reader needs to say
                -- "we wrote this" and does not need to enumerate documents.
                'mirrored',  d.mirrors_document_id is not null,
                'created',   to_char(d.created_at, 'FMDD Mon YYYY')
              )
         from public.documents d
        where d.document_id = p_document_id),
      jsonb_build_object('error', 'no such document'))
  end
$$;

-- PostgREST only exposes `public`.
create or replace function public.studio_document(p_document_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.studio_document(p_document_id) $$;
