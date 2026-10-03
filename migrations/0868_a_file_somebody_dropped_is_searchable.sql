-- A file somebody dropped in was stored and never read, so no agent could ever find what it says (#408).
--
-- `document_upload` stores the bytes in the files bucket and records a row with `content = null`. 0207 is right that
-- null means "nobody has read this yet", and nothing ever read a text file afterwards: of the 22 documents in the
-- Sample office, 22 had no text, so `app.search_documents` (which matches the generated `search` column, built from
-- title and content) could only ever match a title. A question about the budget could not find a budget.
--
-- This is the writer that records what a text file says. The gateway decodes the bytes it already holds, and for a
-- text type calls this once. It is office-checked like every other writer: the row must be in the asking office and
-- must be a stored file, and it never touches a document that has no file behind it (a connector's text is the
-- connector's to refresh, not this function's).
--
-- The three fixed points of a documents row travel together (CLAUDE.md): content with a fingerprint, the fingerprint a
-- sha256, and fetched_at iff content. They are written in ONE statement here.

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
  -- NUL cannot be stored in text; everything else a person typed can.
  v_text := replace(coalesce(p_text, ''), chr(0), '');
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

create or replace function public.index_file_text(p_office uuid, p_document_id uuid, p_text text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$ select app.index_file_text(p_office, p_document_id, p_text) $$;

revoke all on function app.index_file_text(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.index_file_text(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.index_file_text(uuid, uuid, text) to service_role;

commit;
