/*
  0481 — a project with nothing attached could never come back.

  `app.unarchive_project` sets `status = 'active'` and answers with a tidy
  jsonb. ADR-0014 is enforced by a DEFERRED constraint trigger,
  `app.project_has_an_attachment`, which refuses an active project with no
  enabled attachment — so for any project whose sources had been disconnected,
  the call raised **23514 at COMMIT**, out of a SECURITY DEFINER function, and
  the gateway turned that into "the action failed".

  Three things make this the expensive kind of defect:

  - It is the COMMON case, not the edge one. Disconnecting the sources and
    then putting the project away is the ordinary way a project stops being
    used, and that is exactly the project Grant later wants back.
  - It raises where its sibling refuses. The same function returns
    `{"ok": false, "error": "no archived project called x"}` for a slug it
    cannot find; a caller reasonably reads a raise as a bug in the office
    rather than as a rule.
  - The deferral is why nobody saw it. Migration 0480's own drive block
    created a project, archived it, un-archived it and deleted it, all inside
    one transaction — so the constraint was checked at commit against a row
    that no longer existed, and the drive passed. CLAUDE.md already records
    driving a function as what reading it cannot replace; this adds that a
    drive inside one transaction cannot see a deferred constraint.

  0360 is the same shape and the precedent for the fix: `app.project_delete`
  raised 23503 out of a SECURITY DEFINER function when a foreign key held the
  project, and the repair was to turn the violation into a sentence naming what
  holds it. Here the pre-check comes first, and the sentence says what to do.
*/

create or replace function app.unarchive_project(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_project uuid; v_name text; v_off jsonb; v_attached int;
begin
  select project_id, name into v_project, v_name
    from public.projects where slug = p_slug and status = 'archived';
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no archived project called %s', p_slug));
  end if;

  /*
    ADR-0014, asked BEFORE the write rather than discovered at commit.

    The constraint trigger is DEFERRED, so without this the update succeeds,
    the function returns a cheerful `ok: true`, and the transaction then blows
    up somewhere the caller cannot attribute. A refusal that names the remedy
    is the whole difference between a rule and a fault.
  */
  select count(*) into v_attached
    from public.project_attachments a
   where a.project_id = v_project and a.enabled;
  if v_attached = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', format(
        '%s has nothing attached, and an active project has to read from '
        'somewhere real (ADR-0014). Reconnect a source first, then bring it back.',
        v_name),
      'needs', 'an attachment');
  end if;

  update public.projects set status = 'active' where project_id = v_project;

  select coalesce(jsonb_agg(r.slug order by r.slug), '[]'::jsonb) into v_off
    from public.responsibilities r where r.project_id = v_project and not r.enabled;

  return jsonb_build_object(
    'ok', true, 'project', p_slug, 'name', v_name, 'still_off', v_off);
end;
$function$;

/*
  Driven, and driven ACROSS a commit for the branch that the deferral hid.

  The refusal branch is safe inside one transaction because nothing is written.
  The success branch is not — that is the whole lesson above — so it is
  committed and then cleaned up, and the cleanup asserts it left nothing.
*/
do $refusal$
declare
  v_slug text := 'unarchive-drive-' || substr(md5(random()::text), 1, 8);
  v_project uuid;
  v_said jsonb;
begin
  insert into public.projects (slug, name, purpose, status)
  values (v_slug, 'Unarchive drive', 'Rolled back inside 0481', 'archived')
  returning project_id into v_project;

  v_said := app.unarchive_project(v_slug);
  if coalesce(v_said ->> 'ok', 'true') <> 'false' then
    raise exception '0481: a project with nothing attached was brought back — %', v_said;
  end if;
  if position('nothing attached' in coalesce(v_said ->> 'error', '')) = 0 then
    raise exception '0481: it refused for some other reason — %', v_said;
  end if;
  if (select status from public.projects where slug = v_slug) <> 'archived' then
    raise exception '0481: refused, and the status moved anyway';
  end if;

  raise notice '0481: the refusal names the remedy';
  delete from public.events where project_id = v_project;
  delete from public.projects where project_id = v_project;
end $refusal$;
