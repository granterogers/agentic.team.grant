/**
 * Making room (Grant, 14 October 2026): a module moved or resized into another pushes that one down below it, and the
 * push carries on through anything it now touches. The modules that are not in the way keep their places.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as L from '../../web/studio/bc/layout.js'

const rect = (id: string, x: number, y: number, w: number, h: number) => ({ id, x, y, w, h })
const byId = (mods: { id: string; x: number; y: number; w: number; h: number }[], id: string) => {
  const found = mods.find((m) => m.id === id)
  if (found === undefined) throw new Error('no module ' + id)
  return found
}

describe('making room when a module lands on another', () => {
  it('pushes an overlapped module down, below the one that moved', () => {
    const mods = [rect('a', 0, 0, 300, 200), rect('b', 0, 100, 300, 200)]
    L.makeRoom(mods, 'a')
    expect(byId(mods, 'a').y).toBe(0)
    expect(byId(mods, 'b').y).toBe(200 + L.GAP)
  })

  it('carries the push on through a chain of modules it now touches', () => {
    const mods = [
      rect('a', 0, 0, 300, 200),
      rect('b', 0, 150, 300, 200),
      rect('c', 0, 300, 300, 200),
    ]
    L.makeRoom(mods, 'a')
    const b = byId(mods, 'b')
    const c = byId(mods, 'c')
    expect(b.y).toBe(200 + L.GAP)
    expect(c.y).toBe(b.y + 200 + L.GAP)
  })

  it('leaves a module that is not in the way exactly where it was', () => {
    const mods = [
      rect('a', 0, 0, 300, 200),
      rect('far', 600, 0, 300, 200),
      rect('below', 0, 800, 300, 200),
    ]
    L.makeRoom(mods, 'a')
    expect(byId(mods, 'far').y).toBe(0)
    expect(byId(mods, 'below').y).toBe(800)
  })

  it('does not move the module that was placed, even when others are pushed around it', () => {
    const mods = [rect('a', 0, 50, 300, 200), rect('b', 0, 60, 300, 100)]
    L.makeRoom(mods, 'a')
    expect(byId(mods, 'a').y).toBe(50)
    expect(byId(mods, 'b').y).toBe(50 + 200 + L.GAP)
  })

  it('a module that only touches the edge of another is not pushed', () => {
    const mods = [
      rect('a', 0, 0, 300, 200),
      rect('b', 300, 0, 300, 200),
      rect('c', 0, 200, 300, 200),
    ]
    L.makeRoom(mods, 'a')
    expect(byId(mods, 'b').y).toBe(0)
    expect(byId(mods, 'c').y).toBe(200)
  })
})
