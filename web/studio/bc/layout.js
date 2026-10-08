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
const clampZoom = (z) => Math.min(ZOOM.max, Math.max(ZOOM.min, z))
const cleanPan = (p) => ({
  x: Number.isFinite(p?.x) ? Math.max(-REACH, Math.min(REACH, p.x)) : 0,
  y: Number.isFinite(p?.y) ? Math.max(-REACH, Math.min(REACH, p.y)) : 0,
})
export const ALL = ['tasks', 'board', 'documents', 'schedule', 'contacts', 'activity']

export const MIN = { w: 240, h: 150 }
export const POSTIT_MIN = { w: 130, h: 120 }
export const POSTIT_DEFAULT = { w: 210, h: 190 }
export const ZOOM = { min: 0.2, max: 2.5, step: 0.1 }
/** Furthest a module may sit from the origin, in logical pixels: far past anything reachable, so nothing is ever "at the edge". */
export const REACH = 100000
export const MAX_SIZE = 6000
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
/*
  Proportions follow what each module holds (8 October 2026, brief section 12). The top row is the work itself: to-dos and the
  card table need height and the documents need room for thumbnails, so it takes the larger share of the height. The
  bottom row is glanceable (schedule, contacts, activity). Columns line up so the board reads as one arrangement.
*/
const C1 = 0.25
const C2 = 0.29
const C3 = 0.26
const R1 = 0.58
const THIRDS = {
  tasks: [0, 0, C1, R1],
  board: [C1, 0, C2, R1],
  documents: [C1 + C2, 0, C3, R1],
  schedule: [0, R1, C1, 1 - R1],
  contacts: [C1, R1, C2, 1 - R1],
  activity: [C1 + C2, R1, C3, 1 - R1],
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
  const num = (v, d) => (Number.isFinite(v) ? Math.round(v) : d)
  if (st !== undefined) {
    /* Given a stage, keep the rectangle inside it: how defaults, presets and tidying are laid out. */
    const w = Math.max(min.w, Math.min(Math.max(min.w, st.w), num(m.w, min.w)))
    const h = Math.max(min.h, Math.min(Math.max(min.h, st.h), num(m.h, min.h)))
    return {
      ...m,
      x: Math.max(0, Math.min(Math.max(0, st.w - w), num(m.x, 0))),
      y: Math.max(0, Math.min(Math.max(0, st.h - h), num(m.y, 0))),
      w,
      h,
    }
  }
  /* With none, the canvas is infinite: only sizes and absurd distances are bounded. */
  const w = Math.max(min.w, Math.min(MAX_SIZE, num(m.w, min.w)))
  const h = Math.max(min.h, Math.min(MAX_SIZE, num(m.h, min.h)))
  const x = Math.max(-REACH, Math.min(REACH, num(m.x, 0)))
  const y = Math.max(-REACH, Math.min(REACH, num(m.y, 0)))
  return { ...m, x, y, w, h }
}

/* ---------------------------------------------------------- the view ---
  The canvas is infinite: a view is { zoom, x, y }, where (x, y) is where the
  world origin sits on screen, in screen pixels, relative to the board's own
  top-left. A world point wx maps to screen wx * zoom + x. All of the
  arithmetic lives here, as pure functions, so it can be tested without a
  browser and so a pan, a zoom and a drag can never disagree about it.
*/
export const toWorld = (v, sx, sy) => ({ x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom })
export const toScreen = (v, wx, wy) => ({ x: wx * v.zoom + v.x, y: wy * v.zoom + v.y })
/** Zoom by a factor keeping the world point under (sx, sy) exactly where it is. */
export const zoomAt = (v, factor, sx, sy) => {
  const zoom = clampZoom(v.zoom * factor)
  const k = zoom / v.zoom
  return { zoom, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k }
}
/**
 * The distance between grid dots on screen. The grid doubles its spacing each time the dots would otherwise crowd closer
 * than 14px, so zoomed far out it stays a calm lattice instead of a grey haze. Every spacing is a multiple of the base one,
 * so the dots that remain are a subset of the dots that went: nothing seems to slide as you zoom.
 */
