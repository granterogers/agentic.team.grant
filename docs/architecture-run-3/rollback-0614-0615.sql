-- Rollback for 0614 + 0615, generated from the live definitions taken BEFORE they were applied
-- (production at 0613). Order: remove the new signatures, restore the old ones.
-- The `kind` columns and the test member are left in place: they change nothing on their own.
-- WARNING: restoring these puts back the behaviour of #385 (the office key deciding as Grant) once the
-- OLD gateway is redeployed. Roll back the gateway and this together, and only if the new ones broke the office.
drop function if exists public.hq_revoke_tool(text, text, text);
drop function if exists public.hq_autonomy_set(text, uuid, text, text);
drop function if exists public.hq_staff_tool_set(text, text, boolean, text);
drop function if exists public.approve_document(uuid, text, text[], uuid, uuid, text);
drop function if exists public.discard_document(uuid, text, text);
drop function if exists public.say_in_project(uuid, text, text, text[], text);
drop function if exists app.say_in_project(uuid, text, text, text[], text);
drop function if exists public.send_to_agent(text, uuid, text, text, uuid, text, text);
drop function if exists app.send_to_agent(text, uuid, text, text, uuid, text, text);
drop function if exists public.office_member(text);
drop function if exists app.office_member(text);

CREATE OR REPLACE FUNCTION app.office_member(p_email text)
 RETURNS TABLE(ok boolean, owner_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select true, m.owner_key
    from public.office_members m
   where m.email = lower(btrim(coalesce(p_email, '')))
   union all
  select false, null::text
   where not exists (
     select 1 from public.office_members m2
      where m2.email = lower(btrim(coalesce(p_email, '')))
   )
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.office_member(p_email text)
 RETURNS TABLE(ok boolean, owner_key text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select * from app.office_member(p_email) $function$
;

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
  v_gen    jsonb;
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
    v_gen := app.answer_generation_approval(
      p_blocker_id,
      -- The affirmative half of whatever this blocker offered. Matched against
      -- the words agents actually use rather than assuming the first option is
      -- the yes, which is true today and is not a rule anybody wrote down.
      lower(v_answer) in ('yes', 'approve', 'approved', 'go ahead', 'ok', 'do it'),
      v_by
    );
    -- 0611: the option chosen and who chose it are columns, so nothing has to
    -- read them back out of the resolution sentence.
    update public.blockers
       set answered_option = v_answer, answered_by = v_by
     where blocker_id = p_blocker_id and state <> 'open';
    return v_gen || jsonb_build_object('ok', true, 'answer', v_answer);
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
     and (v_answer = (b.on_answer ->> 'option')
          -- 0610: other options that PERFORM the same thing. "Add them from now
          -- on" was accepted and left the files it was being asked about
          -- unread, because only one option could carry the work.
          or coalesce(b.on_answer -> 'also', '[]'::jsonb) ? v_answer)
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
         resolution = format('%s — answered by %s', v_answer, v_by),
         answered_option = v_answer,
         answered_by = v_by
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
$function$
;

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

  -- 0611: locked, like hq_answer_blocker (0596). This is the door the button path
  -- calls directly, and it now writes the durable answer, so two presses at the
  -- same moment must not both read 'open' and leave an answer that contradicts
  -- the job that ran.
  select * into b from public.blockers where blocker_id = p_blocker for update;
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
                        else format('declined by %s', p_by) end,
         -- 0611: the option chosen is a column whichever door answered, so an
         -- answer from a button is as visible to the boundary as one typed.
         answered_option = case when p_approved then b.approval_options[1]
                                else coalesce(b.decline_option, b.approval_options[2]) end,
         answered_by = p_by
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
$function$
;

CREATE OR REPLACE FUNCTION app.withdraw_refusal(p_blocker uuid, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  b         public.blockers;
  v_by      text := btrim(coalesce(p_by, ''));
  v_refusal text;
  v_days    integer;
begin
  /*
    Only through the gateway. PostgREST sets request.jwt.claims for the request,
    with the role of the key that was presented: the gateway presents the service
    key, and a call with the anon key, or from SQL that never came through
    PostgREST (a handler, a job, a script), carries no such role and is refused
    here whatever the grants say. The worker connects as a database owner, so the
    grant alone restricts nobody there; this is the check that does.
  */
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    return jsonb_build_object('error', 'Only the gateway, acting for a signed-in person, can take a No back.');
  end if;
  v_refusal := app.principal_refusal(v_by);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;
  if app.harness_label(v_by) or exists (select 1 from public.staff s where s.slug = v_by) then
    return jsonb_build_object('error',
      'Only a person can take a No back, and that name is not a person the office answers to.');
  end if;

  select * into b from public.blockers where blocker_id = p_blocker for update;
  if not found then
    return jsonb_build_object('error', 'there is no such question');
  end if;
  if b.state <> 'resolved' or b.answered_option is null
     or b.answered_option is distinct from b.decline_option then
    return jsonb_build_object('error', 'That question was not answered No, so there is nothing to take back.');
  end if;
  if b.refusal_withdrawn_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'withdrawn_at', b.refusal_withdrawn_at);
  end if;
  v_days := app.refusal_days();
  if b.resolved_at <= app.now_utc() - make_interval(days => v_days) then
    return jsonb_build_object('error', 'That No has already run out, so the office may ask again without this.');
  end if;

  update public.blockers
     set refusal_withdrawn_at = app.now_utc(), refusal_withdrawn_by = v_by
   where blocker_id = p_blocker;

  perform public.append_event(
    p_correlation_id => extensions.gen_random_uuid(),
    p_actor_kind => 'user',
    p_actor => v_by,
    p_trigger => 'approval',
    p_action_type => 'refusal.withdrawn',
    p_reversible => false,
    p_project_id => b.project_id,
    p_before_state => jsonb_build_object('remembered_no', true),
    p_after_state => jsonb_build_object('remembered_no', false),
    p_rationale_summary => format('%s took back the No to: %s', v_by, left(b.requested_action, 120)),
    p_source_refs => '[]'::jsonb,
    p_tool_used => b.standing_tool,
    p_related_job_id => b.job_id);

  return jsonb_build_object('ok', true, 'withdrawn', p_blocker, 'by', v_by,
    'note', 'Nothing was approved. The next attempt may ask again.');
end;
$function$
;

CREATE OR REPLACE FUNCTION app.principal_known(p_by text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.subject_identities s where s.subject = btrim(p_by))
      or exists (select 1 from public.office_members m where m.owner_key = btrim(p_by))
$function$
;

CREATE OR REPLACE FUNCTION app.principal_refusal(p_by text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when btrim(coalesce(p_by, '')) = '' then
      'I cannot tell who is answering, so this was not taken as an answer.'
    when not app.principal_known(p_by) then
      'That answer came from somebody the office does not know, so it was not taken.'
  end
$function$
;

CREATE OR REPLACE FUNCTION public.hq_approve_tool(p_request_id uuid, p_limits jsonb DEFAULT NULL::jsonb, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when app.principal_refusal(p_by) is not null
              then jsonb_build_object('error', app.principal_refusal(p_by))
              else app.approve_tool(p_request_id, btrim(p_by), p_limits) end
$function$
;

CREATE OR REPLACE FUNCTION public.hq_decline_tool(p_request_id uuid, p_reason text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when app.principal_refusal(p_by) is not null
              then jsonb_build_object('error', app.principal_refusal(p_by))
              else app.decline_tool(p_request_id, btrim(p_by), p_reason) end
$function$
;

CREATE OR REPLACE FUNCTION public.hq_grant_standing(p_tool text, p_reason text, p_project uuid DEFAULT NULL::uuid, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when app.principal_refusal(p_by) is not null
              then jsonb_build_object('error', app.principal_refusal(p_by))
              else app.grant_standing(p_tool, p_project, p_reason, btrim(p_by), p_until) end
$function$
;

CREATE OR REPLACE FUNCTION public.hq_revoke_standing(p_authorization uuid, p_reason text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when app.principal_refusal(p_by) is not null
              then jsonb_build_object('error', app.principal_refusal(p_by))
              else app.revoke_standing(p_authorization, p_reason) end
$function$
;

CREATE OR REPLACE FUNCTION public.hq_revoke_tool(p_slug text, p_tool text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select app.revoke_tool(p_slug, p_tool, 'grant') $function$
;

CREATE OR REPLACE FUNCTION public.hq_autonomy_set(p_level text, p_project_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select app.hq_autonomy_set(p_level, p_project_id, 'grant', p_reason) $function$
;

CREATE OR REPLACE FUNCTION public.hq_staff_tool_set(p_slug text, p_tool text, p_granted boolean)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.hq_staff_tool_set(p_slug, p_tool, p_granted, 'grant') $function$
;

CREATE OR REPLACE FUNCTION public.approve_document(p_document uuid, p_collection text DEFAULT NULL::text, p_tags text[] DEFAULT NULL::text[], p_related_task uuid DEFAULT NULL::uuid, p_related_source uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.approve_document(p_document, p_collection, p_tags, p_related_task, p_related_source) $function$
;

CREATE OR REPLACE FUNCTION public.discard_document(p_document uuid, p_why text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.discard_document(p_document, p_why) $function$
;

CREATE OR REPLACE FUNCTION app.say_in_project(p_project_id uuid, p_text text, p_addressed_to text DEFAULT NULL::text, p_addressed_also text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_said     text := nullif(btrim(coalesce(p_text, '')), '');
  v_to       text := nullif(btrim(coalesce(p_addressed_to, '')), '');
  v_also     text[];
  v_asked    text[] := coalesce(p_addressed_also, '{}');
  v_dropped  text[] := '{}';
  v_key      text;
  v_command  uuid;
  v_queued   jsonb;
begin
  if p_project_id is null
     or not exists (select 1 from public.projects where project_id = p_project_id) then
    return jsonb_build_object('ok', false, 'error', 'no such project');
  end if;

  if v_said is null then
    return jsonb_build_object('ok', false, 'error', 'there is nothing to say');
  end if;

  /*
    Who was asked and could not be found, gathered BEFORE anything is dropped.

    The old version returned a single `addressee_dropped`. A composer that
    quietly ignores who you picked is worse than one that says it could not
    find them, and with a selection there can be more than one - so it is a
    list now, and it names every one.
  */
  select coalesce(array_agg(t.slug order by t.slug), '{}')
    into v_dropped
    from unnest(array_remove(array_append(v_asked, v_to), null)) as t(slug)
   where not exists (select 1 from public.staff s where s.slug = t.slug and s.active);

  if v_to is not null
     and not exists (select 1 from public.staff where slug = v_to and active) then
    v_to := null;
  end if;

  /*
    Everybody real that Grant picked, minus whoever is answering.

    If he picked three and named no answerer, the FIRST becomes the answerer
    and the rest are convened - because somebody has to speak, and choosing
    for him here is better than a reply attributed to nobody.
  */
  select coalesce(array_agg(distinct s.slug order by s.slug), '{}')
    into v_also
    from unnest(v_asked) as t(slug)
    join public.staff s on s.slug = t.slug and s.active;

  if v_to is null and cardinality(v_also) > 0 then
    v_to := v_also[1];
  end if;
  v_also := array_remove(v_also, v_to);

  v_key := 'teamhq:message:' || replace(gen_random_uuid()::text, '-', '');

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, addressed_to, addressed_also,
     dedupe_key, project_id, context)
  values ('teamhq', v_key, 'grant', v_said, v_to, v_also, v_key, p_project_id,
          jsonb_build_object('project_id', p_project_id))
  returning command_id into v_command;

  v_queued := app.enqueue_inbound(v_command);

  return jsonb_build_object(
    'ok', true,
    'command', v_command,
    'job', v_queued->>'job_id',
    'project', p_project_id,
    'addressed_to', v_to,
    'addressed_also', to_jsonb(v_also),
    -- Named rather than silent, and all of them rather than the first.
    'addressee_dropped', to_jsonb(v_dropped));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.say_in_project(p_project_id uuid, p_text text, p_addressed_to text DEFAULT NULL::text, p_addressed_also text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select app.say_in_project(p_project_id, p_text, p_addressed_to, p_addressed_also) $function$
;

CREATE OR REPLACE FUNCTION app.send_to_agent(p_kind text, p_id uuid, p_action text, p_to text DEFAULT NULL::text, p_with uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  a          record;
  v_title    text;
  v_project  uuid;
  v_command  uuid;
  v_said     text;
  v_queued   jsonb;
  v_key      text;
begin
  select * into a from public.asset_actions where action = lower(btrim(coalesce(p_action, '')));
  if not found then
    return jsonb_build_object('ok', false, 'error',
      format('no such action: %s', coalesce(p_action, '(none)')));
  end if;

  /*
    The asset's own name and project, from whichever table it lives in.

    Four branches rather than a lookup table: the id columns and the title
    columns genuinely differ, and a generic resolver would need the same four
    branches with a layer of indirection over them.
  */
  if p_kind = 'document' then
    select d.title, d.project_id into v_title, v_project
      from public.documents d where d.document_id = p_id;
  elsif p_kind = 'task' then
    select t.title, t.project_id into v_title, v_project
      from public.tasks t where t.task_id = p_id;
  elsif p_kind = 'contact' then
    select c.name, c.project_id into v_title, v_project
      from public.contacts c where c.contact_id = p_id;
  elsif p_kind = 'collection' then
    select c.name, c.project_id into v_title, v_project
      from public.collections c where c.collection_id = p_id;
  else
    return jsonb_build_object('ok', false, 'error',
      format('cannot send a %s', coalesce(p_kind, '(nothing)')));
  end if;

  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no such %s', p_kind));
  end if;
  if a.needs_two and p_with is null then
    return jsonb_build_object('ok', false, 'error',
      format('%s needs a second thing to compare against', a.label));
  end if;

  v_said := format(a.says, coalesce(nullif(v_title, ''), 'this'));
  if coalesce(btrim(p_note), '') <> '' then
    v_said := v_said || ' ' || btrim(p_note);
  end if;

  v_key := format('asset:%s:%s:%s:%s', p_kind, p_id, a.action,
                  to_char(app.now_utc(), 'YYYYMMDDHH24MISSMS'));

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, addressed_to, dedupe_key, context)
  values ('teamhq', v_key, 'grant', v_said,
          nullif(btrim(coalesce(p_to, '')), ''),
          v_key,
          jsonb_build_object(
            'asset_kind', p_kind,
            'asset_id', p_id,
            'asset_title', v_title,
            'action', a.action,
            'compare_with', p_with,
            'project_id', v_project))
  returning command_id into v_command;

  v_queued := app.enqueue_inbound(v_command);
  if v_queued->>'job_id' is null then
    return jsonb_build_object('ok', false, 'error',
      coalesce(v_queued->>'error', 'the queue refused it'));
  end if;

  insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, made_by)
  values (v_project, p_kind, p_id, 'input_to', 'job', (v_queued->>'job_id')::uuid, 'teamhq')
  on conflict do nothing;

  if p_with is not null then
    insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, made_by)
    values (v_project, p_kind, p_with, 'input_to', 'job', (v_queued->>'job_id')::uuid, 'teamhq')
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'ok', true, 'job', v_queued->>'job_id', 'action', a.label,
    'about', v_title, 'said', v_said);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_to_agent(p_kind text, p_id uuid, p_action text, p_to text DEFAULT NULL::text, p_with uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.send_to_agent(p_kind, p_id, p_action, p_to, p_with, p_note) $function$
;

CREATE OR REPLACE FUNCTION app.enqueue_inbound(p_command_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  c record;
  v_project uuid;
  v_scope public.project_scope_kind;
  v_talk text;
  v_job uuid;
begin
  select * into c from public.inbound_commands where command_id = p_command_id;
  if not found then
    return jsonb_build_object('error', 'no such command');
  end if;
  /*
    0607. A STRANGER IS NOT A CONVERSATION.

    `public.subject_identities` is the authoritative list of which
    channel-native actor is which person, and `app.subject_for` returns null
    for anybody not on it - 0056 says so in its own comment: "mapping an
    unknown actor to the only person on file would let them inherit his
    preferences and his authority". The trigger on inbound_commands honours
    that and writes a null subject. Nothing downstream ever asked: a null
    subject fell through `coalesce(c.subject, c.actor)` and became a job like
    any other, so a stranger who found the bot's public username reached the
    whole office, could teach it standing rules attributed to a name that is
    not Grant's, and (through record_telegram_chat) could become the chat his
    pager writes to.

    Refused here, at the one function every door calls, so that an edge
    function which has not been redeployed is still safe. Telegram only: a
    Telegram actor is a numeric user id and the list is short and exact.

    NOT refused: a synthetic command. A harness that enters through a real
    signed door declares its conversation first (0605) and is contained by
    the origin machinery; refusing it here would turn every containment proof
    into a proof of nothing. `synthetic` is stamped by a BEFORE INSERT trigger
    from the connection, never by the caller, and cannot be changed.
  */
  if c.origin_channel = 'telegram'
     and c.subject is null
     and not coalesce(c.synthetic, false) then
    return jsonb_build_object(
      'refused', true,
      'error', 'unknown sender: this actor is not a person the office knows');
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

  /*
    The asset's project when the command names one (#27, 0313).

    The fallback below — most recently updated — is right for a message that
    arrives out of nowhere and wrong for a button pressed on a document that
    plainly belongs somewhere. Validated against `projects` rather than
    trusted: the context is written by a caller, and a project id that does not
    resolve should fall back rather than file the job nowhere.
  */
  select p.project_id into v_project
    from public.projects p
   where p.project_id = nullif(c.context->>'project_id', '')::uuid;

  /*
    0337. The project the CALLER named, when it named one.

    0335 gave inbound_commands a project_id and 0336 made this function write
    its answer back to it - but nothing ever READ it, so a surface that knows
    perfectly well which project it is sending from had that knowledge thrown
    away in favour of "most recently updated". A column no writer honours is
    the web.search trap in a new place: it claims something that is not true.

    Below the context project, which is more specific still (#27: a button
    pressed on a document names that document's project). Above the fallback,
    which is a guess.

    Compared against unnamed_project() rather than null, because the column is
    NOT NULL and defaults to Unnamed - so "unset" reads as Unnamed here, and an
    adapter that could not resolve a project still reaches the heuristic rather
    than sending everything to the reserved project. That default is what keeps
    a message from being lost; it is not a routing instruction.
  */
  if v_project is null and c.project_id is distinct from app.unnamed_project() then
    v_project := c.project_id;
  end if;

  /*
    0338. The channel the message came from, when Slack is where it came from.

    #187 gives every dashboard project its own named channel and 0014 has
    mapped channel to project since the beginning - deliberately in Postgres
    rather than in a channel topic, because "a topic is editable by anyone in
    the channel and is lost with the channel". Nothing had ever asked that
    table which project a message belonged to.

    So a question typed in #legacy-coaching-course was filed against whichever
    project happened to have been touched most recently, and its answer went
    into that project's conversation. The mapping existed, the reader existed,
    and no line of code joined them.

    origin_ref is `channel:ts` for a Slack message - the message branch of
    toCanonicalCommand builds it that way and its comment says why the ts is
    the message's own rather than the thread parent's. split_part is safe on a
    ref of any other shape: it returns the whole string, which matches no
    channel_id and falls through.

    Only ACTIVE mappings. An archived channel's project is not where new work
    should go, and slack_channel_map keeps the row so the history still
    resolves.
  */
  if v_project is null and c.origin_channel = 'slack' then
    select m.project_id into v_project
      from public.slack_channel_map m
     where m.channel_id = split_part(c.origin_ref, ':', 1)
       and m.active
       and m.project_id is not null;
  end if;

  /*
    0547. WHICH CONVERSATION IS THIS, and what was it already about.

    Everything above resolves a project from THIS message. Nothing had ever
    asked what the conversation was already working on, so the second turn of
    every exchange started again from nothing: a third of Grant's real
    messages and half his voice notes carry no project, and all of them fell
    to the Unnamed fallback below.

    `project_switches` has existed since the beginning and all 169 of its rows
    are harness traffic, because `switchTo` and `resolveProject` in
    `src/projects/context.ts` have no importer and nothing in the resolution
    cascade consulted `app.current_project`. The table, the writer and the
    reader all existed and no line of code joined them - the same shape as the
    dial with no reader, in the mechanism that decides where Grant's work
    goes.

    The conversation is the FIRST segment of origin_ref, which is what the
    Slack branch above already assumes: `1386648496:325` is a chat and a
    message, `C0BVD21Q9S5:1790016258.057200` is a channel and a timestamp.
  */
  v_scope := case c.origin_channel
               when 'telegram' then 'telegram_chat'
               when 'slack'    then 'slack_channel'
               when 'voice'    then 'voice'
               when 'teamhq'   then 'dashboard'
             end::public.project_scope_kind;
  v_talk := nullif(split_part(coalesce(c.origin_ref, ''), ':', 1), '');

  /*
    RECORDED ONLY FROM AN EXPLICIT RESOLUTION, never from a guess.

    Everything that set v_project above is a resolution: an asset's own
    project, a project the surface named, a Slack channel's mapping. The two
    branches BELOW are guesses - the Unnamed fallback and the
    most-recently-updated heuristic - and writing either into the
    conversation's memory would lock the whole exchange onto something nobody
    said. That is the difference between inheriting context and inventing it.

    Unnamed is excluded for the same reason: it is the absence of a project,
    not a project, and a conversation that remembered it could never resolve
    to anything else.

    Idempotent by comparing with what the scope already says, so an exchange
    that stays on one project writes one row rather than one per turn.
  */
  if v_project is not null
     and v_scope is not null
     and v_talk is not null
     and v_project is distinct from app.unnamed_project()
     and v_project is distinct from app.current_project(v_scope, v_talk)
     /*
       0548. ACTIVE only, because `project_switches` refuses anything else and
       says why: "switching into an archived project would file new work
       somewhere nobody is looking." Perfectly right, and 0547 put that
       refusal in the path of every inbound message — a paused project made
       `enqueue_inbound` RAISE, so the message was not merely mis-filed, it
       was lost. Found by the session runner, whose fixture projects are
       paused by ADR-0014.
     */
     and exists (select 1 from public.projects p
                  where p.project_id = v_project and p.status = 'active') then
    /*
      And wrapped, because REMEMBERING is best-effort and DELIVERING is not.

      The condition above covers the rule that exists today. A constraint
      added to `project_switches` tomorrow would otherwise silently become a
      way to drop Grant's messages, and no future author of that constraint
      would think to check this path. The failure is recorded rather than
      swallowed: `app.cannot` is what this repository uses for a write that
      may fail without failing the work.
    */
    begin
      insert into public.project_switches
        (scope_kind, scope_ref, project_id, switched_by, reason)
      values (v_scope, v_talk, v_project,
              coalesce(c.subject, c.actor, 'the office'),
              'The message resolved to this project, so the conversation is about it.');
    exception when others then
      null;
    end;
  end if;

  /*
    AND INHERITED when this message says nothing.

    The invariant: once a conversation is operating in a known project, later
    turns without an explicit one stay there until it is explicitly switched
    or cleared. `app.current_project` already answers that, and already
    returns nothing when the latest switch points at a fixture project (0164),
    so a harness exchange cannot hand a real one its context.

    Below the explicit routes and above both guesses, which is the whole
    ordering argument: anything this message actually says wins, and the
    conversation beats a fallback.
  */
  if v_project is null and v_scope is not null and v_talk is not null then
    v_project := app.current_project(v_scope, v_talk);
  end if;

  /*
    0341. Nothing above could say which project this is.

    Grant, 13 September, asked what should happen to a message in a general
    Telegram chat that names no project: "you can just go in unnamed project as
    a title or category or whatever" (ADR-0024).

    Until now the answer was the line below: the most recently updated active
    project. That is a guess, and its quality is entirely a matter of whether
    he happens to have been working on the thing he is now talking about. When
    it is wrong it is silently wrong - his message and the answer to it are
    filed against a project he never mentioned, and both appear in that
    project's conversation.

    A setting rather than a constant, per §4 and because the cost of each
    choice is real and only he can weigh them. `true` files an unresolvable
    message under Unnamed, which is honest and loses the guess. `false` is the
    old behaviour, which is useful exactly when the guess is right.

    Whichever it is, everything above still wins: an asset's project, a project
    the surface named, and a Slack channel's project are all resolutions rather
    than guesses, so this only decides what happens when there is nothing to go
    on at all.
  */
  if v_project is null
     and coalesce(
           (select value::text::boolean from public.system_config
             where key = 'routing.unnamed_when_unresolved'), true) then
    v_project := app.unnamed_project();
  end if;

  if v_project is null then
    select project_id into v_project
      from public.projects where status = 'active'
     order by updated_at desc
     limit 1;
  end if;

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
            'addressed_also', to_jsonb(coalesce(c.addressed_also, '{}'::text[])),
            'origin_channel', c.origin_channel,
            'origin_ref', c.origin_ref,
            'command_id', p_command_id,
            'voice_file_id', c.voice_file_id,
            'voice_seconds', c.voice_seconds,
            -- The asset and the action, as facts (#27).
            'context', c.context
          ))
  on conflict (idempotency_key)
    where state <> all (array['complete'::public.job_state,
                              'cancelled'::public.job_state,
                              'failed'::public.job_state])
    do nothing
  returning job_id into v_job;

  -- THE LOSER OF THE RACE WANTS THE WINNER'S JOB (0528).
  -- `do nothing` returns no row, so v_job is null exactly when
  -- another call inserted first. Reading it back is the whole
  -- point: both callers must be told the same job id, which is
  -- what idempotent means to the adapter that asked.
  if v_job is null then
    select job_id into v_job from public.jobs
     where idempotency_key = format('inbound-%s', p_command_id)
       and state <> all (array['complete'::public.job_state,
                               'cancelled'::public.job_state,
                               'failed'::public.job_state]);
    if v_job is null then
      raise exception 'could not record what you said: the job for' 
        ' command % was neither inserted nor found', p_command_id;
    end if;
  end if;

  /*
    0336. The command's project is set to whatever the job resolved to.

    Added because #192 gave inbound_commands a project of its own and this
    function chooses the job's project independently - so the two could
    disagree and split one exchange across two conversations: Grant's message
    under the column's default, the office's answer under the job's project.

    Measured before changing anything: 193 of 194 enqueued commands reach the
    "most recently updated active project" fallback above, and exactly one has
    ever named a project in its context. So the heuristic is not an edge case,
    it is the path - which is why this reconciles the command TO the job rather
    than the other way round. Where work is ROUTED is a different decision from
    where a conversation GROUPS, and ADR-0024 was the latter.
  */
  update public.inbound_commands
     set job_id = v_job, processed_at = app.now_utc(), project_id = v_project
   where command_id = p_command_id;

  return jsonb_build_object('job_id', v_job, 'already', false, 'spoken', c.voice_file_id is not null);
end;
$function$
;

do $rb$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('hq_approve_tool','hq_decline_tool','hq_grant_standing','hq_revoke_standing','hq_revoke_tool',
                                'hq_autonomy_set','hq_staff_tool_set','approve_document','discard_document','office_member',
                                'say_in_project','send_to_agent')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $rb$;
