-- Harness traffic must be invisible to the Browser tab, at birth (#135).
--
-- 0442 shipped an append-only ledger with no way to tell a suite's row from
-- Grant's. That is the single most-repeated defect in this repository's own
-- list of traps -- 0342, 0351, 0355 and 0304 are all the same afternoon in
-- different costumes, and every one of them was a retrofit after somebody had
-- already been shown harness traffic as the office failing.
--
-- It is worse here than usual for two reasons. `browser_actions` is
-- append-only, so a row a suite leaves can never be removed; and a suite that
-- browses will write dozens of rows per run.
--
-- ## Derived, not copied
--
-- 0303 and 0304 are explicit that a flag COPIED onto an append-only row is a
-- fact frozen at insert and wrong for ever the moment the job's attribution is
-- corrected. So nothing is stored. `app.harness_browsing` derives it, once, in
-- the one place both readers ask, from the two things that can still tell the
-- truth: the job, and the project.
--
-- ## And the direction it may lie in
--
-- 0304's asymmetry again: either witness may truthfully say "this is harness
-- traffic" and neither may be trusted to say "this is real", so the rule is
-- `or`. A missing job is NOT evidence of real traffic -- 0210's left-join
-- lesson -- so a row with no job and no project is treated as harness, which
-- is the cheap direction: the worst case is a real row the Browser tab does
-- not show, against a fabricated failure reported to Grant.

create or replace function app.harness_browsing(p_job uuid, p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    -- a harness job, whatever the project says
    (p_job is not null and app.harness_job(p_job))
    -- or a fixture project, whatever the job says
    or (p_project is not null and exists (
          select 1 from public.projects x
           where x.project_id = p_project and x.is_fixture))
    -- or nothing that can vouch for it at all
    or (p_job is null and p_project is null);
$fn$;

comment on function app.harness_browsing(uuid, uuid) is
  'Is this browsing row the harness talking to itself? Derived from the job '
  'and the project because an append-only copy would freeze the answer. '
  'Either witness may exclude; neither may confirm -- hence or, not coalesce.';

-- The two readers 0442 shipped, with the filter and nothing else changed.

create or replace function app.browser_sessions_for(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(jsonb_agg(s.v order by s.ord), '[]'::jsonb) from (
    select row_number() over (order by b.established_at desc) as ord,
           jsonb_build_object(
             'session_id', b.session_id,
             'site', b.site,
             'purpose', b.purpose,
             'has_credential', b.credential_ref is not null,
             'established_at', b.established_at,
             'last_alive_at', b.last_alive_at,
             'state', case
               when b.revoked_at is not null then 'revoked'
               when b.expired_at is not null then 'signed_out'
               when b.credential_ref is null then 'needs_sign_in'
               else 'live' end,
             'actions', (select count(*)::int from public.browser_actions a
                          where a.session_id = b.session_id
                            and not app.harness_browsing(a.job_id, a.project_id))
           ) as v
      from public.browser_sessions b
     where b.project_id = p_project
  ) s;
$fn$;

create or replace function app.browser_lately(p_project uuid, p_limit int default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(jsonb_agg(x.v order by x.ord), '[]'::jsonb) from (
    select row_number() over (order by a.at desc) as ord,
           jsonb_build_object(
             'at', a.at, 'verb', a.verb, 'url', a.url, 'ok', a.ok,
             'detail', a.detail, 'shot_path', a.shot_path, 'ms', a.ms,
             'site', b.site
           ) as v
      from public.browser_actions a
      left join public.browser_sessions b on b.session_id = a.session_id
     where (p_project is null or a.project_id = p_project)
       and not app.harness_browsing(a.job_id, a.project_id)
     order by a.at desc
     limit greatest(coalesce(p_limit, 30), 1)
  ) x;
$fn$;

/*
  The budget counts harness minutes too, deliberately and against the pattern
  above. Cloudflare bills the office for a suite's browsing exactly as it bills
  for Grant's, so a meter that excluded the harness would report room that does
  not exist. What the tab SHOWS and what the vendor CHARGES are different
  questions and this is the one place they part company.
*/
create or replace function app.browser_budget()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  with cap as (
    select coalesce(
      (select nullif(value #>> '{}', '')::numeric from public.system_config
        where key = 'browser.daily_minutes'), 10)::numeric as minutes
  ), spent as (
    select coalesce(sum(a.ms), 0)::numeric / 60000 as minutes,
           count(*)::int as actions,
           count(*) filter (
             where app.harness_browsing(a.job_id, a.project_id))::int as harness_actions
      from public.browser_actions a
     where a.at >= date_trunc('day', app.now_utc())
  )
  select jsonb_build_object(
    'cap_minutes', round(cap.minutes, 2),
    'used_minutes', round(spent.minutes, 2),
    'left_minutes', round(greatest(cap.minutes - spent.minutes, 0), 2),
    'actions_today', spent.actions,
    'harness_actions_today', spent.harness_actions,
    'exhausted', spent.minutes >= cap.minutes
  ) from cap, spent;
$fn$;
