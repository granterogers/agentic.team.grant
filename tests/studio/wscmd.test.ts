/**
 * Workspace commands in plain words (HQ-CONV-001/002): the sentence parses to a command only when it names something
 * resolvable, and running it goes through the layout engine's own operations.
 */
import { beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error - a browser module with no types; ADR-0002, no build step.
import * as L from '../../web/studio/bc/layout.js'
// @ts-expect-error - a browser module with no types.
import * as W from '../../web/studio/bc/wscmd.js'

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

describe('parse', () => {
  const cases: [string, unknown][] = [
    ['Make Documents bigger', { op: 'resize', id: 'documents', dw: 0.25, dh: 0.25 }],
    ['make the calendar a bit smaller.', { op: 'resize', id: 'schedule', dw: -0.1, dh: -0.1 }],
    ['Documents wider', { op: 'resize', id: 'documents', dw: 0.25, dh: 0 }],
    ['please make tasks taller', { op: 'resize', id: 'tasks', dw: 0, dh: 0.25 }],
    ['Move Calendar right', { op: 'move', id: 'schedule', dx: 1, dy: 0 }],
    ['move the contacts up', { op: 'move', id: 'contacts', dx: 0, dy: -1 }],
    ['Make Tasks blue', { op: 'tint', id: 'tasks', tint: 'sky' }],
    ['colour the card table green', { op: 'tint', id: 'board', tint: 'mint' }],
    ['make documents plain', { op: 'tint', id: 'documents', tint: null }],
    ['Zoom out', { op: 'zoom', by: -1 }],
    ['zoom in', { op: 'zoom', by: 1 }],
    ['zoom to 80%', { op: 'zoom_to', to: 0.8 }],
    ['reset zoom', { op: 'zoom_to', to: 1 }],
    ['Hide contacts', { op: 'hide', id: 'contacts' }],
    ['show the latest activity again', { op: 'show', id: 'activity' }],
    ['Save this as Planning', { op: 'save', name: 'planning' }],
    ['switch to the research layout', { op: 'load', name: 'research' }],
    ['tidy up', { op: 'tidy' }],
    ['reset the view', { op: 'reset' }],
  ]
  for (const [text, want] of cases) {
    it(`"${text}"`, () => {
      expect(W.parse(text)).toEqual(want)
    })
  }
  // negative controls: nothing resolvable, nothing offered
  for (const text of [
    'Hide Sources', // not a module on the page
    'make the report bigger',
    'save it',
    'save the report as a pdf',
    'zoom to 900%',
    'what is the weather',
    'bigger',
    'show me the budget',
    'x'.repeat(120),
    '',
  ]) {
    it(`declines "${text.slice(0, 30)}"`, () => {
      expect(W.parse(text)).toBeNull()
    })
  }
})

describe('run, through the layout engine', () => {
  beforeEach(() => {
    ;(globalThis as { localStorage?: Storage }).localStorage = memory()
    L.forgetAll()
    L.setStage(1200, 620, true)
  })
  const rect = (slug: string, id: string) => L.layout(slug).find((m: { id: string }) => m.id === id)

  it('bigger grows the module about its centre and never past the stage', () => {
    const before = rect('p', 'documents')
    const r = W.run(L, 'p', W.parse('make documents bigger'))
    const after = rect('p', 'documents')
    expect(r.ok).toBe(true)
    expect(after.w).toBeGreaterThan(before.w)
    expect(after.x + after.w).toBeLessThanOrEqual(1200)
    expect(after.y + after.h).toBeLessThanOrEqual(620)
  })
  it('move shifts it and keeps it inside', () => {
    const before = rect('p', 'schedule')
    W.run(L, 'p', W.parse('move calendar right'))
    expect(rect('p', 'schedule').x).toBeGreaterThanOrEqual(before.x)
  })
  it('tint persists in the stored document', () => {
    W.run(L, 'p', W.parse('make tasks blue'))
    expect(rect('p', 'tasks').tint).toBe('sky')
  })
  it('hide takes it off the page and show puts it back, deleting nothing', () => {
    W.run(L, 'p', W.parse('hide contacts'))
    expect(rect('p', 'contacts')).toBeUndefined()
    expect(L.off('p')).toContain('contacts')
    expect(W.run(L, 'p', W.parse('hide contacts')).ok).toBe(false)
    W.run(L, 'p', W.parse('show contacts'))
    expect(rect('p', 'contacts')).toBeDefined()
  })
  it('save and load a named layout, and a preset by name', () => {
    W.run(L, 'p', W.parse('make tasks blue'))
    expect(W.run(L, 'p', W.parse('save this as Planning')).ok).toBe(true)
    W.run(L, 'p', W.parse('reset the view'))
    expect(rect('p', 'tasks').tint ?? null).toBeNull()
    expect(W.run(L, 'p', W.parse('switch to the planning layout')).ok).toBe(true)
    expect(rect('p', 'tasks').tint).toBe('sky')
    expect(W.run(L, 'p', W.parse('switch to the overview layout')).ok).toBe(true)
    expect(W.run(L, 'p', W.parse('switch to the nonsense layout')).ok).toBe(false)
  })
  it('zoom steps and sets, and Reset View never deletes a Post-it', () => {
    W.run(L, 'p', W.parse('zoom out'))
    expect(L.zoomOf('p')).toBeLessThan(1)
    W.run(L, 'p', W.parse('zoom to 120%'))
    expect(L.zoomOf('p')).toBeCloseTo(1.2, 5)
    const n = L.addPostit('p')
    L.setPostit('p', n.id ?? n, { text: 'keep me' })
    W.run(L, 'p', W.parse('reset the view'))
    expect(L.postits('p').some((x: { text: string }) => x.text === 'keep me')).toBe(true)
  })
  it('a module that is off the page is refused with a reason, not guessed at', () => {
    W.run(L, 'p', W.parse('hide documents'))
    const r = W.run(L, 'p', W.parse('make documents bigger'))
    expect(r.ok).toBe(false)
    expect(r.said).toMatch(/not on this page/)
  })
  it('every label says what it will do', () => {
    expect(W.label(W.parse('make tasks blue'))).toBe('Make To-dos sky')
    expect(W.label(W.parse('zoom to 80%'))).toBe('Zoom to 80%')
  })
})
