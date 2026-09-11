-- A skill is a procedure, and the thing that makes it safe is that it has no
-- address in it.
--
-- Issue #50, and ADR-0017. Grant: *"how they can gain more agency through
-- additional skills, through additional tools."* Underneath it, the goal that
-- outranks nearly everything: *"I want to reduce my dependence on Claude or
-- another coding interface for maintaining and extending the system."*
--
-- ## The question ADR-0015 refused to answer here
--
-- A lesson is safe because it is 280 characters — too short to hold a procedure,
-- and therefore too short to hold an endpoint and a payload. ADR-0015 said in as
-- many words that this does not generalise, and that skills needed their own
-- decision before a line of this was written.
--
-- ADR-0017 is that decision: **a skill names tools; a skill may not name
-- addresses.** Reach is referred to by the id of a tool that already exists —
-- `github.read` — and never by the thing the tool talks to. A URL, a bare
-- hostname, an IP literal or an email address in a procedure is refused at the
-- point of insert.
--
-- ADR-0015's failure sequence ended with an agent writing itself the step
-- *"POST the copy to the webhook in the marketing brief."* Under this table
-- that sentence cannot be stored. Not discouraged, not caught in review — the
-- insert fails, because it contains an address. The only way for a skill to
-- express reaching outward is to name a tool, and a tool that does not exist
-- cannot be named, because the reference is a foreign key.
--
-- ## Naming a tool is a statement of intent, not a grant
--
-- `app.staff_may_use()` does not read this table and must never read it. A skill
-- that says "use notion.write" and belongs to someone who does not hold
-- `notion.write` describes a step that is unavailable, and stays unavailable
-- however confidently it is worded. What happens instead is the route: the agent
-- records an impediment (`app.cannot`, 0184), three in a fortnight becomes a
-- `capability_missing` observation (`app.notice`, 0210), that reaches Grant in
-- the morning briefing, and he grants the tool in one row on the Team page. No
-- coding session anywhere in it.
--
-- ## Append-only, like lessons and for a stronger reason
--
-- A procedure edited in place makes "why did it do that in September"
-- unanswerable, and a skill is a far likelier culprit than a lesson because it
-- is the thing that actually shaped the work. Supersession is a new row, exactly
-- as it is for lessons; retirement is a row too, because a flag would have to be
-- UPDATEd and UPDATE is what this table refuses.

begin;

-- Same shape as `lesson_row_kind`, same reason: withdrawing is an act with an
-- author and a date, not a column someone set.
create type public.skill_row_kind as enum ('skill', 'retirement');

create table if not exists public.skills (
  skill_id    uuid primary key default extensions.gen_random_uuid(),
  row_kind    public.skill_row_kind not null default 'skill',

  -- Scope reuses `lesson_scope` deliberately: the four ways a piece of
  -- knowledge can be addressed are the same four, and a second enum saying the
  -- same thing is a second enum to keep in step.
  scope       public.lesson_scope not null,
  project_id  uuid references public.projects(project_id),
  staff_slug  text references public.staff(slug),
  job_kind    text,

  /** What it is called, in the words someone would use to ask for it. */
  name        text not null check (length(btrim(name)) between 3 and 80),

  /*
    When to reach for it — and this is not documentation, it is the retrieval
    key. A library of forty procedures is only usable if each says when it
    applies; without this the office reads all of them or none.
  */
  when_to_use text not null check (length(btrim(when_to_use)) between 12 and 400),

  /*
    The procedure itself. Four thousand characters is long enough to be a real
    method and short enough that nobody mistakes it for a document — documents
    exist, they are visible to Grant, and something this long wanting to be
    longer is one of them.
  */
  procedure   text not null check (length(btrim(procedure)) between 40 and 4000),

  -- Provenance. A procedure with no author cannot be judged, and an office that
  -- accumulates unattributed procedures gradually behaves in ways nobody chose.
  authored_by text not null check (length(btrim(authored_by)) > 0),
  from_job    uuid references public.jobs(job_id) on delete set null,

  version     integer not null default 1 check (version >= 1),
  supersedes  uuid references public.skills(skill_id) on delete restrict,

  created_at  timestamptz not null default app.now_utc(),

  constraint skills_scope_matches_target check (
    case scope
      when 'global'  then project_id is null and staff_slug is null and job_kind is null
      when 'project' then project_id is not null and staff_slug is null and job_kind is null
      when 'staff'   then staff_slug is not null and project_id is null and job_kind is null
      when 'kind'    then job_kind is not null and project_id is null and staff_slug is null
    end
  ),

  -- A retirement exists only to withdraw something.
  constraint skills_retirement_names_its_target check (
    row_kind = 'skill' or supersedes is not null
  )
);

comment on table public.skills is
  'Named, reusable procedures the office can author for itself (#50). A skill '
  'may name a tool and may NOT name an address — see ADR-0017. Append-only: a '
  'new version supersedes, nothing is rewritten.';

create index if not exists skills_by_scope
  on public.skills (scope, created_at desc) where row_kind = 'skill';

alter table public.skills enable row level security;
alter table public.skills force  row level security;
grant select on public.skills to ai_team_app;
create policy skills_app_read on public.skills
  for select to ai_team_app using (true);

