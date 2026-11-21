-- 1104 — the document archive passes its office to the undo (D3, correction to 1103, 21 November 2026)
--
-- 1103 called app.undo_offer without the office. Since 0852 the undo takes the office first, so every archive failed with
-- "the action failed". This replaces app.hq_document_archive with the same behaviour and the office passed through. The
-- public wrapper and its grants are unchanged.
--
-- Idempotent: create or replace.

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
   where document_id = p_document_id and office_id = v_office;

  v_undo := app.undo_offer(
    v_office,
    'document.archive',
    format('Archived %s', left(coalesce(v_title, 'a document'), 60)),
    jsonb_build_object('action', 'document_restore',
                       'args', jsonb_build_object('p_document_id', p_document_id,
                                                  'p_state', v_was)));

  return jsonb_build_object('archived', true, 'was', v_was, 'undo', v_undo);
end;
$$;

commit;
