-- 0751 - the read side of the dashboard, part 2: the payloads the studio draws from (multi-user P3, cluster e-views).
--
-- hq_overview, hq_pulse, hq_studio, hq_studio_lately, hq_activity, hq_portfolio_tasks, studio_unseen, studio_team_work,
-- studio_plane, project_history and task_sync_panel take `p_office` first. Every counter, list and feed is filtered by
-- it in the SQL that produces it. A project the office does not own and a project that does not exist answer exactly
-- alike (an empty plane, an empty history). The literal 'grant' owner - on the document order, the dashboard layout,
-- the project-seen mark and the "suggested" test - is the office's actor now. The build log and the Vikunja
-- configuration are the deployment's own and are shown only to its operator.

-- app.hq_activity
create function app.hq_activity(p_office uuid, p_limit integer DEFAULT 50)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  select coalesce(jsonb_agg(row_to_json(a)), '[]'::jsonb) from (
    select c.job_id, j.kind, j.project_id, p.name as project_name,
           c.from_state::text as from_state, c.to_state::text as to_state,
           c.reason, c.attempt, c.occurred_at
    from public.job_state_transitions c
    join public.jobs j on j.job_id = c.job_id and j.office_id = p_office
    left join public.projects p on p.project_id = j.project_id
    order by c.occurred_at desc
    limit least(greatest(p_limit, 1), 200)
  ) a
  );
end
$function$;
revoke all on function app.hq_activity(uuid, integer) from public, anon, authenticated, service_role;

-- public.hq_activity
create function public.hq_activity(p_office uuid, p_limit integer DEFAULT 50)
 returns jsonb
 language sql
 SECURITY DEFINER
 set search_path to ''
as $f$
 select app.hq_activity(p_office, p_limit) 
$f$;

-- app.hq_overview_base
create function app.hq_overview_base(p_office uuid)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  select jsonb_build_object(
    'generated_at', app.now_utc(),
    'counts', jsonb_build_object(
      'live_jobs', (
        select count(*)::int from public.jobs
        where office_id = p_office and state not in ('complete', 'cancelled', 'failed')
      ),
      'needs_me', (select count(*)::int from app.needs_me_in(p_office)),
      'needs_me_overdue', (select count(*)::int from app.needs_me_in(p_office) where overdue),
      'active_projects', (select count(*)::int from public.projects where office_id = p_office and status = 'active'),
      'undo_offers', (select count(*)::int from app.undo_offers_in(p_office))
    ),
    -- Capped, and the cap is reported. A list that silently shows 7 of 40 looks
    -- healthy exactly when it stops being useful.
    'needs_me', coalesce((
      select jsonb_agg(row_to_json(n)) from (
        select blocker_id, project_id, requested_action, why_needed,
               consequences_of_delay, approval_options, real_deadline, overdue,
               work_can_continue, created_at
        from app.needs_me_in(p_office)
        order by overdue desc, real_deadline nulls last, created_at
        limit 20
      ) n
    ), '[]'::jsonb),
    'today', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select job_id, project_id, project_name, kind, state, intent_class,
               priority, state_reason, waiting_on, minutes_since_change
        from app.today_in(p_office)
        order by priority desc, minutes_since_change desc
        limit 40
      ) t
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(row_to_json(p)) from (
        select project_id, slug, name, open_blockers, overdue_blockers,
               live_jobs, failed_jobs_24h, stalled_jobs, hours_since_sync,
               has_brief, brief_is_stale
        from app.project_attention(p_office)
      ) p
    ), '[]'::jsonb)
  )
  );
end
$function$;
revoke all on function app.hq_overview_base(uuid) from public, anon, authenticated, service_role;

-- app.hq_overview
create function app.hq_overview(p_office uuid)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  select app.hq_overview_base(p_office) || jsonb_build_object('calendar', app.calendar_ahead(p_office, 24))
  );
end
$function$;
revoke all on function app.hq_overview(uuid) from public, anon, authenticated, service_role;

-- public.hq_overview
create function public.hq_overview(p_office uuid)
 returns jsonb
 language sql
 SECURITY DEFINER
 set search_path to ''
as $f$
 select app.hq_overview(p_office) 
$f$;

