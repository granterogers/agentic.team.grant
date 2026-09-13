begin;

/**
 * An asset can be renamed, tagged and filed — through the API, not the page.
 *
 * Issue #29: *"Rename, move, categorize, tag, filter and export all reachable
 * through the API (#13) — no frontend-only state."*
 *
 * The model was almost entirely there — `collections`, `document_collections`,
 * `documents.tags`, and `app.put_in_collection` with a public wrapper. What
 * was missing is the half that makes it usable by anything other than a
 * person clicking: there was no way to rename a document, no way to add or
 * remove a tag, and no way to take a document OUT of a collection. Filing it
 * was a one-way door.
 *
 * And `put_in_collection` and `relations_of` had public wrappers and were not
 * in the API's section list, so a browser could not call them either. Wired in
 * the same change, because a wrapper nothing routes to is the same trap as no
 * wrapper at all.
 *
 * ## Every one of these takes what the CALLER has
 *
 * A collection by NAME, not by id — that is `put_in_collection`'s existing
 * choice and this follows it. A caller holding a document and the word
 * "Research" should not have to look up a uuid first, and a caller doing a
 * lookup is a caller that can do it wrong. Creating the collection when it
 * does not exist is the same argument: §31 calls an avoidable request for
 * manual configuration a design failure, and "make the collection, then file
 * the document" is two steps for one intention.
 */

/**
 * Rename an asset.
 *
 * Refuses a blank title rather than storing one. A document with no name is
 * unreachable in a gallery, unsearchable by title, and looks like a rendering
 * bug rather than a data one — `studio_search` already has to say
 * "(untitled)" for the rows that predate any of this.
 */
create or replace function app.rename_document(p_document uuid, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_was text; v_new text := btrim(coalesce(p_title, ''));
begin
  if v_new = '' then
    return jsonb_build_object('ok', false, 'error', 'a document needs a name');
  end if;
  select title into v_was from public.documents where document_id = p_document;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;
  update public.documents set title = v_new where document_id = p_document;
  -- The old name is returned, not just the new one: an undo, a log line and a
  -- say-back all need it, and only this call still knows it.
  return jsonb_build_object('ok', true, 'was', v_was, 'now', v_new);
end;
$$;

/**
 * Add or remove a tag.
 *
 * One function with a boolean rather than two, because the two would share
 * every line except the array operator, and the caller's question is "should
 * this tag be on or off" either way.
 *
 * Tags are folded to lower case and trimmed. "Pricing" and "pricing" are the
 * same tag to a person, and a filter that treats them as two is a filter that
 * quietly hides half the results.
 */
create or replace function app.tag_document(p_document uuid, p_tag text, p_on boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_tag text := lower(btrim(coalesce(p_tag, ''))); v_tags text[];
begin
  if v_tag = '' then
    return jsonb_build_object('ok', false, 'error', 'a tag needs a word');
  end if;
  if not exists (select 1 from public.documents where document_id = p_document) then
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;

  update public.documents
     set tags = case
                  when coalesce(p_on, true)
                    -- `array_append` would add a second copy. This is the
                    -- idempotent form: pressing the tag button twice is one tag.
                    then (select array(select distinct unnest(coalesce(tags, '{}') || v_tag) order by 1))
                  else (select array(select unnest(coalesce(tags, '{}')) except select v_tag order by 1))
                end
   where document_id = p_document
  returning tags into v_tags;

  return jsonb_build_object('ok', true, 'tags', to_jsonb(coalesce(v_tags, '{}')));
end;
$$;

/**
 * Take an asset out of a collection.
 *
 * The collection itself stays, empty, and that is deliberate: it is a thing
 * Grant named and arranged (`collections.position`), and removing the last
 * document from it is not a decision to delete it. Same reason detaching a
 * connector disables the row rather than dropping it.
 */
create or replace function app.take_out_of_collection(p_document uuid, p_collection_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_collection uuid; v_project uuid;
begin
  select project_id into v_project from public.documents where document_id = p_document;
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;
  select collection_id into v_collection
    from public.collections
   where project_id = v_project and lower(name) = lower(btrim(coalesce(p_collection_name, '')));
  if v_collection is null then
    return jsonb_build_object('ok', false, 'error', 'no such collection in this project');
  end if;
  delete from public.document_collections
   where document_id = p_document and collection_id = v_collection;
  if not found then
    -- Not an error. "It is not in that collection" is the state the caller
    -- wanted, and reporting it as a failure makes an idempotent action
    -- look broken on the second press.
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  return jsonb_build_object('ok', true, 'removed_from', p_collection_name);
end;
$$;

create or replace function public.rename_document(p_document uuid, p_title text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.rename_document(p_document, p_title) $$;

create or replace function public.tag_document(p_document uuid, p_tag text, p_on boolean default true)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.tag_document(p_document, p_tag, p_on) $$;

create or replace function public.take_out_of_collection(p_document uuid, p_collection_name text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.take_out_of_collection(p_document, p_collection_name) $$;

grant execute on function app.rename_document(uuid, text) to ai_team_app;
grant execute on function public.rename_document(uuid, text) to ai_team_app;
grant execute on function app.tag_document(uuid, text, boolean) to ai_team_app;
grant execute on function public.tag_document(uuid, text, boolean) to ai_team_app;
grant execute on function app.take_out_of_collection(uuid, text) to ai_team_app;
grant execute on function public.take_out_of_collection(uuid, text) to ai_team_app;

commit;
