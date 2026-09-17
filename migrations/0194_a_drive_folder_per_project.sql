-- A Drive folder per project, watched.
--
-- Issue #62. Grant:
--
--     "I want that each project can be assigned a link to a specific location
--      in the Google Drive, and that that is monitored for changes. So anytime
--      I drop a document in there, chief of staff is like, oh, we see that a
--      file has been dropped in Google Drive. What would you like me to do with
--      that?"
--
-- ## Almost nothing new is needed
--
-- He also asked, thinking aloud: *"there's connectors at the project level, and
-- there's connectors at the system level, isn't there?"* There are, and both
-- already exist:
--
--     knowledge_connectors     7 rows    is this service connected at all
--     project_attachments    288 rows    which thing on it is THIS project's
--
-- `project_attachments` already carries `connector`, `external_ref`,
-- `external_url`, `ref_kind`, `role`, `enabled` and `last_synced_at`, and holds
-- 28 notebooks, 4 Notion data sources and 253 uploads. A Drive folder is a row
-- in it. So this migration registers the connector, records where each folder's
-- change feed has got to, and adds the RPCs — it does not invent a model.
--
-- Drive was already an offered OAuth scope in `google_services`
-- (`drive.readonly`) and was never registered as a SOURCE OF DOCUMENTS, which
-- is why it could be authorised and still not be attachable.
--
-- ## Why a page token and not a folder listing
--
-- Drive has a changes feed: you take a start token, and every later call
-- returns what changed since. The obvious alternative — list the folder each
-- pass and diff it — is wrong in a way that only shows up later: a renamed file
-- reads as one deletion and one arrival, and Grant would be asked what to do
-- with a document he already answered about.
--
-- The token is per attachment rather than global, because two projects watching
-- two folders must not share a cursor: whichever ran first would consume the
-- other's changes.
--
-- ## Nothing is ingested. It ASKS.
--
-- *"What would you like me to do with that?"* — so an arrival becomes a
-- question, not an import. Same rule as *"please don't assume I wish to create
-- a new project"*: a file appearing in a folder is not consent to do anything
-- with it.

begin;

-- ---------------------------------------------------------------------------
-- The system level: Drive is a place documents come from
-- ---------------------------------------------------------------------------
insert into public.knowledge_connectors (connector, name, automated, enabled, notes)
values (
  'drive', 'Google Drive', true, true,
  'A folder per project, watched through the changes feed. Read-only: the '
  || 'scope is drive.readonly and nothing here writes to Grant''s Drive.'
)
on conflict (connector) do update
   set name = excluded.name, enabled = true, notes = excluded.notes,
       updated_at = app.now_utc();

-- ---------------------------------------------------------------------------
-- Where each folder's change feed has got to
--
-- Deliberately its own table rather than a column on `project_attachments`:
-- the token is watcher bookkeeping with a different lifetime from the
-- attachment. Detaching and re-attaching a folder should start the watch
-- afresh, and a column would silently carry a stale cursor across.
-- ---------------------------------------------------------------------------
create table if not exists public.drive_watch (
  attachment_id  uuid primary key
                   references public.project_attachments(attachment_id) on delete cascade,
  folder_id      text not null check (length(btrim(folder_id)) > 0),
  page_token     text,

  /*
    The first pass takes a token and reports NOTHING.

    A folder attached today may hold two hundred files put there last year.
    Asking Grant what to do with two hundred historical documents the moment he
    connects a folder is the opposite of useful, and it is what a watcher that
    treats its first listing as arrivals would do. So the first pass only
    establishes the cursor, and `primed` records that it happened.
  */
  primed         boolean not null default false,

  last_checked_at timestamptz,
  last_change_at  timestamptz,
  failures        integer not null default 0,
  last_error      text,
  created_at     timestamptz not null default app.now_utc(),
  updated_at     timestamptz not null default app.now_utc()
);

comment on table public.drive_watch is
  'Where each attached Drive folder''s change feed has got to. Separate from '
  'project_attachments because a re-attach must start the watch afresh rather '
  'than resume a stale cursor.';

comment on column public.drive_watch.primed is
  'The first pass takes a start token and reports nothing — a folder attached '
  'today may hold hundreds of files from last year, and asking about all of '
  'them is not a welcome.';