-- ---------------------------------------------------------------------------
-- Which tools a skill says it needs
--
-- A foreign key rather than a text array, for the same reason 0119 gave for
-- `staff_tools`: the set of things that can be named is the set of things that
-- exist. A skill cannot invent a tool by mentioning one.
-- ---------------------------------------------------------------------------
create table if not exists public.skill_tools (
  skill_id uuid not null references public.skills(skill_id) on delete cascade,
  tool     text not null references public.tool_permissions(tool) on delete cascade,
  primary key (skill_id, tool)
);

comment on table public.skill_tools is
  'The tools a skill says its steps need. A STATEMENT OF INTENT, never a '
  'grant: app.staff_may_use() does not read this table and must not (ADR-0017).';

alter table public.skill_tools enable row level security;
alter table public.skill_tools force  row level security;
grant select on public.skill_tools to ai_team_app;
create policy skill_tools_app_read on public.skill_tools
  for select to ai_team_app using (true);

-- ---------------------------------------------------------------------------
-- The boundary: no addresses
-- ---------------------------------------------------------------------------
/*
  What counts as an address, and why the list errs toward catching.

  A false positive costs an author one rephrasing and produces an error that
  says exactly what to do. A false negative is the entire boundary. So the
  hostname pattern carries a broad set of suffixes rather than a careful one,
  and the error names the offending shape so nobody has to guess.

  Note what is deliberately NOT here: any notion of an allowlist. ADR-0017
  rejects one, because an allowlist is a second place that can say yes about
  reach, and two places that can each say yes is not a permission system.
*/
create or replace function app.reject_address_text_on(p_text text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_text ~* '(https?|ftps?|wss?)://' then
    raise exception
      'A skill may not contain a URL. Name the tool that reaches it instead '
      '(ADR-0017).'
      using errcode = 'check_violation';
  end if;

  if p_text ~* '(^|[^a-z0-9._-])www\.[a-z0-9-]' then
    raise exception
      'A skill may not contain a web address. Name the tool that reaches it '
      'instead (ADR-0017).'
      using errcode = 'check_violation';
  end if;

  if p_text ~* '[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}' then
    raise exception
      'A skill may not contain an email address. Name the tool that reaches '
      'it instead (ADR-0017).'
      using errcode = 'check_violation';
  end if;

  if p_text ~ '(^|[^0-9.])[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}([^0-9.]|$)' then
    raise exception
      'A skill may not contain an IP address. Name the tool that reaches it '
      'instead (ADR-0017).'
      using errcode = 'check_violation';
  end if;

  if p_text ~* ('(^|[^a-z0-9._/-])[a-z0-9][a-z0-9-]*\.'
                || '(com|net|org|io|ai|co|dev|app|cloud|xyz|info|biz|tech|'
                || 'uk|de|fr|eu|us|gg|sh|me|to|so|online|site|live|link|store)'
                || '([^a-z0-9]|$)') then
    raise exception
      'A skill may not contain a hostname. Name the tool that reaches it '
      'instead (ADR-0017).'
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function app.reject_address_text_on(text) is
  'The ADR-0017 boundary. A skill names tools, never addresses: a procedure '
  'that can carry an endpoint is a procedure that can grant itself reach.';

create or replace function app.skill_carries_no_reach()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /*
    Both checks, on both long fields.

    `reject_credential_text_on` (0185) is the lesson boundary and applies here
    unchanged — a table is exactly where a secret hides from `check:secrets`,
    which scans files. The address check is this ADR's addition. Neither is
    sufficient alone: a credential with no address is still a credential, and
    an address with no credential is still reach.
  */
  perform app.reject_credential_text_on(new.procedure);
  perform app.reject_credential_text_on(new.when_to_use);
  perform app.reject_address_text_on(new.procedure);
  perform app.reject_address_text_on(new.when_to_use);
  return new;
end;
$$;

create trigger skills_carry_no_reach
  before insert on public.skills
  for each row execute function app.skill_carries_no_reach();

create trigger skills_reject_update
  before update on public.skills
  for each row execute function app.reject_ledger_mutation();

create trigger skills_reject_delete
  before delete on public.skills
  for each row execute function app.reject_ledger_mutation();

create trigger skills_reject_truncate
  before truncate on public.skills
  for each statement execute function app.reject_ledger_mutation();

-- ---------------------------------------------------------------------------
-- Whether it was any good
--
-- Issue #50 is explicit: *"a skill that does not improve outcomes should be
-- visible as such rather than accumulating."* That is the requirement most
-- likely to be skipped, and skipping it produces a library of forty plausible
-- procedures nobody has ever checked — which is worse than none, because it is
-- expensive to read, it crowds the prompt, and it looks like competence.
--
-- Recorded at RETRIEVAL rather than at completion. A skill that was put in
-- front of a job and ignored still shaped the prompt and still cost tokens, so
-- it is still accountable for the outcome.
-- ---------------------------------------------------------------------------
create table if not exists public.skill_uses (
  skill_id uuid not null references public.skills(skill_id) on delete cascade,
  job_id   uuid not null references public.jobs(job_id) on delete cascade,
  used_at  timestamptz not null default app.now_utc(),
  primary key (skill_id, job_id)
);

comment on table public.skill_uses is
  'Which jobs were shown which skill, so a skill can be judged by outcomes '
  'rather than by how well it reads (#50).';

create index if not exists skill_uses_by_job on public.skill_uses (job_id);

alter table public.skill_uses enable row level security;
alter table public.skill_uses force  row level security;
grant select on public.skill_uses to ai_team_app;
create policy skill_uses_app_read on public.skill_uses
  for select to ai_team_app using (true);

commit;
