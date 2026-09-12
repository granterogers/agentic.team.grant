-- 0278 — a surface is not listed twice
--
-- `app.capability_index()` reports Slack and Telegram twice:
--
--     GitHub, Google Drive, Google NotebookLM, Notion, Slack, Slack,
--     Telegram, Telegram
--
-- because both are rows in `knowledge_connectors` AND are added again by the
-- surfaces branch of the union. 0277 lifted that union from `reachNow()` in
-- `src/agents/capability.ts`, so **the duplicate has been in every capability
-- brief the office has ever put in front of a model** — it was simply never
-- looked at, because nothing rendered the list where a person would read it.
--
-- Not cosmetic. That paragraph exists to be believed by a model, and a list
-- that repeats itself is a list that reads as carelessly assembled — which is
-- the last impression this particular paragraph can afford, given it exists to
-- stop an agent contradicting it (#64).
--
-- The surfaces branch stays, and it is not redundant: `connection_health` is
-- the only place a surface's state is recorded, and Slack was one of the two
-- things Claire was wrong about. It just yields to the connector row when one
-- exists, because the connector half carries `disabled_reason` as well.

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
    select c.service,
           c.state not in ('dead', 'missing'),
           case when c.state in ('dead', 'missing') then coalesce(c.detail, c.state) else null end
      from public.connection_health c
     where c.service in ('Slack', 'Telegram')
       and not exists (select 1 from connectors n where n.service = c.service)
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
