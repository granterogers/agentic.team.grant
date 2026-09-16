/*
  0411 - say_in_project takes a selection, and enqueue_inbound carries it (#26).

  0410 gave `inbound_commands` a place for "who else was asked". These are the
  two doors it has to arrive through: the composer's RPC, and the function
  that turns a command into a job.

  `create or replace` cannot change an argument list - it creates a second
  overload and every call becomes ambiguous - so the old three-argument form
  is dropped by exact signature first. CLAUDE.md records this twice, and the
  public wrapper is the half that silently keeps the old arity, so it is
  dropped and rebuilt too.

  The new argument is LAST and defaults to empty, so every existing caller
  keeps working unchanged: the Telegram and Slack adapters do not address
  anybody, and the studio composer only sends it when Grant has picked.
*/

drop function if exists app.say_in_project(uuid, text, text);
drop function if exists public.say_in_project(uuid, text, text);

create or replace function app.say_in_project(
  p_project_id uuid,
  p_text text,
  p_addressed_to text default null,
  p_addressed_also text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
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
begin
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
  values ('teamhq', v_key, 'grant', v_said, v_to, v_also, v_key, p_project_id,
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
$function$;

create or replace function public.say_in_project(
  p_project_id uuid,
  p_text text,
  p_addressed_to text default null,
  p_addressed_also text[] default '{}'
)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select app.say_in_project(p_project_id, p_text, p_addressed_to, p_addressed_also) $$;

revoke all on function public.say_in_project(uuid, text, text, text[]) from public, anon;

/*
  And onto the job, so the handler can read it.

  Patched from the live definition rather than transcribed: enqueue_inbound is
  long, holds the project resolution and the dedupe, and retyping it to add
  one key is how a function loses something nobody notices. The anchor is
  asserted first - a replace that matched nothing would leave the function
  correct and the selection unreachable, which reads exactly like the feature
  working for one person and not for two.
*/
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'enqueue_inbound';

  if v_def is null or position('''addressed_to'', c.addressed_to,' in v_def) = 0 then
    raise exception 'enqueue_inbound does not carry addressed_to where this patch expects';
  end if;

  execute replace(
    v_def,
    '''addressed_to'', c.addressed_to,',
    '''addressed_to'', c.addressed_to,
            ''addressed_also'', to_jsonb(coalesce(c.addressed_also, ''{}''::text[])),'
  ) || ';';
end $$;
