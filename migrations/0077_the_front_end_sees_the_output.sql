-- 0077 — The front end sees the output, and can say where things live
--
-- Three things Grant asked for, all of them front-end surface over facts that
-- already exist:
--
--   1. *"see if you can pull them into our store project and display the
--      results as a link"* — the artifacts, with their links.
--   2. *"with regards to database storage, that's something that should be
--      configured on the front end as well. We don't need to change anything,
--      but nevertheless, it should be configurable to where the database is
--      being connected."*
--   3. *"Are we successfully integrating Google Calendar? That's important."*
--      We are not. That is a red light with an honest sentence next to it and
--      not a silence.
--
-- ## What "configurable" honestly means for a database
--
-- A setting that moves the database cannot live in the database it would be
-- moving. What CAN live here, and what the front end now edits, is the
-- DECLARED target: which Supabase project the tooling should connect to, and
-- where backups go. Changing the declared ref does not migrate anything — it
-- tells the next run of the tooling where to look, which is the honest half of
-- the request and the whole of the half that is safe.
--
-- The live location is shown beside it as a fact rather than a field, so the
-- page never implies that editing a box moved a database.
--
-- ## Why an allow-list rather than "set any key"
--
-- `system_config` holds the job lease, the capacity limit and the autonomy
-- level. A general setter on the page is one typo away from a worker that
-- leases jobs for two seconds. Six keys, named.

begin;

-- --------------------------------------------------------------------------
-- 1. The artifacts, for the page
-- --------------------------------------------------------------------------

create or replace function app.hq_artifacts()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(a order by a.created_at desc), '[]'::jsonb)
    from (
      select ar.artifact_id, ar.kind, ar.title, ar.url, ar.state, ar.detail,
             ar.created_at, ar.ready_at, p.name as project
        from public.artifacts ar
        join public.projects p using (project_id)
       order by ar.created_at desc
       limit 40
    ) a
$$;

comment on function app.hq_artifacts is
  'What the notebook has made for us and where to open it. The answer to '
  '"display the results as a link" on the surface that is a page.';

-- --------------------------------------------------------------------------
-- 2. Where things live
-- --------------------------------------------------------------------------

-- Seeded from what is true right now, so the page opens with the real values
-- rather than blanks that look like a broken read.
insert into public.system_config (key, value, description)
values
  ('db.project_ref', to_jsonb('baujwlzcziasnfhhkchg'::text),
   'The Supabase project the tooling connects to. Declared, not live: changing '
   'it tells the next run where to look and moves nothing.'),
  ('db.region', to_jsonb('eu-west-2'::text),
   'Where that project is hosted. Recorded for the page; not enforced.'),
  ('calendar.enabled', to_jsonb(false),
   'Whether Google Calendar is in service. False until a credential exists.'),
  ('calendar.calendar_id', to_jsonb('primary'::text),
   'Which calendar to read and write. "primary" is the account''s own.')
on conflict (key) do nothing;

create or replace function app.hq_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    -- Facts, shown beside the fields so the page never implies that editing a
    -- box moved a database.
    'live', jsonb_build_object(
      'database', current_database(),
      'server', split_part(version(), ' on ', 1),
      'size', pg_size_pretty(pg_database_size(current_database())),
      'tables', (select count(*)::int from information_schema.tables
                  where table_schema = 'public')
    ),
    'settings', coalesce(
      (select jsonb_object_agg(key, jsonb_build_object(
                'value', value, 'description', coalesce(description, '')))
         from public.system_config
        where key in ('db.project_ref', 'db.region', 'backup.s3_bucket',
                      'backup.s3_endpoint', 'backup.s3_region',
                      'calendar.enabled', 'calendar.calendar_id')),
      '{}'::jsonb),
    'editable', jsonb_build_array(
      'db.project_ref', 'db.region', 'backup.s3_bucket', 'backup.s3_endpoint',
      'backup.s3_region', 'calendar.enabled', 'calendar.calendar_id')
  )
$$;

create or replace function app.hq_set_setting(p_key text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_json jsonb;
begin
  -- Named, not pattern-matched. `system_config` also holds the job lease and
  -- the autonomy level, and a page one typo away from a two-second lease is a
  -- page that can stop the worker.
  if p_key not in ('db.project_ref', 'db.region', 'backup.s3_bucket',
                   'backup.s3_endpoint', 'backup.s3_region',
                   'calendar.enabled', 'calendar.calendar_id') then
    return jsonb_build_object('error', format('%L is not a setting this page may change', p_key));
  end if;

  -- Booleans stay booleans. `'false'` as a STRING is truthy in every language
  -- that will read this, which is the kind of bug that turns an integration on.
  v_json := case
    when p_key = 'calendar.enabled' then to_jsonb(lower(trim(p_value)) in ('true', 'on', 'yes', '1'))
    else to_jsonb(trim(p_value))
  end;

  insert into public.system_config (key, value)
  values (p_key, v_json)
  on conflict (key) do update set value = excluded.value;

  return jsonb_build_object('key', p_key, 'value', v_json);
end;
$$;

-- --------------------------------------------------------------------------
-- 3. Google Calendar, as a light that is honestly red
-- --------------------------------------------------------------------------
--
-- Registered before it works, on purpose. Grant asked whether it was
-- integrated; the useful answer is a row on the page that says "no, and here
-- is what it needs", not the absence of a row, which reads identically to
-- "nobody thought about it".

insert into public.connection_health (service, credential, state, detail, owner, action)
values (
  'google_calendar', 'oauth_client', 'missing',
  'not integrated — nothing reads or writes the calendar yet',
  'grant',
  'Needs a Google Cloud OAuth client (Calendar API) and one consent. Until then '
  'this stays red rather than absent, because an absent row reads the same as a '
  'forgotten one.'
)
on conflict (service, credential) do update
  set state = excluded.state, detail = excluded.detail, action = excluded.action;

create or replace function public.hq_artifacts()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_artifacts() $$;

create or replace function public.hq_settings()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_settings() $$;

create or replace function public.hq_set_setting(p_key text, p_value text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_set_setting(p_key, p_value) $$;

commit;
