/*
  THE CANVAS BACKGROUND (#445).

  What a project's board is painted on: the microcement it always had, one of the library's materials, a plain colour, or a
  picture the person uploaded. This module is the model and the painter. The picker is backdrop-ui.js.

  ## What is stored, and where

  A project stores a small REFERENCE in its workspace document (layout.js, field bg): the id, how it is laid out, three
  numbers. Never image bytes: the document is one JSON row that is read and written on every save. The library's own images are
  static files that ship with the page. A person's own picture is kept in this browser (IndexedDB, below), not in the
  office, because the office has no per-person image store the page may write to without a new gateway action and a migration,
  and those belong to the backend workstream (the dependency is written up in the issue). So a custom picture survives a
  reload and is private to the browser and the person who signed in to it (sign-out deletes it), and it is NOT on another device.
  A device that has the reference but not the picture says so and draws the default.

  ## Anchoring: a decision, stated once

  A tiling material is anchored to the WORLD: it is drawn from the same three variables as the dotted grid (the view's origin
  and zoom), so it pans and zooms with the modules like paper under them, and cannot drift against the dots or the panels. Its
  image is built as a 2x2 mirror (scripts/art/import_textures.py), so every edge meets its own reflection and there is no seam
  however far the board is panned. A picture laid out as cover, fit or centre is anchored to the VIEWPORT instead: a photograph
  has no meaningful repeat, and stretching one across a world that can be 200,000px wide is nonsense. One image is decoded
  once; zooming changes only a CSS size, never reloads.

  Layers, top to bottom: the dotted grid, a shade, a veil of the canvas colour (this is the opacity control), the image, the
  canvas colour. The page chrome outside the board keeps the stone it has, and the light or dark scheme is a separate choice.

  A note on comments in this file: a returned template literal ends at a backtick, so comments here avoid them.
*/

import { LIBRARY } from '../textures/bg/library.js'
import * as grid from './layout.js'

/** Plain colours, for the people who want no material. Each has a tone so the grid dots stay visible on it. */
export const SOLIDS = [
  { id: 'solid-stone', name: 'Stone', color: '#d4cfc7', tone: 'light' },
  { id: 'solid-sand', name: 'Sand', color: '#ddd3bf', tone: 'light' },
  { id: 'solid-sage', name: 'Sage', color: '#c5cdbf', tone: 'light' },
  { id: 'solid-mist', name: 'Mist', color: '#c8d0d8', tone: 'light' },
  { id: 'solid-charcoal', name: 'Charcoal', color: '#2f3338', tone: 'dark' },
]

/** Every choice the picker offers, in order. The picker reads this and nothing else, so adding a texture changes no UI code. */
export const entries = () => [
  {
    id: 'default',
    kind: 'default',
    name: 'Microcement',
    category: 'default',
    thumb: '/textures/microcement.webp',
    tone: 'light',
  },
  ...LIBRARY.filter((e) => e.retired !== true),
  { id: 'none', kind: 'none', name: 'Plain', category: 'colour', tone: 'light' },
  ...SOLIDS.map((s) => ({ ...s, kind: 'solid', category: 'colour' })),
]
export const find = (id) => entries().find((e) => e.id === id) ?? null

/** What a choice starts with: the material's own defaults, which is what makes each one look restrained out of the box. */
export const defaultsFor = (id) => {
  const e = find(id)
  if (e === null) return { mode: 'tile', scale: 1, intensity: 1, tint: 0 }
  if (e.kind === 'texture')
    return { mode: e.mode ?? 'tile', scale: 1, intensity: e.intensity ?? 1, tint: e.tint ?? 0 }
  if (id === 'custom') return { mode: 'cover', scale: 1, intensity: 1, tint: 0 }
  return { mode: 'tile', scale: 1, intensity: 1, tint: 0 }
}

/* The size and address of the person's own picture, kept per project once it is loaded, so the first paint can size it. */
const mine = new Map()
export const customInfo = (slug) => mine.get(slug) ?? null

