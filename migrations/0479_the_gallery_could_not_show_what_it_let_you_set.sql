/*
  0479 — the gallery could not show what it let you set.

  `app.tag_document`, `app.put_in_collection` and `app.take_out_of_collection`
  have existed since the document work and are bound at the gateway as
  `document_tag`, `collection_put` and `collection_take`. Nothing in `web/`
  names any of the three (#276), so a document's tags and its collections are
  writable by an agent and invisible to Grant.

  A control cannot be added until the reader carries the state it toggles: a
  tag button with no way of knowing whether the tag is already on is a control
  that can only ever add. `app.studio_documents` emitted neither, so this adds
  both — `tags` as the text array the column already holds, and `collections`
  as the names this document belongs to, ordered so the chips do not reshuffle
  between renders.

  Derived, never stored: both read the rows that already hold the fact
  (`documents.tags`, `document_collections`), in keeping with 0310's rule about
  not keeping a second copy of something a column expresses.
*/

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

/*
  Drive it. A migration that applies cleanly is not a function that works, and
  this one changes the shape of a payload three surfaces read.
*/
do $drive$
declare
  v_project uuid;
  v_doc uuid;
  v_out jsonb;
begin
  select project_id into v_project
    from public.documents
   where state = 'approved'
   order by created_at desc
   limit 1;
  if v_project is null then
    raise notice '0479: no approved document to drive against';
    return;
  end if;
  v_out := app.studio_documents(v_project, 24);
  if jsonb_typeof(v_out) <> 'array' then
    raise exception '0479: studio_documents did not return an array';
  end if;
  if jsonb_array_length(v_out) > 0 then
    if not (v_out -> 0 ? 'tags') or not (v_out -> 0 ? 'collections') then
      raise exception '0479: the payload is missing the new keys';
    end if;
    if jsonb_typeof(v_out -> 0 -> 'tags') <> 'array'
       or jsonb_typeof(v_out -> 0 -> 'collections') <> 'array' then
      raise exception '0479: the new keys are not arrays';
    end if;
  end if;
  v_doc := (v_out -> 0 ->> 'id')::uuid;
  raise notice '0479: % document(s), first one %', jsonb_array_length(v_out), v_doc;
end $drive$;
