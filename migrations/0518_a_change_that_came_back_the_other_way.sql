/*
  0518 — a change that came back the other way (#259, Phase 2)

  Phase 1 built the seam a provider plugs into and built exactly half of it.
  `tasks_to_push` says what the office wants a provider to know; `task_pushed`
  and `task_push_failed` record what happened. There was nothing at all for the
  other direction, and a "two-way" integration with no inbound door is a
  one-way integration with a hopeful name.

  Driving a REAL Vikunja exposed it in the first five minutes, which is what
  the brief means by fixing the abstraction rather than adding an exception:
  the missing thing is not Vikunja-shaped, it is `task_pulled`, and any
  provider will need it.

  ## The conflict policy, stated once and enforced here

  Two sides can change one task between syncs. The rule is:

    - The provider's change applies when the CANONICAL side has not moved
      since the last successful sync (`revision <= synced_revision`).
    - When BOTH have moved, the canonical value is KEPT and the row is marked
      `sync_state = 'conflict'` with a sentence saying so. Supabase is
      canonical (CLAUDE.md, and #259's first invariant), so the tie cannot go
      the other way — but it must not go quietly either, which is why it is a
      state on the link rather than a silent discard.
    - A task that has a TOMBSTONE is never recreated. Grant deleted it; a
      provider that still holds a copy is behind, not right. The answer names
      the deletion so the caller can remove it there.

  ## Idempotency

  Keyed on `(provider, external_id)`, which is already unique on
  `task_links`. The same inbound payload applied twice is one task and the
  second application is a no-op — `revision` only moves when a value really
  changes, because `touch_task` fires on UPDATE and an UPDATE that sets a
  column to what it already holds still fires it. So the writes are guarded by
  `is distinct from` rather than issued unconditionally.
*/

create or replace function app.task_pulled(
  p_provider text,
  p_external_id text,
  p_fields jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
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
begin
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
     where d.cleared_at is null
       and d.links @> jsonb_build_array(
             jsonb_build_object('provider', v_provider, 'external_id', v_ext))
  ) then
    return jsonb_build_object(
      'ok', false, 'deleted', true,
      'note', 'that task was deleted here - remove it at the provider rather than recreating it');
  end if;

  select * into v_link from public.task_links
   where provider = v_provider and external_id = v_ext;

  -- ------------------------------------------------------------------ new --
  if not found then
    if v_title is null then
      return jsonb_build_object('error', 'a new task needs a title');
    end if;
    v_id := (app.my_task_add(
      p_title   => left(v_title, 500),
      p_detail  => coalesce(p_fields ->> 'detail', ''),
      p_due_on  => nullif(p_fields ->> 'due_on', '')::date,
      p_priority => nullif(p_fields ->> 'priority', '')::int
    ) ->> 'id')::uuid;
    if v_id is null then
      return jsonb_build_object('error', 'the task could not be created here');
    end if;
    if coalesce((p_fields ->> 'done')::boolean, false) then
      update public.tasks set state = 'done', done_at = app.now_utc() where task_id = v_id;
    end if;
    select * into v_task from public.tasks where task_id = v_id;
    insert into public.task_links
      (task_id, provider, external_id, external_project_id, external_revision,
       synced_revision, pulled_at, sync_state)
    values (v_id, v_provider, v_ext, nullif(p_fields ->> 'external_project_id', ''),
            v_rev, v_task.revision, app.now_utc(), 'ok');
    return jsonb_build_object('ok', true, 'created', true, 'id', v_id,
                              'title', v_task.title, 'revision', v_task.revision);
  end if;

  -- ------------------------------------------------------------- existing --
  select * into v_task from public.tasks where task_id = v_link.task_id;
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
      update public.tasks set title = left(v_title, 500) where task_id = v_task.task_id;
      v_changed := v_changed || array['title'];
    end if;
    if (p_fields ? 'detail')
       and coalesce(p_fields ->> 'detail', '') is distinct from coalesce(v_task.detail, '') then
      update public.tasks set detail = coalesce(p_fields ->> 'detail', '')
       where task_id = v_task.task_id;
      v_changed := v_changed || array['detail'];
    end if;
    if (p_fields ? 'due_on')
       and nullif(p_fields ->> 'due_on', '')::date is distinct from v_task.due_on then
      update public.tasks set due_on = nullif(p_fields ->> 'due_on', '')::date
       where task_id = v_task.task_id;
      v_changed := v_changed || array['due_on'];
    end if;
    if (p_fields ? 'priority')
       and nullif(p_fields ->> 'priority', '')::int is not null
       and nullif(p_fields ->> 'priority', '')::int is distinct from v_task.priority then
      update public.tasks set priority = nullif(p_fields ->> 'priority', '')::int
       where task_id = v_task.task_id;
      v_changed := v_changed || array['priority'];
    end if;
    if (p_fields ? 'done') then
      if coalesce((p_fields ->> 'done')::boolean, false) and v_task.state <> 'done' then
        update public.tasks set state = 'done', done_at = app.now_utc()
         where task_id = v_task.task_id;
        v_changed := v_changed || array['done'];
      elsif not coalesce((p_fields ->> 'done')::boolean, false) and v_task.state = 'done' then
        update public.tasks set state = 'todo', done_at = null
         where task_id = v_task.task_id;
        v_changed := v_changed || array['reopened'];
      end if;
    end if;
  end if;

  select * into v_task from public.tasks where task_id = v_link.task_id;
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
$fn$;

