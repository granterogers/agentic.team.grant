/*
  0592 - a retried job does not write its task again.

  Behavioural remediation, 24 September 2026, ledger R2. One message ("add a
  task to renew the insurance by the 30th ...") was refused by a coherence
  gate on four attempts, and each attempt had already called app.my_task_add:
  four identical rows on the list, one job id. A retry means DO THE JOB AGAIN
  (src/jobs/checkpoint.ts says so), so any write a handler performs before the
  answer is judged must be idempotent at the writer.

  Both task writers the conversation uses. Spliced from their LIVE definitions;
  only the early return is new.
*/

CREATE OR REPLACE FUNCTION app.my_task_add(p_title text, p_detail text DEFAULT ''::text, p_due_on date DEFAULT NULL::date, p_remind_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_priority integer DEFAULT 100, p_project text DEFAULT NULL::text, p_labels text[] DEFAULT NULL::text[], p_parent text DEFAULT NULL::text, p_job uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_project uuid;
  v_id uuid;
  v_parent uuid;
  v_why text;
begin
  if v_title = '' then
    return jsonb_build_object('ok', false, 'error', 'a task needs a title');
  end if;

  if coalesce(p_parent, '') <> '' then
    begin
      v_parent := p_parent::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'that is not a task id to put this under');
    end;
    v_why := app.task_parent_ok(v_parent);
    if v_why is not null then
      return jsonb_build_object('ok', false, 'error', v_why);
    end if;
  end if;

  if coalesce(p_project, '') <> '' then
    select project_id into v_project from public.projects
     where slug = p_project and status <> 'archived';
    if v_project is null then
      -- Named, rather than silently filed with no project: a task that quietly
      -- lands in the inbox when Grant said which project it belongs to is a
      -- task he will look for in the wrong place.
      return jsonb_build_object('ok', false,
        'error', format('no active project called %s', p_project));
    end if;
  elsif v_parent is not null then
    /*
      A subtask inherits its parent's project unless told otherwise. Without
      this a subtask of a project task lands in the Inbox, away from the
      parent it belongs to, which is how a relationship becomes a filing
      error.
    */
    select t.project_id into v_project from public.tasks t where t.task_id = v_parent;
  end if;

  /*
    0592: ONE JOB, ONE TASK PER TITLE, HOWEVER MANY ATTEMPTS.

    The handler writes the task before the answer is checked, and a refused
    answer retries the whole job, so every attempt wrote it again: four
    identical rows from one message on 24 September. The writer is the one
    place every caller passes through, so the idempotency lives here. Keyed on
    the job that made it and the title, never on the title alone, so two
    messages asking for the same thing still make two tasks.
  */
  if p_job is not null then
    select t.task_id, t.project_id into v_id, v_project from public.tasks t
     where t.job_id = p_job
       and lower(btrim(t.title)) = lower(v_title)
       and t.state <> 'cancelled'
     order by t.created_at limit 1;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'id', v_id, 'title', v_title,
        'project', coalesce(p_project, ''), 'parent', v_parent, 'existing', true);
    end if;
  end if;

  insert into public.tasks
    (project_id, title, detail, state, priority, due_on, remind_at,
     assigned_to_human, added_by, labels, parent_task_id, job_id)
  values (v_project, v_title, coalesce(p_detail, ''), 'todo',
          greatest(coalesce(p_priority, 100), 1), p_due_on, p_remind_at,
          true, 'grant',
          coalesce((select array(select distinct lower(btrim(x))
                                   from unnest(p_labels) x
                                  where btrim(x) <> '' order by 1)), '{}'::text[]),
          v_parent, p_job)
  returning task_id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'title', v_title,
    'project', coalesce(p_project, ''), 'parent', v_parent);
end;
$function$;

CREATE OR REPLACE FUNCTION app.task_add(p_project uuid, p_title text, p_detail text DEFAULT NULL::text, p_due_on date DEFAULT NULL::date, p_assignee text DEFAULT NULL::text, p_milestone boolean DEFAULT false, p_added_by text DEFAULT 'grant'::text, p_job uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_staff uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_by    text := coalesce(nullif(btrim(p_added_by), ''), 'grant');
  v       jsonb;
begin
  if v_title = '' then
    return jsonb_build_object('error', 'a task needs a title');
  end if;

  if p_project is not null
     and not exists (select 1 from public.projects
                      where project_id = p_project
                        and coalesce(status, '') <> 'archived') then
    return jsonb_build_object('error', 'that project does not exist or is archived');
  end if;

  if coalesce(p_milestone, false) and p_project is null then
    return jsonb_build_object('error',
      'a module belongs to a dashboard project - say which one');
  end if;

  if coalesce(btrim(p_assignee), '') <> '' then
    select staff_id into v_staff from public.staff where slug = btrim(p_assignee);
    if v_staff is null then
      return jsonb_build_object('error', format('nobody here is called %L', btrim(p_assignee)));
    end if;
  end if;

  /*
    Harness traffic names itself, here, once.

    `is_fixture` is GENERATED from `added_by`, so the prefix is the only way to
    set it -- and the job is the only thing that knows. A caller that had to
    remember this would forget, which is the whole history of this defect.
  */
  if p_job is not null and app.harness_job(p_job) then
    v_by := 'verify:' || v_by;
  end if;

  /* 0592: see app.my_task_add - one job, one task per title, whatever the attempt. */
  if p_job is not null then
    select jsonb_build_object(
      'id', t.task_id, 'title', t.title, 'state', t.state, 'due_on', t.due_on,
      'milestone', t.is_milestone, 'fixture', t.is_fixture,
      'project', (select p.slug from public.projects p where p.project_id = t.project_id),
      'existing', true)
      into v
      from public.tasks t
     where t.job_id = p_job
       and lower(btrim(t.title)) = lower(v_title)
       and t.state <> 'cancelled'
     order by t.created_at limit 1;
    if v is not null then
      return v;
    end if;
  end if;

  insert into public.tasks
    (project_id, title, detail, due_on, assignee_staff, added_by, is_milestone, job_id)
  values (p_project, v_title, coalesce(btrim(p_detail), ''), p_due_on, v_staff,
          v_by, coalesce(p_milestone, false), p_job)
  returning jsonb_build_object(
    'id', task_id, 'title', title, 'state', state, 'due_on', due_on,
    'milestone', is_milestone, 'fixture', is_fixture,
    'project', (select p.slug from public.projects p where p.project_id = p_project)
  ) into v;

  return v;
end;
$function$;
