-- 0149 — Grant was queuing behind the housekeeping
--
-- `dequeue_job` orders by `priority asc`: lower is sooner. Duty jobs take the
-- column default, 100. An instruction from Grant was given **150**.
--
-- So every calendar refresh, mail poll, notebook sync and backup was claimed
-- ahead of a message he was waiting on, and with `max_concurrent_jobs` at
-- three it did not take many to hold the queue. Measured before this change:
-- seven to twenty-five seconds between his message arriving and any work
-- starting on it, on a surface he had asked to answer within a minute.
--
-- ## How the number got backwards
--
-- 0072 wrote 150 meaning "important", and 0107 later wrote 200 for a source
-- arriving with the comment *"below an instruction Grant is waiting on"* —
-- which is correct on the real scale and reads as though the author of one of
-- them had it upside down. Nothing in between ever compared the two, because
-- nothing had both a duty and an instruction in the queue at the same moment
-- until seven duties went live yesterday.
--
-- ## The scale, written down this time
--
--     10   an instruction from Grant. Somebody is waiting.
--     50   work the office decided to do as part of that.
--    100   a recurring duty. Nobody is waiting.
--    200   a source arriving. Interesting, not urgent.
--
-- Body copied verbatim from 0075, the migration that last authored it, with
-- the one number changed. 0128 is why.

begin;

create or replace function app.enqueue_inbound(p_command_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  c record;
  v_project uuid;
  v_job uuid;
begin
  select * into c from public.inbound_commands where command_id = p_command_id;
  if not found then
    return jsonb_build_object('error', 'no such command');
  end if;
  if c.job_id is not null then
    -- Already turned into work. Idempotent because a webhook is at-least-once
    -- and the same instruction arriving twice must not be done twice.
    return jsonb_build_object('job_id', c.job_id, 'already', true);
  end if;
  -- 0075: a recording is an instruction whose words have not been read yet.
  if coalesce(trim(c.instruction), '') = '' and c.voice_file_id is null then
    return jsonb_build_object('error', 'nothing to do: the command carries no instruction');
  end if;

  select project_id into v_project
    from public.projects where status = 'active'
   order by updated_at desc
   limit 1;

  if v_project is null then
    return jsonb_build_object('error', 'no active project to attach this to');
  end if;

  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
  values (gen_random_uuid(), v_project,
          format('inbound-%s', p_command_id),
          'office.instruction',
          format('%s:%s', c.origin_channel, coalesce(c.subject, c.actor)),
          -- 10, not 150. See the header: lower is sooner, and at 150 every
          -- routine duty in the building was claimed ahead of a message Grant
          -- was waiting on.
          10,
          jsonb_build_object(
            'instruction', c.instruction,
            'addressed_to', c.addressed_to,
            'origin_channel', c.origin_channel,
            'origin_ref', c.origin_ref,
            'command_id', p_command_id,
            'voice_file_id', c.voice_file_id,
            'voice_seconds', c.voice_seconds
          ))
  returning job_id into v_job;

  update public.inbound_commands
     set job_id = v_job, processed_at = app.now_utc()
   where command_id = p_command_id;

  return jsonb_build_object('job_id', v_job, 'already', false, 'spoken', c.voice_file_id is not null);
end;
$$;

comment on function app.enqueue_inbound is
  'Turn an inbound command into a job. Priority 10: somebody is waiting on '
  'this, and everything routine is 100 or above. Lower is sooner.';

commit;
