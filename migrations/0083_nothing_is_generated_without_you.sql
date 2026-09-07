-- 0083 — Nothing is generated without you
--
-- Grant: *"when it comes to any of the agents deciding to generate anything on
-- the notebook, I would like manual approval for that, either for Slack or
-- Telegram or both."*
--
-- The ask is narrow and the reasoning behind it is not. A generation is the one
-- thing this system does that is externally visible, irreversible in the sense
-- that matters (it appears in his notebook whether he wanted it or not) and
-- spends an allowance that cannot be read (0078). Everything else the team does
-- is a message he can ignore.
--
-- ## Why the gate is in the handler and not in the office
--
-- The instruction handler is one of three things that can start a generation:
-- an MCP client can enqueue one (0068), and a scheduled retry can re-enter one
-- (0078). A gate in the office would be a gate on the door Grant uses and no
-- gate at all on the two he does not watch — which is §11's own lesson about a
-- guard applied in one of two call paths, in a different suit.
--
-- So `notebook.generate` refuses to generate unless its own `pinned_config`
-- carries an approval, and the only thing that writes one is a button press.
--
-- ## Why a blocker rather than a new table
--
-- `public.blockers` (0012) is already "a thing waiting on Grant, with options,
-- with consequences of delay, surfaced in Needs Me". An approval request is
-- exactly that and nothing more. A second table would be a second Needs Me.
--
-- ## Approving does not resume a job, it starts one
--
-- The refused job COMPLETES — it did its work, which was to ask. Approval
-- enqueues a fresh generation carrying the approval. That avoids parking a job
-- in `waiting_user` for hours holding a lease, and it makes the audit trail
-- read the way it happened: she asked, he said yes, it ran.

begin;

-- --------------------------------------------------------------------------
-- Asking
-- --------------------------------------------------------------------------

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

  -- Who is asking. The roster's first name, because the message is signed by a
  -- person and a blocker that says "originating_agent: notebook.generate" is a
  -- system talking about itself.
  select coalesce(s.name, 'The team') into v_agent
    from public.routing_decisions r
    join public.staff s on s.slug = r.roster[1]
   where r.job_id = p_job
   order by r.decided_at desc limit 1;

  -- One open request per job. A retry that asked twice would put two identical
  -- messages in front of him, and approving one would leave the other open
  -- forever.
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
    coalesce(v_agent, 'The team'),
    -- Everything else carries on. This is one artifact waiting, not the team
    -- stopped, and §12 keeps those two in different queues for a reason.
    true
  )
  returning blocker_id into v_id;

  return v_id;
end;
$$;

comment on function app.request_generation_approval is
  'Ask before generating. A blocker rather than a new table, because '
  '`blockers` is already "a thing waiting on Grant, with options, surfaced in '
  'Needs Me" and a second one of those would be a second Needs Me.';

-- --------------------------------------------------------------------------
-- Answering
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
  v_new uuid;
begin
  select * into b from public.blockers where blocker_id = p_blocker;
  if not found then
    return jsonb_build_object('error', 'no such request');
  end if;
  if b.state <> 'open' then
    -- Already answered. Not an error: a second press on the same button, or a
    -- press on Slack after answering on Telegram, is the normal way this
    -- happens when a request is delivered to two surfaces.
    return jsonb_build_object('already', true, 'state', b.state);
  end if;

  update public.blockers
     set state = case when p_approved then 'resolved' else 'cancelled' end,
         resolved_at = app.now_utc(),
         resolution = case when p_approved
                        then format('approved by %s', p_by)
                        else format('declined by %s', p_by) end
   where blocker_id = p_blocker;

  if not p_approved then
    return jsonb_build_object('approved', false);
  end if;

  -- The approved run. A NEW job carrying the approval, not a resumption of the
  -- one that asked: that one finished, and its work was the asking.
  select pinned_config into v_config from public.jobs where job_id = b.job_id;

  insert into public.jobs
    (parent_job_id, correlation_id, project_id, idempotency_key, kind,
     requested_by, priority, pinned_config)
  select b.job_id, j.correlation_id, j.project_id,
         format('approved-%s', p_blocker),
         'notebook.generate',
         j.requested_by,
         -- Ahead of the queue. He has just pressed a button and is watching.
         50,
         coalesce(v_config, '{}'::jsonb)
           || jsonb_build_object('approved_by', p_by, 'approval', p_blocker)
    from public.jobs j where j.job_id = b.job_id
  returning job_id into v_new;

  return jsonb_build_object('approved', true, 'job_id', v_new);
end;
$$;

comment on function app.answer_generation_approval is
  'A button press, applied. Idempotent on an already-answered request, because '
  'the same request is delivered to Slack and Telegram and either may answer.';

-- The open request attached to a job, for the button handler to find. Resolved
-- from OUR record of the message rather than from anything the button carries:
-- callback data round-trips through a client, and 0037 already established
-- that the delivery row is the trustworthy end of that.
create or replace function app.open_approval_for_job(p_job uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select blocker_id from public.blockers
   where job_id = p_job and state = 'open'
   order by created_at desc limit 1
$$;

commit;
