-- PENDING: a contact can be corrected, and can have a face
--
-- NOT A MIGRATION OF RECORD, AND NOT APPLIED. It is held here, outside
-- `migrations/`, on purpose.
--
-- This is the UX workstream's branch. It does not own the database, and the
-- main workstream is applying migrations to it daily - it was at 0565 on 23
-- September while this branch carries 533. So this file cannot have a number
-- yet and be honest about it: numbered 0534, where it started, it collides
-- with `0534_the_harness_can_ask_to_see_its_own_projects.sql`, which was
-- applied on 21 September; numbered above that head it leaves a 32-file gap
-- that `check:migrations` refuses, correctly, because the gap is real - those
-- migrations are on main and not here.
--
-- Leaving it in `migrations/` under either number would hand the failure to
-- whoever merges rather than to whoever wrote it, and a numbered file that
-- nobody can apply is worse than an unnumbered one that says so.
--
-- TO LAND IT: docs/basecamp/CONTACTS-BACKEND-HANDOFF.md has the exact steps,
-- the verification, and what it unlocks in the interface.
--
-- Grant, 22 September 2026:
--
--   "Existing contacts must be editable. Grant should be able to open a
--    contact and: change existing data; add missing data; replace/remove the
--    image; add or update website/social information; edit notes; correct
--    details later... Notes must not be read-only decoration. They should be
--    genuinely editable and persisted. The general rule should be: if
--    information about a contact is displayed as user-managed contact data,
--    there should be a sensible way to edit it."
--
-- 0245 gave contacts every column he asked for and exactly one door: you could
-- CREATE one. There has never been an update path, so a typo in an email
-- address was permanent and a note was decoration by construction — which is
-- the "dial with no reader" defect with the sign reversed: data a person can
-- see and cannot change.
--
-- Two things here, and the second is why the first is not simply an UPDATE.
--
-- 1. `image_url`. A contact may have a face. It is stored as text and the
--    writer refuses anything that is not a data URL for an image or an https
--    URL, because this column is rendered into an `img` src by the studio and
--    a column that is rendered is a column that has to be checked at the
--    door. The studio downscales before it sends, so a data URL here is tens
--    of kilobytes rather than megabytes — the size cap below makes that a
--    rule rather than a hope.
--
-- 2. `app.hq_contact_update`. NULL means "leave it alone" and the empty
--    string means "clear it", which is the same vocabulary `hq_task_update`
--    uses (`p_clear` is not needed here because every one of these columns is
--    NOT NULL DEFAULT '' — there is no null to distinguish from an empty).
--    CLAUDE.md's own trap about a sentinel satisfying a constraint and lying
--    does not apply: '' IS the absence for these columns, everywhere, already.
--
-- What this does NOT do: it does not touch `hq_contact_add`. Two writers on
-- one table is how a pre-check comes to exist on one door and not the other
-- (0282/0293, 0365), so the duplicate-name check lives in one place and the
-- updater calls nothing the creator does not.

begin;

alter table public.contacts
  add column if not exists image_url text not null default '';

comment on column public.contacts.image_url is
  'A contact''s face: a downscaled data URL, or an https URL. Checked at the '
  'door because the studio renders it into an img src.';

alter table public.contacts
  drop constraint if exists contacts_image_sane;
alter table public.contacts
  add constraint contacts_image_sane check (
    image_url = ''
    or (image_url like 'data:image/%' and length(image_url) <= 400000)
    or image_url like 'https://%'
  );

-- ---------------------------------------------------------------------------
-- The reader gains the new column
--
-- `create or replace` is safe here: the signature is unchanged, so there is no
-- second overload to make a call ambiguous. CLAUDE.md's warning is about a
-- CHANGED argument list, which this is not.
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
           'image', nullif(c.image_url, ''),
           'last', case when c.last_at is null then null else app.ago(c.last_at) end
         )) order by c.name), '[]'::jsonb)
    from public.contacts c
   where c.project_id = p_project_id and not c.is_fixture
$$;

-- ---------------------------------------------------------------------------
-- Correcting one
-- ---------------------------------------------------------------------------

create or replace function app.hq_contact_update(
  p_contact_id uuid,
  p_name       text default null,
  p_role       text default null,
  p_org        text default null,
  p_email      text default null,
  p_phone      text default null,
  p_instagram  text default null,
  p_website    text default null,
  p_where      text default null,
  p_note       text default null,
  p_next       text default null,
  p_next_due   text default null,
  p_stage      text default null,
  p_kind       text default null,
  p_image      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_now  public.contacts;
  v_name text;
begin
  select * into v_now from public.contacts where contact_id = p_contact_id;
  if not found then
    return jsonb_build_object('error', 'There is no contact with that id.');
  end if;

  -- A name is the one field that may not be emptied: it is what the row IS.
  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_now.name);

  update public.contacts set
    name      = v_name,
    role      = coalesce(p_role, role),
    org       = coalesce(p_org, org),
    email     = coalesce(p_email, email),
    phone     = coalesce(p_phone, phone),
    instagram = coalesce(p_instagram, instagram),
    website   = coalesce(p_website, website),
    "where"   = coalesce(p_where, "where"),
    note      = coalesce(p_note, note),
    next      = coalesce(p_next, next),
    next_due  = coalesce(p_next_due, next_due),
    stage     = coalesce(nullif(btrim(coalesce(p_stage, '')), ''), stage),
    kind      = coalesce(nullif(btrim(coalesce(p_kind, '')), ''), kind),
    image_url = coalesce(p_image, image_url)
  where contact_id = p_contact_id;

  return jsonb_build_object(
    'ok', true,
    'contact_id', p_contact_id,
    'name', v_name
  );
exception
  when check_violation then
    -- The message names the CLASS that was refused, never the value: an image
    -- is not a credential, but the habit of not echoing user input into an
    -- error is worth keeping in one place rather than in the careful ones.
    return jsonb_build_object(
      'error',
      'That change was refused: an image must be a downscaled data URL or an https address, and the stage and kind must be ones the office knows.'
    );
end;
$$;

create or replace function public.hq_contact_update(
  p_contact_id uuid,
  p_name       text default null,
  p_role       text default null,
  p_org        text default null,
  p_email      text default null,
  p_phone      text default null,
  p_instagram  text default null,
  p_website    text default null,
  p_where      text default null,
  p_note       text default null,
  p_next       text default null,
  p_next_due   text default null,
  p_stage      text default null,
  p_kind       text default null,
  p_image      text default null
)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$ select app.hq_contact_update(p_contact_id, p_name, p_role, p_org, p_email,
       p_phone, p_instagram, p_website, p_where, p_note, p_next, p_next_due,
       p_stage, p_kind, p_image) $$;

grant execute on function app.hq_contact_update(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to ai_team_app;
grant execute on function public.hq_contact_update(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to ai_team_app;

commit;
