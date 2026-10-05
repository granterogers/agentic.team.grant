/**
 * The production-access gate.
 *
 * A previous autonomous run executed read-only production catalogue queries (`check:gateway-wrappers`, possibly
 * `check:callers` and `check:consumed`) for no better reason than that production credentials existed in its
 * environment. Having a credential is not the same as having been asked to use it, so this module makes the default
 * the safe one: **a Node process that is about to reach production is refused unless a person said so.**
 *
 *   ALLOW_PRODUCTION_CHECKS=1   any contact with production (reads, catalogue queries, the deployed gateway)
 *   ALLOW_PRODUCTION_WRITES=1   in addition to the above, anything that writes or deploys (deploy:*, migrate, purge:*)
 *
 * Only the exact string "1" counts; "true", "yes" and an empty value do not. Writes never imply checks and checks never
 * imply writes: a write needs BOTH flags.
 *
 * What counts as production is a property of the TARGET, not of the credentials: the Supabase Management API, any
 * `*.supabase.co` project host, the Vercel deployment, a Postgres host that is not this machine. A Unix-socket Postgres
 * (the local replica `scripts/isolated/guard.ts` insists on), localhost and a test server are never production.
 *
 * Inert inside Deno (the edge worker, which IS the production office) and where there is no `process`: this gate protects
 * the build sessions and operators, it must never stop the office from running itself. It reaches the environment only
 * through `globalThis`, so the Deno bundle has no import to resolve.
 *
 * This module is the single definition. `src/db/executor.ts`, `src/db/pg-executor.ts` and the fetch guard installed by
 * `src/safety/arm.ts` all ask it; nothing else decides.
 */

export const ENV_CHECKS = 'ALLOW_PRODUCTION_CHECKS'
export const ENV_WRITES = 'ALLOW_PRODUCTION_WRITES'

/** The one place the list of production hosts lives. Everything else asks `isProductionUrl`. */
const PRODUCTION_HOST = [
  /(^|\.)supabase\.com$/i, // api.supabase.com, the Management API
  /(^|\.)supabase\.co$/i, // <ref>.supabase.co, REST, functions and storage
  /(^|\.)supabase\.in$/i,
  /(^|\.)pooler\.supabase\.com$/i,
  /(^|\.)vercel\.app$/i, // the deployed pages
]

/** The project ref is public and appears in hostnames and in Management API paths. */
const PRODUCTION_REF = 'baujwlzcziasnfhhkchg'

type Env = Record<string, string | undefined>

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0|.*\.localhost|.*\.local)$/i

const processEnv = (): Env | null => {
  const g = globalThis as { Deno?: unknown; process?: { env?: Env } }
  if (g.Deno !== undefined) return null
  return g.process?.env ?? null
}

/**
 * Is this process a command started from `scripts/`? The entry-level modules (`require-production-*`) enforce only then:
 * a unit test that imports a script's exported helpers is not a command, and must not need a flag. The executor and the
 * fetch guard still refuse every actual contact with production, whoever started the process.
 */
export const isScriptEntry = (
  argv1: string | undefined = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1],
): boolean => argv1 !== undefined && /(^|[\\/])scripts[\\/].+\.(ts|mts|js|mjs|cjs)$/.test(argv1)

/** True where the gate applies at all: a Node-like process, never Deno. */
export const gateApplies = (): boolean => processEnv() !== null

const flag = (env: Env, name: string): boolean => env[name] === '1'

export const productionChecksAllowed = (env: Env | null = processEnv()): boolean =>
  env === null || flag(env, ENV_CHECKS)

export const productionWritesAllowed = (env: Env | null = processEnv()): boolean =>
  env === null || (flag(env, ENV_CHECKS) && flag(env, ENV_WRITES))

/** Hosts named by the environment (SUPABASE_URL, HQ_API_URL, the DB URL) count as production too, when they are remote. */
const envHosts = (env: Env | null): string[] => {
  if (env === null) return []
  const hosts: string[] = []
  for (const name of ['SUPABASE_URL', 'HQ_API_URL', 'HQ_URL', 'SUPABASE_DB_URL', 'DATABASE_URL']) {
    const v = env[name]
    if (v === undefined || v === '') continue
    try {
      hosts.push(new URL(v).hostname)
    } catch {
      // not a URL; ignored
    }
  }
  return hosts.filter((h) => !LOCAL_HOST.test(h))
}

/** Does this URL (or host) name production? Local hosts never do. */
export const isProductionUrl = (url: string, env: Env | null = processEnv()): boolean => {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }
  if (LOCAL_HOST.test(host)) return false
  if (PRODUCTION_HOST.some((re) => re.test(host))) return true
  if (url.includes(PRODUCTION_REF)) return true
  return envHosts(env).includes(host)
}

/**
 * Is this Postgres target somewhere other than this machine? A Unix socket (`host=/…` or `@/db`) has no peer at all,
 * so it can only be local. No connection string means the PG* environment decides.
 */
