begin;

-- app.self_improvement_headroom() was the body of the public wrapper dropped in migration 1091. Migration 1088 took the
-- headroom off the Settings page because nothing on the page reads it. With the wrapper gone nothing calls this function
-- (checked read-only: no live function mentions it), and check:callers reports it as a capability nobody can reach. Dropped.

drop function if exists app.self_improvement_headroom();

commit;
