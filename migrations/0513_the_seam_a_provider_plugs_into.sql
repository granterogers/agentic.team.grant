/*
  0513 — the seam a task provider plugs into (#259).

  #259 asks for Vikunja behind a provider abstraction and for Supabase to stay
  canonical. The audit found none of the machinery that makes that possible:
  no external identity, no revision, no tombstone, no sync status. Without
  them, adding Vikunja later is a task-domain rewrite rather than an
  integration — which is the thing the Issue explicitly asks us to avoid.

  This is the DATA seam, and deliberately only that. There is no TypeScript
  `PersonalTaskProvider` interface here, because an interface with no
  implementor is the defect `check:callers` exists to catch and CLAUDE.md
  records under its own heading: a capability nothing calls. The seam is
  proved provider-neutral by `verify:mytasks` driving it as a FAKE provider —
  a second implementation that costs nothing and ships nothing.

  ## What is added

  | | |
  |---|---|
  | `tasks.revision` | the canonical version, bumped on every update by `app.touch_task`. This is the conflict primitive: it says whether the local row has moved since a provider last saw it. |
  | `public.task_links` | one row per (task, provider): the external id, the external project, the revision we last pushed, when, and what went wrong. **Sync status lives here and never on the task**, so the canonical model stays clean — #259's fourth invariant. |
  | `public.task_tombstones` | what a deleted task WAS, written only when something external knew about it. |
  | `app.my_task_delete` | the door #259 and the brief both ask for and which did not exist: a personal task could only be ticked or cancelled, never removed. |

  ## Deleted means deleted, and the tombstone is why that is safe

  A soft-delete column would have been the obvious choice and is the wrong one
  here: twenty-three functions read `public.tasks`, and every one that shows
  Grant a list would have to learn to exclude it. Missing one is the defect
  this repository keeps paying for — a reader that forgets a filter shows him
  something that is gone. A hard delete is correct by construction in all
  twenty-three.

  What a hard delete loses is the thing a provider needs: the knowledge that
  an external task should now be removed. So `task_links` cascades away with
  the row, and a trigger copies the external ids into a tombstone FIRST —
  **and only when there were links**. A personal task nobody outside ever saw
  leaves no tombstone, because there is nobody to tell, which keeps the table
  purposeful and free of harness noise by construction rather than by a filter.

  Deleting a parent takes its subtasks: `tasks_parent_task_id_fkey` is ON
  DELETE CASCADE and that is the right semantic, so `my_task_delete` COUNTS
  them and says so rather than letting them vanish silently.

  ## The conflict policy, stated once

  **Canonical wins.** `task_links.synced_revision` records the `tasks.revision`
  that was last pushed; if `tasks.revision` is higher, the local row has moved
  since the provider saw it. When an inbound change arrives against a moved
  row, the canonical value is kept and the provider's value is recorded in
  `sync_error` so it is visible rather than silently discarded — #259 asks for
  a deterministic strategy, and "the database of record wins, and says what it
  overrode" is the only one that cannot lose Grant's own edit.
*/

-- ---------------------------------------------------------------------------
-- The canonical version
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists revision integer not null default 1;

comment on column public.tasks.revision is
  'The canonical version, bumped on every update by app.touch_task. A provider '
  'stores the revision it last saw in task_links.synced_revision; a higher '
  'number here means the local row has moved since (0513).';

create or replace function app.touch_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.updated_at := now();
  -- Keep done_at honest without making every caller remember it.
  if new.state = 'done' and old.state <> 'done' then new.done_at := now(); end if;
  if new.state <> 'done' then new.done_at := null; end if;
  /*
    0513. The version a provider compares against.

    Bumped here rather than by each writer, for the reason every other trigger
    on this table exists: there are five doors onto `public.tasks` and a
    version maintained by four of them is a version that lies.
  */
  new.revision := coalesce(old.revision, 0) + 1;
  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- Who else knows about this task
-- ---------------------------------------------------------------------------

create table if not exists public.task_links (
  task_id             uuid not null references public.tasks(task_id) on delete cascade,
  provider            text not null,
  external_id         text not null,
  external_project_id text,
  external_revision   text,
  synced_revision     integer,
  pushed_at           timestamptz,
  pulled_at           timestamptz,
  sync_state          text not null default 'pending',
  sync_error          text,
  created_at          timestamptz not null default app.now_utc(),
  updated_at          timestamptz not null default app.now_utc(),
  primary key (task_id, provider),
  constraint task_links_state_known
    check (sync_state in ('pending', 'ok', 'error', 'conflict')),
  constraint task_links_error_says_why
    check (sync_state not in ('error', 'conflict') or coalesce(sync_error, '') <> ''),
  constraint task_links_external_id_real
    check (length(btrim(external_id)) > 0)
);