export const isRemotePgTarget = (
  connection: string | undefined,
  env: Env | null = processEnv(),
): boolean => {
  if (connection === undefined || connection === '') {
    const host = env?.PGHOST ?? ''
    return host === '' ? false : !(host.startsWith('/') || LOCAL_HOST.test(host))
  }
  if (/[?&]host=\//.test(connection) || /@\/[^/]*($|\?)/.test(connection)) return false
  try {
    const u = new URL(connection)
    if (u.hostname === '') return false
    return !LOCAL_HOST.test(u.hostname)
  } catch {
    return true // unparseable is not permission
  }
}

export class ProductionAccessRefused extends Error {
  readonly what: string
  readonly level: 'checks' | 'writes'
  constructor(what: string, level: 'checks' | 'writes') {
    super(refusalMessage(what, level))
    this.name = 'ProductionAccessRefused'
    this.what = what
    this.level = level
  }
}

/** The sentence a person reads. It says what was refused, why, and exactly how to mean it. */
export const refusalMessage = (what: string, level: 'checks' | 'writes'): string => {
  const how =
    level === 'writes'
      ? `${ENV_CHECKS}=1 ${ENV_WRITES}=1 <the same command>`
      : `${ENV_CHECKS}=1 <the same command>`
  return (
    `REFUSED: ${what} would contact PRODUCTION (${level === 'writes' ? 'a write or deploy' : 'a read'}). ` +
    'Having Supabase credentials in the environment is not permission: an earlier autonomous run touched the real office ' +
    'by accident because they were there, so production access is off unless a person turns it on. ' +
    `To do this on purpose, run it as: ${how}. ` +
    'Nothing was sent. Local work (the replica in scripts/isolated, unit tests, the static studio) needs no flag.'
  )
}

/** Throws unless production reads were intentionally enabled. No-op in Deno. */
export const assertProductionChecksAllowed = (
  what: string,
  env: Env | null = processEnv(),
): void => {
  if (productionChecksAllowed(env)) return
  throw new ProductionAccessRefused(what, 'checks')
}

/** Throws unless BOTH flags were set. A write needs the stronger, second confirmation. */
export const assertProductionWritesAllowed = (
  what: string,
  env: Env | null = processEnv(),
): void => {
  if (productionWritesAllowed(env)) return
  throw new ProductionAccessRefused(what, 'writes')
}

/** Management API paths that change the project rather than read it, whatever the method. */
const ADMIN_WRITE_PATH =
  /\/v1\/projects\/[^/]+\/(functions\/deploy|functions\/[^/]+$|secrets|config|database\/password|api-keys|branches|billing|pause|restore|network)/i

/**
 * What a request to this URL needs. A plain read of production needs checks; deploying, changing secrets or config, and any
 * PUT/PATCH/DELETE to the Management API or Vercel's API needs writes. A POST to `/database/query` is SQL of unknown effect,
 * so it asks for checks here and the scripts that write say so themselves (`require-production-writes.ts`).
 */
export const levelForRequest = (url: string, method: string): 'checks' | 'writes' => {
  const m = method.toUpperCase()
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'checks'
  }
  if (/(^|\.)supabase\.com$/i.test(u.hostname)) {
    if (ADMIN_WRITE_PATH.test(u.pathname)) return m === 'GET' || m === 'HEAD' ? 'checks' : 'writes'
    if (m === 'PUT' || m === 'PATCH' || m === 'DELETE') return 'writes'
  }
  if (/(^|\.)vercel\.com$/i.test(u.hostname) && m !== 'GET' && m !== 'HEAD') return 'writes'
  return 'checks'
}

/** The environment variables a browser-driven script reads its target site from. */
export const SITE_VARS = ['BASECAMP_SITE', 'HQ_URL', 'LIVE_HOST', 'PAGE', 'BASECAMP_URL'] as const

/**
 * A browser suite that drives a SITE reaches production through the page's own requests, which no fetch wrapper can see.
 * `defaultsToProduction`: the script falls back to a deployed URL when no variable names a site, so only an explicitly
 * LOCAL target is exempt. Otherwise the script is local unless a variable names a production host.
 */
export const assertSiteAllowed = (
  what: string,
  defaultsToProduction: boolean,
  env: Env | null = processEnv(),
): void => {
  if (env === null) return
  const named = SITE_VARS.map((n) => env[n]).filter((v): v is string => v !== undefined && v !== '')
  const withScheme = (v: string): string => (/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`)
  const production =
    named.length === 0
      ? defaultsToProduction
      : named.some((v) => isProductionUrl(withScheme(v), env))
  if (production) assertProductionChecksAllowed(what, env)
}

type FetchLike = typeof fetch

const urlOf = (input: unknown): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  const r = input as { url?: unknown }
  return typeof r?.url === 'string' ? r.url : String(input)
}

const methodOf = (input: unknown, init: unknown): string => {
  const i = init as { method?: string } | undefined
  if (i?.method !== undefined) return i.method
  const r = input as { method?: unknown }
  return typeof r?.method === 'string' ? r.method : 'GET'
}

/**
 * Wrap a fetch so a request to production is refused BEFORE it is made. `getEnv` is read on every call so a test (or a
 * person) changing the flag takes effect without re-wrapping.
 */
export const guardFetch = (inner: FetchLike, getEnv: () => Env | null = processEnv): FetchLike => {
  const guarded: FetchLike & { productionGuarded?: true } = async (input, init) => {
    const env = getEnv()
    if (env !== null) {
      const url = urlOf(input)
      if (isProductionUrl(url, env)) {
        const level = levelForRequest(url, methodOf(input, init))
        const what = `${methodOf(input, init)} ${safeOrigin(url)}`
        if (level === 'writes') assertProductionWritesAllowed(what, env)
        else assertProductionChecksAllowed(what, env)
      }
    }
    return await inner(input, init)
  }
  guarded.productionGuarded = true
  return guarded
}

/** Origin and path only: a query string can carry a key. */
const safeOrigin = (url: string): string => {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return 'a production URL'
  }
}

/** Idempotent. Replaces `globalThis.fetch` with the guarded one in a Node process; does nothing in Deno. */
export const installProductionFetchGuard = (): boolean => {
  if (!gateApplies()) return false
  const g = globalThis as { fetch?: FetchLike & { productionGuarded?: true } }
  if (typeof g.fetch !== 'function' || g.fetch.productionGuarded === true) return false
  g.fetch = guardFetch(g.fetch.bind(globalThis))
  return true
}
