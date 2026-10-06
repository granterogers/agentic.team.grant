-- 0902. A sample office keeps its dates believable (#424).
--
-- The public Sample is seeded with task dates relative to the day it was seeded, and visitors cannot change it, so nothing
-- moved them: within weeks "today" and "tomorrow" would be in the past, the late count would climb and the café's story would
-- read as abandoned. The smallest honest fix is to move the DATES, daily, by the days that have gone by - every task keeps the
-- same distance from today it was seeded with. Nothing else is touched: not a title, a state, a document, a contact, nor the
-- history the Activity page derives from creation and completion times (that history ages truthfully, the way any workspace's
-- does, and is not rewritten).
--
--   app.sample_refresh_dates()  moves `due_on` and `starts_on` of every task in an active sample office forward by
--                               (today - the day last moved to). The anchor is `system_config` `sample.dates_anchor`, taken as
--                               the day the first task was created when it has never run. A day that has not passed moves
--                               nothing; the shift is capped at a year so a clock gone wrong cannot throw the story away.
--
-- It is a function in `app` with no public wrapper (nothing in a browser can call it) and one daily pg_cron entry, created only
-- where pg_cron exists so an isolated replica still builds. It never reads or writes any office that is not a sample.

create or replace function app.sample_refresh_dates()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today  date := (app.now_utc())::date;
  v_anchor date;
  v_first  date;
  v_shift  integer;
  v_moved  integer := 0;
begin
  select (value #>> '{}')::date into v_anchor from public.system_config where key = 'sample.dates_anchor';
  if v_anchor is null then
    select min(t.created_at)::date into v_first
      from public.tasks t join public.offices o on o.office_id = t.office_id
     where o.kind = 'sample' and o.state = 'active';
    v_anchor := v_first;
  end if;
  if v_anchor is null then
    return jsonb_build_object('ok', true, 'moved', 0, 'note', 'there is no sample office with tasks');
  end if;
  v_shift := least(greatest(v_today - v_anchor, 0), 365);
  if v_shift = 0 then
    -- Remember the day even when nothing moved, so the first real shift starts from it.
    insert into public.system_config (key, value, description, updated_by)
    values ('sample.dates_anchor', to_jsonb(v_anchor::text), 'The day the public Sample Office''s task dates were last moved to (0902).', 'sample_refresh_dates')
    on conflict (key) do nothing;
    return jsonb_build_object('ok', true, 'moved', 0, 'shift_days', 0, 'anchor', v_anchor);
  end if;

  update public.tasks t
     set due_on    = case when t.due_on    is null then null else t.due_on    + v_shift end,
         starts_on = case when t.starts_on is null then null else t.starts_on + v_shift end
   where t.office_id in (select o.office_id from public.offices o where o.kind = 'sample' and o.state = 'active')
     and (t.due_on is not null or t.starts_on is not null);
  get diagnostics v_moved = row_count;

  insert into public.system_config (key, value, description, updated_by)
  values ('sample.dates_anchor', to_jsonb(v_today::text), 'The day the public Sample Office''s task dates were last moved to (0902).', 'sample_refresh_dates')
  on conflict (key) do update set value = excluded.value, updated_at = app.now_utc(), updated_by = 'sample_refresh_dates';

  return jsonb_build_object('ok', true, 'moved', v_moved, 'shift_days', v_shift, 'anchor', v_today);
end
$function$;

revoke all on function app.sample_refresh_dates() from public;

-- Daily, once the night is quiet. Only where pg_cron exists.
do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and not exists (select 1 from cron.job where jobname = 'sample-dates') then
    perform cron.schedule('sample-dates', '23 3 * * *', 'select app.sample_refresh_dates()');
  end if;
end
$cron$;
