-- The office writes down what it decided, as it decides it (#129).
--
-- 0425 built the log. This is the half that fills it, and it fills it from the
-- two places where a decision is ALREADY being made in a structured way, so
-- nothing has to be inferred from prose:
--
--   * **answering a blocker.** The options Grant did not pick are sitting in
--     `blockers.approval_options`, so `ruled_out` -- the field the Issue is
--     about and the one that would otherwise be skipped -- is free and exact.
--   * **settling a proposal.** A declined proposal is the second bullet of
--     #129 verbatim: *"Grant already declined this approach"*. An agent about
--     to propose it again can now find that.
--
-- Both writes are wrapped. A memory that cannot be written must never undo the
-- verdict that was -- but a swallowed write is indistinguishable from a
-- feature that was never built, so the blocker path records the failure as an
-- impediment rather than discarding it. The proposal path cannot: it has no
-- job to hang one on.
--
-- Rebuilt by splicing the live definitions rather than transcribing them, and
-- each one terminated with the semicolon `pg_get_functiondef` does not emit.

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
begin
  select * into b from public.blockers where blocker_id = p_blocker_id;
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
  select state::text into v_was from public.jobs where job_id = b.job_id;
  if v_was in ('waiting_user', 'waiting_external') then
    update public.jobs
       set state = 'paused',
           state_reason = format('answered: %s', v_answer),
           updated_at = app.now_utc()
     where job_id = b.job_id;
    v_was := 'paused';
  end if;
  if v_was = 'paused' then
    update public.jobs
       set state = 'queued',
           state_reason = format('answered: %s', v_answer),
           updated_at = app.now_utc()
     where job_id = b.job_id;
  end if;

  return jsonb_build_object('ok', true, 'answer', v_answer, 'blocker', p_blocker_id,
    -- Null when the answer granted nothing, which is the common case.
    'standing', v_standing);
end;
$function$;

CREATE OR REPLACE FUNCTION app.decide_proposal(p_proposal_id uuid, p_state text, p_note text DEFAULT NULL::text, p_by text DEFAULT 'grant'::text)
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
  select state, title, remedy, argument
    into v_was, v_title, v_remedy, v_argument
    from public.proposals where proposal_id = p_proposal_id;
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
   where proposal_id = p_proposal_id;

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
