-- 0900 - Documents is one VIEW over every source: logical items, real versions, and an import that is only ever a press.
--
-- What Grant asked for (the Documents module requirements, 4 October 2026): Documents is not "what is in Supabase
-- storage". It is a unified view over Drive references, NotebookLM material, uploads and what the team generated.
-- An external document does not have to be copied: it stays searchable, readable and previewable while its connection
-- exists, and only lightweight derived data (text, metadata) is held. An explicit IMPORT makes a durable Team HQ copy
-- that survives the original disappearing, and it is never done silently. The same logical item is one item wherever
-- it is represented, but only where identity is certain - never by a similar name. A document has real versions
-- (v1, v2, v3 with history, provenance and a way back), not report-final2.pdf. An agent never deletes a source.
--
-- ## What is NOT added (0310's lesson: do not store a fact you can read)
--
-- * A version chain. `documents.superseded_by` (0382) already says "X was replaced by Y", so v1..vN is DERIVED by walking
--   it (`app.document_lineage`). No `version` column, no `logical_document_id`: either would be a second copy of a fact
--   the chain already holds and the one that rots.
-- * A dedupe table. A document is one item because of columns it already has - the same (connector, external_ref), a
--   mirrors_document_id whose original is visible (0169), an identical sha-256 of identical size, or a superseded_by
--   chain collapsing to its head - computed on read by `app.hq_project_documents`.
--
-- ## What IS added, and why each exists
--
-- 1. documents.imported_from_document_id. "This row is the durable Team HQ copy of that external one." It is NOT
--    mirrors_document_id: that column means the opposite direction (a copy the office WROTE OUT to a connector, 0169,
--    and 0382 refused to overload it for the same reason). A column that means two things cannot be filtered on either.
--    The partial unique index on it is the idempotency: importing twice is one copy. It names a non-null column, so the
--    NULL-is-not-equal-to-NULL trap that cost 0317-0322 four migrations cannot occur.
-- 2. document_version_notes. The one thing a chain cannot say: why a version exists (a person's note, which door made
--    it, who). Append-only provenance, read by `hq_document_versions`.
-- 3. document_import_requests. An import of a file whose text/bytes Team HQ does not hold yet cannot be a copy yet; it
--    is a recorded, explicit request that `app.document_import_fulfil` completes when the drive read path has brought
--    the material in. One per original.
--
-- ## Vocabulary
--
-- `documents.origin` is yours | source | made (CHECK). An imported copy is origin 'yours', connector null: 0896 already
-- decided what that means - something Team HQ holds, durable, never tied to a connection. Nothing new is invented.
--
-- ## Safety: nothing here deletes a document.
--
-- No function in this migration issues a DELETE against public.documents. Versioning archives (the existing supersede
-- idiom); importing inserts; rollback inserts a new version. The last section's proofs live in
-- scripts/isolated/project-documents.ts and assert the property across the whole catalogue.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. The one new column on documents, and its two keys.
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.documents
  add column if not exists imported_from_document_id uuid;

alter table public.documents
  add constraint documents_imported_from_document_id_fkey
  foreign key (imported_from_document_id) references public.documents (document_id);

alter table public.documents
  add constraint documents_imported_from_same_office
  foreign key (imported_from_document_id, office_id) references public.documents (document_id, office_id);

alter table public.documents
  add constraint documents_import_is_not_itself
  check (imported_from_document_id is null or imported_from_document_id <> document_id);

create unique index documents_one_import_per_original
  on public.documents (office_id, imported_from_document_id)
  where imported_from_document_id is not null;

comment on column public.documents.imported_from_document_id is
  'This row is the durable Team HQ-managed copy of that external document, made by an explicit import (0900). The opposite direction to mirrors_document_id (0169: a copy the office wrote OUT to a connector). One copy per original: documents_one_import_per_original.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Why a version exists.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.document_version_notes (
  document_id          uuid primary key,
  office_id            uuid not null references public.offices (office_id),
  previous_document_id uuid,
  kind                 text not null check (kind in ('new_version', 'adopted', 'rolled_back', 'draft_revision')),
  rolled_back_to       uuid,
  note                 text,
  channel              text,
  created_by           text,
  created_at           timestamptz not null default app.now_utc(),
  -- Insertion order. created_at is the TRANSACTION time, identical for two versions made in one transaction, and a version's
  -- number must never depend on a coin flip: the number is the position in this order (document_version_set).
  seq                  bigint generated always as identity,
  -- Each reference is a single-column key (the edge) and a same-office composite twin (its enforcement), the
  -- convention documents_mirrors_document_id_fkey / _same_office set and docs/multi-user/ownership-manifest.json audits.
  constraint document_version_notes_document_id_fkey foreign key (document_id) references public.documents (document_id),
  constraint document_version_notes_previous_document_id_fkey foreign key (previous_document_id) references public.documents (document_id),
  constraint document_version_notes_rolled_back_to_fkey foreign key (rolled_back_to) references public.documents (document_id),
  constraint document_version_notes_document_same_office foreign key (document_id, office_id) references public.documents (document_id, office_id),
  constraint document_version_notes_previous_same_office foreign key (previous_document_id, office_id) references public.documents (document_id, office_id),
  constraint document_version_notes_rolled_back_same_office foreign key (rolled_back_to, office_id) references public.documents (document_id, office_id)
);

create index document_version_notes_office on public.document_version_notes (office_id);

comment on table public.document_version_notes is
  'Provenance of a document version that the superseded_by chain cannot carry: the person''s note, which door made it, who. One row per version created by hq_document_new_version, hq_document_rollback or document_adopt_version; the chain itself stays in documents.superseded_by (0382). Read by hq_document_versions.';

create trigger a1_office_write_once before update of office_id on public.document_version_notes
  for each row execute function app.office_id_is_write_once();

alter table public.document_version_notes enable row level security;
revoke all on table public.document_version_notes from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. An import that is waiting for material.
-- ---------------------------------------------------------------------------------------------------------------------

create table public.document_import_requests (
  request_id       uuid primary key default gen_random_uuid(),
  office_id        uuid not null references public.offices (office_id),
  document_id      uuid not null,
  requested_by     text,
  channel          text,
  state            text not null default 'pending' check (state in ('pending', 'done')),
  copy_document_id uuid,
  requested_at     timestamptz not null default app.now_utc(),
  done_at          timestamptz,
  constraint document_import_requests_one_per_original unique (office_id, document_id),
  constraint document_import_requests_done_has_copy check ((state = 'done') = (copy_document_id is not null)),
  constraint document_import_requests_document_id_fkey foreign key (document_id) references public.documents (document_id),
  constraint document_import_requests_copy_document_id_fkey foreign key (copy_document_id) references public.documents (document_id),
  constraint document_import_requests_document_same_office foreign key (document_id, office_id) references public.documents (document_id, office_id),
  constraint document_import_requests_copy_same_office foreign key (copy_document_id, office_id) references public.documents (document_id, office_id)
);

comment on table public.document_import_requests is
  'An explicit person''s request to import an external document whose text or bytes Team HQ does not hold yet. Never written by anything but app.hq_document_import (a press); completed by app.document_import_fulfil when the drive read path has brought the material in. One per original.';

