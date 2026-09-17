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

import { act, canWrite } from './office.js'

const KEY = 'studio.panels'
const GRID = 24

/*
  Where an arrangement lives (#81, migration 0250).

  Grant was explicit that `localStorage` is the wrong answer: *"he uses more
  than one device and the whole point of arranging it is that it stays
  arranged."* So the office holds it, in `public.dashboard_layouts`, and
  `hq_studio()` hands it back on the project as `project.layout`.

  `localStorage` still gets written, and is not a leftover. It is the cache
  that makes a drag feel instant: the RPC is a round trip, the redraw is not,
  and a panel that snaps back for 200ms before settling reads as a bug. It is
  also the whole answer with no token, where the studio is a prototype against
  invented projects and there is nothing to save to.

  So the order is: what the office knows, then what this browser remembers,
  then the default. The office wins, because it is the one that is his rather
  than this machine's.
*/
const remember = (slug, panels) => {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (panels === null) delete all[slug]
    else all[slug] = panels
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* not fatal — the office has it */ }
}
const remembered = (slug) => {
  try {
    const mine = JSON.parse(localStorage.getItem(KEY) ?? '{}')[slug]
    return Array.isArray(mine) && mine.length > 0 ? mine : null
  } catch { return null }
}
/*
  Fire and forget, deliberately.

  Awaiting the save would make every drop wait on the network before the board
  redrew. If it fails the arrangement is still on screen and still in this
  browser, and the next change tries again — so the failure mode is "the other
  device is out of date", not "your work vanished". It is logged rather than
  swallowed so a persistent failure is findable.
*/
/*
  What THIS session just did, which outranks all three.

  Without it a drag snapped back. `layout()` prefers `project.layout` — the
  office's copy, carried in the payload fetched at load — so the redraw
  immediately after a drop read the arrangement as it was BEFORE the drop and
  put the panel back. The save had worked; the screen disagreed with it.

  Re-fetching the whole studio payload after every drop is the other fix and is
  much worse: a network round trip between letting go of a panel and seeing it
  land. So the change is held here until the next load, when the office's copy
  is authoritative again.
*/
const live = new Map()

const persist = (action, args) => {
  if (!canWrite()) return
  void act(action, args).catch((e) => {
    console.warn('the arrangement did not reach the office:', e.message)
  })
}

/** What a project CAN show. Each maps to a renderer in app.js. */
export const KINDS = [
  /*
    A tone per category (#220, item 13 of the brief).

    Grant: *"Different modules currently blend together too much. Give module
    categories subtle visual differentiation... Keep this tasteful. Do not turn
    the dashboard into a collection of brightly coloured boxes. The objective is
    faster visual parsing."*

    So it is five CATEGORIES, not eleven colours: things to make, things to do,
    people, what already happened, and what this is joined to. Two panels can
    share a tone - Documents and Note are both things you make - which is the
    point of grouping rather than labelling. It is drawn as a hairline on the
    header, nothing more.
  */
  { id: 'modules', name: 'Modules', note: 'The parts of the work', w: 2, h: 300, tone: 'k-do' },
  /*
    380, not 340.

    A document card is 284px of cover plus a two-line caption, and the panel is
    340 with a 46px header — so the caption was cut off mid-word at the bottom
    edge, on every project, in a panel with overflow: hidden. Measured with
    `npm run probe` rather than read out of the stylesheet, which is the only
    reason it was found: the layout looks deliberate right up until you notice
    the word "Notion" has no second half.
  */
  { id: 'documents', name: 'Documents', note: 'A shelf of covers', w: 2, h: 380, tone: 'k-make' },
  { id: 'tasks', name: 'Tasks', note: 'What is open', w: 1, h: 340, tone: 'k-do' },
  { id: 'contacts', name: 'People', note: 'Who it is about', w: 1, h: 320, tone: 'k-who' },
  { id: 'activity', name: 'Recent activity', note: 'What the team did, most recent first', w: 1, h: 260, tone: 'k-past' },
  { id: 'links', name: 'Connections', note: 'What it is joined to', w: 1, h: 180, tone: 'k-join' },
  /*
    How it got here (#156).

    `k-past` with Recent activity, and deliberately NOT the same panel. Grant:
    "a feed of every job is noise at month three; a sequence of 'the project
    changed in this way' is a story." One is what the team did this week, the
    other is how the thing came to be shaped the way it is.

    Two columns and 320px because it is read top to bottom as prose, not
    scanned like a list, and a narrow column turns every line into three.
  */
  { id: 'history', name: 'How it got here', note: 'Oldest first', w: 2, h: 320, tone: 'k-past' },
  { id: 'note', name: 'Note', note: 'Somewhere to write', w: 1, h: 220, tone: 'k-make' },
]

