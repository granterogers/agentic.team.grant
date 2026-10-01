-- 0741 - approvals, governance and the team page take an office (multi-user P3, cluster d).
--
-- THE APPROVAL DOOR. app.hq_answer_blocker is the one place a human's yes or no becomes an action: it queues the follow-on,
-- grants a standing authorization, performs what the question promised and records who answered. It read the blocker by
-- its id alone, so with a second person a question of the first was answerable by anyone who could name the id. Now it
-- takes `p_office` FIRST and the blocker is looked up `where blocker_id = ... and office_id = p_office`: another office's
-- question and a question that does not exist answer with the same sentence, and nothing of the other office moves.
-- WHO answers is untouched - `p_by` is still the verified person the door injects (principal_refusal runs first, before
-- the row is read); this adds WHERE the answer may land, not who may give it. A standing authorization is minted by
-- app.grant_standing(p_office, ...), which replaces and inserts only inside the office, and the trigger that refuses a
-- standing authorization on a level-3 tool, and the `action_level < 3 or verdict <> 'proceed'` floor, are untouched.
--
-- Converted here (each in app and in public, the public one being the gateway's door): hq_answer_blocker, decide_proposal,
-- decide_suggestion, hq_autonomy_set, hq_staff_tool_set, hq_staff, hq_team, hq_retire_skill, retract_lesson,
-- request_stop, job_progress, hq_governance.
--
-- No `'grant'` literal survives: where a writer stamped it as the actor it now asks app.office_actor(p_office).


-- A tool grant belongs to an office. staff_tools was keyed (staff_slug, tool): with a second person, one office holding a
-- tool made every other office's grant of it a silent no-op (ON CONFLICT DO NOTHING) that still reported success. The key
-- now includes the office. No foreign key points at it, and the two writers (approve_tool, hq_staff_tool_set) name the new
-- key below; the suites that insert with a bare ON CONFLICT DO NOTHING are unaffected.
alter table public.staff_tools drop constraint staff_tools_pkey;
alter table public.staff_tools add constraint staff_tools_pkey primary key (office_id, staff_slug, tool);


create function app.hq_answer_blocker(p_office uuid, p_blocker_id uuid, p_answer text, p_by text DEFAULT NULL::text)
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
  v_called_off boolean;
begin
  perform app.require_office(p_office);
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
  select * into b from public.blockers where blocker_id = p_blocker_id and office_id = p_office for update;
  if not found then
    return jsonb_build_object('error', 'there is nothing here to answer');
  end if;
  /*
    0614. A test principal decides only test traffic. Asked AFTER the row is held
    (the context is the question's own job and project) and BEFORE anything is
    revealed about it, so the refusal is the same sentence for a stranger.
  */
  v_refusal := app.authority_refusal(v_by, b.job_id, b.project_id);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;
  /*
    0618. An answer that GRANTS a standing authorization is a different act from an answer that resolves a
    question: it changes what the office may do without asking, from now on, in that project. A test
    principal does that only in a fixture project. Refused before the row is resolved, so it changes nothing.
  */
  if b.standing_tool is not null
     and b.standing_option is not null
     and v_answer = b.standing_option then
    v_refusal := app.authority_refusal(v_by, null, b.project_id);
    if v_refusal is not null then
      return jsonb_build_object('error', v_refusal);
    end if;
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
  /*
    CALLED OFF (review of the final audit). A cancelled job keeps its open question, so a later Yes - a stale Approve
    button on Slack or Telegram, a dashboard press - answered the question and STARTED what had been withdrawn: the
    generation child, the on_answer work. The answer is still recorded (it is what he said), but nothing is started
    for a job that was called off.
  */
  v_called_off := exists (select 1 from public.jobs j where j.job_id = b.job_id and j.office_id = p_office and j.state = 'cancelled');
  select case when pinned_config ? 'approval' then null else pinned_config ->> 'approval_next' end into v_next
    from public.jobs where job_id = b.job_id and office_id = p_office;
  if v_next is not null and v_called_off then
    update public.blockers
       set state = 'resolved', resolved_at = app.now_utc(),
           resolution = format('%s — answered by %s, but the work it asked about was called off, so nothing was started', v_answer, v_by),
           answered_option = v_answer, answered_by = v_by
     where blocker_id = p_blocker_id and office_id = p_office;
    return jsonb_build_object('ok', true, 'answer', v_answer, 'called_off', true, 'started', 0);
  end if;
  if v_next is not null then
    v_gen := app.answer_generation_approval(
      p_office, p_blocker_id,
      -- The affirmative half of whatever this blocker offered. Matched against
      -- the words agents actually use rather than assuming the first option is
      -- the yes, which is true today and is not a rule anybody wrote down.
      case when b.decline_option is not null then v_answer <> b.decline_option
           else lower(v_answer) in ('yes', 'approve', 'approved', 'go ahead', 'ok', 'do it') end,
      v_by
    );
    -- 0611: the option chosen and who chose it are columns, so nothing has to
    -- read them back out of the resolution sentence.
    update public.blockers
       set answered_option = v_answer, answered_by = v_by
     where blocker_id = p_blocker_id and office_id = p_office and state <> 'open';
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
      p_office, b.standing_tool, b.project_id,
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
      p_office, b.requested_action,
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
     and not v_called_off
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
   where blocker_id = p_blocker_id and office_id = p_office;

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
revoke all on function app.hq_answer_blocker(uuid, uuid, text, text) from public, anon, authenticated, service_role;
create function public.hq_answer_blocker(p_office uuid, p_blocker_id uuid, p_answer text, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_answer_blocker(p_office, p_blocker_id, p_answer, p_by) $f$;
revoke all on function public.hq_answer_blocker(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_answer_blocker(uuid, uuid, text, text) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.hq_answer_blocker(uuid, text, text);
drop function app.hq_answer_blocker(uuid, text, text);

create function app.decide_proposal(p_office uuid, p_proposal_id uuid, p_state text, p_note text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_was text;
  v_title text;
  v_remedy text;
  v_argument text;
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  select state, title, remedy, argument
    into v_was, v_title, v_remedy, v_argument
    from public.proposals where proposal_id = p_proposal_id and office_id = p_office;
  if v_was is null then
    return jsonb_build_object('error', 'there is no such proposal');
  end if;
  if p_state not in ('open', 'approved', 'declined', 'done') then
    return jsonb_build_object('error', format('%L is not a state a proposal can be in', p_state));
  end if;

  update public.proposals
     set state = p_state,
         decided_at = case when p_state = 'open' then null else app.now_utc() end,
         decided_by = case when p_state = 'open' then null else p_by end,
         decided_note = nullif(btrim(coalesce(p_note, '')), '')
   where proposal_id = p_proposal_id and office_id = p_office;

  /*
    A settled proposal is a decision the office should not have to rediscover
    (#129).

    Only when it SETTLES. Reopening one is Grant changing his mind about
    whether to decide, not a decision — and writing a row for it would put
    "open" in a log whose whole purpose is to say what was concluded.

    What it ruled out is the proposal's own remedy when the answer was no: an
    agent about to propose the same thing again can find that it was declined,
    which is #129's second bullet exactly. `times_seen` goes into the reason,
    because a wall hit nine times and declined is a different fact from one hit
    once.
  */
  if p_state in ('approved', 'declined') then
    begin
      perform app.record_decision_made(
        p_office,
        format('Should the office be able to %s?', coalesce(nullif(btrim(v_title), ''), 'do this')),
        case when p_state = 'approved' then coalesce(nullif(btrim(v_remedy), ''), 'yes')
             else 'No, not for now' end,
        case when p_state = 'declined'
             then array[coalesce(nullif(btrim(v_remedy), ''), 'the thing proposed')]
             else array[]::text[] end,
        coalesce(nullif(btrim(p_note), ''),
                 nullif(btrim(v_argument), ''),
                 'Decided on the proposals page.'),
        p_by, null, null, null);
    exception when others then
      -- A memory that cannot be written must not undo a verdict that was.
      null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'was', v_was, 'now', p_state);
end;
$function$;
revoke all on function app.decide_proposal(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
create function public.decide_proposal(p_office uuid, p_proposal_id uuid, p_state text, p_note text default null, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.decide_proposal(p_office, p_proposal_id, p_state, p_note, p_by) $f$;
revoke all on function public.decide_proposal(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.decide_proposal(uuid, uuid, text, text, text) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.decide_proposal(uuid, text, text, text);
drop function app.decide_proposal(uuid, text, text, text);

create function app.decide_suggestion(p_office uuid, p_suggestion_id uuid, p_accept boolean, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  s      public.suggestions;
  v_did  jsonb;
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  -- 0596: locked, for the reason hq_answer_blocker is. A double press on
  -- Accept would otherwise call app.learn twice, and lessons are append-only.
  select * into s from public.suggestions where suggestion_id = p_suggestion_id and office_id = p_office for update;
  if s.suggestion_id is null then
    return jsonb_build_object('error', 'there is no such suggestion');
  end if;
  if s.state <> 'open' then
    return jsonb_build_object('already', s.state);
  end if;

  if not p_accept then
    /*
      Dismissed is a decision, and the count is the office being told it is not
      taking a hint. `raise_suggestions` reads it; so does the page, loudly,
      above zero.
    */
    update public.suggestions
       set state = 'dismissed', settled_at = app.now_utc(),
           dismissals = coalesce(dismissals, 0) + 1
     where suggestion_id = p_suggestion_id and office_id = p_office;
    return jsonb_build_object('accepted', false, 'state', 'dismissed');
  end if;

  if s.offer_kind = 'learn' then
    -- The only path by which a correction becomes a rule, and it is reachable
    -- only from a press. `app.learn` answers in JSONB, not with an id.
    v_did := app.learn(
      p_office,
      (s.offer_args ->> 'scope')::lesson_scope,
      s.body,
      p_by,
      nullif(s.offer_args ->> 'project_id', '')::uuid,
      nullif(s.offer_args ->> 'staff', ''),
      null,
      nullif(s.offer_args ->> 'from_job', '')::uuid,
      0.9,
      null);
  end if;

  if s.offer_kind = 'teach_skill' then
    -- The only path by which a procedure he taught is kept, and it is reachable only from a press. The same writer and
    -- the same ADR-0017 boundary as before; a refusal is an answer to the press, and the offer stays open.
    begin
      v_did := app.teach_skill(
        p_office => p_office,
        p_name => s.offer_args ->> 'name',
        p_when_to_use => coalesce(nullif(s.offer_args ->> 'when', ''), 'when it comes up'),
        p_procedure => s.offer_args ->> 'procedure',
        p_authored_by => p_by,
        p_scope => (s.offer_args ->> 'scope')::lesson_scope,
        p_project_id => nullif(s.offer_args ->> 'project_id', '')::uuid,
        p_staff_slug => nullif(s.offer_args ->> 'staff', ''),
        p_from_job => nullif(s.offer_args ->> 'from_job', '')::uuid);
    exception when others then
      return jsonb_build_object('error', left(sqlerrm, 300));
    end;
    if v_did ? 'error' then
      return jsonb_build_object('error', v_did ->> 'error');
    end if;
  end if;

  update public.suggestions
     set state = 'acted', settled_at = app.now_utc()
   where suggestion_id = p_suggestion_id and office_id = p_office;

  return jsonb_build_object('accepted', true, 'state', 'acted',
                            'lesson_id', v_did -> 'lesson_id',
                            'did', coalesce(s.offer_kind, 'nothing but noting it'));
end;
$function$;
revoke all on function app.decide_suggestion(uuid, uuid, boolean, text) from public, anon, authenticated, service_role;
create function public.decide_suggestion(p_office uuid, p_suggestion_id uuid, p_accept boolean, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.decide_suggestion(p_office, p_suggestion_id, p_accept, p_by) $f$;
revoke all on function public.decide_suggestion(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.decide_suggestion(uuid, uuid, boolean, text) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.decide_suggestion(uuid, boolean, text);
drop function app.decide_suggestion(uuid, boolean, text);

create function app.hq_autonomy_set(p_office uuid, p_level text, p_project_id uuid DEFAULT NULL::uuid, p_by text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_was text;
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  -- A project of another office and a project that does not exist answer alike.
  if p_project_id is not null and app.project_in_office(p_office, p_project_id::text) is null then
    return jsonb_build_object('error', 'there is no such project');
  end if;
  if p_level not in ('observe', 'suggest', 'act_with_review', 'act') then
    return jsonb_build_object('error',
      format('%L is not an autonomy level. They are: observe, suggest, '
             || 'act_with_review, act.', p_level));
  end if;

  select a.level::text into v_was
    from public.autonomy_settings a
   where a.office_id = p_office and a.project_id is not distinct from p_project_id
   order by a.set_at desc limit 1;

  insert into public.autonomy_settings (office_id, project_id, level, set_by, reason)
  values (p_office, p_project_id, p_level::public.autonomy_level, p_by,
          coalesce(nullif(btrim(p_reason), ''),
                   format('Set from the dashboard on %s.',
                          to_char(app.now_utc(), 'FMDD Mon YYYY'))));

  -- How much the office may do without asking is exactly the kind of change
  -- that must be answerable three months later.
  perform app.append_event(
    p_office, extensions.gen_random_uuid(), 'user', p_by, 'settings', 'autonomy.changed',
    true, p_project_id,
    jsonb_build_object('level', v_was),
    jsonb_build_object('level', p_level),
    format('Autonomy %s → %s.', coalesce(v_was, 'unset'), p_level),
    '[]'::jsonb, null, null,
    'app.hq_autonomy_set with the previous level', null);

  return jsonb_build_object('level', p_level, 'was', v_was,
                            'scope', case when p_project_id is null
                                          then 'the whole office'
                                          else 'this project' end);
end;
$function$;
revoke all on function app.hq_autonomy_set(uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
create function public.hq_autonomy_set(p_office uuid, p_level text, p_project_id uuid default null, p_reason text default null, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$
  select case when app.authority_refusal(p_by, null, p_project_id) is not null
              then jsonb_build_object('error', app.authority_refusal(p_by, null, p_project_id))
              else app.hq_autonomy_set(p_office, p_level, p_project_id, btrim(p_by), p_reason) end
$f$;
revoke all on function public.hq_autonomy_set(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_autonomy_set(uuid, text, uuid, text, text) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.hq_autonomy_set(text, uuid, text, text);
drop function app.hq_autonomy_set(text, uuid, text, text);

create function app.hq_staff_tool_set(p_office uuid, p_slug text, p_tool text, p_granted boolean, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_enabled boolean;
  v_reason  text;
  v_changed boolean;
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  if not exists (select 1 from public.staff where slug = p_slug) then
    return jsonb_build_object('error', format('no one called %L', p_slug));
  end if;

  select enabled, disabled_reason into v_enabled, v_reason
    from public.tool_permissions where tool = p_tool;
  if not found then
    return jsonb_build_object('error', format('there is no tool called %L', p_tool));
  end if;

  -- Refused rather than accepted-and-ignored. A checkbox that ticks and then
  -- does nothing is worse than one that refuses and says why: the first one
  -- teaches you the permission is on.
  if p_granted and not v_enabled then
    return jsonb_build_object(
      'error', format('%s is switched off for everyone: %s', p_tool, coalesce(v_reason, 'no reason recorded'))
    );
  end if;

  if p_granted then
    insert into public.staff_tools (office_id, staff_slug, tool, granted_by, note)
    values (p_office, p_slug, p_tool, p_by, 'Granted from the team page.')
    on conflict (office_id, staff_slug, tool) do nothing;
    v_changed := found;
  else
    delete from public.staff_tools where office_id = p_office and staff_slug = p_slug and tool = p_tool;
    v_changed := found;
  end if;

  /*
    The ledger, in the same words the request path uses.

    `tool.granted` and `tool.revoked` are the action types already on record —
    a third spelling for the same fact would make the two doors unjoinable,
    which is what 0311 was spent undoing in a different vocabulary.
  */
  if v_changed then
    perform app.append_event(
      p_office, extensions.gen_random_uuid(), 'user', p_by, 'approval',
      case when p_granted then 'tool.granted' else 'tool.revoked' end,
      true, null,
      jsonb_build_object('held', not p_granted),
      jsonb_build_object('held', p_granted),
      format('%s %s holds %s.', p_slug,
             case when p_granted then 'now' else 'no longer' end, p_tool),
      '[]'::jsonb, null, p_tool,
      case when p_granted then 'app.revoke_tool' else 'app.hq_staff_tool_set on again' end,
      null);
  end if;

  return jsonb_build_object('slug', p_slug, 'tool', p_tool, 'granted', p_granted,
                            'changed', v_changed);
end;
$function$;
revoke all on function app.hq_staff_tool_set(uuid, text, text, boolean, text) from public, anon, authenticated, service_role;
create function public.hq_staff_tool_set(p_office uuid, p_slug text, p_tool text, p_granted boolean, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$
  select case when app.authority_refusal(p_by) is not null
                and not (app.principal_kind(p_by) = 'harness' and app.harness_label(p_slug))
              then jsonb_build_object('error', app.authority_refusal(p_by))
              else app.hq_staff_tool_set(p_office, p_slug, p_tool, p_granted, btrim(p_by)) end
$f$;
revoke all on function public.hq_staff_tool_set(uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.hq_staff_tool_set(uuid, text, text, boolean, text) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.hq_staff_tool_set(text, text, boolean, text);
drop function app.hq_staff_tool_set(text, text, boolean, text);

create function app.approve_tool(p_office uuid, p_request_id uuid, p_by text DEFAULT NULL::text, p_limits jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  req    public.tool_requests%rowtype;
  known  public.tool_permissions%rowtype;
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  if p_by is distinct from app.office_actor(p_office) then
    return jsonb_build_object('error',
      'only the person this office belongs to approves reach. An agent may ask and may never answer (ADR-0018).');
  end if;

  select * into req from public.tool_requests where request_id = p_request_id and office_id = p_office for update;
  if not found then
    return jsonb_build_object('error', 'no such request: ' || p_request_id::text);
  end if;
  if req.state <> 'open' then
    return jsonb_build_object('error', 'that request was already ' || req.state);
  end if;

  update public.tool_requests
     set state = 'approved', settled_at = app.now_utc(),
         decided_by = p_by, limits = p_limits
   where request_id = p_request_id and office_id = p_office;

  select * into known from public.tool_permissions where tool = req.tool;

  /*
    No implementation behind the name, so there is nothing to grant.

    Inserting the row anyway would make the approval appear to work and leave a
    permission that may or may not do anything. What Grant has actually decided
    here is that he wants it built, and saying that is more useful than a grant
    that silently does nothing.
  */
  if not found then
    perform app.append_event(
      p_office,
      extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.wanted',
      true, null, null,
      jsonb_build_object('tool', req.tool, 'request_id', req.request_id),
      'Approved, but no such tool exists yet — this is a decision to build it.',
      '[]'::jsonb, null, null, 'app.withdraw_tool_request(request_id)', null);
    return jsonb_build_object(
      'approved', true, 'granted', false, 'needs_building', true, 'tool', req.tool,
      'say', format('Approved — but %s does not exist yet, so there is nothing '
                    || 'to switch on. It needs building before anyone can hold it.',
                    req.tool));
  end if;

  insert into public.staff_tools (office_id, staff_slug, tool, granted_by, note)
  values (p_office, req.asked_by, req.tool, p_by,
          format('Approved from request %s.', req.request_id))
  on conflict (office_id, staff_slug, tool) do nothing;

  perform app.append_event(
      p_office,
    extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.granted',
    true, null,
    jsonb_build_object('held', false),
    jsonb_build_object('tool', req.tool, 'to', req.asked_by,
                       'request_id', req.request_id, 'limits', p_limits),
    left(req.what_for, 1000), '[]'::jsonb, null, req.tool,
    'app.revoke_tool(staff_slug, tool)', null);

  /*
    The global switch stays the ceiling (0119).

    A grant against a policy-disabled tool is recorded and does nothing, and
    saying so is the difference between a permission screen that explains itself
    and one that lies. Flipping the global switch is a separate, deliberate act.
  */
  return jsonb_build_object(
    'approved', true, 'granted', true, 'tool', req.tool, 'to', req.asked_by,
    'in_force', known.enabled,
    'say', case when known.enabled
      then format('%s can now use %s.', req.asked_by, req.tool)
      else format('Granted to %s, but %s is switched off for everyone — %s. '
                  || 'It stays off until that changes.',
                  req.asked_by, req.tool, coalesce(known.disabled_reason, 'by policy'))
    end);
end;
$function$;
revoke all on function app.approve_tool(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
create function public.hq_approve_tool(p_office uuid, p_request_id uuid, p_limits jsonb default null, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$
  select case when app.authority_refusal(p_by) is not null
              then jsonb_build_object('error', app.authority_refusal(p_by))
              else app.approve_tool(p_office, p_request_id, btrim(p_by), p_limits) end
$f$;
revoke all on function public.hq_approve_tool(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.hq_approve_tool(uuid, uuid, jsonb, text) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.hq_approve_tool(uuid, jsonb, text);
drop function app.approve_tool(uuid, text, jsonb);

create function app.decline_tool(p_office uuid, p_request_id uuid, p_by text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  req    public.tool_requests%rowtype;
  before integer;
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  if p_by is distinct from app.office_actor(p_office) then
    return jsonb_build_object('error',
      'only the person this office belongs to answers a request for reach (ADR-0018).');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    return jsonb_build_object('error',
      'a decline needs a reason — it is what makes it worth revisiting in three months');
  end if;

  select * into req from public.tool_requests where request_id = p_request_id and office_id = p_office for update;
  if not found then
    return jsonb_build_object('error', 'no such request: ' || p_request_id::text);
  end if;
  if req.state <> 'open' then
    return jsonb_build_object('error', 'that request was already ' || req.state);
  end if;

  -- Carried forward from every previous refusal of this exact ask, so the
  -- silence lengthens rather than resetting to ninety days each time.
  select coalesce(max(declines), 0) into before
    from public.tool_requests
   where office_id = p_office and tool = req.tool and asked_by = req.asked_by and state = 'declined';

  update public.tool_requests
     set state = 'declined', settled_at = app.now_utc(),
         decided_by = p_by, decline_reason = btrim(p_reason),
         declines = before + 1
   where request_id = p_request_id and office_id = p_office;

  perform app.append_event(
    p_office,
    extensions.gen_random_uuid(), 'user', p_by, 'approval', 'tool.declined',
    true, null, null,
    jsonb_build_object('tool', req.tool, 'asked_by', req.asked_by,
                       'declines', before + 1),
    left(btrim(p_reason), 1000), '[]'::jsonb, null, req.tool,
    'app.request_tool(...) again once the silence expires', null);

  return jsonb_build_object(
    'declined', true, 'tool', req.tool, 'declines', before + 1,
    'silent_until', app.now_utc() + ((before + 1) * interval '90 days'));
end;
$function$;
revoke all on function app.decline_tool(uuid, uuid, text, text) from public, anon, authenticated, service_role;
create function public.hq_decline_tool(p_office uuid, p_request_id uuid, p_reason text default null, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$
  select case when app.authority_refusal(p_by) is not null
              then jsonb_build_object('error', app.authority_refusal(p_by))
              else app.decline_tool(p_office, p_request_id, btrim(p_by), p_reason) end
$f$;
revoke all on function public.hq_decline_tool(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_decline_tool(uuid, uuid, text, text) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.hq_decline_tool(uuid, text, text);
drop function app.decline_tool(uuid, text, text);

create function app.revoke_tool(p_office uuid, p_slug text, p_tool text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_out jsonb;
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  v_out := app.hq_staff_tool_set(p_office, p_slug, p_tool, false, p_by);
  if v_out ? 'error' then
    return v_out;
  end if;
  if not coalesce((v_out->>'changed')::boolean, false) then
    return jsonb_build_object('error', format('%s does not hold %s', p_slug, p_tool));
  end if;
  return jsonb_build_object('revoked', p_tool, 'from', p_slug);
end;
$function$;
revoke all on function app.revoke_tool(uuid, text, text, text) from public, anon, authenticated, service_role;
create function public.hq_revoke_tool(p_office uuid, p_slug text, p_tool text, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$
  select case when app.authority_refusal(p_by) is not null
                and not (app.principal_kind(p_by) = 'harness' and app.harness_label(p_slug))
              then jsonb_build_object('error', app.authority_refusal(p_by))
              else app.revoke_tool(p_office, p_slug, p_tool, btrim(p_by)) end
$f$;
revoke all on function public.hq_revoke_tool(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.hq_revoke_tool(uuid, text, text, text) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.hq_revoke_tool(text, text, text);
drop function app.revoke_tool(text, text, text);

-- A to-do that stands for a question answers it, in the question's own office - the office of the row that was ticked.
-- (A to-do and the question it satisfies are one office by the composite keys; this says so again where it acts.)
CREATE OR REPLACE FUNCTION app.task_answers_blocker()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  b public.blockers%rowtype;
  r jsonb;
begin
  if new.satisfies_blocker is null then return new; end if;
  if new.state <> 'done' or coalesce(old.state, '') = 'done' then return new; end if;

  select * into b from public.blockers where blocker_id = new.satisfies_blocker and office_id = new.office_id;
  if b.blocker_id is null then return new; end if;
  -- Idempotent: two people agreeing is not an error.
  if b.state <> 'open' then return new; end if;

  r := app.hq_answer_blocker(
    new.office_id, b.blocker_id,
    coalesce(new.satisfies_answer, b.approval_options[1]),
    new.completed_by);

  if r ? 'error' then
    update public.tasks
       set state = coalesce(nullif(old.state, ''), 'todo'), done_at = null, completed_by = null,
           blocked_on = coalesce(old.blocked_on, '')
     where task_id = new.task_id;
    -- Only when somebody was named and refused. An external board pulling 'done' names
    -- nobody and is reconciled on every sync; recording each one would add an
    -- append-only row every fifteen minutes for ever.
    if b.job_id is not null and new.completed_by is not null then
      perform app.cannot(b.job_id, 'not_capable', 'answer a question from a completed to-do',
                         'task_answers_blocker', left(r ->> 'error', 400), null);
    end if;
  end if;
  return new;
end;
$function$;

create function app.hq_staff(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
select jsonb_build_object(
    'avatar_base', (
      select value #>> '{}' from public.system_config where key = 'staff.avatar_base_url'
    ),
    'staff', coalesce((
      select jsonb_agg(row_to_json(s) order by s.permanent desc, s.name) from (
        select staff_id, slug, name, title, responsibilities, expertise,
               communication_style, permanent, active, avatar_ref, prompt_version,
               (select count(*)::int from public.routing_decisions r
                  join public.jobs rj on rj.job_id = r.job_id and rj.office_id = p_office
                 where st.slug = any (r.roster)) as jobs_convened_for
        from public.staff st
        where active
      ) s
    ), '[]'::jsonb)
  )
  );
end;
$function$;
revoke all on function app.hq_staff(uuid) from public, anon, authenticated, service_role;
create function public.hq_staff(p_office uuid)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_staff(p_office) $f$;
revoke all on function public.hq_staff(uuid) from public, anon, authenticated;
grant execute on function public.hq_staff(uuid) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.hq_staff();
drop function app.hq_staff();

create function app.hq_team(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select jsonb_build_object(
    'bots', (app.hq_bots() -> 'bots'),
    'avatar_base', (
      select value #>> '{}' from public.system_config where key = 'staff.avatar_base_url'
    ),
    'staff', coalesce((
      select jsonb_agg(t order by t.sort, t.name)
        from (
          select s.slug, s.name, s.title, s.pronouns, s.responsibilities,
                 -- #70, 0352: from the registry rather than from the copy of it
                 -- on this row. `enabled` is the point — a person whose bot has
                 -- been retired has no bot, and saying otherwise is the
                 -- disagreement this Issue was opened about.
                 (select b.username from public.telegram_bots b
                   where b.staff_slug = s.slug and b.enabled
                   limit 1) as telegram_username,
                 s.avatar_ref, s.active, s.permanent,
                 s.prompt_version,
                 coalesce(s.expertise, array[]::text[]) as skills,
                 s.communication_style,
                 app.hq_staff_tools(p_office, s.slug) as tools,
                 -- How they work, as opposed to what they know about.
                 app.hq_staff_procedures(p_office, s.slug) as procedures,
                 case s.slug when 'chief-of-staff' then 0 else 1 end as sort,
                 (select count(*)::int
                    from public.routing_decisions r
                    join public.jobs rj on rj.job_id = r.job_id and rj.office_id = p_office
                   where r.roster[1] = s.slug) as convened_for
            from public.staff s
           where s.slug not like 'fixture-%'
        ) t
    ), '[]'::jsonb)
  )
  );
end;
$function$;
revoke all on function app.hq_team(uuid) from public, anon, authenticated, service_role;
create function public.hq_team(p_office uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_team(p_office) $f$;
revoke all on function public.hq_team(uuid) from public, anon, authenticated;
grant execute on function public.hq_team(uuid) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.hq_team();
drop function app.hq_team();

create function app.hq_retire_skill(p_office uuid, p_skill_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select app.retire_skill(
    p_office, p_skill_id, app.office_actor(p_office),
    -- A default that is honest rather than a default that is empty. He clicked
    -- the button; "Grant retired this from the dashboard" is exactly what
    -- happened and it beats an eight-character placeholder.
    coalesce(nullif(btrim(p_reason), ''), 'Retired from the dashboard')
  )
  );
end;
$function$;
revoke all on function app.hq_retire_skill(uuid, uuid, text) from public, anon, authenticated, service_role;
create function public.hq_retire_skill(p_office uuid, p_skill_id uuid, p_reason text DEFAULT NULL::text)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_retire_skill(p_office, p_skill_id, p_reason) $f$;
revoke all on function public.hq_retire_skill(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.hq_retire_skill(uuid, uuid, text) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.hq_retire_skill(uuid, text);
drop function app.hq_retire_skill(uuid, text);

create function app.retract_lesson(p_office uuid, p_lesson_id uuid, p_why text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  l    public.lessons%rowtype;
  v_id uuid;
begin
  perform app.require_office(p_office);
  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  select * into l from public.lessons where lesson_id = p_lesson_id and office_id = p_office;
  if not found then
    return jsonb_build_object('error', 'there is no such lesson');
  end if;
  if l.row_kind <> 'lesson' then
    return jsonb_build_object('error', 'that is a retraction, not a lesson');
  end if;
  if exists (select 1 from public.lessons where supersedes = p_lesson_id and office_id = p_office) then
    -- Not an error. Two open tabs produce this, and the honest answer is that
    -- it is already gone rather than a failure.
    return jsonb_build_object('ok', false, 'already', true);
  end if;

  insert into public.lessons
    (office_id, row_kind, scope, project_id, staff_slug, job_kind, body, learned_by,
     confidence, supersedes)
  values (p_office, 'retraction', l.scope, l.project_id, l.staff_slug, l.job_kind,
          coalesce(nullif(btrim(coalesce(p_why, '')), ''),
                   format('Retracted by %s.', p_by)),
          p_by, l.confidence, p_lesson_id)
  returning lesson_id into v_id;

  return jsonb_build_object('ok', true, 'retraction', v_id, 'retracted', p_lesson_id);
end;
$function$;
revoke all on function app.retract_lesson(uuid, uuid, text, text) from public, anon, authenticated, service_role;
create function public.retract_lesson(p_office uuid, p_lesson_id uuid, p_why text default null, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.retract_lesson(p_office, p_lesson_id, p_why, p_by) $f$;
revoke all on function public.retract_lesson(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.retract_lesson(uuid, uuid, text, text) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.retract_lesson(uuid, text, text);
drop function app.retract_lesson(uuid, text, text);

create function app.request_stop(p_office uuid, p_job uuid, p_who text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_state text;
  v_who text;
  v_n integer;
  v_kids uuid[];
  v_refusal text;
begin
  perform app.require_office(p_office);
  select state::text into v_state from public.jobs where job_id = p_job and office_id = p_office;
  if v_state is null then
    return jsonb_build_object('error', 'there is no job by that id');
  end if;
  if v_state in ('complete', 'failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'note',
      'that job already finished, so there is nothing to stop');
  end if;
  v_who := coalesce(nullif(trim(coalesce(p_who, '')), ''), 'the office');
  if nullif(trim(coalesce(p_who, '')), '') is not null then
    v_refusal := app.authority_refusal(trim(p_who), p_job, (select project_id from public.jobs where job_id = p_job and office_id = p_office));
    if v_refusal is not null then
      return jsonb_build_object('error', v_refusal);
    end if;
  end if;
  if v_state in ('paused', 'queued', 'retrying') and app.job_is_stoppable(v_state::public.job_state) then
    update public.jobs
       set state = 'cancelled',
           finished_at = app.now_utc(),
           state_reason = left('stopped by ' || v_who || ' while it was ' || v_state, 500),
           stop_requested_at = coalesce(stop_requested_at, app.now_utc()),
           stop_requested_by = coalesce(stop_requested_by, v_who),
           leased_by = null,
           leased_until = null
     where job_id = p_job and office_id = p_office and state::text = v_state;
    get diagnostics v_n = row_count;
    if v_n = 1 then
      -- The questions this job had open are withdrawn with it, and the idle work beneath it is stopped.
      update public.blockers
         set state = 'resolved', resolved_at = app.now_utc(),
             resolution = 'withdrawn: the job it asked about was stopped by ' || v_who
       where job_id = p_job and office_id = p_office and state = 'open';
      with recursive below as (
        select job_id from public.jobs where parent_job_id = p_job and office_id = p_office
        union all
        select j.job_id from public.jobs j join below b on j.parent_job_id = b.job_id where j.office_id = p_office
      ), gone as (
        update public.jobs k
           set state = 'cancelled', finished_at = app.now_utc(),
               state_reason = left('stopped with the job it belongs to (by ' || v_who || ')', 500),
               leased_by = null, leased_until = null
         where k.office_id = p_office and k.job_id in (select job_id from below)
           and k.state in ('paused', 'queued', 'retrying')
        returning k.job_id
      )
      select coalesce(array_agg(job_id), '{}'::uuid[]) into v_kids from gone;
      update public.blockers
         set state = 'resolved', resolved_at = app.now_utc(),
             resolution = 'withdrawn: the job it asked about was stopped by ' || v_who
       where office_id = p_office and state = 'open' and job_id = any (v_kids);
      return jsonb_build_object('ok', true, 'state', 'cancelled', 'was', v_state);
    end if;
  end if;
  update public.jobs
     set stop_requested_at = coalesce(stop_requested_at, app.now_utc()),
         stop_requested_by = coalesce(stop_requested_by, v_who),
         updated_at = app.now_utc()
   where job_id = p_job and office_id = p_office;
  return jsonb_build_object('ok', true, 'state', v_state);
end;
$function$;
revoke all on function app.request_stop(uuid, uuid, text) from public, anon, authenticated, service_role;
create function public.request_stop(p_office uuid, p_job uuid, p_who text default null)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$ select app.request_stop(p_office, p_job, p_who) $f$;
revoke all on function public.request_stop(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.request_stop(uuid, uuid, text) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.request_stop(uuid, text);
drop function app.request_stop(uuid, text);

create function app.job_progress(p_office uuid, p_job uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select jsonb_build_object(
    'job', p_job,
    'state', (select state::text from public.jobs where job_id = p_job and office_id = p_office),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'step', s.step,
               'ordinal', s.ordinal,
               'done', s.finished_at is not null,
               'began_at', s.began_at,
               'finished_at', s.finished_at,
               /*
                 Named for what it MEANS to a resume, not for what happened.

                 The first version called this `acted_outside`, and the first
                 real job showed a `store` step carrying
                 `document:bcf9fa85-…` next to `acted_outside: false` — which
                 reads as a contradiction and is not one. The question a
                 person needs answered is not "did anything happen" (the
                 effect column says that) but "if this had been interrupted,
                 could it have been retried": `local` can, `external` cannot.
               */
               'unrepeatable', s.effect_kind = 'external',
               'effect', s.effect_ref)
             order by s.ordinal, s.began_at)
        from public.job_steps s
        where s.job_id = p_job
          and exists (select 1 from public.jobs j where j.job_id = p_job and j.office_id = p_office)), '[]'::jsonb),
    'paused', (
      select jsonb_build_object(
               'reason', p.reason, 'detail', p.detail, 'resume_when', p.resume_when,
               'resumable', p.resumable, 'since', p.at, 'expires_at', p.expires_at)
        from public.job_pauses p
       where p.job_id = p_job and p.resumed_at is null
         and exists (select 1 from public.jobs j where j.job_id = p_job and j.office_id = p_office)
       order by p.at desc limit 1)
  )
  );
end;
$function$;
revoke all on function app.job_progress(uuid, uuid) from public, anon, authenticated, service_role;
create function public.job_progress(p_office uuid, p_job uuid)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$ select app.job_progress(p_office, p_job) $f$;
revoke all on function public.job_progress(uuid, uuid) from public, anon, authenticated;
grant execute on function public.job_progress(uuid, uuid) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.job_progress(uuid);
drop function app.job_progress(uuid);

create function app.hq_governance(p_office uuid, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select jsonb_build_object(
    'at', app.now_utc(),

    -- 0612: the Nos the office is remembering, each with the press that takes it back.
    'refusals', app.active_refusals(p_office),

    /*
      What it learned. Scoped, traceable to the job that learned it, and
      retractable — #54's first box, all four parts, because a lesson you
      cannot place is one you cannot judge.
    */
    'lessons', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', l.lesson_id,
               'body', l.body,
               'scope', l.scope::text,
               'where', coalesce(p.name, l.staff_slug, l.job_kind, 'everywhere'),
               'who', l.learned_by,
               'job', l.from_job,
               'seen', l.observations,
               'at', l.created_at
             ) order by l.created_at desc), '[]'::jsonb)
        from (select * from public.lessons x
               where x.office_id = p_office and x.row_kind = 'lesson'
                 and not exists (select 1 from public.lessons s where s.supersedes = x.lesson_id and s.office_id = p_office)
                 and not x.is_fixture
               order by x.created_at desc
               limit greatest(coalesce(p_limit, 40), 1)) l
        left join public.projects p on p.project_id = l.project_id and p.office_id = p_office
    ),

    /*
      What it wants (#49). Open first, then recently settled — a decline that
      vanishes from the page is a decline Grant cannot remember making, and
      the whole value of the row is that it is durable.
    */
    'proposals', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.proposal_id,
               'who', r.staff_slug,
               'title', r.title,
               'remedy', r.remedy,
               'argument', r.argument,
               'cost', nullif(r.cost_note, ''),
               'state', r.state,
               'times', r.times_seen,
               'decided', r.decided_at,
               'note', r.decided_note
             ) order by (r.state = 'open') desc, r.times_seen desc, r.last_seen desc),
             '[]'::jsonb)
        from (
          select * from public.proposals
           where office_id = p_office and not app.harness_proposal(staff_slug, needed) and (state = 'open'
              or decided_at > app.now_utc() - interval '30 days')
           order by (state = 'open') desc, times_seen desc
           limit greatest(coalesce(p_limit, 40), 1)
        ) r
    ),

    /*
      What it noticed (#52), and what became of it. `dismissals` matters as
      much as the suggestion: a thing offered four times and dismissed four
      times is the office failing to take a hint.
    */
    'noticed', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.suggestion_id,
               'kind', s.kind,
               'body', s.body,
               'because', s.because,
               'weight', s.weight,
               'state', s.state,
               'dismissed', s.dismissals,
               'offer', s.offer_kind,
               'project', p.name,
               'at', s.raised_at
             ) order by (s.state = 'open') desc, s.weight desc, s.raised_at desc),
             '[]'::jsonb)
        from (select * from public.suggestions g
               where g.office_id = p_office and not app.harness_suggestion(g.offer_args)
               order by (g.state = 'open') desc, g.weight desc, g.raised_at desc
               limit greatest(coalesce(p_limit, 40), 1)) s
        left join public.projects p on p.project_id = s.project_id and p.office_id = p_office
    ),

    /*
      What each agent can actually do — and, #54's own judgement, the most
      useful list on the page: what it has TRIED and could not do.

      Not the whole capability index per agent: that is eight copies of a
      mostly identical structure and would be the largest payload the studio
      fetches. The remit, the count of tools held, and the walls hit.
    */
    /*
      What it is ASKING FOR (#272, and ADR-0018's missing half).

      `tool_requests` has held rows since ADR-0018 and `public.hq_approve_tool`
      and `public.hq_decline_tool` have existed beside it the whole time. Both
      were in `check:callers`' baseline, which is to say the office could ask
      Grant for a capability and Grant had nowhere to answer -- the approvals
      on record were all made by a script. CLAUDE.md's standing complaint, word
      for word: a capability that exists only as a script an agent runs is a
      capability Grant does not have.

      Open first, then whatever settled in the last thirty days, because a
      decline has to be durable to be worth anything (#49) and one that
      vanishes is one he cannot remember making. `because` is JSONB holding
      counts, not a sentence -- the page renders it as chips, never as text.
    */
    'requests', (
      select coalesce(jsonb_agg(q.v order by q.ord, q.at desc), '[]'::jsonb)
        from (
          select case r.state when 'open' then 0 else 1 end as ord,
                 r.raised_at as at,
                 jsonb_build_object(
                   'id', r.request_id,
                   'tool', r.tool,
                   'who', r.asked_by,
                   'who_name', coalesce(s.name, r.asked_by),
                   'what_for', r.what_for,
                   'because', coalesce(r.because, '{}'::jsonb),
                   'state', r.state,
                   'declines', coalesce(r.declines, 0),
                   'at', r.raised_at,
                   'settled', r.settled_at,
                   'reason', nullif(r.decline_reason, '')) as v
            from public.tool_requests r
            left join public.staff s on s.slug = r.asked_by
           where r.office_id = p_office
             and (r.state = 'open'
                  or r.settled_at > app.now_utc() - interval '30 days')
           order by 1, 2 desc
           limit p_limit
        ) q
    ),

    /*
      Work whose only exit is a person noticing (#272, #211).

      Folded into this payload rather than given its own section: it is the
      same screen and the same question — what is the office unable to finish
      — so a second request would be a second round trip for one number.
    */
    'stranded', app.hq_stranded_work(p_office),

    /*
      How the office is scoring against Grant's own judgement (#272).

      `eval_latest` has existed since the evaluator did and nothing has ever
      shown it, so the one number that says whether the office is getting
      better or worse lived where only a script could see it.
    */
    'scoring', app.eval_latest(),

    'agents', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'slug', s.slug,
               'name', s.name,
               'remit', s.title,
               'expertise', coalesce(s.expertise, array[]::text[]),
               'tools', (select count(*)::int from public.staff_tools t
                          where t.office_id = p_office and t.staff_slug = s.slug),
               /*
                 The tool NAMES, from the same join the count above uses.

                 Not from app.what_i_can_do, which computed the same thing a
                 second time and which 0452 drops: capabilityBrief in
                 TypeScript is the live answer to "what can this agent do"
                 because it builds every prompt, and a page reading an
                 independent second implementation is two lists that will
                 disagree. One source, two readers.
               */
               'can', (select coalesce(jsonb_agg(t.tool order by t.tool), '[]'::jsonb)
                         from public.staff_tools t where t.office_id = p_office and t.staff_slug = s.slug),
               'tried_and_could_not', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'kind', i.kind, 'needed', i.needed, 'times', i.times)
                        order by i.times desc), '[]'::jsonb)
                   from app.impediments_tally(p_office, 90, 1, false) i
                  where i.staff_slug = s.slug
               )
             ) order by case s.slug when 'chief-of-staff' then 0 else 1 end, s.name),
             '[]'::jsonb)
        from public.staff s where s.active and s.slug not like 'fixture-%'
    )
  )
  );
end;
$function$;
revoke all on function app.hq_governance(uuid, integer) from public, anon, authenticated, service_role;
create function public.hq_governance(p_office uuid, p_limit integer DEFAULT 40)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_governance(p_office, p_limit) $f$;
revoke all on function public.hq_governance(uuid, integer) from public, anon, authenticated;
grant execute on function public.hq_governance(uuid, integer) to service_role;
-- the legacy forms: no caller names them any more (the gateway passes the office; see the call-site changes).
drop function public.hq_governance(integer);
drop function app.hq_governance(integer);

