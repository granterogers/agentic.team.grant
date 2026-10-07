import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectPageFiles } from '../../scripts/deploy/lib/page-files.ts'

/** The generated, gitignored config.js. A fresh checkout does not have one, so the test makes a stand-in and removes it again. */
const CONFIG = 'web/studio/config.js'
let madeConfig = false

/*
  The first real page deploy must RECORD the fingerprint and the second identical one must SKIP. The pieces are each tested elsewhere;
  this runs the real scripts/deploy/hq-page-delta.ts, top to bottom, against a stateful fake Vercel, because the thing that can still
  be wrong is the seam: the request body the script builds (the fingerprint and the commit SHA share one `meta` after a merge) and
  what the next run reads back. No network: `fetch` is a fake that throws on any URL it does not know. No rollout log: the write log
  the deploy tool appends to is mocked, so the real one (which the two-GO gate reads) is never touched.
*/
vi.mock('../../src/safety/require-production-writes.ts', () => ({}))
vi.mock('../../scripts/rollout/log.ts', () => ({ logWrite: vi.fn() }))

const SHA = '0123456789abcdef0123456789abcdef01234567'
const LIVE0 = 'dpl_live0'

interface Deployment {
  id: string
  meta: Record<string, string>
}
class FakeVercel {
  live: Deployment = { id: LIVE0, meta: {} }
  created: {
    meta?: Record<string, string> | undefined
    target?: string | undefined
    files?: number | undefined
  }[] = []
  envUpdatedAt = 1_000
  files: string[] = []
  private n = 0
  async handle(url: string, init?: RequestInit): Promise<Response> {
    const u = new URL(url)
    const json = (v: unknown, status = 200): Response =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    const method = init?.method ?? 'GET'
    if (u.hostname === 'api.vercel.com') {
      if (method === 'GET' && u.pathname === '/v9/projects')
        return json({
          projects: [
            {
              id: 'prj1',
              name: 'ai-team-hq',
              framework: null,
              targets: { production: { id: this.live.id } },
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
      if (method === 'GET' && u.pathname === `/v6/deployments/${this.live.id}/files`)
        return json(this.files.map((f) => ({ name: `src/${f}`, type: 'file' })))
      if (method === 'GET' && u.pathname.startsWith('/v13/deployments/')) {
        const id = u.pathname.split('/').pop()
        const dep = id === this.live.id ? this.live : { id, meta: {} }
        return json({ id, readyState: 'READY', target: 'production', meta: dep.meta })
      }
      if (method === 'POST' && u.pathname === '/v13/deployments') {
        const body = JSON.parse(String(init?.body)) as {
          meta?: Record<string, string>
          target?: string
          files?: unknown[]
        }
        this.created.push({ meta: body.meta, target: body.target, files: body.files?.length })
        this.n += 1
        const id = `dpl_new${String(this.n)}`
        this.live = { id, meta: body.meta ?? {} }
        return json({ id, url: `${id}.vercel.app` })
      }
    }
    if (u.hostname.endsWith('.vercel.app') && u.pathname === '/app.js')
      return new Response('import "./settings-ui.js"')
    throw new Error(`unexpected request in the fake Vercel: ${method} ${url}`)
  }
}

const fake = new FakeVercel()
const out: string[] = []
const run = async (...args: string[]): Promise<{ code: number | null }> => {
  vi.resetModules()
  process.argv = ['node', 'hq-page-delta.ts', ...args]
  out.length = 0
  let code: number | null = null
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0
    throw new Error('exit')
  }) as never)
  try {
    await import('../../scripts/deploy/hq-page-delta.ts')
  } catch (e) {
    if (!(e instanceof Error && e.message === 'exit')) throw e
  }
  return { code }
}

beforeEach(async () => {
  madeConfig = !existsSync(CONFIG)
  if (madeConfig) writeFileSync(CONFIG, "window.HQ_API = 'https://test.invalid/hq-api'\n")
  fake.live = { id: LIVE0, meta: {} }
  fake.created = []
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
  // the build poll waits five seconds between reads; resolve it at once
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
})

describe('the generated config.js is part of what ships, so a tree without it is refused', () => {
  it('no config.js: exits non-zero before any request, and nothing is created', async () => {
    rmSync(CONFIG, { force: true })
    const r = await run('--go')
    expect(r.code).toBe(2)
    expect(fake.created).toHaveLength(0)
    expect(out.join('\n')).toContain('npm run config:site')
    expect(out.join('\n')).not.toContain('fingerprint:')
  })

  it('control: with config.js present the same run deploys', async () => {
    const r = await run('--go')
    expect(r.code).not.toBe(2)
    expect(fake.created).toHaveLength(1)
  })
})

describe('the first page deploy records the fingerprint; the second identical one skips', () => {
  it('first run: deploys once, and the request carries the fingerprint AND the commit SHA in one meta', async () => {
    await run('--go')
    expect(fake.created).toHaveLength(1)
    const meta = fake.created[0]?.meta ?? {}
    expect(meta.pageFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(meta.gitCommitSha).toBe(SHA)
    expect(meta.deployedBy).toBe('deploy:hq-page')
    expect(fake.created[0]?.target).toBe('production')
    expect(out.join('\n')).toContain('deploy (the live deployment recorded no fingerprint')
  })

  it('second run with nothing changed: SKIP, no deployment is created, exit 0', async () => {
    await run('--go')
    const recorded = fake.live.meta.pageFingerprint
    const second = await run('--go')
    expect(fake.created).toHaveLength(1)
    expect(second.code).toBe(0)
    expect(out.join('\n')).toMatch(/SKIP \(every input matches the live deployment\)/)
    expect(out.join('\n')).toContain('nothing to deploy')
    expect(fake.live.meta.pageFingerprint).toBe(recorded)
  })

  it('a different commit SHA alone does not cause a redeploy (it is metadata, not an input)', async () => {
    await run('--go')
    process.env.DEPLOY_SOURCE_SHA = 'f'.repeat(40)
    await run('--go')
    expect(fake.created).toHaveLength(1)
  })

  it('a change in a project input (an environment variable edited by hand) deploys again', async () => {
    await run('--go')
    fake.envUpdatedAt += 5_000
    await run('--go')
    expect(fake.created).toHaveLength(2)
    expect(fake.created[1]?.meta?.pageFingerprint).not.toBe(fake.created[0]?.meta?.pageFingerprint)
  })

  it('--force deploys an identical tree', async () => {
    await run('--go')
    await run('--go', '--force')
    expect(fake.created).toHaveLength(2)
    expect(fake.created[1]?.meta?.pageFingerprint).toBe(fake.created[0]?.meta?.pageFingerprint)
  })

  it('a dry run (no --go) creates nothing, even when the tree would deploy', async () => {
    await run()
    expect(fake.created).toHaveLength(0)
    expect(out.join('\n')).toContain('dry run: nothing deployed')
  })

  it('never silently skips when uncertain: a live deployment whose meta cannot be read deploys', async () => {
    await run('--go')
    fake.live = { id: fake.live.id, meta: {} }
    await run('--go')
    expect(fake.created).toHaveLength(2)
  })
})
