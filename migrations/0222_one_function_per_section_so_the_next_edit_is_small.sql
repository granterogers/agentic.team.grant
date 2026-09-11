-- One function per section, so the next edit is small.
--
-- Issue #68. `app.hq_studio()` has been rewritten three times today — 0219 built
-- it, 0220 fixed the connector labels and sizes, 0221 fixed the activity
-- wording — and each rewrite was a hundred and fifty lines copied to change six.
--
-- That is the shape 0130 adopted a discipline against after 0128, which existed
-- because somebody retyped a long function and two column names came back
-- wrong. Copying programmatically avoids the typo and does nothing about the
-- real cost: every future change to one section re-reviews all seven, and the
-- diff cannot show what actually changed.
--
-- So each section becomes its own function taking a project id. The top-level
-- payload assembles them. Adding `attachment_id` to sources — which is what
-- prompted this, because the studio cannot detach something it cannot name —
-- is now a four-line diff instead of a hundred and fifty.
--
-- ## And sources gain what a button needs
--
-- `attachment_id`, `connector` and `ref`. A page can render an attachment
-- without them; it cannot DETACH one, which is the difference between a
-- read-only surface and the one that replaces the old page.

begin;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
create or replace function app.studio_documents(p_project_id uuid, p_limit integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.document_id,
           'title', d.title,
           'kind', case
             when coalesce(d.mime_type, '') like 'audio/%' then 'audio'
             when d.origin = 'made' then 'made'
             when coalesce(d.mime_type, '') = 'application/pdf'
               or d.title ilike '%.pdf' then 'pdf'
             else 'doc' end,
           'origin', case d.origin
             when 'yours' then 'Yours'
             when 'made' then coalesce(d.produced_by, 'The team')
             else app.connector_label(d.connector) end,
           -- A size only when it says something. Below a hundred words "4 words"
           -- reads as broken metadata even when it is exactly right, and several
           -- of these are Notion database containers (#19).
           'size', case
             when d.duration_s is not null
               then format('%s min', greatest(round(d.duration_s / 60.0), 1))
             when coalesce(d.content_chars, 0) >= 550
               then format('%s words', to_char(round(d.content_chars / 5.5), 'FM999G999'))
             when d.byte_size is not null and d.byte_size >= 1024
               then format('%s KB', round(d.byte_size / 1024.0))
             else '' end,
           'state', d.state
         ) order by d.created_at desc), '[]'::jsonb)
    from (select * from public.documents dd
           where dd.project_id = p_project_id
           order by dd.created_at desc
           limit greatest(coalesce(p_limit, 24), 1)) d
$$;

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create or replace function app.studio_tasks(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', tk.task_id,
           'title', tk.title,
           'note', tk.detail,
           'who', st.slug,
           'state', case
             when tk.state = 'done' then 'done'
             when tk.state = 'doing' then 'doing'
             when tk.due_on is not null
              and tk.due_on <= (app.now_utc() at time zone app.grant_timezone())::date + 7
               then 'due' else null end,
           'due', case when tk.due_on is null then null
                       else format('Due %s', to_char(tk.due_on, 'FMDD FMMonth')) end,
           'blocked', tk.blocked_on
         ) order by
           case tk.state when 'doing' then 0 when 'blocked' then 1
                         when 'todo' then 2 else 3 end,
           tk.due_on nulls last), '[]'::jsonb)
    from public.tasks tk
    left join public.staff st on st.staff_id = tk.assignee_staff
   where tk.project_id = p_project_id and not tk.is_fixture
$$;

-- ---------------------------------------------------------------------------
-- Sources
--
-- With the three fields a button needs. A page can RENDER an attachment without
-- them and cannot detach one, which is the whole difference between the
-- read-only surface and the one that replaces the old page.
-- ---------------------------------------------------------------------------
create or replace function app.studio_sources(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'connector',
           'id', a.attachment_id,
           'connector', a.connector,
           'ref', a.external_ref,
           'url', a.external_url,
           -- The individual thing here, because that is what a Sources row is
           -- for: which notebook, which database, which folder. The card above
           -- says the kind.
           'name', coalesce(nullif(a.display_name, ''), app.connector_label(a.connector)),
           'via', app.connector_label(a.connector),
           'what', a.role,
           'health', case when a.enabled then 'ok' else 'blocked' end,
           'problem', a.disabled_reason,
           'last', case when a.last_synced_at is null then 'never'
                        else to_char(a.last_synced_at, 'FMDD Mon') end,
           'gave', (select count(*)::int from public.documents d
                     where d.project_id = p_project_id
                       and coalesce(d.connector, '') = a.connector)
         ) order by a.created_at), '[]'::jsonb)
    from public.project_attachments a
   where a.project_id = p_project_id
