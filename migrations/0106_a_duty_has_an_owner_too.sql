-- 0106 — A duty has an owner, and the report should come from them
--
-- The first daily capacity report posted into `#the_team` as the bare app: no
-- name, no face, next to eight introductions that each had both.
--
-- `app.staff_behind_job` (0103) resolves a job's person from
-- `routing_decisions.roster[1]`, walked up the parent chain. A duty job has no
-- routing decision — nothing routed it, the dispatcher created it — so the
-- lookup found nobody and the notifier presented no one.
--
-- But a duty is the one kind of job whose owner is never in doubt: 0027 made
-- `responsibilities.staff_id` mandatory precisely so that "who is responsible
-- for noticing this" always has an answer, and 0098 seeded the capacity report
-- against Daniel because §9 gives him measurement and §11 gives him the
-- distinction between a measured figure and a modelled one.
--
-- So the fallback is not a guess. It is reading the answer that was already
-- recorded, in the one place a routing decision was never going to be.

begin;

create or replace function app.staff_behind_job(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with recursive lineage as (
    select job_id, parent_job_id, 0 as depth
      from public.jobs where job_id = p_job_id
    union all
    select j.job_id, j.parent_job_id, l.depth + 1
      from public.jobs j join lineage l on j.job_id = l.parent_job_id
     where l.depth < 8
  ),
  routed as (
    select st.slug, l.depth, r.decided_at
      from lineage l
      join public.routing_decisions r on r.job_id = l.job_id
      join public.staff st on st.slug = r.roster[1]
  ),
  -- The duty's owner, for a job the dispatcher created (0098). Matched on
  -- `requested_by`, which it writes as `duty:<slug>` and which no client can
  -- set.
  owned as (
    select st.slug
      from public.jobs j
      join public.responsibilities resp
        on 'duty:' || resp.slug = j.requested_by
      join public.staff st on st.staff_id = resp.staff_id
     where j.job_id = p_job_id and st.active
  )
  -- `coalesce` of two scalar subqueries, not a UNION with a LIMIT: a LIMIT
  -- inside a UNION branch needs parentheses, and the version that did not have
  -- them was a syntax error rather than a subtle bug — but the coalesce also
  -- says the precedence out loud, which the UNION did not.
  select coalesce(
    (select slug from routed order by depth asc, decided_at desc limit 1),
    (select slug from owned limit 1)
  )
$$;

comment on function app.staff_behind_job is
  'Who a job belongs to: the routing decision that convened them, walked up '
  'the parent chain, or - for a recurring duty, which nothing routes - the '
  'staff member who owns the responsibility. NOT outputs.staff_id, which has '
  'never been written.';

commit;