export const gridStep = (zoom, base = 24, min = 14) => {
  let step = base * zoom
  while (step < min) step *= 2
  return step
}
export const panBy = (v, dx, dy) => ({ ...v, x: v.x + dx, y: v.y + dy })
/** The view that brings every rectangle into a box of w by h with a margin, never magnifying past 1. */
export const fitView = (rects, w, h, pad = 40) => {
  if (rects.length === 0) return { zoom: 1, x: 0, y: 0 }
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w))
  const y1 = Math.max(...rects.map((r) => r.y + r.h))
  const zoom = clampZoom(Math.min(1, (w - pad * 2) / (x1 - x0), (h - pad * 2) / (y1 - y0)))
  return { zoom, x: (w - (x1 - x0) * zoom) / 2 - x0 * zoom, y: (h - (y1 - y0) * zoom) / 2 - y0 * zoom }
}

const crossing = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const anyCrossing = (list) => list.some((a, i) => list.slice(i + 1).some((b) => crossing(a, b)))

/**
 * A GIVEN arrangement that does not fit the stage, laid out again so that it does.
 *
 * Clamping a rectangle to its minimum width is right for a module the person has made small; it is wrong for the
 * arrangement the page starts with, because the thirds are fractions of a stage and a narrow stage (a tablet, a window
 * dragged in) cannot hold three columns of 240px. The clamp then pushed each module into its neighbour and the default
 * page opened overlapping itself. Overlap is something a person chooses (HQ-LAYOUT-005), never something the page starts
 * with, so a start that cannot fit is wrapped into rows in reading order, each module keeping its own size, and the
 * rows share the stage's height if they are too tall for it.
 */
export const flowFit = (rects, st) => {
  const list = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const out = []
  let x = 0
  let y = 0
  let rowH = 0
  for (const m of list) {
    const w = Math.min(m.w, st.w)
    if (x > 0 && x + w > st.w) {
      x = 0
      y += rowH + GAP
      rowH = 0
    }
    out.push({ ...m, x, y, w })
    x += w + GAP
    rowH = Math.max(rowH, m.h)
  }
  const bottom = y + rowH
  if (bottom > st.h && out.length > 0) {
    const rows = [...new Set(out.map((m) => m.y))].sort((a, b) => a - b)
    const room = Math.max(0, st.h - GAP * (rows.length - 1))
    const each = Math.max(MIN.h, Math.floor(room / rows.length))
    for (const m of out) {
      const row = rows.indexOf(m.y)
      m.y = row * (each + GAP)
      m.h = Math.min(m.h, each)
    }
  }
  return out
}

/** A fractional layout as pixels for this stage, with a gap between neighbours. */
export const fromFractions = (frac, st) => {
  const placed = Object.entries(frac).map(([id, [fx, fy, fw, fh]], i) =>
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
  // The fractions never overlap each other; if the clamp made them, the stage is too small for this arrangement.
  return anyCrossing(placed) ? flowFit(placed, st).map((m) => clampRect(m, st)) : placed
}

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

const emptyDoc = () => ({
  mods: null,
  zoom: 1,
  pan: { x: 0, y: 0 },
  layouts: {},
  postits: [],
  gone: {},
  seeded: false,
  bg: null,
})

/*
  The canvas background a project chose (#445): a small REFERENCE, never image bytes. `id` names a library entry or 'custom'
  (a picture held in this browser) or 'default' (the microcement the page always had, chosen on purpose); `at` is when it was
  chosen, so two devices that disagree settle on the newer choice exactly as a Post-it does. A project that never chose has
  `bg: null`, which draws the default and costs nothing.
*/
export const BG_MODES = ['tile', 'cover', 'fit', 'center']
const BG_ID = /^[a-z0-9][a-z0-9-]{0,47}$/
const num = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt)
export const cleanBg = (raw) => {
  if (raw === null || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!BG_ID.test(id)) return null
  return {
    id,
    mode: BG_MODES.includes(raw.mode) ? raw.mode : 'tile',
    scale: Math.round(num(raw.scale, 0.5, 2, 1) * 100) / 100,
    intensity: Math.round(num(raw.intensity, 0.2, 1, 1) * 100) / 100,
    tint: Math.round(num(raw.tint, 0, 0.6, 0) * 100) / 100,
    at: Number.isFinite(raw.at) ? raw.at : 0,
  }
}
/** The newer of two choices; on the same instant `mineWins` decides, and otherwise the same copy wins on every device. */
export const mergeBg = (a, b, mineWins = false) => {
  if (a === null || a === undefined) return b ?? null
  if (b === null || b === undefined) return a
  if (a.at !== b.at) return a.at > b.at ? a : b
  if (mineWins) return a
  return JSON.stringify(a) <= JSON.stringify(b) ? a : b
}

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

