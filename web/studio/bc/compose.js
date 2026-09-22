/*
  §21 — two materially different project-home compositions, built so they can
  be captured, compared and one of them chosen.

  This exists because the fix for §20 is not six better tiles: it is a
  different composition. Addressing the seventeen discrepancies one at a time
  inside the three-column equal-weight grid would be building against the
  layout that is being corrected.

  Both compositions render the SAME miniatures from the SAME real records. The
  grammars are not the experiment — §4 to §12 require them either way. The
  arrangement is the experiment, and the two arrangements differ structurally:

    A  THE BRIEFING. One column at the text measure, weighted top to bottom.
       The dominant tool is full width; two secondary tools share a row;
       activity closes the page as a full-width spine. Reads as a document
       about the project. The same order on a phone as on a desktop, so there
       is one thing to learn.

    B  THE WORKSPACE. Asymmetric two columns. The tools stack full width in
       the main column; a companion rail holds the things that are true of the
       project rather than of one tool — who is here, what was said, what has
       happened. The rail is persistent at desktop, so presence is never
       scrolled away. On a phone the rail breaks up and its parts are placed
       by §18's priority rather than kept together.

  Neither is the reference slice with better spacing, which is what "two
  experiments" would have meant if I had let it.

  How to see them: this is chosen per viewer, in localStorage, under
  `bc.compose`. Not a URL, because `keepUrl()` discards the query string and a
  path segment would mean teaching the router about an experiment that is
  meant to be deleted. Wrapped in try/catch and defaulting to the current
  build, because storage throws in a private window and a composition
  experiment must not be able to take the page down.

  A NOTE ON COMMENTS. Plain words only inside a returned template literal.
*/

import { button, esc } from './parts.js'
import {
  calendarMini,
  cardsMini,
  chatMini,
  contactsMini,
  crewMini,
  docsMini,
  face,
  sourcesMini,
  stateLine,
  timelineMini,
  todosMini,
} from './miniatures.js'

let ctx = null
export const mount = (c) => {
  ctx = c
}

const at = (p = '') => `/basecamp${p}`

/*
  A module that IS a tool takes the TOOL's name, from the one list `shell.js`
  keeps. The derived views - the board, the schedule - keep their own words,
  because they are not the tool: three miniatures come out of one to-do list
  and calling all three "To-dos" would say less, not more.
*/
const toolName = (id, fallback) =>
  (ctx?.tools ?? []).find((t) => t.id === id)?.name ?? fallback

/**
 * Which composition this viewer is looking at.
 *
 * B IS THE PROJECT HOME NOW - §21 chose it and the evidence is in the ledger.
 * The other two are kept reachable rather than deleted, because the comparison
 * is the argument: `bc.compose` set to `a` gives the briefing, and `grid`
 * gives the equal-weight build §20 is about, which is the single clearest
 * statement of what changed. Anything else, including nothing, is B.
 */
export const chosen = () => {
  try {
    const v = globalThis.localStorage?.getItem('bc.compose') ?? ''
    if (v === 'grid' || v === 'a' || v === 'b') return v
    return 'c'
  } catch {
    return 'c'
  }
}

export const choose = (v) => {
  try {
    globalThis.localStorage?.setItem('bc.compose', ['a', 'b', 'grid'].includes(v) ? v : 'c')
  } catch {
    /* A viewer who cannot store a preference still gets the chosen home. */
  }
}

/**
 * A module of the project home.
 *
 * §5's two-level pattern: the heading is the way to the full tool and the body
 * is the tool in miniature. The heading is the only navigation — the body is
 * content, and pressing content does what the content says rather than
 * navigating somewhere plausible.
 */
const mod = (p, { id, name, body, wide = false, slot = '' }) =>
  `<section class="bcmod${wide ? ' bcmod--wide' : ''}" data-mod="${esc(id)}" data-slot="${esc(slot === '' ? id : slot)}">
    <header class="bcmodhead">
      <h2><a href="${esc(at(`/p/${p.slug}/${id}`))}" data-bc-go="${esc(at(`/p/${p.slug}/${id}`))}">${esc(name)}</a></h2>
    </header>
    <div class="bcmodbody">${body}</div>
  </section>`

/**
 * The project's own head.
 *
 * §16: the project dominates. The name is the largest thing on the page, the
 * people on it are faces rather than a comma-separated list, and the state
 * line sits directly under the name because it is the answer to the question
 * §2 says this page exists to answer.
 */
