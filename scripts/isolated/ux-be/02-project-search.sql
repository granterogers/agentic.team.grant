-- Proof for 0921: one project search over every store. Local replica only; rolls back.
\set ON_ERROR_STOP on
begin;
set local application_name = 'PostgREST proof';
do $t$
declare
  a uuid := (select office_id from public.offices where kind = 'person' limit 1);
  b uuid := (select office_id from public.offices where kind = 'test' limit 1);
  pa uuid; pa2 uuid; pb uuid; fx uuid; ja uuid; jr uuid; jh uuid; cmd jsonb; n int; r record; k text;
begin
  insert into public.projects (office_id, slug, name) values (a, 'zz-s-a', 'Search A') returning project_id into pa;
  insert into public.projects (office_id, slug, name) values (a, 'zz-s-a2', 'Search A2') returning project_id into pa2;
  insert into public.projects (office_id, slug, name) values (b, 'zz-s-b', 'Search B') returning project_id into pb;
  insert into public.projects (office_id, slug, name) values (a, 'fixture-zz-s', 'Fixture') returning project_id into fx;
  -- one needle word per store, quasar-flavoured so nothing real collides
  perform app.task_add(a, pa, 'Chase the zyxqtask vendor', 'about zyxqtask', null, null, false, null, null);
  perform app.task_add(a, pa2, 'Other project zyxqtask', null, null, null, false, null, null);
  perform app.task_add(b, pb, 'Foreign zyxqtask', null, null, null, false, null, null);
  perform app.task_add(a, fx, 'Fixture zyxqtask', null, null, null, false, null, null);
  insert into public.documents (office_id, project_id, connector, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by)
    values (a, pa, 'browser', 'Saved page', 'webpage', 'a saved zyxqpage about widgets', repeat('1',64), 30, now(), 'office'),
           (a, pa, null, 'My note', 'note', 'my zyxqdoc note', repeat('2',64), 15, now(), 'you'),
           (b, pb, null, 'Foreign doc', 'note', 'foreign zyxqdoc', repeat('3',64), 15, now(), 'you');
  -- chat: a real turn, and a harness turn
  cmd := app.say_in_project(a, pa, 'please look at zyxqchat for me');
  set local application_name = 'psql harness';
  perform app.say_in_project(a, pa, 'harness zyxqchat');
  set local application_name = 'PostgREST proof';
  -- research answer
  insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority)
    values (a, gen_random_uuid(), pa, 'proof-' || gen_random_uuid(), 'browser.gather', 'mcp:none', 100) returning job_id into jr;
  insert into public.outputs (job_id, staff_id, body, confidence, evidence) values (jr, (select staff_id from public.staff limit 1), 'findings on zyxqresearch from the web', 'low', 'inferred');
  -- post-it
  insert into public.dashboard_layouts (owner, project_id, surface, panels)
    values (app.office_actor(a), pa, 'basecamp',
      jsonb_build_array(jsonb_build_object('id','tasks','x',1),
        jsonb_build_object('id','__workspace','v',2,'postits', jsonb_build_array(
          jsonb_build_object('id','n1','text','remember the zyxqnote thing'),
          jsonb_build_object('id','n2','text','unrelated')))));
  -- another owner's layout in the same office must not be read
  insert into public.dashboard_layouts (owner, project_id, surface, panels)
    values ('someone-else', pa2, 'basecamp', jsonb_build_array(jsonb_build_object('id','__workspace','postits', jsonb_build_array(jsonb_build_object('id','x','text','zyxqnote hidden')))));
  -- calendar: the REAL table from 0906, written as 0897 (0925 is what hides a tombstoned event)
  insert into public.project_events (office_id, project_id, title, notes, starts_at, ends_at, origin_channel, created_by)
    values (a, pa, 'Kickoff zyxqcal', 'room 4', now(), now() + interval '1 hour', 'teamhq', 'proof'),
           (b, pb, 'Foreign zyxqcal', null, now(), now() + interval '1 hour', 'teamhq', 'proof');
  insert into public.project_events (office_id, project_id, title, starts_at, ends_at, origin_channel, created_by, deleted_at)
    values (a, pa, 'Gone zyxqcal', now(), now() + interval '1 hour', 'teamhq', 'proof', now());

  -- positive: each needle finds exactly the right kind in project A
  for k, n in select * from (values ('zyxqtask',1),('zyxqpage',1),('zyxqdoc',1),('zyxqchat',1),('zyxqresearch',1),('zyxqnote',1),('zyxqcal',1)) v loop
    select count(*) into n from app.project_search(a, k, pa, 20, null);
    if n <> 1 then raise exception 'needle % expected 1 hit in project A, got %', k, n; end if;
  end loop;
  -- kinds
  if (select kind from app.project_search(a, 'zyxqpage', pa)) <> 'page' then raise exception 'saved page kind'; end if;
  if (select kind from app.project_search(a, 'zyxqchat', pa)) <> 'message' then raise exception 'chat kind'; end if;
  if (select kind from app.project_search(a, 'zyxqresearch', pa)) <> 'research' then raise exception 'research kind'; end if;
  if (select kind from app.project_search(a, 'zyxqnote', pa)) <> 'postit' then raise exception 'postit kind'; end if;
  if (select kind from app.project_search(a, 'zyxqcal', pa)) <> 'event' then raise exception 'event kind'; end if;
  if (select url_hint from app.project_search(a, 'zyxqtask', pa)) not like '/p/zz-s-a/tasks?focus=%' then raise exception 'url_hint'; end if;
  -- kinds filter
  if (select count(*) from app.project_search(a, 'zyxqtask or zyxqdoc', pa, 20, 'task')) <> 1 then raise exception 'kinds filter'; end if;
  -- unscoped (whole office A): two projects' tasks, still no foreign / fixture / harness / someone-else
  select count(*) into n from app.project_search(a, 'zyxqtask', null, 20, null);
  if n <> 2 then raise exception 'office-wide task hits expected 2 got %', n; end if;
  select count(*) into n from app.project_search(a, 'zyxqchat', null, 20, null);
  if n <> 1 then raise exception 'harness chat leaked or real chat lost: %', n; end if;
  select count(*) into n from app.project_search(a, 'zyxqnote', null, 20, null);
  if n <> 1 then raise exception 'another owner''s Post-it leaked: %', n; end if;
  -- negative controls: other office, other project, foreign project id
  if (select count(*) from app.project_search(a, 'zyxqdoc', null, 20, null)) <> 1 then raise exception 'doc: foreign office leaked'; end if;
  if (select count(*) from app.project_search(a, 'zyxqcal', null, 20, null)) <> 1 then raise exception 'event: foreign office leaked'; end if;
  if (select count(*) from app.project_search(a, 'zyxqtask', pb, 20, null)) <> 0 then raise exception 'foreign project id answered'; end if;
  if (select count(*) from app.project_search(b, 'zyxqtask', null, 20, null)) <> 1 then raise exception 'office B should see only its own'; end if;
  if (select count(*) from app.project_search(a, 'zyxqtask', pa2, 20, null)) <> 1 then raise exception 'project scoping'; end if;
  -- the empty / stopword query matches nothing and does not raise
  if (select count(*) from app.project_search(a, 'the and of', pa, 20, null)) <> 0 then raise exception 'stopword query'; end if;
  if (select count(*) from app.project_search(a, '   ', pa, 20, null)) <> 0 then raise exception 'blank query'; end if;
  -- controls: hidden rows exist
  if (select count(*) from public.tasks where title like '%zyxqtask%') <> 4 then raise exception 'control: tasks'; end if;
  if (select count(*) from public.inbound_commands where instruction like '%zyxqchat%') <> 2 then raise exception 'control: chat'; end if;
  -- no office, no answer
  begin perform * from app.project_search('00000000-0000-0000-0000-000000000000', 'zyxqtask', null); raise exception 'no_office should refuse'; exception when sqlstate '42501' then null; end;
  -- provider list tells the truth about calendar
  if not (app.project_search_providers(a) -> 5 ->> 'available')::boolean then raise exception 'events should be available here'; end if;
  raise notice 'PASS 02-project-search (real calendar table, tombstones hidden)';
end $t$;
rollback;

