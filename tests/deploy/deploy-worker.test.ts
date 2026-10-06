/**
 * The ORDER of a worker deploy: everything that can be known locally is known before the first production write.
 *
 * On 6 October 2026 `deploy:worker` reset the function's secrets (which advances every function's version number) and
 * only then had its bundle refused, because the import-graph walk had missed a file. Here the production effects are
 * recorded fakes, so the test can say what was and was not reached.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { BundleError } from '../../scripts/deploy/lib/bundle.ts'
import { DeployFailure, deployWorker } from '../../scripts/deploy/lib/deploy-worker.ts'

mkdirSync(path.join(process.cwd(), '.out'), { recursive: true })
const root = mkdtempSync(path.join(process.cwd(), '.out', 'deploy-worker-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const put = (name: string, source: string): string => {
  const file = path.join(root, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, source)
  return path.relative(process.cwd(), file)
}

type Call = string
const harness = (over: { deployStatus?: number; secretsStatus?: number } = {}) => {
  const calls: Call[] = []
  const db = {
    execute: async (sql: string) => {
      calls.push(`db: ${sql.trim().split(/\s+/).slice(0, 4).join(' ')}`)
      return { rows: sql.includes('decrypted_secrets') ? [{ v: 'kick-secret-for-the-test' }] : [] }
    },
  }
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${u.replace(/^https:\/\/[^/]+/, '')}`)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (u.endsWith('/secrets')) return new Response('', { status: over.secretsStatus ?? 201 })
    if (u.includes('/functions/deploy'))
      return json({ slug: 'worker', version: 99, status: 'ACTIVE' }, over.deployStatus ?? 201)
    if (method === 'GET') return json({ ok: true, configured: true })
    if (!init?.headers) return json({ error: 'no' }, 401)
    return json({ ok: true, handled: 0 })
  }) as typeof fetch
  const lines: string[] = []
  return {
    calls,
    lines,
    deps: {
      slug: 'worker',
      ref: 'ref',
      token: 'tok',
      api: 'https://api.example.test/v1/projects/ref',
      functionsBase: 'https://ref.example.test/functions/v1',
      db,
      fetchFn,
      log: (l: string) => lines.push(l),
      error: (l: string) => lines.push(l),
    },
  }
}

describe('deployWorker order', () => {
  it('a bundle with a missing local module fails BEFORE any production write or request', async () => {
    const entry = put(
      'missing/index.ts',
      "import { run } from './db/executor.ts'\nconsole.log(run)\n",
    )
    put('missing/db/executor.ts', "import '../safety/arm.ts'\nexport const run = 1\n") // arm.ts is not there
    const h = harness()
    await expect(deployWorker({ ...h.deps, entry })).rejects.toThrow(BundleError)
    await expect(deployWorker({ ...h.deps, entry })).rejects.toThrow(
      /imports '\.\.\/safety\/arm\.ts', which does not exist/,
    )
    // not the vault read, not the secrets call, not the deploy: nothing at all
    expect(h.calls).toEqual([])
  })

  it('a closed bundle writes secrets, then deploys, then probes, then states the flag - in that order', async () => {
    const entry = put('ok/index.ts', "import './arm.ts'\nexport {}\n")
    put('ok/arm.ts', 'export {}\n')
    const h = harness()
    await deployWorker({ ...h.deps, entry })
    const at = (needle: string): number => h.calls.findIndex((c) => c.includes(needle))
    expect(at('/secrets')).toBeGreaterThan(-1)
    expect(at('/secrets')).toBeLessThan(at('/functions/deploy'))
    expect(at('/functions/deploy')).toBeLessThan(at('POST /functions/v1/worker'))
    expect(h.calls.at(-1)).toMatch(/^db: insert into public\.system_config/)
    expect(h.lines.join('\n')).toContain('closure verified')
  })

  it('a refused secrets call stops the deploy (the pre-existing gate still holds)', async () => {
    const entry = put('refused/index.ts', 'export {}\n')
    const h = harness({ secretsStatus: 400 })
    await expect(deployWorker({ ...h.deps, entry })).rejects.toThrow(DeployFailure)
    expect(h.calls.some((c) => c.includes('/functions/deploy'))).toBe(false)
  })

  it('a platform refusal of the deploy is reported and the flag is never written', async () => {
    const entry = put('platform/index.ts', 'export {}\n')
    const h = harness({ deployStatus: 400 })
    await expect(deployWorker({ ...h.deps, entry })).rejects.toThrow(/deploy failed: 400/)
    expect(h.calls.some((c) => c.includes('system_config'))).toBe(false)
  })
})