create trigger a1_office_write_once before update of office_id on public.document_import_requests
  for each row execute function app.office_id_is_write_once();

alter table public.document_import_requests enable row level security;
revoke all on table public.document_import_requests from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The lineage: v1..vN, derived from superseded_by and nothing else.
--
-- `superseded_by` is single-valued, so a lineage is an in-tree that ends in exactly one head (a document with no
-- successor). Two documents superseded by the same successor are legitimate (both are its history). The version number
-- is the position in order of (longest chain from a root, created_at, id), numbered 1..N without gaps, so a fan-in is
-- still a clean v1, v2, v3. Cycle-safe: the walk carries its path, and hq_document_supersede now refuses to write a
-- cycle (section 9), so a cycle can only be legacy data and degrades to created_at order rather than looping.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.document_lineage(p_office uuid, p_document uuid)
returns table (document_id uuid, version integer, is_head boolean)
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
  with recursive comp(id) as (
    select d.document_id from public.documents d
     where d.document_id = p_document and d.office_id = p_office
    union
    select n.document_id
      from comp c
      join public.documents n
        on n.office_id = p_office
       and (n.superseded_by = c.id
            or n.document_id = (select s.superseded_by from public.documents s
                                 where s.document_id = c.id and s.office_id = p_office))
  ),
  walk(id, depth, path) as (
    select c.id, 1, array[c.id]
      from comp c
     where not exists (select 1 from public.documents x
                        where x.superseded_by = c.id and x.office_id = p_office)
    union all
    select d.superseded_by, w.depth + 1, w.path || d.superseded_by
      from walk w
      join public.documents d on d.document_id = w.id and d.office_id = p_office
     where d.superseded_by is not null and not d.superseded_by = any (w.path)
  ),
  depths as (select w.id, max(w.depth) as depth from walk w group by w.id)
  select d.document_id,
         (row_number() over (order by coalesce(dp.depth, 0), d.created_at, d.document_id))::integer,
         d.superseded_by is null
    from comp c
    join public.documents d on d.document_id = c.id and d.office_id = p_office
    left join depths dp on dp.id = c.id
$f$;