create index if not exists drive_watch_due on public.drive_watch (last_checked_at);

-- ---------------------------------------------------------------------------
-- Attaching a folder
--
-- Takes the URL, because that is what Grant will paste. Extracting the id here
-- rather than expecting a caller to do it: he will paste
-- `https://drive.google.com/drive/folders/1a2b3c?usp=sharing`, and every caller
-- deriving the id itself is three implementations of one regex.
-- ---------------------------------------------------------------------------
create or replace function app.folder_id_from(p_url text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select nullif(
    coalesce(
      -- .../folders/<id>
      (regexp_match(coalesce(p_url, ''), '/folders/([A-Za-z0-9_-]{10,})'))[1],
      -- ...?id=<id>
      (regexp_match(coalesce(p_url, ''), '[?&]id=([A-Za-z0-9_-]{10,})'))[1],
      -- a bare id, pasted on its own
      (regexp_match(btrim(coalesce(p_url, '')), '^([A-Za-z0-9_-]{10,})$'))[1]
    ), '')
$$;

comment on function app.folder_id_from(text) is
  'The folder id out of whatever Grant pasted — a share link, a query-string '
  'link, or the bare id. One implementation, because three callers deriving it '
  'themselves is three regexes that drift.';

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

  -- One folder per project, and one project per folder. Two projects watching
  -- the same folder would both ask about every arrival, which is the
  -- repetition Grant has complained about twice.
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

  insert into public.project_connector_choices
    (project_id, connector, choice, reason, decided_by)
  values (p_project_id, 'drive', 'use', 'Folder attached by ' || p_by, p_by)
  on conflict (project_id, connector) do update
     set choice = 'use', reason = excluded.reason, decided_by = excluded.decided_by,
         decided_at = app.now_utc();

  return jsonb_build_object(
    'attachment_id', made.attachment_id,
    'folder_id', fid,
    'url', made.external_url);
end;
$$;

comment on function app.attach_drive_folder(uuid, text, text, text) is
  'Give a project its Drive folder. Takes the pasted link (#62).';

-- ---------------------------------------------------------------------------
-- Which folders are due a look
-- ---------------------------------------------------------------------------
create or replace function app.drive_folders_to_check(p_minutes integer default 10)
returns table (
  attachment_id uuid,
  project_id    uuid,
  project_name  text,
  folder_id     text,
  page_token    text,
  primed        boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.attachment_id, a.project_id, p.name, w.folder_id, w.page_token, w.primed
    from public.drive_watch w
    join public.project_attachments a on a.attachment_id = w.attachment_id and a.enabled
    join public.projects p on p.project_id = a.project_id
   where p.status = 'active'
     and not p.is_fixture
     and (w.last_checked_at is null
          or w.last_checked_at <= app.now_utc()
             - make_interval(mins => greatest(coalesce(p_minutes, 10), 1)))
     -- A folder that has failed repeatedly stops being polled and says so,
     -- rather than burning a request every ten minutes for ever.
     and w.failures < 5
   order by w.last_checked_at nulls first
$$;

comment on function app.drive_folders_to_check(integer) is
  'Attached Drive folders due a look. Fixture and inactive projects excluded — '
  'the third place today that rule has had to be written down explicitly.';

create or replace function app.drive_watch_checked(
  p_attachment_id uuid,
  p_page_token    text,
  p_saw_changes   boolean default false,
  p_error         text default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.drive_watch
     set page_token      = coalesce(p_page_token, page_token),
         primed          = primed or p_page_token is not null,
         last_checked_at = app.now_utc(),
         last_change_at  = case when p_saw_changes then app.now_utc() else last_change_at end,
         failures        = case when p_error is null then 0 else failures + 1 end,
         last_error      = p_error,
         updated_at      = app.now_utc()
   where attachment_id = p_attachment_id
$$;

create or replace function public.attach_drive_folder(
  p_project_id uuid, p_url text, p_name text default null, p_by text default 'grant'
)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.attach_drive_folder(p_project_id, p_url, p_name, p_by) $$;

create or replace function public.folder_id_from(p_url text)
returns text language sql immutable security definer set search_path = ''
as $$ select app.folder_id_from(p_url) $$;

commit;
