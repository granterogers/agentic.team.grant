/**
 * The staging preflight: make it hard to confuse staging with production.
 *
 * Pure: it takes an environment and a denylist and returns a report. It reads no file, contacts nothing and prints nothing
 * (scripts/staging/preflight.ts does the I/O). It FAILS CLOSED: a target that is missing, ambiguous, typed two ways that
 * disagree, or that matches a known production identifier is a failure, never a warning.
 *
 * The production access guard (src/safety/production-gate.ts) recognises Supabase and Vercel hosts, so it cannot tell
 * staging from production: the same flag opens both. THIS is the check that the environment you are about to act on names
 * staging, and ONLY staging. It never prints a value whose name suggests a secret, and a failure names the variable, not its value.
 */

export type Env = Readonly<Record<string, string | undefined>>

export interface Denylist {
  /** Supabase project refs that are production. */
  readonly refs: readonly string[]
  /** Hostnames that are production (pages, APIs). */
  readonly hosts: readonly string[]
  /** Any other production identifier: an OAuth client id, a bot id, a Slack team id, a Vikunja host, a bucket name. */
  readonly identifiers: readonly string[]
}

/** What is knowable from the repository. Everything else comes from a local, git-ignored file that Grant owns. */
export const BUILTIN_DENYLIST: Denylist = {
  refs: ['baujwlzcziasnfhhkchg'],
  hosts: ['ai-team-hq.vercel.app'],
  identifiers: [],
}

export interface Check {
  readonly id: string
  readonly ok: boolean
  readonly detail: string
}

export interface Report {
  readonly ok: boolean
  readonly checks: readonly Check[]
}

/** The word an integration carries when staging deliberately has none. It must then stay switched off. */
export const UNUSED = 'unused'

const REF = /^[a-z]{20}$/
const SECRETISH = /(SECRET|TOKEN|KEY|PASSWORD|PASS|CREDENTIAL|JWT|DB_URL|DATABASE_URL)/i

export const mergeDenylists = (...lists: readonly Partial<Denylist>[]): Denylist => ({
  refs: [...new Set(lists.flatMap((l) => l.refs ?? []))],
  hosts: [...new Set(lists.flatMap((l) => l.hosts ?? []))],
  identifiers: [...new Set(lists.flatMap((l) => l.identifiers ?? []))],
})

