-- 0659 - ownership wave 3: the carriers that belong to an account rather than to a project or a job (multi-user P2).
--
-- Twenty-two tables: the person's own settings and layouts, the mail and calendar caches of his Google account, what
-- his chats and instructions said, the integrations installed for him, and the registry of MCP clients. The same tiers
-- as 0658, strongest first: a named owner key, then an explicit statement of which integration an account belongs to,
-- then a suite's own name. A row nothing proves aborts the wave and names itself.
--
-- connection_health is classified by a table in this file, not by a pattern: the deployment's own infrastructure keys
-- (database, hosting, model providers, backup, repository) are SYSTEM, and the credentials that reach the person's
-- accounts (Slack, Telegram, calendar, Notion, NotebookLM) are the person's. The sole-person rows below are bound by
-- that statement, not by there being only one person.
--
-- Dry run: select set_config('p2.dry_run','0659',true); in front of the whole chain raises the report at the end.

create or replace function pg_temp.p2_h(r jsonb) returns boolean language sql immutable as $f$
  select coalesce(r ->> 'is_fixture', 'false') = 'true'
      or (select string_agg(e.value::text, ' ') from jsonb_each(r) e) ~* '(^|[^a-z0-9])m[s-v][0-9a-z]{6}([^a-z0-9]|$)'
      or (select string_agg(e.value::text, ' ') from jsonb_each(r) e) ~* '(fixture|verify|probe|proof|harness|nb-gate|gate-?[0-9]|zz[ _]test|phase-1|verifier|synthetic)'
$f$;

create or replace function pg_temp.p2_owner_office(k text) returns uuid language sql stable as $f$
  select min(o.office_id::text)::uuid from public.office_members m
    join auth.users u on lower(u.email) = m.email
    join public.offices o on o.auth_user_id = u.id and o.kind = 'person'
   where m.kind = 'person' and m.owner_key = k
$f$;

do $m$
declare
  v_person uuid := app.sole_person_office();
  v_test   uuid := app.test_office();
  v_system uuid := app.system_office();
  tabs text[] := array['appearance_settings','briefings','calendar_events','connection_health','contact_labels','feedback',
    'mail_messages','mcp_auth_codes','mcp_clients','mcp_providers','notebook_capability_probes','notebook_exclusions',
    'notebook_refusals','preference_instructions','slack_app_credentials','slack_workspaces','staff_tools',
    'subject_identities','sync_runs','task_tombstones','telegram_chats','workspace_layouts'];
  tbl text; rc bigint; n bigint; v_unres text := ''; v_sample text; v_report text;
