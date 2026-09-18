/*
  `verify:schema` went red on a correct function, because of a key I named.

      no function body names a table, function or type that does not exist
      app.app_base_url -> app.base_url                                    ❌

  `app.app_base_url()` reads the `system_config` row whose KEY is
  `'app.base_url'`. The checker scans function bodies for schema-qualified
  names and cannot tell a relation from a dotted string inside quotes — so a
  config key that borrows a schema name reads as a reference to a table that
  does not exist.

  ## Fixing the key, not the checker

  The obvious move is to teach the checker to ignore string literals. That is
  the wrong one: `pg_get_functiondef` splices and dynamic `execute` put real
  SQL inside strings in this repository, and CLAUDE.md is explicit that
  removing text is the one way a dangling-reference check goes quietly blind.
  The check is right; the name was bad.

  Every other key in the table uses a DOMAIN prefix — `telegram.`, `voice.`,
  `notebook.`, `ui.`, `worker.`, `staff.`. `app.` is not a domain, it is a
  schema, and that collision is the whole defect. `web.base_url` says what it
  is: the address of the web front end.

  ## And the class, because there is already a second one

  `vault.naming` has the same shape and has simply never been referenced from
  inside a function body — the day something reads it, `verify:schema` goes
  red on another correct change. A trigger refuses a NEW key whose prefix is a
  live schema name; the existing row is left alone rather than renamed,
  because it is not mine to rename and it is harmless until something reads
  it. The refusal names the class, so the next person meets a sentence rather
  than a puzzle.
*/

update public.system_config set key = 'web.base_url' where key = 'app.base_url';

-- Rebuild the reader against the new key. Spliced, so nothing else about the
-- function moves.
do $splice$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'app_base_url';
  if position('''app.base_url''' in v_def) = 0 then
    raise exception '0493: app_base_url does not read the key this expects';
  end if;
  execute replace(v_def, '''app.base_url''', '''web.base_url''') || ';';
end
$splice$;

-- ---------------------------------------------------------------------------
-- The class.
-- ---------------------------------------------------------------------------

create or replace function app.config_key_is_not_a_schema()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prefix text := split_part(new.key, '.', 1);
begin
  if exists (select 1 from pg_namespace where nspname = v_prefix) then
    raise exception
      'a config key may not start with a schema name (%): a function reading '
      '''%'' makes verify:schema report a dangling reference to a relation '
      'that does not exist. Use a DOMAIN prefix — telegram., voice., web., '
      'worker. — the way every other key does.', v_prefix, new.key
      using errcode = '23514';
  end if;
  return new;
end
$$;

comment on function app.config_key_is_not_a_schema() is
  '0493. `app.base_url` made a correct function look like it referenced a '
  'missing table. `vault.naming` is the same shape, unreferenced so far, and '
  'left alone deliberately.';

drop trigger if exists system_config_key_is_not_a_schema on public.system_config;
create trigger system_config_key_is_not_a_schema
  before insert or update of key on public.system_config
  for each row execute function app.config_key_is_not_a_schema();

-- ---------------------------------------------------------------------------
-- Drive it.
-- ---------------------------------------------------------------------------

do $drive$
declare
  v_url text;
  v_msg text;
begin
  v_url := app.app_base_url();
  if v_url is null or v_url = '' or v_url not like 'https://%' then
    raise exception '0493: the reader stopped finding the base url: %', coalesce(v_url, '(null)');
  end if;
  if v_url like '%/' then
    raise exception '0493: the base url gained a trailing slash: %', v_url;
  end if;

  -- A new schema-prefixed key is refused, and says why.
  begin
    insert into public.system_config (key, value, description)
    values ('public.nope', to_jsonb('x'::text), 'drive 0493');
    raise exception '0493: a schema-prefixed key was accepted';
  exception
    when sqlstate '23514' then
      get stacked diagnostics v_msg = message_text;
      if v_msg not like '%may not start with a schema name%' then
        raise exception '0493: refused for the wrong reason: %', v_msg;
      end if;
  end;

  -- THE CONTROL: an ordinary domain-prefixed key is still accepted, or the
  -- trigger is simply refusing everything.
  insert into public.system_config (key, value, description)
  values ('drive0493.ok', to_jsonb('x'::text), 'drive 0493');
  if not exists (select 1 from public.system_config where key = 'drive0493.ok') then
    raise exception '0493: the trigger refused a perfectly good key';
  end if;

  raise exception using errcode = 'ZZ000', message = '0493 drive: rolling back';
exception
  when others then
    if sqlerrm <> '0493 drive: rolling back' then raise; end if;
end
$drive$;
