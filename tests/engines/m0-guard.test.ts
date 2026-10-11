/**
 * The M0 model guard (scripts/hermes-m0/model-guard.ts) and the "actually free" test (catalogue.ts), with no network and no key.
 *
 * Asserted: the property each rule exists for.
 *   - free means every price field is exactly zero; a name saying `:free` is not evidence, and a missing price is not zero;
 *   - the guard forwards nothing for a model off its allowlist and never touches the upstream;
 *   - the call cap refuses before the upstream is reached.
 * Each negative has its positive beside it, so a guard that refuses everything cannot pass.
 */
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { candidates, isZeroPriced } from '../../scripts/hermes-m0/catalogue.ts'
import { startGuard } from '../../scripts/hermes-m0/model-guard.ts'

const zero = {
  prompt: '0',
  completion: '0',
  request: '0',
  image: '0',
  web_search: '0',
  internal_reasoning: '0',
}
const model = (
  id: string,
  pricing: Record<string, string | null> | undefined,
  ctx = 131_072,
  tools = true,
) => ({
  id,
  context_length: ctx,
  ...(pricing === undefined ? {} : { pricing }),
  supported_parameters: tools ? ['tools', 'temperature'] : ['temperature'],
})

describe('what counts as free', () => {
  it('is every price field exactly zero, whatever the name says', () => {
    expect(isZeroPriced(model('a/b:free', zero))).toBe(true)
    // The name says free and the price is not.
    expect(isZeroPriced(model('a/c:free', { ...zero, completion: '0.0000004' }))).toBe(false)
    // No suffix, and free: a name test would have missed it.
    expect(isZeroPriced(model('a/ling-flash', zero))).toBe(true)
    // A missing or empty price block is unknown, and unknown is not zero.
    expect(isZeroPriced(model('a/d', undefined))).toBe(false)
    expect(isZeroPriced(model('a/e', {}))).toBe(false)
  })

  it('chooses candidates on context, tools and not being a router', () => {
    const all = [
      model('p/good:free', zero, 262_144),
      model('p/small:free', zero, 32_768),
      model('p/notools:free', zero, 262_144, false),
      model('p/paid:free', { ...zero, prompt: '0.000001' }, 262_144),
      model('openrouter/free', zero, 200_000),
      model('p/nosuffix', zero, 131_072),
    ]
    expect(candidates(all).map((c) => c.id)).toEqual(['p/good:free', 'p/nosuffix'])
    expect(candidates(all).find((c) => c.id === 'p/nosuffix')?.nameSaysFree).toBe(false)
  })
})

describe('the guard', () => {
  const setup = async (maxUpstreamCalls: number) => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-'))
    const logFile = join(dir, 'guard.jsonl')
    appendFileSync(logFile, '')
    const guard = await startGuard({
      upstreamKey: 'test-only-never-used-0000',
      allowed: new Set(['p/good:free']),
      maxUpstreamCalls,
      logFile,
      catalogue: [model('p/good:free', zero), model('p/paid', { ...zero, prompt: '1' })],
    })
    return { guard, logFile }
  }
  const post = (url: string, m: string) =>
    fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: m, messages: [{ role: 'user', content: 'hi' }] }),
    })

  it('refuses a model off the allowlist, records it, and makes no upstream call', async () => {
    const { guard, logFile } = await setup(5)
    try {
      const r = await post(guard.url, 'p/paid')
      expect(r.status).toBe(403)
      expect(guard.upstreamCalls()).toBe(0)
      expect(guard.calls[0]?.verdict).toBe('blocked_model')
      expect(readFileSync(logFile, 'utf8')).toContain('blocked_model')
    } finally {
      await guard.stop()
    }
  })

  it('refuses by call cap before reaching upstream, even for an allowed model', async () => {
    const { guard } = await setup(0)
    try {
      const r = await post(guard.url, 'p/good:free')
      expect(r.status).toBe(429)
      expect(guard.upstreamCalls()).toBe(0)
      expect(guard.calls[0]?.verdict).toBe('blocked_cap')
    } finally {
      await guard.stop()
    }
  })

  it('serves only allowlisted models in the model list', async () => {
    const { guard } = await setup(5)
    try {
      const list = (await (await fetch(`${guard.url}/v1/models`)).json()) as {
        data: { id: string }[]
      }
      expect(list.data.map((m) => m.id)).toEqual(['p/good:free'])
    } finally {
      await guard.stop()
    }
  })

  it('serves nothing else', async () => {
    const { guard } = await setup(5)
    try {
      expect((await fetch(`${guard.url}/v1/embeddings`, { method: 'POST' })).status).toBe(404)
    } finally {
      await guard.stop()
    }
  })
})
