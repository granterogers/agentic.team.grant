import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectPageFiles } from '../../scripts/deploy/lib/page-files.ts'

/*
  scripts/deploy/hq-page-preview.ts creates a PREVIEW deployment. What must hold, with the real script run against a stateful fake
  Vercel (no network: the fake throws on any URL or method it does not know, which is also how "it calls no alias, rollback, promote
  or delete endpoint" is asserted): no `target` is ever sent, production does not move, the throwaway secret reaches only the
  deployment's own env and a 0600 file outside the repository and is never printed, and a --compare run can never create anything.
*/
vi.mock('../../src/safety/require-production-writes.ts', () => ({}))

const PROD = 'dpl_prod0'
const SHA = '0123456789abcdef0123456789abcdef01234567'
const CONFIG = 'web/studio/config.js'
let madeConfig = false

interface Created {
  body: Record<string, unknown>
  id: string
}
class FakeVercel {
  production = { id: PROD, meta: { gitCommitSha: 'old' } as Record<string, string> }
  previews = new Map<string, { meta: Record<string, string> }>()
  created: Created[] = []
  envUpdatedAt = 1_000
  files: string[] = []
  n = 0
  async handle(url: string, init?: RequestInit): Promise<Response> {
    const u = new URL(url)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200): Response =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    if (u.hostname !== 'api.vercel.com') throw new Error(`unexpected host in the fake: ${url}`)
    if (method === 'GET' && u.pathname === '/v9/projects')
      return json({
        projects: [
          {
            id: 'prj1',
            name: 'ai-team-hq',
            framework: null,
            targets: { production: { id: this.production.id } },
          },
        ],
      })
    if (method === 'GET' && u.pathname === '/v9/projects/prj1/env')
      return json({
        envs: [
          {
            key: 'NOTEBOOK_READER_SECRET',
            target: ['production'],
            type: 'encrypted',
            updatedAt: this.envUpdatedAt,
          },
        ],
      })
    if (method === 'GET' && u.pathname.startsWith('/v13/deployments/')) {
      const id = u.pathname.split('/').pop() as string
      if (id === this.production.id)
        return json({ id, readyState: 'READY', target: 'production', meta: this.production.meta })
      const p = this.previews.get(id)
      if (p === undefined) return json({ error: { code: 'not_found' } }, 404)
      return json({ id, readyState: 'READY', target: null, meta: p.meta })
    }
    if (method === 'POST' && u.pathname === '/v13/deployments') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      this.n += 1
      const id = `dpl_prev${String(this.n)}`
      this.created.push({ body, id })
      this.previews.set(id, { meta: (body.meta ?? {}) as Record<string, string> })
      return json({ id, url: `${id}.vercel.app`, target: null })
    }
    throw new Error(`unexpected request in the fake Vercel: ${method} ${url}`)
  }
}

const fake = new FakeVercel()
const out: string[] = []
let dir = ''
let secretPath = ''
const run = async (...args: string[]): Promise<number | null> => {
  vi.resetModules()
  process.argv = ['node', 'hq-page-preview.ts', ...args]
  out.length = 0
  let code: number | null = null
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0
    throw new Error('exit')
  }) as never)
  try {
    await import('../../scripts/deploy/hq-page-preview.ts')
  } catch (e) {
    if (!(e instanceof Error && e.message === 'exit')) throw e
  }
  return code
}

beforeEach(async () => {
  madeConfig = !existsSync(CONFIG)
  if (madeConfig) writeFileSync(CONFIG, "window.HQ_API = 'https://test.invalid/hq-api'\n")
  dir = mkdtempSync(join(tmpdir(), 'preview-test-'))
  secretPath = join(dir, 'secret')
  fake.production = { id: PROD, meta: { gitCommitSha: 'old' } }
  fake.previews = new Map()
  fake.created = []
  fake.n = 0
  fake.envUpdatedAt = 1_000
  fake.files = [...(await collectPageFiles('.')).keys()]
  process.env.VERCEL_TOKEN = 'test-token-not-real'
  process.env.DEPLOY_SOURCE_SHA = SHA
  vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => fake.handle(String(url), init))
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    out.push(a.map(String).join(' '))
  })
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    out.push(a.map(String).join(' '))
  })
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
    queueMicrotask(fn)
    return 0
  }) as never)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(process.env, 'DEPLOY_SOURCE_SHA')
  if (madeConfig) rmSync(CONFIG, { force: true })
  rmSync(dir, { recursive: true, force: true })
})

