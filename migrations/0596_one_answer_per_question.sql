/*
  0596 - two answers to one question perform it once.

  Behavioural remediation, 24 September 2026, ledger R17. Spliced from the
  LIVE definitions; only the row lock is new in each.

  app.decide_suggestion has the same shape - read, check 'open', act,
  update - and a double press on Accept there would call app.learn twice
  into public.lessons, which refuses UPDATE and DELETE, so the duplicate
  standing rule would be permanent. app.hq_undo is NOT changed: claim_undo
  already serialises on a unique insert.
*/

CREATE OR REPLACE FUNCTION app.hq_answer_blocker(p_blocker_id uuid, p_answer text)
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
begin
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
      'grant'
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
      format('You answered "%s" on %s.', v_answer, b.created_at::date), 'grant', null);
  end if;

  /*
    And the office remembers it decided this (#129).

    The options Grant did NOT pick are `ruled_out`, which is the field the
    Issue is about and the one that would otherwise be skipped: *"we chose
    Notion" is worth a fraction of "we chose Notion over Drive because..."*.
    They are right here, in `approval_options`, and no model is needed to know
    what they were.

    `decided_by` is 'grant', which is what lets the reader treat this as a
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
      'grant', b.project_id, b.job_id, null);
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
         resolution = format('%s — answered by grant', v_answer)
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

CREATE OR REPLACE FUNCTION app.decide_suggestion(p_suggestion_id uuid, p_accept boolean, p_by text DEFAULT 'grant'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  s      public.suggestions;
  v_did  jsonb;
begin
  -- 0596: locked, for the reason hq_answer_blocker is. A double press on
  -- Accept would otherwise call app.learn twice, and lessons are append-only.
  select * into s from public.suggestions where suggestion_id = p_suggestion_id for update;
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
     where suggestion_id = p_suggestion_id;
    return jsonb_build_object('accepted', false, 'state', 'dismissed');
  end if;

  if s.offer_kind = 'learn' then
    -- The only path by which a correction becomes a rule, and it is reachable
    -- only from a press. `app.learn` answers in JSONB, not with an id.
    v_did := app.learn(
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

  update public.suggestions
     set state = 'acted', settled_at = app.now_utc()
   where suggestion_id = p_suggestion_id;

  return jsonb_build_object('accepted', true, 'state', 'acted',
                            'lesson_id', v_did -> 'lesson_id',
                            'did', coalesce(s.offer_kind, 'nothing but noting it'));
end;
$function$;
