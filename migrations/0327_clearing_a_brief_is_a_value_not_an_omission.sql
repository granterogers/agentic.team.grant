begin;

/**
 * Clearing a brief is a value, not an omission.
 *
 * Issue #36. `hq-api` treats a required argument as missing when it is the
 * empty string:
 *
 *     args[k] === undefined || args[k] === null || String(args[k]).trim() === ''
 *
 * which is right for every other action it guards — an empty project slug or
 * an empty document id is a bug in the caller, and 400 is the correct answer.
 * It is wrong for exactly one argument in the whole map, because clearing a
 * per-project brief IS sending an empty one, and the page could not do it:
 * `{"error":"missing: p_instruction"}`.
 *
 * Widening the shared guard to make an exception was the other option and is
 * worse. It would loosen a check that protects a dozen actions in order to
 * serve one, and the next person to read it would have to know which of the
 * dozen the exception was for.
 *
 * So the argument gets a default instead, and the API stops requiring it. "No
 * brief was sent" and "clear the brief" then mean the same thing, which is
 * the only reading under which both are true.
 *
 * `create or replace` is not enough on its own here: the argument list is
 * unchanged, so it does replace rather than overload — but CLAUDE.md's rule is
 * about a CHANGED list, and this changes only a default, which Postgres treats
 * as part of the same signature. Both the app function and the public wrapper
 * are restated, because the wrapper is the half that silently drops a
 * parameter.
 */

create or replace function app.set_project_instruction(
  p_slug text, p_staff_slug text, p_instruction text default '', p_by text default 'grant')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_staff   uuid;
  v_text    text := btrim(coalesce(p_instruction, ''));
begin
  select project_id into v_project
    from public.projects where slug = p_slug and status <> 'archived';
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no active project called %s', p_slug));
  end if;

  select staff_id into v_staff from public.staff where slug = p_staff_slug and active;
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', format('nobody here is called %s', p_staff_slug));
  end if;

  -- A brief long enough to be a brief. Two words is a note to self, and it
  -- would be pasted into a prompt where it can only confuse. Empty is not
  -- short — it is the clear.
  if v_text <> '' and length(v_text) < 12 then
    return jsonb_build_object(
      'ok', false,
      'error', 'A brief needs to be a sentence — that is going into what they are told.');
  end if;

  insert into public.project_staff (project_id, staff_id, instruction, decided_by)
  values (v_project, v_staff, v_text, p_by)
  on conflict (project_id, staff_id)
  do update set instruction = excluded.instruction,
                decided_by = excluded.decided_by,
                decided_at = app.now_utc();

  return jsonb_build_object('ok', true, 'staff', p_staff_slug,
                            'cleared', v_text = '', 'instruction', v_text);
end;
$$;

create or replace function public.set_project_instruction(
  p_slug text, p_staff_slug text, p_instruction text default '', p_by text default 'grant')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.set_project_instruction(p_slug, p_staff_slug, p_instruction, p_by) $$;

grant execute on function app.set_project_instruction(text, text, text, text) to ai_team_app;
grant execute on function public.set_project_instruction(text, text, text, text) to ai_team_app;

commit;
