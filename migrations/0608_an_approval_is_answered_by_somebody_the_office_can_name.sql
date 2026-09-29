/*
  0608 - an approval is answered by somebody the office can name

  Audit finding B2 (architecture audit, 29 September 2026), verified first.
  Every route that answered an approval attributed the answer to Grant without
  anything proving it was him:

    - app.hq_answer_blocker wrote 'grant' three times: the approval child job's
      `approved_by`, a standing authorization's `given_by`, and the decision
      log's `decided_by` (which readers treat as HIS word);
    - the button path (src/channels/callbacks.ts, driven by src/office/pass.ts)
      passed the literal 'grant' for EVERY pending press and ignored the
      pressing actor recorded on the row;
    - the gateway's tool-approval and standing-authorization wrappers hardcode
      'grant' in SQL, because "there is exactly one person holding the token".

  This does the attribution half only. The unified approval lifecycle is a
  later workstream. What changes:

    - app.principal_known / app.principal_refusal: the one question "is this a
      person the office knows", answered from the same two lists everything
      else uses (public.subject_identities and public.office_members).
    - app.hq_answer_blocker and app.answer_generation_approval take the
      answering principal and refuse one that is absent or unknown. Nothing
      defaults.
    - the four gateway wrappers take `p_by` and refuse likewise; the gateway
      supplies it from the credential it verified, and strips any `p_by` the
      client sent.

  Old signatures are dropped by exact argument list (a `create or replace` with
  a changed list would leave an overload behind, and the old two-argument call
  would go on working with no identity). Spliced from the live definitions.
*/

create or replace function app.principal_known(p_by text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.subject_identities s where s.subject = btrim(p_by))
      or exists (select 1 from public.office_members m where m.owner_key = btrim(p_by))
$$;

comment on function app.principal_known(text) is
  'Is this a person the office knows? Answered from subject_identities (a channel-native actor is which person) and office_members (a signed-in address belongs to which owner). Null and blank are nobody.';

