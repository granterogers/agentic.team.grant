-- Signing a browser in without pasting a credential into it.
--
-- WHAT WAS WRONG. One bearer token is the whole of the authorisation here and
-- that is a hard constraint, not a preference. The way it reached a browser
-- was `npm run hq:token`, whose own message says it: "Access token -- paste it
-- once, per device." So the normal sign-in was a credential travelling through
-- a chat log, a clipboard and a password field, and Grant met it as an
-- interruption he never asked for -- "Couldn't reach the office, browser's not
-- signed in" and "Read only, no token in this browser" -- in front of Chat,
-- Voice, Settings, appearance and every write.
--
-- WHAT THIS CHANGES. Not the credential and not the check: `hq-api` still
-- compares one bearer token in constant time, and rotating one vault row still
-- rotates everything. What changes is the last mile. A browser asks to be let
-- in, the office shows Grant the request on the channel that already knows who
-- he is, he taps once, and the browser is handed the same token it would have
-- been pasted. The credential never appears on a screen, in a chat log or in a
-- clipboard, so this is strictly less exposure than the paste it replaces.
--
-- WHY THE CODE IS ON BOTH ENDS. Anybody who can reach the page can start a
-- request, and a request Grant did not start is a request to sign somebody
-- else's browser in. The page shows a six-character code, the message carries
-- the same code, and the message asks him to tap only if they match. That is
-- the standard defence and it is the whole reason a code exists at all -- it
-- is not a second secret, it is something to compare.
--
-- WHAT A ROW HERE IS WORTH. Nothing, by itself. `approve_secret` is the only
-- material in the table and it goes out over Telegram to one chat; the token
-- is never stored here. A claimed or expired row is spent.

create table if not exists public.sign_in_requests (
  request_id      uuid primary key default gen_random_uuid(),
  code            text not null,
  approve_secret  text not null unique,
  asked_from      text not null default '',
  started_at      timestamptz not null default app.now_utc(),
  expires_at      timestamptz not null,
  approved_at     timestamptz,
  claimed_at      timestamptz,
  constraint sign_in_requests_code_shape check (code ~ '^[A-Z0-9]{6}$'),
  -- Claimed implies approved. A browser cannot be handed the token on the
  -- strength of a row nobody ever said yes to.
  constraint sign_in_requests_claim_needs_approval
    check (claimed_at is null or approved_at is not null)
);

create index if not exists sign_in_requests_started
  on public.sign_in_requests (started_at desc);

comment on table public.sign_in_requests is
  'One browser asking to be signed in. Holds no credential: the token is never '
  'written here, only handed back once by the signin function when this row '
  'says a human approved it.';

-- Ask. Returns everything the caller needs to send the message and nothing it
-- does not: the secret goes to Telegram, the code goes to the screen, and the
-- request id goes to the browser that is waiting.
create or replace function app.sign_in_begin(p_asked_from text default '')
returns table (
  request_id uuid,
  code text,
  approve_secret text,
  chat_id text,
  bot_id text,
  bot_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_recent integer;
  v_code text;
  v_row public.sign_in_requests;
begin
  -- A rate limit, because this endpoint is unauthenticated by construction and
  -- every call rings Grant's phone. Six pending asks in an hour is far more
  -- than a person signing a device in ever needs and far less than a nuisance.
  select count(*) into v_recent
    from public.sign_in_requests
   where started_at > app.now_utc() - interval '1 hour'
     and claimed_at is null;
  if v_recent >= 6 then
    raise exception 'too many sign-in requests in the last hour'
      using errcode = '53400';
  end if;

  -- No I, O, 0 or 1: this is read off one screen and compared with another.
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                           1 + floor(random() * 32)::int, 1), '')
    into v_code
    from generate_series(1, 6);

  insert into public.sign_in_requests (code, approve_secret, asked_from, expires_at)
  values (
    v_code,
    encode(extensions.gen_random_bytes(32), 'hex'),
    left(coalesce(p_asked_from, ''), 120),
    app.now_utc() + interval '5 minutes'
  )
  returning * into v_row;

  return query
    select v_row.request_id,
           v_row.code,
           v_row.approve_secret,
           app.telegram_chat_for('grant', b.bot_id)::text,
           b.bot_id::text,
           app.resolve_secret(b.token_ref),
           v_row.expires_at
      from public.telegram_bots b
     where b.is_pager and b.enabled and b.token_ref is not null
     limit 1;
