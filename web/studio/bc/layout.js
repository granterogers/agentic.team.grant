/*
  THE PROJECT HOME'S LAYOUT ENGINE.

  Grant, 22 September 2026:

    "The project homepage is intended to behave as a configurable workspace,
    not a static collection of cards... drag-and-drop module repositioning;
    dynamic module resizing; sensible minimum sizes; sensible maximum sizes;
    collision prevention; responsive rearrangement; persistence... Do not
    substitute crude up/down controls for genuine spatial rearrangement."

  What this replaces is an ORDERED LIST OF IDS rendered into a three-column
  CSS grid. That model cannot express any of the above: there is no position
  to drag to and no size to resize, because a module has neither. So the unit
  of storage changes from a name to a RECTANGLE.

  ## The model

  A layout is a list of `{ id, x, y, w, h }` on a 12-column grid with a fixed
  row unit. `x` and `w` are columns; `y` and `h` are rows. Nothing else is
  stored - the module's content, name and renderer are looked up by id, so a
  tool that is removed from the product cannot leave a hole, and a tool that
  is added simply is not placed until somebody places it.

  ## Why a fixed row unit rather than content height

  Because requirement 7 depends on it. Grant:

    "Remove patterns such as One More being used merely because additional
    content does not fit. Modules containing more data than their visible area
    should instead become internally scrollable."

  A pane whose height is decided by its content can never scroll internally -
  it has no height to overflow. A pane whose height is decided by the LAYOUT
  can, and the same decision is what makes a resize handle mean something.

  ## Collision

  Resolved by downward compaction, the same rule every spatial dashboard uses
  and the only one that is stable under repeated drags: sort by row then
  column, and lower each module to the highest row where it does not overlap
  anything already placed. Two consequences worth stating because they are
  deliberate:

   - dragging a module ONTO another pushes the other down rather than swapping
     them. Swapping reads as magic and is ambiguous when the sizes differ;
   - a layout is compacted on every read, so a stored layout written by an
     older version, or one holding a module that has since grown a minimum
     size, is repaired rather than rejected.

  ## Persistence

  Per device, keyed by project slug, in `localStorage` - the same place and
  for the same reason the id list was kept there, which Issue 299 records:
  `public.projects` holds ONE arrangement and Grant's current dashboard
  already uses it, so writing this to the office would take panels off that.
  The moment 299 lands this module gains a second store and nothing above it
  changes, which is the whole reason the reading and writing are here rather
  than scattered through the renderer.
*/

/** The grid. Twelve columns divides by 2, 3, 4 and 6, which is why it is 12. */
export const COLS = 12

/** One row unit, in pixels. The CSS must agree; it reads the same token. */
export const ROW = 44

/**
 * What each module needs, and what it may not exceed.
 *
 * A minimum is a statement about the CONTENT: below it the pane stops being
 * able to say anything, which is the failure CLAUDE.md records as eight agent
 * names wrapping one character per line. A maximum is a statement about the
 * PAGE: a pane wider than this is a pane that has stopped being a pane.
 */
export const BOUNDS = {
  tasks: { minW: 3, minH: 4, maxW: 12, maxH: 14 },
  board: { minW: 3, minH: 4, maxW: 12, maxH: 12 },
  documents: { minW: 3, minH: 4, maxW: 12, maxH: 14 },
  schedule: { minW: 3, minH: 4, maxW: 12, maxH: 12 },
  contacts: { minW: 3, minH: 4, maxW: 12, maxH: 14 },
  activity: { minW: 4, minH: 4, maxW: 12, maxH: 14 },
}

/** Every module the home can hold. The order is the order they are put back. */
export const ALL = Object.keys(BOUNDS)

/*
  The default, which is also the reference composition: three columns of four,
  the tools in the order the project is read in, and Latest Activity full
  width underneath because it is a history rather than a tool.
*/
/*
  THE HEIGHTS ARE SET BY THE FOLD, not by taste. §21 requires every tool to be
  understandable inside the first 1440x900 view, and a 1440 window leaves
  about 580px under the project head for two rows and the gap between them -
  so five rows each. A row unit is 44px and the grid's own 18px gap falls
  BETWEEN the rows a module spans, so h=5 is 5*44 + 4*18 = 292px rather than
  220 - which is the arithmetic that made a first attempt at six rows overrun
  the fold by 77px. The audit measures it rather than trusting this comment.
*/
export const DEFAULT = [
  { id: 'tasks', x: 0, y: 0, w: 4, h: 5 },
  { id: 'board', x: 4, y: 0, w: 4, h: 5 },
  { id: 'documents', x: 8, y: 0, w: 4, h: 5 },
  { id: 'schedule', x: 0, y: 5, w: 4, h: 5 },
  { id: 'contacts', x: 4, y: 5, w: 4, h: 5 },
  { id: 'activity', x: 8, y: 5, w: 4, h: 5 },
]