/** The longest note kept. The textarea says the same (compose.js), so nothing is typed that is not saved. */
export const NOTE_MAX = 5000

const cleanPostit = (n) => ({
  id: String(n.id),
  x: Number(n.x) || 0,
  y: Number(n.y) || 0,
  w: Number(n.w) || POSTIT_DEFAULT.w,
  h: Number(n.h) || POSTIT_DEFAULT.h,
  z: Number.isFinite(n.z) ? n.z : 1,
  text: typeof n.text === 'string' ? n.text.slice(0, NOTE_MAX) : '',
  // When this note last changed: what lets two copies of the document be merged note by note rather than overwritten.
  at: Number.isFinite(n.at) ? n.at : 0,
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
  d.pan = cleanPan(raw.pan)
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
  if (raw.gone !== null && typeof raw.gone === 'object') {
    for (const [id, at] of Object.entries(raw.gone)) {
      if (isPostit(id) && Number.isFinite(at)) d.gone[id] = at
    }
  }
  d.seeded = raw.seeded === true
  d.bg = cleanBg(raw.bg)
  return d
}

/**
 * Two copies of one project's notes, merged note by note.
 *
 * The workspace is stored as ONE document, so a plain overwrite means whichever tab (or device) saved last erases the
 * notes the other one wrote. A note is kept when it is the newest copy of itself and nothing newer removed it. `gone`
 * records removals (id -> when) so that a stale copy cannot bring a removed note back.
 */
export const mergeNotes = (a, b, mineWins = false) => {
  const gone = { ...a.gone }
  for (const [id, at] of Object.entries(b.gone ?? {})) gone[id] = Math.max(gone[id] ?? 0, at)
  const byId = new Map()
  for (const n of [...a.postits, ...b.postits]) {
    const have = byId.get(n.id)
    /*
      On the same instant two DEVICES must pick the same copy, or they would swap forever: compare the text of the copies.
      A save on this device (`mineWins`) is different: its own newest copy beats the stored older one, because a move
      and an edit can land in the same millisecond.
    */
    if (
      have === undefined ||
      n.at > have.at ||
      (n.at === have.at && !mineWins && JSON.stringify(n) > JSON.stringify(have))
    )
      byId.set(n.id, n)
  }
  const postits = [...byId.values()].filter((n) => !((gone[n.id] ?? -1) >= n.at && n.id in gone))
  const kept = Object.fromEntries(
    Object.entries(gone)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 200),
  )
  return { postits, gone: kept }
}

/** The document as the array the office stores. */
export const toPanels = (d) => [
  ...(d.mods ?? []).map(cleanMod),
  {
    id: '__workspace',
    v: 2,
    hasMods: d.mods !== null,
    zoom: d.zoom,
    pan: d.pan,
    layouts: d.layouts,
    postits: d.postits,
    gone: d.gone,
    seeded: d.seeded,
    bg: d.bg,
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
    pan: meta.pan,
    layouts: meta.layouts,
    postits: meta.postits,
    gone: meta.gone,
    seeded: meta.seeded,
    bg: meta.bg,
  })
}

/** Is there anything worth keeping? An empty document is a reset, never stored. */
const isBlank = (d) =>
  d.mods === null &&
  d.zoom === 1 &&
  d.pan.x === 0 &&
  d.pan.y === 0 &&
  d.postits.length === 0 &&
  Object.keys(d.gone).length === 0 &&
  Object.keys(d.layouts).length === 0 &&
  d.bg === null &&
  d.seeded === false

/* Where the browser keeps the document. Replaceable so a test can run two "devices" side by side in one process. */
let storage = null
const ls = () => storage ?? globalThis.localStorage
export const useStorage = (s) => {
  storage = s
}

const cache = new Map()
const mine = new Set()

/** The stored document for a project. */
export const doc = (slug) => {
  const s = slugOf(slug)
  if (cache.has(s)) return cache.get(s)
  let d = emptyDoc()
  try {
    const raw = ls()?.getItem(KEY(s)) ?? ''
    if (raw !== '') d = normalise(JSON.parse(raw))
  } catch {
    d = emptyDoc()
  }
  cache.set(s, d)
  return d
}

