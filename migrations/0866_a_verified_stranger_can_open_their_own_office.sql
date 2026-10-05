-- 0866 - self-service account creation: a verified person opens their OWN office (multi-user P6).
--
-- One person, one private office. No organisations, memberships, invitations or tenant switching. Sign-in stays the
-- passwordless email link the product already has; this adds only the step AFTER it: a person whose address Supabase has
-- verified, and who is not yet anybody's member, may ask for an office of their own.
--
-- What it reuses: app.provision_person_office (0863) does the three-row write and the narrower default grants. This
-- function is the guarded front of it - everything it decides comes from the verified login, never from a caller:
--
--   * the owner key is derived from the auth UUID ('u-' + the uuid without dashes), never from the email, so an address
--     change or a look-alike address can never produce, or collide into, somebody else's identity;
--   * the email is read back from auth.users and must match, and must be CONFIRMED;
--   * one advisory lock per auth UUID makes concurrent calls create exactly one office, and a repeat call is a no-op that
--     returns the same office (idempotent);
--   * a login whose office was retired is not given a new one (a retirement is a decision, not a glitch);
--   * two config switches bound it: `accounts.open_signup` (default true; false closes self-service) and
--     `accounts.max_person_offices` (default 25; a ceiling on ACTIVE person offices on the free tier).
--
-- Errors are plain English for the page; no SQL detail leaves this function. Reachable only through the wrapper below,
-- which is granted to service_role alone (the gateway verifies the session first and passes the verified id and email).

insert into public.system_config (key, value, description)
values
  ('accounts.open_signup', 'true'::jsonb,
   'When true, a person whose email is verified may create their own private office. Set false to close self-service account creation (existing offices are unaffected).'),
  ('accounts.max_person_offices', '25'::jsonb,
   'The most ACTIVE person offices the deployment will hold through self-service creation (free-tier ceiling). Raising it is the operator''s decision.')
on conflict (key) do nothing;

create function app.self_provision_office(p_auth uuid, p_email text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'));
  v_user_email text;
  v_confirmed timestamptz;
  v_office uuid;
  v_state text;
  v_open jsonb;
  v_max int;
  v_active int;
  v_key text;
  v_made jsonb;
begin
  if p_auth is null or v_email = '' then
    return jsonb_build_object('ok', false, 'error', 'We could not tell who you are. Please sign in again.');
  end if;

  -- One lock per person: concurrent presses queue here and the second finds the first one's office.
  perform pg_advisory_xact_lock(hashtextextended('self_provision_office:' || p_auth::text, 0));

  select lower(btrim(u.email)), u.email_confirmed_at into v_user_email, v_confirmed
    from auth.users u where u.id = p_auth;
  if v_user_email is null then
    return jsonb_build_object('ok', false, 'error', 'We could not find your sign-in. Please sign in again.');
  end if;
  if v_user_email <> v_email then
    return jsonb_build_object('ok', false, 'error', 'We could not match your sign-in. Please sign in again.');
  end if;
  if v_confirmed is null then
    return jsonb_build_object('ok', false, 'error', 'Please confirm your email address first, then try again.');
  end if;

  select o.office_id, o.state into v_office, v_state from public.offices o where o.auth_user_id = p_auth;
  if v_office is not null then
    if v_state = 'active' then
      return jsonb_build_object('ok', true, 'created', false, 'office_id', v_office);
    end if;
    return jsonb_build_object('ok', false, 'error', 'This account has been closed. Please contact whoever runs this office.');
  end if;

  -- The address already belongs to somebody the office works for: that is not a new person.
  if exists (select 1 from public.office_members m where lower(m.email) = v_email) then
    return jsonb_build_object('ok', false, 'error', 'This address already belongs to an account. Please contact whoever runs this office.');
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'error', 'Please give your office a name of 1 to 80 characters.');
  end if;

  select c.value into v_open from public.system_config c where c.key = 'accounts.open_signup';
  if v_open is distinct from 'true'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'New accounts are not being opened right now.');
  end if;

  select coalesce((select (c.value #>> '{}')::int from public.system_config c where c.key = 'accounts.max_person_offices'), 0)
    into v_max;
  select count(*)::int into v_active from public.offices o where o.kind = 'person' and o.state = 'active';
  if v_active >= v_max then
    return jsonb_build_object('ok', false, 'error', 'This office is not taking new accounts just now. Please try again later.');
  end if;

  v_key := 'u-' || replace(p_auth::text, '-', '');
  begin
    v_made := app.provision_person_office(v_name, v_email, v_key);
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'We could not set up your office just now. Please try again in a moment.');
  end;
  return jsonb_build_object('ok', true, 'created', true, 'office_id', v_made ->> 'office_id');
end
$function$;
revoke all on function app.self_provision_office(uuid, text, text) from public, anon, authenticated, service_role;

-- PostgREST only exposes public. Service role only: the gateway has verified the session before it calls this.
create function public.self_provision_office(p_auth uuid, p_email text, p_name text)
returns jsonb
language sql
security definer
set search_path to ''
as $function$ select app.self_provision_office(p_auth, p_email, p_name) $function$;
revoke all on function public.self_provision_office(uuid, text, text) from public, anon, authenticated;
grant execute on function public.self_provision_office(uuid, text, text) to service_role;