/** The CSS custom properties and attributes for a background choice. `slug` is only used to look up a custom picture. */
export const resolve = (bg, slug = '') => {
  if (bg === null || bg === undefined || bg.id === 'default') return null
  const e = find(bg.id)
  const custom = bg.id === 'custom'
  if (e === null && !custom) return null
  const info = custom ? customInfo(slug) : null
  const kind = custom ? 'custom' : e.kind
  let w = 0
  let h = 0
  if (kind === 'texture') {
    // The tile is a 2x2 mirror shown at half its pixel size, so grain is crisp on a high-density screen and at 2x zoom.
    w = Math.round(e.tile.w * 0.5 * bg.scale)
    h = Math.round(e.tile.h * 0.5 * bg.scale)
  } else if (kind === 'custom' && info !== null) {
    w = Math.round(info.w * bg.scale)
    h = Math.round(info.h * bg.scale)
  }
  const tone = custom ? (info?.tone ?? 'light') : (e?.tone ?? 'light')
  return {
    id: bg.id,
    kind,
    mode: kind === 'texture' || kind === 'custom' ? bg.mode : 'tile',
    tone,
    img:
      kind === 'texture'
        ? `url('${e.file}')`
        : kind === 'custom' && info !== null
          ? `url('${info.url}')`
          : 'none',
    solid: kind === 'solid' ? e.color : '',
    w,
    h,
    veil: Math.round((1 - bg.intensity) * 100),
    shade: Math.round(bg.tint * 100),
  }
}

/** The inline style for a board, as a string for the first paint. Empty for the default. */
export const styleFor = (bg, slug = '') => {
  const r = resolve(bg, slug)
  if (r === null) return ''
  const v = []
  v.push(`--bc-bg-img:${r.img}`)
  v.push(`--bc-bg-tw:${String(r.w)}px`)
  v.push(`--bc-bg-th:${String(r.h)}px`)
  v.push(`--bc-bg-veilp:${String(r.veil)}%`)
  v.push(`--bc-bg-shadep:${String(r.shade)}%`)
  if (r.solid !== '') v.push(`--bc-bg-solid:${r.solid}`)
  return v.join(';')
}
export const attrsFor = (bg, slug = '') => {
  const r = resolve(bg, slug)
  if (r === null) return ''
  return `data-bg="${r.id}" data-bg-mode="${r.mode}" data-bg-tone="${r.tone}"`
}

/** Paint a background choice onto the live board without storing anything (a preview, or a repaint after a load). */
export const paint = (board, bg, slug = '') => {
  if (board === null || board === undefined) return
  for (const k of [
    '--bc-bg-img',
    '--bc-bg-tw',
    '--bc-bg-th',
    '--bc-bg-veilp',
    '--bc-bg-shadep',
    '--bc-bg-solid',
  ])
    board.style.removeProperty(k)
  for (const a of ['data-bg', 'data-bg-mode', 'data-bg-tone']) board.removeAttribute(a)
  const r = resolve(bg, slug)
  if (r === null) return
  for (const part of styleFor(bg, slug).split(';')) {
    const i = part.indexOf(':')
    board.style.setProperty(part.slice(0, i), part.slice(i + 1))
  }
  board.setAttribute('data-bg', r.id)
  board.setAttribute('data-bg-mode', r.mode)
  board.setAttribute('data-bg-tone', r.tone)
}

/* ---------------------------------------------------- the person's own picture --- */

const DB = 'bc.backdrops'
const STORE = 'images'
let opening = null
let conn = null
const open = () => {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  opening ??= new Promise((resolve) => {
    let request
    try {
      request = indexedDB.open(DB, 1)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'slug' })
    }
    request.onsuccess = () => {
      conn = request.result
      resolve(conn)
    }
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return opening
}
const tx = async (mode, run) => {
  const db = await open()
  if (db === null) throw new Error('This browser cannot keep a picture here.')
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const r = run(t.objectStore(STORE))
    t.oncomplete = () => resolve(r?.result ?? null)
    t.onerror = () => reject(t.error ?? new Error('The picture could not be saved.'))
    t.onabort = () => reject(t.error ?? new Error('The picture could not be saved.'))
  })
}

const forget = (slug) => {
  const old = mine.get(slug)
  if (old?.url) URL.revokeObjectURL(old.url)
  mine.delete(slug)
}

