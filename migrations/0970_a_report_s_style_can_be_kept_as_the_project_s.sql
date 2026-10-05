begin;

-- ---------------------------------------------------------------------------
-- 0970 - "I love this report. Save this as this project's report style."  (HQ-STYLE-013)
--
-- ## What is real, and what is not
--
-- NOTHING is extracted from a PDF. A report the office made was made FROM a resolved style (0923) with a design chosen
-- over it (0940), and both are known exactly at the moment it is rendered. 0940 recorded only a HASH of that style, so
-- the style itself could not be recovered. This migration records the style the report was actually set in, and adds
-- the one move that is honest about it: copy that recorded style into the project's own profile.
--
--   - document_provenance.style_snapshot: the resolved profile (office defaults with the project's fields over them)
--     with the design choices (title page, density) laid over its formatting - what the report LOOKED like. Written
--     once with the rest of the provenance row, by the artifact handler. NULL for a report made before this
--     migration: such a report has no style to save and the move says so and changes nothing.
--   - app.style_adopt_from_document: replaces the project's profile with the snapshot and records where it came from
--     (source.kind = saved_from_document, source.document_id - 0923 reserved exactly this). It asks first: when the
--     project already has a style of its own and p_confirm is not true it changes nothing and says what would be
--     replaced. A logo the snapshot names that this project does not hold is DROPPED and said so, never stored.
--
-- 0940's function gains a parameter. `create or replace` would leave the old seven-argument function beside the new
-- one and calls would become ambiguous, so the old signature is dropped by name. The new parameter defaults to null,
-- so a caller that does not pass it (an older worker) still works and simply records no snapshot.
--
-- Closed doors: no grant on the app functions. Public wrappers for the page's door only: the channel is a fact about
-- the door and is written here, never sent.
-- ---------------------------------------------------------------------------

alter table public.document_provenance
  add column style_snapshot jsonb,
  add constraint document_provenance_snapshot_is_object
    check (style_snapshot is null or jsonb_typeof(style_snapshot) = 'object');

comment on column public.document_provenance.style_snapshot is
  'The resolved style the report was set in, with its design choices over formatting: what it looked like. NULL = made before 0970, so there is no style to save from it. Never extracted from the PDF.';

drop function app.document_provenance_record(uuid, uuid, uuid, text, timestamptz, jsonb, jsonb);

create function app.document_provenance_record(
  p_office uuid, p_document uuid, p_job uuid, p_style_hash text, p_style_updated_at timestamptz,
  p_design jsonb, p_sources jsonb, p_style_snapshot jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare d public.documents%rowtype; v_snap jsonb := p_style_snapshot;
begin
  perform app.require_office(p_office);
  select * into d from public.documents where document_id = p_document and office_id = p_office;
  if not found then return jsonb_build_object('ok', false, 'error', 'there is no document with that id'); end if;
  if d.origin <> 'made' then
    return jsonb_build_object('ok', false, 'error', 'provenance is kept for documents the office made');
  end if;
  -- A snapshot that is not a valid profile is not stored: losing the snapshot must never lose the provenance row.
  if v_snap is not null and (jsonb_typeof(v_snap) <> 'object' or app.style_profile_problems(v_snap) is not null) then
    v_snap := null;
  end if;
  insert into public.document_provenance
    (document_id, office_id, job_id, style_hash, style_updated_at, design, sources, style_snapshot)
  values (p_document, p_office, p_job, nullif(btrim(coalesce(p_style_hash, '')), ''), p_style_updated_at,
          coalesce(p_design, '{}'::jsonb), coalesce(p_sources, '[]'::jsonb), v_snap)
  on conflict (document_id) do nothing;
  return jsonb_build_object('ok', true, 'document_id', p_document, 'snapshot', v_snap is not null);
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
                            'style_updated_at', r.style_updated_at, 'design', r.design, 'sources', r.sources,
                            'has_provenance', true, 'has_style_snapshot', r.style_snapshot is not null);
end
$f$;

create or replace function app.style_adopt_from_document(
  p_office uuid, p_slug text, p_document uuid, p_confirm boolean default false,
  p_channel text default null, p_by text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
  v_project uuid; d public.documents%rowtype; v_snap jsonb; v_found boolean; v_profile jsonb;
  v_existing jsonb; v_has boolean := false; v_dropped text[] := '{}'; v_problem text; v_keys text[];
  v_new jsonb;
begin
  perform app.require_office(p_office);
  if v_slug is null then return jsonb_build_object('error', 'say which project this style is for'); end if;
  select project_id into v_project from public.projects
   where office_id = p_office and slug = v_slug and status <> 'archived';
  if v_project is null then return jsonb_build_object('error', format('no active project called %L', v_slug)); end if;

  select * into d from public.documents where document_id = p_document and office_id = p_office;
  if not found then return jsonb_build_object('error', 'there is no report with that id'); end if;
  if d.origin <> 'made' then
    return jsonb_build_object('error', 'only a report the office made has a style to save');
  end if;
  if d.project_id is distinct from v_project then
    return jsonb_build_object('error', 'that report belongs to a different project, so its style is not saved here');
  end if;

  select style_snapshot, true into v_snap, v_found from public.document_provenance
   where document_id = p_document and office_id = p_office;
  if not coalesce(v_found, false) or v_snap is null then
    return jsonb_build_object('error',
      'This report was made before its style was recorded, so there is no style to save from it. Nothing was changed. A report made from now on can be saved.',
      'no_snapshot', true);
  end if;

  v_profile := v_snap - 'source';
  -- A logo this project does not hold is not stored: say so instead.
  if v_profile ? 'logo_document_id' then
    if jsonb_typeof(v_profile -> 'logo_document_id') <> 'string'
       or not exists (select 1 from public.documents l
                       where l.document_id::text = (v_profile ->> 'logo_document_id')
                         and l.office_id = p_office and l.project_id = v_project) then
      v_profile := v_profile - 'logo_document_id';
      v_dropped := array_append(v_dropped, 'logo_document_id');
    end if;
  end if;
  v_new := v_profile || jsonb_build_object('source', jsonb_build_object('kind', 'saved_from_document', 'document_id', p_document));
  v_problem := app.style_profile_problems(v_new);
  if v_problem is not null then
    return jsonb_build_object('error', 'the style recorded with this report is no longer acceptable: ' || v_problem);
  end if;

  select profile, true into v_existing, v_has from public.style_profiles
   where office_id = p_office and scope = 'project' and project_id = v_project;
  if coalesce(v_has, false) then
    if (v_existing - 'source') = v_profile then
      return app.hq_style_get(p_office, v_slug) || jsonb_build_object('ok', true, 'unchanged', true,
        'message', 'This project already has exactly this style.');
    end if;
    if not coalesce(p_confirm, false) then
      select coalesce(array_agg(k order by k), '{}') into v_keys from jsonb_object_keys(v_existing - 'source') k;
      return jsonb_build_object('ok', false, 'needs_confirmation', true, 'replaces', to_jsonb(v_keys),
        'message', 'This project already has a style of its own. Saving this report''s style replaces it. Nothing has been changed yet.');
    end if;
    update public.style_profiles set profile = v_new, updated_at = app.now_utc(),
           updated_by = nullif(btrim(coalesce(p_by, '')), '')
     where office_id = p_office and scope = 'project' and project_id = v_project;
  else
    insert into public.style_profiles (office_id, scope, project_id, profile, updated_by)
    values (p_office, 'project', v_project, v_new, nullif(btrim(coalesce(p_by, '')), ''));
  end if;

  perform set_config('app.via', coalesce(nullif(btrim(coalesce(p_channel, '')), ''), ''), true);
  perform app.append_event(p_office, gen_random_uuid(), 'user', coalesce(nullif(btrim(coalesce(p_by, '')), ''), app.office_actor(p_office)),
                           'style', 'style.updated', false, v_project, null, null,
                           left(format('saved the style of a report as the project style (%s)', coalesce(d.title, 'a report')), 1000));
  return app.hq_style_get(p_office, v_slug) || jsonb_build_object('ok', true, 'adopted', true,
    'replaced_existing', coalesce(v_has, false), 'dropped', to_jsonb(v_dropped));
end
$f$;

-- ---- public wrappers: the page's door ---------------------------------------

create or replace function public.hq_style_adopt_from_document(
  p_office uuid, p_slug text, p_document uuid, p_confirm boolean default false, p_by text default null)
returns jsonb language sql security definer set search_path = ''
as $f$ select app.style_adopt_from_document(p_office, p_slug, p_document, p_confirm, 'teamhq', p_by) $f$;

create or replace function public.hq_document_provenance(p_office uuid, p_document_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $f$ select coalesce(app.document_provenance_of(p_office, p_document_id), jsonb_build_object('has_provenance', false)) $f$;

commit;