let keep = null
let forget = null
let look = null
let changed = null
let timer = null
let readRev = null
let keepIf = null
let casOff = false
let skew = 0
const pending = new Map()
const revs = new Map()
const backoff = new Map()

/**
 * The time a note is stamped with: this device's clock moved by how far it was from the office's last time the office said its
 * own (migration 1023 returns `now`). A device with a wrong clock would otherwise stamp every edit in the past or the future
 * and outrank or lose to every honest one. Zero until the office has answered, and ignored when the difference is implausible.
 */
export const stamp = () => Date.now() + skew
const noteClock = (serverNow) => {
  const n = Number(serverNow)
  if (!Number.isFinite(n) || n < 1.5e12) return
  const d = n - Date.now()
  skew = Math.abs(d) < 5 * 365 * 24 * 3600 * 1000 ? d : 0
}

/**
 * Tell this module how to put the document in the office.
 *
 * `fetch(slug)` reads the office's copy of one project's arrangement (the array `save` stores, or null) and `changed(slug)` is
 * told when notes from another device were folded in, so the page can draw them. Both are optional: without them a save is
 * not checked afterwards and nothing is announced.
 */
export const persistence = ({
  save: saveAway,
  reset: resetAway,
  fetch: fetchAway,
  changed: told,
  readRev: readRevision,
  saveIf: saveIfRevision,
} = {}) => {
  /*
    `readRev(slug)` answers `{ panels, rev, now }` and `saveIf(slug, panels, rev)` answers `{ ok, rev }` or
    `{ conflict, rev, panels }` (migration 1023, #442). Both or neither: a gateway that lacks them is detected on first use
    and the page falls back to the merge-and-check loop below, which is what it did before they existed.
  */
  readRev = typeof readRevision === 'function' && typeof saveIfRevision === 'function' ? readRevision : null
  keepIf = readRev === null ? null : saveIfRevision
  casOff = false
  keep = typeof saveAway === 'function' ? saveAway : null
  forget = typeof resetAway === 'function' ? resetAway : null
  look = typeof fetchAway === 'function' ? fetchAway : null
  changed = typeof told === 'function' ? told : null
}

/*
  THE STORED DOCUMENT IS ONE ROW, so a plain save is last writer wins, and two devices that each add a note inside the same
  few seconds would leave only one of them in the office. There is no revision column to check against (that needs a backend
  change, recorded in #439), so the guarantee is made from what the browser CAN do: after a save, read the office's copy back
  and merge it with ours note by note (a note is kept when it is the newest copy of itself and nothing newer removed it). If the
  office lacks anything this device holds, send the merged result, and check again; if this device lacks something the office
  holds, take it and say so. Both devices run the same loop and the merge is the same on both, so they converge, and a note is
  only lost if every device that held it is gone, which the browser's own copy (localStorage) makes unlikely.
*/
const HEAL_AFTER_MS = 2500
const HEAL_EVERY_MS = 10000
const healing = new Map()
const lastHeal = new Map()
const sameBg = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const canon = (postits, gone) =>
  JSON.stringify([
    [...postits].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    Object.entries(gone).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  ])

const check = async (s) => {
  if (look === null) return
  let panels
  try {
    if (readRev !== null && !casOff) {
      try {
        const r = await readRev(s)
        noteClock(r?.now)
        panels = r?.panels ?? null
      } catch (e) {
        if (!unsupported(e)) throw e
        casOff = true
        panels = await look(s)
      }
    } else panels = await look(s)
  } catch {
    return
  }
  const there = fromPanels(panels) ?? emptyDoc()
  const here = doc(s)
  const merged = mergeNotes(here, there)
  const bg = mergeBg(here.bg, there.bg)
  const lacksHere =
    canon(merged.postits, merged.gone) !== canon(here.postits, here.gone) || !sameBg(bg, here.bg)
  const lacksThere =
    canon(merged.postits, merged.gone) !== canon(there.postits, there.gone) || !sameBg(bg, there.bg)
  if (lacksHere) {
    const d = { ...here, ...merged, bg }
    cache.set(s, d)
    try {
      ls()?.setItem(KEY(s), JSON.stringify(d))
    } catch {
      /* Cached in memory regardless. */
    }
    changed?.(s)
  }
  if (lacksThere) {
    pending.set(s, doc(s))
    if (timer !== null) globalThis.clearTimeout(timer)
    timer = globalThis.setTimeout(sendNow, 700)
  }
}

