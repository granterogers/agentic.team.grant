-- 0666 - a chat the harness declared a test origin belongs to the test office, not to the person (multi-user P2).
--
-- FOUND BY THE BRIDGE'S OWN METER. `office_bridge_use` is there so that every write that relied on the compatibility
-- bridge can be counted. Two hours after the waves it showed one table doing so: telegram_chats, 16 times. Thirteen of those
-- were chats a suite had DECLARED a test origin before knocking (#381; the row says so in `undeliverable_reason`), recorded
-- under Grant's subject because that is what the webhook does, and the bridge - which knows a project, a job and an actor
-- and nothing about a row's own reason - bound them to the only person. Test data becoming the person's, through the one
-- door that was supposed to make that impossible.
--
-- The row states its own origin, so a trigger that runs BEFORE the bridge reads it. And the thirteen already written are
-- moved (a repair, by name: the write-once trigger is disabled for this transaction only and re-enabled and asserted),
-- with their old values written to office_repair_log first.

create function app.telegram_chat_origin()
returns trigger
language plpgsql
security definer
set search_path to ''
as $f$
begin
  if new.office_id is null and new.undeliverable_reason like 'a declared test origin%' then
    new.office_id := app.test_office();
  end if;
  return new;
end
$f$;
revoke all on function app.telegram_chat_origin() from public, anon, authenticated, service_role;

-- 'a00' sorts before 'a0_office_bridge', and triggers on one event run in name order.
create trigger a00_declared_test_origin before insert on public.telegram_chats
  for each row execute function app.telegram_chat_origin();

do $m$
declare
  v_test uuid := app.test_office();
  v_moved bigint;
begin
  if v_test is null then raise exception '0666: there is no single test office to move them to'; end if;
  alter table public.telegram_chats disable trigger a1_office_write_once;

  insert into public.office_repair_log (wave, table_name, row_id, column_name, old_value, new_value, why)
  select '0666', 'telegram_chats', c.bot_id || ':' || c.chat_id, 'office_id', c.office_id::text, v_test::text,
         'a chat declared a test origin (#381) was bound to the person by the compatibility bridge'
    from public.telegram_chats c
   where c.undeliverable_reason like 'a declared test origin%' and c.office_id <> v_test;
  update public.telegram_chats c set office_id = v_test
   where c.undeliverable_reason like 'a declared test origin%' and c.office_id <> v_test;
  get diagnostics v_moved = row_count;
  insert into public.office_backfill_report (wave, table_name, rule, n)
  values ('0666', 'telegram_chats', 'REPAIR: declared-test-origin chats the bridge had bound to the person, moved to the test office', v_moved);

  alter table public.telegram_chats enable trigger a1_office_write_once;
  if (select tgenabled from pg_trigger where tgrelid = 'public.telegram_chats'::regclass and tgname = 'a1_office_write_once') <> 'O' then
    raise exception '0666: the write-once trigger was left disabled';
  end if;
  if exists (select 1 from public.telegram_chats c where c.undeliverable_reason like 'a declared test origin%' and c.office_id <> v_test) then
    raise exception '0666: a declared test chat is still in a person office';
  end if;
end
$m$;

-- ROLLBACK (not part of the migration): drop trigger a00_declared_test_origin on public.telegram_chats;
-- drop function app.telegram_chat_origin(); the moved rows can be moved back from office_repair_log (wave 0666).
