-- 0668 - public.resolve_office confirms the office it resolved is still active before returning it (multi-user P3).
--
-- app.require_office is the one fail-closed check every internal function will use on an office it was handed by a
-- trusted component. The resolver is its first caller, so a race between "found" and "returned" (an office disabled in
-- between) is refused by the same code that every later function relies on, and the check has a caller that drives it.

create or replace function public.resolve_office(p_auth_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $f$
declare
  v_n int;
  v_office uuid;
  v_kind text;
begin
  select count(*) into v_n from app.office_for_auth(p_auth_user_id);
  if v_n <> 1 then
    return jsonb_build_object('ok', false, 'reason', case when v_n = 0 then 'no_office' else 'ambiguous' end);
  end if;
  select f.office_id, f.kind into v_office, v_kind from app.office_for_auth(p_auth_user_id) f;
  begin
    perform app.require_office(v_office);
  exception when sqlstate '42501' then
    return jsonb_build_object('ok', false, 'reason', 'no_office');
  end;
  return jsonb_build_object('ok', true, 'office_id', v_office, 'kind', v_kind);
end
$f$;
