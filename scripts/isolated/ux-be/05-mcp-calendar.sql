-- Proof for 0924: the MCP calendar tools call the REAL calendar (0906, written as 0897). Local replica only; everything rolls back.
--   psql -h /tmp/pgs -p 55432 -U postgres -d cand_mcp -v ON_ERROR_STOP=1 -f scripts/isolated/ux-be/05-mcp-calendar.sql
-- Needs 0906, 0920 and 0922 and 0924 applied.
\set ON_ERROR_STOP on
begin;
set local application_name = 'PostgREST proof';
do $t$
declare
  a uuid := (select office_id from public.offices where kind = 'person' limit 1);
  b uuid := (select office_id from public.offices where kind = 'test' limit 1);
  pa uuid; pb uuid; pf uuid; r jsonb; ev uuid; evc uuid; n int; l jsonb; row_ record;
  w text := 'zz-cal-gpt'; cl text := 'zz-cal-claude'; ot text := 'zz-cal-other'; ro text := 'zz-cal-ro'; fb text := 'zz-cal-b-gpt';
  t0 timestamptz := date_trunc('hour', now()) + interval '2 days';
begin
  insert into public.projects (office_id, slug, name) values (a, 'zz-cal-a', 'Cal A') returning project_id into pa;
  insert into public.projects (office_id, slug, name) values (b, 'zz-cal-b', 'Cal B') returning project_id into pb;
  -- a fixture project (is_fixture is generated from the slug): the harness's world
  insert into public.projects (office_id, slug, name) values (a, 'fixture-zz-cal', 'Cal fixture') returning project_id into pf;
  if not (select is_fixture from public.projects where project_id = pf) then raise exception 'control: a fixture- slug must be a fixture'; end if;
  insert into public.mcp_clients (office_id, client_id, display_name, token_sha256, scopes) values
    (a, w,  'ChatGPT',        repeat('1',64), array['read','write']),
    (a, cl, 'Claude Desktop', repeat('2',64), array['read','write']),
    (a, ot, 'Some Assistant', repeat('3',64), array['read','write']),
    (a, ro, 'ChatGPT ro',     repeat('4',64), array['read']),
    (b, fb, 'ChatGPT',        repeat('5',64), array['read','write']);

  -- ---- the optional tools are served because the real wrappers exist
  if app.mcp_optional_tools(a) <> '["list_events","create_event","update_event"]'::jsonb then raise exception 'optional: %', app.mcp_optional_tools(a); end if;

  -- ---- create through the real calendar, as ChatGPT
  r := app.mcp_event_create(a, w, 'zz-cal-a', 'Site visit', t0, t0 + interval '2 hours', false, 'Plot 4', 'bring the survey');
  if not coalesce((r ->> 'ok')::boolean, false) then raise exception 'create: %', r; end if;
  ev := (r ->> 'id')::uuid;
  select * into row_ from public.project_events where event_id = ev;
  if row_.origin_channel <> 'chatgpt' then raise exception 'origin_channel should be chatgpt, got %', row_.origin_channel; end if;
  if row_.authority <> 'agent' then raise exception 'an assistant write must carry authority agent (so sync asks the policy), got %', row_.authority; end if;
  if row_.created_by <> app.office_actor(a) then raise exception 'created_by: %', row_.created_by; end if;
  if row_.location <> 'Plot 4' or row_.notes <> 'bring the survey' or row_.ends_at <> t0 + interval '2 hours' then raise exception 'fields not stored: %', row_; end if;
  if row_.project_id <> pa then raise exception 'wrong project'; end if;

  -- it shows in hq_project_events (the page's own reader) with origin_channel chatgpt
  l := app.hq_project_events(a, 'zz-cal-a', (t0 - interval '1 day')::text, (t0 + interval '5 days')::text, 'project');
  if not exists (select 1 from jsonb_array_elements(l -> 'events') e where e ->> 'id' = ev::text and e ->> 'origin_channel' = 'chatgpt' and e ->> 'title' = 'Site visit') then
    raise exception 'event not in hq_project_events: %', l; end if;

  -- ... and in Activity, via ChatGPT, category calendar (project feed and office feed)
  if not exists (select 1 from jsonb_array_elements(app.studio_activity(pa, 20)) e where e ->> 'via' = 'ChatGPT' and e ->> 'category' = 'calendar') then
    raise exception 'project Activity should read via ChatGPT: %', app.studio_activity(pa, 20); end if;
  if not exists (select 1 from jsonb_array_elements(app.hq_studio_lately(a, 30) -> 'office') e where e ->> 'via' = 'ChatGPT' and e ->> 'category' = 'calendar') then
    raise exception 'office Activity should read via ChatGPT'; end if;
  if (select origin_channel from public.events where office_id = a and action_type = 'event.created' and project_id = pa order by occurred_at desc limit 1) is distinct from 'chatgpt' then
    raise exception 'events.origin_channel should be chatgpt'; end if;
  -- it is the assistant's door, not Team HQ's: no Activity row for this project claims Team HQ
  if exists (select 1 from jsonb_array_elements(app.studio_activity(pa, 20)) e where e ->> 'via' = 'Team HQ') then raise exception 'an assistant event claimed Team HQ'; end if;

  -- ---- Claude and an unnamed client carry their own words
  r := app.mcp_event_create(a, cl, 'zz-cal-a', 'Claude event', t0 + interval '1 day', null, true);
  evc := (r ->> 'id')::uuid;
  if (select origin_channel from public.project_events where event_id = evc) <> 'claude' then raise exception 'claude channel'; end if;
  if not (select all_day from public.project_events where event_id = evc) then raise exception 'all_day not passed'; end if;
  if not exists (select 1 from jsonb_array_elements(app.studio_activity(pa, 20)) e where e ->> 'via' = 'Claude' and e ->> 'category' = 'calendar') then raise exception 'activity via Claude'; end if;
  r := app.mcp_event_create(a, ot, 'zz-cal-a', 'Other event', t0 + interval '3 days');
  if (select origin_channel from public.project_events where event_id = (r ->> 'id')::uuid) <> 'external' then raise exception 'other client channel'; end if;
  if not exists (select 1 from jsonb_array_elements(app.studio_activity(pa, 20)) e where e ->> 'via' = 'External assistant') then raise exception 'activity via External assistant'; end if;

  -- ---- update through the real calendar: a patch, door recorded, authority agent
  r := app.mcp_event_update(a, w, ev::text, 'Site visit (moved)', t0 + interval '1 hour');
  if not coalesce((r ->> 'ok')::boolean, false) or (r ->> 'changed')::boolean is not true then raise exception 'update: %', r; end if;
  select * into row_ from public.project_events where event_id = ev;
  if row_.title <> 'Site visit (moved)' or row_.starts_at <> t0 + interval '1 hour' then raise exception 'patch not applied: %', row_; end if;
  if row_.location <> 'Plot 4' then raise exception 'a patch must leave other fields alone'; end if;
  if row_.ends_at <> t0 + interval '3 hours' then raise exception 'moving the start must keep the length (got %)', row_.ends_at; end if;
  if row_.origin_channel <> 'chatgpt' then raise exception 'update must not rewrite the origin'; end if;
  if not exists (select 1 from public.events where office_id = a and action_type = 'event.updated' and origin_channel = 'chatgpt') then raise exception 'update event door'; end if;
  r := app.mcp_event_update(a, w, ev::text, 'Site visit (moved)');
  if (r ->> 'changed')::boolean is not false then raise exception 'a no-op update should say changed false: %', r; end if;
  if not (app.mcp_event_update(a, w, ev::text) ? 'error') then raise exception 'empty update accepted'; end if;
  if not (app.mcp_event_update(a, w, 'g:primary:abc123') ? 'error') then raise exception 'a Google-only id was accepted'; end if;
  if not (app.mcp_event_update(a, w, 'not-a-uuid', 'x') ? 'error') then raise exception 'garbage id accepted'; end if;
  if not (app.mcp_event_update(a, w, gen_random_uuid()::text, 'x') ? 'error') then raise exception 'unknown event accepted'; end if;

  -- ---- list: project scope, all scope, limit, window
  r := app.mcp_event_list(a, 'zz-cal-a', t0 - interval '1 day', t0 + interval '10 days', 25);
  if jsonb_array_length(r -> 'events') <> 3 or r ->> 'scope' <> 'project' then raise exception 'project list: %', r; end if;
  r := app.mcp_event_list(a, 'zz-cal-a', t0 - interval '1 day', t0 + interval '10 days', 1);
  if jsonb_array_length(r -> 'events') <> 1 or (r ->> 'truncated')::boolean is not true or (r ->> 'total')::int <> 3 then raise exception 'limit: %', r; end if;
  r := app.mcp_event_list(a, null, t0 - interval '1 day', t0 + interval '10 days', 50);
  if r ->> 'scope' <> 'all' or jsonb_array_length(r -> 'events') < 3 then raise exception 'all scope: %', r; end if;
  r := app.mcp_event_list(a, 'zz-cal-a', t0 + interval '8 days', t0 + interval '9 days', 25);
  if jsonb_array_length(r -> 'events') <> 0 then raise exception 'window not honoured'; end if;
  if not (app.mcp_event_list(a, 'zz-cal-a', t0, t0 - interval '1 day') ? 'error') then raise exception 'inverted window accepted'; end if;
  r := app.mcp_event_list(a, 'zz-cal-a');   -- defaults: from now, 90 days
  if (r ->> 'ok')::boolean is not true then raise exception 'default window: %', r; end if;

  -- ---- refusals: read-only client; another office's client; another office's project / event; unknown project
  n := (select count(*) from public.project_events where office_id = a);
  if not (app.mcp_event_create(a, ro, 'zz-cal-a', 'x', t0) ? 'error') then raise exception 'read-only client created an event'; end if;
  if not (app.mcp_event_update(a, ro, ev::text, 'x') ? 'error') then raise exception 'read-only client updated an event'; end if;
  if not (app.mcp_event_create(a, fb, 'zz-cal-a', 'x', t0) ? 'error') then raise exception 'office B''s client created in office A'; end if;
  if not (app.mcp_event_update(a, fb, ev::text, 'x') ? 'error') then raise exception 'office B''s client updated office A''s event'; end if;
  if not (app.mcp_event_update(b, fb, ev::text, 'hijacked') ? 'error') then raise exception 'office B reached office A''s event by id'; end if;
  if not (app.mcp_event_create(b, w, 'zz-cal-b', 'x', t0) ? 'error') then raise exception 'A''s client wrote as office B'; end if;
  if not (app.mcp_event_create(a, w, 'zz-cal-b', 'x', t0) ? 'error') then raise exception 'wrote into another office''s project'; end if;
  if not (app.mcp_event_create(a, w, 'no-such', 'x', t0) ? 'error') then raise exception 'unknown project accepted'; end if;
  if not (app.mcp_event_create(a, w, 'zz-cal-a', '   ', t0) ? 'error') then raise exception 'blank title accepted'; end if;
  if not (app.mcp_event_create(a, w, 'zz-cal-a', 'x', null) ? 'error') then raise exception 'missing start accepted'; end if;
  if not (app.mcp_event_list(a, 'zz-cal-b') ? 'error') then raise exception 'list crossed offices'; end if;
  if (select title from public.project_events where event_id = ev) <> 'Site visit (moved)' then raise exception 'a refused update changed the event'; end if;
  if (select count(*) from public.project_events where office_id = a) <> n then raise exception 'a refused write left a row'; end if;
  -- office B's own feed never shows office A's events
  if app.mcp_event_list(b, null, t0 - interval '1 day', t0 + interval '10 days')::text like '%Site visit%' then raise exception 'office B lists office A''s events'; end if;

  -- ---- harness: a fixture project is refused to a write, absent from a list, and its events never reach the all scope
  if not (app.mcp_event_create(a, w, 'fixture-zz-cal', 'x', t0) ? 'error') then raise exception 'assistant wrote into a fixture project'; end if;
  if not (app.mcp_event_list(a, 'fixture-zz-cal') ? 'error') then raise exception 'assistant listed a fixture project'; end if;
  perform app.hq_event_add(a, 'fixture-zz-cal', 'Harness event', t0);   -- written the way a suite would
  if app.mcp_event_list(a, null, t0 - interval '1 day', t0 + interval '10 days', 100)::text like '%Harness event%' then raise exception 'a fixture event reached the all scope'; end if;
  select event_id into evc from public.project_events where project_id = pf;
  if not (app.mcp_event_update(a, w, evc::text, 'hijack') ? 'error') then raise exception 'assistant edited a fixture project''s event'; end if;
  -- an archived project is refused too
  update public.projects set status = 'archived' where project_id = pa;
  if not (app.mcp_event_create(a, w, 'zz-cal-a', 'x', t0) ? 'error') then raise exception 'assistant wrote into an archived project'; end if;
  if not (app.mcp_event_update(a, w, ev::text, 'x') ? 'error') then raise exception 'assistant edited an archived project''s event'; end if;
  update public.projects set status = 'active' where project_id = pa;

  -- ---- there is no delete, and no old overload survives
  if exists (select 1 from pg_proc where pronamespace in ('app'::regnamespace, 'public'::regnamespace) and proname ~ '^mcp_event_(delete|remove|call)') then raise exception 'an assistant event delete/dispatcher exists'; end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'mcp_event_create') <> 1 then raise exception 'duplicate overload of mcp_event_create'; end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'mcp_event_update') <> 1 then raise exception 'duplicate overload of mcp_event_update'; end if;
  raise notice 'PASS 05-mcp-calendar';
end $t$;
rollback;