const head = (p) => {
  const crew = (ctx?.crewFor?.(p.slug) ?? []).slice(0, 6)
  return `<header class="bchead">
    <div class="bcheadtop">
      <h1>${esc(p.name)}</h1>
      <span class="bcpresence">${crew.map((c) => face(c)).join('')}</span>
    </div>
    ${p.purpose ? `<p class="bcheadwhy">${esc(p.purpose)}</p>` : ''}
    <div class="bcheadrow">
      ${stateLine(p)}
      <span class="bcheadacts">
        ${button('Talk to the team', { kind: 'primary', 'data-bc-dock': '1' })}
        ${button('Change this page', { 'data-bc-arrange': '1' })}
      </span>
    </div>
  </header>`
}


/**
 * The tools this experience has not built its own surface for.
 *
 * Quiet, at the foot of the home, and NOT omitted: a home that silently drops
 * a tool makes work that is reachable today unreachable, which the route audit
 * caught within a run of composition B shipping without Contacts, Sources or
 * the way to Project Settings. Whether a tool has a surface here is this
 * experiment's business; whether Grant can get to his own project's settings
 * is not.
 */
const elsewhere = (p) => {
  const others = (ctx?.tools ?? []).filter((t) => t.own !== true)
  if (others.length === 0) return ''
  return `<section class="bcmod bcmod--quiet" data-mod="elsewhere" data-slot="elsewhere">
    <header class="bcmodhead"><h2>Elsewhere on this project</h2></header>
    <div class="bcmodbody">
      <p class="bcmpty">These open in the current Team HQ. Nothing has moved.</p>
      <div class="bcinline-list">
        ${others
          .map(
            (t) =>
              `<a href="${esc(`/p/${p.slug}/${t.id}`)}" data-bc-leave="${esc(`/p/${p.slug}/${t.id}`)}">${esc(t.name)}</a>`,
          )
          .join('')}
      </div>
    </div>
  </section>`
}


/* ======================================================================== *
 * §14 — adding, removing and reordering the tools on the home
 *
 * WHERE THIS IS KEPT, AND WHY IT IS NOT THE OFFICE YET.
 *
 * Grant was explicit about arrangements, and 0250 quotes him: *"Layout is per
 * person, per dashboard project, and persists. Not `localStorage`: he uses
 * more than one device and the whole point of arranging it is that it stays
 * arranged."* He is right, and this does not yet obey him.
 *
 * `public.dashboard_layouts` is keyed `(owner, project_id)` - ONE arrangement
 * per project - and `web/studio/panels.js` already owns that row for the
 * default Team HQ's board. The two vocabularies only partly overlap and the
 * stored array IS the whole arrangement, so writing this one there would
 * silently remove panels from his real dashboard. `hq_dashboard_layout_set`
 * takes no owner, so there is no namespace to escape into either.
 *
 * So it is kept on this device, and the panel SAYS it is kept on this device,
 * with the reason. A limitation stated on screen is a different thing from a
 * limitation discovered on the second laptop. Issue #299 carries the one
 * change that fixes it, and when it lands `save` gains a call and this comment
 * loses four paragraphs.
 *
 * REMOVING A TOOL CANNOT REMOVE ANYTHING ELSE. The whole mechanism is a list
 * of module ids. There is no delete path here to reach, by construction rather
 * than by care - which is §14's actual requirement and the reason it is a list
 * of ids and not a list of records.
 */

const ALL = [
  'tasks',
  'board',
  'documents',
  'schedule',
  'chat',
  'team',
  'contacts',
  'sources',
]

const KEY = (slug) => `bc.home.${slug}`

export const arrangement = (slug) => {
  const s = typeof slug === 'string' ? slug : (slug?.slug ?? '')
  try {
    const raw = globalThis.localStorage?.getItem(KEY(s)) ?? ''
    if (raw === '') return [...ALL]
    const ids = JSON.parse(raw)
    if (!Array.isArray(ids)) return [...ALL]
    /*
      Filtered against ALL on the way OUT, not on the way in. A stored id for a
      tool that has since been removed would otherwise render nothing and take
      its place in the grid - a hole where a pane should be, which is what the
      shipped grid did when two tools arrived with no tile.
    */
    const kept = ids.filter((x) => ALL.includes(x))
    return kept.length === 0 ? [...ALL] : kept
  } catch {
    return [...ALL]
  }
}

