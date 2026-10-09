// biome-ignore-all lint/suspicious/noExplicitAny: a fake office and layout.js modules without types
/**
 * Two and three devices editing one project's notes against one shared "office" (8 October 2026, #439, P1 data integrity).
 *
 * Each device is its own copy of layout.js (its own memory, its own timers) with its own localStorage, talking to a shared fake
 * office that stores ONE document per project and is last writer wins, exactly like `dashboard_layout_set`. The tests drive
 * adversarial orders: saves that cross, reads that arrive late, deletes against stale copies, a device that was offline.
 * They assert what must survive, never how: no note a person wrote may be silently lost or duplicated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Note = { id: string; text: string; at: number }
type Dev = {
  name: string
  L: any
  office: Office
  notes: () => Note[]
  add: (text: string) => string
  edit: (id: string, text: string) => void
  remove: (id: string) => void
  open: () => void
  redraws: number
}

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

class Office {
  panels: any[] | null = null
  saves = 0
  down = false
  latency = 0
  async save(panels: any[]) {
    if (this.down) throw new Error('offline')
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency))
    this.panels = JSON.parse(JSON.stringify(panels))
    this.saves += 1
  }
  async read() {
    if (this.down) throw new Error('offline')
    return this.panels === null ? null : JSON.parse(JSON.stringify(this.panels))
  }
  notes(): Note[] {
    const meta = this.panels?.find((m) => m.id === '__workspace')
    return (meta?.postits ?? []) as Note[]
  }
}

const SLUG = 'riverside'
let counter = 0
const device = async (name: string, office: Office): Promise<Dev> => {
  counter += 1
  const L: any = await import(
    /* @vite-ignore */ `../../web/studio/bc/layout.js?device=${name}${counter}`
  )
  L.useStorage(memory())
  const d: Dev = {
    name,
    L,
    office,
    redraws: 0,
    notes: () => L.postits(SLUG).filter((n: Note) => n.id !== 'n_starter'),
    add: (text) => {
      const n = L.addPostit(SLUG)
      L.setPostit(SLUG, n.id, { text })
      return n.id
    },
    edit: (id, text) => void L.setPostit(SLUG, id, { text }),
    remove: (id) => void L.removePostit(SLUG, id),
    open: () => {
      /* What the page does on load and on every refresh: adopt the office's copy. */
      if (office.panels !== null) L.adopt(SLUG, office.panels)
    },
  }
  live.push(d)
  L.persistence({
    save: (_slug: string, panels: any[]) => office.save(panels),
    reset: async () => {
      office.panels = null
    },
    fetch: () => office.read(),
    changed: () => {
      d.redraws += 1
    },
  })
  return d
}

const live: Dev[] = []
/**
 * Let every device's timers and reads run until nothing is left to do. Between rounds each device does what the page does on
 * its refresh (the office's pulse, or the tab coming back): adopt the office's copy. Three rounds are plenty for the loop to settle.
 */
const settle = async (ms = 90_000) => {
  for (let round = 0; round < 3; round += 1) {
    await vi.advanceTimersByTimeAsync(round === 0 ? ms : 30_000)
    for (const d of live) if (!d.office.down) d.open()
  }
  await vi.advanceTimersByTimeAsync(30_000)
}
const texts = (d: Dev) =>
  d
    .notes()
    .map((n) => n.text)
    .sort()
const officeTexts = (o: Office) =>
  o
    .notes()
    .map((n) => n.text)
    .sort()

