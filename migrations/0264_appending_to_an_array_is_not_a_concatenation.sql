-- 0264 — `text[] || 'a string'` is not appending an element
--
-- 0263 built the clear list for an undo with
--
--     v_clear := v_clear || 'due_on';
--
-- which reads as "append this element" and is not what Postgres does with it.
-- An unquoted-type literal beside an array operand is resolved as an ARRAY
-- literal, so it tries to parse `due_on` as `{...}` and fails:
--
--     malformed array literal: "starts_on"
--     Array value must start with "{" or dimension information.
--
-- `array_append` says what is meant and cannot be read the other way. The cast
-- `'due_on'::text` would also work; the function name is better, because the
-- next person to add a line here does not have to know why the cast is there.
--
-- Caught on the first live round trip rather than by any check, which is the
-- argument for running one before believing a migration: `npm run migrate`
-- applied 0263 happily — a plpgsql body is not resolved until it executes.
--
-- Nothing else in 0263 changes. Both bodies are reproduced verbatim from it
-- with only those seven assignments rewritten.

begin;

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
  if coalesce(v_was.detail, '') = '' then v_clear := array_append(v_clear, 'detail'); end if;
  if v_was.due_on     is null   then v_clear := array_append(v_clear, 'due_on'); end if;
  if v_was.starts_on  is null   then v_clear := array_append(v_clear, 'starts_on'); end if;
  if v_was.assignee   is null   then v_clear := array_append(v_clear, 'assignee'); end if;
  if v_was.parent_task_id is null then v_clear := array_append(v_clear, 'parent'); end if;

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
    if v_icon is null then v_clear := array_append(v_clear, 'icon'); end if;
    if v_hue  is null then v_clear := array_append(v_clear, 'hue'); end if;
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

commit;
