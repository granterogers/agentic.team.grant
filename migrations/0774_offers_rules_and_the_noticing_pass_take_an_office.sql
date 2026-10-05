-- 0774 - offers, standing rules and the noticing pass take an office (multi-user P3, cluster g-context).
--
-- What the office offers to learn (a standing rule, a procedure) and what it notices on its own (a quiet project, an
-- unowned deadline, a failure that keeps happening) is built from a person's own projects, tasks, failures and
-- impediments. A suggestion is a carrier (suggestions.office_id), and the dedupe that decides "already offered once"
-- must be the office's own: one office's open offer must never make another office's identical offer read "already
-- offered", nor fail it with a unique violation that names the first.
--
--   app.propose_standing_rule / propose_standing_procedure (office, ...)
--   app.raise_suggestions (office, limit)  <-  app.notice (office, limit)
--   app.recurring_failures / impediments_tally / reach_wanted / needs_me_pressure (office, ...)  - the noticing pass's inputs
--
-- THE ONE DDL IN THIS CLUSTER: suggestions_one_open (kind, project, subject_ref) is a GLOBAL unique index, and
-- briefings_one_per_day (kind, scope_ref, for_date) likewise. A writer that answers from its own office's rows still
-- hits the other office's row at the index (an insert refused, or silently skipped by ON CONFLICT DO NOTHING). Both
-- gain office_id as their first column. raise_suggestions is the only ON CONFLICT user of the first, write_briefing the
-- only one of the second, and both are rewritten here.
--
-- Left in place on purpose until their last callers move (the lead drops them): app.recurring_failures(integer, integer),
-- app.impediments_tally(integer, integer, boolean), app.reach_wanted() and public.reach_wanted() (the governance page
-- and public.impediments_tally still read them). app.notice(integer) and the old raise_suggestions are dropped here; the
-- old app.needs_me_pressure() goes in 0775 with the briefing facts that were its only caller.

drop index public.suggestions_one_open;
create unique index suggestions_one_open on public.suggestions (office_id, kind, (coalesce(project_id::text, '')), subject_ref)
  where state = 'open';
drop index public.briefings_one_per_day;
create unique index briefings_one_per_day on public.briefings (office_id, kind, scope_ref, for_date);

