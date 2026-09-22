/*
  0547 — a conversation remembers which project it is about

  ## What was measured

      select count(*) from public.project_switches;   -- 169, every one harness

  Not one real Telegram chat, Slack channel, voice call or dashboard
  conversation has ever recorded a project. And the reader has no caller:
  `app.current_project` is reached only through `app.resolve_project`, which
  is reached only from `resolveProject` in `src/projects/context.ts`, which
  nothing in `src/` imports. `switchTo` beside it has no importer either.

  Meanwhile a third of Grant's real messages, and 52% of his voice notes,
  arrive carrying no project at all.

  ## Where the missing link is, since that was the question

  Not ingress, not persistence, not the resolver, not consumption - all four
  work. `enqueue_inbound` already resolves a project from an asset's context,
  from a project the surface named, and from a Slack channel's mapping, and
  `jobs.project_id` carries it onward. `project_switches` stores, and
  `app.current_project` reads and correctly ignores a switch that points at a
  FIXTURE project (0164).

  **Nothing joined them.** No caller wrote a switch for a real conversation,
  and the resolution cascade never asked. The dial with no reader, in the
  mechanism that decides where Grant's work goes.

  ## The two lines this adds, and the ordering argument

  In one function, because §5 says an adapter may only translate and this is
  the canonical layer.

      asset's project  >  the surface named it  >  Slack channel map
        >  WHAT THIS CONVERSATION IS ALREADY ABOUT        <- new
        >  Unnamed  >  most recently updated

  Anything the message itself says still wins. The conversation beats a
  fallback, which is the invariant: a later turn with no project stays where
  the exchange already was.

  ## What is deliberately NOT recorded

  Only an explicit resolution is written to the conversation's memory. The two
  branches below it are guesses, and a guess written into that memory would
  lock the whole exchange onto something nobody said - which is worse than
  guessing once, because it compounds. Unnamed is excluded for the same
  reason: it is the absence of a project rather than a project, and a
  conversation that remembered it could never resolve to anything else.

  ## Containment, both directions

  The scope is the conversation, and a harness conversation's ref is its own -
  `sess-…`, `shadow-…`, `probe-chat-…` - so a synthetic exchange can neither
  read nor write a real one's context. #310 is why this is stated rather than
  assumed: a harness withdrawal retracted one of Grant's real standing rules
  because a lookup was scoped by relevance instead of by class of traffic.
  `verify:context` asserts both directions.

  ## The traps this is written around

  Spliced from the LIVE definition rather than retyped - it is 8,000
  characters and this changes two things in it. The argument list is
  unchanged, so `create or replace` replaces in place and no wrapper needs
  dropping. `pg_get_functiondef` emits no trailing semicolon.
*/

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
     and v_project is distinct from app.current_project(v_scope, v_talk) then
    insert into public.project_switches
      (scope_kind, scope_ref, project_id, switched_by, reason)
    values (v_scope, v_talk, v_project,
            coalesce(c.subject, c.actor, 'the office'),
            'The message resolved to this project, so the conversation is about it.');
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
$function$;


/*
  Driven, because a migration that applies cleanly is not a function that
  works. Inside a transaction that is rolled back, so the real queue is
  untouched: `enqueue_inbound` creates a JOB, and a job can never be deleted.
*/
do $drive$
declare
  v_p uuid;
  v_c uuid;
  v_first uuid;
  v_second uuid;
begin
  /*
    A REAL active project, not merely an active one.

    `app.current_project` returns null when the latest switch points at a
    fixture (0164), so driving this against the most recently updated active
    project picked one of the harness's own and the drive failed with "the
    conversation did not remember" about a function that works. The test was
    wrong and the code was right, which is the direction that sends somebody
    rewriting something correct.
  */
  select project_id into v_p from public.projects
   where status = 'active' and not is_fixture order by updated_at desc limit 1;
  if v_p is null then
    raise notice 'no active project to drive this against; skipped';
    return;
  end if;

  -- A conversation nobody has ever used, so nothing here can inherit by luck.
  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, subject, instruction, project_id, dedupe_key)
  values ('telegram', '999000111:1', '999000111', 'drive-0547',
          'A first message that names its project.', v_p, 'telegram:drive:zero_five_four_seven_one')
  returning command_id into v_c;
  perform app.enqueue_inbound(v_c);
  select project_id into v_first from public.jobs
   where idempotency_key = format('inbound-%s', v_c);
  if v_first is distinct from v_p then
    raise exception 'the explicit project did not survive ingress';
  end if;
  if app.current_project('telegram_chat', '999000111') is distinct from v_p then
    raise exception 'the conversation did not remember the project it resolved to';
  end if;

  -- And the second turn, carrying nothing at all.
  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, subject, instruction, dedupe_key)
  values ('telegram', '999000111:2', '999000111', 'drive-0547',
          'A second message that names nothing.', 'telegram:drive:zero_five_four_seven_two')
  returning command_id into v_c;
  perform app.enqueue_inbound(v_c);
  select project_id into v_second from public.jobs
   where idempotency_key = format('inbound-%s', v_c);
  if v_second is distinct from v_p then
    raise exception 'the second turn did not inherit the conversation''s project (got %)', v_second;
  end if;

  -- A DIFFERENT conversation must inherit nothing.
  if app.current_project('telegram_chat', '999000222') is not null then
    raise exception 'a conversation nobody has used already has a project';
  end if;

  raise notice '0547 drive: explicit then implicit both resolved to %', v_p;
  raise exception 'rolling the drive back' using errcode = 'RS001';
exception when sqlstate 'RS001' then
  raise notice '0547 drive rolled back, as intended';
end
$drive$;
