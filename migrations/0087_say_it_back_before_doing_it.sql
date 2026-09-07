-- 0087 — Say it back before doing it
--
-- Grant, attaching a voice note to a YouTube link: *"I want you to push this
-- video into a new notebook project called AI Learning, then find me the
-- transcription and then report back to me here in Telegram all the
-- repositories that are mentioned."* And immediately after: *"probably a good
-- idea that he confirms he understands and spits back what I want before going
-- ahead."*
--
-- One feature, not two. A single-step instruction can be acted on and reported.
-- A four-step one has three places to go wrong before anything comes back, and
-- by then the work is done wrongly — in his notebook, against an allowance
-- nobody can read.
--
-- ## Generalising 0083 rather than copying it
--
-- 0083's approval was hard-wired to enqueue `notebook.generate`, because that
-- was the only thing that needed asking about. A plan needs the same
-- ask-and-hold and enqueues something else, and two approval mechanisms would
-- be two things to keep in step — the button vocabulary already taught that
-- lesson twice (0076, 0085).
--
-- So the job says what its approval should start, in `pinned_config`, and one
-- function reads it. `notebook.generate` keeps working because it names itself.
--
-- ## Why the plan lives on the job and not in a table of its own
--
-- `pinned_config` is §6's "why did this job behave that way" record and is
-- already carried to every child. A plan is exactly that: the configuration the
-- work was approved under. A `plans` table would be a second copy that could
-- disagree with the job it belongs to.

begin;

-- --------------------------------------------------------------------------
-- Asking, for anything
-- --------------------------------------------------------------------------

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
    v_project, p_job, p_action, p_why,
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

-- --------------------------------------------------------------------------
-- Answering, for anything
-- --------------------------------------------------------------------------

create or replace function app.answer_generation_approval(
  p_blocker  uuid,
  p_approved boolean,
  p_by       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  b public.blockers;
  v_config jsonb;
  v_next text;
  v_new uuid;
begin
  select * into b from public.blockers where blocker_id = p_blocker;
  if not found then
    return jsonb_build_object('error', 'no such request');
  end if;
  if b.state <> 'open' then
    return jsonb_build_object('already', true, 'state', b.state, 'resolution', b.resolution);
  end if;

  update public.blockers
     set state = 'resolved',
         resolved_at = app.now_utc(),
         resolution = case when p_approved
                        then format('approved by %s', p_by)
                        else format('declined by %s', p_by) end
   where blocker_id = p_blocker;

  if not p_approved then
    return jsonb_build_object('approved', false);
  end if;

  select pinned_config into v_config from public.jobs where job_id = b.job_id;
  -- `notebook.generate` when the job did not say, which is every approval
  -- created before this migration. An in-flight request must not become
  -- unanswerable because the schema moved under it.
  v_next := coalesce(v_config ->> 'approval_next', 'notebook.generate');

  insert into public.jobs
    (parent_job_id, correlation_id, project_id, idempotency_key, kind,
     requested_by, priority, pinned_config)
  select b.job_id, j.correlation_id, j.project_id,
         format('approved-%s', p_blocker),
         v_next,
         j.requested_by,
         -- Ahead of the queue: he has just pressed a button and is watching.
         50,
         coalesce(v_config, '{}'::jsonb)
           || jsonb_build_object('approved_by', p_by, 'approval', p_blocker)
    from public.jobs j where j.job_id = b.job_id
  returning job_id into v_new;

  return jsonb_build_object('approved', true, 'job_id', v_new, 'kind', v_next);
end;
$$;

comment on function app.answer_generation_approval is
  'A button press, applied — for a generation or for a plan. The job says what '
  'its yes should start (`approval_next`); this reads it. One mechanism, '
  'because two would need keeping in step and the button vocabulary already '
  'taught that lesson twice.';

commit;
