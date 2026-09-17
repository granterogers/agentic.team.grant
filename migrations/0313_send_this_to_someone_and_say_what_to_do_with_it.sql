begin;

/**
 * Send this to someone, and say what to do with it.
 *
 * Issue #27, under #25.
 *
 * ## What was there
 *
 * One button on every document, contact, task and module: *"talk to the team
 * about this"*, which opens the chat composer with the item attached as a
 * chip. That satisfies the request Grant made in conversation and does not
 * satisfy the specification, which names the actions:
 *
 *     Review · Summarize · Research · Critique · Extract tasks · Compare ·
 *     Custom instruction
 *
 * The difference is not cosmetic. A chip in a composer means Grant still types
 * the verb, every time, in whatever words occur to him — and the office parses
 * a sentence to work out what it was asked. A named action IS the instruction,
 * and #27 says so directly: *"Each action creates a typed job carrying the
 * asset id, not a rendered sentence."*
 *
 * ## Structured context, alongside the sentence rather than instead of it
 *
 * `inbound_commands` gains a `context jsonb`. The command still carries a
 * readable `instruction` — every handler and every model downstream reads that,
 * and a row whose instruction is empty is refused two lines into
 * `enqueue_inbound` — but the asset now travels as FACTS beside it. Nothing
 * has to recover a uuid by parsing English.
 *
 * §5 is intact: this writes to `inbound_commands` and asks the canonical layer,
 * exactly as Telegram, Slack and the voice call do. It is one more surface
 * translating, not a second way of making work.
 *
 * ## The project is the ASSET'S project
 *
 * `enqueue_inbound` picks *"the most recently updated active project"*, which
 * is right for a message arriving out of nowhere on Telegram and wrong for a
 * button on a document that plainly belongs somewhere. When the context names
 * a project, that one wins. This is a real defect fixed in passing: before it,
 * sending a Legacy Coaching document to Emma while the AI-learning project
 * happened to have been touched more recently filed the job against the wrong
 * project, and every reader that groups by project would have shown it in the
 * wrong place.
 *
 * ## The edge, which is what #27 is actually asking for
 *
 *   > *"preserve the relationship between the source document, agent job and
 *   > resulting output"*
 *
 * `document -input_to-> job` is written here. `job -produced-> document` is
 * already derived from `documents.produced_by_job` (0310). So the whole chain
 * — source, job, output — is traversable in both directions the moment the job
 * finishes, and only one half of it needed storing, because the other half is
 * a fact a column already holds.
 *
 * `input_to` and `output_of` have been in `relations.verb`'s CHECK constraint
 * since it was written and nothing had ever used either. The vocabulary
 * anticipated this exactly.
 */

alter table public.inbound_commands add column if not exists context jsonb;

comment on column public.inbound_commands.context is
  'Structured facts travelling with an instruction — which asset, which action '
  '(#27). The instruction stays readable for the handler and the model; this is '
  'so nothing has to recover a uuid by parsing English. Null for a message '
  'typed or spoken with no asset attached, which is most of them. 0313.';

-- ---------------------------------------------------------------------------
-- The canonical layer carries it, and files the job where the asset lives
-- ---------------------------------------------------------------------------

create or replace function app.enqueue_inbound(p_command_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  c record;
  v_project uuid;
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
            'origin_channel', c.origin_channel,
            'origin_ref', c.origin_ref,
            'command_id', p_command_id,
            'voice_file_id', c.voice_file_id,
            'voice_seconds', c.voice_seconds,
            -- The asset and the action, as facts (#27).
            'context', c.context
          ))
  returning job_id into v_job;

  update public.inbound_commands
     set job_id = v_job, processed_at = app.now_utc()
   where command_id = p_command_id;

  return jsonb_build_object('job_id', v_job, 'already', false, 'spoken', c.voice_file_id is not null);
end;
$$;

-- ---------------------------------------------------------------------------
-- The action itself
-- ---------------------------------------------------------------------------

/**
 * What each named action MEANS, in words the office already understands.
 *
 * A table rather than a CASE inside the function, because these are the seven
 * words on Grant's specification and somebody will want to add an eighth. As
 * data they are editable by the office (§ "reduce my dependence on Claude");
 * as a CASE they are a coding session.
 */
create table if not exists public.asset_actions (
  action    text primary key,
  label     text not null,
  /* `%s` is the asset's title. One placeholder, checked below. */
  says      text not null,
  /* Whether it needs a second asset — `compare` does and nothing else does. */
  needs_two boolean not null default false,
  position  int not null default 0
);

