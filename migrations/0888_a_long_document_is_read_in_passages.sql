-- #419: retrieval handed the model the first 1,500 characters of whichever document matched, so a fact on page 40 of a
-- 180,000-character document was found by the search and then never shown. A document is now also held as ordered,
-- overlapping passages, and the passages that best match the question are what the model reads.
--
-- One model for every source: the passages derive from public.documents.content, which upload, Drive, NotebookLM and the
-- office's own documents all write, so there is no separate path per connector. A passage stores only what a document
-- cannot tell you (its text, where it sits, which revision of the text it was cut from); the project, source, title, type and
-- state are read through the document, because a copy of them is the copy that rots (0310).
--
-- Deterministic: the same text always yields the same passages. Revision-safe: a passage records the fingerprint of the text
-- it came from, and re-indexing marks the old generation stale (one stale generation is kept, the one before is dropped).
-- A deleted document takes its passages with it (cascade); an archived one has them marked stale, so nothing active remains
-- for text that ordinary retrieval no longer shows.

create table public.document_chunks (
  chunk_id    uuid primary key default gen_random_uuid(),
  office_id   uuid not null references public.offices(office_id),
  document_id uuid not null,
  revision    text not null,
  seq         integer not null check (seq >= 0),
  start_char  integer not null check (start_char >= 1),
  end_char    integer not null check (end_char >= start_char),
  body        text not null check (body <> ''),
  state       text not null default 'active' check (state in ('active', 'stale')),
  search      tsvector generated always as (to_tsvector('english', body)) stored,
  created_at  timestamptz not null default app.now_utc(),
  constraint document_chunks_document_same_office
    foreign key (document_id, office_id) references public.documents(document_id, office_id) on delete cascade
);
create unique index document_chunks_one_active_position on public.document_chunks (document_id, seq) where state = 'active';
create index document_chunks_document_idx on public.document_chunks (document_id, state);
create index document_chunks_search on public.document_chunks using gin (search) where state = 'active';
comment on table public.document_chunks is
  'Ordered, overlapping passages of public.documents.content, derived by app.index_document_chunks (#419). Never written by hand.';

create trigger a1_office_write_once
  before update on public.document_chunks
  for each row execute function app.office_id_is_write_once();

alter table public.document_chunks enable row level security;
revoke all on table public.document_chunks from public, anon, authenticated, service_role;

-- The cutter. About 1,200 characters a passage, 200 of overlap, ending at a paragraph or sentence boundary when one sits in
-- the last 400 characters of the window; always makes progress.
create or replace function app.chunk_text(p_text text)
returns table (seq integer, start_char integer, end_char integer, body text)
language plpgsql
immutable
set search_path to ''
as $f$
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
    if btrim(body) <> '' then return next; v_pos := v_pos + 1; end if;
    exit when v_stop >= v_len;
    v_start := greatest(v_stop - 199, v_start + 1);
  end loop;
end
$f$;

create or replace function app.index_document_chunks(p_document uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $f$
declare
  d public.documents;
  v_rev text;
  v_n integer;
begin
  select * into d from public.documents where document_id = p_document;
  if not found then return 0; end if;
  if coalesce(d.state, '') = 'archived' or d.content is null or btrim(d.content) = '' then
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
$f$;

create or replace function app.document_chunks_follow()
returns trigger
language plpgsql
security definer
set search_path to ''
as $f$
begin
  perform app.index_document_chunks(new.document_id);
  return null;
end
$f$;

create trigger document_chunks_follow
  after insert or update of content, content_fingerprint, state on public.documents
  for each row execute function app.document_chunks_follow();

-- The best passages of the documents a search already chose, for the question asked. The office filter is here as well as
-- in the caller: a document id from another office matches nothing, whatever the caller passes.
create or replace function app.best_chunks(p_office uuid, p_documents uuid[], p_query text, p_per_document integer default 2)
returns table (document_id uuid, seq integer, total integer, start_char integer, end_char integer, body text, rank real)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $f$
#variable_conflict use_column
declare
  v_q tsquery;
begin
  perform app.require_office(p_office);
  v_q := nullif(array_to_string(tsvector_to_array(to_tsvector('english', coalesce(p_query, ''))), ' | '), '')::tsquery;
  if v_q is null then return; end if;
  return query
  select r.document_id, r.seq, r.total, r.start_char, r.end_char, r.body, r.rank
    from (
      select c.document_id, c.seq, c.start_char, c.end_char, c.body,
             ts_rank(c.search, v_q) as rank,
             (select count(*)::integer from public.document_chunks t where t.document_id = c.document_id and t.state = 'active') as total,
             row_number() over (partition by c.document_id order by ts_rank(c.search, v_q) desc, c.seq) as n
        from public.document_chunks c
        join public.documents d on d.document_id = c.document_id and d.office_id = c.office_id
       where c.office_id = p_office
         and c.state = 'active'
         and c.document_id = any (p_documents)
         and coalesce(d.state, '') <> 'archived'
         and c.search @@ v_q
    ) r
   where r.n <= greatest(1, least(p_per_document, 5))
   order by r.document_id, r.rank desc, r.seq;
end
$f$;

revoke all on function app.chunk_text(text), app.index_document_chunks(uuid), app.document_chunks_follow(),
  app.best_chunks(uuid, uuid[], text, integer) from public, anon, authenticated, service_role;

-- Everything already held that has text.
do $b$
declare r record;
begin
  for r in select document_id from public.documents where content is not null and btrim(content) <> '' loop
    perform app.index_document_chunks(r.document_id);
  end loop;
end
$b$;