export const arrange = (slug, ids) => {
  try {
    globalThis.localStorage?.setItem(KEY(slug), JSON.stringify(ids.filter((x) => ALL.includes(x))))
  } catch {
    /* A viewer who cannot store it still gets the default arrangement. */
  }
}

export const arrangeReset = (slug) => {
  try {
    globalThis.localStorage?.removeItem(KEY(slug))
  } catch {
    /* Already the default. */
  }
}

const NAMES = {
  tasks: 'To-dos',
  board: 'Card Table',
  documents: 'Docs & Files',
  schedule: 'Schedule',
  chat: 'Chat',
  team: 'The team',
  contacts: 'People',
  sources: 'Where the material comes from',
}

/** The panel that changes the home, opened from the head. */
const arrangePanel = (p) => {
  const on = arrangement(p.slug)
  const off = ALL.filter((id) => !on.includes(id))
  return `<section class="bcarrange" data-bc-arrange-panel hidden>
    <header class="bcmodhead"><h2>What is on this page</h2></header>
    <ol class="bcarrlist">
      ${on
        .map(
          (id, i) => `<li class="bcarrrow">
            <span class="bcarrname">${esc(NAMES[id] ?? id)}</span>
            <span class="bcarract">
              ${button('Up', { 'data-bc-arr-up': esc(id), disabled: i === 0 })}
              ${button('Down', { 'data-bc-arr-down': esc(id), disabled: i === on.length - 1 })}
              ${button('Remove', { 'data-bc-arr-off': esc(id) })}
            </span>
          </li>`,
        )
        .join('')}
    </ol>
    ${
      off.length === 0
        ? ''
        : `<div class="bcarradd">
            <span class="bclabel">Put back</span>
            ${off.map((id) => button(NAMES[id] ?? id, { 'data-bc-arr-on': esc(id) })).join('')}
          </div>`
    }
    <p class="bcarrnote">
      Removing a tool takes it off this page and nothing else — the to-dos,
      documents and messages behind it are untouched, because all this changes
      is a list of names.
      <br>
      Kept on this device for now. It cannot be kept in your office yet: a
      project holds one arrangement and your current dashboard already uses it,
      so saving this there would take panels off that. Issue 299 has the fix.
    </p>
    <div class="bcrow">
      ${button('Put it back the way it was', { 'data-bc-arr-reset': '1' })}
      ${button('Done', { kind: 'primary', 'data-bc-arr-close': '1' })}
    </div>
  </section>`
}

/* ======================================================================== *
 * A — the briefing
 * ======================================================================== */

export const compositionA = (p) => `<div class="bchome bccomp bccomp--a">
    ${head(p)}
    ${mod(p, { id: 'tasks', name: toolName('tasks', 'To-dos'), body: todosMini(p, { lists: 3, per: 4 }), wide: true })}
    <div class="bcpair">
      ${mod(p, { id: 'schedule', name: toolName('schedule', 'Schedule'), body: calendarMini(p, { items: 4 }) })}
      ${mod(p, { id: 'board', name: 'Where the work is', body: cardsMini(p) })}
    </div>
    ${mod(p, {
      id: 'team',
      name: 'The team',
      /*
        A composes presence and speech into ONE block, because a briefing
        reads better with the room and what was said in it together. B keeps
        them apart in the rail. That is a compositional difference rather than
        a cosmetic one, and it is one of the things the comparison decides.
      */
      body: `${crewMini(p, { people: 4 })}${chatMini(p, { lines: 3 })}`,
      wide: true,
    })}
    ${mod(p, { id: 'documents', name: toolName('documents', 'Documents'), body: docsMini(p, { items: 4 }), wide: true })}
    <div class="bcpair">
      ${mod(p, { id: 'contacts', name: toolName('contacts', 'People'), body: contactsMini(p, { items: 3 }) })}
      ${mod(p, { id: 'sources', name: 'Where the material comes from', body: sourcesMini(p, { items: 3 }) })}
    </div>
    ${mod(p, { id: 'activity', name: 'What has happened', body: timelineMini(p, { items: 6 }), wide: true })}
    ${elsewhere(p)}
  </div>`

/* ======================================================================== *
 * B — the workspace
 * ======================================================================== */

