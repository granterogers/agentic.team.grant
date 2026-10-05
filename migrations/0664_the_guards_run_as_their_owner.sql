-- 0664 - the ownership guards run with their owner's privileges, not the writer's (multi-user P2).
--
-- FOUND LIVE. 0657/0658 installed `a0_office_bridge` on jobs, projects and the inbound/command tables. The bridge calls
-- app.bridge_office, which `service_role` may not execute (and cannot even see: it has no usage on schema app). The
-- Telegram webhook writes inbound_commands through PostgREST AS service_role, so every inbound update died with
-- 42501 "permission denied for schema app" and the adapter answered 503 "storage failed". It was caught by verify:run1-live
-- the first time it ran after the waves, minutes after 0658.
--
-- The attack suite had missed it because it granted its attackers usage on schema app and execute on every app function
-- - a privilege production does not give them. The suite no longer grants either, and this migration is what it caught.
--
-- A trigger function that must read other rows (the bridge, the derived guards, the relation endpoints) is part of the
-- table, not of the caller, so it runs as its owner with an empty search_path. Nothing about WHO may write changes: the
-- same statements are refused for the same reasons; the guard simply no longer depends on what the writer can see.
alter function app.office_bridge_trigger() security definer;
alter function app.office_id_is_write_once() security definer;
alter function app.relation_endpoint_office(text, uuid) security definer;
alter function app.relations_stay_in_one_office() security definer;
alter function app.p2_edge_artifacts() security definer;
alter function app.p2_edge_branch_groups() security definer;
alter function app.p2_edge_browser_actions() security definer;
alter function app.p2_edge_browser_sessions() security definer;
alter function app.p2_edge_collections() security definer;
alter function app.p2_edge_consultations() security definer;
alter function app.p2_edge_contact_label_links() security definer;
alter function app.p2_edge_contacts() security definer;
alter function app.p2_edge_dashboard_layouts() security definer;
alter function app.p2_edge_document_collections() security definer;
alter function app.p2_edge_document_orders() security definer;
alter function app.p2_edge_drive_watch() security definer;
alter function app.p2_edge_duty_said() security definer;
alter function app.p2_edge_inbound_commands_slack() security definer;
alter function app.p2_edge_job_branches() security definer;
alter function app.p2_edge_job_child_slots() security definer;
alter function app.p2_edge_job_impediments() security definer;
alter function app.p2_edge_job_pauses() security definer;
alter function app.p2_edge_job_plans() security definer;
alter function app.p2_edge_job_state_transitions() security definer;
alter function app.p2_edge_job_steps() security definer;
alter function app.p2_edge_job_traces() security definer;
alter function app.p2_edge_known_escapes() security definer;
alter function app.p2_edge_legacy_trusted_commands() security definer;
alter function app.p2_edge_mcp_calls() security definer;
alter function app.p2_edge_mcp_discovered_tools() security definer;
alter function app.p2_edge_notebook_budgets() security definer;
alter function app.p2_edge_outputs() security definer;
alter function app.p2_edge_plane_layouts() security definer;
alter function app.p2_edge_project_aliases() security definer;
alter function app.p2_edge_project_attachments() security definer;
alter function app.p2_edge_project_briefs() security definer;
alter function app.p2_edge_project_connector_choices() security definer;
alter function app.p2_edge_project_references() security definer;
alter function app.p2_edge_project_seen() security definer;
alter function app.p2_edge_project_staff() security definer;
alter function app.p2_edge_relations() security definer;
alter function app.p2_edge_routing_decisions() security definer;
alter function app.p2_edge_skill_tools() security definer;
alter function app.p2_edge_skill_uses() security definer;
alter function app.p2_edge_slack_channel_authority() security definer;
alter function app.p2_edge_slack_channel_map() security definer;
alter function app.p2_edge_task_calendar_links() security definer;
alter function app.p2_edge_task_links() security definer;
alter function app.p2_edge_trigger_firings() security definer;
alter function app.p2_edge_undo_requests() security definer;

-- ROLLBACK (not part of the migration): alter function <each above> security invoker; that returns the 42501 failure above.
