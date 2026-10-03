-- Team Chat said "I have put that to the team" and never said anything again (#408, found as the Sample).
--
-- A message typed into the team's chat is recorded, a job is queued, and the chat replies at once with an acknowledgement
-- that the answer "will be on the Team page". The answer was never in the conversation: a person asked a question, got
-- "it takes a few minutes", and had to go and find the reply somewhere else, with nothing saying whether anybody was
-- working on it, whether it was stuck, or whether it had failed. Every question the chat sends takes this path.
--
-- This is the reader the chat needs to carry on the conversation: given the job a turn started, what is happening to it
-- and what has been said so far. Everything it says comes from rows that already exist, and it says nothing it does not
-- hold:
--   * `state` is derived from the states of the job and the work it started (queued, working, waiting, needs you, done,
--     failed), never from time passing;
--   * `working` names the specialists who actually hold a live job, from the jobs themselves;
--   * `outputs` are the words the team actually wrote, with who wrote them;
--   * a waiting job says what it is waiting on in the words the office already stored for a person to read (`waiting_on`).
-- No reasoning, no plan and no prompt is read or returned.
--
-- One office, one job. A job in another office, and a job that does not exist, answer the same way (null), so the reader is
-- not an oracle for ids.

begin;

create or replace function app.turn_status(p_office uuid, p_job uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_office uuid := app.require_office(p_office);
  v_root public.jobs%rowtype;
  v_state text;
  v_names jsonb;
  v_waiting text;
  v_outputs jsonb;
  v_live integer;
  v_total integer;
begin
  select * into v_root from public.jobs where job_id = p_job and office_id = v_office;
  if not found then
    return null;
  end if;

  with tree as (
    select j.* from public.jobs j
     where j.office_id = v_office and (j.job_id = p_job or j.root_job_id = p_job)
  )
  select count(*) filter (where state not in ('complete', 'cancelled', 'failed')),
         count(*),
         (select string_agg(distinct w.waiting_on, '; ') from tree w
           where w.state in ('paused', 'waiting_external', 'waiting_user') and coalesce(w.waiting_on, '') <> ''),
         coalesce((select jsonb_agg(distinct s.name) from tree a
                     join public.staff s on s.slug = a.recipient_agent
                    where a.state not in ('complete', 'cancelled', 'failed')), '[]'::jsonb),
         case
           when v_root.state = 'failed' then 'failed'
           when exists (select 1 from tree where state = 'waiting_user') then 'needs_you'
           when exists (select 1 from tree where state in ('paused', 'waiting_external')) then 'waiting'
           when exists (select 1 from tree where state in ('running', 'output_created', 'quality_review',
                                                           'committing', 'committed', 'notifying')) then 'working'
           when exists (select 1 from tree where state in ('queued', 'retrying')) then 'queued'
           else 'done' end
    into v_live, v_total, v_waiting, v_names, v_state
    from tree;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.output_id,
           'who', s.slug,
           'name', s.name,
           'body', left(o.body, 6000),
           'at', o.created_at
         ) order by o.created_at), '[]'::jsonb)
    into v_outputs
    from public.outputs o
    join public.jobs j on j.job_id = o.job_id and j.office_id = v_office
                      and (j.job_id = p_job or j.root_job_id = p_job)
    left join public.staff s on s.staff_id = o.staff_id;

  return jsonb_build_object(
    'job_id', p_job,
    'state', v_state,
    'working', v_names,
    'waiting_on', v_waiting,
    'jobs', v_total,
    'live', v_live,
    'asked_at', v_root.created_at,
    'outputs', v_outputs);
end;
$$;

create or replace function public.turn_status(p_office uuid, p_job uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select app.turn_status(p_office, p_job) $$;

revoke all on function app.turn_status(uuid, uuid) from public, anon, authenticated;
revoke all on function public.turn_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.turn_status(uuid, uuid) to service_role;

commit;