export const compositionB = (p) => `<div class="bchome bccomp bccomp--b">
    ${head(p)}
    <div class="bcwork">
      <div class="bcworkmain">
        ${mod(p, { id: 'tasks', name: toolName('tasks', 'To-dos'), body: todosMini(p, { lists: 3, per: 4 }) })}
        ${mod(p, { id: 'board', name: 'Where the work is', body: cardsMini(p) })}
        ${mod(p, { id: 'schedule', name: toolName('schedule', 'Schedule'), body: calendarMini(p, { items: 5 }) })}
        ${mod(p, { id: 'documents', name: toolName('documents', 'Documents'), body: docsMini(p, { items: 4 }) })}
      </div>
      <aside class="bcrail" aria-label="Who is here and what has happened">
        ${mod(p, { id: 'team', slot: 'crew', name: 'The team', body: crewMini(p, { people: 5 }) })}
        ${mod(p, { id: 'team', slot: 'chat', name: 'Chat', body: chatMini(p, { lines: 3 }) })}
        ${mod(p, { id: 'contacts', name: toolName('contacts', 'People'), body: contactsMini(p, { items: 4 }) })}
        ${mod(p, { id: 'sources', slot: 'sources', name: 'Where the material comes from', body: sourcesMini(p, { items: 4 }) })}
        ${mod(p, { id: 'activity', name: toolName('activity', 'Activity'), body: timelineMini(p, { items: 5 }) })}
      </aside>
    </div>
    ${elsewhere(p)}
  </div>`


/* ======================================================================== *
 * C — the board of tools
 *
 * Grant's correction after seeing B: the project home must carry a Docs and
 * Files pane, and all five of To-dos, Card Table, Docs and Files, Schedule and
 * Chat must be understandable from the first screen without clicking through
 * navigation cards. His own Basecamp screenshot does that with a three-column
 * grid of panes above a full-width activity feed.
 *
 * SO THE GRID COMES BACK, and my §20 analysis was wrong about which half was
 * the defect. I blamed the equal-weight composition; the real fault was that
 * every tile was the same `row(title, meta)` primitive with different words in
 * it. Basecamp uses an even grid too. A grid of REAL MINIATURES and a grid of
 * navigation cards look alike in a wireframe and are not the same product, and
 * saying so is cheaper than defending the earlier reading.
 *
 * What survives from B: the state line under the title, the faces in the head,
 * and the phone order. What goes: the companion rail, because a rail can hold
 * three panes and this composition needs eight.
 * ======================================================================== */

/*
  HOW MUCH EACH PANE SHOWS, and it is a composition decision rather than a
  preference.

  The first pass let every pane take the room its content wanted. A grid row is
  as tall as its tallest cell, so a four-tile Docs pane made row one 580px, row
  two began at 900 - exactly the fold - and Schedule, Chat and the team were
  all below it. Which is the thing Grant asked to be fixed: the five tools have
  to be understandable from the first screen.

  So each pane is given the amount that fits a ~320px row, and the reference is
  the measure: Basecamp's own panes are about that tall and show three or four
  items apiece. This is not shrinking things until they are illegible - the
  type sizes are untouched - it is showing fewer things at full size.
*/
const boardMods = (p) => [
  { id: 'tasks', name: toolName('tasks', 'To-dos'), body: todosMini(p, { lists: 2, per: 2 }) },
  { id: 'board', name: 'Card Table', body: cardsMini(p) },
  { id: 'documents', slot: 'documents', name: toolName('documents', 'Docs & Files'), body: docsMini(p, { items: 3 }) },
  { id: 'schedule', name: toolName('schedule', 'Schedule'), body: calendarMini(p, { items: 3 }) },
  { id: 'chat', name: 'Chat', body: chatMini(p, { lines: 2 }) },
  { id: 'team', name: toolName('team', 'The team'), body: crewMini(p, { people: 3 }) },
  { id: 'contacts', name: toolName('contacts', 'People'), body: contactsMini(p, { items: 3 }) },
  { id: 'sources', name: 'Where the material comes from', body: sourcesMini(p, { items: 3 }) },
]

export const compositionC = (p) => {
  const shown = arrangement(p).map((id) => boardMods(p).find((m) => m.id === id)).filter(Boolean)
  return `<div class="bchome bccomp bccomp--c">
    ${head(p)}
    ${arrangePanel(p)}
    <div class="bcpanes">
      ${shown.map((m) => mod(p, m)).join('')}
    </div>
    ${mod(p, {
      id: 'activity',
      name: 'Latest Activity',
      body: timelineMini(p, { items: 6 }),
      wide: true,
      slot: 'activity',
    })}
    ${elsewhere(p)}
  </div>`
}

export const COMPOSITIONS = { a: compositionA, b: compositionB, c: compositionC }
