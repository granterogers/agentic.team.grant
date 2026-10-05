/*
  THE PROJECT HOME'S WORKSPACE: a freeform stage, not a grid.

  Grant, 4 October 2026: modules should move and resize CONTINUOUSLY - no
  mandatory increments - with gentle alignment guides, free placement and
  overlap permitted ("no forced reflow merely because modules overlap"). Add a
  subtle Auto Arrange that lightly tidies, a Reset View that touches
  presentation only, project-specific layouts, named layouts and presets,
  per-module tints, and a zoom that scales the actual workspace. Still bound to
  the viewport: this is NOT an infinite canvas.

  This replaces the 12-column, 44px-row model whose unit of storage was a grid
  cell and whose only collision tool was downward compaction. That model was
  Grant's 22 September request ("collision prevention"); this is his
  4 October one, and the two cannot both hold, so the old arithmetic
  (`compact`, `squeeze`, `COLS`, `ROW`) is gone rather than kept beside it.

  ## The model

  A project's workspace is ONE document:

    { mods:    null | [{ id, x, y, w, h, z, tint }]   - logical pixels
      zoom:    0.5 .. 1.5
      layouts: { [name]: { mods, zoom } }              - named layouts
      postits: [{ id, x, y, w, h, z, text }]
      seeded:  true once the starter Post-it has been used or removed }

  `mods === null` means "never arranged": the layout is COMPUTED from the
  current stage on every read, so a default adapts to a window of any size. The
  first drag materialises it into pixels. Pixels are LOGICAL - the stage is
  `viewport / zoom` wide, so zooming out gives more room and the stored numbers
  keep their meaning.

  ## Overlap

  Permitted and unresolved. Nothing here moves a module because another one is
  in the way. `z` decides who is on top, and pressing a module raises it.

  ## Persistence

  The office's existing `dashboard_layout_set(surface 'basecamp')` takes any
  non-empty jsonb array, so the document is stored as the module entries plus
  one reserved `{ id: '__workspace', v: 2, ... }` entry carrying everything
  else. No migration. The browser is the synchronous cache in front of it and
  ADR-0021's three rules still hold: the office is read first, an empty
  document is a reset, and this session's own change outranks both until the
  next load. Last write wins on the whole document - recorded in the ledger as
  a trade-off, not an oversight.

  Reset View clears `mods` and `zoom`. It never touches `postits` or `layouts`,
  which is requirement HQ-LAYOUT-011 and is why the office is not told to DELETE
  the row (that would take the notes with it): it is told to store the
  document without the arrangement.
*/

/** Every module the home can hold. */
export const ALL = ['tasks', 'board', 'documents', 'schedule', 'contacts', 'activity']

export const MIN = { w: 240, h: 150 }
export const POSTIT_MIN = { w: 130, h: 120 }
export const POSTIT_DEFAULT = { w: 210, h: 190 }
export const ZOOM = { min: 0.5, max: 1.5, step: 0.1 }
export const GAP = 12

/** The curated tints. `null` is "none". The values are hues, mixed in by CSS. */
export const TINTS = [
  { id: 'slate', name: 'Slate', hue: '#8aa0b8' },
  { id: 'sky', name: 'Sky', hue: '#5aa9e6' },
  { id: 'teal', name: 'Teal', hue: '#3fb8a8' },
  { id: 'mint', name: 'Mint', hue: '#6cc08b' },
  { id: 'moss', name: 'Moss', hue: '#9bb35a' },
  { id: 'sand', name: 'Sand', hue: '#d2b36a' },
  { id: 'amber', name: 'Amber', hue: '#e8a04a' },
  { id: 'coral', name: 'Coral', hue: '#e57a6a' },
  { id: 'rose', name: 'Rose', hue: '#d9739b' },
  { id: 'violet', name: 'Violet', hue: '#9a82e0' },
  { id: 'indigo', name: 'Indigo', hue: '#6f7fe0' },
]

