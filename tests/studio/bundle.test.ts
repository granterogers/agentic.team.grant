import { describe, expect, it } from 'vitest'

// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import { takeBundled } from '../../web/studio/bundle.js'

const store = (sections: Record<string, { status: number; body: unknown }>, token = 'tok') => ({
  token,
  bundle: Promise.resolve({ section: 'first_load', data: sections }),
  taken: new Set<string>(),
})

describe('a section of the first-load bundle is handed out once, and only to the same token', () => {
  it('answers with the status and body the bundle holds', async () => {
    const s = store({ pulse: { status: 200, body: { section: 'pulse', data: { n: 1 } } } })
    const r = await takeBundled(s, 'pulse', 'tok')
    expect(r?.status).toBe(200)
    expect(await r?.json()).toEqual({ section: 'pulse', data: { n: 1 } })
  })

  it('carries a refusal through as the refusal it was, so the page treats it as it would a direct one', async () => {
    const s = store({ pulse: { status: 401, body: { error: 'unauthorized' } } })
    const r = await takeBundled(s, 'pulse', 'tok')
    expect(r?.status).toBe(401)
  })

  it('hands each section out once; a second read goes to the network', async () => {
    const s = store({ pulse: { status: 200, body: {} } })
    expect(await takeBundled(s, 'pulse', 'tok')).not.toBeNull()
    expect(await takeBundled(s, 'pulse', 'tok')).toBeNull()
  })

  it('never answers with a bundle asked for another token', async () => {
    const s = store({ pulse: { status: 200, body: {} } }, 'old')
    expect(await takeBundled(s, 'pulse', 'new')).toBeNull()
  })

  it('a section the bundle does not hold goes to the network', async () => {
    const s = store({ pulse: { status: 200, body: {} } })
    expect(await takeBundled(s, 'lately', 'tok')).toBeNull()
  })

  it('no bundle, or a bundle that failed, goes to the network', async () => {
    expect(await takeBundled(undefined, 'pulse', 'tok')).toBeNull()
    const failed = {
      token: 'tok',
      bundle: Promise.reject(new Error('down')),
      taken: new Set<string>(),
    }
    failed.bundle.catch(() => undefined)
    expect(await takeBundled(failed, 'pulse', 'tok')).toBeNull()
  })
})
