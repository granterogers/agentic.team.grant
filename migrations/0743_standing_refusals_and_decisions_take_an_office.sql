-- 0743 - standing authorizations, taken-back refusals and the decision log take an office (multi-user P3, cluster d).
--
-- The other doors onto the same authority as hq_answer_blocker. They were reached by the gateway and by no cluster list, and
-- each named a row by its id alone: hq_revoke_standing took ANY office's standing authorization back, hq_withdraw_refusal
-- took ANY office's No back, and hq_standing / hq_decisions read every office's. They now take `p_office` first, and an
-- authorization, a question or a decision of another office is indistinguishable from one that does not exist.
--
-- hq_grant_standing is the press that mints a standing yes from the dashboard. It calls app.grant_standing(p_office, ...)
-- (0740), which replaces and inserts only inside the office; the level-3 trigger and the `action_level < 3 or verdict <>
-- 'proceed'` floor are untouched, and a level-3 tool is still refused whoever asks.


create function app.revoke_standing(p_office uuid, p_authorization uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_n integer;
begin
  perform app.require_office(p_office);
  update public.standing_authorizations
     set revoked_at = app.now_utc(),
         revoked_reason = coalesce(nullif(btrim(p_reason), ''), 'you took it back')
   where office_id = p_office and authorization_id = p_authorization and revoked_at is null;
  get diagnostics v_n = row_count;
  -- 0350's lesson: a delete keyed on something nobody checked reports success
  -- having matched nothing. Say which happened.
  if v_n = 0 then
    return jsonb_build_object('ok', false,
      'error', 'there is no live standing authorization with that id');
  end if;
  return jsonb_build_object('ok', true, 'revoked', p_authorization);
end;
$function$;
revoke all on function app.revoke_standing(uuid, uuid, text) from public, anon, authenticated, service_role;
create function public.hq_revoke_standing(p_office uuid, p_authorization uuid, p_reason text default null, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$
  select case when app.authority_refusal(p_by, null,
                     (select project_id from public.standing_authorizations where authorization_id = p_authorization and office_id = p_office)) is not null
              then jsonb_build_object('error', app.authority_refusal(p_by, null,
                     (select project_id from public.standing_authorizations where authorization_id = p_authorization and office_id = p_office)))
              else app.revoke_standing(p_office, p_authorization, p_reason) end
$f$;
revoke all on function public.hq_revoke_standing(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_revoke_standing(uuid, uuid, text, text) to service_role;
drop function public.hq_revoke_standing(uuid, text, text);
drop function app.revoke_standing(uuid, text);

create function public.hq_grant_standing(p_office uuid, p_tool text, p_reason text, p_project uuid default null, p_until timestamp with time zone default null, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$
  select case when app.authority_refusal(p_by, null, p_project) is not null
              then jsonb_build_object('error', app.authority_refusal(p_by, null, p_project))
              else app.grant_standing(p_office, p_tool, p_project, p_reason, btrim(p_by), p_until) end
$f$;
revoke all on function public.hq_grant_standing(uuid, text, text, uuid, timestamp with time zone, text) from public, anon, authenticated;
grant execute on function public.hq_grant_standing(uuid, text, text, uuid, timestamp with time zone, text) to service_role;
drop function public.hq_grant_standing(text, text, uuid, timestamp with time zone, text);

create function app.standing_now(p_office uuid, p_project uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(q.v order by q.ord, q.at desc), '[]'::jsonb)
    from (
      select case when s.revoked_at is null then 0 else 1 end as ord,
             s.granted_at as at,
             jsonb_build_object(
               'id', s.authorization_id,
               'tool', s.tool,
               'level', t.level,
               'what', t.description,
               'scope', case when s.project_id is null then 'everywhere' else coalesce(p.name, 'a project') end,
               'project', s.project_id,
               'reason', s.reason,
               'by', s.granted_by,
               'since', s.granted_at,
               'until', s.expires_at,
               'revoked', s.revoked_at,
               'revoked_reason', s.revoked_reason,
               'live', s.revoked_at is null
                       and (s.expires_at is null or s.expires_at > app.now_utc())) as v
        from public.standing_authorizations s
        join public.tool_permissions t on t.tool = s.tool
        left join public.projects p on p.project_id = s.project_id and p.office_id = p_office
       where s.office_id = p_office
         and (p_project is null or s.project_id is not distinct from p_project
              or s.project_id is null)
         and (s.revoked_at is null or s.revoked_at > app.now_utc() - interval '30 days')
       order by 1, 2 desc
       limit 60
    ) q
  );
end;
$function$;
revoke all on function app.standing_now(uuid, uuid) from public, anon, authenticated, service_role;
create function public.hq_standing(p_office uuid, p_project uuid default null)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$ select app.standing_now(p_office, p_project) $f$;
revoke all on function public.hq_standing(uuid, uuid) from public, anon, authenticated;
grant execute on function public.hq_standing(uuid, uuid) to service_role;
drop function public.hq_standing(uuid);
drop function app.standing_now(uuid);

create function app.decisions_so_far(p_office uuid, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
select coalesce(jsonb_agg(q.v order by q.at desc), '[]'::jsonb)
    from (
      select d.decided_at as at,
             jsonb_build_object(
               'id', d.decision_id,
               'question', d.question,
               'chose', d.chose,
               'ruled_out', to_jsonb(d.ruled_out),
               'because', d.because,
               'by', d.decided_by,
               'at', d.decided_at,
               'project', p.name,
               'supersedes', d.supersedes,
               'live', not exists (select 1 from public.decisions n
                                    where n.supersedes = d.decision_id and n.office_id = p_office)) as v
        from public.decisions d
        left join public.projects p on p.project_id = d.project_id and p.office_id = p_office
       where d.office_id = p_office and not d.is_fixture
       order by d.decided_at desc
       limit greatest(1, least(coalesce(p_limit, 40), 200))
    ) q
  );
end;
$function$;
revoke all on function app.decisions_so_far(uuid, integer) from public, anon, authenticated, service_role;
create function public.hq_decisions(p_office uuid, p_limit integer default 40)
 returns jsonb
 language sql
 security definer
 set search_path to ''
as $f$ select app.decisions_so_far(p_office, p_limit) $f$;
revoke all on function public.hq_decisions(uuid, integer) from public, anon, authenticated;
grant execute on function public.hq_decisions(uuid, integer) to service_role;
drop function public.hq_decisions(integer);
drop function app.decisions_so_far(integer);

create function app.withdraw_refusal(p_office uuid, p_blocker uuid, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  b         public.blockers;
  v_by      text := btrim(coalesce(p_by, ''));
  v_refusal text;
  v_days    integer;
begin
  perform app.require_office(p_office);
  /*
    Only through the gateway. PostgREST sets request.jwt.claims for the request,
    with the role of the key that was presented: the gateway presents the service
    key, and a call with the anon key, or from SQL that never came through
    PostgREST (a handler, a job, a script), carries no such role and is refused
    here whatever the grants say. The worker connects as a database owner, so the
    grant alone restricts nobody there; this is the check that does.
  */
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    return jsonb_build_object('error', 'Only the gateway, acting for a signed-in person, can take a No back.');
  end if;
  v_refusal := app.principal_refusal(v_by);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;
  if app.principal_kind(v_by) <> 'person' or exists (select 1 from public.staff s where s.slug = v_by) then
    return jsonb_build_object('error',
      'Only a person can take a No back, and that name is not a person the office answers to.');
  end if;

  select * into b from public.blockers where blocker_id = p_blocker and office_id = p_office for update;
  if not found then
    return jsonb_build_object('error', 'there is no such question');
  end if;
  if b.state <> 'resolved' or b.answered_option is null
     or b.answered_option is distinct from b.decline_option then
    return jsonb_build_object('error', 'That question was not answered No, so there is nothing to take back.');
  end if;
  if b.refusal_withdrawn_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'withdrawn_at', b.refusal_withdrawn_at);
  end if;
  v_days := app.refusal_days();
  if b.resolved_at <= app.now_utc() - make_interval(days => v_days) then
    return jsonb_build_object('error', 'That No has already run out, so the office may ask again without this.');
  end if;

  update public.blockers
     set refusal_withdrawn_at = app.now_utc(), refusal_withdrawn_by = v_by
   where blocker_id = p_blocker and office_id = p_office;

  perform app.append_event(
    p_office => p_office,
    p_correlation_id => extensions.gen_random_uuid(),
    p_actor_kind => 'user',
    p_actor => v_by,
    p_trigger => 'approval',
    p_action_type => 'refusal.withdrawn',
    p_reversible => false,
    p_project_id => b.project_id,
    p_before_state => jsonb_build_object('remembered_no', true),
    p_after_state => jsonb_build_object('remembered_no', false),
    p_rationale_summary => format('%s took back the No to: %s', v_by, left(b.requested_action, 120)),
    p_source_refs => '[]'::jsonb,
    p_tool_used => b.standing_tool,
    p_related_job_id => b.job_id);

  return jsonb_build_object('ok', true, 'withdrawn', p_blocker, 'by', v_by,
    'note', 'Nothing was approved. The next attempt may ask again.');
end;
$function$;
revoke all on function app.withdraw_refusal(uuid, uuid, text) from public, anon, authenticated, service_role;
create function public.hq_withdraw_refusal(p_office uuid, p_blocker_id uuid, p_by text default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.withdraw_refusal(p_office, p_blocker_id, p_by) $f$;
revoke all on function public.hq_withdraw_refusal(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.hq_withdraw_refusal(uuid, uuid, text) to service_role;
drop function public.hq_withdraw_refusal(uuid, text);
drop function app.withdraw_refusal(uuid, text);