/*
  The home screen's panels (#219, migration 0376).

  Grant: *"The current homepage consisting mainly of project cards is not
  useful enough. The homepage should become the global command dashboard for
  the entire Agentic Team workspace... Projects should remain discoverable
  without consuming the entire purpose of the home screen."*

  So Projects is ONE panel among five rather than the page, and the four
  beside it are the things a command dashboard is for: what is waiting on him,
  what is open across everything, who is working right now, and what just
  happened.

  A separate list from `KINDS` on purpose. A project's Documents panel has no
  meaning without a project, and an "everything, everywhere" version of it
  would be a different panel wearing the same name - which is 0311's lesson
  about two words for one thing, with the sign reversed.
*/
export const HOME_KINDS = [
  { id: 'waiting', name: 'Waiting on you', note: 'Decisions the office cannot make', w: 2, h: 220, tone: 'k-do' },
  { id: 'tasks', name: 'Tasks', note: 'Everything open, across every project', w: 2, h: 420, tone: 'k-do' },
  { id: 'projects', name: 'Projects', note: 'All of them, and how each is doing', w: 1, h: 420, tone: 'k-join' },
  { id: 'team', name: 'The team', note: 'Who is working now', w: 1, h: 280, tone: 'k-who' },
  { id: 'activity', name: 'Recent activity', note: 'What the office did, most recent first', w: 1, h: 320, tone: 'k-past' },
]

/*
  The default home arrangement.

  What needs him first, widest and at the top; everything open under it; the
  projects beside them rather than instead of them. Unlike a project's default
  this does not vary with the data - the home screen exists before there is
  anything on it, and a first-run dashboard that draws two panels teaches
  nothing about what it will become.
*/
const HOME_DEFAULT = [
  { id: 'waiting', x: 0, y: 0, w: 2, h: 220 },
  { id: 'projects', x: 2, y: 0, w: 1, h: 420 },
  { id: 'tasks', x: 0, y: 244, w: 2, h: 420 },
  { id: 'team', x: 2, y: 444, w: 1, h: 300 },
  { id: 'activity', x: 0, y: 688, w: 3, h: 320 },
]

const HOME_KEY = 'home'
/** What the office holds for the home screen, once it has been read. */
let fromOffice = null

/**
 * Adopt the arrangement the office has, if there is one.
 *
 * Called once on the way in, with whatever `section=workspace` returned.
 * Ignoring a malformed payload rather than throwing: a home screen that will
 * not draw because its saved layout is odd is worse than one that draws the
 * default.
 */
export function adoptHome(payload) {
  const panels = payload?.panels
  fromOffice = Array.isArray(panels) && panels.length > 0 ? panels : null
}

export function homeLayout() {
  const mine = live.get(HOME_KEY)
  if (mine !== undefined) return mine === null ? HOME_DEFAULT : mine
  if (fromOffice !== null) return fromOffice
  return remembered(HOME_KEY) ?? HOME_DEFAULT
}

export function homeSave(panels) {
  live.set(HOME_KEY, panels.length === 0 ? null : panels)
  remember(HOME_KEY, panels.length === 0 ? null : panels)
  if (panels.length === 0) {
    fromOffice = null
    persist('workspace_layout_reset', {})
    return
  }
  persist('workspace_layout_set', { p_panels: panels })
}

export function homeReset() {
  live.set(HOME_KEY, null)
  remember(HOME_KEY, null)
  fromOffice = null
  persist('workspace_layout_reset', {})
}

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
  /*
    How it got here, on every board (#156).

    Unconditional, unlike the five above, and for a reason rather than an
    oversight: those are gated on the project HAVING some — a panel showing
    nothing is what #220 removed — and every project has a history, because
    every project has the moment it was started. The one-entry version reads
    "this began on the 3rd of September" and that is a true and useful thing
    for a board to say about a project a week old.

    Below the documents shelf: it is the thing you read after you have seen
    what is here, not before.
  */
  out.push({ id: 'history', x: 0, y, w: 2, h: 320 })
  y += 344
  out.push({ id: 'links', x: 0, y: Math.max(y, ry), w: 1, h: 180 })
  return out
}

export function layout(project) {
  const mine = live.get(project.slug)
  if (mine !== undefined) return mine === null ? defaultFor(project) : mine
  // Then what the office has, which is what he arranged wherever he arranged it.
  if (Array.isArray(project.layout) && project.layout.length > 0) return project.layout
  return remembered(project.slug) ?? defaultFor(project)
}