create or replace function app.principal_refusal(p_by text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when btrim(coalesce(p_by, '')) = '' then
      'I cannot tell who is answering, so this was not taken as an answer.'
    when not app.principal_known(p_by) then
      'That answer came from somebody the office does not know, so it was not taken.'
  end
$$;

/*
  Who a chat turn or a button press came from, as the door recorded it: the
  resolved subject when the sender is on the list, else the actor the door
  wrote (the Team HQ functions write 'grant' behind the gateway; a Telegram or
  Slack actor is a platform id and resolves or is nobody). Deliberately NOT
  defaulted: a command that does not exist has no principal, and the caller
  passes the answer to app.principal_refusal, which decides whether the office
  knows that person.
*/
create or replace function app.command_principal(p_command uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(c.subject, c.actor) from public.inbound_commands c
   where c.command_id = p_command
$$;

revoke all on function app.command_principal(uuid) from public;
grant execute on function app.command_principal(uuid) to ai_team_app, service_role;

revoke all on function app.principal_known(text) from public;
revoke all on function app.principal_refusal(text) from public;
grant execute on function app.principal_known(text) to ai_team_app, service_role;
grant execute on function app.principal_refusal(text) to ai_team_app, service_role;

-- The old shapes, by exact signature.
drop function if exists public.hq_answer_blocker(uuid, text);
drop function if exists app.hq_answer_blocker(uuid, text);
drop function if exists public.hq_approve_tool(uuid, jsonb);
drop function if exists public.hq_decline_tool(uuid, text);
drop function if exists public.hq_grant_standing(text, text, uuid, timestamptz);
drop function if exists public.hq_revoke_standing(uuid, text);

CREATE OR REPLACE FUNCTION app.hq_answer_blocker(p_blocker_id uuid, p_answer text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  b        public.blockers;
  v_answer text := btrim(coalesce(p_answer, ''));
  v_next   text;
  v_was    text;
  v_standing jsonb;
  v_started integer := 0;
  v_by     text := btrim(coalesce(p_by, ''));
  v_refusal text;
begin
  /*
    0608. WHO IS ANSWERING is an argument the caller has to prove, never a
    default this function supplies.

    Every 'grant' in this body used to be a literal: the approval child job
    said `approved_by grant`, a standing authorization said `given by grant`,
    and the decision log said `decided_by grant` - whoever had pressed. The
    decision log's own comment says that value is "what lets the reader treat
    this as a record of what HE said", so an answer from anybody else was
    recorded as his word.

    The door now says who answered (the gateway from the verified credential,
    the chat path from the channel identity the sender was admitted under),
    and this refuses one that names nobody the office knows. Refused BEFORE
    the row is locked or read, so a refusal reveals nothing about the question.
  */
  v_refusal := app.principal_refusal(v_by);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;

  /*
    0596: ONE ANSWER PER QUESTION, EVEN AT THE SAME MOMENT.

    Read without a lock, and the update below does not re-check the state, so
    two overlapping answers - the dashboard and Telegram, or a double press -
    both saw 'open' and both performed what answering promises. Reproduced on
    production by verify:approval-race: one question, two child jobs. FOR
    UPDATE makes the second answer wait for the first and then read
    'resolved', which is the existing "already answered" reply.
  */
  select * into b from public.blockers where blocker_id = p_blocker_id for update;
  if not found then
    return jsonb_build_object('error', 'there is nothing here to answer');
  end if;
  if b.state <> 'open' then
    -- Not an error. Answering something already answered is what two open tabs
    -- produces, and the honest reply is what it was answered with.
    return jsonb_build_object('ok', false, 'already', true,
      'state', b.state::text, 'resolution', b.resolution);
  end if;
  if v_answer = '' then
    return jsonb_build_object('error', 'say what the answer is');
  end if;

  if array_length(b.approval_options, 1) is not null
     and not (v_answer = any (b.approval_options)) then
    return jsonb_build_object('error', format(
      'that is not one of the answers this asks for: %s',
      array_to_string(b.approval_options, ', ')));
  end if;

  /*
    A generation approval is answered by the function that already knows what
    approving one MEANS — it queues the follow-on job. Resolving the row here
    instead would mark it answered and queue nothing.
  */
  select pinned_config ->> 'approval_next' into v_next
    from public.jobs where job_id = b.job_id;
  if v_next is not null then
    return app.answer_generation_approval(
      p_blocker_id,
      -- The affirmative half of whatever this blocker offered. Matched against
      -- the words agents actually use rather than assuming the first option is
      -- the yes, which is true today and is not a rule anybody wrote down.
      lower(v_answer) in ('yes', 'approve', 'approved', 'go ahead', 'ok', 'do it'),
      v_by
    ) || jsonb_build_object('ok', true, 'answer', v_answer);
  end if;

  /*
    "From now on" becomes a row, not a sentence (#15).

    The Drive watcher has offered "do not ask again" as an option since it was
    written, and nothing could honour it -- there was nowhere to write the
    answer. Now the blocker NAMES the tool a standing authorization would cover
    and which of its options grants one, so this does not have to read English
    to find out. `blockers.approval_options` is free text a handler composes;
    deciding a permission by matching words in it would be the parsing defect
    #130 is about, one layer up.

    Scoped to the blocker's own project. A question asked about one project is
    not consent for every project, and `grant_standing` takes null for
    everywhere only when a caller passes it deliberately.

    Never fatal, and never silent: if the grant is refused (a level-3 tool, an
    unknown one) the answer still resolves the blocker and the outcome says
    what happened, because losing Grant's answer to protect a permission would
    be the worse of the two.
  */
  if b.standing_tool is not null
     and b.standing_option is not null
     and v_answer = b.standing_option then
    v_standing := app.grant_standing(
      b.standing_tool, b.project_id,
      format('You answered "%s" on %s.', v_answer, b.created_at::date), v_by, null);
  end if;

  /*
    And the office remembers it decided this (#129).

    The options Grant did NOT pick are `ruled_out`, which is the field the
    Issue is about and the one that would otherwise be skipped: *"we chose
    Notion" is worth a fraction of "we chose Notion over Drive because..."*.
    They are right here, in `approval_options`, and no model is needed to know
    what they were.

    `decided_by` is the answering person, which is what lets the reader treat this as a
    record of what HE said rather than as the office's own prose.

    Never fatal. Losing his answer to protect a memory of it would be the wrong
    way round, and a write allowed to fail must say so rather than vanish --
    which is why the failure is recorded rather than swallowed.
  */
  begin
    perform app.record_decision_made(
      b.requested_action,
      v_answer,
      (select array_agg(o) from unnest(coalesce(b.approval_options, array[]::text[])) o
        where o <> v_answer),
      coalesce(nullif(btrim(b.why_needed), ''), 'You answered the question the office asked.'),
      v_by, b.project_id, b.job_id, null);
  exception when others then
    perform app.cannot(b.job_id, 'not_capable', 'remember this decision',
                       'hq_answer_blocker', left(sqlerrm, 400), null);
  end;

  /*
    And the answer DOES the thing (#257).

    `handlers/drive.ts` has offered "Add them to the project as source
    documents" since #62, and answering it has never been able to work: the
    page token advances whether or not Grant was asked, so by the time he
    answers, those files are no longer in the change list and there is nothing
    left to act on. A dead option on a question he can see.

    So the blocker carries WHAT ANSWERING PERFORMS, written by the handler that
    raised it: a job kind and one payload per thing. Not a model's words and
    not an interpretation of the option text -- the parsing defect #130 is
    about, on a path that enqueues work.

    Bounded on purpose: through `app.enqueue_child`, on the blocker's own job,
    so the child inherits the project and the requester and
    `enforce_delegation_depth` caps it. Nothing here can reach a project the
    question did not come from.

    Never fatal, and never silent: a failure here is an impediment, because
    losing his answer to protect a queue would be the wrong way round.
  */
  if b.on_answer is not null
     and b.on_answer ? 'option'
     and v_answer = (b.on_answer ->> 'option')
     and coalesce(b.on_answer ->> 'kind', '') <> '' then
    begin
      select count(*) into v_started
        from jsonb_array_elements(coalesce(b.on_answer -> 'payloads', '[]'::jsonb)) as pay
       where app.enqueue_child(b.job_id, b.on_answer ->> 'kind', pay, interval '0', false)
             is not null;
    exception when others then
      perform app.cannot(b.job_id, 'not_capable',
                         format('do what answering %L promised', v_answer),
                         'hq_answer_blocker', left(sqlerrm, 400), null);
    end;
  end if;

  update public.blockers
     set state = 'resolved',
         resolved_at = app.now_utc(),
         resolution = format('%s — answered by %s', v_answer, v_by)
   where blocker_id = p_blocker_id;

  /*
    And the job is let go, by the road the state machine allows.

    A resolved blocker whose job is still parked in `waiting_user` is a job
    nothing will ever pick up — the interface would say answered and nothing
    would run. But `waiting_user -> queued` is not an edge, and 0290's header
    says why it should not be: `queued` means nobody has looked at this yet.

    So: park it, then queue it. Both transitions are written to
    `job_state_transitions` by the trigger, and the ledger reads as what
    happened — the wait ended, then the job went back in the queue.
  */
  -- One definition, in app.let_job_go (0496, 0497). A second copy here is
  -- two writers of one field, which is what 0472 exists to stop.
  perform app.let_job_go(b.job_id, format('answered: %s', v_answer));

  return jsonb_build_object('ok', true, 'answer', v_answer, 'blocker', p_blocker_id,
    -- Null when the answer granted nothing, which is the common case.
    'standing', v_standing,
    -- How many jobs answering actually started. Zero is the common case
    -- and is not an error; a number he can hold against what he was
    -- promised is the point (0350's rule about a claim with nothing
    -- behind it).
    'started', v_started);
end;
$function$;

CREATE OR REPLACE FUNCTION app.answer_generation_approval(p_blocker uuid, p_approved boolean, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  b public.blockers;
  v_config jsonb;
  v_next text;
  v_new uuid;
  v_refusal text;
begin
  -- 0608: called directly by the button path as well as by hq_answer_blocker,
  -- so it refuses an unidentified approver for itself.
  v_refusal := app.principal_refusal(p_by);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;

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
$function$;


create or replace function public.hq_answer_blocker(
  p_blocker_id uuid, p_answer text, p_by text default null)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $$ select app.hq_answer_blocker(p_blocker_id, p_answer, p_by) $$;

revoke all on function public.hq_answer_blocker(uuid, text, text) from public;
grant execute on function public.hq_answer_blocker(uuid, text, text) to ai_team_app, service_role;
revoke all on function app.hq_answer_blocker(uuid, text, text) from public;
grant execute on function app.hq_answer_blocker(uuid, text, text) to ai_team_app, service_role;

-- The gateway's other answers to a question of authority. Each was
-- `app.<fn>(..., 'grant', ...)`; each now says who, or says nothing.
create or replace function public.hq_approve_tool(
  p_request_id uuid, p_limits jsonb default null, p_by text default null)
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select case when app.principal_refusal(p_by) is not null
              then jsonb_build_object('error', app.principal_refusal(p_by))
              else app.approve_tool(p_request_id, btrim(p_by), p_limits) end
$$;

create or replace function public.hq_decline_tool(
  p_request_id uuid, p_reason text default null, p_by text default null)
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select case when app.principal_refusal(p_by) is not null
              then jsonb_build_object('error', app.principal_refusal(p_by))
              else app.decline_tool(p_request_id, btrim(p_by), p_reason) end
$$;

create or replace function public.hq_grant_standing(
  p_tool text, p_reason text, p_project uuid default null,
  p_until timestamptz default null, p_by text default null)
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select case when app.principal_refusal(p_by) is not null
              then jsonb_build_object('error', app.principal_refusal(p_by))
              else app.grant_standing(p_tool, p_project, p_reason, btrim(p_by), p_until) end
$$;

-- app.revoke_standing takes no principal and records none; refusing an
-- unidentified revoker is all that can be done at this layer.
create or replace function public.hq_revoke_standing(
  p_authorization uuid, p_reason text default null, p_by text default null)
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select case when app.principal_refusal(p_by) is not null
              then jsonb_build_object('error', app.principal_refusal(p_by))
              else app.revoke_standing(p_authorization, p_reason) end
$$;

do $g$
declare f text;
begin
  foreach f in array array[
    'public.hq_approve_tool(uuid, jsonb, text)',
    'public.hq_decline_tool(uuid, text, text)',
    'public.hq_grant_standing(text, text, uuid, timestamptz, text)',
    'public.hq_revoke_standing(uuid, text, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$g$;
