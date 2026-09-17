-- 0289 — the waiting list is where the work is
--
-- Issue #151, from #137 item 3, and Grant's second pick.
--
--   > *"2 things waiting on you" appears on the landing page. Inside a project
--   > — where you are when you could actually deal with it — it does not. So
--   > the one genuinely urgent category in the whole product is visible exactly
--   > where you are least able to act on it.*
--
--   > *the shape of failure this repo keeps rediscovering: the information
--   > exists, the surface exists, and they are in different rooms.*
--
-- `public.needs_me` has carried `project_id` all along. `hq_studio` reduced the
-- whole view to ONE item for the landing banner and threw the rest away, so a
-- project holding three of them showed none.
--
-- ## Three things, and the third is the one with no mechanism
--
--   1. the count in the project header — `app.studio_waiting` per project;
--   2. the items reachable in one press — the same payload, so no second fetch;
--   3. **each one actionable in place.** There was no way to answer a blocker
--      from anywhere. `app.answer_generation_approval` exists and does exactly
--      one kind; every other blocker could only be discussed.
--
-- ## One entry point, and it delegates rather than duplicates
--
-- `hq_answer_blocker` is the general answer, and where the blocker IS a
-- generation approval it hands straight to `answer_generation_approval` rather
-- than resolving `blockers` a second way. Two functions closing the same row
-- with different consequences is the "second place the rules live" problem, and
-- the consequence here is real: approving a generation queues the follow-on job
-- and a general resolve would not, so the approval would read as answered and
-- nothing would happen.
--
-- The discriminator is `jobs.pinned_config ? 'approval_next'`, which is what
-- `request_approval` writes. Blockers older than that key fall through to the
-- general path — they are historical and resolved, and a wrong guess there
-- would queue `notebook.generate` against something that never asked for it.

begin;

-- ---------------------------------------------------------------------------
-- 1. What is waiting, per project
-- ---------------------------------------------------------------------------

/**
 * The things waiting on Grant in one dashboard project.
 *
 * The same view the landing banner reads, not a second query with its own
 * opinion — `needs_me` decides what counts as waiting, here and there.
 *
 * Ordered the way the banner orders it: overdue first, then by real deadline.
 * A list whose order disagrees with the banner's is a list where "the urgent
 * one" is a different item depending on which room you are standing in, which
 * is the failure this Issue is about.
 */
create or replace function app.studio_waiting(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', n.blocker_id,
           'what', n.requested_action,
           'why', nullif(btrim(n.why_needed), ''),
           'who', coalesce(n.originating_agent, 'The team'),
           'when', to_char(n.created_at, 'FMDD Mon'),
           -- #153: the instant travels, so "2 days ago" stays true on a page
           -- that has been open all afternoon.
           'at', n.created_at,
           'overdue', n.overdue,
           'due', n.real_deadline,
           -- The answers this one will accept, when it names them. Empty means
           -- it wants words rather than a button, and the page draws a field.
           'options', to_jsonb(coalesce(n.approval_options, array[]::text[])),
           'blocks', not n.work_can_continue,
           'cost', nullif(btrim(n.consequences_of_delay), ''),
           'job', n.job_id
         )) order by n.overdue desc, n.real_deadline nulls last, n.created_at), '[]'::jsonb)
    from public.needs_me n
   where n.project_id = p_project_id
$$;

