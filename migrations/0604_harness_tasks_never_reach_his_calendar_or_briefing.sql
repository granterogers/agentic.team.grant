-- 0604: harness tasks never become Grant's calendar or his briefing (#379, #380).
--
-- 0603 decides whether WORK may touch the outside world by where the work came
-- from. Two duties are trusted work that carry task CONTENT outward:
--
--   app.calendar_task_plan  what google.write_calendar_tasks puts in his real
--                           Google Calendar (dormant: calendar.sync_tasks is
--                           false, and the plan is what switching it on would
--                           write);
--   app.notice              the project_quiet and deadline_unowned lines of his
--                           morning briefing.
--
-- Both filtered tasks by tasks.is_fixture, which is generated from added_by and
-- misses a task a harness JOB created through a real door. app.harness_task
-- (0597) is the canonical question, and app.reminders_due already asks it.
-- Spliced from the live definitions; only those filters change.

CREATE OR REPLACE FUNCTION app.calendar_task_plan()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with wanted as (
    select t.task_id,
           t.title,
           t.detail,
           t.due_on,
           p.name as project,
           md5(coalesce(t.title, '') || '|' || coalesce(t.due_on::text, '') || '|' ||
               coalesce(t.detail, '') || '|' || coalesce(p.name, '')) as hash
      from public.tasks t
      join public.projects p on p.project_id = t.project_id
     where t.due_on is not null
       and t.state in ('todo', 'doing', 'blocked')
       and not app.harness_task(t.is_fixture, t.job_id)
       and not p.is_fixture
  )
  select jsonb_build_object(
    'create', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id', w.task_id, 'title', w.title, 'detail', w.detail,
               'due_on', w.due_on, 'project', w.project, 'hash', w.hash))
        from wanted w
        left join public.task_calendar_links l on l.task_id = w.task_id
       where l.task_id is null), '[]'::jsonb),
    'update', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id', w.task_id, 'title', w.title, 'detail', w.detail,
               'due_on', w.due_on, 'project', w.project, 'hash', w.hash,
               'calendar_id', l.calendar_id, 'event_id', l.event_id))
        from wanted w
        join public.task_calendar_links l on l.task_id = w.task_id
       where l.pushed_hash is distinct from w.hash), '[]'::jsonb),
    -- A link whose task is no longer wanted. The task row may still exist
    -- (done, cancelled, or its date removed) or may be gone entirely, and the
    -- cascade takes care of the second case before we ever see it.
    'remove', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id', l.task_id, 'calendar_id', l.calendar_id, 'event_id', l.event_id))
        from public.task_calendar_links l
        left join wanted w on w.task_id = l.task_id
       where w.task_id is null), '[]'::jsonb)
  )
$function$;

