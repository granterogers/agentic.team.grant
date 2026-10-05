/**
 * Post-its survive two tabs, an offline save and a long note.
 *
 * The workspace is stored as one document, so before this a note typed in one tab was erased by the next save from
 * another, and a note written offline was replaced by the older office copy on the next load. Two instances of the
 * module stand in for two tabs: they share localStorage and nothing else, exactly as two tabs do.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Mod = {
  forgetAll: () => void
  persistence: (p: object) => void
  setStage: (w: number, h: number) => void
  addPostit: (s: string) => { id: string }
  setPostit: (s: string, id: string, p: object) => string
  removePostit: (s: string, id: string) => void
  adopt: (s: string, panels: unknown) => boolean
  doc: (s: string) => { postits: { id: string; text: string; at: number }[] }
  toPanels: (d: unknown) => unknown
  flush: () => void
  reset: (s: string) => unknown
  NOTE_MAX: number
}
// A fresh module instance each call: its own in-memory cache, like a separate tab.
const load = async (_tab: string): Promise<Mod> => {
  vi.resetModules()
  // @ts-expect-error — a browser module with no types; ADR-0002, no build step.
  const m = (await import('../../web/studio/bc/layout.js')) as Mod
  m.forgetAll()
  m.persistence({})
  m.setStage(1200, 620)
  return m
}
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
const texts = (m: Mod, s = 'p'): string[] =>
  m
    .doc(s)
    .postits.map((n) => n.text)
    .sort()

beforeEach(() => {
  ;(globalThis as { localStorage?: Storage }).localStorage = memory()
})

describe('two tabs on one project', () => {
  it('keeps both notes instead of the last writer erasing the other', async () => {
    const a = await load('a1')
    const b = await load('b1')
    a.doc('p')
    b.doc('p') // both read an empty document first
    const na = a.addPostit('p')
    a.setPostit('p', na.id, { text: 'from tab A' })
    const nb = b.addPostit('p')
    b.setPostit('p', nb.id, { text: 'from tab B' })
    expect(texts(b)).toEqual(['from tab A', 'from tab B'])
    const reloaded = await load('c1')
    expect(texts(reloaded)).toEqual(['from tab A', 'from tab B'])
  })

  it('a removal in one tab is not undone by a stale copy in the other', async () => {
    const a = await load('a2')
    const n = a.addPostit('p')
    a.setPostit('p', n.id, { text: 'old' })
    const b = await load('b2')
    expect(texts(b)).toEqual(['old'])
    a.removePostit('p', n.id)
    b.setPostit('p', b.addPostit('p').id, { text: 'new in B' })
    const fresh = await load('c2')
    expect(texts(fresh)).toEqual(['new in B'])
  })

  it('Reset View in a stale tab cannot delete notes written elsewhere', async () => {
    const a = await load('a3')
    const b = await load('b3')
    b.doc('p')
    a.setPostit('p', a.addPostit('p').id, { text: 'kept' })
    b.reset('p')
    expect(texts(await load('c3'))).toEqual(['kept'])
  })
})

describe('an office copy older than the browser copy', () => {
  it('adopt folds the browser notes in and sends the result', async () => {
    const m = await load('a4')
    const sent: unknown[] = []
    m.persistence({ save: (_s: string, panels: unknown) => sent.push(panels) })
    const n = m.addPostit('p')
    m.setPostit('p', n.id, { text: 'written offline' })
    m.flush()
    sent.length = 0
    const stale = m.toPanels({
      ...m.doc('p'),
      postits: [],
      mods: null,
      layouts: {},
      zoom: 1,
      seeded: true,
    })
    const next = await load('b4')
    const got: unknown[] = []
    next.persistence({ save: (_s: string, panels: unknown) => got.push(panels) })
    expect(next.adopt('p', stale)).toBe(true)
    expect(texts(next)).toEqual(['written offline'])
    next.flush()
    expect(got.length).toBe(1)
  })
})

describe('the length limit', () => {
  it('is the limit the textarea advertises', async () => {
    const m = await load('a5')
    const n = m.addPostit('p')
    m.setPostit('p', n.id, { text: 'x'.repeat(m.NOTE_MAX + 500) })
    expect(m.doc('p').postits[0]?.text.length).toBe(m.NOTE_MAX)
  })
})
