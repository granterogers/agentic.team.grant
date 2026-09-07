-- 0096 — Settings carries the Google block
--
-- The Settings view renders a Google panel from `d.google`, and `hq_settings`
-- did not return one — the block was added as a separate section, which would
-- have meant a second request for one card on a page that already fetches
-- everything else in one.
--
-- Folded in rather than fetched separately, because the page renders Settings
-- as a whole and a card that arrives late is a card that flashes empty.

begin;

create or replace function app.hq_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'live', jsonb_build_object(
      'database', current_database(),
      'server', split_part(version(), ' on ', 1),
      'size', pg_size_pretty(pg_database_size(current_database())),
      'tables', (select count(*)::int from information_schema.tables
                  where table_schema = 'public')
    ),
    'notebook', app.notebook_allowance(null),
    'google', app.hq_google(),
    'settings', coalesce(
      (select jsonb_object_agg(key, jsonb_build_object(
                'value', value, 'description', coalesce(description, '')))
         from public.system_config
        where key in ('db.project_ref', 'db.region', 'backup.s3_bucket',
                      'backup.s3_endpoint', 'backup.s3_region',
                      'calendar.enabled', 'calendar.calendar_id',
                      'notebook.window_units', 'notebook.week_units')),
      '{}'::jsonb),
    -- `google.client_id` is edited in the Google card above, not in the generic
    -- field list, so it is deliberately not repeated here: two boxes writing one
    -- key is two boxes that disagree.
    'editable', jsonb_build_array(
      'db.project_ref', 'db.region', 'backup.s3_bucket', 'backup.s3_endpoint',
      'backup.s3_region', 'calendar.enabled', 'calendar.calendar_id',
      'notebook.window_units', 'notebook.week_units')
  )
$$;

commit;
