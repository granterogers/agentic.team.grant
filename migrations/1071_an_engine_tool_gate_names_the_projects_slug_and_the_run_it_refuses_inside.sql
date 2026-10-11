-- 1071 - the engine tool gate names the project the run is bound to, and the run it refuses a call inside (Hermes, M3).
--
-- 1070's app.engine_tool_gate answered {allow, run_id, project_id, job_id} only when it allowed a call. Two things the MCP function
-- needs were missing, found while building M3:
--
--   1. The project's SLUG. The MCP tools name a project by slug, and the function forces every project-taking tool to the run's
--      project so a model that omits the argument (which means "every project" to those tools) or names another cannot widen the
--      read. The gate returned a uuid; the function would have had to ask a second question to translate it.
--   2. The RUN, on a refusal. A write tool named during a live run, or a call after the lease lapsed, was refused with no run_id, so
--      the refusal could be written to mcp_calls and nowhere near the run it happened in. engine_record_call(verdict 'refused') needs
--      the run, and the refusal inside a live run is exactly the record worth having. The gate now looks up the run BEFORE it
--      decides, and every refusal after that point carries run_id when exactly one run is in progress for the credential.
--
-- The ORDER of the reasons is unchanged (an unknown client, not an engine client, a tool off the allowlist, no enabled bridge, no run
-- in progress, a lapsed lease or deadline, Hermes switched off), and so is every answer 1070's proof asserts. Spliced from 1070's own
-- definition, never retyped; the only changes are the two above. CREATE OR REPLACE is safe here: the signature is identical.
--
-- ROLLBACK. Restore the 1070 definition. Nothing outside the MCP function (M3, undeployed) reads the two new keys.

create or replace function app.engine_tool_gate(p_office uuid, p_mcp_client text, p_tool text) returns jsonb
 language plpgsql stable security definer set search_path to ''
as $f$
declare v_kind text; v_bridge record; v_run record; v_n integer; v_slug text; v_ids jsonb := '{}'::jsonb;
begin
  perform app.require_office(p_office);
  select k.kind into v_kind from public.mcp_clients k where k.client_id = p_mcp_client and k.office_id = p_office and k.enabled;
  if v_kind is null then
    return jsonb_build_object('allow', false, 'is_engine', false, 'because', 'that client is not known to this office');
  end if;
  if v_kind <> 'engine' then
    return jsonb_build_object('allow', true, 'is_engine', false);
  end if;
  select b.bridge_id into v_bridge from public.engine_bridges b
   where b.mcp_client_id = p_mcp_client and b.office_id = p_office and b.enabled;
  if not found then
    return jsonb_build_object('allow', false, 'is_engine', true, 'because', 'this credential belongs to no enabled bridge');
  end if;
  select count(*) into v_n from public.engine_runs r
   where r.bridge_id = v_bridge.bridge_id and r.office_id = p_office and r.state = 'running';
  if v_n = 1 then
    select r.run_id, r.project_id, r.job_id, r.lease_until, r.deadline_at into v_run from public.engine_runs r
     where r.bridge_id = v_bridge.bridge_id and r.office_id = p_office and r.state = 'running';
    v_ids := jsonb_build_object('run_id', v_run.run_id);
  end if;
  if p_tool is null or not (p_tool = any (app.engine_read_tools())) then
    return jsonb_build_object('allow', false, 'is_engine', true, 'because', 'that tool is not one Hermes may use here') || v_ids;
  end if;
  if v_n <> 1 then
    return jsonb_build_object('allow', false, 'is_engine', true, 'because', 'there is no run in progress for this credential');
  end if;
  if v_run.lease_until < app.now_utc() or v_run.deadline_at < app.now_utc() then
    return jsonb_build_object('allow', false, 'is_engine', true, 'because', 'the run is out of time') || v_ids;
  end if;
  if not app.engine_enabled(p_office, 'hermes') then
    return jsonb_build_object('allow', false, 'is_engine', true, 'because', 'Hermes is switched off for this office') || v_ids;
  end if;
  if v_run.project_id is not null then
    select p.slug into v_slug from public.projects p where p.project_id = v_run.project_id and p.office_id = p_office;
  end if;
  return jsonb_build_object('allow', true, 'is_engine', true, 'run_id', v_run.run_id, 'project_id', v_run.project_id,
                            'project_slug', v_slug, 'job_id', v_run.job_id);
end
$f$;
