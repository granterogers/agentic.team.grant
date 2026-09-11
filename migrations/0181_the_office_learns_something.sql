-- The office learns something, and it survives the job that learned it.
--
-- Issue #48, under the bot-intelligence epic #46. Grant, 11 September 2026:
--
--     "They need to learn... They should learn and grow."
--
-- There is no memory today. Every job starts from the same standing prompt and
-- the same schema. If Emma discovers on Tuesday that the interview transcripts
-- use "client" to mean two different things, Wednesday's Emma does not know.
--
-- `events` holds everything that happened, but it is a LEDGER, not a memory:
-- nobody reads it back to decide anything. `staff_prompts` is versioned, but a
-- core prompt is an identity, not an accumulation — and rewriting an agent's
-- identity every time it notices something is how a team loses its shape.
--
-- ## Why not `documents`
--
-- `documents` are project material Grant might read. Lessons are operating
-- knowledge the office keeps about ITSELF. Mixing them fills his Documents tab
-- with the office's notes-to-self, which is the exact noise he has asked twice
-- to be rid of.
--
-- ## Append-only, like everything else that is evidence
--
-- §6, and the same reasoning as `job_state_transitions`: evidence that can be
-- rewritten is not evidence. A lesson is never UPDATEd and never DELETEd. It is
-- SUPERSEDED — by a corrected lesson, or by a retraction. So the history of
-- what the office believed, and when it stopped believing it, is intact, and
-- "why did it do that in September" stays answerable.
--
-- This also means `observations` cannot be incremented in place. Observing the
-- same thing again writes a new row superseding the old one with a higher
-- count. That is more rows and it is the right trade: the ninth observation is
-- a different claim from the first, and the record should show it became one.
--
-- ## The boundary (#53), built now rather than bolted on afterwards
--
-- A lesson is ADVISORY TEXT. It is retrieved into a prompt and nothing else.
-- Three things enforce that here rather than in a convention:
--
--   1. A hard length cap. One sentence. Anything longer is a document, and a
--      lesson long enough to contain a procedure is a lesson long enough to
--      contain an instruction to call an endpoint.
--   2. No credential may be stored in one. `npm run check:secrets` scans FILES;
--      a table is a place a secret could hide from it. The trigger below closes
--      that, and the scan is extended to cover this table.
--   3. Nothing in the authorisation path reads this table. `app.staff_may_use()`
--      is an AND of `tool_permissions` and `staff_tools` and it stays that way.
--      A lesson can change how an agent works. It can never change what an
--      agent may reach. `verify:boundary` asserts this by attempting it.

begin;

-- ---------------------------------------------------------------------------
-- What a lesson is about
--
-- Scope is the difference between a memory that helps and one that poisons.
-- A lesson about the Legacy transcripts must not colour Ruby's growth work, and
-- a lesson about how Notion paginates must apply everywhere.
-- ---------------------------------------------------------------------------
create type public.lesson_scope as enum ('global', 'project', 'staff', 'kind');

-- A row is either a lesson or the act of withdrawing one. Retraction is a row
-- rather than a flag because a flag would have to be UPDATEd.
create type public.lesson_row_kind as enum ('lesson', 'retraction');

