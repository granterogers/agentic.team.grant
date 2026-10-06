-- Numbering note (6 Oct 2026): below, "0900" means the documents migration, now 0907. The Public Sample Office's applied
-- 0900 (an empty command id is no command id) is a different migration.
begin;

-- ---------------------------------------------------------------------------
-- 0940 - a made report keeps how it was made, and a revision is a NEW VERSION of it
--
-- "Find the latest customer research report and turn it into a beautiful PDF", and then "redo it with a band title":
-- the second PDF is not another document, it is version 2 of the first. 0900 built the versions; this is the door the
-- artifact job uses, and the record of what a made PDF was made FROM.
--
-- ## What is stored, and why only this
--
-- Already readable and NOT stored again (0310): which job made it (documents.produced_by_job), who (produced_by),
-- when, and that it is a version of an earlier one (document_version_notes).
-- Not readable anywhere, so stored: which house style it was set in (a hash of the resolved profile, and the style's
-- updated_at), what design was chosen (the title page, density and charts the deterministic brief picked, with its
-- reasons), and the sources it cited. `document_provenance` holds one row per made document, written once.
--
-- ## Approval belongs to a version (Grant, 5 October 2026)
--
-- A document the office makes is a DRAFT (the review gate, #28). Creating v4 from approved v3 creates v4 as a Draft: it does
-- not inherit v3's approval, and the draft must never make the approved document vanish from the project. So
-- `document_revise_made`:
--   - base APPROVED  -> v4 is attached as a PENDING draft revision (0900: app.document_pending_attach). v3 stays approved,
--     current and listed; the Documents list shows "v3 Approved" with "v4 Draft" beside it. When a person approves v4 the
--     0900 trigger makes it the head and archives v3 (still listed under versions; rollback restores it as a new version).
--     A newer draft replaces an older pending one (the older is archived, never deleted).
--   - base still DRAFT (nothing was ever approved) -> links the chain the old way and the new version stays a draft: there
--     is no approved version to keep visible, and the office never approves its own work.
-- The office never approves anything here. Either way nothing is deleted and the call is idempotent on the new document.
--
-- Closed doors: no public wrapper, no grant. The worker calls them as the office (app.require_office).
-- ---------------------------------------------------------------------------

create table public.document_provenance (
  document_id      uuid primary key references public.documents (document_id),
  office_id        uuid not null references public.offices (office_id),
  job_id           uuid,
  style_hash       text,
  style_updated_at timestamptz,
  design           jsonb not null default '{}'::jsonb,
  sources          jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default app.now_utc(),
  constraint document_provenance_design_is_object check (jsonb_typeof(design) = 'object'),
  constraint document_provenance_sources_is_array check (jsonb_typeof(sources) = 'array')
);

comment on table public.document_provenance is
  'How a made document was made: the house style (hash + updated_at), the design chosen, the sources cited. One row per made document, written once; read by app.document_provenance_of. Job, author and time are NOT here: documents already holds them.';

create trigger a1_office_write_once
  before update of office_id on public.document_provenance
  for each row execute function app.office_id_is_write_once();

alter table public.document_provenance enable row level security;
revoke all on table public.document_provenance from public, anon, authenticated, service_role;

-- When the style a report used was last changed, so a revision can say whether the style moved under it.
create or replace function app.style_stamp(p_office uuid, p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare v_at timestamptz;
begin
  perform app.require_office(p_office);
  select max(s.updated_at) into v_at
    from public.style_profiles s
   where s.office_id = p_office
     and (s.scope = 'office' or (s.scope = 'project' and s.project_id = p_project));
  return jsonb_build_object('updated_at', v_at);
end
$f$;

create or replace function app.document_provenance_record(
  p_office uuid, p_document uuid, p_job uuid, p_style_hash text, p_style_updated_at timestamptz,
  p_design jsonb, p_sources jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare d public.documents%rowtype;
begin
  perform app.require_office(p_office);
  select * into d from public.documents where document_id = p_document and office_id = p_office;
  if not found then return jsonb_build_object('ok', false, 'error', 'there is no document with that id'); end if;
  if d.origin <> 'made' then
    return jsonb_build_object('ok', false, 'error', 'provenance is kept for documents the office made');
  end if;
  insert into public.document_provenance
    (document_id, office_id, job_id, style_hash, style_updated_at, design, sources)
  values (p_document, p_office, p_job, nullif(btrim(coalesce(p_style_hash, '')), ''), p_style_updated_at,
          coalesce(p_design, '{}'::jsonb), coalesce(p_sources, '[]'::jsonb))
  on conflict (document_id) do nothing;
  return jsonb_build_object('ok', true, 'document_id', p_document, 'already', not found);
end
$f$;

create or replace function app.document_provenance_of(p_office uuid, p_document uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare r public.document_provenance%rowtype;
begin
  perform app.require_office(p_office);
  select * into r from public.document_provenance where document_id = p_document and office_id = p_office;
  if not found then return null; end if;
  return jsonb_build_object('document_id', r.document_id, 'job_id', r.job_id, 'style_hash', r.style_hash,
                            'style_updated_at', r.style_updated_at, 'design', r.design, 'sources', r.sources);
end
$f$;

-- The made PDF a revision would be a new version of: the latest head the office made in this project.
create or replace function app.made_head_for_revision(p_office uuid, p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare d public.documents%rowtype; v_ver integer; v_base uuid;
begin
  perform app.require_office(p_office);
  select * into d
    from public.documents x
   where x.office_id = p_office and x.project_id = p_project and x.origin = 'made'
     and x.mime_type = 'application/pdf' and x.superseded_by is null and x.state in ('draft', 'approved')
   order by x.created_at desc, x.document_id desc
   limit 1;
  if not found then return null; end if;
  v_base := app.document_base(p_office, d.document_id);
  if v_base <> d.document_id then
    -- a pending draft revision: it is the version after the approved head it was written against
    v_ver := app.document_next_number(p_office, v_base);
  else
    v_ver := app.document_number(p_office, d.document_id, d.document_id);
  end if;
  return jsonb_build_object('document_id', d.document_id, 'title', d.title, 'state', d.state,
                            'version', coalesce(v_ver, 1), 'produced_by_job', d.produced_by_job, 'base_id', v_base);
end
$f$;

create or replace function app.document_revise_made(p_office uuid, p_head uuid, p_new uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  h public.documents%rowtype;
  b public.documents%rowtype;
  y public.documents%rowtype;
  v_base uuid;
  v_head uuid;
  v_ver integer;
begin
  perform app.require_office(p_office);
  select * into h from public.documents where document_id = p_head and office_id = p_office for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'there is no document with that id'); end if;
  select * into y from public.documents where document_id = p_new and office_id = p_office for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'the revised document does not exist'); end if;
  if h.origin <> 'made' or y.origin <> 'made' then
    return jsonb_build_object('ok', false, 'error', 'only a document the office made is revised this way');
  end if;
  if h.document_id = y.document_id then
    return jsonb_build_object('ok', false, 'error', 'a document cannot be its own next version');
  end if;
  if h.project_id is distinct from y.project_id then
    return jsonb_build_object('ok', false, 'error', 'the next version must be in the same project');
  end if;
  -- The head may be a pending draft the last revision made; the revision is written against the approved base it hangs from.
  v_base := app.document_base(p_office, p_head);
  select * into b from public.documents where document_id = v_base and office_id = p_office for update;
  if b.superseded_by = y.document_id then
    v_ver := app.document_number(p_office, y.document_id, y.document_id);
    return jsonb_build_object('ok', true, 'already', true, 'document_id', y.document_id, 'current_id', y.document_id, 'version', v_ver);
  end if;
  if b.superseded_by is not null then
    select l.document_id into v_head from app.document_lineage(p_office, p_head) l where l.is_head limit 1;
    return jsonb_build_object('ok', false, 'error', 'that is not the latest version of this document', 'current_id', v_head);
  end if;
  if y.superseded_by is not null or exists (select 1 from public.documents x where x.superseded_by = y.document_id and x.office_id = p_office) then
    return jsonb_build_object('ok', false, 'error', 'that document already has version history of its own');
  end if;
  if exists (select 1 from public.document_version_notes z where z.document_id = y.document_id and z.office_id = p_office) then
    v_ver := coalesce(app.document_number(p_office, b.document_id, y.document_id), app.document_next_number(p_office, b.document_id));
    return jsonb_build_object('ok', true, 'already', true, 'document_id', y.document_id, 'previous_id', b.document_id,
                              'pending_id', y.document_id, 'current_id', b.document_id, 'version', v_ver, 'state', y.state);
  end if;

  if b.state = 'approved' then
    -- v4 from approved v3 is a DRAFT beside v3. The office never approves; v3 stays current and listed.
    v_ver := app.document_next_number(p_office, b.document_id);
    perform app.document_pending_attach(p_office, b.document_id, y.document_id, p_note, 'job');
    return jsonb_build_object('ok', true, 'document_id', y.document_id, 'previous_id', b.document_id, 'version', v_ver,
                              'pending_id', y.document_id, 'current_id', b.document_id, 'state', y.state);
  end if;
  if b.state <> 'draft' then
    return jsonb_build_object('ok', false, 'error', format('a %s document is not revised; it is not the current one', b.state));
  end if;
  perform app.document_version_link(p_office, b.document_id, y.document_id, 'adopted', null, p_note, 'job');
  v_ver := app.document_number(p_office, y.document_id, y.document_id);
  return jsonb_build_object('ok', true, 'document_id', y.document_id, 'previous_id', b.document_id, 'version', v_ver, 'current_id', y.document_id);
end
$f$;

revoke all on function
  app.style_stamp(uuid, uuid),
  app.document_provenance_record(uuid, uuid, uuid, text, timestamptz, jsonb, jsonb),
  app.document_provenance_of(uuid, uuid),
  app.made_head_for_revision(uuid, uuid),
  app.document_revise_made(uuid, uuid, uuid, text)
  from public, anon, authenticated;

commit;
