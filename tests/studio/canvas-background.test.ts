// biome-ignore-all lint/suspicious/noExplicitAny: layout.js modules without types and a fake office
// biome-ignore-all format: byte-array fixtures and one-line assertions read better than the formatter's wrapping
/**
 * The canvas background library (#445): the stored reference, its merge between devices, the file checks, and the library
 * manifest. The browser behaviour (preview, apply, zoom alignment, upload) is scripts/verify/canvas-background.ts.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* Plain modules without types: loaded as any, the way the other studio tests load them. */
const studio = '../../web/studio/bc'
const bd: any = await import(/* @vite-ignore */ `${studio}/backdrop.js`)
const L: any = await import(/* @vite-ignore */ `${studio}/layout.js`)

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

describe('the stored reference', () => {
  it('accepts a library id and fills in the rest', () => {
    const b = L.cleanBg({ id: 'slate', at: 5 })
    expect(b).toEqual({ id: 'slate', mode: 'tile', scale: 1, intensity: 1, tint: 0, at: 5 })
  })
  it('refuses anything that is not a plain id (no paths, no urls, no data)', () => {
    for (const id of ['', '../x', 'https://x.test/a.png', 'data:image/png;base64,AAAA', 'A B', 'x'.repeat(60), 7, null])
      expect(L.cleanBg({ id, at: 1 })).toBeNull()
    expect(L.cleanBg(null)).toBeNull()
    expect(L.cleanBg('slate')).toBeNull()
  })
  it('clamps every number and ignores an unknown mode', () => {
    const b = L.cleanBg({ id: 'walnut', mode: 'sideways', scale: 99, intensity: -4, tint: 5, at: 1 })
    expect(b).toMatchObject({ mode: 'tile', scale: 2, intensity: 0.2, tint: 0.6 })
  })
  it('survives the round trip through the office array, and an old document has none', () => {
    const d = L.normalise({ zoom: 1.4, bg: { id: 'linen', mode: 'cover', at: 9 } })
    const back = L.fromPanels(L.toPanels(d))
    expect(back.bg).toMatchObject({ id: 'linen', mode: 'cover', at: 9 })
    const old = L.fromPanels([{ id: '__workspace', v: 2, zoom: 1, postits: [], gone: {} }])
    expect(old.bg).toBeNull()
  })
  it('a document with only a background is worth keeping, and one with none is blank', () => {
    const only = L.toPanels(L.normalise({ bg: { id: 'paper', at: 3 } }))
    expect(L.fromPanels(only).bg?.id).toBe('paper')
  })
})

describe('choosing one, per project', () => {
  let store: Storage
  beforeEach(() => {
    L.forgetAll()
    store = memory()
    L.useStorage(store)
  })
  it('stores a small reference and leaves notes, positions and the view alone', () => {
    L.setView('a', { zoom: 1.5, x: -120, y: 40 })
    const note = L.addPostit('a')
    L.setPostit('a', note.id, { text: 'keep' })
    const before = JSON.stringify([L.doc('a').postits, L.doc('a').pan, L.doc('a').zoom, L.doc('a').mods])
    L.setBg('a', { id: 'slate', mode: 'tile', scale: 1, intensity: 0.85, tint: 0 })
    expect(L.bgOf('a')?.id).toBe('slate')
    const after = JSON.stringify([L.doc('a').postits, L.doc('a').pan, L.doc('a').zoom, L.doc('a').mods])
    expect(after).toBe(before)
    const stored = store.getItem('bc.stage.a') ?? ''
    /* A control first: the read must find the document, or "holds no image data" would be true of nothing. */
    expect(stored).toContain('"id":"slate"')
    expect(stored.includes('data:')).toBe(false)
    expect(stored.length).toBeLessThan(5000)
  })
  it('each project keeps its own, and one that never chose has none', () => {
    L.setBg('a', { id: 'slate' })
    L.setBg('b', { id: 'walnut' })
    expect(L.bgOf('a')?.id).toBe('slate')
    expect(L.bgOf('b')?.id).toBe('walnut')
    expect(L.bgOf('c')).toBeNull()
  })
  it('a view reset does not forget the background', () => {
    L.setBg('a', { id: 'leather' })
    L.setView('a', { zoom: 2, x: 5, y: 5 })
    L.reset('a')
    expect(L.bgOf('a')?.id).toBe('leather')
  })
  it('going back to the default is a choice that can beat an older one', () => {
    L.setBg('a', { id: 'slate' }, 1000)
    L.setBg('a', { id: 'default' }, 2000)
    expect(L.bgOf('a')?.id).toBe('default')
    expect(L.mergeBg(L.bgOf('a'), { id: 'slate', mode: 'tile', scale: 1, intensity: 1, tint: 0, at: 1000 })?.id).toBe('default')
  })
  it('an unusable choice changes nothing', () => {
    L.setBg('a', { id: 'slate' })
    L.setBg('a', { id: '../../etc/passwd' })
    expect(L.bgOf('a')?.id).toBe('slate')
  })
})

