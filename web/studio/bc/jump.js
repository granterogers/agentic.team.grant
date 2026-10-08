/*
  THE COMMAND PALETTE (Cmd+K on a Mac, Ctrl+K elsewhere).

  8 October 2026, Grant: remove Jump To. The "Jump to..." control in the top bar and its Shift+J shortcut are gone, and
  the hamburger menu (bc/menu.js) is how a person moves between projects. This file keeps the OTHER thing that shared
  its dialog: the command palette, which finds records and DOES things (workspace commands in plain words, "Ask the
  team: ..."), and which Grant asked for separately. It no longer has a visible button of its own. The file name, the
  bcjump ids and the group names below are history and are kept so the palette's tests and wiring stay one thing.

  Universal Jump (§7 of basecamp_clone.md), as it was.

  Opened by clicking the centre shell control or by pressing Shift+J anywhere
  outside a text composition context. Filters projects, project tools, people
  and direct product destinations as you type; Shift+Enter promotes the query
  into full search; Escape closes and returns focus to whatever opened it.

  ## Why the candidate list is built once

  The renderer and the keyboard both need the same rows in the same order. Two
  assemblies is two lists that will disagree the day one of them gains a group,
  and the command bar in the default studio already carries a comment warning
  about exactly that. `candidates()` is the only place rows are made; the
  renderer draws what it returns and the keyboard indexes into the same array.

  ## Focus

  §7.1 and §11.2 require a trap, a labelled title, an explicit close and a
  restore. The trap is a Tab handler over the sheet's own focusables rather
  than an inert-attribute dance, because the sheet is a sibling of #root and
  the shell behind it is replaced on every paint.
*/

import { PROJECTS } from '../data.js'
import * as cal from './calendar.js'
import * as grid from './layout.js'
import { esc } from './parts.js'
import * as todos from './todos.js'
import * as wscmd from './wscmd.js'

let ctx = null
let open = false
let query = ''
let picked = 0
let invoker = null
let rows = []

export const mount = (c) => {
  ctx = c
}
export const isOpen = () => open
/** Redraw the rows when something they depend on has arrived (the office's search answer). */
export const refresh = () => {
  if (open) draw()
}

// Team HQ's addresses are the site's own (#382).
const at = (p = '') => (p === '' ? '/' : p)

/**
 * Everything Jump can reach, filtered by the query.
 *
 * Direct destinations first when the query is empty, because an empty Jump is
 * a navigator rather than a search box; once there is a query, relevance
 * decides and the groups keep their labels so a result is never ambiguous
 * about what kind of thing it is.
 */
