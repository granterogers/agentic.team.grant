-- 0667 - one trusted way from a verified login to an office (multi-user P3, wave 1).
--
-- IDENTITY -> TRUSTED OFFICE CONTEXT -> RESOURCE CHECK. Until now the gateway turned a verified Supabase session into an
-- email, asked office_members for a free-text owner_key (whose default is 'grant') and the office was inferred later by
-- the compatibility bridge. This is the resolver that replaces that inference: it answers from the verified AUTH USER ID,
-- never from an email, and it fails closed - no row, a disabled office, or a system office is "no office", not "Grant".
--
-- Nothing here takes an office from a caller. resolve_office takes the identity (an auth user id the gateway just got from
-- Supabase) and returns the office; require_office is for INTERNAL use by functions that were handed an office by a
-- trusted component and must refuse a missing or disabled one.

create function app.office_for_auth(p_auth_user_id uuid)
returns table (office_id uuid, kind text)
language sql
stable
security definer
set search_path to ''
as $f$
  select o.office_id, o.kind
    from public.offices o
   where o.auth_user_id = p_auth_user_id
     and o.state = 'active'
     and o.kind <> 'system'
$f$;
revoke all on function app.office_for_auth(uuid) from public, anon, authenticated;

create function app.require_office(p_office uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $f$
begin
  if p_office is null
     or not exists (select 1 from public.offices o where o.office_id = p_office and o.state = 'active') then
    raise exception 'no_office' using errcode = '42501', hint = 'a missing or disabled office is refused, never defaulted';
  end if;
  return p_office;
end
$f$;
revoke all on function app.require_office(uuid) from public, anon, authenticated;

-- The gateway's door. The identity is the argument; the answer is the office or nothing. Service role only.
create function public.resolve_office(p_auth_user_id uuid)
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
  return jsonb_build_object('ok', true, 'office_id', v_office, 'kind', v_kind);
end
$f$;
revoke all on function public.resolve_office(uuid) from public, anon, authenticated;
grant execute on function public.resolve_office(uuid) to service_role;
