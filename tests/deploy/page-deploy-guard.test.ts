/**
 * `assessPageDeploy` end to end against a FAKE Vercel client: no HTTP call is made. It must skip only when the live
 * production deployment is READY and recorded exactly the fingerprint of this tree, and must deploy in every other case,
 * including every way the reading can go wrong.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assessPageDeploy,
  deploymentMeta,
  type GuardOptions,
  makeVercelReader,
  type VercelReader,
} from '../../scripts/deploy/lib/page-deploy-guard.ts'
import { FINGERPRINT_META_KEY } from '../../scripts/deploy/lib/page-fingerprint.ts'

let root = ''
const put = (rel: string, body: string): void => {
  const full = join(root, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, body)
}
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'page-guard-'))
  put('web/studio/index.html', '<html>Team HQ</html>')
  put('web/studio/app.js', 'export const a = 1\n')
  put('web/studio/config.js', "window.HQ_API = 'https://aaaa/hq-api'\n")
  put('api/notebook.py', 'print("reader")\n')
  put('api/notebook-act.py', 'print("writer")\n')
  put('scripts/notebook/act.py', 'print("act")\n')
  put('requirements.txt', 'notebooklm-py\nhttpx==0.27.0\n')
  put('vercel.json', '{"functions":{}}\n')
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const SECRET = 'reader-secret-value-1'
const opts = (over: Partial<GuardOptions> = {}): GuardOptions => ({
  root,
  projectName: 'ai-team-hq',
  deployment: { name: 'ai-team-hq', target: 'production', projectSettings: { framework: null } },
  supplied: { NOTEBOOK_READER_SECRET: SECRET },
  ...over,
})

interface FakeWorld {
  projects?: unknown
  env?: unknown
  live?: unknown
  failOn?: RegExp
  calls: string[]
}
const fake = (w: FakeWorld): VercelReader => ({
  async get(path: string): Promise<unknown> {
    w.calls.push(path)
    if (w.failOn?.test(path)) throw new Error('GET failed -> http 500')
    if (path.startsWith('/v9/projects?')) return w.projects
    if (/\/v9\/projects\/[^/]+\/env/.test(path)) return w.env
    if (path.startsWith('/v13/deployments/')) return w.live
    throw new Error(`unexpected path ${path}`)
  },
})

const world = (over: Partial<FakeWorld> = {}): FakeWorld => ({
  projects: {
    projects: [
      {
        id: 'prj_1',
        name: 'ai-team-hq',
        framework: null,
        nodeVersion: '24.x',
        targets: { production: { id: 'dpl_live' } },
      },
      { id: 'prj_2', name: 'other', targets: { production: { id: 'dpl_other' } } },
    ],
  },
  env: {
    envs: [
      { key: 'NOTEBOOK_READER_SECRET', updatedAt: 1 },
      { key: 'OTHER_FLAG', updatedAt: 1_760_000_000_000 },
    ],
  },
  live: { readyState: 'READY', target: 'production', meta: {} },
  calls: [],
  ...over,
})

/** Deploys once to learn this tree's fingerprint, then returns a world whose live deployment recorded exactly it. */
async function matching(over: Partial<FakeWorld> = {}, o = opts()): Promise<FakeWorld> {
  const first = await assessPageDeploy(fake(world(over)), o)
  expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  return world({
    ...over,
    live: {
      readyState: 'READY',
      target: 'production',
      meta: { [FINGERPRINT_META_KEY]: first.fingerprint },
    },
  })
}

describe('the first deploy after this change deploys and records', () => {
  it('a live deployment with no fingerprint is never skipped, and the result carries the fingerprint to record', async () => {
    const r = await assessPageDeploy(fake(world()), opts())
    expect(r.decision.skip).toBe(false)
    expect(r.decision.reason).toContain('recorded no fingerprint')
    expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(deploymentMeta(r)).toEqual({ meta: { [FINGERPRINT_META_KEY]: r.fingerprint } })
  })
})

