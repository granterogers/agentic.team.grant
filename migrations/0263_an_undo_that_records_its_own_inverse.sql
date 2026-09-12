-- 0263 — an undo that records its own inverse
--
-- Issue #118. The studio has fifteen write actions and not one of them can be
-- taken back. The only route out of a mistake is to do the opposite by hand:
-- rename it again, re-tick the task, re-pick the icon, re-attach the source.
--
-- ## The machinery already existed and nobody had ever called it
--
-- 0029 and 0030 built `undoable_actions`, `undo_requests` and
-- `app.request_undo` — a genuinely good piece of work, idempotent under
-- concurrent duplicate delivery, with the serialisation point in the right
-- place. A grep for `undoable_actions` across the whole repository finds those
-- two migrations and NOTHING ELSE. No RPC writes a row. No page reads one.
--
-- That is the shape this repository keeps rediscovering (#72): a mechanism
-- nobody calls is not a feature, and it is worse than an absent one because
-- everybody who reads the schema believes undo exists.
--
-- ## The rule, and why it decides the whole design
--
-- #118: **only offer undo where the inverse is exact.**
--
-- An undo that does something slightly different from the reverse of what
-- happened is worse than no undo, because it is trusted. So the inverse cannot
-- be *derived at undo time* from what was requested — by then the prior value
-- is gone. It has to be **captured by the function that overwrote it, at the
-- moment it still knows what it is overwriting.**
--
-- That is why this migration patches seven functions rather than adding one.
-- There is no place other than inside the writing statement's own transaction
-- where the previous value is still available and still correct.
--
-- 0029 said the same thing in its own words and it is worth repeating:
--
--   > Deliberately not "the whole event": an undo payload that carries the
--   > original request invites re-deriving the reversal from it at undo time,
--   > which is how an undo starts doing something subtly different from the
--   > reverse of what happened.
--
-- ## What gets an undo, decided per action rather than assumed
--
--   rename a project      yes — the previous name is known
--   edit a task           yes — every field's previous value, and a clear list
--                               for the ones that were empty
--   tick a task done      yes — the previous state, and its blocked reason
--   move or resize panels yes — the previous arrangement, or a reset when
--                               there was no saved arrangement at all
--   an icon or a hue      yes
--   a project's PHOTO     no  — see below
--   detach a source       yes — the same row re-enabled, which is more exact
--                               than attaching the same reference again
--   disconnect a service  no  — the credential is deleted from the Vault and
--                               we cannot put it back
--   create a project      no  — Grant: *"don't assume I wish to create a new
--                               project — this is a large task and should
--                               always be confirmed."* The confirmation is the
--                               safeguard, not an undo.
--
-- **The photo.** Restoring it would be exact — we could keep the old data URL
-- — and it is still refused, for a different reason: the previous image is up
-- to 96 KB, and keeping a copy of every replaced image so that a ten-second
-- offer can be exact is a hoard rather than an undo. So a call that changes
-- the image records `not_undoable` and says why. Changing the icon or the hue
-- in the same call still offers one; the photo is the part that does not.
--
-- **Disconnect.** `hq_disconnect` runs `delete from vault.secrets`. The
-- credential is gone from the only place we held it. #118 allows an undo
-- *"only while the credential is still ours to put back"* and it is not, today,
-- before #109 revokes anything at the provider. `not_undoable` with the reason
-- is the honest answer, and being able to SAY that is exactly why 0029 made
-- `not_undoable` a first-class status rather than an absent row.
--
-- ## Reversal shape
--
-- `{"action": "<hq-api action name>", "args": {...}}` — the inverse expressed
-- in the same vocabulary the page uses to make the change in the first place.
-- You can read a row and see precisely what pressing Undo will do, which is
-- the property that makes this auditable rather than merely present.
--
-- ## Undoing does not itself become undoable
--
-- `app.hq_undo` sets a transaction-local `app.undoing`, and `app.undo_offer`
-- returns null while it is set. Without that, pressing Undo would offer an undo
-- of the undo, and a strip that reappears after you dismiss it reads as a bug.
--
-- ## If the reversal fails, nothing happened
--
-- `app.request_undo` marks the action `undone` before the reversal runs, which
-- is correct — it is the claim, and it must be taken before acting. But an
-- inner RPC that returns `{"error": ...}` rather than raising would leave the
-- action marked undone with nothing reversed. So `hq_undo` RAISES on an inner
-- error, which rolls back the claim with it. Either the world moved back and
-- the row says undone, or neither.

begin;

-- ---------------------------------------------------------------------------
-- Recording an offer
-- ---------------------------------------------------------------------------

/**
 * Record that something just happened and can be taken back.
 *
 * Returns the action id, or null when no offer was made — which callers pass
 * straight into their answer, so a page can show a strip without knowing any
 * of this.
 *
 * `p_minutes` is the life of the OFFER, not of the strip. The strip is about
 * ten seconds; the offer is generous, so a press at the very edge of the strip
 * still lands rather than reporting `expired` for a button that was on screen
 * when it was pressed.
 */
create or replace function app.undo_offer(
  p_kind        text,
  p_description text,
  p_reversal    jsonb,
  p_minutes     int default 2
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  -- An undo of an undo is not a feature.
  if coalesce(current_setting('app.undoing', true), '') = '1' then
    return null;
  end if;
  -- A reversal with nothing in it is not a reversal; the table says so too,
  -- and reaching that constraint would turn a missing inverse into a failed
  -- write of the thing the person actually asked for.
  if p_reversal is null or p_reversal = '{}'::jsonb then
    return null;
  end if;

  insert into public.undoable_actions
    (correlation_id, kind, description, reversal, status, undo_deadline)
  values (gen_random_uuid(), p_kind, p_description, p_reversal, 'available',
          app.now_utc() + make_interval(mins => p_minutes))
  returning action_id into v_id;
  return v_id;
end;
$$;

comment on function app.undo_offer is
  'Record an exact inverse at the moment the previous value is still known. '
  'Returns null while an undo is being performed, so undoing is not itself '
  'undoable.';

/**
 * Record that something happened and CANNOT be taken back, with the reason.
 *
 * The half people leave out. "There is no undo for this" is something the
 * interface has to be able to say, and saying nothing reads as "we forgot"
 * rather than as "this one is deliberate".
 */
create or replace function app.undo_none(p_kind text, p_description text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if coalesce(current_setting('app.undoing', true), '') = '1' then
    return null;
  end if;
  insert into public.undoable_actions
    (correlation_id, kind, description, reversal, status, undo_deadline)
  values (gen_random_uuid(), p_kind, p_description, '{}'::jsonb, 'not_undoable', null)
  returning action_id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Re-attaching exactly the row that was detached
-- ---------------------------------------------------------------------------

/**
 * The inverse of `hq_detach`.
 *
 * #118 suggested `hq_attach` with the same reference, and re-enabling the same
 * row is strictly more exact: `hq_attach` would resolve the reference again and
 * could find a different attachment, or make a second one. Detach disables a
 * row and records why; this puts both back.
 */
create or replace function app.hq_reattach(p_attachment_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_found uuid;
begin
  select attachment_id into v_found
    from public.project_attachments where attachment_id = p_attachment_id;
  if v_found is null then
    return jsonb_build_object('error', 'no such attachment');
  end if;

  -- `project_attachments` carries `check (enabled or disabled_reason is not
  -- null)`, so re-enabling and clearing the reason must happen in one
  -- statement. They do.
  update public.project_attachments
     set enabled = true, disabled_reason = p_reason
   where attachment_id = p_attachment_id;

  return jsonb_build_object('reattached', p_attachment_id);
end;
$$;

create or replace function public.hq_reattach(p_attachment_id uuid, p_reason text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_reattach(p_attachment_id, p_reason) $$;

-- ---------------------------------------------------------------------------
-- The seven writers, each recording its own inverse
-- ---------------------------------------------------------------------------

-- 1. Renaming a project. The previous name, read before the update.
create or replace function app.hq_rename_project(p_slug text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_prefix text;
  v_id uuid;
  v_was text;
  v_undo uuid;
begin
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('error', 'a project needs a name');
  end if;
  select project_id, name into v_id, v_was from public.projects where slug = p_slug;
  if v_id is null then
    return jsonb_build_object('error', format('no project %L', p_slug));
  end if;

  v_prefix := left(trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')), 48);
  update public.projects
     set name = trim(p_name), channel_prefix = nullif(v_prefix, '')
   where project_id = v_id;

  -- The Slack channels follow, but not from here: renaming a channel is a
  -- Slack API call and this is SQL. The page reports that the rename is
  -- pending and the worker carries it out, rather than the page claiming a
  -- rename it cannot perform.
  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
  values (gen_random_uuid(), v_id, format('rename-%s-%s', v_id, gen_random_uuid()),
          'office.rename_channels', 'hq', 300,
          jsonb_build_object('prefix', v_prefix));

  -- The slug does not change on a rename, so the inverse addresses the same
  -- project. Undoing also enqueues a second rename job, which is right: the
  -- channels followed the name out and have to follow it back.
  if trim(p_name) is distinct from v_was then
    v_undo := app.undo_offer(
      'project.rename',
      format('Renamed to %s', trim(p_name)),
      jsonb_build_object('action', 'rename_project',
                         'args', jsonb_build_object('p_slug', p_slug, 'p_name', v_was)));
  end if;

  return jsonb_build_object(
    'slug', p_slug, 'name', trim(p_name), 'channel_prefix', v_prefix,
    'undo', v_undo,
    'note', 'channels will be renamed by the worker on its next pass'
  );
end;
$function$;

-- 2. A task's state. The previous state AND its blocked reason, because
--    `blocked` without one is refused and an undo that cannot be applied is
--    not an undo.
create or replace function app.hq_task_state(p_task_id text, p_state text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_id       uuid;
  v          jsonb;
  v_was      text;
  v_was_why  text;
  v_title    text;
  v_undo     uuid;
begin
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('error', 'that is not a task id');
  end;

  if p_state not in ('todo', 'doing', 'blocked', 'done', 'cancelled') then
    return jsonb_build_object('error', format(
      '%L is not a state — it is one of todo, doing, blocked, done, cancelled', p_state));
  end if;

  -- blocked_needs_a_reason. Said here, with the reason why, rather than
  -- arriving as a constraint name.
  if p_state = 'blocked' and coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('error',
      'say what it is blocked on — a blocked task with no reason cannot be unblocked by anyone but the person who blocked it');
  end if;

  select state, blocked_on, title into v_was, v_was_why, v_title
    from public.tasks where task_id = v_id;
  if v_was is null then
    return jsonb_build_object('error', 'no such task');
  end if;

  /*
    done_at moves with the state, in both directions.

    `(state = 'done') = (done_at is not null)` is a check constraint, so
    marking done without a timestamp fails AND so does re-opening a done task
    without clearing one. Handling only the first is the bug that looks fixed.
  */
  update public.tasks
     set state      = p_state,
         done_at    = case when p_state = 'done' then coalesce(done_at, app.now_utc()) else null end,
         blocked_on = case when p_state = 'blocked' then btrim(p_reason) else '' end
   where task_id = v_id
  returning jsonb_build_object('id', task_id, 'title', title, 'state', state) into v;

  if p_state is distinct from v_was then
    v_undo := app.undo_offer(
      'task.state',
      format('%s marked %s', left(v_title, 60), p_state),
      jsonb_build_object('action', 'task_state',
                         'args', jsonb_build_object(
                           'p_task_id', p_task_id, 'p_state', v_was,
                           'p_reason', nullif(v_was_why, ''))));
  end if;

  return coalesce(v, jsonb_build_object('error', 'no such task')) || jsonb_build_object('undo', v_undo);
end;
$function$;

-- 3. Editing a task. Every field's previous value, plus a clear list for the
--    ones that were empty — `coalesce` cannot restore a field to null, so an
--    inverse without the clear list would silently leave a due date behind.
create or replace function app.hq_task_update(
  p_task_id text, p_title text default null, p_detail text default null,
  p_due_on date default null, p_starts_on date default null, p_assignee text default null,
  p_parent text default null, p_milestone boolean default null, p_priority integer default null,
  p_clear text[] default array[]::text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_id      uuid;
  v_project uuid;
  v_staff   uuid;
  v_parent  uuid;
  v_title   text;
  v         jsonb;
  v_was     record;
  v_back    jsonb;
  v_clear   text[] := array[]::text[];
  v_undo    uuid;
begin
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('error', format('%L is not a task id', p_task_id));
  end;

  select project_id into v_project from public.tasks where task_id = v_id;
  if v_project is null then
    return jsonb_build_object('error', 'no task with that id');
  end if;

  if p_title is not null then
    v_title := btrim(p_title);
    if v_title = '' then
      return jsonb_build_object('error', 'a task needs a title -- rename it to something, or leave it');
    end if;
  end if;

  if coalesce(btrim(p_assignee), '') <> '' then
    select staff_id into v_staff from public.staff where slug = btrim(p_assignee);
    if v_staff is null then
      return jsonb_build_object('error', format('nobody here is called %L', btrim(p_assignee)));
    end if;
  end if;

  if coalesce(btrim(p_parent), '') <> '' then
    begin
      v_parent := btrim(p_parent)::uuid;
    exception when others then
      return jsonb_build_object('error', format('%L is not a task id', p_parent));
    end;
    if v_parent = v_id then
      return jsonb_build_object('error', 'a task cannot be its own parent');
    end if;
    if not exists (select 1 from public.tasks where task_id = v_parent
                    and project_id = v_project) then
      return jsonb_build_object('error',
        'that parent is not a task on the same dashboard project');
    end if;
    -- The cycle. A -> B -> A is invisible to a single-level comparison, so
    -- walk the proposed parent's own ancestry and refuse if this task is in it.
    if exists (
      with recursive up as (
        select task_id, parent_task_id from public.tasks where task_id = v_parent
        union all
        select t.task_id, t.parent_task_id
          from public.tasks t join up on t.task_id = up.parent_task_id
      )
      select 1 from up where task_id = v_id
    ) then
      return jsonb_build_object('error',
        'that would make a loop -- the task you picked is already under this one');
    end if;
  end if;

  -- Read the whole row before touching it. This is the only moment the
  -- previous values exist.
  select t.title, t.detail, t.due_on, t.starts_on, t.parent_task_id,
         t.is_milestone, t.priority,
         (select s.slug from public.staff s where s.staff_id = t.assignee_staff) as assignee
    into v_was
    from public.tasks t where t.task_id = v_id;

  update public.tasks
     set title             = coalesce(v_title, title),
         detail            = case when 'detail' = any(p_clear) then ''
                                  else coalesce(btrim(p_detail), detail) end,
         due_on            = case when 'due_on' = any(p_clear) then null
                                  else coalesce(p_due_on, due_on) end,
         starts_on         = case when 'starts_on' = any(p_clear) then null
                                  else coalesce(p_starts_on, starts_on) end,
         assignee_staff    = case when 'assignee' = any(p_clear) then null
                                  else coalesce(v_staff, assignee_staff) end,
         parent_task_id    = case when 'parent' = any(p_clear) then null
                                  else coalesce(v_parent, parent_task_id) end,
         is_milestone      = coalesce(p_milestone, is_milestone),
         priority          = coalesce(p_priority, priority),
         updated_at        = app.now_utc()
   where task_id = v_id;

  /*
    Build the inverse from what was read.

    A field that WAS empty cannot be restored by passing null — null means
    "leave it" everywhere in this function — so it goes in the clear list
    instead. Getting this wrong is the exact failure #118 warns about: an undo
    that restores four fields out of five looks like it worked.
  */
  if coalesce(v_was.detail, '') = '' then v_clear := v_clear || 'detail'; end if;
  if v_was.due_on     is null   then v_clear := v_clear || 'due_on'; end if;
  if v_was.starts_on  is null   then v_clear := v_clear || 'starts_on'; end if;
  if v_was.assignee   is null   then v_clear := v_clear || 'assignee'; end if;
  if v_was.parent_task_id is null then v_clear := v_clear || 'parent'; end if;

  v_back := jsonb_build_object(
    'p_task_id',   p_task_id,
    'p_title',     v_was.title,
    'p_detail',    nullif(coalesce(v_was.detail, ''), ''),
    'p_due_on',    v_was.due_on,
    'p_starts_on', v_was.starts_on,
    'p_assignee',  v_was.assignee,
    'p_parent',    v_was.parent_task_id,
    'p_milestone', v_was.is_milestone,
    'p_priority',  v_was.priority,
    'p_clear',     to_jsonb(v_clear));

  v_undo := app.undo_offer(
    'task.update',
    format('Edited %s', left(v_was.title, 60)),
    jsonb_build_object('action', 'task_update', 'args', v_back));

  select jsonb_build_object(
           'id', t.task_id, 'title', t.title, 'detail', t.detail,
           'state', t.state, 'due_on', t.due_on, 'starts_on', t.starts_on,
           'milestone', t.is_milestone, 'priority', t.priority,
           'parent', t.parent_task_id, 'undo', v_undo,
           'assignee', (select s.slug from public.staff s where s.staff_id = t.assignee_staff)
         )
    into v
    from public.tasks t where t.task_id = v_id;
  return v;
end;
$function$;

-- 4. A project's icon and hue. The photo is deliberately outside the offer.
create or replace function app.hq_project_look(
  p_slug text, p_icon text default null, p_hue text default null,
  p_image text default null, p_clear text[] default array[]::text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_project uuid;
  v_icon    text;
  v_hue     text;
  v_clear   text[] := array[]::text[];
  v_undo    uuid;
  v_touched_image boolean;
begin
  select project_id, icon, icon_hue into v_project, v_icon, v_hue
    from public.projects
   where slug = p_slug and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active dashboard project called %s', p_slug));
  end if;

  if p_hue is not null and p_hue not in
     ('p-rust', 'p-amber', 'p-moss', 'p-slate', 'p-iris', 'p-plum') then
    return jsonb_build_object('error', format('%s is not one of the palette colours', p_hue));
  end if;

  -- The new one. A URL to somewhere else is the likeliest mistake and the one
  -- worth naming: an image the office does not hold is an image that vanishes
  -- when that host does.
  if p_image is not null and p_image not like 'data:image/%' then
    return jsonb_build_object('error',
      'an image has to be sent as data, not as a link -- the page resizes it to 256px '
      || 'and encodes it before it gets here, so a link means something else called this');
  end if;

  if p_image is not null and length(p_image) > 98304 then
    return jsonb_build_object('error',
      'that image is too large once encoded -- it is resized to 256px before it is sent, '
      || 'so an image this big means the resize did not run');
  end if;

  update public.projects
     set icon     = case when 'icon'  = any(p_clear) then null
                         else coalesce(p_icon, icon) end,
         icon_hue = case when 'hue'   = any(p_clear) then null
                         else coalesce(p_hue, icon_hue) end,
         image    = case when 'image' = any(p_clear) then null
                         else coalesce(p_image, image) end
   where project_id = v_project;

  v_touched_image := p_image is not null or 'image' = any(p_clear);

  if v_touched_image then
    -- Exact would mean keeping the previous 96 KB data URL for a two-minute
    -- offer, on every change, for ever. That is a hoard, not an undo. Say so
    -- rather than offering a partial restore that quietly leaves the old photo
    -- gone.
    v_undo := null;
    perform app.undo_none('project.photo',
      format('Changed the photo on %s — the previous one is not kept', p_slug));
  else
    if v_icon is null then v_clear := v_clear || 'icon'; end if;
    if v_hue  is null then v_clear := v_clear || 'hue'; end if;
    v_undo := app.undo_offer(
      'project.look',
      format('Changed how %s looks', p_slug),
      jsonb_build_object('action', 'project_look',
                         'args', jsonb_build_object(
                           'p_slug', p_slug, 'p_icon', v_icon, 'p_hue', v_hue,
                           'p_clear', to_jsonb(v_clear))));
  end if;

  return (
    select jsonb_build_object('ok', true, 'slug', p_slug,
             'icon', pr.icon, 'hue', pr.icon_hue, 'undo', v_undo,
             'image', case when pr.image is null then null else 'set' end)
      from public.projects pr where pr.project_id = v_project
  );
end;
$function$;

-- 5. The arrangement of a dashboard. ADR-0021 — an arrangement belongs to the
--    person, so losing one to a mis-drag is losing something they composed.
create or replace function app.hq_dashboard_layout_set(p_slug text, p_panels jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_project uuid;
  v_bad     int;
  v_was     jsonb;
  v_undo    uuid;
begin
  select project_id into v_project
    from public.projects
   where slug = p_slug and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active dashboard project called %s', p_slug));
  end if;

  if jsonb_typeof(p_panels) <> 'array' then
    return jsonb_build_object('error', 'panels must be an array');
  end if;

  select panels into v_was
    from public.dashboard_layouts
   where project_id = v_project and owner = 'grant';

  -- Nothing left on the board is a reset, not a layout.
  if jsonb_array_length(p_panels) = 0 then
    delete from public.dashboard_layouts
     where project_id = v_project and owner = 'grant';
    if v_was is not null then
      v_undo := app.undo_offer(
        'dashboard.layout',
        format('Emptied the board on %s', p_slug),
        jsonb_build_object('action', 'dashboard_layout_set',
                           'args', jsonb_build_object('p_slug', p_slug, 'p_panels', v_was)));
    end if;
    return jsonb_build_object('ok', true, 'panels', 0, 'undo', v_undo,
      'note', 'the board was emptied, so it is back to its default');
  end if;

  -- `coalesce(..., 'missing')`, so an absent key is a failure rather than a
  -- NULL that the WHERE clause quietly drops.
  select count(*) into v_bad
    from jsonb_array_elements(p_panels) e
   where coalesce(jsonb_typeof(e), 'missing') <> 'object'
      or coalesce(jsonb_typeof(e -> 'id'), 'missing') <> 'string'
      or coalesce(jsonb_typeof(e -> 'x'), 'missing') <> 'number'
      or coalesce(jsonb_typeof(e -> 'y'), 'missing') <> 'number'
      or coalesce(jsonb_typeof(e -> 'w'), 'missing') <> 'number'
      or coalesce(jsonb_typeof(e -> 'h'), 'missing') <> 'number';
  if v_bad > 0 then
    return jsonb_build_object('error',
      format('%s panel(s) are not {id, x, y, w, h} -- nothing was saved', v_bad));
  end if;

  insert into public.dashboard_layouts (project_id, owner, panels, updated_at)
  values (v_project, 'grant', p_panels, now())
  on conflict (owner, project_id)
    do update set panels = excluded.panels, updated_at = now();

  /*
    There are two inverses here and they are different operations.

    If an arrangement existed, undo restores it. If there was NONE — this is
    the first time the board has been arranged — undo has to REMOVE the row,
    not write an empty one, because a saved empty arrangement and no saved
    arrangement are different states: the second falls back to the default and
    the first does not. `dashboard_layout_reset` is that operation and it
    already exists.
  */
  if v_was is null then
    v_undo := app.undo_offer(
      'dashboard.layout',
      format('Arranged the board on %s', p_slug),
      jsonb_build_object('action', 'dashboard_layout_reset',
                         'args', jsonb_build_object('p_slug', p_slug)));
  elsif v_was is distinct from p_panels then
    v_undo := app.undo_offer(
      'dashboard.layout',
      format('Rearranged the board on %s', p_slug),
      jsonb_build_object('action', 'dashboard_layout_set',
                         'args', jsonb_build_object('p_slug', p_slug, 'p_panels', v_was)));
  end if;

  return jsonb_build_object('ok', true, 'panels', jsonb_array_length(p_panels), 'undo', v_undo);
end;
$function$;

-- 6. Detaching a source.
create or replace function app.hq_detach(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_project uuid;
  v_was_enabled boolean;
  v_was_reason  text;
  v_what        text;
  v_undo        uuid;
begin
  select project_id, enabled, disabled_reason, coalesce(display_name, external_ref)
    into v_project, v_was_enabled, v_was_reason, v_what
    from public.project_attachments where attachment_id = p_attachment_id;
  if v_project is null then return jsonb_build_object('error', 'no such attachment'); end if;

  -- Disabled, not deleted, and the documents it fed are untouched. ADR-0013:
  -- closing a route loses the route, never the corpus.
  update public.project_attachments
     set enabled = false, disabled_reason = 'detached from Team HQ'
   where attachment_id = p_attachment_id;

  -- Detaching something already detached changes nothing, so there is nothing
  -- to take back.
  if v_was_enabled then
    v_undo := app.undo_offer(
      'attachment.detach',
      format('Detached %s', left(coalesce(v_what, 'a source'), 60)),
      jsonb_build_object('action', 'reattach',
                         'args', jsonb_build_object(
                           'p_attachment_id', p_attachment_id::text,
                           'p_reason', v_was_reason)));
  end if;

  return jsonb_build_object('detached', p_attachment_id, 'undo', v_undo);
end;
$function$;

-- 7. Disconnecting a service. Recorded as impossible, with the reason.
--
--    Patched by wrapping rather than by restating: `hq_disconnect` is ninety
--    lines of per-service wording and copying it here to add three would be
--    four chances to mistype somebody's revocation URL. The inner function
--    keeps its name and its body; this decides only whether an offer is made.
create or replace function app.hq_disconnect_recording(p_service text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_result jsonb;
begin
  v_result := app.hq_disconnect(p_service);
  -- A refusal changed nothing, so there is nothing to say about undo.
  if v_result ? 'error' then return v_result; end if;

  perform app.undo_none(
    'service.disconnect',
    format('Disconnected %s — the credential was deleted and cannot be put back from here',
           coalesce(v_result ->> 'service', p_service)));

  return v_result || jsonb_build_object('undo', null);
end;
$$;

create or replace function public.hq_disconnect(p_service text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_disconnect_recording(p_service) $$;

-- ---------------------------------------------------------------------------
-- Pressing Undo
-- ---------------------------------------------------------------------------

/**
 * Take something back.
 *
 * Idempotent under a double tap, because `app.request_undo` is: the second
 * press is TOLD what the first one did rather than being given an error, and
 * only one of them performs the reversal.
 */
create or replace function app.hq_undo(p_action_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id       uuid;
  v_action   public.undoable_actions;
  v_outcome  public.undo_status;
  v_args     jsonb;
  v_did      jsonb;
begin
  begin
    v_id := p_action_id::uuid;
  exception when others then
    return jsonb_build_object('error', 'that is not an action id');
  end;

  select * into v_action from public.undoable_actions where action_id = v_id;
  if not found then
    return jsonb_build_object('error', 'there is nothing here to undo');
  end if;

  v_outcome := app.request_undo(v_id, 'grant', 'studio');

  if v_outcome <> 'undone' then
    -- Not a failure. A lapsed offer and an already-undone action are both
    -- normal, and both need words the page can show without alarm.
    return jsonb_build_object('ok', false, 'outcome', v_outcome,
      'note', case v_outcome
        when 'expired'      then 'That offer has lapsed.'
        when 'not_undoable' then 'That one cannot be undone.'
        else 'Already undone.' end);
  end if;

  /*
    From here on we are performing the reversal, and nothing it calls may
    record an undo of its own. Transaction-local, so it lifts by itself.
  */
  perform set_config('app.undoing', '1', true);

  v_args := v_action.reversal -> 'args';
  case v_action.reversal ->> 'action'
    when 'rename_project' then
      v_did := app.hq_rename_project(v_args ->> 'p_slug', v_args ->> 'p_name');
    when 'task_state' then
      v_did := app.hq_task_state(v_args ->> 'p_task_id', v_args ->> 'p_state',
                                 v_args ->> 'p_reason');
    when 'task_update' then
      v_did := app.hq_task_update(
        v_args ->> 'p_task_id', v_args ->> 'p_title', v_args ->> 'p_detail',
        (v_args ->> 'p_due_on')::date, (v_args ->> 'p_starts_on')::date,
        v_args ->> 'p_assignee', v_args ->> 'p_parent',
        (v_args ->> 'p_milestone')::boolean, (v_args ->> 'p_priority')::int,
        coalesce(
          (select array_agg(x #>> '{}') from jsonb_array_elements(v_args -> 'p_clear') x),
          array[]::text[]));
    when 'project_look' then
      v_did := app.hq_project_look(
        v_args ->> 'p_slug', v_args ->> 'p_icon', v_args ->> 'p_hue', null,
        coalesce(
          (select array_agg(x #>> '{}') from jsonb_array_elements(v_args -> 'p_clear') x),
          array[]::text[]));
    when 'dashboard_layout_set' then
      v_did := app.hq_dashboard_layout_set(v_args ->> 'p_slug', v_args -> 'p_panels');
    when 'dashboard_layout_reset' then
      v_did := app.hq_dashboard_layout_reset(v_args ->> 'p_slug');
    when 'reattach' then
      v_did := app.hq_reattach((v_args ->> 'p_attachment_id')::uuid, v_args ->> 'p_reason');
    else
      -- A reversal naming something this function cannot perform is a bug in
      -- whoever recorded it, and raising rolls back the claim so the offer is
      -- not silently consumed.
      raise exception 'no way to perform the reversal %', v_action.reversal ->> 'action'
        using errcode = 'feature_not_supported';
  end case;

  /*
    The inner RPCs answer a refusal as `{"error": ...}` rather than raising.
    Left alone, that would leave the action marked undone with nothing
    reversed — the worst outcome available, because the interface would say it
    worked. Raise, so the claim rolls back with it and the offer survives.
  */
  if v_did ? 'error' then
    raise exception 'could not undo: %', v_did ->> 'error'
      using errcode = 'raise_exception';
  end if;

  return jsonb_build_object('ok', true, 'outcome', 'undone',
    'kind', v_action.kind, 'note', format('Undone — %s', v_action.description));
end;
$$;

comment on function app.hq_undo is
  'Performs the exact inverse recorded when the action happened. Raises if the '
  'reversal fails, so the claim rolls back with it: either the world moved back '
  'and the row says undone, or neither did.';

create or replace function public.hq_undo(p_action_id text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_undo(p_action_id) $$;

commit;
