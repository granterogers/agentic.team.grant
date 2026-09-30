-- ROLLBACK SNAPSHOT before 0611/0612 (production at 0610 + Run 1)

-- app.answer_generation_approval(p_blocker uuid, p_approved boolean, p_by text)
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
$function$
;

-- app.hq_answer_blocker(p_blocker_id uuid, p_answer text, p_by text)
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
$function$
;

-- app.hq_governance(p_limit integer)
CREATE OR REPLACE FUNCTION app.hq_governance(p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'at', app.now_utc(),

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
        from (select * from public.lessons_live where not is_fixture order by created_at desc
               limit greatest(coalesce(p_limit, 40), 1)) l
        left join public.projects p on p.project_id = l.project_id
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
           where not app.harness_proposal(staff_slug, needed) and (state = 'open'
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
               where not app.harness_suggestion(g.offer_args)
               order by (g.state = 'open') desc, g.weight desc, g.raised_at desc
               limit greatest(coalesce(p_limit, 40), 1)) s
        left join public.projects p on p.project_id = s.project_id
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
           where r.state = 'open'
              or r.settled_at > app.now_utc() - interval '30 days'
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
    'stranded', app.hq_stranded_work(),

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
                          where t.staff_slug = s.slug),
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
                         from public.staff_tools t where t.staff_slug = s.slug),
               'tried_and_could_not', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'kind', i.kind, 'needed', i.needed, 'times', i.times)
                        order by i.times desc), '[]'::jsonb)
                   from app.impediments_tally(90, 1, false) i
                  where i.staff_slug = s.slug
               )
             ) order by case s.slug when 'chief-of-staff' then 0 else 1 end, s.name),
             '[]'::jsonb)
        from public.staff s where s.active and s.slug not like 'fixture-%'
    )
  )
$function$
;

-- app.hq_task_state(p_task_id text, p_state text, p_reason text)
CREATE OR REPLACE FUNCTION app.hq_task_state(p_task_id text, p_state text, p_reason text DEFAULT NULL::text)
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
         blocked_on = case when p_state = 'blocked' then btrim(p_reason) else '' end
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
$function$
;

-- app.task_answers_blocker()
CREATE OR REPLACE FUNCTION app.task_answers_blocker()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  b public.blockers%rowtype;
begin
  if new.satisfies_blocker is null then return new; end if;
  if new.state <> 'done' or coalesce(old.state, '') = 'done' then return new; end if;

  select * into b from public.blockers where blocker_id = new.satisfies_blocker;
  if b.blocker_id is null then return new; end if;
  /*
    Idempotent. He may tick a task whose blocker somebody already answered --
    from Telegram, from the Governance page, or through a standing
    authorization -- and that is not an error, it is two people agreeing.
  */
  if b.state <> 'open' then return new; end if;

  update public.blockers
     set state = 'resolved',
         resolved_at = app.now_utc(),
         resolution = coalesce(new.satisfies_answer, 'done') ||
                      ' — the linked personal task was completed'
   where blocker_id = b.blocker_id;

  perform app.let_job_go(b.job_id, 'the personal task for this was done');
  return new;
end;
$function$
;

-- public.hq_answer_blocker(p_blocker_id uuid, p_answer text, p_by text)
CREATE OR REPLACE FUNCTION public.hq_answer_blocker(p_blocker_id uuid, p_answer text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.hq_answer_blocker(p_blocker_id, p_answer, p_by) $function$
;

-- public.hq_governance(p_limit integer)
CREATE OR REPLACE FUNCTION public.hq_governance(p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.hq_governance(p_limit) $function$
;

-- public.hq_task_state(p_task_id text, p_state text, p_reason text)
CREATE OR REPLACE FUNCTION public.hq_task_state(p_task_id text, p_state text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.hq_task_state(p_task_id, p_state, p_reason) $function$
;

-- ACLs of the functions 0611 closes to anon/authenticated (restore with grant execute ... to anon, authenticated, PUBLIC as listed)
-- hq_answer_blocker(uuid,text,text) :: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,ai_team_app=X/postgres}
-- hq_approve_tool(uuid,jsonb,text) :: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- hq_decline_tool(uuid,text,text) :: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- hq_grant_standing(text,text,uuid,timestamp with time zone,text) :: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- hq_revoke_standing(uuid,text,text) :: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- add_project_reference(text,text,text,text,text,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,ai_team_app=X/postgres}
-- unlearn(uuid,text,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- discard_document(uuid,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,ai_team_app=X/postgres}
-- attach_drive_folder(uuid,text,text,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- retire_skill(uuid,text,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- hq_autonomy_set(text,uuid,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- hq_task_state(text,text,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- archive_project(text,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,ai_team_app=X/postgres}
-- decide_proposal(uuid,text,text,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,ai_team_app=X/postgres}
-- retract_lesson(uuid,text,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,ai_team_app=X/postgres}
-- approve_document(uuid,text,text[],uuid,uuid) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,ai_team_app=X/postgres}
-- set_project_staff(text,text,boolean,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,ai_team_app=X/postgres}
-- create_automation(text,text,integer,text,text,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,ai_team_app=X/postgres}
-- set_project_instruction(text,text,text,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,ai_team_app=X/postgres}
-- decide_suggestion(uuid,boolean,text) :: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- browser_session_establish(uuid,text,text,text,text) :: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- hq_staff_tool_set(text,text,boolean) :: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- sender_admitted(text,text,text) :: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}

-- 0612 rows before: [{"autonomy":"suggest","action_level":1,"verdict":"ask","note":"It proposes; you decide, even for a draft."}] [{"tool":"drive.ingest","level":1}]
-- to undo 0612: update public.autonomy_policy set verdict='ask', note='It proposes; you decide, even for a draft.' where autonomy='suggest' and action_level=1; update public.tool_permissions set level=1 where tool='drive.ingest';
