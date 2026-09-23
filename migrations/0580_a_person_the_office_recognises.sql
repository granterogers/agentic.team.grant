-- Who the office lets in, as a fact rather than as a shared secret.
--
-- WHAT WAS WRONG, AND IT WAS NOT THE TOKEN. One bearer token is the whole of
-- the authorisation here and that is fine for the worker, the scripts and the
-- MCP endpoint: they are machines, a capability is exactly what they need, and
-- it is compared in constant time. What was wrong is that the SAME credential
-- was the only way a PERSON could get in, so a browser could only be let in by
-- somebody carrying the office's own key to it.
--
-- Grant, 24 September:
--
--   "He does not want an office-token interaction in the normal user
--    experience AT ALL. The intended experience is: OPEN AGENTIC TEAM ->
--    APPLICATION LOADS -> USER IS AUTHENTICATED -> USE APPLICATION. If an
--    internal credential/token is required for secure communication with the
--    office, that is an IMPLEMENTATION DETAIL."
--
-- WHY THIS TABLE AND NOT A NEW AUTH SYSTEM. There is already an identity
-- system in this project and it had never been used: `auth.users` holds zero
-- rows, every one of the 117 row-level policies names `ai_team_app` and not one
-- names `anon` or `authenticated`, and the browser has never spoken to PostgREST
-- at all -- it speaks to `hq-api`, which holds the service key. So the whole of
-- the change is WHICH FACT `hq-api` checks before it answers, and this table is
-- that fact: a short list of the people whose session the office recognises.
--
-- It is deliberately NOT a copy of `auth.users`. Supabase owns who has proved
-- an email address; this owns who the office is willing to work for. Keeping
-- them apart is what makes "somebody signed up" and "somebody is allowed in"
-- two different questions, which is the property that survives signup ever
-- being open again by accident.
--
-- ADR-0043.

create table if not exists public.office_members (
  email       text primary key,
  note        text not null default '',
  added_at    timestamptz not null default app.now_utc(),
  -- The name `dashboard_layouts.owner` already uses (ADR-0021), so a person
  -- and their arrangement can finally be the same person rather than a column
  -- defaulted to the string 'grant'.
  owner_key   text not null default 'grant',
  constraint office_members_email_shape check (email = lower(btrim(email)) and email like '%@%')
);

comment on table public.office_members is
  'The people whose authenticated session the office will answer. Not a copy '
  'of auth.users: that says who proved an address, this says who is allowed.';

-- One seeded member: the address the office already corresponds from, which it
-- knows from its own mail rather than from anything typed here. A second
-- address of Grant's was seeded at first and `check:secrets` refused the file,
-- correctly -- it matches a value in this environment, and a repository is the
-- wrong place for somebody's contact details whether or not they are secret.
-- Anybody else he wants let in is a row he adds, not a migration.
insert into public.office_members (email, note, owner_key) values
  ('grant.e.rogers@gmail.com', 'the address the office already corresponds from', 'grant')
on conflict (email) do nothing;

-- Is this session a person the office knows? One question, one place, so the
-- gateway cannot answer it slightly differently from anything else that asks.
create or replace function app.office_member(p_email text)
returns table (ok boolean, owner_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select true, m.owner_key
    from public.office_members m
   where m.email = lower(btrim(coalesce(p_email, '')))
   union all
  select false, null::text
   where not exists (
     select 1 from public.office_members m2
      where m2.email = lower(btrim(coalesce(p_email, '')))
   )
  limit 1
$$;

comment on function app.office_member(text) is
  'Whether an authenticated address belongs to somebody the office works for, '
  'and which owner key their stored state hangs off.';

create or replace function public.office_member(p_email text)
returns table (ok boolean, owner_key text)
language sql security definer set search_path = ''
as $$ select * from app.office_member(p_email) $$;

-- Only the gateway asks this, with the service key. An anonymous caller that
-- could ask "is this address allowed" is an address oracle, and there is no
-- reason for one to exist.
revoke all on function public.office_member(text) from public, anon, authenticated;
grant execute on function public.office_member(text) to service_role;

revoke all on table public.office_members from anon, authenticated;
