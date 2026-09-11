-- Saying what it could not do, in a form something can count.
--
-- Issue #47, under #46. Grant:
--
--     "They need to propose how they can improve... they should make
--      suggestions to me and how they can improve if they can't do it
--      themselves."
--
-- A proposal has to come from somewhere, and the only honest source is a
-- limitation that has actually recurred. Today that is unfindable. Failures land
-- in `jobs.state_reason`, which is prose:
--
--     'no inbound telegram message to reply to; delivered to slack via gener…'
--     'incoherent output metadata: confidence'
--     'verification cleanup'                                        (608 rows)
--
-- You cannot ask that "how many times has Ruby been unable to publish, and what
-- would fix it". You can only grep it, and a grep over prose written by a
-- language model is not a measurement.
--
-- `jobs.waiting_on` exists and looks like it was meant for exactly this. **It
-- has never been written to. Not once, in the whole history of the database.**
-- A column nobody fills is not a gap in the data; it is a gap in the design,
-- and adding a convention on top of it would produce a second unfilled column.
--
-- ## Why a table and not an enum on `jobs`
--
-- Three reasons, and the third is the one that decides it.
--
--   1. A job can be impeded more than once — a research job that lacks both a
--      source and a credential has two problems, and recording one loses the
--      other.
--   2. A retried job that succeeds should not erase the fact that it was
--      blocked twice first. That history is the evidence a proposal is built
--      from.
--   3. `jobs` is mutable and this is evidence. Evidence that can be rewritten is
--      not evidence — the same reasoning as `job_state_transitions`.
--
-- ## The typed part
--
-- Six kinds, chosen so that each maps to a DIFFERENT remedy. A taxonomy whose
-- categories all lead to the same action is decoration.
--
--     missing_tool       -> a connector or credential the office does not have
--     missing_skill      -> it has the reach and does not know the procedure
--     missing_data       -> the material simply is not there
--     needs_permission   -> it could, and is not allowed to
--     ambiguous          -> the instruction has two readings that differ
--     not_capable        -> honestly beyond it; a person has to do this
--
-- `needed` is the short machine-comparable handle — a tool name, a connector, a
-- document kind — and it is what makes the tally possible. `detail` is for a
-- human. Counting on `detail` would put us back in the prose.

begin;

create type public.impediment_kind as enum (
  'missing_tool',
  'missing_skill',
  'missing_data',
  'needs_permission',
  'ambiguous',
  'not_capable'
);

create table if not exists public.job_impediments (
  impediment_id uuid primary key default extensions.gen_random_uuid(),

  -- Plain references, no cascade: this is a ledger row, not a child record.
  -- Same family as events, autonomy_settings and lessons (0183, Issue #43).
  job_id        uuid not null references public.jobs(job_id),
  project_id    uuid references public.projects(project_id),
  staff_slug    text references public.staff(slug),

  kind          public.impediment_kind not null,

  /*
    The countable handle.

    Lower-case, no spaces, so that four agents hitting the same wall produce
    four rows that GROUP BY together instead of four spellings of the same
    problem. Normalised here rather than trusted from the caller, because the
    caller is a language model and it will not be consistent.
  */
  needed        text not null
                  generated always as (lower(btrim(needed_raw))) stored,
  needed_raw    text not null check (length(btrim(needed_raw)) between 2 and 64),

  -- For a person. Never grouped on.
  detail        text not null default '' check (length(detail) <= 500),

  -- What the agent believed it was asked to do. #47's other half: a wrong
  -- restatement is visible where a wrong output is not.
  understood_as text not null default '' check (length(understood_as) <= 280),

  noticed_by    text not null check (length(btrim(noticed_by)) > 0),
  created_at    timestamptz not null default app.now_utc(),

  /*
    Harness traffic is not the office struggling.

    `jobs.is_fixture` exists because 264 fixture jobs were once reported to
    Grant as the office collapsing. A tally that counts verification runs would
    manufacture proposals out of test noise, so the discriminator is carried
    here and every aggregate filters on it. GENERATED from the job, so it cannot
    be set wrongly.
  */
  is_fixture    boolean not null default false
);

create index if not exists job_impediments_tally
  on public.job_impediments (kind, needed, staff_slug) where not is_fixture;
create index if not exists job_impediments_by_job on public.job_impediments (job_id);

comment on table public.job_impediments is
  'What a job could not do, typed so it can be counted. jobs.state_reason is '
  'prose and jobs.waiting_on was never once written to; a proposal (#49) has to '
  'be built on something countable. Append-only: a retry that succeeds must not '
  'erase the fact that it was blocked first.';

comment on column public.job_impediments.needed is
  'The machine-comparable handle, normalised. GROUP BY this. Never group on '
  'detail — that is how we ended up grepping prose.';

-- Append-only, per §6.
create trigger job_impediments_reject_update
  before update on public.job_impediments
  for each row execute function app.reject_ledger_mutation();
create trigger job_impediments_reject_delete
  before delete on public.job_impediments
  for each row execute function app.reject_ledger_mutation();
create trigger job_impediments_reject_truncate
  before truncate on public.job_impediments
  for each statement execute function app.reject_ledger_mutation();

-- No credential may hide in here either. Same reasoning as 0181: check:secrets
-- scans files, and `detail` is written by a model that has just been handling
-- a connector.
create or replace function app.reject_impediment_credential()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  probe public.lessons%rowtype;
begin
  -- Reuse the one implementation rather than keeping two patterns in step.
  probe.body := coalesce(new.detail, '') || ' ' || coalesce(new.understood_as, '');
  perform app.reject_credential_text_on(probe.body);
  return new;
end;
$$;

-- The shared check, extracted so 0181's trigger and this one cannot drift.
create or replace function app.reject_credential_text_on(p_text text)
returns void
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_text ~ '(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.)'
  then
    raise exception 'that text looks like a credential and will not be stored'
      using errcode = '42501',
            hint = 'Secrets live in the Supabase Vault. Reference one by name; '
                   'never copy its value into a row.';
  end if;
end;
$$;

comment on function app.reject_credential_text_on(text) is
  'The one credential-shape check. 0181 and 0184 both call it so the two '
  'cannot drift apart and leave one table protected and the other not.';

create trigger job_impediments_reject_credentials
  before insert on public.job_impediments
  for each row execute function app.reject_impediment_credential();

commit;
