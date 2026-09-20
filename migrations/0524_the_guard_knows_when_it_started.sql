/*
  0524 — the guard knows when it started (anchor C)

  0523's counter in `check:leaks` went red on 73 deliveries that escaped BEFORE
  the guard existed. True, and useless as a gate: a check that can only ever
  fail is one somebody deletes, and this is the last check in the office that
  should be easy to delete.

  The honest claim is not "no harness traffic has ever reached Grant" — it has,
  162 times, and the ledger says so. It is **"none has escaped since the guard
  was installed"**, and that is a claim which starts true and can go false, so
  a gate can carry it.

  Read from `app.schema_migrations` rather than written as a literal date: the
  moment the guard started IS the moment its migration applied, and a hardcoded
  timestamp is a second place for that fact to rot.
*/

create or replace function app.harness_guard_since()
returns timestamptz language sql stable security definer set search_path = '' as $f$
  select coalesce(
    (select applied_at from app.schema_migrations
      where name like '0523_%' limit 1),
    /*
      Not `now()` as the fallback. If the row is ever missing, a fallback of
      "now" would make the window empty and every escape invisible — the
      found-nothing shape, on the one check that must not have it. An
      impossible past makes the check count EVERYTHING and go loudly red,
      which is the safe direction to fail in.
    */
    '-infinity'::timestamptz)
$f$;

grant execute on function app.harness_guard_since() to authenticated, service_role;

/*
  What has escaped SINCE, and what is still aiming at production. Both bounded
  by the same instant so the two numbers are about one window.
*/
create or replace function app.harness_escapes()
returns jsonb language sql stable security definer set search_path = '' as $f$
  select jsonb_build_object(
    'since', app.harness_guard_since(),
    'escaped', coalesce((
      select jsonb_agg(jsonb_build_object(
               'channel', d.channel, 'target', d.target_ref,
               'by', j.requested_by, 'at', d.sent_at) order by d.sent_at desc)
        from public.deliveries d
        join public.jobs j on j.job_id = d.job_id
       where app.harness_job(d.job_id)
         and d.sent_at is not null
         and d.created_at > app.harness_guard_since()), '[]'::jsonb),
    'refused', coalesce((
      select count(*)::int from public.deliveries d
       where app.harness_job(d.job_id)
         and d.state = 'suppressed'
         and d.suppressed_reason like '%production destination%'
         and d.created_at > app.harness_guard_since()), 0),
    /*
      And the historical total, reported rather than hidden. The number is the
      argument for the guard and nobody should have to dig for it.
    */
    'before_the_guard', coalesce((
      select count(*)::int from public.deliveries d
       where app.harness_job(d.job_id) and d.sent_at is not null
         and d.created_at <= app.harness_guard_since()), 0))
$f$;

grant execute on function app.harness_escapes() to authenticated, service_role;

do $drive$
declare v jsonb;
begin
  v := app.harness_escapes();
  if v ->> 'since' is null then
    raise exception '0524: the guard cannot say when it started: %', v;
  end if;
  if app.harness_guard_since() = '-infinity'::timestamptz then
    raise exception '0524: 0523 is not recorded as applied, so the window is wrong';
  end if;
  if (v ->> 'before_the_guard')::int < 100 then
    raise exception
      '0524: the historical count reads %, which is too low to be the real one - the window is wrong',
      v ->> 'before_the_guard';
  end if;
  if jsonb_array_length(v -> 'escaped') <> 0 then
    raise exception '0524: something has escaped SINCE the guard was installed: %', v -> 'escaped';
  end if;
  raise notice '0524 drive: four checks passed - % escaped before the guard, 0 since',
    v ->> 'before_the_guard';
end;
$drive$;
