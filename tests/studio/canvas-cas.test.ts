// biome-ignore-all lint/suspicious/noExplicitAny: a fake office and layout.js modules without types
// biome-ignore-all format: a dense fake office and tables of cases, kept readable as written
/**
 * Compare-and-swap saves of a project's arrangement (#442, migration 1023), driven through the real layout.js against a fake
 * office that keeps a revision exactly as the database does: a save naming a stale revision is refused with the current copy.
 * They assert what must survive (no note lost, a deletion kept, a bounded number of attempts), never how it got there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Note = { id: string; text: string; at: number }

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
  rev = 0
  seq = 0
  conflicts = 0
  swaps = 0
  clockOffset = 0
  latency = 0
  lacksCas = false
  alwaysConflict = false
  now() {
    return Date.now() + this.clockOffset
  }
  async readRev() {
    if (this.lacksCas) throw new Error('unknown section')
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency))
    return { panels: this.panels === null ? null : JSON.parse(JSON.stringify(this.panels)), rev: this.rev, now: this.now() }
  }
  async saveIf(panels: any[], expected: number) {
    this.swaps += 1
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency))
    if (this.alwaysConflict || expected !== this.rev) {
      this.conflicts += 1
      if (this.alwaysConflict) this.rev = ++this.seq
      return { conflict: true, rev: this.rev, panels: this.panels, now: this.now() }
    }
    this.panels = JSON.parse(JSON.stringify(panels))
    this.rev = ++this.seq
    return { ok: true, rev: this.rev, now: this.now() }
  }
  notes(): Note[] {
    return (this.panels?.find((m) => m.id === '__workspace')?.postits ?? []) as Note[]
  }
}

const SLUG = 'riverside'
let counter = 0
const live: { L: any; office: Office }[] = []
const device = async (office: Office) => {
  counter += 1
  const L: any = await import(/* @vite-ignore */ `../../web/studio/bc/layout.js?cas=${counter}`)
  L.useStorage(memory())
  live.push({ L, office })
  L.persistence({
    save: async (_s: string, panels: any[]) => {
      office.panels = JSON.parse(JSON.stringify(panels))
      office.rev = ++office.seq
    },
    reset: async () => {
      office.panels = null
      office.rev = ++office.seq
    },
    fetch: async () => office.panels,
    readRev: () => office.readRev(),
    saveIf: (_s: string, panels: any[], rev: number) => office.saveIf(panels, rev),
    changed: () => undefined,
  })
  return {
    L,
    notes: () => (L.postits(SLUG) as Note[]).filter((n) => n.id !== 'n_starter'),
    add: (text: string) => {
      const n = L.addPostit(SLUG)
      L.setPostit(SLUG, n.id, { text })
      return n.id as string
    },
    remove: (id: string) => void L.removePostit(SLUG, id),
    open: () => {
      if (office.panels !== null) L.adopt(SLUG, office.panels)
    },
  }
}
const settle = async (devs: { open: () => void }[], ms = 60_000) => {
  for (let round = 0; round < 3; round += 1) {
    await vi.advanceTimersByTimeAsync(round === 0 ? ms : 30_000)
    for (const d of devs) d.open()
  }
  await vi.advanceTimersByTimeAsync(30_000)
}
const texts = (n: Note[]) => n.map((x) => x.text).sort()

beforeEach(() => {
  live.length = 0
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_000)
})
afterEach(() => vi.useRealTimers())

describe('compare-and-swap saves', () => {
  it('keeps every note when three devices save at once, and a stale save is refused rather than stored', async () => {
    const office = new Office()
    office.latency = 120
    const a = await device(office)
    const b = await device(office)
    const c = await device(office)
    a.add('laptop')
    b.add('phone')
    c.add('tablet')
    await settle([a, b, c])
    const want = ['laptop', 'phone', 'tablet']
    expect(texts(office.notes())).toEqual(want)
    expect(texts(a.notes())).toEqual(want)
    expect(texts(b.notes())).toEqual(want)
    expect(texts(c.notes())).toEqual(want)
    expect(office.conflicts).toBeGreaterThan(0)
  })

  it('keeps a deletion against a device that still holds the note', async () => {
    const office = new Office()
    const a = await device(office)
    const b = await device(office)
    const id = a.add('to be removed')
    a.add('stays')
    await settle([a, b])
    expect(texts(b.notes())).toEqual(['stays', 'to be removed'])
    b.remove(id)
    await settle([a, b])
    expect(texts(office.notes())).toEqual(['stays'])
    expect(texts(a.notes())).toEqual(['stays'])
  })

  it('stamps a note in the office clock, so a device with a wrong clock does not outrank a newer change', async () => {
    const office = new Office()
    office.clockOffset = -3_600_000 // this device is an hour ahead of the office
    const a = await device(office)
    a.add('first')
    await settle([a])
    a.add('second')
    const second = a.notes().find((n) => n.text === 'second')
    const serverNow = office.now()
    expect(second).toBeDefined()
    expect(Math.abs((second?.at ?? 0) - serverNow)).toBeLessThan(5_000)
  })

  it('ignores an implausible office clock instead of stamping notes in 1970', async () => {
    const office = new Office()
    office.clockOffset = -1_700_000_000_000
    const a = await device(office)
    a.add('first')
    await settle([a])
    a.add('second')
    const second = a.notes().find((n) => n.text === 'second')
    expect(second?.at ?? 0).toBeGreaterThan(1.7e12)
  })

  it('falls back to the merge-and-check loop when the office has no revisions yet, and still converges', async () => {
    const office = new Office()
    office.lacksCas = true
    const a = await device(office)
    const b = await device(office)
    a.add('laptop')
    b.add('phone')
    await settle([a, b])
    expect(office.swaps).toBe(0)
    expect(texts(office.notes())).toEqual(['laptop', 'phone'])
    expect(texts(a.notes())).toEqual(['laptop', 'phone'])
  })

  it('is bounded: an office that refuses every save is asked a limited number of times and the note is still held here', async () => {
    const office = new Office()
    office.alwaysConflict = true
    const a = await device(office)
    a.add('kept locally')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(office.swaps).toBeGreaterThan(0)
    expect(office.swaps).toBeLessThan(40)
    expect(texts(a.notes())).toEqual(['kept locally'])
  })

  it('does not send a Sample visitor anything (saveIf answers nothing) and does not loop', async () => {
    const office = new Office()
    const a = await device(office)
    a.L.persistence({
      save: async () => undefined,
      reset: async () => undefined,
      fetch: async () => null,
      readRev: () => office.readRev(),
      saveIf: () => undefined,
      changed: () => undefined,
    })
    a.add('local only')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(office.panels).toBeNull()
    expect(texts(a.notes())).toEqual(['local only'])
  })
})
