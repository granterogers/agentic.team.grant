-- A replayed Team HQ message is ONE logical command (acceptance journey L).
--
-- Delivering the identical Telegram update or Slack event gives one command, one job and one reply, because the
-- adapter's dedupe key is made of what the PROVIDER numbers (update id, event id). The Team HQ composer had no such
-- number: `app.say_in_project` composed its key from a fresh uuid on every call, so a page that re-sent a message after
-- a timeout filed two commands and two jobs, and only the task writer hid the second.
--
-- The page now names each message once, at send time (`p_message_id`), and reuses that name for any replay of the same
-- message. The key is derived from the name TOGETHER WITH the office, the speaker and the project, so another person's
-- identical id can never dedupe against yours, and the same id in another project is another message. The shape stays
-- exactly `teamhq:message:<32 hex>`, the only shape the dashboard door produces (app.adapter_key_ok), so containment
-- reads it as before. An absent or malformed id changes nothing: the old per-call key, so older pages keep working.
-- A person sending the same words twice is two messages with two ids, not a replay.
--
-- The arity changes, so the old overloads are dropped by exact signature first (create or replace would leave a second
-- overload and make a six-argument call ambiguous). The new argument has a default, so every existing call still binds.
-- Spliced from the live definition; only the key, the insert and the result differ.

drop function if exists public.say_in_project(uuid, uuid, text, text, text[], text);
drop function if exists app.say_in_project(uuid, uuid, text, text, text[], text);

create function app.say_in_project(
  p_office uuid,
  p_project_id uuid,
  p_text text,
  p_addressed_to text default null::text,
  p_addressed_also text[] default '{}'::text[],
  p_by text default null::text,
  p_message_id text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
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
  v_already  boolean := false;
begin
  perform app.require_office(p_office);
  -- The project first, inside the office: a project of another office and one that does not exist answer
  -- alike, whoever is asking.
  if p_project_id is null
     or not exists (select 1 from public.projects where project_id = p_project_id and office_id = p_office) then
    return jsonb_build_object('ok', false, 'error', 'no such project');
  end if;

  p_by := coalesce(nullif(btrim(p_by), ''), app.office_actor(p_office));
  -- 0618: who may say something WHERE: a test principal speaks only in a fixture project.
  v_refusal := app.authority_refusal(p_by, null, p_project_id);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal);
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

  if p_message_id is not null and p_message_id ~ '^[A-Za-z0-9_-]{8,64}$' then
    -- Named by the page: the same message again is the same key. Scoped to office, speaker and project.
    v_key := 'teamhq:message:' || md5(
      p_office::text || '|' || btrim(p_by) || '|' || p_project_id::text || '|' || p_message_id);
  else
    v_key := 'teamhq:message:' || replace(gen_random_uuid()::text, '-', '');
  end if;

  insert into public.inbound_commands
    (office_id, origin_channel, origin_ref, actor, instruction, addressed_to, addressed_also,
     dedupe_key, project_id, context)
  values (p_office, 'teamhq', v_key, btrim(p_by), v_said, v_to, v_also, v_key, p_project_id,
          jsonb_build_object('project_id', p_project_id))
  on conflict (dedupe_key) do nothing
  returning command_id into v_command;

  if v_command is null then
    -- A replay: the command that key already names, in this office. Never another office's (the key carries it).
    select c.command_id into v_command
      from public.inbound_commands c
     where c.dedupe_key = v_key and c.office_id = p_office;
    v_already := true;
    if v_command is null then
      return jsonb_build_object('ok', false, 'error', 'could not record what you said');
    end if;
  end if;

  -- Idempotent: a command already turned into work answers with its job.
  v_queued := app.enqueue_inbound(v_command);

  return jsonb_build_object(
    'ok', true,
    'command', v_command,
    'job', v_queued->>'job_id',
    'project', p_project_id,
    'addressed_to', v_to,
    'addressed_also', to_jsonb(v_also),
    -- Named rather than silent, and all of them rather than the first.
    'addressee_dropped', to_jsonb(v_dropped),
    'replayed', v_already);
end;
$function$;

create function public.say_in_project(
  p_office uuid,
  p_project_id uuid,
  p_text text,
  p_addressed_to text default null::text,
  p_addressed_also text[] default '{}'::text[],
  p_by text default null::text,
  p_message_id text default null::text
)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$ select app.say_in_project(p_office, p_project_id, p_text, p_addressed_to, p_addressed_also, p_by, p_message_id) $function$;

revoke all on function app.say_in_project(uuid, uuid, text, text, text[], text, text) from public, anon, authenticated;
revoke all on function public.say_in_project(uuid, uuid, text, text, text[], text, text) from public, anon, authenticated;
grant execute on function public.say_in_project(uuid, uuid, text, text, text[], text, text) to service_role;
