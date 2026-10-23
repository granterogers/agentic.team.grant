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

  it('the documents and contacts modules show a skeleton while the office is asked', () => {
    data.source.fetching = true
    expect(miniatures.docsMini(project)).toContain('bcskelwrap')
    expect(miniatures.contactsMini(project)).toContain('bcskelwrap')
    expect(miniatures.contactsMini(project)).not.toContain('Nobody is recorded')
  })

  it('the calendar keeps its month while the office is asked, when it already has events to draw', () => {
    // The calendar's events come from the Sample or this browser, not from the office, so a month that has events is
    // drawn at once. The skeleton is for an empty month that is still being asked for.
    data.source.fetching = true
    const html = miniatures.calendarMini(project)
    expect(html).toContain('data-bc-cal')
    expect(html).not.toContain('bcskelwrap')
    data.source.fetching = false
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
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every(Boolean)).toBe(true)
    expect(data.source.fetching).toBe(false)
  })

  it('uses the first asks the page started before its modules loaded, when they are good', async () => {
    const realFetch = globalThis.fetch
    const asked: string[] = []
    globalThis.fetch = ((url: string) => {
      asked.push(String(url))
      return Promise.resolve(new Response('{}', { status: 500 }))
    }) as typeof fetch
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    ;(globalThis as { hqEarly?: unknown }).hqEarly = {
      token: 'early-token',
      studio: Promise.resolve(ok({ data: { projects: [] } })),
      projects: Promise.resolve(ok({ data: [] })),
    }
    try {
      const loaded = await data.hydrate('https://example.invalid/api', 'early-token')
      expect(loaded).toBe(true)
      expect(asked.some((u) => u.includes('section=studio'))).toBe(false)
    } finally {
      globalThis.fetch = realFetch
      delete (globalThis as { hqEarly?: unknown }).hqEarly
    }
  })

  it('asks afresh when the early request has a different token', async () => {
    const realFetch = globalThis.fetch
    const asked: string[] = []
    globalThis.fetch = ((url: string) => {
      asked.push(String(url))
      return Promise.resolve(new Response('bad', { status: 500 }))
    }) as typeof fetch
    ;(globalThis as { hqEarly?: unknown }).hqEarly = {
      token: 'some-other-token',
      studio: Promise.resolve(new Response('{}', { status: 200 })),
      projects: Promise.resolve(new Response('{}', { status: 200 })),
    }
    try {
      await data.hydrate('https://example.invalid/api', 'this-token').catch(() => undefined)
      expect(asked.some((u) => u.includes('section=studio'))).toBe(true)
    } finally {
      globalThis.fetch = realFetch
      delete (globalThis as { hqEarly?: unknown }).hqEarly
    }
  })

  it('asks again after a gateway 502, and loads when the retry answers', async () => {
    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = ((url: string) => {
      if (!String(url).includes('section=studio')) return Promise.resolve(new Response('{}', { status: 500 }))
      calls += 1
      if (calls === 1) return Promise.resolve(new Response('bad gateway', { status: 502 }))
      return Promise.resolve(new Response(JSON.stringify({ data: { projects: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    }) as typeof fetch
    try {
      const loaded = await data.hydrate('https://example.invalid/api', 'token')
      expect(loaded).toBe(true)
      expect(calls).toBe(2)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('fills the project list from the projects section while the studio payload is still pending', async () => {
    const realFetch = globalThis.fetch
    let releaseStudio = (): void => undefined
    const studioPending = new Promise<void>((resolve) => {
      releaseStudio = resolve
    })
    globalThis.fetch = ((url: string) => {
      if (String(url).includes('section=projects')) {
        const body = { section: 'projects', data: [{ name: 'Alpha', slug: 'alpha' }, { name: 'Unnamed', slug: 'unnamed' }] }
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      return studioPending.then(() => new Response('{}', { status: 500 }))
    }) as typeof fetch
    try {
      const asking = data.hydrate('https://example.invalid/api', 'token')
      for (let i = 0; i < 50 && data.PROJECTS.length === 0; i++) await new Promise((r) => setTimeout(r, 10))
      expect(data.PROJECTS.map((p: { slug: string }) => p.slug)).toEqual(['alpha', 'unnamed'])
      expect(data.PROJECTS[1].name).toBe('Conversations')
      releaseStudio()
      await asking
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