/** Keep a processed picture for a project. */
export const customPut = async (slug, rec) => {
  pullFailedAt.delete(slug)
  await tx('readwrite', (s) => s.put({ slug, ...rec, at: Date.now() }))
  forget(slug)
  mine.set(slug, {
    url: URL.createObjectURL(rec.blob),
    w: rec.w,
    h: rec.h,
    tone: rec.tone,
    name: rec.name,
    rev: rec.rev ?? null,
  })
}

/*
  THE OFFICE'S COPY (#445, migration 1041). The picture is also stored in the office, one per project, so a second device can
  draw it; this browser's database is then only a cache keyed by the office's revision. The adapter is given by the page and is
  optional: with none (an office that predates the migration, a Sample visitor, offline) a picture stays in this browser alone,
  exactly as before, and the person is told so.

    put(slug, blob)  -> { rev }                the office stored it
    get(slug)        -> { rev, url } | null    a signed link to the office's copy, or nothing
    del(slug)        -> anything               the office removed it
*/
let remoteAdapter = null
const REMOTE_WAIT_MS = 15_000
export const useRemote = (a) => {
  pullFailedAt.clear()
  pulling.clear()
  remoteAdapter = a !== null && typeof a === 'object' && typeof a.put === 'function' ? a : null
}

/**
 * Keep a picture here and, when the office can, there. Never throws because the office would not: the answer says what
 * happened ('saved' everywhere, or 'local' with the reason) so the picker can say it in words.
 */
export const customKeep = async (slug, rec) => {
  let rev = null
  let remote = 'local'
  let reason = ''
  /* This browser's copy first and at once: the picture is never lost or held up because the office is slow. */
  await customPut(slug, { ...rec, rev: null })
  if (remoteAdapter !== null) {
    try {
      const r = await Promise.race([
        remoteAdapter.put(slug, rec.blob),
        new Promise((_, no) => setTimeout(() => no(new Error('the office did not answer in time')), REMOTE_WAIT_MS)),
      ])
      if (r !== null && typeof r === 'object' && typeof r.rev === 'string' && r.rev !== '') {
        rev = r.rev
        remote = 'saved'
      } else reason = 'the office did not say it had stored it'
    } catch (e) {
      reason = e instanceof Error ? e.message : 'the office could not store it'
    }
  } else reason = 'this office does not keep pictures yet'
  if (rev !== null) await customPut(slug, { ...rec, rev })
  return { rev, remote, reason }
}

/*
  The board is wired again on every redraw, so a pull must not start again while one is running, and a pull that failed (offline,
  damaged picture) is not retried for a minute: otherwise each redraw would ask the office and download the picture again.
*/
const pulling = new Map()
const pullFailedAt = new Map()
const PULL_RETRY_MS = 60_000
const customPull = (slug) => {
  const running = pulling.get(slug)
  if (running !== undefined) return running
  const failed = pullFailedAt.get(slug)
  if (failed !== undefined && Date.now() - failed < PULL_RETRY_MS) return Promise.resolve(null)
  const p = pullOnce(slug)
    .then((info) => {
      if (info === null) pullFailedAt.set(slug, Date.now())
      else pullFailedAt.delete(slug)
      return info
    })
    .finally(() => pulling.delete(slug))
  pulling.set(slug, p)
  return p
}

/** Take the office's copy into this browser. Resolves the info the painter uses, or null (nothing there, offline, damaged). */
const pullOnce = async (slug) => {
  if (remoteAdapter === null || typeof remoteAdapter.get !== 'function') return null
  let meta
  try {
    meta = await remoteAdapter.get(slug)
  } catch {
    return null
  }
  if (meta === null || typeof meta !== 'object' || typeof meta.url !== 'string') return null
  let blob
  try {
    const r = await fetch(meta.url)
    if (!r.ok) return null
    blob = await r.blob()
  } catch {
    return null
  }
  if (!/^image\/(jpeg|png|webp|avif)$/.test(blob.type)) return null
  let seen
  try {
    seen = await describe(blob)
  } catch {
    return null
  }
  try {
    await customPut(slug, { blob, ...seen, name: '', rev: typeof meta.rev === 'string' ? meta.rev : null })
  } catch {
    return null
  }
  return mine.get(slug) ?? null
}

/** Remove a picture here and, when the office has one, there. Resolves false when the office could not remove its copy. */
export const customRemove = async (slug) => {
  await customDelete(slug)
  return remoteRemove(slug)
}

