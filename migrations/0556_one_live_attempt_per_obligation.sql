/*
  0556 — one live attempt per obligation (#316)

  ## Measured on Grant's REAL Telegram chat, not on a harness

      08:05:27  "Write me a PDF report on where the Legacy Coaching…"  -> 1 artifact.report
      08:08:37  "Write me a PDF report on where the Legacy Coaching…"  -> 1 artifact.report

  Identical sentence, 190 seconds apart, two children, two PDFs into his real
  project. CLAUDE.md already records near-duplicate reports piling up in
  Legacy Coaching and attributes them to the replay harness; some of them are
  his own repeats, faithfully duplicated.

  On genuinely delivered real traffic — a real channel AND an answer that
  actually reached somebody, which is the property that survives where a name
  does not — **57 of 290 message pairs within two hours are near-duplicates**,
  over 113 messages. This is not an edge case; it is how a person behaves when
  an answer has not arrived yet.

  (The first calibration said 166 of 506. Every one of the top pairs was the
  same sentence in a chat literally named `verify`, driven through the real
  voice path so `requested_by` is `voice:grant` and `app.harness_job` cannot
  see it. Seventh instance of that class, and it was about to be reported as
  Grant's own behaviour.)

  ## The mechanism already exists and is defeated by one line

  `jobs_one_live_per_idempotency_key` is a partial unique index over every
  state except complete, cancelled and failed. It is a database-enforced "one
  live job per obligation", and **a unique index cannot be raced** — which is
  the concurrency half of this Issue, answered without a check-before-create.

  `app.enqueue_child` composes its key as
  `format('child-%s-%s', kind, gen_random_uuid())`. A random uuid can never
  collide, so for every child the index is structurally inert.

  ## What an obligation is, and why it is scoped to the conversation

  Not the text alone. An obligation is **this conversation, this kind of work,
  this request** — canonical conversation state plus what was asked, hashed so
  the key stays a key rather than becoming a copy of the instruction.

  The conversation scope is not decoration. Without it, two people (or two
  chats) asking for the same thing would collide and the second would be
  silently suppressed — which is #315's cross-conversation destruction with
  the sign reversed, and the more dangerous direction because nothing would
  look wrong.

  ## Three properties fall out of the partial index rather than being coded

    - a CANCELLED obligation frees its key, so #315's explicit restart works
      and is not a special case
    - a COMPLETE obligation frees its key, so asking again after an answer
      starts fresh rather than being refused for ever
    - a FAILED obligation frees its key, so a retry is possible

  That is exactly the lifecycle #316 asks for, and none of it is a rule
  somebody has to remember.

  ## enqueue_child is not changed

  It has twelve callers and `create or replace` with a changed argument list
  makes a second overload rather than replacing it — CLAUDE.md records the
  ambiguous-call trap. `enqueue_child_once` is a new door, and it returns
  whether it CREATED anything, because a caller that cannot tell "I started
  this" from "this was already running" cannot narrate either one honestly.
*/

create or replace function app.obligation_key(
  p_parent uuid,
  p_kind text,
  p_request text
) returns text
language sql
stable
security definer
set search_path to ''
as $function$
  /*
    The conversation this job belongs to, or the job itself when it has no
    inbound command — a duty, or a child of a child. Falling back to the job
    means an unattributed obligation is unique to itself, which is the safe
    direction: it duplicates rather than suppressing somebody else's work.
  */
  select 'obl-' || encode(extensions.digest(
    coalesce((
      select c.origin_channel || ':' || split_part(c.origin_ref, ':', 1) || ':' ||
             coalesce(c.subject, c.actor)
        from public.inbound_commands c
       where c.job_id = p_parent
       limit 1), p_parent::text)
    || '|' || coalesce(p_kind, '')
    || '|' || lower(btrim(regexp_replace(coalesce(p_request, ''), '\s+', ' ', 'g'))),
    'sha256'), 'hex')
$function$;

comment on function app.obligation_key(uuid, text, text) is
  'The identity of a piece of work: this conversation, this kind, this '
  'request. Scoped to the conversation because an unscoped key would let one '
  'chat silently suppress another chat''s work. 0556.';

