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
-- ## The honest part about drafts
--
-- A document the office makes is a DRAFT (the review gate, #28), and 0900's versioning refuses anything not approved,
-- and the project list shows only approved documents. So a draft report cannot be versioned through
-- hq_document_new_version. `document_revise_made`:
--   - head APPROVED  -> delegates to hq_document_new_version (the new PDF becomes the approved head; the old one is
--     archived and still listed under versions; rollback restores it as a new version),
--   - head still DRAFT -> links the chain with the same document_version_link and leaves the new version a DRAFT:
--     the office never approves its own work that nobody has reviewed. Review still decides what the project shows.
-- Either way nothing is deleted and the call is idempotent on the new document.
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
declare d public.documents%rowtype; v_ver integer;
begin
  perform app.require_office(p_office);
  select * into d
    from public.documents x
   where x.office_id = p_office and x.project_id = p_project and x.origin = 'made'
     and x.mime_type = 'application/pdf' and x.superseded_by is null and x.state in ('draft', 'approved')
   order by x.created_at desc, x.document_id desc
   limit 1;
  if not found then return null; end if;
  select l.version into v_ver from app.document_lineage(p_office, d.document_id) l where l.document_id = d.document_id;
  return jsonb_build_object('document_id', d.document_id, 'title', d.title, 'state', d.state,
                            'version', coalesce(v_ver, 1), 'produced_by_job', d.produced_by_job);
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
  y public.documents%rowtype;
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
  if h.superseded_by = y.document_id then
    select l.version into v_ver from app.document_lineage(p_office, y.document_id) l where l.document_id = y.document_id;
    return jsonb_build_object('ok', true, 'already', true, 'document_id', y.document_id, 'current_id', y.document_id, 'version', v_ver);
  end if;
  if h.superseded_by is not null then
    select l.document_id into v_head from app.document_lineage(p_office, p_head) l where l.is_head limit 1;
    return jsonb_build_object('ok', false, 'error', 'that is not the latest version of this document', 'current_id', v_head);
  end if;
  if y.superseded_by is not null or exists (select 1 from public.documents x where x.superseded_by = y.document_id and x.office_id = p_office) then
    return jsonb_build_object('ok', false, 'error', 'that document already has version history of its own');
  end if;

  if h.state = 'approved' then
    return app.hq_document_new_version(p_office, p_head, null, p_new, p_note, 'job', true);
  end if;
  if h.state <> 'draft' then
    return jsonb_build_object('ok', false, 'error', format('a %s document is not revised; it is not the current one', h.state));
  end if;
  perform app.document_version_link(p_office, p_head, p_new, 'adopted', null, p_note, 'job');
  select l.version into v_ver from app.document_lineage(p_office, p_new) l where l.document_id = p_new;
  return jsonb_build_object('ok', true, 'document_id', p_new, 'previous_id', p_head, 'version', v_ver, 'current_id', p_new);
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
