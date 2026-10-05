-- Proof for 0920: Activity says which door. Local replica only; everything rolls back.
--   psql -h /tmp/pgs -p 55432 -U postgres -d cand_act -v ON_ERROR_STOP=1 -f scripts/isolated/ux-be/01-activity-via.sql
\set ON_ERROR_STOP on
begin;
set local application_name = 'PostgREST proof';

do $t$
declare
  a uuid := (select office_id from public.offices where kind = 'person' limit 1);
  b uuid := (select office_id from public.offices where kind = 'test' limit 1);
  pa uuid; pb uuid; ja uuid; jh uuid; jm uuid; r jsonb; l jsonb; row_ jsonb; n int;
  cmd jsonb; client_gpt text := 'zz-proof-gpt'; client_cl text := 'zz-proof-claude';
begin
  insert into public.projects (office_id, slug, name) values (a, 'zz-act-a', 'Act A') returning project_id into pa;
  insert into public.projects (office_id, slug, name) values (b, 'zz-act-b', 'Act B') returning project_id into pb;
  insert into public.mcp_clients (office_id, client_id, display_name, token_sha256, scopes)
    values (a, client_gpt, 'ChatGPT', repeat('a',64), array['read','write']), (a, client_cl, 'Claude Desktop', repeat('b',64), array['read','write']);
  if (select kind from public.mcp_clients where client_id = client_gpt) <> 'chatgpt' then raise exception 'kind chatgpt'; end if;
  if (select kind from public.mcp_clients where client_id = client_cl) <> 'claude' then raise exception 'kind claude'; end if;

  -- (1) an event recorded under an ambient door
  perform set_config('app.via', 'chatgpt', true);
  perform app.append_event(a, gen_random_uuid(), 'user', app.office_actor(a), 'mcp', 'task.created', false, pa);
  perform set_config('app.via', '', true);
  -- a bad word is ignored, not an error
  perform set_config('app.via', 'carrier-pigeon', true);
  perform app.append_event(a, gen_random_uuid(), 'user', app.office_actor(a), 'x', 'document.noted', false, pa);
  perform set_config('app.via', '', true);
  -- no door: unknown
  perform app.append_event(a, gen_random_uuid(), 'user', app.office_actor(a), 'x', 'calendar.moved', false, pa);
  -- a sync, system actor
  perform app.append_event(a, gen_random_uuid(), 'system', 'office', 'duty', 'google.mail_read', false, pa);
  -- a person acting in Team HQ: a real inbound turn creates a job with origin_channel teamhq
  cmd := app.say_in_project(a, pa, 'proof question about the plan');
  ja := (cmd ->> 'job')::uuid;
  if app.job_via(ja) is distinct from 'teamhq' then raise exception 'job_via teamhq got %', app.job_via(ja); end if;
  perform app.append_event(a, gen_random_uuid(), 'agent', 'office', 'office.instruction', 'office.learned', false, pa,
                           null, null, 'found something', '[]', null, null, null, ja);
  -- an MCP job
  insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
    values (a, gen_random_uuid(), pa, 'mcp-proof-' || gen_random_uuid(), 'notebook.ask', 'mcp:' || client_cl, 200, '{}') returning job_id into jm;
  if app.job_via(jm) is distinct from 'claude' then raise exception 'job_via claude got %', app.job_via(jm); end if;
  perform app.append_event(a, gen_random_uuid(), 'agent', 'office', 'office.instruction', 'research.asked', false, pa,
                           null, null, 'asked', '[]', null, null, null, jm);
  -- a HARNESS job's event must never show
  set local application_name = 'psql harness';
  cmd := app.say_in_project(a, pa, 'harness question');
  set local application_name = 'PostgREST proof';
  jh := (cmd ->> 'job')::uuid;
  if not app.harness_job(jh) then raise exception 'control: the harness job should read as harness'; end if;
  perform app.append_event(a, gen_random_uuid(), 'agent', 'office', 'office.instruction', 'finding.committed', false, pa,
                           null, null, 'HARNESS-ROW', '[]', null, null, null, jh);
  -- the OTHER office's event
  perform app.append_event(b, gen_random_uuid(), 'user', app.office_actor(b), 'x', 'task.created', false, pb, null, null, 'OTHER-OFFICE');

  -- tasks: stamped by a client / by a job / by a person
  perform app.task_add(a, pa, 'via gpt task', null, null, null, false, 'mcp:' || client_gpt, null);
  perform app.task_add(a, pa, 'own task', null, null, null, false, null, null);
  perform app.task_add(a, pa, 'job task', null, null, null, false, null, ja);
  insert into public.documents (office_id, project_id, connector, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by, origin)
    values (a, pa, 'mcp', 'Claude note', 'note', 'x', repeat('c',64), 1, now(), client_cl, 'yours');

  -- control: both hidden rows really exist, so their absence below is the filter and not a missing write
  if (select count(*) from public.events where rationale_summary in ('HARNESS-ROW','OTHER-OFFICE')) <> 2 then raise exception 'control: hidden rows were not written'; end if;
  -- ---- reader 1: project activity
  l := app.studio_activity(pa, 50);
  raise notice 'project activity: %', jsonb_pretty(l);
  select count(*) into n from jsonb_array_elements(l) e where e->>'detail' like '%HARNESS-ROW%' or e->>'detail' like '%OTHER-OFFICE%';
  if n <> 0 then raise exception 'harness or other-office row leaked into project activity'; end if;
  if not exists (select 1 from jsonb_array_elements(l) e where e->>'what' like '%task "via gpt task"%' and e->>'via' = 'ChatGPT' and e->>'category' = 'task') then raise exception 'task via ChatGPT missing'; end if;
  if not exists (select 1 from jsonb_array_elements(l) e where e->>'what' like '%task "own task"%' and e->>'via' is null) then raise exception 'own task must be via null'; end if;
  if not exists (select 1 from jsonb_array_elements(l) e where e->>'what' like '%task "job task"%' and e->>'via' = 'Team HQ') then raise exception 'job task should read Team HQ'; end if;
  if not exists (select 1 from jsonb_array_elements(l) e where e->>'what' like '%document "Claude note"%' and e->>'via' = 'Claude' and e->>'category' = 'document') then raise exception 'document via Claude missing'; end if;
  if not exists (select 1 from jsonb_array_elements(l) e where e->>'verb' = 'created' and e->>'what' = 'a task' and e->>'via' = 'ChatGPT') then raise exception 'ambient ChatGPT event row missing'; end if;
  if not exists (select 1 from jsonb_array_elements(l) e where e->>'what' = 'a calendar' and e->>'via' is null and e->>'category' = 'calendar') then raise exception 'unknown-door calendar row must be via null, category calendar'; end if;
  if not exists (select 1 from jsonb_array_elements(l) e where e->>'what' = 'a document' and e->>'via' is null) then raise exception 'bad ambient word must record null'; end if;
  if not exists (select 1 from jsonb_array_elements(l) e where e->>'what' = 'something' and e->>'via' = 'Team HQ') then raise exception 'job event via Team HQ missing'; end if;
  if not exists (select 1 from jsonb_array_elements(l) e where e->>'verb' = 'asked' and e->>'via' = 'Claude' and e->>'category' = 'research') then raise exception 'mcp job event via Claude missing'; end if;
  if not exists (select 1 from jsonb_array_elements(l) e where e->>'what' = 'a google' and e->>'via' = 'Google sync' and e->>'category' = 'sync') then raise exception 'sync row missing'; end if;

  -- ---- reader 2: office-wide Recent activity
  r := app.hq_studio_lately(a, 40);
  select count(*) into n from jsonb_array_elements(r->'office') e where e->>'why' in ('HARNESS-ROW','OTHER-OFFICE');
  if n <> 0 then raise exception 'harness or other-office row leaked into lately'; end if;
  if not exists (select 1 from jsonb_array_elements(r->'office') e where e->>'via' = 'ChatGPT' and e->>'category' = 'task') then raise exception 'lately: ChatGPT row missing'; end if;
  if not exists (select 1 from jsonb_array_elements(r->'office') e where e->>'via' = 'Claude' and e->>'category' = 'research') then raise exception 'lately: Claude row missing'; end if;
  if not exists (select 1 from jsonb_array_elements(r->'office') e where e->>'via' = 'Google sync') then raise exception 'lately: sync row missing'; end if;
  -- tenant isolation: office B sees none of A's, and its own is shown
  r := app.hq_studio_lately(b, 40);
  if exists (select 1 from jsonb_array_elements(r->'office') e where e->>'project' = 'Act A' ) then raise exception 'office B saw office A rows'; end if;
  -- control: the detector can fail (no events -> expect the claim to be false)
  if app.via_label('nonsense') is not null then raise exception 'via_label must be null for unknown'; end if;
  if app.activity_category('x.y') <> 'other' then raise exception 'category default'; end if;
  raise notice 'PASS 01-activity-via';
end $t$;
rollback;
