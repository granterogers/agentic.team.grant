-- Attach reads the registry.
--
-- Issue #62. `app.hq_attach` — the RPC the build page's Projects tab calls —
-- refuses anything outside a hardcoded list:
--
--     if p_connector not in ('notebooklm', 'notion', 'upload', 'mcp') then
--
-- `knowledge_connectors` is that list, in a table, with an `enabled` flag and a
-- `disabled_reason`. It has seven rows and has had `drive` in it since 0194.
-- So a Drive folder could be attached by RPC and not by clicking, for no reason
-- other than a second copy of the answer living in a function.
--
-- This is the same shape as the routing vocabulary an hour ago: a list in
-- TypeScript that a table already held. Reading the registry means registering
-- a connector is now the whole job of adding one, which is what a registry is
-- for.
--
-- ## And a Drive attachment needs its watch
--
-- `attach_drive_folder` does three things `hq_attach` does not: it extracts the
-- folder id from whatever Grant pasted, refuses a folder another project is
-- already watching, and creates the `drive_watch` row that makes the watcher
-- look at it. An attachment without that row is a folder nobody is watching —
-- which looks exactly like a folder being watched, until nothing is ever
-- reported from it.
--
-- So `hq_attach` delegates rather than duplicating. One implementation of what
-- attaching Drive means.

begin;

create or replace function app.hq_attach(
  p_slug      text,
  p_connector text,
  p_ref       text,
  p_role      text default 'source',
  p_kind      text default null,
  p_display   text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_project uuid;
  v_row     public.project_attachments%rowtype;
begin
  select project_id into v_project from public.projects where slug = p_slug;
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
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
    return app.attach_drive_folder(v_project, p_ref, p_display, 'grant');
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

  return jsonb_build_object(
    'attachment_id', v_row.attachment_id,
    'connector', p_connector,
    'role', p_role);
end;
$$;

comment on function app.hq_attach(text, text, text, text, text, text) is
  'Attach something to a dashboard project. The allowed connectors come from '
  '`knowledge_connectors`, not from a list in here — registering a connector '
  'should be the whole job of adding one (#62). Drive delegates to '
  'attach_drive_folder, which also starts the watch.';

commit;