create or replace function app.enqueue_child_once(
  p_parent uuid,
  p_kind text,
  p_request text,
  p_payload jsonb default '{}'::jsonb,
  p_announce boolean default true,
  p_project uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_parent public.jobs;
  v_key text;
  v_id uuid;
  v_live uuid;
begin
  select * into v_parent from public.jobs where job_id = p_parent;
  if not found then
    raise exception 'no job % to hang a child on', p_parent using errcode = '23503';
  end if;

  v_key := app.obligation_key(p_parent, p_kind, p_request);

  /*
    The insert is the check. Asking first and inserting second is the race
    #316 names, and no amount of care in the caller closes it — two messages
    120 milliseconds apart both find nothing and both fan out. The unique
    index decides, and the loser reads back what the winner made.
  */
  begin
    insert into public.jobs
      (parent_job_id, correlation_id, project_id, idempotency_key, kind,
       requested_by, priority, pinned_config, announce)
    values (
      p_parent, v_parent.correlation_id,
      coalesce(p_project, v_parent.project_id),
      v_key, p_kind, v_parent.requested_by, v_parent.priority,
      coalesce(p_payload, '{}'::jsonb), p_announce)
    returning job_id into v_id;
    return jsonb_build_object('job_id', v_id, 'created', true);
  exception when unique_violation then
    /*
      Somebody is already doing exactly this. Hand back WHICH job, so the
      caller can say what is happening rather than either duplicating it or
      going quiet — the two things the office did before this existed.
    */
    select job_id into v_live from public.jobs
     where idempotency_key = v_key
       and state not in ('complete', 'cancelled', 'failed')
     limit 1;
    return jsonb_build_object('job_id', v_live, 'created', false);
  end;
end;
$function$;

comment on function app.enqueue_child_once(uuid, text, text, jsonb, boolean, uuid) is
  'Hand work on unless this conversation is already pursuing exactly it, in '
  'which case say which job is doing it. The insert IS the check, because '
  'asking first loses the race two near-simultaneous messages create. A '
  'cancelled, failed or complete obligation frees its key, so an explicit '
  'restart needs no special case (#315). 0556.';

/*
  Driven, inside a rollback. The halves that matter are the SECOND call,
  and the three that must still be allowed to start again.
*/
do $drive$
declare
  v_p uuid; v_c uuid; v_parent uuid; v_a jsonb; v_b jsonb; v_say text := '';
begin
  select project_id into v_p from public.projects
   where status = 'active' and not is_fixture
     and project_id <> app.unnamed_project() order by updated_at desc limit 1;
  if v_p is null then raise notice '0556: no real project; skipped'; return; end if;

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key)
  values ('teamhq', 'drive0556:1', 'grant', 'write me a report',
          'teamhq:drive:zero_five_five_six_a')
  returning command_id into v_c;
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state)
  values (extensions.gen_random_uuid(), v_p, 'drive-0556-parent', 'office.instruction',
          'teamhq:grant', 10, 'queued')
  returning job_id into v_parent;
  update public.inbound_commands set job_id = v_parent where command_id = v_c;

  v_a := app.enqueue_child_once(v_parent, 'artifact.report', 'Write me a PDF report');
  if (v_a ->> 'created')::boolean is not true then
    raise exception '0556: the first attempt did not create anything: %', v_a;
  end if;
  v_say := v_say || 'first creates; ';

  /* The same obligation again: no second child, and it says which one. */
  v_b := app.enqueue_child_once(v_parent, 'artifact.report', 'Write me a PDF report');
  if (v_b ->> 'created')::boolean is not false then
    raise exception '0556: the repeat created a second child: %', v_b;
  end if;
  if (v_b ->> 'job_id') is distinct from (v_a ->> 'job_id') then
    raise exception '0556: the repeat did not name the live job: % vs %', v_b, v_a;
  end if;
  v_say := v_say || 'repeat reuses and names it; ';

  /* Whitespace and case are not a different obligation. */
  v_b := app.enqueue_child_once(v_parent, 'artifact.report', '  write me a   PDF REPORT ');
  if (v_b ->> 'created')::boolean is not false then
    raise exception '0556: spacing made it a different obligation: %', v_b;
  end if;
  v_say := v_say || 'spacing and case do not matter; ';

  /* A materially different request IS different work. */
  v_b := app.enqueue_child_once(v_parent, 'artifact.report', 'Write me a report on the venue');
  if (v_b ->> 'created')::boolean is not true then
    raise exception '0556: different work was refused: %', v_b;
  end if;
  v_say := v_say || 'different work still starts; ';

  /* A different KIND of work on the same words is different work. */
  v_b := app.enqueue_child_once(v_parent, 'office.pursue', 'Write me a PDF report');
  if (v_b ->> 'created')::boolean is not true then
    raise exception '0556: a different kind was refused: %', v_b;
  end if;
  v_say := v_say || 'a different kind still starts; ';

  /* #315: cancelling frees the obligation, so an explicit restart works. */
  update public.jobs set state = 'cancelled', finished_at = app.now_utc()
   where job_id = (v_a ->> 'job_id')::uuid;
  v_b := app.enqueue_child_once(v_parent, 'artifact.report', 'Write me a PDF report');
  if (v_b ->> 'created')::boolean is not true then
    raise exception '0556: cancelled work could not be restarted: %', v_b;
  end if;
  if (v_b ->> 'job_id') = (v_a ->> 'job_id') then
    raise exception '0556: it resurrected the cancelled job rather than starting one';
  end if;
  v_say := v_say || 'a cancelled obligation restarts as a NEW job';

  raise exception '0556 drive: %', v_say using errcode = 'RS001';
exception when sqlstate 'RS001' then
  raise notice '0556 drive rolled back, as intended';
end
$drive$;
