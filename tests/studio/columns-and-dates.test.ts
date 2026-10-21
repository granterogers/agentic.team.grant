import { beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as L from '../../web/studio/bc/layout.js'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as when from '../../web/studio/when.js'

/*
  The Card Table's columns (22 October 2026, Option A): each column can be renamed and hidden, the four task states stay
  fixed, and at least one column is always shown. Also the one date format the dashboard uses (item 50), and the strip on the
  right that the starter note keeps while it is pending (item 84).
*/
type Rect = { id: string; x: number; y: number; w: number; h: number }

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
  L.setStage(1440, 900)
})

describe('the Card Table columns', () => {
  it('start with the four task states under their own names, all shown', () => {
    expect(L.columnsOf('p')).toEqual([
      { id: 'todo', name: 'Not started', renamed: false, shown: true },
      { id: 'doing', name: 'In progress', renamed: false, shown: true },
      { id: 'blocked', name: 'Stuck', renamed: false, shown: true },
      { id: 'done', name: 'Done', renamed: false, shown: true },
    ])
  })

  it('a column can be renamed, and a name that is the default is not kept as a rename', () => {
    L.setColumns('p', { names: { doing: '  Working   on it  ', todo: 'Not started' }, hidden: [] })
    const cols = L.columnsOf('p') as Array<{ id: string; name: string; renamed: boolean }>
    expect(cols.find((c) => c.id === 'doing')).toMatchObject({
      name: 'Working on it',
      renamed: true,
    })
    expect(cols.find((c) => c.id === 'todo')).toMatchObject({ name: 'Not started', renamed: false })
  })

  it('a name is trimmed and cut to 24 characters', () => {
    L.setColumns('p', { names: { done: 'x'.repeat(60) }, hidden: [] })
    expect((L.columnsOf('p') as Array<{ name: string }>)[3]?.name).toBe('x'.repeat(24))
  })

  it('a column can be hidden, and its tasks are not touched', () => {
    L.setColumns('p', { names: {}, hidden: ['blocked'] })
    const cols = L.columnsOf('p') as Array<{ id: string; shown: boolean }>
    expect(cols.find((c) => c.id === 'blocked')?.shown).toBe(false)
    expect(cols.filter((c) => c.shown)).toHaveLength(3)
  })

  it('never hides every column: hiding all four keeps them all shown', () => {
    L.setColumns('p', { names: {}, hidden: ['todo', 'doing', 'blocked', 'done'] })
    expect((L.columnsOf('p') as Array<{ shown: boolean }>).every((c) => c.shown)).toBe(true)
  })

  it('a column id that is not one of the four states is dropped, never stored', () => {
    L.setColumns('p', { names: { archive: 'Old', done: 'Finished' }, hidden: ['archive'] })
    expect(L.doc('p').columns).toEqual({ names: { done: 'Finished' }, hidden: [] })
  })

  it('survives a save and a reload: the stored columns come back as they were set', () => {
    L.setColumns('p', { names: { doing: 'Working' }, hidden: ['blocked'] })
    const back = L.fromPanels(L.toPanels(L.doc('p')))
    expect(back.columns).toEqual({ names: { doing: 'Working' }, hidden: ['blocked'] })
  })
})

describe('the Card Table uses the strip once the starter note is settled (item 84)', () => {
  const boardWidth = (): number => (L.layout('p') as Rect[]).find((m) => m.id === 'board')?.w ?? 0

  it('while the starter note is pending, the strip on the right is kept for it', () => {
    const pending = boardWidth()
    L.setStage(1440, 900)
    expect(L.postits('p').length).toBe(1)
    expect(pending).toBeGreaterThan(0)
    const list = L.layout('p') as Rect[]
    const note = L.postits('p')[0] as Rect
    for (const m of list) expect(m.x + m.w).toBeLessThanOrEqual(note.x)
  })

  it('once a note is written, the Card Table takes the free width and is wider than while the note was pending', () => {
    const pending = boardWidth()
    L.addPostit('p')
    expect(boardWidth()).toBeGreaterThan(pending)
  })
})

describe('one date format for the dashboard (item 50)', () => {
  it('a day reads as 21 Oct 2026', () => {
    expect(when.day('2026-10-21T12:00:00Z')).toBe('21 Oct 2026')
  })

  it('a day with a time reads as 21 Oct 2026, 14:05', () => {
    expect(when.plain('2026-10-21T14:05:00Z')).toMatch(/^21 Oct 2026, 1[0-6]:05$/)
  })

  it('an unreadable date is empty, not "Invalid Date"', () => {
    expect(when.day('not a date')).toBe('')
    expect(when.plain('not a date')).toBe('')
  })
})
