-- 0285 — a label he defined is his, and so is a field he added
--
-- Issue #110, split out of #107, and the last thing in the studio on the wrong
-- side of ADR-0021.
--
-- Grant, on #81, in words that decide this one too:
--
--   > *"Layout is per person, per dashboard project, and persists. Not
--   > `localStorage`: he uses more than one device and the whole point of
--   > arranging it is that it stays arranged."*
--
-- Dashboard arrangements moved in 0250. `web/studio/people.js` did not, and its
-- own header admits it — "localStorage in the prototype... the real shape is
-- filed as #25". Two things are still one cleared browser away from gone:
--
--   * **Labels he defines himself** — *"the ability to attach tags/labels and
--     let me define those labels myself in the UI (e.g. client, coach,
--     colleague, lead)"*.
--   * **Custom fields** — *"metadata fields should be dynamically added/removed
--     on the UI anyway"*.
--
-- Both say the same thing: the shape of a contact is his, not ours.
--
-- ## Now, because `public.contacts` is empty
--
-- Zero rows. Every contact on screen is the prototype's, so there is no
-- migration of existing links to get wrong — which makes this the cheapest it
-- will ever be, not the least urgent.
--
-- ## Keyed on contact_id, never on name
--
-- `people.js` keys `applied` and `fields` on the contact's NAME, and that is
-- wrong the first time two people share one. The links table takes the id.
--
-- ## `labels_set`, which is not redundant
--
-- #107 gave a contact with no labels of its own the ones its `role` already
-- names, so a chip never reads `0` beside four contacts that plainly say
-- Client. That behaviour has two rules and #110 requires both to survive:
--
--   1. the fallback applies only when **nobody has ever decided**, and
--   2. the first touch materialises what was on screen.
--
-- Rule 1 needs to tell "no labels" from "never touched", and an absent row says
-- both. In `localStorage` that was `applied[name] !== undefined`. Here it is a
-- flag on the contact, set by the write path — because a contact Grant has
-- edited down to no labels at all must STAY at none, and without it the derived
-- set comes straight back and the label he removed is unremovable.
--
-- ## The whole set, not a delta
--
-- `hq_contact_labels_set` and `hq_contact_fields_set` each replace the whole
-- value, which is 0250's shape for `p_panels` and is right for the same
-- reasons: it is idempotent, it has an exact inverse for #118's undo, and it
-- cannot half-apply. An index-based "remove the third field" is fragile the
-- moment two devices are open.
--
-- ## `fields` is jsonb for 0250's reason, restated
--
--   > Modelling five integers as five columns would put the page's layout
--   > vocabulary in the schema.
--
-- A user-defined field is that argument at its strongest: the whole point is
-- that Grant invents the field, so a column per field is a migration per
-- thought.

begin;

-- ---------------------------------------------------------------------------
-- 1. The labels
-- ---------------------------------------------------------------------------

create table if not exists public.contact_labels (
  label_id   uuid        not null default extensions.gen_random_uuid(),
  owner      text        not null default 'grant',
  name       text        not null,
  hue        text        not null default 'p-slate',
  sort       int         not null default 0,
  created_at timestamptz not null default app.now_utc(),
  primary key (owner, label_id),
  constraint contact_labels_name_is_said check (btrim(name) <> ''),
  -- The six the design system defines. A hue outside them renders as no colour
  -- at all, which looks like a broken chip rather than a rejected value.
  constraint contact_labels_hue_known
    check (hue in ('p-rust', 'p-amber', 'p-moss', 'p-slate', 'p-iris', 'p-plum'))
);

/*
  One label per name per person.

  Not because a duplicate breaks anything mechanically — it does not — but
  because two chips both reading "Client" is a filter Grant cannot use, and he
  would have to work out which one he had applied to whom. Normalised, so
  "client" does not become a second "Client".
*/
create unique index if not exists contact_labels_one_per_name
  on public.contact_labels (owner, app.normalise_name(name));

alter table public.contact_labels enable row level security;

create table if not exists public.contact_label_links (
  contact_id uuid not null references public.contacts (contact_id) on delete cascade,
  owner      text not null default 'grant',
  label_id   uuid not null,
  created_at timestamptz not null default app.now_utc(),
  primary key (contact_id, label_id),
  foreign key (owner, label_id) references public.contact_labels (owner, label_id)
    on delete cascade
);

create index if not exists contact_label_links_by_label
  on public.contact_label_links (owner, label_id);

alter table public.contact_label_links enable row level security;

