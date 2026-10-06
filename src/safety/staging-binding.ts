/**
 * A staging command is bound to the staging identity the preflight attested.
 *
 * The production-access guard recognises Supabase and Vercel hosts, so `ALLOW_PRODUCTION_CHECKS=1` opens a staging project
 * and the production one alike. This module is the other half: in a shell that says it is staging
 * (`TARGET_ENVIRONMENT=staging`) a flag is not enough. `npm run staging:preflight` writes an attestation of WHICH staging
 * it checked (project ref, gateway, worker, storage and database hosts, site, and the named OAuth client, bot, workspace and
 * Vikunja), and every later contact must still match it:
 *
 *   - no attestation, an expired one, or one that is not this version: refused;
 *   - the environment no longer names the identity that was attested (the ref was changed, a gateway address was swapped):
 *     refused, and the message names the FIELDS that drifted, never their values;
 *   - the thing actually being contacted (a Management API path, a `<ref>.supabase.co` host, a database host, a Vercel
 *     page) is not the attested project or site: refused, even when both ALLOW flags are set. This is what stops a script
 *     that falls back to the production ref (`process.env.SUPABASE_PROJECT_REF ?? '<production>'`) from reaching it.
 *
 * Pure and dependency-free: it reads no file (the gate hands it the attestation) and contacts nothing. It holds
 * identifiers only: no token, no key, no password, and a database URL is reduced to its host.
 */

export type Env = Readonly<Record<string, string | undefined>>

export const ATTESTATION_VERSION = 1
export const ATTESTATION_HOURS = 8
export const DEFAULT_ATTESTATION_FILE = '.staging/attestation.json'

/** The identity fields, in the order they are reported. */
export const IDENTITY_FIELDS = [
  'ref',
  'gateway',
  'worker',
  'storage',
  'database_host',
  'site',
  'google_client',
  'telegram_bot',
  'slack_team',
  'vikunja',
] as const
export type IdentityField = (typeof IDENTITY_FIELDS)[number]
export type Identity = Readonly<Record<IdentityField, string>>

export interface Attestation {
  readonly version: number
  readonly identity: Identity
  readonly created_at: string
  readonly expires_at: string
}

const trim = (v: string | undefined): string => (v ?? '').trim()

const hostOnly = (url: string): string => {
  if (url === '') return ''
  try {
    return new URL(url.replace(/^postgres(ql)?:/, 'http:')).hostname.toLowerCase()
  } catch {
    return 'unparseable'
  }
}

/** What the environment says staging is, as identifiers only. Empty string for a field that is unset. */
export const identityOf = (env: Env): Identity => ({
  ref: trim(env.SUPABASE_PROJECT_REF),
  gateway: trim(env.STAGING_GATEWAY_URL),
  worker: trim(env.STAGING_WORKER_URL),
  storage: trim(env.STAGING_STORAGE_URL),
  database_host: hostOnly(trim(env.SUPABASE_DB_URL)),
  site: trim(env.STAGING_SITE_URL),
  google_client: trim(env.STAGING_GOOGLE_CLIENT_ID),
  telegram_bot: trim(env.STAGING_TELEGRAM_BOT),
  slack_team: trim(env.STAGING_SLACK_TEAM),
  vikunja: trim(env.STAGING_VIKUNJA_URL),
})

export const attest = (env: Env, now: number): Attestation => ({
  version: ATTESTATION_VERSION,
  identity: identityOf(env),
  created_at: new Date(now).toISOString(),
  expires_at: new Date(now + ATTESTATION_HOURS * 3_600_000).toISOString(),
})

/** Is this shell one that says it is staging? Only such a shell is bound. */
export const isStagingShell = (env: Env): boolean => trim(env.TARGET_ENVIRONMENT) === 'staging'

export const driftedFields = (attested: Identity, env: Env): IdentityField[] => {
  const now = identityOf(env)
  return IDENTITY_FIELDS.filter((f) => attested[f] !== now[f])
}

const siteHost = (site: string): string => {
  try {
    return new URL(site).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Is `target` (a URL, or a database connection string) the attested project or site? Returns the reason it is not, or null.
 * Hosts and paths the binding has no opinion on (a model provider, a fake local base URL) are not its business: the
 * production gate decides whether they need a flag at all.
 */
export const targetProblem = (target: string, identity: Identity): string | null => {
  const ref = identity.ref
  if (ref === '') return 'the attestation names no project'
  let host = ''
  let path = ''
  try {
    const u = new URL(target.replace(/^postgres(ql)?:/, 'http:'))
    host = u.hostname.toLowerCase()
    path = u.pathname
  } catch {
    return 'the target could not be read, so it cannot be shown to be the attested staging project'
  }
  if (/(^|\.)supabase\.co$/.test(host) || /(^|\.)supabase\.in$/.test(host)) {
    return host.startsWith(`${ref}.`) || host.includes(`.${ref}.`) || target.includes(`.${ref}`)
      ? null
      : `the Supabase address ${host} is not the attested staging project`
  }
  if (/(^|\.)pooler\.supabase\.com$/.test(host)) {
    return target.includes(ref)
      ? null
      : 'the database pooler address does not name the attested staging project'
  }
  if (/(^|\.)supabase\.com$/.test(host)) {
    return path.includes(`/projects/${ref}`)
      ? null
      : 'the Supabase Management API path does not name the attested staging project'
  }
  if (/(^|\.)vercel\.app$/.test(host)) {
    const want = siteHost(identity.site)
    return want !== '' && host === want ? null : `the page ${host} is not the attested staging site`
  }
  return null
}

/**
 * Why a command in this environment may not proceed, or null. `attestation` is what the gate read (null when there is
 * none), `target` what the command is about to contact, if it knows.
 */
export const bindingProblem = (
  env: Env,
  attestation: Attestation | null,
  nowMs: number,
  target?: string,
): string | null => {
  if (!isStagingShell(env)) return null
  if (attestation === null)
    return 'this shell says it is staging but no staging preflight has been attested (run: npm run staging:preflight)'
  if (attestation.version !== ATTESTATION_VERSION)
    return 'the staging attestation is from a different version of the preflight; run it again'
  const expires = Date.parse(attestation.expires_at)
  if (!Number.isFinite(expires) || expires <= nowMs)
    return 'the staging attestation has expired; run the preflight again'
  const drift = driftedFields(attestation.identity, env)
  if (drift.length > 0)
    return `the environment no longer matches the staging identity that was attested (changed: ${drift.join(', ')})`
  if (target !== undefined && target !== '') return targetProblem(target, attestation.identity)
  return null
}

export class StagingBindingRefused extends Error {
  readonly reason: string
  constructor(what: string, reason: string) {
    super(
      `REFUSED: ${what} is bound to the staging identity the preflight attested, and ${reason}. ` +
        'ALLOW_PRODUCTION_CHECKS / ALLOW_PRODUCTION_WRITES do not change this: the flags cannot tell staging from production, ' +
        'the attested identity can. Nothing was sent.',
    )
    this.name = 'StagingBindingRefused'
    this.reason = reason
  }
}
