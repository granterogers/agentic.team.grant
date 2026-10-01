-- 0780 - the office-explicit pieces the job lifecycle needs (multi-user P3, cluster h-jobs).
--
-- The worker's internal functions (approvals, deliveries, conversation memory, proposals) read four things that were
-- never office-aware: the autonomy dial and standing authorizations (`app.may_act`, `app.autonomy_for`), the
-- impediment tally (`app.impediments_tally`) and the harness-proposal test (`app.harness_proposal`). Each read a row of
-- EVERY office: `project_id is null` meant "global to the deployment", so one office's "do not ask again" or its
-- dial setting was another office's. These are the scoped readers, under the `_in` convention 0750 set (`needs_me_in`):
-- the old names are left alone for their last legacy callers, and the lead drops them when those move.
--
--   app.autonomy_for_in(p_office, p_project)       - the dial inside ONE office; null project = that office's global row
--   app.may_act_in(p_office, p_project, tool, job) - may_act reading only that office's standing yes and that office's job
--   app.impediments_tally_in(p_office, ...)        - the tally over that office's jobs only
--   app.harness_proposal_in(p_office, staff, need) - "is every impediment behind this proposal harness", that office only
--   app.delivery_office(job, channel, target)      - the office a delivery is claimed for: its job's, else the test office
--                                                     for a registered test destination, else the operator's
--
-- A foreign project, a foreign job and a nonexistent one all read the same: nothing in this office matches them.

create function app.autonomy_for_in(p_office uuid, p_project_id uuid default null)
returns public.autonomy_level
language sql
stable
security definer
set search_path to ''
as $f$
  select coalesce(
    -- The project's own setting, if it has one and the project is this office's.
    (select s.level from public.autonomy_settings s
      where s.office_id = app.require_office(p_office)
        and s.project_id is not distinct from p_project_id
      order by s.set_at desc, s.setting_id desc limit 1),
    -- Otherwise this office's global setting.
    (select s.level from public.autonomy_settings s
      where s.office_id = p_office and s.project_id is null
      order by s.set_at desc, s.setting_id desc limit 1),
    -- Otherwise the conservative default. A missing configuration must not read as permission.
    'suggest'::public.autonomy_level
  );
$f$;
revoke all on function app.autonomy_for_in(uuid, uuid) from public, anon, authenticated, service_role;

