begin;

-- ---------------------------------------------------------------------------
-- 0923 - style profiles: an office has a house style and a project may override it
--
-- Grant: a report or a deck the team produces should look like HIS - his colours, his typefaces, his way of opening a
-- document - and a project (a client, a campaign) may differ from the office default in some fields and inherit the
-- rest.
--
-- ## What this is, and is not
--
-- STORAGE, RESOLUTION AND A VALIDATOR. A person writes a profile (the Style page, or an assistant on his behalf, or
-- "save the style of this document" - which records WHERE the profile came from and nothing more). There is NO
-- automatic extraction of a style from a document: a profile is what somebody said it is. `source` says which, so a
-- profile that claims to have come from a document names that document and the claim can be checked; nothing here
-- reads a document's pixels, fonts or colours.
--
-- ## Inheritance, field by field
--
-- `app.hq_style_get` returns the RESOLVED profile: the office's, with the project's fields laid over it. The merge is
-- per FIELD, not per profile: a project that sets only `palette.primary` keeps the office's typography, tone and the
-- rest, and `inherited_from` says, for every field in the result, whether it came from the `project` or the `office`.
-- Arrays (preferred sections, chart colours) replace, never concatenate: two lists spliced are neither of the lists
-- anybody wrote.
--
-- ## What the renderer can honour
--
-- `typography` is limited to the faces `src/artifacts/metrics.ts` has measured widths for: the Helvetica family and
-- the Times family. A profile naming any other font is refused at write time - not accepted and then silently drawn in
-- something else, which is a style the document does not have. Colours are `#rrggbb`. A logo is a reference to a
-- document the office already holds; the PDF writer cannot embed an image yet, so the profile can carry it and the
-- renderer says it did not draw it.
--
-- Written once, validated in one place (`app.style_profile_problems`, enforced by a CHECK on the table so no writer
-- can bypass it); `src/artifacts/style.ts` restates the SAME vocabulary for the renderer and a unit test compares the
-- two so they cannot drift apart.
-- ---------------------------------------------------------------------------

create or replace function app.style_font(p_name text)
returns text
language sql
immutable
set search_path = ''
as $f$
  select case lower(btrim(coalesce(p_name, '')))
    when 'helvetica' then 'Helvetica' when 'arial' then 'Helvetica' when 'sans' then 'Helvetica' when 'sans-serif' then 'Helvetica'
    when 'times' then 'Times' when 'times new roman' then 'Times' when 'serif' then 'Times'
  end
$f$;

