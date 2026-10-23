begin;

-- The Docs & Files tiles are drawn with the first words of each document (miniatures.js reads `excerpt`), and the documents
-- hold that text already as documents.preview_excerpt (0960). This payload never sent it, so every tile fell back to a generic
-- "DOC" label. It is added as one more key; nothing else in the function changes. Replaces app.studio_documents only.

create or replace function app.studio_documents(p_project_id uuid, p_limit integer default 24)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.document_id,
           'title', d.title,
           'kind', case
             when coalesce(d.mime_type, '') like 'audio/%' then 'audio'
             when d.origin = 'made' then 'made'
             when coalesce(d.mime_type, '') = 'application/pdf'
               or d.title ilike '%.pdf' then 'pdf'
             else 'doc' end,
           'origin', case d.origin
             when 'yours' then 'Yours'
             when 'made' then coalesce(d.produced_by, 'The team')
             else app.connector_label(d.connector) end,
           -- A size only when it says something. Below a hundred words "4 words"
           -- reads as broken metadata even when it is exactly right, and several
           -- of these are Notion database containers (#19).
           'size', case
             when d.duration_s is not null
               then format('%s min', greatest(round(d.duration_s / 60.0), 1))
             when coalesce(d.content_chars, 0) >= 550
               then format('%s words', to_char(round(d.content_chars / 5.5), 'FM999G999'))
             when d.byte_size is not null and d.byte_size >= 1024
               then format('%s KB', round(d.byte_size / 1024.0))
             else '' end,
           'state', d.state,
           -- The first words of the text, cached by the database (0960), for the tile's drawn page. Null when the office holds no text.
           'excerpt', d.preview_excerpt,

           -- THE TWO DATES, AND THE HONEST GAPS IN THEM (§§27-28).
           --
           -- `uploaded` is when this copy entered the office, which for
           -- anything pulled from a connector or dropped on a project is
           -- exactly `fetched_at`. A document the office WROTE was never
           -- uploaded, so it has none, and saying so is the point: "do NOT
           -- silently substitute another timestamp merely because an upload
           -- timestamp is missing."
           --
           -- `created` is when the thing itself was made, and the office only
           -- knows that for its own work. For a source document `created_at`
           -- is when the office first recorded it -- which is the UPLOAD date
           -- wearing another name, and confusing the two is what §28 forbids.
           -- `remote_updated_at` is a MODIFIED date and is not it either.
           --
           -- `added` is neither: it is the office's own row date, always
           -- present, and it is here as the deterministic tiebreak so two
           -- documents with equal or absent dates never swap places between
           -- renders.
           'uploaded', d.fetched_at,
           'created', case when d.origin = 'made' then d.created_at else null end,
           'added', d.created_at,
           -- What the two new controls toggle. Sorted, so a press that adds a
           -- tag does not reorder the ones already there.
           'tags', to_jsonb(coalesce((select array(select distinct unnest(d.tags) order by 1)), '{}'::text[])),
           'collections', coalesce((
             select jsonb_agg(c.name order by c.name)
               from public.document_collections dc
               join public.collections c on c.collection_id = dc.collection_id
              where dc.document_id = d.document_id), '[]'::jsonb)
         ) order by d.created_at desc), '[]'::jsonb)
    from (select * from public.documents dd
           where dd.project_id = p_project_id
             /*
               #28: an output that has not been approved is not in the project.

               This function emitted `state` and never filtered on it, so a
               draft sat in the gallery beside eighty-six approved documents and
               looked exactly like them. The import gate is only a gate if the
               thing behind it is actually behind it.

               Here rather than in the page: an agent asking what this project
               holds must get the same answer as the gallery, and a rule
               enforced in one renderer is a rule the API does not have.
             */
             and dd.state = 'approved'
           order by dd.created_at desc
           limit greatest(coalesce(p_limit, 24), 1)) d
$function$;

commit;