/** Compare this device's notes with the office's now (the open page asks about once a minute). */
export const syncNow = (slug) => {
  const s = slugOf(slug)
  if (s === '' || look === null) return Promise.resolve()
  lastHeal.set(s, Date.now())
  return check(s)
}

const heal = (s) => {
  if (look === null || healing.has(s)) return
  const wait = Math.max(HEAL_AFTER_MS, (lastHeal.get(s) ?? 0) + HEAL_EVERY_MS - Date.now())
  healing.set(
    s,
    globalThis.setTimeout(() => {
      healing.delete(s)
      lastHeal.set(s, Date.now())
      void check(s)
    }, wait),
  )
}

const sendNow = () => {
  timer = null
  for (const [s, d] of pending) {
    if (isBlank(d)) {
      if (forget !== null) void forget(s)
    } else if (keep !== null) {
      void saveChecked(s)
    }
  }
  pending.clear()
}

/*
  Read before writing, so a device that has been idle (and so is behind) does not overwrite what another device wrote since: the
  office's copy is merged in first. At most once every ten seconds per project, because typing saves every 700ms and the read is the
  whole studio payload; the check after the save covers the rest.
*/
const MAX_SWAPS = 6
const unsupported = (e) =>
  /unknown section|PGRST202|could not find the function|schema cache|p_expected_rev/i.test(String(e?.message ?? e))

/** Fold the office's copy into this device's, drawing anything that arrived. */
const foldIn = (s, panels) => {
  const there = fromPanels(panels)
  if (there === null) return
  const here = doc(s)
  const merged = mergeNotes(here, there)
  const bg = mergeBg(here.bg, there.bg)
  if (canon(merged.postits, merged.gone) === canon(here.postits, here.gone) && sameBg(bg, here.bg)) return
  const d = { ...here, ...merged, bg }
  cache.set(s, d)
  try {
    ls()?.setItem(KEY(s), JSON.stringify(d))
  } catch {
    /* Cached in memory regardless. */
  }
  changed?.(s)
}

/**
 * Save by compare-and-swap: read the office's copy and its revision, fold it in, send naming that revision. If the office has
 * moved on, it refuses and hands back its current copy, which is folded in and the save is tried again. Bounded; a save that
 * is still being refused is kept and tried on the next tick, never dropped. Returns false when the office cannot do this.
 */
const swapSave = async (s) => {
  let r
  try {
    r = await readRev(s)
  } catch (e) {
    if (unsupported(e)) casOff = true
    return false
  }
  if (r === null || typeof r !== 'object') return false
  noteClock(r.now)
  for (let i = 0; i < MAX_SWAPS; i += 1) {
    foldIn(s, r.panels)
    const now = doc(s)
    if (isBlank(now)) {
      if (forget !== null) await forget(s)
      revs.delete(s)
      return true
    }
    let out
    try {
      out = await keepIf(s, toPanels(now), Number(r.rev) || 0)
    } catch (e) {
      if (unsupported(e)) casOff = true
      throw e
    }
    if (out === undefined) return true
    noteClock(out?.now)
    if (out?.conflict === true) {
      r = { panels: out.panels, rev: out.rev }
      continue
    }
    if (out?.ok === true || out?.reset === true) {
      backoff.delete(s)
      revs.set(s, Number(out.rev) || 0)
      return true
    }
    return false
  }
  /* Still being refused after several tries: keep it and go again later, waiting longer each round (1.5 s, 3 s ... 60 s). */
  const round = (backoff.get(s) ?? 0) + 1
  backoff.set(s, round)
  pending.set(s, doc(s))
  if (timer !== null) globalThis.clearTimeout(timer)
  timer = globalThis.setTimeout(sendNow, Math.min(60_000, 750 * 2 ** round))
  return true
}