comment on function app.document_lineage(uuid, uuid) is
  'The versions of one logical document, derived by walking documents.superseded_by in both directions. version is 1 for the oldest; is_head marks the one with no successor. Stores nothing (0310).';

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Reading the versions.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.hq_document_versions(p_office uuid, p_document uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  v_base   uuid;
  v_head   uuid;
  v_title  text;
  v_n      integer;
  v_items  jsonb;
  v_pend   uuid;
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.documents d where d.document_id = p_document and d.office_id = p_office) then
    return jsonb_build_object('error', 'there is no document with that id');
  end if;
  -- Asked about a pending draft, answer for the document it is a revision of.
  v_base := app.document_base(p_office, p_document);
  select l.document_id into v_head from app.document_lineage(p_office, v_base) l where l.is_head limit 1;
  -- A legacy cycle has no head. Fall back to the newest so the caller still gets an answer.
  if v_head is null then
    select l.document_id into v_head
      from app.document_lineage(p_office, v_base) l
      join public.documents d on d.document_id = l.document_id and d.office_id = p_office
     order by d.created_at desc, d.document_id desc limit 1;
  end if;
  select d.title into v_title from public.documents d where d.document_id = v_head and d.office_id = p_office;
  select count(*)::integer into v_n from app.document_version_set(p_office, v_base);
  select r.document_id into v_pend
    from app.document_pending_revisions(p_office, v_head) r
   where r.state in ('draft', 'review') order by r.created_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'document_id', d.document_id,
           'version', l.version,
           'title', d.title,
           'created_at', d.created_at,
           'fetched_at', d.fetched_at,
           'updated_at', coalesce(d.remote_updated_at, d.updated_at),
           'size_bytes', d.byte_size,
           'content_chars', d.content_chars,
           'words', case when d.content_chars is null then null else round(d.content_chars / 5.5)::integer end,
           'produced_by', d.produced_by,
           'produced_by_job', d.produced_by_job,
           'origin', d.origin,
           'connector', d.connector,
           'state', d.state,
           'is_current', d.document_id = v_head,
           'is_pending', l.is_pending,
           -- kept for the pages that drew an unnumbered "earlier draft"; every version is numbered now
           'is_earlier_draft', d.state = 'archived' and d.superseded_by is null and d.document_id <> v_head
                               and exists (select 1 from public.document_version_notes z
                                            where z.document_id = d.document_id and z.office_id = p_office and z.kind = 'draft_revision'),
           -- A version can be returned to if it was once APPROVED (a lineage member) and holds content. A draft never was.
           'can_roll_back_to', not l.is_pending
                               and not (d.state = 'archived' and d.superseded_by is null and d.document_id <> v_head)
                               and (d.content is not null or d.storage_path is not null)
                               and (d.document_id <> v_head or v_pend is not null),
           'note', n.note,
           'how', n.kind,
           'channel', n.channel,
           'created_by', n.created_by,
           'previous_document_id', n.previous_document_id,
           'rolled_back_to', n.rolled_back_to,
           'restored_from_version', case when n.rolled_back_to is null then null
                                         else app.document_number(p_office, v_base, n.rolled_back_to) end
         ) order by l.version), '[]'::jsonb)
    into v_items
    from app.document_version_set(p_office, v_base) l
    join public.documents d on d.document_id = l.document_id and d.office_id = p_office
    left join public.document_version_notes n on n.document_id = d.document_id and n.office_id = p_office;

  return jsonb_build_object(
    'logical_title', v_title,
    'current_id', v_head,
    'current_version', app.document_number(p_office, v_base, v_head),
    'pending_id', v_pend,
    'version_count', v_n,
    'versions', v_items);
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. The one place a successor becomes part of a lineage, with everything the old head had carried across.
--
-- Shared by new_version, rollback and adopt so there is one definition of "the next version inherits": project (checked
-- by the callers), tags (unioned), the pin and its position in the project's custom order, and collection membership.
-- The old head is ARCHIVED with superseded_by pointing at the successor - exactly what hq_document_supersede does - and
-- is never deleted. Its collection rows are kept too (history), the successor gets copies.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.document_carry(p_office uuid, p_head uuid, p_new uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  h public.documents%rowtype;
begin
  select * into h from public.documents where document_id = p_head and office_id = p_office for update;
  update public.documents n
     set tags = coalesce((select array(select distinct t from unnest(coalesce(n.tags, '{}') || coalesce(h.tags, '{}')) t order by 1)), '{}'),
         pinned = n.pinned or h.pinned
   where n.document_id = p_new and n.office_id = p_office;
  update public.documents
     set state = 'archived', superseded_by = p_new, pinned = false
   where document_id = p_head and office_id = p_office;
  -- Keep the position the old one held in the project's custom order. Elements are uuid strings (hq_document_order_set).
  if h.project_id is not null then
    update public.document_orders o
       set doc_ids = (select coalesce(jsonb_agg(case when e.value #>> '{}' = p_head::text then to_jsonb(p_new::text) else e.value end
                                                order by e.ordinality), '[]'::jsonb)
                        from jsonb_array_elements(o.doc_ids) with ordinality e(value, ordinality)),
           updated_at = app.now_utc()
     where o.project_id = h.project_id
       and exists (select 1 from public.projects pr where pr.project_id = o.project_id and pr.office_id = p_office)
       and o.doc_ids @> to_jsonb(p_head::text) is true;
  end if;
  insert into public.document_collections (document_id, collection_id)
  select p_new, c.collection_id
    from public.document_collections c
   where c.document_id = p_head
  on conflict do nothing;
end
$f$;

create or replace function app.document_version_link(
  p_office uuid, p_head uuid, p_new uuid, p_kind text, p_rolled_back_to uuid, p_note text, p_channel text)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
begin
  perform app.document_carry(p_office, p_head, p_new);
  insert into public.document_version_notes
    (document_id, office_id, previous_document_id, kind, rolled_back_to, note, channel, created_by)
  values (p_new, p_office, p_head, p_kind, p_rolled_back_to,
          nullif(btrim(coalesce(p_note, '')), ''), nullif(btrim(coalesce(p_channel, '')), ''),
          app.office_actor(p_office));
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6b. APPROVAL BELONGS TO A VERSION. Grant's policy (5 October 2026): creating v4 from approved v3 creates v4 as a DRAFT.
-- It does not inherit v3's approval, and a draft revision must never make the approved document disappear.
--
-- So a new version of an approved document is a PENDING revision: a draft attached to the lineage by a note
-- (kind draft_revision) and by nothing else. v3 stays approved, stays unsuperseded and stays the item the project lists;
-- the draft is listed beside it. The superseded_by link, the archiving of v3 and the carrying of tags, pin, order and
-- collections all happen at the one moment a person APPROVES the draft (the trigger below), whichever door the approval
-- came through (approve_document, decide_output, import_output, a direct update): the writers share one door, so the
-- rule lives there rather than in each of them.
-- ---------------------------------------------------------------------------------------------------------------------

-- The approved head a document belongs to: itself, or, for a pending draft revision, the head of the lineage it was
-- written against (which may have moved on since - a rollback or another approval - so the head is looked up, not stored).
create or replace function app.document_base(p_office uuid, p_document uuid)
returns uuid
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
  select coalesce(
           (select l.document_id from app.document_lineage(p_office, n.previous_document_id) l where l.is_head limit 1),
           n.previous_document_id)
    from public.document_version_notes n
    join public.documents d on d.document_id = n.document_id and d.office_id = p_office
   where n.document_id = p_document and n.office_id = p_office and n.kind = 'draft_revision'
     and d.state <> 'approved' and d.superseded_by is null
  union all
  select p_document
   where not exists (select 1
                       from public.document_version_notes n
                       join public.documents d on d.document_id = n.document_id and d.office_id = p_office
                      where n.document_id = p_document and n.office_id = p_office and n.kind = 'draft_revision'
                        and d.state <> 'approved' and d.superseded_by is null)
  limit 1
$f$;

-- Every draft revision written against this lineage that is not itself part of it. Live ones (draft, review) are
-- "pending"; archived ones are earlier drafts a newer draft replaced, kept as history and never numbered.
create or replace function app.document_pending_revisions(p_office uuid, p_base uuid)
returns table (document_id uuid, state text, created_at timestamptz)
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
  select d.document_id, d.state, d.created_at
    from public.document_version_notes n
    join public.documents d on d.document_id = n.document_id and d.office_id = p_office
   where n.office_id = p_office and n.kind = 'draft_revision'
     and n.previous_document_id in (select l.document_id from app.document_lineage(p_office, p_base) l)
     and d.state in ('draft', 'review', 'archived')
     and d.superseded_by is null
     and d.document_id not in (select l.document_id from app.document_lineage(p_office, p_base) l)
$f$;

-- Attach a draft as the pending revision of an approved head. A newer draft REPLACES an older pending one (the older is
-- archived, never deleted), so a lineage has at most one pending draft and "v4 Draft" is never ambiguous.
create or replace function app.document_pending_attach(
  p_office uuid, p_head uuid, p_new uuid, p_note text, p_channel text)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
begin
  update public.documents d
     set state = 'archived'
   where d.office_id = p_office and d.state in ('draft', 'review') and d.document_id <> p_new
     and d.document_id in (select r.document_id from app.document_pending_revisions(p_office, p_head) r);
  insert into public.document_version_notes
    (document_id, office_id, previous_document_id, kind, note, channel, created_by)
  values (p_new, p_office, p_head, 'draft_revision',
          nullif(btrim(coalesce(p_note, '')), ''), nullif(btrim(coalesce(p_channel, '')), ''),
          app.office_actor(p_office))
  on conflict (document_id) do nothing;
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6c. VERSION NUMBERS ARE STABLE AND IMMUTABLE (Grant, 5 October: v3 Approved, v4 Draft; returning to v3 makes v5).
--
-- A number is the version's position in the order versions were MADE, counting every version of the logical document -
-- approved, replaced, still a draft, or an earlier draft a newer one replaced. So v4 stays v4 whatever later happens to
-- it, a rollback is v5, and nothing is ever renumbered. The order is the notes' insertion sequence (a root version has no
-- note and sorts first; ties among roots by created_at, id). Derived on read, stored nowhere (0310).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app.document_version_set(p_office uuid, p_document uuid)
returns table (document_id uuid, version integer, is_head boolean, is_pending boolean)
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
  with base as (select app.document_base(p_office, p_document) as b),
  head as (
    select l.document_id as h
      from app.document_lineage(p_office, (select b from base)) l
     where l.is_head
     limit 1
  ),
  members as (
    select l.document_id from app.document_lineage(p_office, (select b from base)) l
    union
    select r.document_id from app.document_pending_revisions(p_office, (select h from head)) r
  ),
  ranked as (
    select m.document_id,
           (row_number() over (order by (n.seq is not null), n.seq, d.created_at, d.document_id))::integer as version
      from members m
      join public.documents d on d.document_id = m.document_id and d.office_id = p_office
      left join public.document_version_notes n on n.document_id = m.document_id and n.office_id = p_office
  )
  select r.document_id, r.version,
         r.document_id = (select h from head),
         exists (select 1 from app.document_pending_revisions(p_office, (select h from head)) pr
                  where pr.document_id = r.document_id and pr.state in ('draft', 'review'))
    from ranked r
$f$;

create or replace function app.document_number(p_office uuid, p_in uuid, p_document uuid)
returns integer
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
  select s.version from app.document_version_set(p_office, p_in) s where s.document_id = p_document
$f$;

create or replace function app.document_next_number(p_office uuid, p_in uuid)
returns integer
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
  select coalesce(max(s.version), 0)::integer + 1 from app.document_version_set(p_office, p_in) s
$f$;

create or replace function app.draft_revision_approved()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  v_prev uuid;
  v_head uuid;
  h      public.documents%rowtype;
