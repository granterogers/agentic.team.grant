-- 0067 — a project must attach to something real (ADR-0014)
--
-- Grant: *"you can't start a project on the front end in isolation. Doesn't
-- make any sense. At the very least there should be a minimum requirement that
-- it connects to at least a notebook or a Notion project."*
--
-- Right, and worth making structural rather than a rule in a form handler. A
-- project with no attachment is a row with a name: nothing to read, nowhere to
-- put anything, and no reason for it to exist. The constraint is deferred so a
-- project and its first attachment can be created in one transaction, which is
-- how the front end will do it.
--
-- ## Roles, and the one that matters
--
--   source  — we READ this. Safe, cheap, many allowed.
--   home    — we WRITE here. **At most one per (project, artifact kind).**
--   mirror  — one-way copy, allowed to drift, explicitly not authoritative.
--
-- The `home` uniqueness is the whole of ADR-0014's answer to "no duplicates".
-- Two systems both claiming authorship of one artifact is the only way
-- duplicates happen, and a partial unique index makes it impossible rather than
-- discouraged.
--
-- ## What Grant's correction changes
--
-- He pointed out that Notion and NotebookLM are not symmetrical: *"Notion
-- doesn't really need to push anything out. Notion just kind of stores stuff
-- and we grab things from Notion. Notebook generates things."* That is a
-- sharper reading than ADR-0014 had, and it makes the default obvious:
--
--   Notion     → `source` for documents, `home` for documents (it stores)
--   NotebookLM → `source` for documents, `home` for **artifacts** (it generates)
--   Obsidian   → `mirror` only, and only when asked. Never automatic.
--
-- So `artifact_kind` is a column: a project can hold documents in Notion and
-- have its audio overviews and slide decks generated into a notebook, without
-- either being the home for the other's kind.

begin;

create table public.project_attachments (
  attachment_id       uuid        primary key default gen_random_uuid(),
  project_id          uuid        not null references public.projects (project_id) on delete cascade,
  connector           text        not null references public.knowledge_connectors (connector),

  -- The thing over there: a notebook id, a Notion database id, a vault path.
  external_ref        text        not null,
  -- What it is called over there, for a human reading the front end.
  display_name        text        not null,
  external_url        text,

  role                text        not null,
  -- Which kind of thing this is the home for. Null for a `source`, which is
  -- not the home for anything.
  artifact_kind       text,

  enabled             boolean     not null default true,
  disabled_reason     text,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default app.now_utc(),
  updated_at          timestamptz not null default app.now_utc(),

  constraint project_attachments_role_known
    check (role in ('source', 'home', 'mirror')),
  constraint project_attachments_kind_known
    check (artifact_kind is null or artifact_kind in ('document', 'artifact', 'task')),
  -- A home must say what it is the home for, and a source must not: "the home
  -- for everything" is how one connector quietly becomes the store again.
  constraint project_attachments_home_names_a_kind
    check ((role = 'home') = (artifact_kind is not null)),
  constraint project_attachments_disabled_has_reason
    check (enabled or disabled_reason is not null)
);

create unique index project_attachments_one_per_ref
  on public.project_attachments (project_id, connector, external_ref, role);

-- ADR-0014's rule, enforced rather than documented.
create unique index project_attachments_one_home_per_kind
  on public.project_attachments (project_id, artifact_kind)
  where role = 'home' and enabled;

create index project_attachments_by_project on public.project_attachments (project_id);

create trigger project_attachments_touch_updated_at
  before update on public.project_attachments
  for each row execute function app.touch_updated_at();

comment on table public.project_attachments is
  'Where a project''s work really lives (ADR-0014). A project is an attachment '
  'point, not a container: it reads from many sources and writes to at most one '
  'home per artifact kind, which is the only way "no duplicates" is achievable '
  'rather than aspirational.';

-- --------------------------------------------------------------------------
-- "At least one attachment", enforced at the end of the transaction
-- --------------------------------------------------------------------------

create or replace function app.project_has_an_attachment()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_status text;
  v_count integer;
begin
  v_project := coalesce(new.project_id, old.project_id);

  select status into v_status from public.projects where project_id = v_project;
  -- An archived project keeps its history and needs no live attachment. Only
  -- an active one has to be attached to something.
  if v_status is distinct from 'active' then
    return null;
  end if;

  select count(*) into v_count
    from public.project_attachments a
   where a.project_id = v_project and a.enabled;

  if v_count = 0 then
    raise exception
      'project % is active with no enabled attachment. A project reads from and '
      'writes to somewhere real - attach a notebook, a Notion database or an '
      'upload before activating it (ADR-0014).', v_project
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger projects_need_an_attachment
  after insert or update of status on public.projects
  deferrable initially deferred
  for each row execute function app.project_has_an_attachment();

create constraint trigger attachments_keep_projects_attached
  after delete or update on public.project_attachments
  deferrable initially deferred
  for each row execute function app.project_has_an_attachment();

comment on function app.project_has_an_attachment is
  'Deferred, so a project and its first attachment are one transaction - which '
  'is how the front end will create them. Archived projects are exempt: they '
  'keep their history and need nowhere to write.';

-- --------------------------------------------------------------------------
-- Backfill, so the constraint is true of what already exists
-- --------------------------------------------------------------------------
--
-- Every active project with documents gets a `source` attachment per connector
-- that actually fed it. Derived from the documents rather than assumed, so the
-- backfill states a fact.

insert into public.project_attachments
  (project_id, connector, external_ref, display_name, role)
select distinct
       d.project_id,
       d.connector,
       coalesce(d.external_parent_ref, 'backfill'),
       'Backfilled from existing documents',
       'source'
  from public.documents d
  join public.projects p on p.project_id = d.project_id
 where p.status = 'active' and d.project_id is not null
on conflict do nothing;

-- An active project with no documents at all cannot be attached from evidence,
-- so it is archived rather than given a fabricated attachment. Naming the
-- reason, because a project that quietly changed status is worse than one that
-- failed loudly.
update public.projects p
   set status = 'archived'
 where p.status = 'active'
   and not exists (select 1 from public.project_attachments a where a.project_id = p.project_id);

grant select, insert, update, delete on public.project_attachments to ai_team_app;
alter table public.project_attachments enable row level security;
alter table public.project_attachments force  row level security;
create policy project_attachments_app on public.project_attachments
  for all to ai_team_app using (true) with check (true);

commit;