const saveChecked = async (s) => {
  if (readRev !== null && !casOff) {
    try {
      if (await swapSave(s)) {
        heal(s)
        return
      }
    } catch {
      /* Fell through to the plain save below only when the office lacks compare-and-swap. */
      if (!casOff) return
    }
  }
  try {
    if (look !== null && Date.now() - (lastHeal.get(s) ?? 0) > HEAL_EVERY_MS) {
      lastHeal.set(s, Date.now())
      try {
        const there = fromPanels(await look(s))
        if (there !== null) {
          const here = doc(s)
          const merged = mergeNotes(here, there)
          const bg = mergeBg(here.bg, there.bg)
          if (
            canon(merged.postits, merged.gone) !== canon(here.postits, here.gone) ||
            !sameBg(bg, here.bg)
          ) {
            cache.set(s, { ...here, ...merged, bg })
            try {
              ls()?.setItem(KEY(s), JSON.stringify({ ...here, ...merged, bg }))
            } catch {
              /* Cached in memory regardless. */
            }
            changed?.(s)
          }
        }
      } catch {
        /* Could not look: save what is here; the check afterwards tries again. */
      }
    }
    const now = doc(s)
    if (isBlank(now)) {
      if (forget !== null) await forget(s)
    } else {
      await keep(s, toPanels(now))
    }
    heal(s)
  } catch {
    /* A failed save is retried by the next refresh (adopt sends what the office lacks). */
  }
}

