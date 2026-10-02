-- 0863 - provisioning and retiring a person office (multi-user P4, second-user acceptance).
--
-- P3 made every function name its office and removed the bridge. Until now the only person office was created by a
-- migration, so there was no code path that makes another one. This is that path, and nothing more: it does not invite
-- anybody, send anything, or build organisations. It is run by an operator (the Management API, as postgres) after the
-- auth user exists, and is not reachable by any browser role.
--
-- A person office is three rows that must agree, because that is how a login becomes an office:
--   auth.users (the login)  <-  public.offices.auth_user_id
--   public.office_members (email -> owner_key, kind = 'person')   - the people the office works for (hq-api checks it)
-- and a narrower default set of specialist grants than the first person's: internal, reversible work only. Nothing
-- outward (post, send, write to a connected system) is granted by default, and nothing that needs a connection that a
-- new office does not have. A grant is the person's to widen from the Team page.
--
-- Retiring is `state = 'disabled'`, never a delete (offices are never deleted): the login stops resolving to an
-- office, `require_office` refuses it, and `dequeue_job` skips its work.
--
-- It also records that the MCP gateway is office-bound (`mcp.office_bound`), which P3 delivered (an MCP client belongs to
-- one office and consent binds the office of whoever consented) and which `check:office-edges` requires before a second
-- real office may exist while a client is enabled.

create function app.provision_person_office(p_name text, p_email text, p_owner_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_auth uuid;
  v_office uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_key text := nullif(btrim(coalesce(p_owner_key, '')), '');
  v_grants int;
begin
  if btrim(coalesce(p_name, '')) = '' or v_email = '' or v_key is null then
    raise exception 'provision_person_office: a name, an email and an owner key are all needed';
  end if;
  select u.id into v_auth from auth.users u where lower(u.email) = v_email;
  if v_auth is null then
    raise exception 'provision_person_office: there is no login for that email (create the auth user first)';
  end if;
  if exists (select 1 from public.offices o where o.auth_user_id = v_auth)
     or exists (select 1 from public.office_members m where lower(m.email) = v_email or m.owner_key = v_key) then
    raise exception 'provision_person_office: that login or owner key already belongs to an office';
  end if;

  insert into public.office_members (email, owner_key, kind, note)
  values (v_email, v_key, 'person', 'provisioned by app.provision_person_office');
  insert into public.offices (kind, name, auth_user_id)
  values ('person', btrim(p_name), v_auth)
  returning office_id into v_office;

  -- the narrower default: internal, reversible tools only, for every specialist
  insert into public.staff_tools (office_id, staff_slug, tool, granted_by, note)
  select v_office, s.slug, t.tool, 'provision_person_office', 'default grant for a new person office'
    from public.staff s
    cross join (values ('db.read'), ('document.create'), ('draft.create'), ('preference.update'),
                       ('task.create'), ('task.extract'), ('web.read')) as t(tool)
   where s.active and s.permanent and not s.is_fixture
     and exists (select 1 from public.tool_permissions tp where tp.tool = t.tool and tp.enabled)
  on conflict do nothing;
  get diagnostics v_grants = row_count;

  perform app.unnamed_project(v_office);

  return jsonb_build_object('ok', true, 'office_id', v_office, 'auth_user_id', v_auth, 'owner_key', v_key,
                            'grants', v_grants);
end
$function$;
revoke all on function app.provision_person_office(text, text, text) from public, anon, authenticated, service_role;

create function app.retire_person_office(p_office uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_kind text;
begin
  select kind into v_kind from public.offices where office_id = p_office;
  if v_kind is distinct from 'person' then
    raise exception 'retire_person_office: that is not a person office';
  end if;
  if p_office in (select app.operator_offices()) then
    raise exception 'retire_person_office: the operator office is not retired by this function';
  end if;
  update public.offices set state = 'disabled', disabled_at = app.now_utc() where office_id = p_office and state = 'active';
  return jsonb_build_object('ok', true, 'office_id', p_office, 'state', 'disabled');
end
$function$;
revoke all on function app.retire_person_office(uuid) from public, anon, authenticated, service_role;

insert into public.system_config (key, value, description)
values ('mcp.office_bound', 'true'::jsonb,
        'The MCP gateway is office-bound (P3): a client belongs to one office, consent binds the consenting office. Required before a second real office may exist while a client is enabled.')
on conflict (key) do update set value = excluded.value;
