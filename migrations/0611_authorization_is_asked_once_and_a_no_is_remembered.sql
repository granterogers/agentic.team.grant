/*
  0611 - an effect is authorised once, and a No is remembered

  Architecture Run 2. What the map found (docs/architecture-run-2/AUTHORITY-MAP.md):

    * app.staff_may_use has no runtime caller: a specialist's grant blocks nothing.
    * A "No, leave it" to a duty's question is forgotten: the next run asks again.
    * A plan step's approval is found by a +-10 second window and read from the
      resolution SENTENCE.
    * Ticking the to-do that stands for a question answered it as nobody, with the
      first option, and never ran what answering promises.

  Consolidation, not a second engine. app.may_act (the matrix, the dial, standing
  rows, "a person asked") is unchanged and stays an input. app.authorize_effect
  CALLS it and layers what it cannot know: the acting specialist's grant, an
  outside audience, the exact approval on file, and a refusal already given.
  Containment (may_act_outside / claim_delivery) stays an independent witness.

  Everything below is additive columns plus functions spliced from their live
  definitions. Nothing is stored that can be read: whether an action was
  approved or declined is derived from the blocker that asked it.
*/

alter table public.blockers
  add column if not exists action_fingerprint text,
  add column if not exists decline_option     text,
  add column if not exists answered_option    text,
  add column if not exists answered_by        text;

comment on column public.blockers.action_fingerprint is
  'sha256 of the exact action this question asks about (the same fingerprint job_pauses.binds_to stores). '
  'An answer approves or declines THIS action and nothing that merely resembles it.';
comment on column public.blockers.decline_option is
  'Which of approval_options is the No, named by the writer as standing_option names the standing Yes. '
  'Nothing reads English to find out.';
comment on column public.blockers.answered_option is
  'The option that answered it, written by app.hq_answer_blocker. resolution stays for people; nothing parses it.';
comment on column public.blockers.answered_by is
  'The verified principal that answered (0608), written by app.hq_answer_blocker.';

create index if not exists blockers_by_action on public.blockers (action_fingerprint)
  where action_fingerprint is not null;
create index if not exists blockers_by_standing_tool on public.blockers (standing_tool, project_id)
  where standing_tool is not null;

alter table public.tasks add column if not exists completed_by text;
comment on column public.tasks.completed_by is
  'Who completed it, when the door knew. A to-do that stands for a question is only an answer from somebody the office can name.';

insert into public.system_config (key, value, description, self_adjustable, updated_by)
values ('approval.refusal_days', '30'::jsonb,
        'How many days a No to a question about an action stays a No before the office may ask about it again.',
        false, 'migration 0611')
on conflict (key) do nothing;

-- What answered this exact action, for this job.
create or replace function app.action_answer(p_job uuid, p_fingerprint text)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
           when b.answered_option is null then null
           when b.answered_option = coalesce(b.decline_option, b.approval_options[2]) then 'no'
           when b.answered_option = b.approval_options[1] then 'yes'
           else 'unclear'
         end
    from public.blockers b
   where b.job_id = p_job
     and b.action_fingerprint = p_fingerprint
     and b.state = 'resolved'
   order by b.resolved_at desc
   limit 1
$$;

revoke all on function app.action_answer(uuid, text) from public;
grant execute on function app.action_answer(uuid, text) to ai_team_app, service_role;

