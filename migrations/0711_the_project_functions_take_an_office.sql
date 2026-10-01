-- 0711 - the project functions take an office and check every row against it (multi-user P3, cluster a-projects).
--
-- Before: archive_project, hq_create_project, hq_attach, hq_rename_project, the automation, team, instruction, reference,
-- layout and seen functions found a project BY SLUG ALONE, found an attachment, an automation or a reference by its own
-- key, wrote 'grant' as the person on every layout and read-marker, and let the compatibility bridge guess which office a
-- new row belonged to. A second person would have shared Grant's project list, his workspace and his automations.
--
-- Now each of the 31 functions (both schemas) takes `p_office uuid` FIRST with no default, opens with
-- app.require_office, and carries `office_id = p_office` on every statement that touches a carrier (projects,
-- responsibilities, inbound_commands, workspace_layouts, jobs, undoable_actions) or reaches a derived table through the
-- project's office (attachments, references, staff, connector choices, dashboard and plane layouts, project_seen).
-- A resource of another office is indistinguishable from one that does not exist: the same sentence, the same shape.
-- The person a layout or read-marker belongs to is app.office_actor(p_office), not the literal 'grant'; p_by defaults to
-- that actor instead of 'grant'.
--
-- Spliced from the LIVE definitions, with every anchor count-asserted by the generator; app.hq_undo is spliced inside
-- this file from its definition at apply time (so it composes with the other clusters' splices).
-- The old signatures are dropped in this migration (the release pauses the worker so drop and deploy land together).

-- ------------------------------------------------------------------------------------------------------------------
-- app.add_project_reference
-- ------------------------------------------------------------------------------------------------------------------
create function app.add_project_reference(p_office uuid, p_slug text, p_url text, p_title text DEFAULT NULL::text, p_kind text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_url     text := btrim(coalesce(p_url, ''));
  v_kind    text;
  v_title   text;
  v_id      uuid;
  v_existing uuid;
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  if v_url = '' then
    return jsonb_build_object('ok', false, 'error', 'a reference needs a link');
  end if;

  select project_id into v_project
    from public.projects where slug = p_slug and office_id = p_office and status <> 'archived';
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no active project called %s', p_slug));
  end if;

  /*
    A bare host is a link. Grant pastes "stripe.com/docs" as often as the full
    thing, and refusing it would be the interface being pedantic about a
    detail it can fix itself.
  */
  if v_url !~* '^[a-z][a-z0-9+.-]*:' then
    v_url := 'https://' || v_url;
  end if;

  v_kind  := coalesce(nullif(btrim(coalesce(p_kind, '')), ''), app.guess_reference_kind(v_url));
  v_title := coalesce(nullif(btrim(coalesce(p_title, '')), ''),
                      app.guess_reference_title(v_url), v_url);

  select reference_id into v_existing
    from public.project_references
   where project_id = v_project
     and app.normalise_reference_url(url) = app.normalise_reference_url(v_url);
  if v_existing is not null then
    return jsonb_build_object(
      'ok', false, 'already', true, 'reference', v_existing,
      'error', format('%s already points at that', p_slug));
  end if;

  insert into public.project_references (project_id, kind, url, title, note, added_by)
  values (v_project, v_kind, v_url, v_title, btrim(coalesce(p_note, '')), p_by)
  returning reference_id into v_id;

  return jsonb_build_object('ok', true, 'reference', v_id, 'kind', v_kind, 'title', v_title);
end;
$function$;
revoke all on function app.add_project_reference(uuid, text, text, text, text, text, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.archive_project
-- ------------------------------------------------------------------------------------------------------------------
create function app.archive_project(p_office uuid, p_slug text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_project uuid; v_name text; v_stopped int; v_undo uuid;
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  select project_id, name into v_project, v_name
    from public.projects where slug = p_slug and office_id = p_office;
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no project called %s', p_slug));
  end if;

  update public.projects set status = 'archived' where project_id = v_project and office_id = p_office;

  update public.responsibilities
     set enabled = false, updated_at = app.now_utc()
   where project_id = v_project and office_id = p_office and enabled;
  get diagnostics v_stopped = row_count;

  /*
    The way back, offered at the moment it still knows what it changed.

    Ten minutes rather than the default two: archiving a project is not a
    typo in a title, and the realisation that it was the wrong one tends to
    arrive after looking for it somewhere else. `undo_offer` returns null while
    a reversal is being performed, so an undo of an undo is not a feature and
    nothing here has to know that.

    It does NOT restore the automations this call stopped. `unarchive_project`
    is explicit that they stay off and says which ones, because a duty that
    starts running again without being asked is a worse surprise than one that
    does not.
  */
  v_undo := app.undo_offer(
    p_office,
    'project_archive',
    format('archived %s', v_name),
    jsonb_build_object('action', 'unarchive_project',
                       'args', jsonb_build_object('p_slug', p_slug)),
    10);

  return jsonb_build_object(
    'ok', true, 'archived', p_slug, 'name', v_name, 'automations_stopped', v_stopped,
    'reversible', true, 'undo', v_undo);
end;
$function$;
revoke all on function app.archive_project(uuid, text, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.unarchive_project
-- ------------------------------------------------------------------------------------------------------------------
create function app.unarchive_project(p_office uuid, p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_project uuid; v_name text; v_off jsonb; v_attached int;
begin
  perform app.require_office(p_office);
  select project_id, name into v_project, v_name
    from public.projects where slug = p_slug and office_id = p_office and status = 'archived';
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no archived project called %s', p_slug));
  end if;

  /*
    ADR-0014, asked BEFORE the write rather than discovered at commit.

    The constraint trigger is DEFERRED, so without this the update succeeds,
    the function returns a cheerful `ok: true`, and the transaction then blows
    up somewhere the caller cannot attribute. A refusal that names the remedy
    is the whole difference between a rule and a fault.
  */
  select count(*) into v_attached
    from public.project_attachments a
   where a.project_id = v_project and a.enabled;
  if v_attached = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', format(
        '%s has nothing attached, and an active project has to read from '
        'somewhere real (ADR-0014). Reconnect a source first, then bring it back.',
        v_name),
      'needs', 'an attachment');
  end if;

  update public.projects set status = 'active' where project_id = v_project and office_id = p_office;

  select coalesce(jsonb_agg(r.slug order by r.slug), '[]'::jsonb) into v_off
    from public.responsibilities r where r.project_id = v_project and r.office_id = p_office and not r.enabled;

  return jsonb_build_object(
    'ok', true, 'project', p_slug, 'name', v_name, 'still_off', v_off);
end;
$function$;
revoke all on function app.unarchive_project(uuid, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.create_automation
-- ------------------------------------------------------------------------------------------------------------------
create function app.create_automation(p_office uuid, p_slug text, p_instruction text, p_every_minutes integer DEFAULT 1440, p_at_time text DEFAULT NULL::text, p_who text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_name    text;
  v_staff   uuid;
  v_named   text := nullif(btrim(coalesce(p_who, '')), '');
  v_what    text := btrim(coalesce(p_instruction, ''));
  v_at      time := case when btrim(coalesce(p_at_time, '')) = '' then null
                         else btrim(p_at_time)::time end;
  v_stem    text;
  v_slug    text;
  v_n       int := 1;
  v_id      uuid;
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  select project_id, name into v_project, v_name
    from public.projects where slug = p_slug and office_id = p_office and status <> 'archived';
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no active project called %s', p_slug));
  end if;

  -- Twenty characters, matching `responsibilities_description_substantive`.
  -- Checked here so the message is a sentence rather than a constraint name;
  -- the column still enforces it, which is what makes this a better error and
  -- not the only guard.
  if length(v_what) < 20 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Say what should happen in a sentence — this is the instruction the team will be given.');
  end if;

  if v_named is not null then
    select staff_id into v_staff from public.staff where slug = v_named and active;
    if v_staff is null then
      return jsonb_build_object('ok', false, 'error', format('nobody here is called %s', v_named));
    end if;
    -- An automation addressed to somebody who is not on this project would
    -- never produce anything, and the reason would be two tables away. 0323's
    -- rule, enforced at the point the decision is made.
    if not (v_named = any (app.staff_on_project(p_office, v_project))) then
      return jsonb_build_object(
        'ok', false,
        'error', format('%s is not on this project — put them on it first, in Team.', v_named));
    end if;
  else
    -- See the header. Not a placeholder: this is who actually has it.
    select staff_id into v_staff from public.staff where slug = 'chief-of-staff';
  end if;

  if p_every_minutes < 10 or p_every_minutes > 20160 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Anything from every ten minutes to once a fortnight.');
  end if;
  -- `responsibilities_one_schedule`. A time of day only means something on a
  -- period of a day or more; "every hour at 09:00" is two schedules.
  if v_at is not null and p_every_minutes < 1440 then
    return jsonb_build_object(
      'ok', false,
      'error', 'A time of day needs a daily or slower schedule.');
  end if;

  v_stem := regexp_replace(
              regexp_replace(lower(btrim(coalesce(v_name, 'project'))), '[^a-z0-9]+', '-', 'g'),
              '(^-+|-+$)', '', 'g');
  v_stem := left(coalesce(nullif(v_stem, ''), 'project'), 40) || '-auto';
  v_slug := v_stem;
  while exists (select 1 from public.responsibilities where slug = v_slug and office_id = p_office) loop
    v_n := v_n + 1;
    v_slug := v_stem || '-' || v_n::text;
  end loop;

  insert into public.responsibilities
    (office_id, slug, staff_id, project_id, description, job_kind, period_minutes, at_time,
     enabled, pinned_config, recipient_agent, created_by)
  values
    (p_office, v_slug, v_staff, v_project, v_what, 'office.instruction', p_every_minutes, v_at,
     true, jsonb_build_object('instruction', v_what), v_named, p_by)
  returning responsibility_id into v_id;

  return jsonb_build_object(
    'ok', true, 'automation', v_slug, 'id', v_id,
    'whose', coalesce(v_named, 'chief-of-staff'),
    'when', app.say_schedule(p_every_minutes, v_at, 'UTC'));
end;
$function$;
revoke all on function app.create_automation(uuid, text, text, integer, text, text, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.set_automation
-- ------------------------------------------------------------------------------------------------------------------
create function app.set_automation(p_office uuid, p_automation text, p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_kind text; v_by text;
begin
  perform app.require_office(p_office);
  select job_kind, created_by into v_kind, v_by
    from public.responsibilities where slug = p_automation and office_id = p_office;
  if v_kind is null then
    return jsonb_build_object('ok', false, 'error', format('no automation called %s', p_automation));
  end if;

  update public.responsibilities
     set enabled = p_on, updated_at = app.now_utc()
   where slug = p_automation and office_id = p_office;

  return jsonb_build_object('ok', true, 'automation', p_automation, 'on', p_on);
end;
$function$;
revoke all on function app.set_automation(uuid, text, boolean) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.remove_automation
-- ------------------------------------------------------------------------------------------------------------------
create function app.remove_automation(p_office uuid, p_automation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_by text; v_kind text; v_what text;
begin
  perform app.require_office(p_office);
  select created_by, job_kind, description into v_by, v_kind, v_what
    from public.responsibilities where slug = p_automation and office_id = p_office;
  if v_by is null then
    return jsonb_build_object('ok', false, 'error', format('no automation called %s', p_automation));
  end if;
  if v_by = 'migration' then
    return jsonb_build_object(
      'ok', false, 'refused', true,
      'error', 'That one runs the office rather than this project. Switch it off in Settings if you need it quiet.');
  end if;

  delete from public.responsibilities where slug = p_automation and office_id = p_office;
  return jsonb_build_object('ok', true, 'removed', p_automation, 'what', v_what);
end;
$function$;
revoke all on function app.remove_automation(uuid, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.project_automations
-- ------------------------------------------------------------------------------------------------------------------
create function app.project_automations(p_office uuid, p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(x.v order by x.at desc), '[]'::jsonb)
    from (
      select r.created_at as at, jsonb_build_object(
               'slug', r.slug,
               'what', r.description,
               -- The instruction as written, when there is one. A duty that
               -- pre-dates automations has none, and says so by being null
               -- rather than by an empty string that reads as a blank field.
               'instruction', nullif(r.pinned_config ->> 'instruction', ''),
               'who', s.name,
               'who_slug', s.slug,
               'addressed_to', r.recipient_agent,
               'when', app.say_schedule(r.period_minutes, r.at_time, r.timezone),
               'every_minutes', r.period_minutes,
               'at_time', to_char(r.at_time, 'HH24:MI'),
               'on', r.enabled,
               'last_run', r.last_run_at,
               'made_by', r.created_by,
               -- Whether Grant can edit it here. The twelve that run the
               -- office are not his to change from a project page, and a
               -- control that refuses on press is worse than one that is not
               -- drawn. See `remove_automation`.
               'mine', r.created_by <> 'migration' and r.job_kind = 'office.instruction'
             ) as v
        from public.responsibilities r
        left join public.staff s on s.staff_id = r.staff_id
       where r.project_id = p_project_id
         and r.office_id = p_office
    ) x
  );
end
$function$;
revoke all on function app.project_automations(uuid, uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.remove_project_reference
-- ------------------------------------------------------------------------------------------------------------------
create function app.remove_project_reference(p_office uuid, p_reference_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_title text;
begin
  perform app.require_office(p_office);
  delete from public.project_references r
   using public.projects p
   where r.reference_id = p_reference_id
     and p.project_id = r.project_id and p.office_id = p_office
  returning r.title into v_title;
  if v_title is null then
    return jsonb_build_object('ok', false, 'error', 'no such reference');
  end if;
  return jsonb_build_object('ok', true, 'removed', v_title);
end;
$function$;
revoke all on function app.remove_project_reference(uuid, uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_attach
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_attach(p_office uuid, p_slug text, p_connector text, p_ref text, p_role text DEFAULT 'source'::text, p_kind text DEFAULT NULL::text, p_display text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project uuid;
  v_row     public.project_attachments%rowtype;
  v_auth    jsonb;
  v_refusal text;
begin
  perform app.require_office(p_office);
  select project_id into v_project from public.projects where slug = p_slug and office_id = p_office;
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;

  if btrim(coalesce(p_by, '')) <> '' then
    v_refusal := app.authority_refusal(btrim(p_by), null, v_project);
    if v_refusal is not null then return jsonb_build_object('error', v_refusal); end if;
  end if;

  -- The registry, not a list. A connector that is registered and enabled can
  -- be attached; one that is not says why in its own words.
  if not exists (
    select 1 from public.knowledge_connectors k
     where k.connector = p_connector and k.enabled
  ) then
    return jsonb_build_object(
      'error', format('%L is not a connector this office has', p_connector),
      'reason', (select k.disabled_reason from public.knowledge_connectors k
                  where k.connector = p_connector),
      'connectors', (select jsonb_agg(k.connector order by k.connector)
                       from public.knowledge_connectors k where k.enabled));
  end if;

  /*
    Drive has its own front door, and it does three things this one cannot:
    reads the folder id out of a pasted share link, refuses a folder another
    project already watches, and creates the `drive_watch` row.

    An attachment without that row is a folder nobody looks at — which is
    indistinguishable from one being watched until nothing is ever reported.
  */
  if p_connector = 'drive' then
    return app.attach_drive_folder(p_office, v_project, p_ref, p_display,
                                   coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office)));
  end if;

  insert into public.project_attachments
    (project_id, connector, external_ref, display_name, role, artifact_kind)
  values
    (v_project, p_connector, btrim(p_ref),
     nullif(btrim(coalesce(p_display, '')), ''), p_role, p_kind)
  on conflict do nothing
  returning * into v_row;

  if v_row.attachment_id is null then
    select * into v_row from public.project_attachments
     where project_id = v_project and connector = p_connector
       and external_ref = btrim(p_ref);
  end if;

  -- Connecting a Notion database IS the yes to writing into it - that database, on that project, from a person.
  v_auth := case when p_connector = 'notion' and p_role = 'home' and v_row.attachment_id is not null
                      and btrim(coalesce(p_by, '')) <> ''
    then app.record_destination_authority('notion.write', v_project, 'notion:' || btrim(p_ref), p_by, null,
           format('the Notion database %s', coalesce(v_row.display_name, btrim(p_ref)))) end;

  return jsonb_build_object(
    'attachment_id', v_row.attachment_id,
    'connector', p_connector,
    'role', p_role,
    'authorised', coalesce((v_auth ->> 'ok')::boolean, false));
end;
$function$;
revoke all on function app.hq_attach(uuid, text, text, text, text, text, text, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_detach
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_detach(p_office uuid, p_attachment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_was_enabled boolean;
  v_was_reason  text;
  v_what        text;
  v_undo        uuid;
begin
  perform app.require_office(p_office);
  select a.project_id, a.enabled, a.disabled_reason, coalesce(a.display_name, a.external_ref)
    into v_project, v_was_enabled, v_was_reason, v_what
    from public.project_attachments a
    join public.projects p on p.project_id = a.project_id and p.office_id = p_office
   where a.attachment_id = p_attachment_id;
  if v_project is null then return jsonb_build_object('error', 'no such attachment'); end if;

  -- Disabled, not deleted, and the documents it fed are untouched. ADR-0013:
  -- closing a route loses the route, never the corpus.
  update public.project_attachments
     set enabled = false, disabled_reason = 'detached from Team HQ'
   where attachment_id = p_attachment_id and project_id = v_project;

  -- Detaching something already detached changes nothing, so there is nothing
  -- to take back.
  if v_was_enabled then
    v_undo := app.undo_offer(
      p_office,
      'attachment.detach',
      format('Detached %s', left(coalesce(v_what, 'a source'), 60)),
      jsonb_build_object('action', 'reattach',
                         'args', jsonb_build_object(
                           'p_attachment_id', p_attachment_id::text,
                           'p_reason', v_was_reason)));
  end if;

  return jsonb_build_object('detached', p_attachment_id, 'undo', v_undo);
end;
$function$;
revoke all on function app.hq_detach(uuid, uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_reattach
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_reattach(p_office uuid, p_attachment_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_found uuid;
begin
  perform app.require_office(p_office);
  select a.attachment_id into v_found
    from public.project_attachments a
    join public.projects p on p.project_id = a.project_id and p.office_id = p_office
   where a.attachment_id = p_attachment_id;
  if v_found is null then
    return jsonb_build_object('error', 'no such attachment');
  end if;

  -- `project_attachments` carries `check (enabled or disabled_reason is not
  -- null)`, so re-enabling and clearing the reason must happen in one
  -- statement. They do.
  update public.project_attachments
     set enabled = true, disabled_reason = p_reason
   where attachment_id = v_found;

  return jsonb_build_object('reattached', p_attachment_id);
end;
$function$;
revoke all on function app.hq_reattach(uuid, uuid, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_connection_choose
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_connection_choose(p_office uuid, p_slug text, p_connector text, p_choice text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
  select project_id into v_project from public.projects where slug = p_slug and office_id = p_office and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active project called %L', p_slug));
  end if;
  if not exists (select 1 from public.knowledge_connectors where connector = p_connector and enabled) then
    return jsonb_build_object('error', format('%L is not a connector', p_connector));
  end if;

  -- `clear` removes the decision rather than storing a third value, so
  -- "changed my mind" and "never considered" end up in the same state — which
  -- they are.
  if p_choice = 'clear' then
    delete from public.project_connector_choices
     where project_id = v_project and connector = p_connector;
    return jsonb_build_object('ok', true, 'choice', null);
  end if;

  if p_choice not in ('declined', 'wanted') then
    return jsonb_build_object('error', 'choice must be declined, wanted or clear');
  end if;

  -- Refused rather than silently overwritten: a project that IS connected has
  -- no business also being marked as not wanting the connection, and the way
  -- to stop using one is to detach it.
  if exists (
    select 1 from public.project_attachments
     where project_id = v_project and connector = p_connector and enabled
  ) then
    return jsonb_build_object(
      'error', format('%s is already attached to %s — detach it first', p_connector, p_slug)
    );
  end if;

  insert into public.project_connector_choices (project_id, connector, choice, reason)
  values (v_project, p_connector, p_choice, nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (project_id, connector) do update
    set choice = excluded.choice, reason = excluded.reason, decided_at = app.now_utc();

  return jsonb_build_object('ok', true, 'choice', p_choice, 'connector', p_connector);
end;
$function$;
revoke all on function app.hq_connection_choose(uuid, text, text, text, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_create_project
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_create_project(p_office uuid, p_name text, p_connector text, p_ref text, p_display text DEFAULT NULL::text, p_force boolean DEFAULT false, p_by text DEFAULT NULL::text)
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

  v_slug := left(trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')), 60);
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
  perform app.record_channel_authority(v_id, p_by, null);

  return jsonb_build_object(
    'project_id', v_id, 'slug', v_slug, 'name', trim(p_name),
    'needs_you', case when p_connector <> 'notion'
                 then 'a Notion Teamspace, which only you can create' end
  );
end;
$function$;
revoke all on function app.hq_create_project(uuid, text, text, text, text, boolean, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_rename_project
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_rename_project(p_office uuid, p_slug text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_prefix text;
  v_id uuid;
  v_was text;
  v_fixture boolean;
  v_undo uuid;
  v_taken text;
begin
  perform app.require_office(p_office);
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('error', 'a project needs a name');
  end if;
  select project_id, name, is_fixture into v_id, v_was, v_fixture
    from public.projects where slug = p_slug and office_id = p_office;
  if v_id is null then
    return jsonb_build_object('error', format('no project %L', p_slug));
  end if;

  /*
    0365. The check hq_create_project has always had, on the writer that never
    did. Excludes this project so renaming to its own name stays a no-op, and
    excludes archived projects so a retired probe cannot hold a name hostage.
  */
  select p.slug into v_taken
    from public.projects p
   where p.project_id <> v_id
     and p.office_id = p_office
     and p.status <> 'archived'
     and lower(trim(p.name)) = lower(trim(p_name))
   limit 1;
  if v_taken is not null then
    return jsonb_build_object('error', format(
      '%L already belongs to the project %L, and two projects answering to one name '
      || 'is how work lands in the wrong place. Rename or archive that one first.',
      trim(p_name), v_taken));
  end if;

  v_prefix := left(trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')), 48);
  update public.projects
     set name = trim(p_name), channel_prefix = nullif(v_prefix, '')
   where project_id = v_id and office_id = p_office;

  -- The Slack channels follow, but not from here: renaming a channel is a
  -- Slack API call and this is SQL. The page reports that the rename is
  -- pending and the worker carries it out, rather than the page claiming a
  -- rename it cannot perform.
  --
  -- A fixture project has no channels, so there is nothing for the worker to
  -- do and the job would be real work queued against a project nobody can see.
  if not coalesce(v_fixture, false) then
    insert into public.jobs
      (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
    values (p_office, gen_random_uuid(), v_id, format('rename-%s-%s', v_id, gen_random_uuid()),
            'office.rename_channels', 'hq', 300,
            jsonb_build_object('prefix', v_prefix));
  end if;

  -- The slug does not change on a rename, so the inverse addresses the same
  -- project. Undoing also enqueues a second rename job, which is right: the
  -- channels followed the name out and have to follow it back.
  if trim(p_name) is distinct from v_was then
    v_undo := app.undo_offer(
      p_office,
      'project.rename',
      format('Renamed to %s', trim(p_name)),
      jsonb_build_object('action', 'rename_project',
                         'args', jsonb_build_object('p_slug', p_slug, 'p_name', v_was)));
  end if;

  return jsonb_build_object(
    'slug', p_slug, 'name', trim(p_name), 'channel_prefix', v_prefix,
    'undo', v_undo,
    'note', case when coalesce(v_fixture, false)
                 then 'a fixture project has no channels to rename'
                 else 'channels will be renamed by the worker on its next pass' end
  );
end;
$function$;
revoke all on function app.hq_rename_project(uuid, text, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_project_look
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_project_look(p_office uuid, p_slug text, p_icon text DEFAULT NULL::text, p_hue text DEFAULT NULL::text, p_image text DEFAULT NULL::text, p_clear text[] DEFAULT ARRAY[]::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_icon    text;
  v_hue     text;
  v_clear   text[] := array[]::text[];
  v_undo    uuid;
  v_touched_image boolean;
begin
  perform app.require_office(p_office);
  select project_id, icon, icon_hue into v_project, v_icon, v_hue
    from public.projects
   where slug = p_slug and office_id = p_office and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active dashboard project called %s', p_slug));
  end if;

  if p_hue is not null and p_hue not in
     ('p-rust', 'p-amber', 'p-moss', 'p-slate', 'p-iris', 'p-plum') then
    return jsonb_build_object('error', format('%s is not one of the palette colours', p_hue));
  end if;

  -- The new one. A URL to somewhere else is the likeliest mistake and the one
  -- worth naming: an image the office does not hold is an image that vanishes
  -- when that host does.
  if p_image is not null and p_image not like 'data:image/%' then
    return jsonb_build_object('error',
      'an image has to be sent as data, not as a link -- the page resizes it to 256px '
      || 'and encodes it before it gets here, so a link means something else called this');
  end if;

  if p_image is not null and length(p_image) > 98304 then
    return jsonb_build_object('error',
      'that image is too large once encoded -- it is resized to 256px before it is sent, '
      || 'so an image this big means the resize did not run');
  end if;

  if not app.icon_key_ok(p_icon) then
    return jsonb_build_object('error',
      format('%L is not the shape of an icon key -- lowercase letters, digits '
             || 'and single hyphens, two to forty characters', p_icon));
  end if;

  update public.projects
     set icon     = case when 'icon'  = any(p_clear) then null
                         else coalesce(p_icon, icon) end,
         icon_hue = case when 'hue'   = any(p_clear) then null
                         else coalesce(p_hue, icon_hue) end,
         image    = case when 'image' = any(p_clear) then null
                         else coalesce(p_image, image) end
   where project_id = v_project and office_id = p_office;

  v_touched_image := p_image is not null or 'image' = any(p_clear);

  if v_touched_image then
    -- Exact would mean keeping the previous 96 KB data URL for a two-minute
    -- offer, on every change, for ever. That is a hoard, not an undo. Say so
    -- rather than offering a partial restore that quietly leaves the old photo
    -- gone.
    v_undo := null;
    perform app.undo_none(p_office, 'project.photo',
      format('Changed the photo on %s — the previous one is not kept', p_slug));
  else
    if v_icon is null then v_clear := array_append(v_clear, 'icon'); end if;
    if v_hue  is null then v_clear := array_append(v_clear, 'hue'); end if;
    v_undo := app.undo_offer(
      p_office,
      'project.look',
      format('Changed how %s looks', p_slug),
      jsonb_build_object('action', 'project_look',
                         'args', jsonb_build_object(
                           'p_slug', p_slug, 'p_icon', v_icon, 'p_hue', v_hue,
                           'p_clear', to_jsonb(v_clear))));
  end if;

  return (
    select jsonb_build_object('ok', true, 'slug', p_slug,
             'icon', pr.icon, 'hue', pr.icon_hue, 'undo', v_undo,
             'image', case when pr.image is null then null else 'set' end)
      from public.projects pr where pr.project_id = v_project
  );
end;
$function$;
revoke all on function app.hq_project_look(uuid, text, text, text, text, text[]) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_projects
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_projects(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object(
             'project_id', p.project_id,
             'slug', p.slug,
             'name', p.name,
             'description', p.description,
             'purpose', p.purpose,
             'channel_prefix', p.channel_prefix,
             'status', p.status,
             'documents', (select count(*) from public.documents d
                            where d.project_id = p.project_id and d.office_id = p_office
                              and d.mirrors_document_id is null),
             -- Shown separately rather than hidden: a mirror is real, it is
             -- just not new material, and "12 documents, 12 mirrored to Notion"
             -- is a more useful sentence than either number alone.
             'mirrored', (select count(*) from public.documents d
                           where d.project_id = p.project_id and d.office_id = p_office
                             and d.mirrors_document_id is not null),
             'aliases', (select coalesce(jsonb_agg(jsonb_build_object(
                              'alias', a.alias, 'source', a.source) order by a.confidence desc, a.alias), '[]'::jsonb)
                           from public.project_aliases a
                          where a.project_id = p.project_id and a.source <> 'name'),
             'connections', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                               from app.project_connections(p.project_id) c),
             'channels', (select coalesce(jsonb_agg(jsonb_build_object(
                              'name', m.channel_name, 'discipline', m.discipline) order by m.channel_name), '[]'::jsonb)
                            from public.slack_channel_map m
                           where m.project_id = p.project_id and m.active),
             'attachments', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'attachment_id', a.attachment_id,
                                 'connector', a.connector,
                                 'external_ref', a.external_ref,
                                 'display_name', a.display_name,
                                 'role', a.role,
                                 'artifact_kind', a.artifact_kind) order by a.role, a.connector), '[]'::jsonb)
                               from public.project_attachments a
                              where a.project_id = p.project_id and a.enabled)
           ) as x
      from public.projects p
     where p.office_id = p_office
       and p.status = 'active'
  ) s
  );
end
$function$;
revoke all on function app.hq_projects(uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_project_seen
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_project_seen(p_office uuid, p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_project uuid;
begin
  perform app.require_office(p_office);
  -- A project of another office and a project that does not exist are the same thing to this caller.
  select project_id into v_project from public.projects where project_id = p_project_id and office_id = p_office;
  if v_project is null then
    return jsonb_build_object('error', 'no such project');
  end if;
  insert into public.project_seen (owner, project_id, at)
  values (app.office_actor(p_office), v_project, app.now_utc())
  on conflict (owner, project_id) do update set at = app.now_utc();
  return jsonb_build_object('seen', true);
end;
$function$;
revoke all on function app.hq_project_seen(uuid, uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.project_team
-- ------------------------------------------------------------------------------------------------------------------
create function app.project_team(p_office uuid, p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(t.v order by t.ord, t.name), '[]'::jsonb)
    from (
      select case when s.slug = 'chief-of-staff' then 0 else 1 end as ord,
             s.name,
             jsonb_build_object(
               'slug', s.slug,
               'name', s.name,
               'title', s.title,
               'avatar', s.avatar_ref,
               'on', (s.slug = 'chief-of-staff' or coalesce(ps.active, true)),
               -- Said plainly, because a switch that cannot move needs to
               -- explain itself rather than merely refuse.
               'fixed', s.slug = 'chief-of-staff',
               'why_fixed', case when s.slug = 'chief-of-staff'
                                 then 'She is the only person who messages you.' end,
               'instruction', coalesce(ps.instruction, ''),
               -- Whether a DECISION exists, which is not the same as being on.
               -- The page draws a default differently from a choice.
               'decided', ps.staff_id is not null,
               'decided_by', ps.decided_by,
               'decided_at', ps.decided_at
             ) as v
        from public.staff s
        left join public.project_staff ps
          on ps.staff_id = s.staff_id
         and ps.project_id = (select pr.project_id from public.projects pr
                               where pr.project_id = p_project_id and pr.office_id = p_office)
       where s.active
    ) t
  );
end
$function$;
revoke all on function app.project_team(uuid, uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.staff_on_project
-- ------------------------------------------------------------------------------------------------------------------
create function app.staff_on_project(p_office uuid, p_project_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(array_agg(s.slug order by s.slug), array[]::text[])
    from public.staff s
    left join public.project_staff ps
      on ps.staff_id = s.staff_id
     and ps.project_id = (select pr.project_id from public.projects pr
                           where pr.project_id = p_project_id and pr.office_id = p_office)
   where s.active
     and (s.slug = 'chief-of-staff' or coalesce(ps.active, true))
  );
end
$function$;
revoke all on function app.staff_on_project(uuid, uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.set_project_instruction
-- ------------------------------------------------------------------------------------------------------------------
create function app.set_project_instruction(p_office uuid, p_slug text, p_staff_slug text, p_instruction text DEFAULT ''::text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_staff   uuid;
  v_text    text := btrim(coalesce(p_instruction, ''));
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  select project_id into v_project
    from public.projects where slug = p_slug and office_id = p_office and status <> 'archived';
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no active project called %s', p_slug));
  end if;

  select staff_id into v_staff from public.staff where slug = p_staff_slug and active;
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', format('nobody here is called %s', p_staff_slug));
  end if;

  -- A brief long enough to be a brief. Two words is a note to self, and it
  -- would be pasted into a prompt where it can only confuse. Empty is not
  -- short — it is the clear.
  if v_text <> '' and length(v_text) < 12 then
    return jsonb_build_object(
      'ok', false,
      'error', 'A brief needs to be a sentence — that is going into what they are told.');
  end if;

  insert into public.project_staff (project_id, staff_id, instruction, decided_by)
  values (v_project, v_staff, v_text, p_by)
  on conflict (project_id, staff_id)
  do update set instruction = excluded.instruction,
                decided_by = excluded.decided_by,
                decided_at = app.now_utc();

  return jsonb_build_object('ok', true, 'staff', p_staff_slug,
                            'cleared', v_text = '', 'instruction', v_text);
end;
$function$;
revoke all on function app.set_project_instruction(uuid, text, text, text, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.set_project_staff
-- ------------------------------------------------------------------------------------------------------------------
create function app.set_project_staff(p_office uuid, p_slug text, p_staff_slug text, p_on boolean, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_staff   uuid;
  v_name    text;
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  select project_id into v_project
    from public.projects where slug = p_slug and office_id = p_office and status <> 'archived';
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no active project called %s', p_slug));
  end if;

  select staff_id, name into v_staff, v_name
    from public.staff where slug = p_staff_slug and active;
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', format('nobody here is called %s', p_staff_slug));
  end if;

  if p_staff_slug = 'chief-of-staff' and not p_on then
    return jsonb_build_object(
      'ok', false, 'refused', true,
      'error', 'The Chief of Staff is on every project — she is the only person who messages you.');
  end if;

  insert into public.project_staff (project_id, staff_id, active, decided_by)
  values (v_project, v_staff, p_on, p_by)
  on conflict (project_id, staff_id)
  do update set active = excluded.active,
                decided_by = excluded.decided_by,
                decided_at = app.now_utc();

  return jsonb_build_object('ok', true, 'staff', p_staff_slug, 'name', v_name, 'on', p_on);
end;
$function$;
revoke all on function app.set_project_staff(uuid, text, text, boolean, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.machine_project_ok
-- ------------------------------------------------------------------------------------------------------------------
create function app.machine_project_ok(p_office uuid, p_ref text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return case
    when p_ref is null or btrim(p_ref) = '' then false
    when exists (select 1 from public.projects where slug = p_ref and office_id = p_office)
      then coalesce((select is_fixture from public.projects where slug = p_ref and office_id = p_office), false)
    else left(trim(both '-' from regexp_replace(lower(p_ref), '[^a-z0-9]+', '-', 'g')), 60)
           ~ '^(fixture|verify|ledger-proof)-'
  end;
end
$function$;
revoke all on function app.machine_project_ok(uuid, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.say_in_project
-- ------------------------------------------------------------------------------------------------------------------
create function app.say_in_project(p_office uuid, p_project_id uuid, p_text text, p_addressed_to text DEFAULT NULL::text, p_addressed_also text[] DEFAULT '{}'::text[], p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_said     text := nullif(btrim(coalesce(p_text, '')), '');
  v_to       text := nullif(btrim(coalesce(p_addressed_to, '')), '');
  v_also     text[];
  v_asked    text[] := coalesce(p_addressed_also, '{}');
  v_dropped  text[] := '{}';
  v_key      text;
  v_command  uuid;
  v_queued   jsonb;
  v_refusal  text;
begin
  perform app.require_office(p_office);
  -- The project first, inside the office: a project of another office and one that does not exist answer
  -- alike, whoever is asking.
  if p_project_id is null
     or not exists (select 1 from public.projects where project_id = p_project_id and office_id = p_office) then
    return jsonb_build_object('ok', false, 'error', 'no such project');
  end if;

  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  -- 0618: who may say something WHERE: a test principal speaks only in a fixture project.
  v_refusal := app.authority_refusal(p_by, null, p_project_id);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal);
  end if;

  if v_said is null then
    return jsonb_build_object('ok', false, 'error', 'there is nothing to say');
  end if;

  /*
    Who was asked and could not be found, gathered BEFORE anything is dropped.

    The old version returned a single `addressee_dropped`. A composer that
    quietly ignores who you picked is worse than one that says it could not
    find them, and with a selection there can be more than one - so it is a
    list now, and it names every one.
  */
  select coalesce(array_agg(t.slug order by t.slug), '{}')
    into v_dropped
    from unnest(array_remove(array_append(v_asked, v_to), null)) as t(slug)
   where not exists (select 1 from public.staff s where s.slug = t.slug and s.active);

  if v_to is not null
     and not exists (select 1 from public.staff where slug = v_to and active) then
    v_to := null;
  end if;

  /*
    Everybody real that Grant picked, minus whoever is answering.

    If he picked three and named no answerer, the FIRST becomes the answerer
    and the rest are convened - because somebody has to speak, and choosing
    for him here is better than a reply attributed to nobody.
  */
  select coalesce(array_agg(distinct s.slug order by s.slug), '{}')
    into v_also
    from unnest(v_asked) as t(slug)
    join public.staff s on s.slug = t.slug and s.active;

  if v_to is null and cardinality(v_also) > 0 then
    v_to := v_also[1];
  end if;
  v_also := array_remove(v_also, v_to);

  v_key := 'teamhq:message:' || replace(gen_random_uuid()::text, '-', '');

  insert into public.inbound_commands
    (office_id, origin_channel, origin_ref, actor, instruction, addressed_to, addressed_also,
     dedupe_key, project_id, context)
  values (p_office, 'teamhq', v_key, btrim(p_by), v_said, v_to, v_also, v_key, p_project_id,
          jsonb_build_object('project_id', p_project_id))
  returning command_id into v_command;

  v_queued := app.enqueue_inbound(v_command);

  return jsonb_build_object(
    'ok', true,
    'command', v_command,
    'job', v_queued->>'job_id',
    'project', p_project_id,
    'addressed_to', v_to,
    'addressed_also', to_jsonb(v_also),
    -- Named rather than silent, and all of them rather than the first.
    'addressee_dropped', to_jsonb(v_dropped));
end;
$function$;
revoke all on function app.say_in_project(uuid, uuid, text, text, text[], text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_dashboard_layout_reset
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_dashboard_layout_reset(p_office uuid, p_slug text, p_surface text DEFAULT 'studio'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
  select project_id into v_project from public.projects where slug = p_slug and office_id = p_office;
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;
  delete from public.dashboard_layouts
   where project_id = v_project and owner = app.office_actor(p_office) and surface = coalesce(p_surface, 'studio');
  return jsonb_build_object('ok', true, 'reset', true);
end;
$function$;
revoke all on function app.hq_dashboard_layout_reset(uuid, text, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_dashboard_layout_set
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_dashboard_layout_set(p_office uuid, p_slug text, p_panels jsonb, p_surface text DEFAULT 'studio'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
  select project_id into v_project from public.projects where slug = p_slug and office_id = p_office;
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;
  if coalesce(p_surface, '') not in ('studio', 'basecamp') then
    return jsonb_build_object('error', format('%L is not a surface', p_surface));
  end if;
  -- ADR-0021: an empty layout is a RESET, never a stored value. `[]` cannot be
  -- told apart from a layout that failed to load, so the row goes and the
  -- default comes back -- enforced here rather than only in the page.
  if p_panels is null or jsonb_typeof(p_panels) <> 'array'
     or jsonb_array_length(p_panels) = 0 then
    delete from public.dashboard_layouts
     where project_id = v_project and owner = app.office_actor(p_office) and surface = p_surface;
    return jsonb_build_object('ok', true, 'reset', true);
  end if;
  insert into public.dashboard_layouts (owner, project_id, surface, panels, updated_at)
  values (app.office_actor(p_office), v_project, p_surface, p_panels, app.now_utc())
  on conflict (owner, project_id, surface)
    do update set panels = excluded.panels, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true, 'panels', jsonb_array_length(p_panels));
end;
$function$;
revoke all on function app.hq_dashboard_layout_set(uuid, text, jsonb, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_plane_layout
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_plane_layout(p_office uuid, p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  -- A project of another office reads as a project with no saved arrangement, exactly as one that does not exist.
  return coalesce(
    (select jsonb_build_object('at', l.at, 'view', l.view)
       from public.plane_layouts l
       join public.projects p on p.project_id = l.project_id and p.office_id = p_office
      where l.owner = app.office_actor(p_office) and l.project_id = p_project_id),
    jsonb_build_object('at', '{}'::jsonb, 'view', '{}'::jsonb));
end
$function$;
revoke all on function app.hq_plane_layout(uuid, uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_plane_layout_reset
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_plane_layout_reset(p_office uuid, p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_had boolean;
begin
  perform app.require_office(p_office);
  with gone as (
    delete from public.plane_layouts l
     using public.projects p
     where p.project_id = l.project_id and p.office_id = p_office
       and l.owner = app.office_actor(p_office) and l.project_id = p_project_id
    returning 1)
  select exists (select 1 from gone) into v_had;
  return jsonb_build_object('reset', true, 'had_one', v_had);
end
$function$;
revoke all on function app.hq_plane_layout_reset(uuid, uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_plane_layout_set
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_plane_layout_set(p_office uuid, p_project_id uuid, p_at jsonb, p_view jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
  if jsonb_typeof(p_at) is distinct from 'object' then
    return jsonb_build_object('error', 'the arrangement is a map of node id to position');
  end if;
  select project_id into v_project from public.projects where project_id = p_project_id and office_id = p_office;
  if v_project is null then
    return jsonb_build_object('error', 'no such project');
  end if;
  insert into public.plane_layouts (owner, project_id, at, view)
  values (app.office_actor(p_office), v_project, p_at, coalesce(p_view, '{}'::jsonb))
  on conflict (owner, project_id) do update
    set at = excluded.at, view = excluded.view, updated_at = app.now_utc();
  return jsonb_build_object('saved', true, 'cards', (select count(*) from jsonb_object_keys(p_at)));
end;
$function$;
revoke all on function app.hq_plane_layout_set(uuid, uuid, jsonb, jsonb) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_workspace_layout
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_workspace_layout(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return jsonb_build_object(
    'panels', (select panels from public.workspace_layouts where owner = app.office_actor(p_office) and office_id = p_office),
    'at',     (select updated_at from public.workspace_layouts where owner = app.office_actor(p_office) and office_id = p_office)
  );
end
$function$;
revoke all on function app.hq_workspace_layout(uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_workspace_layout_reset
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_workspace_layout_reset(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_n bigint;
begin
  perform app.require_office(p_office);
  with gone as (
    delete from public.workspace_layouts
     where owner = app.office_actor(p_office) and office_id = p_office returning 1)
  select count(*) into v_n from gone;
  return jsonb_build_object('ok', true, 'removed', v_n);
end
$function$;
revoke all on function app.hq_workspace_layout_reset(uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_workspace_layout_set
-- ------------------------------------------------------------------------------------------------------------------
create function app.hq_workspace_layout_set(p_office uuid, p_panels jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_bad int;
begin
  perform app.require_office(p_office);
  if jsonb_typeof(p_panels) <> 'array' then
    return jsonb_build_object('error', 'panels must be an array');
  end if;

  if jsonb_array_length(p_panels) = 0 then
    delete from public.workspace_layouts where owner = app.office_actor(p_office) and office_id = p_office;
    return jsonb_build_object('ok', true, 'panels', 0,
      'note', 'the home screen was emptied, so it is back to its default');
  end if;

  select count(*) into v_bad
    from jsonb_array_elements(p_panels) e
   where jsonb_typeof(e) <> 'object'
      or jsonb_typeof(e -> 'id') <> 'string'
      or jsonb_typeof(e -> 'x') <> 'number'
      or jsonb_typeof(e -> 'y') <> 'number'
      or jsonb_typeof(e -> 'w') <> 'number'
      or jsonb_typeof(e -> 'h') <> 'number';
  if v_bad > 0 then
    return jsonb_build_object('error',
      format('%s panel(s) are not {id, x, y, w, h} -- nothing was saved', v_bad));
  end if;

  -- Keyed by the person; the office predicate on the conflict arm means a colliding key can never overwrite
  -- another office's row.
  insert into public.workspace_layouts (office_id, owner, panels, updated_at)
  values (p_office, app.office_actor(p_office), p_panels, now())
  on conflict (owner)
    do update set panels = excluded.panels, updated_at = now()
    where public.workspace_layouts.office_id = p_office;

  return jsonb_build_object('ok', true, 'panels', jsonb_array_length(p_panels));
end;
$function$;
revoke all on function app.hq_workspace_layout_set(uuid, jsonb) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- the public doors: service role only, the office FIRST, no default
-- ------------------------------------------------------------------------------------------------------------------
create function public.add_project_reference(p_office uuid, p_slug text, p_url text, p_title text DEFAULT NULL::text, p_kind text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.add_project_reference(p_office, p_slug, p_url, p_title, p_kind, p_note, p_by) $f$;

create function public.archive_project(p_office uuid, p_slug text, p_by text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.archive_project(p_office, p_slug, p_by) $f$;

create function public.unarchive_project(p_office uuid, p_slug text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.unarchive_project(p_office, p_slug) $f$;

create function public.create_automation(p_office uuid, p_slug text, p_instruction text, p_every_minutes integer DEFAULT 1440, p_at_time text DEFAULT NULL::text, p_who text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.create_automation(p_office, p_slug, p_instruction, p_every_minutes, p_at_time, p_who, p_by) $f$;

create function public.set_automation(p_office uuid, p_automation text, p_on boolean)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.set_automation(p_office, p_automation, p_on) $f$;

create function public.remove_automation(p_office uuid, p_automation text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.remove_automation(p_office, p_automation) $f$;

create function public.project_automations(p_office uuid, p_project_id uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.project_automations(p_office, p_project_id) $f$;

create function public.remove_project_reference(p_office uuid, p_reference_id uuid)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.remove_project_reference(p_office, p_reference_id) $f$;

create function public.hq_attach(p_office uuid, p_slug text, p_connector text, p_ref text, p_role text DEFAULT 'source'::text, p_kind text DEFAULT NULL::text, p_display text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_attach(p_office, p_slug, p_connector, p_ref, p_role, p_kind, p_display, p_by) $f$;

create function public.hq_detach(p_office uuid, p_attachment_id uuid)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_detach(p_office, p_attachment_id) $f$;

create function public.hq_reattach(p_office uuid, p_attachment_id uuid, p_reason text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_reattach(p_office, p_attachment_id, p_reason) $f$;

create function public.hq_connection_choose(p_office uuid, p_slug text, p_connector text, p_choice text, p_reason text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_connection_choose(p_office, p_slug, p_connector, p_choice, p_reason) $f$;

create function public.hq_create_project(p_office uuid, p_name text, p_connector text, p_ref text, p_display text DEFAULT NULL::text, p_force boolean DEFAULT false, p_by text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_create_project(p_office, p_name, p_connector, p_ref, p_display, p_force, p_by) $f$;

create function public.hq_rename_project(p_office uuid, p_slug text, p_name text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_rename_project(p_office, p_slug, p_name) $f$;

create function public.hq_project_look(p_office uuid, p_slug text, p_icon text DEFAULT NULL::text, p_hue text DEFAULT NULL::text, p_image text DEFAULT NULL::text, p_clear text[] DEFAULT ARRAY[]::text[])
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_project_look(p_office, p_slug, p_icon, p_hue, p_image, p_clear) $f$;

create function public.hq_projects(p_office uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_projects(p_office) $f$;

create function public.hq_project_seen(p_office uuid, p_project_id uuid)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_project_seen(p_office, p_project_id) $f$;

create function public.project_team(p_office uuid, p_project_id uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.project_team(p_office, p_project_id) $f$;

create function public.staff_on_project(p_office uuid, p_project_id uuid)
returns text[] language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.staff_on_project(p_office, p_project_id) $f$;

create function public.set_project_instruction(p_office uuid, p_slug text, p_staff_slug text, p_instruction text DEFAULT ''::text, p_by text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.set_project_instruction(p_office, p_slug, p_staff_slug, p_instruction, p_by) $f$;

create function public.set_project_staff(p_office uuid, p_slug text, p_staff_slug text, p_on boolean, p_by text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.set_project_staff(p_office, p_slug, p_staff_slug, p_on, p_by) $f$;

create function public.machine_project_ok(p_office uuid, p_ref text)
returns boolean language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.machine_project_ok(p_office, p_ref) $f$;

create function public.say_in_project(p_office uuid, p_project_id uuid, p_text text, p_addressed_to text DEFAULT NULL::text, p_addressed_also text[] DEFAULT '{}'::text[], p_by text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.say_in_project(p_office, p_project_id, p_text, p_addressed_to, p_addressed_also, p_by) $f$;

create function public.hq_dashboard_layout_reset(p_office uuid, p_slug text, p_surface text DEFAULT 'studio'::text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_dashboard_layout_reset(p_office, p_slug, p_surface) $f$;

create function public.hq_dashboard_layout_set(p_office uuid, p_slug text, p_panels jsonb, p_surface text DEFAULT 'studio'::text)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_dashboard_layout_set(p_office, p_slug, p_panels, p_surface) $f$;

create function public.hq_plane_layout(p_office uuid, p_project_id uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_plane_layout(p_office, p_project_id) $f$;

create function public.hq_plane_layout_reset(p_office uuid, p_project_id uuid)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_plane_layout_reset(p_office, p_project_id) $f$;

create function public.hq_plane_layout_set(p_office uuid, p_project_id uuid, p_at jsonb, p_view jsonb)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_plane_layout_set(p_office, p_project_id, p_at, p_view) $f$;

create function public.hq_workspace_layout(p_office uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_workspace_layout(p_office) $f$;

create function public.hq_workspace_layout_reset(p_office uuid)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_workspace_layout_reset(p_office) $f$;

create function public.hq_workspace_layout_set(p_office uuid, p_panels jsonb)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_workspace_layout_set(p_office, p_panels) $f$;

do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('add_project_reference', 'archive_project', 'unarchive_project', 'create_automation', 'set_automation', 'remove_automation', 'project_automations', 'remove_project_reference', 'hq_attach', 'hq_detach', 'hq_reattach', 'hq_connection_choose', 'hq_create_project', 'hq_rename_project', 'hq_project_look', 'hq_projects', 'hq_project_seen', 'project_team', 'staff_on_project', 'set_project_instruction', 'set_project_staff', 'machine_project_ok', 'say_in_project', 'hq_dashboard_layout_reset', 'hq_dashboard_layout_set', 'hq_plane_layout', 'hq_plane_layout_reset', 'hq_plane_layout_set', 'hq_workspace_layout', 'hq_workspace_layout_reset', 'hq_workspace_layout_set')
              and (pg_get_function_arguments(p.oid)) like 'p_office uuid%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $g$;

-- ------------------------------------------------------------------------------------------------------------------
-- app.hq_undo: the six branches this cluster owns now pass the office (spliced from the definition at apply time)
-- ------------------------------------------------------------------------------------------------------------------
do $m$
declare
  v text;
  pairs text[][] := array[
    ['app.hq_rename_project(v_args ->> ''p_slug'', v_args ->> ''p_name'')', 'app.hq_rename_project(p_office, v_args ->> ''p_slug'', v_args ->> ''p_name'')'],
    ['app.hq_project_look(
        v_args ->> ''p_slug''', 'app.hq_project_look(
        p_office, v_args ->> ''p_slug'''],
    ['app.hq_dashboard_layout_set(v_args ->> ''p_slug'', v_args -> ''p_panels'')', 'app.hq_dashboard_layout_set(p_office, v_args ->> ''p_slug'', v_args -> ''p_panels'')'],
    ['app.hq_dashboard_layout_reset(v_args ->> ''p_slug'')', 'app.hq_dashboard_layout_reset(p_office, v_args ->> ''p_slug'')'],
    ['app.unarchive_project(v_args ->> ''p_slug'')', 'app.unarchive_project(p_office, v_args ->> ''p_slug'')'],
    ['app.hq_reattach((v_args ->> ''p_attachment_id'')::uuid, v_args ->> ''p_reason'')', 'app.hq_reattach(p_office, (v_args ->> ''p_attachment_id'')::uuid, v_args ->> ''p_reason'')']
  ];
  i int; n int;
begin
  v := pg_get_functiondef('app.hq_undo(uuid,text)'::regprocedure);
  for i in 1 .. array_length(pairs, 1) loop
    n := (length(v) - length(replace(v, pairs[i][1], ''))) / length(pairs[i][1]);
    if n <> 1 then
      raise exception 'splice anchor % found % times (want 1): %', i, n, pairs[i][1];
    end if;
    v := replace(v, pairs[i][1], pairs[i][2]);
  end loop;
  execute v;
end $m$;

-- ------------------------------------------------------------------------------------------------------------------
-- the old, ambient signatures go
-- ------------------------------------------------------------------------------------------------------------------
drop function public.add_project_reference(text,text,text,text,text,text);
drop function public.archive_project(text,text);
drop function public.create_automation(text,text,integer,text,text,text);
drop function public.hq_attach(text,text,text,text,text,text,text);
drop function public.hq_connection_choose(text,text,text,text);
drop function public.hq_create_project(text,text,text,text,boolean,text);
drop function public.hq_dashboard_layout_reset(text,text);
drop function public.hq_dashboard_layout_set(text,jsonb,text);
drop function public.hq_detach(uuid);
drop function public.hq_plane_layout(uuid);
drop function public.hq_plane_layout_reset(uuid);
drop function public.hq_plane_layout_set(uuid,jsonb,jsonb);
drop function public.hq_project_look(text,text,text,text,text[]);
drop function public.hq_project_seen(uuid);
drop function public.hq_projects();
drop function public.hq_reattach(uuid,text);
drop function public.hq_rename_project(text,text);
drop function public.hq_workspace_layout();
drop function public.hq_workspace_layout_reset();
drop function public.hq_workspace_layout_set(jsonb);
drop function public.machine_project_ok(text);
drop function public.project_automations(uuid);
drop function public.project_team(uuid);
drop function public.remove_automation(text);
drop function public.remove_project_reference(uuid);
drop function public.say_in_project(uuid,text,text,text[],text);
drop function public.set_automation(text,boolean);
drop function public.set_project_instruction(text,text,text,text);
drop function public.set_project_staff(text,text,boolean,text);
drop function public.staff_on_project(uuid);
drop function public.unarchive_project(text);
drop function app.add_project_reference(text,text,text,text,text,text);
drop function app.archive_project(text,text);
drop function app.create_automation(text,text,integer,text,text,text);
drop function app.hq_attach(text,text,text,text,text,text,text);
drop function app.hq_connection_choose(text,text,text,text);
drop function app.hq_create_project(text,text,text,text,boolean,text);
drop function app.hq_dashboard_layout_reset(text,text);
drop function app.hq_dashboard_layout_set(text,jsonb,text);
drop function app.hq_detach(uuid);
drop function app.hq_plane_layout(uuid);
drop function app.hq_plane_layout_reset(uuid);
drop function app.hq_plane_layout_set(uuid,jsonb,jsonb);
drop function app.hq_project_look(text,text,text,text,text[]);
drop function app.hq_project_seen(uuid);
drop function app.hq_projects();
drop function app.hq_reattach(uuid,text);
drop function app.hq_rename_project(text,text);
drop function app.hq_workspace_layout();
drop function app.hq_workspace_layout_reset();
drop function app.hq_workspace_layout_set(jsonb);
drop function app.machine_project_ok(text);
drop function app.project_automations(uuid);
drop function app.project_team(uuid);
drop function app.remove_automation(text);
drop function app.remove_project_reference(uuid);
drop function app.say_in_project(uuid,text,text,text[],text);
drop function app.set_automation(text,boolean);
drop function app.set_project_instruction(text,text,text,text);
drop function app.set_project_staff(text,text,boolean,text);
drop function app.staff_on_project(uuid);
drop function app.unarchive_project(text);
