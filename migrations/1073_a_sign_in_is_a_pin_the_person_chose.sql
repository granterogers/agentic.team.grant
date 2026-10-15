-- A sign-in PIN, one per login (owner decision, 15 October 2026).
--
-- The table holds only what a check needs: the salt, the PBKDF2 hash of the PIN, and the wrong-try counter with its
-- lock. The PIN itself is never stored, and nothing in this table is readable by the browser roles: row security is on,
-- and anon and authenticated have no privilege at all. The sign-in function reads and writes it with the service role.
--
-- Keyed by the login's email, which is how the sign-in function finds it. No office column: a PIN belongs to a login,
-- and a login may own an office, so the table is deployment-wide by design (ownership class GLOBAL, with its reason in
-- docs/multi-user/ownership-manifest.json).

create table if not exists public.sign_in_pins (
  email text primary key,
  salt text not null,
  hash text not null,
  fails integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint sign_in_pins_email_shape
    check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  constraint sign_in_pins_salt_shape check (salt ~ '^[0-9a-f]{32}$'),
  constraint sign_in_pins_hash_shape check (hash ~ '^[0-9a-f]{64}$'),
  constraint sign_in_pins_fails_range check (fails >= 0 and fails < 5)
);

comment on table public.sign_in_pins is
  'One sign-in PIN per login: a PBKDF2-SHA256 hash and salt, and the wrong-try counter. Never the PIN. Read and written only by the sign-in function, with the service role.';

alter table public.sign_in_pins enable row level security;

revoke all on table public.sign_in_pins from public, anon, authenticated;
