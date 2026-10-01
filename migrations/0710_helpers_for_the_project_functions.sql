-- 0710 - the small office-explicit helpers the project functions stand on (multi-user P3, cluster a-projects).
--
-- Four helpers that hq_attach / hq_create_project / hq_project_look call were scoped to nothing: resolving a name,
-- adding a routing phrase, attaching a Drive folder and recording a "not undoable" action all looked across every
-- office, so a person creating a project would have been told that *another office's* project "already means" their
-- words (an existence oracle), and an attach could have been refused because a different office watches a folder.
-- Each gets an office-explicit OVERLOAD here, taking `p_office uuid` FIRST. The old signatures stay: other callers
-- (the worker's routing, the Drive duty, the contact and integration clusters) still use them and the lead drops
-- each when its last caller moves. They are `create or replace` so a sibling cluster that adds the same overload
-- does not collide with this file.
--
-- The alias trigger is the same rule stated at the table: two projects of ONE office may not claim a phrase; a project
-- in another office holding the same words is no conflict, and the refusal never names it.

create or replace function app.undo_none(p_office uuid, p_kind text, p_description text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $f$
declare v_id uuid;
begin
  perform app.require_office(p_office);
  if coalesce(current_setting('app.undoing', true), '') = '1' then
    return null;
  end if;
  insert into public.undoable_actions
    (office_id, correlation_id, kind, description, reversal, status, undo_deadline)
  values (p_office, gen_random_uuid(), p_kind, p_description, '{}'::jsonb, 'not_undoable', null)
  returning action_id into v_id;
  return v_id;
end
$f$;
revoke all on function app.undo_none(uuid, text, text) from public, anon, authenticated, service_role;

create or replace function app.attach_drive_folder(p_office uuid, p_project_id uuid, p_url text, p_name text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  fid      text;
  existing public.project_attachments%rowtype;
  made     public.project_attachments%rowtype;
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  fid := app.folder_id_from(p_url);
  if fid is null then
    return jsonb_build_object(
      'error', 'that does not look like a Drive folder link',
      'hint', 'Open the folder in Drive and copy the address bar — it looks '
              || 'like https://drive.google.com/drive/folders/…');
  end if;

  if not exists (select 1 from public.projects where project_id = p_project_id and office_id = p_office) then
    return jsonb_build_object('error', 'no such project');
  end if;

  select a.* into existing from public.project_attachments a
    join public.projects pr on pr.project_id = a.project_id and pr.office_id = p_office
   where a.connector = 'drive' and a.external_ref = fid and a.enabled;
  if found and existing.project_id <> p_project_id then
    return jsonb_build_object(
      'error', 'that folder is already watched by another project',
      'project_id', existing.project_id);
  end if;

  insert into public.project_attachments
    (project_id, connector, external_ref, display_name, external_url, role, ref_kind, enabled)
  values
    (p_project_id, 'drive', fid,
     coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Drive folder'),
     'https://drive.google.com/drive/folders/' || fid,
     'source', 'folder', true)
  on conflict do nothing
  returning * into made;

  if made.attachment_id is null then
    select * into made from public.project_attachments
     where project_id = p_project_id and connector = 'drive' and external_ref = fid;
  end if;

  insert into public.drive_watch (attachment_id, folder_id)
  values (made.attachment_id, fid)
  on conflict (attachment_id) do nothing;

  -- `wanted`, the word this table already uses. See the header.
  insert into public.project_connector_choices
    (project_id, connector, choice, reason, decided_by)
  values (p_project_id, 'drive', 'wanted', 'Folder attached by ' || p_by, p_by)
  on conflict (project_id, connector) do update
     set choice = 'wanted', reason = excluded.reason, decided_by = excluded.decided_by,
         decided_at = app.now_utc();

  return jsonb_build_object(
    'attachment_id', made.attachment_id,
    'folder_id', fid,
    'url', made.external_url);
end;
$function$;
revoke all on function app.attach_drive_folder(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;

create or replace function app.resolve_project_by_name(p_office uuid, p_text text, p_include_fixtures boolean DEFAULT false)
 RETURNS TABLE(project_id uuid, slug text, name text, confidence numeric, how text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with asked as (
    select app.normalise_name(p_text) as n
  ),
  live as (
    -- One place the fixture rule is applied, rather than four.
    --
    -- The flag widens this set and nothing else, so every branch below keeps
    -- scoring exactly as it did. It defaults to false, so every existing
    -- caller - and every message Grant sends - resolves against precisely
    -- the same rows as before.
    select p.* from public.projects p
     where p.office_id = app.require_office(p_office)
       and p.status = 'active'
       and (p_include_fixtures or not p.is_fixture)
  ),
  scored as (
    select p.project_id, p.slug, p.name, 1.00::numeric as confidence, 'slug'::text as how
      from live p
     cross join asked a
     where a.n is not null and app.normalise_name(p.slug) = a.n

    union all

    select p.project_id, p.slug, p.name,
           least(0.99, 0.90 + (al.confidence * 0.09))::numeric,
           case al.source when 'grant' then 'you call it that'
                          when 'name' then 'its name'
                          when 'slug' then 'its slug'
                          else 'a name we picked up' end
      from public.project_aliases al
      join live p on p.project_id = al.project_id
     cross join asked a
     where a.n is not null and al.normalised = a.n

    union all

    -- The name inside a sentence (0156).
    select p.project_id, p.slug, p.name,
           least(0.95, 0.86 + (al.confidence * 0.09))::numeric,
           case al.source when 'grant' then 'you called it that, in what you said'
                          when 'name' then 'its name, in what you said'
                          else 'a name we know, in what you said' end
      from public.project_aliases al
      join live p on p.project_id = al.project_id
     cross join asked a
     where a.n is not null
       and length(al.normalised) >= 4
       and al.normalised <> a.n
       and a.n ~ ('\m' || regexp_replace(al.normalised, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M')

    union all

    select p.project_id, p.slug, p.name,
           (0.40 + (0.45 * greatest(
              extensions.similarity(app.normalise_name(p.name), a.n),
              coalesce((select max(extensions.similarity(al2.normalised, a.n))
                          from public.project_aliases al2
                         where al2.project_id = p.project_id), 0),
              coalesce(extensions.similarity(app.normalise_name(coalesce(p.description, '')), a.n), 0) * 0.6,
              coalesce(extensions.similarity(app.normalise_name(coalesce(p.purpose, '')), a.n), 0) * 0.6
           )))::numeric,
           'a close match on the name'::text
      from live p
     cross join asked a
     where a.n is not null
       and greatest(
             extensions.similarity(app.normalise_name(p.name), a.n),
             coalesce((select max(extensions.similarity(al3.normalised, a.n))
                         from public.project_aliases al3
                        where al3.project_id = p.project_id), 0),
             coalesce(extensions.similarity(app.normalise_name(coalesce(p.description, '')), a.n), 0) * 0.6,
             coalesce(extensions.similarity(app.normalise_name(coalesce(p.purpose, '')), a.n), 0) * 0.6
           ) >= 0.34
  )
  select distinct on (s.project_id)
         s.project_id, s.slug, s.name, round(s.confidence, 3), s.how
    from scored s
   order by s.project_id, s.confidence desc
$function$;
revoke all on function app.resolve_project_by_name(uuid, text, boolean) from public, anon, authenticated, service_role;

create or replace function app.add_project_alias(p_office uuid, p_project_id uuid, p_alias text, p_source text DEFAULT 'grant'::text, p_confidence numeric DEFAULT 1.0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_norm  text := app.normalise_name(p_alias);
  v_owner record;
  v_from  record;
begin
  perform app.require_office(p_office);
  if v_norm is null then
    return jsonb_build_object('error', 'that is not a name');
  end if;
  if not exists (select 1 from public.projects where project_id = p_project_id and office_id = p_office) then
    return jsonb_build_object('error', 'no such project');
  end if;

  /*
    Checked before inserting rather than caught after, so the answer can name
    the project that already holds the phrase. A unique violation tells the
    caller that something is wrong and not which thing.

    `status <> 'archived'` since 0293, matching `app.alias_is_free_among_active`
    exactly. Without it this refused on behalf of retired projects the trigger
    had already stopped protecting, and 0282's release of 561 phrases could
    never actually happen.
  */
  select p.project_id, p.name into v_owner
    from public.project_aliases al
    join public.projects p on p.project_id = al.project_id
   where al.normalised = v_norm
     and al.project_id <> p_project_id
     and p.office_id = p_office
     and p.status <> 'archived';

  if found then
    return jsonb_build_object(
      'error', format('%L already means %s', p_alias, v_owner.name),
      'conflicts_with', v_owner.project_id
    );
  end if;

  /*
    An ARCHIVED project may still hold this phrase, and taking it is allowed —
    that is the whole point of 0282. But it is worth saying so: a phrase
    quietly changing which project it routes to is the ambiguity #44 was about,
    and the caller should be able to see it rather than discover it later.
  */
  select p.name into v_from
    from public.project_aliases al
    join public.projects p on p.project_id = al.project_id
   where al.normalised = v_norm
     and al.project_id <> p_project_id
     and p.office_id = p_office
     and p.status = 'archived'
   limit 1;

  insert into public.project_aliases (project_id, alias, source, confidence)
  values (p_project_id, btrim(p_alias), p_source, p_confidence)
  on conflict (project_id, normalised)
    do update set source = excluded.source,
                  confidence = greatest(public.project_aliases.confidence, excluded.confidence);

  return jsonb_build_object('ok', true, 'alias', btrim(p_alias), 'project_id', p_project_id)
    || case when v_from.name is null then '{}'::jsonb
            else jsonb_build_object('taken_from_archived', v_from.name) end;
end;
$function$;
revoke all on function app.add_project_alias(uuid, uuid, text, text, numeric) from public, anon, authenticated, service_role;

-- The trigger that makes a routing phrase belong to one project is a rule WITHIN an office: another office's project
-- holding the same words is not a conflict, and the refusal must never name another office's project.
create or replace function app.alias_is_free_among_active()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_holder text;
begin
  select p.slug into v_holder
    from public.project_aliases a
    join public.projects p on p.project_id = a.project_id
    join public.projects np on np.project_id = new.project_id and np.office_id = p.office_id
   where a.normalised = new.normalised
     and a.project_id <> new.project_id
     and p.status <> 'archived'
   limit 1;

  if v_holder is not null then
    raise exception 'the phrase %L already routes to %', new.normalised, v_holder
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$function$;
