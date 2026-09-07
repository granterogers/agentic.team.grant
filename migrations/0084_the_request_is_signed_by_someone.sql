-- 0084 — The request is signed by someone
--
-- 0083's approval request came out as "The team", not "Claire". The lookup was
-- right and it was looking in the wrong place: `routing_decisions` records who
-- was convened for the job that RECEIVED the instruction, and the job that asks
-- for permission is that job's child. The child has no decision of its own, so
-- the query found nothing and fell back.
--
-- The same shape as the reply-channel and staff-attribution fixes in the
-- artifact work: a follow-up job is the same person continuing the same piece
-- of work, and every lookup that asks "who is this?" has to walk the parent
-- chain to find out. This is the third time, which is enough times to say so in
-- a comment rather than fixing it a fourth time in a fourth place.

begin;

create or replace function app.request_generation_approval(
  p_job     uuid,
  p_kind    text,
  p_what    text,
  p_cost    text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_agent text;
  v_id uuid;
begin
  select project_id into v_project from public.jobs where job_id = p_job;

  -- Up the parent chain. A generation job is the child of the instruction that
  -- asked for it, and the routing decision — who is speaking — lives on the
  -- parent. Bounded at eight because a chain deeper than that is a bug, and an
  -- unbounded recursive CTE over a table with a self-reference is how a bug
  -- becomes an outage.
  with recursive lineage as (
    select job_id, parent_job_id, 0 as depth
      from public.jobs where job_id = p_job
    union all
    select j.job_id, j.parent_job_id, l.depth + 1
      from public.jobs j join lineage l on j.job_id = l.parent_job_id
     where l.depth < 8
  )
  select s.name into v_agent
    from lineage l
    join public.routing_decisions r on r.job_id = l.job_id
    join public.staff s on s.slug = r.roster[1]
   order by l.depth asc, r.decided_at desc
   limit 1;

  select blocker_id into v_id
    from public.blockers
   where job_id = p_job and state = 'open'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.blockers
    (project_id, job_id, requested_action, why_needed, consequences_of_delay,
     approval_options, originating_agent, work_can_continue)
  values (
    v_project, p_job,
    format('Generate %s in the notebook', p_what),
    p_cost,
    'Nothing is generated until you say so. The request stays here until you answer it.',
    array['Go ahead', 'Not now'],
    -- The Chief of Staff, not "the team", when the chain says nothing. She is
    -- who asks when nobody else was convened, and a request signed by a
    -- collective noun is a request from the software.
    coalesce(v_agent, (select name from public.staff where slug = 'chief-of-staff')),
    true
  )
  returning blocker_id into v_id;

  return v_id;
end;
$$;

commit;
