-- 1024 - the project activity reader stops asking a function for every output (efficiency run, 5 to 6 October 2026; NOT applied
-- to production).
--
-- WHAT WAS MEASURED (replica seeded to production's 5 Oct shape, scripts/isolated/seed-production-scale.sql). hq_studio builds the
-- project overview and calls app.studio_activity once per project; five projects cost 1.85 s and about 258,000 buffer hits, and
-- Team HQ draws that on every page load and refresh. Almost all of it was the `answered` branch ("<specialist> answered N requests"):
-- for every output in the 45-day window it called app.job_via_label(job_id), which is three nested SQL functions that each re-read
-- the job (0.15 ms a call, 1,800 outputs a project).
--
-- WHY IT WAS EXPENSIVE. app.job_via is a function of columns the query already has in hand on the job row: requested_by, the
-- inbound command's recorded via, the origin channel. Asking it per row repeated a primary-key read of jobs, then of inbound_commands
-- (and of mcp_clients for an external assistant) for rows the join had just read.
--
-- WHAT CHANGED. The branch now (1) takes the window's outputs with the cheap predicates only, in a MATERIALIZED step so the harness
-- question is asked of exactly those rows and cannot be pushed down onto the project's whole job history, and (2) reads the via with
-- the same three sources in the same order, as a join: an external assistant's own client first, then the command's recorded via
-- (chatgpt, claude, mcp only), then the channel, mapped through app.via_label unchanged. 0.30 s for the same five projects.
-- The harness exclusion is the same predicate (app.harness_job, untouched: about twenty-five readers depend on it and its strict
-- direction is the safe one). Office isolation is unchanged: the project is resolved with its office and every read is bound to it.
--
-- Proof: scripts/isolated/studio-activity-equivalence.ts runs the frozen 0920 definition beside this one on every project plus edge
-- rows (a harness job, an external-assistant job, a command recorded as ChatGPT) inside a rolled-back transaction and requires equal
-- jsonb, with controls that must be able to fail.
-- Roll back by re-applying the 0920 definition of app.studio_activity (create or replace; no data changed).

begin;

CREATE OR REPLACE FUNCTION app.studio_activity(p_project_id uuid, p_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with window_start as materialized (select app.now_utc() - interval '45 days' as t),
  staff_slugs as (select slug from public.staff),
  proj as (
    select p.project_id, p.office_id, p.created_at, p.is_fixture
      from public.projects p where p.project_id = p_project_id and not p.is_fixture
  ),
  ledger as (
    select case when e.actor in (select slug from staff_slugs) then e.actor
                    when e.actor is not distinct from app.office_actor(proj.office_id) then 'you'
                    else e.actor end as who,
           app.action_in_words(e.action_type) ->> 'verb' as verb,
           app.action_in_words(e.action_type) ->> 'what' as what,
           e.occurred_at as at,
           e.rationale_summary as detail,
           app.event_via_label(e.origin_channel, e.related_job_id, e.action_type, e.actor_kind) as via,
           app.activity_category(e.action_type) as category
      from public.events e, proj
     where e.project_id = proj.project_id and e.office_id = proj.office_id
       and not app.harness_label(e.actor)
       and (e.related_job_id is null or not app.harness_job(e.related_job_id))
       -- The office's own plumbing is not what happened on the project: a committed finding is the answer line below
       -- said once, and the ledger, gate and backup rows are about the machinery.
       and e.action_type !~ '^(ledger|gate[0-9]|backup)\.'
       and e.action_type not in ('finding.committed', 'job.committed')
     order by e.occurred_at desc
     limit 40
  ),
  made as (
    select case when t.added_by in (select slug from staff_slugs) then t.added_by else 'you' end as who,
           date_trunc('day', t.created_at) as day,
           count(*) as n, max(t.created_at) as at,
           (array_agg(t.title order by t.created_at desc))[1] as one,
           app.actor_via_label(t.added_by, t.job_id) as via
      from public.tasks t, proj, window_start w
     where t.project_id = proj.project_id and t.office_id = proj.office_id
       and t.state <> 'cancelled' and t.created_at >= w.t
       and not app.harness_task(t.is_fixture, t.job_id)
     group by 1, 2, app.actor_via_label(t.added_by, t.job_id)
  ),
  finished as (
    select case when t.completed_by in (select slug from staff_slugs) then t.completed_by else 'you' end as who,
           date_trunc('day', t.done_at) as day,
           count(*) as n, max(t.done_at) as at,
           (array_agg(t.title order by t.done_at desc))[1] as one,
           app.actor_via_label(t.completed_by, null) as via
      from public.tasks t, proj, window_start w
     where t.project_id = proj.project_id and t.office_id = proj.office_id
       and t.state = 'done' and t.done_at is not null and t.done_at >= w.t
       and not app.harness_task(t.is_fixture, t.job_id)
     group by 1, 2, app.actor_via_label(t.completed_by, null)
  ),
  filed as (
    select case when coalesce(d.produced_by, d.added_by) in (select slug from staff_slugs)
                then coalesce(d.produced_by, d.added_by) else 'you' end as who,
           d.origin, date_trunc('day', d.created_at) as day,
           count(*) as n, max(d.created_at) as at,
           (array_agg(d.title order by d.created_at desc))[1] as one,
           app.actor_via_label(d.added_by, d.produced_by_job) as via
      from public.documents d, proj, window_start w
     where d.project_id = proj.project_id and d.office_id = proj.office_id
       and (d.origin in ('yours', 'made') or d.connector = 'mcp') and d.state <> 'archived' and d.created_at >= w.t
     group by 1, 2, 3, app.actor_via_label(d.added_by, d.produced_by_job)
  ),
  met as (
    select date_trunc('day', c.created_at) as day, count(*) as n, max(c.created_at) as at,
           (array_agg(c.name order by c.created_at desc))[1] as one
      from public.contacts c, proj, window_start w
     where c.project_id = proj.project_id and c.archived_at is null
       and c.created_at >= w.t and not c.is_fixture
       and exists (select 1 from public.projects pp where pp.project_id = c.project_id and pp.office_id = proj.office_id)
     group by 1
  ),
  -- Every output of this project's jobs in the window, with the cheap predicates only. MATERIALIZED so it is a barrier: the
  -- harness question (several index probes per job, up the parent chain) is asked below of THESE rows, never pushed down onto
  -- the project's whole job history.
  answered_raw as materialized (
    select s.slug as who, o.created_at, j.job_id, j.kind,
           -- app.job_via written as a join: the same three sources in the same order (an external assistant's own client, then
           -- the inbound command's recorded via, then the channel), read from the rows the join already holds
           app.via_label(case when j.requested_by like 'mcp:%' then
                    (select case k.kind when 'chatgpt' then 'chatgpt' when 'claude' then 'claude' else 'mcp' end
                       from public.mcp_clients k where k.client_id = substring(j.requested_by from 5))
                  else coalesce(case when c.context ->> 'via' in ('chatgpt', 'claude', 'mcp') then c.context ->> 'via' end,
                                j.origin_channel) end) as via
      from public.outputs o
      join public.jobs j on j.job_id = o.job_id
      left join public.inbound_commands c on c.command_id = j.origin_command_id
      join public.staff s on s.staff_id = o.staff_id, proj, window_start w
     where j.project_id = proj.project_id and j.office_id = proj.office_id
       and o.created_at >= w.t
  ),
  answered as (
    select r.who, date_trunc('day', r.created_at) as day, count(*) as n, max(r.created_at) as at,
           r.via,
           case when r.kind ~ '^(browser|research|notebook[.]ask)' then 'research' else 'other' end as category
      from answered_raw r
     where not app.harness_job(r.job_id)
     group by 1, 2, 5, 6
  ),
  lines as (
    select who, verb, what, at, detail, via, category from ledger
    union all
    select who, 'added',
           case when n = 1 then format('the task "%s"', one) else format('%s tasks', n) end, at, null, via, 'task' from made
    union all
    select who, 'completed',
           case when n = 1 then format('the task "%s"', one) else format('%s tasks', n) end, at, null, via, 'task' from finished
    union all
    select who, case when origin = 'made' then 'made' else 'added' end,
           case when n = 1 then format('the document "%s"', left(one, 70)) else format('%s documents', n) end, at, null, via, 'document' from filed
    union all
    select 'you', 'added',
           case when n = 1 then format('the contact %s', one) else format('%s contacts', n) end, at, null, null::text, 'other' from met
    union all
    select who, 'answered', case when n = 1 then 'a request' else format('%s requests', n) end, at, null, via, category from answered
    union all
    select 'you', 'created', 'this project', proj.created_at, null, null::text, 'other' from proj, window_start w where proj.created_at >= w.t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'who', l.who,
           'verb', l.verb,
           'what', l.what,
           'when', to_char(l.at, 'FMDD Mon HH24:MI'),
           'at', l.at,
           'detail', l.detail,
           'via', l.via,
           'category', l.category
         ) order by l.at desc), '[]'::jsonb)
    from (select * from lines order by at desc limit greatest(coalesce(p_limit, 12), 1)) l
$function$;

commit;
