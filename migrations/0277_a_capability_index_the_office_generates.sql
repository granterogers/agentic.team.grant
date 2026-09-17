-- 0277 — a capability index the office generates
--
-- Issue #148, the first slice of #170, tracked from #169.
--
-- ## The bug underneath it
--
-- #64. Claire told Grant *"I can't post to Slack or pull data from your Notion
-- teamspace. I don't have integration access."* She was posting in Slack as she
-- said it, the Notion token works, and the notebook had been read twenty
-- minutes earlier. He then asked for a feature that already existed.
--
-- `src/agents/capability.ts` was written for that and it works. It has one
-- structural flaw and this migration is about that flaw:
--
--     `verbsNow()` is a hand-written list in TypeScript covering THREE of the
--     twenty-one tools.
--
-- #148 says exactly why that is the wrong shape:
--
--   > The index is generated from the live state, never hand-maintained. A
--   > hand-maintained capability list is wrong within a fortnight and is then
--   > worse than no list, because it is believed.
--
-- Eighteen tools have no verb at all, so an agent asked about any of them
-- answers from what a language model is rather than from what this office is —
-- which is precisely how #64 happened.
--
-- ## Data, not TypeScript, and that is the point
--
-- The verbs do not become *derived* — a verb is a sentence somebody writes. They
-- become **a column**, so the office can correct one without a deploy. Grant's
-- long-range goal is the argument:
--
--   > *"I want to reduce my dependence on Claude or another coding interface
--   > for maintaining and extending the system."*
--
-- A verb list in `src/agents/capability.ts` is a capability only I can fix. A
-- verb list in `tool_permissions.verbs` is one he can fix, and one #50's skills
-- machinery can eventually write.
--
-- ## Per agent, because reach is per agent
--
-- `verbsNow()` answered globally. `app.staff_may_use` has been per-staff since
-- 0119, so telling Ruby she can write to Notion when she holds no such grant is
-- a promise the boundary will refuse — and an agent that has been lied to about
-- its own reach cannot ask for the right thing (#49).
--
-- So the index answers four different questions, and keeping them apart is what
-- makes it useful:
--
--   `can`       — enabled, and this agent holds the grant
--   `must_ask`  — enabled, and it does not: ADR-0018 says ask, do not assume
--   `cannot`    — switched off for everyone, with the reason
--   `declined`  — asked for and refused, so it is not re-requested
--
-- The last one exists because a declined request that is invisible becomes a
-- request made again next week, which is how a boundary turns into a nag.

begin;

/*
  What a tool can actually be made to DO.

  Separate from `description`, which is the one-line label the Settings screen
  shows. "Create or change a calendar event" is a label; "create an all-day
  event tagged to a task, move one, remove one we created" is what stops an
  agent offering to write something out for Grant to paste in.

  Null rather than an empty array where nobody has written them yet, so the
  index can say "no verbs recorded" rather than implying the tool does nothing.
*/
alter table public.tool_permissions add column verbs text[];

comment on column public.tool_permissions.verbs is
  '#148. What the tool can be made to do, in a person''s words. A COLUMN rather '
  'than a list in TypeScript so the office can correct one without a deploy — '
  'Grant''s standing goal is to depend less on a coding session, and eighteen '
  'of these had no verb at all while the list lived in src/agents/capability.ts.';

/*
  Seeded from `src/agents/capability.ts`, verbatim where it had them.

  The Notion six are reproduced exactly rather than summarised: they were
  written against a specific failure — Claire offering to produce an outline
  "ready for you to add" when she could add it herself — and a tidier version
  would lose the sentence that fixed it.
*/
update public.tool_permissions set verbs = array[
  'create pages in any shared data source',
  'append and update blocks',
  'set properties and relations',
  'upload and attach files including audio and video',
  'archive a page (reversibly)',
  'read a database schema before writing to it'
] where tool = 'notion.write';

update public.tool_permissions set verbs = array[
  'add a link or a note as a source',
  'push a document the office holds into a notebook',
  'ask for a generated artifact and collect it when it is ready'
] where tool = 'notebook.write';

update public.tool_permissions set verbs = array[
  'read repositories, branches, the README, the source tree, issues and releases'
] where tool = 'github.read';

-- And the eighteen that had none. Written from what the handlers actually do,
-- not from what the tool is called.
update public.tool_permissions set verbs = array[
  'read the diary, including all-day events and attendees'
] where tool = 'calendar.read';

update public.tool_permissions set verbs = array[
  'create an all-day event for a dated task',
  'move one when the task''s date changes',
  'remove one when the task is done',
  'only ever touch events the office created, matched on a stored tag'
] where tool = 'calendar.write';

update public.tool_permissions set verbs = array[
  'read a message, its thread and its attachments'
] where tool = 'gmail.read';

update public.tool_permissions set verbs = array[
  'search the mailbox by sender, subject, date and text'
] where tool = 'gmail.search';

update public.tool_permissions set verbs = array[
  'write a draft into Gmail for Grant to review and send himself'
] where tool = 'gmail.draft';

update public.tool_permissions set verbs = array[
  'read notebooks, their sources and the cached full text'
] where tool = 'notebook.read';

update public.tool_permissions set verbs = array[
  'post a message to a project channel or the office floor',
  'messages carry the sender''s own face and name'
] where tool = 'slack.post';

update public.tool_permissions set verbs = array[
  'search the web and read what comes back'
] where tool = 'web.search';

update public.tool_permissions set verbs = array[
  'read any of the office''s own records — projects, documents, tasks, jobs, outputs'
] where tool = 'db.read';

update public.tool_permissions set verbs = array[
  'create a task on a dashboard project, with a date, an owner and a parent'
] where tool = 'task.create';

update public.tool_permissions set verbs = array[
  'write an internal note nobody is paged about'
] where tool = 'note.create';

update public.tool_permissions set verbs = array[
  'draft something for Grant to approve before it goes anywhere'
] where tool = 'draft.create';

update public.tool_permissions set verbs = array[
  'change how loudly a kind of thing reaches him'
] where tool = 'preference.update';

-- The disabled ones get verbs too. An agent should be able to say WHAT it would
-- be able to do if Grant switched something on -- that is #49's whole point,
-- and a tool with no verbs cannot be proposed usefully.
update public.tool_permissions set verbs = array[
  'send an email as Grant'
] where tool = 'gmail.send';

update public.tool_permissions set verbs = array[
  'open a pull request, push a commit, change a file'
] where tool = 'github.write';

update public.tool_permissions set verbs = array[
  'delete application data'
] where tool = 'db.delete';

update public.tool_permissions set verbs = array[
  'change production configuration or a security boundary'
] where tool = 'production.write';

update public.tool_permissions set verbs = array[
  'anything that costs money'
] where tool = 'spend.money';

-- ---------------------------------------------------------------------------
-- The index
-- ---------------------------------------------------------------------------

/**
 * What this office can do, right now, for this agent.
 *
 * Generated on every call from `tool_permissions`, `staff_tools`,
 * `knowledge_connectors`, `connection_health` and `tool_requests`. Nothing is
 * cached and nothing is stored: a capability index that can be stale is a
 * capability index that is believed while wrong, which is worse than none.
 *
 * `p_staff` null answers for the office rather than for a person — what the
 * studio shows, and what a job with no assigned agent gets.
 *
 * In SQL rather than in TypeScript because the worker and the Edge Function
 * both need it and a second copy is how two runtimes come to disagree about
 * what the office can reach. Same reasoning as `app.classify_failure` (0274).
 */
create or replace function app.capability_index(p_staff text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with reach as (
    /*
      Lifted from `reachNow()` in src/agents/capability.ts, so there is one
      description of what "reachable" means. A connector switched on with a dead
      credential is NOT reachable, and saying so is the honest answer.
    */
    select k.name as service,
           (k.enabled and coalesce(h.state, 'ok') not in ('dead', 'missing')) as reachable,
           case when not k.enabled then coalesce(k.disabled_reason, 'switched off')
                when h.state in ('dead', 'missing') then coalesce(h.detail, h.state)
                else null end as detail
      from public.knowledge_connectors k
      left join lateral (
        select ch.state, ch.detail
          from public.connection_health ch
         where ch.service = k.health_service
         order by case ch.state when 'dead' then 0 when 'missing' then 1
                                when 'unknown' then 2 when 'ok' then 3 else 4 end
         limit 1
      ) h on true
     where k.connector not in ('upload', 'mcp')
    union all
    -- The surfaces. Not connectors, and two of #64's three false claims were
    -- about Slack.
    select c.service,
           c.state not in ('dead', 'missing'),
           case when c.state in ('dead', 'missing') then coalesce(c.detail, c.state) else null end
      from public.connection_health c
     where c.service in ('Slack', 'Telegram')
  ),
  tools as (
    select t.tool, t.level, t.enabled, t.disabled_reason,
           t.description, coalesce(t.verbs, array[]::text[]) as verbs,
           /*
             Null staff means "the office". A per-agent answer needs the grant;
             the office-wide one is about what exists at all.
           */
           (p_staff is null or exists (
              select 1 from public.staff_tools st
               where st.staff_slug = p_staff and st.tool = t.tool)) as granted
      from public.tool_permissions t
  ),
  declined as (
    -- Most recent refusal per tool. A tool asked for three times and refused
    -- three times should read as one closed door, not three.
    select distinct on (r.tool)
           r.tool, r.decline_reason, r.settled_at, r.declines
      from public.tool_requests r
     where r.state = 'declined'
     order by r.tool, r.settled_at desc nulls last
  )
  select jsonb_build_object(
    'at', app.now_utc(),
    'for', coalesce(p_staff, 'the office'),
    'reach', (select coalesce(jsonb_agg(jsonb_build_object(
                'service', r.service, 'reachable', r.reachable, 'detail', r.detail)
                order by r.service), '[]'::jsonb) from reach r),
    -- Enabled, and this agent holds the grant.
    'can', (select coalesce(jsonb_agg(jsonb_build_object(
              'tool', t.tool, 'level', t.level, 'what', t.description, 'verbs', to_jsonb(t.verbs))
              order by t.tool), '[]'::jsonb)
              from tools t where t.enabled and t.granted),
    -- Enabled for the office, not granted to this agent. ADR-0018: ask.
    'must_ask', (select coalesce(jsonb_agg(jsonb_build_object(
                   'tool', t.tool, 'what', t.description) order by t.tool), '[]'::jsonb)
                   from tools t where t.enabled and not t.granted),
    -- Off for everyone, with the reason, so a proposal can be specific (#49).
    'cannot', (select coalesce(jsonb_agg(jsonb_build_object(
                 'tool', t.tool, 'what', t.description,
                 'why', coalesce(t.disabled_reason, 'switched off'),
                 'verbs', to_jsonb(t.verbs)) order by t.tool), '[]'::jsonb)
                 from tools t where not t.enabled),
    -- Already asked for and refused. Not asked again.
    'declined', (select coalesce(jsonb_agg(jsonb_build_object(
                   'tool', d.tool, 'why', d.decline_reason,
                   'when', d.settled_at, 'times', d.declines) order by d.tool), '[]'::jsonb)
                   from declined d)
  )
$$;

comment on function app.capability_index is
  '#148. What the office can do, generated on every call and never stored — a '
  'capability index that can be stale is believed while wrong. Four separate '
  'answers: can / must_ask / cannot / declined, because "I may not" and "nobody '
  'may" and "we already asked" need different replies.';

-- PostgREST only exposes `public`.
create or replace function public.hq_capability_index(p_staff text default null)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.capability_index(p_staff) $$;

grant execute on function app.capability_index(text) to ai_team_app;

commit;
