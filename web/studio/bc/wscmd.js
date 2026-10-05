/*
  WORKSPACE COMMANDS IN PLAIN WORDS (HQ-CONV-001, HQ-CONV-002).

  Grant, 4 October 2026: "Make Documents bigger." "Move Calendar right." "Make Tasks blue." "Zoom out." "Hide Sources."
  "Save this as Planning." Lower priority than the buttons, and the requirement was that the SAME operations the buttons
  call are reachable from words, so a conversation can drive them later.

  This file is the bridge and it is deliberately small and boring:
    - `parse(text)` is PURE. It turns a sentence into a command object or null. No model, no layout state, nothing
      invented: a sentence that does not name a module (or a layout) it can resolve is not a command, and the caller
      offers nothing rather than guessing. That is the whole safety property - the palette never shows a row for a
      command it could not carry out, and never carries one out on a guess.
    - `run(grid, slug, cmd)` performs it through the layout engine's own exported operations (place, setTint, remove,
      add, setZoom, saveLayout, loadLayout, applyPreset, autoArrange, reset) - the functions the dock, the module
      controls and the palette's other actions already call. There is no second implementation of any of them.
    - `label(cmd)` is the sentence shown before it is pressed ("Make Documents bigger"), so a person sees what a press
      will do. Nothing here is destructive: nothing is deleted, and Reset View keeps Post-its (layout.js).

  What it deliberately does not understand: a module that is not one of the six on the page ("Hide Sources" names the
  Sources drawer, which is not a module, so it is not a command and is not offered), and anything ambiguous.
*/

const MODULES = {
  tasks: ['tasks', 'task', 'to-dos', 'to dos', 'todos', 'todo', 'to-do', 'to do', 'to do list'],
  board: ['card table', 'cardtable', 'board', 'cards', 'kanban'],
  documents: ['documents', 'document', 'docs & files', 'docs and files', 'docs', 'files'],
  schedule: ['schedule', 'calendar'],
  contacts: ['contacts', 'contact', 'people'],
  activity: ['latest activity', 'activity'],
}

const NAMES = {
  tasks: 'To-dos',
  board: 'Card Table',
  documents: 'Docs & Files',
  schedule: 'Schedule',
  contacts: 'Contacts',
  activity: 'Latest Activity',
}

/* The colour words a person uses, mapped onto the eleven curated tints (layout.js TINTS). */
const COLOURS = {
  slate: 'slate', grey: 'slate', gray: 'slate',
  sky: 'sky', blue: 'sky', 'light blue': 'sky',
  teal: 'teal', turquoise: 'teal', aqua: 'teal',
  mint: 'mint', green: 'mint',
  moss: 'moss', olive: 'moss', lime: 'moss',
  sand: 'sand', yellow: 'sand', beige: 'sand', gold: 'sand',
  amber: 'amber', orange: 'amber',
  coral: 'coral', red: 'coral',
  rose: 'rose', pink: 'rose',
  violet: 'violet', purple: 'violet',
  indigo: 'indigo', 'dark blue': 'indigo', navy: 'indigo',
}
const CLEAR = ['no colour', 'no color', 'no tint', 'plain', 'default', 'uncoloured', 'uncolored', 'normal']

