-- 0534 — a contact can be corrected, can be put away, and can have a face
--
-- Grant, 22 and 23 September 2026:
--
--   "Existing contacts must be editable... change existing data; add missing
--    data; replace/remove the image; add or update website/social information;
--    edit notes... Notes must not be read-only decoration."
--
--   "Use the repository's established storage architecture. Do not store giant
--    base64 images in inappropriate database fields."
--
-- 0245 gave `public.contacts` every column he asked for and exactly one door:
-- you could CREATE one. There has never been an update path, so a typo in an
-- email address was permanent and a note was decoration by construction.
--
-- ============================================================================
-- ABOUT THIS FILE'S NUMBER — read this before merging it anywhere
-- ============================================================================
--
-- This is the UX workstream's branch (`claude/basecamp-team-hq`), which carries
-- migrations 0001–0533. The DATABASE is at 0566, because another workstream
-- (`claude/human-simulation-harness`) has applied 33 more that are not on main
-- and are not here. So this branch has exactly one legal number — 0534 — and
-- that number is ALSO used by that workstream's
-- `0534_the_harness_can_ask_to_see_its_own_projects.sql`, applied on
-- 21 September.
--
-- `app.schema_migrations` is keyed on the NAME, not the number, so the two
-- coexist in the database perfectly well and this applies cleanly. What will
-- surface is a `sequence/duplicate` finding the day the two branches meet.
--
-- THE FIX AT THAT MOMENT IS TO RENAME THIS FILE to the next free number, and
-- everything below is written to make that safe: every statement is idempotent,
-- so re-applying it under a new name changes nothing. Nothing here drops,
-- rewrites or depends on anything that workstream owns — `public.contacts` is
-- untouched by all 33 of their migrations, which was checked rather than
-- assumed.
--
-- ============================================================================
-- WHERE THE PHOTO LIVES
-- ============================================================================
--
-- Not here. The column holds a STORAGE PATH into the private `files` bucket —
-- the same bucket `document_upload` writes to and the same one `hq-api` mints
-- short-lived signed URLs from, so a contact's photograph is no more reachable
-- than a contact's documents are. A data URL in a text column would put a
-- person's photograph in every backup, every query result and every log line
-- that touched the row, which is what Grant's instruction is about.

-- --- the photograph, as a path ---------------------------------------------
alter table public.contacts
  add column if not exists photo_path text;

comment on column public.contacts.photo_path is
  'Storage path in the private files bucket, never the image itself. The '
  'gateway swaps it for a short-lived signed URL on read, exactly as a '
  'document''s file is handled.';

-- Shape only: a path inside the bucket, no scheme, no traversal, no data URL.
alter table public.contacts drop constraint if exists contacts_photo_is_a_path;
alter table public.contacts add constraint contacts_photo_is_a_path check (
  photo_path is null
  or (
    photo_path <> ''
    and photo_path !~ '^[a-z]+:'
    and photo_path !~ '\.\.'
    and length(photo_path) <= 400
  )
);

-- --- putting one away -------------------------------------------------------
--
-- ARCHIVED, NOT DELETED, and for the reason this repository keeps relearning:
-- a contact who has been corresponded with is referred to by the things that
-- happened, and deleting the row makes that history anonymous. `archived_at`
-- is the withdrawal path; the readers exclude it.
alter table public.contacts
  add column if not exists archived_at timestamptz;

comment on column public.contacts.archived_at is
  'When this contact was put away. Readers exclude them; nothing is deleted, '
  'so anything that referred to the person still can.';