/** A custom tint must be a six-digit hex colour. Nothing else is stored. */
export const validTint = (t) =>
  t === null ||
  t === undefined ||
  (typeof t === 'string' && (TINTS.some((x) => x.id === t) || /^#[0-9a-fA-F]{6}$/.test(t)))

/** The CSS colour for a stored tint. */
export const tintHue = (t) => {
  if (typeof t !== 'string') return ''
  const known = TINTS.find((x) => x.id === t)
  if (known !== undefined) return known.hue
  return /^#[0-9a-fA-F]{6}$/.test(t) ? t : ''
}

/*
  Fractions of the stage, [x, y, w, h]. The default and the presets are written
  as fractions so that they fit any window; they become pixels only when read.
*/
/*
  The default leaves the right-hand fifth of the stage free: that is where the
  first Post-it sits, so a note is there to be typed in without covering a
  module. Anybody who does not want a note can remove it and drag the modules
  wherever they like; the presets below use the whole width.
*/
const COLW = 0.8 / 3
const THIRDS = {
  tasks: [0, 0, COLW, 0.5],
  board: [COLW, 0, COLW, 0.5],
  documents: [2 * COLW, 0, COLW, 0.5],
  schedule: [0, 0.5, COLW, 0.5],
  contacts: [COLW, 0.5, COLW, 0.5],
  activity: [2 * COLW, 0.5, COLW, 0.5],
}

export const PRESETS = {
  overview: { name: 'Overview', frac: THIRDS },
  planning: {
    name: 'Planning',
    frac: {
      tasks: [0, 0, 0.36, 1],
      schedule: [0.36, 0, 0.38, 0.6],
      board: [0.74, 0, 0.26, 0.6],
      activity: [0.36, 0.6, 0.38, 0.4],
      contacts: [0.74, 0.6, 0.26, 0.4],
    },
  },
  research: {
    name: 'Research',
    frac: {
      documents: [0, 0, 0.56, 1],
      activity: [0.56, 0, 0.44, 0.5],
      tasks: [0.56, 0.5, 0.44, 0.5],
    },
  },
  documents: {
    name: 'Documents',
    frac: {
      documents: [0, 0, 0.7, 1],
      tasks: [0.7, 0, 0.3, 0.5],
      activity: [0.7, 0.5, 0.3, 0.5],
    },
  },
}

export const isPostit = (id) => typeof id === 'string' && id.startsWith('n_')
const minOf = (id) => (isPostit(id) ? POSTIT_MIN : MIN)

/**
 * One rectangle, brought inside the stage and above its minimum.
 *
 * Never refuses: a stored rectangle is untrusted (an older window size, a
 * hand-edited store), and clamping keeps every module and moves the one that is
 * wrong. A module can never be dragged wholly off the stage, which is what
 * keeps this a viewport-bound workspace rather than a canvas.
 */
export const clampRect = (m, st) => {
  const min = minOf(m.id)
  const w = Math.max(min.w, Math.min(Math.max(min.w, st.w), Math.round(m.w ?? min.w)))
  const h = Math.max(min.h, Math.min(Math.max(min.h, st.h), Math.round(m.h ?? min.h)))
  const x = Math.max(0, Math.min(Math.max(0, st.w - w), Math.round(m.x ?? 0)))
  const y = Math.max(0, Math.min(Math.max(0, st.h - h), Math.round(m.y ?? 0)))
  return { ...m, x, y, w, h }
}

/** A fractional layout as pixels for this stage, with a gap between neighbours. */
export const fromFractions = (frac, st) =>
  Object.entries(frac).map(([id, [fx, fy, fw, fh]], i) =>
    clampRect(
      {
        id,
        x: Math.round(fx * st.w + GAP / 2),
        y: Math.round(fy * st.h + GAP / 2),
        w: Math.round(fw * st.w - GAP),
        h: Math.round(fh * st.h - GAP),
        z: i + 1,
        tint: null,
      },
      st,
    ),
  )

/* ------------------------------------------------------ alignment guides --- */

/**
 * Snap a moving or resizing rectangle to its neighbours, gently.
 *
 * `kind` is 'move' (left, centre and right edges can snap) or 'size' (only the
 * right and bottom edges move, so only they snap). A snap happens only within
 * `threshold` logical pixels, which is what makes it a guide rather than a
 * grid: away from every candidate the rectangle goes exactly where the pointer
 * put it. Returns the adjusted rectangle and the guide lines to draw.
 */
export const align = (rect, others, st, kind = 'move', threshold = 6) => {
  const xs = [0, st.w / 2, st.w]
  const ys = [0, st.h / 2, st.h]
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w)
    ys.push(o.y, o.y + o.h / 2, o.y + o.h)
  }
  const best = (probes, list) => {
    let hit = null
    for (const p of probes) {
      for (const c of list) {
        const d = Math.abs(c - p.at)
        if (d <= threshold && (hit === null || d < hit.d)) hit = { d, at: c, off: p.off }
      }
    }
    return hit
  }
  const out = { ...rect }
  const guides = []
  if (kind === 'move') {
    const hx = best(
      [
        { off: 0, at: rect.x },
        { off: rect.w / 2, at: rect.x + rect.w / 2 },
        { off: rect.w, at: rect.x + rect.w },
      ],
      xs,
    )
    if (hx !== null) {
      out.x = Math.round(hx.at - hx.off)
      guides.push({ axis: 'x', at: hx.at })
    }
    const hy = best(
      [
        { off: 0, at: rect.y },
        { off: rect.h / 2, at: rect.y + rect.h / 2 },
        { off: rect.h, at: rect.y + rect.h },
      ],
      ys,
    )
    if (hy !== null) {
      out.y = Math.round(hy.at - hy.off)
      guides.push({ axis: 'y', at: hy.at })
    }
  } else {
    const hx = best([{ off: rect.w, at: rect.x + rect.w }], xs)
    if (hx !== null) {
      out.w = Math.round(hx.at - rect.x)
      guides.push({ axis: 'x', at: hx.at })
    }
    const hy = best([{ off: rect.h, at: rect.y + rect.h }], ys)
    if (hy !== null) {
      out.h = Math.round(hy.at - rect.y)
      guides.push({ axis: 'y', at: hy.at })
    }
  }
  return { rect: out, guides }
}

