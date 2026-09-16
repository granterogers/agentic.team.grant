begin;

-- ---------------------------------------------------------------------------
-- 0383 - one function renames a document, and now it can be undone (#152)
--
-- 0382 added `app.hq_document_rename` an hour ago. `app.rename_document` has
-- existed since the document actions were built and is already wired to the
-- page as the `document_rename` API action. Two functions writing
-- `documents.title` is precisely the trap CLAUDE.md records twice - 0282/0293,
-- and `hq_create_project` against `hq_rename_project` - where both halves are
-- correct alone and only their disagreement is wrong.
--
-- The new one is dropped. What it had that the old one lacked is the thing the
-- issue actually asks for - *"Rename and move are exactly invertible, so both
-- get undo"* - so that moves into the function that already exists, and the
-- caller that already exists gets it without being changed.
--
-- The old one's own comment says why this was easy: *"The old name is
-- returned, not just the new one: an undo, a log line and a say-back all need
-- it, and only this call still knows it."* It was written for this.
-- ---------------------------------------------------------------------------

drop function if exists app.hq_document_rename(uuid, text);
drop function if exists public.hq_document_rename(uuid, text);

create or replace function app.rename_document(p_document uuid, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_was  text;
  v_new  text := btrim(coalesce(p_title, ''));
  v_undo uuid;
begin
  if v_new = '' then
    return jsonb_build_object('ok', false, 'error', 'a document needs a name');
  end if;
  select title into v_was from public.documents where document_id = p_document;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;
  if v_was = v_new then
    return jsonb_build_object('ok', true, 'was', v_was, 'now', v_new, 'unchanged', true);
  end if;
  update public.documents set title = v_new, updated_at = app.now_utc()
   where document_id = p_document;

  -- The reversal is this same function with the old name, which is what
  -- "exactly invertible" means and why no separate undo path is needed.
  v_undo := app.undo_offer(
    'document.rename',
    format('Renamed %s', left(v_was, 60)),
    jsonb_build_object('action', 'document_rename',
                       'args', jsonb_build_object('p_document', p_document,
                                                  'p_title', v_was)));

  return jsonb_build_object('ok', true, 'was', v_was, 'now', v_new, 'undo', v_undo);
end;
$$;

commit;