-- ---------------------------------------------------------------------------
-- 2. The fields, and the flag that keeps #107 honest
-- ---------------------------------------------------------------------------

alter table public.contacts
  add column if not exists fields jsonb not null default '[]'::jsonb,
  add column if not exists labels_set boolean not null default false;

alter table public.contacts
  drop constraint if exists contacts_fields_is_a_list;
alter table public.contacts
  add constraint contacts_fields_is_a_list
  check (jsonb_typeof(fields) = 'array');

comment on column public.contacts.labels_set is
  '#110. True once Grant has decided this contact''s labels, even if he decided '
  'on none. Distinguishes "no labels" from "never touched", which #107''s '
  'derived-label fallback needs and which an absent link row cannot say — '
  'without it, a label he removes comes straight back and is unremovable.';

comment on column public.contacts.fields is
  '#110. Fields Grant added himself: [{label, value}]. jsonb rather than '
  'columns for 0250''s reason at its strongest — the whole point is that he '
  'invents the field, so a column per field is a migration per thought.';

-- ---------------------------------------------------------------------------
-- 3. The five he starts with
-- ---------------------------------------------------------------------------
--
-- Seeded so the page behaves identically on the first load after this lands.
-- Every one is his to rename or delete; they are a starting point, not a
-- vocabulary we are imposing.

insert into public.contact_labels (owner, name, hue, sort)
values ('grant', 'Client', 'p-moss', 0),
       ('grant', 'Lead', 'p-amber', 1),
       ('grant', 'Coach', 'p-iris', 2),
       ('grant', 'Colleague', 'p-slate', 3),
       ('grant', 'Referrer', 'p-rust', 4)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Reading
-- ---------------------------------------------------------------------------

/** Grant's label set, in the order he arranged it. */
create or replace function app.contact_labels(p_owner text default 'grant')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.label_id, 'name', l.name, 'hue', l.hue
         ) order by l.sort, l.name), '[]'::jsonb)
    from public.contact_labels l
   where l.owner = coalesce(nullif(btrim(p_owner), ''), 'grant')
$$;

create or replace function public.contact_labels(p_owner text default 'grant')
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.contact_labels(p_owner) $$;

/*
  Patched from `pg_get_functiondef`, not rewritten from memory: everything above
  `labels` is exactly what 0245 wrote, and three keys are added.

  `jsonb_strip_nulls` is why `labelsSet` is a boolean and never null — stripped
  out, the page could not tell false from absent, which is the one distinction
  the whole flag exists to make.
*/
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
           'last', case when c.last_at is null then null else app.ago(c.last_at) end,
           -- #110. The ids only: the page already holds the label set, and
           -- repeating a name and a hue on every contact is the same string
           -- twenty times in one payload.
           'labels', coalesce((select jsonb_agg(k.label_id)
                                 from public.contact_label_links k
                                where k.contact_id = c.contact_id), '[]'::jsonb),
           'labelsSet', c.labels_set,
           'fields', c.fields
         )) order by c.name), '[]'::jsonb)
    from public.contacts c
   where c.project_id = p_project_id and not c.is_fixture
$$;

-- ---------------------------------------------------------------------------
-- 5. Writing
-- ---------------------------------------------------------------------------