export function save(slug, panels) {
  live.set(slug, panels.length === 0 ? null : panels)
  remember(slug, panels)
  /*
    An empty board is a reset, not a layout — and the RPC says the same thing,
    because a stored `[]` is indistinguishable from a layout that failed to
    load. Removing the last panel puts the default back.
  */
  if (panels.length === 0) {
    remember(slug, null)
    persist('dashboard_layout_reset', { p_slug: slug })
    return
  }
  persist('dashboard_layout_set', { p_slug: slug, p_panels: panels })
}

export const reset = (slug) => {
  live.set(slug, null)
  remember(slug, null)
  persist('dashboard_layout_reset', { p_slug: slug })
}

/**
 * Dragging, snapping, and resizing by column.
 *
 * Snap targets are the grid AND the edges of every other panel, because
 * aligning to a neighbour is what "nicely arranged" actually means and a bare
 * grid does not guarantee it — two panels can both be on the grid and still be
 * a few pixels out of line with each other.
 */
/*
  `scope` is a dashboard project or the home screen (#219).

  It used to be the project, and the only thing it was ever read for was
  `project.slug` on the four lines that save. Two copies of this function -
  four hundred lines of snapping, pointer capture and the #105 fix for the
  header buttons - is exactly the drift CLAUDE.md keeps recording, so the
  engine takes a place to save to instead.
*/
export function wire(host, scope, panels, redraw) {
  const put = (ps) => { if (scope?.home === true) homeSave(ps); else save(scope.slug, ps) }
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
      put(panels)
      redraw()
    }
    grip?.addEventListener('pointerup', drop)
    grip?.addEventListener('pointercancel', drop)

    /*
      The three header buttons are INSIDE the drag handle, and that stopped
      them working (#105).

      `[data-grip]` is the whole header, so a press on Narrower, Wider or
      Remove first fired `pointerdown` on the grip: a drag began, the grip took
      pointer capture, `pointerup` ran `drop()`, which saved and redrew — and
      the DOM the click was travelling towards no longer existed. The click
      never landed. Three controls per panel, six panels, eighteen buttons that
      looked fine and did nothing.

      Found by `verify:controls` the first time it could reach the project
      routes at all. `verify:wired` could not have found it: the handlers ARE
      registered and the attributes ARE looked up — the fault is that the event
      never arrives, which only pressing the thing can show. That is why both
      checks exist.

      `pointerdown` rather than `click`: the drag starts on pointerdown, so
      that is the event that has to be kept away from the grip.
    */
    for (const b of el.querySelectorAll('.pctl button, .pfold')) {
      b.addEventListener('pointerdown', (e) => { e.stopPropagation() })
    }

    /*
      Open and shut (#220).

      The height is not touched. A panel that came back from collapsed at some
      default height would have lost the size he chose, and the whole reason
      the arrangement is saved is that it stays arranged - so `h` is remembered
      through the fold and `panelChrome` draws a header's worth of height while
      the flag is set.
    */
    el.querySelector('[data-fold]')?.addEventListener('click', () => {
      panel.c = panel.c !== true
      put(panels); redraw()
    })

    /*
      Height, by dragging the bottom edge (#220).

      Not snapped to the 24px grid the way x and y are. Width snaps because a
      dashboard of arbitrary widths never lines up in three columns; height has
      no column of rows to line up with, and the right height for a panel is
      whatever makes its contents fit. A floor of 120px so a panel cannot be
      dragged into nothing, which is what Remove is for and is reversible.

      Saved on release rather than on every pointer move: a drag is one change
      of mind, not two hundred, and the RPC does not need to hear about each
      pixel of it.
    */
    const grow = el.querySelector('[data-taller]')
    let tall = null
    grow?.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      tall = { y: e.clientY, h: panel.h }
      grow.setPointerCapture(e.pointerId)
      el.classList.add('growing')
    })
    grow?.addEventListener('pointermove', (e) => {
      if (tall === null) return
      panel.h = Math.max(120, Math.round(tall.h + (e.clientY - tall.y)))
      el.style.height = `${panel.h}px`
    })
    const settle = () => {
      if (tall === null) return
      tall = null
      el.classList.remove('growing')
      put(panels)
      redraw()
    }
    grow?.addEventListener('pointerup', settle)
    grow?.addEventListener('pointercancel', settle)

    // Width by column, because a dashboard of arbitrary widths never lines up.
    el.querySelector('[data-wider]')?.addEventListener('click', () => {
      panel.w = Math.min(3, panel.w + 1)
      put(panels); redraw()
    })
    el.querySelector('[data-narrower]')?.addEventListener('click', () => {
      panel.w = Math.max(1, panel.w - 1)
      put(panels); redraw()
    })
    el.querySelector('[data-drop-panel]')?.addEventListener('click', () => {
      put(panels.filter((p) => p.id !== id)); redraw()
    })
  }
}