/** Write the document to the browser now and to the office shortly after. */
const commit = (slug, mine_) => {
  const s = slugOf(slug)
  /*
    Another tab may have written notes since this one last read the document. Fold its notes in before writing, or this
    save erases them (and a blank result would delete the office's copy, notes included).
  */
  let d = mine_
  try {
    const raw = ls()?.getItem(KEY(s)) ?? ''
    if (raw !== '') {
      const stored = normalise(JSON.parse(raw))
      d = { ...d, ...mergeNotes(d, stored, true), bg: mergeBg(d.bg, stored.bg, true) }
    }
  } catch {
    /* Nothing readable to fold in. */
  }
  cache.set(s, d)
  mine.add(s)
  try {
    if (isBlank(d)) ls()?.removeItem(KEY(s))
    else ls()?.setItem(KEY(s), JSON.stringify(d))
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

/* A tab closed inside the save delay would otherwise leave the last moments of typing only in this browser. */
if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('pagehide', () => flush())
  globalThis.addEventListener?.('visibilitychange', () => {
    if (globalThis.document?.visibilityState === 'hidden') flush()
  })
}

/** Take the office's copy, unless this session has already changed it. */
export const adopt = (slug, panels) => {
  const s = slugOf(slug)
  if (s === '') return false
  const theirs = fromPanels(panels)
  if (theirs === null) return false
  if (mine.has(s)) {
    /*
      This session has changed the arrangement, so the view, sizes and positions stay as it left them. Notes are
      different: another device may have written some since, and the next save would erase them. Fold in only the notes,
      and send the result when this session holds anything the office lacks.
    */
    const here = doc(s)
    const merged = mergeNotes(here, theirs)
    const bg = mergeBg(here.bg, theirs.bg)
    const whole = canon(merged.postits, merged.gone)
    const lacksHere = whole !== canon(here.postits, here.gone) || !sameBg(bg, here.bg)
    /* A save that failed (offline) leaves notes only here: a refresh must send them, not just take what the office has. */
    const lacksThere = whole !== canon(theirs.postits, theirs.gone) || !sameBg(bg, theirs.bg)
    if (!lacksHere && !lacksThere) return false
    const d = { ...here, ...merged, bg }
    cache.set(s, d)
    try {
      ls()?.setItem(KEY(s), JSON.stringify(d))
    } catch {
      /* Cached in memory regardless. */
    }
    if (lacksThere) {
      pending.set(s, d)
      if (timer !== null) globalThis.clearTimeout(timer)
      timer = globalThis.setTimeout(sendNow, 700)
    }
    return lacksHere
  }
  /*
    The browser may hold notes the office never received (offline, a tab closed inside the save delay). Taking the office's
    copy whole would throw them away; fold them in, and send the result when it differs.
  */
  let d = theirs
  let ahead = false
  try {
    const raw = ls()?.getItem(KEY(s)) ?? ''
    if (raw !== '') {
      const stored = normalise(JSON.parse(raw))
      const merged = mergeNotes(theirs, stored)
      const bg = mergeBg(theirs.bg, stored.bg)
      ahead =
        canon(merged.postits, merged.gone) !== canon(theirs.postits, theirs.gone) ||
        !sameBg(bg, theirs.bg)
      d = { ...theirs, ...merged, bg }
    }
  } catch {
    d = theirs
  }
  cache.set(s, d)
  try {
    ls()?.setItem(KEY(s), JSON.stringify(d))
  } catch {
    /* Cached in memory regardless. */
  }
  if (ahead) {
    pending.set(s, d)
    if (timer !== null) globalThis.clearTimeout(timer)
    timer = globalThis.setTimeout(sendNow, 700)
  }
  return true
}

/** Forget every in-memory document (tests). */
export const forgetAll = () => {
  cache.clear()
  mine.clear()
  pending.clear()
  for (const t of healing.values()) globalThis.clearTimeout(t)
  healing.clear()
  lastHeal.clear()
  backoff.clear()
  revs.clear()
}

/* ------------------------------------------------------------- the modules --- */

/** The modules on the page, in pixels for the current stage, clamped. */
export const layout = (slug) => {
  const d = doc(slug)
  const base = d.mods === null ? fromFractions(THIRDS, stage) : d.mods
  return base.map((m) => clampRect(m))
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
  d.mods = d.mods.map((m) => (m.id === id ? clampRect({ ...m, ...rect, id, z }) : m))
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
  commit(slug, { ...doc(slug), mods: null, zoom: 1, pan: { x: 0, y: 0 } })
}

/**
 * Has this page been arranged, tinted or zoomed, or is it as it was given?
 * Compared as geometry by id, so a board dragged back into its original shape
 * stops offering to restore a shape it is already in.
 */
export const customised = (slug) => {
  const d = doc(slug)
  if (d.zoom !== 1 || d.pan.x !== 0 || d.pan.y !== 0) return true
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
export const viewOf = (slug) => ({ zoom: doc(slug).zoom, ...doc(slug).pan })
/** Store the view (zoom and where the origin sits). */
export const setView = (slug, v) => {
  const zoom = Math.round(clampZoom(v.zoom) * 1000) / 1000
  commit(slug, { ...doc(slug), zoom, pan: cleanPan(v) })
  return viewOf(slug)
}

/** The project's chosen background (a reference), or null when it never chose one. */
export const bgOf = (slug) => doc(slug).bg

/**
 * Choose a background. Stored with the moment it was chosen, so the newer of two devices' choices wins; a project's notes,
 * arrangement and view are carried through untouched. `null` is not accepted: going back to the default is a choice too
 * ({ id: 'default' }), because a plain removal could not beat an older choice on another device.
 */
export const setBg = (slug, bg, now = stamp()) => {
  const clean = cleanBg({ ...bg, at: now })
  if (clean === null) return doc(slug).bg
  commit(slug, { ...doc(slug), bg: clean })
  return clean
}

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
    /*
      Put where nothing is. The first draft assumed the thirds leave a free fifth on the right, which a tablet's three
      240px columns do not: the blank note opened on top of Docs & Files. So: beside the modules if there is room for it,
      else underneath them, and when neither exists the page simply has no starter (the Note button adds one): an empty
      note is never worth covering somebody's documents for.
    */
    // Judged against the arrangement the page is GIVEN, not the one a person has since made: a note that vanished the moment
    // somebody rearranged their modules would be stranger than one that was never offered.
    const mods = fromFractions(THIRDS, stage)
    const right = mods.reduce((n, m) => Math.max(n, m.x + m.w), 0)
    const bottom = mods.reduce((n, m) => Math.max(n, m.y + m.h), 0)
    const beside = stage.w - right - GAP - 8
    let spot
    if (mods.length === 0 || beside >= POSTIT_MIN.w + 20) {
      const sw = Math.min(POSTIT_DEFAULT.w, Math.max(150, Math.round(stage.w * 0.2) - 14), mods.length === 0 ? 999 : beside)
      spot = { x: stage.w - sw - 8, y: 6, w: sw, h: POSTIT_DEFAULT.h }
    } else if (stage.h - bottom - GAP >= POSTIT_MIN.h + 10) {
      spot = { x: stage.w - POSTIT_DEFAULT.w - 8, y: bottom + GAP, w: POSTIT_DEFAULT.w, h: Math.min(POSTIT_DEFAULT.h, stage.h - bottom - GAP) }
    } else {
      // Nowhere clear: no starter. The Note button in the toolbar still adds one, wherever its owner puts it.
      return []
    }
    const starter = clampRect({ id: 'n_starter', ...spot, z: 7, text: '' })
    return [{ ...starter, starter: true }]
  }
  return d.postits.map((n) => clampRect(n))
}

