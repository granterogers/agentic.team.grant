-- 0662 - private names are unique per office, not per deployment (multi-user P2).
--
-- A global unique key on a name a person chooses does two harmful things once there is a second office: it refuses
-- a name the second person is entitled to use, and its refusal ("that slug is taken") tells them another office has
-- it. These keys become (office, name). A duplicate inside one office is still refused.
--
-- Converted: the project slug and notebook reference, the duty slug, the trigger name, the MCP provider name, the
-- contact label name and the global standing authorization. NOT converted, on purpose: keys that identify a thing
-- across the deployment - mcp_clients.token_sha256 (a credential must establish exactly one office), delivery and
-- command dedupe keys and idempotency keys (composed by the system from ids, and read by ON CONFLICT clauses in
-- functions P3 converts), external ids a provider hands out, and every key that already starts with a project.
--
-- Callers that infer a conflict target by column list (ON CONFLICT (slug)) must name the new pair; the repository's
-- own are changed in the same commit. A bare ON CONFLICT DO NOTHING needs no change.

alter table public.projects drop constraint projects_slug_key;
alter table public.projects add constraint projects_office_slug_key unique (office_id, slug);

drop index public.projects_one_per_notebook;
create unique index projects_one_per_notebook on public.projects (office_id, notebook_ref) where notebook_ref is not null;

alter table public.responsibilities drop constraint responsibilities_slug_key;
alter table public.responsibilities add constraint responsibilities_office_slug_key unique (office_id, slug);

alter table public.event_triggers drop constraint event_triggers_name_key;
alter table public.event_triggers add constraint event_triggers_office_name_key unique (office_id, name);

alter table public.mcp_providers drop constraint mcp_providers_name_key;
alter table public.mcp_providers add constraint mcp_providers_office_name_key unique (office_id, name);

drop index public.contact_labels_one_per_name;
create unique index contact_labels_one_per_name on public.contact_labels (office_id, owner, app.normalise_name(name));

drop index public.standing_live_globally;
create unique index standing_live_globally on public.standing_authorizations (office_id, tool, coalesce(scope_ref, ''))
  where revoked_at is null and project_id is null;

-- ROLLBACK (not part of the migration): the converted keys are weaker than the old ones, so restoring them succeeds
-- only while no two offices share a name. drop each key above and recreate the original single-column key
-- (projects (slug), projects (notebook_ref) where notebook_ref is not null, responsibilities (slug), event_triggers (name),
-- mcp_providers (name), contact_labels (owner, app.normalise_name(name)), standing_authorizations (tool,
-- coalesce(scope_ref, '')) where revoked_at is null and project_id is null).
