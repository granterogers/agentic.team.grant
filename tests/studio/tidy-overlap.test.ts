/**
 * Tidy must leave no module over another and no module outside the stage (A6, 0.41.0).
 *
 * Found on the live Legacy course: a row of five 240px modules in a 1200px stage was scaled to 230px, the minimum width
 * put it back to 240px, and the modules landed on each other. Each case below is a layout that produced an overlap or
 * an escape before the fix.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as L from '../../web/studio/bc/layout.js'

type R = { id: string; x: number; y: number; w: number; h: number }

const crosses = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const pairs = (list: R[]) => {
  let n = 0
  for (let i = 0; i < list.length; i += 1)
    for (let j = i + 1; j < list.length; j += 1) if (crosses(list[i] as R, list[j] as R)) n += 1
  return n
}
const outside = (list: R[], st: { w: number; h: number }) =>
  list.filter((m) => m.x < 0 || m.y < 0 || m.x + m.w > st.w || m.y + m.h > st.h).length

const row = (n: number, w: number, h: number): R[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, x: i * (w + 20), y: 0, w, h }))

describe('tidy leaves no overlap', () => {
  it('five 240px modules in a row of a 1200px stage', () => {
    const st = { w: 1200, h: 620 }
    const out = L.tidy(row(5, 240, 400), st)
    expect(pairs(out)).toBe(0)
    expect(outside(out, st)).toBe(0)
  })

  it('seven wide modules in one row', () => {
    const st = { w: 1200, h: 620 }
    const out = L.tidy(row(7, 260, 300), st)
    expect(pairs(out)).toBe(0)
    expect(outside(out, st)).toBe(0)
  })

  it('six modules stacked in two columns of a 620px stage', () => {
    const st = { w: 1200, h: 620 }
    const mods: R[] = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`,
      x: (i % 2) * 300,
      y: i * 90,
      w: 280,
      h: 200,
    }))
    const out = L.tidy(mods, st)
    expect(pairs(out)).toBe(0)
    expect(outside(out, st)).toBe(0)
  })

  it('eight modules in two rows of a short stage', () => {
    const st = { w: 1200, h: 620 }
    const mods: R[] = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`,
      x: (i % 4) * 300,
      y: Math.floor(i / 4) * 300,
      w: 280,
      h: 280,
    }))
    const out = L.tidy(mods, st)
    expect(pairs(out)).toBe(0)
    expect(outside(out, st)).toBe(0)
  })

  it('a row that fits keeps its minimum width', () => {
    const st = { w: 1200, h: 620 }
    const out = L.tidy(row(3, 300, 300), st)
    for (const m of out) expect(m.w).toBeGreaterThanOrEqual(240)
  })
})