const norm = (t) =>
  String(t ?? '')
    .toLowerCase()
    .replace(/[“”"‘’]/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/^(please|could you|can you|would you|i want you to|i'd like you to|go ahead and)\s+/g, '')
    .replace(/\s+please$/g, '')
    .replace(/\b(the|my|this|that)\s+(?=(module|panel|pane|section)\b)/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** The module a phrase names, longest alias first so "latest activity" is not read as "activity". */
const moduleIn = (phrase) => {
  const p = ` ${phrase.replace(/\b(the|my|this|that|module|panel|pane|section)\b/g, ' ').replace(/\s+/g, ' ').trim()} `
  let best = null
  for (const [id, aliases] of Object.entries(MODULES)) {
    for (const a of aliases) {
      if (p.includes(` ${a} `) && (best === null || a.length > best.len)) best = { id, len: a.length }
    }
  }
  return best === null ? null : best.id
}

const colourIn = (phrase) => {
  const p = phrase.trim()
  for (const c of CLEAR) if (p === c || p.endsWith(` ${c}`)) return { clear: true }
  let best = null
  for (const [word, tint] of Object.entries(COLOURS)) {
    if ((` ${p} `).includes(` ${word} `) && (best === null || word.length > best.len)) best = { tint, len: word.length }
  }
  return best === null ? null : { tint: best.tint }
}

const WIDER = ['wider', 'broader']
const NARROWER = ['narrower', 'thinner']
const TALLER = ['taller', 'higher', 'longer']
const SHORTER = ['shorter', 'lower']
const BIGGER = ['bigger', 'larger']
const SMALLER = ['smaller']

/**
 * A sentence as a command, or null.
 * Shapes: { op: 'resize', id, dw, dh } | { op: 'move', id, dx, dy } | { op: 'tint', id, tint } | { op: 'hide', id } |
 * { op: 'show', id } | { op: 'zoom', by } | { op: 'zoom_to', to } | { op: 'save', name } | { op: 'load', name } |
 * { op: 'tidy' } | { op: 'reset' }.
 */
export const parse = (text) => {
  const t = norm(text)
  if (t === '' || t.length > 90) return null

  /* whole-page operations */
  if (/^(tidy|tidy up|auto arrange|auto-arrange|tidy this page|tidy the page|tidy things up)$/.test(t)) return { op: 'tidy' }
  if (/^reset( the)?( page)?( view| layout)?$/.test(t) || /^reset view$/.test(t)) return { op: 'reset' }
  if (/^zoom in$/.test(t)) return { op: 'zoom', by: 1 }
  if (/^zoom out$/.test(t)) return { op: 'zoom', by: -1 }
  if (/^(reset zoom|zoom reset|zoom to 100%?|zoom 100%?|100% zoom)$/.test(t)) return { op: 'zoom_to', to: 1 }
  {
    const z = /^zoom( to)? (\d{2,3}) ?%?$/.exec(t)
    if (z !== null) {
      const pct = Number(z[2])
      return pct >= 50 && pct <= 150 ? { op: 'zoom_to', to: pct / 100 } : null
    }
  }
  {
    const s = /^save( this| the layout| this layout| the page| this page| it| the view)?( as| to| under| called| named)? ["']?([\w][\w &'-]{0,38})$/.exec(t)
    if (s !== null && s[2] !== undefined) return { op: 'save', name: s[3].trim() }
  }
  {
    const l = /^(?:switch to|load|use|go to|show|apply|open)( the)?( layout| preset| view)? ["']?([\w][\w &'-]{0,38}?)( layout| preset)?$/.exec(t)
    if (l !== null && (l[2] !== undefined || l[4] !== undefined)) return { op: 'load', name: l[3].trim() }
  }

  /* hide / show a module */
  {
    const h = /^(?:hide|remove|take off|take|close|get rid of)\s+(.+?)(?: off( this page| the page)?)?$/.exec(t)
    if (h !== null) {
      const id = moduleIn(h[1])
      if (id !== null) return { op: 'hide', id }
    }
    const s = /^(?:show|bring back|put back|unhide|restore|put)\s+(.+?)(?: back| again)?(?: on( this page| the page)?)?$/.exec(t)
    if (s !== null) {
      const id = moduleIn(s[1])
      if (id !== null) return { op: 'show', id }
    }
  }

  /* move */
  {
    const m = /^(?:move|shift|push|nudge)\s+(.+?)\s+(?:to the\s+)?(left|right|up|down)(?: a (?:bit|little))?$/.exec(t)
    if (m !== null) {
      const id = moduleIn(m[1])
      if (id !== null) {
        const dir = m[2]
        return { op: 'move', id, dx: dir === 'left' ? -1 : dir === 'right' ? 1 : 0, dy: dir === 'up' ? -1 : dir === 'down' ? 1 : 0 }
      }
    }
  }

  /* resize: "make X bigger", "X wider", "make X a bit smaller" */
  {
    const r = /^(?:make|let)?\s*(.+?)\s+(?:a (?:bit|little) |much |a lot |slightly )?(bigger|larger|smaller|wider|broader|narrower|thinner|taller|higher|longer|shorter|lower)$/.exec(t)
    if (r !== null) {
      const id = moduleIn(r[1])
      const w = r[2]
      if (id !== null) {
        const f = /much|a lot/.test(t) ? 0.4 : /bit|little|slightly/.test(t) ? 0.1 : 0.25
        if (BIGGER.includes(w)) return { op: 'resize', id, dw: f, dh: f }
        if (SMALLER.includes(w)) return { op: 'resize', id, dw: -f, dh: -f }
        if (WIDER.includes(w)) return { op: 'resize', id, dw: f, dh: 0 }
        if (NARROWER.includes(w)) return { op: 'resize', id, dw: -f, dh: 0 }
        if (TALLER.includes(w)) return { op: 'resize', id, dw: 0, dh: f }
        if (SHORTER.includes(w)) return { op: 'resize', id, dw: 0, dh: -f }
      }
    }
  }

  /* tint: "make Tasks blue", "colour the card table green", "tint the calendar green", "Tasks blue", "make tasks plain".
     Every split of the sentence is tried, because a module's name can be several words and a lazy pattern stops at the
     first split that matches the SHAPE, not the one that names a module and a colour. */
  {
    const body = t.replace(/^(?:make|colou?r|tint|paint|turn|set)\s+/, '')
    const words = body.split(' ')
    for (let i = 1; i < words.length; i += 1) {
      const id = moduleIn(words.slice(0, i).join(' '))
      if (id === null) continue
      const col = colourIn(words.slice(i).join(' ').replace(/^(?:to |the colou?r |colou?r to |tint to )/, ''))
      if (col !== null) return col.clear === true ? { op: 'tint', id, tint: null } : { op: 'tint', id, tint: col.tint }
    }
  }
  return null
}

/** The sentence shown before it is pressed. */
export const label = (c) => {
  const n = NAMES[c.id] ?? c.id
  switch (c.op) {
    case 'resize': {
      const w = c.dw > 0 && c.dh > 0 ? 'bigger' : c.dw < 0 && c.dh < 0 ? 'smaller' : c.dw > 0 ? 'wider' : c.dw < 0 ? 'narrower' : c.dh > 0 ? 'taller' : 'shorter'
      return `Make ${n} ${w}`
    }
    case 'move':
      return `Move ${n} ${c.dx < 0 ? 'left' : c.dx > 0 ? 'right' : c.dy < 0 ? 'up' : 'down'}`
    case 'tint':
      return c.tint === null ? `Clear the colour of ${n}` : `Make ${n} ${c.tint}`
    case 'hide':
      return `Hide ${n}`
    case 'show':
      return `Show ${n}`
    case 'zoom':
      return c.by > 0 ? 'Zoom in' : 'Zoom out'
    case 'zoom_to':
      return `Zoom to ${String(Math.round(c.to * 100))}%`
    case 'save':
      return `Save this layout as ${c.name}`
    case 'load':
      return `Switch to the ${c.name} layout`
    case 'tidy':
      return 'Tidy this page'
    default:
      return 'Reset the view'
  }
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase()

/**
 * Carry a command out through the layout engine's own operations. Returns what was done, in a sentence, or the reason
 * nothing was ("There is no layout called X"), so a caller can say so.
 */
export const run = (grid, slug, c) => {
  const find = (id) => grid.layout(slug).find((m) => m.id === id)
  switch (c.op) {
    case 'resize': {
      const m = find(c.id)
      if (m === undefined) return { ok: false, said: `${NAMES[c.id]} is not on this page. Put it back first.` }
      const st = grid.stageSize()
      const w = Math.max(grid.MIN.w, Math.min(st.w, Math.round(m.w * (1 + c.dw))))
      const h = Math.max(grid.MIN.h, Math.min(st.h, Math.round(m.h * (1 + c.dh))))
      grid.place(slug, c.id, { x: Math.round(m.x - (w - m.w) / 2), y: Math.round(m.y - (h - m.h) / 2), w, h })
      return { ok: true, said: label(c) }
    }
    case 'move': {
      const m = find(c.id)
      if (m === undefined) return { ok: false, said: `${NAMES[c.id]} is not on this page. Put it back first.` }
      const st = grid.stageSize()
      grid.place(slug, c.id, { x: Math.round(m.x + c.dx * st.w * 0.15), y: Math.round(m.y + c.dy * st.h * 0.15) })
      return { ok: true, said: label(c) }
    }
    case 'tint':
      if (find(c.id) === undefined) return { ok: false, said: `${NAMES[c.id]} is not on this page. Put it back first.` }
      return grid.setTint(slug, c.id, c.tint) ? { ok: true, said: label(c) } : { ok: false, said: 'That colour is not one Team HQ offers.' }
    case 'hide':
      if (find(c.id) === undefined) return { ok: false, said: `${NAMES[c.id]} is already off this page.` }
      grid.remove(slug, c.id)
      return { ok: true, said: `${label(c)}. Nothing in it is deleted; "Show ${NAMES[c.id]}" brings it back.` }
    case 'show':
      if (find(c.id) !== undefined) return { ok: false, said: `${NAMES[c.id]} is already on this page.` }
      grid.add(slug, c.id)
      return { ok: true, said: label(c) }
    case 'zoom':
      grid.setZoom(slug, grid.zoomOf(slug) + c.by * grid.ZOOM.step)
      return { ok: true, said: label(c) }
    case 'zoom_to':
      grid.setZoom(slug, c.to)
      return { ok: true, said: label(c) }
    case 'save': {
      const name = grid.saveLayout(slug, c.name)
      return name === '' ? { ok: false, said: 'A layout needs a name.' } : { ok: true, said: `Saved this layout as ${name}` }
    }
    case 'load': {
      const saved = grid.layoutNames(slug).find((n) => sameName(n, c.name))
      if (saved !== undefined && grid.loadLayout(slug, saved)) return { ok: true, said: `Switched to ${saved}` }
      const key = Object.keys(grid.PRESETS).find((k) => sameName(k, c.name) || sameName(grid.PRESETS[k].name, c.name))
      if (key !== undefined && grid.applyPreset(slug, key)) return { ok: true, said: `Switched to ${grid.PRESETS[key].name}` }
      return { ok: false, said: `There is no layout called ${c.name}.` }
    }
    case 'tidy':
      grid.autoArrange(slug)
      return { ok: true, said: 'Tidied this page' }
    default:
      grid.reset(slug)
      return { ok: true, said: 'Reset the view. Your notes and everything in the modules are kept.' }
  }
}