-- NULL when the profile is acceptable, otherwise the first thing wrong with it, in words a person can act on.
create or replace function app.style_profile_problems(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $f$
declare
  k text; v jsonb; e record;
  top_keys constant text[] := array['palette','typography','logo_document_id','tone','terminology','structure',
                                    'formatting','chart','image','audience','instructions','source'];
  palette_keys constant text[] := array['primary','accent','ink','paper','wash','rule','muted'];
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'a style profile is an object'; end if;
  if length(p::text) > 20000 then return 'that profile is too large (keep it under 20,000 characters)'; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (top_keys)) then return format('%L is not part of a style profile', k); end if;
  end loop;

  v := p -> 'palette';
  if v is not null then
    if jsonb_typeof(v) <> 'object' then return 'palette is an object of colours'; end if;
    for e in select key, value from jsonb_each(v) loop
      if not (e.key = any (palette_keys)) then return format('palette.%s is not a colour this office draws with (%s)', e.key, array_to_string(palette_keys, ', ')); end if;
      if jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') !~ '^#[0-9a-f]{6}$' then
        return format('palette.%s must be a colour like #1f5a85', e.key);
      end if;
    end loop;
  end if;

  v := p -> 'typography';
  if v is not null then
    if jsonb_typeof(v) <> 'object' then return 'typography is an object with heading and body'; end if;
    for e in select key, value from jsonb_each(v) loop
      if e.key not in ('heading', 'body') then return format('typography.%s is not a role (heading, body)', e.key); end if;
      if jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') not in ('Helvetica', 'Times') then
        return format('typography.%s must be Helvetica or Times - the faces a report can be set in', e.key);
      end if;
    end loop;
  end if;

  if p ? 'logo_document_id' and (jsonb_typeof(p -> 'logo_document_id') <> 'string'
     or (p ->> 'logo_document_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    return 'logo_document_id must be the id of a document';
  end if;

  foreach k in array array['tone', 'audience'] loop
    if p ? k and (jsonb_typeof(p -> k) <> 'string' or length(p ->> k) > 500) then
      return format('%s is text of at most 500 characters', k);
    end if;
  end loop;
  if p ? 'instructions' and (jsonb_typeof(p -> 'instructions') <> 'string' or length(p ->> 'instructions') > 4000) then
    return 'instructions is text of at most 4000 characters';
  end if;

  v := p -> 'terminology';
  if v is not null then
    if jsonb_typeof(v) <> 'object' or (select count(*) from jsonb_object_keys(v)) > 50 then
      return 'terminology is an object of at most 50 entries';
    end if;
    for e in select key, value from jsonb_each(v) loop
      if jsonb_typeof(e.value) <> 'string' or length(e.key) > 200 or length(e.value #>> '{}') > 200 then
        return 'terminology maps a word to the word to use instead, each under 200 characters';
      end if;
    end loop;
  end if;

  v := p -> 'structure';
  if v is not null then
    if jsonb_typeof(v) <> 'object' then return 'structure is an object'; end if;
    for e in select key, value from jsonb_each(v) loop
      if e.key = 'sections' then
        if jsonb_typeof(e.value) <> 'array' or jsonb_array_length(e.value) > 20
           or exists (select 1 from jsonb_array_elements(e.value) s where jsonb_typeof(s) <> 'string' or length(s #>> '{}') > 80) then
          return 'structure.sections is a list of at most 20 section names';
        end if;
      elsif e.key in ('executive_summary', 'sources') then
        if jsonb_typeof(e.value) <> 'boolean' then return format('structure.%s is true or false', e.key); end if;
      else
        return format('structure.%s is not something a report is structured by', e.key);
      end if;
    end loop;
  end if;

  v := p -> 'formatting';
  if v is not null then
    if jsonb_typeof(v) <> 'object' then return 'formatting is an object'; end if;
    for e in select key, value from jsonb_each(v) loop
      if e.key = 'title_page' then
        if (e.value #>> '{}') is distinct from 'standard' and (e.value #>> '{}') is distinct from 'band' then
          return 'formatting.title_page is standard or band';
        end if;
      elsif e.key = 'density' then
        if (e.value #>> '{}') is distinct from 'comfortable' and (e.value #>> '{}') is distinct from 'compact' then
          return 'formatting.density is comfortable or compact';
        end if;
      else
        return format('formatting.%s is not a setting', e.key);
      end if;
    end loop;
  end if;

  v := p -> 'chart';
  if v is not null then
    if jsonb_typeof(v) <> 'object' then return 'chart is an object'; end if;
    for e in select key, value from jsonb_each(v) loop
      if e.key = 'series_colors' then
        if jsonb_typeof(e.value) <> 'array' or jsonb_array_length(e.value) > 8
           or exists (select 1 from jsonb_array_elements(e.value) c where jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^#[0-9a-f]{6}$') then
          return 'chart.series_colors is a list of at most 8 colours like #1f5a85';
        end if;
      elsif e.key = 'note' then
        if jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 300 then return 'chart.note is text under 300 characters'; end if;
      else
        return format('chart.%s is not a setting', e.key);
      end if;
    end loop;
  end if;

  v := p -> 'image';
  if v is not null then
    if jsonb_typeof(v) <> 'object' then return 'image is an object'; end if;
    for e in select key, value from jsonb_each(v) loop
      if e.key not in ('style', 'avoid') or jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 300 then
        return 'image takes style and avoid, each text under 300 characters';
      end if;
    end loop;
  end if;

  v := p -> 'source';
  if v is not null then
    if jsonb_typeof(v) <> 'object' or not (v ? 'kind') or (v ->> 'kind') not in ('manual', 'saved_from_document') then
      return 'source.kind is manual or saved_from_document';
    end if;
    if (v ->> 'kind') = 'saved_from_document'
       and (v ->> 'document_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return 'a profile saved from a document names that document (source.document_id)';
    end if;
  end if;
  return null;
end
$f$;

create table public.style_profiles (
  style_id    uuid primary key default gen_random_uuid(),
  office_id   uuid not null references public.offices (office_id),
  scope       text not null check (scope in ('office', 'project')),
  project_id  uuid,
  profile     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default app.now_utc(),
  updated_at  timestamptz not null default app.now_utc(),
  updated_by  text,
  constraint style_scope_matches_project check ((scope = 'office') = (project_id is null)),
  constraint style_project_in_same_office foreign key (project_id, office_id) references public.projects (project_id, office_id),
  constraint style_profile_is_valid check (app.style_profile_problems(profile) is null)
);
create unique index style_one_office_default on public.style_profiles (office_id) where scope = 'office';
create unique index style_one_per_project on public.style_profiles (project_id) where scope = 'project';

comment on table public.style_profiles is
  'A house style: one office-wide row, and at most one per project overriding it field by field. Resolved by app.hq_style_get. '
  'Nothing is extracted from documents: source records only where a person said it came from.';

create trigger a1_office_write_once
  before update of office_id on public.style_profiles
  for each row execute function app.office_id_is_write_once();

alter table public.style_profiles enable row level security;
revoke all on table public.style_profiles from public, anon, authenticated, service_role;

-- ---- resolution ------------------------------------------------------------

create or replace function app.style_resolve(p_office uuid, p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare
  v_off jsonb := coalesce((select profile from public.style_profiles where office_id = p_office and scope = 'office'), '{}'::jsonb);
  v_pro jsonb := case when p_project is null then '{}'::jsonb
                      else coalesce((select profile from public.style_profiles where office_id = p_office and scope = 'project' and project_id = p_project), '{}'::jsonb) end;
  v_out jsonb := '{}'::jsonb;
  v_from jsonb := '{}'::jsonb;
  k text; s text; sec constant text[] := array['palette', 'typography', 'formatting', 'chart', 'image', 'structure', 'terminology'];
begin
  for k in select distinct x from (select jsonb_object_keys(v_off) x union select jsonb_object_keys(v_pro)) u loop
    if k = any (sec) and jsonb_typeof(v_off -> k) = 'object' and jsonb_typeof(v_pro -> k) = 'object' then
      v_out := v_out || jsonb_build_object(k, (v_off -> k) || (v_pro -> k));
      for s in select distinct y from (select jsonb_object_keys(v_off -> k) y union select jsonb_object_keys(v_pro -> k)) w loop
        v_from := v_from || jsonb_build_object(k || '.' || s, case when (v_pro -> k) ? s then 'project' else 'office' end);
      end loop;
    elsif v_pro ? k then
      v_out := v_out || jsonb_build_object(k, v_pro -> k);
      if k = any (sec) and jsonb_typeof(v_pro -> k) = 'object' then
        for s in select jsonb_object_keys(v_pro -> k) loop v_from := v_from || jsonb_build_object(k || '.' || s, 'project'); end loop;
      else v_from := v_from || jsonb_build_object(k, 'project'); end if;
    else
      v_out := v_out || jsonb_build_object(k, v_off -> k);
      if k = any (sec) and jsonb_typeof(v_off -> k) = 'object' then
        for s in select jsonb_object_keys(v_off -> k) loop v_from := v_from || jsonb_build_object(k || '.' || s, 'office'); end loop;
      else v_from := v_from || jsonb_build_object(k, 'office'); end if;
    end if;
  end loop;
  return jsonb_build_object('profile', v_out, 'inherited_from', v_from,
                            'office_profile', v_off, 'project_profile', case when p_project is null then null else v_pro end);
end
$f$;

create or replace function app.hq_style_get(p_office uuid, p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare v_project uuid; v jsonb; v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
begin
  perform app.require_office(p_office);
  if v_slug is not null then
    select project_id into v_project from public.projects where office_id = p_office and slug = v_slug;
    if v_project is null then return jsonb_build_object('error', format('no project called %L', v_slug)); end if;
  end if;
  v := app.style_resolve(p_office, v_project);
  return jsonb_build_object(
    'scope', case when v_project is null then 'office' else 'project' end,
    'project', v_slug,
    'profile', v -> 'profile',
    'inherited_from', v -> 'inherited_from',
    'office_profile', v -> 'office_profile',
    'project_profile', v -> 'project_profile',
    -- what the page may offer, from the same definition the validator enforces
    'vocabulary', jsonb_build_object(
      'fonts', jsonb_build_array('Helvetica', 'Times'),
      'palette', jsonb_build_array('primary', 'accent', 'ink', 'paper', 'wash', 'rule', 'muted'),
      'title_pages', jsonb_build_array('standard', 'band'),
      'densities', jsonb_build_array('comfortable', 'compact')));
end
$f$;

-- ---- writing ---------------------------------------------------------------

-- Lays a patch over a stored profile. A JSON null removes a key, inside a section as well as at the top.
create or replace function app.style_patch(p_old jsonb, p_patch jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $f$
declare
  out_ jsonb := coalesce(p_old, '{}'::jsonb); k text; v jsonb; s text; sv jsonb;
  sec constant text[] := array['palette', 'typography', 'formatting', 'chart', 'image', 'structure', 'terminology'];
begin
  for k, v in select key, value from jsonb_each(p_patch) loop
    if v = 'null'::jsonb then
      out_ := out_ - k;
    elsif k = any (sec) and jsonb_typeof(v) = 'object' and jsonb_typeof(out_ -> k) = 'object' then
      for s, sv in select key, value from jsonb_each(v) loop
        out_ := jsonb_set(out_, array[k], case when sv = 'null'::jsonb then (out_ -> k) - s else (out_ -> k) || jsonb_build_object(s, sv) end);
      end loop;
    elsif k = any (sec) and jsonb_typeof(v) = 'object' then
      out_ := out_ || jsonb_build_object(k, (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(v) where value <> 'null'::jsonb));
    else
      out_ := out_ || jsonb_build_object(k, v);
    end if;
  end loop;
  -- an emptied section is no section
  for k in select key from jsonb_each(out_) where key = any (sec) and value = '{}'::jsonb loop
    out_ := out_ - k;
  end loop;
  return out_;
end
$f$;

create or replace function app.hq_style_set(
  p_office uuid, p_slug text, p_patch jsonb, p_channel text default null, p_by text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
  v_project uuid; v_old jsonb; v_new jsonb; v_problem text; v_patch jsonb := p_patch; v_doc uuid; k text;
  v_has_row boolean; v_keys text;
begin
  perform app.require_office(p_office);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    return jsonb_build_object('error', 'say what to change: a style patch is an object with at least one field');
  end if;
  if v_slug is not null then
    select project_id into v_project from public.projects where office_id = p_office and slug = v_slug and status <> 'archived';
    if v_project is null then return jsonb_build_object('error', format('no active project called %L', v_slug)); end if;
  end if;
  -- Normalise what has one right spelling, so "Arial" and "#1F5A85" are accepted and stored in the one form the
  -- renderer reads. Anything else is left exactly as sent for the validator to refuse by name.
  if jsonb_typeof(v_patch -> 'typography') = 'object' then
    for k in select key from jsonb_each(v_patch -> 'typography') loop
      if jsonb_typeof(v_patch -> 'typography' -> k) = 'string' and app.style_font(v_patch -> 'typography' ->> k) is not null then
        v_patch := jsonb_set(v_patch, array['typography', k], to_jsonb(app.style_font(v_patch -> 'typography' ->> k)));
      end if;
    end loop;
  end if;
  if jsonb_typeof(v_patch -> 'palette') = 'object' then
    for k in select key from jsonb_each(v_patch -> 'palette') loop
      if jsonb_typeof(v_patch -> 'palette' -> k) = 'string' then
        v_patch := jsonb_set(v_patch, array['palette', k], to_jsonb(lower(btrim(v_patch -> 'palette' ->> k))));
      end if;
    end loop;
  end if;
  -- A document a profile names must be this office's (and, for a project's profile, this project's): an id from
  -- somewhere else is refused, never stored.
  for k in select unnest(array['logo_document_id']) loop
    if jsonb_typeof(v_patch -> k) = 'string' then
      begin v_doc := (v_patch ->> k)::uuid; exception when others then v_doc := null; end;
      if v_doc is null or not exists (select 1 from public.documents d where d.document_id = v_doc and d.office_id = p_office
                                       and (v_project is null or d.project_id = v_project)) then
        return jsonb_build_object('error', k || ' must be a document this ' || case when v_project is null then 'office' else 'project' end || ' holds');
      end if;
    end if;
  end loop;
  if jsonb_typeof(v_patch -> 'source') = 'object' and (v_patch -> 'source' ->> 'kind') = 'saved_from_document' then
    begin v_doc := (v_patch -> 'source' ->> 'document_id')::uuid; exception when others then v_doc := null; end;
    if v_doc is null or not exists (select 1 from public.documents d where d.document_id = v_doc and d.office_id = p_office) then
      return jsonb_build_object('error', 'source.document_id must be a document this office holds');
    end if;
  end if;

  select profile, true into v_old, v_has_row from public.style_profiles
   where office_id = p_office and scope = case when v_project is null then 'office' else 'project' end
     and project_id is not distinct from v_project;
  v_new := app.style_patch(coalesce(v_old, '{}'::jsonb), v_patch);
  -- Nothing left but a source is no profile at all: for a project that is "inherit everything again".
  if (v_new - 'source') = '{}'::jsonb then
    delete from public.style_profiles
     where office_id = p_office and scope = case when v_project is null then 'office' else 'project' end
       and project_id is not distinct from v_project;
    perform set_config('app.via', coalesce(nullif(btrim(coalesce(p_channel, '')), ''), ''), true);
    perform app.append_event(p_office, gen_random_uuid(), 'user', coalesce(nullif(btrim(coalesce(p_by, '')), ''), app.office_actor(p_office)),
                             'style', 'style.cleared', false, v_project, null, null,
                             format('cleared the %s style', case when v_project is null then 'office' else 'project' end));
    return app.hq_style_get(p_office, v_slug) || jsonb_build_object('ok', true, 'cleared', true);
  end if;
  -- a profile that was set by hand says so, unless the person said where it came from
  if not (v_new ? 'source') then v_new := v_new || jsonb_build_object('source', jsonb_build_object('kind', 'manual')); end if;
  v_problem := app.style_profile_problems(v_new);
  if v_problem is not null then return jsonb_build_object('error', v_problem); end if;

  if coalesce(v_has_row, false) then
    update public.style_profiles set profile = v_new, updated_at = app.now_utc(), updated_by = nullif(btrim(coalesce(p_by, '')), '')
     where office_id = p_office and scope = case when v_project is null then 'office' else 'project' end
       and project_id is not distinct from v_project;
  else
    insert into public.style_profiles (office_id, scope, project_id, profile, updated_by)
    values (p_office, case when v_project is null then 'office' else 'project' end, v_project, v_new, nullif(btrim(coalesce(p_by, '')), ''));
  end if;

  -- The ledger says WHICH FIELDS changed and through which door, never the values.
  select string_agg(key, ', ' order by key) into v_keys from jsonb_object_keys(v_patch) key;
  perform set_config('app.via', coalesce(nullif(btrim(coalesce(p_channel, '')), ''), ''), true);
  perform app.append_event(p_office, gen_random_uuid(), 'user', coalesce(nullif(btrim(coalesce(p_by, '')), ''), app.office_actor(p_office)),
                           'style', 'style.updated', false, v_project, null, null,
                           left(format('changed the %s style: %s', case when v_project is null then 'office' else 'project' end, v_keys), 1000));
  return app.hq_style_get(p_office, v_slug) || jsonb_build_object('ok', true);
end
$f$;

-- Takes a field (or the whole scope's profile) back. For a project this is "inherit again".
create or replace function app.hq_style_clear(
  p_office uuid, p_slug text default null, p_field text default null, p_channel text default null, p_by text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
  v_project uuid; v_field text := nullif(btrim(coalesce(p_field, '')), ''); v_row public.style_profiles;
begin
  perform app.require_office(p_office);
  if v_slug is not null then
    select project_id into v_project from public.projects where office_id = p_office and slug = v_slug;
    if v_project is null then return jsonb_build_object('error', format('no project called %L', v_slug)); end if;
  end if;
  select * into v_row from public.style_profiles
   where office_id = p_office and scope = case when v_project is null then 'office' else 'project' end
     and project_id is not distinct from v_project;
  if v_row.style_id is null then
    return app.hq_style_get(p_office, v_slug) || jsonb_build_object('ok', true, 'cleared', false);
  end if;
  if v_field is null then
    delete from public.style_profiles where style_id = v_row.style_id;
  else
    if not (v_row.profile ? v_field) then return jsonb_build_object('error', format('%L is not set here', v_field)); end if;
    if v_row.profile - v_field = '{}'::jsonb or (v_row.profile - v_field) = jsonb_build_object('source', v_row.profile -> 'source') then
      delete from public.style_profiles where style_id = v_row.style_id;
    else
      update public.style_profiles set profile = profile - v_field, updated_at = app.now_utc(),
             updated_by = nullif(btrim(coalesce(p_by, '')), '') where style_id = v_row.style_id;
    end if;
  end if;
  perform set_config('app.via', coalesce(nullif(btrim(coalesce(p_channel, '')), ''), ''), true);
  perform app.append_event(p_office, gen_random_uuid(), 'user', coalesce(nullif(btrim(coalesce(p_by, '')), ''), app.office_actor(p_office)),
                           'style', 'style.cleared', false, v_project, null, null,
                           left(format('cleared %s of the %s style', coalesce(v_field, 'everything'), case when v_project is null then 'office' else 'project' end), 1000));
  return app.hq_style_get(p_office, v_slug) || jsonb_build_object('ok', true, 'cleared', true);
end
$f$;

-- ---- public wrappers: the PAGE's door. The channel is a fact about the door, so it is written here, not sent. ---

create or replace function public.hq_style_get(p_office uuid, p_slug text default null)
returns jsonb language sql stable security definer set search_path = ''
as $f$ select app.hq_style_get(p_office, p_slug) $f$;

create or replace function public.hq_style_set(p_office uuid, p_patch jsonb, p_slug text default null, p_by text default null)
returns jsonb language sql security definer set search_path = ''
as $f$ select app.hq_style_set(p_office, p_slug, p_patch, 'teamhq', p_by) $f$;

create or replace function public.hq_style_clear(p_office uuid, p_slug text default null, p_field text default null, p_by text default null)
returns jsonb language sql security definer set search_path = ''
as $f$ select app.hq_style_clear(p_office, p_slug, p_field, 'teamhq', p_by) $f$;

commit;
