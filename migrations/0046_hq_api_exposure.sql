-- 0046 — the four wrappers the endpoint can actually reach
--
-- The same exposure problem 0042 hit, applied before it could bite rather than
-- after: PostgREST serves only the schemas it is configured for, `app` is not
-- one of them, and an RPC into it fails. In 0042 that failure was silent for a
-- while because the caller swallowed it; here it would have been a 502 on every
-- dashboard load, which is louder but no less avoidable.
--
-- Wrappers only. The projections stay in `app` with the rest of the logic, and
-- exposing the whole internal schema to fix four calls would put every function
-- in it one anon key away from the internet.

begin;

create or replace function public.hq_overview()
returns jsonb language sql security definer set search_path = '' as $$ select app.hq_overview() $$;

create or replace function public.hq_staff()
returns jsonb language sql security definer set search_path = '' as $$ select app.hq_staff() $$;

create or replace function public.hq_usage()
returns jsonb language sql security definer set search_path = '' as $$ select app.hq_usage() $$;

create or replace function public.hq_activity(p_limit integer default 50)
returns jsonb language sql security definer set search_path = '' as $$ select app.hq_activity(p_limit) $$;

comment on function public.hq_overview() is
  'Exposure wrapper for the Team HQ endpoint. Logic is in app.hq_overview; the '
  'app schema is deliberately not exposed to PostgREST.';

-- service_role only. Emphatically NOT anon: the endpoint holds the bearer token
-- and does the authorising, and a function anon can call is a function the
-- internet can call.
revoke all on function public.hq_overview() from public;
revoke all on function public.hq_staff() from public;
revoke all on function public.hq_usage() from public;
revoke all on function public.hq_activity(integer) from public;

grant execute on function public.hq_overview() to service_role;
grant execute on function public.hq_staff() to service_role;
grant execute on function public.hq_usage() to service_role;
grant execute on function public.hq_activity(integer) to service_role;

commit;
