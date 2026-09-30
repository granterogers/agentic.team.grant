-- Rollback for 0620: the pre-0620 bodies, dumped from the live schema before it ran.
CREATE OR REPLACE FUNCTION app.pause_job(p_job uuid, p_reason text, p_detail text, p_resume_when text, p_resumable boolean DEFAULT true, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_binds_to text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_state text;
begin
  /*
    0436's body, unchanged, with one guard and one column added.

    Rewritten from memory the first time and four behaviours went missing:
    `waiting_on` took the reason instead of the sentence a person reads,
    `state_reason` lost its prefix, the already-paused early return went, and
    the job kept its LEASE — which would have left a paused job looking
    claimed until the lease expired. Taken from the live definition this time,
    which is the rule CLAUDE.md states and which I did not follow.
  */
  select state::text into v_state from public.jobs where job_id = p_job;
  if v_state is null then
    return jsonb_build_object('error', 'no such job');
  end if;
  if v_state = 'paused' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if p_reason = 'awaiting_approval' and coalesce(p_binds_to, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error',
      'an approval has to bind to the exact action it approves — pass the '
      'fingerprint of what the job is promising to do');
  end if;

  insert into public.job_pauses
    (job_id, reason, detail, resume_when, resumable, expires_at, binds_to)
  values (p_job, p_reason, p_detail, p_resume_when, coalesce(p_resumable, true),
          p_expires_at, p_binds_to);

  update public.jobs
     set state = 'paused',
         state_reason = left(p_reason || ': ' || p_detail, 500),
         waiting_on = left(p_resume_when, 500),
         not_before = coalesce(p_until, not_before),
         leased_by = null,
         leased_until = null
   where job_id = p_job;

  return jsonb_build_object('ok', true, 'was', v_state);
end;
$function$;

CREATE OR REPLACE FUNCTION app.enqueue_child(p_parent uuid, p_kind text, p_payload jsonb DEFAULT '{}'::jsonb, p_delay interval DEFAULT '00:00:00'::interval, p_announce boolean DEFAULT true, p_project uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION app.let_job_go(p_job uuid, p_why text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_was text;
begin
  if p_job is null then return; end if;
  select state::text into v_was from public.jobs where job_id = p_job;
  if v_was is null then return; end if;
  if v_was in ('waiting_user', 'waiting_external') then
    update public.jobs
       set state = 'paused', state_reason = p_why, updated_at = app.now_utc()
     where job_id = p_job;
    v_was := 'paused';
  end if;
  if v_was = 'paused' then
    update public.jobs
       set state = 'queued', state_reason = p_why, updated_at = app.now_utc()
     where job_id = p_job;
  end if;
end;
$function$;

drop function if exists app.job_held(uuid, text, integer);
drop function if exists app.renew_lease(uuid, text, integer);
drop function if exists app.settle_exhausted_jobs();
drop function if exists app.job_situation(uuid);
