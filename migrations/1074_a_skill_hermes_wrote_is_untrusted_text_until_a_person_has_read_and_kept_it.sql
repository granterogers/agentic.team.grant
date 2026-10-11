-- 1074 - A skill Hermes wrote is untrusted text until a person has read it and kept it; accepted skills go back to Hermes read-only (Hermes, M8b).
--
-- Switched OFF. Nothing in this migration does anything for an office until `engine.hermes.learning_offices` (a system_config list of office
-- ids, absent by default) names it AND Hermes is on for it (`engine.hermes.offices`). No office is named here; a person with the operator's
-- access names one, and removing the name stops everything below at once.
--
--   1. app.engine_learning_enabled(office): the one question every function below asks first.
--   2. public.engine_runs.profile ('default' or 'hermes-learn'), fixed when the run opens (the run guard refuses any later change) and decided
--      by the OFFICE at open from the flag, never by the bridge. It is returned on a claim so the bridge knows which Hermes profile to use.
--   3. app.engine_propose_skill(office, bridge, run, draft): the only way Hermes-authored text reaches the office. It writes ONE
--      public.suggestions row and nothing else. The bridge supplies the draft's name, when, procedure, tools and what was dropped, and
--      NOTHING ELSE: the scope, project, job, run and source are filled in here from the run itself, so a bridge cannot choose where a skill
--      would apply. The draft passes the same validator as an observed technique (1073) and then the ordinary suggestion route: it is open,
--      inactive, and applies to no prompt until a person presses Accept, which reads it again (1073). One proposal per run, a daily cap
--      shared with the observed ones, never again once the same procedure has a suggestion in any state but stale (so a rejected one is not
--      resubmitted, and neither is one accepted and later withdrawn).
--   4. app.engine_skills_for_export(office, bridge, run): the office's LIVE skills for one claimed run, read-only reference material for
--      Hermes: global skills and the claimed run's own project's, never another project's, at most 50 and 100,000 characters. Retired and
--      superseded skills are not live and so are never returned; there is no cache here, so a withdrawal is effective on the next read.
--   5. Public wrappers for the engine gateway's service role only (the same shape as the other engine wrappers).
--
-- ROLLBACK. Drop the two public wrappers and the two app functions and app.engine_learning_enabled. Restore app.engine_runs_guard,
-- app.engine_run_open and app.engine_run_claim from 1070 (their definitions are in that file) and drop the column engine_runs.profile.
-- Suggestions that were raised stay as rows nobody can act on once 1073's press is restored without the engine.skill branch. Roll the
-- worker and the bridge back first.

create function app.engine_learning_enabled(p_office uuid) returns boolean
 language sql stable security definer set search_path to ''
as $f$
  select app.engine_enabled(p_office, 'hermes') and coalesce(
    (select case when jsonb_typeof(c.value) = 'array' then c.value ? p_office::text else false end
       from public.system_config c where c.key = 'engine.hermes.learning_offices'),
    false)
$f$;
revoke all on function app.engine_learning_enabled(uuid) from public, anon, authenticated, service_role;

alter table public.engine_runs
  add column profile text not null default 'default',
  add constraint engine_runs_profile_known check (profile in ('default', 'hermes-learn'));