/*
  One external task is one canonical task. Without this an inbound reconcile
  that matched loosely could attach a second canonical row to the same remote
  id, which is #259's "uncontrolled duplicate tasks" arriving through the back
  door.
*/
create unique index if not exists task_links_one_per_external
  on public.task_links (provider, external_id);

create index if not exists task_links_needing_attention
  on public.task_links (provider, sync_state) where sync_state <> 'ok';

comment on table public.task_links is
  'Canonical task to external provider identity (#259). Sync status lives '
  'here and never on public.tasks, so the canonical model stays independent '
  'of whatever a provider needs to remember.';
comment on column public.task_links.synced_revision is
  'The tasks.revision that was last successfully pushed. tasks.revision above '
  'this means the local row has moved since the provider saw it.';

-- ---------------------------------------------------------------------------
-- What a deleted task WAS, when somebody outside knew about it
-- ---------------------------------------------------------------------------

create table if not exists public.task_tombstones (
  task_id     uuid primary key,
  title       text not null,
  deleted_at  timestamptz not null default app.now_utc(),
  deleted_by  text not null default 'grant',
  links       jsonb not null default '[]'::jsonb,
  cleared_at  timestamptz
);

comment on table public.task_tombstones is
  'A personal task that was deleted while an external provider knew about it '
  '(#259). Written by trigger, only when task_links had rows — a task nobody '
  'outside ever saw leaves nothing here, because there is nobody to tell.';
comment on column public.task_tombstones.cleared_at is
  'When every provider named in `links` had the deletion applied. Null means '
  'the removal is still owed to somebody.';

create or replace function app.task_leaves_a_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_links jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', l.provider,
           'external_id', l.external_id,
           'external_project_id', l.external_project_id)), '[]'::jsonb)
    into v_links
    from public.task_links l
   where l.task_id = old.task_id;

  /*
    Nothing outside knew about it, so there is nothing to tell and no row to
    keep. This is what stops the table filling with every fixture task a
    verification run ever made — by construction rather than by a filter,
    which is the difference between a rule and a hope.
  */
  if v_links = '[]'::jsonb then
    return old;
  end if;

  insert into public.task_tombstones (task_id, title, links, deleted_by)
  values (old.task_id, old.title, v_links, coalesce(old.added_by, 'grant'))
  on conflict (task_id) do nothing;
  return old;
end $function$;

drop trigger if exists tasks_leave_a_tombstone on public.tasks;
create trigger tasks_leave_a_tombstone
  before delete on public.tasks
  for each row execute function app.task_leaves_a_tombstone();

-- ---------------------------------------------------------------------------
-- Deleting one, which was not possible
-- ---------------------------------------------------------------------------

create or replace function app.my_task_delete(p_task_id text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = 'public', 'pg_catalog'
as $fn$
declare
  v_id       uuid;
  v_title    text;
  v_children int;
begin
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'that is not a task id');
  end;

  select t.title into v_title
    from public.tasks t
   where t.task_id = v_id and t.assigned_to_human;
  if v_title is null then
    /*
      Named rather than silent, and scoped to MINE. The office's own project
      tasks are not Grant's to delete from this door — #259's second invariant
      is that the two are separate, and a delete that reached across it would
      be the one place the separation stopped mattering.
    */
    return jsonb_build_object('ok', false,
      'error', 'no personal task by that id — the team''s own work is not deleted from here');
  end if;

  select count(*)::int into v_children
    from public.tasks c where c.parent_task_id = v_id;

  delete from public.tasks where task_id = v_id;

  return jsonb_build_object(
    'ok', true, 'deleted', v_title,
    -- Said out loud, because the foreign key takes them and a subtask that
    -- disappears without being mentioned is data loss that looks like a bug.
    'children_deleted', v_children,
    'reason', p_reason);
end
$fn$;

create or replace function public.my_task_delete(p_task_id text, p_reason text default null)
returns jsonb
language sql volatile security definer
set search_path = 'public', 'pg_catalog'
as $fn$ select app.my_task_delete(p_task_id, p_reason) $fn$;