/**
 * Where a new note goes: beside the one it was made from (right, then below, left, above) at the first spot that
 * covers nothing, and failing that diagonally down and right of it. Pure, so it is decidable without a browser.
 */
export const spotNear = (origin, taken, size = POSTIT_DEFAULT, gap = 16) => {
  const hits = (r) => taken.some((t) => crossing(r, t))
  const tries = [
    { x: origin.x + origin.w + gap, y: origin.y },
    { x: origin.x, y: origin.y + origin.h + gap },
    { x: origin.x - size.w - gap, y: origin.y },
    { x: origin.x, y: origin.y - size.h - gap },
  ]
  for (const t of tries) {
    const r = { ...t, ...size }
    if (!hits(r)) return t
  }
  for (let i = 1; i < 40; i += 1) {
    const r = { x: origin.x + 24 * i, y: origin.y + 24 * i, ...size }
    if (!hits(r)) return { x: r.x, y: r.y }
  }
  return { x: origin.x + 24, y: origin.y + 24 }
}

/**
 * Add a note. With `near` (a note's id) it is placed beside that note; with `at` ({x, y} in world pixels) it is put
 * there, which is how the empty-canvas button drops one in the middle of what is on screen.
 */
export const addPostit = (slug, { near, at } = {}) => {
  const d = doc(slug)
  const z = topZ(d) + 1
  const offset = (d.postits.length % 6) * 22
  const all = postits(slug)
  const origin = near === undefined ? undefined : all.find((n) => n.id === near)
  let pos
  if (origin !== undefined) pos = spotNear(origin, [...layout(slug), ...all])
  else if (at !== undefined) pos = { x: Math.round(at.x), y: Math.round(at.y) }
  else pos = { x: stage.w - POSTIT_DEFAULT.w - 24 - offset, y: 24 + offset }
  const n = clampRect({ id: newId(), ...pos, ...POSTIT_DEFAULT, z, text: '', at: stamp() })
  commit(slug, { ...d, postits: [...d.postits, n], seeded: true })
  return n
}

/** Change a note. Returns its id, which differs only when the starter became real. */
export const setPostit = (slug, id, patch) => {
  const d = doc(slug)
  if (id === 'n_starter' && !d.postits.some((n) => n.id === id)) {
    const real = cleanPostit({ ...postits(slug)[0], ...patch, id: newId(), at: stamp() })
    commit(slug, { ...d, postits: [real], seeded: true })
    return real.id
  }
  commit(slug, {
    ...d,
    postits: d.postits.map((n) => (n.id === id ? cleanPostit({ ...n, ...patch, at: stamp() }) : n)),
  })
  return id
}

export const movePostit = (slug, id, rect) => {
  const d = doc(slug)
  const z = topZ(d) + 1
  if (id === 'n_starter' && !d.postits.some((n) => n.id === id)) {
    const real = cleanPostit({ ...postits(slug)[0], ...rect, id: newId(), z, at: stamp() })
    commit(slug, { ...d, postits: [real], seeded: true })
    return real.id
  }
  commit(slug, {
    ...d,
    postits: d.postits.map((n) =>
      n.id === id ? cleanPostit({ ...clampRect({ ...n, ...rect, id, z }, stage), at: stamp() }) : n,
    ),
  })
  return id
}

/** Put a removed note back exactly as it was (the Undo beside the removal). Its removal record is cleared, and it is newer than that record. */
export const restorePostit = (slug, note) => {
  const d = doc(slug)
  if (d.postits.some((n) => n.id === note.id)) return false
  const gone = { ...d.gone }
  // Strictly newer than the removal it undoes, even inside the same millisecond.
  const at = Math.max(stamp(), (gone[note.id] ?? 0) + 1)
  delete gone[note.id]
  commit(slug, { ...d, postits: [...d.postits, cleanPostit({ ...note, at })], gone, seeded: true })
  return true
}

/** Remove a note. This is the only thing in this module that deletes content, and it is explicit. */
export const removePostit = (slug, id) => {
  const d = doc(slug)
  commit(slug, {
    ...d,
    postits: d.postits.filter((n) => n.id !== id),
    gone: { ...d.gone, [id]: stamp() },
    seeded: true,
  })
}
