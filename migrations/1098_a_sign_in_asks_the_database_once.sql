begin;

-- The gateway checked a login in two calls in a row: public.office_member (who is this address in the office's list) and then
-- public.resolve_office (which office does this auth user belong to). On a cold instance that was about a second and a half of
-- waiting before any work began, on every first request. This answers both in one call, from the same lookups and with the same
-- answers. Additive: the two functions it calls are unchanged and still exist for anything else that uses them. Only the service
-- key may call it, as with the two it replaces. Read-only.

create or replace function public.principal_for_session(p_auth_user_id uuid, p_email text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'member', (select jsonb_build_object('ok', m.ok, 'owner_key', m.owner_key, 'kind', m.kind)
                 from app.office_member(p_email) m limit 1),
    'office', public.resolve_office(p_auth_user_id)
  )
$$;

revoke all on function public.principal_for_session(uuid, text) from public, anon, authenticated;
grant execute on function public.principal_for_session(uuid, text) to service_role;

commit;
