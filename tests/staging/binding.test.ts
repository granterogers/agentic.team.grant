import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { PgExecutor } from '../../src/db/pg-executor.ts'
import {
  assertProductionChecksAllowed,
  assertProductionWritesAllowed,
  guardFetch,
} from '../../src/safety/production-gate.ts'
import {
  attest,
  bindingProblem,
  type Env,
  identityOf,
  StagingBindingRefused,
  targetProblem,
} from '../../src/safety/staging-binding.ts'

/*
  A preflight pass is bound to the staging identity it checked. Everything here is local: the "production" in these
  tests is the PUBLIC project ref that already sits in the repository, and nothing is ever sent (a fetch spy that fails
  the test if called, a dead proxy for the subprocesses, fake credentials throughout).
*/
const STAGING = 'abcdefghijklmnopqrst'
const PROD = 'baujwlzcziasnfhhkchg'
const FLAGS = { ALLOW_PRODUCTION_CHECKS: '1', ALLOW_PRODUCTION_WRITES: '1' }
const stagingEnv = (over: Env = {}): Env => ({
  TARGET_ENVIRONMENT: 'staging',
  SUPABASE_PROJECT_REF: STAGING,
  STAGING_EXPECT_REF: STAGING,
  STAGING_GATEWAY_URL: `https://${STAGING}.supabase.co/functions/v1/hq-api`,
  STAGING_WORKER_URL: `https://${STAGING}.supabase.co/functions/v1/worker`,
  STAGING_STORAGE_URL: `https://${STAGING}.supabase.co/storage/v1/`,
  STAGING_SITE_URL: 'https://team-hq-staging.vercel.app',
  VERCEL_ENV: 'preview',
  STAGING_GOOGLE_CLIENT_ID: 'staging-client.apps.googleusercontent.com',
  STAGING_TELEGRAM_BOT: 'unused',
  STAGING_SLACK_TEAM: 'unused',
  STAGING_VIKUNJA_URL: 'unused',
  STAGING_DENYLIST_ACKNOWLEDGED: 'builtin-only',
  ...over,
})