/** Ask the office to delete its copy (waits a bounded time). True when there is nothing to delete or it was deleted. */
export const remoteRemove = async (slug) => {
  if (remoteAdapter === null || typeof remoteAdapter.del !== 'function') return true
  try {
    await Promise.race([
      remoteAdapter.del(slug),
      new Promise((_, no) => setTimeout(() => no(new Error('slow')), REMOTE_WAIT_MS)),
    ])
    return true
  } catch {
    return false
  }
}

const toneOf = (r, g, b) => {
  const lin = (c) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.18 ? 'dark' : 'light'
}

/** The size and tone of a picture the office returned (it is already modest, so it is not shrunk again). */
const describe = async (blob) => {
  const bitmap = await createImageBitmap(blob)
  try {
    const one = document.createElement('canvas')
    one.width = 1
    one.height = 1
    const ctx = one.getContext('2d')
    if (ctx === null) throw new Error('no canvas')
    ctx.drawImage(bitmap, 0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return { w: bitmap.width, h: bitmap.height, tone: toneOf(r, g, b) }
  } finally {
    bitmap.close?.()
  }
}

/** Load a project's picture into memory (and make its address available to the painter). Resolves null when there is none. */
export const customLoad = async (slug) => {
  if (mine.has(slug)) return mine.get(slug)
  let rec = null
  try {
    rec = await tx('readonly', (s) => s.get(slug))
  } catch {
    return null
  }
  if (rec === null || !(rec.blob instanceof Blob)) return null
  const info = {
    url: URL.createObjectURL(rec.blob),
    w: rec.w,
    h: rec.h,
    tone: rec.tone,
    name: rec.name,
    rev: rec.rev ?? null,
  }
  mine.set(slug, info)
  return info
}

export const customDelete = async (slug) => {
  try {
    await tx('readwrite', (s) => s.delete(slug))
  } finally {
    forget(slug)
  }
}

/** Close the connection and drop every address, so that signing out can delete the database. */
export const release = async () => {
  for (const slug of [...mine.keys()]) forget(slug)
  if (conn !== null) conn.close()
  conn = null
  opening = null
}

/**
 * Called once the board is in the page. Draws the project's choice, and for a picture of the person's own, loads it first.
 * Returns a sentence when the reference names a picture this browser does not hold (set on another device), else ''.
 */
export const hydrate = async (board, slug) => {
  const bg = grid.bgOf(slug)
  if (bg === null || bg.id !== 'custom') return ''
  let info = await customLoad(slug)
  /*
    The office's copy is fetched when this browser has none, or holds a different revision than the one the project names
    (a picture changed on another device). A browser that already holds the named revision asks the office for nothing.
  */
  const named = typeof bg.rev === 'string' && bg.rev !== ''
  if (remoteAdapter !== null && (info === null || (named && info.rev !== bg.rev))) {
    const got = await customPull(slug)
    if (got !== null) info = got
  }
  if (info === null) {
    paint(board, null)
    return 'This background is a picture the office does not hold a copy of, and this browser has none, so the default is shown.'
  }
  /* The board may have been replaced while the picture loaded. */
  const live = document.querySelector(`[data-bc-board="${slug}"]`)
  paint(live ?? board, grid.bgOf(slug), slug)
  return ''
}

/* ---------------------------------------------------------- checking a file --- */

export const LIMITS = {
  bytes: 15 * 1024 * 1024,
  pixels: 40_000_000,
  edge: 12_000,
  outEdge: 2560,
  outBytes: 3 * 1024 * 1024,
}

const u16 = (b, i) => (b[i] << 8) | b[i + 1]
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const le24 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
const ascii = (b, i, n) => String.fromCharCode(...b.slice(i, i + n))

/**
 * Read the type and pixel size of an image from its own header, WITHOUT decoding it, so a file that claims to be enormous is
 * refused before the browser allocates anything for it. Returns { type, w, h } or throws a sentence for a person.
 * The file extension and the declared MIME type are not trusted: only the bytes are.
 */
export const sniff = (bytes) => {
  const b = bytes
  const text = ascii(b, 0, Math.min(b.length, 256)).toLowerCase()
  if (text.includes('<svg') || text.startsWith('<?xml') || text.includes('<!doctype svg'))
    throw new Error('SVG pictures are not accepted. Use a JPEG, PNG, WebP or AVIF image.')
  if (b.length < 24) throw new Error('That file is too small to be a picture.')
  // PNG
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') {
    if (ascii(b, 12, 4) !== 'IHDR') throw new Error('That PNG is damaged.')
    return { type: 'image/png', w: u32(b, 16), h: u32(b, 20) }
  }
  // JPEG: walk the segments to the first start-of-frame
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i += 1
        continue
      }
      const m = b[i + 1]
      if (m === 0xff) {
        i += 1
        continue
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { type: 'image/jpeg', h: u16(b, i + 5), w: u16(b, i + 7) }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2
        continue
      }
      i += 2 + u16(b, i + 2)
    }
    throw new Error('That JPEG is damaged.')
  }
  // WebP
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const kind = ascii(b, 12, 4)
    if (kind === 'VP8X') return { type: 'image/webp', w: le24(b, 24) + 1, h: le24(b, 27) + 1 }
    if (kind === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
      return { type: 'image/webp', w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (kind === 'VP8 ') return { type: 'image/webp', w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff }
    throw new Error('That WebP is damaged.')
  }
  // AVIF: an ftyp box naming avif, then an ispe property carrying the size
  if (ascii(b, 4, 4) === 'ftyp' && /avi[fs]/.test(ascii(b, 8, 12))) {
    for (let i = 12; i + 20 < Math.min(b.length, 4096); i += 1) {
      if (ascii(b, i, 4) === 'ispe') return { type: 'image/avif', w: u32(b, i + 8), h: u32(b, i + 12) }
    }
    throw new Error('That AVIF could not be read.')
  }
  throw new Error('That is not a JPEG, PNG, WebP or AVIF picture.')
}