create table if not exists public.lessons (
  lesson_id     uuid primary key default extensions.gen_random_uuid(),
  row_kind      public.lesson_row_kind not null default 'lesson',
  scope         public.lesson_scope not null,

  -- Exactly one of these is set, decided by `scope`. Checked below rather than
  -- left to the caller, because a mis-scoped lesson is retrieved in the wrong
  -- place and looks like the model hallucinating.
  project_id    uuid references public.projects(project_id) on delete cascade,
  staff_slug    text references public.staff(slug) on delete cascade,
  job_kind      text,

  -- One sentence. The cap is the boundary, not a style preference.
  body          text not null check (length(btrim(body)) between 8 and 280),

  -- Provenance. A lesson with no traceable origin cannot be judged or retracted
  -- with any confidence, so both of these are required.
  learned_by    text not null check (length(btrim(learned_by)) > 0),
  from_job      uuid references public.jobs(job_id) on delete set null,

  -- A thing seen once is a hunch; a thing seen nine times is a rule. Ranking
  -- reads both, so a confident single observation cannot outrank a repeatedly
  -- confirmed one on wording alone.
  confidence    numeric(3, 2) not null default 0.50
                  check (confidence >= 0 and confidence <= 1),
  observations  integer not null default 1 check (observations >= 1),

  -- Learning includes unlearning.
  supersedes    uuid references public.lessons(lesson_id) on delete restrict,

  created_at    timestamptz not null default app.now_utc(),

  -- Scope decides which discriminator is present, and forbids the others.
  constraint lessons_scope_matches_target check (
    case scope
      when 'global'  then project_id is null and staff_slug is null and job_kind is null
      when 'project' then project_id is not null and staff_slug is null and job_kind is null
      when 'staff'   then staff_slug is not null and project_id is null and job_kind is null
      when 'kind'    then job_kind is not null and project_id is null and staff_slug is null
    end
  ),

  -- A retraction exists only to withdraw something.
  constraint lessons_retraction_names_its_target check (
    row_kind = 'lesson' or supersedes is not null
  )
);

-- One row may supersede at most one other, and each row may be superseded once.
-- Without this, two agents correcting the same lesson in the same minute both
-- succeed and the live view shows neither.
create unique index if not exists lessons_supersedes_once
  on public.lessons (supersedes) where supersedes is not null;

create index if not exists lessons_by_project on public.lessons (project_id)
  where project_id is not null;
create index if not exists lessons_by_staff on public.lessons (staff_slug)
  where staff_slug is not null;
create index if not exists lessons_by_kind on public.lessons (job_kind)
  where job_kind is not null;

comment on table public.lessons is
  'Operating knowledge the office keeps about itself, scoped and append-only. '
  'Advisory text only: retrieved into a prompt, never consulted by the '
  'authorisation path. A lesson can change how an agent works and can never '
  'change what an agent may reach (#48, #53).';

-- ---------------------------------------------------------------------------
-- Append-only. §6, and app.reject_ledger_mutation() names the table it guarded.
-- ---------------------------------------------------------------------------
create trigger lessons_reject_update
  before update on public.lessons
  for each row execute function app.reject_ledger_mutation();

create trigger lessons_reject_delete
  before delete on public.lessons
  for each row execute function app.reject_ledger_mutation();

create trigger lessons_reject_truncate
  before truncate on public.lessons
  for each statement execute function app.reject_ledger_mutation();

-- ---------------------------------------------------------------------------
-- A credential must never end up in here
--
-- Grant: *"Do not expose secret values in logs, commits, reports, test output
-- or chat."* A table is none of those and is exactly where a secret would hide
-- from `npm run check:secrets`, which scans files.
--
-- The patterns are the recognisable prefixes, not an attempt at cleverness. A
-- generic high-entropy string cannot be distinguished from a hash of a document
-- and trying would reject real lessons; these shapes are unambiguous.
-- ---------------------------------------------------------------------------
create or replace function app.reject_credential_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.body ~ '(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.)'
  then
    raise exception 'that text looks like a credential and will not be stored'
      using errcode = '42501',
            hint = 'Secrets live in the Supabase Vault. Reference one by name; '
                   'never copy its value into a row.';
  end if;
  return new;
end;
$$;

comment on function app.reject_credential_text() is
  'Refuses a row whose body carries a recognisable credential. check:secrets '
  'scans files; a table is where a secret would hide from it.';

create trigger lessons_reject_credentials
  before insert on public.lessons
  for each row execute function app.reject_credential_text();

-- ---------------------------------------------------------------------------
-- What the office currently believes
--
-- A lesson is live if nothing supersedes it. Derived rather than stored,
-- because a stored current-state flag can disagree with its own history — the
-- same reasoning `notebook_capability` already uses for probes.
-- ---------------------------------------------------------------------------
create or replace view public.lessons_live as
  select l.*
    from public.lessons l
   where l.row_kind = 'lesson'
     and not exists (select 1 from public.lessons s where s.supersedes = l.lesson_id);

comment on view public.lessons_live is
  'Lessons nothing has superseded or retracted. Derived, so it cannot disagree '
  'with the history it is drawn from.';

commit;
