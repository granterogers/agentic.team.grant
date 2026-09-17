-- 0269 — an approval carries the plan
--
-- Issue #131's second half. 0267 records what a job would change; this puts it
-- in front of the person being asked.
--
-- Until now a blocker said what was requested and why it was needed, and both
-- of those are written by whoever raised it — a sentence about a category. The
-- plan is the other thing: the actual list, produced by the code that will do
-- the work.
--
--     Requested: write the course modules into Notion
--     Why: you asked for the curriculum to live where the team can edit it
--
-- versus the same request with the plan under it:
--
--     What it would do — 6 to add, 1 to change in Notion
--     · create Module 1 — Finding your first client → Notion · Coaching Course
--     · create Module 2 — Pricing without flinching → Notion · Coaching Course
--     …
--
-- The first is consent to a category. The second is an approval.
--
-- ## Why it is composed here rather than by the caller
--
-- Every caller of `request_approval` would otherwise have to remember to fetch
-- the plan and append it, and the one that forgets is the one that ships. Doing
-- it inside means an approval CANNOT be raised without the plan when a plan
-- exists — which is the same reason the worker records the plan rather than
-- each handler, and the same reason `act()` in the studio offers undo rather
-- than each button.
--
-- ## Why the text is built in SQL rather than in TypeScript
--
-- `blockers.why_needed` is read by Telegram, by Slack, by the studio and by the
-- MCP server. Rendering it in one of those four would mean the other three show
-- an approval without its plan, which is worse than none of them doing so —
-- because the three that do not would look like approvals that have nothing to
-- show.
--
-- ## The cap, and why the hidden count is stated
--
-- Twelve steps, then a count. A message carrying two hundred lines is one
-- nobody reads to the end, and an approval nobody reads to the end is the thing
-- this issue is about. Saying "and 28 more" keeps the number honest: the reader
-- is never shown a smaller job than the one they are agreeing to.

begin;

/**
 * The plan a job intends, as something a person reads.
 *
 * Empty string when there is no plan, so a caller can concatenate without
 * checking — most jobs have no plan and must not gain a blank heading.
 */
create or replace function app.job_plan_text(p_job_id uuid, p_most int default 12)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select * from public.job_plans where job_id = p_job_id
  ),
  lines as (
    select string_agg(
             format('· %s %s → %s', e ->> 'verb', e ->> 'what', e ->> 'where'),
             E'\n' order by n)                                              as body,
           (select count(*) from p, jsonb_array_elements(p.steps))          as total
      from p, lateral jsonb_array_elements(p.steps) with ordinality as t(e, n)
     where n <= p_most
  )
  select case
    when (select count(*) from p) = 0 then ''
    when (select jsonb_array_length(steps) from p) = 0
      then format(E'\n\nWhat it would do — %s', (select summary from p))
    else format(E'\n\nWhat it would do — %s\n%s%s',
                (select summary from p),
                (select body from lines),
                case when (select total from lines) > p_most
                     then format(E'\n· …and %s more',
                                 (select total from lines) - p_most)
                     else '' end)
  end
$$;

comment on function app.job_plan_text is
  '#131. The plan a job intends, rendered once here rather than four times in '
  'four channels -- so an approval cannot reach one surface with its plan and '
  'another without it.';

create or replace function app.request_approval(
  p_job    uuid,
  p_action text,
  p_why    text,
  p_next   text
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
  if p_next not in ('notebook.generate', 'office.execute_plan') then
    -- The list is fixed for the same reason the MCP kinds are: an approval
    -- that can start any job kind is a button that can start any job kind.
    raise exception '% is not a kind an approval may start', p_next
      using errcode = '22023';
  end if;

  select project_id into v_project from public.jobs where job_id = p_job;

  -- Up the parent chain: a follow-up job is the same person continuing the
  -- same work, and the routing decision lives on the job that took the
  -- message. Third place this has been needed, hence the note in
  -- new-environment.md rather than a fourth fix in a fourth file.
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
    from public.blockers where job_id = p_job and state = 'open' limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.blockers
    (project_id, job_id, requested_action, why_needed, consequences_of_delay,
     approval_options, originating_agent, work_can_continue)
  values (
    v_project, p_job, p_action,
    -- The plan, appended (#131). Empty when the job has none, so a job that
    -- only reads gains nothing and no blank heading.
    p_why || app.job_plan_text(p_job),
    'Nothing happens until you answer. The request stays here.',
    array['Go ahead', 'Not now'],
    coalesce(v_agent, (select name from public.staff where slug = 'chief-of-staff')),
    true
  )
  returning blocker_id into v_id;

  -- What the yes should start. On the job, because `pinned_config` is already
  -- §6's record of the configuration a job ran under, and a plan is exactly
  -- that.
  update public.jobs
     set pinned_config = pinned_config || jsonb_build_object('approval_next', p_next)
   where job_id = p_job;

  return v_id;
end;
$$;

grant execute on function app.job_plan_text(uuid, int) to ai_team_app;

commit;