/** A label Grant defines. Returns the whole set, so the page redraws from truth. */
create or replace function app.hq_contact_label_add(p_name text, p_hue text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_hue  text := nullif(btrim(coalesce(p_hue, '')), '');
  v_id   uuid;
begin
  if v_name = '' then
    return jsonb_build_object('error', 'a label needs a name');
  end if;

  select label_id into v_id from public.contact_labels
   where owner = 'grant' and app.normalise_name(name) = app.normalise_name(v_name);
  if v_id is not null then
    return jsonb_build_object('error', format('there is already a label called %L', v_name));
  end if;

  /*
    The next hue in the ring rather than a random one, matching what the page
    did: `HUES[labels.length % HUES.length]`. Two labels created in a row should
    look different, which a random pick does not guarantee.
  */
  insert into public.contact_labels (owner, name, hue, sort)
  values ('grant', v_name,
          coalesce(v_hue, (array['p-rust', 'p-amber', 'p-moss', 'p-slate', 'p-iris', 'p-plum'])[
            (select count(*) from public.contact_labels where owner = 'grant') % 6 + 1]),
          coalesce((select max(sort) + 1 from public.contact_labels where owner = 'grant'), 0))
  returning label_id into v_id;

  return jsonb_build_object('ok', true, 'label', v_id, 'labels', app.contact_labels('grant'));
end;
$$;

create or replace function app.hq_contact_label_rename(p_label_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_was  text;
  v_undo uuid;
begin
  if v_name = '' then
    return jsonb_build_object('error', 'a label needs a name');
  end if;

  select name into v_was from public.contact_labels
   where owner = 'grant' and label_id = p_label_id;
  if v_was is null then
    return jsonb_build_object('error', 'no such label');
  end if;

  if exists (select 1 from public.contact_labels
              where owner = 'grant' and label_id <> p_label_id
                and app.normalise_name(name) = app.normalise_name(v_name)) then
    return jsonb_build_object('error', format('there is already a label called %L', v_name));
  end if;

  update public.contact_labels set name = v_name
   where owner = 'grant' and label_id = p_label_id;

  -- The exact inverse, recorded while the previous value is still known (#118).
  v_undo := app.undo_offer(
    'contact.label_rename',
    format('Renamed the label %s to %s', v_was, v_name),
    jsonb_build_object('action', 'contact_label_rename',
                       'args', jsonb_build_object('p_label_id', p_label_id,
                                                  'p_name', v_was)));

  return jsonb_build_object('ok', true, 'undo', v_undo,
                            'labels', app.contact_labels('grant'));
end;
$$;

/** Deleting a label removes it from everyone, rather than leaving orphan ids. */
create or replace function app.hq_contact_label_remove(p_label_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_n int;
begin
  if not exists (select 1 from public.contact_labels
                  where owner = 'grant' and label_id = p_label_id) then
    return jsonb_build_object('error', 'no such label');
  end if;

  select count(*) into v_n from public.contact_label_links
   where owner = 'grant' and label_id = p_label_id;

  -- The links go with it, by the foreign key's cascade.
  delete from public.contact_labels where owner = 'grant' and label_id = p_label_id;

  /*
    No undo offered, and that is deliberate rather than an omission.

    #118's rule is that an offer is made only where the inverse is EXACT.
    Recreating the label would give it a new id, so every contact it was on
    stays unlabelled and the reversal silently does less than it says. The
    honest answer is to say so, which `undo_none` is for.
  */
  perform app.undo_none(
    'contact.label_remove',
    format('Deleted a label — putting it back would give it a new id, so the %s '
           || 'contact(s) it was on would stay unlabelled', v_n));

  return jsonb_build_object('ok', true, 'removed_from', v_n, 'undo', null,
                            'labels', app.contact_labels('grant'));
end;
$$;

/**
 * The labels on one contact, as a whole set.
 *
 * A replacement rather than a toggle, for 0250's reasons: idempotent, exactly
 * invertible, and impossible to half-apply. The page computes the new set —
 * including #107's "first touch materialises what was on screen" — and sends
 * it; `labels_set` records that a decision now exists, which is what stops the
 * derived set coming back.
 */
create or replace function app.hq_contact_labels_set(p_contact_id uuid, p_labels jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ids  uuid[];
  v_was  jsonb;
  v_bad  int;
  v_undo uuid;
begin
  if not exists (select 1 from public.contacts where contact_id = p_contact_id) then
    return jsonb_build_object('error', 'no such contact');
  end if;
  if p_labels is null or jsonb_typeof(p_labels) <> 'array' then
    return jsonb_build_object('error', 'labels must be an array of label ids');
  end if;

  select coalesce(array_agg((e #>> '{}')::uuid), array[]::uuid[]) into v_ids
    from jsonb_array_elements(p_labels) e;

  select count(*) into v_bad from unnest(v_ids) id
   where not exists (select 1 from public.contact_labels
                      where owner = 'grant' and label_id = id);
  if v_bad > 0 then
    return jsonb_build_object('error', format('%s of those labels do not exist', v_bad));
  end if;

  select coalesce(jsonb_agg(label_id), '[]'::jsonb) into v_was
    from public.contact_label_links where contact_id = p_contact_id;

  delete from public.contact_label_links where contact_id = p_contact_id;
  insert into public.contact_label_links (contact_id, owner, label_id)
  select p_contact_id, 'grant', id from unnest(v_ids) id;

  update public.contacts set labels_set = true where contact_id = p_contact_id;

  v_undo := app.undo_offer(
    'contact.labels',
    format('Changed the labels on %s',
           (select name from public.contacts where contact_id = p_contact_id)),
    jsonb_build_object('action', 'contact_labels_set',
                       'args', jsonb_build_object('p_contact_id', p_contact_id,
                                                  'p_labels', v_was)));

  return jsonb_build_object('ok', true, 'undo', v_undo, 'labels', to_jsonb(v_ids));
end;
$$;

/**
 * The fields on one contact, as a whole set.
 *
 * Every entry must be `{label, value}` with a label that says something, and a
 * single bad entry writes nothing — 0250's rule for `p_panels`, for the same
 * reason: a half-saved set is worse than an unsaved one.
 */
create or replace function app.hq_contact_fields_set(p_contact_id uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_was  jsonb;
  v_bad  int;
  v_undo uuid;
begin
  if not exists (select 1 from public.contacts where contact_id = p_contact_id) then
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

  select fields into v_was from public.contacts where contact_id = p_contact_id;
  update public.contacts set fields = p_fields where contact_id = p_contact_id;

  v_undo := app.undo_offer(
    'contact.fields',
    format('Changed the fields on %s',
           (select name from public.contacts where contact_id = p_contact_id)),
    jsonb_build_object('action', 'contact_fields_set',
                       'args', jsonb_build_object('p_contact_id', p_contact_id,
                                                  'p_fields', v_was)));

  return jsonb_build_object('ok', true, 'undo', v_undo, 'fields', p_fields);
end;
$$;

-- PostgREST only exposes `public`.
create or replace function public.hq_contact_label_add(p_name text, p_hue text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_contact_label_add(p_name, p_hue) $$;

create or replace function public.hq_contact_label_rename(p_label_id uuid, p_name text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_contact_label_rename(p_label_id, p_name) $$;

create or replace function public.hq_contact_label_remove(p_label_id uuid)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_contact_label_remove(p_label_id) $$;

create or replace function public.hq_contact_labels_set(p_contact_id uuid, p_labels jsonb)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_contact_labels_set(p_contact_id, p_labels) $$;

create or replace function public.hq_contact_fields_set(p_contact_id uuid, p_fields jsonb)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_contact_fields_set(p_contact_id, p_fields) $$;

grant execute on function app.contact_labels(text) to ai_team_app;
grant execute on function public.contact_labels(text) to ai_team_app;
grant execute on function app.hq_contact_label_add(text, text) to ai_team_app;
grant execute on function public.hq_contact_label_add(text, text) to ai_team_app;
grant execute on function app.hq_contact_label_rename(uuid, text) to ai_team_app;
grant execute on function public.hq_contact_label_rename(uuid, text) to ai_team_app;
grant execute on function app.hq_contact_label_remove(uuid) to ai_team_app;
grant execute on function public.hq_contact_label_remove(uuid) to ai_team_app;
grant execute on function app.hq_contact_labels_set(uuid, jsonb) to ai_team_app;
grant execute on function public.hq_contact_labels_set(uuid, jsonb) to ai_team_app;
grant execute on function app.hq_contact_fields_set(uuid, jsonb) to ai_team_app;
grant execute on function public.hq_contact_fields_set(uuid, jsonb) to ai_team_app;

grant select, insert, update, delete on public.contact_labels to ai_team_app;
grant select, insert, update, delete on public.contact_label_links to ai_team_app;

-- ---------------------------------------------------------------------------
-- 6. The page gets the label set with everything else
-- ---------------------------------------------------------------------------
--
-- In `hq_studio`'s existing payload rather than a second fetch, for the reason
-- 0270 gives about `health`: a second fetch is a second thing that can fail on
-- its own, and the way it fails is by quietly returning nothing — which renders
-- as a contacts tab with no labels at all, indistinguishable from a person who
-- has not defined any.
--
-- Patched in with a wrapper rather than by restating 700 lines of `hq_studio`:
-- the label set is a top-level key and does not belong inside the per-project
-- CTE, so `||` on the result is exactly the right shape and leaves the function
-- 0270 wrote untouched.

alter function app.hq_studio() rename to hq_studio_core;

create or replace function app.hq_studio()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select app.hq_studio_core()
      || jsonb_build_object('contactLabels', app.contact_labels('grant'))
$$;

comment on function app.hq_studio is
  '#110. The studio payload, plus the labels Grant defined for contacts. A '
  'wrapper rather than an edit so the core function stays the one 0222 built '
  'section by section; a top-level key does not belong in its per-project CTE.';

grant execute on function app.hq_studio_core() to ai_team_app;

-- ---------------------------------------------------------------------------
-- 7. Undo can perform the three reversals recorded above
-- ---------------------------------------------------------------------------
--
-- Patched from `pg_get_functiondef`. The `else` branch raises on a reversal it
-- cannot perform, deliberately, so recording an inverse without teaching this
-- function to run it turns Undo into a button that consumes the offer and does
-- nothing. Adding the three cases IS the other half of section 5.

create or replace function app.hq_undo(p_action_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id       uuid;
  v_action   public.undoable_actions;
  v_outcome  public.undo_status;
  v_args     jsonb;
  v_did      jsonb;
begin
  begin
    v_id := p_action_id::uuid;
  exception when others then
    return jsonb_build_object('error', 'that is not an action id');
  end;

  select * into v_action from public.undoable_actions where action_id = v_id;
  if not found then
    return jsonb_build_object('error', 'there is nothing here to undo');
  end if;

  v_outcome := app.request_undo(v_id, 'grant', 'studio');

  if v_outcome <> 'undone' then
    -- Not a failure. A lapsed offer and an already-undone action are both
    -- normal, and both need words the page can show without alarm.
    return jsonb_build_object('ok', false, 'outcome', v_outcome,
      'note', case v_outcome
        when 'expired'      then 'That offer has lapsed.'
        when 'not_undoable' then 'That one cannot be undone.'
        else 'Already undone.' end);
  end if;

  /*
    From here on we are performing the reversal, and nothing it calls may
    record an undo of its own. Transaction-local, so it lifts by itself.
  */
  perform set_config('app.undoing', '1', true);

  v_args := v_action.reversal -> 'args';
  case v_action.reversal ->> 'action'
    when 'rename_project' then
      v_did := app.hq_rename_project(v_args ->> 'p_slug', v_args ->> 'p_name');
    when 'task_state' then
      v_did := app.hq_task_state(v_args ->> 'p_task_id', v_args ->> 'p_state',
                                 v_args ->> 'p_reason');
    when 'task_update' then
      v_did := app.hq_task_update(
        v_args ->> 'p_task_id', v_args ->> 'p_title', v_args ->> 'p_detail',
        (v_args ->> 'p_due_on')::date, (v_args ->> 'p_starts_on')::date,
        v_args ->> 'p_assignee', v_args ->> 'p_parent',
        (v_args ->> 'p_milestone')::boolean, (v_args ->> 'p_priority')::int,
        coalesce(
          (select array_agg(x #>> '{}') from jsonb_array_elements(v_args -> 'p_clear') x),
          array[]::text[]));
    when 'project_look' then
      v_did := app.hq_project_look(
        v_args ->> 'p_slug', v_args ->> 'p_icon', v_args ->> 'p_hue', null,
        coalesce(
          (select array_agg(x #>> '{}') from jsonb_array_elements(v_args -> 'p_clear') x),
          array[]::text[]));
    when 'dashboard_layout_set' then
      v_did := app.hq_dashboard_layout_set(v_args ->> 'p_slug', v_args -> 'p_panels');
    when 'dashboard_layout_reset' then
      v_did := app.hq_dashboard_layout_reset(v_args ->> 'p_slug');
    when 'reattach' then
      v_did := app.hq_reattach((v_args ->> 'p_attachment_id')::uuid, v_args ->> 'p_reason');
    -- #110, migration 0285.
    when 'contact_label_rename' then
      v_did := app.hq_contact_label_rename((v_args ->> 'p_label_id')::uuid,
                                           v_args ->> 'p_name');
    when 'contact_labels_set' then
      v_did := app.hq_contact_labels_set((v_args ->> 'p_contact_id')::uuid,
                                         v_args -> 'p_labels');
    when 'contact_fields_set' then
      v_did := app.hq_contact_fields_set((v_args ->> 'p_contact_id')::uuid,
                                         v_args -> 'p_fields');
    else
      -- A reversal naming something this function cannot perform is a bug in
      -- whoever recorded it, and raising rolls back the claim so the offer is
      -- not silently consumed.
      raise exception 'no way to perform the reversal %', v_action.reversal ->> 'action'
        using errcode = 'feature_not_supported';
  end case;

  /*
    The inner RPCs answer a refusal as `{"error": ...}` rather than raising.
    Left alone, that would leave the action marked undone with nothing
    reversed — the worst outcome available, because the interface would say it
    worked. Raise, so the claim rolls back with it and the offer survives.
  */
  if v_did ? 'error' then
    raise exception 'could not undo: %', v_did ->> 'error'
      using errcode = 'raise_exception';
  end if;

  return jsonb_build_object('ok', true, 'outcome', 'undone',
    'kind', v_action.kind, 'note', format('Undone — %s', v_action.description));
end;
$$;

commit;
