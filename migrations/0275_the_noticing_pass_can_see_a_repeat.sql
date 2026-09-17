-- 0275 — the noticing pass can see a failure it has seen before
--
-- 0274 gave the office a memory for failures: `failure_signatures` counts a
-- repeat instead of logging it again. Nothing read it.
--
-- That is #72's shape, produced for the third time this week, and #132 says
-- exactly where the mouth belongs:
--
--   > "this has failed the same way eleven times in three days" is a
--   > recommendation, and it is exactly the kind of thing `app.notice()` was
--   > built to surface.
--
-- ## Weight 75
--
-- Below `deadline_unowned` (80): a date that is about to pass is more urgent
-- than a thing that keeps breaking. Above `capability_missing` (70) and
-- `project_quiet` (55): something failing repeatedly is a live fault, and a
-- quiet project is merely still.
--
-- ## Three, and a fortnight
--
-- Two is a coincidence. A month-old signature is history rather than news, and
-- a noticing pass that raises history is one Grant stops reading.
--
-- ## The subject_ref is the signature, not the job
--
-- 0210's dismissal machinery is keyed on `(kind, project_id, subject_ref)`, so
-- a suggestion dismissed once must not come back the next time the same thing
-- fails. Keying on the job id would do precisely that -- a new job every hour,
-- a new suggestion every hour, and the dismissal never matching. The signature
-- is the identity, which is the whole reason 0274 made it the primary key.
--
-- The body below is `pg_get_functiondef` output with one branch added.

begin;

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
         where tk.project_id = l.project_id and not tk.is_fixture
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
     where not tk.is_fixture
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
           format('We have been unable to %s %s times in the last fortnight.',
                  replace(i.needed, '-', ' '), i.times),
           jsonb_build_object('times', i.times, 'who', i.staff_slug),
           70,
           null::text, null::jsonb
      from public.impediments_tally(14, 3) i
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

commit;
