-- 0091 — The MCP server speaks OAuth
--
-- Grant: *"ChatGPT does not support manually entering an arbitrary static
-- bearer header when installing a developer-mode MCP app. It supports OAuth, no
-- authentication, or mixed authentication."*
--
-- He is right, and the two alternatives are not alternatives. "No
-- authentication" on this endpoint means an open door to his project store with
-- write access (0068), reachable by anyone who has the URL — and the URL is in
-- a chat transcript. So: OAuth.
--
-- ## What OAuth means for a system with exactly one user
--
-- Most of the ceremony exists to protect a user from an application acting in
-- their name without consent. Here there is one user, one browser, and one
-- password he already has (the Team HQ one). So the flow is the standard one
-- with the consent step being what it always is — a page that asks him — and
-- nothing invented around it:
--
--   1. ChatGPT registers itself (RFC 7591 dynamic registration) and gets a
--      client id. No secret: it is a public client using PKCE.
--   2. It sends him to `/authorize`, which shows a page naming the client and
--      asking for the HQ password.
--   3. Correct password, and he is redirected back with a one-time code.
--   4. ChatGPT exchanges the code plus its PKCE verifier for an access token.
--
-- Every step is the RFC. The only local decision is that the password is the
-- Team HQ one rather than a second credential to remember.
--
-- ## Why the codes table is not just "a column on mcp_clients"
--
-- An authorization code is a different object with a different lifetime: it is
-- single-use, expires in a minute, is bound to a redirect URI and a PKCE
-- challenge, and must be usable exactly once even if two requests arrive at the
-- same moment. Hanging that on the client row would make "has this code been
-- redeemed" a question about a client rather than about a code, and the answer
-- would be wrong the first time two tabs were open.
--
-- ## PKCE is required, not optional
--
-- `code_challenge_methods_supported` advertises S256 only. A public client with
-- no secret and no PKCE is a client whose authorization code is a bearer token
-- for anyone who can see a redirect — and a redirect goes through a browser.

begin;

-- --------------------------------------------------------------------------
-- Clients that registered themselves
-- --------------------------------------------------------------------------

create table public.mcp_oauth_clients (
  client_id        text        primary key,
  client_name      text        not null,
  -- Where a code may be sent back to. Checked exactly, never by prefix: a
  -- prefix match on a redirect URI is how an open redirector becomes a token
  -- thief.
  redirect_uris    text[]      not null,
  -- Public clients only. There is no secret to store, and storing an empty one
  -- would invite a future reader to treat its absence as a bug.
  created_at       timestamptz not null default app.now_utc(),
  last_used_at     timestamptz,

  constraint mcp_oauth_clients_has_a_redirect
    check (array_length(redirect_uris, 1) >= 1)
);

/**
 * Every redirect is https, or localhost for a desktop client's loopback.
 *
 * A trigger rather than a check constraint, because a check constraint may not
 * contain a subquery and there is no array operator for "every element matches
 * this pattern". The registration function checks it too; this is the one that
 * cannot be bypassed by a future caller that forgets, and the rule matters —
 * a plain-http redirect carries an authorization code over the wire in clear.
 */
create or replace function app.mcp_redirects_are_safe()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if exists (
    select 1 from unnest(new.redirect_uris) u
     where u !~ '^https://' and u !~ '^http://localhost(:[0-9]+)?(/|$)'
  ) then
    raise exception 'every redirect_uri must be https, or http://localhost for a loopback client'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger mcp_oauth_clients_redirects_are_safe
  before insert or update on public.mcp_oauth_clients
  for each row execute function app.mcp_redirects_are_safe();

comment on table public.mcp_oauth_clients is
  'Clients that registered themselves under RFC 7591. Public clients using '
  'PKCE - there is no secret, which is why there is no column for one.';

-- --------------------------------------------------------------------------
-- Codes in flight
-- --------------------------------------------------------------------------

create table public.mcp_auth_codes (
  code_sha256      text        primary key,
  client_id        text        not null references public.mcp_oauth_clients (client_id),
  redirect_uri     text        not null,
  -- S256 only; the method is not stored because only one is accepted and a
  -- column that can only hold one value is a column that will eventually hold
  -- another.
  code_challenge   text        not null,
  scope            text        not null default 'read write',
  resource         text,
  issued_at        timestamptz not null default app.now_utc(),
  expires_at       timestamptz not null default app.now_utc() + interval '2 minutes',
  redeemed_at      timestamptz,

  constraint mcp_auth_codes_is_a_hash check (code_sha256 ~ '^[0-9a-f]{64}$'),
  constraint mcp_auth_codes_expires_after_issue check (expires_at > issued_at)
);

create index mcp_auth_codes_expiry on public.mcp_auth_codes (expires_at);

comment on table public.mcp_auth_codes is
  'One-time authorization codes, by hash. Single-use is enforced by the '
  'redemption UPDATE rather than by a read-then-write, so two tabs racing the '
  'same code produce one token and one failure rather than two tokens.';

-- --------------------------------------------------------------------------
-- Registration
-- --------------------------------------------------------------------------

