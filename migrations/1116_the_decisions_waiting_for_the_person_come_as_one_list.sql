-- 1116 — the decisions waiting for the person come as one labelled list, as well as one count (SET-03, option B)
--
-- 1115 gave one count. The owner chose one list: Activity, Requests and Usage and health show the same total, and each item
-- carries its kind, so the number and the list cannot disagree. This replaces app.pending_decisions (same signature, same
-- counts, same exclusions) to also return the items, newest and most urgent first, at most 20 of each kind.
--
-- Team results are not decisions and are not listed here.

create or replace function app.pending_decisions(p_office uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $$
declare
  v_blockers  integer;
  v_proposals integer;
  v_requests  integer;
  v_offers    integer;
  v_items     jsonb;
begin
  perform app.require_office(p_office);

  select count(*)::int into v_blockers
    from public.blockers b
   where b.office_id = p_office
     and b.state = 'open'::blocker_state
     and not coalesce(app.harness_job(b.job_id), false);

  select count(*)::int into v_proposals
    from public.proposals r
   where r.office_id = p_office
     and r.state = 'open'
     and not app.harness_proposal(r.staff_slug, r.needed);

  select count(*)::int into v_requests
    from public.tool_requests q
   where q.office_id = p_office
     and q.state = 'open';

  select count(*)::int into v_offers
    from public.suggestions g
   where g.office_id = p_office
     and g.state = 'open'
     and g.offer_kind is not null
     and not app.harness_suggestion(g.offer_args);

  select coalesce(jsonb_agg(i.item order by i.rank, i.at desc), '[]'::jsonb) into v_items
    from (
      (select 0 as rank, b.created_at as at, jsonb_build_object(
                'id', b.blocker_id, 'kind', 'approval',
                'title', b.requested_action, 'who', coalesce(b.originating_agent, 'The team'),
                'overdue', b.real_deadline is not null and b.real_deadline <= app.now_utc(),
                'at', b.created_at) as item
         from public.blockers b
        where b.office_id = p_office and b.state = 'open'::blocker_state
          and not coalesce(app.harness_job(b.job_id), false)
        order by b.created_at desc limit 20)
      union all
      (select 1, r.last_seen, jsonb_build_object(
                'id', r.proposal_id, 'kind', 'proposal',
                'title', r.title, 'who', r.staff_slug, 'overdue', false, 'at', r.last_seen) as item
         from public.proposals r
        where r.office_id = p_office and r.state = 'open' and not app.harness_proposal(r.staff_slug, r.needed)
        order by r.last_seen desc limit 20)
      union all
      (select 2, q.raised_at, jsonb_build_object(
                'id', q.request_id, 'kind', 'tool',
                'title', 'Asks for the ' || q.tool || ' tool', 'who', q.asked_by, 'overdue', false, 'at', q.raised_at) as item
         from public.tool_requests q
        where q.office_id = p_office and q.state = 'open'
        order by q.raised_at desc limit 20)
      union all
      (select 3, g.raised_at, jsonb_build_object(
                'id', g.suggestion_id, 'kind', 'offer',
                'title', g.body, 'who', 'Claire', 'overdue', false, 'at', g.raised_at) as item
         from public.suggestions g
        where g.office_id = p_office and g.state = 'open' and g.offer_kind is not null
          and not app.harness_suggestion(g.offer_args)
        order by g.raised_at desc limit 20)
    ) i;

  return jsonb_build_object(
    'count', v_blockers + v_proposals + v_requests + v_offers,
    'blockers', v_blockers,
    'proposals', v_proposals,
    'requests', v_requests,
    'offers', v_offers,
    'items', v_items
  );
end;
$$;

comment on function app.pending_decisions(uuid) is
  'The decisions waiting for the person in this office: one count in four parts, and the items labelled by kind (SET-03, migrations 1115 and 1116). Team results are not counted.';
