-- 0024 — the Staff Builder, temporary specialists, and prompt versions
--
-- Three things that only make sense together, because each is a way of
-- CHANGING THE TEAM and §21 has one rule about all of them:
--
--   role identity and core prompts are not silently changed.
--
-- 0018 recorded `staff.prompt_version` and left it a bare integer that anyone
-- could increment with nothing attached. A version number with no versioned
-- text behind it records that something changed and destroys what it was -
-- which is worse than not versioning at all, because it looks like an audit
-- trail.
--
-- ## What "not silently" is taken to mean here
--
-- Not "impossible". The system is supposed to be able to recommend a
-- specialist; §9 gives the Chief of Staff that job. The distinction drawn
-- throughout is between changes the system may make about ITS OWN temporary
-- structure and changes to the eight permanent identities, which are Grant's.
-- So:
--
--   * A temporary specialist may be created by the system. It must expire,
--     it must say what gap in the permanent roster justified it, and it can
--     never quietly become permanent.
--   * A permanent role's identity and prompt may not be changed by the
--     application role at all. 0018 already withholds those grants; this file
--     keeps them withheld and adds the versioned history so that a change made
--     through the migration identity is legible afterwards.
--
-- ## The failure this is shaped against
--
-- An agent that can create staff can create staff that agree with it. The cap,
-- the expiry and the recorded justification are all aimed at that: not at
-- stopping a specialist being made, but at stopping a roster growing without
-- anyone deciding it should.

begin;

-- ---------------------------------------------------------------------------
-- Prompt versions
-- ---------------------------------------------------------------------------

create table public.staff_prompts (
  prompt_id     uuid        primary key default gen_random_uuid(),
  staff_id      uuid        not null references public.staff (staff_id),
  version       integer     not null,

  body          text        not null,
  -- Why this version exists. Required, because "what changed" is recoverable
  -- from a diff and "why" never is.
  rationale     text        not null,

  -- Who made it. Free text rather than a staff reference: the honest answer is
  -- often 'migration:0024' or 'grant', neither of which is a staff row.
  authored_by   text        not null,
  created_at    timestamptz not null default app.now_utc(),

  constraint staff_prompts_version_positive check (version >= 1),
  constraint staff_prompts_body_substantive check (length(trim(body)) >= 40),
  constraint staff_prompts_rationale_present check (length(trim(rationale)) >= 10),
  constraint staff_prompts_author_present check (length(trim(authored_by)) > 0),
  unique (staff_id, version)
);

create index staff_prompts_by_staff on public.staff_prompts (staff_id, version desc);

comment on table public.staff_prompts is
  '§21: core prompts are versioned, and a version is an immutable row rather '
  'than an integer on `staff`. A version number with no text behind it records '
  'that something changed while destroying what it was.';

-- Immutable, like every other record of a decision in this schema.
revoke update, delete, truncate on public.staff_prompts from ai_team_app;

create trigger staff_prompts_reject_update
  before update on public.staff_prompts
  for each row execute function app.reject_ledger_mutation();
create trigger staff_prompts_reject_truncate
  before truncate on public.staff_prompts
  for each statement execute function app.reject_ledger_mutation();

-- A prompt version must exist before `staff.prompt_version` can point at it,
-- and the pointer only ever moves forward. Going backwards would make a job's
-- pinned version ambiguous - §6 pins configuration at job start precisely so a
-- past job stays explicable, and that fails if version 2 can mean two things.
create or replace function app.enforce_prompt_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.prompt_version = old.prompt_version then
    return new;
  end if;

  if new.prompt_version < old.prompt_version then
    raise exception
      'staff % prompt_version cannot go backwards (% -> %). A pinned version '
      'must mean one thing forever, or §6''s configuration pinning stops '
      'explaining anything.', new.slug, old.prompt_version, new.prompt_version
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.staff_prompts
    where staff_id = new.staff_id and version = new.prompt_version
  ) then
    raise exception
      'staff % cannot point at prompt version %: no such version exists. §21 '
      'versions the prompt, not the number.', new.slug, new.prompt_version
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create trigger staff_enforce_prompt_version
  before update of prompt_version on public.staff
  for each row execute function app.enforce_prompt_version();

-- ---------------------------------------------------------------------------
-- Temporary specialists
-- ---------------------------------------------------------------------------

alter table public.staff
  add column expires_at timestamptz,
  -- The gap in the permanent roster that justified this specialist. NOT NULL
  -- for temporary staff by the constraint below: "we needed someone" is not a
  -- reason, and a roster grows on reasons like that.
  add column justification text,
  add column requested_for_job uuid references public.jobs (job_id);

alter table public.staff
  add constraint staff_temporary_expires
    check (permanent = (expires_at is null)),
  add constraint staff_temporary_is_justified
    check (
      permanent
      or length(trim(coalesce(justification, ''))) >= 30
    );

comment on column public.staff.expires_at is
  'Set iff the staff member is temporary. A specialist with no end is a ninth '
  'permanent role that nobody decided to create.';
comment on column public.staff.justification is
  'Which gap in the eight permanent roles this specialist fills. Required for '
  'temporary staff: an agent that can create staff can create staff that agree '
  'with it, and a recorded reason is what makes that visible.';

