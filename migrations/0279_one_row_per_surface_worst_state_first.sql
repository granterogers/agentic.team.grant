-- 0279 — one row per surface, worst state first
--
-- 0278 was written against the wrong cause and did not fix the duplicate. The
-- brief still said:
--
--     GitHub, Google Drive, Google NotebookLM, Notion, Slack, Slack,
--     Telegram, Telegram
--
-- The guess was that Slack and Telegram appear both as connectors and as
-- surfaces. They do not: `knowledge_connectors` holds six rows — drive, github,
-- mcp, notebooklm, notion, upload — and **neither Slack nor Telegram is one of
-- them.** The `not exists` guard 0278 added therefore matched nothing.
--
-- The real cause is in `connection_health`, which holds more than one row per
-- service: Slack has two `ok` rows and Telegram has an `attested` and an `ok`.
-- The connectors half already handles that with a `limit 1` lateral ordered by
-- severity; the surfaces half selected them all.
--
-- Two things worth keeping from this:
--
-- **The fix was applied before the cause was found.** 0278's reasoning was
-- plausible, the migration was clean, and it changed nothing — because nobody
-- looked at `knowledge_connectors` before writing it. Two minutes of
-- `select connector, name from knowledge_connectors` would have skipped it.
-- CLAUDE.md already says *"guessing column names wastes hours"*; guessing row
-- CONTENTS is the same mistake with a different noun.
--
-- **This has been wrong in every capability brief the office has ever sent.**
-- `reachNow()` in `src/agents/capability.ts` has the same un-deduped union and
-- has since it was written. Nothing caught it because nothing rendered the
-- list anywhere a person would read it — the paragraph goes straight into a
-- prompt. `verify:capability` (new) now reads it.
--
-- Severity ordering rather than an arbitrary pick: if one Slack row says dead
-- and another says ok, the honest answer is dead. An agent told a surface is
-- reachable when half the record says otherwise is an agent about to promise
-- something.

begin;

create or replace function app.capability_index(p_staff text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
    /*
      The surfaces, only where a connector row does not already cover them.
      Slack and Telegram are both -- so before this they appeared twice in
      every brief. The branch stays because `connection_health` is the only
      place a surface's state lives, and Slack is one of the two things #64's
      false claim was about.
    */
    /*
      Wrapped in a subquery because `distinct on` needs its own `order by`, and
      an `order by` written directly in a UNION ALL branch belongs to the whole
      union rather than to the branch -- Postgres refuses it outright, which is
      the good outcome.
    */
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
              'tool', t.tool, 'level', t.level, 'what', t.description, 'verbs', to_jsonb(t.verbs))
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
$$;


commit;
