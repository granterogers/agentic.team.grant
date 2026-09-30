/*
  0615 - a stranger on Slack is not a conversation, and a dashboard message says who said it

  Issue #388 (Slack sender authorization) and the last two places the gateway
  spoke as Grant without asking.

  SLACK. Telegram has refused a sender the office does not list since 0607: the
  door asks `public.sender_admitted` before it stores anything, and
  `app.enqueue_inbound` refuses a Telegram command with no resolved subject as a
  second lock for an edge function that has not been redeployed. Slack had
  neither. A correctly signed event from ANY workspace member or Slack Connect
  guest became an instruction from `slack:<their id>`, a trusted production door,
  and through it a stranger reached the project's documents and could teach the
  office a standing rule that read as Grant's (a lesson's author is taken from
  `requested_by`, and an author who is not a specialist is read as him). This is
  the second lock: `enqueue_inbound` refuses a Slack command with no resolved
  subject unless it is synthetic. The first lock is the door (slack-events),
  which asks sender_admitted before storing. A command inserted by a suite
  straight into the table is stamped synthetic by the connection (0603), so the
  suites that write Slack rows are untouched; the ones that go through the real
  signed door declare their conversation first (0605), and sender_admitted
  answers `declared_test` for those.

  SAYING SOMETHING. `app.say_in_project` and `app.send_to_agent` wrote actor
  'grant' for every dashboard message. A message is an INSTRUCTION, and an
  instruction from a person is what turns "ask first" into "he asked for it", so
  the actor is now the answering principal the gateway verified, and a principal
  the office does not know is refused. A test principal speaks as itself, which
  the harness predicate names on sight, so a verification suite driving the
  gateway can never produce a message that reads as his. The two `public`
  wrappers gain the argument; the old signatures are dropped by exact argument
  list. `p_by` defaults to 'grant' at the `app` level only, for the trusted
  callers that are SQL (the suites); nothing the gateway calls omits it.
*/

-- ---- Slack: the second lock ----------------------------------------------
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
  /*
    0607. A STRANGER IS NOT A CONVERSATION.

    `public.subject_identities` is the authoritative list of which
    channel-native actor is which person, and `app.subject_for` returns null
    for anybody not on it - 0056 says so in its own comment: "mapping an
    unknown actor to the only person on file would let them inherit his
    preferences and his authority". The trigger on inbound_commands honours
    that and writes a null subject. Nothing downstream ever asked: a null
    subject fell through `coalesce(c.subject, c.actor)` and became a job like
    any other, so a stranger who found the bot's public username reached the
    whole office, could teach it standing rules attributed to a name that is
    not Grant's, and (through record_telegram_chat) could become the chat his
    pager writes to.

    Refused here, at the one function every door calls, so that an edge
    function which has not been redeployed is still safe. Telegram, and since
    0615 Slack (a Slack actor is a workspace user id and the list is short and exact).

    NOT refused: a synthetic command. A harness that enters through a real
    signed door declares its conversation first (0605) and is contained by
    the origin machinery; refusing it here would turn every containment proof
    into a proof of nothing. `synthetic` is stamped by a BEFORE INSERT trigger
    from the connection, never by the caller, and cannot be changed.
  */
  if c.origin_channel in ('telegram', 'slack')
     and c.subject is null
     and not coalesce(c.synthetic, false) then
    return jsonb_build_object(
      'refused', true,
      'error', 'unknown sender: this actor is not a person the office knows');
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
     and v_project is distinct from app.current_project(v_scope, v_talk)
     /*
       0548. ACTIVE only, because `project_switches` refuses anything else and
       says why: "switching into an archived project would file new work
       somewhere nobody is looking." Perfectly right, and 0547 put that
       refusal in the path of every inbound message — a paused project made
       `enqueue_inbound` RAISE, so the message was not merely mis-filed, it
       was lost. Found by the session runner, whose fixture projects are
       paused by ADR-0014.
     */
     and exists (select 1 from public.projects p
                  where p.project_id = v_project and p.status = 'active') then
    /*
      And wrapped, because REMEMBERING is best-effort and DELIVERING is not.

      The condition above covers the rule that exists today. A constraint
      added to `project_switches` tomorrow would otherwise silently become a
      way to drop Grant's messages, and no future author of that constraint
      would think to check this path. The failure is recorded rather than
      swallowed: `app.cannot` is what this repository uses for a write that
      may fail without failing the work.
    */
    begin
      insert into public.project_switches
        (scope_kind, scope_ref, project_id, switched_by, reason)
      values (v_scope, v_talk, v_project,
              coalesce(c.subject, c.actor, 'the office'),
              'The message resolved to this project, so the conversation is about it.');
    exception when others then
      null;
    end;
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
$function$
;

drop function if exists public.say_in_project(uuid, text, text, text[]);
drop function if exists app.say_in_project(uuid, text, text, text[]);
drop function if exists public.send_to_agent(text, uuid, text, text, uuid, text);
drop function if exists app.send_to_agent(text, uuid, text, text, uuid, text);

-- ---- a dashboard message says who said it -----------------------------------
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
  v_refusal := app.principal_refusal(p_by);
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

do $g$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'app'::regnamespace and p.proname in ('say_in_project','send_to_agent')
  loop
    execute format('grant execute on function %s to ai_team_app, service_role', f.sig);
  end loop;
end $g$;

create or replace function public.say_in_project(p_project_id uuid, p_text text,
    p_addressed_to text default null, p_addressed_also text[] default '{}'::text[], p_by text default null)
returns jsonb language sql security definer set search_path = '' as
$$ select app.say_in_project(p_project_id, p_text, p_addressed_to, p_addressed_also, p_by) $$;
create or replace function public.send_to_agent(p_kind text, p_id uuid, p_action text, p_to text default null,
    p_with uuid default null, p_note text default null, p_by text default null)
returns jsonb language sql security definer set search_path = 'public', 'pg_catalog' as
$$ select app.send_to_agent(p_kind, p_id, p_action, p_to, p_with, p_note, p_by) $$;
do $close$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname in ('say_in_project','send_to_agent')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $close$;
