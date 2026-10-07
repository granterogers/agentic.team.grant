-- 1032: a FAILED or UNCERTAIN delivery of a finished answer never disappears silently. It puts ONE question on the
-- person's own list, and the person's decision, not the system's guess, settles it.
--
-- WHAT WAS WRONG (the residual 1029 named and left open: "FINDING K"). A finished answer whose delivery ended
-- terminally `failed`, or parked `indeterminate` (a request left the process and nothing recorded how it ended), was
-- surfaced only by the events ledger and by `app.undelivered`, which no gateway section serves and which is not scoped
-- to an office. A person who asked on Telegram got nothing and was told nothing; the thread on the dashboard showed
-- "Could not be delivered" with an internal word for the uncertain case. The `owed_a_word` mechanism covers FAILED TURNS
-- only and skips a job that has any delivery row, so it never spoke for a completed answer.
--
-- THE DESIGN (docs/delivery/DELIVERY-STATE-MACHINE.md, "Who learns of a terminal failure").
--
--   1. The answer is preserved: nothing here touches `outputs`. It is read back by the item below (an excerpt) and by the
--      thread in full.
--   2. The durable attention item is a BLOCKER (a question on the person's Needs me list), not a new table and not a
--      to-do:
--        * Needs me is the surface the person already reads, it carries options as buttons, it is per office, and it is
--          harness-filtered by `app.harness_job` through the job;
--        * a to-do is filed by `blockers_make_a_task` only for a blocker that stops work, and ticking such a to-do
--          ANSWERS the blocker with its first option, which here would resend an uncertain message. So the item is
--          `work_can_continue = true` (nothing is held up: the answer exists) and files no to-do.
--      It satisfies check:answerable by the START road: `on_answer` names `delivery.decide`, and `hq_answer_blocker`
--      performs the person's choice in SQL (`app.answer_delivery_attention`), through the doors that already existed
--      (`app.retry_delivery`, `app.resolve_indeterminate_delivery`).
--   3. ONE per undelivered answer, whatever raises it: a unique partial index on the open item keyed by the job, and an
--      AFTER trigger on `public.deliveries` so EVERY writer of a terminal state (the failure recorder, the sweep, the
--      reclaim of a lapsed mid-send, the person's own retry failing again) raises through one door. Two workers, a retry
--      and the sweep all land on the same index; the loser inserts nothing.
--   4. Never an automatic resend of an uncertain message. "Send it again" is an option the PERSON presses; "It arrived,
--      close this" settles the ambiguity without sending; "Dismiss" closes the item and sends nothing. A definite refusal
--      offers "Send it again" and "Dismiss" only (an arrival cannot be claimed for a message the provider refused).
--   5. The item closes itself when the answer is delivered some other way (the person's Try again on the thread, a
--      reconcile): the same trigger settles it on `sent`, and the sweep settles any it missed.
--   6. NOTHING is sent on a second channel. Whether a code-composed notice on another channel is permitted for the owner
--      is not settled by policy (telegram.only_chief_speaks, the pager and claim_delivery containment say nothing about a
--      failure notice), so it is not done. Team HQ plus the item is the whole surface.
--
-- Containment: a job `app.harness_job` calls harness raises nothing; an item carries the delivery's own office, and
-- `needs_me_in`, `studio_waiting` and `hq_answer_blocker` are all office-scoped, so another office never sees or
-- answers it.

-- ---------------------------------------------------------------------------------------------------------------------
-- The failure in plain words, once. Never an id, a code or a number.
create or replace function app.delivery_words(p_error_code text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_error_code like 'chat_not_found%'
      then 'That chat no longer exists, or the bot was removed from it.'
    when p_error_code like 'blocked_by_user%'
      then 'The bot was blocked, so it cannot message you there.'
    when p_error_code like 'indeterminate%'
      then 'The provider did not say whether it arrived, so it was not sent again in case you already have it.'
    when p_error_code like 'abandoned:%'
      then 'It was never sent and the office stopped trying.'
    when p_error_code like '%rate%'
      then 'The provider kept rate-limiting the office and it gave up.'
    when p_error_code like '%timeout%' or p_error_code like '%ECONN%' or p_error_code like 'network%'
      then 'The provider could not be reached and the office gave up.'
    else 'The provider refused it.'
  end
$fn$;

-- ONE open item per job, however many things try to raise it at once.
create unique index if not exists blockers_one_open_delivery_attention
  on public.blockers ((on_answer -> 'payloads' -> 0 ->> 'job_id'))
  where state = 'open' and on_answer ->> 'kind' = 'delivery.decide';

-- ---------------------------------------------------------------------------------------------------------------------
-- RAISE: put the question on the person's list. Idempotent; a harness job, an answer with no stored text, a superseded
-- row and a row that is not a failed result all raise nothing.
create or replace function app.raise_delivery_attention(p_delivery uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  d public.deliveries;
  j public.jobs;
  v_body text;
  v_staff uuid;
  v_who text;
  v_channels text;
  v_unsure boolean;
  v_excerpt text;
  v_project uuid;
  v_options text[];
  v_id uuid;
begin
  select * into d from public.deliveries x where x.delivery_id = p_delivery;
  -- Only a job's own ANSWER (key `job:<id>:<channel>`, the key the redrive rebuilds). A failed QUESTION (key `blocker:...`)
  -- is already an open question on his list, and a second item on a paused job would be asked by the pause sweep as
  -- though it were the pause's own question.
  if not found or d.state <> 'failed' or d.purpose <> 'result' or d.job_id is null
     or coalesce(d.error_code, '') like 'superseded:%'
     or d.dedupe_key not like 'job:' || d.job_id::text || ':%' then
    return null;
  end if;
  select * into j from public.jobs x where x.job_id = d.job_id and x.office_id = d.office_id;
  if not found then return null; end if;
  if j.state in ('paused', 'waiting_user', 'waiting_external') then return null; end if;
  if coalesce(app.harness_job(j.job_id), false) then return null; end if;

  select o.body, o.staff_id into v_body, v_staff
    from public.outputs o where o.job_id = j.job_id order by o.created_at desc limit 1;
  if v_body is null or btrim(v_body) = '' then return null; end if;

  select coalesce(nullif(btrim(s.name), ''), 'The team') into v_who from public.staff s where s.staff_id = v_staff;
  v_who := coalesce(v_who, 'The team');

  select string_agg(distinct case x.channel when 'telegram' then 'Telegram' when 'slack' then 'Slack'
                                            when 'voice' then 'your call' else 'Team HQ' end, ' and '),
         bool_and(coalesce(x.error_code, '') like 'indeterminate:%')
    into v_channels, v_unsure
    from public.deliveries x
   where x.job_id = j.job_id and x.office_id = d.office_id and x.purpose = 'result' and x.state = 'failed'
     and x.dedupe_key like 'job:' || x.job_id::text || ':%'
     and coalesce(x.error_code, '') not like 'superseded:%';

  v_excerpt := left(regexp_replace(btrim(v_body), '\s+', ' ', 'g'), 500)
               || case when length(btrim(v_body)) > 500 then '…' else '' end;
  v_project := coalesce(j.project_id,
                        (select p.project_id from public.projects p where p.office_id = d.office_id and p.slug = 'unnamed'));
  v_options := case when coalesce(v_unsure, false)
                    then array['Send it again', 'It arrived, close this', 'Dismiss']
                    else array['Send it again', 'Dismiss'] end;

  insert into public.blockers
    (office_id, project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options,
     originating_agent, work_can_continue, on_answer)
  values
    (d.office_id, v_project, j.job_id,
     case when coalesce(v_unsure, false)
          then format('%s''s answer may not have reached you on %s', v_who, coalesce(v_channels, 'its channel'))
          else format('%s''s answer did not reach you on %s', v_who, coalesce(v_channels, 'its channel')) end,
     app.delivery_words(d.error_code)
       || ' The answer is kept, and you can read it in full in the project conversation in Team HQ. It said: "'
       || v_excerpt || '"',
     'Nothing else is waiting on this. Until you decide, the answer is not sent again.',
     v_options, v_who, true,
     jsonb_build_object('kind', 'delivery.decide', 'option', 'Send it again', 'also', '[]'::jsonb,
                        'payloads', jsonb_build_array(jsonb_build_object('job_id', j.job_id))))
  on conflict ((on_answer -> 'payloads' -> 0 ->> 'job_id'))
    where state = 'open' and on_answer ->> 'kind' = 'delivery.decide'
  do nothing
  returning blocker_id into v_id;
  return v_id;
end;
$fn$;

-- SETTLE: an open item whose answer has been delivered (or can no longer be) closes itself. Nothing failed and nothing is
-- still owed for the job's results.
create or replace function app.settle_delivery_attention(p_job uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_n integer;
begin
  with closed as (
    update public.blockers b
       set state = 'resolved', resolved_at = app.now_utc(),
           resolution = 'It reached you, so there is nothing left to decide.'
     where b.state = 'open'
       and b.on_answer ->> 'kind' = 'delivery.decide'
       and (p_job is null or b.on_answer -> 'payloads' -> 0 ->> 'job_id' = p_job::text)
       and not exists (
             select 1 from public.deliveries d
              where d.job_id::text = b.on_answer -> 'payloads' -> 0 ->> 'job_id'
                and d.office_id = b.office_id and d.purpose = 'result'
                and d.dedupe_key like 'job:' || d.job_id::text || ':%'
                and (d.state = 'claimed'
                     or (d.state = 'failed' and coalesce(d.error_code, '') not like 'superseded:%')))
    returning 1)
  select count(*) into v_n from closed;
  return v_n;
end;
$fn$;

-- BACKSTOP: a recent failed answer with no item (the trigger below failed, or the row failed before this existed) gets
-- one. Bounded to the redrive window so a deploy does not spring an old answer on a person, and an item already raised
-- for this failure, answered or not, is not raised again.
create or replace function app.raise_missing_delivery_attention(p_max_age interval default interval '2 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select d.delivery_id
      from public.deliveries d
     where d.state = 'failed' and d.purpose = 'result' and d.job_id is not null
       and d.dedupe_key like 'job:' || d.job_id::text || ':%'
       and coalesce(d.error_code, '') not like 'superseded:%'
       and d.updated_at > app.now_utc() - p_max_age
       and not exists (
             select 1 from public.blockers b
              where b.office_id = d.office_id
                and b.on_answer ->> 'kind' = 'delivery.decide'
                and b.on_answer -> 'payloads' -> 0 ->> 'job_id' = d.job_id::text
                and (b.state = 'open' or b.created_at >= d.updated_at - interval '1 minute'))
     order by d.updated_at
     limit 50
  loop
    if app.raise_delivery_attention(r.delivery_id) is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$fn$;

-- THE TRIGGER: one door for every writer of a terminal state. Never fatal: a failure to raise must not undo the state
-- change it describes, and is written to the events ledger instead of vanishing (the sweep raises it on its next pass).
create or replace function app.deliveries_attention_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.purpose <> 'result' or new.job_id is null then return null; end if;
  if new.state = 'failed' and coalesce(new.error_code, '') not like 'superseded:%' then
    perform app.raise_delivery_attention(new.delivery_id);
  else
    perform app.settle_delivery_attention(new.job_id);
  end if;
  return null;
exception when others then
  perform app.delivery_note(new.delivery_id, 'delivery.attention_failed', left(sqlerrm, 300));
  return null;
end;
$fn$;

drop trigger if exists deliveries_attention on public.deliveries;
create trigger deliveries_attention
  after insert or update of state, error_code on public.deliveries
  for each row
  when (new.state in ('failed', 'sent', 'suppressed'))
  execute function app.deliveries_attention_trigger();

-- ---------------------------------------------------------------------------------------------------------------------
-- ANSWER: the person's decision performs exactly one of three things. Called by hq_answer_blocker, which has already
-- locked the row, refused a stranger and checked the answer is one of the offered options.
create or replace function app.answer_delivery_attention(p_office uuid, p_blocker_id uuid, p_answer text, p_by text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  b public.blockers;
  v_job uuid;
  r record;
  v_n integer := 0;
  v_what text;
begin
  perform app.require_office(p_office);
  select * into b from public.blockers x where x.blocker_id = p_blocker_id and x.office_id = p_office for update;
  if not found or coalesce(b.on_answer ->> 'kind', '') <> 'delivery.decide' then
    return jsonb_build_object('error', 'there is nothing here to answer');
  end if;
  if b.state <> 'open' then
    return jsonb_build_object('ok', false, 'already', true, 'state', b.state::text, 'resolution', b.resolution);
  end if;
  v_job := (b.on_answer -> 'payloads' -> 0 ->> 'job_id')::uuid;

  if p_answer = 'Send it again' then
    -- The person's decision replaces the ambiguity: the existing safe door clears the intent record and makes the row
    -- owed once, and the redrive sends it through the same notifier and the same fence.
    for r in
      select x.delivery_id from public.deliveries x
       where x.job_id = v_job and x.office_id = p_office and x.purpose = 'result' and x.state = 'failed'
         and x.dedupe_key like 'job:' || x.job_id::text || ':%'
         and coalesce(x.error_code, '') not like 'superseded:%'
       order by x.updated_at
    loop
      if app.retry_delivery(p_office, r.delivery_id) = 'queued' then v_n := v_n + 1; end if;
    end loop;
    v_what := case when v_n = 0 then 'there was nothing left to send'
                   when v_n = 1 then 'it will be sent again'
                   else format('%s will be sent again', v_n) end;
  elsif p_answer = 'It arrived, close this' then
    -- He says it arrived: the uncertain row is closed as sent. Nothing is sent.
    for r in
      select x.delivery_id from public.deliveries x
       where x.job_id = v_job and x.office_id = p_office and x.purpose = 'result' and x.state = 'failed'
         and x.dedupe_key like 'job:' || x.job_id::text || ':%'
         and coalesce(x.error_code, '') like 'indeterminate:%'
       order by x.updated_at
    loop
      if app.resolve_indeterminate_delivery(p_office, r.delivery_id, 'confirmed-by-person:' || r.delivery_id::text) = 'sent' then
        v_n := v_n + 1;
      end if;
    end loop;
    v_what := 'closed as delivered; nothing was sent';
  else
    v_what := 'nothing was sent';
  end if;

  update public.blockers
     set state = 'resolved', resolved_at = coalesce(resolved_at, app.now_utc()),
         resolution = format('%s — answered by %s: %s', p_answer, p_by, v_what),
         answered_option = p_answer, answered_by = p_by
   where blocker_id = p_blocker_id and office_id = p_office;

  return jsonb_build_object('ok', true, 'answer', p_answer, 'blocker', p_blocker_id,
    'started', case when p_answer = 'Send it again' then v_n else 0 end, 'says', v_what);
end;
$fn$;

revoke all on function app.delivery_words(text) from public;
revoke all on function app.raise_delivery_attention(uuid) from public;
revoke all on function app.settle_delivery_attention(uuid) from public;
revoke all on function app.raise_missing_delivery_attention(interval) from public;
revoke all on function app.deliveries_attention_trigger() from public;
revoke all on function app.answer_delivery_attention(uuid, uuid, text, text) from public;

-- ---------------------------------------------------------------------------------------------------------------------
-- hq_answer_blocker, spliced from its live definition. ONE change: an item of this kind is performed by
-- app.answer_delivery_attention, after the principal, authority, state and option checks and before anything that
-- reads the job as a parked question.
CREATE OR REPLACE FUNCTION app.hq_answer_blocker(p_office uuid, p_blocker_id uuid, p_answer text, p_by text DEFAULT NULL::text)
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
    1032. A FAILED OR UNCERTAIN DELIVERY of a finished answer is put to the person as a question, and his answer
    performs one of three things in app.answer_delivery_attention: send it again (the existing safe retry),
    close it as delivered (nothing is sent), or dismiss it (nothing is sent). The job is complete and nothing
    here resumes it.
  */
  if coalesce(b.on_answer ->> 'kind', '') = 'delivery.decide' then
    return app.answer_delivery_attention(p_office, p_blocker_id, v_answer, v_by);
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
       where app.enqueue_child(p_office, b.job_id, b.on_answer ->> 'kind', pay, interval '0', false)
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

-- ---------------------------------------------------------------------------------------------------------------------
-- conversation_history, spliced from its live definition. ONE change, in the delivery state of an answer:
--   * a superseded row is bookkeeping (the same job already reached that chat), so it is not a failure;
--   * a failure that is ENTIRELY uncertain says 'unconfirmed', so the page can say it may have arrived rather than that
--     it did not.
CREATE OR REPLACE FUNCTION app.conversation_history(p_office uuid, p_project_id uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
  if exists (select 1 from public.offices o where o.office_id = p_office and o.kind = 'sample') then
    return '[]'::jsonb;
  end if;
  select pj.project_id into v_project from public.projects pj where pj.project_id = p_project_id and pj.office_id = p_office;
  return (
  with bounded as (select greatest(1, least(coalesce(p_limit, 50), 200)) as n),
  said as (
    select
      c.received_at as at,
      jsonb_build_object(
        'message_id',   c.command_id,
        'kind',         'said',
        'at',           c.received_at,
        'from',         app.office_actor(p_office),
        'name',         (select o.name from public.offices o where o.office_id = p_office),
        'body',         coalesce(nullif(btrim(c.transcript), ''), c.instruction),
        'surface',      c.origin_channel,
        'addressed_to', c.addressed_to,
        'spoken',       c.voice_file_id is not null,
        'backfilled',   coalesce((c.context->>'backfilled')::boolean, false)
      ) as v
      from public.inbound_commands c
      left join public.jobs j on j.job_id = c.job_id
     where c.office_id = p_office
       and c.project_id = v_project
       and coalesce(j.is_fixture, false) = false
       and (c.job_id is null or not app.harness_job(c.job_id))
       and (p_before is null or c.received_at < p_before)
     order by c.received_at desc
     limit (select n from bounded)
  ),
  answered as (
    select
      o.created_at as at,
      jsonb_build_object(
        'message_id',    o.output_id,
        'kind',          'answered',
        'at',            o.created_at,
        'from',          coalesce(s.slug, 'the-office'),
        'name',          coalesce(s.name, 'The team'),
        'body',          o.body,
        'confidence',    o.confidence::text,
        'evidence',      o.evidence::text,
        'deterministic', o.deterministic,
        'job',           o.job_id,
        'delivery',      dstate.worst,
        'undelivered',   coalesce(dstate.failed, 0)
      ) as v
      from public.outputs o
      join public.jobs j on j.job_id = o.job_id
      left join public.staff s on s.staff_id = o.staff_id
      left join lateral (
        select
          x.failed as failed,
          case
            when x.failed > 0 and x.failed = x.unsure then 'unconfirmed'
            when x.failed > 0 then 'failed'
            when x.claimed > 0 then 'sending'
            when x.total > 0 then 'sent'
            else null
          end as worst
          from (
            select
              count(*) filter (where d.state = 'failed' and coalesce(d.error_code, '') not like 'superseded:%') as failed,
              count(*) filter (where d.state = 'failed' and coalesce(d.error_code, '') like 'indeterminate:%') as unsure,
              count(*) filter (where d.state = 'claimed') as claimed,
              count(*) filter (where coalesce(d.error_code, '') not like 'superseded:%') as total
              from public.deliveries d
             where d.job_id = o.job_id and d.office_id = p_office
          ) x
      ) dstate on true
     where j.office_id = p_office
       and (
             j.project_id = v_project
             or (j.project_id is null and v_project is not null
                 and v_project = (select pu.project_id from public.projects pu
                                   where pu.slug = 'unnamed' and pu.office_id = p_office))
           )
       and not j.is_fixture
       and not app.harness_job(j.job_id)
       and (p_before is null or o.created_at < p_before)
     order by o.created_at desc
     limit (select n from bounded)
  ),
  recent as (
    select at, v
      from (select at, v from said union all select at, v from answered) both_sides
     order by at desc
     limit (select n from bounded)
  )
  select coalesce(jsonb_agg(r.v order by r.at), '[]'::jsonb) from recent r
  );
end
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- settle_lapsed_deliveries, spliced from its live definition (1029). ONE change: before it returns it settles the items
-- whose answer has been delivered and raises the ones a recent failure is missing (the backstop).
create or replace function app.settle_lapsed_deliveries(p_max_age interval default interval '2 days')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r public.deliveries;
  v_refusal text;
  v_unconfirmed int := 0;
  v_suppressed int := 0;
  v_superseded int := 0;
  v_abandoned int := 0;
  v_due int := 0;
  v_state text;
  v_has_output boolean;
  v_closed int := 0;
  v_raised int := 0;
begin
  for r in
    select d.* from public.deliveries d
     where d.state = 'claimed' and d.lease_expires_at < app.now_utc()
     order by d.lease_expires_at
     limit 200
       for update skip locked
  loop
    -- 1. AMBIGUOUS: a send began and nothing recorded how it ended. Not resent; parked and said.
    if r.send_started_at is not null then
      update public.deliveries
         set state = 'failed', error_code = 'indeterminate:lease_lapsed_mid_send', send_started_at = null
       where delivery_id = r.delivery_id and office_id = r.office_id and state = 'claimed';
      perform app.delivery_note(r.delivery_id, 'delivery.unconfirmed',
        'A send began and the worker never recorded how it ended; the provider may or may not have accepted it, so it was not sent again.');
      v_unconfirmed := v_unconfirmed + 1;
      continue;
    end if;

    -- 2. CONTAINMENT, asked again: a destination retired or a job found to be harness since the claim is a refusal now.
    v_refusal := app.delivery_refusal(r.job_id, r.dedupe_key, r.channel, r.target_ref);
    if v_refusal is not null then
      update public.deliveries
         set state = 'suppressed', suppressed_reason = v_refusal
       where delivery_id = r.delivery_id and office_id = r.office_id and state = 'claimed';
      v_suppressed := v_suppressed + 1;
      continue;
    end if;

    -- 3. SUPERSEDED: the same job already reached this same destination on another delivery. Resending would be a
    -- second visible message, so the row is closed (and is not a failure Grant is shown).
    if r.job_id is not null and exists (
         select 1 from public.deliveries s
          where s.job_id = r.job_id and s.office_id = r.office_id and s.state = 'sent'
            and s.channel = r.channel and s.target_ref = r.target_ref and s.delivery_id <> r.delivery_id) then
      update public.deliveries
         set state = 'failed', error_code = 'superseded:sent_by_sibling'
       where delivery_id = r.delivery_id and office_id = r.office_id and state = 'claimed';
      v_superseded := v_superseded + 1;
      continue;
    end if;

    -- 4. TOO OLD: a deploy must not spring an old answer on a person.
    if r.created_at < app.now_utc() - p_max_age then
      update public.deliveries
         set state = 'failed', error_code = 'abandoned:older_than_redrive_window'
       where delivery_id = r.delivery_id and office_id = r.office_id and state = 'claimed';
      perform app.delivery_note(r.delivery_id, 'delivery.abandoned', 'The message was never sent and is too old to send now.');
      perform app.reopen_duty_voice(r.job_id);
      v_abandoned := v_abandoned + 1;
      continue;
    end if;

    -- 5. NOTHING TO REDRIVE WITH. Only a job's result is rebuilt from its stored output (the key is `job:<id>:<channel>`).
    -- Anything else gets the question-asking sweep's window (an hour), then an honest ending.
    if r.purpose <> 'result' or r.job_id is null or r.dedupe_key not like 'job:' || r.job_id::text || ':%' then
      if r.lease_expires_at < app.now_utc() - interval '1 hour' then
        update public.deliveries
           set state = 'failed', error_code = 'abandoned:' || r.purpose || '_not_redriven'
         where delivery_id = r.delivery_id and office_id = r.office_id and state = 'claimed';
        perform app.delivery_note(r.delivery_id, 'delivery.abandoned',
          'A ' || r.purpose || ' message was claimed, never sent, and has nothing to rebuild it from.');
        perform app.reopen_duty_voice(r.job_id);
        v_abandoned := v_abandoned + 1;
      end if;
      continue;
    end if;

    select j.state::text, exists (select 1 from public.outputs o where o.job_id = j.job_id)
      into v_state, v_has_output
      from public.jobs j where j.job_id = r.job_id and j.office_id = r.office_id;
    if v_state is null or not v_has_output or v_state in ('failed', 'cancelled') then
      update public.deliveries
         set state = 'failed', error_code = 'abandoned:no_answer_to_redrive'
       where delivery_id = r.delivery_id and office_id = r.office_id and state = 'claimed';
      perform app.delivery_note(r.delivery_id, 'delivery.abandoned', 'The message was never sent and there is no stored answer to send.');
      perform app.reopen_duty_voice(r.job_id);
      v_abandoned := v_abandoned + 1;
      continue;
    end if;

    v_due := v_due + 1;   -- the redrive resends it
  end loop;

  -- 1032: the persons list. An item whose answer was delivered closes; a recent failure with no item gets one.
  v_closed := app.settle_delivery_attention(null);
  v_raised := app.raise_missing_delivery_attention(p_max_age);

  return jsonb_build_object('unconfirmed', v_unconfirmed, 'suppressed', v_suppressed, 'superseded', v_superseded,
                            'abandoned', v_abandoned, 'due', v_due,
                            'attention_closed', v_closed, 'attention_raised', v_raised);
end;
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------
-- undelivered, spliced from its live definition (1029). Two additions for the reader that shows a failed answer: the
-- answer itself (an excerpt, so the list is never only a code), and whether it is one the person has been asked about.
create or replace function app.undelivered(p_project_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(jsonb_agg(x.v order by x.at desc), '[]'::jsonb)
    from (
      select d.updated_at as at,
             jsonb_build_object(
               'delivery_id', d.delivery_id,
               'channel',     d.channel,
               'purpose',     d.purpose,
               'target',      d.target_ref,
               'attempt',     d.attempt,
               'error_code',  d.error_code,
               'job',         d.job_id,
               'project',     j.project_id,
               'at',          d.updated_at,
               'unconfirmed', coalesce(d.error_code, '') like 'indeterminate%',
               -- The answer that did not arrive, so a person reading this list can SEE it.
               'answer',      (select left(regexp_replace(btrim(o.body), '\s+', ' ', 'g'), 500)
                                 from public.outputs o where o.job_id = d.job_id
                                order by o.created_at desc limit 1),
               -- The question on his Needs me list for it, when there is one.
               'attention',   (select b.blocker_id from public.blockers b
                                where b.office_id = d.office_id and b.state = 'open'
                                  and b.on_answer ->> 'kind' = 'delivery.decide'
                                  and b.on_answer -> 'payloads' -> 0 ->> 'job_id' = d.job_id::text
                                limit 1),
               -- A code nobody can act on is a code nobody reads.
               'says', case
                 when d.error_code like 'chat_not_found%'
                   then 'That chat no longer exists, or the bot was removed from it.'
                 when d.error_code like 'indeterminate%'
                   then 'The provider did not say whether it arrived.'
                 when d.error_code like 'abandoned:%'
                   then 'It was never sent and the office stopped trying.'
                 when d.error_code like '%rate%'
                   then 'The provider is rate-limiting us.'
                 when d.error_code like '%timeout%' or d.error_code like '%ECONN%'
                   then 'The provider could not be reached.'
                 else 'The provider refused it.'
               end
             ) as v
        from public.deliveries d
        join public.jobs j on j.job_id = d.job_id
       where d.state = 'failed'
         and coalesce(d.error_code, '') not like 'superseded:%'
         and not app.harness_job(j.job_id)
         and (p_project_id is null or j.project_id = p_project_id)
       order by d.updated_at desc
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x
$function$;