grant execute on function app.my_task_delete(text, text) to ai_team_app, service_role;
grant execute on function public.my_task_delete(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- What a provider would ask for, and tell us
-- ---------------------------------------------------------------------------

create or replace function app.tasks_to_push(p_provider text, p_limit integer default 200)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  with mine as (
    select t.*, l.external_id, l.external_project_id, l.synced_revision
      from public.tasks t
      left join public.task_links l
        on l.task_id = t.task_id and l.provider = p_provider
     where t.assigned_to_human
       and not coalesce(t.is_fixture, false)
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
        'project', (select p.slug from public.projects p where p.project_id = m.project_id),
        'external_id', m.external_id,
        'external_project_id', m.external_project_id) order by m.updated_at), '[]'::jsonb)
      from mine m),
    /*
      Deletions travel in the same answer as the upserts, because a provider
      that learns about them separately will eventually apply them in the
      wrong order and resurrect a task Grant deleted.
    */
    'deletes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.task_id, 'title', d.title, 'links', d.links)), '[]'::jsonb)
      from public.task_tombstones d
     where d.cleared_at is null
       and d.links @> jsonb_build_array(jsonb_build_object('provider', p_provider)))
  )
$fn$;

create or replace function app.task_pushed(
  p_task_id uuid,
  p_provider text,
  p_external_id text,
  p_revision integer,
  p_external_project_id text default null,
  p_external_revision text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = 'public', 'pg_catalog'
as $fn$
begin
  insert into public.task_links
    (task_id, provider, external_id, external_project_id, external_revision,
     synced_revision, pushed_at, sync_state, sync_error, updated_at)
  values (p_task_id, p_provider, p_external_id, p_external_project_id, p_external_revision,
          p_revision, app.now_utc(), 'ok', null, app.now_utc())
  on conflict (task_id, provider) do update
     set external_id = excluded.external_id,
         external_project_id = excluded.external_project_id,
         external_revision = excluded.external_revision,
         /*
           GREATEST, not the incoming value. A push that lands out of order
           must not walk the watermark backwards and make a newer revision
           look unpushed for ever.
         */
         synced_revision = greatest(coalesce(public.task_links.synced_revision, 0),
                                    coalesce(excluded.synced_revision, 0)),
         pushed_at = excluded.pushed_at,
         sync_state = 'ok',
         sync_error = null,
         updated_at = app.now_utc();
  return jsonb_build_object('ok', true, 'task', p_task_id, 'provider', p_provider);
end
$fn$;

create or replace function app.task_push_failed(
  p_task_id uuid, p_provider text, p_error text)
returns jsonb
language plpgsql volatile security definer
set search_path = 'public', 'pg_catalog'
as $fn$
begin
  insert into public.task_links
    (task_id, provider, external_id, sync_state, sync_error, updated_at)
  values (p_task_id, p_provider, 'pending:' || p_task_id::text, 'error',
          coalesce(nullif(btrim(p_error), ''), 'the provider refused, and said nothing'),
          app.now_utc())
  on conflict (task_id, provider) do update
     set sync_state = 'error',
         sync_error = excluded.sync_error,
         updated_at = app.now_utc();
  return jsonb_build_object('ok', true, 'recorded', p_error);
end
$fn$;

/*
  A deletion a provider has applied. Separate from `task_pushed` because the
  task is gone: there is no row to link, only a tombstone to close.
*/
create or replace function app.task_delete_pushed(p_task_id uuid, p_provider text)
returns jsonb
language plpgsql volatile security definer
set search_path = 'public', 'pg_catalog'
as $fn$
declare
  v_left jsonb;
begin
  select jsonb_agg(e) into v_left
    from public.task_tombstones d,
         lateral jsonb_array_elements(d.links) e
   where d.task_id = p_task_id and e ->> 'provider' <> p_provider;

  update public.task_tombstones
     set links = coalesce(v_left, '[]'::jsonb),
         cleared_at = case when coalesce(v_left, '[]'::jsonb) = '[]'::jsonb
                           then app.now_utc() else null end
   where task_id = p_task_id;
  return jsonb_build_object('ok', true, 'owed_to', coalesce(v_left, '[]'::jsonb));
end
$fn$;

/*
  Disconnecting a provider. #259: this must never lose a native task.
*/
create or replace function app.task_provider_forget(p_provider text)
returns jsonb
language plpgsql volatile security definer
set search_path = 'public', 'pg_catalog'
as $fn$
declare
  v_links int;
  v_tasks int;
begin
  select count(*)::int into v_links from public.task_links where provider = p_provider;
  delete from public.task_links where provider = p_provider;
  update public.task_tombstones
     set links = coalesce((select jsonb_agg(e) from jsonb_array_elements(links) e
                            where e ->> 'provider' <> p_provider), '[]'::jsonb);
  update public.task_tombstones set cleared_at = app.now_utc()
   where cleared_at is null and links = '[]'::jsonb;
  select count(*)::int into v_tasks from public.tasks where assigned_to_human;
  return jsonb_build_object('ok', true, 'links_removed', v_links, 'tasks_kept', v_tasks);
end
$fn$;

grant execute on function app.tasks_to_push(text, integer) to ai_team_app, service_role;
grant execute on function app.task_pushed(uuid, text, text, integer, text, text)
  to ai_team_app, service_role;
grant execute on function app.task_push_failed(uuid, text, text) to ai_team_app, service_role;
grant execute on function app.task_delete_pushed(uuid, text) to ai_team_app, service_role;
grant execute on function app.task_provider_forget(text) to ai_team_app, service_role;

-- ---------------------------------------------------------------------------
-- Drive the whole seam, as a fake provider would.
-- ---------------------------------------------------------------------------

do $drive$
declare
  v_id   uuid;
  v_rev  int;
  v_out  jsonb;
begin
  insert into public.tasks (title, assigned_to_human, added_by, state)
  values ('Seam probe 0513', true, 'migration', 'todo') returning task_id into v_id;

  select revision into v_rev from public.tasks where task_id = v_id;
  if v_rev <> 1 then raise exception '0513: a new task starts at revision %', v_rev; end if;

  update public.tasks set title = 'Seam probe 0513 renamed' where task_id = v_id;
  select revision into v_rev from public.tasks where task_id = v_id;
  if v_rev <> 2 then raise exception '0513: an update left the revision at %', v_rev; end if;

  -- Unpushed, so it is offered.
  v_out := app.tasks_to_push('probe');
  if not (v_out -> 'upserts' @> jsonb_build_array(jsonb_build_object('id', v_id))) then
    raise exception '0513: a task no provider has seen is not offered for push';
  end if;

  perform app.task_pushed(v_id, 'probe', 'ext-1', v_rev, 'ext-project-1', 'etag-1');
  v_out := app.tasks_to_push('probe');
  if v_out -> 'upserts' @> jsonb_build_array(jsonb_build_object('id', v_id)) then
    raise exception '0513: a task just pushed is offered again — the watermark is not held';
  end if;

  -- An out-of-order push must not walk the watermark back.
  perform app.task_pushed(v_id, 'probe', 'ext-1', 1);
  if (select synced_revision from public.task_links
       where task_id = v_id and provider = 'probe') <> 2 then
    raise exception '0513: a stale push moved the watermark backwards';
  end if;

  -- A local edit makes it pushable again.
  update public.tasks set title = 'Seam probe 0513 edited again' where task_id = v_id;
  if not (app.tasks_to_push('probe') -> 'upserts'
          @> jsonb_build_array(jsonb_build_object('id', v_id))) then
    raise exception '0513: an edited task is not offered for push';
  end if;

  -- A failure is recorded and says why.
  perform app.task_push_failed(v_id, 'probe', 'the provider was unreachable');
  if (select sync_state from public.task_links where task_id = v_id and provider = 'probe')
     <> 'error' then
    raise exception '0513: a failed push was not recorded as an error';
  end if;

  -- Deleting leaves a tombstone, because somebody outside knew.
  v_out := app.my_task_delete(v_id::text);
  if coalesce((v_out ->> 'ok')::boolean, false) is not true then
    raise exception '0513: my_task_delete refused: %', v_out;
  end if;
  if not exists (select 1 from public.task_tombstones where task_id = v_id) then
    raise exception '0513: a task a provider knew about left no tombstone';
  end if;
  if not (app.tasks_to_push('probe') -> 'deletes'
          @> jsonb_build_array(jsonb_build_object('id', v_id))) then
    raise exception '0513: the deletion is not offered to the provider that holds it';
  end if;
  perform app.task_delete_pushed(v_id, 'probe');
  if (select cleared_at from public.task_tombstones where task_id = v_id) is null then
    raise exception '0513: a deletion every provider has applied is still owed';
  end if;

  -- CONTROL: a task NOBODY knew about leaves no tombstone at all.
  insert into public.tasks (title, assigned_to_human, added_by, state)
  values ('Seam probe 0513 private', true, 'migration', 'todo') returning task_id into v_id;
  perform app.my_task_delete(v_id::text);
  if exists (select 1 from public.task_tombstones where task_id = v_id) then
    raise exception 'CONTROL FAILED: a task no provider ever saw left a tombstone';
  end if;

  -- CONTROL: the team's own work is not deletable from this door.
  insert into public.tasks (title, assigned_to_human, added_by, state)
  values ('Seam probe 0513 theirs', false, 'migration', 'todo') returning task_id into v_id;
  v_out := app.my_task_delete(v_id::text);
  if coalesce((v_out ->> 'ok')::boolean, true) is not false then
    raise exception 'CONTROL FAILED: my_task_delete removed the team''s own task';
  end if;
  delete from public.tasks where task_id = v_id;

  delete from public.task_tombstones where title like 'Seam probe 0513%';
  raise notice '0513: revision, push watermark, failure, tombstone and both controls hold';
end
$drive$;