const candidates = () => {
  const q = query.trim().toLowerCase()
  const out = []

  const push = (group, name, to, kind, hay) => {
    if (q !== '' && !String(hay ?? name).toLowerCase().includes(q)) return
    out.push({ group, name, to, kind })
  }

  for (const p of PROJECTS) {
    if (p.slug === 'unnamed') continue
    push('Projects', p.name, at(`/p/${p.slug}`), 'Project', `${p.name} ${p.purpose ?? ''}`)
  }

  /*
    Tools are offered for the project you are IN, not for all of them at once.
    Nine tools times a dozen projects is a list nobody can read, and the
    project you are looking at is overwhelmingly the one you mean.
  */
  const here = PROJECTS.find((p) => p.slug === ctx?.state?.project)
  if (here !== undefined) {
    for (const t of ctx.tools) {
      push(
        `In ${here.name}`,
        t.name,
        t.own ? at(`/p/${here.slug}/${t.id}`) : `/p/${here.slug}/${t.id}`,
        t.own ? 'Tool' : 'Opens current HQ',
        `${t.name} ${t.id === 'schedule' ? 'calendar events' : ''} ${t.id === 'documents' ? 'files docs' : ''}`,
      )
    }
  }

  /*
    DIRECT DESTINATIONS BEFORE PEOPLE.

    An empty Jump listed three projects, then eight specialists, then the
    places — so the four things somebody opens Jump to reach were below the
    fold of a 495px sheet, behind eight rows that were not destinations at
    all. §7.1 lists places among what Jump offers; it does not say to bury
    them.
  */
  /*
    ACTIONS. The palette finds things AND does things. Each action is a row with
    a `run`, built from the same functions the buttons call (the workspace
    operations in layout.js, the calendar's editor), so the palette is another
    way to press a control and not a second implementation of it. Offered for the
    project you are in, and only when there is one.
  */
  if (here !== undefined) {
    const slug = here.slug
    const home = () => {
      if (ctx.state.tab !== 'overview' || ctx.state.view !== 'project') ctx.goAnywhere(at(`/p/${slug}`))
    }
    const act = (name, kind, hay, run) => {
      const words = q.split(/\s+/).filter(Boolean)
      const text = `${name} ${hay ?? ''}`.toLowerCase()
      if (!words.every((w) => text.includes(w))) return
      out.push({ group: 'Do', name, kind, run })
    }
    /*
      WORKSPACE COMMANDS IN WORDS ("Make Documents bigger", "Zoom out", "Save this as Planning"). Offered only when the
      sentence parses to something this page can carry out; the row says what pressing it will do. The same layout
      functions as every button below (wscmd.js), so there is one implementation of each.
    */
    const wc = wscmd.parse(query)
    if (wc !== null) {
      out.push({
        group: 'Do',
        name: wscmd.label(wc),
        kind: 'Workspace',
        run: () => {
          home()
          wscmd.run(grid, slug, wc)
          ctx.render()
        },
      })
    }
    /*
      ADD A TO-DO IN ONE STEP. "add task call the venue" creates the to-do and then opens the To-dos so the person SEES
      it. Needs the lead word on purpose: a bare phrase typed to search must never create anything. Without an office
      it goes to the preview's own list exactly as the form does (todos.addLocal), and says so by showing it there.
    */
    const made = /^(?:add|new|create)\s+(?:a\s+|an\s+)?(?:to-?do|task)\s*[:\-]?\s*(.{3,120})$/i.exec(query.trim()) ?? /^(?:todo|to-do|task)\s*[:\-]\s*(.{3,120})$/i.exec(query.trim())
    if (made !== null) {
      const title = made[1].trim()
      out.push({
        group: 'Do',
        name: `Add to-do: ${title}`,
        kind: todos.canWrite() ? 'Creates it now' : 'Preview only: not saved to the office',
        run: () => {
          void (async () => {
            try {
              if (todos.canWrite()) await todos.add({ project: slug, title })
              else todos.addLocal(slug, { title, list: 'loose', due: '', assignee: '' })
            } catch {
              /* the To-dos screen opens either way and shows what exists */
            }
            ctx.goAnywhere(at(`/p/${slug}/tasks`))
            ctx.render()
          })()
        },
      })
    }
    act('New to-do', 'Action', 'new add create task to-do todo', () => {
      ctx.goAnywhere(at(`/p/${slug}/tasks`))
    })
    act('New event', 'Action', 'new add create event calendar meeting', () => {
      cal.newEvent(slug)
    })
    act('New Post-it note', 'Action', 'new add create note post-it sticky', () => {
      grid.addPostit(slug)
      home()
      ctx.render()
    })
    act('Tidy this page', 'Layout', 'tidy auto arrange layout', () => {
      home()
      grid.autoArrange(slug)
      ctx.render()
    })
    act('Reset the view', 'Layout', 'reset view layout default', () => {
      home()
      grid.reset(slug)
      ctx.render()
    })
    for (const [id, p] of Object.entries(grid.PRESETS)) {
      act(`Layout: ${p.name}`, 'Layout', `layout preset ${p.name}`, () => {
        home()
        grid.applyPreset(slug, id)
        ctx.render()
      })
    }
    for (const name of grid.layoutNames(slug)) {
      act(`Layout: ${name}`, 'Saved layout', `layout saved ${name}`, () => {
        home()
        grid.loadLayout(slug, name)
        ctx.render()
      })
    }
    for (const [name, delta] of [['Zoom in', grid.ZOOM.step], ['Zoom out', -grid.ZOOM.step]]) {
      act(name, 'Layout', `zoom ${name}`, () => {
        home()
        grid.setZoom(slug, grid.zoomOf(slug) + delta)
        ctx.render()
      })
    }
    act('Zoom to 100%', 'Layout', 'zoom reset 100', () => {
      home()
      grid.setZoom(slug, 1)
      ctx.render()
    })
  }

  /* FIND: what the query matches inside the projects, through the page's own search. */
  if (q.length >= 2 && ctx.find !== undefined) {
    for (const h of ctx.find(query).slice(0, 8)) {
      out.push({ group: 'Found', name: h.title, kind: [h.kind, h.project].filter(Boolean).join(' · '), to: h.to, open: h.open })
    }
  }

  push('Go to', 'Home', at('/'), 'Place', 'home projects')
  push('Go to', 'My Tasks', at('/tasks'), 'Place', 'my tasks personal')
  push('Go to', 'Activity', at('/activity'), 'Place', 'activity recent')
  push('Go to', 'Search everything', at('/search'), 'Place', 'search find everything')
  // No entry leaves Team HQ for the older studio any more (#382).

  /*
    A PERSON GOES WHERE THAT PERSON IS, and is not offered when that is
    nowhere.

    Every specialist row used to navigate to `at('/')` — so Jump offered
    eight results reading "Claire · Chief of Staff" and every one of them
    dropped you on the projects list. A destination that is plausible and
    wrong is worse than one that is missing: you press it, you arrive
    somewhere real, and you conclude the search is broken rather than the
    link. It is the same defect the Activity tool had, in the one surface
    built entirely out of destinations.

    Where somebody appears on a project, the honest destination is that
    project's team surface. Where they appear on none, they are not a place
    and Jump does not pretend otherwise.
  */
  for (const c of ctx.crew ?? []) {
    const on = PROJECTS.find((p2) => (ctx.crewFor?.(p2.slug) ?? []).some((x) => x.slug === c.slug))
    if (on === undefined) continue
    push('People', c.name, at(`/p/${on.slug}/team`), `${c.role ?? 'Person'} · ${on.name}`, `${c.name} ${c.role ?? ''}`)
  }

  /*
    ASKING THE TEAM IS LAST, never the default. Enter on a row sends what was
    typed to the team as a message, so the row that does that must not be the one
    that is selected when somebody has merely typed a word to look for it.
  */
  const ask = query.trim()
  if (here !== undefined && ask.length >= 3 && ctx.chatSend !== undefined) {
    out.push({
      group: 'Ask',
      name: `Ask the team: ${ask}`,
      kind: 'Sends this to the team',
      run: () => {
        /*
          WHAT THE SEND BUTTON DOES, in the same three steps: put the words on screen, repaint both the page and the
          dock, and ASK THE OFFICE. This row used to call chatSend alone, so the message was stored and nothing was
          ever asked (found by pressing it in scripts/verify/palette.ts).
        */
        ctx.openDock?.()
        const redraw = () => {
          ctx.render?.()
          ctx.repaintDock?.()
        }
        ctx.chatSend(here.slug, ask)
        redraw()
        void Promise.resolve(ctx.chatAsk?.(here.slug, ask, redraw)).then(redraw)
      },
    })
  }

  return out
}


