-- Proof for 0930: provenance for web sources, the reader, safe-file refusals, the acting-verb CHECK and the approval
-- boundary. Local replica only; rolls back. Run: psql -h /tmp/pgs -p 55432 -U postgres -d cand_web -v ON_ERROR_STOP=1 -f <this>
\set ON_ERROR_STOP on
begin;
set local application_name = 'PostgREST proof';
do $t$
declare
  a uuid := (select office_id from public.offices where kind = 'person' limit 1);
  b uuid := (select office_id from public.offices where kind = 'test' limit 1);
  pa uuid; pa2 uuid; pb uuid; fx uuid;
  jr uuid; jc uuid; jh uuid; jo uuid; joh uuid;
  d1 uuid; d2 uuid; d3 uuid; dh uuid; df uuid; dfx uuid; dfile uuid; db_ uuid;
  r jsonb; pg jsonb; one jsonb; msg text; n int; k text;
begin
  insert into public.projects (office_id, slug, name) values (a, 'zz-ws-a', 'Web A') returning project_id into pa;
  insert into public.projects (office_id, slug, name) values (a, 'zz-ws-a2', 'Web A2') returning project_id into pa2;
  insert into public.projects (office_id, slug, name) values (b, 'zz-ws-b', 'Web B') returning project_id into pb;
  insert into public.projects (office_id, slug, name) values (a, 'fixture-zz-ws', 'Fixture') returning project_id into fx;

  -- a real research job (production-shaped requester) and a child that actually fetched; a harness job beside them
  insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config, recipient_agent)
    values (a, gen_random_uuid(), pa, 'proof-' || gen_random_uuid(), 'web.research', 'telegram:424242', 100,
            jsonb_build_object('question', 'what do widgets cost for small shops', 'by', 'chief-of-staff'), 'chief-of-staff')
    returning job_id into jr;
  insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config, parent_job_id)
    values (a, gen_random_uuid(), pa, 'proof-' || gen_random_uuid(), 'browser.gather', 'telegram:424242', 100,
            jsonb_build_object('url', 'https://x.example/child', 'by', 'finance-director'), jr)
    returning job_id into jc;
  insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
    values (a, gen_random_uuid(), pa, 'proof-' || gen_random_uuid(), 'web.research', 'verify:ws-' || gen_random_uuid(), 100,
            jsonb_build_object('question', 'harness question'))
    returning job_id into jh;

  -- pages: found by search (the research job), reached by link (the child), a harness page, a foreign office's page,
  -- a page in a fixture project, and one in the other project of the same office
  d1 := (app.record_browser_page(a, pa, 'https://x.example/widgets', 'Widget prices', 'Widgets cost forty pounds a month for small shops, billed annually.', jr) ->> 'document_id')::uuid;
  d2 := (app.record_browser_page(a, pa, 'https://x.example/widgets/small', 'Small shop plan', 'The small shop plan is the cheapest widget plan we sell today and tomorrow.', jc) ->> 'document_id')::uuid;
  dh := (app.record_browser_page(a, pa, 'https://harness.example/h', 'Harness page', 'harness words that must never be listed to anybody at all', jh) ->> 'document_id')::uuid;
  db_ := (app.record_browser_page(b, pb, 'https://x.example/widgets', 'Foreign page', 'foreign words that belong to another office entirely and nobody else', null) ->> 'document_id')::uuid;
  dfx := (app.record_browser_page(a, fx, 'https://fixture.example/f', 'Fixture page', 'fixture project words that are a suites own traffic only here', null) ->> 'document_id')::uuid;
  d3 := (app.record_browser_page(a, pa2, 'https://x.example/other', 'Other project page', 'a page filed under another project of the same office entirely', jr) ->> 'document_id')::uuid;

  -- how they were reached, on the ledger rows that recorded the reads; and a screenshot of the first
  perform app.browser_note_via(a, null, jr, 'read', 'https://x.example/widgets', true, 'http 200', null, 120,
                               jsonb_build_object('how', 'search', 'query', 'widget prices', 'rank', 2));
  perform app.browser_note_via(a, null, jc, 'read', 'https://x.example/widgets/small', true, 'http 200', null, 90,
                               jsonb_build_object('how', 'link', 'from', 'https://x.example/widgets', 'depth', 1));
  perform app.browser_note_via(a, null, jr, 'shot', 'https://x.example/widgets', true, 'photographed', 'pa/browser/shot.png', 500, null);
  -- the nine-argument writer still works, delegates, and records no found_via
  perform app.browser_note(a, null, jr, 'read', 'https://x.example/legacy', true, 'http 200', null, 10);
  if (select found_via from public.browser_actions where url = 'https://x.example/legacy') is not null then
    raise exception 'browser_note must record no found_via'; end if;

  -- a downloaded file: allowed
  dfile := (app.record_web_file(a, pa, 'https://x.example/files/pricing.pdf', 'Pricing sheet', 'pa/browser/j-0.pdf', 'application/pdf', 4096, jr) ->> 'document_id')::uuid;
  if dfile is null then raise exception 'an allowed pdf was refused'; end if;
  -- ... and the refusals, each asserted on its REASON
  for k, msg in select * from (values
      ('text/html', 'not a type the office keeps'), ('image/svg+xml', 'not a type the office keeps'),
      ('application/zip', 'not a type the office keeps'), ('application/x-msdownload', 'not a type the office keeps'),
      ('application/vnd.ms-excel.sheet.macroEnabled.12', 'not a type the office keeps'), ('', 'unknown type')) v(k, msg) loop
    r := app.record_web_file(a, pa, 'https://x.example/files/' || md5(k), 'File ' || k, 'pa/browser/' || md5(k), k, 100, jr);
    if coalesce(r ->> 'error', '') not like '%' || msg || '%' then raise exception 'type % expected refusal containing %, got %', k, msg, r; end if;
  end loop;
  r := app.record_web_file(a, pa, 'https://x.example/files/big.pdf', 'Big', 'pa/browser/big', 'application/pdf', 10485761, jr);
  if coalesce(r ->> 'error', '') not like '%10 MB cap%' then raise exception 'cap not enforced: %', r; end if;
  r := app.record_web_file(a, pa, 'https://x.example/files/zero.pdf', 'Zero', 'pa/browser/zero', 'application/pdf', 0, jr);
  if coalesce(r ->> 'error', '') not like '%empty%' then raise exception 'empty not refused: %', r; end if;
  -- control: exactly the cap is fine
  r := app.record_web_file(a, pa, 'https://x.example/files/edge.pdf', 'Edge', 'pa/browser/edge', 'application/pdf', 10485760, jr);
  if r ->> 'ok' is distinct from 'true' then raise exception 'a file at the cap was refused: %', r; end if;
  -- a project that is another office's is refused, the same as a missing one
  r := app.record_web_file(a, pb, 'https://x.example/f.pdf', 'Cross', 'x/y', 'application/pdf', 10, jr);
  if r ->> 'error' is null then raise exception 'a foreign project was accepted'; end if;

  -- evidence: an output of a real job cites d1 (and the research job's own output cites both); a harness output cites d1 too
  insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority)
    values (a, gen_random_uuid(), pa, 'proof-' || gen_random_uuid(), 'artifact.report', 'telegram:424242', 100) returning job_id into jo;
  insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority)
    values (a, gen_random_uuid(), pa, 'proof-' || gen_random_uuid(), 'artifact.report', 'verify:ws-' || gen_random_uuid(), 100) returning job_id into joh;
  insert into public.outputs (job_id, staff_id, body, confidence, evidence, sources)
    values (jo, (select staff_id from public.staff limit 1), 'a report using the web', 'medium', 'inferred',
            jsonb_build_array('job:' || jo::text, 'browser:' || d1::text || ' Widget prices (https://x.example/widgets)'));
  insert into public.outputs (job_id, staff_id, body, confidence, evidence, sources)
    values (joh, (select staff_id from public.staff limit 1), 'harness report', 'medium', 'inferred',
            jsonb_build_array('browser:' || d1::text || ' Widget prices'));

  -- ---- the reader --------------------------------------------------------------------------------------------------
  r := app.hq_project_sources_web(a, 'zz-ws-a');
  pg := r -> 'pages';
  if (r ->> 'count')::int <> 4 then raise exception 'expected 4 pages in zz-ws-a (2 pages, the pdf and the edge pdf), got % : %', r ->> 'count', pg; end if;
  select x into one from jsonb_array_elements(pg) x where x ->> 'document_id' = d1::text;
  if one ->> 'url' <> 'https://x.example/widgets' or one ->> 'title' <> 'Widget prices' or one ->> 'kind' <> 'page' then raise exception 'page fields: %', one; end if;
  if one -> 'retrieved_at' is null or one #>> '{project,slug}' <> 'zz-ws-a' then raise exception 'retrieved_at/project: %', one; end if;
  if one #>> '{agent,slug}' <> 'chief-of-staff' or one ->> 'job_id' <> jr::text then raise exception 'agent/job: %', one; end if;
  if one #>> '{research_task,job_id}' <> jr::text or one #>> '{research_task,label}' <> 'what do widgets cost for small shops' then raise exception 'research_task: %', one; end if;
  if one #>> '{found_via,how}' <> 'search' or (one #>> '{found_via,rank}')::int <> 2 then raise exception 'found_via: %', one; end if;
  if (one ->> 'indexed')::boolean is not true or (one ->> 'has_excerpt')::boolean is not true or one ->> 'excerpt' not like 'Widgets cost%' then raise exception 'indexed/excerpt: %', one; end if;
  if (one #>> '{screenshot,available}')::boolean is not true or one #>> '{screenshot,path}' <> 'pa/browser/shot.png' then raise exception 'screenshot: %', one; end if;
  if (one #>> '{citations,count}')::int <> 1 then raise exception 'citation count must be 1 (the real report; the harness output is excluded): %', one; end if;
  if one #>> '{citations,evidence,0,job_id}' <> jo::text then raise exception 'evidence link: %', one; end if;
  -- the page reached by a link: attributed to the child's agent, its research task is the PARENT, how it was reached is recorded
  select x into one from jsonb_array_elements(pg) x where x ->> 'document_id' = d2::text;
  if one #>> '{agent,slug}' <> 'finance-director' then raise exception 'child agent: %', one; end if;
  if one #>> '{research_task,job_id}' <> jr::text then raise exception 'child research task must be the parent: %', one; end if;
  if one #>> '{found_via,how}' <> 'link' or one #>> '{found_via,from}' <> 'https://x.example/widgets' or (one #>> '{found_via,depth}')::int <> 1 then raise exception 'link found_via: %', one; end if;
  if (one #>> '{screenshot,available}')::boolean is not false or (one #>> '{citations,count}')::int <> 0 then raise exception 'uncited, unshot page: %', one; end if;
  -- the file
  select x into one from jsonb_array_elements(pg) x where x ->> 'document_id' = dfile::text;
  if one ->> 'kind' <> 'file' or one #>> '{file,mime_type}' <> 'application/pdf' or (one ->> 'indexed')::boolean is not false then raise exception 'file row: %', one; end if;
  -- isolation: other project, foreign office, harness, fixture
  if exists (select 1 from jsonb_array_elements(pg) x where x ->> 'document_id' in (d3::text, db_::text, dh::text, dfx::text)) then
    raise exception 'a page from another project, another office, a harness job or a fixture project was listed'; end if;
  r := app.hq_project_sources_web(a, 'zz-ws-a2');
  if (r ->> 'count')::int <> 1 or r #>> '{pages,0,document_id}' <> d3::text then raise exception 'zz-ws-a2 should list only its own page: %', r; end if;
  r := app.hq_project_sources_web(b, 'zz-ws-a');
  if r ->> 'error' is null or r ->> 'error' not like 'no project called%' then raise exception 'another office must not read zz-ws-a: %', r; end if;
  r := app.hq_project_sources_web(a, 'zz-ws-b');
  if r ->> 'error' is null then raise exception 'office a must not read office b project: %', r; end if;
  r := app.hq_project_sources_web(b, 'zz-ws-b');
  if (r ->> 'count')::int <> 1 or r #>> '{pages,0,document_id}' <> db_::text then raise exception 'office b sees its own page: %', r; end if;
  -- a fixture project lists nothing: harness traffic is not shown
  r := app.hq_project_sources_web(a, 'fixture-zz-ws');
  if (r ->> 'count')::int <> 0 then raise exception 'a fixture project listed pages: %', r; end if;
  -- limit, and a bad one refused by name
  r := app.hq_project_sources_web(a, 'zz-ws-a', '2');
  if (r ->> 'count')::int <> 2 then raise exception 'limit 2: %', r ->> 'count'; end if;
  r := app.hq_project_sources_web(a, 'zz-ws-a', 'lots');
  if r ->> 'error' not like '%whole number%' then raise exception 'bad limit: %', r; end if;
  -- the public wrapper is the same answer
  if public.hq_project_sources_web(a, 'zz-ws-a', '2') <> app.hq_project_sources_web(a, 'zz-ws-a', '2') then raise exception 'wrapper differs'; end if;
  -- a control that must come back positive: the reader is capable of listing the harness page when it is not harness
  if app.harness_browsing(jh, pa) is not true then raise exception 'control: the harness job must read as harness'; end if;
  if app.harness_browsing(jr, pa) is not false then raise exception 'control: the real job must NOT read as harness'; end if;

  -- ---- the ledger refuses an acting word, whatever the caller -------------------------------------------------------
  foreach k in array array['click', 'type', 'submit', 'post', 'send', 'publish', 'purchase', 'book', 'upload', 'press'] loop
    begin
      insert into public.browser_actions (office_id, job_id, project_id, verb, url, ok) values (a, jr, pa, k, 'https://x.example/', true);
      raise exception 'THE LEDGER ACCEPTED THE ACTING VERB %', k;
    exception when check_violation then
      get stacked diagnostics msg = constraint_name;
      if msg <> 'browser_actions_verb_check' then raise exception 'verb % refused for the wrong reason: %', k, msg; end if;
    end;
  end loop;
  -- found_via must be an object
  begin
    insert into public.browser_actions (office_id, job_id, project_id, verb, url, ok, found_via) values (a, jr, pa, 'read', 'https://x.example/', true, '[1]'::jsonb);
    raise exception 'a non-object found_via was accepted';
  exception when check_violation then null; end;

  -- ---- the registry tells the truth (0298) ---------------------------------------------------------------------------
  if not exists (select 1 from public.tool_permissions where tool = 'web.search' and enabled and delivered_by like '%web.research%') then
    raise exception 'web.search must be enabled and delivered_by web.research'; end if;
  if not exists (select 1 from public.tool_permissions where tool = 'web.read' and enabled and delivered_by like '%browser.gather%' and delivered_by like '%web.research%') then
    raise exception 'web.read delivered_by'; end if;

  -- ---- the approval architecture: reading proceeds, every consequential thing does not -----------------------------------
  foreach k in array array['web.search', 'web.read'] loop
    if app.authorize_effect(p_office => a, p_project => pa, p_tool => k) ->> 'verdict' <> 'proceed' then
      raise exception 'reading tool % must proceed without a question', k; end if;
  end loop;
  foreach k in array array['slack.post', 'gmail.send', 'spend.money', 'github.write', 'db.delete', 'form.submit', 'booking.make', 'upload.external', 'web.submit'] loop
    r := app.authorize_effect(p_office => a, p_project => pa, p_tool => k);
    if r ->> 'verdict' = 'proceed' then raise exception 'CONSEQUENTIAL TOOL % PROCEEDED WITHOUT ASKING: %', k, r; end if;
  end loop;
  -- ... and at the most permissive dial too: a level-3 action can never become proceed
  raise exception 'PROOF_OK_ROLLBACK';
exception when others then
  if sqlerrm <> 'PROOF_OK_ROLLBACK' then raise; end if;
end
$t$;
rollback;
\echo 05-web-sources: all checks passed (rolled back)
