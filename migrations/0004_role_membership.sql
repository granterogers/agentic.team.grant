-- 0004 — Role membership, so enforcement can be tested as the role it restrains
--
-- 0001 created `ai_team_app` NOLOGIN, on the reasoning that a role with no
-- password has no credential to leak and that `SET LOCAL ROLE` would be enough
-- to test its grants. The second half of that was wrong, and the verification
-- script found it: `SET ROLE` requires the current role to be a MEMBER of the
-- target role, so every attempt failed with
--
--   42501: permission denied to set role "ai_team_app"
--
-- which is itself `insufficient_privilege`. The verification harness matched on
-- SQLSTATE alone and reported two passes for tests that never ran. A test that
-- fails for the wrong reason and is counted as a pass is worse than no test.
--
-- Granting membership to the owner gives away nothing: `postgres` owns these
-- tables and can already do strictly more than `ai_team_app`. What it buys is
-- the ability to *prove* what the application role cannot do, as that role,
-- from a session that has no password for it.

grant ai_team_app to postgres;

comment on role ai_team_app is
  'Least-privilege application role. The deployed runtime connects as this, '
  'never as postgres or service_role. NOLOGIN until Phase 2 provides an '
  'encrypted store for its password; postgres is a member so that enforcement '
  'can be verified as this role without one existing.';