create function app.may_act_in(p_office uuid, p_project uuid, p_tool text, p_job uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_tool      record;
  v_autonomy  public.autonomy_level;
  v_verdict   public.policy_verdict;
  v_note      text;
  v_standing  record;
  v_asked_for boolean := false;
  v_by        text;
begin
  perform app.require_office(p_office);

  select tool, level, enabled, disabled_reason into v_tool
    from public.tool_permissions where tool = p_tool;
  if not found then
    return jsonb_build_object('verdict', 'refuse', 'tool', p_tool,
      'because', format('There is no such capability as %s.', p_tool));
  end if;

  -- A disabled tool is refused before the dial is consulted: the registry is the authority on what exists.
  if not v_tool.enabled then
    return jsonb_build_object('verdict', 'refuse', 'tool', p_tool,
      'action_level', v_tool.level,
      'because', coalesce(nullif(btrim(v_tool.disabled_reason), ''),
                          format('%s is switched off for everyone.', p_tool)));
  end if;

  -- Did a PERSON ask for this, or did the office decide to do it? Only a job of THIS office can say so: a foreign
  -- job and a nonexistent one both leave v_by null, which is the conservative reading (unprompted).
  if p_job is not null then
    select j.requested_by into v_by from public.jobs j where j.job_id = p_job and j.office_id = p_office;
    if v_by is not null then
      v_asked_for := v_by not like 'duty:%' and not app.job_forwarded(p_job)
                     and app.job_origin(p_job) in ('trusted', 'harness');
    end if;
  end if;

  v_autonomy := app.autonomy_for_in(p_office, p_project);

  select verdict, note into v_verdict, v_note
    from public.autonomy_policy
   where autonomy = v_autonomy and action_level = v_tool.level;
  if v_verdict is null then
    return jsonb_build_object('verdict', 'ask', 'tool', p_tool,
      'action_level', v_tool.level, 'autonomy', v_autonomy::text,
      'because', 'The policy has nothing to say about this, so it asks.');
  end if;

  -- Prompted work below level 3 does not stop to ask. Level 3 and `refuse` are untouched (see app.may_act).
  if v_verdict = 'ask' and v_asked_for and v_tool.level < 3 then
    return jsonb_build_object(
      'verdict', 'proceed', 'tool', p_tool, 'action_level', v_tool.level,
      'autonomy', v_autonomy::text, 'standing', null, 'asked_for', true,
      'because', 'You asked for this, so it does not stop to ask you again.');
  end if;

  -- A standing authorization upgrades ask to proceed and nothing else - and only THIS office's: `project_id is null`
  -- is this office's global row, never the deployment's.
  if v_verdict = 'ask' then
    select authorization_id, project_id, reason, granted_at, expires_at
      into v_standing
      from public.standing_authorizations
     where office_id = p_office
       and tool = p_tool
       and scope_ref is null
       and revoked_at is null
       and (expires_at is null or expires_at > app.now_utc())
       and (project_id is null or project_id = p_project)
     order by (project_id is not null) desc
     limit 1;
    if found then
      return jsonb_build_object(
        'verdict', 'proceed', 'tool', p_tool, 'action_level', v_tool.level,
        'autonomy', v_autonomy::text,
        'standing', jsonb_build_object(
          'id', v_standing.authorization_id,
          'scope', case when v_standing.project_id is null then 'everywhere' else 'this project' end,
          'reason', v_standing.reason,
          'since', v_standing.granted_at,
          'until', v_standing.expires_at),
        'because', format('You said not to ask again about %s: %s', p_tool, v_standing.reason));
    end if;
  end if;

  return jsonb_build_object('verdict', v_verdict::text, 'tool', p_tool,
    'action_level', v_tool.level, 'autonomy', v_autonomy::text,
    'standing', null, 'asked_for', v_asked_for, 'because', v_note);
end;
$f$;
revoke all on function app.may_act_in(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

create function app.impediments_tally_in(p_office uuid, p_days integer default 30, p_min integer default 2, p_include_fixtures boolean default false)
returns table(kind public.impediment_kind, needed text, staff_slug text, times integer, first_seen timestamptz, last_seen timestamptz, projects integer, for_instance text)
language sql
stable
security definer
set search_path to ''
as $f$
  select i.kind,
         i.needed,
         i.staff_slug,
         count(*)::int                        as times,
         min(i.created_at)                    as first_seen,
         max(i.created_at)                    as last_seen,
         count(distinct i.project_id)::int    as projects,
         (array_agg(i.detail order by i.created_at desc)
            filter (where btrim(i.detail) <> ''))[1] as for_instance
    -- An impediment has no office column: it is the office of the job it was recorded against (an INNER join, so
    -- a row whose job cannot be named is nobody's and counts for nobody).
    from public.job_impediments i
    join public.jobs j on j.job_id = i.job_id and j.office_id = app.require_office(p_office)
   where (
           coalesce(p_include_fixtures, false)
           or not (coalesce(j.is_fixture, false) or i.is_fixture)
         )
     and i.created_at >= app.now_utc() - make_interval(days => greatest(coalesce(p_days, 30), 1))
   group by i.kind, i.needed, i.staff_slug
  having count(*) >= greatest(coalesce(p_min, 2), 1)
   order by count(*) desc, max(i.created_at) desc
$f$;
revoke all on function app.impediments_tally_in(uuid, integer, integer, boolean) from public, anon, authenticated, service_role;

create function app.harness_proposal_in(p_office uuid, p_staff text, p_needed text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $f$
  select case
           when not exists (
             select 1 from public.job_impediments i
               join public.jobs j on j.job_id = i.job_id and j.office_id = app.require_office(p_office)
              where i.staff_slug = p_staff and i.needed = p_needed
           ) then false
           else not exists (
             select 1
               from public.job_impediments i
               join public.jobs j on j.job_id = i.job_id and j.office_id = p_office
              where i.staff_slug = p_staff
                and i.needed = p_needed
                and not (coalesce(i.is_fixture, false)
                         or coalesce(j.is_fixture, false)
                         or coalesce(app.harness_job(i.job_id), false))
           )
         end
     or app.harness_label(p_needed)
$f$;
revoke all on function app.harness_proposal_in(uuid, text, text) from public, anon, authenticated, service_role;

-- The office a delivery is claimed for. Every sender that has a job passes it, and the job's office is the delivery's.
-- A sender with no job is only ever allowed to a registered test destination (the TEST office's) or from a registered
-- operator sender (the operator's office) - app.delivery_refusal says the same; anything else is recorded as
-- suppressed in the operator's office. Raises `no_office` rather than guess when there is none.
create function app.delivery_office(p_job uuid, p_channel text, p_target_ref text)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $f$
declare
  v_office uuid;
begin
  v_office := coalesce(
    (select j.office_id from public.jobs j where j.job_id = p_job),
    case when exists (select 1 from public.test_destinations t
                       where t.channel = p_channel and t.target_ref = p_target_ref and t.retired_at is null)
         then app.test_office() end,
    app.operator_office());
  return app.require_office(v_office);
end
$f$;
revoke all on function app.delivery_office(uuid, text, text) from public, anon, authenticated, service_role;