begin
  if v_person is null or v_test is null or v_system is null then
    raise exception '0659: expected exactly one person, one test and one system office';
  end if;
  create temp table p2_rep3(tbl text, rule text, n bigint) on commit drop;
  foreach tbl in array tabs loop
    execute format('alter table public.%I disable trigger user', tbl);
  end loop;

  -- 1. the named owner key
  update public.appearance_settings t set office_id = pg_temp.p2_owner_office(t.owner) where t.office_id is null and pg_temp.p2_owner_office(t.owner) is not null;
  get diagnostics rc = row_count; insert into p2_rep3 values ('appearance_settings', 'owner is the person''s owner key', rc);
  update public.workspace_layouts t set office_id = pg_temp.p2_owner_office(t.owner) where t.office_id is null and pg_temp.p2_owner_office(t.owner) is not null;
  get diagnostics rc = row_count; insert into p2_rep3 values ('workspace_layouts', 'owner is the person''s owner key', rc);
  update public.contact_labels t set office_id = pg_temp.p2_owner_office(t.owner) where t.office_id is null and pg_temp.p2_owner_office(t.owner) is not null;
  get diagnostics rc = row_count; insert into p2_rep3 values ('contact_labels', 'owner is the person''s owner key', rc);
  update public.task_tombstones t set office_id = pg_temp.p2_owner_office(t.deleted_by) where t.office_id is null and pg_temp.p2_owner_office(t.deleted_by) is not null;
  get diagnostics rc = row_count; insert into p2_rep3 values ('task_tombstones', 'deleted by the person''s owner key', rc);
  update public.staff_tools t set office_id = pg_temp.p2_owner_office(t.granted_by) where t.office_id is null and pg_temp.p2_owner_office(t.granted_by) is not null;
  get diagnostics rc = row_count; insert into p2_rep3 values ('staff_tools', 'granted by the person''s owner key', rc);
  update public.subject_identities t set office_id = pg_temp.p2_owner_office(t.subject)
   where t.office_id is null and t.kind = 'person' and pg_temp.p2_owner_office(t.subject) is not null;
  get diagnostics rc = row_count; insert into p2_rep3 values ('subject_identities', 'a person identity of the person''s owner key', rc);
  update public.subject_identities t set office_id = v_test where t.office_id is null and (t.kind = 'harness' or pg_temp.p2_h(to_jsonb(t)));
  get diagnostics rc = row_count; insert into p2_rep3 values ('subject_identities', 'a harness identity', rc);
  update public.telegram_chats t set office_id = pg_temp.p2_owner_office(t.subject) where t.office_id is null and pg_temp.p2_owner_office(t.subject) is not null;
  get diagnostics rc = row_count; insert into p2_rep3 values ('telegram_chats', 'registered to the person''s owner key', rc);
  -- feedback and preference instructions: the actor resolves through the identity registry to an owner key
  update public.feedback t set office_id = pg_temp.p2_owner_office(i.subject)
    from public.subject_identities i
   where t.office_id is null and i.origin_channel = t.origin_channel and i.actor = t.given_by and i.kind = 'person'
     and pg_temp.p2_owner_office(i.subject) is not null;
  get diagnostics rc = row_count; insert into p2_rep3 values ('feedback', 'given by an actor the identity registry binds to the person', rc);
  update public.preference_instructions t set office_id = c.office_id from public.inbound_commands c
   where t.office_id is null and c.command_id = t.command_id;
  get diagnostics rc = row_count; insert into p2_rep3 values ('preference_instructions', 'link: the command it came from', rc);
  update public.preference_instructions t set office_id = pg_temp.p2_owner_office(t.subject)
   where t.office_id is null and pg_temp.p2_owner_office(t.subject) is not null and not pg_temp.p2_h(to_jsonb(t));
  get diagnostics rc = row_count; insert into p2_rep3 values ('preference_instructions', 'subject is the person''s owner key', rc);

  -- 2. the person's Google, Notion, Slack and NotebookLM accounts
  update public.mail_messages t set office_id = d.office_id from public.responsibilities d
   where t.office_id is null and d.slug = 'mail-refresh';
  get diagnostics rc = row_count; insert into p2_rep3 values ('mail_messages', 'the cache the mail-refresh duty keeps (the duty''s office)', rc);
  update public.calendar_events t set office_id = d.office_id from public.responsibilities d
   where t.office_id is null and d.slug = 'calendar-refresh';
  get diagnostics rc = row_count; insert into p2_rep3 values ('calendar_events', 'the cache the calendar-refresh duty keeps (the duty''s office)', rc);
  update public.briefings t set office_id = d.office_id from public.responsibilities d
   where t.office_id is null and t.kind = 'morning' and d.slug = 'morning-briefing';
  get diagnostics rc = row_count; insert into p2_rep3 values ('briefings', 'a morning briefing is the morning-briefing duty''s', rc);
  update public.sync_runs t set office_id = d.office_id from public.responsibilities d
   where t.office_id is null and d.slug = 'discovery-sync' and not pg_temp.p2_h(to_jsonb(t));
  get diagnostics rc = row_count; insert into p2_rep3 values ('sync_runs', 'a run of the discovery-sync duty', rc);
  update public.notebook_capability_probes t set office_id = v_person
   where t.office_id is null and not pg_temp.p2_h(to_jsonb(t))
     and exists (select 1 from public.connection_health c where c.service = 'Google' and c.credential = 'NotebookLM master token' and c.purpose = 'acts');
  get diagnostics rc = row_count; insert into p2_rep3 values ('notebook_capability_probes', 'a probe of the NotebookLM account the person connected', rc);
  update public.slack_app_credentials t set office_id = v_person where t.office_id is null;
  get diagnostics rc = row_count; insert into p2_rep3 values ('slack_app_credentials', 'the one Slack app installed for the person', rc);
  update public.slack_workspaces t set office_id = v_person
   where t.office_id is null and t.installed and not pg_temp.p2_h(to_jsonb(t))
     and exists (select 1 from public.slack_app_credentials x where x.team_id = t.team_id);
  get diagnostics rc = row_count; insert into p2_rep3 values ('slack_workspaces', 'the workspace the person''s Slack app is installed in', rc);

  -- connection_health: the deployment's own infrastructure is SYSTEM; the person's accounts are the person's
  update public.connection_health t set office_id = case
      when t.service in ('Supabase', 'Vercel', 'OpenRouter', 'OpenAI', 'Groq', 'Backblaze B2', 'GitHub') then v_system
      when t.service = 'Google' and t.credential in ('Gemini API key', 'Cloud TTS service account', 'NotebookLM adapter (python)') then v_system
      when t.service = 'Slack' and t.purpose = 'maintains' then v_system
      when t.service = 'Telegram' and t.credential like 'staff bot tokens%' then v_system
      when t.service in ('Slack', 'Telegram', 'google_calendar', 'Notion') or (t.service = 'Google' and t.credential = 'NotebookLM master token') then v_person
    end
   where t.office_id is null;
  get diagnostics rc = row_count; insert into p2_rep3 values ('connection_health', 'credential classified by service: infrastructure is system, the person''s accounts are the person''s', rc);

  -- the MCP registry: the two designed clients act as the person; probes were revoked and belong to the suite
  update public.mcp_clients t set office_id = v_test where t.office_id is null and (t.enabled = false and t.display_name = 'Flow probe');
  get diagnostics rc = row_count; insert into p2_rep3 values ('mcp_clients', 'a revoked probe client', rc);
  update public.mcp_clients t set office_id = v_person where t.office_id is null and t.enabled and t.display_name in ('ChatGPT', 'Claude Desktop');
  get diagnostics rc = row_count; insert into p2_rep3 values ('mcp_clients', 'one of the two designed clients (ChatGPT, Claude Desktop), bound to the one person', rc);

  update public.telegram_chats t set office_id = v_test where t.office_id is null and t.undeliverable_reason = 'a declared test origin (#381)';
  get diagnostics rc = row_count; insert into p2_rep3 values ('telegram_chats', 'a chat the harness declared a test origin before knocking (#381)', rc);
  update public.telegram_chats t set office_id = v_person
   where t.office_id is null and t.chat_type = 'group' and t.deliverable
     and not exists (select 1 from public.telegram_chats o where o.chat_id = t.chat_id and o.subject is not null and pg_temp.p2_owner_office(o.subject) <> v_person);
  get diagnostics rc = row_count; insert into p2_rep3 values ('telegram_chats', 'REVIEW: the deliverable group the roster bots sit in, bound to the one person office (sole-person reasoning; P3 pairs chats explicitly)', rc);
  update public.feedback t set office_id = v_test where t.office_id is null and t.origin_channel = 'telegram' and t.given_by !~ '^[0-9]{6,}$';
  get diagnostics rc = row_count; insert into p2_rep3 values ('feedback', 'a Telegram user id too short to be a real one', rc);

  -- 3. a suite's own name
  foreach tbl in array tabs loop
    execute format('update public.%I t set office_id = %L where t.office_id is null and pg_temp.p2_h(to_jsonb(t) - ''search'')', tbl, v_test);
    get diagnostics rc = row_count;
    if rc > 0 then insert into p2_rep3 values (tbl, 'harness-shaped identity (run token / suite name)', rc); end if;
  end loop;
  update public.staff_tools t set office_id = v_person
   where t.office_id is null and t.granted_by like 'migration%'
     and exists (select 1 from public.staff s where s.slug = t.staff_slug and not s.is_fixture);
  get diagnostics rc = row_count; insert into p2_rep3 values ('staff_tools', 'a default grant a migration made to a roster member, in the one person office', rc);

  -- 4. every row owned, or the wave stops here
  foreach tbl in array tabs loop
    execute format('select count(*) from public.%I where office_id is null', tbl) into n;
    if n > 0 then
      execute format('select string_agg(left((to_jsonb(r) - ''search'' - ''body'' - ''excerpt'')::text, 300), E''\n    '') from (select * from public.%I where office_id is null limit 2) r', tbl) into v_sample;
      v_unres := v_unres || tbl || ': unresolved=' || n || E'\n    ' || v_sample || E'\n';
    end if;
  end loop;
  if v_unres <> '' then raise exception E'0659: rows no rule proves an owner for:\n%', v_unres; end if;

  insert into public.office_backfill_report (wave, table_name, rule, n)
  select '0659', r.tbl, r.rule, sum(r.n) from p2_rep3 r where r.n > 0 group by r.tbl, r.rule;
  foreach tbl in array tabs loop
    execute format('alter table public.%I enable trigger user', tbl);
  end loop;
  if exists (select 1 from pg_trigger t where t.tgrelid::regclass::text = any(select 'public.' || x from unnest(tabs) x)
              and not t.tgisinternal and t.tgenabled <> 'O') then
    raise exception '0659: a trigger was left disabled';
  end if;
  select string_agg(r.tbl || ' | ' || r.rule || ' | ' || r.n, E'\n' order by r.tbl, r.rule) into v_report from p2_rep3 r where r.n > 0;
  v_report := v_report || E'\nelapsed since the transaction began = ' || (clock_timestamp() - transaction_timestamp());
  if current_setting('p2.dry_run', true) = '0659' then raise exception E'P2REPORT\n%', v_report; end if;
  raise notice E'0659 backfill:\n%', v_report;