create function app.recurring_failures(p_office uuid, p_least integer DEFAULT 3, p_days integer DEFAULT 14)
 RETURNS TABLE(job_kind text, error_class text, subject text, seen integer, first_seen timestamp with time zone, last_seen timestamp with time zone, last_job_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  perform app.require_office(p_office);
  return query
  select f.job_kind, f.error_class, f.subject, f.seen, f.first_seen, f.last_seen, f.last_job_id
    from public.failure_signatures f
   -- Belt and braces with the writer (0491): a signature whose last job is
   -- a suite's never reaches Grant, however it got into the table.
   where f.office_id = p_office
     and f.last_job_id is not null
     and not app.harness_job(f.last_job_id)
     -- And a kind the office has never run is not something that failed.
     -- The writer composes this from jobs.kind, so a real one always matches.
     and exists (select 1 from public.jobs j where j.kind = f.job_kind and j.office_id = p_office)
     and f.seen >= greatest(coalesce(p_least, 3), 2)
     and f.last_seen > app.now_utc() - make_interval(days => coalesce(p_days, 14))
   order by f.seen desc, f.last_seen desc;
end
$function$;

revoke all on function app.recurring_failures(uuid, integer, integer) from public, anon, authenticated, service_role;

create or replace function app.impediments_tally(p_office uuid, p_days integer DEFAULT 30, p_min integer DEFAULT 2, p_include_fixtures boolean DEFAULT false)
 RETURNS TABLE(kind impediment_kind, needed text, staff_slug text, times integer, first_seen timestamp with time zone, last_seen timestamp with time zone, projects integer, for_instance text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select i.kind,
         i.needed,
         i.staff_slug,
         count(*)::int                        as times,
         min(i.created_at)                    as first_seen,
         max(i.created_at)                    as last_seen,
         count(distinct i.project_id)::int    as projects,
         (array_agg(i.detail order by i.created_at desc)
            filter (where btrim(i.detail) <> ''))[1] as for_instance
    from public.job_impediments i
    -- an impediment is the office's through its job; one with no job cannot be shown to be anybody's, and is not counted
    join public.jobs j on j.job_id = i.job_id and j.office_id = app.require_office(p_office)
   where (
           coalesce(p_include_fixtures, false)
           -- Either witness may exclude; neither may include. See the header.
           or not (coalesce(j.is_fixture, false) or i.is_fixture)
         )
     and i.created_at >= app.now_utc() - make_interval(days => greatest(coalesce(p_days, 30), 1))
   group by i.kind, i.needed, i.staff_slug
  having count(*) >= greatest(coalesce(p_min, 2), 1)
   order by count(*) desc, max(i.created_at) desc
$function$;

revoke all on function app.impediments_tally(uuid, integer, integer, boolean) from public, anon, authenticated, service_role;

create function app.reach_wanted(p_office uuid)
 returns table(request_id uuid, tool text, asked_by text, what_for text, because jsonb, exists_yet boolean, raised_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select r.request_id, r.tool, r.asked_by, r.what_for, r.because,
         exists (select 1 from public.tool_permissions t where t.tool = r.tool),
         r.raised_at
    from public.tool_requests r
   where r.office_id = app.require_office(p_office)
     and r.state = 'open'
   order by r.raised_at
$function$;
revoke all on function app.reach_wanted(uuid) from public, anon, authenticated, service_role;

create function app.needs_me_pressure(p_office uuid)
 returns table(open_items integer, cap integer, suppressed integer, oldest_days numeric)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select
    count(*)::int,
    app.needs_me_cap(),
    greatest(count(*)::int - app.needs_me_cap(), 0),
    coalesce(round(extract(epoch from (app.now_utc() - min(created_at))) / 86400, 1), 0)
  from public.blockers
  where office_id = app.require_office(p_office)
    and state = 'open'
    and not coalesce(app.harness_job(job_id), false);
$function$;
revoke all on function app.needs_me_pressure(uuid) from public, anon, authenticated, service_role;

create function app.notice(p_office uuid, p_limit integer DEFAULT 12)
 RETURNS TABLE(kind text, project_id uuid, subject_ref text, body text, because jsonb, weight integer, offer_kind text, offer_args jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with live as (
    select p.project_id, p.name, p.updated_at
      from public.projects p
     where p.office_id = app.require_office(p_office)
       and p.status = 'active' and not p.is_fixture
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
     where s.office_id = p_office
       and (s.state = 'open'
        or (s.state = 'dismissed'
            and s.settled_at > app.now_utc()
                               - (greatest(s.dismissals, 1) * interval '14 days'))
        or (s.state = 'acted'
            and s.settled_at > app.now_utc() - interval '7 days'))
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
         where tk.project_id = l.project_id and tk.office_id = p_office
           and not app.harness_task(tk.is_fixture, tk.job_id)
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
     where tk.office_id = p_office
       and not app.harness_task(tk.is_fixture, tk.job_id)
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
            and d.office_id = p_office
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
      from app.recurring_failures(p_office, 3, 14) f
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
      from app.impediments_tally(p_office, 14, 3) i
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

revoke all on function app.notice(uuid, integer) from public, anon, authenticated, service_role;

create function app.raise_suggestions(p_office uuid, p_limit integer DEFAULT 6)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  n integer;
  raised uuid[];
begin
  perform app.require_office(p_office);
  with put as (
    insert into public.suggestions
      (office_id, project_id, kind, subject_ref, body, because, weight, offer_kind, offer_args)
    select p_office, s.project_id, s.kind, s.subject_ref, s.body, s.because,
           s.weight, s.offer_kind, s.offer_args
      from app.notice(p_office, p_limit) s
    on conflict (office_id, kind, (coalesce(project_id::text, '')), subject_ref)
      where state = 'open'
      do nothing
    returning suggestion_id
  )
  select count(*)::integer, coalesce(array_agg(suggestion_id), '{}')
    into n, raised
    from put;

  /*
    One event for the pass, not one per suggestion.

    A noticing pass that found four things is one act of noticing, and four
    ledger rows would make the daily volume of "the office thought about itself"
    four times what it is. The ids are in the row, so the detail is not lost.
  */
  if n > 0 then
    perform app.append_event(
      p_office, extensions.gen_random_uuid(), 'agent', 'chief-of-staff', 'noticing',
      'office.noticed', true, null, null,
      jsonb_build_object('raised', n, 'suggestion_ids', raised),
      format('Raised %s observation%s nobody asked for.', n,
             case when n = 1 then '' else 's' end),
      '[]'::jsonb, null, null,
      'update public.suggestions set state = ''dismissed'' — or the dashboard',
      null);
  end if;

  return n;
end;
$function$;

revoke all on function app.raise_suggestions(uuid, integer) from public, anon, authenticated, service_role;

create function app.propose_standing_procedure(p_office uuid, p_name text, p_when text, p_procedure text, p_scope text DEFAULT 'global'::text, p_staff text DEFAULT NULL::text, p_project_id uuid DEFAULT NULL::uuid, p_from_job uuid DEFAULT NULL::uuid, p_because jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_proc text := btrim(coalesce(p_procedure, ''));
  v_staff text := nullif(btrim(coalesce(p_staff, '')), '');
  v_ref text;
  v_id uuid;
begin
  perform app.require_office(p_office);
  -- A project of another office is refused exactly as one that does not exist is.
  if p_project_id is not null and app.office_project(p_office, p_project_id) is null then
    return jsonb_build_object('error', 'no such project');
  end if;
  if length(v_name) < 3 or length(v_proc) < 12 then
    return jsonb_build_object('error', 'a procedure needs a name and something to do');
  end if;
  if p_scope not in ('global', 'project', 'staff') then
    return jsonb_build_object('error', format('%L is not a scope a procedure can be offered at', p_scope));
  end if;
  if p_scope = 'project' and p_project_id is null then
    return jsonb_build_object('error', 'a project procedure needs a project');
  end if;
  if p_scope = 'staff' and v_staff is null then
    return jsonb_build_object('error', 'a procedure for one person needs to say who');
  end if;
  v_ref := left(regexp_replace(lower(v_name || ' ' || v_proc), '[^a-z0-9]+', '-', 'g'), 120);
  -- Any row, not only an open one: a declined procedure must not come back.
  if exists (select 1 from public.suggestions s where s.office_id = p_office and s.kind = 'standing_procedure' and s.subject_ref = v_ref) then
    return jsonb_build_object('offered', false, 'why', 'already offered once');
  end if;
  insert into public.suggestions (office_id, project_id, kind, subject_ref, body, because, weight, offer_kind, offer_args)
  values (p_office, p_project_id, 'standing_procedure', v_ref,
          left(format('%s: %s', v_name, v_proc), 400), coalesce(p_because, '{}'::jsonb), 3, 'teach_skill',
          jsonb_build_object('name', v_name, 'when', btrim(coalesce(p_when, '')), 'procedure', v_proc,
                             'scope', p_scope, 'staff', case when p_scope = 'staff' then v_staff end,
                             'project_id', case when p_scope = 'project' then p_project_id end,
                             'from_job', p_from_job))
  returning suggestion_id into v_id;
  return jsonb_build_object('offered', true, 'suggestion', v_id, 'name', v_name);
end;
$function$;

revoke all on function app.propose_standing_procedure(uuid, text, text, text, text, text, uuid, uuid, jsonb) from public, anon, authenticated, service_role;

create function app.propose_standing_rule(p_office uuid, p_body text, p_scope text DEFAULT 'global'::text, p_staff text DEFAULT NULL::text, p_project_id uuid DEFAULT NULL::uuid, p_from_job uuid DEFAULT NULL::uuid, p_because jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_body    text := btrim(coalesce(p_body, ''));
  v_staff   text := nullif(btrim(coalesce(p_staff, '')), '');
  v_ref     text;
  v_id      uuid;
  v_target  jsonb;
begin
  perform app.require_office(p_office);
  -- A project of another office is refused exactly as one that does not exist is.
  if p_project_id is not null and app.office_project(p_office, p_project_id) is null then
    return jsonb_build_object('error', 'no such project');
  end if;
  if length(v_body) < 12 then
    return jsonb_build_object('error', 'a standing rule needs to say something');
  end if;
  /*
    The scopes the PRESS can perform, which is a shorter list than the enum.

    'kind' is a real member of `lesson_scope` and is refused here for a reason
    about this function rather than about the enum: a kind-scoped lesson needs
    a `job_kind` and an offer carries no way to say one. Offer only what the
    press can perform.
  */
  if p_scope not in ('global', 'project', 'staff') then
    return jsonb_build_object('error',
      format('%L is not a scope a standing rule can be offered at', p_scope));
  end if;

  /*
    Exactly one target, chosen by the scope, and the others dropped.

    `lessons_scope_matches_target` permits precisely one non-null per scope, so
    this is not tidying - it is the difference between an offer that can be
    accepted and one that raises 23514 on the press.
  */
  v_target := case p_scope
    when 'project' then jsonb_build_object('project_id', p_project_id, 'staff', null)
    when 'staff'   then jsonb_build_object('project_id', null, 'staff', v_staff)
    else                jsonb_build_object('project_id', null, 'staff', null)
  end;
  if p_scope = 'project' and p_project_id is null then
    return jsonb_build_object('error', 'a project rule needs a project');
  end if;
  if p_scope = 'staff' and v_staff is null then
    return jsonb_build_object('error', 'a rule for one person needs to say who');
  end if;

  /*
    The class, not the sentence.

    Two corrections about the same thing, worded differently, must not produce
    two offers - "offer at most once per correction" is only meaningful if
    similar corrections collapse. The subject is the normalised rule text, so
    punctuation and case do not make a second class.
  */
  v_ref := left(regexp_replace(lower(v_body), '[^a-z0-9]+', '-', 'g'), 120);

  -- Any row, not only an open one. A dismissed offer must not come back.
  if exists (select 1 from public.suggestions s
              where s.office_id = p_office and s.kind = 'standing_rule' and s.subject_ref = v_ref) then
    return jsonb_build_object('offered', false, 'why', 'already offered once');
  end if;

  insert into public.suggestions
    (office_id, project_id, kind, subject_ref, body, because, weight, offer_kind, offer_args)
  values (p_office, p_project_id, 'standing_rule', v_ref, v_body,
          coalesce(p_because, '{}'::jsonb), 3, 'learn',
          v_target || jsonb_build_object('scope', p_scope, 'from_job', p_from_job))
  returning suggestion_id into v_id;

  return jsonb_build_object('offered', true, 'suggestion_id', v_id,
                            'rule', v_body, 'scope', p_scope);
end;
$function$;

revoke all on function app.propose_standing_rule(uuid, text, text, text, uuid, uuid, jsonb) from public, anon, authenticated, service_role;


drop function app.notice(integer);
drop function app.raise_suggestions(integer);
drop function app.propose_standing_rule(text, text, text, uuid, uuid, jsonb);
drop function app.propose_standing_procedure(text, text, text, text, text, uuid, uuid, jsonb);
drop function public.raise_suggestions(integer);