describe('two devices', () => {
  it('the newer choice wins on both, in either order', () => {
    const x = { id: 'slate', mode: 'tile', scale: 1, intensity: 1, tint: 0, at: 100 }
    const y = { id: 'walnut', mode: 'tile', scale: 1, intensity: 1, tint: 0, at: 200 }
    expect(L.mergeBg(x, y)?.id).toBe('walnut')
    expect(L.mergeBg(y, x)?.id).toBe('walnut')
    expect(L.mergeBg(null, x)?.id).toBe('slate')
    expect(L.mergeBg(x, null)?.id).toBe('slate')
  })
  it('the same instant picks the same copy on every device (no swapping for ever), and a local save prefers its own', () => {
    const x = { id: 'slate', mode: 'tile', scale: 1, intensity: 1, tint: 0, at: 100 }
    const y = { id: 'walnut', mode: 'tile', scale: 1, intensity: 1, tint: 0, at: 100 }
    expect(L.mergeBg(x, y)).toEqual(L.mergeBg(y, x))
    expect(L.mergeBg(x, y, true)).toEqual(x)
  })
})

describe('adopting the office copy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    L.forgetAll()
    L.useStorage(memory())
  })
  afterEach(() => vi.useRealTimers())
  it('a newer background from another device is taken, with this device’s notes kept', () => {
    const n = L.addPostit('p')
    L.setPostit('p', n.id, { text: 'mine' })
    L.setBg('p', { id: 'slate' }, 1_800_000_000_000)
    const theirs = L.toPanels(L.normalise({ bg: { id: 'walnut', at: 1_800_000_050_000 } }))
    L.adopt('p', theirs)
    expect(L.bgOf('p')?.id).toBe('walnut')
    expect(L.postits('p').some((x: any) => x.text === 'mine')).toBe(true)
  })
  it('an older background from another device does not undo this device’s choice', () => {
    L.setBg('p', { id: 'slate' }, 1_800_000_100_000)
    L.adopt('p', L.toPanels(L.normalise({ bg: { id: 'walnut', at: 1_800_000_000_000 } })))
    expect(L.bgOf('p')?.id).toBe('slate')
  })
  it('a device with none takes the office’s', () => {
    L.adopt('p', L.toPanels(L.normalise({ bg: { id: 'paper', at: 7 } })))
    expect(L.bgOf('p')?.id).toBe('paper')
  })
})

describe('checking a picture before it is decoded', () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(33)
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    b.set([0, 0, 0, 13], 8)
    b.set([0x49, 0x48, 0x44, 0x52], 12)
    new DataView(b.buffer).setUint32(16, w)
    new DataView(b.buffer).setUint32(20, h)
    return b
  }
  const jpeg = (w: number, h: number) =>
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
  const webpX = (w: number, h: number) => {
    const b = new Uint8Array(40)
    b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 0)
    const wm = w - 1
    const hm = h - 1
    b.set([wm & 255, (wm >> 8) & 255, (wm >> 16) & 255, hm & 255, (hm >> 8) & 255, (hm >> 16) & 255], 24)
    return b
  }
  const avif = (w: number, h: number) => {
    const b = new Uint8Array(64)
    b.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 0)
    b.set([0x69, 0x73, 0x70, 0x65], 30)
    new DataView(b.buffer).setUint32(38, w)
    new DataView(b.buffer).setUint32(42, h)
    return b
  }
  it('reads the type and size of each accepted format from the header alone', () => {
    expect(bd.sniff(png(1600, 900))).toEqual({ type: 'image/png', w: 1600, h: 900 })
    expect(bd.sniff(jpeg(1200, 800))).toEqual({ type: 'image/jpeg', w: 1200, h: 800 })
    expect(bd.sniff(webpX(2048, 1152))).toEqual({ type: 'image/webp', w: 2048, h: 1152 })
    expect(bd.sniff(avif(1920, 1080))).toEqual({ type: 'image/avif', w: 1920, h: 1080 })
  })
  it('refuses SVG and active content however it is named', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')
    expect(() => bd.sniff(svg)).toThrow(/SVG/)
    const xml = new TextEncoder().encode('<?xml version="1.0"?><svg></svg> padding padding padding')
    expect(() => bd.sniff(xml)).toThrow(/SVG/)
    const html = new TextEncoder().encode('<html><body>not a picture at all, just a page of text</body></html>')
    expect(() => bd.sniff(html)).toThrow(/not a JPEG, PNG, WebP or AVIF/)
  })
  it('refuses a file whose header claims too many pixels or too long an edge, before any decode', () => {
    const file = (n: number) => ({ size: n, name: 'x', slice: () => null }) as unknown as File
    expect(() => bd.vet(file(2000), png(60000, 60000))).toThrow(/too large to open safely/)
    expect(() => bd.vet(file(2000), png(13000, 100))).toThrow(/too large to open safely/)
    expect(() => bd.vet(file(2000), png(8000, 6000))).toThrow(/too large to open safely/)
    expect(bd.vet(file(2000), png(7000, 5000)).w).toBe(7000)
    expect(() => bd.vet(file(bd.LIMITS.bytes + 1), png(10, 10))).toThrow(/over 15 MB/)
    expect(() => bd.vet(file(0), png(10, 10))).toThrow(/empty/)
    expect(() => bd.vet(file(2000), png(0, 0))).toThrow(/no size/)
  })
  it('refuses a truncated or lying header', () => {
    expect(() => bd.sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]))).toThrow(/damaged/)
    expect(() => bd.sniff(new Uint8Array(10))).toThrow(/too small/)
  })
})

