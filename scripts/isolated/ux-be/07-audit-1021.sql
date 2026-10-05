-- Proof for 1021: seven gaps the final audit found. Local replica only; rolls back.
-- Each check is driven both ways (the refusal AND the thing that must still work), because a suite made only of refusals
-- passes against a system that refuses everything.
\set ON_ERROR_STOP on
begin;
do $t$
declare
  a uuid := (select office_id from public.offices where kind = 'person' limit 1);
  b uuid := (select office_id from public.offices where kind = 'test' limit 1);
  pa uuid; pa2 uuid; r jsonb; n int; tid text; tid2 text; src uuid; appr uuid; draft uuid; other uuid; srcb uuid;
  w text := 'zz-1021-w'; ro text := 'zz-1021-ro';
begin
  insert into public.projects (office_id, slug, name) values (a, 'zz-1021-a', 'Audit A') returning project_id into pa;
  insert into public.projects (office_id, slug, name) values (a, 'zz-1021-a2', 'Audit A2') returning project_id into pa2;
  insert into public.mcp_clients (office_id, client_id, display_name, token_sha256, scopes) values
    (a, w, 'ChatGPT', repeat('7',64), array['read','write']),
    (a, ro, 'ChatGPT read-only', repeat('8',64), array['read']);

  -- 1. a source document cannot be moved out from under the gate; an uploaded one still can
  insert into public.project_attachments (project_id, connector, external_ref, display_name, role, enabled, disabled_reason)
    values (pa, 'drive', 'zz-folder', 'Folder', 'source', false, 'switched off for the proof');
  insert into public.documents (office_id, project_id, connector, external_parent_ref, external_ref, origin, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by)
    values (a, pa, 'drive', 'zz-folder', 'zz-file', 'source', 'Drive file zzaudit', 'doc', 'zzauditneedle held text', repeat('a',64), 23, now(), 'office')
    returning document_id into src;
  r := app.hq_document_move(a, src, pa2);
  if not (r ? 'error') or (select project_id from public.documents where document_id = src) <> pa then raise exception '1.1 a source document was moved: %', r; end if;
  insert into public.documents (office_id, project_id, connector, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by)
    values (a, pa, null, 'Uploaded zzaudit', 'note', 'zz', repeat('b',64), 2, now(), 'you') returning document_id into other;
  r := app.hq_document_move(a, other, pa2);
  if r ? 'error' or (select project_id from public.documents where document_id = other) <> pa2 then raise exception '1.2 control: an uploaded document should still move: %', r; end if;

  -- 4. MCP read_document hands out no text from a switched-off source; an ordinary document still reads
  r := app.mcp_document(a, src, 20000);
  if not (r ? 'error') or r::text like '%zzauditneedle%' then raise exception '4.1 text of a disconnected source was handed out: %', r; end if;
  r := app.mcp_document(a, other, 20000);
  if r ? 'error' or r ->> 'content' <> 'zz' then raise exception '4.2 control: an ordinary document should read: %', r; end if;
  update public.project_attachments set enabled = true, disabled_reason = null where project_id = pa and external_ref = 'zz-folder';
  r := app.mcp_document(a, src, 20000);
  if r ? 'error' or r ->> 'content' not like '%zzauditneedle%' then raise exception '4.3 reconnecting should make it readable again: %', r; end if;

  -- 3. superseding needs an approved replacement in the same project
  insert into public.documents (office_id, project_id, connector, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by, state)
    values (a, pa, null, 'Report zzaudit', 'note', 'old', repeat('c',64), 3, now(), 'you', 'approved') returning document_id into appr;
  insert into public.documents (office_id, project_id, connector, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by, state)
    values (a, pa, null, 'Report zzaudit draft', 'note', 'new', repeat('d',64), 3, now(), 'office', 'draft') returning document_id into draft;
  r := app.hq_document_supersede(a, appr, draft);
  if not (r ? 'error') or (select state from public.documents where document_id = appr) <> 'approved' then raise exception '3.1 a draft superseded an approved document: %', r; end if;
  update public.documents set state = 'approved' where document_id = draft;
  r := app.hq_document_supersede(a, appr, draft);
  if r ? 'error' or (select state from public.documents where document_id = appr) <> 'archived' then raise exception '3.2 control: an approved replacement should supersede: %', r; end if;
  r := app.hq_document_supersede(a, draft, other);  -- other is in another project
  if not (r ? 'error') then raise exception '3.3 a replacement from another project was accepted'; end if;

  -- 5. an update is one unit, and a cancelled task stays cancelled
  r := app.mcp_task_add(a, w, 'zz-1021-a', 'Atomic task');
  tid := r ->> 'id';
  r := app.mcp_task_update(a, w, tid, 'blocked', 'Renamed but refused', null, null, null);
  if not (r ? 'error') then raise exception '5.1 blocked without a reason was accepted: %', r; end if;
  if (select title from public.tasks where task_id = tid::uuid) <> 'Atomic task' then raise exception '5.2 a refused update left the title changed'; end if;
  r := app.mcp_task_update(a, w, tid, 'blocked', 'Renamed and blocked', null, null, 'waiting');
  if r ? 'error' or (select title from public.tasks where task_id = tid::uuid) <> 'Renamed and blocked' then raise exception '5.3 control: a valid combined update should apply: %', r; end if;
  r := app.mcp_task_add(a, w, 'zz-1021-a', 'Owner cancels this');
  tid2 := r ->> 'id';
  update public.tasks set state = 'cancelled' where task_id = tid2::uuid;
  r := app.mcp_task_update(a, w, tid2, 'todo');
  if not (r ? 'error') or (select state from public.tasks where task_id = tid2::uuid) <> 'cancelled' then raise exception '5.4 an assistant reopened a cancelled task: %', r; end if;

  -- 6. a kinds filter finds what ranks below ten documents
  insert into public.documents (office_id, project_id, connector, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by)
    select a, pa, null, 'Filler ' || g, 'note', 'zzkinds filler ' || g || ' zzkinds zzkinds', md5(g::text) || md5(g::text), 20, now(), 'you' from generate_series(1, 14) g;
  insert into public.documents (office_id, project_id, connector, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by)
    values (a, pa, 'browser', 'Saved page zzkinds', 'webpage', 'zzkinds once', repeat('e',64), 12, now(), 'office');
  select count(*) into n from app.project_search(a, 'zzkinds', pa, 10, 'page');
  if n < 1 then raise exception '6.1 kinds=page found nothing although a page matches'; end if;
  select count(*) into n from app.project_search(a, 'zzkinds', pa, 10, null);
  if n <> 10 then raise exception '6.2 control: an unfiltered search should still return the limit (%)', n; end if;

  -- 7. the database itself checks the write scope
  r := app.mcp_add_document(a, ro, 'zz-1021-a', 'x', 'y');
  if not (r ? 'error') then raise exception '7.1 a read-only client added a document: %', r; end if;
  r := app.mcp_add_document(a, w, 'zz-1021-a', 'Written by a writer', 'body');
  if r ? 'error' then raise exception '7.2 control: a write client should add: %', r; end if;
  r := app.mcp_enqueue(a, ro, 'zz-1021-a', 'notebook.generate', '{}');
  if not (r ? 'error') then raise exception '7.3 a read-only client enqueued a generate: %', r; end if;
  r := app.mcp_enqueue(a, ro, 'zz-1021-a', 'notebook.ask', '{}');
  if r ? 'error' then raise exception '7.4 control: asking the notebook is a read: %', r; end if;

  -- 8. an assistant's 'start research' produces the words the instruction handler turns into a web lookup
  r := app.mcp_start_research(a, w, 'zz-1021-a', 'churn benchmarks for SaaS');
  if r ? 'error' or (r ->> 'status') in ('refused', 'needs_approval') then raise exception '8.1 start_research did not start: %', r; end if;
  if not exists (select 1 from public.inbound_commands where office_id = a and instruction like '%on the web%churn benchmarks%') then
    raise exception '8.2 the research instruction does not say on the web'; end if;
  r := app.mcp_start_research(a, ro, 'zz-1021-a', 'x');
  if not (r ? 'error') then raise exception '8.3 a read-only client started research'; end if;

  -- the duties that must ship off
  if exists (select 1 from public.responsibilities where slug in ('drive-index', 'calendar-event-sync') and enabled) then
    raise exception '8 a duty that ships switched off is on'; end if;
  raise exception 'PROOF_OK' using errcode = 'P0001';
end $t$;
rollback;