/* ------------------------------------------------------------- tidy up --- */

/**
 * Lightly tidy a layout. It does not redesign it.
 *
 * What it does, in order: group modules that already sit on roughly one row;
 * line each row's tops up; close horizontal overlaps by moving a module to the
 * right of its neighbour (never reordering them); make a row's heights equal;
 * then stop rows overlapping vertically. Everything keeps its rough position
 * and its width - a person who arranged six modules should recognise them
 * afterwards. If a row is too wide it narrows its modules proportionally and if
 * the rows are too tall they share the stage's height.
 */
export const tidy = (mods, st) => {
  const list = mods
    .filter((m) => !isPostit(m.id))
    .map((m) => ({ ...m }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const rows = []
  for (const m of list) {
    const row = rows.find((r) => {
      const over = Math.min(r.anchor.y + r.anchor.h, m.y + m.h) - Math.max(r.anchor.y, m.y)
      return over > 0.4 * Math.min(r.anchor.h, m.h)
    })
    if (row === undefined) rows.push({ anchor: m, items: [m] })
    else row.items.push(m)
  }
  rows.sort((a, b) => a.anchor.y - b.anchor.y)
  const placed = []
  let bottom = -GAP
  for (const row of rows) {
    const items = row.items.sort((a, b) => a.x - b.x)
    const top = Math.max(Math.min(...items.map((m) => m.y)), bottom + GAP)
    const height = Math.max(...items.map((m) => m.h))
    const gaps = GAP * (items.length - 1)
    const total = items.reduce((n, m) => n + m.w, 0) + gaps
    const scale = total > st.w ? (st.w - gaps) / (total - gaps) : 1
    /*
      Left to right, each module keeps its own x unless it would overlap the one
      before. Then right to left, so a row that ran off the right edge is pulled
      back without anything landing on its neighbour: clamping afterwards would
      move the last module on top of the one beside it.
    */
    let cursor = 0
    const row2 = items.map((m) => {
      const w = Math.max(MIN.w, Math.round(m.w * scale))
      const x = Math.max(cursor, m.x)
      cursor = x + w + GAP
      return { ...m, x, w }
    })
    let limit = st.w
    for (let i = row2.length - 1; i >= 0; i -= 1) {
      const m = row2[i]
      m.x = Math.max(0, Math.min(m.x, limit - m.w))
      limit = m.x - GAP
    }
    for (const m of row2) {
      placed.push({ ...m, x: Math.round(m.x), y: Math.round(top), h: height })
    }
    bottom = top + height
  }
  /* Too tall for the stage: share the height rather than run off it. */
  if (bottom > st.h && rows.length > 0) {
    const f = Math.max(0.4, st.h / bottom)
    for (const m of placed) {
      m.y = Math.round(m.y * f)
      m.h = Math.max(MIN.h, Math.round(m.h * f))
    }
  }
  return placed.map((m) => clampRect(m, st))
}

/* ----------------------------------------------------------- the document --- */

const KEY = (slug) => `bc.stage.${slug}`
const slugOf = (s) => (typeof s === 'string' ? s : (s?.slug ?? ''))

const emptyDoc = () => ({ mods: null, zoom: 1, layouts: {}, postits: [], seeded: false })
const clampZoom = (z) => Math.min(ZOOM.max, Math.max(ZOOM.min, z))

let stage = { w: 1200, h: 620 }
let measured = false
/** The logical stage size, set by the page once it has measured the board. */
export const setStage = (w, h, real = false) => {
  stage = { w: Math.max(MIN.w, Math.round(w)), h: Math.max(MIN.h, Math.round(h)) }
  if (real) measured = true
}
export const stageSize = () => ({ ...stage })
/** Has the page measured the stage, or is the size still an estimate? */
export const stageMeasured = () => measured

const cleanMod = (m) => ({
  id: m.id,
  x: m.x,
  y: m.y,
  w: m.w,
  h: m.h,
  z: Number.isFinite(m.z) ? m.z : 1,
  tint: validTint(m.tint) ? (m.tint ?? null) : null,
})

const cleanPostit = (n) => ({
  id: String(n.id),
  x: Number(n.x) || 0,
  y: Number(n.y) || 0,
  w: Number(n.w) || POSTIT_DEFAULT.w,
  h: Number(n.h) || POSTIT_DEFAULT.h,
  z: Number.isFinite(n.z) ? n.z : 1,
  text: typeof n.text === 'string' ? n.text.slice(0, 5000) : '',
})

/** An untrusted stored document, repaired. */
export const normalise = (raw) => {
  const d = emptyDoc()
  if (raw === null || typeof raw !== 'object') return d
  if (Array.isArray(raw.mods)) {
    d.mods = raw.mods
      .filter((m) => m !== null && typeof m === 'object' && ALL.includes(m.id))
      .map(cleanMod)
  }
  if (Number.isFinite(raw.zoom)) d.zoom = clampZoom(raw.zoom)
  if (raw.layouts !== null && typeof raw.layouts === 'object') {
    for (const [name, l] of Object.entries(raw.layouts)) {
      if (l === null || typeof l !== 'object' || !Array.isArray(l.mods)) continue
      d.layouts[String(name).slice(0, 40)] = {
        mods: l.mods.filter((m) => m && ALL.includes(m.id)).map(cleanMod),
        zoom: Number.isFinite(l.zoom) ? clampZoom(l.zoom) : 1,
      }
    }
  }
  if (Array.isArray(raw.postits)) {
    d.postits = raw.postits
      .filter((n) => n && typeof n.id === 'string' && isPostit(n.id))
      .map(cleanPostit)
  }
  d.seeded = raw.seeded === true
  return d
}

/** The document as the array the office stores. */
export const toPanels = (d) => [
  ...(d.mods ?? []).map(cleanMod),
  {
    id: '__workspace',
    v: 2,
    hasMods: d.mods !== null,
    zoom: d.zoom,
    layouts: d.layouts,
    postits: d.postits,
    seeded: d.seeded,
  },
]

/** The document from the office's array, or null when it is not a v2 workspace. */
export const fromPanels = (panels) => {
  if (!Array.isArray(panels)) return null
  const meta = panels.find((m) => m !== null && typeof m === 'object' && m.id === '__workspace')
  if (meta === undefined) return null
  return normalise({
    mods: meta.hasMods === true ? panels.filter((m) => m && m.id !== '__workspace') : null,
    zoom: meta.zoom,
    layouts: meta.layouts,
    postits: meta.postits,
    seeded: meta.seeded,
  })
}

/** Is there anything worth keeping? An empty document is a reset, never stored. */
const isBlank = (d) =>
  d.mods === null &&
  d.zoom === 1 &&
  d.postits.length === 0 &&
  Object.keys(d.layouts).length === 0 &&
  d.seeded === false

const cache = new Map()
const mine = new Set()

/** The stored document for a project. */
export const doc = (slug) => {
  const s = slugOf(slug)
  if (cache.has(s)) return cache.get(s)
  let d = emptyDoc()
  try {
    const raw = globalThis.localStorage?.getItem(KEY(s)) ?? ''
    if (raw !== '') d = normalise(JSON.parse(raw))
  } catch {
    d = emptyDoc()
  }
  cache.set(s, d)
  return d
}

let keep = null
let forget = null
let timer = null
const pending = new Map()

/** Tell this module how to put the document in the office. */
export const persistence = ({ save: saveAway, reset: resetAway } = {}) => {
  keep = typeof saveAway === 'function' ? saveAway : null
  forget = typeof resetAway === 'function' ? resetAway : null
}

const sendNow = () => {
  timer = null
  for (const [s, d] of pending) {
    if (isBlank(d)) {
      if (forget !== null) void forget(s)
    } else if (keep !== null) {
      void keep(s, toPanels(d))
    }
  }
  pending.clear()
}

/** Write the document to the browser now and to the office shortly after. */
const commit = (slug, d) => {
  const s = slugOf(slug)
  cache.set(s, d)
  mine.add(s)
  try {
    if (isBlank(d)) globalThis.localStorage?.removeItem(KEY(s))
    else globalThis.localStorage?.setItem(KEY(s), JSON.stringify(d))
  } catch {
    /* A viewer who cannot store it still has it for this session. */
  }
  pending.set(s, d)
  if (timer !== null) globalThis.clearTimeout(timer)
  /* Debounced, because a Post-it saves on every keystroke. */
  timer = globalThis.setTimeout(sendNow, 700)
  return d
}

/** Send anything waiting, immediately (page hide, tests). */
export const flush = () => {
  if (timer !== null) globalThis.clearTimeout(timer)
  sendNow()
}

/** Take the office's copy, unless this session has already changed it. */
export const adopt = (slug, panels) => {
  const s = slugOf(slug)
  if (s === '' || mine.has(s)) return false
  const d = fromPanels(panels)
  if (d === null) return false
  cache.set(s, d)
  try {
    globalThis.localStorage?.setItem(KEY(s), JSON.stringify(d))
  } catch {
    /* Cached in memory regardless. */
  }
  return true
}

/** Forget every in-memory document (tests). */
export const forgetAll = () => {
  cache.clear()
  mine.clear()
  pending.clear()
}

/* ------------------------------------------------------------- the modules --- */

/** The modules on the page, in pixels for the current stage, clamped. */
export const layout = (slug) => {
  const d = doc(slug)
  const base = d.mods === null ? fromFractions(THIRDS, stage) : d.mods
  return base.map((m) => clampRect(m, stage))
}

const materialised = (slug) => {
  const d = doc(slug)
  return {
    ...d,
    mods: d.mods === null ? fromFractions(THIRDS, stage) : d.mods.map((m) => ({ ...m })),
  }
}

const topZ = (d) =>
  Math.max(0, ...(d.mods ?? []).map((m) => m.z ?? 0), ...d.postits.map((n) => n.z ?? 0))

/** Move or resize one module. Neighbours are left alone: overlap is permitted. */
export const place = (slug, id, rect) => {
  const d = materialised(slug)
  const z = topZ(d) + 1
  d.mods = d.mods.map((m) => (m.id === id ? clampRect({ ...m, ...rect, id, z }, stage) : m))
  commit(slug, d)
  return layout(slug)
}

/** Bring a module to the front without moving it. */
export const raise = (slug, id) => {
  const d = materialised(slug)
  const z = topZ(d) + 1
  d.mods = d.mods.map((m) => (m.id === id ? { ...m, z } : m))
  commit(slug, d)
}

export const setTint = (slug, id, tint) => {
  if (!validTint(tint)) return false
  const d = materialised(slug)
  d.mods = d.mods.map((m) => (m.id === id ? { ...m, tint: tint ?? null } : m))
  commit(slug, d)
  return true
}

/** Take a module off the page. Nothing in it is deleted. */
export const remove = (slug, id) => {
  const d = materialised(slug)
  d.mods = d.mods.filter((m) => m.id !== id)
  commit(slug, d)
}

/** Put a module back where its default would be, on top. */
export const add = (slug, id) => {
  if (!ALL.includes(id)) return
  const d = materialised(slug)
  if (d.mods.some((m) => m.id === id)) return
  const [r] = fromFractions({ [id]: THIRDS[id] }, stage)
  d.mods = [...d.mods, { ...r, z: topZ(d) + 1 }]
  commit(slug, d)
}

/** Which modules are not on the page. */
export const off = (slug) => {
  const on = new Set(layout(slug).map((m) => m.id))
  return ALL.filter((id) => !on.has(id))
}

/** Lightly tidy this page. */
export const autoArrange = (slug) => {
  const d = materialised(slug)
  d.mods = tidy(d.mods, stage)
  commit(slug, d)
  return layout(slug)
}

/**
 * Reset the VIEW: arrangement, tints, z-order and zoom.
 *
 * Post-its and saved layouts are not part of the view and are never touched
 * here. If nothing else is left the document is blank and the office is told
 * to drop the row; otherwise it is told to store the document without an
 * arrangement.
 */
export const reset = (slug) => {
  commit(slug, { ...doc(slug), mods: null, zoom: 1 })
}

/**
 * Has this page been arranged, tinted or zoomed, or is it as it was given?
 * Compared as geometry by id, so a board dragged back into its original shape
 * stops offering to restore a shape it is already in.
 */
export const customised = (slug) => {
  const d = doc(slug)
  if (d.zoom !== 1) return true
  if (d.mods === null) return false
  const was = fromFractions(THIRDS, stage)
  if (d.mods.length !== was.length) return true
  return d.mods.some((m) => {
    const w = was.find((x) => x.id === m.id)
    return (
      w === undefined ||
      m.tint !== null ||
      Math.abs(w.x - m.x) > 1 ||
      Math.abs(w.y - m.y) > 1 ||
      Math.abs(w.w - m.w) > 1 ||
      Math.abs(w.h - m.h) > 1
    )
  })
}

/* ------------------------------------------------------------------- zoom --- */

export const zoomOf = (slug) => doc(slug).zoom

export const setZoom = (slug, z) => {
  const zoom = Math.round(clampZoom(z) * 100) / 100
  commit(slug, { ...doc(slug), zoom })
  return zoom
}

/* ------------------------------------------------------- named layouts --- */

const cleanName = (n) =>
  String(n ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 40)

export const layoutNames = (slug) => Object.keys(doc(slug).layouts)

export const saveLayout = (slug, name) => {
  const n = cleanName(name)
  if (n === '') return ''
  const d = doc(slug)
  const snap = layout(slug).map(cleanMod)
  commit(slug, { ...d, layouts: { ...d.layouts, [n]: { mods: snap, zoom: d.zoom } } })
  return n
}

export const loadLayout = (slug, name) => {
  const d = doc(slug)
  const l = d.layouts[name]
  if (l === undefined) return false
  commit(slug, { ...d, mods: l.mods.map((m) => ({ ...m })), zoom: l.zoom })
  return true
}

export const renameLayout = (slug, from, to) => {
  const n = cleanName(to)
  const d = doc(slug)
  if (n === '' || d.layouts[from] === undefined) return false
  if (n !== from && d.layouts[n] !== undefined) return false
  const layouts = {}
  for (const [k, v] of Object.entries(d.layouts)) layouts[k === from ? n : k] = v
  commit(slug, { ...d, layouts })
  return true
}

export const deleteLayout = (slug, name) => {
  const d = doc(slug)
  if (d.layouts[name] === undefined) return false
  const layouts = { ...d.layouts }
  delete layouts[name]
  commit(slug, { ...d, layouts })
  return true
}

/** One of the built-in presets, as the arrangement. */
export const applyPreset = (slug, key) => {
  const p = PRESETS[key]
  if (p === undefined) return false
  commit(slug, { ...doc(slug), mods: fromFractions(p.frac, stage) })
  return true
}

/* -------------------------------------------------------------- Post-its --- */

const newId = () => `n_${Math.random().toString(36).slice(2, 9)}`

/**
 * The notes on this project's page.
 *
 * The first time a project is opened there is one blank note to type into. It
 * is not stored until somebody types in it, and removing it (or the last one)
 * sets `seeded` so it does not come back. Deliberately dumb notes: text and a
 * rectangle, nothing else.
 */
export const postits = (slug) => {
  const d = doc(slug)
  if (d.postits.length === 0 && !d.seeded) {
    /* Sized to the free fifth of the stage, so it never covers a module on a narrow window. */
    const sw = Math.min(POSTIT_DEFAULT.w, Math.max(150, Math.round(stage.w * 0.2) - 14))
    const starter = clampRect(
      {
        id: 'n_starter',
        x: stage.w - sw - 8,
        y: 6,
        ...POSTIT_DEFAULT,
        w: sw,
        z: 7,
        text: '',
      },
      stage,
    )
    return [{ ...starter, starter: true }]
  }
  return d.postits.map((n) => clampRect(n, stage))
}

export const addPostit = (slug) => {
  const d = doc(slug)
  const z = topZ(d) + 1
  const offset = (d.postits.length % 6) * 22
  const n = clampRect(
    {
      id: newId(),
      x: stage.w - POSTIT_DEFAULT.w - 24 - offset,
      y: 24 + offset,
      ...POSTIT_DEFAULT,
      z,
      text: '',
    },
    stage,
  )
  commit(slug, { ...d, postits: [...d.postits, n], seeded: true })
  return n
}

/** Change a note. Returns its id, which differs only when the starter became real. */
export const setPostit = (slug, id, patch) => {
  const d = doc(slug)
  if (id === 'n_starter' && !d.postits.some((n) => n.id === id)) {
    const real = cleanPostit({ ...postits(slug)[0], ...patch, id: newId() })
    commit(slug, { ...d, postits: [real], seeded: true })
    return real.id
  }
  commit(slug, {
    ...d,
    postits: d.postits.map((n) => (n.id === id ? cleanPostit({ ...n, ...patch }) : n)),
  })
  return id
}

export const movePostit = (slug, id, rect) => {
  const d = doc(slug)
  const z = topZ(d) + 1
  if (id === 'n_starter' && !d.postits.some((n) => n.id === id)) {
    const real = cleanPostit({ ...postits(slug)[0], ...rect, id: newId(), z })
    commit(slug, { ...d, postits: [real], seeded: true })
    return real.id
  }
  commit(slug, {
    ...d,
    postits: d.postits.map((n) => (n.id === id ? clampRect({ ...n, ...rect, id, z }, stage) : n)),
  })
  return id
}

/** Remove a note. This is the only thing in this module that deletes content, and it is explicit. */
export const removePostit = (slug, id) => {
  const d = doc(slug)
  commit(slug, { ...d, postits: d.postits.filter((n) => n.id !== id), seeded: true })
}
