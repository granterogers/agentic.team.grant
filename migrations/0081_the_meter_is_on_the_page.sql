-- 0081 — The meter is on the page
--
-- 0078 counts what we spend against NotebookLM's new compute allowance. This
-- puts it where Grant can see it and change it, because the ceiling is a guess
-- until a refusal measures it, and a guess he cannot adjust is a guess he has
-- to live with.
--
-- Shown as OUR count, in as many words, on the surface as well as in the
-- messages. Google exposes no usage API; a figure on this page that did not say
-- whose count it was would be read as Google's within a week, and then a
-- refusal at half our number would look like our bug rather than our estimate.

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
    -- What the notebook has cost us lately, by our own reckoning.
    'notebook', app.notebook_allowance(null),
    'settings', coalesce(
      (select jsonb_object_agg(key, jsonb_build_object(
                'value', value, 'description', coalesce(description, '')))
         from public.system_config
        where key in ('db.project_ref', 'db.region', 'backup.s3_bucket',
                      'backup.s3_endpoint', 'backup.s3_region',
                      'calendar.enabled', 'calendar.calendar_id',
                      'notebook.window_units', 'notebook.week_units')),
      '{}'::jsonb),
    'editable', jsonb_build_array(
      'db.project_ref', 'db.region', 'backup.s3_bucket', 'backup.s3_endpoint',
      'backup.s3_region', 'calendar.enabled', 'calendar.calendar_id',
      'notebook.window_units', 'notebook.week_units')
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
  if p_key not in ('db.project_ref', 'db.region', 'backup.s3_bucket',
                   'backup.s3_endpoint', 'backup.s3_region',
                   'calendar.enabled', 'calendar.calendar_id',
                   'notebook.window_units', 'notebook.week_units') then
    return jsonb_build_object('error', format('%L is not a setting this page may change', p_key));
  end if;

  v_json := case
    when p_key = 'calendar.enabled'
      then to_jsonb(lower(trim(p_value)) in ('true', 'on', 'yes', '1'))
    when p_key like 'notebook.%units'
      then to_jsonb(greatest(1,
             coalesce(nullif(regexp_replace(p_value, '[^0-9]', '', 'g'), ''), '1')::integer))
    else to_jsonb(trim(p_value))
  end;

  insert into public.system_config (key, value)
  values (p_key, v_json)
  on conflict (key) do update set value = excluded.value;

  -- Raising the ceiling by hand un-measures it. 0078 lowers it from a refusal
  -- and flags it as measured; a human overriding that is making a fresh guess,
  -- and the flag has to say so or the page will go on claiming a number Google
  -- has never confirmed.
  if p_key = 'notebook.window_units' then
    update public.system_config set value = to_jsonb(false)
     where key = 'notebook.ceiling_is_measured';
  end if;

  return jsonb_build_object('key', p_key, 'value', v_json);
end;
$$;

commit;