begin
  select n.previous_document_id into v_prev
    from public.document_version_notes n
   where n.document_id = new.document_id and n.office_id = new.office_id and n.kind = 'draft_revision';
  if v_prev is null then return new; end if;
  select l.document_id into v_head from app.document_lineage(new.office_id, v_prev) l where l.is_head limit 1;
  select * into h from public.documents where document_id = coalesce(v_head, v_prev) and office_id = new.office_id;
  -- A sibling draft that is still pending when its neighbour is approved is no longer the next version of anything.
  update public.documents d
     set state = 'archived'
   where d.office_id = new.office_id and d.state in ('draft', 'review') and d.document_id <> new.document_id
     and d.document_id in (select r.document_id from app.document_pending_revisions(new.office_id, coalesce(v_head, v_prev)) r);
  if h.document_id is not null and h.document_id <> new.document_id
     and h.state = 'approved' and h.superseded_by is null
     and h.project_id is not distinct from new.project_id then
    perform app.document_carry(new.office_id, h.document_id, new.document_id);
  end if;
  return new;
end
$f$;

create trigger documents_draft_revision_approved
  after update of state on public.documents
  for each row when (new.state = 'approved' and old.state is distinct from 'approved')
  execute function app.draft_revision_approved();

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Making the next version: from new text, or by adopting a document that already exists (an artifact job's revised
--    report). Rolling back is a NEW version holding the old content - history is never rewritten, so a rollback is
--    itself reversible by rolling back again, and no undo verb has to be taught to hq_undo.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.hq_document_new_version(
  p_office uuid, p_document uuid, p_content text default null, p_by_document uuid default null,
  p_note text default null, p_channel text default null, p_approve boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  h        public.documents%rowtype;
  y        public.documents%rowtype;
  v_head   uuid;
  v_new    uuid;
  v_text   text := nullif(btrim(coalesce(p_content, ''), E' \t\r\n'), '');
  v_fp     text;
  v_ver    integer;
begin
  perform app.require_office(p_office);
  if (v_text is null) = (p_by_document is null) then
    return jsonb_build_object('ok', false, 'error', 'give either the new content or the existing document that is the next version, not both and not neither');
  end if;
  select * into h from public.documents where document_id = p_document and office_id = p_office for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'there is no document with that id');
  end if;
  if v_text is not null then v_fp := encode(extensions.digest(p_content, 'sha256'), 'hex'); end if;

  if h.superseded_by is not null then
    select l.document_id into v_head from app.document_lineage(p_office, p_document) l where l.is_head limit 1;
    -- Pressing twice (or two tabs) must not make two versions: if the current one already carries this, say so.
    if p_by_document is not null and p_by_document = h.superseded_by then
      return jsonb_build_object('ok', true, 'already', true, 'document_id', h.superseded_by, 'current_id', v_head);
    end if;
    if v_fp is not null and exists (select 1 from public.documents c where c.document_id = v_head and c.office_id = p_office
                                     and c.content_fingerprint = v_fp) then
      return jsonb_build_object('ok', true, 'already', true, 'document_id', v_head, 'current_id', v_head);
    end if;
    return jsonb_build_object('ok', false, 'error', 'that is not the latest version of this document', 'current_id', v_head);
  end if;
  if h.state <> 'approved' then
    return jsonb_build_object('ok', false, 'error', format('only a document in the project (approved) can be versioned; this one is %s', h.state));
  end if;
  v_ver := app.document_next_number(p_office, h.document_id) - 1;

  if v_text is not null then
    if h.content_fingerprint = v_fp then
      return jsonb_build_object('ok', false, 'error', 'that is the same content as the current version');
    end if;
    -- Pressing twice must not make two drafts: the pending draft already carrying this is the answer.
    select r.document_id into v_new
      from app.document_pending_revisions(p_office, h.document_id) r
      join public.documents c on c.document_id = r.document_id and c.office_id = p_office
     where r.state in ('draft', 'review') and c.content_fingerprint = v_fp limit 1;
    if v_new is not null then
      return jsonb_build_object('ok', true, 'already', true, 'document_id', v_new, 'previous_id', h.document_id,
                                'pending_id', v_new, 'current_id', h.document_id, 'version', app.document_number(p_office, h.document_id, v_new), 'state', 'draft');
    end if;
    -- The new text is a DRAFT. It does not inherit the approval of the version it was made from.
    insert into public.documents
      (office_id, project_id, title, doc_type, content, content_fingerprint, content_chars, fetched_at,
       origin, connector, state, added_by, tags, pinned)
    values (p_office, h.project_id, h.title, h.doc_type, p_content, v_fp, length(p_content), app.now_utc(),
            'yours', null, 'draft', app.office_actor(p_office), '{}', false)
    returning document_id into v_new;
    perform app.document_pending_attach(p_office, h.document_id, v_new, p_note, p_channel);
  else
    select * into y from public.documents where document_id = p_by_document and office_id = p_office for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'the document offered as the next version does not exist');
    end if;
    if y.document_id = h.document_id then
      return jsonb_build_object('ok', false, 'error', 'a document cannot be its own next version');
    end if;
    if y.project_id is distinct from h.project_id then
      return jsonb_build_object('ok', false, 'error', 'the next version must be in the same project');
    end if;
    if y.superseded_by is not null or exists (select 1 from public.documents x where x.superseded_by = y.document_id and x.office_id = p_office) then
      return jsonb_build_object('ok', false, 'error', 'that document already has version history of its own');
    end if;
    if y.state = 'approved' then
      -- Approved on its own account, by a person: it is the next version now.
      perform app.document_version_link(p_office, h.document_id, y.document_id, 'adopted', null, p_note, p_channel);
      return jsonb_build_object('ok', true, 'document_id', y.document_id, 'previous_id', h.document_id,
                                'version', v_ver + 1, 'current_id', y.document_id, 'state', 'approved');
    end if;
    if y.state not in ('draft', 'review') then
      return jsonb_build_object('ok', false, 'error', format('a %s document cannot become a version', y.state));
    end if;
    v_new := y.document_id;
    if not p_approve and exists (select 1 from public.document_version_notes z where z.document_id = v_new and z.office_id = p_office) then
      return jsonb_build_object('ok', true, 'already', true, 'document_id', v_new, 'previous_id', h.document_id,
                                'pending_id', v_new, 'current_id', h.document_id,
                                'version', app.document_number(p_office, h.document_id, v_new), 'state', y.state);
    end if;
    perform app.document_pending_attach(p_office, h.document_id, v_new, p_note, p_channel);
  end if;

  -- p_approve is a PERSON's yes given together with the request: only then does the new version become current.
  if p_approve then
    update public.documents set state = 'approved' where document_id = v_new and office_id = p_office;
    return jsonb_build_object('ok', true, 'document_id', v_new, 'previous_id', h.document_id,
                              'version', app.document_number(p_office, v_new, v_new), 'current_id', v_new, 'state', 'approved');
  end if;
  return jsonb_build_object('ok', true, 'document_id', v_new, 'previous_id', h.document_id,
                            'version', app.document_number(p_office, h.document_id, v_new),
                            'pending_id', v_new, 'current_id', h.document_id, 'state', 'draft');