describe('skips only on an exact match with a READY live deployment', () => {
  it('skips when READY and the recorded fingerprint is this tree', async () => {
    const w = await matching()
    const r = await assessPageDeploy(fake(w), opts())
    expect(r.decision.skip).toBe(true)
    expect(r.liveId).toBe('dpl_live')
  })

  it('is deterministic: two assessments of the same tree give the same fingerprint', async () => {
    const a = await assessPageDeploy(fake(world()), opts())
    const b = await assessPageDeploy(fake(world()), opts())
    expect(a.fingerprint).toBe(b.fingerprint)
  })

  it('--force deploys even on an exact match, and still reports the fingerprint', async () => {
    const r = await assessPageDeploy(fake(await matching()), opts({ force: true }))
    expect(r.decision).toEqual({ skip: false, reason: 'forced' })
    expect(r.fingerprint).not.toBeNull()
  })

  it.each([
    ['ERROR', 'ERROR'],
    ['BUILDING', 'BUILDING'],
    ['CANCELED', 'CANCELED'],
  ])('deploys when the live deployment is %s', async (_n, readyState) => {
    const w = await matching()
    const fp = (w.live as { meta: Record<string, string> }).meta[FINGERPRINT_META_KEY]
    w.live = { readyState, target: 'production', meta: { [FINGERPRINT_META_KEY]: fp } }
    expect((await assessPageDeploy(fake(w), opts())).decision.skip).toBe(false)
  })

  it('deploys when the live deployment says it is not a production deployment', async () => {
    const w = await matching()
    const fp = (w.live as { meta: Record<string, string> }).meta[FINGERPRINT_META_KEY]
    w.live = { readyState: 'READY', target: 'preview', meta: { [FINGERPRINT_META_KEY]: fp } }
    expect((await assessPageDeploy(fake(w), opts())).decision.skip).toBe(false)
  })

  it('deploys when the recorded fingerprint is for a different algorithm version or is garbage', async () => {
    const w = await matching()
    w.live = {
      readyState: 'READY',
      target: 'production',
      meta: { [FINGERPRINT_META_KEY]: 'v1:abc' },
    }
    expect((await assessPageDeploy(fake(w), opts())).decision.skip).toBe(false)
  })

  it.each([
    ['no meta at all', { readyState: 'READY', target: 'production' }],
    ['meta that is not an object', { readyState: 'READY', target: 'production', meta: 'x' }],
    [
      'an empty fingerprint',
      { readyState: 'READY', target: 'production', meta: { [FINGERPRINT_META_KEY]: '' } },
    ],
    [
      'a non-string fingerprint',
      { readyState: 'READY', target: 'production', meta: { [FINGERPRINT_META_KEY]: 7 } },
    ],
  ])('deploys on %s', async (_n, live) => {
    expect((await assessPageDeploy(fake(world({ live })), opts())).decision.skip).toBe(false)
  })

  it('deploys when the project has no production deployment yet', async () => {
    const w = world({
      projects: { projects: [{ id: 'prj_1', name: 'ai-team-hq', targets: {} }] },
    })
    const r = await assessPageDeploy(fake(w), opts())
    expect(r.decision.skip).toBe(false)
    expect(r.fingerprint).not.toBeNull()
  })
})

describe('every input class that changes makes a skip impossible (through the real assessment)', () => {
  const noop = (): void => {}
  const skipsAfter = async (
    change: () => void,
    undo: () => void,
    over: Partial<GuardOptions> = {},
  ) => {
    const w = await matching()
    change()
    try {
      return (await assessPageDeploy(fake(w), opts(over))).decision.skip
    } finally {
      undo()
    }
  }
  const edit = (rel: string, to: string) => {
    const full = join(root, rel)
    const original = readFileSync(full, 'utf8')
    return { change: () => writeFileSync(full, to), undo: () => writeFileSync(full, original) }
  }

  it('control: with nothing changed it does skip (so the cases below could have skipped)', async () => {
    expect(await skipsAfter(noop, noop)).toBe(true)
  })

  it.each([
    ['a studio file', 'web/studio/app.js', 'export const a = 2\n'],
    ['the generated config.js', 'web/studio/config.js', "window.HQ_API = 'https://bbbb/hq-api'\n"],
    ['the reader function', 'api/notebook.py', 'print("readeR")\n'],
    ['act.py', 'scripts/notebook/act.py', 'print("acT")\n'],
    ['requirements.txt', 'requirements.txt', 'notebooklm-py\nhttpx==0.27.1\n'],
    ['vercel.json', 'vercel.json', '{"functions":{"x":1}}\n'],
  ])('%s', async (_n, rel, to) => {
    const e = edit(rel, to)
    expect(await skipsAfter(e.change, e.undo)).toBe(false)
  })

  it('the reader secret rotated', async () => {
    const w = await matching()
    const rotated = opts({ supplied: { NOTEBOOK_READER_SECRET: 'rotated' } })
    expect((await assessPageDeploy(fake(w), rotated)).decision.skip).toBe(false)
  })

  it('a deployment request field (target)', async () => {
    const w = await matching()
    const o = opts({
      deployment: { name: 'ai-team-hq', target: 'preview', projectSettings: { framework: null } },
    })
    expect((await assessPageDeploy(fake(w), o)).decision.skip).toBe(false)
  })

  it('a project build setting changed in the dashboard', async () => {
    const w = await matching()
    ;(w.projects as { projects: Record<string, unknown>[] }).projects[0] = {
      id: 'prj_1',
      name: 'ai-team-hq',
      framework: null,
      nodeVersion: '22.x',
      targets: { production: { id: 'dpl_live' } },
    }
    expect((await assessPageDeploy(fake(w), opts())).decision.skip).toBe(false)
  })

  it('an environment variable added, and one edited by hand', async () => {
    const added = await matching()
    ;(added.env as { envs: unknown[] }).envs.push({ key: 'NEW', updatedAt: 5 })
    expect((await assessPageDeploy(fake(added), opts())).decision.skip).toBe(false)
    const edited = await matching()
    ;(edited.env as { envs: { key: string; updatedAt: number }[] }).envs[1] = {
      key: 'OTHER_FLAG',
      updatedAt: 1_760_000_999_999,
    }
    expect((await assessPageDeploy(fake(edited), opts())).decision.skip).toBe(false)
  })

  it('the supplied secret is NOT affected by its own update time (an upsert of the same value must still skip)', async () => {
    const w = await matching()
    ;(w.env as { envs: { key: string; updatedAt: number }[] }).envs[0] = {
      key: 'NOTEBOOK_READER_SECRET',
      updatedAt: 999_999_999_999,
    }
    expect((await assessPageDeploy(fake(w), opts())).decision.skip).toBe(true)
  })
})