let dir = ''
let file = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'attest-'))
  file = join(dir, 'attestation.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const writeAttestation = (env: Env, at = Date.now()): void =>
  writeFileSync(file, JSON.stringify(attest(env, at)))
const envWith = (over: Env = {}): Env => ({
  ...stagingEnv(),
  ...FLAGS,
  STAGING_ATTESTATION_FILE: file,
  ...over,
})

describe('the binding, as a pure function', () => {
  const now = Date.now()
  it('does not touch a shell that does not say it is staging (an authorised production read is unchanged)', () => {
    expect(bindingProblem({ SUPABASE_PROJECT_REF: PROD }, null, now)).toBeNull()
  })

  it('refuses a staging shell with no attestation, an expired one, or one from another version', () => {
    expect(bindingProblem(stagingEnv(), null, now)).toMatch(/no staging preflight/)
    const a = attest(stagingEnv(), now - 9 * 3_600_000)
    expect(bindingProblem(stagingEnv(), a, now)).toMatch(/expired/)
    expect(
      bindingProblem(stagingEnv(), { ...attest(stagingEnv(), now), version: 99 }, now),
    ).toMatch(/different version/)
  })

  it('accepts exactly the attested identity', () => {
    expect(bindingProblem(stagingEnv(), attest(stagingEnv(), now), now)).toBeNull()
  })

  it('names the drifted FIELDS and never the values', () => {
    const a = attest(stagingEnv(), now)
    const why = bindingProblem(stagingEnv({ SUPABASE_PROJECT_REF: PROD }), a, now) as string
    expect(why).toMatch(/changed: ref/)
    expect(why).not.toContain(PROD)
    const two = bindingProblem(
      stagingEnv({
        STAGING_SITE_URL: 'https://elsewhere.vercel.app',
        STAGING_GOOGLE_CLIENT_ID: 'other',
      }),
      a,
      now,
    ) as string
    expect(two).toMatch(/site/)
    expect(two).toMatch(/google_client/)
  })

  it('every identity field is bound: changing any one is refused', () => {
    const a = attest(stagingEnv(), now)
    const changes: Env[] = [
      { SUPABASE_PROJECT_REF: 'zzzzzzzzzzzzzzzzzzzz' },
      { STAGING_GATEWAY_URL: 'https://x.example/hq-api' },
      { STAGING_WORKER_URL: 'https://x.example/worker' },
      { STAGING_STORAGE_URL: 'https://x.example/storage' },
      { SUPABASE_DB_URL: 'postgresql://u:p@db.zzzzzzzzzzzzzzzzzzzz.supabase.co/postgres' },
      { STAGING_SITE_URL: 'https://x-other.vercel.app' },
      { STAGING_GOOGLE_CLIENT_ID: 'another' },
      { STAGING_TELEGRAM_BOT: 'a_bot' },
      { STAGING_SLACK_TEAM: 'T123' },
      { STAGING_VIKUNJA_URL: 'https://v.example' },
    ]
    for (const c of changes)
      expect(bindingProblem(stagingEnv(c), a, now), JSON.stringify(c)).toMatch(/no longer matches/)
  })

  it('a database password is never part of the identity', () => {
    const id = identityOf(
      stagingEnv({
        SUPABASE_DB_URL: `postgresql://postgres:hunter2@db.${STAGING}.supabase.co:5432/postgres`,
      }),
    )
    expect(JSON.stringify(id)).not.toContain('hunter2')
    expect(id.database_host).toBe(`db.${STAGING}.supabase.co`)
  })

  it('binds the TARGET too: only the attested project and site', () => {
    const id = identityOf(stagingEnv())
    expect(targetProblem(`https://${STAGING}.supabase.co/functions/v1/hq-api`, id)).toBeNull()
    expect(
      targetProblem(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, id),
    ).toBeNull()
    expect(targetProblem(`postgresql://u:p@db.${STAGING}.supabase.co:5432/postgres`, id)).toBeNull()
    expect(targetProblem('https://team-hq-staging.vercel.app/x', id)).toBeNull()
    expect(targetProblem(`https://${PROD}.supabase.co/functions/v1/hq-api`, id)).toMatch(
      /not the attested/,
    )
    expect(
      targetProblem(`https://api.supabase.com/v1/projects/${PROD}/database/query`, id),
    ).toMatch(/does not name/)
    expect(targetProblem('https://api.supabase.com/v1/projects', id)).toMatch(/does not name/)
    expect(targetProblem(`postgresql://u:p@db.${PROD}.supabase.co:5432/postgres`, id)).toMatch(
      /not the attested/,
    )
    expect(targetProblem('https://ai-team-hq.vercel.app/', id)).toMatch(
      /not the attested staging site/,
    )
  })
})

describe('the gate, with BOTH production flags set', () => {
  it('CONTROL: matching attestation passes, for a read and for a write', () => {
    writeAttestation(stagingEnv())
    expect(() => assertProductionChecksAllowed('a read', envWith())).not.toThrow()
    expect(() => assertProductionWritesAllowed('a write', envWith())).not.toThrow()
  })

  it('refuses when there is no attestation, even with both flags', () => {
    expect(() => assertProductionWritesAllowed('a write', envWith())).toThrow(StagingBindingRefused)
  })

  it('refuses when the ref drifted to production after the preflight, even with both flags', () => {
    writeAttestation(stagingEnv())
    const drifted = envWith({ SUPABASE_PROJECT_REF: PROD })
    expect(() => assertProductionChecksAllowed('a read', drifted)).toThrow(
      /no longer matches the staging identity/,
    )
    expect(() => assertProductionWritesAllowed('a write', drifted)).toThrow(StagingBindingRefused)
  })

  it('refuses when the attestation has expired', () => {
    writeAttestation(stagingEnv(), Date.now() - 9 * 3_600_000)
    expect(() => assertProductionChecksAllowed('a read', envWith())).toThrow(/expired/)
  })

  it('refuses a target that is production even though the environment still matches', () => {
    writeAttestation(stagingEnv())
    expect(() =>
      assertProductionChecksAllowed(
        'a read',
        envWith(),
        `https://api.supabase.com/v1/projects/${PROD}/database/query`,
      ),
    ).toThrow(/does not name the attested/)
  })

  it('does not bind a production-authorised shell that never said staging', () => {
    const prod = { SUPABASE_PROJECT_REF: PROD, ...FLAGS }
    expect(() => assertProductionWritesAllowed('a write', prod)).not.toThrow()
  })

  it('the flags are still required: a bound staging shell without them is refused for that reason', () => {
    writeAttestation(stagingEnv())
    expect(() =>
      assertProductionChecksAllowed('a read', { ...stagingEnv(), STAGING_ATTESTATION_FILE: file }),
    ).toThrow(/ALLOW_PRODUCTION_CHECKS/)
  })
})

describe('the choke points', () => {
  let saved: Record<string, string | undefined> = {}
  const set = (e: Env): void => {
    saved = {}
    for (const [k, v] of Object.entries(e)) {
      saved[k] = process.env[k]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('the fetch guard never calls the network for a production URL in a staging shell, flags or not', async () => {
    writeAttestation(stagingEnv())
    const env = envWith({ SUPABASE_PROJECT_REF: PROD })
    const calls: string[] = []
    const guarded = guardFetch(
      (async (u: unknown) => {
        calls.push(String(u))
        return new Response('{}')
      }) as typeof fetch,
      () => env,
    )
    await expect(
      guarded(`https://api.supabase.com/v1/projects/${PROD}/database/query`),
    ).rejects.toThrow(StagingBindingRefused)
    expect(calls).toEqual([])
    // and with the environment intact, a request for the attested project goes through
    const ok = guardFetch(
      (async (u: unknown) => {
        calls.push(String(u))
        return new Response('{}')
      }) as typeof fetch,
      () => envWith(),
    )
    await ok(`https://api.supabase.com/v1/projects/${STAGING}/database/query`)
    await expect(ok(`https://api.supabase.com/v1/projects/${PROD}/database/query`)).rejects.toThrow(
      /does not name/,
    )
    expect(calls).toEqual([`https://api.supabase.com/v1/projects/${STAGING}/database/query`])
  })

  it('the Management API executor refuses a production ref at construction in a staging shell', () => {
    writeAttestation(stagingEnv())
    set(envWith())
    expect(() => new ManagementApiExecutor(PROD, 'fake-token')).toThrow(StagingBindingRefused)
    expect(() => new ManagementApiExecutor(STAGING, 'fake-token')).not.toThrow()
  })

  it('the Postgres executor refuses a production host in a staging shell', () => {
    writeAttestation(stagingEnv())
    set(envWith())
    expect(
      () => new PgExecutor(`postgresql://postgres:pw@db.${PROD}.supabase.co:5432/postgres`),
    ).toThrow(StagingBindingRefused)
    expect(
      () => new PgExecutor('postgresql://postgres@/testdb?host=/tmp/pgs&port=55432'),
    ).not.toThrow()
  })
})

describe('the staging commands', () => {
  const run = (script: string, args: string[], env: Env) =>
    spawnSync('npx', ['tsx', script, ...args], {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        HTTPS_PROXY: 'http://127.0.0.1:9',
        HTTP_PROXY: 'http://127.0.0.1:9',
        SUPABASE_ACCESS_TOKEN: 'fake-not-real',
        ...env,
      } as NodeJS.ProcessEnv,
      encoding: 'utf8',
      timeout: 60_000,
    })

  it('preflight attests the identity it checked; a later command refuses once the ref drifts, with both flags set', () => {
    const base = envWith()
    const pre = run('scripts/staging/preflight.ts', [], base)
    expect(pre.stdout).toMatch(/STAGING PREFLIGHT PASSED/)
    expect(existsSync(file)).toBe(true)
    const body = readFileSync(file, 'utf8')
    expect(JSON.parse(body).identity.ref).toBe(STAGING)
    expect(body).not.toContain('fake-not-real')

    // unchanged: the command gets past the binding (it then fails on the dead proxy, which proves it TRIED, not that it was refused)
    const ok = run('scripts/staging/posture.ts', ['status'], base)
    expect(`${ok.stdout}${ok.stderr}`).not.toMatch(/bound to the staging identity/)

    // drifted to production: refused before anything is sent
    const drifted = run('scripts/staging/posture.ts', ['hold'], {
      ...base,
      SUPABASE_PROJECT_REF: PROD,
      STAGING_EXPECT_REF: PROD,
    })
    expect(drifted.status).not.toBe(0)
    expect(`${drifted.stdout}${drifted.stderr}`).toMatch(
      /preflight did not pass|bound to the staging identity|no longer matches/,
    )
    expect(`${drifted.stdout}${drifted.stderr}`).not.toMatch(/ECONNREFUSED|fetch failed/)
  })

  it('a failed preflight removes an earlier attestation, so a stale pass cannot outlive a bad edit', () => {
    run('scripts/staging/preflight.ts', [], envWith())
    expect(existsSync(file)).toBe(true)
    const bad = run(
      'scripts/staging/preflight.ts',
      [],
      envWith({ STAGING_GATEWAY_URL: `https://${PROD}.supabase.co/functions/v1/hq-api` }),
    )
    expect(bad.stdout).toMatch(/FAILED/)
    expect(existsSync(file)).toBe(false)
  })

  it('posture refuses a drifted identity at the gate even when the preflight inputs are rebuilt to look valid', () => {
    const base = envWith()
    run('scripts/staging/preflight.ts', [], base)
    // a different (valid-looking) staging project: the preflight would pass it, the attestation does not
    const other = 'zzzzzzzzzzzzzzzzzzzz'
    const moved = envWith({
      SUPABASE_PROJECT_REF: other,
      STAGING_EXPECT_REF: other,
      STAGING_GATEWAY_URL: `https://${other}.supabase.co/functions/v1/hq-api`,
      STAGING_WORKER_URL: `https://${other}.supabase.co/functions/v1/worker`,
      STAGING_STORAGE_URL: `https://${other}.supabase.co/storage/v1/`,
    })
    const r = run('scripts/staging/posture.ts', ['hold'], moved)
    expect(r.status).not.toBe(0)
    expect(`${r.stdout}${r.stderr}`).toMatch(/no longer matches the staging identity/)
    expect(`${r.stdout}${r.stderr}`).toMatch(/changed: ref/)
  })
})
