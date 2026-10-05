-- Recent activity said nothing about the work (#409).
--
-- A project's activity was `public.events` and only that, and the ledger records the office acting on itself: tools
-- granted, things learned. Adding a task, finishing one, dropping in a document, adding a contact, or the team
-- answering a request wrote nothing there, so a busy project read "no recent activity" and the panel was a log of
-- plumbing. 96 tasks, 22 documents and 12 contacts in the Sample office produced no line at all.
--
-- The facts already exist in the tables that hold the work, each with when and by whom (`created_at` and `added_by`,
-- `done_at` and `completed_by`, `documents.created_at`, `outputs.created_at` with the specialist). Storing a second
-- copy as events would be the copy that rots (0310), and a trigger per writer is the guard that covers the writers
-- somebody remembered. So the reader DERIVES them, and nothing is invented: every line below is one row, or a count of
-- rows, that is really there, attributed to who really did it.
--
-- Not an audit log: edits, reorderings and per-field changes are not here, and a burst by one person on one day is ONE
-- line with a count ("added 12 tasks"), not twelve. Events already folded repeats by the same reasoning.
--
-- Provenance. `who` is a specialist's slug when the row names a specialist and `you` for everything else the person
-- did, never a raw owner key. An agent line exists only where a specialist's output row exists.

begin;

create or replace function app.studio_activity(p_project_id uuid, p_limit integer default 12)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with window_start as (select app.now_utc() - interval '45 days' as t),
  staff_slugs as (select slug from public.staff),
  proj as (
    select p.project_id, p.office_id, p.created_at, p.is_fixture
      from public.projects p where p.project_id = p_project_id and not p.is_fixture
  ),
  ledger as (
    select e.actor as who,
           app.action_in_words(e.action_type) ->> 'verb' as verb,
           app.action_in_words(e.action_type) ->> 'what' as what,
           e.occurred_at as at,
           e.rationale_summary as detail
      from public.events e, proj
     where e.project_id = proj.project_id and e.office_id = proj.office_id
       and not app.harness_label(e.actor)
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
           (array_agg(t.title order by t.created_at desc))[1] as one
      from public.tasks t, proj, window_start w
     where t.project_id = proj.project_id and t.office_id = proj.office_id
       and t.state <> 'cancelled' and t.created_at >= w.t
       and not app.harness_task(t.is_fixture, t.job_id)
     group by 1, 2
  ),
  finished as (
    select case when t.completed_by in (select slug from staff_slugs) then t.completed_by else 'you' end as who,
           date_trunc('day', t.done_at) as day,
           count(*) as n, max(t.done_at) as at,
           (array_agg(t.title order by t.done_at desc))[1] as one
      from public.tasks t, proj, window_start w
     where t.project_id = proj.project_id and t.office_id = proj.office_id
       and t.state = 'done' and t.done_at is not null and t.done_at >= w.t
       and not app.harness_task(t.is_fixture, t.job_id)
     group by 1, 2
  ),
  filed as (
    select case when coalesce(d.produced_by, d.added_by) in (select slug from staff_slugs)
                then coalesce(d.produced_by, d.added_by) else 'you' end as who,
           d.origin, date_trunc('day', d.created_at) as day,
           count(*) as n, max(d.created_at) as at,
           (array_agg(d.title order by d.created_at desc))[1] as one
      from public.documents d, proj, window_start w
     where d.project_id = proj.project_id and d.office_id = proj.office_id
       and d.origin in ('yours', 'made') and d.state <> 'archived' and d.created_at >= w.t
     group by 1, 2, 3
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
  answered as (
    select s.slug as who, date_trunc('day', o.created_at) as day, count(*) as n, max(o.created_at) as at
      from public.outputs o
      join public.jobs j on j.job_id = o.job_id
      join public.staff s on s.staff_id = o.staff_id, proj, window_start w
     where j.project_id = proj.project_id and j.office_id = proj.office_id
       and o.created_at >= w.t and not app.harness_job(j.job_id)
     group by 1, 2
  ),
  lines as (
    select who, verb, what, at, detail from ledger
    union all
    select who, 'added',
           case when n = 1 then format('the task "%s"', one) else format('%s tasks', n) end, at, null from made
    union all
    select who, 'completed',
           case when n = 1 then format('the task "%s"', one) else format('%s tasks', n) end, at, null from finished
    union all
    select who, case when origin = 'made' then 'made' else 'added' end,
           case when n = 1 then format('the document "%s"', left(one, 70)) else format('%s documents', n) end, at, null from filed
    union all
    select 'you', 'added',
           case when n = 1 then format('the contact %s', one) else format('%s contacts', n) end, at, null from met
    union all
    select who, 'answered', case when n = 1 then 'a request' else format('%s requests', n) end, at, null from answered
    union all
    select 'you', 'created', 'this project', proj.created_at, null from proj, window_start w where proj.created_at >= w.t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'who', l.who,
           'verb', l.verb,
           'what', l.what,
           'when', to_char(l.at, 'FMDD Mon HH24:MI'),
           'at', l.at,
           'detail', l.detail
         ) order by l.at desc), '[]'::jsonb)
    from (select * from lines order by at desc limit greatest(coalesce(p_limit, 12), 1)) l
$$;

revoke all on function app.studio_activity(uuid, integer) from public, anon, authenticated;

commit;
