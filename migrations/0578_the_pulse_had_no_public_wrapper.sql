-- The section the page asks for on every load, and could never reach.
--
-- `hq-api?section=pulse` answered **502 on every dashboard page load**.
-- `app.hq_pulse` existed and worked; `public.hq_pulse` never did, and PostgREST
-- only exposes `public` -- which is the first entry in CLAUDE.md's own list of
-- traps, paid for again by the one section built to be cheap enough to poll.
--
-- WHY NOTHING CAUGHT IT. `verify:pulse` passed 11/11 by calling
-- `app.hq_pulse()` in SQL, which is `verify:search`'s recorded defect exactly:
-- a suite that skips the layer the defect lives in. `verify:wrappers` passed
-- 43/43 because `hq_pulse` was not on its hardcoded list -- an enumeration of
-- the things somebody thought to write down, which is the shape this file keeps
-- warning about. Only a browser at the real deployed origin ever saw it.
--
-- The standing check is `npm run check:gateway-wrappers`, which asks the
-- property instead: the `fn:` entries in the gateway's own routing maps ARE the
-- list a browser can reach, so a future section cannot silently lack a wrapper.
-- It found this one among 147.
--
-- Issue #340.

create or replace function public.hq_pulse()
returns jsonb
language sql
security definer
set search_path = ''
as $$ select app.hq_pulse() $$;

comment on function public.hq_pulse() is
  'The cheap poll the dashboard makes on every load. A wrapper, because '
  'PostgREST only exposes public and app.hq_pulse alone answered 502.';

grant execute on function public.hq_pulse() to anon, authenticated, service_role;
