-- 0860 - the compatibility bridge is removed (multi-user P3, Wave 12).
--
-- The bridge (0656) gave an insert that named no office to the only person, or to the test office when the writer was
-- named like a harness. It existed so P2 could add the carrier columns without every writer moving at once. P3 moved
-- every writer: the application passes its office explicitly, and `public.office_bridge_use` - the meter - showed zero
-- reliance across the worker's ticks after the P3 release. A bridge nobody relies on is only a way for a mistake to
-- become somebody's data, so it goes.
--
-- After this a writer that names no office fails on NOT NULL (23502) in every state of the world, including the one
-- where Grant is the only real office. The meter table is KEPT: it is the evidence of what relied on the bridge, and it
-- is read by the enforcement catalogue.
--
-- ROLLBACK: the trigger definitions are in migrations/0656 (function) and 0658/0659 (per-table triggers); a database-only
-- rollback re-creates them from there. The worker does not need rolling back, because nothing relies on the bridge.

do $m$
declare
  r record;
  v_dropped int := 0;
begin
  for r in
    select c.oid::regclass::text as tbl, t.tgname
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where t.tgname = 'a0_office_bridge' and not t.tgisinternal
  loop
    execute format('drop trigger %I on %s', r.tgname, r.tbl);
    v_dropped := v_dropped + 1;
  end loop;

  if v_dropped = 0 then
    raise exception '0860: no bridge trigger was found, so this migration matched nothing';
  end if;
  raise notice '0860: dropped % bridge trigger(s)', v_dropped;
end
$m$;

drop function app.office_bridge_trigger();
drop function app.bridge_office(text, uuid, uuid, text);

do $m$
begin
  if exists (select 1 from pg_trigger where tgname = 'a0_office_bridge') then
    raise exception '0860: a bridge trigger is still present';
  end if;
  if exists (select 1 from pg_proc where proname in ('office_bridge_trigger', 'bridge_office')) then
    raise exception '0860: a bridge function is still present';
  end if;
end
$m$;
