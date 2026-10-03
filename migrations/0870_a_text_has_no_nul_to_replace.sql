-- 0868's indexer asked Postgres to replace a NUL character, and writing chr(0) is itself an error (54000), so it
-- failed on the first call. A NUL cannot reach a text parameter from any caller, so the gateway strips it before the
-- call and this function no longer mentions it. Same function, one line fewer.

begin;

create or replace function app.index_file_text(p_office uuid, p_document_id uuid, p_text text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_text text;
  v_hash text;
begin
  perform app.require_office(p_office);
  -- A NUL character cannot be in a text value at all (the caller strips it before it gets here), so it is not handled here.
  v_text := coalesce(p_text, '');
  if btrim(v_text) = '' then
    return jsonb_build_object('indexed', false, 'why', 'there was no text in it');
  end if;
  -- Bounded, so one enormous export is not a row nobody can ever search quickly. 400,000 characters is far past any
  -- note, budget or itinerary; the stored file itself is untouched and still opens whole.
  v_text := left(v_text, 400000);
  v_hash := encode(extensions.digest(convert_to(v_text, 'UTF8'), 'sha256'), 'hex');

  update public.documents d
     set content = v_text,
         content_fingerprint = v_hash,
         content_chars = char_length(v_text),
         fetched_at = app.now_utc()
   where d.document_id = p_document_id
     and d.office_id = p_office
     and d.storage_path is not null
     and d.origin in ('yours', 'made');
  if not found then
    -- Not an oracle: a document in another office and one that does not exist answer identically.
    return jsonb_build_object('indexed', false, 'why', 'no stored file of yours by that id');
  end if;
  return jsonb_build_object('indexed', true, 'chars', char_length(v_text));
end;
$$;

revoke all on function app.index_file_text(uuid, uuid, text) from public, anon, authenticated;

commit;