CREATE OR REPLACE FUNCTION app.notice(p_limit integer DEFAULT 12)
 RETURNS TABLE(kind text, project_id uuid, subject_ref text, body text, because jsonb, weight integer, offer_kind text, offer_args jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with live as (
    select p.project_id, p.name, p.updated_at
      from public.projects p
     where p.status = 'active' and not p.is_fixture
  ),

  /*
    Everything settled recently enough to still count as answered.

    Keyed on the identity, never on the wording — that is the whole point of
    the shape 0210 chose. `state = 'open'` is in here too: an observation
    already sitting unanswered on the dashboard should not be raised a second
    time as though it were new.
  */
  answered as (
    select s.kind, coalesce(s.project_id::text, '') as pid, s.subject_ref
      from public.suggestions s
     where s.state = 'open'
        or (s.state = 'dismissed'
            and s.settled_at > app.now_utc()
                               - (greatest(s.dismissals, 1) * interval '14 days'))
        or (s.state = 'acted'
            and s.settled_at > app.now_utc() - interval '7 days')
  ),

  quiet as (
    select 'project_quiet'::text as kind, l.project_id, ''::text as subject_ref,
           format('%s has not moved in %s days, with %s open %s.',
                  l.name,
                  round(extract(epoch from (app.now_utc() - l.updated_at)) / 86400),
                  t.open_count,
                  case when t.open_count = 1 then 'task' else 'tasks' end) as body,
           jsonb_build_object('days',
             round(extract(epoch from (app.now_utc() - l.updated_at)) / 86400),
             'open_tasks', t.open_count) as because,
           55 as weight,
           null::text as offer_kind, null::jsonb as offer_args
      from live l
      join lateral (
        select count(*) filter (where tk.state in ('todo', 'doing', 'blocked')) as open_count
          from public.tasks tk
         where tk.project_id = l.project_id and not app.harness_task(tk.is_fixture, tk.job_id)
      ) t on true
     where l.updated_at < app.now_utc() - interval '14 days'
       and t.open_count > 0
  ),

  looming as (
    select 'deadline_unowned'::text, tk.project_id, tk.task_id::text,
           format('“%s” is due %s and nobody is on it.',
                  left(tk.title, 90), to_char(tk.due_on, 'FMDay DD Mon')),
           jsonb_build_object('due_on', tk.due_on),
           80,
           null::text, null::jsonb
      from public.tasks tk
      join live l on l.project_id = tk.project_id
     where not app.harness_task(tk.is_fixture, tk.job_id)
       and tk.state in ('todo', 'doing')
       and tk.due_on is not null
       and tk.due_on <= (app.now_utc() at time zone app.grant_timezone())::date + 7
       and tk.assignee_staff is null
       and not tk.assigned_to_human
  ),

  idle_source as (
    select 'source_unused'::text, a.project_id, a.attachment_id::text,
           format('%s has been attached to %s since %s and has produced nothing.',
                  coalesce(nullif(a.display_name, ''), a.connector),
                  l.name, to_char(a.created_at, 'FMDD Mon')),
           jsonb_build_object('connector', a.connector,
                              'attached_days',
                              round(extract(epoch from (app.now_utc() - a.created_at)) / 86400)),
           45,
           null::text, null::jsonb
      from public.project_attachments a
      join live l on l.project_id = a.project_id
     where a.enabled
       and a.created_at < app.now_utc() - interval '7 days'
       and not exists (
         select 1 from public.documents d
          where d.project_id = a.project_id
            and coalesce(d.connector, '') = a.connector
       )
  ),

  /*
    A failure the office has seen before (#132, migration 0274).

    #132: *"this has failed the same way eleven times in three days is a
    recommendation, and it is exactly the kind of thing app.notice() was built
    to surface."* Until this branch existed, `failure_signatures` was a table
    nobody read -- the mechanism built and the mouth forgotten, which is #72's
    shape and which this repository keeps producing.

    Weighted at 75: below a deadline nobody owns, above a quiet project. A
    thing that keeps breaking is more urgent than a thing that is merely still,
    and less urgent than a date that is about to pass.

    Only three or more, and only within a fortnight. Two is a coincidence and
    a month-old signature is history rather than news.
  */
  repeated_failure as (
    select 'failure_repeats'::text, null::uuid,
           -- Kind and class, never the message. The signature IS the identity,
           -- so the suggestion is answered per signature rather than per job.
           format('%s:%s%s', f.job_kind, f.error_class,
                  case when f.subject = '' then '' else ':' || f.subject end),
           format('%s has failed the same way (%s) %s times since %s. Nothing about '
                  || 'the next attempt will be different.',
                  f.job_kind, replace(f.error_class, '_', ' '), f.seen,
                  to_char(f.first_seen, 'FMDD Mon')),
           jsonb_build_object('times', f.seen, 'class', f.error_class,
                              'since', f.first_seen, 'last_job', f.last_job_id),
           75,
           null::text, null::jsonb
      from app.recurring_failures(3, 14) f
  ),

  blocked_capability as (
    select 'capability_missing'::text, null::uuid, i.needed,
           /*
             `could not:` reads for a noun AND a verb phrase (0474, 0577).
             "We have been unable to an answer the database will accept" was
             on his page; half of what `needed` holds is a noun.
           */
           format('Could not: %s — %s times in the last fortnight.',
                  replace(i.needed, '-', ' '), i.times),
           jsonb_build_object('times', i.times, 'who', i.staff_slug),
           70,
           null::text, null::jsonb
      from public.impediments_tally(14, 3) i
     /*
       NOT the coherence gate refusing an answer (0474's rule, carried across).

       `not_capable` is overwhelmingly #185's gate declining to let the office
       claim something it did not do. That is the gate working, there is
       nothing in it for Grant to approve, and offering it to him as a
       capability he might grant reads as the office asking permission to
       fabricate.
     */
     where i.kind <> 'not_capable'
  )

  select k.kind, k.project_id, k.subject_ref, k.body, k.because,
         k.weight, k.offer_kind, k.offer_args
    from (
      select * from looming
      union all select * from repeated_failure
      union all select * from blocked_capability
      union all select * from quiet
      union all select * from idle_source
    ) as k (kind, project_id, subject_ref, body, because, weight, offer_kind, offer_args)
   where not exists (
     select 1 from answered a
      where a.kind = k.kind
        and a.pid = coalesce(k.project_id::text, '')
        and a.subject_ref = k.subject_ref
   )
   order by k.weight desc
   limit greatest(coalesce(p_limit, 12), 1)
$function$;