end
$f$;

comment on function app.hq_document_new_version(uuid, uuid, text, uuid, text, text, boolean) is
  'The next version of an approved document, from new text (p_content) or by adopting an existing document in the same project (p_by_document - an artifact job''s revised report). Approval belongs to a version: unless p_approve (a person''s yes) or the adopted document is already approved, the new version is a DRAFT pending revision; the approved version stays current and listed, and the link, the archiving and the carry-over happen when the draft is approved. Idempotent for the same content or the same adopted document.';

create or replace function app.hq_document_rollback(
  p_office uuid, p_document uuid, p_note text default null, p_channel text default null)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  t        public.documents%rowtype;
  v_head   uuid;
  h        public.documents%rowtype;
  v_new    uuid;
  v_ver    integer;
  v_from   integer;
  v_pend   uuid;
  v_by     text;
begin
  perform app.require_office(p_office);
  select * into t from public.documents where document_id = p_document and office_id = p_office;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'there is no document with that id');
  end if;
  -- A draft (or a draft a newer one replaced) was never approved: there is nothing to return TO. Approve it instead.
  if exists (select 1 from app.document_pending_revisions(p_office, p_document) r where r.document_id = t.document_id)
     or exists (select 1 from public.document_version_notes z
                 where z.document_id = t.document_id and z.office_id = p_office and z.kind = 'draft_revision'
                   and t.superseded_by is null and t.state <> 'approved') then
    return jsonb_build_object('ok', false, 'error', 'that version was never approved, so there is nothing to return to; approve it instead');
  end if;
  select l.document_id into v_head from app.document_lineage(p_office, p_document) l where l.is_head limit 1;
  if v_head is null then
    return jsonb_build_object('ok', false, 'error', 'that document has no single current version to roll back from');
  end if;
  select r.document_id into v_pend
    from app.document_pending_revisions(p_office, v_head) r where r.state in ('draft', 'review') limit 1;
  -- Returning to the version that is already current is pointless, unless a draft is waiting beside it: then "return to
  -- this one" is a real choice (Grant: v3 Approved, v4 Draft, "Return to this version" on v3 makes v5 Approved).
  if v_head = t.document_id and v_pend is null then
    return jsonb_build_object('ok', false, 'error', 'that is already the current version');
  end if;
  if t.content is null and t.storage_path is null then
    return jsonb_build_object('ok', false, 'error', 'that version holds no content to return to');
  end if;
  select * into h from public.documents where document_id = v_head and office_id = p_office for update;
  if h.state <> 'approved' then
    return jsonb_build_object('ok', false, 'error', format('the current version is %s, not in the project', h.state));
  end if;
  -- A second press (or a double click) must not stack a second restored copy: if the current version already holds
  -- exactly the content being returned to, there is nothing to restore.
  if t.document_id <> v_head
     and ((t.content_fingerprint is not null and t.content_fingerprint = h.content_fingerprint)
          or (t.storage_path is not null and t.storage_path = h.storage_path)) then
    return jsonb_build_object('ok', false, 'error', 'the current version already holds that content', 'current_id', v_head);
  end if;
  v_from := app.document_number(p_office, v_head, t.document_id);
  -- ROLLBACK IS A NEW VERSION. t is not mutated, nothing is deleted, a waiting draft is left exactly as it is, and the
  -- restored copy is APPROVED: it is a person's explicit act and the content is what was once approved.
  insert into public.documents
    (office_id, project_id, title, doc_type, content, content_fingerprint, content_chars, fetched_at,
     storage_path, mime_type, byte_size, duration_s, origin, connector, state, added_by, tags, pinned)
  values (p_office, h.project_id, h.title, coalesce(t.doc_type, h.doc_type), t.content, t.content_fingerprint,
          t.content_chars, case when t.content is null then null else app.now_utc() end,
          t.storage_path, t.mime_type, t.byte_size, t.duration_s,
          'yours', null, 'approved', app.office_actor(p_office), '{}', false)
  returning document_id into v_new;
  perform app.document_version_link(p_office, h.document_id, v_new, 'rolled_back', t.document_id,
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), format('Restored from v%s', v_from)), p_channel);
  v_ver := app.document_number(p_office, v_new, v_new);
  v_by := app.office_actor(p_office);
  -- The ledger, so Activity says it: "<person> restored <title> v5 from v3" (category: documents).
  perform app.append_event(
    p_office, gen_random_uuid(), 'user', v_by, 'document.rollback', 'document.rolled_back', false, h.project_id,
    jsonb_build_object('current_id', h.document_id, 'version', app.document_number(p_office, v_new, h.document_id)),
    jsonb_build_object('current_id', v_new, 'version', v_ver, 'restored_from', t.document_id, 'restored_from_version', v_from,
                       'draft_kept', v_pend),
    format('%s restored from v%s as v%s (approved); nothing was deleted%s', h.title, v_from, v_ver,
           case when v_pend is null then '' else '; the waiting draft is kept in history' end));
  return jsonb_build_object('ok', true, 'document_id', v_new, 'previous_id', h.document_id,
                            'rolled_back_to', t.document_id, 'restored_from_version', v_from, 'version', v_ver,
                            'current_id', v_new, 'state', 'approved', 'draft_kept_id', v_pend,
                            'said', format('Restored v%s as v%s (approved).%s', v_from, v_ver,
                                           case when v_pend is null then '' else ' The draft that was waiting is kept in the history.' end));
end
$f$;

comment on function app.hq_document_rollback(uuid, uuid, text, text) is
  'Make an older version current again by writing its content as a NEW version (revert, not rewind). History is untouched, so a rollback can itself be rolled back. hq_document_restore stays what it was: the undo of a supersede LINK (it unlinks), not a way to choose a version.';

-- The helper for a revised report: an artifact job produced a document; make it the next version of an existing one.
-- Only the job's own output in the same office is adoptable, and it must already be in the project (approved) - an agent
-- calling this never approves anything on a person's behalf. A TypeScript caller passes the job it ran as.
create or replace function app.document_adopt_version(p_office uuid, p_head uuid, p_job uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  v_doc uuid;
  v_n   integer;
begin
  perform app.require_office(p_office);
  select count(*), min(d.document_id::text)::uuid into v_n, v_doc
    from public.documents d
   where d.office_id = p_office and d.produced_by_job = p_job and d.document_id <> p_head;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'that job has produced no document to adopt');
  end if;
  if v_n > 1 then
    return jsonb_build_object('ok', false, 'error', 'that job produced several documents; name the one by document id');
  end if;
  return app.hq_document_new_version(p_office, p_head, null, v_doc, p_note, 'job', false);
end
$f$;

comment on function app.document_adopt_version(uuid, uuid, uuid, text) is
  'Attach the single document a job produced as the next version of p_head (an artifact job''s revised report). Does not approve: an unapproved output becomes a pending DRAFT revision beside the approved head, because approving is a person''s act and approval belongs to a version.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Import: an explicit press that turns an external document into a durable Team HQ copy.
