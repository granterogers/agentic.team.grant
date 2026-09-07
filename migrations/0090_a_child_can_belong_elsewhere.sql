-- 0090 — A child can belong to a different project
--
-- `app.enqueue_child` inherits the parent's project, which is right for a
-- follow-up and wrong for a plan that has just created a project. Two callers
-- worked around it the same way and both were silently broken:
--
--     with made as (select app.enqueue_child(...) as job_id)
--     update public.jobs set project_id = X where job_id = (select job_id from made)
--
-- Postgres takes the UPDATE's snapshot at statement start, so the row the
-- function inserted inside the CTE is not visible to the UPDATE in the same
-- statement. The CTE ran, the job was created, the update matched zero rows,
-- and no error was raised anywhere.
--
-- Measured consequence: Grant asked for a video to go into a new project called
-- "AI Learning". The project was created, the notebook was created, and the
-- video went into "AI Team HQ Test" — the parent's project — because the two
-- steps that were supposed to move it never moved anything. Both outputs read
-- as success.
--
-- The fix is a parameter, not a better workaround. A caller that knows which
-- project the child belongs to should be able to say so.

begin;

-- Dropped first, and this is the point rather than housekeeping. `create or
-- replace` with an added defaulted parameter does not replace anything: it
-- creates a SECOND overload, and Postgres then refuses `comment on function`
-- as ambiguous. Which is the polite version of the real hazard — two
-- implementations of one name, where a five-argument call silently reaches the
-- old one and inherits the parent's project after all.
drop function if exists app.enqueue_child(uuid, text, jsonb, interval, boolean);

create or replace function app.enqueue_child(
  p_parent   uuid,
  p_kind     text,
  p_payload  jsonb    default '{}'::jsonb,
  p_delay    interval default interval '0',
  p_announce boolean  default true,
  -- Null means "the parent's", which is what every existing caller wants and
  -- is why they can go on not passing it.
  p_project  uuid     default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_parent public.jobs;
  v_id uuid;
begin
  select * into v_parent from public.jobs where job_id = p_parent;
  if not found then
    raise exception 'no job % to hang a child on', p_parent using errcode = '23503';
  end if;

  insert into public.jobs
    (parent_job_id, correlation_id, project_id, idempotency_key, kind,
     requested_by, priority, pinned_config, not_before, announce)
  values (
    p_parent, v_parent.correlation_id,
    coalesce(p_project, v_parent.project_id),
    format('child-%s-%s', left(p_kind, 40), gen_random_uuid()),
    p_kind, v_parent.requested_by, v_parent.priority,
    coalesce(p_payload, '{}'::jsonb),
    case when p_delay <= interval '0' then null else now() + p_delay end,
    p_announce
  )
  returning job_id into v_id;

  return v_id;
end;
$$;

comment on function app.enqueue_child is
  'One step of work spawning the next. The child carries the parent''s '
  'correlation, its own idempotency key, and the parent''s project unless the '
  'caller names another - which two callers previously tried to do with a CTE '
  'that could not see the row it had just inserted, and neither noticed.';

commit;
