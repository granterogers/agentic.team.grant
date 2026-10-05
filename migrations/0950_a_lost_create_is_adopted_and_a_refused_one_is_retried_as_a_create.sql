-- 0950: two defects in the task provider seam, found by driving the real round against a Vikunja-shaped server.
--
-- 1. app.task_push_failed leaves a placeholder link (external_id 'pending:<task>'), and app.tasks_to_push then offered
--    that string as the task's external id. The engine read "has an external id" as "update", so a task whose first
--    create was refused was updated at an id that never existed, for ever (http 400 each round), and deleting it made
--    the provider delete of 'pending:...' throw and stop every round after it. The sentinel is the database's
--    invention, so the database reads it: a placeholder is no external id.
-- 2. The pull ignored the office's mark. A create whose record was lost is adopted by the PUSH (alreadyMine), but when
--    the push does not reach it (the write is held, or the task is past the round's limit) the pull then imported the
--    remote copy as a second task here. task_pulled now takes the mark ('canonical_id') and adopts or reports it.
--
-- Both functions are spliced from their live definitions (0803 is the last to touch either) with one change each.
-- Rollback: roll the worker back FIRST (it sends canonical_id, which the old function ignores), then restore 0803's two
-- definitions.

CREATE OR REPLACE FUNCTION app.tasks_to_push(p_office uuid, p_provider text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
  with mine as (
    select t.*,
           -- 0950: a failed first create leaves a placeholder link (pending:<task>) so the failure has somewhere to
           -- live. It is not a task at the provider, and offering it as one made every retry an UPDATE of an id that
           -- never existed.
           case when l.external_id like 'pending:%' then null else l.external_id end as external_id,
           l.external_project_id, l.synced_revision
      from public.tasks t
      left join public.task_links l
        on l.task_id = t.task_id and l.provider = p_provider
     where t.office_id = p_office
       and t.assigned_to_human
       -- 0597: a harness task never leaves the office (see app.reminders_due).
       and not app.harness_task(t.is_fixture, t.job_id)
       -- Never pushed, or moved since it was.
       and (l.task_id is null or t.revision > coalesce(l.synced_revision, 0))
     order by t.updated_at
     limit greatest(coalesce(p_limit, 200), 1)
  )
  select jsonb_build_object(
    'provider', p_provider,
    'upserts', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.task_id, 'revision', m.revision,
        'title', m.title, 'detail', m.detail,
        'state', m.state, 'done', m.state = 'done',
        'priority', m.priority, 'due_on', m.due_on, 'starts_on', m.starts_on,
        'remind_at', m.remind_at, 'labels', to_jsonb(m.labels),
        'parent', m.parent_task_id,
        'project', (select p.slug from public.projects p where p.project_id = m.project_id and p.office_id = p_office),
        'external_id', m.external_id,
        'external_project_id', m.external_project_id) order by m.updated_at), '[]'::jsonb)
      from mine m),
    /*
      Deletions travel in the same answer as the upserts, because a provider
      that learns about them separately will eventually apply them in the
      wrong order and resurrect a task Grant deleted.
    */
    'deletes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.task_id, 'title', d.title,
        -- 0950: a placeholder names nothing at the provider, so it is not offered as something to remove there.
        'links', coalesce((select jsonb_agg(e) from jsonb_array_elements(d.links) e
                            where coalesce(e ->> 'external_id', '') not like 'pending:%'), '[]'::jsonb))), '[]'::jsonb)
      from public.task_tombstones d
     where d.office_id = p_office
       and d.cleared_at is null
       and d.links @> jsonb_build_array(jsonb_build_object('provider', p_provider)))
  )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app.task_pulled(p_office uuid, p_provider text, p_external_id text, p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_provider text := btrim(coalesce(p_provider, ''));
  v_ext      text := btrim(coalesce(p_external_id, ''));
  v_link     public.task_links%rowtype;
  v_task     public.tasks%rowtype;
  v_title    text := nullif(btrim(coalesce(p_fields ->> 'title', '')), '');
  v_rev      text := nullif(btrim(coalesce(p_fields ->> 'external_revision', '')), '');
  v_id       uuid;
  v_conflict boolean := false;
  v_changed  text[] := '{}';
  v_have     boolean;
  v_mark     uuid := case when coalesce(p_fields ->> 'canonical_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          then (p_fields ->> 'canonical_id')::uuid end;
begin
  perform app.require_office(p_office);
  if v_provider = '' or v_ext = '' then
    return jsonb_build_object('error', 'a pulled task needs a provider and an external id');
  end if;

  /*
    THE TOMBSTONE IS CHECKED FIRST, and against the EXTERNAL id.

    A task Grant deleted here can still be sitting in the provider, and the
    provider will offer it back on every pull for ever. Checking the canonical
    id would not help: by the time a pull arrives the link may already be gone.
  */
  if exists (
    select 1 from public.task_tombstones d
     where d.office_id = p_office
       and d.cleared_at is null
       and d.links @> jsonb_build_array(
             jsonb_build_object('provider', v_provider, 'external_id', v_ext))
  ) then
    return jsonb_build_object(
      'ok', false, 'deleted', true,
      'note', 'that task was deleted here - remove it at the provider rather than recreating it');
  end if;

  select l.* into v_link from public.task_links l
    join public.tasks lt on lt.task_id = l.task_id and lt.office_id = p_office
   where l.provider = v_provider and l.external_id = v_ext;
  -- FOUND is reset by the statements below; keep the answer to this lookup.
  v_have := found;

  /*
    0950: THE OFFICE'S OWN MARK. A task the office wrote carries its canonical id in the provider's copy. When the
    record of that create was lost (a crash between the remote create and app.task_pushed), the remote task is known
    to the office by its mark and by nothing else, so the pull must not read it as somebody else's new task:

      - the canonical task is still here and has no link for this provider: it IS that task, so link it and let the
        copy here stand (the push that follows brings the provider into line);
      - the canonical task is gone (he deleted it before the link was ever recorded, so no tombstone was written):
        tell the engine it is a deleted task, which sends the remote delete through the same approval a deletion
        always needs;
      - anything else (the task already has a link, which is what a copy made inside the provider looks like, or the
        mark is not a uuid): it is a new task, as before.
  */
  if not v_have and v_mark is not null then
    if exists (select 1 from public.tasks where task_id = v_mark and office_id = p_office) then
      if not exists (select 1 from public.task_links where task_id = v_mark and provider = v_provider) then
        begin
          insert into public.task_links
            (task_id, provider, external_id, external_project_id, external_revision,
             synced_revision, pulled_at, sync_state)
          values (v_mark, v_provider, v_ext, nullif(p_fields ->> 'external_project_id', ''), v_rev,
                  null, app.now_utc(), 'pending');
          return jsonb_build_object('ok', true, 'adopted', true, 'id', v_mark);
        exception when unique_violation then
          null; -- another task holds that external id: fall through to the ordinary path
        end;
      end if;
    else
      return jsonb_build_object(
        'ok', false, 'deleted', true,
        'note', 'the task this was made from no longer exists here - remove it at the provider rather than recreating it');
    end if;
  end if;

  -- ------------------------------------------------------------------ new --
  if not v_have then
    if v_title is null then
      return jsonb_build_object('error', 'a new task needs a title');
    end if;
    v_id := (app.my_task_add(
      p_office  => p_office,
      p_title   => left(v_title, 500),
      p_detail  => coalesce(p_fields ->> 'detail', ''),
      p_due_on  => nullif(p_fields ->> 'due_on', '')::date,
      p_priority => nullif(p_fields ->> 'priority', '')::int
    ) ->> 'id')::uuid;
    if v_id is null then
      return jsonb_build_object('error', 'the task could not be created here');
    end if;
    if coalesce((p_fields ->> 'done')::boolean, false) then
      update public.tasks set state = 'done', done_at = app.now_utc() where task_id = v_id and office_id = p_office;
    end if;
    select * into v_task from public.tasks where task_id = v_id and office_id = p_office;
    insert into public.task_links
      (task_id, provider, external_id, external_project_id, external_revision,
       synced_revision, pulled_at, sync_state)
    values (v_id, v_provider, v_ext, nullif(p_fields ->> 'external_project_id', ''),
            v_rev, v_task.revision, app.now_utc(), 'ok');
    return jsonb_build_object('ok', true, 'created', true, 'id', v_id,
                              'title', v_task.title, 'revision', v_task.revision);
  end if;

  -- ------------------------------------------------------------- existing --
  select * into v_task from public.tasks where task_id = v_link.task_id and office_id = p_office;
  if not found then
    -- The link outlived its task. Nothing to update and nothing to resurrect.
    delete from public.task_links where task_id = v_link.task_id and provider = v_provider;
    return jsonb_build_object('ok', false, 'deleted', true,
      'note', 'that task no longer exists here');
  end if;

  /*
    BOTH SIDES MOVED. Canonical is kept and the disagreement is recorded.

    `synced_revision` is the canonical revision as of the last successful
    sync in EITHER direction, so "greater than" means somebody changed the
    task here since the provider was last in step with it.
  */
  if v_task.revision > coalesce(v_link.synced_revision, 0) then
    v_conflict := true;
  end if;

  if not v_conflict then
    /*
      `is distinct from` on every column, so applying the same payload twice
      does not move `revision` — the trigger fires on any UPDATE, including
      one that changes nothing.
    */
    if v_title is not null and v_title is distinct from v_task.title then
      update public.tasks set title = left(v_title, 500) where task_id = v_task.task_id and office_id = p_office;
      v_changed := v_changed || array['title'];
    end if;
    if (p_fields ? 'detail')
       and coalesce(p_fields ->> 'detail', '') is distinct from coalesce(v_task.detail, '') then
      update public.tasks set detail = coalesce(p_fields ->> 'detail', '')
       where task_id = v_task.task_id and office_id = p_office;
      v_changed := v_changed || array['detail'];
    end if;
    if (p_fields ? 'due_on')
       and nullif(p_fields ->> 'due_on', '')::date is distinct from v_task.due_on then
      update public.tasks set due_on = nullif(p_fields ->> 'due_on', '')::date
       where task_id = v_task.task_id and office_id = p_office;
      v_changed := v_changed || array['due_on'];
    end if;
    if (p_fields ? 'priority')
       and nullif(p_fields ->> 'priority', '')::int is not null
       and nullif(p_fields ->> 'priority', '')::int is distinct from v_task.priority then
      update public.tasks set priority = nullif(p_fields ->> 'priority', '')::int
       where task_id = v_task.task_id and office_id = p_office;
      v_changed := v_changed || array['priority'];
    end if;
    if (p_fields ? 'done') then
      if coalesce((p_fields ->> 'done')::boolean, false) and v_task.state <> 'done' then
        update public.tasks set state = 'done', done_at = app.now_utc()
         where task_id = v_task.task_id and office_id = p_office;
        v_changed := v_changed || array['done'];
      elsif not coalesce((p_fields ->> 'done')::boolean, false) and v_task.state = 'done' then
        update public.tasks set state = 'todo', done_at = null
         where task_id = v_task.task_id and office_id = p_office;
        v_changed := v_changed || array['reopened'];
      end if;
    end if;
  end if;

  select * into v_task from public.tasks where task_id = v_link.task_id and office_id = p_office;
  update public.task_links
     set external_revision = coalesce(v_rev, external_revision),
         external_project_id = coalesce(nullif(p_fields ->> 'external_project_id', ''),
                                        external_project_id),
         pulled_at = app.now_utc(),
         /*
           A conflict does NOT advance the watermark. The canonical value is
           still ahead of the provider, so it must still be offered for push —
           which is what resolves the conflict on the next round, in the
           direction the invariant requires.
         */
         synced_revision = case when v_conflict then synced_revision else v_task.revision end,
         sync_state = case when v_conflict then 'conflict' else 'ok' end,
         sync_error = case when v_conflict
                           then 'both sides changed this since the last sync - the copy here was kept'
                           else null end,
         updated_at = app.now_utc()
   where task_id = v_link.task_id and provider = v_provider;

  return jsonb_build_object('ok', true, 'id', v_task.task_id, 'title', v_task.title,
                            'conflict', v_conflict, 'changed', to_jsonb(v_changed),
                            'revision', v_task.revision);
end;
$function$;
