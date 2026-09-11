-- What happened, in words a person uses.
--
-- Issue #68. The studio's Activity panel renders `who VERB what`, and 0219 fed
-- it the raw `action_type`, so every row on Grant's biggest project read
--
--     Claire finding.committed · 11 Sep 06:59
--
-- four times over. Two separate faults wearing one appearance: the payload had
-- no `verb` at all, and `what` was a machine identifier.
--
-- ## Split rather than looked up
--
-- `action_type` is constrained to dotted lowercase precisely so the ledger stays
-- queryable — 0003 says a free-form one makes it unqueryable within a month —
-- and that same shape is what makes this cheap. `finding.committed` is a noun
-- and a verb already; it needs separating and articling, not a lookup table
-- with fourteen rows that somebody has to remember to extend.
--
-- The handful where plain splitting reads badly get named. Everything else
-- degrades to something readable rather than to an identifier, which is the
-- property that matters when a new action type is added by someone who has
-- never seen this file.

begin;

/**
 * A ledger action as a verb and a thing, for a sentence.
 *
 * Returns `{verb, what}`. `office.skill_written` becomes "wrote down a
 * procedure" rather than "written office", because a mechanical split of that
 * one is worse than the identifier it replaces.
 */
create or replace function app.action_in_words(p_action text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_action
    when 'finding.committed'     then jsonb_build_object('verb', 'recorded', 'what', 'a finding')
    when 'office.learned'        then jsonb_build_object('verb', 'learned', 'what', 'something')
    when 'office.skill_written'  then jsonb_build_object('verb', 'wrote down', 'what', 'a procedure')
    when 'office.noticed'        then jsonb_build_object('verb', 'noticed', 'what', 'something unasked')
    when 'tool.requested'        then jsonb_build_object('verb', 'asked for', 'what', 'a tool')
    when 'tool.granted'          then jsonb_build_object('verb', 'was given', 'what', 'a tool')
    when 'tool.declined'         then jsonb_build_object('verb', 'was refused', 'what', 'a tool')
    when 'tool.revoked'          then jsonb_build_object('verb', 'lost', 'what', 'a tool')
    when 'tool.wanted'           then jsonb_build_object('verb', 'was promised', 'what', 'a tool')
    when 'job.committed'         then jsonb_build_object('verb', 'finished', 'what', 'a piece of work')
    when 'notebook.source_added' then jsonb_build_object('verb', 'added', 'what', 'a source')
    else
      /*
        The general case, and it has to be readable rather than merely present.

        Dotted lowercase with underscores is guaranteed by the constraint on
        `events.action_type`, so `thing.was_done` splits cleanly into "was done"
        and "a thing". A new action type nobody has named here still reads as a
        sentence, which is the whole point of not using a lookup table.
      */
      jsonb_build_object(
        'verb', replace(split_part(p_action, '.', 2), '_', ' '),
        'what', case
          when split_part(p_action, '.', 1) in ('office', 'ledger', 'system')
            -- These are the office acting on itself; "a office" is not a thing.
            then replace(split_part(p_action, '.', 1), '_', ' ')
          else 'a ' || replace(split_part(p_action, '.', 1), '_', ' ')
        end)
  end
$$;

comment on function app.action_in_words(text) is
  'A ledger action as a verb and a thing, so the activity panel reads as a '
  'sentence rather than an identifier (#68). Unnamed types degrade to '
  'something readable rather than to a machine string.';

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

          -- Now as a sentence: who, did what, to what, when.
          coalesce((
            select jsonb_agg(jsonb_build_object(
                     'who', e.actor,
                     'verb', app.action_in_words(e.action_type) ->> 'verb',
                     'what', app.action_in_words(e.action_type) ->> 'what',
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