comment on function app.task_pulled(text, text, jsonb) is
  'Apply one inbound change from a provider. Canonical wins a genuine conflict and the link says so; a tombstoned task is never recreated. #259 Phase 2.';

grant execute on function app.task_pulled(text, text, jsonb) to authenticated, service_role;

/* PostgREST only exposes `public`, and the office reaches this over HTTP. */
create or replace function public.task_pulled(p_provider text, p_external_id text, p_fields jsonb)
returns jsonb language sql security definer set search_path = '' as $w$
  select app.task_pulled(p_provider, p_external_id, p_fields)
$w$;

grant execute on function public.task_pulled(text, text, jsonb) to authenticated, service_role;

/*
  And the LIST of what a provider has disagreed about, so it is visible
  somewhere rather than only being true.

  A conflict that only exists as a column value is a conflict nobody sees —
  the dead-dial shape this repository keeps paying for. One reader, named for
  the question a person asks.
*/
create or replace function app.task_sync_trouble(p_provider text default null)
returns jsonb language sql stable security definer set search_path = '' as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
           'task_id', l.task_id, 'title', t.title, 'provider', l.provider,
           'state', l.sync_state, 'why', l.sync_error,
           'last_pushed', l.pushed_at, 'last_pulled', l.pulled_at)
         order by l.updated_at desc), '[]'::jsonb)
    from public.task_links l
    join public.tasks t on t.task_id = l.task_id
   where l.sync_state in ('error', 'conflict')
     and (p_provider is null or l.provider = p_provider)
     and not coalesce(t.is_fixture, false)
$f$;

grant execute on function app.task_sync_trouble(text) to authenticated, service_role;

create or replace function public.task_sync_trouble(p_provider text default null)
returns jsonb language sql security definer set search_path = '' as $w$
  select app.task_sync_trouble(p_provider)
$w$;

grant execute on function public.task_sync_trouble(text) to authenticated, service_role;

/*
  DRIVE IT. A migration that applies cleanly is not a function that works, and
  0390 cost four defects in one feature for exactly this reason.
*/
do $drive$
declare
  v    jsonb;
  v_id uuid;
  v_r1 int;
