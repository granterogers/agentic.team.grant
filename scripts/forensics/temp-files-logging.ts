/**
 * Turn on temp-file logging for a bounded window, to NAME the process that writes 12 GB a day of sort and hash spill.
 *
 *   npm run forensics:temp-logging                      # DRY RUN (default): reads the current overrides, prints the exact request
 *   npm run forensics:temp-logging -- --apply           # applies, but only with GRANT_APPROVED_DB_CONFIG=log_temp_files set
 *   npm run forensics:temp-logging -- --revert --apply  # removes the override again (same approval)
 *
 * Why it exists: `docs/ops/supabase-efficiency-2026-10-04.md` concluded `log_temp_files` was "BLOCKED by the platform, ask
 * support". That conclusion rested on `has_parameter_privilege(..., 'SET')` being false and a GET returning `{}`. It never tried
 * the change, and the privilege check cannot see how Supabase grants it: the `supautils` extension lets the `postgres` role set
 * a listed set of superuser parameters at role level, and the Management API accepts `log_temp_files` in the Postgres-config
 * body (OpenAPI `UpdatePostgresConfigBody`, `PUT /v1/projects/{ref}/config/database/postgres`, scope `database:write`; the
 * CLI table lists it as "CLI + SQL, no restart"). Checked against the published docs and spec on 4 October 2026. Whether THIS
 * project's token and organisation role may do it is not established: only the request can say.
 *
 * It is a CONFIGURATION CHANGE, so it is Grant's decision, not this script's: it does nothing without
 * GRANT_APPROVED_DB_CONFIG=log_temp_files in the environment, it refuses on an unhealthy platform, it merges with whatever
 * overrides already exist (a PUT is documented as an update but whether it merges or replaces is not stated, so the whole
 * desired set is sent), and it reads the result back and says so if the setting is not what was asked for. It never sets
 * `restart_database`: `log_temp_files` is reloadable (pg_settings context `superuser`), so no restart is requested.
 *
 * Value: `0` logs every temp file. The counter says the average file is about 5.5 MB (383.5 GB over 69,295 files), so a
 * 10 MB threshold would miss most of them; 69,295 files in 31 days is about 1.5 a minute, a trivial log volume.
 */
import '../../src/safety/require-production-writes.ts'

export {}

const REF = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const API = `https://api.supabase.com/v1/projects/${REF}`
const args = process.argv.slice(2)
const apply = args.includes('--apply')
const revert = args.includes('--revert')
const value = args.find((a) => a.startsWith('--value='))?.split('=')[1] ?? '0'
const KEY = 'log_temp_files'

if (TOKEN === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set (it is never printed).')
  process.exit(2)
}
const call = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; text: string }> => {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 30_000)
  try {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: ctl.signal,
    })
    const text = await r.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      // not JSON
    }
    return { status: r.status, json, text: text.slice(0, 200) }
  } catch (e) {
    return { status: 0, json: null, text: String(e instanceof Error ? e.name : e) }
  } finally {
    clearTimeout(timer)
  }
}

const current = await call('GET', '/config/database/postgres')
if (current.status !== 200 || current.json === null || typeof current.json !== 'object') {
  console.log(
    `Could not read the current overrides (http ${String(current.status)}: ${current.text}). Nothing changed.`,
  )
  process.exit(1)
}
const existing = { ...(current.json as Record<string, unknown>) }
const desired: Record<string, unknown> = { ...existing }
if (revert) delete desired[KEY]
else desired[KEY] = value

console.log(`current overrides: ${JSON.stringify(existing)}`)
console.log(`request that ${apply ? 'WILL' : 'would'} be sent: PUT ${API}/config/database/postgres`)
console.log(
  `  body: ${JSON.stringify(desired)}   (no restart_database: the parameter is reloadable)`,
)
console.log('CLI equivalent (Owner or Administrator in the organisation):')
console.log(
  revert
    ? `  supabase postgres-config delete --config ${KEY} --project-ref ${REF} --experimental`
    : `  supabase postgres-config update --config ${KEY}=${value} --project-ref ${REF} --experimental`,
)
console.log(
  'Role-level alternative, covers sessions of the postgres role ONLY (not PostgREST, Auth or Storage):',
)
console.log(`  alter role "postgres" set "${KEY}" to '${value}';`)

/**
 * What the documented API requires, and what this token has shown, WITHOUT sending the change. Three facts are read live:
 * the published OpenAPI document (is the key in the PUT body, is a restart part of it), what kind of token this is (a
 * user-scoped personal access token or something narrower), and whether the platform is healthy right now. None of them
 * is a GET of the override itself: an empty answer there says nothing about what a PUT may do.
 */