describe('fails open: every way the reading can go wrong deploys, and never throws', () => {
  it.each([
    ['the project list fails', /v9\/projects\?/],
    ['the environment read fails', /\/env/],
    ['the live deployment read fails', /v13\/deployments/],
  ])('%s', async (_n, failOn) => {
    const w = await matching()
    w.failOn = failOn
    const r = await assessPageDeploy(fake(w), opts())
    expect(r.decision.skip).toBe(false)
    expect(r.decision.reason).toContain('could not assess')
  })

  it('failing before the fingerprint is complete records nothing', async () => {
    const w = await matching()
    w.failOn = /\/env/
    const r = await assessPageDeploy(fake(w), opts())
    expect(r.fingerprint).toBeNull()
    expect(deploymentMeta(r)).toEqual({})
  })

  it.each([
    ['a project list of the wrong shape', { projects: { projects: 'x' } }],
    ['no such project', { projects: { projects: [{ id: 'p', name: 'else' }] } }],
    ['an environment list of the wrong shape', { env: { nope: 1 } }],
    ['a truncated environment list', { env: { envs: [], pagination: { next: 123 } } }],
    ['an environment entry with no key', { env: { envs: [{ updatedAt: 1 }] } }],
    ['a variable with no update time', { env: { envs: [{ key: 'OTHER_FLAG' }] } }],
    ['a live deployment of the wrong shape', { live: 'x' }],
  ])('%s', async (_n, over) => {
    const r = await assessPageDeploy(fake(world(over as Partial<FakeWorld>)), opts())
    expect(r.decision.skip).toBe(false)
  })

  it('a tree missing a required file deploys rather than crashing', async () => {
    const r = await assessPageDeploy(fake(world()), opts({ root: join(root, 'does-not-exist') }))
    expect(r.decision.skip).toBe(false)
    expect(r.fingerprint).toBeNull()
  })

  it('the reason never contains a secret value', async () => {
    const w = world({ failOn: /\/env/ })
    const r = await assessPageDeploy(fake(w), opts())
    expect(JSON.stringify(r)).not.toContain(SECRET)
  })
})

describe('requirements pin state is reported, not changed', () => {
  it('lists the unpinned line and not the pinned one', async () => {
    const r = await assessPageDeploy(fake(world()), opts())
    expect(r.unpinned).toEqual(['notebooklm-py'])
  })
})

describe('the reader cannot write', () => {
  it('exposes no method but get, and the real reader only GETs', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = []
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init })
      return new Response('{"ok":true}', { status: 200 })
    }) as unknown as typeof fetch
    const reader = makeVercelReader('tok', fakeFetch)
    expect(Object.keys(reader)).toEqual(['get'])
    await reader.get('/v9/projects?limit=100')
    expect(seen).toHaveLength(1)
    expect(seen[0]?.init?.method).toBeUndefined() // fetch defaults to GET
    expect(seen[0]?.url).toBe('https://api.vercel.com/v9/projects?limit=100')
  })

  it('a refusal throws a message that names the status and not the token', async () => {
    const fakeFetch = (async () => new Response('no', { status: 403 })) as unknown as typeof fetch
    await expect(makeVercelReader('super-secret-token', fakeFetch).get('/x')).rejects.toThrow(
      /http 403/,
    )
    await expect(makeVercelReader('super-secret-token', fakeFetch).get('/x')).rejects.not.toThrow(
      /super-secret-token/,
    )
  })
})
