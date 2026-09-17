begin;

-- ---------------------------------------------------------------------------
-- 0401 - how a project got here (#156)
--
-- Grant: *"Activity is a feed of recent events. There is no HOW DID THIS
-- PROJECT GET HERE... For a coaching course being built over months that is
-- the most useful single view and it does not exist."*
--
-- And the line that is the whole design:
--
--   > "A history, oldest to newest, of the events that CHANGED THE PROJECT
--   >  rather than of everything that happened in it. A feed of every job is
--   >  noise at month three; a sequence of 'the project changed in this way'
--   >  is a story."
--
-- ## Derived, because nothing records it
--
-- `public.events` is an office-wide ledger of what AGENTS did - 1,782
-- `finding.committed`, tool grants, lessons learned. It contains no project
-- lifecycle at all: nothing writes "project created", "source attached" or
-- "task finished" into it, and `app.studio_activity` reading it is exactly the
-- feed this issue says is not the thing.
--
-- So the sequence is DERIVED from the tables that already hold those facts,
-- the way `app.relations_of` derives edges from the columns that hold them
-- (0310). Adding an events row for each of these would be a second copy of a
-- fact a timestamp already carries, and 0303/0304 are the pair about what the
-- copy does next.
--
-- ## What is knowable, and what is not
--
-- Knowable, because a row carries the moment: the project being made, a source
-- being attached, a source being detached and why, a document arriving (and
-- whether the office wrote it or Grant supplied it), a task being finished, a
-- milestone being set.
--
-- NOT knowable: **status changes.** `projects.status` is a current value with
-- no history behind it, so "it was paused in March" cannot be recovered - only
-- "it is archived now, and the row was last touched then", which is a
-- different claim. A project that is not active therefore contributes ONE
-- entry dated `updated_at`, and the wording says what that date really means
-- rather than implying the status changed at that moment. Inventing the rest
-- would be the office claiming to remember something nobody wrote down, which
-- is the failure #231 exists to prevent, in a view.
--
-- Deadlines are named in the issue and there is no project deadline column at
-- all. Task due dates are per task and change without a trail. Left out, and
-- said here rather than silently approximated.
--
-- ## Harness traffic excluded
--
-- A fixture document or a fixture task in a real project would put probe rows
-- in the story of Grant's coaching course. Fifth instance this week.
-- ---------------------------------------------------------------------------

create or replace function app.project_history(
  p_project uuid,
  p_limit   integer default 200
)
returns table (
  at      timestamptz,
  kind    text,
  what    text,
  detail  text,
  who     text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with story as (
    -- It began.
    select p.created_at as at, 'created'::text as kind,
           format('%s started', p.name) as what,
           nullif(btrim(coalesce(p.purpose, p.description, '')), '') as detail,
           null::text as who
      from public.projects p
     where p.project_id = p_project

    union all

    -- Something was attached to work from.
    select a.created_at, 'attached',
           format('%s attached', coalesce(nullif(a.display_name, ''), a.connector)),
           format('%s · %s', a.connector, coalesce(nullif(a.artifact_kind, ''), a.role)),
           null
      from public.project_attachments a
     where a.project_id = p_project

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
     where a.project_id = p_project and not a.enabled

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
     where d.project_id = p_project
       and coalesce(d.state, '') <> 'archived'

    union all

    -- Work finished. Not work STARTED: a task appearing is an intention and a
    -- task finishing is the project having moved.
    select t.done_at, 'finished', t.title,
           case when t.is_milestone then 'a milestone' else null end,
           (select s.name from public.staff s where s.staff_id = t.assignee_staff)
      from public.tasks t
     where t.project_id = p_project and t.state = 'done' and t.done_at is not null
       and not t.is_fixture

    union all

    -- A milestone being SET is itself a shaping decision, dated by the task.
    select t.created_at, 'milestone', t.title, 'set as a milestone', null
      from public.tasks t
     where t.project_id = p_project and t.is_milestone and not t.is_fixture

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
     where p.project_id = p_project and coalesce(p.status, 'active') <> 'active'
  )
  select s.at, s.kind, s.what, s.detail, s.who
    from story s
   where s.at is not null
   order by s.at asc
   limit greatest(coalesce(p_limit, 200), 1)
$$;

comment on function app.project_history(uuid, integer) is
  'How a project got here, oldest first (#156). The events that CHANGED it, '
  'not everything that happened in it - app.studio_activity is the feed and '
  'this is the story. Derived from the timestamps the rows already carry, '
  'because public.events holds agent actions and no project lifecycle at all. '
  'Status changes are NOT in it: projects.status has no history and inventing '
  'one would be the office remembering what nobody wrote down.';

create or replace function public.project_history(p_project uuid, p_limit integer default 200)
returns table (at timestamptz, kind text, what text, detail text, who text)
language sql security definer set search_path = public, pg_catalog
as $$ select * from app.project_history(p_project, p_limit) $$;

revoke all on function public.project_history(uuid, integer) from public;
grant execute on function public.project_history(uuid, integer) to service_role;

commit;
