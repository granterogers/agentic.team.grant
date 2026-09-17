-- Answering "from now on" writes the row that makes it true (#15).
--
-- 0421 built the policy and the standing authorizations. This is the loop that
-- lets Grant create one WITHOUT going to a settings page: he answers the
-- question he was already being asked, picks the option that says "stop asking
-- me", and the office stops asking.
--
-- Two columns rather than a parser. `blockers.standing_tool` names the
-- capability a standing authorization would cover and `standing_option` names
-- which of the free-text options grants it. Deciding a permission by matching
-- words in `approval_options` would be #130's parsing defect applied to a
-- security boundary, and the options are composed by handlers in whatever
-- English reads best.
--
-- A foreign key on `standing_tool`, so a handler cannot offer a standing
-- authorization for a capability that does not exist -- 0298's rule that a
-- claim needs something behind it, enforced rather than commented.

alter table public.blockers
  add column standing_tool text references public.tool_permissions(tool),
  add column standing_option text;

comment on column public.blockers.standing_tool is
  'The capability answering standing_option would authorize from now on (#15). '
  'Null on a question that grants nothing, which is most of them.';

-- Both or neither. A tool with no option is a permission nobody can grant; an
-- option with no tool is a button that does nothing, which this repository has
-- a whole audit for.
alter table public.blockers
  add constraint blockers_standing_needs_both
  check ((standing_tool is null) = (standing_option is null));

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
