-- Keeping what a browser read, as a source document (#135).
--
-- The gather tier's whole point is that the words end up somewhere retrieval
-- can find them. This is the writer, and it is a function rather than an
-- INSERT in the handler for the reason 0296 gives: a caller should speak the
-- vocabulary it has (a URL, a title, some text) and not have to know that
-- `documents` has three CHECK constraints which must be satisfied together.
--
-- ## `origin = 'source'`, and the reason it matters beyond a column
--
-- `src/agents/provenance.ts` divides what the office may treat as established
-- into Grant's own words and documents that were actually read. A page the
-- office opened belongs in the second group and emphatically not in the first
-- -- and it must never land as `made`, which is where the office's own prose
-- goes, because that is precisely the laundering route provenance.ts exists to
-- close.
--
-- ## One document per URL, not one per visit
--
-- Reading the same page next week should update it, not accumulate a seventh
-- copy in a 500 MB database. `external_ref` carries the URL and the partial
-- unique index below makes re-reading idempotent -- with no nullable column in
-- the conflict target, which is 0322's lesson after four migrations spent
-- discovering that two nulls are distinct.

create unique index if not exists documents_one_per_browsed_url
  on public.documents (project_id, external_ref)
  where connector = 'browser' and external_ref is not null;

create or replace function app.record_browser_page(
  p_project uuid, p_url text, p_title text, p_text text, p_job uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_text text := left(coalesce(p_text, ''), 400000);
  v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  if not exists (select 1 from public.projects where project_id = p_project) then
    return jsonb_build_object('error', 'there is no dashboard project by that id');
  end if;
  if length(trim(v_text)) = 0 then
    return jsonb_build_object('error', 'the page had no words on it');
  end if;
  if v_title is null then
    return jsonb_build_object('error', 'a kept page needs a title');
  end if;

  insert into public.documents
    (project_id, title, origin, connector, external_ref, state,
     content, content_fingerprint, content_chars, fetched_at,
     produced_by_job)
  values
    (p_project, v_title, 'source', 'browser', p_url, 'approved',
     v_text, encode(extensions.digest(v_text, 'sha256'), 'hex'), length(v_text), app.now_utc(),
     p_job)
  on conflict (project_id, external_ref) where connector = 'browser' and external_ref is not null
  do update set
     title = excluded.title,
     content = excluded.content,
     content_fingerprint = excluded.content_fingerprint,
     content_chars = excluded.content_chars,
     fetched_at = excluded.fetched_at,
     produced_by_job = excluded.produced_by_job,
     updated_at = app.now_utc()
  returning document_id into v_id;

  return jsonb_build_object('ok', true, 'document_id', v_id);
end;
$fn$;

comment on function app.record_browser_page(uuid, text, text, text, uuid) is
  'What a browser read, kept as a source document. Never ''made'': the office '
  'did not write it, it went and looked at it, and provenance depends on the '
  'difference.';