const draw = () => {
  const el = document.getElementById('bcjump')
  if (el === null) return
  rows = candidates()
  if (picked >= rows.length) picked = Math.max(0, rows.length - 1)

  let last = null
  const list = rows
    .map((r, i) => {
      const head = r.group === last ? '' : `<div class="bcjumpgroup">${esc(r.group)}</div>`
      last = r.group
      return `${head}<button type="button" class="bcjumprow" role="option" id="bcjr${String(i)}"
        aria-selected="${i === picked ? 'true' : 'false'}" data-bc-jumpi="${String(i)}">
        <span>${esc(r.name)}</span><span class="bckind">${esc(r.kind)}</span>
      </button>`
    })
    .join('')

  el.innerHTML = `<div class="bcjumphead">
      <label class="bclabel" for="bcjumpq" id="bcjumptitle">Find something, or do something</label>
      <input class="bcinput" id="bcjumpq" autocomplete="off" role="combobox"
        aria-expanded="true" aria-controls="bcjumplist" aria-autocomplete="list"
        ${rows.length > 0 ? `aria-activedescendant="bcjr${String(picked)}"` : ''}
        value="${esc(query)}" placeholder="Search everything, or type an action">
    </div>
    <div class="bcjumpresults" id="bcjumplist" role="listbox" aria-labelledby="bcjumptitle">
      ${
        rows.length === 0
          ? `<div class="bcjumpempty">Nothing matches that. Shift+Enter searches everything.</div>`
          : list
      }
    </div>`

  const box = el.querySelector('#bcjumpq')
  if (box !== null) {
    box.addEventListener('input', () => {
      query = box.value
      picked = 0
      draw()
    })
    box.focus()
    box.setSelectionRange(query.length, query.length)
  }
  for (const b of el.querySelectorAll('[data-bc-jumpi]')) {
    b.addEventListener('click', () => {
      choose(Number(b.dataset.bcJumpi))
    })
  }
  const sel = el.querySelector('[aria-selected="true"]')
  if (sel !== null) sel.scrollIntoView({ block: 'nearest' })
}

