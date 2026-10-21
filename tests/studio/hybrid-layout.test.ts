import { beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as L from '../../web/studio/bc/layout.js'

/*
  Hybrid automatic layout (21 October 2026, Grant's brief): a manual move or resize overrides only the module it touched.
  Every other module keeps following its content and the window, laid out around the pinned ones. Nothing a person arranged is
  overwritten by the automatic layout, and each module can be returned to automatic on its own.
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

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const noOverlaps = (list: Rect[]): void => {
  for (let i = 0; i < list.length; i += 1)
    for (let j = i + 1; j < list.length; j += 1)
      expect(overlaps(list[i] as Rect, list[j] as Rect)).toBe(false)
}

const find = (list: Rect[], id: string): Rect => list.find((m) => m.id === id) as Rect

beforeEach(() => {
  ;(globalThis as { localStorage?: Storage }).localStorage = memory()
  L.forgetAll()
  L.persistence({})
  L.setStage(1280, 800)
})

describe('a move pins only the module that was moved', () => {
  it('the others are not pinned and stay automatic', () => {
    L.place('p', 'tasks', { x: 40, y: 30, w: 360, h: 220 })
    expect(L.pinnedOf('p')).toEqual(['tasks'])
    expect(L.isAutomatic('p')).toBe(false)
    expect(L.isPinned('p', 'documents')).toBe(false)
  })

  it('a content change re-lays the automatic modules and leaves the pinned rectangle where it was', () => {
    L.place('p', 'tasks', { x: 40, y: 30, w: 360, h: 220 })
    L.setContent('p', { open: 0, docs: 0, contacts: 0, activity: 0, maxStage: 0 })
    const small = L.layout('p') as Rect[]
    L.setContent('p', { open: 9, docs: 9, contacts: 6, activity: 6, maxStage: 6 })
    const full = L.layout('p') as Rect[]
    expect([find(full, 'tasks').x, find(full, 'tasks').y, find(full, 'tasks').h]).toEqual([
      40, 30, 220,
    ])
    expect(find(full, 'documents').h).not.toBe(find(small, 'documents').h)
    noOverlaps(full)
  })

  it('the automatic modules never cover a pinned one at any width', () => {
    L.place('p', 'board', { x: 300, y: 60, w: 420, h: 300 })
    for (const w of [1440, 1280, 980, 820, 640, 390]) {
      L.setStage(w, 800)
      const list = L.layout('p') as Rect[]
      expect(find(list, 'board')).toMatchObject({ x: 300, y: 60, w: 420, h: 300 })
      noOverlaps(list)
    }
  })
})

describe('returning one module to automatic', () => {
  it('releases only that module; the rest keep their arrangement', () => {
    L.place('p', 'tasks', { x: 40, y: 30, w: 360, h: 220 })
    L.place('p', 'board', { x: 500, y: 40, w: 420, h: 300 })
    expect(L.releaseModule('p', 'tasks')).toBe(true)
    expect(L.isPinned('p', 'tasks')).toBe(false)
    expect(L.isPinned('p', 'board')).toBe(true)
    const list = L.layout('p') as Rect[]
    expect(find(list, 'board')).toMatchObject({ x: 500, y: 40, w: 420, h: 300 })
    noOverlaps(list)
  })

  it('keeps the colour the person chose, since that is not sizing or positioning', () => {
    L.place('p', 'tasks', { x: 40, y: 30, w: 360, h: 220 })
    L.setTint('p', 'tasks', L.TINTS[0].id)
    L.releaseModule('p', 'tasks')
    expect(find(L.layout('p') as Rect[], 'tasks').tint).toBe(L.TINTS[0].id)
  })

  it('a module that is not pinned is not released, and nothing changes', () => {
    expect(L.releaseModule('p', 'documents')).toBe(false)
    expect(L.isAutomatic('p')).toBe(true)
  })

  it('releasing the last pinned module makes the whole project automatic again', () => {
    L.place('p', 'tasks', { x: 40, y: 30, w: 360, h: 220 })
    L.releaseModule('p', 'tasks')
    expect(L.isAutomatic('p')).toBe(true)
    expect(L.customised('p')).toBe(false)
  })
})

describe('arrange automatically keeps the manual layout as a backup', () => {
  it('unpins every module and stores the manual layout under a name', () => {
    L.place('p', 'tasks', { x: 40, y: 30, w: 360, h: 220 })
    L.place('p', 'board', { x: 500, y: 40, w: 420, h: 300 })
    expect(L.arrangeAutomatically('p')).toBe(true)
    expect(L.isAutomatic('p')).toBe(true)
    expect(L.layoutNames('p')).toContain('Before automatic arrangement')
    L.loadLayout('p', 'Before automatic arrangement')
    expect(find(L.layout('p') as Rect[], 'tasks')).toMatchObject({ x: 40, y: 30 })
  })

  it('does nothing when nothing is pinned', () => {
    expect(L.arrangeAutomatically('p')).toBe(false)
    expect(L.layoutNames('p')).toEqual([])
  })
})