/** Refuse before decoding when the header says the picture is too big. */
export const vet = (file, head) => {
  if (file.size > LIMITS.bytes)
    throw new Error(`That file is over ${String(LIMITS.bytes / 1024 / 1024)} MB. Pick a smaller picture.`)
  if (file.size === 0) throw new Error('That file is empty.')
  const s = sniff(head)
  if (!(s.w > 0 && s.h > 0)) throw new Error('That picture reports no size.')
  if (s.w > LIMITS.edge || s.h > LIMITS.edge || s.w * s.h > LIMITS.pixels)
    throw new Error(
      `That picture is ${String(s.w)} x ${String(s.h)} pixels, which is too large to open safely. Pick one under ${String(LIMITS.pixels / 1_000_000)} megapixels.`,
    )
  return s
}

/**
 * Decode, shrink to at most 2560px on the long edge and re-encode, so what is kept is a modest WebP (or JPEG where the browser
 * has no WebP encoder) whatever was dropped in. Returns { blob, w, h, tone, name }.
 */
export const optimise = async (file) => {
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer())
  const s = vet(file, head)
  const scale = Math.min(1, LIMITS.outEdge / Math.max(s.w, s.h))
  const w = Math.max(1, Math.round(s.w * scale))
  const h = Math.max(1, Math.round(s.h * scale))
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
  } catch {
    throw new Error('This browser could not open that picture. It may be damaged or in a format it does not support.')
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('This browser cannot resize pictures.')
    ctx.drawImage(bitmap, 0, 0, w, h)
    // Average colour from a 1x1 reduction: decides whether the grid dots should be light or dark on it.
    const one = document.createElement('canvas')
    one.width = 1
    one.height = 1
    const octx = one.getContext('2d')
    octx.drawImage(canvas, 0, 0, 1, 1)
    const [r, g, bl] = octx.getImageData(0, 0, 1, 1).data
    const tone = toneOf(r, g, bl)
    const encode = (type, q) => new Promise((res) => canvas.toBlob(res, type, q))
    let blob = await encode('image/webp', 0.84)
    if (blob === null || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.86)
    for (let q = 0.7; blob !== null && blob.size > LIMITS.outBytes && q > 0.3; q -= 0.15)
      blob = await encode(blob.type, q)
    if (blob === null || blob.size > LIMITS.outBytes)
      throw new Error('That picture is still too large after shrinking it. Pick a simpler one.')
    return { blob, w, h, tone, name: String(file.name ?? 'picture').slice(0, 80) }
  } finally {
    bitmap.close?.()
  }
}