beforeEach(() => {
  live.length = 0
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_000)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('two devices adding notes at once', () => {
  it('keeps both notes when their saves cross', async () => {
    const office = new Office()
    const a = await device('a', office)
    const b = await device('b', office)
    a.add('from the laptop')
    b.add('from the phone')
    await settle()
    expect(texts(a)).toEqual(['from the laptop', 'from the phone'])
    expect(texts(b)).toEqual(['from the laptop', 'from the phone'])
    expect(officeTexts(office)).toEqual(['from the laptop', 'from the phone'])
  })

  it('repairs the office copy by itself, with no device refreshing, after crossing saves', async () => {
    const office = new Office()
    const a = await device('a', office)
    const b = await device('b', office)
    a.add('from the laptop')
    b.add('from the phone')
    /* No refresh anywhere: only the check each device makes after its own save. */
    await vi.advanceTimersByTimeAsync(120_000)
    expect(officeTexts(office)).toEqual(['from the laptop', 'from the phone'])
  })

  it('keeps both when the office is slow and the second save lands after the first read', async () => {
    const office = new Office()
    office.latency = 4000
    const a = await device('a', office)
    const b = await device('b', office)
    a.add('A one')
    await vi.advanceTimersByTimeAsync(1000)
    b.add('B one')
    await settle()
    expect(texts(a)).toEqual(['A one', 'B one'])
    expect(texts(b)).toEqual(['A one', 'B one'])
    expect(office.notes()).toHaveLength(2)
  })

  it('does not duplicate a note that both devices already hold', async () => {
    const office = new Office()
    const a = await device('a', office)
    const b = await device('b', office)
    a.add('shared')
    await settle()
    b.open()
    await settle()
    expect(texts(b)).toEqual(['shared'])
    a.add('second')
    await settle()
    expect(texts(a)).toEqual(['second', 'shared'])
    expect(texts(b)).toEqual(['second', 'shared'])
    expect(office.notes()).toHaveLength(2)
  })
})

describe('edits', () => {
  it('keeps independent edits to different notes', async () => {
    const office = new Office()
    const a = await device('a', office)
    const b = await device('b', office)
    const x = a.add('first')
    const y = a.add('second')
    await settle()
    b.open()
    await settle()
    vi.setSystemTime(Date.now() + 5)
    a.edit(x, 'first, edited on A')
    b.edit(y, 'second, edited on B')
    await settle()
    for (const d of [a, b]) expect(texts(d)).toEqual(['first, edited on A', 'second, edited on B'])
    expect(officeTexts(office)).toEqual(['first, edited on A', 'second, edited on B'])
  })

  it('settles two edits of the same note on the newest, the same on both devices', async () => {
    const office = new Office()
    const a = await device('a', office)
    const b = await device('b', office)
    const id = a.add('original')
    await settle()
    b.open()
    await settle()
    a.edit(id, 'A early')
    await vi.advanceTimersByTimeAsync(50)
    b.edit(id, 'B later')
    await settle()
    expect(texts(a)).toEqual(['B later'])
    expect(texts(b)).toEqual(['B later'])
  })

  it('agrees even when both edits carry the very same instant', async () => {
    const office = new Office()
    const a = await device('a', office)
    const b = await device('b', office)
    const id = a.add('original')
    await settle()
    b.open()
    await settle()
    a.edit(id, 'A same ms')
    b.edit(id, 'B same ms')
    await settle()
    expect(texts(a)).toEqual(texts(b))
    expect(texts(a)).toHaveLength(1)
  })
})

describe('deletion', () => {
  it('propagates a delete to a device that still holds the note', async () => {
    const office = new Office()
    const a = await device('a', office)
    const b = await device('b', office)
    const id = a.add('to remove')
    a.add('to keep')
    await settle()
    b.open()
    await settle()
    expect(texts(b)).toEqual(['to keep', 'to remove'])
    vi.setSystemTime(Date.now() + 10)
    a.remove(id)
    await settle()
    expect(texts(a)).toEqual(['to keep'])
    expect(texts(b)).toEqual(['to keep'])
    expect(office.notes().map((n) => n.text)).toEqual(['to keep'])
  })

  it('does not let a stale device bring a deleted note back', async () => {
    const office = new Office()
    const a = await device('a', office)
    const b = await device('b', office)
    const id = a.add('gone for good')
    await settle()
    b.open()
    await settle()
    vi.setSystemTime(Date.now() + 10)
    a.remove(id)
    await vi.advanceTimersByTimeAsync(800)
    b.add('b writes something unrelated while it still holds the old note')
    await settle()
    expect(texts(a).some((t) => t === 'gone for good')).toBe(false)
    expect(texts(b).some((t) => t === 'gone for good')).toBe(false)
    expect(office.notes().some((n) => n.text === 'gone for good')).toBe(false)
  })

  it('lets an edit made after the delete win (the person came back to it)', async () => {
    const office = new Office()
    const a = await device('a', office)
    const b = await device('b', office)
    const id = a.add('contested')
    await settle()
    b.open()
    await settle()
    vi.setSystemTime(Date.now() + 10)
    a.remove(id)
    await vi.advanceTimersByTimeAsync(20)
    b.edit(id, 'contested, kept by B')
    await settle()
    expect(texts(a)).toEqual(['contested, kept by B'])
    expect(texts(b)).toEqual(['contested, kept by B'])
  })
})

describe('offline and hostile', () => {
  it('a device that was offline loses nothing and loses nobody else', async () => {
    const office = new Office()
    const a = await device('a', office)
    const b = await device('b', office)
    b.add('seen by both')
    await settle()
    a.open()
    office.down = true
    a.add('written offline on A')
    await settle(30_000)
    b.open()
    b.add('written online on B')
    await vi.advanceTimersByTimeAsync(800)
    office.down = false
    await settle()
    expect(texts(a)).toEqual(['seen by both', 'written offline on A', 'written online on B'])
    expect(texts(b)).toEqual(['seen by both', 'written offline on A', 'written online on B'])
    expect(office.notes()).toHaveLength(3)
  })

  it('a refused or failing read never loses notes or throws', async () => {
    const office = new Office()
    const a = await device('a', office)
    a.add('safe')
    office.down = true
    await settle(30_000)
    expect(texts(a)).toEqual(['safe'])
  })

  it('survives a hostile office document', async () => {
    const office = new Office()
    const a = await device('a', office)
    a.add('mine')
    await settle()
    office.panels = [
      {
        id: '__workspace',
        v: 2,
        postits: [
          null,
          7,
          { id: 5 },
          { id: 'n_x', text: 'x'.repeat(100_000), at: 'soon' },
          { id: 'n_ok', text: 'fine', at: 1 },
        ],
        gone: { n_bad: 'never', n_ok2: Number.NaN },
      },
    ]
    a.open()
    a.add('after')
    await settle()
    expect(texts(a)).toContain('mine')
    expect(texts(a)).toContain('after')
    for (const n of a.notes()) expect(n.text.length).toBeLessThanOrEqual(5000)
  })
})

describe('many devices, random order', () => {
  /* A small seeded generator so a failing run can be replayed. */
  const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  for (const seed of Array.from({ length: 40 }, (_, i) => i + 1)) {
    it(`converges and loses nothing (seed ${seed})`, async () => {
      const r = rng(seed)
      const office = new Office()
      office.latency = Math.floor(r() * 3000)
      const devs = [await device('a', office), await device('b', office), await device('c', office)]
      /* Every deliberate act, with the instant it happened: the newest act on a note decides whether it should exist. */
      const acts = new Map<string, { t: number; kind: 'write' | 'remove' }[]>()
      const act = (id: string, kind: 'write' | 'remove') =>
        acts.set(id, [...(acts.get(id) ?? []), { t: Date.now(), kind }])
      for (let step = 0; step < 30; step += 1) {
        const d = devs[Math.floor(r() * devs.length)] as Dev
        const roll = r()
        const mine = d.notes()
        if (roll < 0.4 || mine.length === 0) {
          act(d.add(`note ${step} from ${d.name}`), 'write')
        } else if (roll < 0.7) {
          const n = mine[Math.floor(r() * mine.length)] as Note
          d.edit(n.id, `${n.text} +${step}`)
          act(n.id, 'write')
        } else if (roll < 0.85) {
          const n = mine[Math.floor(r() * mine.length)] as Note
          d.remove(n.id)
          act(n.id, 'remove')
        } else {
          d.open()
        }
        await vi.advanceTimersByTimeAsync(Math.floor(r() * 4000))
      }
      await settle(120_000)
      const first = JSON.stringify(
        devs[0]
          ?.notes()
          .map((n) => [n.id, n.text])
          .sort(),
      )
      for (const d of devs) {
        expect(
          JSON.stringify(
            d
              .notes()
              .map((n) => [n.id, n.text])
              .sort(),
          ),
        ).toBe(first)
      }
      expect(
        JSON.stringify(
          office
            .notes()
            .map((n) => [n.id, n.text])
            .sort(),
        ),
      ).toBe(first)
      const have = new Set(devs[0]?.notes().map((n) => n.id))
      for (const [id, list] of acts) {
        const last = Math.max(...list.map((a) => a.t))
        const newest = list.filter((a) => a.t === last)
        /* Two different acts on the very same millisecond have no defined winner: the model does not judge them. */
        if (new Set(newest.map((a) => a.kind)).size !== 1) continue
        expect(have.has(id), `${id}: newest act is ${newest[0]?.kind}`).toBe(
          newest[0]?.kind === 'write',
        )
      }
    })
  }
})