describe('the preview deploy', () => {
  it('a dry run creates nothing and writes no secret', async () => {
    const code = await run()
    expect(code).toBe(0)
    expect(fake.created).toHaveLength(0)
    expect(existsSync(secretPath)).toBe(false)
    expect(out.join('\n')).toContain('dry run: nothing created')
  })

  it('--go creates exactly one deployment whose request has NO target, and production does not move', async () => {
    const code = await run('--go', `--secret-file=${secretPath}`)
    expect(code).toBe(0)
    expect(fake.created).toHaveLength(1)
    const body = (fake.created[0] as Created).body
    expect('target' in body).toBe(false)
    expect(Object.keys(body).sort()).toEqual(['env', 'files', 'meta', 'name', 'projectSettings'])
    expect(fake.production.id).toBe(PROD)
    expect(out.join('\n')).toMatch(/PREVIEW_ID=dpl_prev1/)
    expect(out.join('\n')).toContain(
      'production deployment (never touched by this script): dpl_prod0',
    )
  })

  it('records the fingerprint, the commit SHA and who deployed it, and includes config.js in the upload', async () => {
    await run('--go', `--secret-file=${secretPath}`)
    const body = (fake.created[0] as Created).body as {
      meta: Record<string, string>
      files: { file: string }[]
    }
    expect(body.meta.pageFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(body.meta.gitCommitSha).toBe(SHA)
    expect(body.meta.deployedBy).toBe('deploy:hq-page-preview')
    const names = body.files.map((f) => f.file)
    expect(names).toContain('config.js')
    expect(names).toContain('studio/config.js')
    expect(names).toContain('scripts/notebook/act.py')
  })

  it('the throwaway secret reaches the deployment env and a 0600 file, and nothing printed', async () => {
    await run('--go', `--secret-file=${secretPath}`)
    const secret = readFileSync(secretPath, 'utf8')
    expect(secret).toMatch(/^[0-9a-f]{48}$/)
    expect(
      ((fake.created[0] as Created).body.env as Record<string, string>).NOTEBOOK_READER_SECRET,
    ).toBe(secret)
    expect((statSync(secretPath).mode & 0o777).toString(8)).toBe('600')
    expect(out.join('\n')).not.toContain(secret)
  })

  it('refuses a secret file inside the repository, a missing one, a tree without config.js, and --go with --compare', async () => {
    expect(await run('--go', '--secret-file=./inside-the-repo')).toBe(2)
    expect(await run('--go')).toBe(2)
    expect(await run('--go', '--compare=dpl_x', `--secret-file=${secretPath}`)).toBe(2)
    rmSync(CONFIG, { force: true })
    expect(await run('--go', `--secret-file=${secretPath}`)).toBe(2)
    expect(fake.created).toHaveLength(0)
  })
})

describe('--compare asks whether an identical second preview would be skipped, and can never create one', () => {
  it('an identical tree is a SKIP and creates nothing', async () => {
    await run('--go', `--secret-file=${secretPath}`)
    const code = await run('--compare=dpl_prev1')
    expect(code).toBe(0)
    expect(out.join('\n')).toMatch(
      /SKIP: nothing to deploy; dpl_prev1 was built from exactly these inputs/,
    )
    expect(fake.created).toHaveLength(1)
  })

  it('a changed project input is "would deploy", and still creates nothing', async () => {
    await run('--go', `--secret-file=${secretPath}`)
    fake.envUpdatedAt += 9_000
    await run('--compare=dpl_prev1')
    expect(out.join('\n')).toMatch(/would deploy: .*This was a comparison, so nothing was created/)
    expect(fake.created).toHaveLength(1)
  })

  it('fails open: a preview that cannot be read is "would deploy", never SKIP', async () => {
    await run('--go', `--secret-file=${secretPath}`)
    await run('--compare=dpl_doesnotexist')
    expect(out.join('\n')).toContain('would deploy')
    expect(out.join('\n')).not.toMatch(/\bSKIP: nothing to deploy/)
  })

  it('a preview that recorded no fingerprint is never skipped', async () => {
    await run('--go', `--secret-file=${secretPath}`)
    fake.previews.set('dpl_prev1', { meta: {} })
    await run('--compare=dpl_prev1')
    expect(out.join('\n')).toContain('would deploy')
  })
})

describe('what the script is able to do', () => {
  it('names no alias, rollback, promote or delete operation, and sends no target', () => {
    const src = readFileSync('scripts/deploy/hq-page-preview.ts', 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(
      /alias|rollback|promote|method: 'DELETE'|method: 'PATCH'|method: 'PUT'/i,
    )
    expect(code).not.toMatch(/target: 'production'/)
    const body = code.slice(code.indexOf('const body = {'), code.indexOf('const create'))
    expect(body).not.toMatch(/\btarget\b/)
  })
})