end $m$;

-- ---- constrain ---------------------------------------------------------------------------------------------------
alter table public.preference_instructions add constraint preference_instructions_id_office_key unique (instruction_id, office_id);
alter table public.preference_instructions add constraint preference_instructions_command_id_same_office
  foreign key (command_id, office_id) references public.inbound_commands (command_id, office_id) not valid;
alter table public.preference_instructions validate constraint preference_instructions_command_id_same_office;
alter table public.preference_proposals add constraint preference_proposals_instruction_id_same_office
  foreign key (instruction_id, office_id) references public.preference_instructions (instruction_id, office_id) not valid;
alter table public.preference_proposals validate constraint preference_proposals_instruction_id_same_office;

do $m$
declare t text;
begin
  for t in select unnest(array['appearance_settings','briefings','calendar_events','connection_health','contact_labels','feedback',
    'mail_messages','mcp_auth_codes','mcp_clients','mcp_providers','notebook_capability_probes','notebook_exclusions',
    'notebook_refusals','preference_instructions','slack_app_credentials','slack_workspaces','staff_tools',
    'subject_identities','sync_runs','task_tombstones','telegram_chats','workspace_layouts']) loop
    execute format('alter table public.%I alter column office_id set not null', t);
  end loop;
end $m$;

select app.p2_guard_table('appearance_settings', '', '', 'owner');
select app.p2_guard_table('briefings', '', '', '');
select app.p2_guard_table('calendar_events', '', '', '');
select app.p2_guard_table('connection_health', '', '', '');
select app.p2_guard_table('contact_labels', '', '', 'owner');
select app.p2_guard_table('feedback', '', '', 'given_by');
select app.p2_guard_table('mail_messages', '', '', '');
select app.p2_guard_table('mcp_auth_codes', '', '', '');
select app.p2_guard_table('mcp_clients', '', '', '');
select app.p2_guard_table('mcp_providers', '', '', '');
select app.p2_guard_table('notebook_capability_probes', '', '', '');
select app.p2_guard_table('notebook_exclusions', '', '', '');
select app.p2_guard_table('notebook_refusals', '', '', '');
select app.p2_guard_table('preference_instructions', '', '', 'subject');
select app.p2_guard_table('slack_app_credentials', '', '', '');
select app.p2_guard_table('slack_workspaces', '', '', '');
select app.p2_guard_table('staff_tools', '', '', 'granted_by');
select app.p2_guard_table('subject_identities', '', '', 'subject');
select app.p2_guard_table('sync_runs', '', '', '');
select app.p2_guard_table('task_tombstones', '', '', 'deleted_by');
select app.p2_guard_table('telegram_chats', '', '', 'subject');
select app.p2_guard_table('workspace_layouts', '', '', 'owner');

-- ROLLBACK (not part of the migration): per table drop the a0_office_bridge and a1_office_write_once triggers;
-- alter column office_id drop not null; drop the three *_same_office / *_id_office_key constraints added above.
