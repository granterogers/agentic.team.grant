/**
 * The project home's layout engine.
 *
 * The properties below are the ones a person notices the moment they are
 * wrong: modules overlapping, a drop landing somewhere else, a resize that
 * silently exceeds the grid, and a stored layout from an older version
 * rendering as a page of holes. Every one of them is decidable from the
 * rectangles alone, which is why they are here rather than in a capture run —
 * a browser can show that two panes overlap, and cannot enumerate the
 * hundred drags that would have made them.
 */

import { describe, expect, it } from 'vitest'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import { BOUNDS, COLS, clamp, compact, DEFAULT } from '../../web/studio/bc/layout.js'

type Rect = { id: string; x: number; y: number; w: number; h: number }

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const anyOverlap = (list: Rect[]): [Rect, Rect] | null => {
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i] as Rect
      const b = list[j] as Rect
      if (overlaps(a, b)) return [a, b]
    }
  }
  return null
}

describe('the layout engine', () => {
  it('ships a default in which nothing overlaps and nothing leaves the grid', () => {
    const out = compact(DEFAULT) as Rect[]
    expect(anyOverlap(out)).toBeNull()
    for (const m of out) expect(m.x + m.w).toBeLessThanOrEqual(COLS)
  })

  it('clamps a module into its own bounds rather than refusing it', () => {
    /*
      A stored rectangle is untrusted input: it can come from an older version,
      a hand-edited localStorage, or a bound that has since changed. Refusing
      it would lose the page; clamping keeps every module and moves the one
      that is wrong.
    */
    const wide = clamp({ id: 'tasks', x: 0, y: 0, w: 99, h: 99 }) as Rect
    expect(wide.w).toBe(BOUNDS.tasks.maxW)
    expect(wide.h).toBe(BOUNDS.tasks.maxH)
    const tiny = clamp({ id: 'tasks', x: -5, y: -5, w: 0, h: 0 }) as Rect
    expect(tiny.w).toBe(BOUNDS.tasks.minW)
    expect(tiny.h).toBe(BOUNDS.tasks.minH)
    expect(tiny.x).toBe(0)
    expect(tiny.y).toBe(0)
  })

  it('never lets a module hang off the right edge, however wide it is asked to be', () => {
    const m = clamp({ id: 'documents', x: 10, y: 0, w: 8, h: 5 }) as Rect
    expect(m.x + m.w).toBeLessThanOrEqual(COLS)
  })

  it('pushes the module underneath down rather than overlapping it', () => {
    const out = compact(
      [
        { id: 'tasks', x: 0, y: 0, w: 6, h: 5 },
        { id: 'board', x: 0, y: 0, w: 6, h: 5 },
      ],
      null,
    ) as Rect[]
    expect(anyOverlap(out)).toBeNull()
    expect(out.map((m) => m.y).sort((a, b) => a - b)).toEqual([0, 5])
  })

  it('leaves the module being dragged on the row it was dropped on', () => {
    /*
      THE ONE EXCEPTION, and the reason it exists: without it the dragged
      module compacts to the top along with everything else and the drop reads
      as having been ignored.
    */
    const out = compact(
      [
        { id: 'tasks', x: 0, y: 0, w: 4, h: 4 },
        { id: 'board', x: 6, y: 9, w: 4, h: 4 },
      ],
      'board',
    ) as Rect[]
    expect((out.find((m) => m.id === 'board') as Rect).y).toBe(9)
  })

  it('closes the gap under a module that is not being dragged', () => {
    const out = compact([{ id: 'tasks', x: 0, y: 12, w: 4, h: 4 }], null) as Rect[]
    expect((out[0] as Rect).y).toBe(0)
  })

  it('is stable: compacting twice changes nothing the second time', () => {
    const once = compact(DEFAULT) as Rect[]
    const twice = compact(once) as Rect[]
    expect(twice).toEqual(once)
  })

  it('survives a stored layout naming a module that no longer exists', () => {
    const out = compact([
      { id: 'tasks', x: 0, y: 0, w: 4, h: 4 },
      { id: 'chat', x: 4, y: 0, w: 4, h: 4 },
    ]) as Rect[]
    /*
      compact() does not filter - layout() does, on the way out of storage -
      so what is asserted here is that an unknown id gets a usable default
      rather than NaN geometry, which would render as a pane with no box.
    */
    const ghost = out.find((m) => m.id === 'chat') as Rect
    expect(Number.isFinite(ghost.w)).toBe(true)
    expect(ghost.w).toBeGreaterThan(0)
  })

  it('never produces a fractional row or column', () => {
    const out = compact([{ id: 'tasks', x: 1.6, y: 2.4, w: 4.5, h: 5.5 }]) as Rect[]
    for (const v of Object.values(out[0] as Rect)) {
      if (typeof v === 'number') expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('keeps every minimum at or above three columns, so no pane can be a sliver', () => {
    /*
      Asserted as a property of the TABLE rather than of one entry, because the
      failure it guards against is somebody adding a seventh module with a
      minimum of one - which is 70px at a third of the page, and CLAUDE.md
      records what that does to a card: one character per line.
    */
    for (const [id, b] of Object.entries(
      BOUNDS as Record<string, { minW: number; minH: number }>,
    )) {
      expect(b.minW, id).toBeGreaterThanOrEqual(3)
      expect(b.minH, id).toBeGreaterThanOrEqual(3)
    }
  })
})
