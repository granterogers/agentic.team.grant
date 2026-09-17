-- Discarding a document has never discarded one (#28, found by #258).
--
-- `app.discard_document` sets `state = 'rejected'` and
-- `documents_state_check` permits exactly `draft`, `review`, `approved` and
-- `archived`. So the statement raises 23514 every time, from inside a SECURITY
-- DEFINER function, and the press returns an error rather than doing anything.
--
-- It has therefore NEVER worked, and nothing said so: the whole `documents`
-- table is 98 approved rows and 5 drafts, with no rejected row and no archived
-- one, which is exactly what a discard path that always throws looks like from
-- the outside. #28's review gate offers Approve and Discard; only one of them
-- was real.
--
-- Found by trying to tidy up after the #258 end-to-end run, which is the
-- ordinary way this class of defect surfaces: an offer may only promise what
-- the press can perform, and reading the function proves it parses.
--
-- `archived` rather than widening the constraint. It is already in the
-- vocabulary, it already means "no longer live", and 0311 was a migration
-- spent undoing two words for one thing.

create or replace function app.discard_document(p_document uuid, p_why text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_title text; v_was text;
begin
  select title, state into v_title, v_was
    from public.documents where document_id = p_document;
  if v_title is null then
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;
  if v_was = 'archived' then
    -- Already gone. Reported as ok with nothing changed, because a second
    -- press of Discard is a person making sure, not an error.
    return jsonb_build_object('ok', true, 'title', v_title, 'already', true);
  end if;

  update public.documents set state = 'archived' where document_id = p_document;
  return jsonb_build_object('ok', true, 'title', v_title, 'was', v_was,
                            'why', nullif(btrim(coalesce(p_why, '')), ''));
end;
$function$;

comment on function app.discard_document(uuid, text) is
  'Take a document out of the project (#28). Writes `archived`, which is what '
  'the state constraint permits -- it wrote `rejected` from the day it was '
  'created and raised 23514 every time, so nothing has ever been discarded.';
