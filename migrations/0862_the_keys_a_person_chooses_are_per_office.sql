-- 0862 - the remaining global keys on what a person or a provider names become per-office (multi-user P3, Wave 12).
--
-- A global unique key on a name two offices could both hold is a collision and an existence oracle: office B importing the
-- same Drive file as office A is refused because A holds it, which tells B that somebody does. P2 made the keys on project
-- slugs and names per-office and listed the rest; P3 closes them:
--
--   documents (connector, external_parent_ref, external_ref)   the same provider file in two offices is two documents
--   documents (connector, external_ref) for a linked file       likewise
--   proposals (staff_slug, kind, needed)                        two offices' specialists need the same thing independently
--   sync_runs (running)                                         one running sync per office, not one for the deployment
--   notebook_sync_queue (fingerprint)                           one live job per office per content fingerprint
--   notification_preferences (subject), global row              one global preference per office's subject
--   connection_health (service, credential)                     each office has its own reading of a service
--   workspace_layouts (owner)                                   each office has its own arrangement
--
-- Keys that stay global, on purpose: a credential hash (mcp_clients.token_sha256), the system-composed dedupe keys
-- (deliveries, inbound_commands) and keys on ids (supersedes, compensates_event_id), which are unique by being ids.
--
-- The ON CONFLICT targets of the functions that use these keys are spliced from their LIVE definitions (a function being
-- patched must never be rewritten from memory) and each splice is asserted to have changed exactly one place.

do $m$
declare
  r record;
  v text;
  v_new text;
begin
  for r in
    select * from (values
      ('app.hq_document_link(uuid,uuid,text,text,text,text,text)'::text, 'on conflict (connector, external_ref)', 'on conflict (office_id, connector, external_ref)'),
      ('app.raise_proposals(uuid,integer,integer,boolean)', 'on conflict (staff_slug, kind, needed)', 'on conflict (office_id, staff_slug, kind, needed)'),
      ('app.hq_workspace_layout_set(uuid,jsonb)', 'on conflict (owner)', 'on conflict (office_id, owner)'),
      ('app.hq_store_google_refresh(uuid,text,text)', 'on conflict (service, credential)', 'on conflict (office_id, service, credential)')
    ) as t(fn, old_text, new_text)
  loop
    v := pg_get_functiondef(r.fn::regprocedure);
    if (length(v) - length(replace(v, r.old_text, ''))) / length(r.old_text) <> 1 then
      raise exception '0862: % does not hold % exactly once', r.fn, r.old_text;
    end if;
    v_new := replace(v, r.old_text, r.new_text);
    execute v_new;
  end loop;
end
$m$;

create or replace function app.record_connection_health(p_office uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_count integer;
begin
  perform app.require_office(p_office);
  insert into public.connection_health (office_id, service, credential, state, detail, owner, action, checked_at)
  select p_office, r->>'service', r->>'credential', r->>'state',
         left(coalesce(r->>'detail', ''), 200), coalesce(r->>'owner', ''),
         left(coalesce(r->>'action', ''), 200), app.now_utc()
    from jsonb_array_elements(p_rows) as r
  on conflict (office_id, service, credential) do update
    set state = excluded.state,
        detail = excluded.detail,
        owner = excluded.owner,
        action = excluded.action,
        checked_at = excluded.checked_at;
  get diagnostics v_count = row_count;
  if v_count >= 5 then
    delete from public.connection_health
     where office_id = p_office and checked_at < app.now_utc() - interval '1 minute';
  end if;
  return v_count;
end;
$function$;
revoke all on function app.record_connection_health(uuid, jsonb) from public, anon, authenticated, service_role;

alter table public.connection_health drop constraint connection_health_pkey;
alter table public.connection_health add constraint connection_health_pkey primary key (office_id, service, credential);

alter table public.workspace_layouts drop constraint workspace_layouts_pkey;
alter table public.workspace_layouts add constraint workspace_layouts_pkey primary key (office_id, owner);

drop index public.documents_one_per_external_ref;
create unique index documents_one_per_external_ref
  on public.documents (office_id, connector, external_parent_ref, external_ref) where external_ref is not null;

drop index public.documents_one_per_linked_file;
create unique index documents_one_per_linked_file
  on public.documents (office_id, connector, external_ref) where external_ref is not null and external_parent_ref is null;

drop index public.proposals_one_per_need;
create unique index proposals_one_per_need on public.proposals (office_id, staff_slug, kind, needed);

drop index public.sync_runs_one_at_a_time;
create unique index sync_runs_one_at_a_time on public.sync_runs (office_id, (true)) where state = 'running';

drop index public.notebook_sync_queue_one_live_per_fingerprint;
create unique index notebook_sync_queue_one_live_per_fingerprint
  on public.notebook_sync_queue (office_id, fingerprint)
  where state = any (array['pending'::notebook_sync_state, 'in_flight'::notebook_sync_state, 'uncertain'::notebook_sync_state, 'reconciling'::notebook_sync_state]);

drop index public.notification_preferences_one_global;
create unique index notification_preferences_one_global on public.notification_preferences (office_id, subject) where project_id is null;

do $m$
begin
  if exists (select 1 from pg_indexes where schemaname = 'public'
              and indexname in ('documents_one_per_external_ref', 'documents_one_per_linked_file', 'proposals_one_per_need',
                                'sync_runs_one_at_a_time', 'notebook_sync_queue_one_live_per_fingerprint',
                                'notification_preferences_one_global')
              and indexdef !~* 'btree \(office_id') then
    raise exception '0862: a key was left global';
  end if;
end
$m$;
