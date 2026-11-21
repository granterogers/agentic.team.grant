-- 1103 — archiving a document, with an undo (D3, 21 November 2026)
--
-- Documents could be renamed (0382) and restored from archive (0384), but nothing in the product archived one. An archived
-- document is already left out of every project list: app.studio_documents shows only state = 'approved' (1100). So an
-- archive is one state change, recorded with an undo that puts the previous state back, the same idiom rename uses.
--
-- Nothing is deleted. A team-made document is archived like any other, never removed.

begin;

create or replace function app.hq_document_archive(p_office uuid, p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_office uuid := app.require_office(p_office);
  v_was   text;
  v_title text;
  v_undo  uuid;
begin
  -- A document in another office and a document that does not exist get the same answer.
  select d.state, d.title into v_was, v_title
    from public.documents d where d.document_id = p_document_id and d.office_id = v_office;
  if v_was is null then
    return jsonb_build_object('error', 'there is no document with that id');
  end if;
  if v_was = 'archived' then
    return jsonb_build_object('archived', true, 'unchanged', true, 'was', v_was);
  end if;

  update public.documents
     set state = 'archived', updated_at = app.now_utc()
   where document_id = p_document_id;

  v_undo := app.undo_offer(
    'document.archive',
    format('Archived %s', left(coalesce(v_title, 'a document'), 60)),
    jsonb_build_object('action', 'document_restore',
                       'args', jsonb_build_object('p_document_id', p_document_id,
                                                  'p_state', v_was)));

  return jsonb_build_object('archived', true, 'was', v_was, 'undo', v_undo);
end;
$$;

create or replace function public.hq_document_archive(p_office uuid, p_document_id uuid)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_document_archive(p_office, p_document_id) $$;

revoke all on function public.hq_document_archive(uuid, uuid) from public;
grant execute on function public.hq_document_archive(uuid, uuid) to service_role;

commit;
