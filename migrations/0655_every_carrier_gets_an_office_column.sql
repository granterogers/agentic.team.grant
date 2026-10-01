-- 0655 - every carrier gets an office_id column (multi-user P2, expand step; nullable on purpose).
--
-- The 52 OFFICE_CARRIER tables of docs/multi-user/ownership-manifest.json, and only those. Each gains
-- `office_id uuid references public.offices` and an index. The column is NULLABLE here and nothing writes it yet: the
-- backfill waves (0656 onwards) stamp it, install the immutability trigger and the composite keys, and set NOT NULL per
-- table group, each group in ONE transaction, so there is never a committed state in which a table is stamped but
-- unconstrained and new writers can slip a null in.
--
-- Version skew is safe because the column is invisible to every existing writer (no default, no NOT NULL) and no
-- second real office exists (0654 made exactly Grant, the test principal and the system office).
--
-- Tables that already carry a text `owner` keep it: it is the old identity and is removed in the contract step
-- (P3 and after), not here. A table that is not in the manifest as a carrier is refused, so a carrier added
-- by a concurrent branch fails this migration instead of being silently skipped.

do $m$
declare
  v_carriers text[] := array[
    'appearance_settings',
    'autonomy_settings',
    'blockers',
    'briefings',
    'browser_actions',
    'calendar_events',
    'connection_health',
    'contact_labels',
    'decisions',
    'deliveries',
    'documents',
    'event_triggers',
    'events',
    'failure_signatures',
    'feedback',
    'inbound_commands',
    'inference_usage',
    'jobs',
    'lessons',
    'mail_messages',
    'mcp_auth_codes',
    'mcp_clients',
    'mcp_providers',
    'notebook_capability_probes',
    'notebook_chat_usage',
    'notebook_exclusions',
    'notebook_refusals',
    'notebook_spend',
    'notebook_sync_queue',
    'notification_events',
    'notification_preferences',
    'preference_instructions',
    'preference_proposals',
    'project_switches',
    'projects',
    'proposals',
    'responsibilities',
    'signals',
    'skills',
    'slack_app_credentials',
    'slack_workspaces',
    'staff_tools',
    'standing_authorizations',
    'subject_identities',
    'suggestions',
    'sync_runs',
    'task_tombstones',
    'tasks',
    'telegram_chats',
    'tool_requests',
    'undoable_actions',
    'workspace_layouts'
  ];
  t text;
  v_missing text[];
begin
  select array_agg(c) into v_missing
    from unnest(v_carriers) c
   where to_regclass('public.' || c) is null;
  if v_missing is not null then
    raise exception '0655: the manifest names tables that do not exist: %', v_missing;
  end if;

  foreach t in array v_carriers loop
    execute format('alter table public.%I add column if not exists office_id uuid references public.offices (office_id)', t);
    execute format('create index if not exists %I on public.%I (office_id)', t || '_office_idx', t);
  end loop;
end
$m$;

-- ROLLBACK (not part of the migration): for each carrier, drop index <t>_office_idx and drop column office_id.
