/*
  0597 - a harness task is never reminded.

  Behavioural remediation, 24 September 2026, ledger R24/R25. The
  conversation now sets remind_at ("remind me at 3pm to call Sarah back"),
  and app.reminders_due excluded fixtures by is_fixture only - which is false
  for every personal task a harness job made. The reminders duty is real
  traffic, so claim_delivery would have let a test session's reminder reach
  Grant. Spliced from the LIVE definition; one predicate changes.

  app.tasks_to_push (outbound task sync) had the identical predicate and
  would push a harness job's personal task to an external provider. Latent:
  no provider is linked today (task_links is empty). Same fix, same file.

  MUST be applied before, or with, the worker that sets remind_at.
*/

CREATE OR REPLACE FUNCTION app.reminders_due(p_grace interval DEFAULT '14 days'::interval)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  /*
    `p_grace` is the floor, not the ceiling: a reminder whose time passed
    while the office was down should still arrive, and one from a fortnight
    ago should not — by then the due date has done the work and a stale
    midnight ping is noise. Fourteen days is long enough to survive any
    outage this office has had and short enough that a backlog cannot
    announce itself as a wall of text.
  */
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.task_id,
           'title', t.title,
           'remind_at', t.remind_at,
           'due_on', t.due_on,
           'project', p.name,
           'overdue', t.due_on is not null
                      and t.due_on < (app.now_utc() at time zone 'UTC')::date
         ) order by t.remind_at), '[]'::jsonb)
    from public.tasks t
    left join public.projects p on p.project_id = t.project_id
   where t.assigned_to_human
     and t.state <> 'done'
     and t.state <> 'cancelled'
     /*
       0597: a HARNESS task is never reminded. is_fixture alone missed every
       personal task a harness job made, because app.my_task_add writes
       added_by 'grant' whoever asked; app.harness_task also reads the job.
       Latent while nothing in the conversation set remind_at - the day it
       could (ledger R24), a test session's reminder would have been sent to
       Grant's real chat by a real duty.
     */
     and not app.harness_task(t.is_fixture, t.job_id)
     and t.remind_at is not null
     and t.reminded_at is null
     and t.remind_at <= app.now_utc()
     and t.remind_at >= app.now_utc() - p_grace
$function$;

CREATE OR REPLACE FUNCTION app.tasks_to_push(p_provider text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with mine as (
    select t.*, l.external_id, l.external_project_id, l.synced_revision
      from public.tasks t
      left join public.task_links l
        on l.task_id = t.task_id and l.provider = p_provider
     where t.assigned_to_human
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
$function$;