-- app.hq_portfolio_tasks
create function app.hq_portfolio_tasks(p_office uuid, p_limit integer DEFAULT 200)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  with today as (
    select (app.now_utc() at time zone app.grant_timezone())::date as d
  ),
  open_tasks as (
    select t.task_id, t.title, t.detail, t.state, t.priority, t.due_on, t.starts_on,
           t.is_milestone, t.parent_task_id, t.blocked_on, t.added_by,
           t.updated_at, t.created_at, t.project_id,
           p.slug as project_slug, p.name as project_name,
           s.slug as owner_slug, s.name as owner_name,
           /*
             An agent put it there, so Grant has not agreed to it. `added_by`
             already carried this and nothing had ever read it -- which is why
             #139's proposals and #130's extracted tasks have somewhere to land
             without a new column.
           */
           (t.added_by is distinct from app.office_actor(p_office)) as suggested
      from public.tasks t
      left join public.projects p on p.project_id = t.project_id and p.office_id = p_office
      left join public.staff s on s.staff_id = t.assignee_staff
     where t.office_id = p_office and not t.is_fixture and not t.assigned_to_human
       and t.state in ('todo', 'doing', 'blocked')
       -- A task on an archived project is not work; the project was put away.
       and (t.project_id is null or p.status = 'active')
  ),
  ranked as (
    select o.*,
           (o.due_on is not null and o.due_on < (select d from today)) as overdue,
           /*
             Nothing has happened to it in a fortnight and nothing is stopping
             it. `blocked` is excluded deliberately: a blocked task is not
             neglected, it is waiting, and flagging it as stale would bury the
             ones that genuinely are.
           */
           (o.state in ('todo', 'doing')
            and o.updated_at < app.now_utc() - interval '14 days') as stale,
           (o.state = 'blocked') as waiting,
           (o.assignee_slug_missing) as unowned
      from (select oo.*, (oo.owner_slug is null) as assignee_slug_missing from open_tasks oo) o
  )
  select jsonb_build_object(
    'at', app.now_utc(),
    'today', (select d from today),
    'counts', jsonb_build_object(
      'open',     (select count(*) from ranked),
      'overdue',  (select count(*) from ranked where overdue),
      'waiting',  (select count(*) from ranked where waiting),
      'stale',    (select count(*) from ranked where stale),
      'unowned',  (select count(*) from ranked where unowned),
      'suggested',(select count(*) from ranked where suggested),
      'no_project',(select count(*) from ranked where project_id is null)),
    'tasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.task_id, 'title', r.title, 'detail', nullif(r.detail, ''),
               'state', r.state, 'priority', r.priority,
               'due_on', r.due_on, 'starts_on', r.starts_on,
               'milestone', r.is_milestone, 'parent', r.parent_task_id,
               'blocked_on', nullif(r.blocked_on, ''),
               'project', r.project_slug, 'project_name', r.project_name,
               'owner', r.owner_slug, 'owner_name', r.owner_name,
               'overdue', r.overdue, 'stale', r.stale,
               'waiting', r.waiting, 'unowned', r.unowned,
               'suggested', r.suggested,
               'added_by', r.added_by)
             /*
               What to do next, as an ordering rather than an opinion.

               Overdue first, then a date approaching, then what he marked
               important, then a milestone, then oldest. Dated work outranks
               undated work because a date is a commitment somebody else may be
               waiting on -- priority alone would let a P1 with no date sit
               above something due this morning.
             */
             order by r.overdue desc,
                      (r.due_on is null), r.due_on asc nulls last,
                      r.priority asc, r.is_milestone desc, r.created_at asc)
             , '[]'::jsonb)
        from (select * from ranked
               order by overdue desc, (due_on is null), due_on asc nulls last,
                        priority asc, is_milestone desc, created_at asc
               limit greatest(coalesce(p_limit, 200), 1)) r
    )
  )
  );
end
$function$;
revoke all on function app.hq_portfolio_tasks(uuid, integer) from public, anon, authenticated, service_role;

-- public.hq_portfolio_tasks
create function public.hq_portfolio_tasks(p_office uuid, p_limit integer DEFAULT 200)
 returns jsonb
 language sql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $f$
 select app.hq_portfolio_tasks(p_office, p_limit) 
$f$;

-- app.hq_pulse
create function app.hq_pulse(p_office uuid)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  return (
  select jsonb_build_object(
    'at', app.now_utc(),
    /*
      The digest. Anything that changes what the studio DRAWS has to move one of
      these, and nothing else should -- a digest that changes when nothing
      visible did is a page that redraws for no reason, which is worse than a
      stale one because it interrupts.
    */
    'jobs_running', (select count(*)::int from public.jobs
                      where office_id = p_office and state in ('running', 'queued') and not is_fixture),
    'jobs_done', (select count(*)::int from public.jobs
                   where office_id = p_office and state = 'complete' and not is_fixture),
    'outputs', (select count(*)::int from public.outputs o
                 join public.jobs j using (job_id) where j.office_id = p_office and not j.is_fixture),
    'tasks_open', (select count(*)::int from public.tasks
                    where office_id = p_office and state in ('todo', 'doing', 'blocked') and not is_fixture),
    'documents', (select count(*)::int from public.documents where office_id = p_office),
    /*
      0343. Something was SAID.

      Most conversation already moves this digest by accident: a message
      becomes a job, and `jobs_running` counts it. Most is not all — a
      backfilled message makes no job (0340), and neither does a button press.
      Without this the studio's chat would sit still while the conversation
      grew underneath it, which is exactly the "photograph, not a window"
      this function exists to stop.
    */
    'messages', (select count(*)::int from public.inbound_commands where office_id = p_office),
    -- The most recent moment anything the page shows was touched. Catches an
    -- edit that leaves every count identical -- a task renamed, a project
    -- given an icon -- which the counts alone cannot see.
    'latest', greatest(
      (select max(updated_at) from public.jobs where office_id = p_office and not is_fixture),
      (select max(o2.created_at) from public.outputs o2 join public.jobs j2 on j2.job_id = o2.job_id and j2.office_id = p_office),
      (select max(updated_at) from public.tasks where office_id = p_office and not is_fixture),
      (select max(updated_at) from public.projects where office_id = p_office),
      -- And an edit that changes no count: a message arriving on a surface
      -- whose job already existed.
      (select max(received_at) from public.inbound_commands where office_id = p_office)
    )
  )
  );
end
$function$;
revoke all on function app.hq_pulse(uuid) from public, anon, authenticated, service_role;

-- public.hq_pulse
create function public.hq_pulse(p_office uuid)
 returns jsonb
 language sql
 SECURITY DEFINER
 set search_path to ''
