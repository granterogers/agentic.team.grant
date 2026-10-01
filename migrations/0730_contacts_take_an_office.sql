-- 0730 - the contact functions take an office and check every row against it (multi-user P3, cluster c-contacts).
--
-- Before: app.hq_contact_add/_update/_archive/_fields_set/_labels_set/_photo_set, the label writers and
-- app.recoverable_projects read and wrote contacts, labels and archived projects for whoever called. A contact has no
-- office_id of its own (its office is its project's), so "this contact" was found by `contact_id = $1` alone, and the
-- label functions found a label by `owner = 'grant'`, a literal that named one person for every office. A second
-- person's contact list would have been the first person's, and a contact id of another office would have been
-- readable and writable by a guess.
--
-- Now each takes `p_office uuid` FIRST, with no default. A contact is found through app.contact_in_office, which joins
-- the contact to a project OF THAT OFFICE: a contact of another office and a contact that does not exist are both
-- null, and every function answers them with the same sentence ("no such contact"). Labels are carriers: every read
-- and write carries `office_id = p_office`, new labels are owned by app.office_actor(p_office) and not by 'grant',
-- and the per-office name uniqueness of 0662 does the rest. The duplicate checks ("already a contact on this project",
-- "already a label called") only ever see the office's own rows, so the same name or the same email in two offices is
-- two independent contacts.
--
-- hq_contact_photo_set also refuses a storage path that is not under the contact's own project folder or the office's
-- own prefix: the path is where the bytes are, and a path into another office's folder must not be recordable.
--
-- Undo: app.hq_undo is spliced from its LIVE definition and the six contact branches receive the office.
-- app.undo_none gains the office-explicit overload (the old one stays for writers not yet converted), and
-- app.contact_labels gains `(p_office)`; the old `(p_owner text)` stays because app.hq_studio still calls it and is the
-- views cluster's to convert. Old signatures of every function in this file are dropped here.

----------------------------------------------------------------------------------------------------------------------
-- helpers
----------------------------------------------------------------------------------------------------------------------
-- The project a contact belongs to, when - and only when - that project is this office's.
create function app.contact_in_office(p_office uuid, p_contact uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $f$
  select c.project_id
    from public.contacts c
    join public.projects p on p.project_id = c.project_id and p.office_id = p_office
   where c.contact_id = p_contact
$f$;
revoke all on function app.contact_in_office(uuid, uuid) from public, anon, authenticated, service_role;

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
end;
$f$;
revoke all on function app.undo_none(uuid, text, text) from public, anon, authenticated, service_role;

create function app.contact_labels(p_office uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $f$
begin
  perform app.require_office(p_office);
  return (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', l.label_id, 'name', l.name, 'hue', l.hue
                 ) order by l.sort, l.name), '[]'::jsonb)
            from public.contact_labels l
           where l.office_id = p_office);
end
$f$;
revoke all on function app.contact_labels(uuid) from public, anon, authenticated, service_role;

