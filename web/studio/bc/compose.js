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

import { esc } from './parts.js'
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
    if (v === 'grid') return 'grid'
    return v === 'a' ? 'a' : 'b'
  } catch {
    return 'b'
  }
}

export const choose = (v) => {
  try {
    globalThis.localStorage?.setItem('bc.compose', v === 'a' || v === 'grid' ? v : 'b')
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
    ${stateLine(p)}
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
 * A — the briefing
 * ======================================================================== */

export const compositionA = (p) => `<div class="bchome bccomp bccomp--a">
    ${head(p)}
    ${mod(p, { id: 'tasks', name: 'To-dos', body: todosMini(p, { lists: 3, per: 4 }), wide: true })}
    <div class="bcpair">
      ${mod(p, { id: 'tasks', name: 'Schedule', body: calendarMini(p, { items: 4 }) })}
      ${mod(p, { id: 'tasks', name: 'Where the work is', body: cardsMini(p) })}
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
    ${mod(p, { id: 'documents', name: 'Documents', body: docsMini(p, { items: 4 }), wide: true })}
    <div class="bcpair">
      ${mod(p, { id: 'contacts', name: 'People', body: contactsMini(p, { items: 3 }) })}
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
        ${mod(p, { id: 'tasks', name: 'To-dos', body: todosMini(p, { lists: 3, per: 4 }) })}
        ${mod(p, { id: 'tasks', name: 'Where the work is', body: cardsMini(p) })}
        ${mod(p, { id: 'tasks', name: 'Schedule', body: calendarMini(p, { items: 5 }) })}
        ${mod(p, { id: 'documents', name: 'Documents', body: docsMini(p, { items: 4 }) })}
      </div>
      <aside class="bcrail" aria-label="Who is here and what has happened">
        ${mod(p, { id: 'team', slot: 'crew', name: 'The team', body: crewMini(p, { people: 5 }) })}
        ${mod(p, { id: 'team', slot: 'chat', name: 'Chat', body: chatMini(p, { lines: 3 }) })}
        ${mod(p, { id: 'contacts', name: 'People', body: contactsMini(p, { items: 4 }) })}
        ${mod(p, { id: 'sources', slot: 'sources', name: 'Where the material comes from', body: sourcesMini(p, { items: 4 }) })}
        ${mod(p, { id: 'activity', name: 'Activity', body: timelineMini(p, { items: 5 }) })}
      </aside>
    </div>
    ${elsewhere(p)}
  </div>`

export const COMPOSITIONS = { a: compositionA, b: compositionB }
