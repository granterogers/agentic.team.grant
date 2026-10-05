-- #419: app.chunk_text and app.index_document_chunks decided "is there anything here" with btrim(x), and btrim with no
-- second argument removes SPACES only. A passage (or a whole document) made of newlines and tabs, which is what a run of
-- blank lines or an empty table row looks like, was therefore "content": it was indexed as a passage, took a seq number
-- (so "part N of M" counted a passage nobody can read), and a document of nothing but blank lines was chunked instead
-- of being treated as having no text. Found by driving the chunker over whitespace-only input on the replica.
--
-- Both functions are replaced from their LIVE definitions with ONE change each: the test is "contains a non-space
-- character" ('[^[:space:]]'), which covers newline, tab, form feed and the rest. Same signatures, so create or replace
-- replaces rather than overloads. Any existing whitespace-only passage is re-indexed away (the replica and, as of the
-- last reading, production hold none, so this is a no-op there and exists so the property cannot depend on that).

create or replace function app.chunk_text(p_text text)
 returns table(seq integer, start_char integer, end_char integer, body text)
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare
  v_len integer := coalesce(length(p_text), 0);
  v_start integer := 1;
  v_stop integer;
  v_tail text;
  v_cut text;
  v_pos integer := 0;
begin
  while v_start <= v_len loop
    v_stop := least(v_start + 1199, v_len);
    if v_stop < v_len then
      v_tail := substr(p_text, greatest(v_start, v_stop - 399), v_stop - greatest(v_start, v_stop - 399) + 1);
      v_cut := (regexp_match(v_tail, '^.*(?:\n\n|\n|[.!?] )', 's'))[1];
      if v_cut is not null and length(v_cut) > 0 then
        v_stop := greatest(v_start, v_stop - 399) - 1 + length(v_cut);
      end if;
    end if;
    seq := v_pos; start_char := v_start; end_char := v_stop; body := substr(p_text, v_start, v_stop - v_start + 1);
    if body ~ '[^[:space:]]' then return next; v_pos := v_pos + 1; end if;
    exit when v_stop >= v_len;
    v_start := greatest(v_stop - 199, v_start + 1);
  end loop;
end
$function$;

create or replace function app.index_document_chunks(p_document uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  d public.documents;
  v_rev text;
  v_n integer;
begin
  select * into d from public.documents where document_id = p_document;
  if not found then return 0; end if;
  if coalesce(d.state, '') = 'archived' or d.content is null or d.content !~ '[^[:space:]]' then
    update public.document_chunks set state = 'stale' where document_id = p_document and state = 'active';
    return 0;
  end if;
  v_rev := coalesce(d.content_fingerprint, md5(d.content));
  if exists (select 1 from public.document_chunks c where c.document_id = p_document and c.state = 'active' and c.revision = v_rev) then
    return 0;
  end if;
  delete from public.document_chunks where document_id = p_document and state = 'stale';
  update public.document_chunks set state = 'stale' where document_id = p_document and state = 'active';
  insert into public.document_chunks (office_id, document_id, revision, seq, start_char, end_char, body)
  select d.office_id, d.document_id, v_rev, k.seq, k.start_char, k.end_char, k.body
    from app.chunk_text(d.content) k;
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;

do $$
declare r record;
begin
  for r in select distinct document_id from public.document_chunks where body !~ '[^[:space:]]' loop
    update public.document_chunks set state = 'stale' where document_id = r.document_id and state = 'active';
    perform app.index_document_chunks(r.document_id);
  end loop;
end
$$;
