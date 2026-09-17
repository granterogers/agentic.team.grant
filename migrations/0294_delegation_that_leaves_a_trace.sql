-- 0294 — delegation that leaves a trace
--
-- Issue #65. Grant: *"If it's truly being delegated, if it's just one bot now
-- doing all the work, it's not really what we want, is it?"*
--
-- Measured again today, against the numbers in the Issue:
--
--   | | when #65 was filed | now |
--   |---|---|---|
--   | jobs addressed to an agent | 0 of 499 | 9 of 856 |
--   | rows in `consultations` | 0 | **0** |
--   | outputs with no `staff_id` | 140 | **1,060 of 1,714** |
--
-- The first number moved because `instruction.ts` now writes `recipient_agent`,
-- and three of those nine went to a specialist rather than to Claire — so the
-- choosing is real. The other two did not move, and this migration is why.
--
-- ## The consultation insert has never once succeeded
--
--     insert into public.consultations
--       (job_id, consulted_staff, requested_by, reason, provider_requests)
--     values (…, array['research-director']::text[], 'chief-of-staff', …)
--
--     ERROR: column "consulted_staff" is of type uuid but expression is of
--            type text[]
--
-- `consulted_staff` and `requested_by` are UUIDs; the caller had slugs and a
-- text array. It has failed on every single hand-off — and the call site ends
-- `.catch(() => undefined)`, so the failure was swallowed, the table stayed
-- empty, and the code read as finished. §9's consultation economics could not
-- answer its own question because nothing had ever been written to it.
--
-- **A swallowed error on a write nobody reads back is indistinguishable from a
-- feature that was never built.** That is the lesson, and it is why the fix is
-- an RPC rather than a corrected INSERT: the caller passes the slugs it has,
-- one place does the resolution, and getting the types wrong stops being
-- possible.
--
-- ## An output takes its author from the job
--
-- 1,060 outputs have no `staff_id`. Not because handlers are careless — most
-- job kinds simply never had a reason to know whose work they were. But the
-- job DOES know now: `recipient_agent` is the decision, and the output is the
-- result of that decision.
--
-- So a trigger fills it in, rather than an edit to every handler. Editing
-- handlers is how you get 27 of them right and the 28th silently wrong; a
-- default at the table is true for the one somebody writes next month.
--
-- History is left alone. There is no honest way to say who wrote an output
-- from 2026-09-03 when nothing recorded it, and inventing an attribution is
-- worse than admitting the gap — Grant would read those names as fact.

begin;

-- ---------------------------------------------------------------------------
-- 1. Recording a hand-off, in the vocabulary the caller actually has
-- ---------------------------------------------------------------------------

/**
 * Record that one agent's work was handed to another.
 *
 * Takes SLUGS, because slugs are what the routing decision, the handlers and
 * the interface all hold — `staff_id` is a detail of this table and the
 * conversion belongs on this side of the call. The previous caller had to know
 * that `consulted_staff` is a uuid and did not, and every hand-off since has
 * been dropped on the floor.
 *
 * `changed_outcome` is deliberately left NULL. Recording that a consult
 * happened is not the same as claiming it helped, and a table that assumed so
 * would answer its own question — which is the one question §9 built it to ask.
 */
