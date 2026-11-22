-- 1115 — one count says how many decisions are waiting for the person (SET-03, stress test of 21 November 2026)
--
-- "Waiting for you" was counted three ways: Activity counted open blockers, Requests counted open proposals, requests and
-- noticed offers, and Usage and health counted a third source. The person saw three numbers for one question.
--
-- app.pending_decisions counts every decision that is the person's to answer, from the same tables and with the same
-- harness exclusions the governance and blocker views already use:
--   blockers      open, not harness traffic (as public.needs_me)
--   proposals     open, not harness (as app.hq_governance)
--   requests      open tool requests
--   offers        open noticed offers that carry an offer, not harness (as app.hq_governance)
-- Team results waiting to be read are not decisions and are not counted here.
--
-- The count is returned with its four parts, so a screen can show the total and say what it is made of.

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

  return jsonb_build_object(
    'count', v_blockers + v_proposals + v_requests + v_offers,
    'blockers', v_blockers,
    'proposals', v_proposals,
    'requests', v_requests,
    'offers', v_offers
  );
end;
$$;

revoke all on function app.pending_decisions(uuid) from public, anon, authenticated, service_role;

comment on function app.pending_decisions(uuid) is
  'How many decisions are waiting for the person in this office, in four parts (SET-03, migration 1115). Team results are not counted.';

create or replace function public.pending_decisions(p_office uuid)
returns jsonb
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $$ select app.pending_decisions(p_office) $$;

revoke all on function public.pending_decisions(uuid) from public, anon, authenticated;
grant execute on function public.pending_decisions(uuid) to service_role;