$$;

-- ---------------------------------------------------------------------------
-- Activity
-- ---------------------------------------------------------------------------
create or replace function app.studio_activity(p_project_id uuid, p_limit integer default 12)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'who', e.actor,
           'verb', app.action_in_words(e.action_type) ->> 'verb',
           'what', app.action_in_words(e.action_type) ->> 'what',
           'when', to_char(e.occurred_at, 'FMDD Mon HH24:MI'),
           'detail', e.rationale_summary
         ) order by e.occurred_at desc), '[]'::jsonb)
    from (select * from public.events ee
           where ee.project_id = p_project_id
           order by ee.occurred_at desc
           limit greatest(coalesce(p_limit, 12), 1)) e
$$;

-- ---------------------------------------------------------------------------
-- The payload, now an assembly rather than a monolith
-- ---------------------------------------------------------------------------
create or replace function app.hq_studio()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
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
         where jj.recipient_agent = s.slug
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
            where d.project_id = p.project_id) as docs,
          (select count(*)::int from public.tasks tk
            where tk.project_id = p.project_id and not tk.is_fixture
              and tk.state = 'done') as done,
          (select count(*)::int from public.tasks tk
            where tk.project_id = p.project_id and not tk.is_fixture) as total,

          (select format('%s by %s', left(tk.title, 40), to_char(tk.due_on, 'FMDD Mon'))
             from public.tasks tk
            where tk.project_id = p.project_id and not tk.is_fixture
              and tk.due_on is not null and tk.state in ('todo', 'doing')
            order by tk.due_on limit 1) as next,

          app.studio_documents(p.project_id) as documents,
          app.studio_tasks(p.project_id)     as tasks,
          app.studio_sources(p.project_id)   as sources,
          app.studio_activity(p.project_id)  as activity,

          -- Honestly empty. Contacts have no table (#24) and modules have none
          -- either; both are in the canonical IA. Returning something plausible
          -- would be a dashboard that invents a client.
          '[]'::jsonb as modules,
          '[]'::jsonb as contacts,
          '[]'::jsonb as requests

        from public.projects p
        where p.status = 'active' and not p.is_fixture
      ) t
  ),

  waiting as (
    select case when n.blocker_id is null then null else jsonb_build_object(
             'what', n.requested_action,
             'who', coalesce(n.originating_agent, 'The team'),
             'when', to_char(n.created_at, 'FMDD Mon'),
             'note', case when n.work_can_continue
                          then 'Everything else on that project is carrying on.'
                          else 'Nothing else on that project moves until you answer.' end
           ) end as v
      from (select * from public.needs_me
             order by overdue desc, real_deadline nulls last limit 1) n
     union all select null limit 1
  )

  select jsonb_build_object(
    'crew', (select v from people),
    'projects', (select v from projects),
    'waiting', (select v from waiting),
    'avatar_base', (select value #>> '{}' from public.system_config
                     where key = 'staff.avatar_base_url'),
    -- What the page may offer to change. Read from the same place the API
    -- enforces it, so a button that cannot work is never drawn.
    'connectors', (select coalesce(jsonb_agg(jsonb_build_object(
                            'connector', k.connector,
                            'name', app.connector_label(k.connector),
                            'enabled', k.enabled
                          ) order by k.name), '[]'::jsonb)
                     from public.knowledge_connectors k),
    'generated_at', app.now_utc()
  )
$$;

comment on function app.hq_studio() is
  'Everything the studio renders, assembled from one function per section '
  '(#68). Rewritten three times as a monolith before the fourth change made '
  'the case: a hundred and fifty lines copied to alter six.';

commit;
