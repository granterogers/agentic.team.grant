/*
  0618 - a test principal cannot say something in a real project, or mint a standing authorization there

  Found by the second independent review of Run 3 (finding F2), the database half of a pair. The gateway half
  (a test member reaches only what the database itself enforces) is in hq-api.

  The chain: a test member SAYS something in a REAL project (`say_in_project` asked only whether the principal
  is known, not what it may say WHERE); the job is a test job by its own name (`teamhq:verify-operator`); the
  test-principal rule in `hq_answer_blocker` is "the job is a test job OR the project is a fixture", so it then
  answers any question that job raised - and a question that carries a standing-authorization option makes
  `app.grant_standing` write a standing yes for the REAL project, attributed to the test member, with no
  principal check of its own. A standing authorization is exactly the thing Run 2 said a person must give.

  Closed at every step, because any one alone leaves the chain half-open:
    - say_in_project and send_to_agent refuse through app.authority_refusal(p_by, null, project): a test
      principal speaks only in a fixture project. (Its job was contained by its name; that was never the same
      as being unable to reach a real project's questions.)
    - hq_answer_blocker refuses a test principal an answer that would GRANT a standing authorization unless the
      project is a fixture. Asked before the row is resolved, so a refusal changes nothing.
    - app.grant_standing itself refuses through the same function, whichever door calls it (the gateway
      wrapper already did; the answer path and any future caller did not).
  Spliced from the live definitions (post-0614/0615).
*/

CREATE OR REPLACE FUNCTION app.grant_standing(p_tool text, p_project uuid, p_reason text, p_by text, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_id uuid; v_refusal text;
begin
  -- 0618: a test principal grants a standing authorization only in a fixture project, and nobody unknown at all.
  v_refusal := app.authority_refusal(p_by, null, p_project);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal);
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('ok', false,
      'error', 'a standing authorization needs a reason — it is what makes it reviewable later');
  end if;

  -- Replace rather than collide. Saying it again with a better reason is the
  -- common case, and the unique index would otherwise refuse it.
  update public.standing_authorizations
     set revoked_at = app.now_utc(), revoked_reason = 'replaced by a newer standing authorization'
   where tool = p_tool and revoked_at is null
     and project_id is not distinct from p_project;

  insert into public.standing_authorizations (project_id, tool, reason, granted_by, expires_at)
  values (p_project, p_tool, btrim(p_reason), p_by, p_until)
  returning authorization_id into v_id;

  return jsonb_build_object('ok', true, 'authorization', v_id, 'tool', p_tool,
    'scope', case when p_project is null then 'everywhere' else 'this project' end);
end;
$function$
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

CREATE OR REPLACE FUNCTION app.say_in_project(p_project_id uuid, p_text text, p_addressed_to text DEFAULT NULL::text, p_addressed_also text[] DEFAULT '{}'::text[], p_by text DEFAULT 'grant'::text)
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
  v_refusal  text;
begin
  -- 0618: who may say something WHERE: a test principal speaks only in a fixture project.
  v_refusal := app.authority_refusal(p_by, null, p_project_id);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal);
  end if;
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
  values ('teamhq', v_key, btrim(p_by), v_said, v_to, v_also, v_key, p_project_id,
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

CREATE OR REPLACE FUNCTION app.send_to_agent(p_kind text, p_id uuid, p_action text, p_to text DEFAULT NULL::text, p_with uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text, p_by text DEFAULT 'grant'::text)
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
  v_refusal  text;
begin
  v_refusal := app.principal_refusal(p_by);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal);
  end if;
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
  -- 0618: who may send WHAT, WHERE: a test principal only in a fixture project.
  v_refusal := app.authority_refusal(p_by, null, v_project);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal);
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
  values ('teamhq', v_key, btrim(p_by), v_said,
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
