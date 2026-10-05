/**
 * Having production credentials is not permission to use them.
 *
 * An earlier autonomous run executed read-only production catalogue queries only because credentials were in its
 * environment. These tests prove the default is refusal, using FAKE credentials and a fetch spy that must never be called,
 * so nothing here can reach production whatever the environment holds.
 */
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isolated } from '../../scripts/isolated/guard.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { PgExecutor } from '../../src/db/pg-executor.ts'
import {
  assertProductionChecksAllowed,
  assertProductionWritesAllowed,
  assertSiteAllowed,
  ENV_CHECKS,
  ENV_WRITES,
  gateApplies,
  guardFetch,
  isProductionUrl,
  isRemotePgTarget,
  levelForRequest,
  ProductionAccessRefused,
  refusalMessage,
} from '../../src/safety/production-gate.ts'

const FAKE = {
  // secret-scan:allow-shape (a synthetic specimen, not a credential)
  SUPABASE_ACCESS_TOKEN: 'sbp_0000000000000000000000000000000000000000',
  SUPABASE_PROJECT_REF: 'baujwlzcziasnfhhkchg',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role',
  // secret-scan:allow-shape (a synthetic specimen, not a credential)
  SUPABASE_DB_URL: 'postgresql://postgres:fake@db.baujwlzcziasnfhhkchg.supabase.co:5432/postgres',
}
const KEYS = [ENV_CHECKS, ENV_WRITES, ...Object.keys(FAKE)]
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, FAKE) // credentials PRESENT, flags UNSET: the exact situation that caused the accident
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.unstubAllGlobals()
})

const spy = () => {
  const f = vi.fn(async () => new Response('[]', { status: 200 }))
  vi.stubGlobal('fetch', f)
  return f
}

