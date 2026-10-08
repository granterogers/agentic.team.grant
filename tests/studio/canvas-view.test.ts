/**
 * The infinite canvas's coordinate arithmetic (8 October 2026). These are the
 * pure functions the page uses for every pan, zoom and drag, so they are
 * decidable without a browser. The property that matters is that the world
 * point under the pointer does not move when zooming, however many times.
 */
import { beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error browser module without types (ADR-0002)
import * as L from '../../web/studio/bc/layout.js'

type V = { zoom: number; x: number; y: number }

const memory = (): Storage => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  }
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: memory(), configurable: true })
  L.forgetAll()
})

describe('canvas view arithmetic', () => {
  it('round-trips screen and world', () => {
    const v: V = { zoom: 1.7, x: -240, y: 91 }
    const w = L.toWorld(v, 512, 300)
    const s = L.toScreen(v, w.x, w.y)
    expect(s.x).toBeCloseTo(512, 9)
    expect(s.y).toBeCloseTo(300, 9)
  })

  it('zooms about the pointer: the world point under it stays put', () => {
    const v: V = { zoom: 1, x: 40, y: -20 }
    const before = L.toWorld(v, 700, 400)
    const after = L.zoomAt(v, 1.8, 700, 400) as V
    const now = L.toWorld(after, 700, 400)
    expect(now.x).toBeCloseTo(before.x, 9)
    expect(now.y).toBeCloseTo(before.y, 9)
    expect(after.zoom).toBeCloseTo(1.8, 9)
  })

  it('does not drift over 500 mixed zoom, pan and unzoom steps', () => {
    let v: V = { zoom: 1, x: 0, y: 0 }
    const anchor = L.toWorld(v, 321, 222)
    for (let i = 0; i < 500; i += 1) {
      v = L.zoomAt(v, i % 2 === 0 ? 1.13 : 0.9, 321, 222) as V
    }
    const now = L.toWorld(v, 321, 222)
    expect(now.x).toBeCloseTo(anchor.x, 6)
    expect(now.y).toBeCloseTo(anchor.y, 6)
  })

  it('clamps zoom to the bounds and then stops moving the origin', () => {
    let v: V = { zoom: 1, x: 10, y: 10 }
    for (let i = 0; i < 100; i += 1) v = L.zoomAt(v, 2, 100, 100) as V
    expect(v.zoom).toBe(L.ZOOM.max)
    const again = L.zoomAt(v, 2, 100, 100) as V
    expect(again).toEqual(v)
    for (let i = 0; i < 100; i += 1) v = L.zoomAt(v, 0.5, 100, 100) as V
    expect(v.zoom).toBe(L.ZOOM.min)
  })

  it('a drag is exact at every zoom: a screen delta of d moves the world by d / zoom', () => {
    for (const zoom of [0.2, 0.5, 1, 1.5, 2.5]) {
      const v: V = { zoom, x: 33, y: -17 }
      const a = L.toWorld(v, 400, 300)
      const b = L.toWorld(v, 400 + 120, 300 - 60)
      expect(b.x - a.x).toBeCloseTo(120 / zoom, 9)
      expect(b.y - a.y).toBeCloseTo(-60 / zoom, 9)
    }
  })

  it('fits rectangles into a box without magnifying past 100%', () => {
    const v = L.fitView(
      [
        { x: -900, y: -500, w: 400, h: 300 },
        { x: 1500, y: 1200, w: 400, h: 300 },
      ],
      1000,
      700,
    ) as V
    for (const r of [
      { x: -900, y: -500 },
      { x: 1900, y: 1500 },
    ]) {
      const s = L.toScreen(v, r.x, r.y)
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.x).toBeLessThanOrEqual(1000)
      expect(s.y).toBeGreaterThanOrEqual(0)
      expect(s.y).toBeLessThanOrEqual(700)
    }
    expect(L.fitView([{ x: 0, y: 0, w: 100, h: 100 }], 1000, 700).zoom).toBe(1)
  })
})

describe('the stored view', () => {
  it('persists per project and survives a reload of the cache', () => {
    L.setView('alpha', { zoom: 0.6, x: -1200, y: 340 })
    L.setView('beta', { zoom: 1.4, x: 5, y: 6 })
    L.flush()
    expect(L.viewOf('alpha')).toEqual({ zoom: 0.6, x: -1200, y: 340 })
    expect(L.viewOf('beta')).toEqual({ zoom: 1.4, x: 5, y: 6 })
    expect(L.normalise(JSON.parse(JSON.stringify(L.doc('alpha')))).pan).toEqual({
      x: -1200,
      y: 340,
    })
  })

  it('repairs a hostile or older stored document', () => {
    expect(L.normalise({ zoom: 1, pan: { x: 'a', y: null } }).pan).toEqual({ x: 0, y: 0 })
    expect(L.normalise({ zoom: 99 }).zoom).toBe(L.ZOOM.max)
    expect(L.normalise({ mods: null, zoom: 1 }).pan).toEqual({ x: 0, y: 0 })
  })

  it('reset view returns pan and zoom to the origin and keeps the notes', () => {
    L.addPostit('alpha')
    L.setView('alpha', { zoom: 2, x: 100, y: 100 })
    L.reset('alpha')
    expect(L.viewOf('alpha')).toEqual({ zoom: 1, x: 0, y: 0 })
    expect(L.postits('alpha').length).toBeGreaterThan(0)
  })
})

describe('where a new note goes', () => {
  const origin = { x: 100, y: 100, w: 210, h: 190 }
  it('goes to the right of the note it came from when that is free', () => {
    expect(L.spotNear(origin, [origin])).toEqual({ x: 326, y: 100 })
  })
  it('goes below when the right is taken, and never overlaps anything', () => {
    const right = { x: 326, y: 100, w: 210, h: 190 }
    const spot = L.spotNear(origin, [origin, right])
    expect(spot).toEqual({ x: 100, y: 306 })
    const taken = [
      origin,
      right,
      { x: 100, y: 306, w: 210, h: 190 },
      { x: -126, y: 100, w: 210, h: 190 },
      { x: 100, y: -106, w: 210, h: 190 },
    ]
    const fallback = L.spotNear(origin, taken)
    const r = { ...fallback, w: 210, h: 190 }
    for (const t of taken) {
      const apart = r.x >= t.x + t.w || t.x >= r.x + r.w || r.y >= t.y + t.h || t.y >= r.y + r.h
      expect(apart).toBe(true)
    }
  })
  it('adds beside a given note, panned far from the origin', () => {
    L.setView('n', { zoom: 0.4, x: -9000, y: 4000 })
    const a = L.addPostit('n', { at: { x: 12000, y: -800 } })
    const b = L.addPostit('n', { near: a.id })
    expect(a.x).toBe(12000)
    expect(b.x).toBe(12000 + 210 + 16)
    expect(L.postits('n').map((n: { id: string }) => n.id)).toContain(b.id)
  })
})

describe('the dotted grid', () => {
  it('never crowds below 14px and keeps its dots on the base lattice', () => {
    for (let z = 0.2; z <= 2.5; z += 0.05) {
      const step = L.gridStep(z) as number
      expect(step).toBeGreaterThanOrEqual(14 - 1e-9)
      const ratio = step / (24 * z)
      expect(Math.log2(ratio) % 1).toBeCloseTo(0, 9)
    }
    expect(L.gridStep(1)).toBe(24)
  })
})