do $splice$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('app.engine_runs_guard()'::regprocedure);
  v_new := replace(v_def, 'or new.created_at is distinct from old.created_at or new.project_id is distinct from old.project_id then',
                          'or new.created_at is distinct from old.created_at or new.project_id is distinct from old.project_id or new.profile is distinct from old.profile then');
  if v_new = v_def then raise exception '1074: guard anchor did not land'; end if;
  execute v_new;

  v_def := pg_get_functiondef('app.engine_run_open(uuid,uuid,text,jsonb)'::regprocedure);
  v_new := replace(v_def, E'  insert into public.engine_runs (office_id, job_id, project_id, engine, deadline_at, request)\n  values (p_office, p_job, v_job.project_id, p_engine, app.now_utc() + make_interval(secs => v_deadline), p_request)',
                          E'  insert into public.engine_runs (office_id, job_id, project_id, engine, deadline_at, request, profile)\n  values (p_office, p_job, v_job.project_id, p_engine, app.now_utc() + make_interval(secs => v_deadline), p_request,\n          case when app.engine_learning_enabled(p_office) then ''hermes-learn'' else ''default'' end)');
  if v_new = v_def then raise exception '1074: open anchor did not land'; end if;
  execute v_new;

  v_def := pg_get_functiondef('app.engine_run_claim(uuid,uuid)'::regprocedure);
  v_new := replace(v_def, E'    ''request'', v_run.request,\n', E'    ''request'', v_run.request, ''profile'', v_run.profile,\n');
  if v_new = v_def then raise exception '1074: claim anchor did not land'; end if;
  execute v_new;
end
$splice$;

create function app.engine_propose_skill(p_office uuid, p_bridge uuid, p_run uuid, p_draft jsonb) returns jsonb
 language plpgsql security definer set search_path to ''
as $f$
declare
  r record; k text; v_offer jsonb; v_problem text; v_key text; v_cap integer; v_today integer; v_id uuid;
  v_name text;
begin
  perform app.require_office(p_office);
  if not app.engine_learning_enabled(p_office) then
    return jsonb_build_object('refused', 'Hermes is not switched on to suggest skills for this office.');
  end if;
  if not exists (select 1 from public.engine_bridges b where b.bridge_id = p_bridge and b.office_id = p_office and b.enabled) then
    return jsonb_build_object('refused', 'This bridge is not enabled for this office.');
  end if;
  select e.run_id, e.job_id, e.project_id, e.profile, e.state, e.bridge_id into r
    from public.engine_runs e where e.run_id = p_run and e.office_id = p_office;
  if not found or r.bridge_id is distinct from p_bridge then
    return jsonb_build_object('refused', 'That is not a run of this bridge.');
  end if;
  if r.state <> 'completed' then return jsonb_build_object('refused', 'Only a finished run can propose a skill.'); end if;
  if r.profile <> 'hermes-learn' then return jsonb_build_object('refused', 'This run was not opened to learn from.'); end if;
  if r.project_id is null then return jsonb_build_object('refused', 'A skill is for one project and this run has none.'); end if;

  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then return jsonb_build_object('refused', 'The draft is not a single set of fields.'); end if;
  -- The bridge says what the text is. It does not say where it applies, which run it came from or what it is: those are the office's.
  for k in select jsonb_object_keys(p_draft) loop
    if k <> all (array['name', 'when', 'procedure', 'tools', 'dropped']) then
      return jsonb_build_object('refused', format('The draft carries a field it may not (%s).', left(k, 40)));
    end if;
  end loop;
  v_offer := jsonb_build_object('tools', '[]'::jsonb, 'dropped', '[]'::jsonb) || p_draft
          || jsonb_build_object('scope', 'project', 'project_id', r.project_id, 'from_job', r.job_id, 'run_id', r.run_id, 'source', 'hermes_authored');
  v_problem := app.engine_skill_offer_problem(v_offer);
  if v_problem is not null then return jsonb_build_object('refused', v_problem); end if;

  if exists (select 1 from public.suggestions s where s.office_id = p_office and s.kind = 'engine.skill' and s.offer_args ->> 'run_id' = r.run_id::text) then
    return jsonb_build_object('refused', 'This run has already proposed a skill.');
  end if;
  v_key := app.engine_skill_key(v_offer ->> 'procedure', r.project_id);
  if exists (select 1 from public.suggestions s where s.office_id = p_office and s.kind = 'engine.skill' and s.subject_ref = v_key and s.state <> 'stale') then
    return jsonb_build_object('refused', 'This procedure is already waiting, or has already been decided.');
  end if;
  v_cap := app.engine_setting('engine.hermes.skill_proposals_per_day', 3, 0, 10);
  select count(*)::integer into v_today from public.suggestions s
   where s.office_id = p_office and s.kind = 'engine.skill'
     and s.raised_at >= date_trunc('day', app.now_utc() at time zone 'utc') at time zone 'utc';
  if v_today >= v_cap then return jsonb_build_object('refused', 'Enough skills have been suggested today.'); end if;

  v_name := btrim(v_offer ->> 'name');
  insert into public.suggestions (office_id, project_id, kind, subject_ref, body, because, weight, offer_kind, offer_args)
  values (p_office, r.project_id, 'engine.skill', v_key,
          format('Hermes wrote a procedure for this project called "%s". It is not in use, and will not be unless you keep it. Read it first.', left(v_name, 80)),
          jsonb_build_object('source', 'hermes_authored', 'run_id', r.run_id), 35, 'teach_skill', v_offer)
  on conflict (office_id, kind, (coalesce(project_id::text, '')), subject_ref) where state = 'open' do nothing
  returning suggestion_id into v_id;
  if v_id is null then return jsonb_build_object('refused', 'This procedure is already waiting.'); end if;
  return jsonb_build_object('suggestion_id', v_id);
