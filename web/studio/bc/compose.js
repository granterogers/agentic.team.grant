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
import { calendarMini, cardsMini, chatMini, crewMini, docsMini, face, stateLine, timelineMini, todosMini } from './miniatures.js'

let ctx = null
export const mount = (c) => {
  ctx = c
}

const at = (p = '') => `/basecamp${p}`

/** Which composition this viewer is looking at. '' is the shipped build. */
export const chosen = () => {
  try {
    const v = globalThis.localStorage?.getItem('bc.compose') ?? ''
    return v === 'a' || v === 'b' ? v : ''
  } catch {
    return ''
  }
}

export const choose = (v) => {
  try {
    globalThis.localStorage?.setItem('bc.compose', v === 'a' || v === 'b' ? v : '')
  } catch {
    /* A viewer who cannot store a preference still gets a working page. */
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

/* ======================================================================== *
 * A — the briefing
 * ======================================================================== */

export const compositionA = (p) => `<div class="bccomp bccomp--a">
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
    ${mod(p, { id: 'activity', name: 'What has happened', body: timelineMini(p, { items: 6 }), wide: true })}
  </div>`

/* ======================================================================== *
 * B — the workspace
 * ======================================================================== */

export const compositionB = (p) => `<div class="bccomp bccomp--b">
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
        ${mod(p, { id: 'activity', name: 'Activity', body: timelineMini(p, { items: 5 }) })}
      </aside>
    </div>
  </div>`

export const COMPOSITIONS = { a: compositionA, b: compositionB }