as $f$
 select app.hq_pulse(p_office) 
$f$;

-- app.hq_studio_core
create function app.hq_studio_core(p_office uuid)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  return (
  with people as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'slug', s.slug,
             'name', s.name,
             'role', s.title,
             'avatar_ref', s.avatar_ref,
             'expertise', coalesce(s.expertise, array[]::text[]),
             'state', case when j.running > 0 then 'busy' else 'idle' end,
             'doing', j.doing
           ) order by case s.slug when 'chief-of-staff' then 0 else 1 end, s.name),
           '[]'::jsonb) as v
      from public.staff s
      left join lateral (
        select count(*) as running,
               (array_agg(jj.kind order by jj.updated_at desc))[1] as doing
          from public.jobs jj
         where jj.office_id = p_office and jj.recipient_agent = s.slug
           and jj.state in ('running', 'queued')
           and not jj.is_fixture
      ) j on true
     where s.active and s.slug not like 'fixture-%'
  ),

  projects as (
    select coalesce(jsonb_agg(t order by t.name), '[]'::jsonb) as v
      from (
        select
          p.project_id as id,
          p.slug, p.name,
          coalesce(nullif(btrim(p.purpose), ''), '') as purpose,

          coalesce((
            select array_agg(distinct app.connector_label(a.connector)
                             order by app.connector_label(a.connector))
              from public.project_attachments a
             where a.project_id = p.project_id and a.enabled
          ), array[]::text[]) as connectors,

          (select count(*)::int from public.documents d
            where d.office_id = p_office and d.project_id = p.project_id) as docs,
          (select count(*)::int from public.tasks tk
            where tk.office_id = p_office and tk.project_id = p.project_id and not tk.is_fixture
              and tk.state = 'done') as done,
          (select count(*)::int from public.tasks tk
            where tk.office_id = p_office and tk.project_id = p.project_id and not tk.is_fixture) as total,

          (select format('%s by %s', left(tk.title, 40), to_char(tk.due_on, 'FMDD Mon'))
             from public.tasks tk
            where tk.office_id = p_office and tk.project_id = p.project_id and not tk.is_fixture
              and tk.due_on is not null and tk.state in ('todo', 'doing')
            order by tk.due_on limit 1) as next,

          app.studio_documents(p.project_id) as documents,

          -- The order he put them in (§§29-31), or nothing if he has not.
          (select o.doc_ids from public.document_orders o
            where o.project_id = p.project_id and o.owner = app.office_actor(p_office)) as doc_order,
          app.studio_tasks(p.project_id)     as tasks,
          app.studio_sources(p.project_id)   as sources,
          app.studio_activity(p.project_id)  as activity,
          /*
            What is waiting on Grant, in the project (#151, migration 0289).

            The landing page has shown this since 0240 and a project never did,
            so the one genuinely urgent category was visible exactly where he
            could not act on it. Same view, same order — a list that disagreed
            with the banner would make "the urgent one" depend on which room he
            was standing in.
          */
          app.studio_waiting(p.project_id) as waiting,
          /*
            Real, since #71 and migration 0286. This was an honest empty literal
            because there was nowhere for a module to be written — and honest
            or not it was permanent, which is what the Issue objected to.

            It is not a new table. A module is a MILESTONE that gathers
            documents; 0286's header has the mapping and the reasoning.
          */
          app.studio_modules(p.project_id) as modules,
          -- Contacts are real now (#24, migration 0245). This was an honest
          -- empty literal because there was no table; there is one, and the
          -- function returns it in the shape the contact card already draws.
          app.studio_contacts(p.project_id) as contacts,
          -- Real work, not an empty array (0228). AI Team went honestly empty
          -- when data.js was replaced, and an empty tab because nothing was
          -- asked looks identical to one because nobody wired it.
          app.studio_requests(p.project_id) as requests,

          -- The arrangement he made, so it is his on every device (#81).
          (select l.panels from public.dashboard_layouts l
            where l.project_id = p.project_id and l.owner = app.office_actor(p_office)
              and l.surface = 'studio') as layout,

          -- And the experiment's, which is a DIFFERENT arrangement of a
          -- different board: twelve columns and heights in rows, where the
          -- studio's is three columns and heights in pixels. One row per
          -- surface is what #299 was waiting for; before it, saving one would
          -- have taken panels off the other.
          (select l.panels from public.dashboard_layouts l
            where l.project_id = p.project_id and l.owner = app.office_actor(p_office)
              and l.surface = 'basecamp') as layout_board,

          -- What the project LOOKS like, when he has said (#83).
          p.icon, p.icon_hue as "iconHue", p.image

        from public.projects p
        where p.office_id = p_office and p.status = 'active' and not p.is_fixture
      ) t
  ),

  waiting as (
    select case when n.blocker_id is null then null else jsonb_build_object(
             'what', n.requested_action,
             'who', coalesce(n.originating_agent, 'The team'),
             'when', to_char(n.created_at, 'FMDD Mon'),
             'slug', (select p.slug from public.projects p where p.project_id = n.project_id and p.office_id = p_office),
             'blocker', n.blocker_id,
             'note', case when n.work_can_continue
                          then 'Everything else on that project is carrying on.'
                          else 'Nothing else on that project moves until you answer.' end
           ) end as v
      from (select * from app.needs_me_in(p_office)
             order by overdue desc, real_deadline nulls last limit 1) n
     union all select null limit 1
  )

  select jsonb_build_object(
    'crew', (select v from people),
    'projects', (select v from projects),
    'waiting', (select v from waiting),
    'avatar_base', (select value #>> '{}' from public.system_config
                     where key = 'staff.avatar_base_url'),
    'connectors', (select coalesce(jsonb_agg(jsonb_build_object(
                            'connector', k.connector,
                            'name', app.connector_label(k.connector),
                            'enabled', k.enabled
                          ) order by k.name), '[]'::jsonb)
                     from public.knowledge_connectors k),
    'health', (
      select jsonb_build_object(
        'stalled', coalesce(sum(s.n), 0),
        'kinds', coalesce(jsonb_agg(jsonb_build_object(
                   'kind', s.kind, 'n', s.n,
                   'oldest_minutes', s.oldest_minutes) order by s.n desc)
                 filter (where s.kind is not null), '[]'::jsonb))
        from app.jobs_stuck_queued(p_office) s
    ),
    'generated_at', app.now_utc()
  )
  );
end
$function$;
revoke all on function app.hq_studio_core(uuid) from public, anon, authenticated, service_role;

-- app.hq_studio (the labels and appearance are read by office; the literal 'grant' owner is gone)
create function app.hq_studio(p_office uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  return app.hq_studio_core(p_office)
      || jsonb_build_object(
           'contactLabels', coalesce((select jsonb_agg(jsonb_build_object('id', l.label_id, 'name', l.name, 'hue', l.hue)
                                                       order by l.sort, l.name)
                                        from public.contact_labels l
                                       where l.office_id = p_office), '[]'::jsonb),
           'appearance', coalesce((select a.settings from public.appearance_settings a
                                    where a.office_id = p_office
                                    order by a.updated_at desc limit 1), '{}'::jsonb));
end
$function$;
revoke all on function app.hq_studio(uuid) from public, anon, authenticated, service_role;

-- public.hq_studio
create function public.hq_studio(p_office uuid)
 returns jsonb
 language sql
 STABLE SECURITY DEFINER
 set search_path to ''
as $f$ select app.hq_studio(p_office) $f$;

-- app.hq_studio_lately
create function app.hq_studio_lately(p_office uuid, p_limit integer DEFAULT 40)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  return (
  with
  -- A window to summarise from, deliberately wider than the page: collapsing
  -- forty rows into eight and then showing eight is a shorter page, not a
  -- better one.
  recent as (
    select e.event_id, e.actor, e.actor_kind, e.action_type, e.rationale_summary,
           e.project_id, e.occurred_at, e.reversible, e.reversal_method,
           p.name as project_name
      from public.events e
      left join public.projects p on p.project_id = e.project_id and p.office_id = p_office
     where e.office_id = p_office
       and (p.project_id is null or not p.is_fixture)
       and not app.harness_label(e.actor)
     order by e.occurred_at desc
     limit greatest(coalesce(p_limit, 40), 1) * 10
  ),
  ranked as (
    select r.*,
           row_number() over (partition by r.actor, r.action_type, r.project_id
                              order by r.occurred_at desc) as n
      from recent r
  ),
  kept as (
    select jsonb_build_object(
             'id', k.event_id,
             'who', k.actor,
             'kind', k.actor_kind,
             'verb', app.action_in_words(k.action_type) ->> 'verb',
             'what', app.action_in_words(k.action_type) ->> 'what',
             'why', k.rationale_summary,
             'project', k.project_name,
             'when', to_char(k.occurred_at, 'FMDD Mon HH24:MI'),
             'at', k.occurred_at,
             'reversible', k.reversible,
             'undo_with', k.reversal_method
           ) as v, k.occurred_at as at
      from ranked k
     where k.n <= 2
  ),
  -- The rest of each group, as one row that says how many and when the last of
  -- them was. Placed at the newest of the ones it stands for, so it sits
  -- directly under the two that are shown rather than at the bottom of the day.
  folded as (
    select jsonb_build_object(
             'id', null,
             'who', f.actor,
             'kind', min(f.actor_kind),
             'verb', app.action_in_words(f.action_type) ->> 'verb',
             'what', app.action_in_words(f.action_type) ->> 'what',
             'why', null,
             'project', min(f.project_name),
             'when', to_char(max(f.occurred_at), 'FMDD Mon HH24:MI'),
             'at', max(f.occurred_at),
             'times', count(*)::int,
             'reversible', false,
             'undo_with', null
           ) as v, max(f.occurred_at) as at
      from ranked f
     where f.n > 2
     group by f.actor, f.action_type, f.project_id
  ),
  office as (
    select coalesce(jsonb_agg(x.v order by x.at desc), '[]'::jsonb) as v
      from (
        select v, at from kept
        union all
        select v, at from folded
        order by at desc
        limit greatest(coalesce(p_limit, 40), 1)
      ) x
  ),
  -- the build log is the deployment's own: only its operator reads it
  building as (select case when app.office_sees_the_deployment(p_office) then app.hq_build() else '{}'::jsonb end as v),
  today as (
    select jsonb_build_object(
      'events', (select count(*)::int
                   from public.events e
                   left join public.projects p on p.project_id = e.project_id and p.office_id = p_office
                  where e.office_id = p_office
                    and e.occurred_at > app.now_utc() - interval '24 hours'
                    and not app.harness_label(e.actor)
                    and (p.project_id is null or not p.is_fixture)),
      'jobs_done', (select count(*)::int from public.jobs j
                     where j.office_id = p_office and not app.harness_job(j.job_id) and j.state = 'complete'
                       and j.updated_at > app.now_utc() - interval '24 hours'),
      'jobs_failed', (select count(*)::int from public.jobs j
                       where j.office_id = p_office and not app.harness_job(j.job_id) and j.state = 'failed'
                         and j.updated_at > app.now_utc() - interval '24 hours')
    ) as v
  )
  select jsonb_build_object(
    'office', (select v from office),
    'building', (select v from building),
    'today', (select v from today),
    'generated_at', app.now_utc()
  )
  );
end
$function$;
revoke all on function app.hq_studio_lately(uuid, integer) from public, anon, authenticated, service_role;

-- public.hq_studio_lately
create function public.hq_studio_lately(p_office uuid, p_limit integer DEFAULT 40)
 returns jsonb
 language sql
 STABLE SECURITY DEFINER
 set search_path to ''
as $f$
 select app.hq_studio_lately(p_office, p_limit) 
$f$;

-- app.studio_unseen
create function app.studio_unseen(p_office uuid)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  return (
with mine as (
  select p.project_id, p.slug,
         greatest(
           coalesce((select s.at from public.project_seen s
                      where s.owner = app.office_actor(p_office) and s.project_id = p.project_id),
                    p.created_at),
           app.now_utc() - interval '7 days') as since
    from public.projects p
   where p.office_id = p_office and p.status = 'active' and not p.is_fixture
),
counted as (
  select m.slug,
         (select count(*) from public.documents d
           where d.office_id = p_office and d.project_id = m.project_id and d.created_at > m.since
             and coalesce(d.state, 'live') <> 'superseded') as docs,
         (select count(*) from public.tasks t
           where t.office_id = p_office and t.project_id = m.project_id and t.created_at > m.since
             and not coalesce(t.is_fixture, false)) as tasks,
         /*
           Outputs, through the job, because `outputs` has no project of its
           own - CLAUDE.md's own note about this join. An output exists only
           when a job produced one, which is the "finished" the first rule asks
           for: there is no such thing as an output from a job that is still
           thinking.
         */
         (select count(*) from public.outputs o
            join public.jobs j on j.job_id = o.job_id
           where j.office_id = p_office and j.project_id = m.project_id and o.created_at > m.since
             and not coalesce(app.harness_job(j.job_id), false)) as answers,
         (select count(*) from public.job_impediments i
           where i.project_id = m.project_id and i.created_at > m.since
             and exists (select 1 from public.jobs ij where ij.job_id = i.job_id and ij.office_id = p_office)
             and not coalesce(i.is_fixture, false)) as walls
    from mine m
)
select coalesce(jsonb_object_agg(c.slug, jsonb_build_object(
         'n', c.docs + c.tasks + c.answers + c.walls,
         'docs', c.docs, 'tasks', c.tasks, 'answers', c.answers, 'walls', c.walls)),
       '{}'::jsonb)
  from counted c
 where c.docs + c.tasks + c.answers + c.walls > 0
  );
end
$function$;
revoke all on function app.studio_unseen(uuid) from public, anon, authenticated, service_role;

-- public.studio_unseen
create function public.studio_unseen(p_office uuid)
 returns jsonb
 language sql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $f$
 select app.studio_unseen(p_office) 
$f$;

-- app.studio_team_work
create function app.studio_team_work(p_office uuid, p_days integer DEFAULT 14)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  return (
with since as (select app.now_utc() - make_interval(days => greatest(1, coalesce(p_days, 14))) as t),
real_jobs as (
  select j.job_id, j.recipient_agent, j.state, j.created_at, j.project_id
    from public.jobs j, since s
   where j.office_id = p_office and j.recipient_agent is not null
     and j.created_at > s.t
     and not coalesce(app.harness_job(j.job_id), false)
),
per as (
  select st.slug, st.name, st.title,
         (select count(*) from real_jobs r where r.recipient_agent = st.slug) as asked,
         (select count(*) from real_jobs r
           where r.recipient_agent = st.slug and r.state = 'complete') as answered,
         (select count(*) from real_jobs r
           where r.recipient_agent = st.slug and r.state = 'failed') as failed,
         (select count(*) from public.job_impediments i, since s
           where i.staff_slug = st.slug and i.created_at > s.t
             and i.job_id in (select ij.job_id from public.jobs ij where ij.office_id = p_office)
             and not coalesce(i.is_fixture, false)) as could_not,
         (select count(*) from real_jobs r
           where r.recipient_agent = st.slug
             and r.state not in ('complete', 'failed', 'cancelled')) as in_hand
    from public.staff st
   where st.active
),
made as (
  select r.recipient_agent as slug,
         jsonb_agg(jsonb_build_object(
           'title', d.title,
           'at', d.created_at,
           'project', (select p.name from public.projects p where p.project_id = d.project_id and p.office_id = p_office))
           order by d.created_at desc) as items
    from public.documents d
    join real_jobs r on r.job_id = d.produced_by_job and d.office_id = p_office
   group by r.recipient_agent
),
/*
  What they could not do, in their own words.

  The impediment's `needed` is the sentence the agent wrote about what stopped
  it, which is more useful than a count and is the whole point of showing
  failures at all - "3 could not" tells him to look, and this is what he finds.
*/
walls as (
  select i.staff_slug as slug,
         jsonb_agg(jsonb_build_object('needed', i.needed, 'at', i.created_at)
                   order by i.created_at desc) as items
    from public.job_impediments i, since s
   where i.created_at > s.t and not coalesce(i.is_fixture, false)
     and i.job_id in (select ij.job_id from public.jobs ij where ij.office_id = p_office)
   group by i.staff_slug
)
select coalesce(jsonb_object_agg(per.slug, jsonb_build_object(
         'name', per.name, 'title', per.title,
         'asked', per.asked, 'answered', per.answered,
         'failed', per.failed, 'could_not', per.could_not, 'in_hand', per.in_hand,
         -- Three is a card, not a list. The rest is one press away on the
         -- agent's own screen.
         'made', coalesce((select jsonb_agg(x) from jsonb_array_elements(
                    (select m.items from made m where m.slug = per.slug)) with ordinality t(x, i)
                    where i <= 3), '[]'::jsonb),
         'walls', coalesce((select jsonb_agg(x) from jsonb_array_elements(
                    (select w.items from walls w where w.slug = per.slug)) with ordinality t(x, i)
                    where i <= 2), '[]'::jsonb))), '{}'::jsonb)
  from per
  );
end
$function$;
revoke all on function app.studio_team_work(uuid, integer) from public, anon, authenticated, service_role;

-- public.studio_team_work
create function public.studio_team_work(p_office uuid, p_days integer DEFAULT 14)
 returns jsonb
 language sql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $f$
 select app.studio_team_work(p_office, p_days) 
$f$;

-- app.studio_plane
create function app.studio_plane(p_office uuid, p_project_id uuid)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
  select pj.project_id into v_project from public.projects pj where pj.project_id = p_project_id and pj.office_id = p_office;
  return (
with
-- Which staff have actually touched this project. Not the whole roster: a map
-- of eight people where three have ever done anything is a map of the org
-- chart, and Grant asked for a map of the project.
touched as (
  select distinct s.staff_id, s.slug, s.name, s.title
    from public.staff s
   where exists (select 1 from public.jobs j
                  where j.project_id = v_project and j.recipient_agent = s.slug
                    and not coalesce(app.harness_job(j.job_id), false))
      or exists (select 1 from public.tasks t
                  where t.project_id = v_project and t.assignee_staff = s.staff_id
                    and not coalesce(t.is_fixture, false))
      or exists (select 1 from public.documents d
                  join public.jobs j2 on j2.job_id = d.produced_by_job
                 where d.project_id = v_project and j2.recipient_agent = s.slug)
),
agent_state as (
  select t.*,
         (select count(*) from public.jobs j
           where j.project_id = v_project and j.recipient_agent = t.slug
             and j.state not in ('complete','cancelled','failed')) as live,
         (select count(*) from public.job_impediments i
           where i.project_id = v_project and i.staff_slug = t.slug
             and not coalesce(i.is_fixture, false)) as walls,
         (select count(*) from public.documents d
           join public.jobs j3 on j3.job_id = d.produced_by_job
          where d.project_id = v_project and j3.recipient_agent = t.slug) as made,
         (select count(*) from public.jobs j4
           where j4.project_id = v_project and j4.recipient_agent = t.slug
             and j4.state = 'complete'
             and not coalesce(app.harness_job(j4.job_id), false)) as answered
    from touched t
),
agents as (
  select jsonb_build_object(
           'id',    'agent:' || a.slug,
           'kind',  'agent',
           'ref',   a.slug,
           'name',  a.name,
           'sub',   a.title,
           'state', case when a.live  > 0 then 'working'
                         when a.walls > 0 then 'needs attention'
                         when a.made  > 0 or a.answered > 0 then 'done'
                         else 'idle' end,
           'says',  case when a.live  > 0 then a.live::text  || ' in hand'
                         when a.walls > 0 then a.walls::text || ' could not be done'
                         when a.made  > 0 then a.made::text  || ' made'
                         when a.answered > 0 then a.answered::text || ' answered'
                         else 'nothing yet' end
         ) as n, a.slug
    from agent_state a
),
-- The project's own attachments. `ref_kind` separates a live connector from a
-- reference (0306, #35): a bookmark never fails and nothing syncs it, so it
-- must not be drawn as a connection that could be healthy.
attach as (
  select pa.attachment_id, pa.connector, pa.external_ref, pa.display_name,
         pa.external_url, pa.enabled, pa.last_synced_at,
         coalesce(pa.ref_kind, 'connector') as ref_kind,
         (select ch.state from public.connection_health ch
           where ch.office_id = p_office and lower(ch.service) = case pa.connector
                                       when 'drive'      then 'google'
                                       when 'notion'     then 'notion'
                                       when 'github'     then 'github'
                                       when 'notebooklm' then 'google'
                                       else null end
           limit 1) as health
    from public.project_attachments pa
   where pa.project_id = v_project
),
services as (
  select jsonb_build_object(
           'id',    'service:' || a.attachment_id::text,
           'kind',  case when a.ref_kind = 'connector' then 'service' else 'reference' end,
           'ref',   a.attachment_id::text,
           'name',  coalesce(nullif(a.display_name, ''), a.connector),
           'sub',   a.connector,
           'url',   a.external_url,
           'state', case when a.ref_kind <> 'connector'  then 'a pointer'
                         when a.enabled is not true      then 'not connected'
                         when a.health = 'failing'       then 'needs attention'
                         else 'connected' end,
           -- The page already turns a timestamp into "6 minutes ago" everywhere
           -- else (`when.words`), so this hands over the instant and not a
           -- sentence. Two places that phrase the same fact is how a product
           -- ends up with two vocabularies for one thing (0311).
           'says',  case when a.ref_kind <> 'connector' then 'nothing reads this'
                         when a.last_synced_at is null  then 'never read'
                         else null end,
           'at',    a.last_synced_at
         ) as n, a.attachment_id, a.connector, a.external_ref
    from attach a
),
open_tasks as (
  select t.task_id, t.title, t.state, t.assignee_staff, t.due_on,
         jsonb_build_object(
           'id',    'task:' || t.task_id::text,
           'kind',  'task',
           'ref',   t.task_id::text,
           'name',  t.title,
           'sub',   case when t.due_on is null then null else 'due ' || to_char(t.due_on, 'FMDD Mon') end,
           'state', case when t.state = 'done' then 'done'
                         when t.blocked_on is not null then 'blocked'
                         else 'open' end,
           'says',  t.state
         ) as n
    from public.tasks t
   where t.project_id = v_project
     and not coalesce(t.is_fixture, false)
     and t.state <> 'done'
   order by t.due_on nulls last, t.created_at desc
   limit 12
),
recent_docs as (
  select d.document_id, d.title, d.connector, d.external_parent_ref,
         d.produced_by_job, d.produced_by,
         jsonb_build_object(
           'id',    'doc:' || d.document_id::text,
           'kind',  'document',
           'ref',   d.document_id::text,
           'name',  d.title,
           'sub',   nullif(d.produced_by, ''),
           'state', 'ready',
           'says',  coalesce(d.doc_type, 'document')
         ) as n
    from public.documents d
   where d.project_id = v_project
     and coalesce(d.state, 'approved') <> 'archived'
   order by d.updated_at desc nulls last
   limit 12
),
-- --- the edges, each read from the column that already holds it -------------
e_made as (
  select jsonb_build_object('from', 'agent:' || j.recipient_agent,
                            'to',   'doc:' || d.document_id::text,
                            'verb', 'produced', 'derived', false) as e,
         j.recipient_agent as slug, d.document_id
    from recent_docs d
    join public.jobs j on j.job_id = d.produced_by_job
   where j.recipient_agent is not null
     and exists (select 1 from agents a where a.slug = j.recipient_agent)
),
e_task as (
  select jsonb_build_object('from', 'agent:' || s.slug,
                            'to',   'task:' || t.task_id::text,
                            'verb', 'assigned_to', 'derived', false) as e
    from open_tasks t
    join public.staff s on s.staff_id = t.assignee_staff
   where exists (select 1 from agents a where a.slug = s.slug)
),
e_from as (
  select jsonb_build_object('from', 'service:' || sv.attachment_id::text,
                            'to',   'doc:' || d.document_id::text,
                            'verb', 'came_from', 'derived', false) as e,
         sv.attachment_id, d.document_id
    from recent_docs d
    join services sv
      on sv.connector = d.connector
     and (d.external_parent_ref is null or d.external_parent_ref = sv.external_ref)
),
-- The one Grant asked for, and the only one no column holds. Derived from two
-- real edges and labelled as such, so the interface can say WHY the line is
-- there rather than implying a credential.
e_uses as (
  select distinct jsonb_build_object(
           'from', 'agent:' || m.slug,
           'to',   'service:' || f.attachment_id::text,
           'verb', 'uses', 'derived', true,
           'because', 'wrote something that came from here') as e
    from e_made m
    join e_from f on f.document_id = m.document_id
)
select jsonb_build_object(
  'nodes', coalesce((select jsonb_agg(x.n) from (
             select n from agents
             union all select n from services
             union all select n from open_tasks
             union all select n from recent_docs) x), '[]'::jsonb),
  'edges', coalesce((select jsonb_agg(y.e) from (
             select e from e_made
             union all select e from e_task
             union all select e from e_from
             union all select e from e_uses) y), '[]'::jsonb)
)
  );
end
$function$;
revoke all on function app.studio_plane(uuid, uuid) from public, anon, authenticated, service_role;

-- public.studio_plane
create function public.studio_plane(p_office uuid, p_project_id uuid)
 returns jsonb
 language sql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $f$
 select app.studio_plane(p_office, p_project_id) 
$f$;

-- app.project_history
create function app.project_history(p_office uuid, p_project uuid, p_limit integer DEFAULT 200)
 returns TABLE(at timestamp with time zone, kind text, what text, detail text, who text)
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $function$
#variable_conflict use_column
declare
  v_project uuid;
begin
  perform app.require_office(p_office);
  select pj.project_id into v_project from public.projects pj where pj.project_id = p_project and pj.office_id = p_office;
  return query
  with story as (
    -- It began.
    select p.created_at as at, 'created'::text as kind,
           format('%s started', p.name) as what,
           nullif(btrim(coalesce(p.purpose, p.description, '')), '') as detail,
           null::text as who
      from public.projects p
     where p.project_id = v_project

    union all

    -- Something was attached to work from.
    select a.created_at, 'attached',
           format('%s attached', coalesce(nullif(a.display_name, ''), a.connector)),
           format('%s · %s', a.connector, coalesce(nullif(a.artifact_kind, ''), a.role)),
           null
      from public.project_attachments a
     where a.project_id = v_project

    union all

    /*
      And something stopped being used. `updated_at` is when the row last
      changed, which for a disabled attachment is when it was disabled - the
      one case where a touch timestamp genuinely dates the event, because
      disabling is the only thing that sets `enabled = false`.
    */
    select a.updated_at, 'detached',
           format('%s detached', coalesce(nullif(a.display_name, ''), a.connector)),
           nullif(btrim(coalesce(a.disabled_reason, '')), ''),
           null
      from public.project_attachments a
     where a.project_id = v_project and not a.enabled

    union all

    -- Material arrived, and it matters whether the office wrote it.
    select d.created_at,
           case when d.origin = 'made' then 'made' else 'source' end,
           d.title,
           case when d.origin = 'made' then 'written by the team'
                else format('%s%s', coalesce(nullif(d.connector, ''), 'upload'),
                            case when d.content_chars > 0
                                 then format(' · %s words', (d.content_chars / 6)) else '' end)
           end,
           nullif(d.produced_by, '')
      from public.documents d
     where d.project_id = v_project
       and coalesce(d.state, '') <> 'archived'
       -- Harness material is not part of how the project got here.
       and coalesce(d.added_by, '') !~ '^(verify|probe|fixture|gate|ledger-proof)[:-]'

    union all

    -- Work finished. Not work STARTED: a task appearing is an intention and a
    -- task finishing is the project having moved.
    select t.done_at, 'finished', t.title,
           case when t.is_milestone then 'a milestone' else null end,
           (select s.name from public.staff s where s.staff_id = t.assignee_staff)
      from public.tasks t
     where t.project_id = v_project and t.state = 'done' and t.done_at is not null
       and not t.is_fixture

    union all

    -- A milestone being SET is itself a shaping decision, dated by the task.
    select t.created_at, 'milestone', t.title, 'set as a milestone', null
      from public.tasks t
     where t.project_id = v_project and t.is_milestone and not t.is_fixture

    union all

    /*
      And where it stands, for a project that is no longer active.

      Dated `updated_at` and worded so the date is not read as the moment the
      status changed - there is no status history and this view will not
      pretend there is.
    */
    select p.updated_at, 'standing',
           format('%s is %s', p.name, p.status),
           'the office keeps no history of status changes, so this is dated by the last change to the project row',
           null
      from public.projects p
     where p.project_id = v_project and coalesce(p.status, 'active') <> 'active'
  )
  select s.at, s.kind, s.what, s.detail, s.who
    from story s
   where s.at is not null
   order by s.at asc
   limit greatest(coalesce(p_limit, 200), 1);
end
$function$;
revoke all on function app.project_history(uuid, uuid, integer) from public, anon, authenticated, service_role;

-- public.project_history
create function public.project_history(p_office uuid, p_project uuid, p_limit integer DEFAULT 200)
 returns TABLE(at timestamp with time zone, kind text, what text, detail text, who text)
 language sql
 SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $f$
 select * from app.project_history(p_office, p_project, p_limit) 
$f$;

-- app.task_sync_panel
create function app.task_sync_panel(p_office uuid)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  select (case when app.office_sees_the_deployment(p_office) then app.vikunja_settings() else jsonb_build_object('configured', false) end) || jsonb_build_object(
    'trouble', app.task_sync_trouble(p_office, 'vikunja'),
    /*
      What it is keeping in step, so "connected" is a number rather than a
      claim. A panel that says connected over an empty mapping is the dead-dial
      shape one layer up.
    */
    'linked', (select count(*)::int from public.task_links l
                join public.tasks t on t.task_id = l.task_id and t.office_id = p_office
               where l.provider = 'vikunja' and not coalesce(t.is_fixture, false)),
    'last_synced', (select max(greatest(coalesce(pushed_at, 'epoch'::timestamptz),
                                        coalesce(pulled_at, 'epoch'::timestamptz)))
                      from public.task_links tl2
                      join public.tasks t2 on t2.task_id = tl2.task_id and t2.office_id = p_office
                     where tl2.provider = 'vikunja'))
  );
end
$function$;
revoke all on function app.task_sync_panel(uuid) from public, anon, authenticated, service_role;

-- public.task_sync_panel
create function public.task_sync_panel(p_office uuid)
 returns jsonb
 language sql
 SECURITY DEFINER
 set search_path to ''
as $f$
  select app.task_sync_panel(p_office)
$f$;

do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('hq_activity', 'hq_overview', 'hq_portfolio_tasks', 'hq_pulse', 'hq_studio', 'hq_studio_lately', 'studio_unseen', 'studio_team_work', 'studio_plane', 'project_history', 'task_sync_panel')
              and (pg_get_function_arguments(p.oid)) like 'p_office uuid%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $g$;

-- the old signatures go: nothing may ask without saying whose
drop function app.hq_activity(integer);
drop function public.hq_activity(integer);
drop function app.hq_overview_base();
drop function app.hq_overview();
drop function public.hq_overview();
drop function app.hq_portfolio_tasks(integer);
drop function public.hq_portfolio_tasks(integer);
drop function app.hq_pulse();
drop function public.hq_pulse();
drop function app.hq_studio_core();
drop function app.hq_studio();
drop function public.hq_studio();
drop function app.hq_studio_lately(integer);
drop function public.hq_studio_lately(integer);
drop function app.studio_unseen();
drop function public.studio_unseen();
drop function app.studio_team_work(integer);
drop function public.studio_team_work(integer);
drop function app.studio_plane(uuid);
drop function public.studio_plane(uuid);
drop function app.project_history(uuid, integer);
drop function public.project_history(uuid, integer);
drop function app.task_sync_panel();
drop function public.task_sync_panel();
