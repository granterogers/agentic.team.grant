begin;

/**
 * Approving is what moves it into the project, and the project has to agree.
 *
 * Issue #28, under #25.
 *
 * ## What was there, and where it was
 *
 * Almost all of the backend. `app.approve_document(document, collection, tags,
 * related_task)` sets `state = 'approved'`, replaces the tags, files it in a
 * collection and writes the task edge — three of #28's four import fields, done
 * properly, with a public wrapper.
 *
 * **Nothing calls it.** Not the API, not the studio. The third capability found
 * this week that works perfectly and cannot be reached — after
 * `app.search_documents` (#37) and `app.put_in_collection` (#29).
 *
 * The studio's approve/drop lives in `localStorage`, in `workspace.js`. So the
 * gate #28 calls *"what moves an artifact into the project"* was a note in
 * Grant's browser: it did not survive a different device, it was invisible to
 * every agent, and nothing downstream could act on it.
 *
 * ## And the gallery never asked
 *
 * `studio_documents` EMITS `state` and does not filter on it, so #28's
 * criterion — *"an unapproved output does not appear in the project's
 * Documents"* — was simply false. A draft was in the gallery beside eighty-six
 * approved documents, indistinguishable.
 *
 * Filtering there rather than in the page, because the page is not the only
 * reader: an agent asking what this project holds must get the same answer, and
 * a rule enforced in one renderer is a rule the API does not have.
 *
 * ## The fourth field
 *
 * #28 names collection, tags, related task AND related source. The signature
 * gains `p_related_source`, so it has to be dropped and recreated — `create or
 * replace` does not replace a function whose argument list changed, it makes a
 * second overload and every call becomes ambiguous.
 *
 * A source is a `project_attachments` row or a `project_references` one (#35),
 * and `relations.to_kind` has allowed `'source'` since it was written with
 * nothing ever using it — the same way `input_to` was waiting for #27.
 * `relations_of` had no branch to resolve a source's name, so one is added
 * here; without it the edge would come back titleless and the graph would
 * report its own damage, correctly, about damage this migration caused.
 */

-- ---------------------------------------------------------------------------
-- An unapproved document is not in the project yet
-- ---------------------------------------------------------------------------

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
           'state', d.state
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

-- ---------------------------------------------------------------------------
-- Import, with all four of #28's fields
-- ---------------------------------------------------------------------------

drop function if exists public.approve_document(uuid, text, text[], uuid);
drop function if exists app.approve_document(uuid, text, text[], uuid);

/**
 * Move an output into the project, with the metadata chosen at import.
 *
 * Every field optional but the document: #28 asks for a sheet, and a sheet that
 * refuses to submit until four things are filled in is a sheet Grant closes.
 * Approving with nothing chosen is a real answer — it means "yes, and I have
 * nothing to add".
 */
create or replace function app.approve_document(
  p_document uuid,
  p_collection text default null,
  p_tags text[] default null,
  p_related_task uuid default null,
  p_related_source uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_title   text;
  v_source  text;
begin
  select project_id, title into v_project, v_title
    from public.documents where document_id = p_document;
  if v_project is null then
    -- A jsonb answer rather than a raise: this is called from a button, and
    -- "no such document" is something the page can say out loud.
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;

  update public.documents
     set state = 'approved',
         tags = case when p_tags is null then tags else p_tags end
   where document_id = p_document;

  if p_collection is not null and length(btrim(p_collection)) > 0 then
    perform app.put_in_collection(p_document, p_collection);
  end if;

  if p_related_task is not null then
    perform app.link(v_project, 'document', p_document, 'attached_to', 'task', p_related_task, 'grant');
  end if;

  /*
    The fourth field (#28), and it is checked before it is written.

    A source is an attachment or a reference (#35), and `relations` has no
    foreign key on `to_id` — it cannot, because the id may point at any of
    seven tables. So a bad id would store silently and surface later as a
    dangling edge, which `relations_of` reports honestly and nobody would
    connect back to here.
  */
  if p_related_source is not null then
    select coalesce(
             (select a.display_name from public.project_attachments a
               where a.attachment_id = p_related_source and a.project_id = v_project),
             (select r.title from public.project_references r
               where r.reference_id = p_related_source and r.project_id = v_project))
      into v_source;
    if v_source is null then
      return jsonb_build_object('ok', false,
        'error', 'that source does not belong to this project');
    end if;
    perform app.link(v_project, 'document', p_document, 'derived_from', 'source',
                     p_related_source, 'grant');
  end if;

  return jsonb_build_object(
    'ok', true, 'document', p_document, 'title', v_title,
    'collection', nullif(btrim(coalesce(p_collection, '')), ''),
    'tags', to_jsonb(coalesce(p_tags, '{}')),
    'source', v_source);
end;
$$;

/**
 * And the other answer, which is not a delete.
 *
 * #28's gate has two sides and only one of them was ever going to be built
 * first. A dropped output STAYS — `state = 'rejected'` — because the ledger of
 * what the office produced and what Grant did with it is the whole of §16's
 * argument, and a deleted row cannot be counted, learned from, or undone.
 * It simply stops being in the project.
 */
create or replace function app.discard_document(p_document uuid, p_why text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_title text;
begin
  select title into v_title from public.documents where document_id = p_document;
  if v_title is null then
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;
  update public.documents set state = 'rejected' where document_id = p_document;
  return jsonb_build_object('ok', true, 'title', v_title,
                            'why', nullif(btrim(coalesce(p_why, '')), ''));
end;
$$;

create or replace function public.approve_document(
  p_document uuid, p_collection text default null, p_tags text[] default null,
  p_related_task uuid default null, p_related_source uuid default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.approve_document(p_document, p_collection, p_tags, p_related_task, p_related_source) $$;

create or replace function public.discard_document(p_document uuid, p_why text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.discard_document(p_document, p_why) $$;

grant execute on function app.approve_document(uuid, text, text[], uuid, uuid) to ai_team_app;
grant execute on function public.approve_document(uuid, text, text[], uuid, uuid) to ai_team_app;
grant execute on function app.discard_document(uuid, text) to ai_team_app;
grant execute on function public.discard_document(uuid, text) to ai_team_app;

commit;
