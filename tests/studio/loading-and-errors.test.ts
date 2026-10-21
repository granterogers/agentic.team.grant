import { beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as L from '../../web/studio/bc/layout.js'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as miniatures from '../../web/studio/bc/miniatures.js'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as data from '../../web/studio/data.js'

/*
  Items 25 and 26 (22 October 2026). A module with nothing in it says one of three true things: it is still loading (a
  skeleton), the office did not answer (an error with Try again), or there is genuinely nothing yet (the empty note).
  It must never say "nothing yet" while the office is still being asked, or when it could not be asked.
*/
const memory = (): Storage => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
}

const project = { slug: 'p', name: 'P', tasks: [], docs: [], contacts: [] }

beforeEach(() => {
  ;(globalThis as { localStorage?: Storage }).localStorage = memory()
  L.forgetAll()
  L.persistence({})
  L.setStage(1440, 900)
  data.source.fetching = false
  data.source.state = 'live'
})

describe('an empty module while the office is being asked (item 25)', () => {
  it('the Card Table shows a skeleton, not "No to-dos yet"', () => {
    data.source.fetching = true
    const html = miniatures.cardsMini(project)
    expect(html).toContain('bcskelwrap')
    expect(html).not.toContain('No to-dos yet')
  })

  it('the To-dos list shows a skeleton, not "No to-dos yet"', () => {
    data.source.fetching = true
    const html = miniatures.todosMini(project)
    expect(html).toContain('bcskelwrap')
    expect(html).not.toContain('No to-dos yet')
  })

  it('once the office has answered, an empty list is genuinely empty', () => {
    data.source.fetching = false
    expect(miniatures.cardsMini(project)).toContain('No to-dos yet')
    expect(miniatures.cardsMini(project)).not.toContain('bcskelwrap')
  })
})

describe('an empty module when the office did not answer (item 26)', () => {
  it('the Card Table says it could not be loaded, and offers Try again', () => {
    data.source.fetching = false
    data.source.state = 'unreachable'
    const html = miniatures.cardsMini(project)
    expect(html).toContain('could not be loaded just now')
    expect(html).toContain('data-bc-retry-office')
    expect(html).not.toContain('No to-dos yet')
  })

  it('the To-dos list says it could not be loaded, and offers Try again', () => {
    data.source.fetching = false
    data.source.state = 'unreachable'
    const html = miniatures.todosMini(project)
    expect(html).toContain('could not be loaded just now')
    expect(html).toContain('data-bc-retry-office')
  })
})

describe('hydrate tells the page when it is asking (item 25)', () => {
  it('is true while the office is being asked, and false again after a failure', async () => {
    const seen: boolean[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (() => {
      seen.push(data.source.fetching)
      return Promise.reject(new Error('no network in this test'))
    }) as typeof fetch
    try {
      await data.hydrate('https://example.invalid/api', 'token').catch(() => undefined)
    } finally {
      globalThis.fetch = realFetch
    }
    expect(seen).toEqual([true])
    expect(data.source.fetching).toBe(false)
  })
})