const requirements = async (): Promise<string> => {
  const lines: string[] = []
  let inBody = false
  let restartInBody = false
  try {
    const r = await fetch('https://api.supabase.com/api/v1-json', {
      signal: AbortSignal.timeout(30_000),
    })
    const spec = (await r.json()) as {
      components?: {
        schemas?: { UpdatePostgresConfigBody?: { properties?: Record<string, unknown> } }
      }
    }
    const props = spec.components?.schemas?.UpdatePostgresConfigBody?.properties ?? {}
    inBody = KEY in props
    restartInBody = 'restart_database' in props
    lines.push(
      `OpenAPI UpdatePostgresConfigBody carries ${KEY}: ${inBody ? 'YES' : 'NO'} (restart_database is an optional flag: ${restartInBody ? 'present, not sent' : 'absent'})`,
    )
  } catch {
    lines.push('OpenAPI document could not be read: the body schema is UNVERIFIED this run')
  }
  const profile = await call('GET', '/../../profile')
  lines.push(
    `token class: GET /v1/profile -> http ${String(profile.status)} (${profile.status === 403 ? 'not a user-scoped personal access token; it is a narrower credential' : 'user-scoped'})`,
  )
  lines.push(
    'documented requirement: a bearer token allowed to write project configuration; the access-control table gives database configuration updates (pooling, SSL, disk) to Owner and Administrator only, with no Developer tick. The Postgres-config row itself is not in the published table.',
  )
  lines.push(
    'observed on this token: listing API keys is allowed; revealing the secret key is refused ("not the necessary privileges"). That is evidence of a role or scope below Administrator, NOT proof that the PUT is refused.',
  )
  const h = await call('GET', '/health?services=auth&services=db&services=rest&services=storage')
  const healthy =
    h.status === 200 &&
    Array.isArray(h.json) &&
    (h.json as { status: string }[]).every((s) => s.status === 'ACTIVE_HEALTHY')
  lines.push(
    `platform health now: ${healthy ? 'all ACTIVE_HEALTHY' : `NOT healthy (health endpoint http ${String(h.status)})`}`,
  )
  const approved = process.env.GRANT_APPROVED_DB_CONFIG === KEY
  lines.push(
    `explicit approval (GRANT_APPROVED_DB_CONFIG=${KEY}): ${approved ? 'STATED' : 'not stated'}`,
  )
  const status = !inBody
    ? 'BLOCKED: the key is not in the documented request body'
    : !healthy
      ? 'WAITING: the platform is not healthy, nothing is changed while it is degraded'
      : !approved
        ? 'READY FOR APPROVAL: not applied. Permission for this token is UNKNOWN until the request is made; a 403 would refuse cleanly and change nothing.'
        : 'APPROVED and healthy: --apply may be run'
  lines.push(`STATUS: ${status}`)
  return lines.join('\n  ')
}
console.log(`\nrequirements check:\n  ${await requirements()}`)

if (!apply) {
  console.log(
    '\nDRY RUN: nothing was sent. Re-run with --apply and GRANT_APPROVED_DB_CONFIG=log_temp_files once Grant approves.',
  )
  process.exit(0)
}
if (process.env.GRANT_APPROVED_DB_CONFIG !== KEY) {
  console.log(
    "\nREFUSED: this is a configuration change and needs Grant's approval. Set GRANT_APPROVED_DB_CONFIG=log_temp_files to state it.",
  )
  process.exit(1)
}
const h = await call('GET', '/health?services=auth&services=db&services=rest&services=storage')
const unhealthy =
  !Array.isArray(h.json) ||
  (h.json as { status: string }[]).some((s) => s.status !== 'ACTIVE_HEALTHY')
if (h.status !== 200 || unhealthy) {
  console.log(
    '\nREFUSED: the platform is not reporting healthy. No configuration change is made while it is degraded.',
  )
  process.exit(1)
}
const put = await call('PUT', '/config/database/postgres', desired)
console.log(`\nPUT answered http ${String(put.status)}${put.status === 200 ? '' : `: ${put.text}`}`)
const after = await call('GET', '/config/database/postgres')
const got =
  after.json !== null && typeof after.json === 'object'
    ? (after.json as Record<string, unknown>)[KEY]
    : undefined
const ok = revert ? got === undefined || got === null : String(got) === value
console.log(
  `read back: ${KEY} = ${JSON.stringify(got)} -> ${ok ? 'AS ASKED' : 'NOT AS ASKED (the platform did not apply it; use the CLI line above)'}`,
)
process.exit(ok ? 0 : 1)