----------------------------------------------------------------------------------------------------------------------
-- the contact writers
----------------------------------------------------------------------------------------------------------------------
create function app.hq_contact_add(p_office uuid, p_project text, p_name text, p_role text DEFAULT NULL::text, p_org text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_website text DEFAULT NULL::text, p_kind text DEFAULT 'person'::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_name    text := btrim(coalesce(p_name, ''));
  v_kind    text := lower(btrim(coalesce(nullif(p_kind, ''), 'person')));
  v         jsonb;
begin
  perform app.require_office(p_office);
  if v_name = '' then
    return jsonb_build_object('error', 'a contact needs a name');
  end if;
  if v_kind not in ('person', 'company', 'collaborator', 'supplier') then
    return jsonb_build_object('error', format(
      '%L is not a kind — it is one of person, company, collaborator, supplier', v_kind));
  end if;

  select project_id into v_project
    from public.projects
   where office_id = p_office
     and slug = p_project and coalesce(status, '') <> 'archived' and not is_fixture;
  if v_project is null then
    return jsonb_build_object('error', format('no dashboard project called %L', p_project));
  end if;

  -- The same name twice on one project is almost always a mistake rather than
  -- twins. The project is this office's (resolved above), so the check never sees another office's contacts:
  -- the same name or the same email in two offices are two independent contacts. Refused with the name in it, so the answer is obvious.
  if exists (select 1 from public.contacts
              where project_id = v_project and lower(btrim(name)) = lower(v_name)) then
    return jsonb_build_object('error', format('%s is already a contact on this project', v_name));
  end if;

  insert into public.contacts (project_id, kind, name, role, org, email, phone,
                               instagram, website, note)
  values (v_project, v_kind, v_name,
          btrim(coalesce(p_role, '')), btrim(coalesce(p_org, '')),
          btrim(coalesce(p_email, '')), btrim(coalesce(p_phone, '')),
          btrim(coalesce(p_instagram, '')), btrim(coalesce(p_website, '')),
          btrim(coalesce(p_note, '')))
  returning jsonb_build_object('id', contact_id, 'name', name, 'kind', kind) into v;

  return v;
end;
$function$;

create function app.hq_contact_archive(p_office uuid, p_contact_id uuid, p_put_away boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_name text;
  v_was  timestamptz;
  v_undo uuid;
  v_project uuid;
begin
  perform app.require_office(p_office);
  v_project := app.contact_in_office(p_office, p_contact_id);
  select name, archived_at into v_name, v_was
    from public.contacts where contact_id = p_contact_id and project_id = v_project;
  if v_project is null or not found then
    return jsonb_build_object('error', 'no such contact');
  end if;

  update public.contacts
     set archived_at = case when p_put_away then coalesce(archived_at, app.now_utc()) else null end
   where contact_id = p_contact_id and project_id = v_project;

  v_undo := app.undo_offer(
    p_office,
    'contact.archive',
    format('%s %s', case when p_put_away then 'Put away' else 'Brought back' end, v_name),
    jsonb_build_object('action', 'contact_archive',
                       'args', jsonb_build_object('p_contact_id', p_contact_id,
                                                  'p_put_away', v_was is not null)));

  return jsonb_build_object('ok', true, 'undo', v_undo, 'archived', p_put_away);
end;
$function$;

create function app.hq_contact_fields_set(p_office uuid, p_contact_id uuid, p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_was  jsonb;
  v_bad  int;
  v_undo uuid;
  v_project uuid;
begin
  perform app.require_office(p_office);
  v_project := app.contact_in_office(p_office, p_contact_id);
  if v_project is null then
    return jsonb_build_object('error', 'no such contact');
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    return jsonb_build_object('error', 'fields must be an array');
  end if;

  select count(*) into v_bad from jsonb_array_elements(p_fields) e
   where jsonb_typeof(e) <> 'object'
      or coalesce(jsonb_typeof(e -> 'label'), 'missing') <> 'string'
      or btrim(coalesce(e ->> 'label', '')) = ''
      or coalesce(jsonb_typeof(e -> 'value'), 'string') <> 'string';
  if v_bad > 0 then
    return jsonb_build_object('error',
      format('%s field(s) are not {label, value} with a label that says something', v_bad));
  end if;

  select fields into v_was from public.contacts where contact_id = p_contact_id and project_id = v_project;
  update public.contacts set fields = p_fields where contact_id = p_contact_id and project_id = v_project;

  v_undo := app.undo_offer(
    p_office,
    'contact.fields',
    format('Changed the fields on %s',
           (select name from public.contacts where contact_id = p_contact_id and project_id = v_project)),
    jsonb_build_object('action', 'contact_fields_set',
                       'args', jsonb_build_object('p_contact_id', p_contact_id,
                                                  'p_fields', v_was)));

  return jsonb_build_object('ok', true, 'undo', v_undo, 'fields', p_fields);
end;
$function$;

create function app.hq_contact_label_add(p_office uuid, p_name text, p_hue text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_hue  text := nullif(btrim(coalesce(p_hue, '')), '');
  v_id   uuid;
begin
  perform app.require_office(p_office);
  if v_name = '' then
    return jsonb_build_object('error', 'a label needs a name');
  end if;

  select label_id into v_id from public.contact_labels
   where office_id = p_office and app.normalise_name(name) = app.normalise_name(v_name);
  if v_id is not null then
    return jsonb_build_object('error', format('there is already a label called %L', v_name));
  end if;

  /*
    The next hue in the ring rather than a random one, matching what the page
    did: `HUES[labels.length % HUES.length]`. Two labels created in a row should
    look different, which a random pick does not guarantee.
  */
  insert into public.contact_labels (office_id, owner, name, hue, sort)
  values (p_office, app.office_actor(p_office), v_name,
          coalesce(v_hue, (array['p-rust', 'p-amber', 'p-moss', 'p-slate', 'p-iris', 'p-plum'])[
            (select count(*) from public.contact_labels where office_id = p_office) % 6 + 1]),
          coalesce((select max(sort) + 1 from public.contact_labels where office_id = p_office), 0))
  returning label_id into v_id;

  return jsonb_build_object('ok', true, 'label', v_id, 'labels', app.contact_labels(p_office));
end;
$function$;

create function app.hq_contact_label_remove(p_office uuid, p_label_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_n int;
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.contact_labels
                  where office_id = p_office and label_id = p_label_id) then
    return jsonb_build_object('error', 'no such label');
  end if;

  select count(*) into v_n
    from public.contact_label_links k
    join public.contact_labels l on l.owner = k.owner and l.label_id = k.label_id and l.office_id = p_office
   where k.label_id = p_label_id;

  -- The links go with it, by the foreign key's cascade.
  delete from public.contact_labels where office_id = p_office and label_id = p_label_id;

  /*
    No undo offered, and that is deliberate rather than an omission.

    #118's rule is that an offer is made only where the inverse is EXACT.
    Recreating the label would give it a new id, so every contact it was on
    stays unlabelled and the reversal silently does less than it says. The
    honest answer is to say so, which `undo_none` is for.
  */
  perform app.undo_none(
    p_office,
    'contact.label_remove',
    format('Deleted a label — putting it back would give it a new id, so the %s '
           || 'contact(s) it was on would stay unlabelled', v_n));

  return jsonb_build_object('ok', true, 'removed_from', v_n, 'undo', null,
                            'labels', app.contact_labels(p_office));
end;
$function$;

create function app.hq_contact_label_rename(p_office uuid, p_label_id uuid, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_was  text;
  v_undo uuid;
begin
  perform app.require_office(p_office);
  if v_name = '' then
    return jsonb_build_object('error', 'a label needs a name');
  end if;

  select name into v_was from public.contact_labels
   where office_id = p_office and label_id = p_label_id;
  if v_was is null then
    return jsonb_build_object('error', 'no such label');
  end if;

  if exists (select 1 from public.contact_labels
              where office_id = p_office and label_id <> p_label_id
                and app.normalise_name(name) = app.normalise_name(v_name)) then
    return jsonb_build_object('error', format('there is already a label called %L', v_name));
  end if;

  update public.contact_labels set name = v_name
   where office_id = p_office and label_id = p_label_id;

  -- The exact inverse, recorded while the previous value is still known (#118).
  v_undo := app.undo_offer(
    p_office,
    'contact.label_rename',
    format('Renamed the label %s to %s', v_was, v_name),
    jsonb_build_object('action', 'contact_label_rename',
                       'args', jsonb_build_object('p_label_id', p_label_id,
                                                  'p_name', v_was)));

  return jsonb_build_object('ok', true, 'undo', v_undo,
                            'labels', app.contact_labels(p_office));
end;
$function$;

create function app.hq_contact_labels_set(p_office uuid, p_contact_id uuid, p_labels jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_ids  uuid[];
  v_was  jsonb;
  v_bad  int;
  v_undo uuid;
  v_project uuid;
begin
  perform app.require_office(p_office);
  v_project := app.contact_in_office(p_office, p_contact_id);
  if v_project is null then
    return jsonb_build_object('error', 'no such contact');
  end if;
  if p_labels is null or jsonb_typeof(p_labels) <> 'array' then
    return jsonb_build_object('error', 'labels must be an array of label ids');
  end if;

  select coalesce(array_agg((e #>> '{}')::uuid), array[]::uuid[]) into v_ids
    from jsonb_array_elements(p_labels) e;

  select count(*) into v_bad from unnest(v_ids) id
   where not exists (select 1 from public.contact_labels
                      where office_id = p_office and label_id = id);
  if v_bad > 0 then
    return jsonb_build_object('error', format('%s of those labels do not exist', v_bad));
  end if;

  select coalesce(jsonb_agg(label_id), '[]'::jsonb) into v_was
    from public.contact_label_links where contact_id = p_contact_id;

  delete from public.contact_label_links where contact_id = p_contact_id;
  -- Each label is taken from the office's own set (its owner comes from the label row), so a label id of
  -- another office cannot be linked even if it were named, and a label named twice is linked once.
  insert into public.contact_label_links (contact_id, owner, label_id)
  select p_contact_id, l.owner, l.label_id
    from public.contact_labels l
   where l.office_id = p_office and l.label_id = any (v_ids);

  update public.contacts set labels_set = true where contact_id = p_contact_id and project_id = v_project;

  v_undo := app.undo_offer(
    p_office,
    'contact.labels',
    format('Changed the labels on %s',
           (select name from public.contacts where contact_id = p_contact_id and project_id = v_project)),
    jsonb_build_object('action', 'contact_labels_set',
                       'args', jsonb_build_object('p_contact_id', p_contact_id,
                                                  'p_labels', v_was)));

  return jsonb_build_object('ok', true, 'undo', v_undo, 'labels', to_jsonb(v_ids));
end;
$function$;

create function app.hq_contact_photo_set(p_office uuid, p_contact_id uuid, p_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_was  text;
  v_name text;
  v_undo uuid;
  v_project uuid;
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  perform app.require_office(p_office);
  v_project := app.contact_in_office(p_office, p_contact_id);
  if v_project is null then
    return jsonb_build_object('error', 'no such contact');
  end if;
  select photo_path, name into v_was, v_name
    from public.contacts where contact_id = p_contact_id and project_id = v_project;

  /*
    A photograph is a storage path, and a storage path is where the BYTES are. Recording one that points into somebody
    else's project would make this contact's card display (and let a signed link be minted for) another office's file.
    So the path must lie under this contact's own project folder, or under the office's own prefix, and may not climb.
    Removing a photograph (no path) is always allowed.
  */
  if v_path is not null
     and (v_path ~ '\.\.'
          or not (left(v_path, length(v_project::text) + 10) = v_project::text || '/contacts/'
                  or left(v_path, length(p_office::text) + 1) = p_office::text || '/')) then
    return jsonb_build_object('error', 'that photograph is not stored under this office');
  end if;

  update public.contacts
     set photo_path = v_path
   where contact_id = p_contact_id and project_id = v_project;

  v_undo := app.undo_offer(
    p_office,
    'contact.photo',
    format('%s %s',
           case when p_path is null or btrim(p_path) = '' then 'Removed the photograph of'
                else 'Changed the photograph of' end,
           v_name),
    jsonb_build_object('action', 'contact_photo_set',
                       'args', jsonb_build_object('p_contact_id', p_contact_id,
                                                  'p_path', v_was)));

  return jsonb_build_object('ok', true, 'undo', v_undo);
end;
$function$;

create function app.hq_contact_update(p_office uuid, p_contact_id uuid, p_name text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_org text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_website text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_where text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_kind text DEFAULT NULL::text, p_stage text DEFAULT NULL::text, p_next text DEFAULT NULL::text, p_next_due text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_was  public.contacts%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_undo uuid;
  v      jsonb;
  v_project uuid;
begin
  perform app.require_office(p_office);
  v_project := app.contact_in_office(p_office, p_contact_id);
  select * into v_was from public.contacts where contact_id = p_contact_id and project_id = v_project;
  if v_project is null or not found then
    return jsonb_build_object('error', 'no such contact');
  end if;
  if v_was.archived_at is not null then
    return jsonb_build_object('error', format('%s has been put away', v_was.name));
  end if;

  -- A name may be changed and may not be emptied: it is the only thing on a
  -- contact that everything else hangs off.
  if p_name is not null and v_name = '' then
    return jsonb_build_object('error', 'a contact needs a name');
  end if;
  if v_kind <> '' and v_kind not in ('person', 'company', 'collaborator', 'supplier') then
    return jsonb_build_object('error', format(
      '%L is not a kind — it is one of person, company, collaborator, supplier', v_kind));
  end if;

  -- The same refusal `hq_contact_add` gives, for the same reason, because a
  -- rename is the other door onto one field and a constraint enforced at one
  -- door only is a constraint that is not enforced.
  if v_name <> '' and lower(v_name) <> lower(v_was.name)
     and exists (select 1 from public.contacts
                  where project_id = v_was.project_id
                    and archived_at is null
                    and lower(btrim(name)) = lower(v_name)) then
    return jsonb_build_object('error', format('%s is already a contact on this project', v_name));
  end if;

  update public.contacts set
    name      = case when p_name      is null then name      else v_name end,
    role      = case when p_role      is null then role      else btrim(p_role) end,
    org       = case when p_org       is null then org       else btrim(p_org) end,
    email     = case when p_email     is null then email     else btrim(p_email) end,
    phone     = case when p_phone     is null then phone     else btrim(p_phone) end,
    website   = case when p_website   is null then website   else btrim(p_website) end,
    instagram = case when p_instagram is null then instagram else btrim(p_instagram) end,
    "where"   = case when p_where     is null then "where"   else btrim(p_where) end,
    note      = case when p_note      is null then note      else btrim(p_note) end,
    kind      = case when v_kind = ''         then kind      else v_kind end,
    stage     = case when p_stage     is null then stage     else btrim(p_stage) end,
    next      = case when p_next      is null then next      else btrim(p_next) end,
    next_due  = case when p_next_due  is null then next_due  else btrim(p_next_due) end
  where contact_id = p_contact_id and project_id = v_project;

  -- Every other writer on this table offers an undo, so this one does too.
  v_undo := app.undo_offer(
    p_office,
    'contact.update',
    format('Changed %s', v_was.name),
    jsonb_build_object(
      'action', 'contact_update',
      'args', jsonb_build_object(
        'p_contact_id', p_contact_id,
        'p_name', v_was.name, 'p_role', v_was.role, 'p_org', v_was.org,
        'p_email', v_was.email, 'p_phone', v_was.phone, 'p_website', v_was.website,
        'p_instagram', v_was.instagram, 'p_where', v_was."where", 'p_note', v_was.note,
        'p_kind', v_was.kind, 'p_stage', v_was.stage,
        'p_next', v_was.next, 'p_next_due', v_was.next_due)));

  select jsonb_build_object('ok', true, 'id', contact_id, 'name', name, 'undo', v_undo)
    into v from public.contacts where contact_id = p_contact_id and project_id = v_project;
  return v;
end;
$function$;

----------------------------------------------------------------------------------------------------------------------
-- recoverable_projects: the office's own archived projects, and only what the office holds in them
----------------------------------------------------------------------------------------------------------------------
create function app.recoverable_projects(p_office uuid, p_limit integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $f$
begin
  -- A plpgsql body, not `language sql`: a gate inside a query that finds no rows is never evaluated, and an
  -- office that is missing must be refused whether or not it has anything archived.
  perform app.require_office(p_office);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'slug', x.slug,
             'name', x.name,
             'purpose', x.purpose,
             'archived_at', x.updated_at,
             'held', x.held
           ) order by x.updated_at desc), '[]'::jsonb)
      from (
        select p.slug, p.name, p.purpose, p.updated_at,
               (select count(*) from public.documents d where d.project_id = p.project_id and d.office_id = p_office)
               + (select count(*) from public.tasks t where t.project_id = p.project_id and t.office_id = p_office)
               + (select count(*) from public.contacts c where c.project_id = p.project_id)
                 as held
          from public.projects p
         where p.office_id = p_office
           and p.status = 'archived'
           and not p.is_fixture
           and not app.harness_label(p.slug)
         order by p.updated_at desc
      ) x
     where x.held > 0
     limit greatest(coalesce(p_limit, 12), 1)
  );
end
$f$;
revoke all on function app.recoverable_projects(uuid, integer) from public, anon, authenticated, service_role;

----------------------------------------------------------------------------------------------------------------------
-- the undo dispatcher: the six contact branches receive the office (spliced from the LIVE definition)
----------------------------------------------------------------------------------------------------------------------
do $m$
declare
  v text;
  r record;
  n int;
begin
  v := pg_get_functiondef('app.hq_undo(uuid,text)'::regprocedure);
  for r in select * from (values
      ('app.hq_contact_label_rename((v_args'),
      ('app.hq_contact_labels_set((v_args'),
      ('app.hq_contact_fields_set((v_args'),
      ('app.hq_contact_update((v_args'),
      ('app.hq_contact_archive((v_args'),
      ('app.hq_contact_photo_set((v_args')) a(anchor)
  loop
    n := (length(v) - length(replace(v, r.anchor, ''))) / length(r.anchor);
    if n <> 1 then
      raise exception 'splice anchor % found % times in app.hq_undo, expected 1', r.anchor, n;
    end if;
    v := replace(v, r.anchor, replace(r.anchor, '((v_args', '(p_office, (v_args'));
  end loop;
  execute v;
end $m$;

----------------------------------------------------------------------------------------------------------------------
-- the doors: public wrappers, service_role only
----------------------------------------------------------------------------------------------------------------------
create function public.hq_contact_add(p_office uuid, p_project text, p_name text, p_role text default null,
  p_org text default null, p_email text default null, p_phone text default null, p_instagram text default null,
  p_website text default null, p_kind text default 'person', p_note text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_contact_add(p_office, p_project, p_name, p_role, p_org, p_email, p_phone, p_instagram, p_website,
  p_kind, p_note) $f$;

create function public.hq_contact_archive(p_office uuid, p_contact_id uuid, p_put_away boolean default true)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_contact_archive(p_office, p_contact_id, p_put_away) $f$;

create function public.hq_contact_fields_set(p_office uuid, p_contact_id uuid, p_fields jsonb)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_contact_fields_set(p_office, p_contact_id, p_fields) $f$;

create function public.hq_contact_label_add(p_office uuid, p_name text, p_hue text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_contact_label_add(p_office, p_name, p_hue) $f$;

create function public.hq_contact_label_remove(p_office uuid, p_label_id uuid)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_contact_label_remove(p_office, p_label_id) $f$;

create function public.hq_contact_label_rename(p_office uuid, p_label_id uuid, p_name text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_contact_label_rename(p_office, p_label_id, p_name) $f$;

create function public.hq_contact_labels_set(p_office uuid, p_contact_id uuid, p_labels jsonb)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_contact_labels_set(p_office, p_contact_id, p_labels) $f$;

create function public.hq_contact_photo_set(p_office uuid, p_contact_id uuid, p_path text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_contact_photo_set(p_office, p_contact_id, p_path) $f$;

create function public.hq_contact_update(p_office uuid, p_contact_id uuid, p_name text default null,
  p_role text default null, p_org text default null, p_email text default null, p_phone text default null,
  p_website text default null, p_instagram text default null, p_where text default null, p_note text default null,
  p_kind text default null, p_stage text default null, p_next text default null, p_next_due text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_contact_update(p_office, p_contact_id, p_name, p_role, p_org, p_email, p_phone, p_website,
  p_instagram, p_where, p_note, p_kind, p_stage, p_next, p_next_due) $f$;

create function public.recoverable_projects(p_office uuid, p_limit integer default 12)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.recoverable_projects(p_office, p_limit) $f$;

do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('hq_contact_add','hq_contact_archive','hq_contact_fields_set','hq_contact_label_add',
                                'hq_contact_label_remove','hq_contact_label_rename','hq_contact_labels_set',
                                'hq_contact_photo_set','hq_contact_update','recoverable_projects')
              and (pg_get_function_arguments(p.oid)) like 'p_office uuid%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $g$;

----------------------------------------------------------------------------------------------------------------------
-- the old signatures go: nothing may touch a contact without saying whose
----------------------------------------------------------------------------------------------------------------------
drop function public.hq_contact_add(text, text, text, text, text, text, text, text, text, text);
drop function public.hq_contact_archive(uuid, boolean);
drop function public.hq_contact_fields_set(uuid, jsonb);
drop function public.hq_contact_label_add(text, text);
drop function public.hq_contact_label_remove(uuid);
drop function public.hq_contact_label_rename(uuid, text);
drop function public.hq_contact_labels_set(uuid, jsonb);
drop function public.hq_contact_photo_set(uuid, text);
drop function public.hq_contact_update(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text);
drop function public.recoverable_projects(integer);
-- Nothing in the repository or the gateway reads it, and it listed every office's labels for an owner NAME.
drop function public.contact_labels(text);
drop function app.hq_contact_add(text, text, text, text, text, text, text, text, text, text);
drop function app.hq_contact_archive(uuid, boolean);
drop function app.hq_contact_fields_set(uuid, jsonb);
drop function app.hq_contact_label_add(text, text);
drop function app.hq_contact_label_remove(uuid);
drop function app.hq_contact_label_rename(uuid, text);
drop function app.hq_contact_labels_set(uuid, jsonb);
drop function app.hq_contact_photo_set(uuid, text);
drop function app.hq_contact_update(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text);
drop function app.recoverable_projects(integer);

-- the app side of the new signatures is closed to every role the browser can be
do $r$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'app'::regnamespace
              and p.proname in ('hq_contact_add','hq_contact_archive','hq_contact_fields_set','hq_contact_label_add',
                                'hq_contact_label_remove','hq_contact_label_rename','hq_contact_labels_set',
                                'hq_contact_photo_set','hq_contact_update')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
  end loop;
end $r$;

-- ROLLBACK (not part of the migration): roll the worker and hq-api back first, then restore the previous
-- definitions from migrations/0730's predecessors; a database-only rollback leaves the gateway calling signatures
-- that no longer exist.
