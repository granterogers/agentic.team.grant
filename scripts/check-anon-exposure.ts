/**
 * No function in schema public can be executed with a public key (#384, 0613).
 *
 *   npm run check:anon-exposure        # production, read-only
 *
 * ## What it asks
 *
 * The anon key is public by design and `authenticated` is anybody who signs up
 * (the office admits only members, but a stranger's session is a perfectly
 * valid one - see `hq-api`'s allow-list). So the question is not "who calls
 * this" but "could a public key call it". Two independent readings, because
 * one of them has been wrong before:
 *
 *   - `has_function_privilege` for anon and authenticated, which is what
 *     PostgREST would actually be allowed to do, inheritance included;
 *   - the ACL itself, for a grant to PUBLIC (grantee 0) - which the first
 *     reading also sees, and which is named separately because it is the one
 *     a `revoke ... from anon` leaves behind (173 functions had one).
 *
 * ## Why it exists as a check and not only as the migration
 *
 * A schema-scoped ALTER DEFAULT PRIVILEGES cannot remove the built-in PUBLIC
 * default for a NEW function, so the next migration that adds a public wrapper
 * re-opens the door unless it names its grants. This is the witness that says
 * so, in the gate, the day it happens.
 *
 * ## Its own control
 *
 * A check whose happy path is "found nothing" must first prove it looked at
 * something and that it can fire. It asserts the inspected set is non-empty,
 * that service_role can execute every function it inspected (so the sweep did
 * not simply revoke everything from everybody), and that a synthetic exposed
 * row is refused by the same predicate.
 */
import { ManagementApiExecutor } from '../src/db/executor.ts'

export type FnReach = {
  readonly name: string
  readonly anon: boolean
  readonly authenticated: boolean
  readonly public: boolean
  readonly service: boolean
}

/** THE PREDICATE, named so a control can run an injected row through the same code. */
export const reachableByAPublicKey = (f: FnReach): boolean => f.anon || f.authenticated || f.public

export const EXPOSURE_SQL = `
  select p.oid::regprocedure::text as name,
         has_function_privilege('anon', p.oid, 'execute') as anon,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
         exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE') as "public",
         has_function_privilege('service_role', p.oid, 'execute') as service
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
   order by 1`

export const readReach = (rows: readonly unknown[]): FnReach[] =>
  (rows as Record<string, unknown>[]).map((r) => ({
    name: String(r.name),
    anon: r.anon === true,
    authenticated: r.authenticated === true,
    public: r.public === true,
    service: r.service === true,
  }))

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  if (token === '') {
    console.error('SUPABASE_ACCESS_TOKEN is required')
    process.exit(2)
  }
  const db = new ManagementApiExecutor('baujwlzcziasnfhhkchg', token)
  const fns = readReach((await db.execute(EXPOSURE_SQL)).rows)
  const open = fns.filter(reachableByAPublicKey)
  const noService = fns.filter((f) => !f.service)
  const control = reachableByAPublicKey({
    name: 'synthetic',
    anon: true,
    authenticated: false,
    public: false,
    service: true,
  })
  const controlPublic = reachableByAPublicKey({
    name: 'synthetic',
    anon: false,
    authenticated: false,
    public: true,
    service: true,
  })
  console.log(`inspected ${String(fns.length)} public function(s)`)
  console.log(
    `control: an anon grant is caught ${String(control)}; a PUBLIC grant is caught ${String(controlPublic)}`,
  )
  let failed = false
  if (fns.length === 0 || !control || !controlPublic) {
    console.log('FAIL the check cannot see anything, so its silence means nothing')
    failed = true
  }
  if (noService.length > 0) {
    console.log(
      `FAIL service_role cannot execute ${String(noService.length)}: ${noService
        .slice(0, 5)
        .map((f) => f.name)
        .join(', ')}`,
    )
    failed = true
  }
  if (open.length > 0) {
    console.log(`FAIL ${String(open.length)} function(s) are reachable by a public key:`)
    for (const f of open.slice(0, 40)) {
      console.log(
        `  ${f.name}  ${f.anon ? 'anon ' : ''}${f.authenticated ? 'authenticated ' : ''}${f.public ? 'PUBLIC' : ''}`,
      )
    }
  } else if (!failed) {
    console.log('ok   no public function is reachable by anon, authenticated or PUBLIC')
  }
  process.exit(failed || open.length > 0 ? 1 : 0)
}
