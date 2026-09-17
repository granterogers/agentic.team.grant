-- The word was `wanted`, and I wrote `use`.
--
-- Issue #62. 0194's `attach_drive_folder` recorded the connector choice as
-- 'use':
--
--     new row for relation "project_connector_choices" violates check
--     constraint "project_connector_choices_choice_check"
--
-- The vocabulary is `wanted` / `declined`, and all 25 existing rows say
-- `wanted`. I invented a third word without reading the table — which is
-- CLAUDE.md's *"guessing column names wastes hours"* in its third variant
-- today: the name was right, the type was right, and the VALUE was guessed.
--
-- Caught by the constraint at the first call, which is the constraint being
-- worth having. A free-text column would have accepted 'use' happily and
-- produced a table where 'use' and 'wanted' both mean wanted, and every query
-- would have had to know that for ever.
--
-- `wanted` is also the more honest word here. Attaching a folder is Grant
-- saying he wants Drive on this project; whether it is actually working is
-- `project_attachments.enabled` and `drive_watch.failures`, which are separate
-- questions and already have their own answers.

begin;

create or replace function app.attach_drive_folder(
  p_project_id uuid,
  p_url        text,
  p_name       text default null,
  p_by         text default 'grant'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  fid      text;
  existing public.project_attachments%rowtype;
  made     public.project_attachments%rowtype;
begin
  fid := app.folder_id_from(p_url);
  if fid is null then
    return jsonb_build_object(
      'error', 'that does not look like a Drive folder link',
      'hint', 'Open the folder in Drive and copy the address bar — it looks '
              || 'like https://drive.google.com/drive/folders/…');
  end if;

  if not exists (select 1 from public.projects where project_id = p_project_id) then
    return jsonb_build_object('error', 'no such project');
  end if;

  select * into existing from public.project_attachments
   where connector = 'drive' and external_ref = fid and enabled;
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
$$;

commit;
