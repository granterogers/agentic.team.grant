-- 0840 - a spoken question is answered inside the office it was asked in (multi-user P3, wave 9 follow-up).
-- (Numbered after 0802, which splices the previous definition: the order the migrations apply in is the order they read.)
--
-- app.voice_answer(command) read the office OFF the command it was handed. The command is one the voice function wrote a
-- moment earlier under the caller's verified login, so nothing a caller can choose reaches it - but "resource in, office
-- derived from the resource" is the shape this phase removes, and a future second caller passing a command id it did not
-- write would have been answered from that command's office. The office is now the first argument, named by the voice
-- function from the verified session, and the command must belong to it: a command of another office reads exactly as a
-- command that does not exist.
--
-- Spliced from the LIVE definition, with every replacement counted: a function rewritten from memory loses behaviours.

do $m$
declare
  v text;
  n integer;
begin
  v := pg_get_functiondef('app.voice_answer(uuid)'::regprocedure);

  -- 1. the signature
  n := (length(v) - length(replace(v, 'app.voice_answer(p_command_id uuid)', ''))) / length('app.voice_answer(p_command_id uuid)');
  if n <> 1 then raise exception 'splice anchor 1 matched % times', n; end if;
  v := replace(v, 'app.voice_answer(p_command_id uuid)', 'app.voice_answer(p_office uuid, p_command_id uuid)');

  -- 2. the lookup: the command must be the office's own, and a missing office is refused first
  n := (length(v) - length(replace(v, 'select * into c from public.inbound_commands where command_id = p_command_id;', ''))) / length('select * into c from public.inbound_commands where command_id = p_command_id;');
  if n <> 1 then raise exception 'splice anchor 2 matched % times', n; end if;
  v := replace(v,
    'select * into c from public.inbound_commands where command_id = p_command_id;',
    E'perform app.require_office(p_office);\n  select * into c from public.inbound_commands where command_id = p_command_id and office_id = p_office;');

  -- 3. the derived-office assertion that followed is now redundant (the row was selected inside the office)
  n := (length(v) - length(replace(v, 'perform app.require_office(c.office_id);', ''))) / length('perform app.require_office(c.office_id);');
  if n <> 1 then raise exception 'splice anchor 3 matched % times', n; end if;
  v := replace(v, 'perform app.require_office(c.office_id);', '');

  execute v;
end
$m$;

drop function app.voice_answer(uuid);
revoke all on function app.voice_answer(uuid, uuid) from public, anon, authenticated, service_role;

drop function public.voice_answer(uuid);
create function public.voice_answer(p_office uuid, p_command_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.voice_answer(p_office, p_command_id) $f$;
revoke all on function public.voice_answer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.voice_answer(uuid, uuid) to service_role;

comment on function public.voice_answer(uuid, uuid) is
  'Answer a spoken question from the state of ONE office (0689). The command must be that office''s own; another office''s command is indistinguishable from a missing one.';
