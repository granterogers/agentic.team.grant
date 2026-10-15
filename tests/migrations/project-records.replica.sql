-- Scratch proof for migration 1063 (local replica only; the whole thing rolls back).
begin;

insert into auth.users (id) values ('c1000000-0000-4000-8000-00000000000a'), ('c1000000-0000-4000-8000-00000000000b');
insert into public.offices (name, kind, auth_user_id) values ('c1-test-office-a', 'person', 'c1000000-0000-4000-8000-00000000000a');
insert into public.offices (name, kind, auth_user_id) values ('c1-test-office-b', 'person', 'c1000000-0000-4000-8000-00000000000b');
create temp table c1 as
  select (select office_id from public.offices where name = 'c1-test-office-a') as a,
         (select office_id from public.offices where name = 'c1-test-office-b') as b;

insert into public.projects (slug, name, office_id)
  select 'c1-test-project', 'C1 test project', a from c1;
insert into public.projects (slug, name, office_id)
  select 'c1-other-project', 'C1 other project', b from c1;

create temp table ids as
  select (select project_id from public.projects where slug = 'c1-test-project') as p,
         (select project_id from public.projects where slug = 'c1-other-project') as q,
         (select a from c1) as a,
         (select b from c1) as b;

insert into public.contacts (project_id, name, email, "where", note)
  select p, 'Priya Shah', 'priya@example.test', '1 High Street', 'met at expo' from ids;
insert into public.contacts (project_id, name)
  select q, 'Stranger in another project' from ids;

insert into public.tasks (project_id, office_id, title, due_on, state)
  select p, a, 'Confirm the deposit', date '2026-10-20', 'todo' from ids;

insert into public.project_events (office_id, project_id, title, starts_at, ends_at, origin_channel, created_by)
  select a, p, 'Native walk-through', timestamptz '2026-10-13 09:00+00', timestamptz '2026-10-13 10:00+00',
         'teamhq', 'grant' from ids;
insert into public.project_events (office_id, project_id, title, starts_at, ends_at, all_day, origin_channel, created_by)
  select a, p, 'Native all-day', timestamptz '2026-10-12 21:00+00', timestamptz '2026-10-13 21:00+00', true,
         'teamhq', 'grant' from ids;

-- A Google event filed to the project, and a native event that was synced to Google (must appear once, not twice).
insert into public.calendar_events (calendar_id, event_id, office_id, summary, starts_at, ends_at, status)
  select 'grant@example.test', 'g-filed', a, 'Google filed event', timestamptz '2026-10-14 08:00+00',
         timestamptz '2026-10-14 09:00+00', 'confirmed' from ids;
insert into public.calendar_events (calendar_id, event_id, office_id, summary, starts_at, ends_at, status)
  select 'grant@example.test', 'g-synced', a, 'Synced copy of a native event', timestamptz '2026-10-15 08:00+00',
         timestamptz '2026-10-15 09:00+00', 'confirmed' from ids;
insert into public.calendar_event_projects (office_id, calendar_id, event_id, project_id, assigned_by, origin_channel)
  select a, 'grant@example.test', 'g-filed', p, 'grant', 'teamhq' from ids;
insert into public.calendar_event_projects (office_id, calendar_id, event_id, project_id, assigned_by, origin_channel)
  select a, 'grant@example.test', 'g-synced', p, 'grant', 'teamhq' from ids;
update public.project_events set external_calendar_id = 'grant@example.test', external_event_id = 'g-synced'
 where title = 'Native walk-through';

create temp table out as
  select
    (select app.project_records(a, p, 'contacts') from ids) as contacts,
    (select app.project_records(a, p, 'tasks') from ids) as tasks,
    (select app.project_records(a, p, 'events') from ids) as events,
    (select app.project_records(a, q, 'contacts') from ids) as wrong_project_office_null,
    (select public.project_records(b, p, 'contacts') from ids) as wrong_office_null;

\echo ==== CONTACTS
select contacts from out;
\echo ==== TASKS
select tasks from out;
\echo ==== EVENTS
select jsonb_array_length(events->'records') as event_count, events->>'zone' as zone,
       (select jsonb_agg(r->>'event_id') from jsonb_array_elements(events->'records') r) as ids
  from out;
\echo ==== CROSS-OFFICE / UNKNOWN
select wrong_project_office_null is null as cross_project_is_null,
       wrong_office_null is null as cross_office_is_null from out;

do $$
declare
  v_c jsonb; v_t jsonb; v_e jsonb; v_zone text; v_refused boolean := false;
begin
  select contacts, tasks, events into v_c, v_t, v_e from out;
  assert jsonb_array_length(v_c->'records') = 1, 'contacts: the other project must not appear';
  assert v_c->'records'->0->>'name' = 'Priya Shah';
  assert jsonb_array_length(v_t->'records') = 1, 'tasks: exactly the project tasks';
  assert (v_t->'records'->0->>'due_on') = '2026-10-20', 'tasks: due date keeps its date form';
  assert jsonb_array_length(v_e->'records') = 3,
    'events: native walk-through (synced), native all-day, filed google event; synced copy counted once';
  assert not exists (select 1 from jsonb_array_elements(v_e->'records') r where r->>'summary' = 'Synced copy of a native event'),
    'events: the Google copy of a synced native event must be dropped';
  assert (v_e->>'zone') is not null, 'events: the office zone is returned';
  begin
    perform app.project_records((select a from ids), (select p from ids), 'secrets');
  exception when sqlstate '22023' then v_refused := true;
  end;
  assert v_refused, 'an unknown kind must be refused, not returned empty';
  raise notice 'C1 PROOF: contacts, tasks, events, cross-office and unknown-kind all as specified';
end $$;

rollback;
