-- 0086 — Declining is answering
--
-- 0083 settled a declined approval as `cancelled`, which is not a
-- `blocker_state`. The four are open, resolved, expired and withdrawn, so every
-- press of "Not now" would have raised `invalid input value for enum` and been
-- reported to Grant as a failure to record his answer — on the button whose
-- entire job is to be trusted.
--
-- Caught by trying to withdraw a stale request by hand, which is the only
-- reason it was found before he pressed it. The approve path was tested; the
-- decline path was written in the same breath and never run.
--
-- ## `resolved`, not `withdrawn`
--
-- The obvious fix was the nearest valid word, and it is the wrong one.
-- `withdrawn` means the asker took the question back. Grant pressing "Not now"
-- is not that: he answered it, and the answer was no. A blocker settled by his
-- decision is `resolved`, and `resolution` is the column that says which way —
-- which is what that column has been for since 0012.
--
-- Getting this wrong would have been invisible and permanent: "withdrawn" in a
-- year's audit reads as "the team changed its mind", when what happened was
-- that Grant said no.

begin;

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
  v_new uuid;
begin
  select * into b from public.blockers where blocker_id = p_blocker;
  if not found then
    return jsonb_build_object('error', 'no such request');
  end if;
  if b.state <> 'open' then
    -- Already answered. Not an error: the same request goes to Slack and to
    -- Telegram and either may answer it, so a second press is the normal way
    -- this ends rather than a fault.
    return jsonb_build_object('already', true, 'state', b.state,
                              'resolution', b.resolution);
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

  insert into public.jobs
    (parent_job_id, correlation_id, project_id, idempotency_key, kind,
     requested_by, priority, pinned_config)
  select b.job_id, j.correlation_id, j.project_id,
         format('approved-%s', p_blocker),
         'notebook.generate',
         j.requested_by,
         -- Ahead of the queue: he has just pressed a button and is watching.
         50,
         coalesce(v_config, '{}'::jsonb)
           || jsonb_build_object('approved_by', p_by, 'approval', p_blocker)
    from public.jobs j where j.job_id = b.job_id
  returning job_id into v_new;

  return jsonb_build_object('approved', true, 'job_id', v_new);
end;
$$;

commit;
