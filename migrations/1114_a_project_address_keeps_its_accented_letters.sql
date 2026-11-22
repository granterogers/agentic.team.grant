-- 1114 — a project's address keeps the letters of its name (FUN-12, stress test of 21 November 2026)
--
-- app.hq_create_project built the slug with regexp_replace(lower(name), '[^a-z0-9]+', '-'), which DROPS every accented
-- letter: "Café Øresund" became "caf-resund". The slug is the project's address, so the name the person typed was lost
-- from the one place it had to read correctly.
--
-- app.address_stem folds the accents to their base letters first ("café" -> "cafe", "Øresund" -> "oresund", "straße" ->
-- "strasse", "œuvre" -> "oeuvre"), then applies the same non-alphanumeric rule as before. The function is replaced in
-- full, with the same signature, so the gateway and the public wrapper are unchanged. Existing projects keep their slugs:
-- this changes only projects created from now on.

create or replace function app.address_stem(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    translate(
      replace(replace(replace(lower(coalesce(p_text, '')), 'œ', 'oe'), 'æ', 'ae'), 'ß', 'ss'),
      'àáâãäåçèéêëìíîïñòóôõöøùúûüýÿ',
      'aaaaaaceeeeiiiinoooooouuuuyy'
    ),
    '[^a-z0-9]+', '-', 'g'
  )
$$;

comment on function app.address_stem(text) is
  'The address stem of a name: accents folded to base letters, lower case, runs of other characters become a hyphen (FUN-12).';

create or replace function app.hq_create_project(p_office uuid, p_name text, p_connector text, p_ref text, p_display text DEFAULT NULL::text, p_force boolean DEFAULT false, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_slug   text;
  v_prefix text;
  v_id     uuid;
  v_n      integer := 0;
  v_near   jsonb;
  v_refusal text;
begin
  perform app.require_office(p_office);
  -- A test member makes only a test project; nobody unknown at all (0614's rule on this door).
  if btrim(coalesce(p_by, '')) <> '' then
    v_refusal := app.authority_refusal(btrim(p_by), null, null);
    if v_refusal is not null and app.principal_kind(p_by) <> 'harness' then
      return jsonb_build_object('error', v_refusal);
    end if;
  end if;
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('error', 'a project needs a name');
  end if;
  if coalesce(trim(p_ref), '') = '' then
    return jsonb_build_object(
      'error', 'a project needs at least one source: a notebook or a Notion database'
    );
  end if;
  if p_connector not in ('notebooklm', 'notion', 'upload', 'github') then
    return jsonb_build_object('error', format('%L is not a connector', p_connector));
  end if;

  if not p_force then
    select jsonb_agg(jsonb_build_object(
             'project_id', r.project_id, 'slug', r.slug, 'name', r.name,
             'confidence', r.confidence, 'how', r.how) order by r.confidence desc)
      into v_near
      from app.resolve_project_by_name(p_office, p_name) r
     where r.confidence >= 0.55;

    if v_near is not null then
      return jsonb_build_object(
        'needs_confirmation', true,
        'candidates', v_near,
        'question', format(
          'There is already something by that name. Did you mean one of these, '
          'or is %L genuinely new?', trim(p_name))
      );
    end if;
  end if;

  v_slug := left(trim(both '-' from app.address_stem(p_name)), 60);
  if v_slug = '' then v_slug := 'project'; end if;
  v_prefix := left(v_slug, 48);

  while exists (select 1 from public.projects where slug = v_slug and office_id = p_office) loop
    v_n := v_n + 1;
    v_slug := left(v_prefix, 56) || '-' || v_n::text;
    if v_n > 50 then
      return jsonb_build_object('error', 'could not find a free slug for that name');
    end if;
  end loop;

  insert into public.projects (office_id, slug, name, channel_prefix, status, icon)
  values (p_office, v_slug, trim(p_name), v_prefix, 'active', app.icon_for_name(p_name))
  returning project_id into v_id;

  insert into public.project_attachments
    (project_id, connector, external_ref, display_name, role, ref_kind)
  values (v_id, p_connector, trim(p_ref),
          coalesce(nullif(trim(coalesce(p_display, '')), ''), trim(p_name)), 'source',
          case p_connector when 'notebooklm' then 'notebook'
                           when 'github' then 'repository'
                           when 'notion' then 'database' end);

  perform app.add_project_alias(p_office, v_id, trim(p_name), 'name', 1.0);
  -- He made this project, so its normal channel is part of what he asked for - recorded, durably, with who.
  perform app.record_channel_authority(p_office, v_id, p_by, null);

  return jsonb_build_object(
    'project_id', v_id, 'slug', v_slug, 'name', trim(p_name),
    'needs_you', case when p_connector <> 'notion'
                 then 'a Notion Teamspace, which only you can create' end
  );
end;
$function$;
revoke all on function app.hq_create_project(uuid, text, text, text, text, boolean, text) from public, anon, authenticated, service_role;