create or replace function app.mcp_register_client(
  p_client_name   text,
  p_redirect_uris text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id text;
begin
  if coalesce(array_length(p_redirect_uris, 1), 0) = 0 then
    return jsonb_build_object('error', 'invalid_redirect_uri');
  end if;
  if exists (select 1 from unnest(p_redirect_uris) u
              where u !~ '^https://' and u !~ '^http://localhost') then
    return jsonb_build_object('error', 'invalid_redirect_uri');
  end if;

  v_id := 'mcpc_' || encode(gen_random_bytes(12), 'hex');

  insert into public.mcp_oauth_clients (client_id, client_name, redirect_uris)
  values (v_id, coalesce(nullif(trim(p_client_name), ''), 'unnamed client'), p_redirect_uris);

  return jsonb_build_object(
    'client_id', v_id,
    'client_name', coalesce(nullif(trim(p_client_name), ''), 'unnamed client'),
    'redirect_uris', to_jsonb(p_redirect_uris),
    'token_endpoint_auth_method', 'none',
    'grant_types', jsonb_build_array('authorization_code', 'refresh_token'),
    'response_types', jsonb_build_array('code')
  );
end;
$$;

-- --------------------------------------------------------------------------
-- Issuing a code
-- --------------------------------------------------------------------------

create or replace function app.mcp_issue_code(
  p_client_id      text,
  p_redirect_uri   text,
  p_code_sha256    text,
  p_code_challenge text,
  p_resource       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uris text[];
begin
  select redirect_uris into v_uris
    from public.mcp_oauth_clients where client_id = p_client_id;
  if v_uris is null then
    return jsonb_build_object('error', 'invalid_client');
  end if;
  -- Exact membership. A prefix match here is how an open redirector becomes a
  -- token thief.
  if not (p_redirect_uri = any(v_uris)) then
    return jsonb_build_object('error', 'invalid_redirect_uri');
  end if;

  insert into public.mcp_auth_codes
    (code_sha256, client_id, redirect_uri, code_challenge, resource)
  values (p_code_sha256, p_client_id, p_redirect_uri, p_code_challenge, p_resource);

  update public.mcp_oauth_clients set last_used_at = app.now_utc()
   where client_id = p_client_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- --------------------------------------------------------------------------
-- Redeeming it
-- --------------------------------------------------------------------------

/**
 * Redeem a code once, and mint the access token in the same transaction.
 *
 * The UPDATE ... WHERE redeemed_at is null IS the lock: a second request for
 * the same code changes no rows and is refused. A read-then-write would let two
 * tabs both succeed, which is the classic authorization-code replay.
 *
 * The token itself is generated by the caller and passed in as a hash — the
 * database never sees it, exactly as `mcp_clients` has always worked.
 */
create or replace function app.mcp_redeem_code(
  p_code_sha256  text,
  p_client_id    text,
  p_redirect_uri text,
  p_token_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  c public.mcp_auth_codes;
  v_name text;
begin
  update public.mcp_auth_codes
     set redeemed_at = app.now_utc()
   where code_sha256 = p_code_sha256
     and redeemed_at is null
     and expires_at > app.now_utc()
     and client_id = p_client_id
     and redirect_uri = p_redirect_uri
  returning * into c;

  if not found then
    return jsonb_build_object('error', 'invalid_grant');
  end if;

  select client_name into v_name
    from public.mcp_oauth_clients where client_id = p_client_id;

  -- One row per OAuth client in `mcp_clients`, reusing the table the endpoint
  -- already authenticates against. A second authentication path would be a
  -- second thing to get wrong, and this one is already tested.
  insert into public.mcp_clients (client_id, display_name, token_sha256, scopes)
  values (p_client_id, coalesce(v_name, 'OAuth client'), p_token_sha256,
          string_to_array(c.scope, ' '))
  on conflict (client_id) do update
    set token_sha256 = excluded.token_sha256,
        display_name = excluded.display_name,
        scopes = excluded.scopes,
        enabled = true,
        disabled_reason = null;

  return jsonb_build_object('ok', true, 'scope', c.scope);
end;
$$;

/** The PKCE challenge a code was issued against, for the token endpoint. */
create or replace function app.mcp_code_challenge(p_code_sha256 text)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select code_challenge from public.mcp_auth_codes
   where code_sha256 = p_code_sha256
     and redeemed_at is null
     and expires_at > app.now_utc()
$$;

/** Housekeeping: a code nobody redeemed is rubbish after a few minutes. */
create or replace function app.mcp_expire_codes()
returns integer
language sql
security definer
set search_path = public, pg_catalog
as $$
  with gone as (
    delete from public.mcp_auth_codes
     where expires_at < app.now_utc() - interval '1 hour'
    returning 1
  )
  select count(*)::integer from gone
$$;

create or replace function public.mcp_register_client(p_client_name text, p_redirect_uris text[])
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.mcp_register_client(p_client_name, p_redirect_uris) $$;

create or replace function public.mcp_issue_code(
  p_client_id text, p_redirect_uri text, p_code_sha256 text,
  p_code_challenge text, p_resource text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.mcp_issue_code(p_client_id, p_redirect_uri, p_code_sha256, p_code_challenge, p_resource) $$;

create or replace function public.mcp_redeem_code(
  p_code_sha256 text, p_client_id text, p_redirect_uri text, p_token_sha256 text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.mcp_redeem_code(p_code_sha256, p_client_id, p_redirect_uri, p_token_sha256) $$;

create or replace function public.mcp_code_challenge(p_code_sha256 text)
returns text language sql stable security definer set search_path = public, pg_catalog
as $$ select app.mcp_code_challenge(p_code_sha256) $$;

commit;