--
-- Three outcomes, all explicit and all idempotent:
--   imported  Team HQ already holds the material (extracted text, or the bytes from drive.read_file) - the copy is made
--             now: a new documents row, origin yours, connector null, linked by imported_from_document_id.
--   pending   it does not hold it yet (a Drive reference). The request is recorded (one per original) and
--             app.document_import_fulfil finishes it when drive.read_file has brought the material in.
--   already   a copy exists; its id is returned.
-- Only a source-origin document can be imported: yours and made documents are already held. A shared storage_path is
-- deliberate for a file already in the files bucket: the bucket object is Team HQ's, no code path removes one except
-- teardown, and copying bytes needs the Storage API, which SQL cannot call.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.document_import_copy(p_office uuid, p_original uuid, p_channel text)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  o public.documents%rowtype;
  v_id uuid;
begin
  select * into o from public.documents where document_id = p_original and office_id = p_office;
  insert into public.documents
    (office_id, project_id, title, doc_type, content, content_fingerprint, content_chars, fetched_at,
     remote_updated_at, storage_path, mime_type, byte_size, duration_s, origin, connector, state, added_by, tags,
     imported_from_document_id)
  values (p_office, o.project_id, o.title, o.doc_type, o.content, o.content_fingerprint, o.content_chars,
          case when o.content is null then null else coalesce(o.fetched_at, app.now_utc()) end,
          o.remote_updated_at, o.storage_path, o.mime_type, o.byte_size, o.duration_s,
          'yours', null, 'approved', app.office_actor(p_office), coalesce(o.tags, '{}'), o.document_id)
  on conflict (office_id, imported_from_document_id) where imported_from_document_id is not null do nothing
  returning document_id into v_id;
  if v_id is null then
    select c.document_id into v_id from public.documents c
     where c.office_id = p_office and c.imported_from_document_id = p_original;
  end if;
  return v_id;
end
$f$;

create or replace function app.hq_document_import(p_office uuid, p_document uuid, p_channel text default null)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  o public.documents%rowtype;
  v_copy uuid;
  v_req  uuid;
begin
  perform app.require_office(p_office);
  select * into o from public.documents where document_id = p_document and office_id = p_office for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'there is no document with that id');
  end if;
  if o.origin <> 'source' then
    return jsonb_build_object('ok', false, 'error', 'Team HQ already holds that document; there is nothing to import');
  end if;
  if o.state = 'archived' then
    return jsonb_build_object('ok', false, 'error', 'that document is archived');
  end if;
  select c.document_id into v_copy from public.documents c
   where c.office_id = p_office and c.imported_from_document_id = o.document_id;
  if v_copy is not null then
    return jsonb_build_object('ok', true, 'state', 'imported', 'already', true, 'copy_id', v_copy);
  end if;
  if o.content is not null or o.storage_path is not null then
    v_copy := app.document_import_copy(p_office, o.document_id, p_channel);
    update public.document_import_requests
       set state = 'done', copy_document_id = v_copy, done_at = app.now_utc()
     where office_id = p_office and document_id = o.document_id and state = 'pending';
    return jsonb_build_object('ok', true, 'state', 'imported', 'already', false, 'copy_id', v_copy);
  end if;
  insert into public.document_import_requests (office_id, document_id, requested_by, channel)
  values (p_office, o.document_id, app.office_actor(p_office), nullif(btrim(coalesce(p_channel, '')), ''))
  on conflict (office_id, document_id) do nothing
  returning request_id into v_req;
  if v_req is null then
    select r.request_id into v_req from public.document_import_requests r
     where r.office_id = p_office and r.document_id = o.document_id;
  end if;
  return jsonb_build_object(
    'ok', true, 'state', 'pending', 'request_id', v_req,
    'needs', case o.connector when 'drive' then 'drive.read_file' else 'source_read' end,
    'note', 'Team HQ does not hold this document''s text or file yet. The import is recorded and completes when the source has been read.');
end
$f$;

comment on function app.hq_document_import(uuid, uuid, text) is
  'The explicit import of an external (origin source) document into a durable Team HQ copy. Only ever a press: nothing calls it but the document_import gateway action. Idempotent (one copy per original, one request per original).';