describe('the library', () => {
  const lib = JSON.parse(readFileSync('web/studio/textures/bg/library.json', 'utf8')) as any[]
  it('has stable, unique, well-formed ids, and every file is present and modest', () => {
    expect(lib.length).toBeGreaterThanOrEqual(8)
    const ids = lib.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of lib) {
      expect(e.id).toMatch(/^[a-z0-9][a-z0-9-]{0,47}$/)
      for (const f of [e.file, e.thumb]) expect(existsSync(`web/studio${f}`)).toBe(true)
      expect(statSync(`web/studio${e.file}`).size).toBeLessThan(900 * 1024)
      expect(statSync(`web/studio${e.thumb}`).size).toBeLessThan(40 * 1024)
      expect(e.tile.w).toBeGreaterThanOrEqual(1024)
      expect(['light', 'dark']).toContain(e.tone)
      expect(e.name.length).toBeGreaterThan(2)
    }
  })
  it('records where each image came from and on what terms, and never the same original twice', () => {
    for (const e of lib) {
      expect(e.credit).not.toBe('')
      expect(e.license).not.toBe('')
      expect(e.sourceSha1).toMatch(/^[0-9a-f]{40}$/)
    }
    expect(new Set(lib.map((e) => e.sourceSha1)).size).toBe(lib.length)
  })
  it('the module the page imports is the manifest, entry for entry', () => {
    const js = readFileSync('web/studio/textures/bg/library.js', 'utf8')
    const body = js.slice(js.indexOf('export const LIBRARY = ') + 'export const LIBRARY = '.length)
    expect(JSON.parse(body)).toEqual(lib)
  })
  it('the picker is built from the library, so a new entry appears with no UI change', () => {
    const ids = bd.entries().map((e: any) => e.id)
    for (const e of lib) expect(ids).toContain(e.id)
    expect(ids[0]).toBe('default')
    expect(ids).toContain('none')
  })
  it('the default and a project that never chose draw nothing new', () => {
    expect(bd.styleFor(null)).toBe('')
    expect(bd.attrsFor(null)).toBe('')
    expect(bd.styleFor({ id: 'default', mode: 'tile', scale: 1, intensity: 1, tint: 0, at: 1 })).toBe('')
  })
  it('a material is drawn at half its pixel size so grain stays crisp, scaled by the choice', () => {
    const s = bd.styleFor({ id: 'slate', mode: 'tile', scale: 2, intensity: 0.5, tint: 0.2, at: 1 })
    expect(s).toContain('--bc-bg-tw:2048px')
    expect(s).toContain('--bc-bg-veilp:50%')
    expect(s).toContain('--bc-bg-shadep:20%')
    expect(s).toContain("url('/textures/bg/slate.webp')")
  })
  it('a retired entry leaves the picker but a project that chose it still draws it', () => {
    const e = lib[0]
    expect(bd.find(e.id)).not.toBeNull()
  })
})
