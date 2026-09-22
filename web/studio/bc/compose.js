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

import * as grid from './layout.js'
import { button, esc } from './parts.js'
import {
  calendarMini,
  cardsMini,
  chatMini,
  contactsMini,
  crewMini,
  docsMini,
  mineAndTeam,
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
const mod = (p, { id, name, body, wide = false, slot = '', meta = '', rect = null }) => {
  /*
    THE WHOLE HEADER IS THE TARGET. Grant, 22 September:

      "At present, expanding some minimized panels requires clicking precisely
      on the title text... the entire module header/top section is the
      interaction target... Do not allow interactive controls within the
      header, such as three-dot menus, to accidentally trigger expansion."

    So the header carries the press and the title is a plain heading rather
    than a button. Two things follow, and both are in wire.js because they are
    behaviour rather than markup: the controls inside it stop the event before
    it reaches the header, and a press that MOVED is a drag rather than an
    expand - which is what lets one element be both without a separate grip.
    CLAUDE.md records what a separate grip costs: eighteen buttons inside a
    drag handle that looked fine and did nothing.
  */
  const style =
    rect === null
      ? ''
      : ` style="grid-column:${String(rect.x + 1)}/span ${String(rect.w)};grid-row:${String(rect.y + 1)}/span ${String(rect.h)}"`
  return `<section class="bcmod${wide ? ' bcmod--wide' : ''}${rect === null ? '' : ' bcmod--placed'}" data-mod="${esc(id)}" data-slot="${esc(slot === '' ? id : slot)}"${style}>
    <header class="bcmodhead" data-bc-expand="${esc(id)}" role="button" tabindex="0"
      aria-label="${esc(`${name} — open, or drag to move`)}">
      <h2 class="bcmodtitle">${esc(name)}</h2>
      ${meta === '' ? '' : `<span class="bcmodmeta">${esc(meta)}</span>`}
      ${
        rect === null
          ? ''
          : `<span class="bcmodctl">
              <button type="button" class="bcmodbtn" data-bc-modoff="${esc(id)}"
                aria-label="${esc(`Take ${name} off this page`)}" title="Take it off this page">
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M6 6l12 12M18 6L6 18"></path>
                </svg>
              </button>
            </span>`
      }
    </header>
    <div class="bcmodbody">${body}</div>
    ${
      rect === null
        ? ''
        : `<span class="bcresize" data-bc-resize="${esc(id)}" role="separator"
            aria-label="${esc(`Resize ${name}`)}" tabindex="0" aria-orientation="horizontal">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none"
              stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <path d="M13 6L6 13M13 10.5l-2.5 2.5"></path>
            </svg>
          </span>`
    }
  </section>`
}

/**
 * The project's own head.
 *
 * §16: the project dominates. The name is the largest thing on the page, the
 * people on it are faces rather than a comma-separated list, and the state
 * line sits directly under the name because it is the answer to the question
 * §2 says this page exists to answer.
 */
/*
  No presence cluster in the head either: project home v2 takes team imagery
  off this page entirely, and a row of monograms beside the project name was
  the most decorative instance of it.
*/
const head = (p) => {
  return `<header class="bchead">
    <div class="bcheadtop">
      <h1>${esc(p.name)}</h1>
    </div>
    ${p.purpose ? `<p class="bcheadwhy">${esc(p.purpose)}</p>` : ''}
    <div class="bcheadrow">
      ${stateLine(p)}
      <span class="bcheadacts">
        <!--
          CHAT WITH TEAM, and it is a TOGGLE. Grant: "Clicking it should open
          the team chat sidebar. Clicking the same button again should close
          the sidebar." So the label says what it opens and the control
          carries its own pressed state, painted from whether the dock is
          actually open rather than from a variable this page keeps.
        -->
        ${button('Chat with Team', { kind: 'primary', 'data-bc-dock': '1', 'aria-pressed': 'false' })}
        <!--
          THE MICROPHONE IS A SEPARATE CONTROL, and it starts the call rather
          than opening anything. Grant: do not introduce an intermediate screen
          or another custom chat interface when the microphone is clicked. So
          it presses the studio's own voice path, the same one the call panel
          uses, and nothing is drawn in between.
        -->
        <button type="button" class="bcbtn bcmic" data-bc-voice="1"
          aria-pressed="false" aria-label="Talk to the team out loud">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3"></rect>
            <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"></path>
            <path d="M12 18v3"></path>
          </svg>
        </button>
        <!--
          A three-dot menu, which is where page-level things live now: how this
          page is arranged, where the material comes from, and the project's
          settings. Grant asked for the conventional control rather than a
          sentence, and for those two modules to stop occupying dashboard space.
        -->
        <span class="bcmenuwrap">
          <button type="button" class="bcbtn bcicon" data-bc-pagemenu="1"
            aria-haspopup="menu" aria-expanded="false" aria-label="More about this page">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
              <circle cx="5" cy="12" r="1.7"></circle>
              <circle cx="12" cy="12" r="1.7"></circle>
              <circle cx="19" cy="12" r="1.7"></circle>
            </svg>
          </button>
          <div class="bcmenu" data-bc-pagemenu-panel role="menu" hidden>
            <button type="button" role="menuitem" data-bc-arrange="1">Arrange this page</button>
            <button type="button" role="menuitem" data-bc-expand="team">The team</button>
            <button type="button" role="menuitem" data-bc-sources="1">Sources</button>
            <button type="button" role="menuitem" data-bc-leave="/p/${esc(p.slug)}/settings">Project settings</button>
          </div>
        </span>
      </span>
    </div>
  </header>`
}


/*
  THERE IS NO "ELSEWHERE ON THIS PROJECT" MODULE.

  Grant, 22 September: *"Remove the Elsewhere on this project style module.
  Its purpose is redundant because Project Settings already exists within the
  three-dot project menu."* He is right, and the thing it was written to
  prevent - a tool becoming unreachable because this experience has no surface
  for it - is prevented properly now: the three-dot menu names the team,
  Sources and Project settings, and verify:basecamp-preservation asserts every
  section of the default studio is reachable from this page by SOME press.
  A second list of the same links was duplicate navigation, which is what he
  called it.
*/

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

/*
  THE ARRANGEMENT IS A SET OF RECTANGLES NOW, and it lives in layout.js.

  Grant: *"Do not substitute crude up/down controls for genuine spatial
  rearrangement."* Up and Down are gone with the list they ordered; what is
  left here is the one thing dragging cannot express - putting a module back
  after it has been taken off the page - plus the reset.
*/
const NAMES = {
  tasks: 'To-dos',
  board: 'Card Table',
  documents: 'Docs & Files',
  schedule: 'Schedule',
  contacts: 'People',
  activity: 'Latest Activity',
}

export const arrangement = (slug) => grid.layout(slug).map((m) => m.id)
export const arrangeReset = (slug) => {
  grid.reset(slug)
}

/** The panel that changes the home, opened from the three-dot menu. */
const arrangePanel = (p) => {
  const off = grid.off(p.slug)
  return `<section class="bcarrange" data-bc-arrange-panel hidden>
    <header class="bcmodhead"><h2 class="bcmodtitle">This page</h2></header>
    <p class="bcarrnote">
      Drag a module by its header to move it, and pull the corner to resize
      it. Nothing can overlap: what you drop onto moves down. The cross on a
      header takes that module off the page, which changes nothing but this
      page - the to-dos, documents and messages behind it are untouched.
    </p>
    ${
      off.length === 0
        ? '<p class="bcarrnote">Every module is on the page.</p>'
        : `<div class="bcarradd">
            <span class="bclabel">Put back</span>
            ${off.map((id) => button(NAMES[id] ?? id, { 'data-bc-arr-on': esc(id) })).join('')}
          </div>`
    }
    <p class="bcarrnote">
      Kept on this device for now. It cannot be kept in your office yet: a
      project holds one arrangement and your current dashboard already uses
      it, so saving this there would take panels off that. Issue 299 has the
      fix.
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
  /*
    §21's "Mine / Team" rides in the HEADER, where it costs no height. As a
    block above the lists it added 36px to the tallest pane in row one, and a
    grid row is as tall as its tallest cell - so a one-line summary pushed
    Schedule and Chat below the fold, which is the requirement it was added to
    satisfy. A summary belongs beside the heading anyway.
  */
  { id: 'tasks', name: toolName('tasks', 'To-dos'), meta: mineAndTeam(p), body: todosMini(p, { lists: 4, per: 6 }) },
  { id: 'board', name: 'Card Table', body: cardsMini(p) },
  { id: 'documents', slot: 'documents', name: toolName('documents', 'Docs & Files'), body: docsMini(p, { items: 9 }) },
  { id: 'schedule', name: toolName('schedule', 'Schedule'), body: calendarMini(p, { items: 8 }) },
  /*
    NO CHAT MODULE. Grant: *"It is completely superfluous when the sidebar
    already provides this functionality."* The sidebar is the typed team chat,
    the Chat with Team button opens it, and nothing on the home repeats it.

    NO SOURCES MODULE either - *"not useful enough to occupy dashboard space"* -
    and NO AGENTIC TEAM PANEL: *"The standalone Agentic Team panel on the
    project homepage is superfluous. Remove it. Configuration/management of
    the agentic team belongs in Settings."* Both are in the three-dot menu,
    which is what keeps them REACHABLE while off the board - the distinction
    the preservation check exists to hold.
  */
  { id: 'contacts', name: toolName('contacts', 'People'), body: contactsMini(p, { items: 8 }) },
  /*
    Latest Activity is a module like any other now, rather than a full-width
    band welded under the board. Grant asked not to redesign it and this does
    not: the same renderer, the same rows, placed rather than pinned.
  */
  { id: 'activity', name: 'Latest Activity', slot: 'activity', body: timelineMini(p, { items: 12 }) },
]

/*
  ITEM COUNTS ARE DELIBERATELY LARGER THAN THE PANE.

  Grant: *"Remove patterns such as One More being used merely because
  additional content does not fit. Modules containing more data than their
  visible area should instead become internally scrollable."* A renderer that
  is handed exactly what fits can only ever produce the summary line he is
  objecting to. So each miniature is handed MORE than a default-sized pane
  shows, the body scrolls, and making the pane taller reveals more without
  re-rendering anything.
*/

export const compositionC = (p) => {
  /*
    THE BOARD IS A TWELVE-COLUMN GRID and every module carries its own
    rectangle. The order of the markup no longer decides anything, which is
    the point: a module is where it was put.
  */
  const place = grid.layout(p.slug)
  const by = new Map(boardMods(p).map((m) => [m.id, m]))
  return `<div class="bchome bccomp bccomp--c">
    ${head(p)}
    ${arrangePanel(p)}
    <div class="bcpanes" data-bc-board="${esc(p.slug)}"
      style="--bc-rows:${String(place.reduce((n, m) => Math.max(n, m.y + m.h), 0))}">
      ${place
        .map((r) => {
          const m = by.get(r.id)
          return m === undefined ? '' : mod(p, { ...m, rect: r })
        })
        .join('')}
    </div>
  </div>`
}

export const COMPOSITIONS = { a: compositionA, b: compositionB, c: compositionC }