create or replace function app.record_consultation(
  p_job_id       uuid,
  p_consulted    text,
  p_requested_by text default 'chief-of-staff',
  p_reason       text default '',
  p_requests     int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_consulted uuid;
  v_by        uuid;
  v_id        uuid;
begin
  if not exists (select 1 from public.jobs where job_id = p_job_id) then
    return jsonb_build_object('error', 'no such job');
  end if;

  select staff_id into v_consulted from public.staff where slug = btrim(coalesce(p_consulted, ''));
  if v_consulted is null then
    return jsonb_build_object('error', format('nobody here is called %L', p_consulted));
  end if;

  select staff_id into v_by from public.staff where slug = btrim(coalesce(p_requested_by, ''));

  /*
    Consulting yourself is not a consultation.

    Refused rather than silently written: the chief of staff handling something
    herself is the ordinary case, and counting it would make the delegation
    rate look healthy while nothing was being delegated at all — which is
    exactly the illusion #65 is about.
  */
  if v_consulted = v_by then
    return jsonb_build_object('error', 'that is the same person — not a consultation');
  end if;

  insert into public.consultations
    (job_id, consulted_staff, requested_by, reason, provider_requests)
  values (p_job_id, v_consulted, v_by,
          coalesce(nullif(btrim(p_reason), ''), 'no reason recorded'),
          greatest(coalesce(p_requests, 0), 0))
  returning consultation_id into v_id;

  return jsonb_build_object('ok', true, 'consultation', v_id, 'consulted', p_consulted);
end;
$$;

create or replace function public.record_consultation(
  p_job_id uuid, p_consulted text, p_requested_by text default 'chief-of-staff',
  p_reason text default '', p_requests int default 0
)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.record_consultation(p_job_id, p_consulted, p_requested_by, p_reason, p_requests) $$;

-- ---------------------------------------------------------------------------
-- 2. Was it worth it — recorded from evidence, never assumed
-- ---------------------------------------------------------------------------

/**
 * Say whether consulting a specialist changed the outcome.
 *
 * `changed_outcome` exists so multi-agent work can be shown to be better than
 * one agent doing it. It has to be filled from something that actually
 * happened, or it is a number that agrees with whoever wrote it.
 *
 * The evidence used here is the review the output already gets: an output on a
 * consulted job that Grant approves is evidence the specialist's work stood;
 * one he rejects is evidence it did not. That is weak evidence and it is
 * honest about being weak — `outcome_note` records what it was inferred from,
 * so a stronger judge later can tell the two apart rather than inheriting
 * guesses as facts.
 */
create or replace function app.judge_consultation(p_job_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_status text;
  v_n      int;
begin
  select o.reviewer_status into v_status
    from public.outputs o
   where o.job_id = p_job_id and o.reviewer_status is not null
   order by o.created_at desc
   limit 1;

  if v_status is null or v_status = 'pending' then
    return 0;
  end if;

  update public.consultations
     set changed_outcome = (v_status = 'approved'),
         outcome_note = format('inferred from the review of this job''s output: %s', v_status)
   where job_id = p_job_id
     and changed_outcome is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

/*
  Judged when the review happens, rather than by a sweep.

  A nightly pass would work and would also mean the number is wrong for a day
  every time, and that somebody has to remember the pass exists. The review is
  the event that creates the evidence, so it is where the inference belongs.
*/
create or replace function app.judge_consultation_on_review() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if new.reviewer_status is distinct from old.reviewer_status
     and coalesce(new.reviewer_status, 'pending') <> 'pending' then
    perform app.judge_consultation(new.job_id);
  end if;
  return new;
end $$;

drop trigger if exists outputs_judge_consultation on public.outputs;
create trigger outputs_judge_consultation
  after update of reviewer_status on public.outputs
  for each row execute function app.judge_consultation_on_review();

-- ---------------------------------------------------------------------------
-- 3. An output takes its author from the job that was addressed
-- ---------------------------------------------------------------------------

/**
 * Fill in `outputs.staff_id` from the job's `recipient_agent`.
 *
 * 1,060 of 1,714 outputs carry no author. Not carelessness in the handlers —
 * most job kinds never had a reason to know whose work they were. The job
 * knows: `recipient_agent` IS the decision, and the output is its result.
 *
 * A trigger and not an edit to every handler, because editing handlers is how
 * you get 27 right and the 28th silently wrong, and because the default has to
 * be true for the handler somebody writes next month. A handler that DOES know
 * better still wins — this only fills a null.
 */
create or replace function app.output_author_follows_the_job() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if new.staff_id is null then
    select s.staff_id into new.staff_id
      from public.jobs j
      join public.staff s on s.slug = j.recipient_agent
     where j.job_id = new.job_id;
  end if;
  return new;
end $$;

drop trigger if exists outputs_author_follows_job on public.outputs;
create trigger outputs_author_follows_job
  before insert on public.outputs
  for each row execute function app.output_author_follows_the_job();

comment on function app.output_author_follows_the_job is
  '#65. An output with no author takes the one the job was addressed to. '
  'Historic rows are deliberately NOT backfilled: nothing recorded who wrote '
  'an output before `recipient_agent` was written, and inventing a name Grant '
  'would read as fact is worse than admitting the gap.';

-- ---------------------------------------------------------------------------
-- 4. So the question can be asked
-- ---------------------------------------------------------------------------

/**
 * Is the office actually delegating, and is it worth it?
 *
 * The numbers #65 was filed with, as a function, so the answer is one call and
 * not a page of ad-hoc SQL that everyone writes differently.
 */
create or replace function app.delegation_health(p_days int default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select * from public.jobs
     where not is_fixture
       and created_at > app.now_utc() - make_interval(days => greatest(coalesce(p_days, 30), 1))
  )
  select jsonb_build_object(
    'jobs', (select count(*) from live),
    'addressed', (select count(*) from live where recipient_agent is not null),
    -- The one that matters. A job addressed to the chief of staff is the
    -- office NOT delegating, and counting it would make the rate look healthy.
    'delegated', (select count(*) from live
                   where recipient_agent is not null and recipient_agent <> 'chief-of-staff'),
    'to_whom', (select coalesce(jsonb_object_agg(a, n), '{}'::jsonb)
                  from (select recipient_agent as a, count(*) as n from live
                         where recipient_agent is not null group by 1) x),
    'consultations', (select count(*) from public.consultations c
                       where c.job_id in (select job_id from live)),
    'judged', (select count(*) from public.consultations c
                where c.job_id in (select job_id from live) and c.changed_outcome is not null),
    'helped', (select count(*) from public.consultations c
                where c.job_id in (select job_id from live) and c.changed_outcome),
    'outputs_without_author', (select count(*) from public.outputs o
                                where o.job_id in (select job_id from live) and o.staff_id is null)
  )
$$;

create or replace function public.delegation_health(p_days int default 30)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.delegation_health(p_days) $$;

grant execute on function app.record_consultation(uuid, text, text, text, int) to ai_team_app;
grant execute on function public.record_consultation(uuid, text, text, text, int) to ai_team_app;
grant execute on function app.judge_consultation(uuid) to ai_team_app;
grant execute on function app.delegation_health(int) to ai_team_app;
grant execute on function public.delegation_health(int) to ai_team_app;

commit;
