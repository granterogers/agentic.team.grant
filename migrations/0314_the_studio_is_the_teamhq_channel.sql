begin;

/**
 * The studio is the `teamhq` channel, not a new one.
 *
 * 0313's `send_to_agent` wrote `origin_channel = 'studio'` and was refused by
 * `inbound_origin_channel_known`, which lists slack, telegram, voice and
 * **teamhq**. `teamhq` is the web dashboard's channel and has been since before
 * the studio replaced it: `DeliveryChannel`, `CHANNELS`, the callback router
 * and the preference store all name it, and there is a row on it already.
 *
 * Adding `studio` would have made two words for one surface — which is exactly
 * what 0311 was spent undoing three migrations ago, in the verb vocabulary
 * rather than the channel one. ADR-0019 changed which FILES serve the web
 * dashboard; it did not make the web dashboard a different channel.
 *
 * So this is a one-word change, and the note is longer than the diff because
 * the temptation was to widen the constraint instead.
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

  v_said := format(a.says, coalesce(nullif(v_title, ''), 'this'));
  if coalesce(btrim(p_note), '') <> '' then
    v_said := v_said || ' ' || btrim(p_note);
  end if;

  v_key := format('asset:%s:%s:%s:%s', p_kind, p_id, a.action,
                  to_char(app.now_utc(), 'YYYYMMDDHH24MISSMS'));

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, addressed_to, dedupe_key, context)
  values ('teamhq', v_key, 'grant', v_said,
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
$$;

commit;
