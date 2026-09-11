/*
  A project is an arrangement, not a layout.

  Grant: *"this draggable area should be present within the project itself..
  where I can make a nicely arranged dashboard of the relevant docs (which can
  easily be added and removed), contacts, TODO, etc"*.

  The project page had a layout I chose: modules, then documents, with tasks and
  activity down the right. That is a reasonable guess and it is wrong for at
  least one project — Wellness has no modules and no documents, so two thirds of
  its page is an apology. Letting him arrange it is not a convenience feature,
  it is the difference between a page that fits every project badly and one that
  fits each project.

  ## Snapping, and why not free-drag

  The desk (#23 idea 9) is free-drag, because a desk is a place you remember
  things by position and neatness would defeat it. A dashboard is the opposite:
  he said *"nicely arranged"*, and nicely arranged means aligned. So panels snap
  to a 24px grid and to each other's edges — close enough to free that it never
  fights you, tight enough that the result looks composed rather than dropped.

  ## Layouts are per project

  Because the point is that a project with no documents does not have to show a
  Documents panel. A single shared layout would put the guess back.
*/

const KEY = 'studio.panels'
const GRID = 24

/** What a project CAN show. Each maps to a renderer in app.js. */
export const KINDS = [
  { id: 'modules', name: 'Modules', note: 'The parts of the work', w: 2, h: 300 },
  /*
    380, not 340.

    A document card is 284px of cover plus a two-line caption, and the panel is
    340 with a 46px header — so the caption was cut off mid-word at the bottom
    edge, on every project, in a panel with overflow: hidden. Measured with
    `npm run probe` rather than read out of the stylesheet, which is the only
    reason it was found: the layout looks deliberate right up until you notice
    the word "Notion" has no second half.
  */
  { id: 'documents', name: 'Documents', note: 'A shelf of covers', w: 2, h: 380 },
  { id: 'tasks', name: 'Tasks', note: 'What is open', w: 1, h: 340 },
  { id: 'contacts', name: 'People', note: 'Who it is about', w: 1, h: 320 },
  { id: 'activity', name: 'Lately', note: 'What the team did', w: 1, h: 260 },
  { id: 'links', name: 'Connections', note: 'What it is joined to', w: 1, h: 180 },
  { id: 'note', name: 'Note', note: 'Somewhere to write', w: 1, h: 220 },
]

/** Sensible first arrangement — a starting point, not a rule. */
const defaultFor = (project) => {
  const out = []
  let y = 0
  const has = {
    modules: project.modules.length > 0,
    documents: project.documents.length > 0,
    contacts: project.contacts.length > 0,
    tasks: project.tasks.length > 0,
    activity: project.activity.length > 0,
  }
  // Only what the project actually has. A panel showing nothing is the thing
  // this whole change exists to remove.
  if (has.modules) { out.push({ id: 'modules', x: 0, y, w: 2, h: 300 }); y += 324 }
  if (has.documents) { out.push({ id: 'documents', x: 0, y, w: 2, h: 380 }); y += 404 }
  let ry = 0
  if (has.tasks) { out.push({ id: 'tasks', x: 2, y: ry, w: 1, h: 340 }); ry += 364 }
  if (has.contacts) { out.push({ id: 'contacts', x: 2, y: ry, w: 1, h: 320 }); ry += 344 }
  if (has.activity) { out.push({ id: 'activity', x: 2, y: ry, w: 1, h: 260 }) }
  out.push({ id: 'links', x: 0, y: Math.max(y, ry), w: 1, h: 180 })
  return out
}

export function layout(project) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const mine = all[project.slug]
    if (Array.isArray(mine) && mine.length > 0) return mine
  } catch { /* fall through */ }
  return defaultFor(project)
}

export function save(slug, panels) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    all[slug] = panels
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* not fatal */ }
}

export const reset = (slug) => {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    delete all[slug]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* not fatal */ }
}

/**
 * Dragging, snapping, and resizing by column.
 *
 * Snap targets are the grid AND the edges of every other panel, because
 * aligning to a neighbour is what "nicely arranged" actually means and a bare
 * grid does not guarantee it — two panels can both be on the grid and still be
 * a few pixels out of line with each other.
 */
export function wire(host, project, panels, redraw) {
  const colWidth = () => (host.clientWidth - 2 * 20) / 3

  const snap = (value, others) => {
    const grid = Math.round(value / GRID) * GRID
    // A neighbour's edge wins over the grid when it is closer than half a cell.
    let best = grid
    let bestGap = Math.abs(value - grid)
    for (const o of others) {
      const gap = Math.abs(value - o)
      if (gap < bestGap && gap < GRID) { best = o; bestGap = gap }
    }
    return Math.max(0, best)
  }

  for (const el of host.querySelectorAll('[data-panel]')) {
    const id = el.dataset.panel
    const panel = panels.find((p) => p.id === id)
    if (!panel) continue
    const grip = el.querySelector('[data-grip]')
    let drag = null

    grip?.addEventListener('pointerdown', (e) => {
      drag = { dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop }
      grip.setPointerCapture(e.pointerId)
      el.classList.add('lifted')
    })
    grip?.addEventListener('pointermove', (e) => {
      if (drag === null) return
      const others = panels.filter((p) => p.id !== id)
      const x = snap(e.clientX - drag.dx, others.map((p) => p.x * (colWidth() + 20)))
      const y = snap(e.clientY - drag.dy, others.flatMap((p) => [p.y, p.y + p.h + 20]))
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      panel.x = Math.round(x / (colWidth() + 20))
      panel.y = y
    })
    const drop = () => {
      if (drag === null) return
      drag = null
      el.classList.remove('lifted')
      save(project.slug, panels)
      redraw()
    }
    grip?.addEventListener('pointerup', drop)
    grip?.addEventListener('pointercancel', drop)

    // Width by column, because a dashboard of arbitrary widths never lines up.
    el.querySelector('[data-wider]')?.addEventListener('click', () => {
      panel.w = Math.min(3, panel.w + 1)
      save(project.slug, panels); redraw()
    })
    el.querySelector('[data-narrower]')?.addEventListener('click', () => {
      panel.w = Math.max(1, panel.w - 1)
      save(project.slug, panels); redraw()
    })
    el.querySelector('[data-drop-panel]')?.addEventListener('click', () => {
      save(project.slug, panels.filter((p) => p.id !== id)); redraw()
    })
  }
}