insert into public.asset_actions (action, label, says, needs_two, position) values
  ('review',        'Review',        'Review %s and tell me what you think.', false, 0),
  ('summarise',     'Summarise',     'Summarise %s.', false, 1),
  ('research',      'Research',      'Research the questions %s raises, and come back with what you find.', false, 2),
  ('critique',      'Critique',      'Critique %s — what is weak, what is missing, what would not survive scrutiny.', false, 3),
  ('extract_tasks', 'Extract tasks', 'Read %s and pull out the things that need doing, as tasks on this project.', false, 4),
  ('compare',       'Compare',       'Compare %s with the other one I have attached, and tell me how they differ.', true, 5)
on conflict (action) do update
  set label = excluded.label, says = excluded.says,
      needs_two = excluded.needs_two, position = excluded.position;

comment on table public.asset_actions is
  '#27. The named things an agent can be asked to do to an asset — Review, '
  'Summarise, Research, Critique, Extract tasks, Compare. Data rather than a '
  'CASE so an eighth is a row and not a coding session. "Custom instruction" '
  'is deliberately absent: it opens the composer instead, and has no fixed '
  'sentence. 0313.';

alter table public.asset_actions enable row level security;

/**
 * Send an asset to the team with a named action.
 *
 * Refuses rather than guesses, in three places, and each refusal is a sentence
 * the caller can show:
 *
 *   * an action nobody defined — so a typo becomes an error rather than a job
 *     whose instruction is the word "revuew";
 *   * `compare` with nothing to compare against;
 *   * an asset that does not exist, which otherwise files a job about nothing.
 */
create or replace function app.send_to_agent(
  p_kind text,
  p_id uuid,
  p_action text,
  p_to text default null,
  p_with uuid default null,
  p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a          record;
  v_title    text;
  v_project  uuid;
  v_command  uuid;
  v_said     text;
  v_queued   jsonb;
  v_key      text;
begin
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

  /*
    A readable sentence AND the structured facts.

    The sentence is what the handler and the model read — `enqueue_inbound`
    refuses a command with an empty instruction, and rightly. The context beside
    it is so nothing has to recover a uuid by parsing English (#27).
  */
  v_said := format(a.says, coalesce(nullif(v_title, ''), 'this'));
  if coalesce(btrim(p_note), '') <> '' then
    v_said := v_said || ' ' || btrim(p_note);
  end if;

  v_key := format('asset:%s:%s:%s:%s', p_kind, p_id, a.action,
                  to_char(app.now_utc(), 'YYYYMMDDHH24MISSMS'));

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, addressed_to, dedupe_key, context)
  values ('studio', v_key, 'grant', v_said,
          -- Shape-checked only. `speaker()` decides whether such a person
          -- exists and is active; a name it does not know falls back to the
          -- Chief of Staff, which is what every other channel does.
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

  /*
    source -input_to-> job (#27, #29).

    The other half — `job -produced-> document` — is DERIVED from
    `documents.produced_by_job` and needs no row (0310), so the chain becomes
    traversable in both directions the moment the job writes something.

    `input_to` has been in the verb vocabulary since it was written and nothing
    had ever used it. On conflict do nothing: pressing Review twice is two jobs
    and one edge per job, and the unique index is on the whole tuple.
  */
  insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, made_by)
  values (v_project, p_kind, p_id, 'input_to', 'job', (v_queued->>'job_id')::uuid, 'studio')
  on conflict do nothing;

  if p_with is not null then
    insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, made_by)
    values (v_project, p_kind, p_with, 'input_to', 'job', (v_queued->>'job_id')::uuid, 'studio')
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'ok', true, 'job', v_queued->>'job_id', 'action', a.label,
    'about', v_title, 'said', v_said);
end;
$$;

/** The actions, for a page that must not hard-code them. */
create or replace function app.asset_actions()
returns table (action text, label text, needs_two boolean)
language sql stable security definer set search_path = ''
as $$ select a.action, a.label, a.needs_two from public.asset_actions a order by a.position $$;

create or replace function public.send_to_agent(
  p_kind text, p_id uuid, p_action text, p_to text default null,
  p_with uuid default null, p_note text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.send_to_agent(p_kind, p_id, p_action, p_to, p_with, p_note) $$;

create or replace function public.asset_actions()
returns table (action text, label text, needs_two boolean)
language sql stable security definer set search_path = public, pg_catalog
as $$ select * from app.asset_actions() $$;

grant execute on function app.send_to_agent(text, uuid, text, text, uuid, text) to ai_team_app;
grant execute on function public.send_to_agent(text, uuid, text, text, uuid, text) to ai_team_app;
grant execute on function app.asset_actions() to ai_team_app;
grant execute on function public.asset_actions() to ai_team_app;

commit;
