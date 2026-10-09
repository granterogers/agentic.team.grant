/**
 * What a public key can reach, as data: the query, the shapes it returns and the predicates over them.
 *
 * Pure and importable from anywhere. It lives here, not in scripts/check-anon-exposure.ts, because that script is a command
 * that contacts the real project and so opens with the production-access gate: a local-replica proof that imported its
 * helpers from the command was refused as if it were the command (found integrating the UX branch with p4, 5 October 2026).
 */

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

export type TableReach = {
  readonly name: string
  readonly rls: boolean
  readonly anon: boolean
  readonly authenticated: boolean
}

/** A table with no row policy that a public key can read or write (0642). */
export const tableReachableByAPublicKey = (t: TableReach): boolean =>
  !t.rls && (t.anon || t.authenticated)

export type ViewReach = {
  readonly name: string
  /** `security_invoker = true` in the view's options: the view reads its tables with the CALLER'S rights, so their row security applies. */
  readonly invoker: boolean
  readonly anon: boolean
  readonly authenticated: boolean
}

/**
 * A view a public key can select. Row security on the tables underneath does NOT protect it unless the view is `security_invoker`: a
 * view reads with its owner's rights, and the owner bypasses row security (1053, Issue #457; 0642 and this check once looked at tables
 * only and missed all fourteen).
 */
export const viewReachableByAPublicKey = (v: ViewReach): boolean =>
  !v.invoker && (v.anon || v.authenticated)

export const VIEW_EXPOSURE_SQL = `
  select c.relname as name,
         coalesce(c.reloptions::text, '') like '%security_invoker=true%' as invoker,
         has_table_privilege('anon', c.oid, 'select') as anon,
         has_table_privilege('authenticated', c.oid, 'select') as authenticated
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
   order by 1`

export const readReach = (rows: readonly unknown[]): FnReach[] =>
  (rows as Record<string, unknown>[]).map((r) => ({
    name: String(r.name),
    anon: r.anon === true,
    authenticated: r.authenticated === true,
    public: r.public === true,
    service: r.service === true,
  }))
