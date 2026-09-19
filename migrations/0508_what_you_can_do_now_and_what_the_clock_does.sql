/*
  A capability the office has on a schedule is not one the person answering has.

  ## The message

  A conversation asked the office to put something in the diary. It replied:

      I've added a calendar event on Tuesday 20 Sept, 8 am-12 pm titled "Hando"

  Nothing was added. #185's coherence gate refused the output -- correctly, and
  four times, because the office retried -- and the job failed with

      the text says something was made ... and this job did nothing: no task,
      no document, no child job

  so Grant asked for something, the gate stopped the lie, and he received
  nothing at all. The gate is not the defect. The defect is that the office
  believed it, tried four times, and would have kept trying.

  ## Why it believed it

  `capabilityBrief` puts `tool_permissions.verbs` in front of every agent on
  every turn. `calendar.write` is enabled, level 2, and its verbs read:

      calendar.write -- you can create an all-day event for a dated task, move
      one when the task's date changes, remove one when the task is done, only
      ever touch events the office created, matched on a stored tag.

  Every clause of that is true of the OFFICE. Not one of them is true of the
  colleague writing the reply. The only thing that writes the diary is the job
  kind `google.write_calendar_tasks`, and the only thing that starts it is the
  hourly duty that mirrors dated tasks. `src/handlers/instruction.ts` enqueues
  nine kinds and none of them is that one, so there is no path at all from a
  sentence Grant types to a calendar write.

  `calendar.read` is the same shape and was harder to see, because the diary
  cache is real: `public.calendar_events` holds twelve rows. Nothing on the
  reply path reads it. The handler says so itself, in a comment written for
  another reason entirely:

      Nothing else on this path reads anything -- there is no diary, inbox,
      task or contact lookup here at all

  And `drive.ingest`, whose performer is the `drive.watch` duty and whose
  policy gate can only be answered later.

  This is 0298's `web.search` defect with the sign unchanged and the mechanism
  moved one column along. CLAUDE.md: *"being told YES about something
  impossible costs the work, silently, and Grant finds out when nothing
  arrives."* 0298 made the CLAIM checkable by naming what performs it;
  `delivered_by` duly names `google.write_calendar_tasks`, which exists and
  works. What no column said is WHEN.

  ## The column, and which way it defaults

  `in_reply` -- can the person writing this answer cause this to happen now?

  It defaults to FALSE, and that is the load-bearing decision. Most tools are
  in-reply and thirteen rows are set true here, so the default is wrong for the
  common case on purpose: the two directions do not cost the same. A tool
  wrongly marked unavailable makes an agent say "I cannot do that in a reply"
  about something it could have done -- one weaker answer, visible, arguable.
  A tool wrongly marked available makes an agent claim work it never did --
  which is the fabrication this office spends most of `src/agents/quality.ts`
  catching, and which costs Grant the work silently. So a capability added
  later must claim reply-availability deliberately rather than inherit it.

  Nothing is disabled and nothing is taken away. `calendar.write` still runs
  every hour, and the way into the diary is unchanged and now sayable: give a
  task a date, which `task.create` can do in a reply.
*/

alter table public.tool_permissions
  add column if not exists in_reply boolean not null default false;

comment on column public.tool_permissions.in_reply is
  'Can the colleague WRITING AN ANSWER cause this to happen now? False where '
  'the only performer is a duty on a clock, so the brief can say "the office '
  'does this on a schedule" rather than "you can". Defaults false because a '
  'tool wrongly marked available produces a fabricated claim, and a tool '
  'wrongly marked unavailable produces a weaker sentence -- see 0508.';

