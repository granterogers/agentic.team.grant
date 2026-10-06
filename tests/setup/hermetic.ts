/**
 * The unit suite runs with NO production credential, whatever the shell holds (deep systems audit, test hermeticity).
 *
 * `npm test` must be safely runnable on a machine that has production credentials in its environment AND on one that
 * has none, and must give the same answer on both. A test that is green only because a real token happened to be
 * present (or red only because it was absent) is a test of the shell, and a unit test that is handed a live credential is
 * one typo away from using it. So every test file starts from an environment with the production credentials removed:
 * a test that needs a value sets its own, visibly, inside the test.
 *
 * Removed, not masked: `tests/safety/hermetic.test.ts` asserts the property from inside a test.
 */
export const PRODUCTION_ENV: readonly string[] = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'HQ_API_TOKEN',
  'HQ_MANAGEMENT_TOKEN',
  'ALLOW_PRODUCTION_CHECKS',
  'ALLOW_PRODUCTION_WRITES',
  'ALLOW_UNPROVENANCED_DEPLOY',
]

for (const name of PRODUCTION_ENV) delete process.env[name]
