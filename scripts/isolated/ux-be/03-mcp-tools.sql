-- Proof for 0922: the MCP tool projections. Local replica only; rolls back.
\set ON_ERROR_STOP on
begin;
set local application_name = 'PostgREST proof';
do $t$
declare
  a uuid := (select office_id from public.offices where kind = 'person' limit 1);
  b uuid := (select office_id from public.offices where kind = 'test' limit 1);
  pa uuid; pb uuid; r jsonb; tid text; n int; jid uuid; via text; l jsonb; lat jsonb;
  w text := 'zz-w-gpt'; ro text := 'zz-ro'; cl text := 'zz-w-claude'; fb text := 'zz-b-gpt';
begin
  insert into public.projects (office_id, slug, name) values (a, 'zz-m-a', 'Mcp A') returning project_id into pa;
  insert into public.projects (office_id, slug, name) values (b, 'zz-m-b', 'Mcp B') returning project_id into pb;
  insert into public.mcp_clients (office_id, client_id, display_name, token_sha256, scopes) values
    (a, w,  'ChatGPT',  repeat('1',64), array['read','write']),
    (a, ro, 'ChatGPT read-only', repeat('2',64), array['read']),
    (a, cl, 'Claude',   repeat('3',64), array['read','write']),
    (b, fb, 'ChatGPT',  repeat('4',64), array['read','write']);

  -- ---- create_task: stamped with the client; Activity says via ChatGPT
  r := app.mcp_task_add(a, w, 'zz-m-a', 'Call the surveyor', 'about the plot', current_date + 3);
  if r ? 'error' then raise exception 'task_add: %', r; end if;
  tid := r ->> 'id';
  if (select added_by from public.tasks where task_id = tid::uuid) <> 'mcp:' || w then raise exception 'added_by not stamped'; end if;
  -- read-only client, other office's client, unknown project, fixture project, wrong office's project
  if not (app.mcp_task_add(a, ro, 'zz-m-a', 'x') ? 'error') then raise exception 'read-only client wrote'; end if;
  if not (app.mcp_task_add(a, fb, 'zz-m-a', 'x') ? 'error') then raise exception 'another office''s client wrote into this office'; end if;
  if not (app.mcp_task_add(a, w, 'zz-m-b', 'x') ? 'error') then raise exception 'wrote into another office''s project'; end if;
  if not (app.mcp_task_add(a, w, 'no-such', 'x') ? 'error') then raise exception 'unknown project accepted'; end if;
  if not (app.mcp_task_add(b, w, 'zz-m-b', 'x') ? 'error') then raise exception 'client of A wrote as office B'; end if;
  if not (app.mcp_task_add(a, w, 'zz-m-a', '   ') ? 'error') then raise exception 'blank title accepted'; end if;
  if (select count(*) from public.tasks where office_id = a and title = 'x') <> 0 then raise exception 'a refused write left a row'; end if;

  -- ---- list_tasks
  r := app.mcp_list_tasks(a, 'zz-m-a', 'open', 10);
  if jsonb_array_length(r) <> 1 or r -> 0 ->> 'title' <> 'Call the surveyor' then raise exception 'list_tasks: %', r; end if;
  if jsonb_array_length(app.mcp_list_tasks(a, 'zz-m-a', 'done', 10)) <> 0 then raise exception 'state filter'; end if;
  if not (app.mcp_list_tasks(a, 'zz-m-b', null, 10) ? 'error') then raise exception 'list_tasks crossed offices'; end if;
  if not (app.mcp_list_tasks(a, null, 'bogus', 10) ? 'error') then raise exception 'bad state accepted'; end if;

  -- ---- update_task: state + details, event carries the door; cannot cancel
  r := app.mcp_task_update(a, w, tid, 'doing', 'Call the surveyor today', null, null, null);
  if r ? 'error' then raise exception 'update: %', r; end if;
  if (select state from public.tasks where task_id = tid::uuid) <> 'doing' then raise exception 'state not set'; end if;
  if (select origin_channel from public.events where action_type = 'task.updated' and office_id = a) is distinct from 'chatgpt' then raise exception 'update event door'; end if;
  if not (app.mcp_task_update(a, w, tid, 'cancelled') ? 'error') then raise exception 'assistant cancelled a task'; end if;
  if not (app.mcp_task_update(a, ro, tid, 'done') ? 'error') then raise exception 'read-only client updated'; end if;
  if not (app.mcp_task_update(b, fb, tid, 'done') ? 'error') then raise exception 'office B''s client touched office A''s task'; end if;
  if (select state from public.tasks where task_id = tid::uuid) <> 'doing' then raise exception 'a refused update changed the task'; end if;
  r := app.mcp_task_update(a, cl, tid, 'blocked', null, null, null, 'waiting for the surveyor');
  if r ? 'error' then raise exception 'blocked with reason: %', r; end if;
  if not (app.mcp_task_update(a, cl, tid, 'blocked') ? 'error') then raise exception 'blocked without reason accepted'; end if;

  -- ---- inspect_activity shows both, with doors
  l := app.mcp_activity(a, 'zz-m-a', 25);
  if not exists (select 1 from jsonb_array_elements(l) e where e->>'via' = 'ChatGPT' and e->>'category' = 'task') then raise exception 'activity: ChatGPT'; end if;
  if not exists (select 1 from jsonb_array_elements(l) e where e->>'via' = 'Claude' and e->>'what' = 'a task') then raise exception 'activity: Claude event missing: %', l; end if;
  if not (app.mcp_activity(a, 'zz-m-b', 25) ? 'error') then raise exception 'activity crossed offices'; end if;
  lat := app.mcp_activity(b, null, 25);
  if lat::text like '%surveyor%' then raise exception 'office B''s feed shows A''s work'; end if;

  -- ---- ask_team: queued, NOT trusted, door recorded
  r := app.mcp_ask_team(a, w, 'zz-m-a', 'What is the risk on the plot purchase?', null);
  if r ? 'error' then raise exception 'ask_team: %', r; end if;
  jid := (r ->> 'job_id')::uuid;
  if app.job_via(jid) is distinct from 'chatgpt' then raise exception 'ask_team job door: %', app.job_via(jid); end if;
  if app.job_origin(jid) = 'trusted' then raise exception 'an assistant turn must not be trusted (got %)', app.job_origin(jid); end if;
  if app.may_act_outside(jid) then raise exception 'assistant turn may act outside'; end if;
  if app.harness_job(jid) then raise exception 'control: a PostgREST-ingress turn should not read as harness'; end if;
  if not (app.mcp_ask_team(a, ro, 'zz-m-a', 'hi') ? 'error') then raise exception 'read-only client asked'; end if;
  if not (app.mcp_ask_team(a, w, 'zz-m-a', 'hi', 'nobody-here') ? 'error') then raise exception 'unknown staff accepted'; end if;
  if not (app.mcp_ask_team(a, w, 'zz-m-b', 'hi') ? 'error') then raise exception 'ask_team crossed offices'; end if;
  r := app.mcp_ask_team(a, w, 'zz-m-a', 'Who is on the plot work?', 'research-director');
  if r ? 'error' then raise exception 'ask_team addressed: %', r; end if;

  -- ---- start_research / generate_artifact: policy decides
  r := app.mcp_start_research(a, w, 'zz-m-a', 'competitors in the surveying market', 'https://example.com/a');
  if r ? 'error' or r ->> 'job_id' is null then raise exception 'research at default autonomy should proceed: %', r; end if;
  if not (app.mcp_start_research(a, w, 'zz-m-a', 'x', 'http://insecure.example') ? 'error') then raise exception 'non-https research url accepted'; end if;
  r := app.mcp_generate_artifact(a, w, 'zz-m-a', 'A one-page summary');
  if r ->> 'job_id' is null then raise exception 'artifact at default should queue: %', r; end if;
  if (select announce from public.jobs where job_id = (r ->> 'job_id')::uuid) then raise exception 'artifact job must not announce'; end if;
  if (select requested_by from public.jobs where job_id = (r ->> 'job_id')::uuid) <> 'mcp:' || w then raise exception 'artifact requester'; end if;
  if not (app.mcp_generate_artifact(a, ro, 'zz-m-a', 'x') ? 'error') then raise exception 'read-only client generated'; end if;
  -- the dial goes to observe (one setting per transaction: two in one statement-time tie by design)
  perform app.hq_autonomy_set(a, 'observe', pa, 'office', 'proof: observe only');
  r := app.mcp_start_research(a, w, 'zz-m-a', 'competitors again', null);
  if r ->> 'status' not in ('needs_approval', 'refused') then raise exception 'policy ask/refuse must stop research: %', r; end if;
  if (select count(*) from public.jobs where office_id = a and pinned_config::text like '%competitors again%') <> 0 then raise exception 'a refused research request left a job'; end if;
  n := (select count(*) from public.jobs where office_id = a and kind = 'artifact.report');
  r := app.mcp_generate_artifact(a, w, 'zz-m-a', 'Another summary');
  if r ->> 'status' not in ('needs_approval', 'refused') then raise exception 'policy must stop the artifact: %', r; end if;
  if (select count(*) from public.jobs where office_id = a and kind = 'artifact.report') <> n then raise exception 'a refused artifact left a job'; end if;

  -- ---- project_search via mcp
  r := app.mcp_project_search(a, 'surveyor', 'zz-m-a', 10, null);
  if jsonb_array_length(r) < 1 then raise exception 'search finds the task'; end if;
  if not (app.mcp_project_search(a, 'surveyor', 'zz-m-b', 10, null) ? 'error') then raise exception 'search crossed offices'; end if;
  if app.mcp_project_search(b, 'surveyor', null, 10, null)::text like '%surveyor%' then raise exception 'office B found A''s task'; end if;

  -- ---- optional tools reflect the database
  -- 0906 (the calendar, written as 0897) is applied on this replica, so all three calendar tools are served; the calendar itself is
  -- proved in 05-mcp-calendar.sql.
  if app.mcp_optional_tools(a) <> '["list_events","create_event","update_event"]'::jsonb then raise exception 'optional tools: %', app.mcp_optional_tools(a); end if;
  raise notice 'PASS 03-mcp-tools';
end $t$;
rollback;
