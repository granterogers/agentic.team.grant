-- Establishing and forgetting a browser session (#135, #72).
--
-- 0442 could OPEN a session row and 0446 gave the page its readers, and
-- `check:callers` immediately said what was missing: nothing anywhere could
-- put a cookie jar in the Vault, so the two writers were capabilities nobody
-- could reach. That is #72's defect, caught the same hour it was created,
-- which is the whole point of that check.
--
-- ## Why this is SQL and not TypeScript
--
-- The jar is a credential. Doing it here means it goes straight from the
-- request body into `app.store_secret` and is never held by an edge function,
-- never logged, never interpolated into a message and never returned. The
-- function gives back a session id and a boolean; there is no code path by
-- which it can hand a jar back out.
--
-- ## Forgetting removes the jar, not just the row
--
-- 0350 is the cautionary one: a revoke that leaves a dangling Vault reference
-- raises `23503` on every later read, and a missing Slack token once took down
-- every job in the building. So the reference is nulled and the secret is
-- deleted in one statement, in that order, and a revoke of something already
-- revoked succeeds -- a person pressing Forget twice has not done anything
-- wrong.

create or replace function app.browser_session_establish(
  p_project uuid, p_site text, p_purpose text, p_jar text, p_by text default 'grant'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_site text := lower(trim(coalesce(p_site, '')));
  v_ref app.vault_secret_ref;
  v_opened jsonb;
begin
  if coalesce(length(trim(coalesce(p_jar, ''))), 0) < 2 then
    return jsonb_build_object('error',
      'a session needs the signed-in browser state. Export it from the browser '
      'you signed in with and paste the whole thing.');
  end if;
  /*
    The jar is checked for SHAPE before it is stored, so a paste into the wrong
    box is refused with a sentence rather than kept for ever as a session that
    silently never works. 0359 is the same argument about a Client ID and a
    Client secret sitting next to each other.
  */
  begin
    if jsonb_typeof(p_jar::jsonb) not in ('array', 'object') then
      return jsonb_build_object('error',
        'that does not look like browser session state -- it should be the JSON '
        'a browser export gives you.');
    end if;
  exception when others then
    return jsonb_build_object('error',
      'that does not look like browser session state -- it should be the JSON '
      'a browser export gives you.');
  end;

  -- Opened FIRST, with no credential, so a refusal costs nothing: a Vault row
  -- written for a session the validation then rejects is orphaned for ever.
  v_opened := app.browser_session_open(p_project, v_site, p_purpose, null, p_by);
  if v_opened ? 'error' then return v_opened; end if;

  v_ref := app.store_secret(
    format('browser.session.%s.%s', p_project, v_site), p_jar,
    format('Signed-in browser state for %s. Established by %s.', v_site, coalesce(p_by, 'grant')));

  update public.browser_sessions
     set credential_ref = v_ref, expired_at = null, revoked_at = null,
         updated_at = app.now_utc()
   where session_id = (v_opened ->> 'session_id')::uuid;

  return jsonb_build_object('ok', true, 'session_id', v_opened -> 'session_id',
                            'site', v_site);
end;
$fn$;

create or replace function app.browser_session_forget(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ref app.vault_secret_ref;
  v_site text;
begin
  select credential_ref, site into v_ref, v_site
    from public.browser_sessions where session_id = p_session;
  if not found then
    return jsonb_build_object('error', 'there is no session by that id');
  end if;

  -- The reference first, the secret second. A row pointing at a secret that is
  -- already gone raises on every read (0350); a null reference degrades alone.
  update public.browser_sessions
     set credential_ref = null, revoked_at = coalesce(revoked_at, app.now_utc()),
         updated_at = app.now_utc()
   where session_id = p_session;

  if v_ref is not null then
    delete from vault.secrets where id = v_ref::uuid;
  end if;

  return jsonb_build_object('ok', true, 'site', v_site,
    'note', format('The office can no longer sign in to %s. Nothing it already '
                   'read has been removed.', v_site));
end;
$fn$;

create or replace function public.browser_session_establish(
  p_project uuid, p_site text, p_purpose text, p_jar text, p_by text default 'grant')
returns jsonb language sql security definer set search_path to ''
as $function$ select app.browser_session_establish(p_project, p_site, p_purpose, p_jar, p_by) $function$;

create or replace function public.browser_session_forget(p_session uuid)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.browser_session_forget(p_session) $function$;