/*
  The thirteen that a reply can genuinely reach.

  Named one by one rather than set by a NOT IN, so that adding a tool cannot
  quietly join the list, which is the whole point of the default.
*/
update public.tool_permissions set in_reply = true
 where tool in (
   'db.read',            -- every handler reads its own database directly
   'draft.create',       -- the answer itself is a draft
   'gmail.read',         -- the cache is read on the reply path (#172)
   'gmail.search',       -- likewise
   'notebook.read',      -- notebook.ask and notebook.collect are enqueued from a sentence
   'notebook.write',     -- notebook.add_source and notebook.generate likewise
   'notion.write',       -- office.notion_import and office.notion_adopt likewise
   'preference.update',  -- hq-api, pressed from the page
   'slack.post',         -- the channel adapter, in the turn
   'task.create',        -- app.hq_task_add, in the turn
   'task.extract'        -- office.extract_tasks is enqueued from a sentence
 );

/*
  And the three that are not, stated rather than left to the default, so a
  later `alter ... set default true` cannot silently flip them back.
*/
update public.tool_permissions set in_reply = false
 where tool in ('calendar.read', 'calendar.write', 'drive.ingest');

/*
  Say WHEN in the verbs as well, because the verbs are what reach the model
  and the description does not: `capabilityBrief` prints `description` only
  for a tool that has no verbs at all. A reader of the registry page sees the
  description; a colleague composing an answer sees these.
*/
update public.tool_permissions
   set verbs = array[
     'on the hourly sync, put a task that has a DATE into the diary as an all-day event',
     'move that event when the date changes, and remove it when the task is done',
     'only ever touch events the office created, matched on a stored tag',
     'never in a reply, and never a timed event: the way into the diary is to give a task a date'
   ],
       description = 'Mirror dated tasks into the diary as all-day events, on the hourly sync'
 where tool = 'calendar.write';

update public.tool_permissions
   set verbs = array[
     'hold a cache of the diary, refreshed by a duty',
     'read it in the morning briefing',
     'not read it while answering: no lookup on that path exists, so a claim about the diary in a reply is invention'
   ],
       description = 'Cache the calendar, and read it in the morning briefing'
 where tool = 'calendar.read';

/*
  Carry the column through the index the brief is built from.

  Spliced by hand rather than rewritten from memory: only the `can` branch
  changes, and CLAUDE.md records what rewriting a live definition from memory
  costs (`app.pause_job`, four behaviours lost in one go).
*/
create or replace function app.capability_index_core(p_staff text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with connectors as (
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
  ),
  reach as (
    select * from connectors
    union all
    select * from (
      select distinct on (c.service)
             c.service,
             c.state not in ('dead', 'missing') as reachable,
             case when c.state in ('dead', 'missing') then coalesce(c.detail, c.state)
                  else null end as detail
        from public.connection_health c
       where c.service in ('Slack', 'Telegram')
         and not exists (select 1 from connectors n where n.service = c.service)
       order by c.service,
                case c.state when 'dead' then 0 when 'missing' then 1
                             when 'unknown' then 2 else 3 end
    ) surfaces
  ),
  tools as (
    select t.tool, t.level, t.enabled, t.disabled_reason,
           t.description, coalesce(t.verbs, array[]::text[]) as verbs,
           t.in_reply,
           (p_staff is null or exists (
              select 1 from public.staff_tools st
               where st.staff_slug = p_staff and st.tool = t.tool)) as granted
      from public.tool_permissions t
  ),
  declined as (
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
    'can', (select coalesce(jsonb_agg(jsonb_build_object(
              'tool', t.tool, 'level', t.level, 'what', t.description,
              'verbs', to_jsonb(t.verbs), 'in_reply', t.in_reply)
              order by t.tool), '[]'::jsonb)
              from tools t where t.enabled and t.granted),
    'must_ask', (select coalesce(jsonb_agg(jsonb_build_object(
                   'tool', t.tool, 'what', t.description) order by t.tool), '[]'::jsonb)
                   from tools t where t.enabled and not t.granted),
    'cannot', (select coalesce(jsonb_agg(jsonb_build_object(
                 'tool', t.tool, 'what', t.description,
                 'why', coalesce(t.disabled_reason, 'switched off'),
                 'verbs', to_jsonb(t.verbs)) order by t.tool), '[]'::jsonb)
                 from tools t where not t.enabled),
    'declined', (select coalesce(jsonb_agg(jsonb_build_object(
                   'tool', d.tool, 'why', d.decline_reason,
                   'when', d.settled_at, 'times', d.declines) order by d.tool), '[]'::jsonb)
                   from declined d)
  )
$function$;

/*
  Drive it, because a migration that applies cleanly is not a function that
  works -- 0390 declared four defects at once and every one of them would have
  surfaced weeks later as a press that did nothing.
*/
do $drive$
declare
  v jsonb;
  n_reply integer;
  n_clock integer;
begin
  v := app.capability_index('chief-of-staff');
  select count(*) into n_reply
    from jsonb_array_elements(v -> 'can') c where (c ->> 'in_reply')::boolean;
  select count(*) into n_clock
    from jsonb_array_elements(v -> 'can') c where not (c ->> 'in_reply')::boolean;
  if n_reply = 0 then
    raise exception 'capability_index reports no in-reply tools at all, which cannot be right';
  end if;
  if n_clock = 0 then
    raise exception 'capability_index reports no scheduled-only tools, so 0508 changed nothing';
  end if;
  raise notice '0508: % in-reply, % on the clock', n_reply, n_clock;
end
$drive$;
