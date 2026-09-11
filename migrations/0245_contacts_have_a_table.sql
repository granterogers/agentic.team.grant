-- Contacts have a table (#24), and "Add someone" has something to write to (#99).
--
-- Contacts are in the canonical IA -- `docs/spec/project-dashboard-ia-2026-09-10.md`
-- lists People, Companies, Collaborators, Suppliers and contact notes under
-- CONTACTS -- and there has never been anywhere to put one. `hq_studio()`
-- returns a literal empty array for them, honestly, which is why the section
-- renders an empty state rather than inventing a client.
--
-- Grant, 11 September: *"Make Add someone functional: Open a standard Add
-- Contact form with name, phone number, email, Instagram, and other relevant
-- contact details."*
--
-- ## A party, not a person
--
-- The IA lists companies and suppliers beside people, so `kind` carries which.
-- A supplier with an email and no surname is not a malformed person, and a
-- model that only has people would force one.
--
-- ## Shaped to what the page already renders
--
-- The columns are the fields `web/studio/data.js` already draws on a contact
-- card: name, role, org, stage, email, phone, where, note, plus `next` and
-- `next_due` for the follow-up line. Designing a table and then discovering the
-- renderer wants different words is the "check what the PAGE requests" rule,
-- and it is cheaper to read the renderer first.
--
-- `instagram` is his, explicitly. A generic `handles jsonb` would have been
-- tidier and would have meant the one field he named by name had no column.
--
-- ## is_fixture, generated, like everywhere else
--
-- Harness traffic reported as real was once shown to Grant as the office
-- collapsing. Same rule here, same derivation from the name.

create table if not exists public.contacts (
  contact_id  uuid primary key default extensions.gen_random_uuid(),
  project_id  uuid not null references public.projects(project_id) on delete cascade,
  kind        text not null default 'person',
  name        text not null,
  role        text not null default '',
  org         text not null default '',
  stage       text not null default 'active',
  email       text not null default '',
  phone       text not null default '',
  instagram   text not null default '',
  website     text not null default '',
  "where"     text not null default '',
  note        text not null default '',
  next        text not null default '',
  next_due    text not null default '',
  last_at     timestamptz,
  created_at  timestamptz not null default app.now_utc(),
  updated_at  timestamptz not null default app.now_utc(),
  is_fixture  boolean generated always as (name like 'fixture-%') stored,

  constraint contacts_name_present check (length(btrim(name)) > 0),
  constraint contacts_kind_known check (kind in ('person', 'company', 'collaborator', 'supplier')),
  -- The four the card's pill already knows how to draw.
  constraint contacts_stage_known check (stage in ('active', 'prospect', 'past', 'paused'))
);

comment on table public.contacts is
  'People, companies, collaborators and suppliers attached to a dashboard '
  'project (#24, canonical IA). One row per party per project: the same person '
  'on two projects is two rows, because the relationship is what is being '
  'recorded and it differs.';

create index if not exists contacts_by_project on public.contacts (project_id, name);

create or replace function app.touch_contacts()
returns trigger language plpgsql as $$
begin new.updated_at := app.now_utc(); return new; end $$;

drop trigger if exists contacts_touch on public.contacts;
create trigger contacts_touch before update on public.contacts
  for each row execute function app.touch_contacts();

-- ---------------------------------------------------------------------------
-- Reading them, in the shape the card already draws
-- ---------------------------------------------------------------------------
create or replace function app.studio_contacts(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', c.contact_id,
           'name', c.name,
           'kind', c.kind,
           'role', nullif(c.role, ''),
           'org', nullif(c.org, ''),
           'stage', c.stage,
           'email', nullif(c.email, ''),
           'phone', nullif(c.phone, ''),
           'instagram', nullif(c.instagram, ''),
           'website', nullif(c.website, ''),
           'where', nullif(c."where", ''),
           'note', nullif(c.note, ''),
           'next', nullif(c.next, ''),
           'nextDue', nullif(c.next_due, ''),
           -- The card shows "3 days ago". Absent is absent rather than
           -- "never", because a contact nobody has spoken to yet has no last.
           -- `app.ago`, which already exists and already says "3 days ago".
           -- Grep before you invent applies to functions too.
           'last', case when c.last_at is null then null else app.ago(c.last_at) end
         )) order by c.name), '[]'::jsonb)
    from public.contacts c
   where c.project_id = p_project_id and not c.is_fixture
$$;

-- ---------------------------------------------------------------------------
-- Adding one
-- ---------------------------------------------------------------------------
create or replace function app.hq_contact_add(
  p_project   text,
  p_name      text,
  p_role      text default null,
  p_org       text default null,
  p_email     text default null,
  p_phone     text default null,
  p_instagram text default null,
  p_website   text default null,
  p_kind      text default 'person',
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_name    text := btrim(coalesce(p_name, ''));
  v_kind    text := lower(btrim(coalesce(nullif(p_kind, ''), 'person')));
  v         jsonb;
begin
  if v_name = '' then
    return jsonb_build_object('error', 'a contact needs a name');
  end if;
  if v_kind not in ('person', 'company', 'collaborator', 'supplier') then
    return jsonb_build_object('error', format(
      '%L is not a kind — it is one of person, company, collaborator, supplier', v_kind));
  end if;

  select project_id into v_project
    from public.projects
   where slug = p_project and coalesce(status, '') <> 'archived' and not is_fixture;
  if v_project is null then
    return jsonb_build_object('error', format('no dashboard project called %L', p_project));
  end if;

  -- The same name twice on one project is almost always a mistake rather than
  -- twins. Refused with the name in it, so the answer is obvious.
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
$$;

create or replace function public.hq_contact_add(
  p_project text, p_name text, p_role text default null, p_org text default null,
  p_email text default null, p_phone text default null, p_instagram text default null,
  p_website text default null, p_kind text default 'person', p_note text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_contact_add(p_project, p_name, p_role, p_org, p_email, p_phone,
                                p_instagram, p_website, p_kind, p_note) $$;

create or replace function public.studio_contacts(p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.studio_contacts(p_project_id) $$;