-- Completes a pending request once the material is held. Called by the drive read path after it records a file; a
-- request that was never made is never invented - nothing happens without a recorded explicit request.
create or replace function app.document_import_fulfil(p_office uuid, p_document uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  r public.document_import_requests%rowtype;
  o public.documents%rowtype;
  v_copy uuid;
begin
  perform app.require_office(p_office);
  select * into r from public.document_import_requests
   where office_id = p_office and document_id = p_document and state = 'pending' for update;
  if not found then
    return jsonb_build_object('ok', true, 'fulfilled', false, 'reason', 'no pending request');
  end if;
  select * into o from public.documents where document_id = p_document and office_id = p_office;
  if o.content is null and o.storage_path is null then
    return jsonb_build_object('ok', true, 'fulfilled', false, 'reason', 'still no material');
  end if;
  v_copy := app.document_import_copy(p_office, p_document, r.channel);
  update public.document_import_requests
     set state = 'done', copy_document_id = v_copy, done_at = app.now_utc()
   where request_id = r.request_id;
  return jsonb_build_object('ok', true, 'fulfilled', true, 'copy_id', v_copy);
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 9. hq_document_supersede refuses to write a cycle (a lineage with no head has no current version).
--    Spliced from the LIVE definition so nothing a later migration changed is overwritten from memory.
-- ---------------------------------------------------------------------------------------------------------------------

do $s$
declare
  v_def text := pg_get_functiondef('app.hq_document_supersede(uuid, uuid, uuid)'::regprocedure);
  v_new text;
begin
  v_new := replace(v_def,
    $a$  select d.title, d.state into v_title, v_was$a$,
    $a$  if exists (
    with recursive up(id, path) as (
      select p_by_document_id, array[p_by_document_id]
      union all
      select d.superseded_by, up.path || d.superseded_by
        from up join public.documents d on d.document_id = up.id and d.office_id = p_office
       where d.superseded_by is not null and not d.superseded_by = any (up.path))
    select 1 from up where up.id = p_document_id) then
    return jsonb_build_object('error', 'that would make the two documents each the replacement of the other');
  end if;
  select d.title, d.state into v_title, v_was$a$);
  if v_new = v_def then raise exception '0900: hq_document_supersede splice did not land'; end if;
  execute v_new;
end $s$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 10. THE UNIFIED READ. One item per logical document, with how it is represented.
--
-- Why each collapse rule is safe, and what none of them is:
--
--  a. superseded_by lineage. A document replaced by an approved successor in the same project is that successor's
--     history: collapsed into the head, which reports version_count / current_version. Stated identity, not inference.
--  b. mirrors_document_id (0169). The office-written copy of X steps aside only when X itself is visible in this
--     project payload (0464's rule). If the original is not visible the mirror is the only thing the project has, so it
--     stays.
--  c. imported_from_document_id (0900). The Team HQ copy steps aside while its original is present and not missing -
--     the original is the item and says imported:true. When the original is gone (missing_since) or out of play (its
--     connection was disconnected, 0896) the copy IS the item: that is what "survives the original disappearing" means.
--  d. same (connector, external_ref). A provider's file id is its identity; two rows with it are one file (e.g. watched
--     under a folder and also picked directly). Never matched on a name.
--  e. identical content_fingerprint (sha-256) AND identical size, at least 40 characters of content, neither side having
--     version history. Equal sha-256 means equal bytes. The length floor stops two tiny unrelated notes that happen to
--     read "TODO" merging; the history exclusion stops one logical document's lineage swallowing another's.
--
-- What NEVER merges documents: the same or similar title, the same title with a different fingerprint, similar content.
-- Nothing here is fuzzy. A merged item keeps what it absorbed in `duplicates`, so nothing is hidden without being listed.
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function app.hq_project_documents(p_office uuid, p_slug text, p_include_disconnected boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
declare
  v_project uuid;
  v_name    text;
  v_items   jsonb;
  v_visible integer;
begin
  perform app.require_office(p_office);
  select p.project_id, p.name into v_project, v_name
    from public.projects p
   where p.office_id = p_office and p.slug = btrim(coalesce(p_slug, '')) and coalesce(p.is_fixture, false) = false;
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;

  with base as (
    select d.*,
           case
             when d.imported_from_document_id is not null then 'upload'
             when d.origin = 'made' then 'generated'
             when d.origin = 'yours' then 'upload'
             else case d.connector when 'drive' then 'drive' when 'notebooklm' then 'notebook'
                    when 'upload' then 'upload' when 'browser' then 'web' when 'notion' then 'notion'
                    else 'other' end
           end as src,
           coalesce(d.byte_size, d.content_chars::bigint) as size_key,
           exists (select 1 from public.documents o where o.superseded_by = d.document_id and o.office_id = p_office) as has_prev
      from public.documents d
     where d.office_id = p_office and d.project_id = v_project and d.state = 'approved'
  ),
  vis as (
    select b.*
      from base b
     where (b.superseded_by is null
            or not exists (select 1 from app.document_lineage(p_office, b.document_id) l
                             join base hb on hb.document_id = l.document_id
                            where l.is_head))
       and (p_include_disconnected
            or app.document_in_play(b.state, b.origin, b.project_id, b.connector, b.external_parent_ref))
  ),
  c1 as (
    select v.document_id,
           coalesce(
             (select m.document_id from vis m where m.document_id = v.mirrors_document_id),
             (select o.document_id from vis o where o.document_id = v.imported_from_document_id and o.missing_since is null),
             (select i.document_id from vis i where i.imported_from_document_id = v.document_id and v.missing_since is not null),
             v.document_id) as canon
      from vis v
  ),
  c1b as (
    select a.document_id, coalesce(b.canon, a.canon) as canon
      from c1 a left join c1 b on b.document_id = a.canon
  ),
  reps1 as (select v.* from vis v join c1b on c1b.document_id = v.document_id and c1b.canon = v.document_id),
  c2 as (
    select r.document_id,
           case when r.connector is not null and r.external_ref is not null
                then first_value(r.document_id) over (
                       partition by r.connector, r.external_ref
                       order by (r.content is not null or r.storage_path is not null) desc, r.created_at, r.document_id)
                else r.document_id end as canon
      from reps1 r
  ),
  reps2 as (select r.* from reps1 r join c2 on c2.document_id = r.document_id and c2.canon = r.document_id),
  c3 as (
    select r.document_id,
           first_value(r.document_id) over (
             partition by case when r.content_fingerprint is not null and coalesce(r.content_chars, 0) >= 40
                                and r.size_key is not null and not r.has_prev and r.superseded_by is null
                               then r.content_fingerprint || ':' || r.size_key::text
                               else r.document_id::text end
             order by r.created_at, r.document_id) as canon
      from reps2 r
  ),
  fin0 as (
    select v.document_id,
           coalesce(c3.canon, c2.canon, c1b.canon, v.document_id) as rep
      from vis v
      left join c1b on c1b.document_id = v.document_id
      left join c2 on c2.document_id = c1b.canon
      left join c3 on c3.document_id = c2.canon
  ),
  fin as (
    select f.document_id,
           case when exists (select 1 from c3 where c3.document_id = f.rep and c3.canon = f.rep)
                then f.rep else f.document_id end as rep
      from fin0 f
  ),
  items as (
    select v.*
      from vis v join fin on fin.document_id = v.document_id and fin.rep = v.document_id
  ),
  absorbed as (
    select f.rep,
           jsonb_agg(jsonb_build_object('id', v.document_id, 'title', v.title, 'source', v.src,
                       'why', case when v.mirrors_document_id = f.rep then 'mirror'
                                   when v.imported_from_document_id = f.rep then 'imported_copy'
                                   when (select i.imported_from_document_id from vis i where i.document_id = f.rep) = v.document_id
                                     then 'original_gone'
                                   when v.connector is not null and v.external_ref is not null
                                        and exists (select 1 from vis r where r.document_id = f.rep
                                                     and r.connector = v.connector and r.external_ref = v.external_ref)
                                     then 'same_source_file'
                                   else 'identical_content' end)
                     order by v.created_at) as dups,
           array_agg(distinct v.src) as srcs
      from fin f join vis v on v.document_id = f.document_id
     where f.rep <> f.document_id
     group by f.rep
  ),
  shaped as (
    select i.*,
           (select count(*) from public.documents c
             where c.office_id = p_office and c.imported_from_document_id = i.document_id and c.state <> 'archived') > 0 as has_copy,
           (select c.document_id from public.documents c
             where c.office_id = p_office and c.imported_from_document_id = i.document_id limit 1) as copy_id,
           (select r.state from public.document_import_requests r
             where r.office_id = p_office and r.document_id = i.document_id) as req_state,
           case when i.has_prev then (select count(*)::integer from app.document_version_set(p_office, i.document_id)) else 1 end as vcount,
           case when i.has_prev then app.document_number(p_office, i.document_id, i.document_id) else 1 end as vcur,
           (select jsonb_build_object('id', r.document_id, 'state', r.state, 'created_at', r.created_at,
                                      'produced_by', pd.produced_by)
              from app.document_pending_revisions(p_office, i.document_id) r
              join public.documents pd on pd.document_id = r.document_id and pd.office_id = p_office
             where r.state in ('draft', 'review')
             order by r.created_at desc limit 1) as pending,
           a.dups, a.srcs
      from items i left join absorbed a on a.rep = i.document_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.document_id,
           'title', s.title,
           'source', s.src,
           'connector', s.connector,
           'origin', s.origin,
           'mime', s.mime_type,
           'kind', case when coalesce(s.mime_type, '') like 'audio/%' then 'audio'
                        when coalesce(s.mime_type, '') like 'video/%' then 'video'
                        when coalesce(s.mime_type, '') like 'image/%' then 'image'
                        when coalesce(s.mime_type, '') = 'application/pdf' or s.title ilike '%.pdf' then 'pdf'
                        when coalesce(s.doc_type, '') like 'google-%' then s.doc_type
                        else 'doc' end,
           'size_bytes', s.byte_size,
           'content_chars', s.content_chars,
           'words', case when s.content_chars is null then null else round(s.content_chars / 5.5)::integer end,
           'added_at', s.created_at,
           'modified_at', coalesce(s.remote_updated_at, s.updated_at),
           'project_slug', p_slug,
           'external_ref', s.external_ref,
           'external_url', case
              when s.external_ref is null then null
              when s.connector = 'drive' then case s.doc_type
                   when 'google-doc' then 'https://docs.google.com/document/d/' || s.external_ref || '/edit'
                   when 'google-sheet' then 'https://docs.google.com/spreadsheets/d/' || s.external_ref || '/edit'
                   when 'google-slides' then 'https://docs.google.com/presentation/d/' || s.external_ref || '/edit'
                   else 'https://drive.google.com/file/d/' || s.external_ref || '/view' end
              when s.connector = 'notion' and s.external_ref ~ '^[0-9a-fA-F-]{32,36}$'
                   then 'https://www.notion.so/' || replace(s.external_ref, '-', '')
              when s.connector = 'browser' and s.external_ref ~* '^https?://' then s.external_ref
              when s.connector = 'notebooklm' and s.external_parent_ref is not null
                   then 'https://notebooklm.google.com/notebook/' || s.external_parent_ref
              else null end,
           'imported', (s.origin in ('yours', 'made') or s.has_copy),
           'import_available', (s.origin = 'source' and not s.has_copy),
           'import_state', case when s.origin in ('yours', 'made') or s.has_copy then 'imported'
                                when s.req_state = 'pending' then 'pending' else 'none' end,
           'import_document_id', s.copy_id,
           'imported_from_document_id', s.imported_from_document_id,
           'indexed', (s.content is not null
                       or exists (select 1 from public.document_chunks k
                                   where k.document_id = s.document_id and k.office_id = p_office and k.state = 'active')),
           'has_preview', (s.content is not null or s.storage_path is not null),
           'has_file', s.storage_path is not null,
           'connected', app.source_connected(s.origin, s.project_id, s.connector, s.external_parent_ref),
           'missing', s.missing_since is not null,
           'version_count', s.vcount,
           'current_version', s.vcur,
           'current_state', s.state,
           'pending_version', case when s.pending is null then null
                                   else s.pending || jsonb_build_object('version', app.document_number(p_office, s.document_id, (s.pending ->> 'id')::uuid)) end,
           'also_in', (select coalesce(jsonb_agg(q.x order by q.o), '[]'::jsonb)
                         from (select u.x, min(u.o) as o
                                 from unnest(array[s.src] || coalesce(s.srcs, '{}'::text[])) with ordinality u(x, o)
                                group by u.x) q),
           'duplicates', coalesce(s.dups, '[]'::jsonb),
           'thumbnail', jsonb_build_object(
              'available', false,
              'previewable_from_file', s.storage_path is not null and (coalesce(s.mime_type, '') like 'image/%' or s.mime_type = 'application/pdf'),
              'kind', case when coalesce(s.mime_type, '') like 'image/%' then 'image'
                           when s.mime_type = 'application/pdf' then 'pdf' else null end),
           'pinned', s.pinned,
           'tags', to_jsonb(coalesce(s.tags, '{}'::text[])),
           'produced_by', s.produced_by,
           'state', s.state
         ) order by s.pinned desc, coalesce(s.remote_updated_at, s.updated_at) desc, s.document_id), '[]'::jsonb),
         (select count(*)::integer from vis)
    into v_items, v_visible
    from shaped s;

  return jsonb_build_object(
    'project_slug', p_slug,
    'project_name', v_name,
    'documents', v_items,
    'counts', jsonb_build_object(
      'items', jsonb_array_length(v_items),
      'rows_collapsed', v_visible - jsonb_array_length(v_items)));