create or replace function public.studio_waiting(p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.studio_waiting(p_project_id) $$;

-- ---------------------------------------------------------------------------
-- 2. Answering one, wherever you are standing
-- ---------------------------------------------------------------------------

/**
 * Answer a blocker.
 *
 * Refuses an answer the blocker did not offer. `approval_options` is the list
 * the agent that raised it said it would accept, and accepting anything else
 * would let a button send a word the handler cannot act on — which resolves the
 * row and strands the job, the worst outcome available because the interface
 * would report success.
 *
 * A blocker naming no options takes free text: some of them genuinely want a
 * sentence rather than a choice.
 */
create or replace function app.hq_answer_blocker(p_blocker_id uuid, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  b        public.blockers;
  v_answer text := btrim(coalesce(p_answer, ''));
  v_next   text;
begin
  select * into b from public.blockers where blocker_id = p_blocker_id;
  if not found then
    return jsonb_build_object('error', 'there is nothing here to answer');
  end if;
  if b.state <> 'open' then
    -- Not an error. Answering something already answered is what two open tabs
    -- produces, and the honest reply is what it was answered with.
    return jsonb_build_object('ok', false, 'already', true,
      'state', b.state::text, 'resolution', b.resolution);
  end if;
  if v_answer = '' then
    return jsonb_build_object('error', 'say what the answer is');
  end if;

  if array_length(b.approval_options, 1) is not null
     and not (v_answer = any (b.approval_options)) then
    return jsonb_build_object('error', format(
      'that is not one of the answers this asks for: %s',
      array_to_string(b.approval_options, ', ')));
  end if;

  /*
    A generation approval is answered by the function that already knows what
    approving one MEANS — it queues the follow-on job. Resolving the row here
    instead would mark it answered and queue nothing.
  */
  select pinned_config ->> 'approval_next' into v_next
    from public.jobs where job_id = b.job_id;
  if v_next is not null then
    return app.answer_generation_approval(
      p_blocker_id,
      -- The affirmative half of whatever this blocker offered. Matched against
      -- the words agents actually use rather than assuming the first option is
      -- the yes, which is true today and is not a rule anybody wrote down.
      lower(v_answer) in ('yes', 'approve', 'approved', 'go ahead', 'ok', 'do it'),
      'grant'
    ) || jsonb_build_object('ok', true, 'answer', v_answer);
  end if;

  update public.blockers
     set state = 'resolved',
         resolved_at = app.now_utc(),
         resolution = format('%s — answered by grant', v_answer)
   where blocker_id = p_blocker_id;

  /*
    And the job is told, because a resolved blocker whose job is still parked in
    `waiting_user` is a job nothing will ever pick up. `state_reason` carries the
    answer so the handler can read it on the next pass.
  */
  update public.jobs
     set state = 'queued',
         state_reason = format('answered: %s', v_answer),
         updated_at = app.now_utc()
   where job_id = b.job_id
     and state in ('waiting_user', 'waiting_external', 'paused');

  return jsonb_build_object('ok', true, 'answer', v_answer, 'blocker', p_blocker_id);
end;
$$;

create or replace function public.hq_answer_blocker(p_blocker_id uuid, p_answer text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_answer_blocker(p_blocker_id, p_answer) $$;

grant execute on function app.studio_waiting(uuid) to ai_team_app;
grant execute on function public.studio_waiting(uuid) to ai_team_app;
grant execute on function app.hq_answer_blocker(uuid, text) to ai_team_app;
grant execute on function public.hq_answer_blocker(uuid, text) to ai_team_app;

-- ---------------------------------------------------------------------------
-- 3. And the project carries it
-- ---------------------------------------------------------------------------
--
-- Patched from `pg_get_functiondef`. One line added to the projects CTE, as a
-- CALL rather than as inline SQL — the next section added to a project should
-- be one line here and a function of its own, not another thirty lines in a
-- query that is already the longest in the schema.

create or replace function app.hq_studio_core()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
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
            where l.project_id = p.project_id and l.owner = 'grant') as layout,

          -- What the project LOOKS like, when he has said (#83).
          p.icon, p.icon_hue as "iconHue", p.image

        from public.projects p
        where p.status = 'active' and not p.is_fixture
      ) t
  ),

  waiting as (
    select case when n.blocker_id is null then null else jsonb_build_object(
             'what', n.requested_action,
             'who', coalesce(n.originating_agent, 'The team'),
             'when', to_char(n.created_at, 'FMDD Mon'),
             'slug', (select p.slug from public.projects p where p.project_id = n.project_id),
             'blocker', n.blocker_id,
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
        from app.jobs_stuck_queued() s
    ),
    'generated_at', app.now_utc()
  )
$function$;

commit;