const choose = (i) => {
  const r = rows[i]
  if (r === undefined) return
  const { to, run, open: record } = r
  close()
  if (run !== undefined) {
    run()
    return
  }
  ctx.goAnywhere(to)
  if (record !== undefined) {
    /* Once the page has arrived, open the very record that was found. */
    globalThis.setTimeout(() => {
      if (record.type === 'doc') ctx.openDocDetail?.(record.ref, record.title)
      else if (record.type === 'task') ctx.openTask?.(record.key)
      else if (record.type === 'event') cal.openEvent(record.slug, record.id)
    }, 60)
  }
}

export const show = (from = null) => {
  if (open) return
  open = true
  query = ''
  picked = 0
  /*
    WHO TO GIVE FOCUS BACK TO, which is not always who opened it.

    §7.1 says focus returns to the invoker. Opened from the shortcut there is
    no invoker: `document.activeElement` is the body, because nothing in the
    shell had focus when Shift+J was pressed. Restoring to the body sends a
    keyboard user back to the top of the document after every Escape, with
    nothing anywhere reporting a fault — the shape #147 already records about
    a redraw taking focus with it.

    So the fallback is the control the sheet visually comes out of, which is
    where a person would expect to be standing when it closes.
  */
  const active = document.activeElement
  const real = active instanceof HTMLElement && active !== document.body ? active : null
  invoker = from ?? real ?? document.querySelector('[data-bc-jump]')

  const scrim = document.createElement('div')
  scrim.className = 'bcscrim'
  scrim.id = 'bcscrim'
  scrim.addEventListener('click', close)

  const sheet = document.createElement('div')
  sheet.className = 'bcsheet'
  sheet.id = 'bcjump'
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.setAttribute('aria-labelledby', 'bcjumptitle')

  document.body.append(scrim, sheet)
  draw()
}

export const close = () => {
  if (!open) return
  open = false
  document.getElementById('bcscrim')?.remove()
  document.getElementById('bcjump')?.remove()
  // §7.1: focus returns to the invoker. A sheet that drops focus on the body
  // sends a keyboard user back to the top of the document.
  if (invoker !== null && document.contains(invoker)) invoker.focus()
  invoker = null
}

/**
 * Whether a key event is happening inside text composition.
 *
 * §7.1 and §7.3: the shortcut must not fire while an editor has focus, or
 * typing a capital J into a message opens a dialog over what you are writing.
 * contentEditable is included because the rich-text editor is not an input.
 */
export const composing = (target) => {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

/**
 * Cmd+K on a Mac, Ctrl+K elsewhere. On a Mac Ctrl+K is "delete to end of line" in a text field, so Ctrl does not open the
 * palette there; the browser's own platform answer decides, and a missing one counts as not a Mac.
 */
const isMac = () => /Mac|iPhone|iPad/i.test(globalThis.navigator?.platform ?? '')
const paletteChord = (e) =>
  (e.metaKey || (e.ctrlKey && !isMac())) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k'

/** The keyboard map of §7.3, plus the global Shift+J of §7.1. */
export const onKey = (e) => {
  if (!open) {
    /* Cmd+K on a Mac, Ctrl+K elsewhere: from anywhere, including inside a text field, as a palette is. */
    if (paletteChord(e)) {
      e.preventDefault()
      show()
    }
    return
  }
  if (paletteChord(e)) {
    e.preventDefault()
    close()
    return
  }

  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    picked = rows.length === 0 ? 0 : (picked + 1) % rows.length
    draw()
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    picked = rows.length === 0 ? 0 : (picked - 1 + rows.length) % rows.length
    draw()
    return
  }
  if (e.key === 'Home') {
    e.preventDefault()
    picked = 0
    draw()
    return
  }
  if (e.key === 'End') {
    e.preventDefault()
    picked = Math.max(0, rows.length - 1)
    draw()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    // §7.3: Shift+Enter promotes the typed text into full search rather than
    // opening whatever happens to be selected.
    if (e.shiftKey) {
      const q = query
      close()
      ctx.fullSearch(q)
      return
    }
    choose(picked)
    return
  }
  if (e.key === 'Tab') {
    /*
      §11.2 focus trap. The sheet's focusables are the query box and the result
      rows; wrapping at both ends keeps Tab inside the dialog without making it
      unusable, which is what a naive preventDefault would do.
    */
    const sheet = document.getElementById('bcjump')
    if (sheet === null) return
    const focusable = [...sheet.querySelectorAll('input,button')].filter((n) => !n.disabled)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}
