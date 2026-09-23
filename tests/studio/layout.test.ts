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
import { BOUNDS, COLS, clamp, compact, DEFAULT, squeeze } from '../../web/studio/bc/layout.js'

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

/*
 * MAKING ROOM WITHOUT MAKING SOMEBODY LEAVE.
 *
 * Grant, 23 September: "enlarging one panel can cause the neighbouring panel to
 * jump/move away... the neighbouring panel should intelligently shrink to
 * compensate where possible... Only move a panel to another row when the
 * available width genuinely cannot accommodate both panels at their minimum
 * viable widths."
 */
describe('squeezing a row rather than reflowing it', () => {
  /*
    The shape the layout functions deal in. `layout.js` is a browser module with
    no types (ADR-0002, no build step), so the callbacks below need it written
    out once rather than four times.
  */
  type Cell = { id: string; x: number; y: number; w: number; h: number }
  /* Two six-column panels side by side on one row. */
  const pair = () => [
    { id: 'tasks', x: 0, y: 0, w: 6, h: 5 },
    { id: 'board', x: 6, y: 0, w: 6, h: 5 },
  ]

  it('shrinks the neighbour to the right instead of pushing it down', () => {
    const widened = pair().map((m: Cell) => (m.id === 'tasks' ? { ...m, w: 8 } : m))
    const after = squeeze(widened, 'tasks')
    const board = after.find((m: Cell) => m.id === 'board')
    expect(board).toMatchObject({ x: 8, y: 0, w: 4 })
  })

  it('and the neighbour stays on the same row', () => {
    const widened = pair().map((m: Cell) => (m.id === 'tasks' ? { ...m, w: 8 } : m))
    const after = compact(squeeze(widened, 'tasks').map(clamp), 'tasks')
    expect(after.find((m: Cell) => m.id === 'board')?.y).toBe(0)
  })

  it('narrows a neighbour on the LEFT when the resized panel grows leftwards', () => {
    const widened = pair().map((m: Cell) => (m.id === 'board' ? { ...m, x: 4, w: 8 } : m))
    const after = squeeze(widened, 'board')
    expect(after.find((m: Cell) => m.id === 'tasks')).toMatchObject({ x: 0, w: 4 })
  })

  /*
    THE ONE CASE WHERE A ROW CHANGE IS RIGHT. `board` cannot go below its own
    minimum, so when there is not enough left for it, it is NOT mangled - it is
    left alone and compaction moves it down.
  */
  it('moves a neighbour down only when it cannot fit at its minimum width', () => {
    const min = BOUNDS.board.minW
    const widened = pair().map((m: Cell) => (m.id === 'tasks' ? { ...m, w: COLS - (min - 1) } : m))
    const after = compact(squeeze(widened, 'tasks').map(clamp), 'tasks')
    expect(after.find((m: Cell) => m.id === 'board')?.y).toBeGreaterThan(0)
  })

  it('never lets a squeezed neighbour fall below its minimum width', () => {
    for (let w = 3; w <= COLS; w += 1) {
      const widened = pair().map((m: Cell) => (m.id === 'tasks' ? { ...m, w } : m))
      for (const m of compact(squeeze(widened, 'tasks').map(clamp), 'tasks')) {
        expect(m.w).toBeGreaterThanOrEqual(BOUNDS[m.id].minW)
      }
    }
  })

  it('and never produces an overlap, whatever the width', () => {
    for (let w = 3; w <= COLS; w += 1) {
      const widened = pair().map((m: Cell) => (m.id === 'tasks' ? { ...m, w } : m))
      const after = compact(squeeze(widened, 'tasks').map(clamp), 'tasks')
      for (const a of after) {
        for (const b of after) {
          if (a === b) continue
          const over = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
          expect(over).toBe(false)
        }
      }
    }
  })

  it('leaves a module on another row alone', () => {
    const below = [...pair(), { id: 'documents', x: 0, y: 5, w: 6, h: 5 }]
    const widened = below.map((m: Cell) => (m.id === 'tasks' ? { ...m, w: 8 } : m))
    const after = squeeze(widened, 'tasks')
    expect(after.find((m: Cell) => m.id === 'documents')).toMatchObject({ x: 0, y: 5, w: 6 })
  })
})