/*
  THE DECISION BOUNDARY.

  proceed | ask | refuse, with a sentence a person can read. app.may_act is asked
  first and everything it refuses stays refused. Then:

    (p_asked_job is the job whose PURPOSE this tool is, for the "a person asked"
    rule; p_job is the job running, whose own answers count. They are different
    on purpose: a plan step must not treat the goal as consent for its steps.)

    1. A named specialist must hold the tool (app.staff_may_use). No specialist
       named means the office acting as itself, unchanged.
    2. An outside audience can never proceed on its own: not by the dial, a
       standing row or "you asked for this".
    3. An ask is settled by what he already said about EXACTLY this action:
       yes proceeds, no refuses.
    4. And by what he said before about it or its standing offer: a No stands
       for approval.refusal_days unless a later answer took it back.
*/
create or replace function app.authorize_effect(
  p_project     uuid,
  p_tool        text,
  p_asked_job   uuid default null,
  p_staff       text default null,
  p_audience    text default null,
  p_fingerprint text default null,
  p_job         uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v         jsonb;
  v_verdict text;
  v_days    integer;
  v_answer  text;
  v_last    record;
begin
  v := app.may_act(p_project, p_tool, p_asked_job);
  v_verdict := v ->> 'verdict';
  if v_verdict = 'refuse' then
    return v;
  end if;

  if p_staff is not null and btrim(p_staff) <> '' and not app.staff_may_use(p_staff, p_tool) then
    return v || jsonb_build_object(
      'verdict', 'refuse', 'standing', null, 'reason', 'specialist_not_granted',
      'because', format('%s has not been given %s, so this is not theirs to do.', p_staff, p_tool));
  end if;

  if p_audience = 'outside' and v_verdict = 'proceed' then
    v_verdict := 'ask';
    v := v || jsonb_build_object(
      'verdict', 'ask', 'standing', null, 'reason', 'outside_audience',
      'because', 'This reaches somebody outside the office, so it always waits for your say-so.');
  end if;

  if v_verdict <> 'ask' then
    return v;
  end if;

  if p_job is not null and p_fingerprint is not null then
    v_answer := app.action_answer(p_job, p_fingerprint);
    if v_answer = 'yes' then
      return v || jsonb_build_object(
        'verdict', 'proceed', 'approved', true, 'reason', 'approved',
        'because', 'You said yes to exactly this.');
    elsif v_answer in ('no', 'unclear') then
      return v || jsonb_build_object(
        'verdict', 'refuse', 'declined', true, 'reason', 'declined',
        'because', 'You said no to this.');
    end if;
  end if;

  v_days := coalesce((select (value #>> '{}')::integer from public.system_config
                       where key = 'approval.refusal_days'), 30);
  select b.resolved_at,
         (b.answered_option = b.decline_option) as declined
    into v_last
    from public.blockers b
   where b.state = 'resolved'
     and b.answered_option is not null
     and (   (p_fingerprint is not null and b.action_fingerprint = p_fingerprint)
          or (p_fingerprint is null and b.action_fingerprint is null
              and b.standing_tool = p_tool and b.project_id is not distinct from p_project))
   order by b.resolved_at desc
   limit 1;
  if found and v_last.declined
     and v_last.resolved_at > app.now_utc() - make_interval(days => v_days) then
    return v || jsonb_build_object(
      'verdict', 'refuse', 'declined', true, 'remembered', true, 'reason', 'declined_before',
      'declined_at', v_last.resolved_at,
      'because', format('You said no to this on %s, so it stays no until %s unless you say otherwise.',
                        to_char(v_last.resolved_at, 'FMDD Mon'),
                        to_char(v_last.resolved_at + make_interval(days => v_days), 'FMDD Mon')));
  end if;

  return v;
end;
$$;

revoke all on function app.authorize_effect(uuid, text, uuid, text, text, text, uuid) from public;
grant execute on function app.authorize_effect(uuid, text, uuid, text, text, text, uuid) to ai_team_app, service_role;

-- The old shapes of hq_task_state, by exact signature (the new one carries p_by).
drop function if exists public.hq_task_state(text, text, text);
drop function if exists app.hq_task_state(text, text, text);

-- ---- app.hq_answer_blocker, spliced from the live definition ----
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
$function$;

-- ---- app.hq_task_state, spliced from the live definition ----
CREATE OR REPLACE FUNCTION app.hq_task_state(p_task_id text, p_state text, p_reason text DEFAULT NULL::text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_id       uuid;
  v          jsonb;
  v_was      text;
  v_was_why  text;
  v_title    text;
  v_undo     uuid;
begin
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('error', 'that is not a task id');
  end;

  if p_state not in ('todo', 'doing', 'blocked', 'done', 'cancelled') then
    return jsonb_build_object('error', format(
      '%L is not a state — it is one of todo, doing, blocked, done, cancelled', p_state));
  end if;

  -- blocked_needs_a_reason. Said here, with the reason why, rather than
  -- arriving as a constraint name.
  if p_state = 'blocked' and coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('error',
      'say what it is blocked on — a blocked task with no reason cannot be unblocked by anyone but the person who blocked it');
  end if;

  select state, blocked_on, title into v_was, v_was_why, v_title
    from public.tasks where task_id = v_id;
  if v_was is null then
    return jsonb_build_object('error', 'no such task');
  end if;

  /*
    done_at moves with the state, in both directions.

    `(state = 'done') = (done_at is not null)` is a check constraint, so
    marking done without a timestamp fails AND so does re-opening a done task
    without clearing one. Handling only the first is the bug that looks fixed.
  */
  update public.tasks
     set state      = p_state,
         done_at    = case when p_state = 'done' then coalesce(done_at, app.now_utc()) else null end,
         blocked_on = case when p_state = 'blocked' then btrim(p_reason) else '' end,
         -- 0611: who completed it, when the door knows. A to-do that IS a
         -- question's answer is only an answer from somebody the office can name.
         completed_by = case when p_state = 'done' then nullif(btrim(coalesce(p_by, '')), '') else null end
   where task_id = v_id
  returning jsonb_build_object('id', task_id, 'title', title, 'state', state) into v;

  if p_state is distinct from v_was then
    v_undo := app.undo_offer(
      'task.state',
      format('%s marked %s', left(v_title, 60), p_state),
      jsonb_build_object('action', 'task_state',
                         'args', jsonb_build_object(
                           'p_task_id', p_task_id, 'p_state', v_was,
                           'p_reason', nullif(v_was_why, ''))));
  end if;

  return coalesce(v, jsonb_build_object('error', 'no such task')) || jsonb_build_object('undo', v_undo);
end;
$function$;

create or replace function public.hq_task_state(
  p_task_id text, p_state text, p_reason text default null, p_by text default null)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $$ select app.hq_task_state(p_task_id, p_state, p_reason, p_by) $$;

revoke all on function public.hq_task_state(text, text, text, text) from public;
grant execute on function public.hq_task_state(text, text, text, text) to service_role;

/*
  Ticking the to-do that stands for a question is answering it, through the ONE
  door. It used to resolve the blocker itself: as nobody, with the first option,
  and without running what answering promises (a standing grant, on_answer,
  approval_next). A tick from somebody the office cannot name - an external board
  pulling a done state - reopens the task and leaves the question open.
*/
create or replace function app.task_answers_blocker()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  b public.blockers%rowtype;
  r jsonb;
begin
  if new.satisfies_blocker is null then return new; end if;
  if new.state <> 'done' or coalesce(old.state, '') = 'done' then return new; end if;

  select * into b from public.blockers where blocker_id = new.satisfies_blocker;
  if b.blocker_id is null then return new; end if;
  -- Idempotent: two people agreeing is not an error.
  if b.state <> 'open' then return new; end if;

  r := app.hq_answer_blocker(
    b.blocker_id,
    coalesce(new.satisfies_answer, b.approval_options[1]),
    new.completed_by);

  if r ? 'error' then
    update public.tasks
       set state = coalesce(nullif(old.state, ''), 'todo'), done_at = null, completed_by = null
     where task_id = new.task_id;
    if b.job_id is not null then
      perform app.cannot(b.job_id, 'not_capable', 'answer a question from a completed to-do',
                         'task_answers_blocker', left(r ->> 'error', 400), null);
    end if;
  end if;
  return new;
end;
$$;
