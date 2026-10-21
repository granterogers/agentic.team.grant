import { beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as L from '../../web/studio/bc/layout.js'

/*
  Fit my arrangement to this window (aesthetic sprint, 9 October 2026): the explicit, non-destructive way to adapt an
  arrangement made at another window width. Nothing here may lose what the person made: the arrangement as it was is saved
  first, shape is kept, and notes and tints are untouched.
*/
type Rect = {
  id: string
  x: number
  y: number
  w: number
  h: number
  z?: number
  tint?: string | null
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
beforeEach(() => {
  ;(globalThis as { localStorage?: Storage }).localStorage = memory()
  L.forgetAll()
  L.persistence({})
})

const span = (mods: Rect[]): number =>
  Math.max(...mods.map((m) => m.x + m.w)) - Math.min(...mods.map((m) => m.x))

describe('scaleToWidth (pure)', () => {
  const mods: Rect[] = [
    { id: 'tasks', x: 100, y: 0, w: 300, h: 200 },
    { id: 'board', x: 420, y: 40, w: 300, h: 240 },
    { id: 'documents', x: 740, y: 0, w: 260, h: 200 },
  ]
  it('scales the horizontal extent to the width and moves the left edge to 0', () => {
    const out = L.scaleToWidth(mods, 1350) as Rect[]
    expect(Math.min(...out.map((m) => m.x))).toBe(0)
    expect(Math.abs(span(out) - 1350)).toBeLessThanOrEqual(3)
  })
  it('keeps the shape: order, heights and vertical positions are unchanged', () => {
    const out = L.scaleToWidth(mods, 1800) as Rect[]
    expect(out.map((m) => m.id)).toEqual(mods.map((m) => m.id))
    expect(out.map((m) => [m.y, m.h])).toEqual(mods.map((m) => [m.y, m.h]))
    const xs = out.map((m) => m.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  })
  it('keeps modules that did not overlap from overlapping when widening', () => {
    const out = L.scaleToWidth(mods, 1800) as Rect[]
    for (let i = 0; i < out.length - 1; i += 1) {
      const a = out[i] as Rect
      const b = out[i + 1] as Rect
      expect(a.x + a.w).toBeLessThanOrEqual(b.x + 1)
    }
  })
  it('is bounded: a degenerate arrangement is not blown up or crushed', () => {
    const tiny = L.scaleToWidth([{ id: 'tasks', x: 0, y: 0, w: 240, h: 150 }], 100000) as Rect[]
    expect((tiny[0] as Rect).w).toBeLessThanOrEqual(240 * 3 + 1)
    expect(L.scaleToWidth([], 1000)).toEqual([])
    expect(L.scaleToWidth(mods, 0)).toBe(mods)
  })
})

describe('fitToWindow', () => {
  /* Two pinned modules make an arrangement: one alone has no width of its own to fit (fitsWindow). */
  const arrangedNarrow = (slug: string): void => {
    L.setStage(900, 620)
    L.place(slug, 'tasks', { x: 20, y: 20, w: 400, h: 300 })
    L.place(slug, 'board', { x: 460, y: 20, w: 400, h: 300 })
    L.setTint(slug, 'tasks', 'mint')
  }

  it('a board that follows the window already fits, and fitting it does nothing', () => {
    L.setStage(1200, 620)
    expect(L.fitsWindow('p')).toBe(true)
    expect(L.fitToWindow('p')).toBe('')
    expect(L.layoutNames('p')).toEqual([])
  })

  it('an arrangement made at a narrower window does not fit a wider one, and is offered the fit', () => {
    arrangedNarrow('p')
    L.setStage(1700, 800)
    expect(L.fitsWindow('p')).toBe(false)
  })

  it('saves the arrangement as it was before changing anything', () => {
    arrangedNarrow('p')
    const before = (L.layout('p') as Rect[]).map((m) => ({ ...m }))
    L.setStage(1700, 800)
    const kept = L.fitToWindow('p')
    expect(kept).toBe('Before fitting')
    expect(L.layoutNames('p')).toContain('Before fitting')
    L.loadLayout('p', 'Before fitting')
    /* The modules the person arranged come back exactly. The automatic ones follow the window they are opened in. */
    const restored = (L.layout('p') as Rect[]).filter((m) => L.isPinned('p', m.id))
    const arranged = before.filter((m) => restored.some((r) => r.id === m.id))
    expect(restored.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }))).toEqual(
      arranged.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
    )
    expect(restored.length).toBe(2)
  })

  it('afterwards the arrangement fits, still belongs to the person, and keeps colour and stacking', () => {
    arrangedNarrow('p')
    const z = (L.layout('p') as Rect[]).map((m) => [m.id, m.z])
    L.setStage(1700, 800)
    L.fitToWindow('p')
    const out = L.layout('p') as Rect[]
    expect(L.fitsWindow('p')).toBe(true)
    expect(Math.abs(span(out) - 1700)).toBeLessThanOrEqual(1700 * 0.08)
    expect(out.find((m) => m.id === 'tasks')?.tint).toBe('mint')
    expect(out.map((m) => [m.id, m.z])).toEqual(z)
    /* Still the person's: a later window change does not silently re-flow it. */
    L.setStage(1300, 700)
    expect(L.layout('p')).not.toEqual(L.layout('other'))
    expect(L.fitsWindow('p')).toBe(false)
  })

  it('is idempotent, and a second real fit keeps its own copy instead of overwriting the first', () => {
    arrangedNarrow('p')
    L.setStage(1700, 800)
    expect(L.fitToWindow('p')).toBe('Before fitting')
    expect(L.fitToWindow('p')).toBe('')
    L.setStage(1000, 700)
    expect(L.fitToWindow('p')).toBe('Before fitting 2')
    expect(L.layoutNames('p')).toEqual(
      expect.arrayContaining(['Before fitting', 'Before fitting 2']),
    )
  })

  it('never touches the notes', () => {
    arrangedNarrow('p')
    const n = L.addPostit('p', {})
    L.setPostit('p', n.id, { text: 'keep me' })
    L.setStage(1700, 800)
    L.fitToWindow('p')
    expect((L.postits('p') as { text: string }[]).map((x) => x.text)).toContain('keep me')
  })
})
