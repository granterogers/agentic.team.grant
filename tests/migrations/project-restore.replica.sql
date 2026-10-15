-- Round-trip and negative proofs for migration 1071 (app.project_restore). Local schema replica only; the whole file
-- rolls back. Run it with:
--   psql -h /tmp/pgs -p 55432 -U postgres -d post -X -v ON_ERROR_STOP=1 -f tests/migrations/project-restore.replica.sql
-- It proves: an export restores into a new project with the same records and content; a repeat of the same key writes
-- nothing; another office gets its own copy and never sees this one; malformed packages are refused without a trace;
-- and a failure in the middle leaves no project and no key behind.

begin;

insert into auth.users (id) values ('c2000000-0000-4000-8000-00000000000a'), ('c2000000-0000-4000-8000-00000000000b');
insert into public.offices (name, kind, auth_user_id)
  values ('c2-restore-office-a', 'person', 'c2000000-0000-4000-8000-00000000000a'),
         ('c2-restore-office-b', 'person', 'c2000000-0000-4000-8000-00000000000b');

create temp table c2 as
  select (select office_id from public.offices where name = 'c2-restore-office-a') as a,
         (select office_id from public.offices where name = 'c2-restore-office-b') as b;

-- An active project in office A with a brief, a collection, two documents, tasks and a contact with a label.
insert into public.projects (slug, name, office_id)
  select 'c2-source-project', 'C2 Source Project', a from c2;
insert into public.project_attachments (project_id, connector, external_ref, display_name, role)
  select project_id, 'upload', 'c2-fixture', 'fixture', 'source' from public.projects where slug = 'c2-source-project';
insert into public.project_briefs (project_id, body, sources_used, source_fingerprints, model, confidence)
  select project_id,
         'A brief long enough to pass the floor, written about the source project for the restore proof.',
         0, '{}', 'fixture', 'inferred'
    from public.projects where slug = 'c2-source-project';
insert into public.collections (project_id, name, position)
  select project_id, 'Budget', 1 from public.projects where slug = 'c2-source-project';
insert into public.documents (project_id, office_id, title, doc_type, content, content_fingerprint, content_chars,
                              fetched_at, origin, state, tags, source_title)
  select p.project_id, c.a, 'Budget 2026', 'pdf', 'Line one.' || E'\n' || 'Totals: 40 and 14, quote "£63.50".',
         encode(sha256(convert_to('Line one.' || E'\n' || 'Totals: 40 and 14, quote "£63.50".', 'UTF8')), 'hex'),
         44, app.now_utc(), 'yours', 'approved', array['finance','q4'], 'Drive'
    from public.projects p, c2 c where p.slug = 'c2-source-project';
insert into public.documents (project_id, office_id, title, origin, state)
  select p.project_id, c.a, 'Scanned without text', 'yours', 'approved'
    from public.projects p, c2 c where p.slug = 'c2-source-project';
insert into public.document_collections (document_id, collection_id)
  select d.document_id, col.collection_id
    from public.documents d, public.collections col
   where d.title = 'Budget 2026' and col.name = 'Budget';
insert into public.tasks (project_id, office_id, title, detail, state, blocked_on, due_on, assigned_to_human)
  select p.project_id, c.a, 'Confirm the deposit', 'call first', 'todo', '', date '2026-10-20', true
    from public.projects p, c2 c where p.slug = 'c2-source-project';
insert into public.tasks (project_id, office_id, title, state, blocked_on)
  select p.project_id, c.a, 'Wait for the quote', 'blocked', 'the supplier has not replied'
    from public.projects p, c2 c where p.slug = 'c2-source-project';
insert into public.contacts (project_id, name, email, note)
  select p.project_id, 'Priya Shah', 'priya@example.test', 'met at expo'
    from public.projects p where p.slug = 'c2-source-project';
insert into public.contact_labels (office_id, owner, name)
  select a, 'grant', 'supplier' from c2;
insert into public.contact_label_links (contact_id, label_id)
  select ct.contact_id, l.label_id from public.contacts ct, public.contact_labels l
   where ct.name = 'Priya Shah' and l.name = 'supplier';

create temp table pkg as
  select app.project_export((select a from c2), (select project_id from public.projects where slug = 'c2-source-project')) as p;

create temp table key1 as select repeat('a', 64) as k;
create temp table key2 as select repeat('b', 64) as k;

create temp table res1 as
  select app.project_restore((select a from c2), (select k from key1), (select p from pkg), 'grant') as r;

create temp table res2 as
  select app.project_restore((select a from c2), (select k from key1), (select p from pkg), 'grant') as r;