-- ============================================================================
-- THE WRITER
-- ============================================================================
--
-- NULL MEANS LEAVE IT ALONE, and the empty string means clear it. Those are
-- different intentions and a writer that cannot tell them apart cannot let
-- somebody remove a phone number they typed by mistake — which is half of what
-- "editable" means.
create or replace function app.hq_contact_update(
  p_contact_id uuid,
  p_name       text default null,
  p_role       text default null,
  p_org        text default null,
  p_email      text default null,
  p_phone      text default null,
  p_website    text default null,
  p_instagram  text default null,
  p_where      text default null,
  p_note       text default null,
  p_kind       text default null,
  p_stage      text default null,
  p_next       text default null,
  p_next_due   text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_was  public.contacts%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_undo uuid;
  v      jsonb;
begin
  select * into v_was from public.contacts where contact_id = p_contact_id;
  if not found then
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
  where contact_id = p_contact_id;

  -- Every other writer on this table offers an undo, so this one does too.
  v_undo := app.undo_offer(
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
    into v from public.contacts where contact_id = p_contact_id;
  return v;
end;
$$;

-- --- the photograph ---------------------------------------------------------
--
-- Takes a PATH, never bytes. The gateway has already put the file in the
-- bucket by the time this is called, which is the same division of labour
-- `document_upload` uses: storage is the edge function's job because the
-- service key lives there, and recording what was stored is the database's.
create or replace function app.hq_contact_photo_set(
  p_contact_id uuid,
  p_path       text
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_was  text;
  v_name text;
  v_undo uuid;
begin
  select photo_path, name into v_was, v_name
    from public.contacts where contact_id = p_contact_id;
  if not found then
    return jsonb_build_object('error', 'no such contact');
  end if;

  update public.contacts
     set photo_path = nullif(btrim(coalesce(p_path, '')), '')
   where contact_id = p_contact_id;

  v_undo := app.undo_offer(
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
$$;

-- --- putting one away, and bringing them back -------------------------------
create or replace function app.hq_contact_archive(
  p_contact_id uuid,
  p_put_away   boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_name text;
  v_was  timestamptz;
  v_undo uuid;
begin
  select name, archived_at into v_name, v_was
    from public.contacts where contact_id = p_contact_id;
  if not found then
    return jsonb_build_object('error', 'no such contact');
  end if;

  update public.contacts
     set archived_at = case when p_put_away then coalesce(archived_at, app.now_utc()) else null end
   where contact_id = p_contact_id;

  v_undo := app.undo_offer(
    'contact.archive',
    format('%s %s', case when p_put_away then 'Put away' else 'Brought back' end, v_name),
    jsonb_build_object('action', 'contact_archive',
                       'args', jsonb_build_object('p_contact_id', p_contact_id,
                                                  'p_put_away', v_was is not null)));

  return jsonb_build_object('ok', true, 'undo', v_undo, 'archived', p_put_away);
end;
$$;

-- ============================================================================
-- THE PUBLIC WRAPPERS — PostgREST only exposes `public`
-- ============================================================================
create or replace function public.hq_contact_update(
  p_contact_id uuid,
  p_name text default null, p_role text default null, p_org text default null,
  p_email text default null, p_phone text default null, p_website text default null,
  p_instagram text default null, p_where text default null, p_note text default null,
  p_kind text default null, p_stage text default null,
  p_next text default null, p_next_due text default null
) returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select app.hq_contact_update(p_contact_id, p_name, p_role, p_org, p_email, p_phone,
                               p_website, p_instagram, p_where, p_note, p_kind,
                               p_stage, p_next, p_next_due);
$$;

create or replace function public.hq_contact_photo_set(p_contact_id uuid, p_path text)
returns jsonb language sql security definer
set search_path to 'public', 'pg_catalog'
as $$ select app.hq_contact_photo_set(p_contact_id, p_path); $$;

create or replace function public.hq_contact_archive(p_contact_id uuid, p_put_away boolean default true)
returns jsonb language sql security definer
set search_path to 'public', 'pg_catalog'
as $$ select app.hq_contact_archive(p_contact_id, p_put_away); $$;

grant execute on function public.hq_contact_update(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.hq_contact_photo_set(uuid, text) to service_role;
grant execute on function public.hq_contact_archive(uuid, boolean) to service_role;

-- ============================================================================
-- AND THE READER LEARNS THE TWO NEW FACTS
-- ============================================================================
--
-- Spliced from the LIVE definition rather than retyped: `app.studio_contacts`
-- belongs to the contacts feature and rewriting it from memory is how four
-- behaviours were lost in one go the last time somebody did that here.
do $splice$
declare
  v_def text;
  v_before text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'studio_contacts';

  if v_def is null then
    raise exception 'app.studio_contacts is not here, so the reader cannot learn the new fields';
  end if;

  -- Already carries it: nothing to do, which is what makes this re-runnable.
  if position('photo_path' in v_def) > 0 then
    return;
  end if;

  v_before := v_def;

  -- The photograph, beside the fields it belongs with. Anchored on the LAST
  -- key of the object rather than on a column name that appears three times:
  -- the first draft of this replaced c.note and would have produced
  -- nullif(c.note, 'photo', ...), which is not what it looked like it did.
  v_def := replace(
    v_def,
    '''fields'', c.fields',
    '''fields'', c.fields,' || chr(10) ||
    '           ''photo'', c.photo_path,' || chr(10) ||
    '           ''away'', (c.archived_at is not null)');

  -- And a contact who has been put away is not in the list.
  v_def := replace(
    v_def,
    'where c.project_id = p_project_id and not c.is_fixture',
    'where c.project_id = p_project_id and not c.is_fixture and c.archived_at is null');

  -- A SPLICE THAT MATCHED NOTHING LOOKS EXACTLY LIKE A SPLICE THAT WORKED.
  -- CLAUDE.md records that in four costumes, so this refuses rather than
  -- applying cleanly and leaving the reader unable to see a photograph.
  if v_def = v_before then
    raise exception 'the reader was not changed: neither anchor was found in app.studio_contacts';
  end if;
  if position('photo_path' in v_def) = 0 or position('archived_at is null' in v_def) = 0 then
    raise exception 'the reader was changed but is missing one of the two new facts';
  end if;

  execute v_def;
end
$splice$;