begin
  -- 1. a task that came from the provider and has never been seen here
  v := app.task_pulled('probe-0518', 'ext-1',
         jsonb_build_object('title', 'fixture-0518 from the provider',
                            'due_on', '2026-10-01', 'priority', 20,
                            'external_revision', 'r1'));
  if coalesce((v ->> 'created')::boolean, false) is not true then
    raise exception '0518: an unseen external task was not created here: %', v;
  end if;
  v_id := (v ->> 'id')::uuid;

  -- 2. the SAME payload again is one task, and moves nothing
  select revision into v_r1 from public.tasks where task_id = v_id;
  v := app.task_pulled('probe-0518', 'ext-1',
         jsonb_build_object('title', 'fixture-0518 from the provider',
                            'due_on', '2026-10-01', 'priority', 20,
                            'external_revision', 'r1'));
  if (select count(*) from public.task_links
       where provider = 'probe-0518' and external_id = 'ext-1') <> 1 then
    raise exception '0518: applying the same payload twice made two links';
  end if;
  if (select revision from public.tasks where task_id = v_id) <> v_r1 then
    raise exception '0518: an unchanged payload moved the revision';
  end if;

  -- 3. a real change from the provider applies
  v := app.task_pulled('probe-0518', 'ext-1',
         jsonb_build_object('title', 'fixture-0518 renamed there',
                            'external_revision', 'r2'));
  if (select title from public.tasks where task_id = v_id) <> 'fixture-0518 renamed there' then
    raise exception '0518: a provider rename did not apply: %', v;
  end if;

  -- 4. BOTH sides move: canonical is kept and the link says conflict
  update public.tasks set detail = 'changed here' where task_id = v_id;
  v := app.task_pulled('probe-0518', 'ext-1',
         jsonb_build_object('title', 'fixture-0518 renamed there AGAIN',
                            'external_revision', 'r3'));
  if coalesce((v ->> 'conflict')::boolean, false) is not true then
    raise exception '0518: a simultaneous change on both sides was not a conflict: %', v;
  end if;
  if (select title from public.tasks where task_id = v_id) <> 'fixture-0518 renamed there' then
    raise exception '0518: the conflict overwrote the canonical value';
  end if;
  if (select sync_state from public.task_links
       where provider = 'probe-0518' and external_id = 'ext-1') <> 'conflict' then
    raise exception '0518: the conflict was not recorded on the link';
  end if;
  if (select count(*) from jsonb_array_elements(app.task_sync_trouble('probe-0518'))) <> 1 then
    raise exception '0518: the conflict is not visible to the reader built for it';
  end if;

  -- 5. and the conflicted task is STILL offered for push, which is what resolves it
  if (select count(*) from jsonb_array_elements(app.tasks_to_push('probe-0518', 50) -> 'upserts') e
       where (e ->> 'id')::uuid = v_id) <> 1 then
    raise exception '0518: a conflicted task stopped being offered for push';
  end if;

  -- 6. CONTROL: a tombstoned task is never recreated
  perform app.my_task_delete(v_id::text, 'the 0518 drive');
  v := app.task_pulled('probe-0518', 'ext-1',
         jsonb_build_object('title', 'fixture-0518 back from the dead'));
  if coalesce((v ->> 'deleted')::boolean, false) is not true then
    raise exception '0518: a deleted task was offered back and taken: %', v;
  end if;
  if exists (select 1 from public.tasks where title = 'fixture-0518 back from the dead') then
    raise exception '0518: a tombstoned task was recreated';
  end if;

  -- 7. CONTROL: a payload naming nothing is refused rather than guessed
  v := app.task_pulled('probe-0518', '', jsonb_build_object('title', 'x'));
  if v ->> 'error' is null then
    raise exception '0518: a pull with no external id was accepted';
  end if;

  raise notice '0518 drive: seven checks passed';
end;
$drive$;

/* The drive's own subject, removed. A tombstone is history and stays. */
delete from public.task_links where provider = 'probe-0518';
delete from public.tasks where title like 'fixture-0518%';