create temp table res3 as
  select app.project_restore((select b from c2), (select k from key1), (select p from pkg), 'grant') as r;

create temp table res4 as
  select app.project_restore((select a from c2), (select k from key2), (select p from pkg), 'grant') as r;

-- Each restored project's id, by key, and what each holds.
create temp table restored as
  select (select (r->>'project_id')::uuid from res1) as first_id,
         (select (r->>'project_id')::uuid from res2) as again_id,
         (select (r->>'project_id')::uuid from res3) as other_office_id,
         (select (r->>'project_id')::uuid from res4) as second_restore_id;

do $proof$
declare
  v_a uuid := (select a from c2);
  v_b uuid := (select b from c2);
  v_first uuid := (select first_id from restored);
  v_again uuid := (select again_id from restored);
  v_other uuid := (select other_office_id from restored);
  v_second uuid := (select second_restore_id from restored);
  v_report jsonb := (select r->'report' from res1);
  v_docs int; v_tasks int; v_contacts int; v_colls int; v_links int; v_labels int;
  v_source_docs int; v_src_budget text; v_restored_budget text;
  v_refused text; v_before int; v_after int;
  v_failed boolean := false;
begin
  -- 1. The first restore writes one new project, slugged apart from the source, and says so.
  assert (select r->>'ok' from res1) = 'true', 'first restore must succeed';
  assert (select (r->>'already')::boolean from res1) = false, 'first restore is not a replay';
  assert (select slug from public.projects where project_id = v_first) = 'c2-source-project-restored',
    'a slug held by a live project must not be reused';
  assert (v_report->>'renamed')::boolean = true, 'the report must say the name was changed';
  assert (v_report->'counts'->'documents'->>'restored')::int = 2, 'two documents restored';
  assert (v_report->'counts'->'documents'->>'without_text')::int = 1, 'one document without text is counted';
  assert (v_report->'counts'->>'brief') = 'restored', 'the brief is kept';
  assert (v_report->'not_restored'->>'task_assignees')::int = 0, 'no assignee names in this fixture';
  raise notice 'C2 PROOF 1: first restore writes a new renamed project and reports it';

  -- 2. Content and identity survive: same titles, text, tags and fingerprints as the source.
  select count(*) into v_docs from public.documents where project_id = v_first;
  assert v_docs = 2, 'the restored project holds the two documents';
  select d.content_fingerprint into v_restored_budget from public.documents d
   where d.project_id = v_first and d.title = 'Budget 2026';
  -- Slugs are unique per office, not globally: office B's restore may legitimately hold the same slug.
  select d.content_fingerprint into v_src_budget from public.documents d
   where d.title = 'Budget 2026'
     and d.project_id = (select project_id from public.projects where slug = 'c2-source-project' and office_id = v_a);
  assert v_restored_budget = v_src_budget, 'a restored document keeps its fingerprint, computed from the same text';
  assert v_restored_budget = encode(sha256(convert_to('Line one.' || E'\n' || 'Totals: 40 and 14, quote "£63.50".', 'UTF8')), 'hex'),
    'the fingerprint is the sha256 of the UTF-8 text';
  assert exists (select 1 from public.documents d where d.project_id = v_first and d.title = 'Budget 2026'
                  and d.tags @> array['finance','q4'] and d.content like '%£63.50%'),
    'tags and the non-ASCII text survive the round trip';
  assert exists (select 1 from public.documents d where d.project_id = v_first and d.title = 'Scanned without text'
                  and d.content is null and d.content_fingerprint is null and d.fetched_at is null),
    'a document with no text stays without text, with no half-set fingerprint';
  assert (select count(*) from public.document_collections dc
            join public.documents d using (document_id)
            join public.collections c using (collection_id)
           where d.project_id = v_first and c.name = 'Budget') = 1,
    'collection membership is restored';

  select count(*) into v_tasks from public.tasks where project_id = v_first;
  assert v_tasks = 2, 'two tasks restored';
  assert exists (select 1 from public.tasks where project_id = v_first and state = 'blocked'
                  and blocked_on = 'the supplier has not replied'), 'a blocked task keeps its reason';
  assert exists (select 1 from public.tasks where project_id = v_first and title = 'Confirm the deposit'
                  and due_on = date '2026-10-20' and assigned_to_human), 'a task keeps its due date and who it is for';

  select count(*) into v_contacts from public.contacts where project_id = v_first;
  assert v_contacts = 1, 'one contact restored';
  select count(*) into v_labels from public.contact_labels l where l.office_id = v_a and l.name = 'supplier';
  select count(*) into v_links from public.contact_label_links cl
    join public.contacts ct using (contact_id) where ct.project_id = v_first;
  assert v_links = 1, 'a contact keeps its label';
  raise notice 'C2 PROOF 2: content, fingerprints, tags, collections, tasks, contacts and labels round-trip';

  -- 3. Idempotency: the same key returns the first result and writes nothing.
  assert v_again = v_first, 'a repeat of the same key returns the same project';
  assert (select (r->>'already')::boolean from res2) = true, 'a repeat says it is a replay';
  select count(*) into v_before from public.projects where office_id = v_a;
  assert v_before = 3, 'the replay created no project (source, restored, and the seeded one)';
  assert (select count(*) from public.documents where project_id = v_first) = 2, 'the replay wrote no documents';
  raise notice 'C2 PROOF 3: a repeat with the same key writes nothing';

  -- 4. Another office gets its own copy, and this office is untouched by it.
  assert (select office_id from public.projects where project_id = v_other) = v_b,
    'a restore into office B lands in office B';
  assert not exists (select 1 from public.projects where project_id = v_other and office_id = v_a),
    'nothing from the other office lands in this one';
  assert (select count(*) from public.documents where project_id = v_first and office_id = v_b) = 0,
    'office B holds none of office A''s documents';
  raise notice 'C2 PROOF 4: restores are isolated by office';

  -- 5. A second archive (different key) is a second project, never a merge into the first.
  assert v_second <> v_first, 'a different archive is a different project';
  assert (select slug from public.projects where project_id = v_second) = 'c2-source-project-restored-2',
    'the second restore takes the next free slug';
  assert (select count(*) from public.documents where project_id = v_first) = 2, 'the first restore is not touched';
  raise notice 'C2 PROOF 5: a second restore never merges into the first';

  -- 6. Negative cases: each refused with a sentence, and nothing written.
  select count(*) into v_before from public.project_restores;
  assert (select app.project_restore((select a from c2), 'not-a-key', (select p from pkg), 'grant')->>'ok') = 'false',
    'a key that is not a sha256 is refused';
  assert (select app.project_restore((select a from c2), repeat('c', 64), '{"format":"x"}'::jsonb, 'grant')->>'error')
    = 'the archive is not an Agentic Team project package', 'a foreign format is refused by name';
  assert (select app.project_restore((select a from c2), repeat('d', 64),
            jsonb_set((select p from pkg), '{format_version}', '2'::jsonb), 'grant')->>'error') like '%not supported%',
    'an unknown version is refused by name';
  assert (select app.project_restore((select a from c2), repeat('e', 64),
            jsonb_set((select p from pkg), '{project,name}', '""'::jsonb), 'grant')->>'error') = 'the package has no project name',
    'a missing name is refused';
  assert (select app.project_restore((select a from c2), repeat('f', 64),
            jsonb_set((select p from pkg), '{documents}', '"oops"'::jsonb), 'grant')->>'error') like '%is not a list%',
    'a documents field that is not a list is refused';
  assert (select app.project_restore((select a from c2), repeat('0', 64),
            jsonb_set((select p from pkg), '{documents,0,text}', to_jsonb(repeat('x', 2000001))), 'grant')->>'error')
    like '%2,000,000%', 'an oversize document is refused';
  select count(*) into v_after from public.project_restores;
  assert v_after = v_before, 'refused packages leave no idempotency row behind';
  raise notice 'C2 PROOF 6: malformed packages are refused by name and leave no trace';

  -- 7. A failure in the middle rolls everything back, including the key and the project.
  select count(*) into v_before from public.projects where office_id = v_a;
  begin
    perform app.project_restore((select a from c2), repeat('9', 64),
      jsonb_set((select p from pkg), '{tasks,0,due}', '"not-a-date"'::jsonb), 'grant');
  exception when invalid_datetime_format or invalid_text_representation or datetime_field_overflow then
    v_failed := true;
  end;
  assert v_failed, 'a bad due date must raise, not be swallowed';
  select count(*) into v_after from public.projects where office_id = v_a;
  assert v_after = v_before, 'a failed restore leaves no project';
  assert not exists (select 1 from public.project_restores where idempotency_key = repeat('9', 64)),
    'a failed restore leaves no key, so a corrected package can be sent under it';
  raise notice 'C2 PROOF 7: a mid-restore failure leaves nothing behind';

  raise notice 'C2 PROOF: all seven properties hold';
end
$proof$;

rollback;