const hostOf = (value: string): string | null => {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Does this value name something on the denylist? Returns what it matched (the identifier, never the value). */
export const denied = (value: string, deny: Denylist): string | null => {
  const v = value.toLowerCase()
  for (const r of deny.refs)
    if (r !== '' && v.includes(r.toLowerCase())) return `production ref ${r}`
  const host = hostOf(value)
  for (const h of deny.hosts) {
    const hl = h.toLowerCase()
    if (host === hl || v.includes(hl)) return `production host ${h}`
  }
  for (const i of deny.identifiers)
    if (i !== '' && v.includes(i.toLowerCase())) return 'a known production identifier'
  return null
}

const need = (env: Env, name: string): string => (env[name] ?? '').trim()

export function evaluate(env: Env, deny: Denylist, opts: { denylistFileFound: boolean }): Report {
  const checks: Check[] = []
  const add = (id: string, ok: boolean, detail: string): void => {
    checks.push({ id, ok, detail })
  }

  // --- the target says what it is, twice ---------------------------------------------------------------------------
  const label = need(env, 'TARGET_ENVIRONMENT')
  add(
    'environment.label',
    label === 'staging',
    label === 'staging'
      ? 'TARGET_ENVIRONMENT=staging'
      : 'TARGET_ENVIRONMENT must be exactly "staging" (it is unset or something else)',
  )

  const ref = need(env, 'SUPABASE_PROJECT_REF')
  const expect = need(env, 'STAGING_EXPECT_REF')
  add(
    'supabase.ref.explicit',
    ref !== '',
    ref !== ''
      ? 'SUPABASE_PROJECT_REF is set'
      : 'SUPABASE_PROJECT_REF is unset (scripts default to the PRODUCTION ref when it is)',
  )
  add(
    'supabase.ref.shape',
    REF.test(ref),
    REF.test(ref) ? 'a 20-letter project ref' : 'SUPABASE_PROJECT_REF is not a project ref',
  )
  add(
    'supabase.ref.typed-twice',
    ref !== '' && ref === expect,
    ref !== '' && ref === expect
      ? 'STAGING_EXPECT_REF agrees'
      : 'STAGING_EXPECT_REF must be set and equal SUPABASE_PROJECT_REF',
  )
  const refHit = denied(ref, deny)
  add(
    'supabase.ref.not-production',
    refHit === null && ref !== '',
    refHit === null ? 'not on the denylist' : `SUPABASE_PROJECT_REF is ${refHit}`,
  )

  // --- every address agrees about WHICH project -------------------------------------------------------------------------
  const projectHosts = (name: string, mustBe: RegExp | null) => {
    const v = need(env, name)
    if (v === '') {
      add(`${name}`, false, `${name} is unset`)
      return
    }
    const host = hostOf(v)
    const hit = denied(v, deny)
    const inProject = host !== null && ref !== '' && host.startsWith(`${ref}.`)
    const shape = mustBe === null || mustBe.test(v)
    add(
      name,
      hit === null && inProject && shape,
      hit !== null
        ? `${name} is ${hit}`
        : !inProject
          ? `${name} does not point at the staging project`
          : !shape
            ? `${name} is not the expected kind of address`
            : 'points at the staging project',
    )
  }
  projectHosts('STAGING_GATEWAY_URL', /\/functions\/v1\/hq-api\/?$/)
  projectHosts('STAGING_WORKER_URL', /\/functions\/v1\/worker\/?$/)
  projectHosts('STAGING_STORAGE_URL', /\/storage\/v1\//)
  const db = need(env, 'SUPABASE_DB_URL')
  if (db !== '') {
    const h = hostOf(db.replace(/^postgres(ql)?:/, 'http:'))
    add(
      'database.host',
      h !== null && ref !== '' && h.includes(ref) && denied(db, deny) === null,
      h !== null && h.includes(ref)
        ? 'the database host names the staging project'
        : 'SUPABASE_DB_URL does not name the staging project',
    )
  }

  // --- the site is a preview, not production -----------------------------------------------------------------------------
  const site = need(env, 'STAGING_SITE_URL')
  const siteHit = site === '' ? null : denied(site, deny)
  add(
    'site.url',
    site !== '' && siteHit === null && site.startsWith('https://'),
    site === ''
      ? 'STAGING_SITE_URL is unset'
      : siteHit !== null
        ? `STAGING_SITE_URL is ${siteHit}`
        : 'an https address that is not production',
  )
  const vercelEnv = need(env, 'VERCEL_ENV')
  add(
    'site.vercel-env',
    vercelEnv === 'preview',
    vercelEnv === 'preview'
      ? 'VERCEL_ENV=preview'
      : 'VERCEL_ENV must be "preview" (production or unset is refused)',
  )

  // --- each integration is a staging/test one, or deliberately absent -------------------------------------------------------
  for (const [name, what] of [
    ['STAGING_GOOGLE_CLIENT_ID', 'Google OAuth client'],
    ['STAGING_MICROSOFT_CLIENT_ID', 'Microsoft app registration (To Do)'],
    ['STAGING_TELEGRAM_BOT', 'Telegram bot'],
    ['STAGING_SLACK_TEAM', 'Slack workspace'],
    ['STAGING_VIKUNJA_URL', 'Vikunja server'],
  ] as const) {
    const v = need(env, name)
    if (v === '') {
      add(
        name,
        false,
        `${name} is unset: name the staging ${what}, or set it to "${UNUSED}" and keep that integration switched off`,
      )
      continue
    }
    if (v === UNUSED) {
      add(name, true, `no ${what} in staging (the integration must stay off)`)
      continue
    }
    const hit = denied(v, deny)
    add(
      name,
      hit === null,
      hit === null ? `a ${what} that is not on the denylist` : `${name} is ${hit}`,
    )
  }

  // --- nothing production is lying about in the environment ------------------------------------------------------------------
  const strays: string[] = []
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value === '') continue
    if (name === 'STAGING_EXPECT_REF') continue
    if (denied(value, deny) !== null) strays.push(name)
  }
  add(
    'environment.no-production-identifier',
    strays.length === 0,
    strays.length === 0
      ? 'no variable names a production identifier'
      : `these variables name production: ${strays.sort().join(', ')}`,
  )

  const other: string[] = []
  for (const name of [
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_FUNCTIONS_URL',
    'HQ_API_URL',
    'HQ_URL',
    'HQ_API_OVERRIDE',
    'PAGE',
  ]) {
    const v = need(env, name)
    if (v === '') continue
    const h = hostOf(v)
    if (
      h !== null &&
      /(^|\.)supabase\.(co|com|in)$/.test(h) &&
      ref !== '' &&
      !h.startsWith(`${ref}.`)
    )
      other.push(name)
  }
  add(
    'environment.one-project',
    other.length === 0,
    other.length === 0
      ? 'every Supabase address agrees'
      : `these point at a different Supabase project: ${other.sort().join(', ')}`,
  )

  // --- the denylist itself is present, or its absence was acknowledged -----------------------------------------------------------
  const ack = need(env, 'STAGING_DENYLIST_ACKNOWLEDGED') === 'builtin-only'
  add(
    'denylist.present',
    opts.denylistFileFound || ack,
    opts.denylistFileFound
      ? 'the local production-identifier list was read'
      : ack
        ? 'acknowledged: only the built-in production identifiers are known'
        : 'no local denylist (.staging/production-identifiers.json). Create it, or set STAGING_DENYLIST_ACKNOWLEDGED=builtin-only',
  )

  return { ok: checks.every((c) => c.ok), checks }
}

/** Names of variables the report may show a value for. Secret-ish names never show one. */
export const shownValue = (name: string, value: string | undefined): string =>
  value === undefined || value === ''
    ? '(unset)'
    : SECRETISH.test(name)
      ? '(set, not shown)'
      : value

/**
 * The live phase: may a worker be deployed? Only when timed duties are held AND the database actually honours the hold.
 * A hold written to a database that has not had migration 1020 changes nothing, and would read as safe.
 */
export const workerMayBeDeployed = (config: {
  paused: boolean
  allow: readonly string[]
  honoured?: boolean
}): Check => {
  const honoured = config.honoured !== false
  return {
    id: 'worker.duties-held',
    ok: config.paused && honoured,
    detail: !honoured
      ? 'this database does not have migration 1020 (app.duty_allowed), so a hold would not be honoured. Apply the migrations first.'
      : config.paused
        ? `timed duties are held (allowed: ${config.allow.length === 0 ? 'none' : config.allow.join(', ')})`
        : 'timed duties are NOT held: a staging worker would start Drive, Calendar and chat duties at once. Run staging:posture hold first.',
  }
}
