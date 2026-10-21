/**
 * The project home's freeform workspace engine.
 *
 * Replaces the grid-era suite (4 October 2026): the 12-column model, collision
 * prevention and `squeeze` were Grant's 22 September request and the freeform
 * stage is his 4 October one, so those assertions are retired on purpose, not
 * weakened. What stays is the spirit of the old file - the properties a person
 * notices the moment they are wrong are decidable from rectangles alone.
 */

import { beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as L from '../../web/studio/bc/layout.js'

type Rect = {
  id: string
  x: number
  y: number
  w: number
  h: number
  z?: number
  tint?: string | null
}
const S = { w: 1200, h: 620 }

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

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

beforeEach(() => {
  ;(globalThis as { localStorage?: Storage }).localStorage = memory()
  L.forgetAll()
  L.persistence({})
  L.setStage(S.w, S.h)
})

describe('the default', () => {
  it('fits any stage and overlaps nothing', () => {
    for (const st of [
      { w: 1200, h: 620 },
      { w: 900, h: 500 },
      { w: 1800, h: 900 },
      // A tablet or a window dragged in: three columns of 240px cannot fit, and the page must not open overlapping itself.
      { w: 666, h: 560 },
      { w: 760, h: 600 },
      { w: 540, h: 700 },
      { w: 500, h: 900 },
    ]) {
      L.setStage(st.w, st.h)
      const list = L.layout('p') as Rect[]
      expect(list.length).toBe(L.ALL.length)
      for (const m of list) {
        expect(m.x).toBeGreaterThanOrEqual(0)
        // 21 October 2026: an automatic layout is as tall as its content, so the page scrolls to it; it is never clipped.
        if (st.w >= 600) expect(m.x + m.w).toBeLessThanOrEqual(st.w)
        expect(m.y + m.h).toBeLessThanOrEqual(L.contentBottom('p'))
      }
      for (let i = 0; i < list.length; i += 1)
        for (let j = i + 1; j < list.length; j += 1)
          expect(overlaps(list[i] as Rect, list[j] as Rect)).toBe(false)
    }
  })
})

describe('a stage too SHORT for the wrapped rows', () => {
  it('extends below the window instead of pushing the last row up into the one above (1024px with the chat open: 685 x 430)', () => {
    for (const st of [
      { w: 685, h: 430 },
      { w: 700, h: 360 },
      { w: 520, h: 300 },
    ]) {
      L.setStage(st.w, st.h)
      const list = L.layout('short') as Rect[]
      expect(list.length).toBe(L.ALL.length)
      for (const m of list) {
        expect(m.x).toBeGreaterThanOrEqual(0)
        expect(m.x + m.w).toBeLessThanOrEqual(st.w)
      }
      for (let i = 0; i < list.length; i += 1)
        for (let j = i + 1; j < list.length; j += 1)
          expect(
            overlaps(list[i] as Rect, list[j] as Rect),
            `${String(st.w)}x${String(st.h)}`,
          ).toBe(false)
    }
  })
})

describe('a start that cannot fit the stage is wrapped, not piled up', () => {
  it('every preset overlaps nothing at tablet widths, keeping every module at least its minimum', () => {
    for (const st of [
      { w: 666, h: 560 },
      { w: 760, h: 600 },
    ]) {
      for (const key of Object.keys(L.PRESETS)) {
        L.setStage(st.w, st.h)
        L.applyPreset('p', key)
        const list = L.layout('p') as Rect[]
        for (const m of list) {
          expect(m.w, `${key} ${m.id} width`).toBeGreaterThanOrEqual(L.MIN.w)
          expect(m.x + m.w, `${key} ${m.id} right edge`).toBeLessThanOrEqual(st.w)
        }
        for (let i = 0; i < list.length; i += 1)
          for (let j = i + 1; j < list.length; j += 1)
            expect(overlaps(list[i] as Rect, list[j] as Rect), `${key} ${st.w}`).toBe(false)
      }
    }
  })

  it('CONTROL: a person who drags one module onto another is never covered: the one in the way is laid out around it (21 October 2026)', () => {
    L.setStage(666, 560)
    const [a, b] = L.layout('p') as Rect[] as [Rect, Rect]
    L.place('p', a.id, { x: b.x + 10, y: b.y + 10, w: a.w, h: a.h })
    const list = L.layout('p') as Rect[]
    const A = list.find((m) => m.id === a.id) as Rect
    const B = list.find((m) => m.id === b.id) as Rect
    expect(overlaps(A, B)).toBe(false)
    expect([A.x, A.y]).toEqual([b.x + 10, b.y + 10])
  })
})

describe('the starter note never covers a module', () => {
  it('sits clear of every module at every stage, or is not offered', () => {
    for (const st of [
      { w: 1800, h: 900 },
      { w: 1200, h: 620 },
      { w: 780, h: 640 },
      { w: 666, h: 560 },
      { w: 540, h: 700 },
    ]) {
      L.forgetAll()
      L.setStage(st.w, st.h)
      const mods = L.layout('s') as Rect[]
      const notes = L.postits('s') as (Rect & { starter?: boolean })[]
      expect(notes.length).toBeLessThanOrEqual(1)
      for (const n of notes)
        for (const m of mods) expect(overlaps(n, m), `${st.w}x${st.h} ${m.id}`).toBe(false)
    }
  })

  it('CONTROL: on a wide stage there is one, so the check above is not passing on an empty list', () => {
    L.forgetAll()
    L.setStage(1800, 900)
    expect((L.postits('s') as Rect[]).length).toBe(1)
  })
})

describe('free placement', () => {
  it('moves and resizes by any pixel amount, not in grid steps', () => {
    const out = L.place('p', 'tasks', { x: 13, y: 7, w: 301, h: 177 }) as Rect[]
    const t = out.find((m) => m.id === 'tasks') as Rect
    expect([t.x, t.y, t.w, t.h]).toEqual([13, 7, 301, 177])
  })

  it('makes room: the module in the way is laid out around the one placed, and the placed one keeps its place', () => {
    const before = L.layout('p') as Rect[]
    const board = before.find((m) => m.id === 'board') as Rect
    const out = L.place('p', 'tasks', { x: board.x + 20, y: board.y + 20 }) as Rect[]
    const tasks = out.find((m) => m.id === 'tasks') as Rect
    const after = out.find((m) => m.id === 'board') as Rect
    expect(overlaps(tasks, after)).toBe(false)
    expect([tasks.x, tasks.y]).toEqual([board.x + 20, board.y + 20])
    expect(L.isPinned('p', 'board')).toBe(false)
  })

  it('raises what was just placed above everything', () => {
    const out = L.place('p', 'schedule', { x: 5 }) as Rect[]
    const top = Math.max(...out.map((m) => m.z ?? 0))
    expect((out.find((m) => m.id === 'schedule') as Rect).z).toBe(top)
  })

  it('keeps negative positions, repairs sizes, and bounds only absurd values', () => {
    const wild = L.clampRect({ id: 'tasks', x: -50, y: 9999, w: 3, h: 99999 }) as Rect
    expect(wild.x).toBe(-50)
    expect(wild.y).toBe(9999)
    expect(wild.w).toBe(L.MIN.w)
    expect(wild.h).toBe(L.MAX_SIZE)
    const lost = L.clampRect({ id: 'tasks', x: Number.NaN, y: 1e12, w: 300, h: 300 }) as Rect
    expect(lost.x).toBe(0)
    expect(lost.y).toBe(L.REACH)
  })

  it('lets a module sit beyond the original stage (infinite canvas, 8 Oct 2026)', () => {
    const out = L.place('p', 'tasks', { x: 5000, y: -3000 }) as Rect[]
    const t = out.find((m) => m.id === 'tasks') as Rect
    expect(t.x).toBe(5000)
    expect(t.y).toBe(-3000)
  })
})

describe('alignment guides', () => {
  const others = [{ id: 'a', x: 300, y: 100, w: 200, h: 100 }]
  it('snaps only within the threshold', () => {
    const near = L.align({ id: 'm', x: 297, y: 400, w: 150, h: 80 }, others, S, 'move', 6)
    expect(near.rect.x).toBe(300)
    expect(near.guides.some((g: { axis: string }) => g.axis === 'x')).toBe(true)
    const far = L.align({ id: 'm', x: 280, y: 400, w: 150, h: 80 }, others, S, 'move', 6)
    expect(far.rect.x).toBe(280)
  })
  it('snaps centres as well as edges', () => {
    const c = L.align({ id: 'm', x: 375, y: 400, w: 50, h: 80 }, others, S, 'move', 6)
    expect(c.rect.x + c.rect.w / 2).toBe(400)
  })
  it('resize snaps only the moving edges', () => {
    const r = L.align({ id: 'm', x: 100, y: 10, w: 197, h: 50 }, others, S, 'size', 6)
    expect(r.rect.x).toBe(100)
    expect(r.rect.x + r.rect.w).toBe(300)
  })
})

describe('Auto Arrange', () => {
  it('removes overlaps but keeps order, widths and rough position', () => {
    const messy = [
      { id: 'tasks', x: 20, y: 30, w: 400, h: 250, z: 1, tint: null },
      { id: 'board', x: 200, y: 40, w: 400, h: 240, z: 2, tint: null },
      { id: 'documents', x: 650, y: 35, w: 350, h: 250, z: 3, tint: null },
      { id: 'schedule', x: 30, y: 330, w: 500, h: 220, z: 4, tint: null },
    ]
    const out = L.tidy(messy, S) as Rect[]
    for (let i = 0; i < out.length; i += 1)
      for (let j = i + 1; j < out.length; j += 1)
        expect(overlaps(out[i] as Rect, out[j] as Rect)).toBe(false)
    const by = (id: string) => out.find((m) => m.id === id) as Rect
    expect(by('tasks').x).toBeLessThan(by('board').x)
    expect(by('board').x).toBeLessThan(by('documents').x)
    expect(by('schedule').y).toBeGreaterThan(by('tasks').y)
    for (const m of out) {
      expect(m.x + m.w).toBeLessThanOrEqual(S.w)
      expect(m.y + m.h).toBeLessThanOrEqual(S.h)
    }
  })
  it('keeps every module (it lightly tidies, it does not drop things)', () => {
    L.place('p', 'tasks', { x: 400, y: 100 })
    const out = L.autoArrange('p') as Rect[]
    expect(out.map((m) => m.id).sort()).toEqual([...L.ALL].sort())
  })
})

describe('Reset View', () => {
  it('resets arrangement, tint and zoom but never a Post-it or a saved layout', () => {
    L.place('p', 'tasks', { x: 300, y: 200 })
    L.setTint('p', 'tasks', 'coral')
    L.setZoom('p', 0.8)
    L.saveLayout('p', 'Mine')
    const note = L.addPostit('p')
    L.setPostit('p', note.id, { text: 'remember the roofer' })
    L.reset('p')
    expect(L.customised('p')).toBe(false)
    expect(L.zoomOf('p')).toBe(1)
    expect((L.layout('p') as Rect[]).every((m) => m.tint === null)).toBe(true)
    expect(L.postits('p').map((n: { text: string }) => n.text)).toEqual(['remember the roofer'])
    expect(L.layoutNames('p')).toEqual(['Mine'])
  })
  it('stores nothing at all when there is nothing left to keep', () => {
    L.place('p', 'tasks', { x: 300 })
    L.reset('p')
    expect(L.doc('p').mods).toBeNull()
    expect((globalThis.localStorage as Storage).getItem('bc.stage.p')).toBeNull()
  })
})

describe('persistence and project isolation', () => {
  it('round-trips through the office array', () => {
    L.place('p', 'tasks', { x: 11, y: 22, w: 333, h: 222 })
    L.setTint('p', 'tasks', '#aabbcc')
    L.setZoom('p', 1.2)
    const n = L.addPostit('p')
    L.setPostit('p', n.id, { text: 'hello' })
    const back = L.fromPanels(L.toPanels(L.doc('p')))
    expect(back).toEqual(L.doc('p'))
  })
  it('survives a reload from the browser store', () => {
    L.place('p', 'tasks', { x: 11, y: 22 })
    L.setTint('p', 'tasks', 'sky')
    L.setZoom('p', 0.7)
    L.forgetAll()
    expect((L.layout('p') as Rect[]).find((m) => m.id === 'tasks')).toMatchObject({
      x: 11,
      y: 22,
      tint: 'sky',
    })
    expect(L.zoomOf('p')).toBe(0.7)
  })
  it('keeps projects independent', () => {
    L.place('a', 'tasks', { x: 400 })
    L.setZoom('a', 0.6)
    const b = L.layout('b') as Rect[]
    expect(b.find((m) => m.id === 'tasks')?.x).not.toBe(400)
    expect(L.zoomOf('b')).toBe(1)
    L.addPostit('a')
    expect(L.postits('b')[0]).toMatchObject({ starter: true })
  })
  it('sends the whole document to the office, debounced, and a blank one as a reset', () => {
    const sent: unknown[] = []
    const resets: number[] = []
    L.persistence({
      save: (_s: string, p: unknown) => void sent.push(p),
      reset: () => void resets.push(1),
    })
    L.place('p', 'tasks', { x: 50 })
    L.flush()
    expect(sent.length).toBe(1)
    expect((sent[0] as Array<{ id: string }>).some((m) => m.id === '__workspace')).toBe(true)
    L.reset('p')
    L.flush()
    expect(resets.length).toBe(1)
  })
  it('does not adopt the office copy over a change made this session', () => {
    L.place('p', 'tasks', { x: 99 })
    const office = L.toPanels({ ...L.doc('p'), zoom: 1.4 })
    expect(L.adopt('p', office)).toBe(false)
    expect(L.zoomOf('p')).toBe(1)
  })
  it('adopts the office copy for a project not yet touched here', () => {
    const d = { ...L.normalise({}), zoom: 0.9 }
    expect(L.adopt('fresh', L.toPanels(d))).toBe(true)
    expect(L.zoomOf('fresh')).toBe(0.9)
  })
  it('treats a legacy grid-era array as no arrangement rather than a page of holes', () => {
    expect(L.fromPanels([{ id: 'tasks', x: 0, y: 0, w: 4, h: 5 }])).toBeNull()
  })
})

describe('tints', () => {
  it('offers eight to twelve curated tints', () => {
    expect(L.TINTS.length).toBeGreaterThanOrEqual(8)
    expect(L.TINTS.length).toBeLessThanOrEqual(12)
  })
  it('accepts curated and custom hex colours and refuses anything else', () => {
    expect(L.setTint('p', 'tasks', 'teal')).toBe(true)
    expect(L.setTint('p', 'tasks', '#12abEF')).toBe(true)
    expect(L.setTint('p', 'tasks', 'red; background:url(x)')).toBe(false)
    expect(L.setTint('p', 'tasks', null)).toBe(true)
  })
})

describe('zoom', () => {
  it('is bounded', () => {
    expect(L.setZoom('p', 9)).toBe(L.ZOOM.max)
    expect(L.setZoom('p', 0)).toBe(L.ZOOM.min)
  })
})

describe('named layouts and presets', () => {
  it('saves, loads, renames and deletes', () => {
    L.place('p', 'tasks', { x: 321, y: 123 })
    expect(L.saveLayout('p', '  Focus  ')).toBe('Focus')
    L.place('p', 'tasks', { x: 5, y: 5 })
    expect(L.loadLayout('p', 'Focus')).toBe(true)
    expect((L.layout('p') as Rect[]).find((m) => m.id === 'tasks')).toMatchObject({
      x: 321,
      y: 123,
    })
    expect(L.renameLayout('p', 'Focus', 'Deep work')).toBe(true)
    expect(L.layoutNames('p')).toEqual(['Deep work'])
    expect(L.deleteLayout('p', 'Deep work')).toBe(true)
    expect(L.layoutNames('p')).toEqual([])
  })
  it('refuses a rename onto an existing name and an empty name', () => {
    L.saveLayout('p', 'A')
    L.saveLayout('p', 'B')
    expect(L.renameLayout('p', 'A', 'B')).toBe(false)
    expect(L.saveLayout('p', '   ')).toBe('')
  })
  it('ships Overview, Planning, Research and Documents', () => {
    expect(Object.values(L.PRESETS).map((p) => (p as { name: string }).name)).toEqual([
      'Overview',
      'Planning',
      'Research',
      'Documents',
    ])
    for (const key of Object.keys(L.PRESETS)) {
      expect(L.applyPreset('p', key)).toBe(true)
      for (const m of L.layout('p') as Rect[]) expect(m.x + m.w).toBeLessThanOrEqual(S.w)
    }
  })
})

describe('Post-its', () => {
  it('starts with one blank starter that is not stored until typed in', () => {
    const first = L.postits('p')
    expect(first.length).toBe(1)
    expect(first[0]).toMatchObject({ starter: true, text: '' })
    expect(L.doc('p').postits.length).toBe(0)
    const id = L.setPostit('p', 'n_starter', { text: 'hi' })
    expect(id).not.toBe('n_starter')
    expect(L.postits('p')).toMatchObject([{ text: 'hi' }])
  })
  it('creates more, moves them, resizes them, removes them explicitly', () => {
    const a = L.addPostit('p')
    const b = L.addPostit('p')
    expect(a.id).not.toBe(b.id)
    L.movePostit('p', a.id, { x: 10, y: 20, w: 250, h: 220 })
    expect(L.postits('p').find((n: { id: string }) => n.id === a.id)).toMatchObject({
      x: 10,
      y: 20,
      w: 250,
      h: 220,
    })
    L.removePostit('p', a.id)
    expect(L.postits('p').map((n: { id: string }) => n.id)).toEqual([b.id])
  })
  it('does not resurrect the starter after the last note is removed', () => {
    const a = L.addPostit('p')
    L.removePostit('p', a.id)
    expect(L.postits('p')).toEqual([])
  })
  it('is scoped to its project', () => {
    L.setPostit('a', 'n_starter', { text: 'only a' })
    expect(L.postits('b')[0]).toMatchObject({ starter: true })
  })
  it('holds text and a rectangle and nothing else (no extraction, no conversion)', () => {
    const n = L.addPostit('p')
    // `at` is when the note last changed, kept only so two copies can be merged note by note; nothing else may be added.
    expect(Object.keys(n).sort()).toEqual(['at', 'h', 'id', 'text', 'w', 'x', 'y', 'z'])
  })
})

describe('a press is not an arrangement (9 October 2026)', () => {
  const NARROW = { w: 880, h: 620 }
  const box = (list: Rect[]) => list.map((m) => `${m.id}:${m.x},${m.y},${m.w},${m.h}`).join(' ')

  it('raising a module keeps the default arrangement following the window', () => {
    L.raise('p', 'tasks')
    expect(L.customised('p')).toBe(false)
    L.setStage(NARROW.w, NARROW.h)
    const list = L.layout('p') as Rect[]
    L.forgetAll()
    L.setStage(NARROW.w, NARROW.h)
    expect(box(list)).toBe(box(L.layout('p') as Rect[]))
    for (let i = 0; i < list.length; i += 1)
      for (let j = i + 1; j < list.length; j += 1)
        expect(overlaps(list[i] as Rect, list[j] as Rect)).toBe(false)
  })
  it('a tint still sticks, and neither a raise nor a tint freezes the geometry (21 October 2026: an automatic layout has no stacking to change)', () => {
    L.raise('p', 'tasks')
    L.setTint('p', 'board', L.TINTS[0].id)
    const list = L.layout('p') as Rect[]
    expect(L.isAutomatic('p')).toBe(true)
    expect(list.find((m) => m.id === 'board')?.tint).toBe(L.TINTS[0].id)
    L.setStage(NARROW.w, NARROW.h)
    const narrow = L.layout('p') as Rect[]
    expect(narrow.find((m) => m.id === 'board')?.tint).toBe(L.TINTS[0].id)
    expect(narrow.every((m) => m.x + m.w <= NARROW.w)).toBe(true)
  })
  it('a move pins that module only: its rectangle is kept to the pixel when the window changes, and the rest stay automatic', () => {
    L.place('p', 'tasks', { x: 40, y: 30 })
    const moved = (L.layout('p') as Rect[]).find((m) => m.id === 'tasks') as Rect
    expect(L.customised('p')).toBe(true)
    expect([L.isPinned('p', 'tasks'), L.isPinned('p', 'board')]).toEqual([true, false])
    L.setStage(NARROW.w, NARROW.h)
    const narrow = L.layout('p') as Rect[]
    expect([
      narrow.find((m) => m.id === 'tasks')?.x,
      narrow.find((m) => m.id === 'tasks')?.y,
    ]).toEqual([moved.x, moved.y])
    for (let i = 0; i < narrow.length; i += 1)
      for (let j = i + 1; j < narrow.length; j += 1)
        expect(overlaps(narrow[i] as Rect, narrow[j] as Rect)).toBe(false)
  })
  it('a document stored before the flag existed is kept exactly as it was', () => {
    const arranged = (L.layout('p') as Rect[]).map((m) =>
      m.id === 'tasks' ? { ...m, x: m.x + 50 } : m,
    )
    L.forgetAll()
    localStorage.setItem(
      'bc.stage.q',
      JSON.stringify({ mods: arranged, zoom: 1, pan: { x: 0, y: 0 } }),
    )
    const before = box(L.layout('q') as Rect[])
    L.setStage(NARROW.w, NARROW.h)
    expect(box(L.layout('q') as Rect[])).toBe(before)
    expect(L.customised('q')).toBe(true)
  })
  it('a document that holds only a snapshot of the automatic arrangement follows the window again', () => {
    // 21 October 2026: a snapshot written without a person's move carries placed: false, and is automatic.
    const snapshot = (L.layout('p') as Rect[]).map((m) => ({ ...m, z: m.z ?? 1, placed: false }))
    L.forgetAll()
    localStorage.setItem(
      'bc.stage.q',
      JSON.stringify({ mods: snapshot, zoom: 1, pan: { x: 0, y: 0 } }),
    )
    expect(L.customised('q')).toBe(false)
    L.setStage(NARROW.w, NARROW.h)
    const list = L.layout('q') as Rect[]
    expect(list.every((m) => m.x + m.w <= NARROW.w)).toBe(true)
  })
  it('removing a module and adding it back does not freeze the rest', () => {
    L.remove('p', 'contacts')
    L.add('p', 'contacts')
    L.setStage(NARROW.w, NARROW.h)
    const list = L.layout('p') as Rect[]
    expect(list.length).toBe(L.ALL.length)
    expect(list.every((m) => m.x + m.w <= NARROW.w)).toBe(true)
  })
})
