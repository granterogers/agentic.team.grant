import { beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as L from '../../web/studio/bc/layout.js'

/*
  The automatic layout in the three content states Grant's brief names (22 October 2026, requirement 20): an EMPTY
  dashboard, a PARTIAL one and a FULL one, at every width the page is laid out for. The Sample has only the partial
  state, so this is where the empty and full states are proved. Geometry only; the rendered page is checked by
  scripts/verify/studio.ts and the browser run recorded in the ADR.
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

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const EMPTY = { open: 0, maxStage: 0, docs: 0, contacts: 0, activity: 0 }
const PARTIAL = { open: 4, maxStage: 2, docs: 3, contacts: 2, activity: 3 }
const FULL = { open: 40, maxStage: 20, docs: 40, contacts: 30, activity: 30 }
const WIDTHS = [1440, 1280, 820, 390]

beforeEach(() => {
  ;(globalThis as { localStorage?: Storage }).localStorage = memory()
  L.forgetAll()
  L.persistence({})
})

describe('the automatic layout in every content state', () => {
  for (const [name, counts] of [
    ['empty', EMPTY],
    ['partial', PARTIAL],
    ['full', FULL],
  ] as const) {
    for (const w of WIDTHS) {
      it(`${name} at ${String(w)} px: every module is on the page, none overlaps, and none leaves the window`, () => {
        L.setStage(w, 800)
        L.setContent('p', counts)
        const list = L.layout('p') as Rect[]
        expect(list.map((m) => m.id).sort()).toEqual([...L.ALL].sort())
        for (let i = 0; i < list.length; i += 1)
          for (let j = i + 1; j < list.length; j += 1)
            expect(overlaps(list[i] as Rect, list[j] as Rect), `${name} ${String(w)}`).toBe(false)
        for (const m of list) {
          expect(m.x, `${name} ${String(w)} ${m.id} left`).toBeGreaterThanOrEqual(0)
          expect(m.x + m.w, `${name} ${String(w)} ${m.id} right`).toBeLessThanOrEqual(w)
        }
      })
    }
  }

  it('an empty dashboard is compact: no module is taller than the empty height, apart from the calendar', () => {
    L.setStage(1440, 900)
    L.setContent('p', EMPTY)
    const list = L.layout('p') as Rect[]
    for (const m of list) if (m.id !== 'schedule') expect(m.h, m.id).toBeLessThanOrEqual(180)
  })

  it('a full dashboard uses the window: the content reaches further down than an empty one', () => {
    L.setStage(1440, 900)
    L.setContent('p', EMPTY)
    const empty = L.contentBottom('p')
    L.setContent('p', FULL)
    expect(L.contentBottom('p')).toBeGreaterThan(empty)
  })
})
