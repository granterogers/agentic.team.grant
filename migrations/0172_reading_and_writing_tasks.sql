-- Reading and writing tasks.
--
-- 0171 made the table. This makes it reachable, which is a separate job in this
-- database for a reason that has bitten before: **PostgREST only exposes the
-- `public` schema**, so an `app.*` function is invisible to every caller that
-- is not the service role. Every one below therefore ships with its public
-- wrapper in the same migration, so the pair can never drift apart.
--
-- The other trap this file is written against: `create or replace function`
-- does NOT replace a function whose argument list changed — it creates a second
-- overload and every call becomes ambiguous. So each is dropped by exact
-- signature first, wrapper included. The wrapper is the half that silently
-- keeps the old arity.
--
-- ## Grouping is done here, not in the client
--
-- `app.project_tasks` returns the four groups Grant's IA names, in the order he
-- names them, already sorted. The alternative is every caller — the studio, the
-- API, an agent, the phone — re-implementing the same sort and disagreeing about
-- it. §11 of the frontend spec says UI action = API operation = agent-accessible
-- operation; that only holds if they are all reading the same shape.

begin;

-- --- read -------------------------------------------------------------------

drop function if exists app.project_tasks(uuid);
create function app.project_tasks(p_project uuid)
returns table (
  task_id uuid, title text, detail text, state text, blocked_on text,
  assignee_slug text, assignee_name text, assigned_to_human boolean,
  priority int, due_on date, is_milestone boolean, parent_task_id uuid,
  added_by text, created_at timestamptz, done_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select t.task_id, t.title, t.detail, t.state, t.blocked_on,
         s.slug, s.name, t.assigned_to_human,
         t.priority, t.due_on, t.is_milestone, t.parent_task_id,
         t.added_by, t.created_at, t.done_at
    from public.tasks t
    left join public.staff s on s.staff_id = t.assignee_staff
   where t.project_id = p_project
     and not t.is_fixture
   order by
     -- His order: what is stuck, what is moving, what is next, what is done.
     case t.state when 'blocked' then 0 when 'doing' then 1
                  when 'todo' then 2 when 'done' then 3 else 4 end,
     -- Then by when it actually matters. Nulls last: a task with no date is
     -- not more urgent than one with a date, which `order by due_on` alone
     -- would claim in Postgres's default ascending-nulls-last… except for
     -- descending sorts, so it is stated rather than relied upon.
     t.due_on asc nulls last,
     t.priority asc,
     t.created_at asc
$$;

drop function if exists public.project_tasks(uuid);
create function public.project_tasks(p_project uuid)
returns table (
  task_id uuid, title text, detail text, state text, blocked_on text,
  assignee_slug text, assignee_name text, assigned_to_human boolean,
  priority int, due_on date, is_milestone boolean, parent_task_id uuid,
  added_by text, created_at timestamptz, done_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select * from app.project_tasks(p_project)
$$;

-- --- write ------------------------------------------------------------------

drop function if exists app.add_task(uuid, text, text, text, text, date, boolean, int, uuid);
create function app.add_task(
  p_project uuid,
  p_title   text,
  p_detail  text default '',
  p_assignee_slug text default null,   -- a staff slug, or null
  p_added_by      text default 'grant',
  p_due_on        date default null,
  p_for_human     boolean default false,
  p_priority      int default 100,
  p_job           uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_staff uuid;
  v_id    uuid;
begin
  if p_assignee_slug is not null then
    select staff_id into v_staff from public.staff where slug = p_assignee_slug and active;
    -- A named assignee that does not exist is a caller bug, not a task with no
    -- owner. Failing loudly here is cheaper than a task nobody is watching.
    if v_staff is null then
      raise exception 'no active staff with slug %', p_assignee_slug;
    end if;
  end if;

  insert into public.tasks
    (project_id, title, detail, assignee_staff, assigned_to_human,
     added_by, due_on, priority, job_id)
  values
    (p_project, p_title, coalesce(p_detail, ''), v_staff, p_for_human,
     p_added_by, p_due_on, p_priority, p_job)
  returning task_id into v_id;

  return v_id;
end $$;

drop function if exists public.add_task(uuid, text, text, text, text, date, boolean, int, uuid);
create function public.add_task(
  p_project uuid, p_title text, p_detail text default '',
  p_assignee_slug text default null, p_added_by text default 'grant',
  p_due_on date default null, p_for_human boolean default false,
  p_priority int default 100, p_job uuid default null
) returns uuid
language sql security definer set search_path = '' as $$
  select app.add_task(p_project, p_title, p_detail, p_assignee_slug,
                      p_added_by, p_due_on, p_for_human, p_priority, p_job)
$$;

drop function if exists app.set_task_state(uuid, text, text);
create function app.set_task_state(p_task uuid, p_state text, p_blocked_on text default '')
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  -- The table's own constraint refuses a blocked task with no reason. Saying so
  -- here too turns a constraint violation into a sentence a caller can show.
  if p_state = 'blocked' and length(btrim(coalesce(p_blocked_on, ''))) = 0 then
    raise exception 'a blocked task must say what it is blocked on';
  end if;

  update public.tasks
     set state = p_state,
         blocked_on = case when p_state = 'blocked' then p_blocked_on else '' end
   where task_id = p_task;

  return found;
end $$;

drop function if exists public.set_task_state(uuid, text, text);
create function public.set_task_state(p_task uuid, p_state text, p_blocked_on text default '')
returns boolean
language sql security definer set search_path = '' as $$
  select app.set_task_state(p_task, p_state, p_blocked_on)
$$;

commit;
