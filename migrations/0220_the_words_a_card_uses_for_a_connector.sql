-- The words a card uses for a connector, and when a size is worth printing.
--
-- Issue #68. 0219 wired the studio to real data and the first render showed
-- three things that are true and read badly, which is the ordinary shape of
-- wiring a designed surface to a real database.
--
-- **1. The connector list showed database names.** Legacy Coaching Course came
-- back as `["Docs", "Legacy Coaching Course", "Projects", "Tasks"]` — four
-- Notion data sources — where the card wants to say `Notion`. `display_name` is
-- the right field for a Sources row, which names the individual thing; it is the
-- wrong one for the card, which names the KIND. Distinct on the connector, and
-- given the capitalisation the vendor uses about itself: nobody writes
-- "notebooklm".
--
-- **2. A document said "2 words".** Honest — several Notion pages really are
-- twenty-four characters, because they are database containers ingested as
-- documents (#19). But a size only earns its place when it tells you something,
-- and "4 words" tells you the metadata is broken even when it is not. Below a
-- hundred words it says nothing, which reads as "small" without making a claim.
--
-- **3. A source document was attributed to `notebooklm`.** Same fix as (1),
-- from the same helper, so the two cannot drift.

begin;

/**
 * How a connector spells its own name.
 *
 * One function, so the card, the sources row and the document byline cannot
 * disagree about whether it is `notebooklm`, `NotebookLM` or `Notebook LM`.
 * Unknown connectors are title-cased rather than dropped — a new one should
 * look slightly plain, never invisible.
 */
create or replace function app.connector_label(p_connector text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(p_connector, ''))
    when 'notebooklm' then 'NotebookLM'
    when 'notion'     then 'Notion'
    when 'drive'      then 'Google Drive'
    when 'gmail'      then 'Gmail'
    when 'calendar'   then 'Calendar'
    when 'github'     then 'GitHub'
    when 'slack'      then 'Slack'
    when 'upload'     then 'Uploads'
    when 'mcp'        then 'MCP'
    when ''           then 'Unattached'
    else initcap(p_connector)
  end
$$;

comment on function app.connector_label(text) is
  'The capitalisation a vendor uses about itself, in one place so the card, '
  'the sources row and a document byline cannot disagree (#68).';

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
          p.slug, p.name,
          coalesce(nullif(btrim(p.purpose), ''), '') as purpose,

          -- The KIND, not the instance. Four Notion data sources are one Notion.
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

          coalesce((
            select jsonb_agg(jsonb_build_object(
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
                     /*
                       A size only when it says something.

                       Below a hundred words "4 words" reads as broken metadata
                       even when it is exactly right, and several of these
                       really are twenty-four characters because they are Notion
                       database containers ingested as documents (#19).
                     */
                     'size', case
                       when d.duration_s is not null
                         then format('%s min', greatest(round(d.duration_s / 60.0), 1))
                       when coalesce(d.content_chars, 0) >= 550
                         then format('%s words', to_char(round(d.content_chars / 5.5), 'FM999G999'))
                       when d.byte_size is not null and d.byte_size >= 1024
                         then format('%s KB', round(d.byte_size / 1024.0))
                       else '' end,
                     'state', d.state
                   ) order by d.created_at desc)
              from (select * from public.documents dd
                     where dd.project_id = p.project_id
                     order by dd.created_at desc limit 24) d
          ), '[]'::jsonb) as documents,

          coalesce((
            select jsonb_agg(jsonb_build_object(
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
                     tk.due_on nulls last)
              from public.tasks tk
              left join public.staff st on st.staff_id = tk.assignee_staff
             where tk.project_id = p.project_id and not tk.is_fixture
          ), '[]'::jsonb) as tasks,

          -- The Sources row DOES name the individual thing, because that is
          -- what it is for: which notebook, which database, which folder.
          coalesce((
            select jsonb_agg(jsonb_build_object(
                     'kind', 'connector',
                     'name', coalesce(nullif(a.display_name, ''),
                                      app.connector_label(a.connector)),
                     'via', app.connector_label(a.connector),
                     'what', a.role,
                     'health', case when a.enabled then 'ok' else 'blocked' end,
                     'problem', a.disabled_reason,
                     'last', case when a.last_synced_at is null then 'never'
                                  else to_char(a.last_synced_at, 'FMDD Mon') end,
                     'gave', (select count(*)::int from public.documents d
                               where d.project_id = p.project_id
                                 and coalesce(d.connector, '') = a.connector)
                   ) order by a.created_at)
              from public.project_attachments a
             where a.project_id = p.project_id
          ), '[]'::jsonb) as sources,

          coalesce((
            select jsonb_agg(jsonb_build_object(
                     'what', e.action_type,
                     'who', e.actor,
                     'when', to_char(e.occurred_at, 'FMDD Mon HH24:MI'),
                     'detail', e.rationale_summary
                   ) order by e.occurred_at desc)
              from (select * from public.events ee
                     where ee.project_id = p.project_id
                     order by ee.occurred_at desc limit 12) e
          ), '[]'::jsonb) as activity,

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
    'generated_at', app.now_utc()
  )
$$;

commit;
