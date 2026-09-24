/*
  The document ordering, as properties rather than as a screenshot.

  §§26-32: deterministic names, honest dates, and — the subtle one — an
  automatic sort that is a VIEW and never a write, so returning to Custom
  returns to exactly what he arranged.
*/
import { beforeEach, describe, expect, it } from 'vitest'

/* A localStorage the module can be given, because Node has none. */
class Store {
  private held = new Map<string, string>()
  getItem(k: string): string | null {
    return this.held.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.held.set(k, v)
  }
  removeItem(k: string): void {
    this.held.delete(k)
  }
}
;(globalThis as unknown as { localStorage: Store }).localStorage = new Store()

/*
  A variable specifier, so tsc does not try to type a hand-written ES module
  that has no declarations. The shape below is the contract this test asserts
  against, which is the useful half of a type here anyway.
*/
const WHERE = '../../web/studio/bc/docorder.js'
const docs = (await import(WHERE)) as {
  MODES: { id: string }[]
  ordered: (slug: string, list: unknown[], mode?: string) => { id: string }[]
  custom: (slug: string) => string[]
  remember: (slug: string, ids: string[]) => string[]
  adopt: (slug: string, ids: string[]) => boolean
  setMode: (slug: string, id: string) => boolean
  mode: (slug: string) => string
  moveWithin: (slug: string, drawn: unknown[], moved: string, onto: string) => string[] | null
  nudge: (slug: string, drawn: unknown[], moved: string, by: number) => string[] | null
  persistence: (hooks: Record<string, unknown>) => void
}

type Doc = {
  id: string
  title: string
  uploaded: string | null
  created: string | null
  added: string
}

const d = (
  id: string,
  title: string,
  uploaded: string | null,
  created: string | null,
  added = '2026-01-01T00:00:00Z',
): Doc => ({ id, title, uploaded, created, added })

const SET: Doc[] = [
  d('a', 'Chapter 10', '2026-03-01T00:00:00Z', null, '2026-01-03T00:00:00Z'),
  d('b', 'chapter 2', '2026-05-01T00:00:00Z', '2026-04-01T00:00:00Z', '2026-01-02T00:00:00Z'),
  d('c', 'Avatar', null, null, '2026-01-01T00:00:00Z'),
]
const ids = (list: { id: string }[]): string => list.map((x) => x.id).join('')

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: Store }).localStorage = new Store()
  docs.persistence({})
})

describe('name', () => {
  it('reads numbers as numbers, so 2 comes before 10', () => {
    expect(ids(docs.ordered('p', SET, 'name'))).toBe('cba')
  })

  it('does not split the list into two alphabets over a capital letter', () => {
    const mixed = [d('x', 'apple', null, null), d('y', 'Banana', null, null)]
    expect(ids(docs.ordered('p', mixed, 'name'))).toBe('xy')
  })

  it('breaks a tie the same way whichever end it started from', () => {
    const same = [d('m', 'Same', null, null), d('n', 'Same', null, null)]
    expect(ids(docs.ordered('p', same, 'name'))).toBe(
      ids(docs.ordered('p', [...same].reverse(), 'name')),
    )
  })
})

describe('dates', () => {
  it('puts the newest upload first', () => {
    expect(ids(docs.ordered('p', SET, 'uploaded')).slice(0, 2)).toBe('ba')
  })

  /*
    Not "missing is oldest". A document whose date the office does not know is
    not old, it is unknown, and placing it among the dated ones would be §15's
    invented metadata expressed as a position.
  */
  it('and a document with no upload date LAST, not oldest', () => {
    expect(ids(docs.ordered('p', SET, 'uploaded')).at(-1)).toBe('c')
  })

  it('sorts by creation only on what really has one', () => {
    const order = ids(docs.ordered('p', SET, 'created'))
    expect(order[0]).toBe('b')
    expect(order.slice(1).split('').sort().join('')).toBe('ac')
  })
})

describe('custom', () => {
  it('is the office order until he arranges one', () => {
    expect(ids(docs.ordered('p', SET, 'custom'))).toBe('abc')
  })

  it('follows the arrangement once he has', () => {
    docs.remember('p', ['c', 'a', 'b'])
    expect(ids(docs.ordered('p', SET, 'custom'))).toBe('cab')
  })

  it('puts a document he has never seen after the ones he arranged', () => {
    docs.remember('p', ['c', 'a'])
    expect(ids(docs.ordered('p', SET, 'custom'))).toBe('cab')
  })

  it('moves one onto another and keeps the whole order', () => {
    const drawn = docs.ordered('p', SET, 'custom')
    docs.moveWithin('p', drawn, 'c', 'a')
    expect(ids(docs.ordered('p', SET, 'custom'))).toBe('cab')
  })

  it('nudges one place, for anybody who cannot drag', () => {
    docs.remember('p', ['a', 'b', 'c'])
    docs.nudge('p', docs.ordered('p', SET, 'custom'), 'c', -1)
    expect(ids(docs.ordered('p', SET, 'custom'))).toBe('acb')
  })
})

describe('an automatic sort is a view, never a write', () => {
  it('survives a trip through every other mode', () => {
    docs.remember('p', ['c', 'a', 'b'])
    expect(ids(docs.ordered('p', SET, 'custom'))).toBe('cab')
    docs.ordered('p', SET, 'name')
    docs.ordered('p', SET, 'uploaded')
    docs.ordered('p', SET, 'created')
    expect(ids(docs.ordered('p', SET, 'custom'))).toBe('cab')
  })

  it('and choosing a mode stores no order at all', () => {
    docs.setMode('p', 'name')
    docs.ordered('p', SET, 'name')
    expect(docs.custom('p')).toEqual([])
  })
})

describe('the office', () => {
  it('is told about a rearrangement', () => {
    const sent: { slug: string; ids: string[] }[] = []
    docs.persistence({
      save: (slug: string, list: string[]) => {
        sent.push({ slug, ids: list })
      },
    })
    docs.remember('p', ['b', 'a'])
    expect(sent).toEqual([{ slug: 'p', ids: ['b', 'a'] }])
  })

  it('and its copy is adopted for a project this session has not touched', () => {
    docs.adopt('fresh', ['c', 'b', 'a'])
    expect(docs.custom('fresh')).toEqual(['c', 'b', 'a'])
  })

  /* ADR-0021's third rule: the redraw after a drag must not undo the drag. */
  it('but never over an arrangement made here, which may not have landed yet', () => {
    docs.remember('here', ['a', 'b'])
    docs.adopt('here', ['c', 'b', 'a'])
    expect(docs.custom('here')).toEqual(['a', 'b'])
  })
})