end;
$fn$;

comment on function app.sign_in_begin(text) is
  'Start a browser sign-in. Returns the pager bot and chat so the caller can '
  'send the request to Grant; the approve secret goes only into that message.';

-- Approve, from the tap. Idempotent: tapping the link twice is a person
-- checking it worked, not an error, so it says ok both times.
create or replace function app.sign_in_approve(p_secret text)
returns table (ok boolean, code text, reason text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.sign_in_requests;
begin
  select * into v_row from public.sign_in_requests
   where approve_secret = p_secret;
  if not found then
    return query select false, ''::text, 'that link is not one of ours'::text;
    return;
  end if;
  if v_row.claimed_at is not null then
    return query select true, v_row.code, 'already signed in'::text;
    return;
  end if;
  if v_row.expires_at < app.now_utc() then
    return query select false, v_row.code, 'that request has expired'::text;
    return;
  end if;
  update public.sign_in_requests
     set approved_at = coalesce(approved_at, app.now_utc())
   where request_id = v_row.request_id;
  return query select true, v_row.code, 'approved'::text;
end;
$fn$;

comment on function app.sign_in_approve(text) is
  'Grant tapped the link. Marks the request approved; hands back nothing.';

-- Claim, from the waiting browser. Single use: the row is spent by the first
-- caller, so a request id that leaks after the fact is worth nothing.
create or replace function app.sign_in_claim(p_request uuid)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.sign_in_requests;
begin
  select * into v_row from public.sign_in_requests where request_id = p_request;
  if not found then
    return query select false, 'unknown'::text;
    return;
  end if;
  if v_row.claimed_at is not null then
    return query select false, 'spent'::text;
    return;
  end if;
  if v_row.expires_at < app.now_utc() then
    return query select false, 'expired'::text;
    return;
  end if;
  if v_row.approved_at is null then
    return query select false, 'waiting'::text;
    return;
  end if;
  update public.sign_in_requests
     set claimed_at = app.now_utc()
   where request_id = v_row.request_id;
  return query select true, 'signed in'::text;
end;
$fn$;

comment on function app.sign_in_claim(uuid) is
  'The waiting browser collects an approved request, once. The caller is what '
  'holds the token; this only says whether handing it over is allowed.';

-- Sweep. A spent or expired ask is not history anybody needs.
create or replace function app.sign_in_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_gone integer;
begin
  delete from public.sign_in_requests
   where started_at < app.now_utc() - interval '1 day';
  get diagnostics v_gone = row_count;
  return v_gone;
end;
$fn$;

-- The wrappers. PostgREST only exposes `public`, and the signin function
-- reaches these with the service key.
--
-- `sign_in_begin` hands back a bot token, so it must not be reachable by anon.
-- The pattern is 0403's and 0411's: withdraw the default execute privilege
-- first, because naming service_role alone would leave it in place.
create or replace function public.sign_in_begin(p_asked_from text default '')
returns table (
  request_id uuid, code text, approve_secret text,
  chat_id text, bot_id text, bot_token text, expires_at timestamptz
)
language sql security definer set search_path = ''
as $$ select * from app.sign_in_begin(p_asked_from) $$;

revoke all on function public.sign_in_begin(text) from public, anon, authenticated;
grant execute on function public.sign_in_begin(text) to service_role;

create or replace function public.sign_in_approve(p_secret text)
returns table (ok boolean, code text, reason text)
language sql security definer set search_path = ''
as $$ select * from app.sign_in_approve(p_secret) $$;

revoke all on function public.sign_in_approve(text) from public, anon, authenticated;
grant execute on function public.sign_in_approve(text) to service_role;

create or replace function public.sign_in_claim(p_request uuid)
returns table (ok boolean, reason text)
language sql security definer set search_path = ''
as $$ select * from app.sign_in_claim(p_request) $$;

revoke all on function public.sign_in_claim(uuid) from public, anon, authenticated;
grant execute on function public.sign_in_claim(uuid) to service_role;

create or replace function public.sign_in_sweep()
returns integer
language sql security definer set search_path = ''
as $$ select app.sign_in_sweep() $$;

revoke all on function public.sign_in_sweep() from public, anon, authenticated;
grant execute on function public.sign_in_sweep() to service_role;

-- Nobody reads this table over PostgREST. The approve secret is the one piece
-- of material in it and it belongs in one Telegram message.
revoke all on table public.sign_in_requests from anon, authenticated;
