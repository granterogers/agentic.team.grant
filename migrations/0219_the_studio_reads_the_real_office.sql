-- The studio reads the real office.
--
-- Issue #68, ADR-0019. Grant, on opening the deployed dashboard: *"where all
-- the nice graphics that we spent so long trying to perfect?"* The answer was
-- that the designed frontend was never wired to anything, so the deploy shipped
-- the plain one. He has now decided the studio becomes the product.
--
-- ## One RPC in the shape the studio already renders
--
-- `web/studio/data.js` exports CREW, PROJECTS and WAITING, and eleven hundred
-- lines of the studio render exactly that shape. The cheap and wrong move is to
-- rewrite the studio around whatever the API happens to return; the right one is
-- to return what it already renders, so the visual work is untouched and the
-- change is a fetch.
--
-- Everything here is a count or a row. Nothing is invented — where the office
-- genuinely holds nothing, the section comes back empty and the studio has an
-- `emptyState` for precisely that, which it will now finally get to use.
--
-- ## Colour is design, not data, and stays out of this
--
-- `data.js` carries a `hue` per project and a `tone` per person. Those are
-- decisions from `docs/design/direction.md` about perception — the greens spaced
-- further apart than the blues because they are closer to the eye — and they
-- belong in the stylesheet's world, not in a database column that somebody will
-- eventually set to a hex code. The client maps them by slug.
--
-- ## What is honestly missing
--
-- **Contacts** have no table (#24) and **modules** have none either. Both are
-- in Grant's canonical IA, and both come back as empty arrays rather than as
-- something plausible. A dashboard that invents a contact is worse than one with
-- an empty Contacts tab, because the empty tab is true.

begin;

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
             -- What they are doing RIGHT NOW, from the queue rather than from a
             -- status column somebody has to remember to update.
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

          -- What it is wired to, in the words the connector uses about itself.
          coalesce((
            select array_agg(distinct coalesce(nullif(a.display_name, ''), a.connector)
                             order by coalesce(nullif(a.display_name, ''), a.connector))
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

          -- The nearest real deadline, phrased. Null when there is none, so the
          -- card omits the line rather than printing "no deadline".
          (select format('%s by %s', left(tk.title, 40), to_char(tk.due_on, 'FMDD Mon'))
             from public.tasks tk
            where tk.project_id = p.project_id and not tk.is_fixture
              and tk.due_on is not null and tk.state in ('todo', 'doing')
            order by tk.due_on limit 1) as next,

          /*
            Documents, newest first and capped.

            Forty-one on one project today, and a card that renders all of them
            is a card nobody scrolls past. The cap is here rather than in the
            client because the payload is the cost — a hundred documents with
            their content_chars is a slow first paint on a phone.
          */
          coalesce((
            select jsonb_agg(jsonb_build_object(
                     'title', d.title,
                     -- The studio's own vocabulary: pdf | doc | made | audio.
                     -- `origin` says where it came from; `doc_type` and the mime
                     -- say what it is, and audio is the one worth its own icon
                     -- because it plays rather than opens.
                     'kind', case
                       when coalesce(d.mime_type, '') like 'audio/%' then 'audio'
                       when d.origin = 'made' then 'made'
                       when coalesce(d.mime_type, '') = 'application/pdf'
                         or d.title ilike '%.pdf' then 'pdf'
                       else 'doc' end,
                     'origin', case d.origin
                       when 'yours' then 'Yours'
                       when 'made' then coalesce(d.produced_by, 'The team')
                       else coalesce(d.connector, 'Source') end,
                     'size', case
                       when d.duration_s is not null
                         then format('%s min', greatest(round(d.duration_s / 60.0), 1))
                       when coalesce(d.content_chars, 0) > 0
                         -- Words, not characters. Nobody has an intuition for
                         -- 34,606 characters and everybody has one for words.
                         then format('%s words', to_char(round(d.content_chars / 5.5), 'FM999G999'))
                       when d.byte_size is not null
                         then format('%s KB', greatest(round(d.byte_size / 1024.0), 1))
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

          -- What this project reads from, and whether it has given anything.
          coalesce((
            select jsonb_agg(jsonb_build_object(
                     'kind', 'connector',
                     'name', coalesce(nullif(a.display_name, ''), a.connector),
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

          /*
            Modules and contacts, honestly empty.

            Both are in Grant's canonical IA and neither has a table — contacts
            are #24 and modules have no issue yet. Returning [] means the studio
            shows its empty state, which is true. Returning something plausible
            would be a dashboard that invents a client.
          */
          '[]'::jsonb as modules,
          '[]'::jsonb as contacts,
          '[]'::jsonb as requests

        from public.projects p
        where p.status = 'active' and not p.is_fixture
      ) t
  ),

  -- The one thing that needs him, for the banner. `needs_me` is already the
  -- view that answers this and is deliberately uncapped; the banner takes one.
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

comment on function app.hq_studio() is
  'Everything the studio renders, in the shape web/studio/data.js already '
  'exports (#68, ADR-0019). Counts and rows only — where the office holds '
  'nothing the section is empty, because an invented contact is worse than an '
  'empty Contacts tab.';

create or replace function public.hq_studio()
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.hq_studio() $$;

commit;