describe('refusal is the default, with credentials present and the flag unset', () => {
  it('the Management API executor refuses at construction, before any network call', () => {
    const fetchSpy = spy()
    expect(
      () => new ManagementApiExecutor('baujwlzcziasnfhhkchg', FAKE.SUPABASE_ACCESS_TOKEN),
    ).toThrow(ProductionAccessRefused)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('and again at execute, for an instance built while the flag was set', async () => {
    process.env[ENV_CHECKS] = '1'
    const db = new ManagementApiExecutor('baujwlzcziasnfhhkchg', FAKE.SUPABASE_ACCESS_TOKEN)
    delete process.env[ENV_CHECKS]
    const fetchSpy = spy()
    await expect(db.execute('select 1')).rejects.toThrow(/REFUSED/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a raw fetch to the Management API, the project host or the deployed page is refused before it is sent', async () => {
    const inner = vi.fn(async () => new Response('{}'))
    const guarded = guardFetch(inner as unknown as typeof fetch)
    for (const url of [
      'https://api.supabase.com/v1/projects/baujwlzcziasnfhhkchg/database/query',
      'https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/hq-api?section=studio',
      'https://ai-team-hq.vercel.app/',
    ])
      await expect(guarded(url, { method: 'POST' })).rejects.toBeInstanceOf(ProductionAccessRefused)
    expect(inner).not.toHaveBeenCalled()
  })

  it('a remote Postgres connection is refused (the direct database URL included)', () => {
    expect(() => new PgExecutor(FAKE.SUPABASE_DB_URL)).toThrow(ProductionAccessRefused)
    // secret-scan:allow-shape (a synthetic specimen, not a credential)
    expect(() => new PgExecutor('postgresql://u:p@203.0.113.7:5432/postgres')).toThrow(/REFUSED/)
  })

  it('"true", "yes", "0" and an empty value are not the flag', () => {
    for (const v of ['true', 'yes', '0', '', ' 1']) {
      process.env[ENV_CHECKS] = v
      expect(() => assertProductionChecksAllowed('x')).toThrow(ProductionAccessRefused)
    }
  })
})

describe('it is allowed when the flag is set', () => {
  it('the executor constructs and then sends exactly the request it was asked to', async () => {
    process.env[ENV_CHECKS] = '1'
    const fetchSpy = spy()
    const db = new ManagementApiExecutor('baujwlzcziasnfhhkchg', FAKE.SUPABASE_ACCESS_TOKEN)
    await expect(db.execute('select 1')).resolves.toEqual({ rows: [] })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('the guarded fetch passes a production read through', async () => {
    process.env[ENV_CHECKS] = '1'
    const inner = vi.fn(async () => new Response('{}'))
    await guardFetch(inner as unknown as typeof fetch)(
      'https://baujwlzcziasnfhhkchg.supabase.co/rest/v1/x',
    )
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('a remote Postgres connection is constructed (not connected) once the flag is set', () => {
    process.env[ENV_CHECKS] = '1'
    expect(() => new PgExecutor(FAKE.SUPABASE_DB_URL)).not.toThrow()
  })
})

describe('the refusal message', () => {
  it('says what was refused, why, and the exact way to enable it', () => {
    const m = refusalMessage('GET https://api.supabase.com/v1/projects', 'checks')
    expect(m).toMatch(/^REFUSED:/)
    expect(m).toContain('GET https://api.supabase.com/v1/projects')
    expect(m).toMatch(/PRODUCTION/)
    expect(m).toMatch(/earlier autonomous run/)
    expect(m).toMatch(/by accident/)
    expect(m).toContain(`${ENV_CHECKS}=1 <the same command>`)
    expect(m).toMatch(/Nothing was sent/)
    expect(m).not.toContain(ENV_WRITES)
  })

  it('names both flags when the action writes', () => {
    const m = refusalMessage('running scripts/migrate.ts', 'writes')
    expect(m).toContain(`${ENV_CHECKS}=1 ${ENV_WRITES}=1 <the same command>`)
  })

  it('carries no credential value and no query string', async () => {
    const guarded = guardFetch(vi.fn() as unknown as typeof fetch)
    const err = await guarded('https://x.supabase.co/rest/v1/t?apikey=sekret-key-value').catch(
      (e: Error) => e,
    )
    expect((err as Error).message).not.toContain('sekret-key-value')
    expect((err as Error).message).not.toContain(FAKE.SUPABASE_ACCESS_TOKEN)
  })
})

describe('writing needs the second, stronger confirmation', () => {
  it('checks alone do not allow a write; writes alone do not allow anything; both do', () => {
    process.env[ENV_CHECKS] = '1'
    expect(() => assertProductionChecksAllowed('read')).not.toThrow()
    expect(() => assertProductionWritesAllowed('deploy')).toThrow(/ALLOW_PRODUCTION_WRITES=1/)
    delete process.env[ENV_CHECKS]
    process.env[ENV_WRITES] = '1'
    expect(() => assertProductionWritesAllowed('deploy')).toThrow(ProductionAccessRefused)
    expect(() => assertProductionChecksAllowed('read')).toThrow(ProductionAccessRefused)
    process.env[ENV_CHECKS] = '1'
    expect(() => assertProductionWritesAllowed('deploy')).not.toThrow()
  })

  it('a deploy, a secret or config change and a destructive verb need writes; a read does not', () => {
    const base = 'https://api.supabase.com/v1/projects/baujwlzcziasnfhhkchg'
    expect(levelForRequest(`${base}/functions/deploy?slug=hq-api`, 'POST')).toBe('writes')
    expect(levelForRequest(`${base}/secrets`, 'POST')).toBe('writes')
    expect(levelForRequest(`${base}/config/auth`, 'PATCH')).toBe('writes')
    expect(levelForRequest(`${base}/database/password`, 'PATCH')).toBe('writes')
    expect(levelForRequest(`${base}/anything`, 'DELETE')).toBe('writes')
    expect(levelForRequest('https://api.vercel.com/v13/deployments', 'POST')).toBe('writes')
    expect(levelForRequest(`${base}/api-keys`, 'GET')).toBe('checks')
    expect(levelForRequest(`${base}/health`, 'GET')).toBe('checks')
    expect(levelForRequest(`${base}/database/query`, 'POST')).toBe('checks')
  })

  it('a function deploy through the guarded fetch is refused with only the first flag set', async () => {
    process.env[ENV_CHECKS] = '1'
    const inner = vi.fn(async () => new Response('{}'))
    const guarded = guardFetch(inner as unknown as typeof fetch)
    await expect(
      guarded(
        'https://api.supabase.com/v1/projects/baujwlzcziasnfhhkchg/functions/deploy?slug=hq-api',
        { method: 'POST' },
      ),
    ).rejects.toThrow(/ALLOW_PRODUCTION_WRITES/)
    expect(inner).not.toHaveBeenCalled()
  })

  it('a writing command is refused at its first import, with fake credentials and no network', () => {
    const run = (extra: Record<string, string>) =>
      spawnSync('npx', ['tsx', 'scripts/migrate.ts', '--dry'], {
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          ...FAKE,
          // anything that tried the network would die on this, not on the gate's sentence
          HTTPS_PROXY: 'http://127.0.0.1:9',
          HTTP_PROXY: 'http://127.0.0.1:9',
          ...extra,
        },
      })
    for (const extra of [{}, { [ENV_CHECKS]: '1' }, { [ENV_WRITES]: '1' }]) {
      const r = run(extra)
      expect(r.status, JSON.stringify(extra)).not.toBe(0)
      expect(`${r.stderr}${r.stdout}`).toMatch(
        /REFUSED: running scripts\/migrate\.ts would contact PRODUCTION/,
      )
      expect(`${r.stderr}${r.stdout}`).toContain(`${ENV_CHECKS}=1 ${ENV_WRITES}=1`)
    }
  }, 120_000)

  it('an inspection command is refused at its first import, naming only the first flag', () => {
    const r = spawnSync('npx', ['tsx', 'scripts/check-gateway-wrappers.ts'], {
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        ...FAKE,
        HTTPS_PROXY: 'http://127.0.0.1:9',
      },
    })
    expect(r.status).not.toBe(0)
    expect(`${r.stderr}${r.stdout}`).toMatch(
      /REFUSED: running scripts\/check-gateway-wrappers\.ts would contact PRODUCTION/,
    )
  }, 120_000)
})

describe('what is NOT production stays easy', () => {
  it('the local replica path is untouched: a Unix socket is never remote, and constructing it needs no flag', () => {
    const replica = 'postgresql://postgres@/testdb?host=/tmp/pgs&port=55432'
    expect(isRemotePgTarget(replica)).toBe(false)
    expect(() => new PgExecutor(replica)).not.toThrow()
    expect(isRemotePgTarget('postgresql://postgres@localhost:5432/x')).toBe(false)
    expect(isRemotePgTarget('postgresql://postgres@127.0.0.1:5432/x')).toBe(false)
  })

  it('scripts/isolated/guard.ts still reaches its own socket and still says its own refusal, not ours', async () => {
    const err = await isolated('no_such_database').catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ProductionAccessRefused)
    expect((err as Error).message).not.toMatch(/would contact PRODUCTION/)
  })

  it('local and test servers are never production, so a fake base URL needs no flag', async () => {
    const fetchSpy = spy()
    const db = new ManagementApiExecutor('r', 't', 'http://127.0.0.1:9')
    await db.execute('select 1')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    for (const u of [
      'http://localhost:3000/x',
      'http://127.0.0.1:8080/',
      'http://[::1]:1/',
      'https://example.com/',
    ])
      expect(isProductionUrl(u)).toBe(false)
  })

  it('a project ref in a URL or a host named by the environment counts as production', () => {
    expect(isProductionUrl('https://elsewhere.example/baujwlzcziasnfhhkchg')).toBe(true)
    expect(
      isProductionUrl('https://office.example.org/rest', {
        SUPABASE_URL: 'https://office.example.org',
      }),
    ).toBe(true)
    expect(
      isProductionUrl('http://localhost:54321/rest', { SUPABASE_URL: 'http://localhost:54321' }),
    ).toBe(false)
  })

  it('is inert in Deno (the edge worker IS the production office) and where there is no process', () => {
    vi.stubGlobal('Deno', {})
    expect(gateApplies()).toBe(false)
    expect(() => assertProductionWritesAllowed('the worker')).not.toThrow()
    vi.unstubAllGlobals()
    expect(() => assertProductionChecksAllowed('x', null)).not.toThrow()
  })

  it('a browser suite is refused only against production: default-prod needs the flag unless pointed at a local server', () => {
    expect(() => assertSiteAllowed('a', true, {})).toThrow(ProductionAccessRefused)
    expect(() =>
      assertSiteAllowed('a', true, { BASECAMP_SITE: 'http://127.0.0.1:4173' }),
    ).not.toThrow()
    expect(() =>
      assertSiteAllowed('a', true, { BASECAMP_SITE: 'https://ai-team-hq.vercel.app' }),
    ).toThrow()
    expect(() => assertSiteAllowed('a', false, {})).not.toThrow()
    expect(() => assertSiteAllowed('a', false, { PAGE: 'https://ai-team-hq.vercel.app' })).toThrow()
    expect(() => assertSiteAllowed('a', true, { [ENV_CHECKS]: '1' })).not.toThrow() // the flag is read from the env argument too
  })
})