end
$f$;

comment on function app.hq_project_documents(uuid, text, boolean) is
  'The unified Documents list for one dashboard project: one item per logical document across Drive, NotebookLM, uploads, generated and web material, with source classification, how it is represented, import and index state, and version count. Collapses only on certain identity (see the migration header); never on a name. Not-approved documents are not listed as items (the review gate), but a draft revision of an approved document is reported beside it as pending_version, so the approved version never disappears; disconnected sources are not listed unless p_include_disconnected.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 11. Doors. The app functions are closed to everyone; the public wrappers are service_role's (the gateway), and the
--     gateway puts the verified office in p_office.
-- ---------------------------------------------------------------------------------------------------------------------

revoke all on function
  app.document_lineage(uuid, uuid), app.hq_document_versions(uuid, uuid),
  app.document_version_set(uuid, uuid), app.document_number(uuid, uuid, uuid), app.document_next_number(uuid, uuid),
  app.document_carry(uuid, uuid, uuid), app.document_base(uuid, uuid), app.document_pending_revisions(uuid, uuid),
  app.document_pending_attach(uuid, uuid, uuid, text, text), app.draft_revision_approved(),
  app.document_version_link(uuid, uuid, uuid, text, uuid, text, text),
  app.hq_document_new_version(uuid, uuid, text, uuid, text, text, boolean),
  app.hq_document_rollback(uuid, uuid, text, text), app.document_adopt_version(uuid, uuid, uuid, text),
  app.document_import_copy(uuid, uuid, text), app.hq_document_import(uuid, uuid, text),
  app.document_import_fulfil(uuid, uuid), app.hq_project_documents(uuid, text, boolean)
  from public, anon, authenticated;

create function public.hq_project_documents(p_office uuid, p_slug text, p_include_disconnected boolean default false)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_project_documents(p_office, p_slug, p_include_disconnected) $f$;

create function public.hq_document_versions(p_office uuid, p_document_id uuid)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_document_versions(p_office, p_document_id) $f$;

create function public.hq_document_new_version(
  p_office uuid, p_document_id uuid, p_content text default null, p_by_document_id uuid default null,
  p_note text default null, p_channel text default null, p_approve boolean default false)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_document_new_version(p_office, p_document_id, p_content, p_by_document_id, p_note, p_channel, p_approve) $f$;

create function public.hq_document_rollback(p_office uuid, p_document_id uuid, p_note text default null, p_channel text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_document_rollback(p_office, p_document_id, p_note, p_channel) $f$;

create function public.hq_document_import(p_office uuid, p_document_id uuid, p_channel text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_document_import(p_office, p_document_id, p_channel) $f$;

revoke all on function
  public.hq_project_documents(uuid, text, boolean), public.hq_document_versions(uuid, uuid),
  public.hq_document_new_version(uuid, uuid, text, uuid, text, text, boolean),
  public.hq_document_rollback(uuid, uuid, text, text), public.hq_document_import(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.hq_project_documents(uuid, text, boolean), public.hq_document_versions(uuid, uuid),
  public.hq_document_new_version(uuid, uuid, text, uuid, text, text, boolean),
  public.hq_document_rollback(uuid, uuid, text, text), public.hq_document_import(uuid, uuid, text)
  to service_role;