const KEY = (slug) => `bc.layout.${slug}`

const bounds = (id) => BOUNDS[id] ?? { minW: 3, minH: 3, maxW: 12, maxH: 14 }

/** One module, clamped into the grid and into its own bounds. */
export const clamp = (m) => {
  const b = bounds(m.id)
  const w = Math.max(b.minW, Math.min(b.maxW, Math.round(m.w ?? b.minW)))
  const h = Math.max(b.minH, Math.min(b.maxH, Math.round(m.h ?? b.minH)))
  const x = Math.max(0, Math.min(COLS - w, Math.round(m.x ?? 0)))
  const y = Math.max(0, Math.round(m.y ?? 0))
  return { id: m.id, x, y, w, h }
}

const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * Resolve overlaps and close vertical gaps, in one pass.
 *
 * `held` is the module the person is dragging: it keeps the row it was put on
 * so the drop lands where the pointer is, and everything else settles around
 * it. Without that exception the dragged module compacts to the top with the
 * rest and the drop appears to have been ignored.
 */
export const compact = (list, held = null) => {
  const sorted = [...list].map(clamp).sort((a, b) => a.y - b.y || a.x - b.x)
  const placed = []
  for (const m of sorted) {
    let y = m.id === held ? m.y : 0
    for (;;) {
      const at = { ...m, y }
      const clash = placed.find((q) => hits(at, q))
      if (clash === undefined) break
      y = clash.y + clash.h
    }
    placed.push({ ...m, y })
  }
  return placed.sort((a, b) => a.y - b.y || a.x - b.x)
}

/** The stored layout for a project, repaired, or the default. */
export const layout = (slug) => {
  const s = typeof slug === 'string' ? slug : (slug?.slug ?? '')
  try {
    const raw = globalThis.localStorage?.getItem(KEY(s)) ?? ''
    if (raw === '') return compact(DEFAULT)
    const saved = JSON.parse(raw)
    if (!Array.isArray(saved)) return compact(DEFAULT)
    /*
      Filtered against ALL on the way OUT rather than on the way in, which is
      the one thing the id-list version got right: a stored id for a tool that
      has since been removed renders nothing and would otherwise hold a
      rectangle of empty grid.
    */
    const kept = saved.filter((m) => m !== null && typeof m === 'object' && ALL.includes(m.id))
    return kept.length === 0 ? compact(DEFAULT) : compact(kept)
  } catch {
    return compact(DEFAULT)
  }
}

export const save = (slug, list) => {
  try {
    const clean = compact(list).map((m) => ({ id: m.id, x: m.x, y: m.y, w: m.w, h: m.h }))
    globalThis.localStorage?.setItem(KEY(slug), JSON.stringify(clean))
  } catch {
    /* A viewer who cannot store it still gets the default arrangement. */
  }
}

export const reset = (slug) => {
  try {
    globalThis.localStorage?.removeItem(KEY(slug))
  } catch {
    /* Already the default. */
  }
}

/** Take a module off the page. Everything else closes up behind it. */
export const remove = (slug, id) => {
  save(slug, layout(slug).filter((m) => m.id !== id))
}

/**
 * Put a module back, in the first place it fits.
 *
 * At the END rather than in a gap: a tool reappearing in the middle of a
 * board somebody has arranged is a tool that moved their work, and the
 * compaction will close the gap if there is one under it anyway.
 */
export const add = (slug, id) => {
  const now = layout(slug)
  if (now.some((m) => m.id === id)) return
  const b = bounds(id)
  const bottom = now.reduce((n, m) => Math.max(n, m.y + m.h), 0)
  save(slug, [...now, { id, x: 0, y: bottom, w: Math.max(b.minW, 4), h: Math.max(b.minH, 6) }])
}

/** Which of ALL is not currently on the page. */
export const off = (slug) => {
  const on = new Set(layout(slug).map((m) => m.id))
  return ALL.filter((id) => !on.has(id))
}

/**
 * Move or resize one module and settle the rest.
 *
 * One function for both, because both are the same operation on the same
 * rectangle and having two would be two places for the clamping and the
 * compaction to disagree - which is the defect CLAUDE.md records as a row
 * list built twice.
 */
export const place = (slug, id, rect) => {
  const now = layout(slug)
  const next = now.map((m) => (m.id === id ? clamp({ ...m, ...rect, id }) : m))
  save(slug, compact(next, id))
  return layout(slug)
}