end
$f$;
revoke all on function app.engine_propose_skill(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;

create function app.engine_skills_for_export(p_office uuid, p_bridge uuid, p_run uuid default null) returns jsonb
 language plpgsql stable security definer set search_path to ''
as $f$
declare v_project uuid; v_list jsonb;
begin
  perform app.require_office(p_office);
  if not app.engine_learning_enabled(p_office)
     or not exists (select 1 from public.engine_bridges b where b.bridge_id = p_bridge and b.office_id = p_office and b.enabled) then
    return jsonb_build_object('skills', '[]'::jsonb, 'generated_at', app.now_utc());
  end if;
  if p_run is not null then
    select e.project_id into v_project from public.engine_runs e
     where e.run_id = p_run and e.office_id = p_office and e.bridge_id = p_bridge and e.state = 'running';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('slug', 'skill-' || left(replace(x.skill_id::text, '-', ''), 12), 'name', x.name,
                                               'when_to_use', x.when_to_use, 'procedure', x.procedure) order by x.created_at desc), '[]'::jsonb)
    into v_list
    from (
      select s.*, sum(length(s.procedure)) over (order by s.created_at desc, s.skill_id) as running_chars,
             row_number() over (order by s.created_at desc, s.skill_id) as rn
        from public.skills_live s
       where exists (select 1 from public.skills o where o.skill_id = s.skill_id and o.office_id = p_office)
         and (s.scope = 'global' or (s.scope = 'project' and v_project is not null and s.project_id = v_project))
    ) x
   where x.rn <= 50 and x.running_chars <= 100000;
  return jsonb_build_object('skills', v_list, 'generated_at', app.now_utc());
end
$f$;
revoke all on function app.engine_skills_for_export(uuid, uuid, uuid) from public, anon, authenticated, service_role;

create function public.engine_propose_skill(p_office uuid, p_bridge uuid, p_run uuid, p_draft jsonb) returns jsonb
 language sql security definer set search_path to ''
as $f$ select app.engine_propose_skill(p_office => p_office, p_bridge => p_bridge, p_run => p_run, p_draft => p_draft) $f$;
revoke all on function public.engine_propose_skill(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.engine_propose_skill(uuid, uuid, uuid, jsonb) to service_role;

create function public.engine_skills_for_export(p_office uuid, p_bridge uuid, p_run uuid default null) returns jsonb
 language sql stable security definer set search_path to ''
as $f$ select app.engine_skills_for_export(p_office => p_office, p_bridge => p_bridge, p_run => p_run) $f$;
revoke all on function public.engine_skills_for_export(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.engine_skills_for_export(uuid, uuid, uuid) to service_role;