-- A temporary specialist must never quietly become permanent. Promotion is a
-- decision about the shape of the team, which §21 reserves.
create or replace function app.enforce_staff_permanence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.permanent and not old.permanent then
    raise exception
      'staff % cannot be promoted from temporary to permanent. §21 reserves the '
      'shape of the team: a ninth permanent role is Grant''s decision, not a '
      'field update. Create it as permanent, deliberately, if that is what is '
      'wanted.', new.slug
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger staff_enforce_permanence
  before update of permanent on public.staff
  for each row execute function app.enforce_staff_permanence();

-- How many temporary specialists may be alive at once.
create or replace function app.temporary_specialist_slots()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (value #>> '{}')::integer from public.system_config
      where key = 'agents.max_live_specialists'),
    3);
$$;

create or replace function app.enforce_specialist_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_live integer;
  v_max integer;
begin
  if new.permanent or not new.active then
    return new;
  end if;

  v_max := app.temporary_specialist_slots();
  select count(*) into v_live
  from public.staff
  where not permanent and active
    and (expires_at is null or expires_at > app.now_utc())
    and staff_id <> new.staff_id;

  if v_live + 1 > v_max then
    raise exception
      'cannot create temporary specialist %: % of % slots are already in use. '
      '§9 keeps the specialist set small on purpose - a roster that grows '
      'whenever an agent wants a second opinion is how a team stops being one.',
      new.slug, v_live, v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger staff_enforce_specialist_cap
  before insert or update of permanent, active on public.staff
  for each row execute function app.enforce_specialist_cap();

-- Expiry is a sweep rather than a filter in every query, for the same reason
-- the job recovery sweep is: a rule applied at read time is a rule each caller
-- has to remember.
create or replace function app.expire_temporary_staff()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.staff
  set active = false
  where not permanent and active and expires_at is not null
    and expires_at <= app.now_utc();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function app.expire_temporary_staff() is
  'Deactivates temporary specialists past their expiry. Deactivates rather than '
  'deletes: their outputs and consultations still reference them, and a '
  'dangling author is worse than an inactive one.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

alter table public.staff_prompts enable row level security;
alter table public.staff_prompts force  row level security;

grant select on public.staff_prompts to ai_team_app;
create policy staff_prompts_app_read on public.staff_prompts
  for select to ai_team_app using (true);

-- Creating a temporary specialist is something the system may do; rewriting a
-- permanent role is not. Postgres has no column-level INSERT grant that can
-- express "only rows where permanent is false", so the split is enforced by a
-- SECURITY DEFINER function that the app role may call, rather than by a table
-- grant it may not.
create or replace function app.create_temporary_specialist(
  p_slug text,
  p_name text,
  p_title text,
  p_responsibilities text,
  p_expertise text[],
  p_communication_style text,
  p_justification text,
  p_expires_at timestamptz,
  p_job_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_expires_at is null or p_expires_at <= app.now_utc() then
    raise exception
      'a temporary specialist must expire in the future (got %). §9 keeps the '
      'specialist set small, and an expiry in the past would make a permanent '
      'role by accident.', p_expires_at
      using errcode = 'check_violation';
  end if;

  insert into public.staff
    (slug, name, title, permanent, responsibilities, expertise,
     communication_style, justification, expires_at, requested_for_job)
  values
    (p_slug, p_name, p_title, false, p_responsibilities, p_expertise,
     p_communication_style, p_justification, p_expires_at, p_job_id)
  returning staff_id into v_id;

  return v_id;
end;
$$;

comment on function app.create_temporary_specialist is
  'The only route by which the application role may add staff, and it can only '
  'add TEMPORARY staff. `permanent` is hard-coded false here rather than passed '
  'in: a parameter would be an argument, and an argument can be true.';

grant execute on function app.create_temporary_specialist(
  text, text, text, text, text[], text, text, timestamptz, uuid) to ai_team_app;
grant execute on function app.expire_temporary_staff() to ai_team_app;
grant execute on function app.temporary_specialist_slots() to ai_team_app;

insert into public.system_config (key, value, description, self_adjustable) values
  ('agents.max_live_specialists', '3'::jsonb,
   '§9: how many temporary specialists may be active at once. Not self-adjustable - a roster cap an agent can raise is not a cap.', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Backfill: version 1 of the eight permanent prompts
--
-- `staff.prompt_version` has said 1 since 0019 with nothing behind it. These
-- rows are that missing text, assembled from the identity fields 0019 already
-- seeded, so the pointer stops dangling. Marked as authored by this migration
-- rather than by anyone, which is the truth.
-- ---------------------------------------------------------------------------

insert into public.staff_prompts (staff_id, version, body, rationale, authored_by)
select
  s.staff_id, 1,
  'You are ' || s.name || ', ' || s.title || '.' || chr(10) || chr(10) ||
  'Responsibilities: ' || s.responsibilities || chr(10) || chr(10) ||
  'Expertise: ' || array_to_string(s.expertise, ', ') || '.' || chr(10) || chr(10) ||
  'How you communicate: ' || s.communication_style || chr(10) || chr(10) ||
  'Always state whether a claim is verified, inferred or speculative, and say '
  'plainly when the evidence does not support an answer. Surface disagreement '
  'rather than resolving it quietly.',
  'Version 1, assembled by migration 0024 from the identity fields seeded in '
  '0019, so that staff.prompt_version points at real text rather than at nothing.',
  'migration:0024'
from public.staff s
where s.permanent
on conflict (staff_id, version) do nothing;

commit;
